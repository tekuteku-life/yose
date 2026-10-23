import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adjustDateForHoliday, calculateCreditCardDebitDate, generateUUID, parseHolidayTextOrCsv } from '../../js/logic/date_utils.js';
import { archivedMasterSources, referencedArchivedMasterSources, findArchivedReferences, buildMasterMigration } from '../../js/logic/master_maintenance.js';
import { mergeMasterConfigs, resolveMasterConflicts, assertMasterReferences } from '../../js/logic/master_sync.js';
import { calculateAnnualBudgetDefaults, calculateAnnualBudgetProgress } from '../../js/logic/budget_engine.js';

describe('Public date defaults and capability boundaries', () => {
	it('keeps a weekend unchanged when no holiday adjustment is requested', () => {
		assert.equal(adjustDateForHoliday('2026-10-10'), '2026-10-10');
	});
	it('scans JSON strings for dates and ignores a JSON boolean without dates', () => {
		assert.deepEqual(parseHolidayTextOrCsv('true'), []);
		assert.deepEqual(parseHolidayTextOrCsv('"2026-1-1"'), ['2026-01-01']);
	});
	it('uses the documented default billing cycle and next-month debit date', () => {
		assert.deepEqual(calculateCreditCardDebitDate('2026-10-14'), {
			billingCycle: '2026-10', billingPeriodStart: '2026-09-16', billingPeriodEnd: '2026-10-15', debitDate: '2026-11-10', rawDebitDate: '2026-11-10'
		});
	});
	for (const capability of ['without-randomUUID', 'without-crypto']) it(`generates timestamped IDs ${capability} without replacing random or time outputs`, () => {
		const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
		const start = Date.now();
		try {
			Object.defineProperty(globalThis, 'crypto', { configurable: true, value: capability === 'without-crypto' ? undefined : {} });
			const ids = [generateUUID('fallback'), generateUUID('fallback')];
			for (const id of ids) {
				assert.match(id, /^fallback_[a-z0-9]+_[a-z0-9]+$/);
				const timestamp = parseInt(id.split('_')[1], 36);
				assert.ok(timestamp >= start && timestamp <= Date.now());
			}
			assert.notEqual(ids[0], ids[1]);
		} finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
	});
});

describe('Archived master migration boundaries', () => {
	it('treats omitted collections as empty and lists an archived parent without children', () => {
		assert.deepEqual(archivedMasterSources({}), []);
		assert.deepEqual(referencedArchivedMasterSources({}, []), []);
		assert.deepEqual(findArchivedReferences([], {}), []);
		assert.deepEqual(archivedMasterSources({ categories: [{ id: 'old', name: '旧費目', is_archived: true }] }), [{ kind: 'category', id: 'old', label: '費目: 旧費目' }]);
	});
	it('migrates expense categories and rejects a nonexistent child without mutation', () => {
		const config = { categories: [{ id: 'old', name: '旧費目', type: 'expense', is_archived: true }, { id: 'new', name: '新費目', type: 'expense' }] };
		const records = [{ id: 'tx', type: 'expense', category_id: 'old', actual_category_id: 'old', amount: 100 }];
		const before = structuredClone({ config, records });
		const source = { kind: 'category', id: 'old' };
		assert.throws(() => buildMasterMigration(records, config, source, { id: 'new', subcategoryId: 'missing' }), /中項目/);
		assert.deepEqual({ config, records }, before);
		assert.deepEqual(buildMasterMigration(records, config, source, { id: 'new' }), [{ ...records[0], category_id: 'new', actual_category_id: 'new', subcategory_id: null, actual_subcategory_id: null }]);
		assert.deepEqual({ config, records }, before);
	});
});

function nameConflict() {
	return mergeMasterConfigs({ accounts: [{ id: 'a', name: '元' }] }, { accounts: [{ id: 'a', name: '手元' }] }, { accounts: [{ id: 'a', name: '同期先' }] });
}
function deletionConflict() {
	return mergeMasterConfigs({ accounts: [{ id: 'a', name: '元' }] }, { accounts: [] }, { accounts: [{ id: 'a', name: '同期先' }] });
}
const chooseRemote = result => new Map(result.conflictDetails.map(detail => [detail.id, 'remote']));

