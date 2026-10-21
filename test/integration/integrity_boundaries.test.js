import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { SyncManager } from '../../js/sync.js';
import { createPrepaidAmortizationTransactions } from '../../js/logic/transaction_factory.js';
const tx = (id, extra = {}) => ({ id, date: '2026-10-20', target_month: '2026-10', type: 'expense', status: 'confirmed', amount: 10, account_id: 'acc_wallet', category_id: 'cat_food', subcategory_id: null, actual_category_id: 'cat_food', actual_subcategory_id: null, tags: [], is_deleted: false, ...extra });
async function setup() {
	const db = await new YoseDB().init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveMasterConfig(await db.getMasterConfig()); await db.saveSnapshot(await db.getSnapshot());
	await db.putTransactions([tx('original')]); return db;
}
const raw = async db => Promise.all(['transactions', 'master_config', 'summary_snapshot'].map(store => db.getAllRaw(store)));

describe('Integrity at every local mutation boundary', () => {
	for (const kind of ['local', 'import', 'remote']) it(`repairs a legacy object timestamp through ${kind}`, async () => {
		const db = await setup(), original = await db.getTransaction('original');
		const broken = { ...original, updated_at: { toString: 0 } };
		await db.putRaw('transactions', await db.encryptRecord(broken, { id: broken.id, target_month: broken.target_month }));
		const repaired = { ...original, amount: 91, updated_at: '2030-01-01T00:00:00.000Z' };
		if (kind === 'local') await db.putTransaction(repaired);
		if (kind === 'import') await db.importFullData({ export_type: 'transactions', transactions: [repaired] });
		if (kind === 'remote') await db.mergeRemoteTransactions([repaired]);
		assert.equal((await db.getTransaction(original.id)).amount, 91);
	});
	for (const kind of ['local', 'import', 'remote', 'legacy']) {
		it(`rejects malformed prepaid roles at the ${kind} boundary without changing records`, async () => {
			const db = await setup(), rows = createPrepaidAmortizationTransactions({ paymentDate: '2026-10-01', totalAmount: 100, payingAccountId: 'acc_wallet', categoryId: 'cat_food', amortizeMonths: 2, todayMonth: '2026-10' });
			rows[1].amortization_meta.is_payment_record = 'false';
			if (kind === 'legacy') for (const record of rows) await db.putRaw('transactions', await db.encryptRecord(record, { id: record.id, target_month: record.target_month }));
			const before = await raw(db);
			if (kind === 'local') await assert.rejects(db.putTransactions(rows));
			if (kind === 'import') await assert.rejects(db.importFullData({ export_type: 'transactions', transactions: rows }));
			if (kind === 'remote') await assert.rejects(db.mergeRemoteTransactions(rows));
			if (kind === 'legacy') await assert.rejects(db.updateInstallmentGroup(rows[0].group_id, {}, { newTotalAmount: 200 }), /前払|役割|補助|不正|整合/);
			assert.deepEqual(await raw(db), before);
		});
	}
	it('keeps local edits newer than a previously accepted future version during synchronization', async () => {
		const db = await setup();
		const future = await db.putTransaction({ ...await db.getTransaction('original'), updated_at: '2100-01-01T00:00:00.000Z' });
		const saved = await db.putTransaction({ ...future, amount: 123, updated_at: new Date().toISOString() }, { expectedTransactions: [future] });
		assert.ok(Date.parse(saved.updated_at) > Date.parse(future.updated_at));
		const sync = new SyncManager({ db, gasUrl: 'test', privateKey: {} });
		sync.sendRequest = async (action, payload) => action === 'fetch_master' ? { master_config: await db.getMasterConfig() }
			: { accepted_ids: payload.transactions.filter(row => Date.parse(row.updated_at) > Date.parse(future.updated_at)).map(row => row.id), conflicts: payload.transactions.some(row => Date.parse(row.updated_at) <= Date.parse(future.updated_at)) ? [future] : [] };
		await sync.pushPending();
		assert.equal((await db.getTransaction('original')).amount, 123);
		assert.equal((await db.getTransaction('original')).sync_status, 'synced');
	});
	for (const method of ['putTransactions', 'saveMasterConfig', 'saveSnapshot', 'importFullData', 'mergeRemoteTransactions']) {
		it(`${method} rejects invalid candidates before any write`, async () => {
			const db = await setup(), before = await raw(db);
			const bad = tx('bad', { actual_subcategory_id: 'missing' });
			const config = await db.getMasterConfig(); config.categories = config.categories.filter(item => item.id !== 'cat_food');
			const op = method === 'putTransactions' ? () => db.putTransactions([tx('valid'), bad])
				: method === 'saveMasterConfig' ? () => db.saveMasterConfig(config)
					: method === 'saveSnapshot' ? () => db.saveSnapshot({ schema_version: 2, account_balances: { missing: 1 } })
						: method === 'importFullData' ? () => db.importFullData({ schema_version: 2, export_type: 'transactions', transactions: [tx('valid'), bad] })
							: () => db.mergeRemoteTransactions([tx('valid'), bad]);
			await assert.rejects(op);
			assert.deepEqual(await raw(db), before);
		});
	}
	it('rejects duplicate IDs in imports and remote envelopes before collapsing or writing rows', async () => {
		for (const kind of ['import', 'remote']) {
			const db = await setup(), before = await raw(db), rows = [tx('new'), tx('new', { amount: 12 })];
			if (kind === 'import') await assert.rejects(db.importFullData({ export_type: 'transactions', transactions: rows }), /重複/);
			else await assert.rejects(db.mergeRemoteTransactions(rows), /重複/);
			assert.deepEqual(await raw(db), before);
		}
	});
	it('rejects invalid LWW timestamps at local, import and remote boundaries', async () => {
		for (const kind of ['local', 'import', 'remote']) {
			const db = await setup(), before = await raw(db), rows = [tx('new'), tx('bad-time', { updated_at: 'invalid' })];
			if (kind === 'local') await assert.rejects(db.putTransactions(rows), /日時|整合/);
			if (kind === 'import') await assert.rejects(db.importFullData({ export_type: 'transactions', transactions: rows }), /日時|整合/);
			if (kind === 'remote') await assert.rejects(db.mergeRemoteTransactions(rows), /日時|整合/);
			assert.deepEqual(await raw(db), before);
		}
	});
	it('does not delete a version changed after the original was read', async () => {
		const db = await setup(), get = db.getTransaction.bind(db); let first = true;
		db.getTransaction = async id => {
			const original = await get(id);
			if (first) { first = false; await db.putTransaction({ ...original, memo: '別端末の更新' }); }
			return original;
		};
		await assert.rejects(db.deleteTransaction('original'), /変更|競合/);
		assert.equal((await get('original')).memo, '別端末の更新');
		assert.equal((await get('original')).is_deleted, false);
	});
	it('merges a valid new master and its transactions in the same import', async () => {
		const db = await setup(), config = await db.getMasterConfig();
		config.categories.push({ id: 'cat_new', name: '新費目', type: 'expense', subcategories: [{ id: 'sub_new', name: '内訳' }] });
		await db.importFullData({ schema_version: 2, export_type: 'full_backup', master_config: config, summary_snapshot: await db.getSnapshot(), transactions: [tx('new', { category_id: 'cat_new', subcategory_id: 'sub_new', actual_category_id: 'cat_new', actual_subcategory_id: null })] });
		assert.equal((await db.getTransaction('new')).subcategory_id, 'sub_new');
	});
	it('merges unrelated master edits and rejects an overlapping stale edit', async () => {
		const db = await setup(), original = await db.getMasterConfig();
		const other = structuredClone(original); other.accounts[0].name = '別端末'; await db.saveMasterConfig(other);
		const mine = structuredClone(original); mine.categories.find(item => item.id === 'cat_food').name = '手元';
		await db.saveMasterConfig(mine, { expectedConfig: original });
		assert.equal((await db.getMasterConfig()).accounts[0].name, '別端末');
		const stale = structuredClone(original); stale.accounts[0].name = '古い画面';
		await assert.rejects(db.saveMasterConfig(stale, { expectedConfig: original }), /変更|競合/);
	});
	it('guards edited transactions and create-only writes, including explicitly reactivating a deleted stable ID', async () => {
		const db = await setup(), original = await db.getTransaction('original');
		await db.putTransaction({ ...original, memo: '別端末' });
		const before = await raw(db);
		await assert.rejects(db.putTransaction({ ...original, amount: 30 }, { expectedTransactions: [original] }), /変更|競合/);
		await assert.rejects(db.putTransactions([tx('original')], { createOnly: true }));
		await assert.rejects(db.putTransactions([tx('original')], { expectedTransactions: [] }));
		assert.deepEqual(await raw(db), before);
		await db.deleteTransaction('original'); const deleted = await db.getTransaction('original');
		await db.putTransactions([{ ...deleted, is_deleted: false }], { expectedTransactions: [deleted] });
		assert.equal((await db.getTransaction('original')).is_deleted, false);
	});
	it('applies intent mutations to the latest master without undoing unrelated updates', async () => {
		const db = await setup();
		await Promise.all([
			db.mutateMasterConfig(config => { config.theme = 'dark'; }),
			db.mutateMasterConfig(config => { config.accounts[0].name = '並行更新'; })
		]);
		const result = await db.getMasterConfig(); assert.equal(result.theme, 'dark'); assert.equal(result.accounts[0].name, '並行更新');
	});
	for (const method of ['putTransactions', 'saveMasterConfig', 'saveSnapshot', 'importFullData', 'mergeRemoteTransactions']) {
		it(`${method} refuses lock during encryption without plaintext or partial writes`, async () => {
			const db = await setup(), before = await raw(db);
			const encrypt = db.encryptRecord.bind(db); let first = true;
			db.encryptRecord = async (...args) => { if (first) { first = false; db.clearEncryptionKey(); } return encrypt(...args); };
			const op = method === 'putTransactions' ? () => db.putTransactions([tx('new')])
				: method === 'saveMasterConfig' ? async () => db.saveMasterConfig({ ...await db.getMasterConfig(), theme: 'dark' })
					: method === 'saveSnapshot' ? () => db.saveSnapshot({ schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} })
						: method === 'importFullData' ? () => db.importFullData({ export_type: 'transactions', transactions: [tx('new')] })
							: () => db.mergeRemoteTransactions([tx('new')]);
			await assert.rejects(op, /鍵|認証|ロック|変更/);
			assert.deepEqual(await raw(db), before);
		});
	}
	it('preserves all original stores when a merged backup cannot finish encryption', async () => {
		const db = await setup(), before = await raw(db), config = await db.getMasterConfig();
		config.accounts.push({ id: 'new-account', name: '新口座', type: 'cash', initial_balance: 0 });
		const encrypt = db.encryptRecord.bind(db); let calls = 0;
		db.encryptRecord = async (...args) => { if (++calls === 2) throw new Error('injected failure'); return encrypt(...args); };
		await assert.rejects(db.importFullData({ schema_version: 2, export_type: 'full_backup', master_config: config, transactions: [tx('new')], summary_snapshot: await db.getSnapshot() }), /injected/);
		assert.deepEqual(await raw(db), before);
	});
	it('encrypts existing plaintext stores even when saving the same business values', async () => {
		const db = await new YoseDB().init();
		await db.putTransaction(tx('plain'));
		db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.saveSnapshot(await db.getSnapshot());
		for (const store of ['transactions', 'master_config', 'summary_snapshot']) for (const record of await db.getAllRaw(store)) assert.equal(record.encrypted, true);
	});
	it('rejects malformed snapshots and remote master payloads without writing', async () => {
		const db = await setup(), before = await raw(db), master = await db.getMasterConfig();
		for (const value of [null, false, 0, []]) {
			await assert.rejects(db.saveSnapshot(value));
			await assert.rejects(db.commitMasterSync(master, master, { remoteState: { snapshot: value } }));
			await assert.rejects(db.commitSyncResponse([], { snapshot: value }));
		}
		for (const value of ['bad', false, 1, []]) await assert.rejects(db.commitMasterSync(master, value));
		assert.deepEqual(await raw(db), before);
	});
	it('does not generate a second settlement for the same card and billing cycle in parallel', async () => {
		const db = await setup();
		await db.putTransaction(tx('card-expense', { account_id: 'acc_card_a', date: '2026-09-10', target_month: '2026-09' }));
		await db.putTransaction(tx('card-planned', { account_id: 'acc_card_a', date: '2026-09-11', target_month: '2026-09', status: 'planned', amount: 999 }));
		const pending = tx('card-pending', { account_id: 'acc_card_a', date: '2026-09-12', target_month: '2026-09', amount_pending: true, amount: 999 });
		// Existing inconsistent history must not be silently turned into a confirmed settlement.
		await db.putRaw('transactions', await db.encryptRecord(pending, { id: pending.id }));
		await Promise.all([db.processCreditCardAutoSettlements('2026-10-27'), db.processCreditCardAutoSettlements('2026-10-27')]);
		assert.equal((await db.getTransactions()).filter(item => item.auto_settlement_meta).length, 1);
		const settled = (await db.getTransactions()).find(item => item.auto_settlement_meta);
		assert.equal(settled.amount, 10);
		await assert.rejects(db.putTransaction({ ...settled, id: 'another-settlement' }), /重複/);
	});
	it('skips automatic settlement when its paying account is archived', async () => {
		const db = await setup();
		await db.putTransaction(tx('card-expense', { account_id: 'acc_card_a', date: '2026-09-10', target_month: '2026-09' }));
		await db.mutateMasterConfig(config => { config.accounts.find(item => item.id === 'acc_bank_main').is_archived = true; config.recurring_rules = []; });
		assert.deepEqual(await db.processCreditCardAutoSettlements('2026-10-27'), []);
	});
	it('aborts maintenance if authentication changes immediately before atomic commit', async () => {
		const db = await setup();
		await db.mutateMasterConfig(config => { config.categories.find(item => item.id === 'cat_food').is_archived = true; });
		const before = await raw(db), commit = db.replaceImportBatch.bind(db);
		db.replaceImportBatch = async (...args) => { db.clearEncryptionKey(); return commit(...args); };
		await assert.rejects(db.migrateArchivedMaster({ kind: 'category', id: 'cat_food' }, { id: 'cat_housing' }, await db.getTransactions(), await db.getMasterConfig(), []), /認証|鍵|ロック/);
		assert.deepEqual(await raw(db), before);
	});
});
