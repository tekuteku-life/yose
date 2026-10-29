import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
const result = request => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
async function setup() { const db = await new YoseDB(createMockIndexedDB()).init(); await db.putSecurityKeys({ zero: 0, false: false, empty: '', null: null, object: { nested: { value: 1 } } }, () => true); return db; }
it('models native get without turning valid falsy values into an absent record', async () => {
	const db = await setup(), tx = db.db.transaction(['security_keys'], 'readonly'), store = tx.objectStore('security_keys');
	assert.deepEqual(await Promise.all(['zero', 'false', 'empty', 'null', 'missing'].map(key => result(store.get(key)))), [0, false, '', null, undefined]);
});
it('models native getKey presence independently from null and empty stored values', async () => {
	const db = await setup(), tx = db.db.transaction(['security_keys'], 'readonly'), store = tx.objectStore('security_keys'); assert.equal(typeof store.getKey, 'function', 'native IDBObjectStore.getKey is required');
	assert.deepEqual(await Promise.all(['zero', 'false', 'empty', 'null', 'missing'].map(key => result(store.getKey(key)))), ['zero', 'false', 'empty', 'null', undefined]);
});
it('returns distinct cloned native get results within the same readonly transaction', async () => {
	const db = await setup(), tx = db.db.transaction(['security_keys'], 'readonly'), store = tx.objectStore('security_keys');
	const next = await new Promise((resolve, reject) => { const first = store.get('object'); first.onerror = () => reject(first.error); first.onsuccess = () => { first.result.nested.value = 99; const second = store.get('object'); second.onerror = () => reject(second.error); second.onsuccess = () => resolve(second.result); }; });
	assert.deepEqual(next, { nested: { value: 1 } });
});
