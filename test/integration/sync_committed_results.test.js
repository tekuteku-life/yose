import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, verifySignedRequest } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

async function setup(entry, failAfterCommit) {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: null });
	await db.putTransaction(transaction('base-row', { sync_status: entry === 'syncPendingDiffs' ? 'unsynced' : 'synced' }));
	const master = await db.getMasterConfig(); await db.commitMasterSync(master, sharedMasterConfig(master));
	const snapshot = await db.getSnapshot(), keys = await generateEd25519KeyPair(); let fetches = 0, armed = false;
	const newer = transaction('base-row', { amount: 900, updated_at: '2026-10-30T00:00:00Z' });
	const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://committed-result.fixture', customFetch: async (_url, options) => {
		const request = JSON.parse(options.body); assert.equal((await verifySignedRequest(request, keys.publicKey)).valid, true);
		let response = { success: true, master_config: sharedMasterConfig(master) };
		if (request.action === 'fetch_state') {
			fetches++;
			response = { ...response, snapshot, archived_transactions: [], archive_months: [], pending_diffs: entry === 'fetchRemoteState' || fetches === 2 ? [transaction('new-remote')] : [] };
		}
		if (request.action === 'push_diff') response = { success: true, accepted_ids: [], conflicts: [newer] };
		if (request.action === 'retroactive_update') response = { success: true, conflict: true, transaction: newer };
		if (request.action === 'close_month') response = { success: true, snapshot: { ...snapshot, last_closed_month: '2026-10', account_balances: { ...snapshot.account_balances, acc_wallet: snapshot.account_balances.acc_wallet - 100 }, monthly_summaries: { '2026-10': { income_total: 0, expense_total: 100, net_income: -100 } } } };
		return { ok: true, text: async () => JSON.stringify(response) };
	} });
	const arm = () => { if (failAfterCommit && !armed) { armed = true; db.getUnsyncedTransactions = async () => { throw new Error('pending read failed after confirmed commit'); }; } };
	const masterCommit = db.commitMasterSync.bind(db);
	db.commitMasterSync = async (...args) => {
		const result = await masterCommit(...args);
		if ((args[2]?.remoteState?.pending_diffs || []).some(row => row.id === 'new-remote')) { assert.equal((await db.getTransaction('new-remote')).amount, 100); arm(); }
		return result;
	};
	const responseCommit = db.commitSyncResponse.bind(db);
	db.commitSyncResponse = async (...args) => {
		const result = await responseCommit(...args), response = args[1];
		if (response.conflicts?.length || response.transaction || response.snapshot?.last_closed_month === '2026-10') arm();
		return result;
	};
	return { db, sync, isArmed: () => armed };
}

describe('confirmed synchronization results survive later bookkeeping read failures', () => {
	for (const entry of ['fetchRemoteState', 'syncBidirectional', 'sendRetroactiveUpdate', 'syncPendingDiffs', 'closeMonth']) {
		it(`keeps committed receive work in ${entry} lastResult when its next pending read fails`, async () => {
			const { db, sync, isArmed } = await setup(entry, true), args = entry === 'closeMonth' ? ['2026-10'] : entry === 'sendRetroactiveUpdate' ? [await db.getTransaction('base-row')] : [];
			await assert.rejects(sync[entry](...args), /pending read failed after confirmed commit/); assert.equal(isArmed(), true);
			const snapshotOnly = entry === 'closeMonth';
			if (snapshotOnly) assert.equal((await db.getSnapshot()).last_closed_month, '2026-10');
			else { const received = await db.getTransaction(['fetchRemoteState', 'syncBidirectional'].includes(entry) ? 'new-remote' : 'base-row'); assert.equal(received.amount, ['fetchRemoteState', 'syncBidirectional'].includes(entry) ? 100 : 900); assert.equal(received.sync_status, 'synced'); }
			assert.equal(sync.lastResult.status, 'failed'); assert.equal(sync.lastResult.downloaded_count, snapshotOnly ? 0 : 1, 'confirmed receive count must not wait for a later pending read');
			assert.deepEqual(sync.lastResult.changes.received, snapshotOnly ? { summary_snapshot: 1 } : {});
			assert.equal(sync.lastResult.partial, true, 'a later read failure must preserve the already committed partial result'); assert.equal(sync.isSyncing, false);
		});
		it(`counts the same confirmed work only once when ${entry} finalization succeeds`, async () => {
			const { db, sync } = await setup(entry, false), args = entry === 'closeMonth' ? ['2026-10'] : entry === 'sendRetroactiveUpdate' ? [await db.getTransaction('base-row')] : [];
			await sync[entry](...args); assert.equal(sync.lastResult.status, 'synced'); assert.equal(sync.lastResult.downloaded_count, entry === 'closeMonth' ? 0 : 1); assert.equal(sync.lastResult.partial, false);
		});
	}
});
