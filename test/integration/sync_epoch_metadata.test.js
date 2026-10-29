import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { canonicalJsonStringify, generateDatabaseMasterKey, generateEd25519KeyPair, verifySignedRequest } from '../../js/crypto.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise, message) {
	const expired = Symbol('expired'); let timer;
	try { const value = await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(expired), 3000); })]); assert.notEqual(value, expired, message); return value; }
	finally { clearTimeout(timer); }
}
async function setup() {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: null });
	await db.putTransaction(transaction('local'));
	const local = await db.getMasterConfig(); await db.commitMasterSync(local, sharedMasterConfig(local));
	return db;
}
async function raw(db) { return { business: await db.captureImportState(), settings: await db.getAllRaw('settings') }; }

describe('originating epoch survives nested synchronization and the first database read', () => {
	for (const entry of ['syncMaster', 'syncBidirectional', 'syncPendingDiffs', 'fetchRemoteState', 'closeMonth', 'sendRetroactiveUpdate']) it(`rejects ${entry} after a same-key generation change while its signed request is held`, { timeout: 15000 }, async () => {
		const db = await setup(), keys = await generateEd25519KeyPair(), entered = deferred(), release = deferred(), requests = [];
		const remote = { master_config: sharedMasterConfig(await db.getMasterConfig()), snapshot: await db.getSnapshot(), pending_diffs: [], archived_transactions: [], archive_months: [] };
		remote.master_config.accounts[0].name = 'must not commit from expired request'; let held = false;
		const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://epoch.fixture', customFetch: async (_url, options) => {
			const request = JSON.parse(options.body); assert.equal((await verifySignedRequest(request, keys.publicKey)).valid, true); requests.push(request);
			const response = { success: true, ...structuredClone(remote), state_version: canonicalJsonStringify(remote), accepted_ids: request.payload.transactions?.map(row => row.id) || [] };
			if (!held) { held = true; entered.resolve(); await release.promise; }
			return { ok: true, text: async () => JSON.stringify(response) };
		} });
		const args = entry === 'closeMonth' ? ['2026-10'] : entry === 'sendRetroactiveUpdate' ? [await db.getTransaction('local')] : [];
		const running = sync[entry](...args).then(value => ({ value }), error => ({ error })); let before, sent, outcome;
		try {
			await progress(entered.promise, 'the signed request must start before epoch invalidation'); before = await raw(db); sent = requests.length;
			const key = db.encryptionKey, generation = db.keyGeneration; db.setEncryptionKey(key); assert.equal(db.encryptionKey, key); assert.ok(db.keyGeneration > generation);
		} finally { release.resolve(); outcome = await progress(running, 'expired synchronization must settle after releasing the response'); }
		assert.ok(outcome.error, `${entry} must reject instead of recapturing the new epoch`);
		assert.match(outcome.error.message, /認証|鍵|世代|ロック|状態/); assert.deepEqual(await raw(db), before); assert.equal(requests.length, sent, 'expired operation must not send a later stage');
		assert.equal(sync.isSyncing, false); assert.notEqual(sync.lastResult?.status, 'synced');
	});
	for (const entry of ['putTransaction', 'commitMasterSync']) it(`keeps ${entry} bound to the epoch before its first raw capture resolves`, { timeout: 15000 }, async () => {
		const db = await setup(), entered = deferred(), release = deferred(), capture = db.captureImportState.bind(db), before = await raw(db); let held = false, outcome;
		db.captureImportState = async () => { const state = await capture(); if (!held) { held = true; entered.resolve(); await release.promise; } return state; };
		const config = await db.getMasterConfig(), accepted = structuredClone(config); accepted.accounts[0].name = 'blocked write';
		const running = (entry === 'putTransaction' ? db.putTransaction(transaction('blocked-create')) : db.commitMasterSync(config, accepted)).then(value => ({ value }), error => ({ error }));
		try { await progress(entered.promise, 'the first raw capture must be pending'); db.setEncryptionKey(db.encryptionKey); }
		finally { release.resolve(); outcome = await progress(running, 'expired database operation must finish during cleanup'); }
		assert.ok(outcome.error, 'database write must not adopt the epoch used by later decrypts'); assert.deepEqual(await raw(db), before);
	});
});

describe('archive metadata shares the business commit boundary', () => {
	for (const fault of ['metadata-write', 'metadata-success-invalidation']) it(`rolls back every business/base/settings value during ${fault}`, async () => {
		const db = await setup(), local = await db.getMasterConfig(), accepted = structuredClone(sharedMasterConfig(local)); accepted.accounts[0].name = 'remote name';
		await db.setSetting('downloaded_archive_months', ['2026-08']); await db.setSetting('local-preference', 'keep this device value');
		const before = await raw(db), transactionFn = db.db.transaction.bind(db.db); let valid = true, entered = false;
		db.db.transaction = (...args) => {
			const tx = transactionFn(...args), objectStore = tx.objectStore.bind(tx);
			tx.objectStore = name => {
				const store = objectStore(name), put = store.put.bind(store);
				if (name === 'settings') store.put = (value, key) => {
					if (key !== 'downloaded_archive_months') return put(value, key);
					entered = true; if (fault === 'metadata-write') throw new Error('archive metadata write fault');
					const request = put(value, key); let success;
					Object.defineProperty(request, 'onsuccess', { get: () => event => { valid = false; success?.(event); }, set: handler => { success = handler; } }); return request;
				};
				return store;
			}; return tx;
		};
		await assert.rejects(db.commitMasterSync(local, accepted, { remoteState: { master_config: accepted, pending_diffs: [transaction('remote-new')], archived_transactions: [], snapshot: await db.getSnapshot(), archive_months: ['2026-09'] }, isSessionValid: () => valid }));
		assert.equal(entered, true); assert.deepEqual(await raw(db), before); assert.equal(await db.getTransaction('remote-new'), null);
	});
	it('updates only the archive metadata key alongside a successful business and base commit', async () => {
		const db = await setup(), local = await db.getMasterConfig(), accepted = structuredClone(sharedMasterConfig(local)); accepted.accounts[0].name = 'committed remote name';
		await db.setSetting('local-preference', { private: 'keep' });
		const result = await db.commitMasterSync(local, accepted, { remoteState: { master_config: accepted, pending_diffs: [], archived_transactions: [], snapshot: await db.getSnapshot(), archive_months: ['2026-09'] }, includeChanges: true });
		assert.equal(result.changes.accounts, 1); assert.equal((await db.getMasterConfig()).accounts[0].name, 'committed remote name'); assert.deepEqual(await db.getMasterSyncBase(), accepted);
		assert.deepEqual(await db.getSetting('downloaded_archive_months'), ['2026-09']); assert.deepEqual(await db.getSetting('local-preference'), { private: 'keep' });
	});
});
