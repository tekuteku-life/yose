import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDataMetadata, buildFurusatoSummary, estimateFurusatoLimit } from '../../js/logic/data_insights.js';
import { investmentAtDate, applyInvestmentValuations } from '../../js/logic/investment.js';
import { transaction } from '../helpers/ui_fixture.js';

const tx = (id, values = {}) => transaction(id, values);
const stock = { id: 'stock', name: '証券', type: 'investment', is_asset: true, initial_balance: 0 };
const config = { accounts: [stock], categories: [{ id: 'donation', type: 'expense', name: 'ふるさと納税', subcategories: [] }] };
describe('data metadata', () => {
	it('counts UTF-8 bytes of the entire business JSON, includes empty calendar periods, and separates tombstones', () => {
		const state = { master_config: config, summary_snapshot: {}, transactions: [tx('a', { date: '2024-12-01', memo: '日本語' }), tx('b', { date: '2026-02-01', status: 'planned' }), tx('gone', { is_deleted: true })] };
		const result = buildDataMetadata(state);
		assert.equal(result.bytes, new TextEncoder().encode(JSON.stringify(state)).length);
		assert.equal(result.count, 2); assert.equal(result.deleted, 1);
		assert.equal(result.confirmed, 1); assert.equal(result.planned, 1);
		assert.equal(result.months, 15); assert.equal(result.years, 3);
		assert.equal(result.monthlyAverage, 2 / 15); assert.equal(result.yearlyAverage, 2 / 3);
	});
	it('handles an empty database without division by zero', () => {
		const result = buildDataMetadata({});
		assert.equal(result.count, 0); assert.equal(result.monthlyAverage, 0); assert.equal(result.firstDate, null);
	});
});
describe('furusato budget', () => {
	it('uses calendar donation date, exact category/subcategory/tag names, and separates planned and deleted', () => {
		const rows = [tx('tag', { tags: ['ふるさと納税'], amount: 10000 }), tx('category', { category_id: 'donation', amount: 20000, target_month: '2027-01' }), tx('planned', { tags: ['ふるさと納税'], status: 'planned', amount: 5000 }), tx('memo', { memo: 'ふるさと納税', amount: 500 }), tx('deleted', { tags: ['ふるさと納税'], is_deleted: true }), tx('prior', { date: '2025-12-31', type: 'income', amount: 3000000 }), tx('incomeplan', { date: '2025-01-01', type: 'income', amount: 9, status: 'planned' })];
		const r = buildFurusatoSummary(rows, config, '2026');
		assert.deepEqual(r.records.map(t => t.id).sort(), ['category', 'planned', 'tag']);
		assert.equal(r.confirmed, 30000); assert.equal(r.planned, 5000); assert.equal(r.previousIncome, 3000000);
		assert.equal(r.limit, null); assert.equal(r.remaining, null);
	});
	it('detects an archived subcategory and ignores transfers or actual-axis duplicates', () => {
		const c = { categories: [{ id: 'tax', name: '税金', subcategories: [{ id: 'f', name: 'ふるさと納税', is_archived: true }] }] };
		const rows = [tx('sub', { category_id: 'tax', subcategory_id: 'f', amount: 100 }), tx('transfer', { type: 'transfer', tags: ['ふるさと納税'] }), tx('actual', { actual_category_id: 'tax', actual_subcategory_id: 'f' })];
		assert.deepEqual(buildFurusatoSummary(rows, c, 2026).records.map(t => t.id), ['sub']);
	});
	it('calculates official formula conservatively and represents excess as a negative remainder', () => {
		const input = { resident_tax: 200000, income_tax_rate: 20 };
		assert.equal(estimateFurusatoLimit(input, 2026), 59487);
		const r = buildFurusatoSummary([tx('over', { tags: ['ふるさと納税'], amount: 100000 })], { annual_budgets: { 2026: { furusato_estimate: input } } }, 2026);
		assert.equal(r.remaining, r.limit - 100000); assert.ok(r.remaining < 0);
	});
	it('distinguishes missing and zero inputs and refuses unsupported years and invalid tax rates', () => {
		assert.equal(estimateFurusatoLimit(undefined, 2026), null);
		assert.equal(estimateFurusatoLimit({ resident_tax: 0, income_tax_rate: 0 }, 2026), 0);
		for (const year of [2014, 2038]) assert.equal(estimateFurusatoLimit({ resident_tax: 20000, income_tax_rate: 5 }, year), null);
		for (const input of [{ resident_tax: -1, income_tax_rate: 5 }, { resident_tax: 100, income_tax_rate: 6 }, { resident_tax: 100.5, income_tax_rate: 5 }, { resident_tax: 1 }, { resident_tax: '', income_tax_rate: 0 }]) assert.throws(() => estimateFurusatoLimit(input, 2026));
	});
});
describe('investment contributions and valuations', () => {
	const transfer = (id, date, amount, from = 'bank', to = 'stock') => tx(id, { type: 'transfer', date, amount, account_id: from, to_account_id: to });
	it('derives contributions from cashflows without inventing gains as capital', () => {
		const rows = [transfer('in', '2026-01-02', 100), transfer('out', '2026-01-03', 20, 'stock', 'bank'), tx('dividend', { type: 'income', account_id: 'stock', date: '2026-01-03', amount: 5 }), transfer('plan', '2026-01-03', 30)]; rows.at(-1).status = 'planned';
		assert.deepEqual(investmentAtDate(stock, rows, '2026-01-03', {}), { invested: 80, valuation: null });
	});
	it('uses end-of-day observations, then applies only later confirmed cashflows', () => {
		const account = { ...stock, investment_history: { '2026-01-02': { invested_amount: 100, market_value: 150 } } };
		const rows = [transfer('same', '2026-01-02', 100), transfer('later', '2026-01-03', 30), tx('gain', { type: 'income', account_id: 'stock', date: '2026-01-03', amount: 5 }), transfer('gone', '2026-01-03', 90)]; rows.at(-1).is_deleted = true;
		assert.deepEqual(investmentAtDate(account, rows, '2026-01-03', {}), { invested: 130, valuation: 185 });
		assert.equal(investmentAtDate(account, rows, '2026-01-01', {}).valuation, null);
	});
	it('leaves unknown opening capital and unavailable archives uncalculated', () => {
		assert.equal(investmentAtDate({ ...stock, initial_balance: 300 }, [], '2026-01-03', {}).invested, null);
		assert.equal(investmentAtDate(stock, [], '2026-02-03', { last_closed_month: '2026-01' }).invested, null);
		assert.equal(investmentAtDate(stock, [], '2026-02-03', { last_closed_month: '2026-01' }, { historyComplete: true }).invested, 0);
	});
	it('corrects existing balances without double counting and keeps investment transfers neutral', () => {
		const a = { ...stock, investment_history: { '2026-01-02': { invested_amount: 100, market_value: 150 } } };
		const other = { id: 'other', type: 'investment', is_asset: true, initial_balance: 0, investment_history: { '2026-01-02': { invested_amount: 20, market_value: 25 } } };
		const rows = [transfer('internal', '2026-01-03', 10, 'stock', 'other')];
		const balances = applyInvestmentValuations({ stock: 90, other: 30, bank: 1000 }, [a, other], rows, '2026-01-03', {});
		assert.deepEqual(balances, { stock: 140, other: 35, bank: 1000 });
		assert.equal(investmentAtDate(a, rows, '2026-01-03', {}).invested + investmentAtDate(other, rows, '2026-01-03', {}).invested, 120);
	});
});

