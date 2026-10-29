import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

async function fixture() { const db = await new YoseDB(createMockIndexedDB()).init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.putTransaction(transaction('preserved67')); return db; }
const raw = async db => ({ business: await db.captureImportState(), settings: await db.getAllRaw('settings'), keys: await db.getAllRaw('security_keys') });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('master encryption did not reach its expected stage')), 4000); })]); } finally { clearTimeout(timer); } }

describe('review67 master mutators retain the originating caller session', () => {
	it('does not read or invoke a mutator when its parent was already cancelled', async () => {
		const db = await fixture(), before = await raw(db), capture = db.captureImportState.bind(db); let reads = 0, called = false;
		db.captureImportState = (...args) => { reads++; return capture(...args); };
		let outcome;
		try { outcome = await db.mutateMasterConfig(config => { called = true; config.theme = 'dark'; }, { isSessionValid: () => false }).then(value => ({ value }), error => ({ error })); }
		finally { db.captureImportState = capture; }
		assert.deepEqual({ reads, called, after: await raw(db) }, { reads: 0, called: false, after: before }); assert.match(outcome.error?.message || '', /認証|ロック|処理状態/);
	});
	it('rejects the parent cancelled after real AES encryption without changing the database epoch or any raw record', { timeout: 15000 }, async () => {
		const db = await fixture(), before = await raw(db), key = db.encryptionKey, generation = db.keyGeneration, encrypt = db.encryptRecord.bind(db), entered = deferred(), release = deferred(); let owner = true, held = false, outcome;
		db.encryptRecord = async (...args) => { const encrypted = await encrypt(...args); if (!held && args[0]?.theme === 'dark') { held = true; entered.resolve(); await release.promise; } return encrypted; };
		const running = db.mutateMasterConfig(config => { config.theme = 'dark'; }, { isSessionValid: () => owner }).then(value => ({ value }), error => ({ error }));
		try { await progress(entered.promise); owner = false; }
		finally { release.resolve(); outcome = await progress(running); db.encryptRecord = encrypt; }
		assert.equal(held, true); assert.equal(db.encryptionKey, key); assert.equal(db.keyGeneration, generation); assert.deepEqual(await raw(db), before); assert.match(outcome.error?.message || '', /認証|ロック|処理状態/);
	});
	it('keeps the original one-argument API and its returned master while preserving every financial record', async () => {
		const db = await fixture(), before = await raw(db), result = await db.mutateMasterConfig(config => { config.theme = 'dark'; }); assert.equal(result.theme, 'dark'); assert.equal((await db.getMasterConfig()).theme, 'dark'); const after = await raw(db); assert.deepEqual(after.business.transactions, before.business.transactions); assert.deepEqual(after.business.snapshot, before.business.snapshot); assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.keys, before.keys);
	});
});
