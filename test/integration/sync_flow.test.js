import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const gas = require('../../gas/Code.gs');

import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import {
	generateEd25519KeyPair,
	exportPublicKeyBase64
} from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';

describe('Integration - Client & GAS Sync Flow', () => {
	let gasEnv;
	let db;
	let keyPair;
	let pubKeyBase64;
	let syncManager;

	beforeEach(async () => {
		// 1. Setup GAS Mock Environment
		gasEnv = new MockGasEnvironment();
		gasEnv.setupGlobals();

		// 2. Setup Client Database
		db = new YoseDB(null);
		await db.init();

		// 3. Generate Ed25519 keypair on Client
		keyPair = await generateEd25519KeyPair();
		pubKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

		// 4. Register Public Key on GAS
		globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);

		// 5. Setup Custom Fetch routing directly into gas.doPost(e)
		const directGasFetch = async (url, options) => {
			// Simulate network serialization
			const e = {
				postData: {
					contents: options.body
				}
			};
			const responseObj = gas.doPost(e);
			return {
				ok: true,
				text: async () => JSON.stringify(responseObj)
			};
		};

		// 6. Setup SyncManager with directGasFetch
		syncManager = new SyncManager({
			db: db,
			privateKey: keyPair.privateKey,
			gasUrl: 'https://script.google.com/macros/s/yose_test/exec',
			customFetch: directGasFetch
		});
	});

	afterEach(() => {
		gasEnv.teardownGlobals();
	});

	it('performs complete sync cycle: push diffs -> verify -> mark synced', async () => {
		// Client enters 2 new transactions
		const tx1 = {
			id: 'tx_int_1',
			target_month: '2026-10',
			date: '2026-10-15',
			type: 'expense',
			amount: 4500,
			account_id: 'acc_wallet',
			memo: 'スーパー買い物',
			status: 'confirmed',
			is_deleted: false
		};
		const tx2 = {
			id: 'tx_int_2',
			target_month: '2026-10',
			date: '2026-10-16',
			type: 'income',
			amount: 300000,
			account_id: 'acc_bank_main',
			memo: '給与振込',
			status: 'confirmed',
			is_deleted: false
		};

		await db.putTransactions([tx1, tx2]);

		// Check unsynced count on client
		const unsyncedBefore = await db.getUnsyncedTransactions();
		assert.equal(unsyncedBefore.length, 2);

		// Execute push_diff
		const syncResult = await syncManager.syncPendingDiffs();
		assert.equal(syncResult.status, 'synced');
		assert.equal(syncResult.synced_count, 2);

		// Verify local transactions are marked as synced
		const unsyncedAfter = await db.getUnsyncedTransactions();
		assert.equal(unsyncedAfter.length, 0);

		const savedTx1 = await db.getTransaction('tx_int_1');
		assert.equal(savedTx1.sync_status, 'synced');
	});

	it('closes month on GAS, stores archive, and updates client snapshot', async () => {
		// 1. Client creates and pushes October transactions
		await db.putTransactions([
			{
				id: 'tx_oct_inc',
				target_month: '2026-10',
				date: '2026-10-25',
				type: 'income',
				amount: 250000,
				account_id: 'acc_bank_main',
				status: 'confirmed',
				is_deleted: false
			},
			{
				id: 'tx_oct_exp',
				target_month: '2026-10',
				date: '2026-10-26',
				type: 'expense',
				amount: 50000,
				account_id: 'acc_bank_main',
				status: 'confirmed',
				is_deleted: false
			}
		]);
		await syncManager.syncPendingDiffs();

		// 2. Client initiates Month Closing for 2026-10
		const closeRes = await syncManager.closeMonth('2026-10');
		assert.equal(closeRes.success, true);
		assert.equal(closeRes.snapshot.last_closed_month, '2026-10');

		// 3. Verify client database snapshot was updated
		const localSnapshot = await db.getSnapshot();
		assert.equal(localSnapshot.last_closed_month, '2026-10');
		assert.equal(localSnapshot.monthly_summaries['2026-10'].income_total, 250000);
		assert.equal(localSnapshot.monthly_summaries['2026-10'].expense_total, 50000);
		assert.equal(localSnapshot.monthly_summaries['2026-10'].net_income, 200000);
	});

	it('handles retroactive edit of archived month and propagates recalculated snapshot', async () => {
		// Initialize master config on GAS
		const masterConfig = await db.getMasterConfig();
		const updateMasterReq = {
			action: 'update_master',
			timestamp: Date.now(),
			payload: { master_config: masterConfig }
		};
		gas.handleAction('update_master', { master_config: masterConfig });

		// Close 2026-09
		await db.putTransaction({
			id: 'tx_sep_income',
			target_month: '2026-09',
			date: '2026-09-25',
			type: 'income',
			amount: 200000,
			account_id: 'acc_bank_main',
			status: 'confirmed',
			is_deleted: false
		});
		await syncManager.closeMonth('2026-09');

		// Close 2026-10
		await db.putTransaction({
			id: 'tx_oct_expense',
			target_month: '2026-10',
			date: '2026-10-10',
			type: 'expense',
			amount: 50000,
			account_id: 'acc_bank_main',
			status: 'confirmed',
			is_deleted: false
		});
		await syncManager.closeMonth('2026-10');

		const snapBeforeRetro = await db.getSnapshot();
		// initial bank (1,000,000) + 200,000 - 50,000 = 1,150,000
		assert.equal(snapBeforeRetro.account_balances.acc_bank_main, 1150000);

		// Retroactively modify September: add an extra expense of 30,000 to September
		const retroTx = {
			reclose_approved_months: ['2026-09'],
			id: 'tx_sep_extra_bill',
			target_month: '2026-09',
			date: '2026-09-28',
			type: 'expense',
			amount: 30000,
			account_id: 'acc_bank_main',
			status: 'confirmed',
			is_deleted: false
		};

		const retroRes = await syncManager.sendRetroactiveUpdate(retroTx);
		assert.equal(retroRes.success, true);

		// Verify local snapshot was updated with cascaded recalculation:
		// Initial 1,000,000 + (200k - 30k) - 50k = 1,120,000
		const snapAfterRetro = await db.getSnapshot();
		assert.equal(snapAfterRetro.account_balances.acc_bank_main, 1120000);
		assert.equal(snapAfterRetro.monthly_summaries['2026-09'].expense_total, 30000);
	});
	for (const destination of ['2026-10', '2026-08']) {
		it(`moves an archived transaction to ${destination}, removes the old entry, and recalculates once`, async () => {
			gas.handleUpdateMaster({ master_config: await db.getMasterConfig() });
			const tx = { id: 'move_archived', date: '2026-09-20', target_month: '2026-09', type: 'expense', account_id: 'acc_bank_main', amount: 300, status: 'confirmed', sync_status: 'synced' };
			gas.saveJsonFile('archives/2026-09.json', { transactions: [tx] });
			const snapshot = { schema_version: 2, last_closed_month: '2026-09', account_balances: { acc_bank_main: 999700 }, monthly_summaries: { '2026-09': gas.computeMonthlySummary([tx], { acc_bank_main: 1000000 }) } };
			gas.saveJsonFile('summary_snapshot.json', snapshot);
			await db.saveSnapshot(snapshot);
			await db.putTransaction({ ...tx, reclose_approved_months: ['2026-09', destination], previous_target_month: '2026-09', target_month: destination, date: destination + '-20', sync_status: 'unsynced' });
			await syncManager.syncPendingDiffs();
			const old = gas.loadJsonFile('archives/2026-09.json');
			assert.equal(old.transactions.some(t => t.id === tx.id), false);
			const target = destination <= '2026-09' ? gas.loadJsonFile(`archives/${destination}.json`) : gas.loadJsonFile('pending_diffs.json');
			assert.equal(target.transactions.filter(t => t.id === tx.id).length, 1);
			const after = gas.loadJsonFile('summary_snapshot.json');
			assert.equal(after.monthly_summaries['2026-09'].expense_total, 0);
			assert.equal(after.account_balances.acc_bank_main, destination <= '2026-09' ? 999700 : 1000000);
			assert.equal((await db.getTransaction(tx.id)).previous_target_month, undefined);
		});
	}

	it('keeps failed archived edits pending and retries them into the archive after reconnecting', async () => {
		gas.handleUpdateMaster({ master_config: await db.getMasterConfig() });
		const initial = { id: 'retry_archive', date: '2026-09-20', target_month: '2026-09', type: 'expense', account_id: 'acc_bank_main', amount: 100, status: 'confirmed' };
		gas.saveJsonFile('archives/2026-09.json', { transactions: [initial] });
		const snapshot = { schema_version: 2, last_closed_month: '2026-09', account_balances: { acc_bank_main: 999900 }, monthly_summaries: { '2026-09': gas.computeMonthlySummary([initial], { acc_bank_main: 1000000 }) } };
		gas.saveJsonFile('summary_snapshot.json', snapshot);
		await db.saveSnapshot(snapshot);
		await db.putTransaction({ ...initial, amount: 500, reclose_approved_months: ['2026-09'], sync_status: 'unsynced' });
		const fetch = syncManager.fetch;
		syncManager.fetch = async () => { throw new Error('offline'); };
		await assert.rejects(syncManager.syncPendingDiffs(), /offline/);
		assert.equal((await db.getTransaction(initial.id)).sync_status, 'unsynced');
		syncManager.fetch = fetch;
		await syncManager.syncPendingDiffs();
		assert.equal(gas.loadJsonFile('archives/2026-09.json').transactions[0].amount, 500);
		assert.equal(gas.loadJsonFile('summary_snapshot.json').monthly_summaries['2026-09'].expense_total, 500);
		assert.equal((await db.getTransaction(initial.id)).sync_status, 'synced');
	});

	for (const [source, intermediate] of [['2026-09', '2026-10'], ['2026-10', '2026-08']]) {
		it(`deduplicates ${source} to ${intermediate} to November after the first response is lost`, async () => {
			gas.handleUpdateMaster({ master_config: await db.getMasterConfig() });
			const initial = { id: 'lost_response', date: source + '-20', target_month: source, type: 'expense', account_id: 'acc_bank_main', amount: 300, status: 'confirmed' };
			const snapshot = { schema_version: 2, last_closed_month: '2026-09', account_balances: { acc_bank_main: 1000000 }, monthly_summaries: { '2026-09': gas.computeMonthlySummary(source === '2026-09' ? [initial] : [], { acc_bank_main: 1000000 }) } };
			gas.saveJsonFile('summary_snapshot.json', snapshot);
			gas.saveJsonFile(source <= '2026-09' ? `archives/${source}.json` : 'pending_diffs.json', { transactions: [initial] });
			await db.saveSnapshot(snapshot);
			await db.putTransaction({ ...initial, reclose_approved_months: [source, intermediate], date: intermediate + '-20', target_month: intermediate, previous_target_month: source, sync_status: 'unsynced' });
			const fetch = syncManager.fetch;
			syncManager.fetch = async (...args) => { await fetch(...args); throw new Error('response lost'); };
			await assert.rejects(syncManager.syncPendingDiffs(), /response lost/);
			const applied = gas.loadJsonFile(intermediate <= '2026-09' ? `archives/${intermediate}.json` : 'pending_diffs.json', { transactions: [] });
			assert.ok(applied.transactions.some(tx => tx.id === initial.id && tx.target_month === intermediate));
			const pending = await db.getTransaction(initial.id);
			assert.equal(pending.previous_target_month, source);
			await db.putTransaction({ ...pending, date: '2026-11-20', target_month: '2026-11' });
			syncManager.fetch = fetch;
			await syncManager.syncPendingDiffs();
			const all = [gas.loadJsonFile('pending_diffs.json'), ...['2026-08', '2026-09', '2026-10'].map(month => gas.loadJsonFile(`archives/${month}.json`, { transactions: [] }))];
			const instances = all.flatMap(data => data.transactions || []).filter(tx => tx.id === initial.id);
			assert.equal(instances.length, 1);
			assert.equal(instances[0].target_month, '2026-11');
			const finalSnapshot = gas.loadJsonFile('summary_snapshot.json');
			assert.equal(finalSnapshot.monthly_summaries['2026-09'].expense_total, 0);
			if (intermediate <= '2026-09') assert.equal(finalSnapshot.monthly_summaries[intermediate].expense_total, 0);
			assert.equal(finalSnapshot.account_balances.acc_bank_main, 1000000);
		});
	}

	it('serializes sync before reading pending records and preserves edits made during that read', async () => {
		gas.handleUpdateMaster({ master_config: await db.getMasterConfig() });
		gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
		const initial = await db.putTransaction({ id: 'read_race', date: '2026-10-20', target_month: '2026-10', type: 'expense', account_id: 'acc_bank_main', amount: 100, status: 'confirmed' });
		let release;
		let started;
		const barrier = new Promise(resolve => { release = resolve; });
		const reading = new Promise(resolve => { started = resolve; });
		const getPending = db.getUnsyncedTransactions.bind(db);
		let calls = 0;
		db.getUnsyncedTransactions = async () => {
			const pending = await getPending();
			if (++calls === 1) { started(); await barrier; }
			return pending;
		};
		const first = syncManager.syncPendingDiffs();
		try {
			await reading;
			await db.putTransaction({ ...initial, amount: 200 });
			assert.equal((await syncManager.syncPendingDiffs()).status, 'already_syncing');
			assert.equal(calls, 1);
		} finally {
			release();
			await first;
		}
		assert.equal(syncManager.isSyncing, false);
		assert.equal((await db.getTransaction(initial.id)).amount, 200);
		assert.equal((await db.getTransaction(initial.id)).sync_status, 'unsynced');
		await syncManager.syncPendingDiffs();
		assert.equal(gas.loadJsonFile('pending_diffs.json').transactions.find(tx => tx.id === initial.id).amount, 200);
		assert.equal((await db.getTransaction(initial.id)).sync_status, 'synced');
	});

	for (const route of ['push_diff', 'retroactive_update']) {
		it(`does not acknowledge a concurrently edited version while ${route} is in flight`, async () => {
			gas.handleUpdateMaster({ master_config: await db.getMasterConfig() });
			gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
			const sent = { id: 'concurrent', date: '2026-10-20', target_month: '2026-10', type: 'expense', account_id: 'acc_bank_main', amount: 100, status: 'confirmed', sync_status: 'unsynced', updated_at: '2026-10-20T00:00:00Z', ...(route === 'retroactive_update' ? { previous_target_month: '2026-09', reclose_approved_months: ['2026-09'] } : {}) };
			await db.putTransaction(sent);
			let release;
			let started;
			const barrier = new Promise(resolve => { release = resolve; });
			const requestStarted = new Promise(resolve => { started = resolve; });
			const fetch = syncManager.fetch;
			syncManager.fetch = async (...args) => {
				assert.equal(JSON.parse(args[1].body).action, route);
				const response = await fetch(...args);
				started();
				await barrier;
				return response;
			};
			const sending = syncManager.syncPendingDiffs();
			await requestStarted;
			const latest = { ...await db.getTransaction(sent.id), amount: 222, ...(route === 'retroactive_update' ? { target_month: '2026-11', date: '2026-11-20' } : {}) };
			// Deliberately keep updated_at identical to exercise two edits within one clock tick.
			await db.putTransaction(latest);
			release();
			await sending;
			const remaining = await db.getTransaction(sent.id);
			assert.equal(remaining.amount, 222);
			assert.equal(remaining.sync_status, 'unsynced');
			if (route === 'retroactive_update') assert.equal(remaining.previous_target_month, '2026-09');
			syncManager.fetch = fetch;
			await syncManager.syncPendingDiffs();
			assert.equal((await db.getTransaction(sent.id)).sync_status, 'synced');
			assert.equal(gas.loadJsonFile('pending_diffs.json').transactions.find(tx => tx.id === sent.id).amount, 222);
		});
	}

});

