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
});

