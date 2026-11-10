import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SyncManager } from '../../js/sync.js';
import { YoseDB } from '../../js/db.js';
import { generateEd25519KeyPair, verifySignedRequest, getSubtle } from '../../js/crypto.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { runBackgroundSync } from '../../js/background_sync_worker.js';
import { transaction } from '../helpers/ui_fixture.js';

async function fixture({ fetchError = null, gate = null } = {}) {
	const db = new YoseDB(); await db.init();
	const { privateKey, publicKey } = await generateEd25519KeyPair();
	db.setEncryptionKey(await getSubtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
	await db.saveMasterConfig(await db.getMasterConfig());
	await db.putTransaction(transaction('background-local'));
	const remote = { master_config: sharedMasterConfig(await db.getMasterConfig()), snapshot: await db.getSnapshot(), pending_diffs: [], archived_transactions: [], archive_months: [] };
	const actions = [];
	const fetch = async (_url, options) => {
		const request = JSON.parse(options.body);
		assert.equal((await verifySignedRequest(request, publicKey)).valid, true);
		actions.push(request.action);
		if (gate && actions.length === 1) await gate;
		if (request.action === fetchError) throw new Error('background network failure');
		if (request.action === 'update_master') remote.master_config = request.payload.master_config;
		if (request.action === 'push_diff') remote.pending_diffs = request.payload.transactions.map(tx => ({ ...tx, sync_status: 'synced' }));
		return { ok: true, text: async () => JSON.stringify({ success: true, ...remote, accepted_ids: request.payload.transactions?.map(tx => tx.id) || [] }) };
	};
	let output;
	const backgroundSync = async (job, options) => { output = await runBackgroundSync(structuredClone(job), { ...options, fetch }); return output; };
	const manager = new SyncManager({ db, privateKey, gasUrl: 'https://gas.test/exec', backgroundSync });
	manager.fetch = fetch;
	return { db, manager, actions, remote, output: () => output };
}

describe('Background synchronization commits the original encrypted snapshot atomically', () => {
	it('runs the signed receive / push / receive flow and returns only encrypted business records', async () => {
		const f = await fixture();
		const result = await f.manager.syncBidirectional();
		assert.equal(result.status, 'synced'); assert.equal(result.synced_count, 1);
		assert.deepEqual(f.actions, ['fetch_state', 'fetch_master', 'push_diff', 'fetch_state']);
		assert.equal((await f.db.getTransaction('background-local')).sync_status, 'synced');
		const state = f.output().state;
		assert.ok(state.transactions.every(record => record.encrypted && !Object.hasOwn(record, 'amount')));
		assert.equal(state.master.encrypted, true); assert.equal(state.snapshot.encrypted, true); assert.equal(state.base.encrypted, true);
		assert.equal(JSON.stringify(f.output()).includes('privateKey'), false);
	});
	it('does not overwrite edits made while the worker is running, even when the server accepted the old version', async () => {
		let release; const gate = new Promise(resolve => { release = resolve; });
		const f = await fixture({ gate });
		const work = f.manager.syncBidirectional();
		while (!f.actions.length) await new Promise(resolve => setImmediate(resolve));
		await f.db.putTransaction({ ...await f.db.getTransaction('background-local'), amount: 333 });
		const expected = await f.db.captureImportState(); release();
		await assert.rejects(work, /変更/);
		assert.deepEqual(await f.db.captureImportState(), expected);
		assert.equal((await f.db.getTransaction('background-local')).sync_status, 'unsynced');
		assert.ok(f.actions.includes('push_diff'));
	});
	it('rejects a concurrent synchronization and cancels a detached manager before applying the result', async () => {
		let release; const gate = new Promise(resolve => { release = resolve; });
		const f = await fixture({ gate }), expected = await f.db.captureImportState();
		const work = f.manager.syncBidirectional(), rejected = assert.rejects(work, /取消|ロック|認証/);
		while (!f.actions.length) await new Promise(resolve => setImmediate(resolve));
		assert.equal((await f.manager.syncBidirectional()).status, 'already_syncing');
		f.manager.detachEventListeners(); release(); await rejected;
		assert.deepEqual(await f.db.captureImportState(), expected); assert.equal(f.manager.isSyncing, false);
	});
	it('rejects results after locking and does not alter any raw business store', async () => {
		let release; const gate = new Promise(resolve => { release = resolve; });
		const f = await fixture({ gate }); const before = await f.db.captureImportState();
		const work = f.manager.syncBidirectional();
		const rejected = assert.rejects(work, /ロック|認証|取消/);
		while (!f.actions.length) await new Promise(resolve => setImmediate(resolve));
		f.manager.setPrivateKey(null); f.db.clearEncryptionKey(); release();
		await rejected;
		assert.deepEqual(await f.db.captureImportState(), before);
		assert.deepEqual(f.actions, ['fetch_state']);
	});
	it('retains partial successful downloads and preserves pending uploads on network failure', async () => {
		const f = await fixture({ fetchError: 'push_diff' });
		f.remote.pending_diffs = [transaction('background-remote', { sync_status: 'synced' })];
		await assert.rejects(f.manager.syncBidirectional(), /background network failure/);
		assert.equal((await f.db.getTransaction('background-remote')).sync_status, 'synced');
		assert.equal((await f.db.getTransaction('background-local')).sync_status, 'unsynced');
		assert.equal(f.manager.lastResult.status, 'failed'); assert.equal(f.manager.lastResult.partial, true);
		assert.equal(f.manager.isSyncing, false);
	});
	it('falls back before dispatch only when the worker is unavailable', async () => {
		const f = await fixture(); let delegated = 0;
		f.manager.backgroundSync = async () => { delegated++; return null; };
		f.manager.fetch = async (_url, options) => {
			const request = JSON.parse(options.body);
			return { ok: true, text: async () => JSON.stringify({ success: true, ...f.remote, accepted_ids: request.payload.transactions?.map(tx => tx.id) || [] }) };
		};
		assert.equal((await f.manager.syncBidirectional()).status, 'synced'); assert.equal(delegated, 1);
	});
	it('keeps synchronization ownership across fallback while an automatic master sync is queued', async () => {
		const f = await fixture();
		f.manager.backgroundSync = async () => { await f.manager.queueMasterSync(); return null; };
		const result = await f.manager.syncBidirectional();
		while (f.manager.isSyncing) await new Promise(resolve => setImmediate(resolve));
		assert.equal(result.status, 'synced');
		assert.equal((await f.db.getTransaction('background-local')).sync_status, 'synced');
		assert.equal(f.actions[0], 'fetch_state');
	});
	it('does not clear a newer worker cancellation handle when an older foreground fallback finishes', async () => {
		const f = await fixture(); let calls = 0, release, started, next, signal;
		const gate = new Promise(resolve => { release = resolve; }), dispatched = new Promise(resolve => { started = resolve; });
		f.manager.backgroundSync = async (job, options) => {
			if (++calls === 1) return null;
			signal = options.signal; started(); await gate;
			return runBackgroundSync(structuredClone(job), options);
		};
		let triggered = false;
		const unsubscribe = f.manager.onStateChange(() => {
			if (!f.manager.isSyncing && !triggered) { triggered = true; next = f.manager.syncBidirectional(); next.catch(() => {}); }
		});
		assert.equal((await f.manager.syncBidirectional()).status, 'synced');
		await dispatched; unsubscribe(); f.manager.detachEventListeners();
		assert.equal(signal.aborted, true); release();
		await assert.rejects(next, /取消|ロック|認証/);
	});
	it('does not retry a dispatched job after an unknown outcome', async () => {
		const f = await fixture(); let dispatched = 0;
		f.manager.backgroundSync = async () => { dispatched++; throw new Error('Worker response missing'); };
		f.manager.fetch = async () => { throw new Error('must not fall back after dispatch'); };
		await assert.rejects(f.manager.syncBidirectional(), /Worker response missing/);
		assert.equal(dispatched, 1); assert.equal(f.manager.isSyncing, false);
		assert.equal((await f.db.getTransaction('background-local')).sync_status, 'unsynced');
	});
	it('never approves re-closing in the worker and retains the first download count when confirmation is cancelled', async () => {
		const f = await fixture(); f.remote.snapshot.last_closed_month = '2026-10';
		f.remote.pending_diffs = [transaction('received-before-confirmation', { target_month: '2026-11', date: '2026-11-01', sync_status: 'synced' })];
		let confirmations = 0;
		const result = await f.manager.syncBidirectional({ approveReclose: async () => { confirmations++; return false; } });
		assert.equal(confirmations, 1); assert.equal(result.status, 'approval_required');
		assert.equal(result.downloaded_count, 1);
		assert.equal(f.actions.includes('push_diff'), false);
		assert.equal((await f.db.getTransaction('background-local')).sync_status, 'unsynced');
	});
	it('resolves master conflicts with the existing callback', async () => {
		const f = await fixture(), config = await f.db.getMasterConfig();
		await f.db.putRaw('master_config', await f.db.encryptRecord(sharedMasterConfig(config)), 'sync_base');
		config.categories[0].name = 'Local category'; await f.db.saveMasterConfig(config);
		f.remote.master_config.categories[0].name = 'Remote category';
		let confirmations = 0;
		const result = await f.manager.syncBidirectional({ approveMasterConflict: async () => { confirmations++; return true; } });
		assert.equal(result.status, 'synced'); assert.equal(confirmations, 1);
		assert.equal((await f.db.getMasterConfig()).categories[0].name, 'Local category');
	});
	it('refreshes master consumers after worker commits, isolating listener failures', async () => {
		const f = await fixture(), warn = console.warn; let refreshed = 0, warnings = 0;
		f.remote.master_config.categories[0].name = 'Received category';
		f.manager.onMasterChange(() => { refreshed++; });
		f.manager.onMasterChange(() => { throw new Error('consumer refresh failed'); });
		console.warn = () => { warnings++; };
		try {
			assert.equal((await f.manager.syncBidirectional()).status, 'synced');
			await new Promise(resolve => setImmediate(resolve));
			assert.equal(refreshed, 1); assert.equal(warnings, 1);
		} finally { console.warn = warn; }
	});
	it('does not notify later master consumers after an earlier notification locks the session', async () => {
		const f = await fixture(); let stale = 0;
		f.remote.master_config.categories[0].name = 'Received category';
		f.manager.onMasterChange(() => { f.manager.setPrivateKey(null); });
		f.manager.onMasterChange(() => { stale++; });
		await f.manager.syncBidirectional(); await new Promise(resolve => setImmediate(resolve));
		assert.equal(stale, 0);
	});
	it('waits for the foreground before asking for confirmation and removes listeners on cancellation', async () => {
		const f = await fixture(), previous = globalThis.document;
		const document = new EventTarget(); document.visibilityState = 'hidden'; globalThis.document = document;
		try {
			const abort = new AbortController(); let completed = false;
			const work = f.manager.waitForForeground(abort.signal).then(() => { completed = true; });
			document.dispatchEvent(new Event('visibilitychange')); await new Promise(resolve => setImmediate(resolve)); assert.equal(completed, false);
			document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange')); await work; assert.equal(completed, true);
			await f.manager.waitForForeground(abort.signal);
			document.visibilityState = 'hidden'; const cancelled = f.manager.waitForForeground(abort.signal); abort.abort();
			await assert.rejects(cancelled, /取消|ロック/); await assert.rejects(f.manager.waitForForeground(abort.signal), /取消|ロック/);
			document.dispatchEvent(new Event('visibilitychange'));
		} finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
	});
	for (const kind of ['master', 'reclose']) for (const action of ['resume', 'lock']) {
		it(`holds the real ${kind} confirmation until foreground ${action}, without confirming or sending early`, { timeout: 10000 }, async () => {
			const f = await fixture(), previous = globalThis.document;
			const document = new EventTarget(); document.visibilityState = 'hidden'; globalThis.document = document;
			try {
				if (kind === 'master') {
					const master = await f.db.getMasterConfig();
					await f.db.putRaw('master_config', await f.db.encryptRecord(sharedMasterConfig(master)), 'sync_base');
					master.categories[0].name = 'Local choice'; await f.db.saveMasterConfig(master);
					f.remote.master_config.categories[0].name = 'Remote choice';
				} else f.remote.snapshot.last_closed_month = '2026-10';
				let confirmations = 0, entered;
				const waiting = new Promise(resolve => { entered = resolve; });
				const waitForForeground = f.manager.waitForForeground.bind(f.manager);
				f.manager.waitForForeground = signal => { entered(); return waitForForeground(signal); };
				const options = { [kind === 'master' ? 'approveMasterConflict' : 'approveReclose']: async () => { confirmations++; return false; } };
				const work = f.manager.syncBidirectional(options); work.catch(() => {});
				// Removing syncBidirectional's wait call resolves work first and fails the assertions below.
				await Promise.race([waiting, work]);
				assert.equal(f.output().result.status, kind === 'master' ? 'master_conflict' : 'approval_required');
				assert.equal(confirmations, 0); assert.equal(f.manager.isSyncing, true);
				assert.deepEqual(f.actions, ['fetch_state']);
				if (action === 'resume') {
					document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
					const result = await work;
					assert.equal(confirmations, 1);
					assert.equal(result.status, kind === 'master' ? 'master_conflict_cancelled' : 'approval_required');
					assert.deepEqual(f.actions, ['fetch_state', 'fetch_state']);
				} else {
					const before = await f.db.captureImportState(); f.manager.setPrivateKey(null); f.db.clearEncryptionKey();
					await assert.rejects(work, /取消|ロック|認証/);
					document.visibilityState = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
					await new Promise(resolve => setImmediate(resolve));
					assert.equal(confirmations, 0); assert.deepEqual(f.actions, ['fetch_state']);
					assert.deepEqual(await f.db.captureImportState(), before);
				}
			} finally { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; }
		});
	}
});
