import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StorageEngine } from '../../js/db/storage_engine.js';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise, message) {
	const expired = Symbol('expired'); let timer;
	try { const value = await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(expired), 3000); })]); assert.notEqual(value, expired, message); return value; }
	finally { clearTimeout(timer); }
}
async function storage() {
	const db = new StorageEngine(); db.setEncryptionKey(await generateDatabaseMasterKey()); return db;
}
function countDecrypt(t) {
	const decrypt = crypto.subtle.decrypt.bind(crypto.subtle); let calls = 0;
	t.mock.method(crypto.subtle, 'decrypt', (...args) => { calls++; return decrypt(...args); });
	return () => calls;
}
function countWrites(db) {
	const stats = { put: [], delete: [], clear: 0 }, transaction = db.db.transaction.bind(db.db);
	db.db.transaction = (...args) => {
		const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
		tx.objectStore = name => {
			const store = objectStore(name);
			if (name === 'transactions') for (const action of ['put', 'delete', 'clear']) {
				const original = store[action].bind(store);
				store[action] = (...values) => { if (action === 'clear') stats.clear++; else stats[action].push(action === 'put' ? values[0].id : values[0]); return original(...values); };
			}
			return store;
		};
		return tx;
	};
	return stats;
}

describe('session bound decrypted values', () => {
	it('reuses authenticated ciphertext while cloning every cached result', async t => {
		const db = await storage(), raw = await db.encryptRecord({ id: 'a', nested: { tags: ['original'] } }), calls = countDecrypt(t);
		const first = await db.decryptRecord(raw); first.nested.tags.push('caller mutation');
		const second = await db.decryptRecord({ ...raw, date: '2099-01-01' });
		assert.deepEqual(second, { id: 'a', nested: { tags: ['original'] } }); assert.equal(calls(), 1);
	});
	it('clones plaintext legacy records without sharing nested caller mutations', async () => {
		const db = await storage(), plain = { id: 'plain', nested: { value: 1 } }, decoded = await db.decryptRecord(plain);
		decoded.nested.value = 2; assert.equal(plain.nested.value, 1); assert.deepEqual(await db.decryptRecord(plain), { id: 'plain', nested: { value: 1 } });
	});
	it('shares one in-flight decrypt and returns independent objects to concurrent callers', async t => {
		const db = await storage(), raw = await db.encryptRecord({ id: 'same', tags: [] }), calls = countDecrypt(t);
		const values = await Promise.all(Array.from({ length: 12 }, () => db.decryptRecord(structuredClone(raw))));
		assert.equal(calls(), 1); values[0].tags.push('edited'); assert.deepEqual(values[1].tags, []);
	});
	it('uses ciphertext and IV rather than outer identity or timestamps and never caches authentication failures', async t => {
		const db = await storage(), first = await db.encryptRecord({ id: 'same', amount: 1 }), second = await db.encryptRecord({ id: 'same', amount: 2 }), calls = countDecrypt(t);
		assert.equal((await db.decryptRecord(first)).amount, 1); assert.equal((await db.decryptRecord(second)).amount, 2); assert.equal(calls(), 2);
		for (const corrupted of [{ ...second, iv: first.iv }, { ...second, ciphertext: first.ciphertext }]) {
			await assert.rejects(db.decryptRecord(corrupted), /decryption|認証|corrupt/i);
			await assert.rejects(db.decryptRecord(corrupted), /decryption|認証|corrupt/i);
		}
		assert.equal(calls(), 6); assert.equal((await db.decryptRecord(second)).amount, 2); assert.equal(calls(), 6);
	});
	for (const action of ['clear', 'same-key-set', 'different-key-set']) it(`rejects a held old plaintext after ${action} and protects the new session cache`, { timeout: 15000 }, async t => {
		const db = await storage(), key = db.encryptionKey, raw = await db.encryptRecord({ id: 'private', memo: 'old plaintext' });
		const entered = deferred(), release = deferred(), decrypt = crypto.subtle.decrypt.bind(crypto.subtle); let calls = 0;
		t.mock.method(crypto.subtle, 'decrypt', async (...args) => { const call = ++calls; const value = await decrypt(...args); if (call === 1) { entered.resolve(); await release.promise; } return value; });
		const old = Promise.allSettled([db.decryptRecord(raw), db.decryptRecord(raw)]); let freshPromise;
		try {
			await progress(entered.promise, 'the original decrypt must reach its gate');
			if (action === 'clear') db.clearEncryptionKey();
			else db.setEncryptionKey(action === 'same-key-set' ? key : await generateDatabaseMasterKey());
			if (action !== 'different-key-set') db.setEncryptionKey(key);
			const freshRaw = action === 'different-key-set' ? await db.encryptRecord({ id: 'private', memo: 'new plaintext' }) : raw;
			freshPromise = db.decryptRecord(freshRaw);
			const fresh = await progress(freshPromise, 'fresh session must not share the held old decrypt'); release.resolve();
			const outcomes = await progress(old, 'released old decrypt must settle');
			assert.ok(outcomes.every(result => result.status === 'rejected'), 'old callers must not receive plaintext after invalidation');
			assert.deepEqual(await db.decryptRecord(freshRaw), fresh); assert.equal(calls, 2, 'old completion must not remove or replace the new cache');
		} finally { release.resolve(); await progress(Promise.allSettled([old, freshPromise]), 'all held decrypts must finish during cleanup'); }
	});
	it('invalidates fulfilled cache entries on setKey even when the same CryptoKey is reused', async t => {
		const db = await storage(), raw = await db.encryptRecord({ id: 'key-reuse' }), calls = countDecrypt(t), key = db.encryptionKey;
		await db.decryptRecord(raw); db.setEncryptionKey(key); await db.decryptRecord(raw); assert.equal(calls(), 2);
		db.clearEncryptionKey(); await assert.rejects(db.decryptRecord(raw), /locked|鍵|ロック/i);
		db.setEncryptionKey(await generateDatabaseMasterKey()); await assert.rejects(db.decryptRecord(raw), /decryption|認証/i);
	});
	it('does not let an old rejected decrypt remove a newer in-flight entry', { timeout: 15000 }, async t => {
		const db = await storage(), key = db.encryptionKey, raw = await db.encryptRecord({ id: 'inflight-owner' });
		const firstEntered = deferred(), secondEntered = deferred(), releaseOld = deferred(), releaseNew = deferred(), decrypt = crypto.subtle.decrypt.bind(crypto.subtle); let calls = 0;
		t.mock.method(crypto.subtle, 'decrypt', async (...args) => { const call = ++calls; if (call === 1) { firstEntered.resolve(); await releaseOld.promise; throw new Error('old decrypt failure'); } if (call === 2) { secondEntered.resolve(); await releaseNew.promise; } return decrypt(...args); });
		const old = Promise.allSettled([db.decryptRecord(raw)]); let fresh, shared;
		try {
			await progress(firstEntered.promise, 'old decrypt must reach its gate'); db.setEncryptionKey(key);
			fresh = db.decryptRecord(raw); await progress(secondEntered.promise, 'new generation must start an independent decrypt'); releaseOld.resolve(); assert.equal((await progress(old, 'old failure must settle'))[0].status, 'rejected');
			shared = db.decryptRecord(raw); releaseNew.resolve(); assert.deepEqual(await progress(fresh, 'new decrypt must finish'), { id: 'inflight-owner' }); assert.deepEqual(await progress(shared, 'shared new decrypt must finish'), { id: 'inflight-owner' }); assert.equal(calls, 2);
		} finally { releaseOld.resolve(); releaseNew.resolve(); await progress(Promise.allSettled([old, fresh, shared]), 'all old and new decrypts must finish during cleanup'); }
	});
	it('evicts the least recently used entry at the 20,000 record bound', { timeout: 60000 }, async t => {
		const db = await storage(), raws = await Promise.all(Array.from({ length: 20001 }, (_, id) => db.encryptRecord({ id }))), calls = countDecrypt(t);
		for (let id = 0; id < 20000; id++) await db.decryptRecord(raws[id]);
		await db.decryptRecord(raws[0]); await db.decryptRecord(raws[20000]);
		assert.equal(calls(), 20001);
		await db.decryptRecord(raws[0]); assert.equal(calls(), 20001, 'recently touched record must remain cached');
		assert.equal((await db.decryptRecord(raws[1])).id, 1); assert.equal(calls(), 20002, 'oldest untouched record must be decrypted again');
	});
});

