import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { calculateFurusatoFromLedger, getFurusatoLedgerFingerprint } from '../../js/logic/furusato_calculator.js';
import { buildFurusatoSummary } from '../../js/logic/data_insights.js';
import { transaction } from '../helpers/ui_fixture.js';
it('calculates from annual ledger wages and insurance with a configured arbitrary donation category', async () => {
	const db = new YoseDB(); await db.init();
	await db.putTransactions([transaction('salary', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', date: '2025-12-31', amount: 6000000 }), transaction('policy', { category_id: 'cat_housing', actual_category_id: 'cat_housing', date: '2025-12-31', amount: 120000 }), transaction('gift', { amount: 20000 })]);
	await db.mutateMasterConfig(c => { c.annual_budgets[2026] = { furusato_sources: { salary: [{ category_id: 'cat_income_main', subcategory_id: null }], life_general_new: [{ category_id: 'cat_housing', subcategory_id: null }], donation: [{ category_id: 'cat_food', subcategory_id: null }] }, furusato_calculation: { mode: 'income', base_year: 2025, tax_status: 'taxable', input_modes: { salary: 'ledger', life_general_new: 'ledger', donation: 'ledger' }, manual: { social_insurance: 800000, other_income: 0, other_deductions: 0, personal_gap: 0, other_gap: 0 }, life_enabled: true, young_dependent: true, housing: { enabled: false } } }; });
	let state = await db.getAnalyticsState(); const token = await getFurusatoLedgerFingerprint(state.transactions, state.master_config, 2026);
	await db.mutateMasterConfig(c => { c.annual_budgets[2026].furusato_calculation.ledger_confirmation = token; });
	state = await db.getAnalyticsState(); const result = calculateFurusatoFromLedger(state.transactions, state.master_config, 2026, { ledgerFingerprint: token });
	assert.deepEqual(result.life, { resident: 28000, income: 60000 }); assert.ok(result.limit > 0);
	const summary = buildFurusatoSummary(state.transactions, state.master_config, 2026, { calculation: result });
	assert.equal(summary.confirmed, 20000); assert.equal(summary.remaining, result.limit - 20000);
});
