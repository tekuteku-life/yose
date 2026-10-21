import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateEd25519KeyPair, exportPublicKeyBase64, canonicalJsonStringify } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');

describe('Bidirectional sync and explicit month closing', () => {
	let env, db, sync;
	beforeEach(async () => {
		env = new MockGasEnvironment(); env.setupGlobals();
		db = new YoseDB(); await db.init();
		const kp = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(kp.publicKey));
		assert.equal(gas.handleUpdateMaster({ master_config: await db.getMasterConfig(), base_version: JSON.stringify({ schema_version: 2 }) }).success, true);
		gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
		sync = new SyncManager({ db, privateKey: kp.privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => ({ ok: true, text: async () => JSON.stringify(gas.doPost({ postData: { contents: options.body } })) }) });
	});
	afterEach(() => env.teardownGlobals());

	it('merges local and remote edits, tombstones, and archived transactions in both directions', async () => {
		await db.putTransaction(transaction('local'));
		await db.putTransaction(transaction('same', { amount: 111, updated_at: '2026-10-20T00:00:00Z' }));
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('remote'), transaction('same', { amount: 222, updated_at: '2026-10-21T00:00:00Z' }), transaction('deleted', { is_deleted: true })] });
		gas.saveJsonFile('archives/2026-09.json', { transactions: [transaction('archive', { date: '2026-09-01', target_month: '2026-09' })] });
		const result = await sync.syncBidirectional();
		assert.ok(result.downloaded_count >= 3);
		assert.equal((await db.getTransaction('same')).amount, 222);
		assert.equal((await db.getTransaction('deleted')).is_deleted, true);
		assert.equal((await db.getTransaction('archive')).sync_status, 'synced');
		assert.equal((await db.getUnsyncedTransactions()).length, 0);
		assert.ok(gas.loadJsonFile('pending_diffs.json').transactions.some(tx => tx.id === 'local'));
	});

	it('migrates archived master references through signed sync and recalculates closed summaries', async () => {
		const config = await db.getMasterConfig();
		config.categories.find(category => category.id === 'cat_food').is_archived = true;
		await db.saveMasterConfig(config);
		gas.saveJsonFile('master_config.json', config);
		const original = transaction('maintenance_closed', { date: '2026-09-10', target_month: '2026-09', sync_status: 'synced' });
		await db.putTransaction(original);
		gas.saveJsonFile('archives/2026-09.json', { transactions: [original] });
		await db.migrateArchivedMaster({ kind: 'category', id: 'cat_food' }, { id: 'cat_housing', subcategoryId: null }, await db.getTransactions(), await db.getMasterConfig(), ['2026-09']);
		await sync.syncBidirectional();
		const archive = gas.loadJsonFile('archives/2026-09.json').transactions;
		assert.equal(archive.length, 1);
		assert.equal(archive[0].id, original.id);
		assert.equal(archive[0].category_id, 'cat_housing');
		assert.equal(archive[0].actual_category_id, 'cat_housing');
		assert.equal(archive[0].amount, original.amount);
		const snapshot = gas.loadJsonFile('summary_snapshot.json');
		assert.equal(snapshot.monthly_summaries['2026-09'].by_category.cat_housing.total, 100);
		assert.equal(snapshot.monthly_summaries['2026-09'].by_category.cat_food, undefined);
		assert.equal((await db.getTransaction(original.id)).sync_status, 'synced');
	});

	it('downloads even when the local device has no pending upload', async () => {
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('remote_only')] });
		await sync.syncBidirectional();
		assert.equal((await db.getTransaction('remote_only')).sync_status, 'synced');
	});

	it('does not overwrite an edit made while downloading remote state', async () => {
		await db.putTransaction(transaction('race', { amount: 100 }));
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('race', { amount: 500, updated_at: '2026-10-21T00:00:00Z' })] });
		const fetch = sync.fetch;
		let first = true;
		sync.fetch = async (...args) => {
			const result = await fetch(...args);
			if (first) { first = false; await db.putTransaction(transaction('race', { amount: 999, updated_at: '2026-10-22T00:00:00Z' })); }
			return result;
		};
		await sync.syncBidirectional();
		assert.equal((await db.getTransaction('race')).amount, 999);
		assert.equal(gas.loadJsonFile('pending_diffs.json').transactions[0].amount, 999);
	});

	it('keeps equal-timestamp local changes and protects edits during download encryption', async () => {
		await db.putTransaction(transaction('tie', { amount: 111 }));
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('tie', { amount: 222 }), transaction('encrypt_race', { amount: 333 })] });
		const encrypt = db.encryptRecord.bind(db);
		let injected = false;
		db.encryptRecord = async (payload, ...args) => {
			if (payload.id === 'encrypt_race' && payload.sync_status === 'synced' && !injected) {
				injected = true;
				await db.putTransaction(transaction('encrypt_race', { amount: 999, updated_at: '2026-10-22T00:00:00Z' }));
			}
			return encrypt(payload, ...args);
		};
		await sync.syncBidirectional();
		assert.equal(injected, true);
		assert.equal((await db.getTransaction('tie')).amount, 111);
		assert.equal((await db.getTransaction('encrypt_race')).amount, 999);
	});

	it('retains pending uploads on a partial failure and retries safely', async () => {
		await db.putTransaction(transaction('retry_local'));
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('retry_remote')] });
		const fetch = sync.fetch;
		sync.fetch = async (...args) => {
			if (JSON.parse(args[1].body).action === 'push_diff') throw new Error('offline during upload');
			return fetch(...args);
		};
		await assert.rejects(sync.syncBidirectional(), /offline/);
		assert.equal(sync.isSyncing, false);
		assert.equal((await db.getTransaction('retry_local')).sync_status, 'unsynced');
		assert.ok(await db.getTransaction('retry_remote'));
		sync.fetch = fetch;
		await sync.syncBidirectional();
		assert.equal((await db.getUnsyncedTransactions()).length, 0);
	});

	it('keeps local edits pending when a remote close requires confirmation and the user cancels', async () => {
		await db.putTransaction(transaction('newly_closed'));
		gas.saveJsonFile('summary_snapshot.json', { ...await db.getSnapshot(), last_closed_month: '2026-10' });
		let prompted = 0;
		const result = await sync.syncBidirectional({ approveReclose: async () => { prompted++; return false; } });
		assert.equal(prompted, 1);
		assert.equal(result.pending_count, 1);
		assert.equal((await db.getTransaction('newly_closed')).sync_status, 'unsynced');
		assert.equal(gas.loadJsonFile('archives/2026-10.json', null), null);
	});
	for (const timing of ['confirm', 'encryption']) {
		it(`does not overwrite an edit made during reclose approval ${timing}`, async () => {
			await db.putTransaction(transaction('approval_race'));
			gas.saveJsonFile('summary_snapshot.json', { ...await db.getSnapshot(), last_closed_month: '2026-10' });
			const update = () => db.putTransaction(transaction('approval_race', { amount: 999, updated_at: '2026-10-22T00:00:00Z' }));
			const encrypt = db.encryptRecord.bind(db);
			let injected = false;
			if (timing === 'encryption') db.encryptRecord = async (payload, ...args) => {
				if (payload.id === 'approval_race' && payload.reclose_approved_months?.length && !injected) { injected = true; await update(); }
				return encrypt(payload, ...args);
			};
			const result = await sync.syncBidirectional({ approveReclose: async () => { if (timing === 'confirm') await update(); return true; } });
			assert.equal(result.status, 'approval_required');
			assert.equal((await db.getTransaction('approval_race')).amount, 999);
			assert.equal((await db.getTransaction('approval_race')).sync_status, 'unsynced');
			assert.equal(gas.loadJsonFile('archives/2026-10.json', null), null);
		});
	}
	it('merges a newer server version instead of acknowledging a rejected direct retroactive deletion', async () => {
		const remote = transaction('direct_conflict', { target_month: '2026-09', date: '2026-09-20', amount: 999, updated_at: '2026-10-22T00:00:00Z' });
		gas.saveJsonFile('archives/2026-09.json', { transactions: [remote] });
		await sync.sendRetroactiveUpdate({ ...remote, updated_at: '2026-10-20T00:00:00Z', is_deleted: true, reclose_approved_months: ['2026-09'] });
		assert.equal((await db.getTransaction(remote.id)).is_deleted, false);
		assert.equal((await db.getTransaction(remote.id)).amount, 999);
		assert.equal((await db.getTransaction(remote.id)).sync_status, 'synced');
	});

	it('rejects stale server uploads instead of replacing newer remote records', () => {
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('stale', { amount: 900, updated_at: '2026-10-22T00:00:00Z' })] });
		gas.handlePushDiff({ transactions: [transaction('stale', { amount: 100 })] });
		assert.equal(gas.loadJsonFile('pending_diffs.json').transactions[0].amount, 900);
	});

	for (const kind of ['unknown', 'unapproved', 'changed', 'new']) {
		it(`refuses ${kind} planned records without changing the month archive or snapshot`, () => {
			const planned = transaction('planned', { status: 'planned', ...(kind === 'unknown' ? { amount_pending: true, amount: 0 } : {}) });
			const { sync_status, ...content } = planned;
			const approvals = [{ id: planned.id, version: canonicalJsonStringify(content) }];
			const pending = [{ ...planned, ...(kind === 'changed' ? { amount: 999 } : {}) }];
			if (kind === 'new') pending.push(transaction('new_planned', { status: 'planned' }));
			gas.saveJsonFile('pending_diffs.json', { transactions: pending });
			const before = gas.loadJsonFile('summary_snapshot.json');
			const result = gas.handleCloseMonth({ target_month: '2026-10', approved_planned: kind === 'unapproved' ? [] : approvals });
			assert.equal(result.success, false);
			assert.equal(gas.loadJsonFile('archives/2026-10.json', null), null);
			assert.deepEqual(gas.loadJsonFile('summary_snapshot.json'), before);
		});
	}
	for (const kind of ['push_closed', 'missing_source', 'missing_target', 'missing_intermediate', 'planned', 'unknown']) {
		it(`rejects reclose ${kind} without changing any server records`, () => {
			const stored = transaction('closed_guard', { date: '2026-09-01', target_month: '2026-09' });
			gas.saveJsonFile('archives/2026-09.json', { transactions: [stored] });
			if (kind === 'missing_intermediate') gas.saveJsonFile('archives/2026-08.json', { transactions: [stored] });
			const names = ['pending_diffs.json', 'summary_snapshot.json', 'archives/2026-08.json', 'archives/2026-09.json'];
			const before = names.map(name => gas.loadJsonFile(name, null));
			const changed = { ...stored, amount: 222, updated_at: '2026-10-22T00:00:00Z', reclose_approved_months: ['2026-09'] };
			if (kind === 'missing_source') { changed.target_month = '2026-10'; changed.reclose_approved_months = []; }
			if (kind === 'missing_target') changed.target_month = '2026-08';
			if (kind === 'planned') changed.status = 'planned';
			if (kind === 'unknown') changed.amount_pending = true;
			const result = kind === 'push_closed' ? gas.handlePushDiff({ transactions: [changed] }) : gas.handleRetroactiveUpdate({ transaction: changed });
			assert.equal(result.success, false);
			assert.deepEqual(names.map(name => gas.loadJsonFile(name, null)), before);
		});
	}

	it('does not replace a newer archived version with a stale reclose upload', () => {
		const current = transaction('archive_newer', { target_month: '2026-09', amount: 999, updated_at: '2026-10-22T00:00:00Z' });
		gas.saveJsonFile('archives/2026-09.json', { transactions: [current] });
		gas.handleRetroactiveUpdate({ transaction: { ...current, amount: 100, updated_at: '2026-10-20T00:00:00Z', reclose_approved_months: ['2026-09'] } });
		assert.equal(gas.loadJsonFile('archives/2026-09.json').transactions[0].amount, 999);
	});

	it('confirms exactly the approved planned version and updates local status only after success', async () => {
		const planned = await db.putTransaction(transaction('approved', { status: 'planned' }));
		await sync.closeMonth('2026-10', { approvedPlanned: [planned] });
		assert.equal(gas.loadJsonFile('archives/2026-10.json').transactions[0].status, 'confirmed');
		assert.equal((await db.getTransaction(planned.id)).status, 'confirmed');
	});
});
