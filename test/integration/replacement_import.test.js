import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { generateRecurringTransactions } from '../../js/logic/transaction_factory.js';

const record = (id, fields = {}) => ({ id, date: '2026-10-20', target_month: '2026-10', type: 'expense', status: 'confirmed', amount: 100, account_id: 'acc_wallet', category_id: 'cat_food', subcategory_id: null, actual_category_id: 'cat_food', actual_subcategory_id: null, tags: [], updated_at: '2026-10-20T00:00:00Z', ...fields });
async function fixture() {
	const db = await new YoseDB().init();
	db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveMasterConfig(await db.getMasterConfig());
	await db.saveSnapshot(await db.getSnapshot());
	await db.putTransactions([record('keep'), record('remove')]);
	await db.setSetting('gas_url', 'https://example.invalid/exec');
	await db.saveSecurityKey('secret', { protected: 'keep' });
	return db;
}
const rawState = async db => Promise.all(['transactions', 'master_config', 'summary_snapshot', 'settings', 'security_keys'].map(store => db.getAllRaw(store)));
const commit = (db, plan) => db.commitReplacementImport(plan, { confirmation: '完全インポート' });

describe('Atomic complete JSON import', () => {
	it('takes same-timestamp edits and removes omitted records, with immutable encrypted outbox', async () => {
		const db = await fixture();
		const input = { schema_version: 2, export_type: 'transactions', transactions: [record('keep', { amount: 999, sync_status: 'synced' })] };
		const plan = await db.prepareReplacementImport(input);
		input.transactions[0].amount = 1;
		assert.equal(await db.getPendingImport(), null);
		await commit(db, plan);
		assert.equal((await db.getTransaction('keep')).amount, 999);
		assert.equal((await db.getTransaction('keep')).sync_status, 'unsynced');
		assert.equal(await db.getTransaction('remove'), null);
		const pending = await db.getPendingImport();
		assert.equal(pending.data.transactions[0].amount, 999);
		assert.equal(pending.detectedType, 'transactions');
		assert.equal((await db.getRaw('master_config', 'pending_import')).encrypted, true);
		assert.equal((await db.getAllRaw('transactions'))[0].encrypted, true);
	});

	for (const type of ['full_backup', 'master_config', 'annual_budgets', 'summary_snapshot']) {
		it(`replaces exactly the ${type} scope and preserves keys, connection, and initial sync base`, async () => {
			const db = await fixture();
			const old = await db.exportFullData();
			const base = { schema_version: 2, accounts: [] };
			await db.putRaw('master_config', await db.encryptRecord(base), 'sync_base');
			const master = structuredClone(old.master_config);
			master.accounts[0].name = '編集済み';
			master.annual_budgets = { '2028': { expense_budget: 2500, category_budgets: {} } };
			const snapshot = { schema_version: 2, last_closed_month: null, account_balances: { acc_wallet: 123 }, monthly_summaries: {} };
			const data = { schema_version: 2, export_type: type };
			if (['full_backup', 'master_config'].includes(type)) data.master_config = master;
			if (['full_backup', 'summary_snapshot'].includes(type)) data.summary_snapshot = snapshot;
			if (type === 'full_backup') data.transactions = [];
			if (type === 'annual_budgets') data.annual_budgets = master.annual_budgets;
			await commit(db, await db.prepareReplacementImport(data));
			assert.equal((await db.getMasterConfig()).accounts[0].name, ['full_backup', 'master_config'].includes(type) ? '編集済み' : old.master_config.accounts[0].name);
			assert.deepEqual((await db.getMasterConfig()).annual_budgets, type === 'summary_snapshot' ? old.master_config.annual_budgets : master.annual_budgets);
			assert.deepEqual(await db.getSnapshot(), ['full_backup', 'summary_snapshot'].includes(type) ? snapshot : old.summary_snapshot);
			assert.equal((await db.getTransactions()).length, type === 'full_backup' ? 0 : 2);
			assert.deepEqual(await db.getMasterSyncBase(), base);
			assert.equal(await db.getSetting('gas_url'), 'https://example.invalid/exec');
			assert.deepEqual(await db.getSecurityKey('secret'), { protected: 'keep' });
		});
	}

	it('round-trips a real recurring export whose holiday-adjusted date crosses the accounting month', async () => {
		const db = await fixture();
		const generated = generateRecurringTransactions([{ id: 'month-end', is_active: true, day_of_month: 31, holiday_adjustment: 'after', type: 'expense', amount: 25, account_id: 'acc_wallet', category_id: 'cat_food' }], '2026-10', [], [], '2026-10-01');
		assert.equal(generated[0].date, '2026-11-02');
		assert.equal(generated[0].target_month, '2026-10');
		await db.putTransactions(generated);
		const exported = await db.exportTransactionsData();
		await commit(db, await db.prepareReplacementImport(exported));
		assert.equal((await db.getTransaction(generated[0].id)).date, '2026-11-02');
		assert.equal((await db.getPendingImport()).data.transactions.find(tx => tx.id === generated[0].id).target_month, '2026-10');
	});

	it('requires the exact magic word, preserves originals on refusal, and rejects a second pending import', async () => {
		const db = await fixture(), before = await rawState(db);
		const plan = await db.prepareReplacementImport([record('new')]);
		for (const confirmation of ['', 'OK', ' 完全インポート', '完全インポート ']) {
			await assert.rejects(db.commitReplacementImport(plan, { confirmation }), /確認/);
			assert.deepEqual(await rawState(db), before);
		}
		await commit(db, plan);
		await assert.rejects(db.prepareReplacementImport([]), /保留|送信待ち/);
		await assert.rejects(db.importFullData([]), /保留|送信待ち/);
	});

	for (const change of ['transaction', 'master', 'snapshot', 'lock']) {
		it(`refuses stale confirmation after ${change} changes without partial writes`, async () => {
			const db = await fixture(), plan = await db.prepareReplacementImport([]);
			if (change === 'transaction') await db.putTransaction(record('later'));
			if (change === 'master') await db.saveMasterConfig({ ...await db.getMasterConfig(), holidays: [] });
			if (change === 'snapshot') await db.saveSnapshot({ schema_version: 2, last_closed_month: null });
			if (change === 'lock') db.clearEncryptionKey();
			const before = await rawState(db);
			await assert.rejects(commit(db, plan), /変更|ロック/);
			assert.deepEqual(await rawState(db), before);
		});
	}

	it('fails before writes if encryption fails or session validation fails', async () => {
		const db = await fixture(), plan = await db.prepareReplacementImport([]), before = await rawState(db);
		const encrypt = db.encryptRecord.bind(db);
		db.encryptRecord = async () => { throw new Error('encryption failed'); };
		await assert.rejects(commit(db, plan), /encryption failed/);
		assert.deepEqual(await rawState(db), before);
		db.encryptRecord = encrypt;
		await assert.rejects(db.commitReplacementImport(plan, { confirmation: '完全インポート', isSessionValid: () => false }), /変更|同期/);
		assert.deepEqual(await rawState(db), before);
	});

	it('validates the entire input and references before changing any data', async () => {
		const db = await fixture(), before = await rawState(db);
		const invalid = [
			{ export_type: 'transactions', transactions: [record('dup'), record('dup')] },
			{ export_type: 'transactions', transactions: [record('bad', { amount: '1' })] },
			{ export_type: 'transactions', transactions: [record('bad', { account_id: 'missing' })] },
			{ export_type: 'transactions', transactions: [record('bad', { category_id: 'missing' })] },
			{ export_type: 'transactions', transactions: [record('bad', { date: 'invalid' })] },
			{ export_type: 'transactions', transactions: [record('bad', { type: 'invalid' })] },
			{ export_type: 'transactions', transactions: [record('bad', { is_deleted: 'false' })] },
			{ export_type: 'transactions', transactions: [record('bad', { amount_pending: 'false' })] },
			{ export_type: 'master_config', master_config: { ...await db.getMasterConfig(), accounts: [{ id: 'acc_wallet', is_archived: 'false' }] } },
			{ export_type: 'full_backup', transactions: [] },
			{ export_type: 'summary_snapshot', summary_snapshot: { last_closed_month: 'invalid', account_balances: {}, monthly_summaries: {} } },
			{ export_type: 'summary_snapshot', summary_snapshot: { last_closed_month: null, account_balances: {}, monthly_summaries: { invalid: {} } } },
			JSON.parse('{"export_type":"annual_budgets","annual_budgets":{"__proto__":{}}}')
		];
		for (const data of invalid) {
			await assert.rejects(db.prepareReplacementImport(data), /Invalid|不正|参照|見つかりません/);
			assert.deepEqual(await rawState(db), before);
		}
	});

	for (const boundary of ['lock', 'replace-key', 'sync-start']) {
		it(`rejects ${boundary} during encryption without persisting plaintext or partial records`, async () => {
			const db = await fixture(), plan = await db.prepareReplacementImport([]), before = await rawState(db);
			let entered, release, syncing = false;
			const ready = new Promise(resolve => { entered = resolve; });
			const resume = new Promise(resolve => { release = resolve; });
			const encrypt = db.encryptRecord.bind(db);
			let first = true;
			db.encryptRecord = async (...args) => {
				if (first) { first = false; entered(); await resume; }
				return encrypt(...args);
			};
			const pending = db.commitReplacementImport(plan, { confirmation: '完全インポート', isSessionValid: () => !syncing });
			await ready;
			if (boundary === 'lock') db.clearEncryptionKey();
			if (boundary === 'replace-key') db.setEncryptionKey(await generateDatabaseMasterKey());
			if (boundary === 'sync-start') syncing = true;
			release();
			await assert.rejects(pending, /変更|ロック|同期/);
			assert.deepEqual(await rawState(db), before);
		});
	}

	it('rejects master replacement that would orphan retained local transactions', async () => {
		const db = await fixture(), before = await rawState(db);
		const master = await db.getMasterConfig();
		master.accounts = master.accounts.filter(item => item.id !== 'acc_wallet');
		await assert.rejects(db.prepareReplacementImport({ export_type: 'master_config', master_config: master }), /参照|見つかりません/);
		assert.deepEqual(await rawState(db), before);
	});

	it('acknowledges the imported version only, leaving edits and additions unsynced', async () => {
		const db = await fixture();
		await commit(db, await db.prepareReplacementImport([record('keep'), record('edit')]));
		const pending = await db.getPendingImport();
		await db.putTransaction(record('edit', { amount: 888 }));
		await db.putTransaction(record('added'));
		await db.acknowledgePendingImport(pending);
		assert.equal((await db.getTransaction('keep')).sync_status, 'synced');
		assert.equal((await db.getTransaction('edit')).sync_status, 'unsynced');
		assert.equal((await db.getTransaction('added')).sync_status, 'unsynced');
	});

	it('allows a boolean-like category ID as a numeric budget map key', async () => {
		const db = await fixture(), master = await db.getMasterConfig();
		master.categories.push({ id: 'is_active', name: '正規のID', type: 'expense', subcategories: [] });
		master.annual_budgets = { '2028': { expense_budget: 30, category_budgets: { is_active: 30 } } };
		await commit(db, await db.prepareReplacementImport({ export_type: 'master_config', master_config: master }));
		assert.equal((await db.getMasterConfig()).annual_budgets['2028'].category_budgets.is_active, 30);
	});

	it('supersedes a blocked pending import only with explicit opt-in, a new ID, magic confirmation and original-state CAS', async () => {
		const db = await fixture();
		await commit(db, await db.prepareReplacementImport([record('old')]));
		const original = await db.getPendingImport();
		await assert.rejects(db.prepareReplacementImport({ export_type: 'annual_budgets', annual_budgets: {} }, { replacePending: true }), /種別|全データ/);
		const wider = await db.prepareReplacementImport(await db.exportFullData(), { replacePending: true });
		assert.equal(wider.detectedType, 'full_backup');
		const replacement = await db.prepareReplacementImport([record('fixed')], { replacePending: true });
		await assert.rejects(db.commitReplacementImport(replacement, { confirmation: 'OK' }), /確認/);
		assert.deepEqual(await db.getPendingImport(), original);
		await commit(db, replacement);
		const pending = await db.getPendingImport();
		assert.notEqual(pending.id, original.id);
		assert.deepEqual(pending.data.transactions.map(tx => tx.id), ['fixed']);
		assert.equal(await db.acknowledgePendingImport(original), false);
		assert.deepEqual((await db.getTransactions()).map(tx => tx.id), ['fixed']);
		const stale = await db.prepareReplacementImport([], { replacePending: true });
		await db.updatePendingImport(pending, { ...pending, base_version: 'bound-later' });
		await assert.rejects(commit(db, stale), /変更/);
		assert.deepEqual((await db.getTransactions()).map(tx => tx.id), ['fixed']);
	});

	it('updates and acknowledges only the expected pending operation and preserves later edits', async () => {
		const db = await fixture();
		await commit(db, await db.prepareReplacementImport([record('keep')]));
		const original = await db.getPendingImport(), bound = { ...original, base_version: 'remote-v1' };
		assert.equal(await db.updatePendingImport(original, bound), true);
		assert.equal(await db.updatePendingImport(original, { ...original, base_version: 'stale' }), false);
		await db.putTransaction(record('keep', { amount: 777 }));
		assert.equal(await db.acknowledgePendingImport(original), false);
		assert.equal(await db.acknowledgePendingImport(bound), true);
		assert.equal(await db.getPendingImport(), null);
		assert.equal((await db.getTransaction('keep')).amount, 777);
	});
});
