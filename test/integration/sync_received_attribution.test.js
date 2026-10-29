import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, verifySignedRequest, canonicalJsonStringify } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise, message) {
	const expired = Symbol('expired'); let timer;
	try { const value = await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(expired), 3000); })]); assert.notEqual(value, expired, message); return value; }
	finally { clearTimeout(timer); }
}

describe('downloaded transaction counts belong to the actual database commit', () => {
	for (const entry of ['downloadTransactions', 'syncBidirectional', 'fetchRemoteState']) it(`does not attribute a concurrent preserved local edit to ${entry} receive counts`, { timeout: 15000 }, async () => {
		const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: null });
		await db.putTransactions([transaction('same-record', { sync_status: 'synced' }), transaction('outside', { sync_status: 'synced' })]);
		const local = await db.getMasterConfig(); await db.commitMasterSync(local, sharedMasterConfig(local));
		const original = await db.getTransaction('same-record'), outside = await db.getRaw('transactions', 'outside');
		const remote = { master_config: sharedMasterConfig(local), snapshot: await db.getSnapshot(), pending_diffs: [structuredClone(original)], archived_transactions: [], archive_months: [] }, keys = await generateEd25519KeyPair();
		const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://attribution.fixture', customFetch: async (_url, options) => {
			const request = JSON.parse(options.body); assert.equal((await verifySignedRequest(request, keys.publicKey)).valid, true);
			if (request.action === 'update_master') remote.master_config = structuredClone(request.payload.master_config);
			if (request.action === 'push_diff') remote.pending_diffs = structuredClone(request.payload.transactions);
			return { ok: true, text: async () => JSON.stringify({ success: true, ...remote, state_version: canonicalJsonStringify(remote), ...(request.action === 'push_diff' ? { accepted_ids: request.payload.transactions.map(tx => tx.id) } : {}) }) };
		} });
		const commit = db.commitMasterSync.bind(db), entered = deferred(), release = deferred(); let held = false, outcome;
		db.commitMasterSync = async (...args) => { if (!held) { held = true; entered.resolve(); await release.promise; } return commit(...args); };
		const running = sync[entry]().then(value => ({ value }), error => ({ error }));
		try {
			await progress(entered.promise, 'remote validation must reach the commit boundary');
			await db.putTransaction({ ...original, amount: 777, memo: 'concurrent local version', sync_status: 'unsynced' }, { expectedTransactions: [original] });
		} finally { release.resolve(); outcome = await progress(running, 'download must finish after releasing its commit'); }
		assert.equal(outcome.error, undefined); const current = await db.getTransaction(original.id);
		assert.equal(current.amount, 777); assert.equal(current.memo, 'concurrent local version'); assert.deepEqual(await db.getRaw('transactions', 'outside'), outside);
		if (entry === 'downloadTransactions') assert.equal(outcome.value.count, 0, 'the remote commit preserved this local version, so no received transaction changed');
		else { assert.equal(sync.lastResult.downloaded_count, 0, 'a concurrent local save is not downloaded work'); if (entry === 'syncBidirectional') assert.equal(outcome.value.downloaded_count, 0); }
	});
});
