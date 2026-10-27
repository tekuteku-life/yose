import { it } from 'node:test';
import assert from 'node:assert/strict';
import { SummaryController } from '../../js/ui/summary_controller.js';
import { AppCoordinator } from '../../js/ui/coordinator.js';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';

const rawState = async db => structuredClone(Object.fromEntries(await Promise.all(['transactions', 'master_config', 'summary_snapshot', 'settings', 'security_keys'].map(async name => [name, await db.getAllRaw(name)]))));
async function withClosing(run) {
	const originals = { document: globalThis.document, alert: globalThis.alert, confirm: globalThis.confirm };
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveSnapshot({ schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} });
	const elements = new Map(), alerts = [], closed = [], refreshed = [];
	globalThis.document = { getElementById: id => { if (!elements.has(id)) elements.set(id, { disabled: false, textContent: '' }); return elements.get(id); } };
	globalThis.alert = message => alerts.push(message); globalThis.confirm = () => true;
	const coordinator = { db, analyticsGranularity: 'yearly', selectedYear: '2026', currentMonth: '2026-10', authController: { authGeneration: 1 }, isKeyLocked: false,
		syncManager: { closeMonth: async (month, options) => closed.push({ month, options }) },
		refreshAllViews: async options => refreshed.push(options) };
	const controller = new SummaryController(coordinator);
	try { await run({ db, controller, coordinator, elements, alerts, closed, refreshed }); }
	finally { for (const [key, value] of Object.entries(originals)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } }
}

for (const reason of ['cancel', 'unknown amount', 'read failure']) it(`does not close, refresh or change encrypted originals after ${reason} before submission`, async () => {
	await withClosing(async f => {
		await f.db.putTransaction(transaction('keep', { target_month: '2026-12', status: 'planned', ...(reason === 'unknown amount' ? { amount: 0, amount_pending: true } : {}) }));
		const before = await rawState(f.db);
		if (reason === 'cancel') globalThis.confirm = () => false;
		if (reason === 'read failure') {
			const read = f.db.getTransactions.bind(f.db);
			f.db.getTransactions = filter => { if (filter?.target_month === '2026-06') throw new Error('June read failed'); return read(filter); };
		}
		await f.controller.handleCloseMonth();
		assert.deepEqual(f.closed, []);
		assert.deepEqual(f.refreshed, [], 'pre-submission exit must not run the auto-settlement refresh path');
		assert.deepEqual(await rawState(f.db), before);
		assert.equal(f.elements.get('btn-close-month').disabled, false);
		if (reason !== 'cancel') assert.match(f.alerts.at(-1), reason === 'unknown amount' ? /金額未入力/ : /June read failed/);
	});
});

it('refreshes a completed annual close once through the read-only path', async () => {
	await withClosing(async f => {
		await f.controller.handleCloseMonth();
		assert.equal(f.closed.length, 12);
		assert.equal(f.refreshed.length, 1); assert.equal(f.refreshed[0].generateSettlements, false);
		assert.equal(typeof f.refreshed[0].isSessionValid, 'function'); assert.equal(f.refreshed[0].isSessionValid(), true);
		assert.match(f.alerts[0], /12か月の月締めが完了/);
	});
});

it('refreshes after a submission failure without starting later months or generating settlements', async () => {
	await withClosing(async f => {
		f.coordinator.syncManager.closeMonth = async month => { f.closed.push(month); throw new Error('network disconnected'); };
		await f.controller.handleCloseMonth();
		assert.deepEqual(f.closed, ['2026-01']);
		assert.equal(f.refreshed.length, 1); assert.equal(f.refreshed[0].generateSettlements, false);
		assert.equal(typeof f.refreshed[0].isSessionValid, 'function'); assert.equal(f.refreshed[0].isSessionValid(), true);
		assert.match(f.alerts[0], /完了済み: なし/); assert.match(f.alerts[0], /停止した月: 2026-01/);
	});
});

it('contains a view-refresh rejection while retaining the already committed closing result', async () => {
	await withClosing(async f => {
		f.coordinator.refreshAllViews = async () => { throw new Error('view render failed'); };
		await assert.doesNotReject(f.controller.handleCloseMonth());
		assert.equal(f.closed.length, 12);
		assert.match(f.alerts[0], /12か月の月締めが完了/);
		assert.ok(f.alerts.slice(1).some(message => /表示/.test(message) && /view render failed/.test(message)));
		assert.ok(!f.alerts.some(message => /一括月締めに失敗/.test(message)));
		assert.equal(f.elements.get('btn-close-month').disabled, false);
	});
});

it('keeps duplicate submissions disabled until the final view refresh has completed', async () => {
	await withClosing(async f => {
		let release, started;
		const refreshing = new Promise(resolve => { started = resolve; });
		const gate = new Promise(resolve => { release = resolve; });
		f.coordinator.refreshAllViews = async () => { started(); await gate; };
		const pending = f.controller.handleCloseMonth(); await refreshing;
		const during = { disabled: f.elements.get('btn-close-month').disabled, closing: f.controller.closingMonths };
		const duplicate = f.controller.handleCloseMonth();
		await new Promise(resolve => setImmediate(resolve));
		const sent = f.closed.length;
		release(); await Promise.all([pending, duplicate]);
		assert.deepEqual(during, { disabled: true, closing: true });
		assert.equal(sent, 12);
		assert.equal(f.elements.get('btn-close-month').disabled, false);
	});
});

