import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { IMPORT_CONFIRMATION_WORD } from '../../js/db/backup_replacement.js';
import { generateRecurringTransactions } from '../../js/logic/transaction_factory.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

async function fixture() {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.saveMasterConfig(await db.getMasterConfig()); await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: null }); return db;
}
const raw = async db => ({ business: await db.captureImportState(), settings: await db.getAllRaw('settings'), keys: await db.getAllRaw('security_keys') });
const calculation = () => ({ mode: 'income', base_year: 2026, tax_status: 'unknown', life_enabled: false, young_dependent: false, manual: {}, input_modes: {}, housing: { enabled: false } });

describe('review67 additive and complete legacy imports', () => {
	for (const kind of ['master_config', 'annual_budgets', 'summary_snapshot', 'transactions', 'full_backup']) it(`detects a legacy ${kind} without export_type and replaces only the selected collections`, async () => {
		const db = await fixture(); await db.putTransaction(transaction('old')); await db.setSetting('device-only', { preserve: 1 }); await db.saveSecurityKey('unrelated', { preserve: 2 });
		const data = await db.exportFullData(); data.master_config.collapsed_panes = { old: true }; data.master_config.categories[0].subcategories = undefined;
		const values = { master_config: data.master_config, annual_budgets: { '2026': { expense_budget: 0, category_budgets: {} } }, summary_snapshot: data.summary_snapshot, transactions: [transaction('replacement', { amount: 0 })] };
		const input = kind === 'full_backup' ? { schema_version: 2, master_config: values.master_config, transactions: values.transactions, summary_snapshot: values.summary_snapshot } : { schema_version: 2, [kind]: values[kind] };
		const before = await raw(db), plan = await db.prepareReplacementImport(input); assert.equal(plan.detectedType, kind);
		await db.commitReplacementImport(plan, { confirmation: IMPORT_CONFIRMATION_WORD });
		assert.deepEqual(await db.getSetting('device-only'), { preserve: 1 }); assert.deepEqual(await db.getSecurityKey('unrelated'), { preserve: 2 });
		const pending = await db.getPendingImport(); assert.equal(pending.detectedType, kind); assert.equal(pending.data.export_type, kind);
		if (['transactions', 'full_backup'].includes(kind)) { const rows = await db.getTransactions(); assert.deepEqual(rows.map(row => [row.id, row.amount]), [['replacement', 0]]); }
		else assert.deepEqual((await raw(db)).business.transactions, before.business.transactions);
		if (['master_config', 'full_backup'].includes(kind)) assert.deepEqual((await db.getMasterConfig()).collapsed_panes, { old: true });
	});
	for (const [name, make, error] of [
		['unknown kind', () => ({ schema_version: 2 }), /unknown export type/],
		['invalid schema', () => ({ schema_version: 3, transactions: [] }), /schema version/],
		['null input', () => null, /schema version/],
		['extra kind', () => ({ export_type: 'transactions', transactions: [], annual_budgets: {} }), /種別外/],
		['impossible date', () => [transaction('invalid', { date: '2026-02-30' })], /日付・計上月/],
		['missing date', () => [transaction('invalid', { date: undefined })], /日付・計上月/],
		['missing month', () => [transaction('invalid', { target_month: undefined })], /日付・計上月/],
		['missing transfer destination', () => [transaction('invalid', { type: 'transfer', to_account_id: null })], /振替先/],
		['same transfer destination', () => [transaction('invalid', { type: 'transfer', to_account_id: 'acc_wallet' })], /振替先/]
	]) it(`refuses ${name} before replacement with every raw store intact`, async () => {
		const db = await fixture(), before = await raw(db); await assert.rejects(db.prepareReplacementImport(make()), error); assert.deepEqual(await raw(db), before);
	});
	it('adopts only missing tax settings while preserving local annual amounts and existing calculations', async () => {
		const db = await fixture(), first = calculation();
		await db.mutateMasterConfig(config => { config.annual_budgets = { '2026': { expense_budget: 500, category_budgets: { cat_food: 500 } } }; });
		await db.importFullData({ export_type: 'annual_budgets', annual_budgets: { '2026': { expense_budget: 999, category_budgets: { cat_food: 999 }, furusato_calculation: first, furusato_sources: { salary: [{ category_id: 'cat_income_main', subcategory_id: null }] }, furusato_estimate: { resident_tax: 0, income_tax_rate: 0 } } } });
		let budget = (await db.getMasterConfig()).annual_budgets['2026']; assert.equal(budget.expense_budget, 500); assert.equal(budget.category_budgets.cat_food, 500); assert.deepEqual(budget.furusato_calculation, first); assert.deepEqual(budget.furusato_estimate, { resident_tax: 0, income_tax_rate: 0 }); assert.equal(budget.furusato_sources.salary[0].category_id, 'cat_income_main');
		const next = calculation(); next.mode = 'notice'; await db.importFullData({ export_type: 'annual_budgets', annual_budgets: { '2026': { expense_budget: 0, furusato_calculation: next } } }); budget = (await db.getMasterConfig()).annual_budgets['2026']; assert.deepEqual(budget.furusato_calculation, first); assert.equal(budget.expense_budget, 500);
	});
	it('preserves imported external asset identities and zero annual/category amounts', async () => {
		const db = await fixture(); await db.importFullData({ export_type: 'summary_snapshot', summary_snapshot: { external_assets: [{ id: 'home', name: '住居', market_value: 0 }] } });
		assert.equal((await db.getSnapshot()).external_assets, undefined, 'additive imports merge monthly history, not external asset positions');
		await db.importFullData({ export_type: 'annual_budgets', annual_budgets: { '2027': { expense_budget: 0, savings_target_amount: 0, category_budgets: { cat_food: 0 } } } });
		assert.equal((await db.getMasterConfig()).annual_budgets['2027'].category_budgets.cat_food, 0);
		await db.commitReplacementImport(await db.prepareReplacementImport({ export_type: 'summary_snapshot', summary_snapshot: { external_assets: [{ id: 'home', name: '住居', market_value: 0 }] } }), { confirmation: IMPORT_CONFIRMATION_WORD });
		assert.deepEqual((await db.getSnapshot()).external_assets, [{ id: 'home', name: '住居', market_value: 0 }]);
	});
	it('repairs persisted legacy nonarray master collections through a validated additive import', async () => {
		const db = await fixture(), current = await db.getMasterConfig(), legacy = { ...current, accounts: {}, categories: {}, recurring_rules: {}, holidays: {} };
		await db.putRaw('master_config', await db.encryptRecord(legacy), 'current');
		await db.importFullData({ export_type: 'master_config', master_config: current }); const repaired = await db.getMasterConfig();
		assert.deepEqual(repaired.accounts, current.accounts); assert.deepEqual(repaired.categories, current.categories); assert.deepEqual(repaired.recurring_rules, current.recurring_rules); assert.deepEqual(repaired.holidays, current.holidays);
	});
	it('imports categories without optional children and legacy nested numeric monthly summaries', async () => {
		const db = await fixture(); await db.importFullData({ export_type: 'master_config', master_config: { categories: [{ id: 'custom-no-child', type: 'expense', name: '子なし' }, { id: 'cat_food', type: 'expense', name: '既存' }] } });
		assert.equal((await db.getMasterConfig()).categories.find(category => category.id === 'custom-no-child').subcategories, undefined); assert.equal((await db.getMasterConfig()).categories.find(category => category.id === 'cat_food').name, '食費');
		await db.importFullData({ export_type: 'summary_snapshot', summary_snapshot: { monthly_summaries: { '2026-09': { expense_total: 0, by_category: { cat_food: { total: 0, by_subcategory: { sub_unclassified: 0 } } } } } } });
		assert.equal((await db.getSnapshot()).monthly_summaries['2026-09'].by_category.cat_food.by_subcategory.sub_unclassified, 0);
	});
});

