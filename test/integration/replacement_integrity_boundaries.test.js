import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';
async function fixture() {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveMasterConfig(await db.getMasterConfig()); await db.saveSnapshot(await db.getSnapshot());
	await db.putTransaction(transaction('current'));
	return db;
}
const raw = db => Promise.all(['transactions', 'master_config', 'summary_snapshot', 'settings', 'security_keys'].map(store => db.getAllRaw(store)));
const commit = (db, plan) => db.commitReplacementImport(plan, { confirmation: '完全インポート' });
async function queued(db) { await commit(db, await db.prepareReplacementImport([transaction('imported')])); return db.getPendingImport(); }

describe('Strict complete-import planning and acknowledgement boundaries', () => {
	for (const defect of ['fraction amount', 'category type', 'account type', 'initial balance', 'active archived rule', 'snapshot nested value']) {
		it(`rejects ${defect} in the complete candidate before preparing a replacement`, async () => {
			const db = await fixture(), data = await db.exportFullData(), before = await raw(db);
			if (defect === 'fraction amount') data.transactions[0].amount = 0.5;
			if (defect === 'category type') data.transactions[0].category_id = 'cat_income_main';
			if (defect === 'account type') data.master_config.accounts[0].type = 'unknown';
			if (defect === 'initial balance') data.master_config.accounts[0].initial_balance = 0.5;
			if (defect === 'active archived rule') data.master_config.categories.find(category => category.id === 'cat_housing').is_archived = true;
			if (defect === 'snapshot nested value') data.summary_snapshot.monthly_summaries = { '2026-09': { by_category: { cat_food: { total: 'invalid' } } } };
			await assert.rejects(db.prepareReplacementImport(data), /整合|不正|Invalid/);
			assert.deepEqual(await raw(db), before);
		});
	}
	it('rejects an unrelated partial replacement while a retained legacy record remains invalid', async () => {
		const db = await fixture();
		const legacy = transaction('legacy', { amount: -1 });
		await db.putRaw('transactions', await db.encryptRecord(legacy, { id: legacy.id, sync_status: legacy.sync_status }));
		const before = await raw(db);
		await assert.rejects(db.prepareReplacementImport({ export_type: 'annual_budgets', annual_budgets: {} }), /整合|不正/);
		assert.deepEqual(await raw(db), before);
	});
	for (const part of ['data', 'master', 'snapshot', 'transactions', 'id']) {
		it(`rejects a confirmation plan whose ${part} changed after preview`, async () => {
			const db = await fixture(), plan = await db.prepareReplacementImport(await db.exportFullData()), before = await raw(db);
			if (part === 'data') plan.data.transactions[0].amount = 999;
			if (part === 'master') plan.master.accounts[0].name = 'changed after preview';
			if (part === 'snapshot') plan.snapshot.account_balances.acc_wallet += 1;
			if (part === 'transactions') plan.transactions[0].memo = 'changed after preview';
			if (part === 'id') plan.id = 'different-operation';
			await assert.rejects(commit(db, plan), /変更|確認|不正/);
			assert.deepEqual(await raw(db), before);
		});
	}
	it('invalidates the prepared plan even if its key field is replaced together with the database key', async () => {
		const db = await fixture(), plan = await db.prepareReplacementImport(await db.exportFullData()), before = await raw(db);
		const otherKey = await generateDatabaseMasterKey();
		db.setEncryptionKey(otherKey); plan.encryptionKey = otherKey;
		await assert.rejects(commit(db, plan), /認証|鍵|変更|確認/);
		assert.deepEqual(await raw(db), before);
	});
	it('does not commit a plan mutated while its immutable copy is being encrypted', async () => {
		const db = await fixture(), plan = await db.prepareReplacementImport(await db.exportFullData()), before = await raw(db);
		const encrypt = db.encryptRecord.bind(db); let changed = false;
		db.encryptRecord = async (...args) => { if (!changed) { changed = true; plan.data.transactions[0].amount = 999; } return encrypt(...args); };
		await assert.rejects(commit(db, plan), /変更|確認/);
		assert.deepEqual(await raw(db), before);
	});
	for (const importedSnapshot of [null, false, 0, [], 'invalid']) {
		it(`rejects explicit snapshot ${JSON.stringify(importedSnapshot)} before clearing the outbox`, async () => {
			const db = await fixture(), pending = await queued(db), before = await raw(db);
			await assert.rejects(db.acknowledgePendingImport(pending, undefined, { importedAt: '2026-10-22T00:00:00Z', importedSnapshot }), /snapshot|集計|不正|整合/i);
			assert.deepEqual(await raw(db), before);
		});
	}
	for (const acceptedMaster of [null, false, 0, [], 'invalid']) {
		it(`rejects explicit master ${JSON.stringify(acceptedMaster)} before clearing the outbox`, async () => {
			const db = await fixture(), pending = await queued(db), before = await raw(db);
			await assert.rejects(db.acknowledgePendingImport(pending, acceptedMaster, { importedAt: '2026-10-22T00:00:00Z' }), /master|設定|不正|整合/i);
			assert.deepEqual(await raw(db), before);
		});
	}
	it('rejects an accepted master that orphans the submitted replacement records', async () => {
		const db = await fixture(), pending = await queued(db), accepted = await db.getMasterConfig();
		accepted.categories = accepted.categories.filter(category => category.id !== 'cat_food');
		const before = await raw(db);
		await assert.rejects(db.acknowledgePendingImport(pending, accepted), /参照|整合/);
		assert.deepEqual(await raw(db), before);
	});
	it('keeps later local references while validating only the acknowledged server scope', async () => {
		const db = await fixture(), pending = await queued(db), accepted = await db.getMasterConfig();
		await db.mutateMasterConfig(config => { config.categories.push({ id: 'later', type: 'expense', name: 'later', subcategories: [] }); });
		await db.putTransaction(transaction('later', { category_id: 'later', actual_category_id: 'later' }));
		assert.equal(await db.acknowledgePendingImport(pending, accepted), true);
		assert.equal((await db.getTransaction('later')).sync_status, 'unsynced');
		assert.equal((await db.getTransaction('later')).category_id, 'later');
	});
	for (const responseField of ['snapshot', 'master_config']) {
		it(`retains a bound outbox when synchronization returns explicit false ${responseField}`, async () => {
			const db = await fixture(); await queued(db);
			const original = await db.getPendingImport();
			await db.updatePendingImport(original, { ...original, base_version: 'bound' });
			const pending = await db.getPendingImport(), before = await raw(db);
			const sync = new SyncManager({ db, privateKey: {}, gasUrl: 'test' });
			sync.sendRequest = async () => ({ success: true, import_id: pending.id, imported_at: '2026-10-22T00:00:00Z', [responseField]: false });
			await assert.rejects(sync.flushPendingImport(), /snapshot|master|設定|集計|不正|整合/i);
			assert.deepEqual(await raw(db), before);
		});
	}
	it('allows an acknowledgement that omits both optional remote domains', async () => {
		const db = await fixture(), pending = await queued(db);
		assert.equal(await db.acknowledgePendingImport(pending), true);
		assert.equal(await db.getPendingImport(), null);
		assert.equal((await db.getTransaction('imported')).sync_status, 'synced');
	});
});
