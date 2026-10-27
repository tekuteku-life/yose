import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { SummaryController } from '../../js/ui/summary_controller.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const financialFields = ['id', 'date', 'target_month', 'type', 'amount', 'account_id', 'to_account_id', 'category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id', 'tax_meta', 'amortization_meta'];
const financialContent = records => records.map(record => financialFields.map(field => record[field])).sort((a, b) => a[0].localeCompare(b[0]));
it('closes and recloses twelve months through signatures, GAS archives and encrypted local snapshots without double counting', async () => {
	const env = new MockGasEnvironment(); env.setupGlobals();
	const originals = { document: globalThis.document, alert: globalThis.alert, confirm: globalThis.confirm };
	try {
		const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		const master = await db.getMasterConfig();
		const initialBalances = Object.fromEntries(master.accounts.map(account => [account.id, account.initial_balance || 0]));
		await db.saveSnapshot({ schema_version: 2, last_closed_month: null, account_balances: initialBalances, monthly_summaries: {} });
		gas.saveJsonFile('master_config.json', sharedMasterConfig(master));
		gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
		const keys = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		const calls = [];
		const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => {
			const request = JSON.parse(options.body); calls.push(request);
			const response = gas.doPost({ postData: { contents: options.body } });
			return { ok: true, text: async () => JSON.stringify(response) };
		} });
		const months = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);
		const submitted = months.flatMap((month, index) => [
			transaction(`income-${month}`, { date: `${month}-20`, target_month: month, type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', amount: 1000, status: index === 0 || index === 11 ? 'planned' : 'confirmed' }),
			transaction(`expense-${month}`, { date: `${month}-20`, target_month: month, amount: 100 })
		]);
		await db.putTransactions(submitted);
		const elements = new Map(), alerts = [];
		globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, { disabled: false, textContent: '' }); return elements.get(id); } };
		globalThis.alert = message => alerts.push(message);
		globalThis.confirm = () => true;
		const controller = new SummaryController({ db, syncManager: sync, analyticsGranularity: 'yearly', selectedYear: '2026', currentMonth: '2026-10', authController: { authGeneration: 1 }, isKeyLocked: false, refreshAllViews: async () => {} });
		for (let run = 0; run < 2; run++) {
			calls.length = 0;
			await controller.handleCloseMonth();
			assert.match(alerts.at(-1), /12か月の月締めが完了/);
			assert.deepEqual(calls.filter(call => call.action === 'close_month').map(call => call.payload.target_month), months);
			const local = await db.getSnapshot(), remote = gas.loadJsonFile('summary_snapshot.json');
			assert.deepEqual(local, remote);
			assert.equal(local.last_closed_month, '2026-12');
			assert.equal(local.account_balances.acc_wallet, initialBalances.acc_wallet + 12 * 900);
			assert.deepEqual(Object.keys(local.monthly_summaries).sort(), months);
			for (const month of months) {
				assert.equal(local.monthly_summaries[month].income_total, 1000);
				assert.equal(local.monthly_summaries[month].expense_total, 100);
				const archived = gas.loadJsonFile(`archives/${month}.json`).transactions;
				assert.deepEqual(archived.map(tx => [tx.id, tx.amount, tx.type, tx.target_month]).sort(), [[`expense-${month}`, 100, 'expense', month], [`income-${month}`, 1000, 'income', month]]);
				assert.deepEqual(financialContent(archived), financialContent(submitted.filter(tx => tx.target_month === month)));
				assert.ok(archived.every(tx => tx.status === 'confirmed'));
			}
			const records = await db.getTransactions();
			assert.equal(records.length, 24);
			assert.deepEqual(records.map(tx => tx.id).sort(), months.flatMap(month => [`expense-${month}`, `income-${month}`]).sort());
			assert.deepEqual(financialContent(records), financialContent(submitted));
			assert.ok(records.every(tx => tx.status === 'confirmed' && tx.sync_status === 'synced'));
		}
	} finally {
		for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
		env.teardownGlobals();
	}
});

const rawBusiness = async db => structuredClone(await db.captureImportState());
const serverSheets = env => structuredClone([...env.spreadsheet.sheets].map(([name, sheet]) => [name, sheet.rows]).sort(([a], [b]) => a.localeCompare(b)));
async function withSignedScenario(run) {
	const env = new MockGasEnvironment(); env.setupGlobals();
	const originals = { document: globalThis.document, alert: globalThis.alert, confirm: globalThis.confirm };
	try {
		const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		const master = await db.getMasterConfig(), initial = Object.fromEntries(master.accounts.map(account => [account.id, account.initial_balance || 0]));
		await db.saveSnapshot({ schema_version: 2, last_closed_month: null, account_balances: initial, monthly_summaries: {} });
		gas.saveJsonFile('master_config.json', sharedMasterConfig(master)); gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
		const keys = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		const calls = [], hooks = {}, alerts = [], elements = new Map();
		const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => {
			const request = JSON.parse(options.body); calls.push(request);
			if (hooks.before) await hooks.before(request);
			const response = gas.doPost({ postData: { contents: options.body } });
			if (hooks.after) await hooks.after(request, response);
			return { ok: true, text: async () => JSON.stringify(response) };
		} });
		globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, { disabled: false, textContent: '' }); return elements.get(id); } };
		globalThis.alert = message => alerts.push(message); globalThis.confirm = () => true;
		const controller = new SummaryController({ db, syncManager: sync, analyticsGranularity: 'yearly', selectedYear: '2026', currentMonth: '2026-10', authController: { authGeneration: 1 }, isKeyLocked: false, refreshAllViews: async () => {} });
		await run({ env, db, sync, controller, calls, hooks, alerts, initial });
	} finally {
		for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
		env.teardownGlobals();
	}
}