describe('investment observation boundaries', () => {
	const account = { ...stock, investment_history: { '2026-10-20': { invested_amount: 100, market_value: 150 }, '2026-11-01': { invested_amount: 500, market_value: 800 } } };
	it('includes observation day, excludes future/deleted/planned flows and uses date rather than accounting month', () => {
		const rows = [tx('same', { type: 'transfer', account_id: 'bank', to_account_id: 'stock', date: '2026-10-20', target_month: '2026-11', amount: 100 }), tx('next', { type: 'transfer', account_id: 'bank', to_account_id: 'stock', date: '2026-10-21', target_month: '2026-10', amount: 30 }), tx('future', { type: 'transfer', account_id: 'bank', to_account_id: 'stock', date: '2026-10-22', amount: 50 })];
		assert.deepEqual(investmentAtDate(account, rows, '2026-10-20', {}), { invested: 100, valuation: 150 });
		assert.deepEqual(investmentAtDate(account, rows, '2026-10-21', {}), { invested: 130, valuation: 180 });
	});
	it('does not reuse an observation across unknown closed archives', () => {
		assert.deepEqual(investmentAtDate(account, [], '2026-12-01', { last_closed_month: '2026-11' }), { invested: null, valuation: null });
	});
});
it('counts tombstones without dates as deleted only and excludes device master fields from bytes', () => {
	const state = { master_config: { ...config, theme: 'secretTheme', collapsed_panes: { private: true } }, transactions: [{ id: 'gone', is_deleted: true }], summary_snapshot: {} };
	const clean = { ...state, master_config: config };
	assert.equal(buildDataMetadata(state).bytes, new TextEncoder().encode(JSON.stringify(clean)).length);
	assert.equal(buildDataMetadata(state).count, 0); assert.equal(buildDataMetadata(state).deleted, 1); assert.equal(buildDataMetadata(state).months, 0);
});
it('supports both tax-rule endpoints and zero-percent taxable residents', () => {
	for (const year of [2015, 2037]) assert.equal(estimateFurusatoLimit({ resident_tax: 200000, income_tax_rate: 0 }, year), 46444);
});
it('recalculates an observation after required archive detail is acquired and keeps ledger balances while unknown', () => {
	const a = { ...stock, investment_history: { '2026-01-31': { invested_amount: 100, market_value: 150 } } };
	const snapshot = { last_closed_month: '2026-02' };
	const rows = [tx('flow', { type: 'transfer', account_id: 'bank', to_account_id: 'stock', date: '2026-02-01', target_month: '2026-02', amount: 30 })];
	assert.deepEqual(applyInvestmentValuations({ stock: 777 }, [a], rows, '2026-03-01', snapshot), { stock: 777 });
	assert.deepEqual(investmentAtDate(a, rows, '2026-03-01', snapshot, { historyComplete: true }), { invested: 130, valuation: 180 });
});
it('uses a closed-day observation exactly and requires complete history for later days regardless of accounting month', () => {
	const a = { ...stock, investment_history: { '2026-10-20': { invested_amount: 100, market_value: 150 } } };
	const snapshot = { last_closed_month: '2026-10' };
	assert.deepEqual(investmentAtDate(a, [], '2026-10-20', snapshot), { invested: 100, valuation: 150 });
	const priorSnapshot = { last_closed_month: '2026-09' };
	assert.deepEqual(investmentAtDate(a, [], '2026-10-21', priorSnapshot), { invested: null, valuation: null });
	const rows = [tx('oldArchive', { type: 'transfer', account_id: 'bank', to_account_id: 'stock', date: '2026-10-21', target_month: '2026-09', amount: 30 })];
	assert.deepEqual(investmentAtDate(a, rows, '2026-10-21', priorSnapshot, { historyComplete: true }), { invested: 130, valuation: 180 });
});
