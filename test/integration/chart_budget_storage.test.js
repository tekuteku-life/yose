import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { dataIntegrity } from '../../js/logic/data_integrity.js';
import { DEFAULT_MASTER_CONFIG } from '../../js/db/defaults.js';
const incomeMap = amount => ({ cat_income_main: { total: amount, by_subcategory: { sub_salary: amount } } });
const summary = () => ({ income_total: 100, by_income_category: incomeMap(100), by_actual_income_category: incomeMap(100) });
it('roundtrips encrypted linked goals and keeps legacy goal/input units in non-destructive imports', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveAnnualBudget('2026', { expense_budget: 50, savings_target_amount: 0, savings_target_rate: 0 });
	await db.importFullData({ annual_budgets: { 2026: { goal_basis: 'rate', savings_target_rate: 20 }, 2027: { goal_basis: 'rate', savings_target_rate: 20 } } });
	assert.equal((await db.getAnnualBudget('2026')).goal_basis, undefined);
	assert.equal((await db.getAnnualBudget('2027')).goal_basis, 'rate');
	assert.equal((await db.getRaw('master_config', 'current')).encrypted, true);
	const before = await db.captureImportState();
	for (const invalid of [{ goal_basis: 'other' }, { savings_target_rate: 101 }, { expense_budget: -1 }]) {
		await assert.rejects(db.importFullData({ annual_budgets: { 2026: invalid } })); assert.deepEqual(await db.captureImportState(), before);
	}
	const copy = new YoseDB(); await copy.init(); await copy.importFullData(await db.exportFullData());
	assert.equal((await copy.getAnnualBudget('2027')).goal_basis, 'rate');
});
it('validates income map structure, sums, reference kinds, children, and ignored snapshots before any write', async () => {
	const master = structuredClone(DEFAULT_MASTER_CONFIG);
	const valid = summary();
	assert.deepEqual(dataIntegrity.issues({ master_config: master, summary_snapshot: { monthly_summaries: { '2026-09': valid } } }), []);
	for (const mutate of [
		s => { delete s.by_actual_income_category; }, s => { s.by_income_category = { cat_food: { total: 100, by_subcategory: { sub_unclassified: 100 } } }; },
		s => { s.by_income_category.cat_income_main.total = 99; }, s => { s.by_income_category.cat_income_main.by_subcategory.sub_salary = 99; },
		s => { s.by_income_category.cat_income_main.by_subcategory = { missing: 100 }; }, s => { s.by_income_category.cat_income_main = 100; },
		s => { s.income_total = Number.MAX_SAFE_INTEGER + 1; }, s => { s.by_income_category.cat_income_main.total = -1; }
	]) {
		const bad = summary(); mutate(bad);
		assert.ok(dataIntegrity.issues({ master_config: master, summary_snapshot: { monthly_summaries: { '2026-09': bad } } }).length);
		const db = new YoseDB(); await db.init(); await db.saveSnapshot({ monthly_summaries: { '2026-09': valid } });
		const before = await db.captureImportState();
		await assert.rejects(db.importFullData({ summary_snapshot: { monthly_summaries: { '2026-09': bad } } }));
		assert.deepEqual(await db.captureImportState(), before);
	}
});
