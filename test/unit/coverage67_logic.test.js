import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCategoryTrend } from '../../js/logic/category_trend.js';
import { businessChanges, countBusinessChanges, unionBusinessChanges } from '../../js/logic/sync_changes.js';
import { calculateAnnualBudgetDefaults, calculateAnnualBudgetProgress, resolveAnnualTargets } from '../../js/logic/budget_engine.js';
import { buildAssetHistory, calculateBalancesAndSummaries, aggregateDailySummaries, aggregateMonthlySummaries, aggregateYearlySummaries, calculateTagSummary, calculateTotalAssetSummary, calculateCrossAccrualActualSummary, formatDoughnutTooltipLabel, resolveTransactionDisplayInfo, filterTransactionsByCriteria } from '../../js/logic/aggregator.js';
import { calculateTax, evaluateCalculatorExpression, planRecurringTransactions, generateRecurringTransactions, syncInsuranceRecurringRule, createAdvancePaymentTransactions, createCreditCardSettlementTransaction } from '../../js/logic/transaction_factory.js';
import { transaction } from '../helpers/ui_fixture.js';

describe('review67 legacy income and budget calculations', () => {
	const income = patch => transaction('income', { type: 'income', category_id: 'salary', subcategory_id: null, actual_category_id: null, amount: 120, ...patch });
	const config = { categories: [{ id: 'salary', name: '給与', type: 'income' }] };
	const build = (rows, summaries, options = {}) => buildCategoryTrend(rows, { monthly_summaries: summaries }, config, { type: 'income', month: '2026-10', ...options });
	for (const alias of ['income_total', 'income_confirmed', 'total_income']) {
		for (const acquired of [true, false]) it(`attributes ${alias} only with a complete acquired archive, acquired=${acquired}`, () => {
			const rows = [income({ target_month: '2026-09', date: '2026-09-02' })], summaries = { '2026-09': { [alias]: 120 }, '2025-09': { [alias]: 50 } };
			const before = structuredClone({ rows, summaries });
			const data = build(rows, summaries, { actualAxis: true, historyOptions: acquired ? { archiveMonths: ['2026-09'] } : {} });
			if (acquired) { assert.deepEqual(data.series.map(row => row.id), ['salary']); assert.equal(data.series[0].values[8], 120); }
			else { assert.equal(data.series.length, 1); assert.equal(data.series[0].kind, 'unknown'); assert.equal(data.series[0].values[8], 120); }
			assert.deepEqual({ rows, summaries }, before);
		});
	}
	it('does not attribute an incomplete archive and keeps a zero legacy month empty', () => {
		const data = build([income({ target_month: '2026-09', amount: 119 })], { '2026-09': { income_total: 120 }, '2026-08': {} }, { historyOptions: { archiveMonths: ['2026-09', '2026-08'] } });
		assert.equal(data.series.length, 1); assert.equal(data.series[0].kind, 'unknown'); assert.equal(data.series[0].values[8], 120); assert.equal(data.series[0].values[7], 0);
	});
	it('recovers date-only legacy income and unclassified actual income across years', () => {
		const data = build([income({ target_month: undefined, date: '2025-10-10', category_id: null }), income({ target_month: undefined, date: undefined, amount: 999 })], { '2026-09': { total_income: 50 } }, { granularity: 'yearly', actualAxis: true });
		assert.deepEqual(data.labels, ['2025', '2026']); assert.deepEqual(data.series.find(row => row.id === 'cat_unclassified').values, [120, 0]); assert.deepEqual(data.series.find(row => row.kind === 'unknown').values, [0, 50]);
	});
	it('recovers an acquired archive without a target_month into its unclassified category', () => {
		const data = build([income({ target_month: undefined, date: '2026-09-02', category_id: null })], { '2026-09': { income_total: 120 } }, { actualAxis: true, historyOptions: { archiveMonths: ['2026-09'] } });
		assert.equal(data.series[0].id, 'cat_unclassified'); assert.equal(data.series[0].values[8], 120);
	});
	it('uses actual income classification for unclosed and complete archived rows and keeps zero amounts', () => {
		const rows = [income({ category_id: 'salary', actual_category_id: 'other', amount: 0 }), income({ target_month: '2026-09', amount: 120, actual_category_id: 'other' })];
		const data = build(rows, { '2026-09': { income_total: 120 } }, { actualAxis: true, historyOptions: { archiveMonths: ['2026-09'] } }); assert.deepEqual(data.series.map(row => row.id), ['other']); assert.equal(data.series[0].values[8], 120); assert.equal(data.series[0].values[9], 0);
	});
	it('derives defaults from a previous year with expenses but no income', () => {
		assert.deepEqual(calculateAnnualBudgetDefaults({ previousYearSummary: { expense: 1234, by_category: { food: 1234 } }, targetYear: 2026 }), { expense_budget: 1200, savings_target_amount: 0, savings_target_rate: 0, category_budgets: { food: 1200 } });
	});
	it('uses summary income when omitted and reports linked zero allowance exceeded', () => {
		const data = calculateAnnualBudgetProgress({ yearlySummary: { income: 100, expense: 1 }, budgetConfig: { goal_basis: 'savings', savings_target_amount: 100 }, currentMonth: 1 });
		assert.equal(data.expense_budget, 0); assert.equal(data.pace_status, 'over_budget');
		const zero = calculateAnnualBudgetProgress({ yearlySummary: { income: 100, expense: 0 }, budgetConfig: { goal_basis: 'savings', savings_target_amount: 100 }, currentMonth: 1 });
		assert.equal(zero.pace_status, 'on_pace');
	});
	for (const rate of ['3', Infinity, -1, 101]) it(`rejects an independent invalid savings rate ${rate}`, () => {
		assert.equal(resolveAnnualTargets({ savings_target_rate: rate }, 100).valid, false);
		assert.equal(resolveAnnualTargets({ savings_target_rate: 0 }, 100).valid, true);
	});
});

