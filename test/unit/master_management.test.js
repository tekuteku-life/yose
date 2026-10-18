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
});

