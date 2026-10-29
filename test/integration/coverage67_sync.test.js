import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { IMPORT_CONFIRMATION_WORD } from '../../js/db/backup_replacement.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise) {
	let timer;
	try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('expected asynchronous stage was not reached')), 4000); })]); }
	finally { clearTimeout(timer); }
}
async function fixture(transform = response => response) {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.saveMasterConfig(await db.getMasterConfig()); await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: null });
	gas.saveJsonFile('master_config.json', await db.getMasterConfig()); gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot()); gas.saveJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] });
	const keys = await generateEd25519KeyPair(); PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
	const requests = [], sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://coverage67.fixture', customFetch: async (_url, options) => {
		const request = JSON.parse(options.body); requests.push(request); const response = await transform(gas.doPost({ postData: { contents: options.body } }), request);
		return { ok: true, text: async () => JSON.stringify(response) };
	} });
	return { db, sync, requests, keys };
}

describe('review67 signed import and synchronization ownership', () => {
	let env;
	beforeEach(() => { env = new MockGasEnvironment(); env.setupGlobals(); });
	afterEach(() => env.teardownGlobals());
	for (const fault of ['wrong-import-id', 'invalid-date']) it(`keeps the encrypted outbox when a real server commit is followed by ${fault}`, async () => {
		const { db, sync, requests } = await fixture((response, request) => request.action === 'replace_import' ? { ...response, ...(fault === 'wrong-import-id' ? { import_id: 'different' } : { imported_at: 'invalid-date' }) } : response);
		const plan = await db.prepareReplacementImport([transaction('imported')]); await db.commitReplacementImport(plan, { confirmation: IMPORT_CONFIRMATION_WORD });
		const pending = await db.getPendingImport(); await db.updatePendingImport(pending, { ...pending, base_version: gas.handleAction('fetch_state', {}).state_version }); const before = await db.captureImportState();
		await assert.rejects(sync.syncMaster(), fault === 'wrong-import-id' ? /同期応答/ : /受理時刻/); assert.deepEqual(await db.captureImportState(), before);
		assert.equal(gas.handleAction('fetch_state', {}).pending_diffs[0].id, 'imported'); assert.equal(sync.lastResult.status, 'failed'); assert.equal(sync.lastResult.import_completed, undefined); assert.equal(requests.filter(request => request.action === 'replace_import').length, 1);
	});
	it('retains an unbound import when an old server supplies no state version', async () => {
		const { db, sync, requests } = await fixture((response, request) => { if (request.action === 'fetch_state') { const copy = { ...response }; delete copy.state_version; return copy; } return response; });
		await db.commitReplacementImport(await db.prepareReplacementImport([transaction('pending')]), { confirmation: IMPORT_CONFIRMATION_WORD }); const before = await db.captureImportState();
		await assert.rejects(sync.syncMaster(), /GAS の更新/); assert.deepEqual(await db.captureImportState(), before); assert.equal(requests.some(request => request.action === 'replace_import'), false);
	});
	it('stops a stale import binding when another real writer replaces the encrypted outbox', async () => {
		let writer, arrived;
		const { db, sync, requests } = await fixture(async (response, request) => { if (request.action === 'fetch_state' && writer) { await writer(); arrived = await db.captureImportState(); } return response; });
		await db.commitReplacementImport(await db.prepareReplacementImport([transaction('first')]), { confirmation: IMPORT_CONFIRMATION_WORD });
		writer = async () => { await db.commitReplacementImport(await db.prepareReplacementImport([transaction('replacement')], { replacePending: true }), { confirmation: IMPORT_CONFIRMATION_WORD }); };
		await assert.rejects(sync.syncMaster(), /送信待ちが変更/); assert.deepEqual(await db.captureImportState(), arrived); assert.equal(requests.some(request => request.action === 'replace_import'), false); assert.equal((await db.getPendingImport()).data.transactions[0].id, 'replacement');
	});
	for (const stage of ['pending', 'master']) it(`keeps the old result unchanged when finish ${stage} read completes in a different authentication epoch`, { timeout: 15000 }, async () => {
		const { db, sync, keys } = await fixture(), entered = deferred(), release = deferred(), nextEntered = deferred(), nextRelease = deferred(), unsynced = db.getUnsyncedTransactions.bind(db), hasPending = db.hasUnsyncedMasterConfig.bind(db); let running, nextRunning, reads = 0, held = false;
		await db.putTransaction(transaction('still-unsynced'));
		db.getUnsyncedTransactions = async () => { const answer = await unsynced(); if (stage === 'pending' && ++reads === 2) { entered.resolve(); await release.promise; } return answer; };
		db.hasUnsyncedMasterConfig = async () => { const answer = await hasPending(); if (stage === 'master' && !held) { held = true; entered.resolve(); await release.promise; } return answer; };
		try {
			running = sync.syncMaster(); await progress(entered.promise); const ownerResult = sync.lastResult, oldState = structuredClone(ownerResult); assert.equal(oldState.pending_count, 0); assert.equal((await unsynced()).length, 1, 'the held read will have a value that would corrupt the obsolete result');
			assert.deepEqual(await sync.syncMaster(), { status: 'already_syncing' }); assert.equal(sync.lastResult, ownerResult); db.setEncryptionKey(db.encryptionKey);
			const next = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: sync.gasUrl, customFetch: async (...args) => { nextEntered.resolve(); await nextRelease.promise; return sync.fetch(...args); } }), notifications = [];
			next.onStateChange(() => notifications.push({ busy: next.isSyncing, result: structuredClone(next.lastResult) })); nextRunning = next.syncMaster(); await progress(nextEntered.promise); const newState = structuredClone(next.lastResult), notificationCount = notifications.length, before = await db.captureImportState();
			release.resolve(); await progress(running);
			assert.equal(sync.lastResult, ownerResult); assert.deepEqual(sync.lastResult, oldState, 'obsolete finish must not assign pending_count=1'); assert.equal(sync.lastError, null); assert.equal(sync.isSyncing, false);
			assert.deepEqual(next.lastResult, newState); assert.equal(next.lastResult.status, 'syncing'); assert.equal(next.isSyncing, true); assert.equal(next.lastError, null); assert.equal(notifications.length, notificationCount); assert.deepEqual(await db.captureImportState(), before);
			nextRelease.resolve(); await progress(nextRunning); assert.equal(next.lastResult.status, 'synced'); assert.equal(next.lastResult.pending_count, 1);
		} finally { release.resolve(); nextRelease.resolve(); db.getUnsyncedTransactions = unsynced; db.hasUnsyncedMasterConfig = hasPending; if (running) await running.catch(() => {}); if (nextRunning) await nextRunning.catch(() => {}); }
	});
	for (const soft of [true, false]) it(`preserves a deletion made during a held retroactive import flush, soft=${soft}`, { timeout: 15000 }, async () => {
		const entered = deferred(), release = deferred(); let holding = false;
		const { db, sync, requests } = await fixture(async (response, request) => { if (request.action === 'replace_import' && holding) { entered.resolve(); await release.promise; } return response; });
		await db.commitReplacementImport(await db.prepareReplacementImport([transaction('source')]), { confirmation: IMPORT_CONFIRMATION_WORD }); const original = await db.getTransaction('source'); holding = true;
		const running = sync.sendRetroactiveUpdate(original).then(value => ({ value }), error => ({ error })); let outcome;
		try { await progress(entered.promise); await db.deleteTransaction('source', soft); }
		finally { release.resolve(); outcome = await running; }
		assert.match(outcome.error?.message || '', /明細が変更/); if (soft) assert.equal((await db.getTransaction('source')).is_deleted, true); else assert.equal(await db.getTransaction('source'), null); assert.equal(requests.some(request => request.action === 'retroactive_update'), false);
	});
	it('keeps a previous accounting month in the signed retroactive request and removes the old archived position', async () => {
		const { db, sync, requests } = await fixture();
		const old = transaction('move', { date: '2026-09-01', target_month: '2026-09', sync_status: 'synced' }); gas.saveJsonFile('archives/2026-09.json', { transactions: [old] });
		const snapshot = { ...await db.getSnapshot(), last_closed_month: '2026-09', monthly_summaries: {} }; gas.saveJsonFile('summary_snapshot.json', snapshot); await db.saveSnapshot(snapshot); await db.putTransaction(old);
		await sync.sendRetroactiveUpdate({ ...old, target_month: '2026-10', previous_target_month: '2026-09', reclose_approved_months: ['2026-09'], updated_at: '2026-10-29T00:00:00Z' });
		const request = requests.find(request => request.action === 'retroactive_update'); assert.equal(request.payload.previous_target_month, '2026-09'); assert.equal(gas.loadJsonFile('archives/2026-09.json').transactions.length, 0); assert.equal(gas.handleAction('fetch_state', {}).pending_diffs.filter(row => row.id === 'move').length, 1); assert.equal((await db.getTransaction('move')).target_month, '2026-10');
	});
	it('records and contains an automatic master-sync network failure', async t => {
		const { sync } = await fixture(); const warnings = []; t.mock.method(console, 'warn', (...args) => warnings.push(args.join(' '))); sync.fetch = async () => { throw new Error('network unavailable'); };
		await sync.queueMasterSync(); assert.equal(sync.lastResult.status, 'failed'); assert.equal(sync.lastError, 'network unavailable'); assert.equal(sync.isSyncing, false); assert.match(warnings.join('\n'), /Master sync deferred.*network unavailable/);
	});
	for (const transport of ['abort', 'failure-without-error']) it(`reports ${transport} without claiming any business commit`, async () => {
		const { db, sync } = await fixture(), before = await db.captureImportState();
		sync.fetch = transport === 'abort' ? async () => { throw new DOMException('request aborted', 'AbortError'); } : async () => ({ ok: true, text: async () => JSON.stringify({ success: false }) });
		await assert.rejects(sync.syncMaster(), transport === 'abort' ? /タイムアウト.*処理済み/ : /Server returned failure response/); assert.deepEqual(await db.captureImportState(), before); assert.equal(sync.lastResult.status, 'failed'); assert.equal(sync.lastResult.partial, false); assert.deepEqual(sync.lastResult.changes, { sent: {}, received: {} }); assert.equal(sync.isSyncing, false);
	});
	it('reports an unconfigured new manager before it attempts database or network access', async () => {
		const sync = new SyncManager(); assert.equal(sync.isSyncing, false); assert.equal(sync.lastResult, null); await assert.rejects(sync.sendRequest('fetch_state', {}), /URL is not configured/);
	});
	it('rejects the old owner when validation finishes after a real same-key epoch change', { timeout: 15000 }, async () => {
		const { db, sync, requests } = await fixture(), validate = db.validateRemoteState.bind(db), entered = deferred(), release = deferred(); let running;
		db.validateRemoteState = async (...args) => { const result = await validate(...args); entered.resolve(); await release.promise; return result; };
		const before = await db.captureImportState();
		try { running = sync.syncMaster().then(value => ({ value }), error => ({ error })); await progress(entered.promise); db.setEncryptionKey(db.encryptionKey); }
		finally { release.resolve(); }
		const outcome = await running; assert.match(outcome.error?.message || '', /認証がロックまたは変更/); assert.deepEqual(await db.captureImportState(), before); assert.equal(requests.length, 1); assert.equal(sync.isSyncing, false);
	});
	for (const action of ['syncMaster', 'syncBidirectional', 'fetchRemoteState', 'pushPending', 'closeMonth', 'sendRetroactiveUpdate']) it(`passes explicit normalized snapshot options through the real signed ${action} service entry`, async () => {
		const { db, sync, requests } = await fixture(), guard = sync.sessionGuard, observations = [], originalAccounts = (await db.getMasterConfig()).accounts;
		sync.sessionGuard = function (...args) { observations.push(args); return guard.apply(this, args); };
		let original;
		if (action === 'pushPending') await db.putTransaction(transaction('explicit-push67'));
		if (action === 'sendRetroactiveUpdate') {
			original = transaction('explicit-retro67', { date: '2026-09-01', target_month: '2026-09', sync_status: 'synced' }); await db.putTransaction(original); gas.saveJsonFile('archives/2026-09.json', { transactions: [original] }); const snapshot = { ...await db.getSnapshot(), last_closed_month: '2026-09', monthly_summaries: {} }; await db.saveSnapshot(snapshot); gas.saveJsonFile('summary_snapshot.json', snapshot);
		}
		await db.setSetting('explicit-options-device67', 'keep'); const keys = await db.getAllRaw('security_keys'), settings = await db.getAllRaw('settings');
		try {
			if (action === 'closeMonth') { await sync.closeMonth('2026-10'); assert.equal((await db.getSnapshot()).last_closed_month, '2026-10'); }
			else if (action === 'sendRetroactiveUpdate') { await sync.sendRetroactiveUpdate({ ...original, memo: 'explicit options retro67', reclose_approved_months: ['2026-09'], updated_at: '2026-10-29T00:00:00Z' }); assert.equal((await db.getTransaction(original.id)).memo, 'explicit options retro67'); assert.equal((await db.getTransaction(original.id)).amount, original.amount); }
			else { await sync[action](); if (action === 'pushPending') { assert.equal((await db.getTransaction('explicit-push67')).sync_status, 'synced'); assert.equal(gas.handleAction('fetch_state', {}).pending_diffs.find(row => row.id === 'explicit-push67').amount, 100); } }
			assert.ok(requests.length > 0); assert.ok(observations.length > 0); for (const args of observations) { assert.equal(args.length, 1); assert.ok(args[0] && typeof args[0] === 'object'); assert.equal(Object.hasOwn(args[0], 'parent'), true); assert.ok(args[0].parent === null || typeof args[0].parent === 'function'); }
			assert.equal(sync.isSyncing, false); assert.deepEqual((await db.getMasterConfig()).accounts, originalAccounts); assert.deepEqual(await db.getAllRaw('security_keys'), keys); assert.deepEqual(await db.getAllRaw('settings'), ['syncBidirectional', 'fetchRemoteState'].includes(action) ? [...settings, []] : settings); assert.equal(await db.getSetting('explicit-options-device67'), 'keep');
		} finally { sync.sessionGuard = guard; }
	});
	it('retains the required-private default on a real shared-master entry and refuses before storage or transport', async () => {
		const { db, sync, requests } = await fixture(), config = await db.getMasterConfig(), before = await db.captureImportState(), read = db.getMasterConfig, guard = sync.sessionGuard, observations = []; let reads = 0;
		sync.setPrivateKey(null); db.getMasterConfig = function (...args) { reads++; return read.apply(this, args); }; sync.sessionGuard = function (...args) { observations.push(args); return guard.apply(this, args); };
		try { await assert.rejects(sync.syncSharedMaster(config), /認証がロックまたは変更/); } finally { db.getMasterConfig = read; sync.sessionGuard = guard; }
		assert.equal(reads, 0); assert.equal(requests.length, 0); assert.equal(observations.length, 1); assert.equal(Object.hasOwn(observations[0][0], 'parent'), true); assert.equal(observations[0][0].parent, null); assert.equal(Object.hasOwn(observations[0][0], 'requirePrivateKey'), false); assert.deepEqual(await db.captureImportState(), before);
	});

});