describe('full CAS with changed record IndexedDB writes', () => {
	it('writes one changed ciphertext and leaves every untouched ciphertext byte-for-byte identical', async () => {
		const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.putTransactions([transaction('a'), transaction('b'), transaction('c')]);
		const original = await db.getTransaction('b'), outside = await db.getRaw('transactions', 'a'), stats = countWrites(db);
		await db.putTransaction({ ...original, memo: 'changed' }, { expectedTransactions: [original] });
		assert.deepEqual(stats, { put: ['b'], delete: [], clear: 0 }); assert.deepEqual(await db.getRaw('transactions', 'a'), outside);
		assert.equal((await db.getRaw('transactions', 'b')).encrypted, true); assert.equal((await db.getTransaction('b')).memo, 'changed');
	});
	it('does not rewrite transactions for an unchanged complete remote state', async () => {
		const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.putTransactions([transaction('a', { sync_status: 'synced' }), transaction('b', { sync_status: 'synced' })]);
		const master = await db.getMasterConfig(), records = await db.getTransactions(), stats = countWrites(db);
		await db.commitMasterSync(master, master, { remoteState: { pending_diffs: records, archived_transactions: [], snapshot: await db.getSnapshot() } });
		assert.deepEqual(stats, { put: [], delete: [], clear: 0 });
	});
	it('deletes removed IDs without clear and aborts every store on a later write failure', async () => {
		const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.putTransactions([transaction('a'), transaction('b')]);
		const expected = await db.captureImportState(), stats = countWrites(db);
		assert.equal(await db.replaceImportBatch(expected, { transactions: expected.transactions.filter(raw => raw.id === 'a') }, () => true), true);
		assert.deepEqual(stats, { put: [], delete: ['b'], clear: 0 }); assert.equal(await db.getTransaction('b'), null);
		const before = await db.captureImportState(), transactionFn = db.db.transaction.bind(db.db);
		db.db.transaction = (...args) => { const tx = transactionFn(...args), objectStore = tx.objectStore.bind(tx); tx.objectStore = name => { const store = objectStore(name); if (name === 'master_config') store.put = () => { throw new Error('write fault'); }; return store; }; return tx; };
		const changed = await db.encryptRecord(transaction('a', { memo: 'must roll back' }), { id: 'a' });
		await assert.rejects(db.replaceImportBatch(before, { transactions: [changed], master: { changed: true } }, () => true), /write fault/);
		assert.deepEqual(await db.captureImportState(), before);
	});
	it('keeps unrelated same-ID ciphertext changes in the full CAS boundary', async () => {
		const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.putTransactions([transaction('a'), transaction('b')]); const expected = await db.captureImportState();
		const original = await db.getTransaction('b'); await db.putTransaction({ ...original, memo: 'other writer' });
		const before = await db.captureImportState(), stats = countWrites(db);
		assert.equal(await db.replaceImportBatch(expected, { transactions: expected.transactions }, () => true), false);
		assert.deepEqual(await db.captureImportState(), before); assert.deepEqual(stats, { put: [], delete: [], clear: 0 });
	});
	for (const changed of ['master', 'snapshot', 'pending', 'base']) it(`checks the entire ${changed} value even when no transaction ID or timestamp changed`, async () => {
		const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.putTransactions([transaction('a')]); const expected = await db.captureImportState();
		if (changed === 'master') await db.putRaw('master_config', await db.encryptRecord({ ...await db.getMasterConfig(), theme: 'newer preference' }), 'current');
		if (changed === 'snapshot') await db.putRaw('summary_snapshot', await db.encryptRecord({ ...await db.getSnapshot(), calculated_at: '2026-10-28T00:00:00Z' }), 'current');
		if (changed === 'pending') await db.putRaw('master_config', await db.encryptRecord({ id: 'new-pending', detectedType: 'master_config', data: { master_config: await db.getMasterConfig() } }), 'pending_import');
		if (changed === 'base') await db.putRaw('master_config', await db.encryptRecord({ ...await db.getMasterConfig(), holidays: [] }), 'sync_base');
		const before = await db.captureImportState(), stats = countWrites(db);
		assert.equal(await db.replaceImportBatch(expected, { transactions: expected.transactions }, () => true), false);
		assert.deepEqual(await db.captureImportState(), before); assert.deepEqual(stats, { put: [], delete: [], clear: 0 });
	});
});
