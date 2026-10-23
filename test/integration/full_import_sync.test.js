import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { generateRecurringTransactions } from '../../js/logic/transaction_factory.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { SyncManager } from '../../js/sync.js';
import { canonicalJsonStringify, generateEd25519KeyPair, exportPublicKeyBase64, createSignedRequest, generateDatabaseMasterKey } from '../../js/crypto.js';
import { DEFAULT_MASTER_CONFIG, DEFAULT_SUMMARY_SNAPSHOT } from '../../js/db/defaults.js';
import { transaction } from '../helpers/ui_fixture.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const clone = value => JSON.parse(JSON.stringify(value));
const master = () => clone(DEFAULT_MASTER_CONFIG);
const snapshot = () => ({ ...clone(DEFAULT_SUMMARY_SNAPSHOT), last_closed_month: '2026-09' });

function importData(type, overrides = {}) {
	return { schema_version: 2, export_type: type, ...overrides };
}

function serverState() { return gas.handleAction('fetch_state', {}); }
function replace(data, id = 'replacement-1', base = serverState().state_version) {
	return gas.handleAction('replace_import', { import_id: id, data, base_version: base });
}

describe('GAS complete import replacement and durable recovery', () => {
	let env;
	beforeEach(() => {
		env = new MockGasEnvironment(); env.setupGlobals();
		gas.saveJsonFile('master_config.json', master());
		gas.saveJsonFile('summary_snapshot.json', snapshot());
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('old-pending')] });
		gas.saveJsonFile('archives/2026-09.json', { transactions: [transaction('old-archive', { target_month: '2026-09' })] });
	});
	afterEach(() => env.teardownGlobals());

	it('replaces all transactions including archived IDs and recalculates closed summaries', () => {
		const previous = serverState();
		const next = [transaction('new-pending', { amount: 14 }), transaction('new-archive', { target_month: '2026-08', date: '2026-08-01' })];
		assert.equal(replace(importData('transactions', { transactions: next })).success, true);
		const state = serverState();
		assert.deepEqual(state.pending_diffs.filter(tx => !tx.is_deleted).map(tx => tx.id), ['new-pending']);
		assert.deepEqual(state.archived_transactions.filter(tx => !tx.is_deleted).map(tx => tx.id), ['new-archive']);
		assert.deepEqual(state.master_config, previous.master_config);
		assert.equal(state.snapshot.monthly_summaries['2026-08'].expense_total, 100);
		assert.equal(state.snapshot.monthly_summaries['2026-09'].expense_total, 0);
		assert.equal(state.snapshot.account_balances.acc_wallet, 14900);
		assert.notEqual(state.state_version, previous.state_version);
	});
	it('replaces all backup domains and accepts changed older IDs without timestamp merge', () => {
		const nextMaster = master(); nextMaster.accounts[0].name = '完全置換';
		const nextSnapshot = { ...snapshot(), last_closed_month: null, monthly_summaries: {} };
		const data = importData('full_backup', { master_config: nextMaster, summary_snapshot: nextSnapshot, transactions: [transaction('old-pending', { amount: 88, updated_at: '2000-01-01T00:00:00Z' })] });
		assert.equal(replace(data).success, true);
		const state = serverState();
		assert.equal(state.pending_diffs[0].amount, 88);
		assert.equal(state.archived_transactions.filter(tx => !tx.is_deleted).length, 0);
		assert.equal(state.master_config.accounts[0].name, '完全置換');
		assert.deepEqual(state.snapshot, nextSnapshot);
	});
	for (const type of ['transactions', 'master_config', 'annual_budgets', 'summary_snapshot']) {
		it(`replaces only ${type} including empty content`, () => {
			if (type === 'master_config') { gas.saveJsonFile('summary_snapshot.json', { schema_version: 2, account_balances: {}, monthly_summaries: {}, last_closed_month: null }); gas.saveJsonFile('pending_diffs.json', { transactions: [] }); gas.saveJsonFile('archives/2026-09.json', { transactions: [] }); }
			const previous = serverState();
			const fields = { transactions: [], master_config: { schema_version: 2, accounts: [], categories: [], recurring_rules: [], holidays: [], annual_budgets: {} }, annual_budgets: {}, summary_snapshot: { schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} } };
			assert.equal(replace(importData(type, { [type]: fields[type] })).success, true);
			const state = serverState();
			if (type === 'transactions') assert.equal(state.pending_diffs.filter(tx => !tx.is_deleted).length + state.archived_transactions.filter(tx => !tx.is_deleted).length, 0);
			else {
				assert.deepEqual(state.pending_diffs, previous.pending_diffs);
				assert.deepEqual(state.archived_transactions, previous.archived_transactions);
			}
			if (type === 'master_config') assert.deepEqual(state.master_config, fields.master_config);
			else if (type === 'annual_budgets') assert.deepEqual(state.master_config, { ...previous.master_config, annual_budgets: {} });
			else assert.deepEqual(state.master_config, previous.master_config);
			if (type === 'transactions') {
				assert.equal(state.snapshot.monthly_summaries['2026-09'].expense_total, 0);
				assert.equal(state.snapshot.account_balances.acc_wallet, 15000);
			} else assert.deepEqual(state.snapshot, type === 'summary_snapshot' ? fields.summary_snapshot : previous.snapshot);
		});
	}
	it('retries an acknowledged import idempotently while preserving later server edits', () => {
		const data = importData('transactions', { transactions: [transaction('accepted')] });
		const base = serverState().state_version;
		const response = replace(data, 'same-id', base);
		assert.equal(response.success, true);
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('later-device')] });
		assert.equal(replace(data, 'same-id', base).success, true);
		assert.deepEqual(serverState().pending_diffs.filter(tx => !tx.is_deleted).map(tx => tx.id), ['later-device']);
		const different = replace(importData('transactions', { transactions: [] }), 'same-id', base);
		assert.equal(different.success, false);
		assert.deepEqual(serverState().pending_diffs.filter(tx => !tx.is_deleted).map(tx => tx.id), ['later-device']);
	});
	it('rejects stale state versions and keeps every server domain unchanged', () => {
		const base = serverState().state_version;
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('concurrent-device')] });
		const before = serverState();
		const result = replace(importData('transactions', { transactions: [] }), 'stale', base);
		assert.equal(result.success, false);
		assert.match(result.error, /競合|変更/);
		assert.deepEqual(serverState(), before);
	});
	for (const [name, data] of [
		['unknown type', importData('invalid', { transactions: [] })],
		['unexpected nonselected domain', importData('transactions', { transactions: [], annual_budgets: {} })],
		['missing master collection', importData('full_backup', { master_config: Object.fromEntries(Object.entries(master()).filter(([key]) => key !== 'holidays')), summary_snapshot: snapshot(), transactions: [] })],
		['missing collection', importData('transactions')],
		['legacy advance payment type', importData('transactions', { transactions: [transaction('bad', { type: 'advance_payment' })] })],
		['invalid transaction type', importData('transactions', { transactions: [transaction('bad', { type: 'invalid' })] })],
		['invalid month', importData('transactions', { transactions: [transaction('bad', { target_month: '2026-99' })] })],
		['missing account', importData('transactions', { transactions: [transaction('bad', { account_id: null })] })],
		['negative amount', importData('transactions', { transactions: [transaction('bad', { amount: -1 })] })],
		['invalid calendar date', importData('transactions', { transactions: [transaction('bad', { date: '2026-02-30' })] })],
		['missing transfer destination', importData('transactions', { transactions: [transaction('bad', { type: 'transfer', to_account_id: null })] })],
		['same transfer account', importData('transactions', { transactions: [transaction('bad', { type: 'transfer', to_account_id: 'acc_wallet' })] })],
		['missing id', importData('transactions', { transactions: [transaction('')] })],
		['duplicate id', importData('transactions', { transactions: [transaction('dup'), transaction('dup')] })],
		['unsafe nested key', JSON.parse('{"schema_version":2,"export_type":"annual_budgets","annual_budgets":{"__proto__":{}}}')],
		['invalid budget type', importData('annual_budgets', { annual_budgets: [] })],
		['invalid master collection', importData('master_config', { master_config: { schema_version: 2, accounts: 'wrong' } })]
	]) {
		it(`validates ${name} before mutation`, () => {
			const before = serverState();
			assert.equal(replace(data).success, false);
			assert.deepEqual(serverState(), before);
		});
	}
	for (const [name, field, value] of [
		['account', 'account_id', 'missing-account'],
		['category', 'category_id', 'missing-category'],
		['subcategory', 'subcategory_id', 'missing-subcategory'],
		['actual category', 'actual_category_id', 'missing-category'],
		['actual subcategory', 'actual_subcategory_id', 'missing-subcategory']
	]) {
		it(`rejects a transaction with an unknown ${name} before writing`, () => {
			const before = serverState();
			assert.equal(replace(importData('transactions', { transactions: [transaction('bad-ref', { [field]: value })] })).success, false);
			assert.deepEqual(serverState(), before);
		});
		it(`rejects a recurring rule with an unknown ${name} before writing`, () => {
			const config = master();
			config.recurring_rules.push({ ...transaction('bad-rule', { [field]: value }), name: '不正参照' });
			const before = serverState();
			assert.equal(replace(importData('master_config', { master_config: config })).success, false);
			assert.deepEqual(serverState(), before);
		});
	}
	it('rejects an unknown annual budget category and a master that orphans retained transactions', () => {
		const before = serverState();
		assert.equal(replace(importData('annual_budgets', { annual_budgets: { 2026: { expense_budget: 10, category_budgets: { missing: 10 } } } })).success, false);
		const config = master(); config.accounts = config.accounts.filter(item => item.id !== 'acc_wallet');
		assert.equal(replace(importData('master_config', { master_config: config })).success, false);
		assert.deepEqual(serverState(), before);
	});


	for (const field of ['is_deleted', 'amount_pending', 'is_payment_record', 'is_point_split']) {
		it(`rejects a string boolean for transaction ${field} without changing server data`, () => {
			const before = serverState();
			assert.equal(replace(importData('transactions', { transactions: [transaction('bad-boolean', { [field]: 'false' })] })).success, false);
			assert.deepEqual(serverState(), before);
		});
	}
	for (const [collection, field] of [['accounts', 'is_asset'], ['accounts', 'is_archived'], ['categories', 'is_archived'], ['recurring_rules', 'is_active']]) {
		it(`rejects a string boolean for ${collection}.${field} without mutation`, () => {
			const config = master(); config[collection][0][field] = 'false';
			const before = serverState();
			assert.equal(replace(importData('master_config', { master_config: config })).success, false);
			assert.deepEqual(serverState(), before);
		});
	}
	it('accepts valid category IDs that happen to equal known boolean property names', () => {
		const config = master();
		config.categories.push({ id: 'is_active', name: '正常な ID', type: 'expense', subcategories: [] });
		config.annual_budgets = { 2026: { expense_budget: 10, category_budgets: { is_active: 10 } } };
		assert.equal(replace(importData('master_config', { master_config: config })).success, true);
		assert.equal(serverState().master_config.annual_budgets['2026'].category_budgets.is_active, 10);
	});
	it('rejects a missing premium payment account and a snapshot balance with an unknown account', () => {
		const config = master(); config.accounts[0].premium_pay_account_id = 'missing-premium';
		const before = serverState();
		assert.equal(replace(importData('master_config', { master_config: config })).success, false);
		assert.equal(replace(importData('summary_snapshot', { summary_snapshot: { ...snapshot(), account_balances: { missing: 10 } } })).success, false);
		assert.deepEqual(serverState(), before);
	});

	it('accepts an exported recurring transaction shifted across the target month by a holiday', () => {
		const rule = { id: 'cross-month', name: '休日調整', is_active: true, type: 'expense', amount: 10, day_of_month: 1, holiday_adjustment: 'before', account_id: 'acc_wallet', category_id: 'cat_food', actual_category_id: 'cat_food' };
		const transactions = generateRecurringTransactions([rule], '2026-11', [], [], '2026-10-01');
		assert.equal(transactions.length, 1);
		assert.equal(transactions[0].target_month, '2026-11');
		assert.equal(transactions[0].date, '2026-10-30');
		assert.equal(replace(importData('transactions', { transactions })).success, true);
		assert.equal(serverState().pending_diffs[0].date, '2026-10-30');
	});

	it('requires a registered signature before any replacement mutation', async () => {
		const registered = await generateEd25519KeyPair(), attacker = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(registered.publicKey));
		const before = serverState();
		const payload = { import_id: 'unsigned', data: importData('transactions', { transactions: [] }), base_version: before.state_version };
		const envelope = await createSignedRequest('replace_import', payload, attacker.privateKey);
		const response = gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
		assert.equal(response.success, false);
		assert.match(response.error, /Signature/);
		assert.deepEqual(serverState(), before);
		assert.equal(env.lockAcquired, false);
	});
	it('replays a committed import before accepting a later mutation after marker cleanup interruption', () => {
		const data = importData('transactions', { transactions: [] });
		const insert = env.spreadsheet.insertSheet.bind(env.spreadsheet);
		let calls = 0;
		env.spreadsheet.insertSheet = name => {
			const sheet = insert(name);
			if (name === 'replacement_commit') {
				const getRange = sheet.getRange.bind(sheet);
				sheet.getRange = (...args) => {
					const range = getRange(...args), write = range.setValues;
					range.setValues = values => { calls++; if (calls === 2) throw new Error('cleanup interrupted'); return write(values); };
					return range;
				};
			}
			return sheet;
		};
		try { replace(data); } catch (error) { assert.match(error.message, /interrupted/); }
		assert.equal(calls, 2);
		assert.equal(gas.handleAction('push_diff', { transactions: [transaction('after-recovery')] }).success, true);
		assert.deepEqual(serverState().pending_diffs.filter(tx => !tx.is_deleted).map(tx => tx.id), ['after-recovery']);
		assert.equal(replace(data).success, true);
		assert.deepEqual(serverState().pending_diffs.filter(tx => !tx.is_deleted).map(tx => tx.id), ['after-recovery']);
	});

	for (const failAt of ['replacement_journal', 'replacement_commit', 'pending_diffs', 'arch_2026-09', 'master_config', 'summary_snapshot', 'replacement_receipts']) {
		it(`recovers a forced interruption writing ${failAt} before exposing state`, () => {
			const before = serverState();
			const data = importData('full_backup', { master_config: master(), summary_snapshot: { ...snapshot(), last_closed_month: null }, transactions: [transaction('replacement')] });
			const originalInsert = env.spreadsheet.insertSheet.bind(env.spreadsheet);
			let failed = false;
			const patch = sheet => {
				if (sheet.getName() !== failAt) return sheet;
				const getRange = sheet.getRange.bind(sheet);
				sheet.getRange = (...args) => {
					const range = getRange(...args), setValues = range.setValues;
					range.setValues = values => { if (!failed) { failed = true; throw new Error('forced interruption'); } return setValues(values); };
					return range;
				};
				return sheet;
			};
			for (const sheet of env.spreadsheet.getSheets()) patch(sheet);
			env.spreadsheet.insertSheet = name => patch(originalInsert(name));
			try { replace(data); } catch (error) { assert.match(error.message, /forced interruption/); }
			assert.equal(failed, true);
			const recovered = serverState();
			if (['replacement_journal', 'replacement_commit'].includes(failAt)) assert.deepEqual(recovered, before);
			else {
				assert.deepEqual(recovered.pending_diffs.filter(tx => !tx.is_deleted).map(tx => tx.id), ['replacement']);
				assert.equal(recovered.archived_transactions.filter(tx => !tx.is_deleted).length, 0);
				assert.equal(replace(data).success, true);
			}
		});
	}
});