for (const defect of ['changed planned version', 'remote unknown amount']) it(`rejects annual closing on ${defect} without changing any local raw record or server business sheet`, async () => {
	await withSignedScenario(async f => {
		await f.db.putTransaction(transaction('january-plan', { date: '2026-01-20', target_month: '2026-01', amount: 100, status: 'planned' }));
		await f.sync.syncPendingDiffs();
		const remote = gas.loadJsonFile('pending_diffs.json');
		remote.transactions[0] = { ...remote.transactions[0], amount: defect === 'remote unknown amount' ? 0 : 200, ...(defect === 'remote unknown amount' ? { amount_pending: true } : {}) };
		gas.saveJsonFile('pending_diffs.json', remote);
		const localBefore = await rawBusiness(f.db), remoteBefore = serverSheets(f.env); f.calls.length = 0;
		await f.controller.handleCloseMonth();
		assert.deepEqual(f.calls.filter(call => call.action === 'close_month').map(call => call.payload.target_month), ['2026-01']);
		assert.deepEqual(await rawBusiness(f.db), localBefore); assert.deepEqual(serverSheets(f.env), remoteBefore);
		assert.equal((await f.db.getTransaction('january-plan')).status, 'planned');
		assert.match(f.alerts[0], /完了済み: なし/); assert.match(f.alerts[0], /停止した月: 2026-01/);
		assert.match(f.alerts[0], defect === 'remote unknown amount' ? /金額未入力/ : /未確定の予定が変更/);
	});
});

for (const defect of ['lost response', 'encrypted commit failure']) it(`keeps the server/client closing asymmetry visible after a March ${defect} and stops later submissions`, async () => {
	await withSignedScenario(async f => {
		await f.db.putTransaction(transaction('march-plan', { date: '2026-03-20', target_month: '2026-03', amount: 300, status: 'planned' }));
		await f.sync.syncPendingDiffs();
		const encrypt = f.db.encryptRecord.bind(f.db); let failEncryption = false, localBeforeFailure;
		f.db.encryptRecord = async (...args) => { if (failEncryption) throw new Error('encrypted commit failure'); return encrypt(...args); };
		f.hooks.before = async request => { if (request.action === 'close_month' && request.payload.target_month === '2026-03') localBeforeFailure = await rawBusiness(f.db); };
		f.hooks.after = async (request, response) => {
			if (request.action !== 'close_month' || request.payload.target_month !== '2026-03') return;
			assert.equal(response.success, true);
			if (defect === 'lost response') throw new Error('lost response');
			failEncryption = true;
		};
		f.calls.length = 0; await f.controller.handleCloseMonth();
		assert.deepEqual(f.calls.filter(call => call.action === 'close_month').map(call => call.payload.target_month), ['2026-01', '2026-02', '2026-03']);
		assert.ok(localBeforeFailure); assert.deepEqual(await rawBusiness(f.db), localBeforeFailure);
		assert.equal((await f.db.getSnapshot()).last_closed_month, '2026-02');
		assert.equal((await f.db.getTransaction('march-plan')).status, 'planned');
		assert.equal(gas.loadJsonFile('summary_snapshot.json').last_closed_month, '2026-03');
		assert.deepEqual(gas.loadJsonFile('archives/2026-03.json').transactions.map(tx => [tx.id, tx.status, tx.amount]), [['march-plan', 'confirmed', 300]]);
		assert.deepEqual(gas.loadJsonFile('archives/2026-04.json', { transactions: [] }).transactions, []);
		assert.match(f.alerts[0], /完了済み: 2026-01、2026-02/); assert.match(f.alerts[0], /停止した月: 2026-03/); assert.match(f.alerts[0], /同期で確認/);
	});
});

it('recloses a selected earlier year without moving a later closing boundary or counting later income twice', async () => {
	await withSignedScenario(async f => {
		await f.db.putTransactions([
			transaction('earlier-expense', { date: '2026-10-20', target_month: '2026-10', amount: 100 }),
			transaction('later-income', { date: '2027-01-20', target_month: '2027-01', type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', amount: 500 })
		]);
		await f.sync.closeMonth('2026-10'); await f.sync.closeMonth('2027-01');
		const balance = (await f.db.getSnapshot()).account_balances.acc_wallet;
		f.calls.length = 0; await f.controller.handleCloseMonth();
		const snapshot = await f.db.getSnapshot();
		assert.match(f.alerts[0], /12か月の月締めが完了/);
		assert.equal(f.calls.filter(call => call.action === 'close_month').length, 12);
		assert.equal(snapshot.last_closed_month, '2027-01'); assert.equal(snapshot.account_balances.acc_wallet, balance);
		assert.equal(snapshot.account_balances.acc_wallet, f.initial.acc_wallet + 400);
		assert.equal(snapshot.monthly_summaries['2026-10'].expense_total, 100); assert.equal(snapshot.monthly_summaries['2027-01'].income_total, 500);
		assert.equal((await f.db.getTransactions()).length, 2); assert.deepEqual(snapshot, gas.loadJsonFile('summary_snapshot.json'));
	});
});
