import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';

async function fixture(idb) {
	const db = await new YoseDB(idb).init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveSecurityKey('webauthn_credential', { id: 'credential67', publicKey: 'keep-public', transports: ['internal'] });
	await db.saveSecurityKey('webauthn_vault', { encrypted: 'preserve vault' }); await db.setSetting('device-only', { keep: 1 });
	return db;
}
const raw = async db => ({ business: await db.captureImportState(), settings: await db.getAllRaw('settings'), keys: await db.getAllRaw('security_keys') });

describe('review67 security key removal retains its originating caller session', () => {
	for (const model of ['memory', 'indexedDB']) it(`rejects an expired parent before any ${model} read or delete transaction`, async () => {
		const db = await fixture(model === 'memory' ? null : createMockIndexedDB()), before = await raw(db); let reads = 0, writes = 0;
		const get = db.getRaw.bind(db), all = db.getAllRaw.bind(db), transaction = db.db?.transaction.bind(db.db), remove = db.memoryDb?.delete.bind(db.memoryDb);
		db.getRaw = (...args) => { reads++; return get(...args); }; db.getAllRaw = (...args) => { reads++; return all(...args); };
		if (transaction) db.db.transaction = (...args) => { writes++; return transaction(...args); };
		if (remove) db.memoryDb.delete = (...args) => { writes++; return remove(...args); };
		let outcome;
		try { outcome = await db.deleteSecurityKey('webauthn_credential', { isSessionValid: () => false }).then(value => ({ value }), error => ({ error })); }
		finally { db.getRaw = get; db.getAllRaw = all; if (transaction) db.db.transaction = transaction; if (remove) db.memoryDb.delete = remove; }
		assert.deepEqual({ reads, writes, after: await raw(db) }, { reads: 0, writes: 0, after: before }); assert.match(outcome.error?.message || '', /認証|処理状態/);
	});
	it('rolls back the actual staged delete when only its parent expires on request success', async () => {
		const db = await fixture(createMockIndexedDB()), before = await raw(db), key = db.encryptionKey, generation = db.keyGeneration, original = db.db.transaction.bind(db.db); let owner = true, entered = false, outcome;
		db.db.transaction = (...args) => {
			const tx = original(...args), objectStore = tx.objectStore.bind(tx);
			tx.objectStore = name => { const store = objectStore(name), remove = store.delete.bind(store); if (name === 'security_keys') store.delete = id => {
				const request = remove(id); if (id === 'webauthn_credential') { let success; Object.defineProperty(request, 'onsuccess', { get: () => event => { entered = true; owner = false; success?.(event); }, set: callback => { success = callback; } }); } return request;
			}; return store; }; return tx;
		};
		try { outcome = await db.deleteSecurityKey('webauthn_credential', { isSessionValid: () => owner }).then(value => ({ value }), error => ({ error })); }
		finally { db.db.transaction = original; }
		assert.equal(entered, true); assert.equal(db.encryptionKey, key); assert.equal(db.keyGeneration, generation); assert.deepEqual(await raw(db), before); assert.match(outcome.error?.message || '', /IndexedDB delete aborted/);
	});
	for (const model of ['memory', 'indexedDB']) it(`preserves the original one-argument ${model} deletion and all unrelated records`, async () => {
		const db = await fixture(model === 'memory' ? null : createMockIndexedDB()), before = await raw(db); await db.deleteSecurityKey('webauthn_credential');
		assert.equal(await db.getSecurityKey('webauthn_credential'), null); assert.deepEqual(await db.getSecurityKey('webauthn_vault'), { encrypted: 'preserve vault' });
		const after = await raw(db); assert.deepEqual(after.business, before.business); assert.deepEqual(after.settings, before.settings); assert.equal(after.keys.length, before.keys.length - 1);
	});
});
