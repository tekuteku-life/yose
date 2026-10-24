import { it } from 'node:test';
import assert from 'node:assert/strict';
import { buildFurusatoLedgerSummary } from '../../js/logic/data_insights.js';
import { transaction } from '../helpers/ui_fixture.js';
const sources = { salary: [{ category_id: 'salary', subcategory_id: null }, { category_id: 'salary', subcategory_id: 'bonus' }], income_tax: [{ category_id: 'tax', subcategory_id: 'income' }], resident_tax: [{ category_id: 'tax', subcategory_id: 'resident' }], social_insurance: [{ category_id: 'insurance', subcategory_id: null }] };
it('collects explicitly classified gross salary, bonus and deductions once by transaction year', () => {
	const rows = [
		transaction('wage', { type: 'income', category_id: 'salary', date: '2025-12-31', target_month: '2026-01', amount: 5000000 }),
		transaction('bonus', { type: 'income', category_id: 'salary', subcategory_id: 'bonus', date: '2025-06-01', amount: 1000000 }),
		transaction('resident', { category_id: 'tax', subcategory_id: 'resident', date: '2025-01-01', amount: 200000 }),
		transaction('income', { category_id: 'tax', subcategory_id: 'income', date: '2025-01-01', amount: 100000 }),
		transaction('insurance', { category_id: 'insurance', date: '2025-01-01', amount: 700000 }),
		transaction('current', { type: 'income', category_id: 'salary', amount: 5500000 }),
		transaction('actual-only', { actual_category_id: 'insurance', date: '2025-01-01', amount: 99999 })
	];
	const result = buildFurusatoLedgerSummary(rows, {}, '2026', sources);
	assert.deepEqual(result.salary.previous, { amount: 6000000, count: 2 });
	assert.deepEqual(result.salary.current, { amount: 5500000, count: 1 });
	assert.equal(result.income_tax.previous.amount, 100000); assert.equal(result.resident_tax.previous.amount, 200000); assert.equal(result.social_insurance.previous.amount, 700000);
});
it('excludes pending, planned, deleted, transfers, wrong type and unrelated income without assuming annual zero', () => {
	const rows = [{ is_deleted: true }, ...[{ status: 'planned' }, { amount_pending: true }, { is_deleted: true }, { type: 'transfer' }, { type: 'expense' }, { category_id: 'other' }].map((overrides, i) => transaction(String(i), { type: 'income', category_id: 'salary', date: '2025-01-01', ...overrides }))];
	const config = { annual_budgets: { 2026: { furusato_sources: sources, furusato_estimate: { resident_tax: 300000, income_tax_rate: 20 } } } };
	const result = buildFurusatoLedgerSummary(rows, config, 2026);
	assert.equal(result.salary.configured, true); assert.deepEqual(result.salary.previous, { amount: 0, count: 0 });
	assert.equal(buildFurusatoLedgerSummary(rows, {}, 2026).salary.configured, false);
	assert.equal(config.annual_budgets[2026].furusato_estimate.resident_tax, 300000);
});