function createPendingSync({ fail = null, lock = null } = {}) {
	const original = { id: 'pending-1', created_at: '2026-10-21T00:00:00Z', detectedType: 'transactions', data: importData('transactions', { transactions: [] }) };
	let pending = clone(original);
	const actions = [], updates = [];
	const key = {}, encryptionKey = {};
	const db = {
		encryptionKey,
		getPendingImport: async () => clone(pending),
		updatePendingImport: async (submitted, replacement) => { updates.push(clone(replacement)); if (canonicalJsonStringify(submitted) !== canonicalJsonStringify(pending)) return false; pending = clone(replacement); return true; },
		acknowledgePendingImport: async submitted => { if (canonicalJsonStringify(submitted) !== canonicalJsonStringify(pending)) return false; pending = null; return true; },
		getUnsyncedTransactions: async () => [],
		getSnapshot: async () => ({}),
		getMasterConfig: async () => master(),
		getTransaction: async () => null,
		getTransactions: async () => [],
		validateRemoteState: async () => {},
		commitSyncResponse: async () => ({ synced_count: 0, downloaded_count: 0 }),
		mergeRemoteTransactions: async () => 0,
		saveSnapshot: async () => {},
		setSetting: async () => {}
	};
	const sync = new SyncManager({ db, privateKey: key });
	sync.sendRequest = async (action, payload) => {
		actions.push({ action, payload });
		if (action === fail) throw new Error('offline');
		if (action === 'replace_import' && lock) lock(sync, db);
		if (action === 'replace_import') return { success: true, import_id: original.id, imported_at: '2026-10-22T00:00:00.001Z' };
		return { success: true, state_version: 'server-version', pending_diffs: [] };
	};
	return { sync, db, actions, updates, pending: () => pending };
}

