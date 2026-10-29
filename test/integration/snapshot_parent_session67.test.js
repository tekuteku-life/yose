import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
async function fixture() { const db = await new YoseDB(createMockIndexedDB()).init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.saveSnapshot(await db.getSnapshot()); return db; }
const raw = async db => ({ business: await db.captureImportState(), settings: await db.getAllRaw('settings'), keys: await db.getAllRaw('security_keys') });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('snapshot encryption stage did not arrive')), 4000); })]); } finally { clearTimeout(timer); } }
const stamp = '2027-01-01T00:00:00Z';
describe('review67 snapshot saving retains its originating parent operation', () => {
	it('rejects an initially expired parent before reading any business store', async () => {
		const db = await fixture(), next = { ...await db.getSnapshot(), calculated_at: stamp }, before = await raw(db), capture = db.captureImportState.bind(db); let reads = 0, outcome;
		db.captureImportState = (...args) => { reads++; return capture(...args); };
		try { outcome = await db.saveSnapshot(next, { isSessionValid: () => false }).then(value => ({ value }), error => ({ error })); }
		finally { db.captureImportState = capture; }
		assert.deepEqual({ reads, after: await raw(db) }, { reads: 0, after: before }); assert.match(outcome.error?.message || '', /認証|処理状態/);
	});
	it('rolls back the snapshot when only its parent expires after actual AES encryption', { timeout: 15000 }, async () => {
		const db = await fixture(), next = { ...await db.getSnapshot(), calculated_at: stamp }, before = await raw(db), key = db.encryptionKey, generation = db.keyGeneration, encrypt = db.encryptRecord.bind(db), entered = deferred(), release = deferred(); let owner = true, held = false, outcome;
		db.encryptRecord = async (...args) => { const result = await encrypt(...args); if (!held && args[0]?.calculated_at === stamp) { held = true; entered.resolve(); await release.promise; } return result; };
		const running = db.saveSnapshot(next, { isSessionValid: () => owner }).then(value => ({ value }), error => ({ error }));
		try { await progress(entered.promise); owner = false; }
		finally { release.resolve(); outcome = await progress(running); db.encryptRecord = encrypt; }
		assert.equal(held, true); assert.equal(db.encryptionKey, key); assert.equal(db.keyGeneration, generation); assert.deepEqual(await raw(db), before); assert.match(outcome.error?.message || '', /認証|処理状態/);
	});
	it('preserves the original one-argument API, return value, and every unrelated raw record', async () => {
		const db = await fixture(), next = { ...await db.getSnapshot(), calculated_at: stamp }, before = await raw(db), saved = await db.saveSnapshot(next); assert.deepEqual(saved, next); assert.deepEqual(await db.getSnapshot(), next); const after = await raw(db); assert.deepEqual(after.business.master, before.business.master); assert.deepEqual(after.business.transactions, before.business.transactions); assert.deepEqual(after.business.pending, before.business.pending); assert.deepEqual(after.business.base, before.business.base); assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.keys, before.keys);
	});
});
