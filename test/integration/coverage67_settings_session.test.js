import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';

async function fixture(idb) { const db = await new YoseDB(idb).init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.setSetting('gas_url', 'https://old.fixture/exec'); await db.setSetting('device-only', { keep: 1 }); return db; }
const raw = async db => ({ business: await db.captureImportState(), settings: await db.getAllRaw('settings'), keys: await db.getAllRaw('security_keys') });

describe('review67 device setting writes retain the originating caller session', () => {
	for (const model of ['memory', 'indexedDB']) it(`rejects an expired parent before any ${model} transaction without changing a raw store`, async () => {
		const db = await fixture(model === 'memory' ? null : createMockIndexedDB()), before = await raw(db); let transactions = 0, reads = 0;
		const get = db.getRaw.bind(db), getAll = db.getAllRaw.bind(db), transaction = db.db?.transaction.bind(db.db);
		db.getRaw = (...args) => { reads++; return get(...args); }; db.getAllRaw = (...args) => { reads++; return getAll(...args); };
		if (transaction) db.db.transaction = (...args) => { transactions++; return transaction(...args); };
		let outcome;
		try { outcome = await db.setSetting('gas_url', 'https://expired.fixture/exec', { isSessionValid: () => false }).then(value => ({ value }), error => ({ error })); }
		finally { db.getRaw = get; db.getAllRaw = getAll; if (transaction) db.db.transaction = transaction; }
		assert.deepEqual({ transactions, reads, after: await raw(db) }, { transactions: 0, reads: 0, after: before }); assert.match(outcome.error?.message || '', /認証状態が変更/);
	});
	it('rolls back the real staged setting when its parent expires on request success with an unchanged database key', async () => {
		const db = await fixture(createMockIndexedDB()), before = await raw(db), key = db.encryptionKey, generation = db.keyGeneration, transaction = db.db.transaction.bind(db.db); let owner = true, entered = false, outcome;
		db.db.transaction = (...args) => {
			const tx = transaction(...args), objectStore = tx.objectStore.bind(tx);
			tx.objectStore = name => { const store = objectStore(name), put = store.put.bind(store); if (name === 'settings') store.put = (value, id) => {
				const request = put(value, id); if (id === 'gas_url') { let success; Object.defineProperty(request, 'onsuccess', { get: () => event => { entered = true; owner = false; success?.(event); }, set: callback => { success = callback; } }); } return request;
			}; return store; }; return tx;
		};
		try { outcome = await db.setSetting('gas_url', 'https://expired.fixture/exec', { isSessionValid: () => owner }).then(value => ({ value }), error => ({ error })); }
		finally { db.db.transaction = transaction; }
		assert.equal(entered, true); assert.equal(db.encryptionKey, key); assert.equal(db.keyGeneration, generation); assert.deepEqual(await raw(db), before); assert.match(outcome.error?.message || '', /IndexedDB write aborted/);
	});
	it('preserves the existing two-argument setting API and leaves unrelated device settings intact', async () => {
		const db = await fixture(createMockIndexedDB()), business = await db.captureImportState(); const result = await db.setSetting('gas_url', 'https://new.fixture/exec'); assert.equal(result, 'https://new.fixture/exec'); assert.equal(await db.getSetting('gas_url'), result); assert.deepEqual(await db.getSetting('device-only'), { keep: 1 }); assert.deepEqual(await db.captureImportState(), business);
	});
});