describe('review67 initial and removed business identities', () => {
	it('handles absent master states in both directions without inventing identities', () => {
		const state = { master_config: { accounts: [{ id: 'custom-wallet', name: '現金' }], holidays: ['2026-01-01'] } }, before = structuredClone(state);
		for (const pair of [[undefined, state], [state, undefined], [{}, state], [state, {}]]) {
			assert.deepEqual(businessChanges(...pair), { accounts: ['custom-wallet'], holidays: ['2026-01-01'] });
			assert.deepEqual(countBusinessChanges(businessChanges(...pair)), { accounts: 1, holidays: 1 });
		}
		assert.deepEqual(businessChanges(), {}); assert.deepEqual(unionBusinessChanges({ accounts: ['a'] }), { accounts: ['a'] }); assert.deepEqual(state, before);
	});
});

describe('review67 existing asset anchors and factory defaults', () => {
	it('uses legacy closing account_balances and rolls subsequent transactions once', () => {
		const snapshot = { last_closed_month: '2026-09', account_balances: { wallet: 1000 } }, accounts = [{ id: 'wallet', type: 'cash', initial_balance: 9999 }];
		const data = buildAssetHistory(snapshot, [transaction('later', { account_id: 'wallet', amount: 100, target_month: '2026-10', date: '2026-10-02' })], accounts, { mode: 'range', start: '2026-09-30', end: '2026-10-03', today: '2026-10-03' });
		assert.deepEqual(data.points.map(point => point.net_assets), [1000, 1000, 900, 900]);
	});
	for (const range of [{}, { start: '2026-02-30', end: '2026-03-01' }, { start: '2026-01-01' }]) it(`rejects an invalid explicit asset range ${JSON.stringify(range)}`, () => {
		assert.throws(() => buildAssetHistory({}, [], [], { mode: 'range', ...range }), /開始日・終了日/);
	});
	it('keeps old external asset amount aliases and excludes deleted tag rows', () => {
		const data = calculateTotalAssetSummary({}, [], [{ id: 'a', current_value: 12 }, { id: 'b', market_value: 20 }, { id: 'c', amount: 30 }]);
		assert.equal(data.external_assets_total, 62);
		const tags = calculateTagSummary([transaction('tagged', { amount: 7, tags: [' food ', '', '   '] }), transaction('deleted', { amount: 99, tags: ['food'], is_deleted: true })]);
		assert.equal(tags.tags.food.expense, 7); assert.equal(Object.keys(tags.tags).length, 1);
	});
	it('retains numeric and object historical summaries without adding downloaded rows twice', () => {
		const historical = { '2025-10': { income_total: 100, expense_total: 12, by_category: { food: 12 }, by_actual_category: { actual: { total: 12 } } } };
		const rows = [transaction('downloaded', { target_month: '2025-10', amount: 999 })];
		const monthly = aggregateMonthlySummaries(rows, '2025', historical), yearly = aggregateYearlySummaries(rows, historical);
		assert.equal(monthly.months['2025-10'].expense_total, 12); assert.equal(yearly['2025'].expense, 12); assert.equal(yearly['2025'].by_category.food, 12); assert.equal(yearly['2025'].by_actual_category.actual, 12);
	});
	it('keeps empty category mappings and zero doughnut totals finite', () => {
		const data = calculateCrossAccrualActualSummary([], []); assert.deepEqual(data.matrix, {}); assert.deepEqual(data.categoryIds, []); assert.equal(data.grandTotal, 0);
		assert.match(formatDoughnutTooltipLabel('ゼロ', 0, [0, -1]), /0%/);
	});
	it('creates and updates insurance rules using omitted premium day and selected first category', () => {
		const config = { categories: [{ id: 'custom-expense' }] }, account = { id: 'custom-insurance', type: 'insurance', premium_amount: 1500, premium_pay_account_id: 'wallet' };
		const first = syncInsuranceRecurringRule(config, account, '2026-10-29'); assert.equal(first.name, '[保険料] custom-insurance'); assert.equal(first.day_of_month, 27); assert.equal(first.category_id, 'custom-expense'); assert.equal(first.start_date, '2026-10-01');
		const changed = syncInsuranceRecurringRule(config, { ...account, premium_day: 31, premium_category_id: 'chosen', premium_subcategory_id: 'chosen-child' }, '2026-11-29');
		assert.equal(changed.start_date, '2026-10-01'); assert.equal(changed.day_of_month, 31); assert.equal(changed.category_id, 'chosen'); assert.equal(changed.subcategory_id, 'chosen-child'); assert.equal(config.recurring_rules.length, 1);
	});
	it('retains pending zero amounts and omitted interval/holidays in legacy monthly rules', () => {
		const rule = { id: 'legacy', is_active: true, account_id: 'wallet', category_id: 'food', day_of_month: 1, frequency: 'interval_months', amount: 0, amount_pending: true };
		const result = planRecurringTransactions([rule], '2026-10'); assert.equal(result.generated.length, 1); assert.equal(result.generated[0].amount, 0); assert.equal(result.generated[0].amount_pending, true); assert.equal(result.generated[0].status, 'planned'); assert.equal(result.skipped_count, 0);
		assert.equal(generateRecurringTransactions([rule], '2026-10').length, 1);
	});
	it('rounds tax and calculator results through their public input forms', () => {
		assert.equal(calculateTax(105, 0.1, 'round').amount, 116); assert.equal(evaluateCalculatorExpression('105', 'add10', 'round').amount, 116); assert.equal(evaluateCalculatorExpression().amount, 0);
		assert.equal(evaluateCalculatorExpression('116', 'sub10', 'round').tax_meta.tax_amount, 11);
		assert.equal(evaluateCalculatorExpression('116', 'plain').amount, 116);
	});
	it('does not treat a financial source reference as an ordinary manual recurring duplicate', () => {
		const rule = { id: 'one', is_active: true, account_id: 'wallet', category_id: 'food', amount: 10, frequency: 'interval_months', start_date: '2026-09-01' };
		const row = transaction('manual', { target_month: '2026-10', type: undefined, account_id: 'wallet', category_id: 'food', amount: 10, subcategory_id: null, actual_category_id: 'food' });
		assert.equal(planRecurringTransactions([rule], '2026-10', [], [row]).skipped_count, 1);
		const referenced = [row, transaction('linked-repayment', { type: 'income', advance_source_ids: ['manual'] })]; assert.equal(planRecurringTransactions([rule], '2026-10', [], referenced).generated.length, 1);
	});
	it('does not create empty advance splits and keeps a genuine zero card settlement', () => {
		assert.deepEqual(createAdvancePaymentTransactions({ date: '2026-10-01', payingAccountId: 'wallet', categoryId: 'food' }), []);
		const settlement = createCreditCardSettlementTransaction({ payingAccountId: 'wallet', creditCardId: 'card', amount: 0, debitDate: '2026-10-01', billingCycle: '2026-09' }); assert.equal(settlement.amount, 0); assert.equal(settlement.to_account_id, 'card');
	});
	it('keeps a documented legacy insurance default when category metadata is absent', () => {
		const config = {}, account = { id: 'legacy-insurance', type: 'insurance', premium_amount: 1, premium_pay_account_id: 'wallet' };
		const rule = syncInsuranceRecurringRule(config, account, '2026-10-01'); assert.equal(rule.category_id, 'cat_food'); assert.equal(rule.actual_category_id, 'cat_food'); assert.equal(rule.amount, 1);
	});
});

