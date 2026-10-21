import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sharedMasterConfig, mergeMasterConfigs, assertMasterReferences } from '../../js/logic/master_sync.js';
import { YoseDB, DEFAULT_MASTER_CONFIG } from '../../js/db.js';
import { transaction } from '../helpers/ui_fixture.js';
import { SyncManager } from '../../js/sync.js';
import { generateEd25519KeyPair, generateDatabaseMasterKey, canonicalJsonStringify } from '../../js/crypto.js';

const master = (name = '現金') => ({ schema_version: 2, accounts: [{ id: 'a', name, type: 'cash' }], categories: [], recurring_rules: [], holidays: [], annual_budgets: {} });
const copy = value => structuredClone(value);
const equal = (a, b) => assert.deepEqual(a, b);

async function setup(remote = master()) {
	const db = new YoseDB(null); await db.init();
	await db.saveSnapshot({ schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} });
	await db.saveMasterConfig(master());
	await db.commitMasterSync(await db.getMasterConfig(), remote);
	const keys = await generateEd25519KeyPair();
	const actions = [];
	const state = { remote: copy(remote), fail: null, beforeUpdate: null };
	const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://script.google.com/macros/s/test/exec', customFetch: async (_url, options) => {
		const { action, payload } = JSON.parse(options.body); actions.push(action);
		if (state.fail) throw state.fail;
		if (action === 'update_master') {
			if (state.beforeUpdate) await state.beforeUpdate(payload);
			if (payload.base_version !== canonicalJsonStringify(sharedMasterConfig(state.remote))) return { ok: true, text: async () => JSON.stringify({ success: true, master_conflict: true, master_config: state.remote }) };
			state.remote = payload.master_config;
		}
		return { ok: true, text: async () => JSON.stringify({ success: true, master_config: state.remote, pending_diffs: [], archived_transactions: [] }) };
	} });
	return { db, sync, state, actions };
}