describe('complete import runs before every ordinary sync path', () => {
	for (const [name, run] of [
		['master', sync => sync.syncMaster()],
		['pending diffs', sync => sync.syncPendingDiffs()],
		['bidirectional', sync => sync.syncBidirectional()],
		['remote fetch', sync => sync.fetchRemoteState()],
		['month close', sync => sync.closeMonth('2026-10')],
		['retroactive edit', sync => sync.sendRetroactiveUpdate(transaction('retro'))]
	]) {
		it(`flushes replacement before ${name}`, async () => {
			const fixture = createPendingSync();
			fixture.db.putTransaction = async tx => tx;
			fixture.db.markTransactionsSynced = async () => 1;
			await run(fixture.sync);
			assert.deepEqual(fixture.actions.slice(0, 2).map(item => item.action), ['fetch_state', 'replace_import']);
			assert.equal(fixture.updates[0].base_version, 'server-version');
			assert.equal(fixture.pending(), null);
		});
	}
	it('keeps a failed import and its original server base across retry', async () => {
		const fixture = createPendingSync({ fail: 'replace_import' });
		await assert.rejects(fixture.sync.syncPendingDiffs(), /offline/);
		assert.equal(fixture.pending().base_version, 'server-version');
		await assert.rejects(fixture.sync.syncPendingDiffs(), /offline/);
		assert.deepEqual(fixture.actions.map(item => item.action), ['fetch_state', 'replace_import', 'replace_import']);
		assert.equal(fixture.sync.isSyncing, false);
	});
	it('retains the outbox if authentication changes after server acceptance', async () => {
		const fixture = createPendingSync({ lock: (sync, db) => { sync.setPrivateKey(null); db.encryptionKey = null; } });
		await assert.rejects(fixture.sync.syncPendingDiffs(), /認証/);
		assert.ok(fixture.pending());
		assert.equal(fixture.sync.isSyncing, false);
	});
	it('halts ordinary synchronization when a replacement ACK CAS fails', async () => {
		const fixture = createPendingSync();
		fixture.db.acknowledgePendingImport = async () => false;
		await assert.rejects(fixture.sync.syncBidirectional(), /インポート|変更/);
		assert.deepEqual(fixture.actions.map(item => item.action), ['fetch_state', 'replace_import']);
		assert.ok(fixture.pending());
	});
});