describe('review67 zero data and historical aggregation forms', () => {
	it('returns usable zero summaries for omitted optional inputs', () => {
		assert.equal(buildAssetHistory().mode, 'month'); assert.ok(buildAssetHistory().points.every(row => row.net_assets === 0));
		assert.equal(calculateBalancesAndSummaries().expense_total, 0); assert.equal(aggregateDailySummaries().total_income, 0); assert.equal(Object.keys(aggregateMonthlySummaries().months).length, 12); assert.deepEqual(aggregateYearlySummaries(), {}); assert.deepEqual(calculateTagSummary().tags, {});
	});
	it('uses legacy empty closing maps and year defaults without inventing funds', () => {
		const data = buildAssetHistory({ last_closed_month: '2026-09' }, [], [], { mode: 'year', today: '2026-10-29' }); assert.equal(data.points.at(-1).date, '2026-10-29'); assert.ok(data.points.every(row => row.net_assets === 0));
		const future = buildAssetHistory({}, [], [], { month: '2027-01', today: '2026-10-29' }); assert.deepEqual(future.points, []); assert.match(future.notice, /表示できる確定履歴はない/);
	});
	it('keeps the first day and last observation in a long explicit range', () => {
		const result = buildAssetHistory({}, [], [{ id: 'wallet', type: 'cash', initial_balance: 10 }], { mode: 'range', start: '2026-01-02', end: '2026-10-29', today: '2026-10-29' }); assert.equal(result.points[0].date, '2026-01-02'); assert.equal(result.points.at(-1).date, '2026-10-29'); assert.ok(result.points.every(point => point.net_assets === 10));
	});
	it('normalizes old confirmed-only and empty category buckets in both axes', () => {
		const summaries = { '2026-09': { expense_confirmed: 3, by_category: { food: { confirmed: 3 }, empty: {} }, by_actual_category: { actual: { confirmed: 3 }, empty: {} } } };
		const monthly = aggregateMonthlySummaries([transaction('outside', { target_month: '2026-13' })], '2026', summaries).months['2026-09']; assert.deepEqual(monthly.by_category, { food: 3, empty: 0 }); assert.deepEqual(monthly.by_actual_category, { actual: 3, empty: 0 });
		const yearly = aggregateYearlySummaries([], summaries)['2026']; assert.equal(yearly.expense, 3); assert.deepEqual(yearly.by_category, { food: 3, empty: 0 }); assert.deepEqual(yearly.by_actual_category, { actual: 3, empty: 0 });
	});
	it('applies tag and cross-table month filters to legacy rows without tags', () => {
		const rows = [transaction('selected', { amount: 7 }), transaction('other', { target_month: '2026-09', amount: 99, tags: undefined })];
		assert.equal(calculateTagSummary(rows, { targetMonth: '2026-10' }).total_expense, 7); assert.equal(calculateCrossAccrualActualSummary(rows, '2026-10').grandTotal, 7); assert.deepEqual(filterTransactionsByCriteria(rows, { tag: 'absent' }), []);
		assert.deepEqual(filterTransactionsByCriteria(null), []); assert.equal(calculateCrossAccrualActualSummary(null).grandTotal, 0);
	});
	it('normalizes absent legacy asset amounts, transfer tags and empty chart totals', () => {
		assert.equal(calculateTotalAssetSummary({}, [], [{ id: 'old-position' }, { id: 'zero-position', amount: 0 }]).external_assets_total, 0);
		assert.deepEqual(resolveTransactionDisplayInfo({ type: 'transfer', tags: undefined }).tags, []); assert.deepEqual(resolveTransactionDisplayInfo({ type: 'transfer', tags: ['', 'retained'] }).tags, ['retained']); assert.match(formatDoughnutTooltipLabel('空', 0, null), /0%/);
	});
});
