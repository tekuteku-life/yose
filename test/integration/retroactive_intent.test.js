import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';

async function fixture() {
	const db = new YoseDB();
	await db.init();
	db.setEncryptionKey(await generateDatabaseMasterKey());
	const { privateKey } = await generateEd25519KeyPair();
	const requests = [];
	const sync = new SyncManager({ db, privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => {
		requests.push(JSON.parse(options.body));
		return { ok: true, text: async () => JSON.stringify({ success: true }) };
	} });
	return { db, sync, requests };
}

describe('Direct retroactive intent and saved originals', () => {
	for (const saved of [false, true]) it(`rejects a changed original during import flush for ${saved ? 'saved' : 'unsaved'} changes`, async () => {
		const { db, sync, requests } = await fixture();
		const original = await db.putTransaction(transaction('retro_race', { is_deleted: saved }));
		const requested = saved ? original : { ...original, is_deleted: true };
		let release, start;
		const started = new Promise(resolve => { start = resolve; });
		const gate = new Promise(resolve => { release = resolve; });
		sync.flushPendingImport = async () => { start(); await gate; };
		const operation = sync.sendRetroactiveUpdate(requested);
		await started;
		await db.putTransaction({ ...original, is_deleted: false, amount: 999, memo: '新版を保持' });
		const before = await db.getRaw('transactions', original.id);
		release();
		await assert.rejects(operation, /変更|競合/);
		assert.deepEqual(await db.getRaw('transactions', original.id), before);
		assert.equal(requests.length, 0);
	});
	it('sends an identical saved version without saving it again', async () => {
		const { db, sync, requests } = await fixture();
		const original = await db.putTransaction(transaction('saved_retro', { is_deleted: true }));
		const put = db.putTransaction.bind(db);
		let writes = 0;
		db.putTransaction = async (...args) => { writes++; return put(...args); };
		await sync.sendRetroactiveUpdate(original);
		assert.equal(writes, 0);
		assert.equal(requests.find(request => request.action === 'retroactive_update').payload.transaction.updated_at, original.updated_at);
	});
	it('continues to atomically save an unsaved edit before direct sending', async () => {
		const { db, sync, requests } = await fixture();
		const original = await db.putTransaction(transaction('unsaved_retro'));
		await sync.sendRetroactiveUpdate({ ...original, amount: 250 });
		assert.equal((await db.getTransaction(original.id)).amount, 250);
		assert.equal(requests.find(request => request.action === 'retroactive_update').payload.transaction.amount, 250);
	});
	it('rejects an explicit stale caller original before local or remote mutation', async () => {
		const { db, sync, requests } = await fixture();
		const original = await db.putTransaction(transaction('caller_original'));
		await db.putTransaction({ ...original, amount: 999 });
		const before = await db.getRaw('transactions', original.id);
		await assert.rejects(sync.sendRetroactiveUpdate({ ...original, amount: 250 }, { expectedTransaction: original }), /変更|競合/);
		assert.deepEqual(await db.getRaw('transactions', original.id), before);
		assert.equal(requests.length, 0);
	});
});
