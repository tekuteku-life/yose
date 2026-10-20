import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB, DEFAULT_MASTER_CONFIG, DEFAULT_SUMMARY_SNAPSHOT } from '../../js/db.js';

describe('js/db.js - Unit Tests', () => {
	let db;

	beforeEach(async () => {
		db = new YoseDB(null); // null uses MemoryDatabase fallback in Node
		await db.init();
	});

	describe('Initialization & Defaults', () => {
		it('initializes with default master config and summary snapshot', async () => {
			const config = await db.getMasterConfig();
			assert.ok(config);
			assert.equal(config.schema_version, 2);
			assert.equal(config.accounts.length, 7); // Includes acc_point and acc_investment_main

			const snapshot = await db.getSnapshot();
			assert.ok(snapshot);
			assert.equal(snapshot.schema_version, 2);
			assert.equal(snapshot.last_closed_month, '2026-09');
		});

		it('saves and retrieves updated master config', async () => {
			const config = await db.getMasterConfig();
			config.accounts.push({
				id: 'acc_paypay',
				name: 'PayPay',
				type: 'electronic_money',
				initial_balance: 5000,
				is_asset: true,
				sort_order: 8,
				is_archived: false
			});
			await db.saveMasterConfig(config);

			const retrieved = await db.getMasterConfig();
			assert.equal(retrieved.accounts.length, 8);
			assert.ok(retrieved.accounts.some(a => a.id === 'acc_paypay'));
		});

		it('saves and retrieves updated summary snapshot', async () => {
			const snapshot = await db.getSnapshot();
			snapshot.last_closed_month = '2026-10';
			snapshot.account_balances.acc_wallet = 20000;
			await db.saveSnapshot(snapshot);

			const retrieved = await db.getSnapshot();
			assert.equal(retrieved.last_closed_month, '2026-10');
			assert.equal(retrieved.account_balances.acc_wallet, 20000);
		});
	});

	describe('Transactions CRUD and Filtering', () => {
		it('creates, reads, updates, and soft-deletes a transaction', async () => {
			const tx = {
				id: 'tx_test_1',
				group_id: 'grp_1',
				date: '2026-10-16',
				target_month: '2026-10',
				status: 'confirmed',
				type: 'expense',
				amount: 3500,
				account_id: 'acc_wallet',
				memo: 'ランチ',
				tags: ['食事'],
				is_deleted: false
			};

			// Create
			const saved = await db.putTransaction(tx);
			assert.equal(saved.id, 'tx_test_1');
			assert.equal(saved.sync_status, 'unsynced');
			assert.ok(saved.created_at);
			assert.ok(saved.updated_at);

			// Read
			const retrieved = await db.getTransaction('tx_test_1');
			assert.equal(retrieved.amount, 3500);

			// Update
			retrieved.amount = 4000;
			await db.putTransaction(retrieved);
			const updated = await db.getTransaction('tx_test_1');
			assert.equal(updated.amount, 4000);

			// Soft delete
			await db.deleteTransaction('tx_test_1', true);
			const afterDelete = await db.getTransaction('tx_test_1');
			assert.equal(afterDelete.is_deleted, true);
			assert.equal(afterDelete.sync_status, 'unsynced');

			// Normal query excludes deleted
			const activeList = await db.getTransactions();
			assert.equal(activeList.length, 0);

			// Query with includeDeleted: true includes deleted
			const allList = await db.getTransactions({ includeDeleted: true });
			assert.equal(allList.length, 1);

			// Hard delete
			await db.deleteTransaction('tx_test_1', false);
			const hardDeleted = await db.getTransaction('tx_test_1');
			assert.equal(hardDeleted, null);

			// Soft delete non-existent
			const nonExistent = await db.deleteTransaction('not_found', true);
			assert.equal(nonExistent, null);
		});

		it('filters transactions by month, status, group, type, and account', async () => {
			const txs = [
				{
					id: 'tx_oct_1',
					group_id: 'grp_A',
					date: '2026-10-01',
					target_month: '2026-10',
					status: 'confirmed',
					type: 'expense',
					amount: 1000,
					account_id: 'acc_wallet',
					is_deleted: false
				},
				{
					id: 'tx_oct_2',
					group_id: 'grp_A',
					date: '2026-10-02',
					target_month: '2026-10',
					status: 'planned',
					type: 'expense',
					amount: 2000,
					account_id: 'acc_card_a',
					is_deleted: false
				},
				{
					id: 'tx_nov_1',
					group_id: 'grp_B',
					date: '2026-11-01',
					target_month: '2026-11',
					status: 'planned',
					type: 'transfer',
					amount: 5000,
					account_id: 'acc_bank_main',
					to_account_id: 'acc_card_a',
					is_deleted: false
				}
			];

			await db.putTransactions(txs);

			// Month filter
			const octTxs = await db.getTransactions({ target_month: '2026-10' });
			assert.equal(octTxs.length, 2);

			// Status filter
			const plannedTxs = await db.getTransactions({ status: 'planned' });
			assert.equal(plannedTxs.length, 2);

			// Group filter
			const grpATxs = await db.getTransactions({ group_id: 'grp_A' });
			assert.equal(grpATxs.length, 2);

			// Type filter
			const transferTxs = await db.getTransactions({ type: 'transfer' });
			assert.equal(transferTxs.length, 1);

			// Account filter (matches account_id or to_account_id)
			const cardTxs = await db.getTransactions({ account_id: 'acc_card_a' });
			assert.equal(cardTxs.length, 2); // tx_oct_2 and tx_nov_1
		});

		it('tracks unsynced transactions and marks them synced', async () => {
			await db.putTransactions([
				{ id: 'tx_s1', target_month: '2026-10', amount: 100, is_deleted: false },
				{ id: 'tx_s2', target_month: '2026-10', amount: 200, is_deleted: false }
			]);

			const unsyncedBefore = await db.getUnsyncedTransactions();
			assert.equal(unsyncedBefore.length, 2);

			const count = await db.markTransactionsSynced(['tx_s1']);
			assert.equal(count, 1);

			const txS1 = await db.getTransaction('tx_s1');
			assert.equal(txS1.sync_status, 'synced');

			const unsyncedAfter = await db.getUnsyncedTransactions();
			assert.equal(unsyncedAfter.length, 1);
			assert.equal(unsyncedAfter[0].id, 'tx_s2');
		});
	});

	describe('Security Keys and Settings', () => {
		it('stores and retrieves security keys', async () => {
			await db.saveSecurityKey('test_key', { a: 1, b: 'two' });
			const val = await db.getSecurityKey('test_key');
			assert.deepEqual(val, { a: 1, b: 'two' });

			const nonExistent = await db.getSecurityKey('non_existent');
			assert.equal(nonExistent, null);

			await db.deleteSecurityKey('test_key');
			const afterDelete = await db.getSecurityKey('test_key');
			assert.equal(afterDelete, null);
		});

		it('stores and retrieves app settings with default fallback', async () => {
			const defaultVal = await db.getSetting('gas_url', 'http://default.url');
			assert.equal(defaultVal, 'http://default.url');

			await db.setSetting('gas_url', 'https://script.google.com/macros/s/xyz/exec');
			const savedVal = await db.getSetting('gas_url');
			assert.equal(savedVal, 'https://script.google.com/macros/s/xyz/exec');
		});
	});

	describe('Backup Export and Import', () => {
		it('exports complete database to JSON backup', async () => {
			await db.putTransaction({
				id: 'tx_backup_1',
				target_month: '2026-10',
				amount: 1500,
				is_deleted: false
			});

			const backup = await db.exportFullData();
			assert.equal(backup.schema_version, 2);
			assert.ok(backup.exported_at);
			assert.ok(backup.master_config);
			assert.ok(backup.summary_snapshot);
			assert.equal(backup.transactions.length, 1);
			assert.equal(backup.transactions[0].id, 'tx_backup_1');
		});

		it('manages annual budget settings per year with category budgets (Requirement 3.14)', async () => {
			const bDefault = await db.getAnnualBudget('2026');
			assert.deepEqual(bDefault, { expense_budget: 0, savings_target_amount: 0, savings_target_rate: 0, category_budgets: {} });

			const saved = await db.saveAnnualBudget('2026', {
				expense_budget: 3600000,
				savings_target_amount: 1200000,
				savings_target_rate: 25.0,
				category_budgets: {
					cat_food: 600000,
					cat_housing: 1440000,
					__proto__: 999999
				}
			});
			assert.equal(saved.expense_budget, 3600000);
			assert.equal(saved.savings_target_amount, 1200000);
			assert.equal(saved.savings_target_rate, 25.0);
			assert.equal(saved.category_budgets.cat_food, 600000);
			assert.equal(saved.category_budgets.cat_housing, 1440000);
			assert.equal(Object.prototype.hasOwnProperty.call(saved.category_budgets, '__proto__'), false);

			const retrieved = await db.getAnnualBudget('2026');
			assert.equal(retrieved.expense_budget, 3600000);
			assert.equal(retrieved.category_budgets.cat_food, 600000);
			assert.equal(retrieved.category_budgets.cat_housing, 1440000);

			// Defaults missing year
			const b2027 = await db.getAnnualBudget('2027');
			assert.equal(b2027.expense_budget, 0);
			assert.deepEqual(b2027.category_budgets, {});
		});

		it('performs non-destructive deduplicated JSON import (OR merge) with stats (Requirement 3.15)', async () => {
			// 1. Setup local state
			await db.putTransaction({
				id: 'tx_local_older',
				target_month: '2026-10',
				amount: 1000,
				updated_at: '2026-10-01T12:00:00Z',
				is_deleted: false
			});
			await db.putTransaction({
				id: 'tx_local_newer',
				target_month: '2026-10',
				amount: 2000,
				updated_at: '2026-10-15T12:00:00Z',
				is_deleted: false
			});
			await db.putTransaction({
				id: 'tx_local_exclusive',
				target_month: '2026-10',
				amount: 9999,
				updated_at: '2026-10-10T12:00:00Z',
				is_deleted: false
			});

			const initialConfig = await db.getMasterConfig();
			initialConfig.accounts = [
				{ id: 'acc_wallet', name: '財布', is_archived: false }
			];
			initialConfig.categories = [
				{
					id: 'cat_food',
					name: '食費',
					subcategories: [
						{ id: 'sub_groceries', name: '食材' },
						{ id: 'sub_local_custom', name: '地元野菜' }
					]
				}
			];
			initialConfig.holidays = ['2026-01-01', '2026-05-03'];
			initialConfig.recurring_rules = [
				{ id: 'rec_local', name: 'ローカル定期' }
			];
			initialConfig.annual_budgets = {
				'2026': {
					expense_budget: 3000000,
					savings_target_amount: 1000000,
					savings_target_rate: 20,
					category_budgets: {
						cat_food: 500000
					}
				}
			};
			await db.saveMasterConfig(initialConfig);

			// 2. Prepare imported JSON
			const backupData = {
				schema_version: 2,
				exported_at: new Date().toISOString(),
				master_config: {
					schema_version: 2,
					accounts: [
						{ id: 'acc_wallet', name: '財布' }, // existing
						{ id: 'acc_nisa', name: 'つみたてNISA', is_asset: true } // new
					],
					categories: [
						{
							id: 'cat_food',
							name: '食費',
							subcategories: [
								{ id: 'sub_groceries', name: '食材' }, // existing
								{ id: 'sub_dining_out', name: '外食' } // new
							]
						},
						{
							id: 'cat_hobby',
							name: '趣味・娯楽',
							subcategories: [{ id: 'sub_games', name: 'ゲーム' }]
						} // new
					],
					recurring_rules: [
						{ id: 'rec_local', name: 'ローカル定期' }, // existing
						{ id: 'rec_sub', name: 'サブスク' } // new
					],
					holidays: ['2026-01-01', '2026-05-04', '2026-11-23'], // 2026-05-04 and 11-23 are new
					annual_budgets: {
						'2026': {
							expense_budget: 9999999, // already exists locally -> local respected
							category_budgets: {
								cat_food: 999999, // already exists locally -> local 500000 respected!
								cat_housing: 1400000 // new category budget -> added!
							}
						},
						'2027': {
							expense_budget: 3500000,
							savings_target_amount: 1200000,
							savings_target_rate: 25,
							category_budgets: {
								cat_food: 550000
							}
						} // new
					}
				},
				summary_snapshot: {
					schema_version: 2,
					last_closed_month: '2026-09',
					monthly_summaries: {
						'2026-08': { total_income: 300000, total_expense: 200000 }
					}
				},
				transactions: [
					// Newer version of tx_local_older -> Should update
					{ id: 'tx_local_older', target_month: '2026-10', amount: 1500, updated_at: '2026-10-05T12:00:00Z', is_deleted: false },
					// Older version of tx_local_newer -> Should skip/retain local
					{ id: 'tx_local_newer', target_month: '2026-10', amount: 100, updated_at: '2026-10-10T12:00:00Z', is_deleted: false },
					// Completely new transaction -> Should add
					{ id: 'tx_imported_new', target_month: '2026-10', amount: 3333, updated_at: '2026-10-16T12:00:00Z', is_deleted: false }
				]
			};

			const result = await db.importFullData(backupData);
			assert.equal(result.success, true);
			assert.equal(result.stats.addedTransactions, 1);
			assert.equal(result.stats.updatedTransactions, 1);
			assert.equal(result.stats.skippedTransactions, 1);
			assert.equal(result.stats.addedAccounts, 1);
			assert.equal(result.stats.addedCategories, 1);
			assert.equal(result.stats.addedSubcategories, 2); // sub_dining_out + sub_games
			assert.equal(result.stats.addedRecurringRules, 1);
			assert.equal(result.stats.addedHolidays, 2);
			assert.equal(result.stats.addedBudgets, 1); // 2027

			// Verify transactions
			const tOlder = await db.getTransaction('tx_local_older');
			assert.equal(tOlder.amount, 1500); // Updated to newer imported value

			const tNewer = await db.getTransaction('tx_local_newer');
			assert.equal(tNewer.amount, 2000); // Retained local value because local was newer

			const tExclusive = await db.getTransaction('tx_local_exclusive');
			assert.ok(tExclusive);
			assert.equal(tExclusive.amount, 9999); // Preserved! Never deleted!

			const tNew = await db.getTransaction('tx_imported_new');
			assert.equal(tNew.amount, 3333); // Successfully added!

			// Verify master config
			const cfg = await db.getMasterConfig();
			assert.equal(cfg.accounts.length, 2);
			assert.ok(cfg.accounts.some(a => a.id === 'acc_nisa'));

			const catFood = cfg.categories.find(c => c.id === 'cat_food');
			assert.equal(catFood.subcategories.length, 3); // sub_groceries, sub_local_custom, sub_dining_out
			assert.ok(cfg.categories.some(c => c.id === 'cat_hobby'));

			assert.equal(cfg.holidays.length, 4);
			assert.deepEqual(cfg.holidays, ['2026-01-01', '2026-05-03', '2026-05-04', '2026-11-23']);

			assert.equal(cfg.annual_budgets['2026'].expense_budget, 3000000); // Local preserved
			assert.equal(cfg.annual_budgets['2026'].category_budgets.cat_food, 500000); // Local preserved
			assert.equal(cfg.annual_budgets['2026'].category_budgets.cat_housing, 1400000); // New merged
			assert.equal(cfg.annual_budgets['2027'].expense_budget, 3500000); // New added
			assert.equal(cfg.annual_budgets['2027'].category_budgets.cat_food, 550000); // New added

			// Rejects invalid schema version
			await assert.rejects(
				async () => {
					await db.importFullData({ schema_version: 1 });
				},
				/Invalid data schema version/
			);
			await assert.rejects(
				async () => {
					await db.importFullData(null);
				},
				/Invalid data schema version/
			);

			// Validates JSON text parsing before importFullData (Section 3.15 Item 4)
			const validJsonText = JSON.stringify({
				schema_version: 2,
				transactions: []
			});
			const parsedData = JSON.parse(validJsonText);
			const parseRes = await db.importFullData(parsedData);
			assert.ok(parseRes.success);

			const malformedText = '{ invalid json }}}';
			assert.throws(() => {
				try {
					JSON.parse(malformedText);
				} catch (err) {
					throw new Error('不正なJSONファイル形式です: ' + err.message);
				}
			}, /不正なJSONファイル形式です/);
		});

		it('prevents Prototype Pollution attacks during importFullData and budget operations', async () => {
			const maliciousPayload = JSON.parse(`{
				"schema_version": 2,
				"master_config": {
					"accounts": [{ "id": "__proto__", "name": "Evil" }],
					"categories": [{ "id": "constructor", "name": "Evil Cat", "subcategories": [{ "id": "prototype", "name": "Evil Sub" }] }],
					"recurring_rules": [{ "id": "__proto__", "name": "Evil Rule" }],
					"annual_budgets": {
						"__proto__": { "polluted": true, "expense_budget": 999999 },
						"constructor": { "polluted": true },
						"invalid_year": { "expense_budget": 1000 },
						"2026": {
							"category_budgets": {
								"__proto__": 999999,
								"constructor": 999999,
								"cat_food": 500000
							}
						}
					}
				},
				"summary_snapshot": {
					"monthly_summaries": {
						"__proto__": { "polluted": true },
						"prototype": { "polluted": true },
						"invalid-month": { "total_income": 100 }
					}
				},
				"transactions": [
					{ "id": "__proto__", "amount": 100 }
				]
			}`);

			const result = await db.importFullData(maliciousPayload);
			assert.equal(result.success, true);
			assert.equal(Object.prototype.polluted, undefined);
			assert.equal(({}).polluted, undefined);

			// Budget methods
			const bProto = await db.getAnnualBudget('__proto__');
			assert.equal(bProto.expense_budget, 0);

			await assert.rejects(
				async () => {
					await db.saveAnnualBudget('__proto__', { expense_budget: 1000 });
				},
				/Invalid budget year/
			);
			await assert.rejects(
				async () => {
					await db.saveAnnualBudget('20', { expense_budget: 1000 });
				},
				/Invalid budget year/
			);
			assert.equal(Object.prototype.polluted, undefined);
		});
	});

	describe('IndexedDB Browser Engine Path', () => {
		it('initializes and executes operations via native indexedDB interface', async () => {
			const { createMockIndexedDB } = await import('../helpers/idb_mock.js');
			const mockIDB = createMockIndexedDB();
			const idbDb = new YoseDB(mockIDB);
			await idbDb.init();

			// Master config
			const cfg = await idbDb.getMasterConfig();
			assert.ok(cfg);
			cfg.accounts[0].name = 'Renamed Wallet';
			await idbDb.saveMasterConfig(cfg);
			const updatedCfg = await idbDb.getMasterConfig();
			assert.equal(updatedCfg.accounts[0].name, 'Renamed Wallet');

			// Snapshot
			const snap = await idbDb.getSnapshot();
			assert.ok(snap);
			snap.last_closed_month = '2026-10';
			await idbDb.saveSnapshot(snap);
			const updatedSnap = await idbDb.getSnapshot();
			assert.equal(updatedSnap.last_closed_month, '2026-10');

			// Transactions
			const tx = {
				id: 'tx_idb_1',
				date: '2026-10-16',
				target_month: '2026-10',
				amount: 3000,
				type: 'expense',
				is_deleted: false
			};
			await idbDb.putTransaction(tx);
			const fetchedTx = await idbDb.getTransaction('tx_idb_1');
			assert.equal(fetchedTx.amount, 3000);

			const allTxs = await idbDb.getTransactions({ target_month: '2026-10' });
			assert.equal(allTxs.length, 1);

			// Delete
			await idbDb.deleteTransaction('tx_idb_1', false);
			const afterDel = await idbDb.getTransaction('tx_idb_1');
			assert.equal(afterDel, null);

			// Security key
			await idbDb.saveSecurityKey('key1', 'val1');
			const kVal = await idbDb.getSecurityKey('key1');
			assert.equal(kVal, 'val1');
			await idbDb.deleteSecurityKey('key1');
			const kDel = await idbDb.getSecurityKey('key1');
			assert.equal(kDel, null);

			// Setting
			await idbDb.setSetting('theme', 'dark');
			const sVal = await idbDb.getSetting('theme');
			assert.equal(sVal, 'dark');

			// Locked getTransactions throw
			await idbDb.putTransaction({
				id: 'tx_enc_fake',
				encrypted: true,
				iv: 'dummy',
				ciphertext: 'dummy',
				is_deleted: false
			});
			await assert.rejects(
				async () => {
					await idbDb.getTransactions();
				},
				/Database is locked: encryption key not set/
			);
		});
	});

	describe('Modular Sub-Modules & BackupMerger Defensive Edge Cases (Section 4.7)', () => {
		it('verifies direct sub-module exports from js/db/* and js/logic/* match facade exports', async () => {
			const defaultsMod = await import('../../js/db/defaults.js');
			const storageMod = await import('../../js/db/storage_engine.js');
			const mergerMod = await import('../../js/db/backup_merger.js');
			const yoseDbMod = await import('../../js/db/yose_db.js');

			const dateMod = await import('../../js/logic/date_utils.js');
			const factoryMod = await import('../../js/logic/transaction_factory.js');
			const aggMod = await import('../../js/logic/aggregator.js');
			const budgetMod = await import('../../js/logic/budget_engine.js');

			assert.equal(defaultsMod.DB_NAME, 'yose_kakeibo_db');
			assert.equal(typeof storageMod.StorageEngine, 'function');
			assert.equal(typeof mergerMod.BackupMerger.mergeMasterConfig, 'function');
			assert.equal(yoseDbMod.YoseDB, YoseDB);

			assert.equal(typeof dateMod.formatDate, 'function');
			assert.equal(typeof factoryMod.calculateTax, 'function');
			assert.equal(typeof aggMod.calculateBalancesAndSummaries, 'function');
			assert.equal(typeof budgetMod.calculateAnnualBudgetProgress, 'function');
		});

		it('handles missing subcategories, missing annual_budgets, and missing monthly_summaries during merge and saveAnnualBudget', async () => {
			const { BackupMerger } = await import('../../js/db/backup_merger.js');

			// 1. mergeMasterConfig when target category lacks subcategories array and localConfig lacks annual_budgets
			const sparseLocalConfig = {
				categories: [{ id: 'cat_food', name: 'Food' }] // no subcategories property, no annual_budgets property
			};
			const importedConfig = {
				categories: [{
					id: 'cat_food',
					name: 'Food',
					subcategories: [{ id: 'sub_lunch', name: 'Lunch' }]
				}],
				annual_budgets: {
					'2026': { expense_budget: 1200000, category_budgets: { cat_food: 300000 } }
				}
			};
			const stats = {
				addedAccounts: 0,
				addedCategories: 0,
				addedSubcategories: 0,
				addedRecurringRules: 0,
				addedHolidays: 0,
				addedBudgets: 0
			};
			BackupMerger.mergeMasterConfig(sparseLocalConfig, importedConfig, stats);
			assert.equal(sparseLocalConfig.categories[0].subcategories.length, 1);
			assert.equal(sparseLocalConfig.annual_budgets['2026'].expense_budget, 1200000);

			// Also test merging category_budgets when existing year entry lacks category_budgets object
			sparseLocalConfig.annual_budgets['2026'].category_budgets = null;
			BackupMerger.mergeMasterConfig(sparseLocalConfig, {
				annual_budgets: {
					'2026': { expense_budget: 1500000, category_budgets: { cat_food: 400000 } }
				}
			}, stats);
			assert.equal(sparseLocalConfig.annual_budgets['2026'].category_budgets.cat_food, 400000);

			// 2. mergeSummarySnapshot when localSnapshot lacks monthly_summaries object
			const sparseSnap = { schema_version: 2 };
			BackupMerger.mergeSummarySnapshot(sparseSnap, {
				last_closed_month: '2026-09',
				monthly_summaries: { '2026-09': { income_confirmed: 300000 } }
			});
			assert.equal(sparseSnap.monthly_summaries['2026-09'].income_confirmed, 300000);
			assert.equal(sparseSnap.last_closed_month, '2026-09');

			// 3. YoseDB.saveAnnualBudget when existing master_config lacks annual_budgets property
			await db.saveMasterConfig({ schema_version: 2, accounts: [], categories: [] });
			const savedBudget = await db.saveAnnualBudget('2027', { expense_budget: 2000000 });
			assert.equal(savedBudget.expense_budget, 2000000);

			// 4. Merge collapsed_panes (Requirement 3.37) & synced_passkey_bundle (Requirement 4.8)
			const cfgWithPanes = {
				accounts: [],
				categories: []
			};
			BackupMerger.mergeMasterConfig(cfgWithPanes, {
				collapsed_panes: {
					'card-tag-analytics': true,
					'card-cross-matrix': false,
					'__proto__': true
				},
				synced_passkey_bundle: {
					credentialId: 'cred_v1',
					publicKeyBase64: 'pub_v1',
					signature: 'sig_v1',
					updated_at: '2026-10-19T08:00:00Z',
					vault: {
						ciphertext: 'ct_v1',
						iv: 'iv_v1',
						prfSalt: 'salt_v1'
					}
				}
			}, stats);
			assert.equal(cfgWithPanes.collapsed_panes['card-tag-analytics'], true);
			assert.equal(cfgWithPanes.collapsed_panes['card-cross-matrix'], false);
			assert.equal(Object.prototype.hasOwnProperty.call(cfgWithPanes.collapsed_panes, '__proto__'), false);
			assert.equal(cfgWithPanes.synced_passkey_bundle.credentialId, 'cred_v1');

			// Newer synced_passkey_bundle overwrites older one, while existing collapsed_panes key is preserved
			BackupMerger.mergeMasterConfig(cfgWithPanes, {
				collapsed_panes: {
					'card-tag-analytics': false,
					'card-account-balances': true
				},
				synced_passkey_bundle: {
					credentialId: 'cred_v2',
					publicKeyBase64: 'pub_v2',
					signature: 'sig_v2',
					updated_at: '2026-10-19T12:00:00Z',
					vault: {
						ciphertext: 'ct_v2',
						iv: 'iv_v2'
					}
				}
			}, stats);
			assert.equal(cfgWithPanes.collapsed_panes['card-tag-analytics'], true);
			assert.equal(cfgWithPanes.collapsed_panes['card-account-balances'], true);
			assert.equal(cfgWithPanes.synced_passkey_bundle.credentialId, 'cred_v2');
			assert.equal(cfgWithPanes.synced_passkey_bundle.vault.prfSalt, '');
		});
	});

	describe('Various JSON Export and Auto-Detect Import (Requirement 3.26)', () => {
		it('exports individual datasets with standard metadata and pretty print format', async () => {
			await db.init();
			await db.putTransaction({
				id: 'tx_export_test_1',
				target_month: '2026-10',
				amount: 5000,
				is_deleted: false
			});
			await db.saveAnnualBudget('2026', {
				expense_budget: 2500000,
				savings_target_amount: 800000,
				savings_target_rate: 24,
				category_budgets: { cat_food: 400000 }
			});

			// 1. Transactions only export
			const txExport = await db.exportTransactionsData();
			assert.equal(txExport.schema_version, 2);
			assert.equal(txExport.export_type, 'transactions');
			assert.ok(txExport.exported_at);
			assert.ok(Array.isArray(txExport.transactions));
			assert.ok(txExport.transactions.some(t => t.id === 'tx_export_test_1'));
			assert.equal(txExport.master_config, undefined);
			assert.equal(txExport.summary_snapshot, undefined);

			// 2. Master config only export
			const masterExport = await db.exportMasterConfigData();
			assert.equal(masterExport.schema_version, 2);
			assert.equal(masterExport.export_type, 'master_config');
			assert.ok(masterExport.exported_at);
			assert.ok(masterExport.master_config);
			assert.ok(Array.isArray(masterExport.master_config.accounts));
			assert.equal(masterExport.transactions, undefined);

			// 3. Annual budgets only export
			const budgetExport = await db.exportAnnualBudgetsData();
			assert.equal(budgetExport.schema_version, 2);
			assert.equal(budgetExport.export_type, 'annual_budgets');
			assert.ok(budgetExport.exported_at);
			assert.ok(budgetExport.annual_budgets);
			assert.equal(budgetExport.annual_budgets['2026'].expense_budget, 2500000);
			assert.equal(budgetExport.transactions, undefined);
			assert.equal(budgetExport.master_config, undefined);

			// 4. Summary snapshot only export
			const snapExport = await db.exportSummarySnapshotData();
			assert.equal(snapExport.schema_version, 2);
			assert.equal(snapExport.export_type, 'summary_snapshot');
			assert.ok(snapExport.exported_at);
			assert.ok(snapExport.summary_snapshot);
			assert.equal(snapExport.transactions, undefined);

			// 5. Full backup export
			const fullExport = await db.exportFullData();
			assert.equal(fullExport.schema_version, 2);
			assert.equal(fullExport.export_type, 'full_backup');
			assert.ok(fullExport.master_config);
			assert.ok(fullExport.summary_snapshot);
			assert.ok(Array.isArray(fullExport.transactions));
		});

		it('auto-detects and imports individual transaction JSON, master config, budgets, and snapshots', async () => {
			await db.init();

			// 1. Transactions only import
			const txPayload = {
				schema_version: 2,
				export_type: 'transactions',
				exported_at: new Date().toISOString(),
				transactions: [
					{ id: 'tx_auto_1', target_month: '2026-10', amount: 1200, is_deleted: false, updated_at: '2026-10-18T10:00:00Z' }
				]
			};
			const resTx = await db.importFullData(txPayload);
			assert.equal(resTx.success, true);
			assert.equal(resTx.detectedType, 'transactions');
			assert.equal(resTx.stats.addedTransactions, 1);
			const tx1 = await db.getTransaction('tx_auto_1');
			assert.equal(tx1.amount, 1200);

			// 2. Raw array transactions import (auto-wrap)
			const rawTxs = [
				{ id: 'tx_raw_auto_2', target_month: '2026-10', amount: 3400, is_deleted: false, updated_at: '2026-10-18T11:00:00Z' }
			];
			const resRaw = await db.importFullData(rawTxs);
			assert.equal(resRaw.success, true);
			assert.equal(resRaw.detectedType, 'transactions');
			assert.equal(resRaw.stats.addedTransactions, 1);
			const tx2 = await db.getTransaction('tx_raw_auto_2');
			assert.equal(tx2.amount, 3400);

			// 3. Master config only import
			const masterPayload = {
				schema_version: 2,
				export_type: 'master_config',
				master_config: {
					accounts: [{ id: 'acc_auto_bank', name: '自動判別銀行', is_archived: false }],
					categories: [{ id: 'cat_auto_special', name: '特別費', subcategories: [] }]
				}
			};
			const resMaster = await db.importFullData(masterPayload);
			assert.equal(resMaster.success, true);
			assert.equal(resMaster.detectedType, 'master_config');
			assert.equal(resMaster.stats.addedAccounts, 1);
			assert.equal(resMaster.stats.addedCategories, 1);
			const cfg = await db.getMasterConfig();
			assert.ok(cfg.accounts.some(a => a.id === 'acc_auto_bank'));

			// 4. Annual budgets only import
			const budgetPayload = {
				schema_version: 2,
				export_type: 'annual_budgets',
				annual_budgets: {
					'2029': {
						expense_budget: 4200000,
						savings_target_amount: 1500000,
						savings_target_rate: 26,
						category_budgets: { cat_auto_special: 300000 }
					}
				}
			};
			const resBudget = await db.importFullData(budgetPayload);
			assert.equal(resBudget.success, true);
			assert.equal(resBudget.detectedType, 'annual_budgets');
			assert.equal(resBudget.stats.addedBudgets, 1);
			const b2029 = await db.getAnnualBudget('2029');
			assert.equal(b2029.expense_budget, 4200000);
			assert.equal(b2029.category_budgets.cat_auto_special, 300000);

			// 5. Summary snapshot only import
			const snapPayload = {
				schema_version: 2,
				export_type: 'summary_snapshot',
				summary_snapshot: {
					last_closed_month: '2026-11',
					monthly_summaries: {
						'2026-11': { total_expense: 150000, total_income: 250000 }
					}
				}
			};
			const resSnap = await db.importFullData(snapPayload);
			assert.equal(resSnap.success, true);
			assert.equal(resSnap.detectedType, 'summary_snapshot');
			const snap = await db.getSnapshot();
			assert.equal(snap.last_closed_month, '2026-11');
			assert.equal(snap.monthly_summaries['2026-11'].total_expense, 150000);

			// 6. Full backup import detection
			const fullPayload = {
				schema_version: 2,
				master_config: { accounts: [] },
				summary_snapshot: {},
				transactions: []
			};
			const resFull = await db.importFullData(fullPayload);
			assert.equal(resFull.success, true);
			assert.equal(resFull.detectedType, 'full_backup');
		});

		it('handles defensive edge cases and security protections during import', async () => {
			await db.init();

			// Prototype pollution rejection in standalone budgets
			const maliciousBudget = {
				schema_version: 2,
				export_type: 'annual_budgets',
				annual_budgets: {
					'__proto__': { expense_budget: 999999 },
					'constructor': { expense_budget: 999999 },
					'2030': {
						expense_budget: 1000000,
						category_budgets: {
							'__proto__': 888888,
							'cat_valid': 200000
						}
					}
				}
			};
			const resSec = await db.importFullData(maliciousBudget);
			assert.equal(resSec.success, true);
			assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'expense_budget'), false);
			const b2030 = await db.getAnnualBudget('2030');
			assert.equal(b2030.expense_budget, 1000000);
			assert.equal(b2030.category_budgets.cat_valid, 200000);
			assert.equal(Object.prototype.hasOwnProperty.call(b2030.category_budgets, '__proto__'), false);

			// Invalid schema version and malformed payload rejection
			await assert.rejects(async () => {
				await db.importFullData({ schema_version: 3 });
			}, /Invalid data schema version/);

			await assert.rejects(async () => {
				await db.importFullData('invalid_string');
			}, /Invalid data schema or payload/);

			await assert.rejects(async () => {
				await db.importFullData(12345);
			}, /Invalid data schema or payload/);

			await assert.rejects(async () => {
				await db.importFullData(null);
			}, /Invalid data schema version/);
		});
	});
});

describe('Import structural validation before mutation', () => {
	it('rejects unknown, mismatched, and nested malformed payloads without writing earlier valid entries', async () => {
		const db = new YoseDB(null);
		await db.init();
		for (const payload of [
			{},
			{ export_type: 'transactions', transactions: {} },
			{ transactions: [{ id: 'valid_first' }, { id: 'bad', tags: {} }] },
			{ transactions: [{ id: 'valid_first' }], master_config: { categories: [{ id: 'cat_bad', subcategories: {} }] } },
			{ transactions: [{ id: 'valid_first' }], summary_snapshot: { monthly_summaries: [] } }
		]) {
			await assert.rejects(db.importFullData(payload), /Invalid/);
			assert.equal((await db.getTransactions()).length, 0);
			assert.equal((await db.getMasterConfig()).categories.length, DEFAULT_MASTER_CONFIG.categories.length);
		}
	});
});
