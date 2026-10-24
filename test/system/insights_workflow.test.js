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
	await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { invested_amount: 1000000, market_value: 1200000 }, null);
	const r = buildFurusatoSummary(await db.getTransactions(), await db.getMasterConfig(), 2026);
	assert.equal(r.confirmed, 35000); assert.equal(r.records.length, 2); assert.equal(r.remaining, r.limit - 35000);
	assert.equal((await db.getDataMetadata()).count, 2);
	assert.equal((await db.getTransactions()).length, 2);
});
