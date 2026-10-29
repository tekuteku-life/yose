import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('advance encryption stage did not arrive')), 4000); })]); } finally { clearTimeout(timer); } }
const raw = async db => ({ business: await db.captureImportState(), settings: await db.getAllRaw('settings'), keys: await db.getAllRaw('security_keys') });
async function fixture(unlink) {
	const db = await new YoseDB(createMockIndexedDB()).init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	const source = transaction('advance-parent67', { type: 'transfer', account_id: 'acc_wallet', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null });
	const repayment = transaction('repayment-parent67', { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_bank_main', category_id: null, actual_category_id: null, ...(unlink ? { advance_source_id: source.id } : {}) });
	await db.putTransactions([source, repayment]); return { db, source: await db.getTransaction(source.id), repayment: await db.getTransaction(repayment.id) };
}
const call = (db, source, repayment, unlink, options) => unlink ? db.unlinkAdvanceRepayment(repayment, options) : db.linkAdvanceRepayment(source, repayment, options);
describe('review67 singular advance link and unlink preserve caller lifetime', () => {
	for (const unlink of [false, true]) {
		it(`rejects an initially expired ${unlink ? 'unlink' : 'singular link'} parent before reading business originals`, async () => {
			const { db, source, repayment } = await fixture(unlink), before = await raw(db), original = db.captureImportState.bind(db); let reads = 0, outcome;
			db.captureImportState = (...args) => { reads++; return original(...args); };
			try { outcome = await call(db, source, repayment, unlink, { approvedMonths: [], isSessionValid: () => false }).then(value => ({ value }), error => ({ error })); }
			finally { db.captureImportState = original; }
			assert.deepEqual({ reads, after: await raw(db) }, { reads: 0, after: before }); assert.match(outcome.error?.message || '', /認証|処理状態/);
		});
		it(`rejects the ${unlink ? 'unlink' : 'singular link'} parent after real AES without changing the database key or generation`, { timeout: 15000 }, async () => {
			const { db, source, repayment } = await fixture(unlink), before = await raw(db), key = db.encryptionKey, generation = db.keyGeneration, encrypt = db.encryptRecord.bind(db), entered = deferred(), release = deferred(); let owner = true, held = false, outcome;
			db.encryptRecord = async (...args) => { const result = await encrypt(...args); if (!held && args[0]?.id === repayment.id) { held = true; entered.resolve(); await release.promise; } return result; };
			const running = call(db, source, repayment, unlink, { approvedMonths: [], isSessionValid: () => owner }).then(value => ({ value }), error => ({ error }));
			try { await progress(entered.promise); owner = false; }
			finally { release.resolve(); outcome = await progress(running); db.encryptRecord = encrypt; }
			assert.equal(held, true); assert.equal(db.encryptionKey, key); assert.equal(db.keyGeneration, generation); assert.deepEqual(await raw(db), before); assert.match(outcome.error?.message || '', /認証|処理状態/);
		});
		it(`preserves the existing ${unlink ? 'two-argument unlink' : 'three-argument singular link'} API and financial contents`, async () => {
			const { db, source, repayment } = await fixture(unlink), before = await raw(db); await call(db, source, repayment, unlink, { approvedMonths: [] });
			const latest = await db.getTransaction(repayment.id); assert.equal(latest.advance_source_id, unlink ? undefined : source.id);
			for (const field of ['amount', 'type', 'date', 'target_month', 'account_id', 'to_account_id', 'category_id', 'actual_category_id', 'group_id']) assert.equal(latest[field], repayment[field]);
			const after = await raw(db); assert.deepEqual(after.business.master, before.business.master); assert.deepEqual(after.business.snapshot, before.business.snapshot); assert.deepEqual(after.business.base, before.business.base); assert.deepEqual(after.business.pending, before.business.pending); assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.keys, before.keys);
		});
	}
});