describe('review67 repository validation and old record metadata', () => {
	it('queries legacy encrypted records lacking outer month/status/deleted metadata using authenticated content', async () => {
		const db = await fixture();
		for (const row of [transaction('match'), transaction('deleted', { is_deleted: true }), transaction('month', { target_month: '2026-09' }), transaction('synced', { sync_status: 'synced' })]) await db.putRaw('transactions', await db.encryptRecord(row, { id: row.id }));
		const rows = await db.getTransactions({ target_month: '2026-10', sync_status: 'unsynced' }); assert.deepEqual(rows.map(row => [row.id, row.amount]), [['match', 100]]);
		assert.equal((await db.getTransactions({ includeDeleted: true })).length, 4); assert.equal((await db.getTransactions({ target_month: '2026-09' }))[0].id, 'month');
	});
	for (const value of [null, {}, { id: '' }, { id: 1 }]) it(`rejects an invalid confirmation identity ${JSON.stringify(value)}`, async () => {
		const db = await fixture(), before = await raw(db); await assert.rejects(db.confirmPlannedTransaction(value), /確定対象の明細ID/); assert.deepEqual(await raw(db), before);
	});
	for (const month of [null, 202610, '2026-13', '2026-00', '2026-1']) it(`rejects invalid recurring month ${month}`, async () => {
		const db = await fixture(), before = await raw(db); await assert.rejects(db.generateRecurringForMonth(month), /計上月/); assert.deepEqual(await raw(db), before);
	});
	it('generates no records for a legacy config with no optional rules or holidays', async () => {
		const db = await fixture(); await db.mutateMasterConfig(config => { delete config.recurring_rules; delete config.holidays; });
		assert.deepEqual(await db.generateRecurringForMonth('2026-11'), { generated: [], skipped_count: 0 });
	});
	it('rejects a stable recurring ID occupied by a different live financial record', async () => {
		const db = await fixture(), rule = { id: 'schedule', type: 'expense', account_id: 'acc_wallet', category_id: 'cat_food', amount: 20, is_active: true };
		await db.mutateMasterConfig(config => { config.recurring_rules = [rule]; }); const generated = generateRecurringTransactions([rule], '2026-11', [], [], '2026-11-01')[0];
		await db.putTransaction(transaction(generated.id, { amount: 999 })); const before = await raw(db);
		await assert.rejects(db.generateRecurringForMonth('2026-11', await db.getMasterConfig()), /生成ID/); assert.deepEqual(await raw(db), before);
	});
	it('allows an approved tombstone for a closed-month record whose amount is still unknown', async () => {
		const db = await fixture(); await db.putTransaction(transaction('pending', { status: 'planned', amount_pending: true, amount: 0 })); await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: '2026-10' });
		const original = await db.getTransaction('pending'); await db.bulkDeleteTransactions([original], ['2026-10']); const deleted = await db.getTransaction('pending'); assert.equal(deleted.is_deleted, true); assert.equal(deleted.amount, 0); assert.equal(deleted.amount_pending, true); assert.deepEqual(deleted.reclose_approved_months, ['2026-10']);
	});
	it('rejects locked and modified pending-import writes, and invalid acknowledgement timestamps', async () => {
		const db = await fixture(), plan = await db.prepareReplacementImport([transaction('imported')]); await db.commitReplacementImport(plan, { confirmation: IMPORT_CONFIRMATION_WORD }); const pending = await db.getPendingImport(), before = await raw(db);
		await assert.rejects(db.updatePendingImport(pending, { ...pending, id: 'changed' }), /送信待ちデータの変更/); await assert.rejects(db.updatePendingImport(pending, { ...pending, data: {} }), /送信待ちデータの変更/); await assert.rejects(db.acknowledgePendingImport(pending, undefined, { importedAt: 'not-a-date' }), /確定日時/); assert.deepEqual(await raw(db), before);
		db.clearEncryptionKey(); await assert.rejects(db.updatePendingImport(pending, pending), /ロック/); await assert.rejects(db.acknowledgePendingImport(pending), /ロック/); await assert.rejects(db.prepareReplacementImport([]), /ロック/); assert.deepEqual(await raw(db), before);
	});
	for (const archive_months of [{}, ['2026-13'], [1]]) it(`rejects malformed remote archive metadata ${JSON.stringify(archive_months)} without any commit`, async () => {
		const db = await fixture(), local = await db.getMasterConfig(), before = await raw(db); await assert.rejects(db.commitMasterSync(local, local, { remoteState: { archive_months } }), /受信アーカイブ月/); assert.deepEqual(await raw(db), before);
	});
	for (const returned of [null, 1, [], Promise.resolve({})]) it(`rejects an invalid public master mutator result ${String(returned)}`, async () => {
		const db = await fixture(), before = await raw(db); await assert.rejects(db.mutateMasterConfig(() => returned), returned?.then ? /同期関数/ : /設定オブジェクト/); assert.deepEqual(await raw(db), before);
	});
	it('rejects conflicting remote/local master edits against an earlier submitted version', async () => {
		const db = await fixture(), submitted = await db.getMasterConfig(), accepted = structuredClone(submitted); accepted.accounts[0].name = 'remote edit'; await db.mutateMasterConfig(config => { config.accounts[0].name = 'latest local edit'; }); const before = await raw(db);
		await assert.rejects(db.commitMasterSync(submitted, accepted), /設定が変更/); assert.deepEqual(await raw(db), before);
	});
	it('rejects duplicate IDs split between pending and archive sources', async () => {
		const db = await fixture(), master = await db.getMasterConfig(), before = await raw(db); await assert.rejects(db.commitMasterSync(master, master, { remoteState: { pending_diffs: [transaction('duplicate')], archived_transactions: [transaction('duplicate')] } }), /受信明細ID.*重複/); assert.deepEqual(await raw(db), before);
	});
	it('validates remote state without a supplied local base and keeps null acknowledgements harmless', async () => {
		const db = await fixture(), master = await db.getMasterConfig(), before = await raw(db); await db.validateRemoteState(master, {});
		const result = await db.commitSyncResponse(null, {}); assert.equal(result.synced_count, 0); assert.equal(result.downloaded_count, 0); assert.deepEqual((await raw(db)).business.transactions, before.business.transactions); assert.equal(await db.markTransactionsSynced([]), 0); assert.equal(await db.markTransactionsSynced(null), 0);
	});
	it('acknowledges a single submitted record and records explicit reclose approval', async () => {
		const db = await fixture(); await db.putTransaction(transaction('single')); const original = await db.getTransaction('single'); assert.equal(await db.approveTransactionReclose(original, []), true);
		const current = await db.getTransaction('single'); assert.deepEqual(current.reclose_approved_months, []); const result = await db.commitSyncResponse(current, { accepted_ids: ['single'] }); assert.equal(result.synced_count, 1); assert.equal((await db.getTransaction('single')).sync_status, 'synced');
	});
	it('keeps absent annual budgets exportable and rejects empty annual keys', async () => {
		const db = await fixture(); await db.mutateMasterConfig(config => { delete config.annual_budgets; }); assert.deepEqual((await db.exportAnnualBudgetsData()).annual_budgets, {}); assert.equal((await db.getAnnualBudget('2028')).expense_budget, 0);
		const before = await raw(db); assert.equal((await db.getAnnualBudget()).expense_budget, 0); await assert.rejects(db.saveAnnualBudget(), /budget year/); assert.deepEqual(await raw(db), before);
	});
	for (const [date, value, error] of [['2026-02-30', { acquisition_cost: 1, market_value: 1 }, /評価記録の日付/], ['2026-10-01', { market_value: 1 }, /取得原価/]]) it(`rejects invalid valuation input ${date}/${JSON.stringify(value)} before writing`, async () => {
		const db = await fixture(), before = await raw(db); await assert.rejects(db.saveInvestmentObservation('missing', date, value, null), error); assert.deepEqual(await raw(db), before);
	});
	it('keeps only nonempty trimmed tags and dated memo order from legacy transactions', async () => {
		const db = await fixture(); await db.putRaw('transactions', transaction('first', { date: undefined, tags: ['', '   ', ' saved '], memo: 'legacy memo' })); await db.putRaw('transactions', transaction('second', { date: undefined, tags: ['saved'], memo: 'second memo' }));
		assert.deepEqual(await db.getUniqueTags(), ['saved']); assert.deepEqual(Object.keys(await db.getMemoHistory()).sort(), ['legacy memo', 'second memo']); assert.equal((await db.getMemoHistory())['legacy memo'].category_id, 'cat_food');
	});
	it('rejects an analytics capture and pending encryption after a real same-key epoch change', async () => {
		const db = await fixture(), capture = db.captureImportState.bind(db); let changed = false;
		db.captureImportState = async () => { const result = await capture(); if (!changed) { changed = true; db.setEncryptionKey(db.encryptionKey); } return result; }; const before = await raw(db); changed = false;
		await assert.rejects(db.getAnalyticsState(), /認証状態/); assert.deepEqual(await raw(db), before); db.captureImportState = capture;
		await db.commitReplacementImport(await db.prepareReplacementImport([]), { confirmation: IMPORT_CONFIRMATION_WORD }); const pending = await db.getPendingImport(), pendingBefore = await raw(db), encrypt = db.encryptRecord.bind(db);
		db.encryptRecord = async (...args) => { const encrypted = await encrypt(...args); db.setEncryptionKey(db.encryptionKey); return encrypted; };
		await assert.rejects(db.updatePendingImport(pending, { ...pending, base_version: 'bound-version' }), /認証鍵/); assert.deepEqual(await raw(db), pendingBefore);
	});
	it('rejects duplicate public transaction saves without dropping or replacing either original', async () => {
		const db = await fixture(); await db.putTransaction(transaction('keep')); const before = await raw(db); await assert.rejects(db.putTransactions([transaction('duplicate'), transaction('duplicate', { amount: 0 })]), /明細ID.*重複/); assert.deepEqual(await raw(db), before);
	});
	it('preserves a new transaction edit arriving between hard-delete lookup and its mutation', async () => {
		const db = await fixture(); await db.putTransaction(transaction('keep')); const capture = db.captureImportState.bind(db); let changed = false, arrived;
		db.captureImportState = async () => { if (!changed) { changed = true; await db.putTransaction({ ...await db.getTransaction('keep'), memo: 'later arrival', amount: 888 }); arrived = await raw(db); } return capture(); };
		await assert.rejects(db.deleteTransaction('keep', false), /明細が変更/); assert.deepEqual(await raw(db), arrived); assert.equal((await db.getTransaction('keep')).amount, 888);
	});
	it('rejects unlinked repayments and creation against an already settled advance', async () => {
		const db = await fixture(), source = transaction('advance', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null, settlement_status: 'settled' }); await db.putTransaction(source); await db.putTransaction(transaction('unlinked')); const before = await raw(db);
		await assert.rejects(db.unlinkAdvanceRepayment(await db.getTransaction('unlinked')), /ひも付け明細が変更/); await assert.rejects(db.linkAdvanceRepayment(await db.getTransaction('advance'), transaction('new-repayment'), { create: true }), /精算済み/); assert.deepEqual(await raw(db), before);
	});
	it('rejects a malformed persisted legacy prepayment role before changing the group', async () => {
		const db = await fixture(); await db.putRaw('transactions', transaction('legacy-prepayment', { group_id: 'legacy-group', type: 'expense', amortization_meta: { is_payment_record: true } })); const before = await raw(db);
		await assert.rejects(db.updateInstallmentGroup('legacy-group', { memo: 'must not apply' }), /前払グループの補助情報.*amortization_meta/); assert.deepEqual(await raw(db), before);
	});
	it('rejects an invalid master session before any read or write and requires explicit replacement confirmation', async () => {
		const db = await fixture(), master = await db.getMasterConfig(), before = await raw(db); await assert.rejects(db.commitMasterSync(master, master, { isSessionValid: () => false }), /認証/); assert.deepEqual(await raw(db), before);
		const plan = await db.prepareReplacementImport([]); await assert.rejects(db.commitReplacementImport(plan), /確認の文字/); assert.deepEqual(await raw(db), before);
	});
	it('rejects a complete-import preview whose actual authentication epoch changed during capture', async () => {
		const db = await fixture(), capture = db.captureImportState.bind(db), before = await raw(db); let changed = false;
		db.captureImportState = async () => { const state = await capture(); if (!changed) { changed = true; db.setEncryptionKey(db.encryptionKey); } return state; };
		await assert.rejects(db.prepareReplacementImport([]), /確認中に認証鍵または世代/); assert.deepEqual(await raw(db), before);
	});
	it('does not bulk-edit a planned row into an already closed month even after approval', async () => {
		const db = await fixture(); await db.putTransaction(transaction('planned', { status: 'planned' })); await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: '2026-10' }); const before = await raw(db);
		await assert.rejects(db.bulkEditTransactions([await db.getTransaction('planned')], { memo: 'blocked' }, ['2026-10']), /締め済み月.*確定明細/); assert.deepEqual(await raw(db), before);
	});
	it('keeps optional legacy tags absent rather than inventing a unique tag', async () => {
		const db = await fixture(); await db.putTransaction(transaction('untagged67', { tags: undefined })); const before = await raw(db); assert.deepEqual(await db.getUniqueTags(), []); assert.deepEqual(await raw(db), before); assert.equal((await db.getTransaction('untagged67')).amount, 100);
	});
	it('uses an omitted holiday list for all card billing cycles and never generates a zero settlement', async () => {
		const db = await fixture(); await db.mutateMasterConfig(config => { delete config.holidays; }); await db.putTransaction(transaction('zero-card67', { account_id: 'acc_card_a', date: '2026-09-01', target_month: '2026-09', amount: 0 })); const before = await raw(db);
		assert.deepEqual(await db.processCreditCardAutoSettlements('2026-10-29'), []); assert.deepEqual(await raw(db), before); assert.deepEqual((await db.getTransactions()).map(row => [row.id, row.amount]), [['zero-card67', 0]]);
	});
});
