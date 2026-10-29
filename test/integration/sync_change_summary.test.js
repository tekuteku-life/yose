import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, verifySignedRequest, canonicalJsonStringify, exportKeyRaw, importAesKeyRaw } from '../../js/crypto.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { IMPORT_CONFIRMATION_WORD } from '../../js/db/backup_replacement.js';
import { transaction } from '../helpers/ui_fixture.js';

const copy = value => structuredClone(value);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise, message) {
	const expired = Symbol('expired'); let timer;
	try { const value = await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(expired), 3000); })]); assert.notEqual(value, expired, message); return value; }
	finally { clearTimeout(timer); }
}
async function setup() {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: null });
	await db.mutateMasterConfig(config => { config.categories.push({ id: 'custom-income', type: 'income', name: 'custom income', subcategories: [{ id: 'custom-child', name: 'custom child' }] }); });
	const base = await db.getMasterConfig(); await db.commitMasterSync(base, sharedMasterConfig(base));
	const remote = { master_config: copy(sharedMasterConfig(base)), snapshot: await db.getSnapshot(), pending_diffs: [], archived_transactions: [], archive_months: [] };
	const keys = await generateEd25519KeyPair(), requests = [], hooks = {};
	const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://signed.fixture', customFetch: async (_url, options) => {
		const request = JSON.parse(options.body); assert.equal((await verifySignedRequest(request, keys.publicKey)).valid, true, 'summary collection must preserve the real signature envelope');
		requests.push(request); const { action, payload } = request;
		if (hooks.before) await hooks.before(action, payload);
		if (action === 'update_master') {
			if (hooks.update) return hooks.update(payload);
			assert.equal(payload.base_version, canonicalJsonStringify(remote.master_config)); remote.master_config = copy(payload.master_config);
		}
		if (action === 'push_diff') {
			for (const tx of payload.transactions) { const index = remote.pending_diffs.findIndex(row => row.id === tx.id); if (index < 0) remote.pending_diffs.push(copy(tx)); else remote.pending_diffs[index] = copy(tx); }
		}
		const response = { success: true, ...copy(remote), ...(action === 'push_diff' ? { accepted_ids: payload.transactions.map(tx => tx.id) } : {}) };
		if (hooks.after) await hooks.after(action, payload, response);
		return { ok: true, text: async () => JSON.stringify(response) };
	} });
	return { db, sync, remote, requests, hooks };
}
const domains = {
	accounts: config => { config.accounts[0].name = 'changed account'; },
	categories: config => { config.categories[0].subcategories[0].name = 'changed child'; },
	recurring_rules: config => { config.recurring_rules.push({ id: 'summary-rule', name: 'summary', is_active: true, type: 'expense', account_id: 'acc_wallet', category_id: 'cat_food', amount: 100 }); },
	holidays: config => { config.holidays.push('2027-01-01'); },
	annual_budgets: config => { config.annual_budgets['2027'] = { expense_budget: 1234, category_budgets: {} }; },
	investment_history: config => { config.accounts.find(account => account.type === 'investment').investment_history = { '2026-10-21': { market_value: 1234, acquisition_cost: 1000 } }; },
	point_payment_defaults: config => { config.point_payment_defaults = { category_id: 'custom-income', subcategory_id: 'custom-child' }; }
};

