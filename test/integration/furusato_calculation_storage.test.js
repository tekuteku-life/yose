import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { calculateFurusatoFromLedger, getFurusatoLedgerFingerprint } from '../../js/logic/furusato_calculator.js';
import { transaction } from '../helpers/ui_fixture.js';
const manual = { salary: 6000000, social_insurance: 800000, other_income: 0, other_deductions: 0, personal_gap: 0, other_gap: 0 };
it('persists an encrypted calculator, preserves it through ordinary budgets and imports, and rejects malformed unadopted settings', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.mutateMasterConfig(c => { c.annual_budgets[2026] = { furusato_calculation: { mode: 'income', base_year: 2025, tax_status: 'taxable', input_modes: {}, manual, life_enabled: false, young_dependent: false, housing: { enabled: false } } }; });
	const saved = structuredClone((await db.getMasterConfig()).annual_budgets[2026].furusato_calculation);
	await db.saveAnnualBudget('2026', { ...(await db.getAnnualBudget('2026')), expense_budget: 500000 });
	assert.deepEqual((await db.getMasterConfig()).annual_budgets[2026].furusato_calculation, saved);
	await db.importFullData({ annual_budgets: { 2026: { furusato_calculation: { ...saved, manual: { ...manual, salary: 7000000 } } }, 2027: { furusato_calculation: saved } } });
	assert.deepEqual((await db.getMasterConfig()).annual_budgets[2026].furusato_calculation, saved);
	assert.deepEqual((await db.getMasterConfig()).annual_budgets[2027].furusato_calculation, saved);
	const backup = await db.exportFullData(); const before = await db.captureImportState();
	for (const invalid of [{ mode: 'invented' }, { base_year: '2025' }, { manual: { salary: -1 } }, { input_modes: { salary: 'auto' } }, { manual: { invented: 0 } }, { ledger_confirmation: 'not-a-hash' }, { housing: { enabled: true, applicable: true, rate: 99 } }]) {
		const bad = structuredClone(backup); Object.assign(bad.master_config.annual_budgets[2026].furusato_calculation, invalid);
		await assert.rejects(db.importFullData(bad)); assert.deepEqual(await db.captureImportState(), before);
		await assert.rejects(db.importFullData({ annual_budgets: { 2026: bad.master_config.annual_budgets[2026] } })); assert.deepEqual(await db.captureImportState(), before);
	}
	const copy = new YoseDB(); await copy.init(); await copy.importFullData(backup);
	assert.deepEqual((await copy.getMasterConfig()).annual_budgets[2026].furusato_calculation, backup.master_config.annual_budgets[2026].furusato_calculation);
	assert.equal((await db.getRaw('master_config', 'current')).encrypted, true);
});
it('invalidates confirmed annual ledger inputs after transaction-only replacement while keeping a consistent state', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.putTransactions(Array.from({ length: 12 }, (_, i) => transaction(`salary${i}`, { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', date: `2025-${String(i + 1).padStart(2, '0')}-25`, amount: 500000 })));
	await db.mutateMasterConfig(c => { c.annual_budgets[2026] = { furusato_sources: { salary: [{ category_id: 'cat_income_main', subcategory_id: null }] }, furusato_calculation: { mode: 'income', base_year: 2025, tax_status: 'taxable', input_modes: { salary: 'ledger' }, manual, life_enabled: false, young_dependent: false, housing: { enabled: false } } }; });
	let state = await db.getAnalyticsState(); const token = await getFurusatoLedgerFingerprint(state.transactions, state.master_config, 2026);
	await db.mutateMasterConfig(c => { c.annual_budgets[2026].furusato_calculation.ledger_confirmation = token; });
	state = await db.getAnalyticsState(); assert.ok(calculateFurusatoFromLedger(state.transactions, state.master_config, 2026, { ledgerFingerprint: token }).limit > 0);
	const data = { schema_version: 2, export_type: 'transactions', transactions: [state.transactions[0]] };
	await db.commitReplacementImport(await db.prepareReplacementImport(data), { confirmation: '完全インポート' });
	state = await db.getAnalyticsState(); const changed = await getFurusatoLedgerFingerprint(state.transactions, state.master_config, 2026);
	assert.notEqual(changed, token); assert.equal(calculateFurusatoFromLedger(state.transactions, state.master_config, 2026, { ledgerFingerprint: changed }).limit, null);
});
it('binds annual confirmation to financial fields and selectors but not ordering or memo-only changes', async () => {
	const rows = [transaction('wage', { type: 'income', category_id: 'salary', date: '2025-01-25', amount: 6000000 }), transaction('gift', { amount: 10000 })];
	const config = { annual_budgets: { 2026: { furusato_sources: { salary: [{ category_id: 'salary', subcategory_id: null }] }, furusato_calculation: { mode: 'income', base_year: 2025, tax_status: 'taxable', input_modes: { salary: 'ledger' }, manual, life_enabled: false, young_dependent: false, housing: { enabled: false } } } } };
	const token = await getFurusatoLedgerFingerprint(rows, config, 2026);
	assert.equal(await getFurusatoLedgerFingerprint([...rows].reverse().map(row => ({ ...row, memo: 'updated' })), config, 2026), token);
	for (const patch of [{ amount: 5000000 }, { status: 'planned' }, { amount_pending: true }, { is_deleted: true }, { date: '2026-01-25' }, { category_id: 'other' }]) {
		const changed = structuredClone(rows); Object.assign(changed[0], patch); assert.notEqual(await getFurusatoLedgerFingerprint(changed, config, 2026), token);
	}
	const changed = structuredClone(config); changed.annual_budgets[2026].furusato_calculation.base_year = 2024;
	assert.notEqual(await getFurusatoLedgerFingerprint(rows, changed, 2026), token);
});
it('accepts a minimal deletion tombstone without breaking fingerprints or notice calculations', async () => {
	const db = new YoseDB(); await db.init(); await db.putTransaction({ id: 'deleted', is_deleted: true, updated_at: '2026-10-20T00:00:00Z' });
	const state = await db.getAnalyticsState();
	assert.equal(await getFurusatoLedgerFingerprint(state.transactions, state.master_config, 2026), await getFurusatoLedgerFingerprint([], state.master_config, 2026));
	state.master_config.annual_budgets[2026] = { furusato_estimate: { resident_tax: 200000, income_tax_rate: 20 } };
	assert.equal(calculateFurusatoFromLedger(state.transactions, state.master_config, 2026).limit, 59487);
});