describe('Master reconciliation public contracts', () => {
	it('labels unknown category budgets without inventing a category and resolves their amounts', () => {
		const config = amount => ({ annual_budgets: { 2026: { category_budgets: { missing: amount } } } });
		const result = mergeMasterConfigs(config(100), config(200), config(300));
		assert.match(result.conflictDetails[0].label, /2026年.*名称未設定の費目/);
		assert.equal(resolveMasterConflicts(result, chooseRemote(result)).annual_budgets[2026].category_budgets.missing, 300);
	});
	it('preserves raw account IDs without display names when account collections are absent, then rejects saving dangling references', () => {
		const config = account_id => ({ recurring_rules: [{ id: 'rule', account_id }] });
		const result = mergeMasterConfigs(config('a'), config('b'), config('c'));
		assert.equal(result.conflictDetails[0].localValue, 'b');
		assert.equal(result.conflictDetails[0].remoteValue, 'c');
		assert.equal(result.conflictDetails[0].localDisplayName, undefined);
		assert.equal(result.conflictDetails[0].remoteDisplayName, undefined);
		assert.throws(() => assertMasterReferences(resolveMasterConflicts(result, chooseRemote(result))), /c.*存在しません/);
	});
	it('applies holiday deletions from both devices', () => {
		const result = mergeMasterConfigs({ holidays: ['2026-01-01', '2026-01-12'] }, { holidays: ['2026-01-01'] }, { holidays: ['2026-01-12'] });
		assert.deepEqual(result.config.holidays, []);
		assert.deepEqual(result.conflicts, []);
	});
	it('permits selecting deletion in a generated whole-config conflict', () => {
		const result = mergeMasterConfigs({}, undefined, { changed: true });
		assert.equal(result.conflictDetails[0].hasLocal, false);
		assert.equal(resolveMasterConflicts(result, new Map([[result.conflictDetails[0].id, 'local']])), undefined);
	});
	for (const value of [null, {}, { conflictDetails: {} }]) it(`rejects missing conflict metadata ${JSON.stringify(value)}`, () => {
		const before = structuredClone(value);
		assert.throws(() => resolveMasterConflicts(value, new Map()), /競合情報/);
		assert.deepEqual(value, before);
	});
	for (const [field, value] of [['hasLocal', undefined], ['hasRemote', undefined], ['hasLocal', false], ['hasRemote', false]]) it(`rejects an inconsistent ${field} flag ${value}`, () => {
		const result = nameConflict(); result.conflictDetails[0][field] = value;
		const before = structuredClone(result);
		assert.throws(() => resolveMasterConflicts(result, chooseRemote(result)), /有無/);
		assert.deepEqual(result, before);
	});
	for (const [label, modify, error] of [
		['changed collection type', result => { result.config.accounts = {}; }, /配列参照/],
		['removed item', result => { result.config.accounts = []; }, /項目参照/]
	]) it(`rejects a stale field conflict after a ${label} without mutating its input`, () => {
		const result = nameConflict(); modify(result); const before = structuredClone(result);
		assert.throws(() => resolveMasterConflicts(result, chooseRemote(result)), error);
		assert.deepEqual(result, before);
	});
	it('rejects a stale object field when its parent became null', () => {
		const result = mergeMasterConfigs({ name: '元' }, { name: '手元' }, { name: '同期先' });
		result.config = null; const before = structuredClone(result);
		assert.throws(() => resolveMasterConflicts(result, chooseRemote(result)), /参照先/);
		assert.deepEqual(result, before);
	});
	it('rejects a stale item conflict when its collection ceased to be an array', () => {
		const result = deletionConflict(); result.config.accounts = {}; const before = structuredClone(result);
		assert.throws(() => resolveMasterConflicts(result, chooseRemote(result)), /配列参照/);
		assert.deepEqual(result, before);
	});
	for (const value of [null, 1, { id: 'another' }]) it(`rejects a selected item with an invalid ID ${JSON.stringify(value)}`, () => {
		const result = deletionConflict(); result.conflictDetails[0].remoteValue = value; const before = structuredClone(result);
		assert.throws(() => resolveMasterConflicts(result, chooseRemote(result)), /ID参照/);
		assert.deepEqual(result, before);
	});
	it('permits omitted master collections and child lists but rejects malformed collection types', () => {
		assert.doesNotThrow(() => assertMasterReferences({}));
		assert.doesNotThrow(() => assertMasterReferences({ categories: [{ id: 'food' }] }));
		for (const field of ['accounts', 'categories', 'recurring_rules']) assert.throws(() => assertMasterReferences({ [field]: {} }), /設定形式/);
		assert.throws(() => assertMasterReferences({ accounts: [{ id: 'a', settlement_account_id: 'missing' }] }), /a.*精算口座.*missing/);
	});
});

