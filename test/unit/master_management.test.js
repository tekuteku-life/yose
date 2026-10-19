import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';

describe('js/db.js & Master Management - Unit Tests', () => {
	let db;

	beforeEach(async () => {
		db = new YoseDB(null);
		await db.init();
	});

	describe('Account Master Operations', () => {
		it('adds a new account to master config and saves to db', async () => {
			const config = await db.getMasterConfig();
			const newAcc = {
				id: 'acc_paypay',
				name: 'PayPay残高',
				type: 'cash',
				initial_balance: 3000,
				is_asset: true,
				sort_order: 10,
				is_archived: false
			};
			config.accounts.push(newAcc);
			await db.saveMasterConfig(config);

			const updated = await db.getMasterConfig();
			assert.ok(updated.accounts.some(a => a.id === 'acc_paypay'));
			const found = updated.accounts.find(a => a.id === 'acc_paypay');
			assert.equal(found.name, 'PayPay残高');
			assert.equal(found.initial_balance, 3000);
		});

		it('edits an existing account in master config', async () => {
			const config = await db.getMasterConfig();
			const wallet = config.accounts.find(a => a.id === 'acc_wallet');
			assert.ok(wallet);
			wallet.name = '現金（メイン財布）';
			wallet.initial_balance = 20000;
			await db.saveMasterConfig(config);

			const updated = await db.getMasterConfig();
			const updatedWallet = updated.accounts.find(a => a.id === 'acc_wallet');
			assert.equal(updatedWallet.name, '現金（メイン財布）');
			assert.equal(updatedWallet.initial_balance, 20000);
		});

		it('archives and unarchives an account', async () => {
			const config = await db.getMasterConfig();
			const card = config.accounts.find(a => a.id === 'acc_card_a');
			card.is_archived = true;
			await db.saveMasterConfig(config);

			let updated = await db.getMasterConfig();
			assert.equal(updated.accounts.find(a => a.id === 'acc_card_a').is_archived, true);

			// Unarchive
			card.is_archived = false;
			await db.saveMasterConfig(config);
			updated = await db.getMasterConfig();
			assert.equal(updated.accounts.find(a => a.id === 'acc_card_a').is_archived, false);
		});
	});

	describe('Category & Subcategory Master Operations', () => {
		it('adds a new category with subcategories', async () => {
			const config = await db.getMasterConfig();
			const newCat = {
				id: 'cat_hobby',
				type: 'expense',
				name: '趣味・娯楽',
				sort_order: 5,
				is_archived: false,
				subcategories: [
					{ id: 'sub_books', name: '書籍', sort_order: 1, is_archived: false },
					{ id: 'sub_games', name: 'ゲーム', sort_order: 2, is_archived: false }
				]
			};
			config.categories.push(newCat);
			await db.saveMasterConfig(config);

			const updated = await db.getMasterConfig();
			const found = updated.categories.find(c => c.id === 'cat_hobby');
			assert.ok(found);
			assert.equal(found.subcategories.length, 2);
		});

		it('adds and edits subcategories within an existing category', async () => {
			const config = await db.getMasterConfig();
			const food = config.categories.find(c => c.id === 'cat_food');
			assert.ok(food);

			// Add subcategory
			food.subcategories.push({
				id: 'sub_cafe',
				name: 'カフェ',
				sort_order: 3,
				is_archived: false
			});
			await db.saveMasterConfig(config);

			let updated = await db.getMasterConfig();
			let updatedFood = updated.categories.find(c => c.id === 'cat_food');
			assert.ok(updatedFood.subcategories.some(s => s.id === 'sub_cafe'));

			// Edit subcategory
			const cafe = updatedFood.subcategories.find(s => s.id === 'sub_cafe');
			cafe.name = 'カフェ・喫茶店';
			await db.saveMasterConfig(updated);

			updated = await db.getMasterConfig();
			updatedFood = updated.categories.find(c => c.id === 'cat_food');
			assert.equal(updatedFood.subcategories.find(s => s.id === 'sub_cafe').name, 'カフェ・喫茶店');
		});

		it('archives category and subcategory', async () => {
			const config = await db.getMasterConfig();
			const social = config.categories.find(c => c.id === 'cat_social');
			social.is_archived = true;
			social.subcategories[0].is_archived = true;
			await db.saveMasterConfig(config);

			const updated = await db.getMasterConfig();
			const updatedSocial = updated.categories.find(c => c.id === 'cat_social');
			assert.equal(updatedSocial.is_archived, true);
			assert.equal(updatedSocial.subcategories[0].is_archived, true);
		});
	});

	describe('Recurring Rules Master Operations', () => {
		it('adds, edits, and toggles recurring rules', async () => {
			const config = await db.getMasterConfig();
			const newRule = {
				id: 'rec_gym',
				name: 'フィットネス会費',
				is_active: true,
				start_date: '2026-10-01',
				end_date: null,
				frequency: 'interval_months',
				interval_months: 1,
				day_of_month: 20,
				holiday_adjustment: 'none',
				amortize_months: 1,
				type: 'expense',
				amount: 8800,
				account_id: 'acc_card_a',
				category_id: 'cat_social',
				subcategory_id: 'sub_leisure'
			};
			config.recurring_rules.push(newRule);
			await db.saveMasterConfig(config);

			let updated = await db.getMasterConfig();
			const found = updated.recurring_rules.find(r => r.id === 'rec_gym');
			assert.ok(found);
			assert.equal(found.amount, 8800);

			// Edit amount
			found.amount = 9900;
			found.is_active = false;
			await db.saveMasterConfig(updated);

			updated = await db.getMasterConfig();
			const updatedRule = updated.recurring_rules.find(r => r.id === 'rec_gym');
			assert.equal(updatedRule.amount, 9900);
			assert.equal(updatedRule.is_active, false);
		});
	});

	describe('Holiday List Master Operations', () => {
		it('adds and removes holidays from holidays array', async () => {
			const config = await db.getMasterConfig();
			assert.ok(Array.isArray(config.holidays));

			// Add a custom holiday
			const customHoliday = '2026-12-31';
			config.holidays.push(customHoliday);
			config.holidays.sort();
			await db.saveMasterConfig(config);

			let updated = await db.getMasterConfig();
			assert.ok(updated.holidays.includes(customHoliday));

			// Remove a holiday
			updated.holidays = updated.holidays.filter(h => h !== customHoliday);
			await db.saveMasterConfig(updated);

			updated = await db.getMasterConfig();
			assert.equal(updated.holidays.includes(customHoliday), false);
		});
	});

	describe('Investment Account Master Operations (Integrated Asset Accounts)', () => {
		it('manages investment/asset accounts with market valuation in account balances', async () => {
			const config = await db.getMasterConfig();
			const nisaAcc = {
				id: 'acc_nisa_sp500',
				name: 'つみたてNISA (S&P500)',
				type: 'investment',
				initial_balance: 500000,
				is_asset: true,
				sort_order: 15,
				is_archived: false
			};
			config.accounts.push(nisaAcc);
			await db.saveMasterConfig(config);

			const updated = await db.getMasterConfig();
			const found = updated.accounts.find(a => a.id === 'acc_nisa_sp500');
			assert.ok(found);
			assert.equal(found.type, 'investment');
			assert.equal(found.initial_balance, 500000);

			// Verify updating valuation balance
			const snapshot = await db.getSnapshot();
			snapshot.account_balances['acc_nisa_sp500'] = 650000;
			await db.saveSnapshot(snapshot);

			const updatedSnapshot = await db.getSnapshot();
			assert.equal(updatedSnapshot.account_balances['acc_nisa_sp500'], 650000);
		});
	});

	describe('Encrypted Database Operations (AES-GCM-256 At-Rest)', () => {
		it('encrypts records when encryption key is active and decrypts transparently', async () => {
			const { generateDatabaseMasterKey } = await import('../../js/crypto.js');
			const dmk = await generateDatabaseMasterKey();

			// Enable encryption on db
			db.setEncryptionKey(dmk);
			assert.equal(db.isEncrypted(), true);

			// Save transaction
			const tx = {
				id: 'tx_enc_1',
				target_month: '2026-10',
				date: '2026-10-17',
				amount: 15000,
				type: 'expense',
				memo: 'Secret transaction'
			};
			await db.saveTransaction(tx);

			// Fetch transaction with key active -> transparently decrypted
			const retrieved = await db.getTransaction('tx_enc_1');
			assert.ok(retrieved);
			assert.equal(retrieved.memo, 'Secret transaction');
			assert.equal(retrieved.amount, 15000);

			// Lock database (clear key)
			db.clearEncryptionKey();
			assert.equal(db.isEncrypted(), false);

			// Attempting to read encrypted transaction without key throws error
			await assert.rejects(async () => {
				await db.getTransaction('tx_enc_1');
			}, /locked/i);

			// Verify master_config and summary_snapshot also require active key when encrypted
			db.setEncryptionKey(dmk);
			const cfg = await db.getMasterConfig();
			await db.saveMasterConfig(cfg);
			const snap = await db.getSnapshot();
			await db.saveSnapshot(snap);

			// Clear key -> lock
			db.clearEncryptionKey();
			await assert.rejects(async () => {
				await db.getMasterConfig();
			}, /locked/i);
			await assert.rejects(async () => {
				await db.getSnapshot();
			}, /locked/i);
		});

		it('initializes cleanly without throwing locked error even when DB has encrypted records at rest', async () => {
			const storage = {
				master_config: new Map([['current', { encrypted: true, iv: 'abc', ciphertext: 'xyz' }]]),
				summary_snapshot: new Map([['current', { encrypted: true, iv: 'def', ciphertext: 'uvw' }]]),
				security_keys: new Map(),
				settings: new Map(),
				transactions: new Map()
			};

			const mockDb = {
				objectStoreNames: {
					contains: (name) => name in storage
				},
				createObjectStore: () => ({ createIndex: () => {} }),
				transaction: (storeNames, mode) => {
					const tx = {
						oncomplete: null,
						onerror: null,
						objectStore: (name) => ({
							get: (key) => {
								const req = { onsuccess: null, onerror: null, result: storage[name]?.get(key) };
								queueMicrotask(() => req.onsuccess && req.onsuccess());
								return req;
							},
							put: (val, key) => {
								storage[name]?.set(key, val);
								const req = { onsuccess: null, onerror: null, result: key };
								queueMicrotask(() => req.onsuccess && req.onsuccess());
								return req;
							}
						})
					};
					queueMicrotask(() => tx.oncomplete && tx.oncomplete());
					return tx;
				}
			};

			const mockIdb = {
				open: () => {
					const req = {
						onupgradeneeded: null,
						onsuccess: null,
						onerror: null,
						result: mockDb
					};
					queueMicrotask(() => req.onsuccess && req.onsuccess());
					return req;
				}
			};

			const encDb = new YoseDB(mockIdb);
			// DB has not been unlocked yet (encDb.encryptionKey is null)
			await encDb.init();
			assert.ok(encDb.db);
			// Data remains intact in encrypted state, not overwritten by defaults
			assert.equal(storage.master_config.get('current').encrypted, true);
		});

		it('initializes default master config and snapshot on fresh IndexedDB setup', async () => {
			const storage = {
				master_config: new Map(),
				summary_snapshot: new Map(),
				security_keys: new Map(),
				settings: new Map(),
				transactions: new Map()
			};

			const mockDb = {
				objectStoreNames: {
					contains: (name) => false
				},
				createObjectStore: (name) => ({
					createIndex: () => {}
				}),
				transaction: (storeNames, mode) => {
					const tx = {
						oncomplete: null,
						onerror: null,
						objectStore: (name) => ({
							get: (key) => {
								const req = { onsuccess: null, onerror: null, result: storage[name]?.get(key) };
								queueMicrotask(() => req.onsuccess && req.onsuccess());
								return req;
							},
							put: (val, key) => {
								storage[name]?.set(key, val);
								const req = { onsuccess: null, onerror: null, result: key };
								queueMicrotask(() => req.onsuccess && req.onsuccess());
								return req;
							}
						})
					};
					queueMicrotask(() => tx.oncomplete && tx.oncomplete());
					return tx;
				}
			};

			const mockIdb = {
				open: () => {
					const req = {
						onupgradeneeded: null,
						onsuccess: null,
						onerror: null,
						result: mockDb
					};
					queueMicrotask(() => {
						if (req.onupgradeneeded) req.onupgradeneeded({ target: { result: mockDb } });
						if (req.onsuccess) req.onsuccess();
					});
					return req;
				}
			};

			const freshDb = new YoseDB(mockIdb);
			await freshDb.init();
			assert.ok(freshDb.db);
			assert.ok(storage.master_config.has('current'));
			assert.ok(storage.summary_snapshot.has('current'));
		});

		it('pre-filters raw transactions by target_month, sync_status, and is_deleted before decryption', async () => {
			const { generateDatabaseMasterKey } = await import('../../js/crypto.js');
			const dmk = await generateDatabaseMasterKey();
			db.setEncryptionKey(dmk);

			await db.putTransactions([
				{ id: 'tx_oct_1', target_month: '2026-10', date: '2026-10-01', amount: 1000, type: 'expense', sync_status: 'synced', is_deleted: false },
				{ id: 'tx_oct_2', target_month: '2026-10', date: '2026-10-02', amount: 2000, type: 'expense', sync_status: 'unsynced', is_deleted: false },
				{ id: 'tx_nov_1', target_month: '2026-11', date: '2026-11-01', amount: 3000, type: 'expense', sync_status: 'unsynced', is_deleted: false },
				{ id: 'tx_del_1', target_month: '2026-10', date: '2026-10-05', amount: 4000, type: 'expense', sync_status: 'unsynced', is_deleted: true }
			]);

			const octTxs = await db.getTransactions({ target_month: '2026-10' });
			assert.equal(octTxs.length, 2);
			assert.deepEqual(octTxs.map(t => t.id).sort(), ['tx_oct_1', 'tx_oct_2']);

			const unsyncedOct = await db.getTransactions({ target_month: '2026-10', sync_status: 'unsynced' });
			assert.equal(unsyncedOct.length, 1);
			assert.equal(unsyncedOct[0].id, 'tx_oct_2');

			const withDeleted = await db.getTransactions({ target_month: '2026-10', includeDeleted: true });
			assert.equal(withDeleted.length, 3);
		});
	});

	describe('YoseDB Advanced Query & Operations (Requirements 3.18 - 3.24)', () => {
		it('saves and retrieves credit card debit settings and theme in master config', async () => {
			const config = await db.getMasterConfig();
			config.theme = 'dark';
			const card = config.accounts.find(a => a.id === 'acc_card_a');
			assert.ok(card);
			card.closing_day = 15;
			card.debit_day = 10;
			card.debit_month_offset = 1;
			card.debit_account_id = 'acc_bank_main';
			await db.saveMasterConfig(config);

			const updated = await db.getMasterConfig();
			assert.equal(updated.theme, 'dark');
			const updatedCard = updated.accounts.find(a => a.id === 'acc_card_a');
			assert.equal(updatedCard.closing_day, 15);
			assert.equal(updatedCard.debit_day, 10);
			assert.equal(updatedCard.debit_month_offset, 1);
			assert.equal(updatedCard.debit_account_id, 'acc_bank_main');
		});

		it('getUnsettledAdvancePayments returns unsettled advance transfers (to acc_receivable) and legacy advance_payment records', async () => {
			await db.putTransactions([
				{ id: 'adv_1', type: 'advance_payment', amount: 5000, settlement_status: 'unsettled', memo: '立替A', is_deleted: false, date: '2026-10-01', target_month: '2026-10' },
				{ id: 'adv_2', type: 'advance_payment', amount: 3000, settlement_status: 'settled', memo: '立替B (回収済)', is_deleted: false, date: '2026-10-02', target_month: '2026-10' },
				{ id: 'adv_3', type: 'advance_payment', amount: 4000, settlement_status: 'unsettled', memo: '立替C (削除)', is_deleted: true, date: '2026-10-03', target_month: '2026-10' },
				{ id: 'tx_adv_loan_1', type: 'transfer', account_id: 'acc_wallet', to_account_id: 'acc_receivable', amount: 8500, memo: '[立替貸付] 飲み会立替', is_deleted: false, date: '2026-10-05', target_month: '2026-10' },
				{ id: 'tx_adv_loan_settled', type: 'transfer', account_id: 'acc_wallet', to_account_id: 'acc_receivable', amount: 6000, settlement_status: 'settled', memo: '[立替貸付] 精算済', is_deleted: false, date: '2026-10-06', target_month: '2026-10' },
				{ id: 'tx_normal_transfer', type: 'transfer', account_id: 'acc_bank_main', to_account_id: 'acc_wallet', amount: 10000, is_deleted: false, date: '2026-10-04', target_month: '2026-10' },
				{ id: 'tx_normal', type: 'expense', amount: 1000, is_deleted: false, date: '2026-10-04', target_month: '2026-10' }
			]);

			const unsettled = await db.getUnsettledAdvancePayments();
			assert.equal(unsettled.length, 2);
			assert.deepEqual(unsettled.map(u => u.id).sort(), ['adv_1', 'tx_adv_loan_1']);
		});

		it('getUniqueTags returns sorted unique tags list', async () => {
			await db.putTransactions([
				{ id: 't1', type: 'expense', amount: 100, tags: ['スーパー', '食料品'], is_deleted: false, date: '2026-10-01', target_month: '2026-10' },
				{ id: 't2', type: 'expense', amount: 200, tags: ['食料品', 'ディナー'], is_deleted: false, date: '2026-10-02', target_month: '2026-10' },
				{ id: 't3', type: 'expense', amount: 300, tags: ['日用品'], is_deleted: true, date: '2026-10-03', target_month: '2026-10' }
			]);

			const tags = await db.getUniqueTags();
			assert.deepEqual(tags, ['スーパー', 'ディナー', '食料品']);
		});

		it('getMemoHistory returns memo mapping with category and subcategory', async () => {
			await db.putTransactions([
				{ id: 'm1', memo: 'セブンイレブン', category_id: 'cat_food', subcategory_id: 'sub_groceries', date: '2026-10-01', is_deleted: false, target_month: '2026-10' },
				{ id: 'm2', memo: 'セブンイレブン', category_id: 'cat_food', subcategory_id: 'sub_snack', date: '2026-10-10', is_deleted: false, target_month: '2026-10' },
				{ id: 'm3', memo: 'ガソリンスタンド', category_id: 'cat_transport', subcategory_id: 'sub_gas', date: '2026-10-05', is_deleted: false, target_month: '2026-10' }
			]);

			const history = await db.getMemoHistory();
			assert.ok(history['セブンイレブン']);
			// Latest one (2026-10-10) should win
			assert.equal(history['セブンイレブン'].subcategory_id, 'sub_snack');
			assert.ok(history['ガソリンスタンド']);
			assert.equal(history['ガソリンスタンド'].category_id, 'cat_transport');
		});

		it('processCreditCardAutoSettlements generates settlement and prevents duplicates', async () => {
			// Setup credit card account with auto debit
			const config = await db.getMasterConfig();
			const card = config.accounts.find(a => a.id === 'acc_card_a');
			assert.ok(card);
			card.closing_day = 15;
			card.debit_day = 10;
			card.debit_month_offset = 1;
			card.debit_account_id = 'acc_bank_main';
			await db.saveMasterConfig(config);

			// Add card expenses in period 2026-09-16 to 2026-10-15 (cycle 2026-10)
			await db.putTransactions([
				{ id: 'c_tx_1', type: 'expense', account_id: 'acc_card_a', amount: 30000, date: '2026-09-20', target_month: '2026-09', is_deleted: false },
				{ id: 'c_tx_2', type: 'expense', account_id: 'acc_card_a', amount: 25000, date: '2026-10-05', target_month: '2026-10', is_deleted: false },
				{ id: 'c_tx_3', type: 'expense', account_id: 'acc_card_a', amount: 10000, date: '2026-10-20', target_month: '2026-10', is_deleted: false } // next cycle
			]);

			// Process settlements on debit day 2026-11-10
			const generated = await db.processCreditCardAutoSettlements('2026-11-10');
			assert.equal(generated.length, 1);
			assert.equal(generated[0].amount, 55000); // 30000 + 25000
			assert.equal(generated[0].account_id, 'acc_bank_main');
			assert.equal(generated[0].to_account_id, 'acc_card_a');
			assert.equal(generated[0].type, 'transfer');
			assert.equal(generated[0].auto_settlement_meta.billing_cycle, '2026-10');

			// Running again on same or later date should produce 0 duplicates
			const secondRun = await db.processCreditCardAutoSettlements('2026-11-10');
			assert.equal(secondRun.length, 0);

			const thirdRun = await db.processCreditCardAutoSettlements('2026-11-15');
			assert.equal(thirdRun.length, 0);
		});

		it('updateInstallmentGroup cascades updates across all records in group', async () => {
			const groupId = 'grp_inst_test_1';
			await db.putTransactions([
				{ id: 'pay_1', group_id: groupId, type: 'transfer', amount: 12000, memo: '年額契約', tags: ['前払'], is_deleted: false, amortization_meta: { is_payment_record: true, total_amount: 12000, amortize_months: 3 } },
				{ id: 'amort_1', group_id: groupId, type: 'expense', amount: 4000, category_id: 'cat_food', subcategory_id: 'sub_groceries', memo: '月次償却1', tags: ['前払'], is_deleted: false, amortization_meta: { month_index: 0 } },
				{ id: 'amort_2', group_id: groupId, type: 'expense', amount: 4000, category_id: 'cat_food', subcategory_id: 'sub_groceries', memo: '月次償却2', tags: ['前払'], is_deleted: false, amortization_meta: { month_index: 1 } },
				{ id: 'amort_3', group_id: groupId, type: 'expense', amount: 4000, category_id: 'cat_food', subcategory_id: 'sub_groceries', memo: '月次償却3', tags: ['前払'], is_deleted: false, amortization_meta: { month_index: 2 } }
			]);

			// Update category to housing, memo, tags, and new total amount 15000 (15000 / 3 = 5000 each)
			const updatedCount = await db.updateInstallmentGroup(groupId, {
				category_id: 'cat_housing',
				subcategory_id: 'sub_rent',
				memo: '[変更] 家賃年払',
				tags: ['固定費', '年払']
			}, { newTotalAmount: 15000 });

			assert.equal(updatedCount, 4);

			const txs = await db.getTransactions();
			const groupTxs = txs.filter(t => t.group_id === groupId);
			const payTx = groupTxs.find(t => t.id === 'pay_1');
			assert.equal(payTx.amount, 15000);
			assert.equal(payTx.memo, '[前払一括支払] [変更] 家賃年払');

			// Re-editing with existing [前払一括支払] prefix should NOT duplicate the prefix
			await db.updateInstallmentGroup(groupId, {
				memo: '[前払一括支払] [変更2] 家賃年払'
			});
			const txsAfter = await db.getTransactions({ group_id: groupId });
			const payTxAfter = txsAfter.find(t => t.id === 'pay_1');
			assert.equal(payTxAfter.memo, '[前払一括支払] [変更2] 家賃年払');

			const amortTxs = txsAfter.filter(t => t.id.startsWith('amort_'));
			for (const a of amortTxs) {
				assert.equal(a.category_id, 'cat_housing');
				assert.equal(a.subcategory_id, 'sub_rent');
				assert.equal(a.amount, 5000);
				assert.equal(a.memo, '[変更2] 家賃年払');
				assert.ok(a.tags.includes('固定費'));
			}
		});

		it('processCreditCardAutoSettlements handles empty credit cards and default todayStr', async () => {
			const emptyDb = new YoseDB(null);
			await emptyDb.init();
			// No credit cards configured with debit_account_id
			const res = await emptyDb.processCreditCardAutoSettlements();
			assert.deepEqual(res, []);
		});

		it('updateInstallmentGroup handles amount in updates and updates without amountAdjustment', async () => {
			const groupId = 'grp_inst_test_2';
			await db.putTransactions([
				{ id: 'pay_2', group_id: groupId, type: 'transfer', amount: 30000, memo: '一括', tags: ['前払'], is_deleted: false, amortization_meta: { is_payment_record: true, total_amount: 30000, amortize_months: 2 } },
				{ id: 'amort_2_1', group_id: groupId, type: 'expense', amount: 15000, category_id: 'cat_food', subcategory_id: 'sub_groceries', memo: '月次1', tags: ['前払'], is_deleted: false, amortization_meta: { month_index: 0 } },
				{ id: 'amort_2_2', group_id: groupId, type: 'expense', amount: 15000, category_id: 'cat_food', subcategory_id: 'sub_groceries', memo: '月次2', tags: ['前払'], is_deleted: false, amortization_meta: { month_index: 1 } }
			]);

			const count = await db.updateInstallmentGroup(groupId, { amount: 36000, memo: '新メモ' });
			assert.equal(count, 3);
			const txs = await db.getTransactions({ group_id: groupId });
			const pay = txs.find(t => t.id === 'pay_2');
			assert.equal(pay.amount, 36000);
			const amorts = txs.filter(t => t.id.startsWith('amort_2_'));
			for (const a of amorts) {
				assert.equal(a.amount, 18000);
				assert.equal(a.memo, '新メモ');
			}

			// Also supports total_amount property
			await db.updateInstallmentGroup(groupId, { total_amount: 40000 });
			const txs2 = await db.getTransactions({ group_id: groupId });
			assert.equal(txs2.find(t => t.id === 'pay_2').amount, 40000);
		});

		it('updateInstallmentGroup returns 0 for empty or invalid groupId or deleted group', async () => {
			assert.equal(await db.updateInstallmentGroup(null), 0);
			assert.equal(await db.updateInstallmentGroup(''), 0);
			assert.equal(await db.updateInstallmentGroup('non_existent_group'), 0);

			await db.putTransaction({ id: 'del_1', group_id: 'grp_all_deleted', is_deleted: true });
			assert.equal(await db.updateInstallmentGroup('grp_all_deleted'), 0);
		});

		it('updateInstallmentGroup allocates remainder to first month and updates actual categories', async () => {
			const groupId = 'grp_inst_test_3';
			await db.putTransactions([
				{ id: 'amort_3_1', group_id: groupId, type: 'expense', amount: 3000, target_month: '2026-01', is_deleted: false },
				{ id: 'amort_3_2', group_id: groupId, type: 'expense', amount: 3000, target_month: '2026-02', is_deleted: false },
				{ id: 'amort_3_3', group_id: groupId, type: 'expense', amount: 3000, target_month: '2026-03', is_deleted: false }
			]);

			const count = await db.updateInstallmentGroup(groupId, {
				actual_category_id: 'act_cat_1',
				actual_subcategory_id: 'act_sub_1'
			}, { newTotalAmount: 10000 });

			assert.equal(count, 3);
			const txs = await db.getTransactions({ group_id: groupId });
			const sorted = txs.sort((a, b) => a.target_month.localeCompare(b.target_month));
			assert.equal(sorted[0].amount, 3334); // 3333 + 1 remainder
			assert.equal(sorted[1].amount, 3333);
			assert.equal(sorted[2].amount, 3333);
			assert.equal(sorted[0].actual_category_id, 'act_cat_1');
			assert.equal(sorted[0].actual_subcategory_id, 'act_sub_1');
		});

		it('getTransactionsByGroupId retrieves transactions belonging to groupId', async () => {
			const groupId = 'grp_query_test';
			await db.putTransactions([
				{ id: 'q1', group_id: groupId, type: 'expense', amount: 1000, date: '2026-10-01', target_month: '2026-10', is_deleted: false },
				{ id: 'q2', group_id: groupId, type: 'expense', amount: 2000, date: '2026-10-02', target_month: '2026-10', is_deleted: false }
			]);
			const res = await db.getTransactionsByGroupId(groupId);
			assert.equal(res.length, 2);
			assert.deepEqual(res.map(r => r.id).sort(), ['q1', 'q2']);
		});
	});
});