describe('committed business changes in signed synchronization results', () => {
	it('reports a true no-op and excludes local device settings and keys', async () => {
		const { db, sync, remote } = await setup(); await db.mutateMasterConfig(config => { config.theme = 'dark'; config.collapsed_panes = { private: true }; });
		const result = await sync.syncBidirectional();
		assert.deepEqual(result.changes, { sent: {}, received: {} }); assert.equal(result.pending_master, false);
		assert.equal(result.synced_count, 0); assert.equal(result.downloaded_count, 0); assert.equal(result.pending_count, 0);
		assert.equal(remote.master_config.theme, undefined); assert.equal(remote.master_config.collapsed_panes, undefined);
	});
	for (const [field, change] of Object.entries(domains)) {
		it(`reports only a committed ${field} receive once across both downloads`, async () => {
			const { sync, remote } = await setup(); change(remote.master_config);
			const result = await sync.syncBidirectional(); assert.deepEqual(result.changes, { sent: {}, received: { [field]: 1 } });
			assert.equal(result.synced_count, 0); assert.equal(result.downloaded_count, 0); assert.equal(result.pending_master, false);
		});
		it(`reports only a server-accepted ${field} send with zero transaction changes`, async () => {
			const { db, sync, requests } = await setup(); await db.mutateMasterConfig(change);
			const result = await sync.syncBidirectional(); assert.deepEqual(result.changes, { sent: { [field]: 1 }, received: {} });
			assert.equal(result.synced_count, 0); assert.equal(result.downloaded_count, 0); assert.equal(result.pending_master, false);
			assert.equal(requests.filter(request => request.action === 'update_master').length, 1);
		});
	}
	it('counts distinct changed business IDs while unioning the same ID across receive stages', async () => {
		const { sync, remote, hooks } = await setup(); remote.master_config.accounts[0].name = 'first receive'; remote.master_config.accounts[1].name = 'second account'; let fetches = 0;
		hooks.before = async action => { if (action === 'fetch_state' && ++fetches === 2) remote.master_config.accounts[0].name = 'later same account'; };
		const result = await sync.syncBidirectional(); assert.deepEqual(result.changes, { sent: {}, received: { accounts: 2 } });
	});
	it('reports changed month closing information independently from transaction counts', async () => {
		const { sync, remote } = await setup(); remote.snapshot.account_balances.acc_wallet += 1;
		const result = await sync.syncBidirectional(); assert.ok(result.changes && result.changes.received, 'the sync result must include committed receive changes'); assert.equal(result.changes.received.summary_snapshot, 1); assert.equal(result.downloaded_count, 0);
	});
	it('does not attribute a concurrent preserved local edit to received master changes', async () => {
		const { db, sync, remote } = await setup(); domains.holidays(remote.master_config);
		const commit = db.commitMasterSync.bind(db); let injected = false;
		db.commitMasterSync = async (...args) => { if (!injected) { injected = true; await db.mutateMasterConfig(config => { config.accounts[0].name = 'concurrent local'; }); } return commit(...args); };
		const result = await sync.syncBidirectional(); assert.ok(result.changes && result.changes.received, 'the sync result must include committed receive changes'); assert.deepEqual(result.changes.received, { holidays: 1 });
		assert.equal((await db.getMasterConfig()).accounts[0].name, 'concurrent local');
	});
	it('retains unresolved master changes without claiming a cancelled conflict was committed', async () => {
		const { db, sync, remote } = await setup(); await db.mutateMasterConfig(config => { config.accounts[0].name = 'local conflict'; }); remote.master_config.accounts[0].name = 'remote conflict';
		const before = await db.captureImportState(), remoteBefore = copy(remote);
		const result = await sync.syncBidirectional({ approveMasterConflict: async () => false });
		assert.equal(result.status, 'master_conflict_cancelled'); assert.deepEqual(result.changes, { sent: {}, received: {} }); assert.equal(result.pending_master, true);
		assert.deepEqual(await db.captureImportState(), before); assert.deepEqual(remote, remoteBefore);
	});
	for (const defect of ['drop-field', 'wrong-value', 'missing-master']) it(`refuses old GAS ${defect} acknowledgement and preserves the local setting and sync base`, async () => {
		const { db, sync, hooks } = await setup(); await db.mutateMasterConfig(domains.point_payment_defaults); const before = await db.captureImportState();
		hooks.update = async payload => {
			const accepted = copy(payload.master_config);
			if (defect === 'drop-field') delete accepted.point_payment_defaults;
			if (defect === 'wrong-value') accepted.point_payment_defaults = null;
			return { ok: true, text: async () => JSON.stringify({ success: true, ...(defect === 'missing-master' ? {} : { master_config: accepted }) }) };
		};
		await assert.rejects(sync.syncBidirectional(), /GAS|設定|応答|更新|point/i); assert.deepEqual(await db.captureImportState(), before); assert.equal(await db.hasUnsyncedMasterConfig(), true);
	});
	for (const defect of ['stale-value', 'missing-master', 'array-master', 'null-master']) it(`refuses an unconfirmed point default clear with ${defect} while preserving every local store`, async () => {
		const { db, sync, remote, hooks } = await setup(), oldValue = copy(remote.master_config.point_payment_defaults);
		assert.ok(oldValue, 'fixture must start with an explicitly configured default');
		await db.mutateMasterConfig(config => { config.point_payment_defaults = null; }); const before = await db.captureImportState();
		hooks.update = async payload => {
			const accepted = { ...copy(payload.master_config), point_payment_defaults: oldValue };
			return { ok: true, text: async () => JSON.stringify({ success: true, ...(defect === 'missing-master' ? {} : { master_config: defect === 'array-master' ? [] : defect === 'null-master' ? null : accepted }) }) };
		};
		await assert.rejects(sync.syncBidirectional(), /GAS|設定|応答|更新|point/i);
		assert.deepEqual(await db.captureImportState(), before); assert.equal((await db.getMasterConfig()).point_payment_defaults ?? null, null); assert.equal(await db.hasUnsyncedMasterConfig(), true);
	});
	for (const unset of ['absent', 'null']) it(`accepts an explicit clear acknowledged with ${unset} and reports one accepted setting change`, async () => {
		const { db, sync, remote, hooks } = await setup(); await db.mutateMasterConfig(config => { config.point_payment_defaults = null; });
		hooks.update = async payload => {
			const accepted = copy(payload.master_config); if (unset === 'absent') delete accepted.point_payment_defaults; else accepted.point_payment_defaults = null;
			remote.master_config = copy(accepted); return { ok: true, text: async () => JSON.stringify({ success: true, master_config: accepted }) };
		};
		const result = await sync.syncBidirectional(); assert.equal(result.status, 'synced'); assert.equal(result.changes.sent.point_payment_defaults, 1); assert.equal(result.pending_master, false);
		assert.equal((await db.getMasterConfig()).point_payment_defaults ?? null, null); assert.equal((await db.getMasterSyncBase()).point_payment_defaults ?? null, null);
	});
	it('keeps a transactions-only replacement receipt compatible when its master echo is omitted', async () => {
		const { db, sync, hooks } = await setup(), originalMaster = await db.getMasterConfig();
		const plan = await db.prepareReplacementImport({ schema_version: 2, export_type: 'transactions', transactions: [transaction('receipt-no-master')] });
		await db.commitReplacementImport(plan, { confirmation: IMPORT_CONFIRMATION_WORD });
		hooks.after = async (action, payload, response) => {
			if (action === 'fetch_state') response.state_version = 'replacement-base-version';
			if (action === 'replace_import') { response.import_id = payload.import_id; response.imported_at = '2026-10-28T01:00:00Z'; delete response.master_config; }
		};
		await sync.flushPendingImport(); assert.equal(await db.getPendingImport(), null);
		assert.equal((await db.getTransaction('receipt-no-master')).sync_status, 'synced'); assert.deepEqual(await db.getMasterConfig(), originalMaster);
	});
	for (const defect of ['stale-value', 'missing-master']) it(`preserves an unset master replacement pending state when the receipt has ${defect}`, async () => {
		const { db, sync, remote, hooks } = await setup(), oldValue = copy(remote.master_config.point_payment_defaults), incoming = copy(await db.getMasterConfig()); delete incoming.point_payment_defaults;
		const plan = await db.prepareReplacementImport({ schema_version: 2, export_type: 'master_config', master_config: incoming }); await db.commitReplacementImport(plan, { confirmation: IMPORT_CONFIRMATION_WORD });
		hooks.after = async (action, payload, response) => {
			if (action === 'fetch_state') response.state_version = 'replacement-base-version';
			if (action === 'replace_import') { response.import_id = payload.import_id; if (defect === 'stale-value') response.master_config = { ...incoming, point_payment_defaults: oldValue }; else delete response.master_config; }
		};
		const pending = await db.getPendingImport(); assert.equal(await db.updatePendingImport(pending, { ...pending, base_version: 'replacement-base-version' }), true); const before = await db.captureImportState();
		await assert.rejects(sync.flushPendingImport(), /GAS|設定|応答|更新|point/i); assert.deepEqual(await db.captureImportState(), before); assert.ok(await db.getPendingImport());
	});
	it('keeps the local setting and base pending after a server commit whose response is lost', async () => {
		const { db, sync, remote, hooks } = await setup(); await db.mutateMasterConfig(domains.point_payment_defaults); const before = await db.captureImportState();
		hooks.after = async action => { if (action === 'update_master') throw new Error('response lost after server commit'); };
		await assert.rejects(sync.syncBidirectional(), /response lost/); assert.deepEqual(await db.captureImportState(), before);
		assert.deepEqual(remote.master_config.point_payment_defaults, { category_id: 'custom-income', subcategory_id: 'custom-child' }); assert.equal(await db.hasUnsyncedMasterConfig(), true);
	});
	it('commits settings and their base atomically and preserves every raw store on local encryption failure', async () => {
		const { db, sync, remote } = await setup(); domains.accounts(remote.master_config); const before = await db.captureImportState(), encrypt = db.encryptRecord.bind(db); let calls = 0;
		db.encryptRecord = async (...args) => { if (++calls === 2) throw new Error('master base encryption fault'); return encrypt(...args); };
		await assert.rejects(sync.syncBidirectional(), /encryption fault/); assert.deepEqual(await db.captureImportState(), before);
	});
	it('retains existing transaction counters without inventing setting changes for a transaction-only upload', async () => {
		const { db, sync } = await setup(); await db.putTransaction(transaction('tx-only'));
		const result = await sync.syncBidirectional(); assert.equal(result.synced_count, 1); assert.equal(result.pending_count, 0); assert.deepEqual(result.changes, { sent: {}, received: {} });
	});
	for (const entry of ['syncPendingDiffs', 'syncBidirectional']) it(`includes a committed conflict receive in ${entry} when the server accepts no local IDs`, async () => {
		const { db, sync, remote, hooks } = await setup(); await db.putTransaction(transaction('conflict-only'));
		const newer = transaction('conflict-only', { amount: 900, updated_at: '2026-10-30T00:00:00Z' });
		hooks.after = async (action, _payload, response) => {
			if (action === 'push_diff') { response.accepted_ids = []; response.conflicts = [copy(newer)]; response.pending_diffs = []; response.archived_transactions = []; remote.pending_diffs = [copy(newer)]; }
		};
		const result = await sync[entry]();
		assert.equal(result.synced_count, 0); assert.equal(result.downloaded_count, 1, 'a committed conflict is received work even when accepted_ids is empty');
		assert.equal(sync.lastResult.downloaded_count, 1); assert.equal((await db.getTransaction('conflict-only')).amount, 900); assert.equal((await db.getTransaction('conflict-only')).sync_status, 'synced');
	});
	it('keeps the ordinary config return API while offering actual commit differences explicitly', async () => {
		const { db } = await setup(), local = await db.getMasterConfig(), remote = copy(sharedMasterConfig(local)); domains.accounts(remote);
		const detailed = await db.commitMasterSync(local, remote, { includeChanges: true }); assert.deepEqual(detailed.changes, { accounts: 1 }); assert.equal(detailed.config.accounts[0].name, 'changed account');
		const ordinary = await db.commitMasterSync(await db.getMasterConfig(), remote); assert.equal(ordinary.accounts[0].name, 'changed account'); assert.equal(ordinary.config, undefined);
	});
	it('retains confirmed receive changes in lastResult when a later upload fails', async () => {
		const { db, sync, remote, hooks } = await setup(); await db.putTransaction(transaction('still-pending')); domains.accounts(remote.master_config);
		hooks.before = async action => { if (action === 'push_diff') throw new Error('upload disconnected'); };
		await assert.rejects(sync.syncBidirectional(), /upload disconnected/);
		assert.ok(sync.lastResult, 'a partial failed attempt must expose its confirmed result');
		assert.equal(sync.lastResult.status, 'failed'); assert.deepEqual(sync.lastResult.changes, { sent: {}, received: { accounts: 1 } });
		assert.equal(sync.lastResult.synced_count, 0); assert.equal(sync.lastResult.pending_count, 1); assert.equal((await db.getTransaction('still-pending')).sync_status, 'unsynced');
	});
	it('does not reset the active attempt result when a second caller receives already_syncing', { timeout: 15000 }, async () => {
		const { sync, hooks } = await setup(), entered = deferred(), release = deferred(); let held = false;
		hooks.before = async action => { if (action === 'fetch_state' && !held) { held = true; entered.resolve(); await release.promise; } };
		const running = sync.syncBidirectional();
		try {
			await progress(entered.promise, 'active synchronization must reach its held response');
			assert.ok(sync.lastResult, 'the real attempt must own a result before its first response'); const active = sync.lastResult;
			assert.equal((await sync.syncBidirectional()).status, 'already_syncing'); assert.equal(sync.lastResult, active); assert.equal(sync.isSyncing, true);
		} finally { release.resolve(); await progress(running, 'released synchronization must finish during cleanup'); }
	});
	it('does not let an old locked manager commit or change the result owned by the re-unlocked manager', { timeout: 15000 }, async () => {
		const { db, sync: oldManager, remote, hooks } = await setup(), entered = deferred(), release = deferred(); let held = false;
		hooks.before = async action => { if (action === 'fetch_state' && !held) { held = true; entered.resolve(); await release.promise; } };
		const old = oldManager.syncBidirectional().then(value => ({ value }), error => ({ error }));
		let newManager, result, committed, outcome;
		try {
			await progress(entered.promise, 'old manager must reach its held response');
			const rawKey = await exportKeyRaw(db.encryptionKey); oldManager.setPrivateKey(null); db.clearEncryptionKey(); db.setEncryptionKey(await importAesKeyRaw(rawKey)); rawKey.fill(0);
			const keys = await generateEd25519KeyPair();
			newManager = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://new-session.fixture', customFetch: async (_url, options) => {
				assert.equal((await verifySignedRequest(JSON.parse(options.body), keys.publicKey)).valid, true);
				return { ok: true, text: async () => JSON.stringify({ success: true, ...copy(remote) }) };
			} });
			result = await newManager.syncBidirectional(); committed = await db.captureImportState();
		} finally { release.resolve(); outcome = await progress(old, 'old manager must finish after releasing its response'); }
		assert.ok(outcome.error, 'old manager must reject its invalid session instead of committing');
		assert.deepEqual(await db.captureImportState(), committed); assert.equal(newManager.isSyncing, false); assert.equal(newManager.lastError, null);
		assert.deepEqual(newManager.lastResult, result); assert.equal(result.status, 'synced'); assert.notEqual(oldManager.lastResult?.status, 'synced');
	});
});

