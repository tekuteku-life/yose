import { it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMasterConfigs, resolveMasterConflicts } from '../../js/logic/master_sync.js';
const base = { annual_budgets: { 2026: { expense_budget: 800, savings_target_amount: 200, savings_target_rate: 20 } } };
it('conflicts on parallel basis and primary-input changes and keeps independent unrelated fields in either choice', () => {
	const local=structuredClone(base), remote=structuredClone(base);
	local.annual_budgets[2026].goal_basis='rate';local.annual_budgets[2026].category_budgets={ food: 50 };
	remote.annual_budgets[2026].savings_target_rate=30;remote.annual_budgets[2026].furusato_estimate={resident_tax:200000,income_tax_rate:20};
	const result=mergeMasterConfigs(base,local,remote);assert.ok(result.conflicts.length);
	for(const choice of ['local','remote']) {
		const config=resolveMasterConflicts(result,new Map(result.conflictDetails.map(d=>[d.id,choice]))), entry=config.annual_budgets[2026];
		assert.equal(entry.goal_basis,choice==='local'?'rate':undefined);assert.equal(entry.savings_target_rate,choice==='local'?20:30);
		assert.deepEqual(entry.category_budgets,{food:50});assert.equal(entry.furusato_estimate.resident_tax,200000);
	}
});
it('preserves implicit independent shape, while equivalent explicit independent does not conflict', () => {
	const local=structuredClone(base), remote=structuredClone(base);local.annual_budgets[2026].goal_basis='independent';remote.annual_budgets[2026].category_budgets={ food: 50 };
	const result=mergeMasterConfigs(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.config.annual_budgets[2026].goal_basis,'independent');
});
it('treats missing and explicit independent as equivalent while preserving the adopted primary input shape', () => {
	const local=structuredClone(base), remote=structuredClone(base);local.annual_budgets[2026].goal_basis='independent';remote.annual_budgets[2026].savings_target_rate=30;
	const result=mergeMasterConfigs(base,local,remote);assert.deepEqual(result.conflicts,[]);assert.equal(result.config.annual_budgets[2026].savings_target_rate,30);assert.equal(result.config.annual_budgets[2026].goal_basis,undefined);
});
it('includes the legacy rate alias in basis/input conflicts', () => {
	const previous={annual_budgets:{2026:{expense_budget:800,savings_target_amount:200,target_savings_rate:20}}}, local=structuredClone(previous),remote=structuredClone(previous);
	local.annual_budgets[2026].goal_basis='rate';remote.annual_budgets[2026].target_savings_rate=30;
	const result=mergeMasterConfigs(previous,local,remote);assert.ok(result.conflicts.length);
	const resolved=resolveMasterConflicts(result,new Map(result.conflictDetails.map(d=>[d.id,'remote'])));
	assert.equal(resolved.annual_budgets[2026].goal_basis,undefined);assert.equal(resolved.annual_budgets[2026].target_savings_rate,30);assert.equal(resolved.annual_budgets[2026].savings_target_rate,undefined);
});
it('keeps category conflict choices independent of goal tuple choices in either order', () => {
	const previous=structuredClone(base);previous.annual_budgets[2026].category_budgets={food:100};
	const local=structuredClone(previous),remote=structuredClone(previous);local.annual_budgets[2026].goal_basis='rate';local.annual_budgets[2026].category_budgets.food=200;remote.annual_budgets[2026].savings_target_rate=30;remote.annual_budgets[2026].category_budgets.food=300;
	for(const reverse of [false,true]) {
		const result=mergeMasterConfigs(previous,local,remote);if(reverse)result.conflictDetails.reverse();
		const choices=new Map(result.conflictDetails.map(d=>[d.id,d.path.endsWith('.food')?'remote':'local']));
		const config=resolveMasterConflicts(result,choices);assert.equal(config.annual_budgets[2026].category_budgets.food,300);assert.equal(config.annual_budgets[2026].goal_basis,'rate');assert.equal(config.annual_budgets[2026].savings_target_rate,20);
	}
});
it('rejects tampered goal conflict metadata rather than applying it to unrelated master fields', () => {
	const local=structuredClone(base),remote=structuredClone(base);local.annual_budgets[2026].goal_basis='rate';remote.annual_budgets[2026].savings_target_rate=30;
	const result=mergeMasterConfigs(base,local,remote), choice=new Map(result.conflictDetails.map(d=>[d.id,'local']));
	for(const mutate of [d=>{d.kind='invented';},d=>{d.segments=['accounts','2026'];},d=>{d.localValue={accounts:[]};}]) {
		const invalid=structuredClone(result);mutate(invalid.conflictDetails[0]);assert.throws(()=>resolveMasterConflicts(invalid,choice));
	}
});