describe('shared master merge and synchronization', () => {
	it('shares explicit master fields and excludes device preferences, security, and timestamps', () => {
		equal(sharedMasterConfig({ ...master(), theme: 'dark', collapsed_panes: { settings: true }, updated_at: 'now', synced_passkey_bundle: 'secret', security: { key: 'secret' }, unknown: 'local' }), master());
		assert.throws(() => sharedMasterConfig(JSON.parse('{"accounts":[],"constructor":{"x":1}}')), /不正|unsafe/i);
		assert.throws(() => sharedMasterConfig(JSON.parse('{"accounts":[{"id":"a","__proto__":{"x":1}}]}')), /不正|unsafe/i);
	});

	it('merges different IDs, different properties of one ID, and holiday additions/removals', () => {
		const base = master(), local = copy(base), remote = copy(base);
		local.accounts[0].name = '手元'; remote.accounts[0].type = 'bank';
		local.accounts.push({ id: 'b', name: '追加' }); remote.accounts.push({ id: 'c', name: '別端末追加' });
		base.holidays = ['2026-01-01']; local.holidays = []; remote.holidays = ['2026-01-01', '2026-02-01'];
		const result = mergeMasterConfigs(base, local, remote);
		equal(result.conflicts, []); equal(result.config.accounts.map(a => a.id), ['a', 'b', 'c']);
		equal(result.config.accounts[0], { id: 'a', name: '手元', type: 'bank' }); equal(result.config.holidays, ['2026-02-01']);
	});

	it('accepts equal edits and reports differing values and deletion versus nested edits', () => {
		const base = master(), local = copy(base), remote = copy(base);
		local.accounts[0].name = '同じ'; remote.accounts[0].name = '同じ';
		equal(mergeMasterConfigs(base, local, remote).conflicts, []);
		remote.accounts[0].name = '別';
		assert.ok(mergeMasterConfigs(base, local, remote).conflicts.includes('accounts.a.name'));
		local.accounts = [];
		const removed = mergeMasterConfigs(base, local, remote);
		assert.ok(removed.conflicts.includes('accounts.a')); equal(removed.config.accounts, []);
		base.categories = [{ id: 'cat', subcategories: [{ id: 'sub', name: '元' }] }];
		local.categories = []; remote.categories = copy(base.categories); remote.categories[0].subcategories[0].name = '変更';
		assert.ok(mergeMasterConfigs(base, local, remote).conflicts.includes('categories.cat'));
	});

	it('validates master references and duplicate IDs before sending a merged configuration', () => {
		assert.doesNotThrow(() => assertMasterReferences(master()));
		assert.throws(() => assertMasterReferences({ ...master(), accounts: [{ id: 'a', debit_account_id: 'missing' }] }), /参照/);
		assert.throws(() => assertMasterReferences({ ...master(), recurring_rules: [{ id: 'r', account_id: 'missing' }] }), /参照/);
		assert.throws(() => assertMasterReferences({ ...master(), recurring_rules: [{ id: 'r', account_id: 'a', category_id: 'missing' }] }), /参照/);
		assert.throws(() => assertMasterReferences({ ...master(), categories: [{ id: 'cat', subcategories: [] }], recurring_rules: [{ id: 'r', category_id: 'cat', subcategory_id: 'missing' }] }), /参照/);
		assert.throws(() => assertMasterReferences({ ...master(), accounts: [{ id: 'a' }, { id: 'a' }] }), /重複/);
	});

	it('stores the shared base encrypted, ignores preferences, and retains edits made during acknowledgement', async () => {
		const { db } = await setup();
		db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.saveMasterConfig({ ...master(), theme: 'dark', collapsed_panes: { foo: true } });
		await db.commitMasterSync(await db.getMasterConfig(), master());
		assert.equal((await db.getRaw('master_config', 'sync_base')).encrypted, true);
		assert.equal(await db.hasUnsyncedMasterConfig(), false);
		const submitted = await db.getMasterConfig();
		await db.saveMasterConfig({ ...submitted, accounts: [{ id: 'a', name: '再編集', type: 'cash' }] });
		await db.commitMasterSync(submitted, { ...master(), holidays: ['2026-01-01'] });
		const current = await db.getMasterConfig();
		assert.equal(current.accounts[0].name, '再編集'); equal(current.holidays, ['2026-01-01']);
		assert.equal(current.theme, 'dark'); equal(current.collapsed_panes, { foo: true });
		assert.equal(await db.hasUnsyncedMasterConfig(), true);
	});

	it('retries an atomic compare failure without advancing the base alone', async () => {
		const { db } = await setup();
		const original = db.replaceImportBatch.bind(db); let calls = 0;
		db.replaceImportBatch = async (...args) => {
			if (calls++ === 0) { await db.saveMasterConfig({ ...await db.getMasterConfig(), accounts: [{ id: 'a', name: '並行編集', type: 'cash' }] }); return false; }
			return original(...args);
		};
		await db.commitMasterSync(await db.getMasterConfig(), { ...master(), holidays: ['2026-01-01'] });
		assert.equal((await db.getMasterConfig()).accounts[0].name, '並行編集');
		equal((await db.getMasterSyncBase()).holidays, ['2026-01-01']);
		assert.equal(await db.hasUnsyncedMasterConfig(), true);
	});

	it('manual sync sends master-only changes and obtains remote-only changes without changing local preferences', async () => {
		const { db, sync, state, actions } = await setup();
		await db.saveMasterConfig({ ...await db.getMasterConfig(), accounts: [{ id: 'a', name: '手元', type: 'cash' }], theme: 'dark' });
		state.remote.holidays = ['2026-02-01'];
		const result = await sync.syncBidirectional();
		assert.equal(result.status, 'synced'); assert.ok(actions.includes('update_master'));
		assert.equal(state.remote.accounts[0].name, '手元'); equal((await db.getMasterConfig()).holidays, ['2026-02-01']);
		assert.equal((await db.getMasterConfig()).theme, 'dark'); assert.equal(state.remote.theme, undefined);
		assert.equal(await db.hasUnsyncedMasterConfig(), false);
	});

	it('retains both versions on conflict, allows cancelling, and resolves explicitly on a later retry', async () => {
		const { db, sync, state } = await setup();
		await db.saveMasterConfig({ ...master('手元') }); state.remote = master('リモート');
		assert.equal((await sync.syncBidirectional()).status, 'master_conflict');
		assert.equal((await db.getMasterConfig()).accounts[0].name, '手元'); assert.equal(state.remote.accounts[0].name, 'リモート');
		assert.equal((await sync.syncBidirectional({ approveMasterConflict: async () => false })).status, 'master_conflict_cancelled');
		await sync.syncBidirectional({ approveMasterConflict: async paths => { assert.ok(paths.includes('accounts.a.name')); return true; } });
		assert.equal(state.remote.accounts[0].name, '手元'); assert.equal(await db.hasUnsyncedMasterConfig(), false);
	});

	it('rejects a server CAS conflict and preserves the local pending version', async () => {
		const { db, sync, state } = await setup();
		await db.saveMasterConfig(master('手元'));
		state.beforeUpdate = async () => { state.remote = master('途中変更'); };
		await assert.rejects(sync.syncBidirectional(), /別端末|再取得/);
		assert.equal((await db.getMasterConfig()).accounts[0].name, '手元'); assert.equal(await db.hasUnsyncedMasterConfig(), true);
	});

	it('does not erase master edits created during a network upload', async () => {
		const { db, sync, state } = await setup();
		await db.saveMasterConfig(master('送信版'));
		state.beforeUpdate = async () => { state.beforeUpdate = null; await db.saveMasterConfig(master('再編集版')); };
		await sync.syncMaster();
		assert.equal(state.remote.accounts[0].name, '送信版');
		assert.equal((await db.getMasterConfig()).accounts[0].name, '再編集版'); assert.equal(await db.hasUnsyncedMasterConfig(), true);
	});

	it('requires confirmation for divergent first-sync existing data and imports remote into default local data', async () => {
		const { db, sync, state } = await setup();
		await db.deleteRaw('master_config', 'sync_base'); state.remote = master('リモート既存'); await db.saveMasterConfig(master('ローカル既存'));
		assert.equal((await sync.syncBidirectional()).status, 'master_conflict');
		await db.saveMasterConfig(copy(DEFAULT_MASTER_CONFIG));
		await sync.syncBidirectional(); assert.equal((await db.getMasterConfig()).accounts[0].name, 'リモート既存');
	});

	it('publishes synchronization start and end on success and failure and retains failed data', async () => {
		const { db, sync, state } = await setup(); const states = [];
		const unsubscribe = sync.onStateChange(() => states.push(sync.isSyncing));
		await sync.syncBidirectional(); equal(states, [true, false]);
		states.length = 0; await db.saveMasterConfig(master('失敗保存')); state.fail = new TypeError('Failed to fetch');
		await assert.rejects(sync.syncBidirectional(), /接続|URL|公開/); equal(states, [true, false]);
		assert.equal((await db.getMasterConfig()).accounts[0].name, '失敗保存'); assert.equal(await db.hasUnsyncedMasterConfig(), true);
		unsubscribe();
	});

	it('times out an unavailable connection without resending a potentially committed operation', async () => {
		const { sync } = await setup(); let attempts = 0; sync.requestTimeoutMs = 5;
		sync.fetch = async (_url, { signal }) => { attempts++; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))); };
		await assert.rejects(sync.sendRequest('update_master', { master_config: master() }), /タイムアウト/);
		assert.equal(attempts, 1);
	});

	it('queues another background master synchronization when saved during an active one', async () => {
		const { db, sync, state } = await setup();
		await db.saveMasterConfig(master('最初'));
		state.beforeUpdate = async () => { state.beforeUpdate = null; await db.saveMasterConfig(master('次')); sync.queueMasterSync(); };
		await sync.queueMasterSync();
		for (let tries = 0; tries < 50 && (sync.isSyncing || sync._masterSyncRequested); tries++) await new Promise(resolve => setTimeout(resolve, 2));
		assert.equal(state.remote.accounts[0].name, '次'); assert.equal(await db.hasUnsyncedMasterConfig(), false);
	});
	it('synchronizes both masters and pending transactions from an actual online event', async () => {
		const { db, sync, actions } = await setup();
		await db.saveMasterConfig(master('オンライン復帰'));
		await db.putTransaction(transaction('offline_tx', { account_id: 'a', category_id: null, actual_category_id: null, amount: 1 }));
		const previousWindow = globalThis.window, previousDocument = globalThis.document;
		const listeners = new Map();
		globalThis.window = { addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: name => listeners.delete(name) };
		globalThis.document = { addEventListener() {}, removeEventListener() {} };
		try {
			sync.attachEventListeners();
			await listeners.get('online')();
			assert.ok(actions.includes('update_master')); assert.ok(actions.includes('push_diff'));
			assert.equal((await db.getUnsyncedTransactions()).length, 0);
		} finally { sync.detachEventListeners(); globalThis.window = previousWindow; globalThis.document = previousDocument; }
	});

	it('times out when response headers arrive but the body never completes', async () => {
		const { sync } = await setup(); sync.requestTimeoutMs = 5;
		sync.fetch = async () => ({ ok: true, text: () => new Promise(() => {}) });
		await assert.rejects(Promise.race([sync.sendRequest('fetch_state', {}), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('test guard: body was not timed out')), 100))]), /タイムアウト/);
	});

	it('requests view refresh only when a received master changes the local shared data', async () => {
		const { sync, state } = await setup(); let refreshes = 0;
		const unsubscribe = sync.onMasterChange(() => { refreshes++; });
		await sync.syncMaster(); assert.equal(refreshes, 0);
		state.remote.holidays = ['2026-12-31'];
		await sync.syncMaster(); assert.equal(refreshes, 1);
		unsubscribe(); state.remote.holidays = [];
		await sync.syncMaster(); assert.equal(refreshes, 1);
	});

});