describe('legacy master repair produces a safe committed synchronization summary', () => {
	for (const field of ['accounts', 'categories', 'recurring_rules']) for (const shape of ['object', 'null-row', 'invalid-ids']) it(`repairs legacy ${field} ${shape} without throwing after the commit or inventing invalid identities`, async () => {
		const { db } = await setup(), good = await db.getMasterConfig(), legacy = copy(good);
		legacy[field] = shape === 'object' ? {} : shape === 'null-row' ? [null] : [{ id: null }, { id: 123 }, { id: '' }, { id: 'constructor' }];
		await db.putRaw('master_config', await db.encryptRecord(legacy), 'current');
		const detailed = await db.commitMasterSync(legacy, sharedMasterConfig(good), { includeChanges: true });
		assert.deepEqual(detailed.config[field], good[field]); assert.deepEqual((await db.getMasterConfig())[field], good[field]);
		assert.deepEqual(detailed.change_ids[field], good[field].map(row => row.id)); assert.equal(detailed.changes[field], good[field].length);
		assert.deepEqual(await db.getMasterSyncBase(), sharedMasterConfig(good));
	});
	for (const field of ['holidays', 'annual_budgets', 'investment_history']) for (const shape of ['wrong-container', 'invalid-entries', ...(field === 'holidays' ? [] : ['array-container'])]) it(`handles legacy ${field} ${shape} without a summary-only failure after repair`, async () => {
		const { db } = await setup(), good = await db.getMasterConfig(), legacy = copy(good);
		if (field === 'holidays') legacy.holidays = shape === 'wrong-container' ? {} : [null, {}, 1, 'not-a-date'];
		if (field === 'annual_budgets') legacy.annual_budgets = shape === 'wrong-container' ? 'bad-budget-container' : shape === 'array-container' ? [{ expense_budget: 100 }] : { invalid: {}, '2026': null };
		if (field === 'investment_history') legacy.accounts.find(account => account.type === 'investment').investment_history = shape === 'wrong-container' ? 'bad-history-container' : shape === 'array-container' ? [{ market_value: 100 }] : { bad: {}, '2026-10-21': null };
		await db.putRaw('master_config', await db.encryptRecord(legacy), 'current');
		const detailed = await db.commitMasterSync(legacy, sharedMasterConfig(good), { includeChanges: true });
		assert.deepEqual(await db.getMasterConfig(), detailed.config); assert.deepEqual(sharedMasterConfig(detailed.config), sharedMasterConfig(good));
		assert.deepEqual(detailed.change_ids[field] || [], field === 'holidays' ? good.holidays : []);
		assert.deepEqual(await db.getMasterSyncBase(), sharedMasterConfig(good));
	});
});