it('does not resume or refresh an earlier batch after lock and unlock replace its session', async () => {
	await withClosing(async f => {
		f.coordinator.syncManager.closeMonth = async month => {
			f.closed.push(month); f.coordinator.authController.authGeneration += 2;
			f.db.setEncryptionKey(await generateDatabaseMasterKey());
			f.coordinator.isKeyLocked = false;
		};
		await f.controller.handleCloseMonth();
		assert.deepEqual(f.closed, ['2026-01']); assert.deepEqual(f.refreshed, []);
		assert.deepEqual(f.alerts, [], 'an expired batch must not notify a newly unlocked session');
	});
});

it('keeps default auto-settlement refresh but skips all financial mutation in its explicit read-only mode', async () => {
	const previousDocument = globalThis.document;
	globalThis.document = { getElementById: () => ({ classList: { contains: () => false } }) };
	try {
		const calls = [];
		const coordinator = { authController: { authGeneration: 1 }, isKeyLocked: false, db: { encryptionKey: {}, processCreditCardAutoSettlements: async () => calls.push('settlement') },
			txInputController: { populateMasterDropdowns: async () => calls.push('inputs') }, txListController: { renderRecentTransactions: async () => calls.push('recent') },
			summaryController: { renderSummary: async () => calls.push('summary') }, settingsController: { renderSettings: async () => calls.push('settings') },
			syncStatusController: { updateSyncBadge: async () => calls.push('badge') }, maintenanceController: { refresh: async () => calls.push('maintenance') } };
		await AppCoordinator.prototype.refreshAllViews.call(coordinator, { generateSettlements: false });
		assert.deepEqual(calls, ['inputs', 'recent', 'summary', 'settings', 'badge', 'maintenance']);
		calls.length = 0; await AppCoordinator.prototype.refreshAllViews.call(coordinator);
		assert.deepEqual(calls, ['settlement', 'inputs', 'recent', 'summary', 'settings', 'badge', 'maintenance']);
	} finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});

it('does not start later rendering stages when the parent session expires during the first stage', async () => {
	const previousDocument = globalThis.document;
	globalThis.document = { getElementById: () => ({ classList: { contains: () => false } }) };
	try {
		const calls = []; let active = true, release, started, receivedOptions;
		const gate = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { started = resolve; });
		const coordinator = { authController: { authGeneration: 1 }, isKeyLocked: false, db: { encryptionKey: {}, processCreditCardAutoSettlements: async () => calls.push('settlement') },
			txInputController: { populateMasterDropdowns: async options => { receivedOptions = options; calls.push('inputs'); started(); await gate; } },
			txListController: { renderRecentTransactions: async () => calls.push('recent') }, summaryController: { renderSummary: async () => calls.push('summary') },
			settingsController: { renderSettings: async () => calls.push('settings') }, syncStatusController: { updateSyncBadge: async () => calls.push('badge') }, maintenanceController: { refresh: async () => calls.push('maintenance') } };
		const pending = AppCoordinator.prototype.refreshAllViews.call(coordinator, { generateSettlements: false, isSessionValid: () => active });
		await entered;
		const validBefore = receivedOptions?.isSessionValid?.();
		active = false;
		const validAfter = receivedOptions?.isSessionValid?.();
		release(); await pending;
		assert.equal(typeof receivedOptions?.isSessionValid, 'function');
		assert.equal(validBefore, true); assert.equal(validAfter, false, 'the leaf must retain the parent guard instead of capturing a fresh session');
		assert.deepEqual(calls, ['inputs']);
	} finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});

it('passes the same live parent guard into every rendering stage including the tax state/options signature', async () => {
	const previousDocument = globalThis.document;
	globalThis.document = { getElementById: id => ({ classList: { contains: () => id === 'tab-tax' } }) };
	try {
		const received = []; let active = true;
		const capture = stage => async options => received.push({ stage, options });
		const coordinator = { authController: { authGeneration: 1 }, isKeyLocked: false, db: { encryptionKey: {}, processCreditCardAutoSettlements: async () => assert.fail('read-only rendering must not generate financial records') },
			txInputController: { populateMasterDropdowns: capture('inputs') }, txListController: { renderRecentTransactions: capture('recent') },
			summaryController: { renderSummary: capture('summary') }, settingsController: { renderSettings: capture('settings') },
			furusatoController: { render: async (state = null, options) => received.push({ stage: 'tax', state, options }) },
			syncStatusController: { updateSyncBadge: capture('badge') }, maintenanceController: { refresh: capture('maintenance') } };
		await AppCoordinator.prototype.refreshAllViews.call(coordinator, { generateSettlements: false, isSessionValid: () => active });
		assert.deepEqual(received.map(row => row.stage), ['inputs', 'recent', 'summary', 'settings', 'tax', 'badge', 'maintenance']);
		const shared = received[0].options?.isSessionValid;
		assert.equal(typeof shared, 'function');
		for (const row of received) { assert.equal(row.options?.isSessionValid, shared, `${row.stage} must receive the shared guard`); assert.equal(row.options.isSessionValid(), true); }
		assert.equal(received.find(row => row.stage === 'tax').state, null, 'the options object must remain the second argument of tax rendering');
		active = false;
		for (const row of received) assert.equal(row.options.isSessionValid(), false, `${row.stage} must still observe expiration of the same parent`);
	} finally { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; }
});
