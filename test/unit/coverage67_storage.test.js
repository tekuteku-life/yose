import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { StorageEngine } from '../../js/db/storage_engine.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';

describe('review67 atomic security-key persistence', () => {
	for (const nativeModel of [false, true]) it(`stores detached security packages and preserves other keys, indexedDB model=${nativeModel}`, async () => {
		const db = await new StorageEngine(nativeModel ? createMockIndexedDB() : null).init(); await db.putRaw('security_keys', { unchanged: 3 }, 'other');
		const packages = { signing: { encrypted: 'one', iv: [1, 2] }, recovery: { encrypted: 'two' } }; await db.putSecurityKeys(packages, () => true); packages.signing.iv.push(9);
		assert.deepEqual(await db.getRaw('security_keys', 'signing'), { encrypted: 'one', iv: [1, 2] }); assert.deepEqual(await db.getRaw('security_keys', 'recovery'), { encrypted: 'two' }); assert.deepEqual(await db.getRaw('security_keys', 'other'), { unchanged: 3 });
		const before = await db.getAllRaw('security_keys'); await assert.rejects(db.putSecurityKeys({ other: { changed: true } }, () => false), /認証状態/); assert.deepEqual(await db.getAllRaw('security_keys'), before);
		await assert.rejects(db.putRaw('security_keys', { changed: true }, 'other', () => false), /認証状態/); assert.deepEqual(await db.getAllRaw('security_keys'), before);
		await db.putAllRaw('transactions', []); assert.deepEqual(await db.getAllRaw('transactions'), []);
	});
	for (const operation of ['putRaw', 'putAllRaw', 'putSecurityKeys', 'deleteRaw']) it(`models a quota request failure and rolls back every staged ${operation} write`, async () => {
		const db = await new StorageEngine(createMockIndexedDB()).init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		const original = await db.encryptRecord(transaction('original'), { id: 'original' }); await db.putRaw('transactions', original); await db.putRaw('security_keys', { protected: 'keep' }, 'kept');
		const capture = async () => ({ transactions: await db.getAllRaw('transactions'), keys: await db.getAllRaw('security_keys') }), before = await capture(), transactionFn = db.db.transaction.bind(db.db); let entered = false;
		// A failed request fires its error at the request and then bubbles while
		// transaction.error is null. The default action aborts with the request's cause.
		// This adapter models that sequence without calling a successful write first.
		db.db.transaction = (...args) => {
			const tx = transactionFn(...args), objectStore = tx.objectStore.bind(tx);
			if (args[1] !== 'readwrite') return tx;
			tx.objectStore = name => {
				const store = objectStore(name), method = operation === 'deleteRaw' ? 'delete' : 'put';
				store[method] = () => {
					const request = { onsuccess: null, onerror: null, error: null, result: undefined }; entered = true;
					queueMicrotask(() => { const error = new DOMException('quota request failure', 'QuotaExceededError'); request.error = error; request.onerror?.({ target: request }); tx.onerror?.({ target: request }); tx.error = error; tx.abort(); }); return request;
				}; return store;
			}; return tx;
		};
		const replacement = await db.encryptRecord(transaction('replacement'), { id: 'replacement' });
		try {
			const running = operation === 'putRaw' ? db.putRaw('transactions', replacement) : operation === 'putAllRaw' ? db.putAllRaw('transactions', [replacement]) : operation === 'putSecurityKeys' ? db.putSecurityKeys({ signing: { cipher: 'new' } }, () => true) : db.deleteRaw('transactions', 'original');
			await assert.rejects(running, operation === 'putAllRaw' ? /IndexedDB batch write failed/ : operation === 'putSecurityKeys' ? /認証鍵の保存を中止/ : /quota request failure/);
		} finally { db.db.transaction = transactionFn; }
		assert.equal(entered, true); assert.deepEqual(await capture(), before);
	});
});
