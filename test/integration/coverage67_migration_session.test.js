import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

async function fixture() {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.putTransaction(transaction('migrate67')); await db.mutateMasterConfig(config => { config.categories.find(row => row.id === 'cat_food').is_archived = true; });
	return { db, source: { kind: 'category', id: 'cat_food' }, target: { id: 'cat_housing' }, expected: await db.getTransactions(), config: await db.getMasterConfig() };
}
const raw = async db => ({ business: await db.captureImportState(), settings: await db.getAllRaw('settings'), keys: await db.getAllRaw('security_keys') });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('migration encryption did not reach its expected stage')), 4000); })]); } finally { clearTimeout(timer); } }

describe('review67 archived-master migration retains its parent operation owner', () => {
	it('rejects an expired parent before the first business read and preserves every raw store', async () => {
		const { db, source, target, expected, config } = await fixture(), before = await raw(db), capture = db.captureImportState.bind(db); let reads = 0;
		db.captureImportState = (...args) => { reads++; return capture(...args); };
		const outcome = await db.migrateArchivedMaster(source, target, expected, config, [], { isSessionValid: () => false }).then(value => ({ value }), error => ({ error })); db.captureImportState = capture;
		assert.deepEqual({ reads, after: await raw(db) }, { reads: 0, after: before }); assert.match(outcome.error?.message || '', /認証|処理状態|ロック/);
	});
	it('rolls back a parent invalidated after real AES encryption while the same database key remains active', { timeout: 15000 }, async () => {
		const { db, source, target, expected, config } = await fixture(), before = await raw(db), key = db.encryptionKey, generation = db.keyGeneration, encrypt = db.encryptRecord.bind(db), entered = deferred(), release = deferred(); let owner = true, held = false, outcome;
		db.encryptRecord = async (...args) => { const result = await encrypt(...args); if (!held && args[0]?.category_id === 'cat_housing') { held = true; entered.resolve(); await release.promise; } return result; };
		const running = db.migrateArchivedMaster(source, target, expected, config, [], { isSessionValid: () => owner }).then(value => ({ value }), error => ({ error }));
		try { await progress(entered.promise); owner = false; }
		finally { release.resolve(); outcome = await progress(running); db.encryptRecord = encrypt; }
		assert.equal(held, true); assert.equal(db.encryptionKey, key); assert.equal(db.keyGeneration, generation); assert.deepEqual(await raw(db), before); assert.match(outcome.error?.message || '', /認証|処理状態|ロック/);
	});
});
