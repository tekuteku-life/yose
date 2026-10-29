import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const gas = require('../../gas/Code.gs');

import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import {
	calculateTax,
	generateRecurringTransactions,
	createPrepaidAmortizationTransactions,
	createAdvancePaymentTransactions,
	createAdvanceRepaymentTransaction,
	createPointPaymentTransactions,
	calculateBalancesAndSummaries,
	calculateTotalAssetSummary,
	calculateAnnualBudgetProgress,
	calculateAnnualBudgetDefaults,
	generateAnnualTrajectory,
	roundTieredAmount,
	JAPANESE_HOLIDAYS_PRESET
} from '../../js/logic.js';
import {
	generateEd25519KeyPair,
	exportPublicKeyBase64,
	encryptPrivateKeyWithPin,
	decryptPrivateKeyWithPin
} from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';

describe('System Test - Yoseatsume Kakeibo End-to-End Complete Scenario', () => {
	let gasEnv;
	let db;
	let keyPair;
	let pubKeyBase64;
	let syncManager;

	beforeEach(async () => {
		// 1. Backend environment setup
		gasEnv = new MockGasEnvironment();
		gasEnv.setupGlobals();

		// 2. Client DB bootstrap
		db = new YoseDB(null);
		await db.init();

		// 3. Ed25519 Key generation & PIN protection
		keyPair = await generateEd25519KeyPair();
		pubKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

		// Save and protect private key with PIN
		const encKey = await encryptPrivateKeyWithPin(keyPair.privateKey, '9876');
		await db.saveSecurityKey('encrypted_priv_key', encKey);
		await db.saveSecurityKey('pub_key_base64', pubKeyBase64);

		// Register Public Key on GAS
		globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);

		// Initial Master Config sync to GAS
		const masterConfig = await db.getMasterConfig();
		assert.equal(gas.handleAction('update_master', { master_config: masterConfig, base_version: JSON.stringify({ schema_version: 2 }) }).success, true);

		// 4. Setup Client Sync Manager
		const directGasFetch = async (url, options) => {
			const e = { postData: { contents: options.body } };
			const res = gas.doPost(e);
			return {
				ok: true,
				text: async () => JSON.stringify(res)
			};
		};

		syncManager = new SyncManager({
			db,
			privateKey: keyPair.privateKey,
			gasUrl: 'https://script.google.com/macros/s/yose_sys/exec',
			customFetch: directGasFetch
		});
	});

	afterEach(() => {
		gasEnv.teardownGlobals();
	});

	it('runs complete lifecycle scenario matching Req.md specifications', async () => {
		// -------------------------------------------------------------
		// Step 1: Verify Key Decryption with PIN
		// -------------------------------------------------------------
		const encKey = await db.getSecurityKey('encrypted_priv_key');
		const unlockedPrivateKey = await decryptPrivateKeyWithPin(encKey, '9876');
		assert.ok(unlockedPrivateKey);
		syncManager.setPrivateKey(unlockedPrivateKey);

		// -------------------------------------------------------------
		// Step 2: Normal Purchase with Tax Calculator Helper
		// -------------------------------------------------------------
		// Shopping receipt: Tax-excluded 4,546 yen with 10% tax -> 5,000 yen total
		const taxCalc = calculateTax(4546, 0.10, 'floor');
		assert.equal(taxCalc.amount, 5000);

		const normalTx = {
			id: 'tx_sys_dinner',
			group_id: 'grp_dinner_1',
			date: '2026-10-16',
			target_month: '2026-10',
			status: 'confirmed',
			type: 'expense',
			amount: taxCalc.amount,
			tax_meta: taxCalc.tax_meta,
			account_id: 'acc_card_a',
			category_id: 'cat_social',
			subcategory_id: 'sub_drinking',
			actual_category_id: 'cat_food',
			actual_subcategory_id: 'sub_dining_out',
			memo: '友人ディナー自己負担',
			tags: ['友人A'],
			is_deleted: false
		};
		await db.putTransaction(normalTx);

		// -------------------------------------------------------------
		// Step 3: Advance Payment & Subsequent Repayment
		// -------------------------------------------------------------
		// Friend portion: 5,000 yen paid from credit card to acc_receivable
		const advanceRecords = createAdvancePaymentTransactions({
			date: '2026-10-16',
			payingAccountId: 'acc_card_a',
			selfAmount: 0,
			advanceAmount: 5000,
			memo: '友人のディナー代立替',
			tags: ['友人A']
		});
		await db.putTransactions(advanceRecords);

		// Friend repays 5,000 yen via bank transfer on next day
		const repayTx = createAdvanceRepaymentTransaction({
			date: '2026-10-17',
			receivingAccountId: 'acc_bank_main',
			amount: 5000,
			memo: '友人Aより立替返金'
		});
		await db.putTransaction(repayTx);

		// -------------------------------------------------------------
		// Step 4: Annual Prepaid Split Amortization (12 months)
		// -------------------------------------------------------------
		// 12,000 yen annual subscription on 2026-10-01 (acc_card_a -> acc_prepaid)
		const prepaidTxs = createPrepaidAmortizationTransactions({
			paymentDate: '2026-10-01',
			totalAmount: 12000,
			payingAccountId: 'acc_card_a',
			categoryId: 'cat_social',
			subcategoryId: 'sub_leisure',
			amortizeMonths: 12,
			memo: 'クラウド年額プラン',
			todayMonth: '2026-10'
		});
		await db.putTransactions(prepaidTxs);

		// -------------------------------------------------------------
		// Step 5: Monthly Recurring Generation with Holiday Adjustment
		// -------------------------------------------------------------
		const config = await db.getMasterConfig();
		const existingTxs = await db.getTransactions({ target_month: '2026-10' });
		const recurringTxs = generateRecurringTransactions(
			config.recurring_rules,
			'2026-10',
			config.holidays,
			existingTxs
		);
		// Rent rule (120,000 yen) generated as planned
		assert.equal(recurringTxs.length, 1);
		await db.putTransactions(recurringTxs);

		// -------------------------------------------------------------
		// Step 6: Verify Realtime Local Balances & Dual Axis Aggregations
		// -------------------------------------------------------------
		const snapshot = await db.getSnapshot();
		const allLocalTxs = await db.getTransactions();

		const summary = calculateBalancesAndSummaries(snapshot, allLocalTxs, '2026-10');

		// Confirmed Expense for October:
		// Dinner: 5,000 + Prepaid Oct amort: 1,000 = 6,000 yen
		assert.equal(summary.expense_confirmed, 6000);

		// Planned Expense for October:
		// Rent: 120,000 yen
		assert.equal(summary.expense_planned, 120000);

		// Total Projected Expense: 6,000 + 120,000 = 126,000 yen
		assert.equal(summary.expense_total, 126000);

		// acc_receivable should be 0 (5,000 advance - 5,000 repayment)
		assert.equal(summary.confirmed_balances.acc_receivable, 0);

		// Dual-axis category verification:
		// Accounting basis: cat_social has 5,000 (dinner) + 1,000 (prepaid) = 6,000
		assert.equal(summary.by_category.cat_social.total_confirmed, 6000);
		// Actual basis: cat_food has 5,000 (dinner)
		assert.equal(summary.by_actual_category.cat_food.total_confirmed, 5000);

		// -------------------------------------------------------------
		// Step 7: Push Diff Synchronization to GAS
		// -------------------------------------------------------------
		const syncRes = await syncManager.syncPendingDiffs();
		assert.equal(syncRes.status, 'synced');
		assert.ok(syncRes.synced_count > 0);

		const unsyncedRemaining = await db.getUnsyncedTransactions();
		assert.equal(unsyncedRemaining.length, 0);

		// -------------------------------------------------------------
		// Step 8: Monthly Closing for October 2026
		// -------------------------------------------------------------
		// Rent is confirmed prior to closing
		const rentTx = (await db.getTransactions({ target_month: '2026-10' }))
			.find(t => t.recurring_rule_id === 'rec_rent');
		rentTx.status = 'confirmed';
		rentTx.sync_status = 'unsynced';
		rentTx.updated_at = new Date().toISOString();
		await db.putTransaction(rentTx);

		const closeRes = await syncManager.closeMonth('2026-10', { approvedPlanned: (await db.getTransactions({ target_month: '2026-10' })).filter(tx => tx.status === 'planned') });
		assert.equal(closeRes.success, true);
		assert.equal(closeRes.snapshot.last_closed_month, '2026-10');

		// Local snapshot is automatically updated
		const postCloseSnapshot = await db.getSnapshot();
		assert.equal(postCloseSnapshot.last_closed_month, '2026-10');
		assert.equal(postCloseSnapshot.monthly_summaries['2026-10'].expense_total, 126000);

		// -------------------------------------------------------------
		// Step 9: Retroactive Adjustment and Cascade Recalculation
		// -------------------------------------------------------------
		// User edits an expense in the closed month (e.g. October) by adding 2,000 yen
		const retroTx = {
			reclose_approved_months: ['2026-10'],
			id: 'tx_retro_bonus_tax',
			target_month: '2026-10',
			date: '2026-10-20',
			type: 'expense',
			amount: 2000,
			account_id: 'acc_wallet',
			status: 'confirmed',
			is_deleted: false
		};
		const retroRes = await syncManager.sendRetroactiveUpdate(retroTx);
		assert.equal(retroRes.success, true);
		assert.equal(retroRes.snapshot.monthly_summaries['2026-10'].expense_total, 128000);

		// -------------------------------------------------------------
		// Step 10: Full Backup Export and Restoration Verification
		// -------------------------------------------------------------
		const backupJson = await db.exportFullData();
		assert.equal(backupJson.schema_version, 2);
		assert.ok(backupJson.transactions.length > 0);

		// Restore into a fresh database instance
		const freshDb = new YoseDB(null);
		await freshDb.init();
		await freshDb.importFullData(backupJson);

		const restoredSnapshot = await freshDb.getSnapshot();
		assert.equal(restoredSnapshot.last_closed_month, '2026-10');
		assert.equal(restoredSnapshot.monthly_summaries['2026-10'].expense_total, 128000);

		const restoredTxs = await freshDb.getTransactions({ target_month: '2026-10' });
		assert.ok(restoredTxs.length > 0);

		// -------------------------------------------------------------
		// Step 11: Master Manual Sync & External Asset Registration
		// -------------------------------------------------------------
		const updatedMaster = await db.getMasterConfig();
		updatedMaster.holidays = [...JAPANESE_HOLIDAYS_PRESET];
		await db.saveMasterConfig(updatedMaster);

		const extAssets = [
			{ id: 'sec_vanguard', name: '全世界株式インデックス', market_value: 2500000, type: 'stock' }
		];
		const curSnapshot = await db.getSnapshot();
		curSnapshot.external_assets = extAssets;
		await db.saveSnapshot(curSnapshot);

		const masterSyncRes = await syncManager.syncMaster();
		assert.equal(masterSyncRes.status, 'synced');

		const assetSyncRes = await syncManager.sendAction('update_external_assets', { external_assets: extAssets });
		assert.equal(assetSyncRes.success, true);

		// -------------------------------------------------------------
		// Step 12: Point Payment Linked Transaction Creation
		// -------------------------------------------------------------
		const pointTxs = createPointPaymentTransactions({
			offsetCategoryId: 'cat_point_income', offsetSubcategoryId: 'sub_point_offset',
			date: '2026-10-22',
			totalAmount: 10000,
			pointUsed: 3000,
			payingAccountId: 'acc_wallet',
			categoryId: 'cat_food'
		});
		assert.equal(pointTxs.length, 2);
		await db.putTransactions(pointTxs);

		// -------------------------------------------------------------
		// Step 13: Total Net Asset Calculation & Multi-Granularity Analytics
		// -------------------------------------------------------------
		const postPointSummary = calculateBalancesAndSummaries(curSnapshot, await db.getTransactions(), '2026-10');
		const totalAssets = calculateTotalAssetSummary(
			postPointSummary.confirmed_balances,
			updatedMaster.accounts,
			extAssets
		);
		assert.ok(totalAssets.total_assets > 2500000);
		assert.ok(totalAssets.external_assets_total === 2500000);
		assert.ok(totalAssets.net_assets > 0);

		// -------------------------------------------------------------
		// Step 14: Annual Budget & Category Budget Setting, Auto-Calculation Defaults, Sync, and Progress Analytics (Requirement 3.14)
		// -------------------------------------------------------------
		const allTxs = await db.getTransactions({ includeDeleted: false });
		const configBeforeBudget = await db.getMasterConfig();

		// Auto-calculate budget defaults based on 2026 data
		const budgetDefaults = calculateAnnualBudgetDefaults({
			previousYearSummary: {
				income: 300000,
				expense: 138000,
				net: 162000,
				savings_rate: 54
			},
			pastTransactions: allTxs,
			categories: configBeforeBudget.categories,
			targetYear: 2027
		});

		assert.ok(budgetDefaults.expense_budget > 0);
		assert.ok(budgetDefaults.savings_target_amount > 0);
		assert.ok(budgetDefaults.savings_target_rate > 0);
		assert.ok(typeof budgetDefaults.category_budgets === 'object');

		// Save annual budget with category budgets for 2027
		const savedBudget = await db.saveAnnualBudget('2027', {
			expense_budget: 2000000,
			savings_target_amount: 1000000,
			savings_target_rate: 33,
			category_budgets: {
				cat_food: 600000,
				cat_housing: 1000000
			}
		});
		assert.equal(savedBudget.expense_budget, 2000000);
		assert.equal(savedBudget.category_budgets.cat_food, 600000);
		assert.equal(savedBudget.category_budgets.cat_housing, 1000000);

		// Sync updated master config containing annual_budgets to GAS
		const gasBudgetSyncRes = await syncManager.syncMaster();
		assert.equal(gasBudgetSyncRes.status, 'synced');

		// Fetch remote state from GAS and verify annual_budgets and category_budgets integrity
		const remoteState = await syncManager.fetchRemoteState();
		assert.ok(remoteState.master_config.annual_budgets['2027']);
		assert.equal(remoteState.master_config.annual_budgets['2027'].expense_budget, 2000000);
		assert.equal(remoteState.master_config.annual_budgets['2027'].category_budgets.cat_food, 600000);

		// Calculate progress and trajectory
		const budgetProgress = calculateAnnualBudgetProgress({
			yearlySummary: {
				expense: 150000,
				income: 300000,
				net: 150000
			},
			budgetConfig: savedBudget,
			currentMonth: 1
		});
		assert.equal(budgetProgress.expense_budget, 2000000);
		assert.equal(budgetProgress.total_category_budget, 1600000);
		assert.equal(budgetProgress.budget_discrepancy, 400000); // 2000000 - 1600000

		const trajectory = generateAnnualTrajectory({
			year: '2027',
			monthlySummaries: {},
			expenseBudget: 2000000,
			savingsTarget: 1000000
		});
		assert.equal(trajectory.length, 12);
		assert.equal(trajectory[0].month_str, '2027-01');
	});
});