describe('complete import real encrypted DB and signed GAS synchronization', () => {
	let env, db, sync;
	beforeEach(async () => {
		env = new MockGasEnvironment(); env.setupGlobals();
		db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		const keys = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		gas.saveJsonFile('master_config.json', sharedMasterConfig(await db.getMasterConfig()));
		gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
		sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => { const response = gas.doPost({ postData: { contents: options.body } }); return { ok: true, text: async () => JSON.stringify(response) }; } });
	});
	afterEach(() => env.teardownGlobals());
	async function queue(data) {
		const plan = await db.prepareReplacementImport(data);
		await db.commitReplacementImport(plan, { confirmation: '完全インポート' });
	}
	it('commits the recalculated replacement snapshot even when pending-only sync performs no later download', async () => {
		const original = transaction('closed-replacement', { date: '2026-09-01', target_month: '2026-09', sync_status: 'synced', amount: 100 });
		await db.putTransaction(original);
		gas.saveJsonFile('archives/2026-09.json', { transactions: [original] });
		const snapshot = await db.getSnapshot();
		snapshot.monthly_summaries['2026-09'] = gas.computeMonthlySummary([original], snapshot.account_balances);
		snapshot.account_balances = snapshot.monthly_summaries['2026-09'].closing_balances;
		await db.saveSnapshot(snapshot); gas.saveJsonFile('summary_snapshot.json', snapshot);
		await queue(importData('transactions', { transactions: [{ ...original, amount: 300 }] }));
		const actions = [], fetch = sync.fetch;
		sync.fetch = async (...args) => { actions.push(JSON.parse(args[1].body).action); return fetch(...args); };
		await sync.syncPendingDiffs();
		assert.deepEqual(actions, ['fetch_state', 'replace_import']);
		assert.equal((await db.getSnapshot()).monthly_summaries['2026-09'].expense_total, 300);
		assert.equal((await db.getSnapshot()).account_balances.acc_wallet, 14700);
		assert.deepEqual(await db.getSnapshot(), serverState().snapshot);
		assert.equal(await db.getPendingImport(), null);
	});
	for (const type of ['master_config', 'annual_budgets', 'full_backup']) {
		it(`preserves later local settings and transactions around ${type} replacement ACK`, async () => {
			const config = await db.getMasterConfig(); config.accounts[0].name = 'JSON の口座';
			config.annual_budgets = { 2026: { expense_budget: 200, savings_target_amount: 10, savings_target_rate: 0, category_budgets: { cat_food: 100 } } };
			const data = importData(type, type === 'annual_budgets' ? { annual_budgets: config.annual_budgets } : { master_config: config, ...(type === 'full_backup' ? { summary_snapshot: await db.getSnapshot(), transactions: [transaction('imported')] } : {}) });
			await queue(data);
			const fetch = sync.fetch;
			let edited = false;
			sync.fetch = async (...args) => {
				const response = await fetch(...args);
				if (JSON.parse(args[1].body).action === 'replace_import' && !edited) {
					edited = true;
					const current = await db.getMasterConfig(); current.accounts[0].name = '送信中のローカル編集';
					await db.saveMasterConfig(current);
					await db.putTransaction(transaction('later-local'));
				}
				return response;
			};
			await sync.syncBidirectional();
			assert.equal(await db.getPendingImport(), null);
			assert.equal((await db.getMasterConfig()).accounts[0].name, '送信中のローカル編集');
			assert.equal(serverState().master_config.accounts[0].name, '送信中のローカル編集');
			assert.ok(serverState().pending_diffs.some(tx => tx.id === 'later-local'));
			assert.ok(await db.getTransaction('later-local'));
			assert.deepEqual(await db.getMasterSyncBase(), serverState().master_config);
		});
	}
	it('does not resend accepted closed records or recalculate a manually imported snapshot', async () => {
		const originalSnapshot = await db.getSnapshot();
		originalSnapshot.account_balances.acc_wallet = 424242;
		originalSnapshot.monthly_summaries = { '2026-09': { income_total: 123456, expense_total: 789, net_income: 122667, by_category: {}, by_actual_category: {}, closing_balances: { acc_wallet: 424242 } } };
		await queue(importData('full_backup', { master_config: await db.getMasterConfig(), summary_snapshot: originalSnapshot, transactions: [transaction('closed', { target_month: '2026-09', date: '2026-09-01' })] }));
		const fetch = sync.fetch, actions = [];
		sync.fetch = async (...args) => { actions.push(JSON.parse(args[1].body).action); return fetch(...args); };
		let approvals = 0;
		await sync.syncBidirectional({ approveReclose: async () => { approvals++; return false; } });
		assert.equal(approvals, 0);
		assert.equal(actions.includes('retroactive_update'), false);
		assert.equal(actions.includes('push_diff'), false);
		assert.equal(actions.includes('close_month'), false);
		assert.deepEqual((await db.getSnapshot()).account_balances, originalSnapshot.account_balances);
		assert.deepEqual(serverState().snapshot, originalSnapshot);
		assert.equal((await db.getTransaction('closed')).sync_status, 'synced');
	});
	it('resends only closed records edited during replacement and preserves untouched imported records', async () => {
		await queue(importData('full_backup', { master_config: await db.getMasterConfig(), summary_snapshot: await db.getSnapshot(), transactions: ['unchanged', 'edited'].map(id => transaction(id, { target_month: '2026-09', date: '2026-09-01' })) }));
		const fetch = sync.fetch, retroactive = [];
		let changed = false;
		sync.fetch = async (...args) => {
			const request = JSON.parse(args[1].body);
			if (request.action === 'push_diff') retroactive.push(...request.payload.transactions.filter(tx => tx.target_month <= '2026-09').map(tx => tx.id));
			const response = await fetch(...args);
			if (request.action === 'replace_import' && !changed) { changed = true; await db.putTransaction(transaction('edited', { target_month: '2026-09', date: '2026-09-01', amount: 999, updated_at: '2026-10-22T00:00:00Z' })); }
			return response;
		};
		await sync.syncBidirectional({ approveReclose: async () => true });
		assert.deepEqual(retroactive, ['edited']);
		assert.equal((await db.getTransaction('unchanged')).sync_status, 'synced');
		assert.equal(serverState().archived_transactions.find(tx => tx.id === 'edited').amount, 999);
	});

	for (const editDuringSend of [false, true]) {
		it(`propagates older imported values over known future timestamps and preserves concurrent local edits (${editDuringSend})`, async () => {
			const previous = transaction('shared', { amount: 111, updated_at: '2099-12-31T23:59:59.000Z', sync_status: 'synced' });
			gas.saveJsonFile('pending_diffs.json', { transactions: [previous] });
			const other = new YoseDB(); await other.init(); other.setEncryptionKey(await generateDatabaseMasterKey());
			await other.putTransaction(previous);
			const otherSync = new SyncManager({ db: other, privateKey: sync.privateKey, gasUrl: sync.gasUrl, customFetch: sync.fetch });
			const imported = transaction('shared', { amount: 222, updated_at: '2000-01-01T00:00:00Z' });
			await queue(importData('transactions', { transactions: [imported] }));
			const fetch = sync.fetch;
			let acceptedTime = null;
			sync.fetch = async (...args) => {
				const response = await fetch(...args);
				if (JSON.parse(args[1].body).action === 'replace_import') {
					acceptedTime = JSON.parse(await response.text()).imported_at;
					if (editDuringSend) await db.putTransaction({ ...imported, amount: 999, updated_at: '2026-10-22T00:00:00Z' });
				}
				return response;
			};
			await sync.syncBidirectional();
			assert.ok(Date.parse(acceptedTime) > Date.parse(previous.updated_at));
			assert.equal((await db.getTransaction('shared')).amount, editDuringSend ? 999 : 222);
			assert.equal(serverState().pending_diffs[0].amount, editDuringSend ? 999 : 222);
			if (editDuringSend) assert.ok(Date.parse((await db.getTransaction('shared')).updated_at) > Date.parse(acceptedTime));
			await otherSync.syncBidirectional();
			assert.equal((await other.getTransaction('shared')).amount, editDuringSend ? 999 : 222);
		});
	}

	it('propagates omitted synced IDs as tombstones to another device while retaining its new unsynced ID', async () => {
		const oldPending = transaction('old-pending', { sync_status: 'synced', updated_at: '2026-10-22T00:00:00Z' });
		const oldArchive = transaction('old-archive', { target_month: '2026-09', date: '2026-09-01', sync_status: 'synced' });
		gas.saveJsonFile('pending_diffs.json', { transactions: [oldPending] });
		gas.saveJsonFile('archives/2026-09.json', { transactions: [oldArchive] });
		const other = new YoseDB(); await other.init(); other.setEncryptionKey(await generateDatabaseMasterKey());
		await other.putTransactions([oldPending, oldArchive, transaction('other-new')]);
		const otherSync = new SyncManager({ db: other, privateKey: sync.privateKey, gasUrl: sync.gasUrl, customFetch: sync.fetch });
		await queue(importData('transactions', { transactions: [transaction('replacement')] }));
		await sync.syncBidirectional();
		const remote = serverState();
		const removed = [...remote.pending_diffs, ...remote.archived_transactions].filter(tx => tx.is_deleted);
		assert.deepEqual(removed.map(tx => tx.id).sort(), ['old-archive', 'old-pending']);
		assert.ok(removed.every(tx => Date.parse(tx.updated_at) > Date.parse(oldPending.updated_at)));
		await otherSync.syncBidirectional();
		assert.deepEqual((await other.getTransactions()).map(tx => tx.id).sort(), ['other-new', 'replacement']);
		assert.equal((await other.getTransaction('old-pending')).is_deleted, true);
		assert.equal((await other.getTransaction('old-archive')).is_deleted, true);
		assert.ok(serverState().pending_diffs.some(tx => tx.id === 'other-new' && !tx.is_deleted));
	});

	it('retains the outbox when the signing key changes during encrypted ACK preparation', async () => {
		await queue(importData('transactions', { transactions: [transaction('ack-race')] }));
		const originalKey = sync.privateKey, replacementKey = (await generateEd25519KeyPair()).privateKey;
		const encrypt = db.encryptRecord.bind(db);
		let changed = false;
		db.encryptRecord = async (payload, ...args) => {
			const encrypted = await encrypt(payload, ...args);
			if (payload.id === 'ack-race' && payload.sync_status === 'synced' && !changed) { changed = true; sync.setPrivateKey(replacementKey); }
			return encrypted;
		};
		await assert.rejects(sync.syncPendingDiffs(), /認証|鍵/);
		assert.equal(changed, true);
		assert.ok(await db.getPendingImport());
		assert.equal((await db.getTransaction('ack-race')).sync_status, 'unsynced');
		sync.setPrivateKey(originalKey);
		await sync.syncPendingDiffs();
		assert.equal(await db.getPendingImport(), null);
		assert.equal((await db.getTransaction('ack-race')).sync_status, 'synced');
	});

	it('recovers a lost replacement ACK and retains a later edit from another device', async () => {
		const config = await db.getMasterConfig(); config.accounts[0].name = 'JSON の口座';
		await queue(importData('master_config', { master_config: config }));
		const fetch = sync.fetch;
		let lost = false;
		sync.fetch = async (...args) => {
			const response = await fetch(...args);
			if (JSON.parse(args[1].body).action === 'replace_import' && !lost) { lost = true; throw new Error('lost ACK'); }
			return response;
		};
		await assert.rejects(sync.syncBidirectional(), /lost ACK/);
		assert.ok(await db.getPendingImport());
		const remote = serverState().master_config; remote.accounts[1].name = '別端末の後続変更';
		gas.saveJsonFile('master_config.json', remote);
		sync.fetch = fetch;
		await sync.syncBidirectional();
		assert.equal(await db.getPendingImport(), null);
		assert.equal((await db.getMasterConfig()).accounts[0].name, 'JSON の口座');
		assert.equal((await db.getMasterConfig()).accounts[1].name, '別端末の後続変更');
		assert.deepEqual(await db.getMasterSyncBase(), serverState().master_config);
	});
});