describe('Budget totals and owned forbidden keys', () => {
	it('keeps a year with no income or spending at zero, including a category without prior spending', () => {
		const expected = { expense_budget: 0, savings_target_amount: 0, savings_target_rate: 0, category_budgets: { food: 0 } };
		assert.deepEqual(calculateAnnualBudgetDefaults({ previousYearSummary: { expense: 0, net: 0, income: 0, savings_rate: 0 }, categories: [{ id: 'food', type: 'expense' }] }), expected);
		assert.deepEqual(calculateAnnualBudgetDefaults({ previousYearSummary: { expense: 0, income: 0 }, categories: [{ id: 'food', type: 'expense' }] }), expected);
		const progress = calculateAnnualBudgetProgress({ expenseBudget: 0, savingsTargetAmount: 0, savingsTargetRate: 0, expenseActual: 0, incomeActual: 0, netSavingsActual: 0, currentMonth: 1 });
		for (const key of ['expense_budget', 'expense_actual', 'expense_remaining', 'expense_consumption_rate', 'savings_target_amount', 'savings_actual', 'savings_achievement_rate', 'savings_remaining', 'savings_target_rate', 'savings_actual_rate']) assert.equal(progress[key], 0, key);
		assert.equal(progress.savings_rate_achieved, false);
		assert.equal(progress.is_deficit, false);
		assert.equal(progress.pace_status, 'on_pace');
	});
	it('ignores forbidden own keys in every category source and leaves Object.prototype unchanged', () => {
		const before = Object.getOwnPropertyDescriptors(Object.prototype);
		const forbidden = ['__proto__', 'constructor', 'prototype'];
		const owned = JSON.parse('{"__proto__":100000,"constructor":100000,"prototype":100000,"food":1000}');
		assert.ok(Object.hasOwn(owned, '__proto__'));
		const result = calculateAnnualBudgetDefaults({ previousYearSummary: { by_category: owned }, pastTransactions: forbidden.map(category_id => ({ type: 'expense', category_id, amount: 100000 })), categories: [...forbidden.map(id => ({ id })), { id: 'food' }] });
		assert.deepEqual(result.category_budgets, { food: 1000 });
		assert.equal(result.expense_budget, 1000);
		const progress = calculateAnnualBudgetProgress({ categoryBudgets: owned, categoryActuals: { food: 100 }, currentMonth: 1 });
		assert.deepEqual(Object.keys(progress.category_progress), ['food']);
		assert.equal(progress.total_category_budget, 1000);
		assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
	});
	it('keeps transaction totals over duplicate summary totals and excludes nonpositive summary categories', () => {
		const result = calculateAnnualBudgetDefaults({ pastTransactions: [{ type: 'expense', category_id: 'food', amount: 0 }, { type: 'expense', category_id: 'food', amount: 1000 }], previousYearSummary: { by_category: { food: 9999, zero: 0, empty: null, object: { total: 0 } } } });
		assert.deepEqual(result.category_budgets, { food: 1000 });
		assert.equal(result.expense_budget, 1000);
	});
	it('keeps zero category budgets finite when actual spending is positive', () => {
		const result = calculateAnnualBudgetProgress({ categoryBudgets: { food: 0 }, categoryActuals: { food: 100 }, currentMonth: 1 });
		assert.deepEqual(result.category_progress.food, { budget: 0, actual: 100, remaining: -100, consumption_rate: 0, pace_status: 'on_pace' });
	});
});
