import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { SyncManager } from '../../js/sync.js';
import { YoseDB } from '../../js/db.js';
import { transaction } from '../helpers/ui_fixture.js';
import { generateEd25519KeyPair } from '../../js/crypto.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';

async function masterResponse(db, request) {
	if (request.action === 'fetch_master') return { ok: true, text: async () => JSON.stringify({ success: true, master_config: sharedMasterConfig(await db.getMasterConfig()) }) };
	if (request.action === 'update_master') return { ok: true, text: async () => JSON.stringify({ success: true, master_config: request.payload.master_config }) };
	return null;
}

describe('js/sync.js - Unit Tests', () => {
	let db;
	let keyPair;

	beforeEach(async () => {
		db = new YoseDB(null);
		await db.init();
		keyPair = await generateEd25519KeyPair();
	});

	describe('Validation & Error Handling', () => {
		it('throws error if gasUrl is not configured', async () => {
			const sync = new SyncManager({ db, privateKey: keyPair.privateKey, gasUrl: '' });
			await assert.rejects(
				async () => sync.sendRequest('push_diff', {}),
				/GAS Web App URL is not configured/
			);
		});

		it('throws error if privateKey is missing', async () => {
			const sync = new SyncManager({ db, privateKey: null, gasUrl: 'http://gas.test' });
			await assert.rejects(
				async () => sync.sendRequest('push_diff', {}),
				/Ed25519 Private Key is not loaded/
			);
		});

		it('throws error on non-ok HTTP status', async () => {
			const mockFetch = async () => ({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error'
			});

			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			await assert.rejects(
				async () => sync.sendRequest('push_diff', {}),
				/HTTP error 500/
			);
		});

		it('throws error if server returns success: false', async () => {
			const mockFetch = async () => ({
				ok: true,
				text: async () => JSON.stringify({ success: false, error: 'Signature invalid' })
			});

			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			await assert.rejects(
				async () => sync.sendRequest('push_diff', {}),
				/Signature invalid/
			);
		});

		it('throws error on invalid non-JSON response', async () => {
			const mockFetch = async () => ({
				ok: true,
				text: async () => '<html>Error 404 Not Found</html>'
			});

			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			await assert.rejects(
				async () => sync.sendRequest('push_diff', {}),
				/Invalid JSON response/
			);
		});
	});

	describe('CORS and Request Formatting', () => {
		it('uses Content-Type: text/plain;charset=utf-8 to bypass CORS preflight', async () => {
			let capturedHeaders = null;
			let capturedBody = null;
			let capturedKeepalive = null;

			const mockFetch = async (url, options) => {
				capturedHeaders = options.headers;
				capturedBody = JSON.parse(options.body);
				capturedKeepalive = options.keepalive;
				return {
					ok: true,
					text: async () => JSON.stringify({ success: true })
				};
			};

			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			await sync.sendRequest('push_diff', { test: 123 }, { keepalive: true });

			assert.equal(capturedHeaders['Content-Type'], 'text/plain;charset=utf-8');
			assert.equal(capturedKeepalive, true);
			assert.equal(capturedBody.action, 'push_diff');
			assert.ok(capturedBody.signature);
			assert.ok(capturedBody.timestamp);
		});
	});

	describe('syncPendingDiffs Workflow', () => {
		it('releases the sync lock after a pending-record read fails and after an empty retry', async () => {
			const sync = new SyncManager({ db });
			const getPending = db.getUnsyncedTransactions.bind(db);
			db.getUnsyncedTransactions = async () => { throw new Error('pending read failed'); };
			await assert.rejects(sync.syncPendingDiffs(), /pending read failed/);
			assert.equal(sync.isSyncing, false);
			assert.equal(sync.lastError, 'pending read failed');
			db.getUnsyncedTransactions = getPending;
			assert.equal((await sync.syncPendingDiffs()).status, 'up_to_date');
			assert.equal(sync.isSyncing, false);
			assert.equal(sync.lastError, null);
		});

		it('returns up_to_date if there are no unsynced transactions', async () => {
			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test'
			});

			const res = await sync.syncPendingDiffs();
			assert.equal(res.status, 'up_to_date');
			assert.equal(res.synced_count, 0);
		});

		it('pushes unsynced transactions, marks them synced, and saves snapshot', async () => {
			await db.putTransactions([
				transaction('tx_sync_1', { target_month: '2026-10', amount: 1500, is_deleted: false }),
				transaction('tx_sync_2', { target_month: '2026-10', amount: 2500, is_deleted: false })
			]);

			const mockSnapshot = {
				schema_version: 2,
				last_closed_month: '2026-09',
				account_balances: { acc_wallet: 15000 }
			};

			let sentPayload = null;
			const mockFetch = async (url, options) => {
				const body = JSON.parse(options.body);
				const master = await masterResponse(db, body); if (master) return master;
				sentPayload = body.payload;
				return {
					ok: true,
					text: async () => JSON.stringify({
						success: true,
						updated_count: 2,
						snapshot: mockSnapshot
					})
				};
			};

			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			const res = await sync.syncPendingDiffs();
			assert.equal(res.status, 'synced');
			assert.equal(res.synced_count, 2);
			assert.equal(sentPayload.transactions.length, 2);

			// Verify transactions are marked synced in DB
			const tx1 = await db.getTransaction('tx_sync_1');
			assert.equal(tx1.sync_status, 'synced');

			// Verify snapshot was updated in DB
			const savedSnapshot = await db.getSnapshot();
			assert.deepEqual(savedSnapshot, mockSnapshot);
		});
	});

	describe('closeMonth & retroactiveUpdate & fetchRemoteState', () => {
		it('closeMonth syncs pending first and closes month', async () => {
			const actions = [];
			const mockFetch = async (url, options) => {
				const body = JSON.parse(options.body);
				actions.push(body.action);
				const master = await masterResponse(db, body); if (master) return master;
				return {
					ok: true,
					text: async () => JSON.stringify({
						success: true,
						snapshot: { last_closed_month: '2026-10', account_balances: {} }
					})
				};
			};

			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			const res = await sync.closeMonth('2026-10');
			assert.equal(res.success, true);
			assert.ok(actions.includes('close_month'));

			const snap = await db.getSnapshot();
			assert.equal(snap.last_closed_month, '2026-10');
		});

		it('sendRetroactiveUpdate saves transaction and updates cascaded snapshot', async () => {
			const mockFetch = async (_url, options) => {
				const master = await masterResponse(db, JSON.parse(options.body)); if (master) return master;
				return { ok: true, text: async () => JSON.stringify({ success: true, snapshot: { last_closed_month: '2026-10', account_balances: { acc_wallet: 8000 } } }) };
			};

			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			const retroTx = {
				...transaction('tx_retro'),
				id: 'tx_retro',
				target_month: '2026-09',
				amount: 2000,
				is_deleted: false
			};

			const res = await sync.sendRetroactiveUpdate(retroTx);
			assert.equal(res.success, true);

			const savedTx = await db.getTransaction('tx_retro');
			assert.equal(savedTx.sync_status, 'synced');

			const savedSnap = await db.getSnapshot();
			assert.equal(savedSnap.account_balances.acc_wallet, 8000);
		});

		it('fetchRemoteState updates master config, snapshot and pending diffs', async () => {
			await db.mutateMasterConfig(config => { config.point_payment_defaults = null; });
			const mockFetch = async () => ({
				ok: true,
				text: async () => JSON.stringify({
					success: true,
					master_config: { schema_version: 2, accounts: [{ id: 'acc_remote', type: 'cash' }] },
					snapshot: { schema_version: 2, last_closed_month: '2026-09', account_balances: {} },
					pending_diffs: [transaction('tx_remote_1', { target_month: '2026-10', amount: 500, is_deleted: false , account_id: 'acc_remote', category_id: null, actual_category_id: null })]
				})
			});

			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			const res = await sync.fetchRemoteState();
			assert.equal(res.success, true);

			const cfg = await db.getMasterConfig();
			assert.equal(cfg.accounts[0].id, 'acc_remote');

			const tx = await db.getTransaction('tx_remote_1');
			assert.equal(tx.amount, 500);
			assert.equal(tx.sync_status, 'synced');
		});

		it('manages setters, event listeners, and concurrent sync protection', async () => {
			const sync = new SyncManager({ db });
			sync.setGasUrl('http://new.gas.url');
			assert.equal(sync.gasUrl, 'http://new.gas.url');
			sync.setPrivateKey(keyPair.privateKey);
			assert.equal(sync.privateKey, keyPair.privateKey);

			// Concurrent sync guard
			sync.isSyncing = true;
			const res = await sync.syncPendingDiffs();
			assert.equal(res.status, 'already_syncing');

			await assert.rejects(
				async () => sync.closeMonth('2026-10'),
				/Another sync operation is in progress/
			);
			sync.isSyncing = false;

			// Event listener attachment and detachment
			const listeners = new Map();
			globalThis.window = {
				addEventListener: (ev, fn) => listeners.set(`win_${ev}`, fn),
				removeEventListener: (ev) => listeners.delete(`win_${ev}`)
			};
			globalThis.document = {
				visibilityState: 'hidden',
				addEventListener: (ev, fn) => listeners.set(`doc_${ev}`, fn),
				removeEventListener: (ev) => listeners.delete(`doc_${ev}`)
			};

			sync.attachEventListeners();
			assert.ok(listeners.has('win_online'));
			assert.ok(listeners.has('doc_visibilitychange'));

			// Trigger online event callback
			listeners.get('win_online')();

			// Trigger visibilitychange event callback
			listeners.get('doc_visibilitychange')();

			// Trigger when visible (does not trigger keepalive)
			globalThis.document.visibilityState = 'visible';
			listeners.get('doc_visibilitychange')();

			sync.detachEventListeners();
			assert.equal(listeners.size, 0);

			// Test online and visibility callbacks when syncPendingDiffs rejects
			sync.fetch = async () => { throw new Error('Failed to connect'); };
			sync.attachEventListeners();
			// Add an unsynced transaction so syncPendingDiffs tries to sendRequest
			await db.putTransactions([{
				...transaction('tx_fail_ev'),
				id: 'tx_fail_ev',
				amount: 500,
				type: 'expense',
				date: '2026-10-15',
				target_month: '2026-10',
				sync_status: 'unsynced'
			}]);

			// Trigger online rejecting
			listeners.get('win_online')();

			// Trigger visibility rejecting
			listeners.get('doc_visibilitychange')();

			// Clean up event listeners
			sync.detachEventListeners();
			delete globalThis.window;
			delete globalThis.document;
		});

		it('tests sendAction alias and error paths for closeMonth, retroactiveUpdate, and missing fetch', async () => {
			const mockFetch = async () => ({
				ok: true,
				text: async () => JSON.stringify({ success: true })
			});
			const sync = new SyncManager({
				db,
				privateKey: keyPair.privateKey,
				gasUrl: 'http://gas.test',
				customFetch: mockFetch
			});

			const res = await sync.sendAction('fetch_state', {});
			assert.equal(res.success, true);

			// Missing fetch error
			sync.fetch = null;
			await assert.rejects(
				async () => sync.sendRequest('test', {}),
				/Fetch API is not available/
			);

			// closeMonth error path
			sync.fetch = async () => { throw new Error('Network timeout'); };
			await assert.rejects(
				async () => sync.closeMonth('2026-10'),
				/Network timeout/
			);
			assert.equal(sync.lastError, 'Network timeout');

			// retroactiveUpdate error path
			await assert.rejects(
				async () => sync.sendRetroactiveUpdate(transaction('tx_fail', { target_month: '2026-09' })),
				/Network timeout/
			);
			assert.equal(sync.lastError, 'Network timeout');

			// syncPendingDiffs error path (lines 148-149)
			await db.putTransactions([{
				...transaction('tx_throw'),
				id: 'tx_throw',
				amount: 1000,
				type: 'expense',
				date: '2026-10-15',
				target_month: '2026-10',
				sync_status: 'unsynced'
			}]);
			await assert.rejects(
				async () => sync.syncPendingDiffs(),
				/Network timeout/
			);

			// Concurrent sync protection tests
			sync.isSyncing = true;
			const alreadySync = await sync.syncPendingDiffs();
			assert.equal(alreadySync.status, 'already_syncing');

			await assert.rejects(
				async () => sync.closeMonth('2026-10'),
				/Another sync operation is in progress/
			);
			await assert.rejects(
				async () => sync.sendRetroactiveUpdate({ id: 't' }),
				/Another sync operation is in progress/
			);
			await assert.rejects(
				async () => sync.fetchRemoteState(),
				/Another sync operation is in progress/
			);
			sync.isSyncing = false;
		});
	});

});

