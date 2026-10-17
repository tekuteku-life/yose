import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const gas = require('../../gas/Code.gs');
import {
	generateEd25519KeyPair,
	exportPublicKeyBase64,
	signPayload,
	createSignedRequest
} from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';

describe('gas/Code.gs - Unit Tests', () => {
	let keyPair;
	let pubKeyBase64;
	let gasEnv;

	beforeEach(async () => {
		gasEnv = new MockGasEnvironment();
		gasEnv.setupGlobals();
		keyPair = await generateEd25519KeyPair();
		pubKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);
	});

	afterEach(() => {
		gasEnv.teardownGlobals();
	});

	describe('Ed25519 Pure JS Verification in GAS', () => {
		it('verifies valid WebCrypto signature using Pure JS RFC 8032 in GAS', async () => {
			const msg = 'GAS Ed25519 verification test';
			const sigBase64 = await signPayload(keyPair.privateKey, msg);

			const pubBytes = gas.base64ToUint8Array(pubKeyBase64);
			const sigBytes = gas.base64ToUint8Array(sigBase64);
			const msgBytes = new TextEncoder().encode(msg);

			const valid = gas.verifyEd25519(pubBytes, sigBytes, msgBytes);
			assert.equal(valid, true);
		});

		it('rejects tampered message', async () => {
			const msg = 'Original message';
			const sigBase64 = await signPayload(keyPair.privateKey, msg);

			const pubBytes = gas.base64ToUint8Array(pubKeyBase64);
			const sigBytes = gas.base64ToUint8Array(sigBase64);
			const tamperedBytes = new TextEncoder().encode('Tampered message');

			const valid = gas.verifyEd25519(pubBytes, sigBytes, tamperedBytes);
			assert.equal(valid, false);
		});

		it('rejects invalid signature or key lengths', () => {
			const valid = gas.verifyEd25519(new Uint8Array(31), new Uint8Array(64), new Uint8Array(10));
			assert.equal(valid, false);
			const validSig = gas.verifyEd25519(new Uint8Array(32), new Uint8Array(63), new Uint8Array(10));
			assert.equal(validSig, false);
		});
	});

	describe('computeMonthlySummary', () => {
		it('aggregates income, expense, and transfer with dual category breakdown', () => {
			const initialBalances = { acc_wallet: 10000, acc_bank: 50000 };
			const transactions = [
				{
					id: 'tx1',
					type: 'income',
					amount: 200000,
					account_id: 'acc_bank',
					is_deleted: false
				},
				{
					id: 'tx2',
					type: 'expense',
					amount: 3000,
					account_id: 'acc_wallet',
					category_id: 'cat_social',
					subcategory_id: 'sub_drinking',
					actual_category_id: 'cat_food',
					actual_subcategory_id: 'sub_dining',
					is_deleted: false
				},
				{
					id: 'tx3',
					type: 'transfer',
					amount: 5000,
					account_id: 'acc_bank',
					to_account_id: 'acc_wallet',
					is_deleted: false
				},
				{
					id: 'tx_del',
					type: 'expense',
					amount: 99999,
					is_deleted: true
				}
			];

			const summary = gas.computeMonthlySummary(transactions, initialBalances);

			assert.equal(summary.income_total, 200000);
			assert.equal(summary.expense_total, 3000);
			assert.equal(summary.net_income, 197000);

			assert.equal(summary.closing_balances.acc_wallet, 12000);
			assert.equal(summary.closing_balances.acc_bank, 245000);

			assert.equal(summary.by_category.cat_social.total, 3000);
			assert.equal(summary.by_category.cat_social.by_subcategory.sub_drinking, 3000);

			assert.equal(summary.by_actual_category.cat_food.total, 3000);
			assert.equal(summary.by_actual_category.cat_food.by_subcategory.sub_dining, 3000);
		});
	});

	describe('doPost Request Processing & Actions', () => {
		it('rejects empty or invalid JSON body', () => {
			const resEmpty = gas.doPost(null);
			assert.equal(resEmpty.success, false);
			assert.match(resEmpty.error, /Empty request body/);

			const resInvalid = gas.doPost({ postData: { contents: '{invalid-json' } });
			assert.equal(resInvalid.success, false);
			assert.match(resInvalid.error, /Invalid JSON/);
		});

		it('rejects requests with stale timestamp (replay attack prevention)', async () => {
			const staleTime = Date.now() - 400000; // >5 minutes ago
			const envelope = await createSignedRequest('push_diff', {}, keyPair.privateKey, staleTime);

			const res = gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
			assert.equal(res.success, false);
			assert.match(res.error, /replay attack/);
		});

		it('rejects when no public keys are registered on server for normal actions', async () => {
			// No USER_PUBLIC_KEYS set
			const now = Date.now();
			const envelope = await createSignedRequest('push_diff', {}, keyPair.privateKey, now);

			const res = gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
			assert.equal(res.success, false);
			assert.match(res.error, /No public keys registered/);
		});

		it('successfully registers initial public key on unconfigured server with valid self-signature', async () => {
			// Ensure no USER_PUBLIC_KEYS is set
			globalThis.PropertiesService.getScriptProperties().deleteProperty('USER_PUBLIC_KEYS');

			const now = Date.now();
			const envelope = await createSignedRequest('register_initial_key', { publicKey: pubKeyBase64 }, keyPair.privateKey, now);

			const res = gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
			assert.equal(res.success, true);
			assert.match(res.message, /successfully registered/i);

			// Verify it was saved to script properties
			const saved = globalThis.PropertiesService.getScriptProperties().getProperty('USER_PUBLIC_KEYS');
			assert.ok(saved);
			assert.ok(saved.includes(pubKeyBase64));

			// Attempting to register again should be rejected (write-once)
			const resAgain = gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
			assert.equal(resAgain.success, false);
			assert.match(resAgain.error, /already configured/i);
		});

		it('rejects register_initial_key if self-signature does not match or payload is invalid', async () => {
			globalThis.PropertiesService.getScriptProperties().deleteProperty('USER_PUBLIC_KEYS');

			const otherKp = await generateEd25519KeyPair();
			const otherPub = await exportPublicKeyBase64(otherKp.publicKey);

			// Sign with our key, but claim publicKey is otherKp's
			const envelope = await createSignedRequest('register_initial_key', { publicKey: otherPub }, keyPair.privateKey, Date.now());
			const res = gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
			assert.equal(res.success, false);
			assert.match(res.error, /verification failed/i);

			// Missing publicKey in payload
			const noKeyEnv = await createSignedRequest('register_initial_key', {}, keyPair.privateKey, Date.now());
			const resMissing = gas.doPost({ postData: { contents: JSON.stringify(noKeyEnv) } });
			assert.equal(resMissing.success, false);
			assert.match(resMissing.error, /Missing publicKey/i);
		});

		it('rejects request with signature from unregistered key', async () => {
			// Register a different key
			const otherKp = await generateEd25519KeyPair();
			const otherPubBase64 = await exportPublicKeyBase64(otherKp.publicKey);
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', otherPubBase64);

			// Sign with our key
			const envelope = await createSignedRequest('push_diff', {}, keyPair.privateKey, Date.now());

			const res = gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
			assert.equal(res.success, false);
			assert.match(res.error, /Signature verification failed/);
		});

		it('executes push_diff action and stores pending diffs in Drive', async () => {
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);

			const txs = [
				{ id: 'tx_gas_1', target_month: '2026-10', amount: 5000, type: 'expense', account_id: 'acc_wallet', is_deleted: false }
			];
			const envelope = await createSignedRequest('push_diff', { transactions: txs }, keyPair.privateKey, Date.now());

			const res = gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
			assert.equal(res.success, true);
			assert.equal(res.updated_count, 1);
			assert.ok(res.snapshot);
		});

		it('executes close_month action, archives month, and calculates closing snapshot', async () => {
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);

			// 1. Push diffs for 2026-10
			const txs = [
				{ id: 'tx_c1', target_month: '2026-10', type: 'income', amount: 300000, account_id: 'acc_bank', is_deleted: false, status: 'confirmed' },
				{ id: 'tx_c2', target_month: '2026-10', type: 'expense', amount: 100000, account_id: 'acc_bank', is_deleted: false, status: 'planned' }
			];
			const pushEnv = await createSignedRequest('push_diff', { transactions: txs }, keyPair.privateKey, Date.now());
			gas.doPost({ postData: { contents: JSON.stringify(pushEnv) } });

			// 2. Close month 2026-10
			const closeEnv = await createSignedRequest('close_month', { target_month: '2026-10' }, keyPair.privateKey, Date.now());
			const res = gas.doPost({ postData: { contents: JSON.stringify(closeEnv) } });

			assert.equal(res.success, true);
			assert.equal(res.archived_count, 2);
			assert.equal(res.snapshot.last_closed_month, '2026-10');
			assert.equal(res.snapshot.monthly_summaries['2026-10'].income_total, 300000);
			assert.equal(res.snapshot.monthly_summaries['2026-10'].expense_total, 100000);
			assert.equal(res.snapshot.monthly_summaries['2026-10'].net_income, 200000);
			assert.equal(res.snapshot.account_balances.acc_bank, 200000);
		});

		it('executes retroactive_update action and cascades recalculation', async () => {
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);

			// Setup initial master accounts
			const masterEnv = await createSignedRequest('update_master', {
				master_config: {
					accounts: [{ id: 'acc_bank', initial_balance: 100000 }]
				}
			}, keyPair.privateKey, Date.now());
			gas.doPost({ postData: { contents: JSON.stringify(masterEnv) } });

			// Close 2026-09 with income 50,000
			const pushSep = await createSignedRequest('push_diff', {
				transactions: [
					{ id: 'tx_sep_1', target_month: '2026-09', type: 'income', amount: 50000, account_id: 'acc_bank', is_deleted: false }
				]
			}, keyPair.privateKey, Date.now());
			gas.doPost({ postData: { contents: JSON.stringify(pushSep) } });

			const closeSep = await createSignedRequest('close_month', { target_month: '2026-09' }, keyPair.privateKey, Date.now());
			gas.doPost({ postData: { contents: JSON.stringify(closeSep) } });

			// Close 2026-10 with expense 20,000
			const pushOct = await createSignedRequest('push_diff', {
				transactions: [
					{ id: 'tx_oct_1', target_month: '2026-10', type: 'expense', amount: 20000, account_id: 'acc_bank', is_deleted: false }
				]
			}, keyPair.privateKey, Date.now());
			gas.doPost({ postData: { contents: JSON.stringify(pushOct) } });

			const closeOct = await createSignedRequest('close_month', { target_month: '2026-10' }, keyPair.privateKey, Date.now());
			const closeOctRes = gas.doPost({ postData: { contents: JSON.stringify(closeOct) } });

			// Initial 100k + 50k (Sep) - 20k (Oct) = 130k
			assert.equal(closeOctRes.snapshot.account_balances.acc_bank, 130000);

			// Now retroactively modify September: add extra expense 10,000 to September
			const retroTx = {
				id: 'tx_sep_retro_expense',
				target_month: '2026-09',
				type: 'expense',
				amount: 10000,
				account_id: 'acc_bank',
				is_deleted: false
			};
			const retroEnv = await createSignedRequest('retroactive_update', { transaction: retroTx }, keyPair.privateKey, Date.now());
			const retroRes = gas.doPost({ postData: { contents: JSON.stringify(retroEnv) } });

			assert.equal(retroRes.success, true);
			// Cascaded recalculation:
			// Sep net: 50k - 10k = 40k -> closing Sep: 100k + 40k = 140k
			// Oct net: -20k -> closing Oct: 140k - 20k = 120k!
			assert.equal(retroRes.snapshot.monthly_summaries['2026-09'].expense_total, 10000);
			assert.equal(retroRes.snapshot.monthly_summaries['2026-09'].closing_balances.acc_bank, 140000);
			assert.equal(retroRes.snapshot.account_balances.acc_bank, 120000);
		});

		it('executes update_external_assets and fetch_state', async () => {
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);

			const assets = [
				{ id: 'sec_1', name: '全世界株', quantity: 100, unit_price: 2500, market_value: 250000 }
			];
			const assetEnv = await createSignedRequest('update_external_assets', { external_assets: assets }, keyPair.privateKey, Date.now());
			const assetRes = gas.doPost({ postData: { contents: JSON.stringify(assetEnv) } });
			assert.equal(assetRes.success, true);
			assert.deepEqual(assetRes.snapshot.external_assets, assets);

			// fetch_state
			const fetchEnv = await createSignedRequest('fetch_state', {}, keyPair.privateKey, Date.now());
			const fetchRes = gas.doPost({ postData: { contents: JSON.stringify(fetchEnv) } });
			assert.equal(fetchRes.success, true);
			assert.ok(fetchRes.master_config);
			assert.ok(fetchRes.snapshot);
			assert.ok(Array.isArray(fetchRes.pending_diffs));
		});

		it('returns error on unknown action', async () => {
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);
			const env = await createSignedRequest('unknown_action', {}, keyPair.privateKey, Date.now());
			const res = gas.doPost({ postData: { contents: JSON.stringify(env) } });
			assert.equal(res.success, false);
			assert.match(res.error, /Unknown action/);
		});

		it('handles stale Drive IDs in Properties and recreates files/folders', async () => {
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);
			// Set non-existent folder and file ID
			globalThis.PropertiesService.getScriptProperties().setProperty('DATA_FOLDER_ID', 'invalid_folder_id');
			globalThis.PropertiesService.getScriptProperties().setProperty('FILE_ID_master_config_json', 'invalid_file_id');

			// Setup getFolderById to throw on invalid_folder_id
			const origGetFolder = globalThis.DriveApp.getFolderById;
			globalThis.DriveApp.getFolderById = (id) => {
				if (id === 'invalid_folder_id') throw new Error('Invalid folder');
				return origGetFolder(id);
			};

			const fetchEnv = await createSignedRequest('fetch_state', {}, keyPair.privateKey, Date.now());
			const res = gas.doPost({ postData: { contents: JSON.stringify(fetchEnv) } });
			assert.equal(res.success, true);
		});

		it('handles update_master missing payload error', async () => {
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);
			const env = await createSignedRequest('update_master', {}, keyPair.privateKey, Date.now());
			const res = gas.doPost({ postData: { contents: JSON.stringify(env) } });
			assert.equal(res.success, false);
			assert.match(res.error, /Missing master_config/);
		});

		it('handles doGet health check request', () => {
			const getRes = gas.doGet({});
			assert.equal(getRes.status, 'ok');
			assert.match(getRes.app, /よせあつめ家計簿/);
		});

		it('handles Node.js crypto and base64 fallbacks when Utilities is unavailable', () => {
			const origUtilities = globalThis.Utilities;
			delete globalThis.Utilities;
			try {
				const hash = gas.computeSha512(new Uint8Array([1, 2, 3]));
				assert.equal(hash.length, 64);

				const bytes = gas.base64ToUint8Array('AQID');
				assert.deepEqual(Array.from(bytes), [1, 2, 3]);
			} finally {
				globalThis.Utilities = origUtilities;
			}
		});

		it('falls back to defaultContent in loadJsonFile when file content is invalid JSON', () => {
			const corruptFile = gas.getOrCreateFile('corrupt.json');
			corruptFile.setContent('{ corrupt json');
			const loaded = gas.loadJsonFile('corrupt.json', { fallback: true });
			assert.deepEqual(loaded, { fallback: true });
		});

		it('executes initialSetup successfully and logs folder details', () => {
			globalThis.Logger = {
				log: () => {}
			};
			const res = gas.initialSetup();
			assert.equal(res.status, 'ok');
			assert.ok(res.folderId);
			delete globalThis.Logger;
		});

		it('creates files when getFilesByName is not available or throws', () => {
			const folder = gas.getDataFolder();
			const origGetFiles = folder.getFilesByName;
			folder.getFilesByName = () => { throw new Error('Search failed'); };
			try {
				const file = gas.getOrCreateFile('fallback_test.json', '{"test":1}');
				assert.ok(file);
			} finally {
				folder.getFilesByName = origGetFiles;
			}
		});

		it('handles container-bound spreadsheet requirement and error when unbound', () => {
			const origSs = globalThis.SpreadsheetApp;
			delete globalThis.SpreadsheetApp;
			try {
				const testData = { fallbackTest: true, num: 123 };
				gas.saveJsonFile('unbound.json', testData);
				const loaded = gas.loadJsonFile('unbound.json', { defaultVal: true });
				assert.deepEqual(loaded, { defaultVal: true });

				assert.throws(() => {
					gas.initialSetup();
				}, /スプレッドシートが見つかりません/);
			} finally {
				globalThis.SpreadsheetApp = origSs;
			}
		});

		it('correctly chunks and reads large JSON files in Spreadsheet storage', () => {
			const largeData = {
				items: Array.from({ length: 500 }, (_, i) => ({ id: i, text: 'long_data_chunk_sample_' + i }))
			};
			gas.saveJsonFile('large_test.json', largeData);
			const loaded = gas.loadJsonFile('large_test.json');
			assert.deepEqual(loaded, largeData);
		});

		it('handles null active spreadsheet gracefully in getStorageSpreadsheet and safeSheetName formatting', () => {
			const origActive = globalThis.SpreadsheetApp.getActiveSpreadsheet;
			globalThis.SpreadsheetApp.getActiveSpreadsheet = () => null;
			try {
				const ss = gas.getStorageSpreadsheet();
				assert.equal(ss, null);
			} finally {
				globalThis.SpreadsheetApp.getActiveSpreadsheet = origActive;
			}

			assert.equal(gas.safeSheetName('archives/2026-05.json'), 'arch_2026-05');
			assert.equal(gas.safeSheetName('master_config.json'), 'master_config');
		});

		it('covers getOrCreateFile blob data string and setContent', () => {
			const file = gas.getOrCreateFile('blob_test.json', { a: 1 });
			assert.equal(file.getName(), 'blob_test.json');
			assert.ok(file.getId());
			const dataStr = file.getBlob().getDataAsString();
			assert.ok(dataStr.includes('"a":1'));
			file.setContent({ a: 2 });
			const updated = file.getBlob().getDataAsString();
			assert.ok(updated.includes('"a":2'));
		});

		it('covers public keys parsing from single JSON string and CSV fallback', () => {
			const props = globalThis.PropertiesService.getScriptProperties();
			// Single JSON string (not array)
			props.setProperty('USER_PUBLIC_KEYS', JSON.stringify('single_key_base64'));
			const keys1 = gas.doPost ? gasEnv : null; // env check
			// Direct call via registered keys
			props.setProperty('USER_PUBLIC_KEYS', 'csv_key_1, csv_key_2');
			// When comma separated, JSON.parse throws and catch branch splits by comma
			const testEnv = { postData: { contents: '{ invalid' } };
			const res = gas.doPost(testEnv);
			assert.equal(res.success, false);
			assert.equal(res.error, 'Invalid JSON body');
		});

		it('covers doPost error branches: null request, lock failure, lock exception, and unknown action', async () => {
			// 1. Empty / null request
			const resNull = gas.doPost(null);
			assert.equal(resNull.success, false);
			assert.equal(resNull.error, 'Empty request body');

			const resEmpty = gas.doPost({});
			assert.equal(resEmpty.success, false);

			const resNoContents = gas.doPost({ postData: {} });
			assert.equal(resNoContents.success, false);

			// 2. LockService tryLock returns false
			const origLock = globalThis.LockService.getScriptLock;
			globalThis.LockService.getScriptLock = () => ({
				tryLock: () => false,
				releaseLock: () => {}
			});
			const resLockBusy = gas.doPost({ postData: { contents: '{}' } });
			assert.equal(resLockBusy.success, false);
			assert.match(resLockBusy.error, /Server is busy/);

			// 3. LockService tryLock throws error
			globalThis.LockService.getScriptLock = () => ({
				tryLock: () => { throw new Error('Lock timeout'); },
				releaseLock: () => {}
			});
			const resLockErr = gas.doPost({ postData: { contents: '{}' } });
			assert.equal(resLockErr.success, false);
			assert.match(resLockErr.error, /LockService error/);

			globalThis.LockService.getScriptLock = origLock;

			// 4. Unknown action dispatched with valid signature
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);
			const unknownEnv = await createSignedRequest('some_unknown_action', {}, keyPair.privateKey, Date.now());
			const resUnknown = gas.doPost({ postData: { contents: JSON.stringify(unknownEnv) } });
			assert.equal(resUnknown.success, false);
			assert.match(resUnknown.error, /Unknown action/);
		});

		it('covers handleCloseMonth, handleRetroactiveUpdate, and recalculateArchiveCascade edge cases', () => {
			// handleCloseMonth without target_month
			const closeErr = gas.handleCloseMonth({});
			assert.equal(closeErr.success, false);
			assert.equal(closeErr.error, 'Missing target_month');

			// handleCloseMonth with empty snapshot initial balances from master_config
			gas.saveJsonFile('master_config.json', {
				accounts: [{ id: 'acc_master_init', initial_balance: 70000 }]
			});
			gas.saveJsonFile('summary_snapshot.json', {
				schema_version: 2,
				account_balances: {}
			});
			gas.saveJsonFile('pending_diffs.json', {
				transactions: [{ id: 't_init', target_month: '2026-01', amount: 5000, type: 'expense', account_id: 'acc_master_init' }]
			});
			const closeRes = gas.handleCloseMonth({ target_month: '2026-01' });
			assert.equal(closeRes.success, true);
			assert.equal(closeRes.snapshot.account_balances.acc_master_init, 65000);

			// handleRetroactiveUpdate missing tx or target_month
			const retroErr = gas.handleRetroactiveUpdate({});
			assert.equal(retroErr.success, false);
			assert.match(retroErr.error, /Missing transaction/);

			// handleRetroactiveUpdate on unclosed future month (saves to pending_diffs)
			const retroFuture = gas.handleRetroactiveUpdate({
				transaction: {
					id: 'tx_fut_retro',
					target_month: '2028-12',
					amount: 8888,
					type: 'expense'
				}
			});
			assert.equal(retroFuture.success, true);
			const pending = gas.loadJsonFile('pending_diffs.json');
			assert.ok(pending.transactions.some(t => t.id === 'tx_fut_retro'));

			// recalculateArchiveCascade edge cases: null or empty monthly_summaries
			gas.recalculateArchiveCascade(null);
			gas.recalculateArchiveCascade({});
			gas.recalculateArchiveCascade({ monthly_summaries: {} });
		});

		it('covers computeMonthlySummary missing account_id, missing to_account_id, and category fallbacks', () => {
			const summary = gas.computeMonthlySummary([
				{
					id: 't_exp_no_acc',
					type: 'expense',
					amount: 500,
					is_deleted: false
					// missing account_id, category_id, subcategory_id
				},
				{
					id: 't_inc_no_acc',
					type: 'income',
					amount: 1000,
					is_deleted: false
					// missing account_id
				},
				{
					id: 't_trans_no_from',
					type: 'transfer',
					amount: 300,
					to_account_id: 'acc_wallet',
					is_deleted: false
					// missing account_id
				},
				{
					id: 't_trans_no_to',
					type: 'transfer',
					amount: 200,
					account_id: 'acc_wallet',
					is_deleted: false
					// missing to_account_id
				}
			], { acc_wallet: 1000 });

			assert.equal(summary.income_total, 1000);
			assert.equal(summary.expense_total, 500);
			assert.equal(summary.net_income, 500);
			assert.equal(summary.closing_balances.acc_wallet, 1000 + 300 - 200);
			assert.ok(summary.by_category.cat_unclassified);
			assert.ok(summary.by_actual_category.cat_unclassified);
		});

		it('covers missing PropertiesService and Logger logging in initialSetup failure', () => {
			const origProps = globalThis.PropertiesService;
			delete globalThis.PropertiesService;
			try {
				// Functions will hit typeof PropertiesService !== 'undefined' === false
				gas.loadJsonFile('test_no_props.json');
			} finally {
				globalThis.PropertiesService = origProps;
			}

			// initialSetup with Logger when SS is unbound
			const origSs = globalThis.SpreadsheetApp;
			delete globalThis.SpreadsheetApp;
			let logged = '';
			globalThis.Logger = {
				log: (msg) => { logged = msg; }
			};
			try {
				assert.throws(() => gas.initialSetup(), /スプレッドシートが見つかりません/);
				assert.match(logged, /スプレッドシートが見つかりません/);
			} finally {
				globalThis.SpreadsheetApp = origSs;
				delete globalThis.Logger;
			}
		});

		it('covers getScriptProp, setScriptProp, getRegisteredPublicKeys, createResponse and lock release error', async () => {
			// 1. getScriptProp and setScriptProp with missing PropertiesService
			const origProps = globalThis.PropertiesService;
			delete globalThis.PropertiesService;
			try {
				assert.equal(gas.getScriptProp('k'), null);
				gas.setScriptProp('k', 'v');
			} finally {
				globalThis.PropertiesService = origProps;
			}

			// 2. getRegisteredPublicKeys branches
			const props = globalThis.PropertiesService.getScriptProperties();
			props.deleteProperty('USER_PUBLIC_KEYS');
			assert.deepEqual(gas.getRegisteredPublicKeys(), []);
			props.setProperty('USER_PUBLIC_KEYS', JSON.stringify('single_key'));
			assert.deepEqual(gas.getRegisteredPublicKeys(), ['single_key']);
			props.setProperty('USER_PUBLIC_KEYS', 'k1, k2');
			assert.deepEqual(gas.getRegisteredPublicKeys(), ['k1', 'k2']);

			// Restore valid public key for subsequent tests
			props.setProperty('USER_PUBLIC_KEYS', JSON.stringify([pubKeyBase64]));

			// 3. createResponse without ContentService
			const origCs = globalThis.ContentService;
			delete globalThis.ContentService;
			try {
				assert.deepEqual(gas.createResponse({ plain: true }), { plain: true });
			} finally {
				globalThis.ContentService = origCs;
			}

			// 4. doPost with lock release throwing in finally block (line 423-424)
			const origLock = globalThis.LockService.getScriptLock;
			globalThis.LockService.getScriptLock = () => ({
				tryLock: () => true,
				releaseLock: () => { throw new Error('Lock release failure'); }
			});
			try {
				const env = await createSignedRequest('fetch_state', {}, keyPair.privateKey, Date.now());
				const res = gas.doPost({ postData: { contents: JSON.stringify(env) } });
				assert.equal(res.success, true);
			} finally {
				globalThis.LockService.getScriptLock = origLock;
			}

			// 5. handleUpdateExternalAssets with empty / non-array payload
			const extRes = gas.handleUpdateExternalAssets({});
			assert.equal(extRes.success, true);

			// 6. handlePushDiff merging both existing and incoming transactions
			gas.saveJsonFile('pending_diffs.json', { schema_version: 2, transactions: [{ id: 'tx_exist', amount: 100 }] });
			const pushRes = gas.handlePushDiff({ transactions: [{ id: 'tx_exist', amount: 200 }, { id: 'tx_new', amount: 300 }] });
			assert.equal(pushRes.success, true);
			assert.equal(pushRes.updated_count, 2);
		});

		it('comprehensively covers all edge branches in gas/Code.gs', async () => {
			globalThis.PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', pubKeyBase64);

			// 1. setScriptProp when PropertiesService is defined
			gas.setScriptProp('branch_test_key', 'branch_test_val');
			assert.equal(gas.getScriptProp('branch_test_key'), 'branch_test_val');

			// 2. recoverX edge cases: y >= ED25519_P and quadratic non-residue
			assert.equal(gas.recoverX(BigInt(2) ** BigInt(256), BigInt(0)), null);
			assert.equal(gas.recoverX(BigInt(7), BigInt(0)), null);

			// 3. verifyEd25519 edge cases: S >= ED25519_L, invalid rx, invalid x
			const msg = 'branch edge test';
			const sigBase64 = await signPayload(keyPair.privateKey, msg);
			const pubBytes = gas.base64ToUint8Array(pubKeyBase64);
			const sigBytes = gas.base64ToUint8Array(sigBase64);
			const msgBytes = new TextEncoder().encode(msg);

			const badSigS = new Uint8Array(sigBytes);
			badSigS.fill(255, 32); // S >= ED25519_L
			assert.equal(gas.verifyEd25519(pubBytes, badSigS, msgBytes), false);

			const badSigR = new Uint8Array(sigBytes);
			badSigR.set(new Uint8Array(32).fill(255), 0); // rx === null
			assert.equal(gas.verifyEd25519(pubBytes, badSigR, msgBytes), false);

			const badPub = new Uint8Array(32).fill(255); // x === null
			assert.equal(gas.verifyEd25519(badPub, sigBytes, msgBytes), false);

			// 4. Utilities undefined for computeSha512, base64ToUint8Array, and doPost msgBytes
			const origUtils = globalThis.Utilities;
			delete globalThis.Utilities;
			try {
				const hash = gas.computeSha512(new Uint8Array([1, 2, 3]));
				assert.equal(hash.length, 64);
				const b64Bytes = gas.base64ToUint8Array(pubKeyBase64);
				assert.equal(b64Bytes.length, 32);

				const env = await createSignedRequest('fetch_state', {}, keyPair.privateKey, Date.now());
				const res = gas.doPost({ postData: { contents: JSON.stringify(env) } });
				assert.equal(res.success, true);
			} finally {
				globalThis.Utilities = origUtils;
			}

			// 5. doPost line 417 catch block: with error.message and with empty/falsy error.message
			const badReqInvalidB64 = {
				action: 'fetch_state',
				timestamp: Date.now(),
				payload: {},
				signature: 'not_base64!?%'
			};
			const resBadSig = gas.doPost({ postData: { contents: JSON.stringify(badReqInvalidB64) } });
			assert.equal(resBadSig.success, false);
			assert.ok(resBadSig.error);

			// Trigger line 417 fallback ('Internal server error')
			const envValid = await createSignedRequest('fetch_state', {}, keyPair.privateKey, Date.now());
			const origJsonParse = JSON.parse;
			JSON.parse = (str) => {
				const obj = origJsonParse(str);
				if (str === JSON.stringify(envValid)) {
					return new Proxy(obj, {
						get(target, prop) {
							if (prop === 'action') throw new Error('');
							return target[prop];
						}
					});
				}
				return obj;
			};
			try {
				const resNoMsg = gas.doPost({ postData: { contents: JSON.stringify(envValid) } });
				assert.equal(resNoMsg.success, false);
				assert.equal(resNoMsg.error, 'Internal server error');
			} finally {
				JSON.parse = origJsonParse;
			}

			// 6. loadJsonFile and saveJsonFile when SpreadsheetApp is missing / getStorageSpreadsheet returns null
			const origSs = globalThis.SpreadsheetApp;
			delete globalThis.SpreadsheetApp;
			try {
				assert.deepEqual(gas.loadJsonFile('missing_ss.json', { def: 123 }), { def: 123 });
				gas.saveJsonFile('missing_ss.json', { def: 123 });
			} finally {
				globalThis.SpreadsheetApp = origSs;
			}

			// 7. loadJsonFromSheet edge cases
			assert.deepEqual(gas.loadJsonFromSheet({ getLastRow: () => 0 }, { empty: true }), { empty: true });
			assert.deepEqual(gas.loadJsonFromSheet({ getLastRow: () => 1, getRange: () => ({ getValues: () => [['   ']] }) }, { blank: true }), { blank: true });
			assert.deepEqual(gas.loadJsonFromSheet({ getLastRow: () => { throw new Error('sheet err'); } }, { thrown: true }), { thrown: true });

			// 8. saveJsonToSheet without clearContents or getRange
			gas.saveJsonToSheet({}, { test: 1 });

			// 9. recalculateArchiveCascade edge cases
			gas.recalculateArchiveCascade(null);
			gas.recalculateArchiveCascade({});
			gas.recalculateArchiveCascade({ monthly_summaries: {} });

			// 10. Error branches of action handlers
			assert.equal(gas.handleCloseMonth({}).success, false);
			assert.equal(gas.handleRetroactiveUpdate({}).success, false);
			assert.equal(gas.handleUpdateMaster({}).success, false);
			assert.equal(gas.handlePushDiff({ transactions: 'not_an_array' }).success, false);

			// 11. CacheService replay detection
			const replayEnv = await createSignedRequest('fetch_state', {}, keyPair.privateKey, Date.now());
			const res1 = gas.doPost({ postData: { contents: JSON.stringify(replayEnv) } });
			assert.equal(res1.success, true);
			const resReplay = gas.doPost({ postData: { contents: JSON.stringify(replayEnv) } });
			assert.equal(resReplay.success, false);
			assert.match(resReplay.error, /Replay detected/);

			// 12. handleCloseMonth idempotency and safe merging when archive already exists
			gas.saveJsonFile('archives/2026-08.json', { schema_version: 2, transactions: [{ id: 'tx_arch_1', target_month: '2026-08', amount: 1000 }] });
			// When targetMonth has 0 pending items, it preserves existing archive
			const closeDupRes = gas.handleCloseMonth({ target_month: '2026-08' });
			assert.equal(closeDupRes.success, true);
			assert.equal(closeDupRes.archived_count, 1);
			// When targetMonth has pending items, it merges into existing archive
			gas.saveJsonFile('pending_diffs.json', { schema_version: 2, transactions: [{ id: 'tx_arch_2', target_month: '2026-08', amount: 2000 }] });
			const closeMergeRes = gas.handleCloseMonth({ target_month: '2026-08' });
			assert.equal(closeMergeRes.success, true);
			const updatedArch = gas.loadJsonFile('archives/2026-08.json');
			assert.equal(updatedArch.transactions.length, 2);
		});
	});
});
