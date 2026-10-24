import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { buildFurusatoSummary } from '../../js/logic/data_insights.js';
import { transaction } from '../helpers/ui_fixture.js';
it('classifies existing donations in a batch, estimates allowance, and keeps investment observations separate from cashflows', async () => {
	const db = new YoseDB(); await db.init();
	await db.putTransactions([transaction('gift1', { amount: 20000 }), transaction('gift2', { amount: 15000 })]);
	await db.bulkEditTransactions(await db.getTransactions(), { tags: ['ふるさと納税'] }, []);
	await db.mutateMasterConfig(config => { config.annual_budgets[2026] = { furusato_estimate: { resident_tax: 200000, income_tax_rate: 20 } }; });
	await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { acquisition_cost: 1000000, market_value: 1200000 }, null);
	const r = buildFurusatoSummary(await db.getTransactions(), await db.getMasterConfig(), 2026);
	assert.equal(r.confirmed, 35000); assert.equal(r.records.length, 2); assert.equal(r.remaining, r.limit - 35000);
	assert.equal((await db.getDataMetadata()).count, 2);
	assert.equal((await db.getTransactions()).length, 2);
});

it('uses ledger payroll totals as notice reference and keeps holding cost independent of cash deposits', async () => {
	const { buildFurusatoLedgerSummary } = await import('../../js/logic/data_insights.js');
	const { buildAssetHistory } = await import('../../js/logic/aggregator.js');
	const db = new YoseDB(); await db.init();
	await db.saveSnapshot({ account_balances: Object.fromEntries((await db.getMasterConfig()).accounts.map(a => [a.id, a.initial_balance])) });
	await db.putTransactions([transaction('salary', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', date: '2025-12-31', target_month: '2026-01', amount: 6000000 }), transaction('deposit', { type: 'transfer', account_id: 'acc_bank_main', to_account_id: 'acc_investment_main', category_id: null, actual_category_id: null, date: '2026-10-21', amount: 300000 })]);
	await db.mutateMasterConfig(config => { config.annual_budgets[2026] = { furusato_sources: { salary: [{ category_id: 'cat_income_main', subcategory_id: null }] }, furusato_estimate: { resident_tax: 200000, income_tax_rate: 20 } }; });
	await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { acquisition_cost: 1000000, market_value: 1200000 }, null);
	const state = await db.getAnalyticsState();
	assert.equal(buildFurusatoLedgerSummary(state.transactions, state.master_config, 2026).salary.previous.amount, 6000000);
	const point = buildAssetHistory(state.summary_snapshot, state.transactions, state.master_config.accounts, { mode: 'month', month: '2026-10', today: '2026-10-21', ...state.historyOptions }).points.at(-1);
	assert.equal(point.investment_acquisition_cost, 1000000); assert.equal(point.investment_valuation, 1500000);
	assert.equal(state.master_config.annual_budgets[2026].furusato_estimate.resident_tax, 200000);
});
