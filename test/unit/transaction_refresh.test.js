import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppCoordinator } from '../../js/ui/coordinator.js';

function gate() {
	let release;
	const promise = new Promise(resolve => { release = resolve; });
	return { promise, release };
}
async function fixture(run) {
	const original = globalThis.document;
	const calls = [], options = [], listeners = new Set(), subscribed = gate();
	let active = 'tab-summary';
	globalThis.document = { getElementById: id => ({ classList: { contains: value => value === 'active' && id === active } }) };
	const step = name => async value => { calls.push(name); options.push([name, value]); };
	const c = Object.assign(Object.create(AppCoordinator.prototype), {
		db: { encryptionKey: {}, processCreditCardAutoSettlements: async (_date, value) => { calls.push('generate'); options.push(['generate', value]); return []; } },
		authController: { authGeneration: 1 }, isKeyLocked: false,
		txInputController: { submitBusy: false, populateMasterDropdowns: step('dropdowns'), updateTagAndMemoSuggestions: step('suggestions'), renderUnsettledAdvanceList: step('advances') },
		txListController: { renderRecentTransactions: step('recent') }, summaryController: { renderSummary: step('summary') },
		settingsController: { renderSettings: step('settings') }, furusatoController: { render: async (_state, value) => step('tax')(value) },
		syncStatusController: { updateSyncBadge: step('badge') }, maintenanceController: { refresh: step('maintenance') },
		syncManager: { isSyncing: false, privateKey: {}, gasUrl: 'https://yose.local/refresh-test', syncPendingDiffs: step('sync'), onStateChange: callback => { listeners.add(callback); subscribed.release(); return () => listeners.delete(callback); } }
	});
	try { await run({ c, calls, options, listeners, subscribed, activate: id => { active = id; } }); }
	finally { if (original === undefined) delete globalThis.document; else globalThis.document = original; }
}

describe('Transaction refresh separates local rendering from background work', { timeout: 30000 }, () => {
	for (const [tab, stage] of [['tab-summary', 'summary'], ['tab-tax', 'tax'], ['tab-settings', 'settings'], ['tab-input', null]]) {
		it(`refreshes only the visible ${tab} stage, recent entries and badge without financial generation`, () => fixture(async f => {
			assert.equal(typeof f.c.refreshAfterTransactionChange, 'function');
			f.activate(tab);
			f.c.scheduleTransactionMaintenance = () => { f.calls.push('scheduled'); return Promise.resolve(); };
			await f.c.refreshAfterTransactionChange();
			assert.deepEqual([...f.calls].sort(), ['recent', 'badge', 'scheduled', ...(stage ? [stage] : [])].sort());
			assert.ok(f.options.every(([, opts]) => typeof opts?.isSessionValid === 'function' && opts.isSessionValid()));
		}));
	}
	it('does not wait for background work and still schedules it when local rendering fails', () => fixture(async f => {
		assert.equal(typeof f.c.refreshAfterTransactionChange, 'function');
		const held = gate(); let scheduled = 0;
		f.c.scheduleTransactionMaintenance = () => { scheduled++; return held.promise; };
		try {
			await f.c.refreshAfterTransactionChange(); assert.equal(scheduled, 1);
			f.c.summaryController.renderSummary = async () => { throw new Error('表示失敗'); };
			await assert.rejects(f.c.refreshAfterTransactionChange(), /表示失敗/);
			assert.equal(scheduled, 2);
		} finally { held.release(); }
	}));
	it('invalidates the visible stage after a tab change and never schedules work for an expired parent', () => fixture(async f => {
		assert.equal(typeof f.c.refreshAfterTransactionChange, 'function');
		const held = gate(), entered = gate(); let stageOptions;
		f.c.summaryController.renderSummary = async value => { stageOptions = value; entered.release(); await held.promise; };
		f.c.scheduleTransactionMaintenance = () => { f.calls.push('scheduled'); };
		let parent = true;
		const pending = f.c.refreshAfterTransactionChange({ isSessionValid: () => parent });
		try {
			await entered.promise; assert.equal(typeof stageOptions?.isSessionValid, 'function');
			f.activate('tab-input'); assert.equal(stageOptions.isSessionValid(), false);
			parent = false; held.release(); await pending;
			assert.equal(f.calls.includes('scheduled'), false);
		} finally { held.release(); await pending; }
	}));
	it('runs maintenance once and redraws only after actual card transactions were generated', () => fixture(async f => {
		assert.equal(typeof f.c.scheduleTransactionMaintenance, 'function');
		const redraws = [];
		f.c.refreshAfterTransactionChange = async value => { redraws.push(value); };
		await f.c.scheduleTransactionMaintenance();
		assert.equal(redraws.length, 0);
		f.c.db.processCreditCardAutoSettlements = async (_date, value) => { f.options.push(['generate', value]); return [{ id: 'generated-card' }]; };
		await f.c.scheduleTransactionMaintenance();
		assert.equal(redraws.length, 1); assert.equal(redraws[0].scheduleMaintenance, false);
		assert.ok(f.options.filter(([name]) => name === 'generate').every(([, value]) => typeof value?.isSessionValid === 'function'));
	}));
	it('waits for an existing synchronization only in the background and coalesces requests before sending', () => fixture(async f => {
		assert.equal(typeof f.c.scheduleTransactionMaintenance, 'function');
		f.c.syncManager.isSyncing = true;
		const first = f.c.scheduleTransactionMaintenance();
		try {
			await f.subscribed.promise;
			assert.ok(f.listeners.size > 0, 'background must observe the actual existing sync completion');
			assert.equal(f.calls.includes('sync'), false);
			const trailing = f.c.scheduleTransactionMaintenance();
			f.c.syncManager.isSyncing = false;
			for (const callback of [...f.listeners]) callback();
			await Promise.all([first, trailing]);
			assert.ok(f.calls.filter(name => name === 'sync').length >= 1);
			assert.ok(f.calls.filter(name => name === 'sync').length <= 2, 'requests must coalesce');
			assert.equal(f.listeners.size, 0);
		} finally {
			f.c.syncManager.isSyncing = false;
			for (const callback of [...f.listeners]) callback();
			await first;
		}
	}));
	for (const result of [
		{ status: 'synced', synced_count: 1 },
		{ status: 'synced', downloaded_count: 1 },
		{ status: 'synced', changes: { received: { summary_snapshot: 1 }, sent: {} } },
		{ status: 'synced', changes: { received: {}, sent: { accounts: 1 } } },
		{ status: 'synced', import_completed: true },
		{ status: 'reclose_confirmation_required', downloaded_count: 1, changes: { received: { summary_snapshot: 1 } } }
	]) it(`redraws committed background synchronization without scheduling more work: ${JSON.stringify(result)}`, () => fixture(async f => {
		const redraws = [];
		f.c.syncManager.syncPendingDiffs = async () => result;
		f.c.refreshAfterTransactionChange = async options => { redraws.push(options); };
		await f.c.scheduleTransactionMaintenance();
		assert.equal(redraws.length, 1);
		assert.equal(redraws[0].scheduleMaintenance, false);
		assert.equal(redraws[0].isSessionValid(), true);
	}));
	it('refreshes a new partially committed lastResult when synchronization throws', () => fixture(async f => {
		let redraws = 0;
		f.c.syncManager.lastResult = { status: 'synced', synced_count: 3 };
		f.c.syncManager.syncPendingDiffs = async () => {
			f.c.syncManager.lastResult = { status: 'failed', changes: { received: { summary_snapshot: 1 } }, partial: true };
			throw new Error('failed after committed receive');
		};
		f.c.refreshAfterTransactionChange = async options => { redraws++; assert.equal(options.scheduleMaintenance, false); };
		await f.c.scheduleTransactionMaintenance();
		assert.equal(redraws, 1);
	}));
	it('does not attribute an old successful lastResult to a new failed synchronization', () => fixture(async f => {
		let redraws = 0;
		f.c.syncManager.lastResult = { status: 'synced', synced_count: 3 };
		f.c.syncManager.syncPendingDiffs = async () => { throw new Error('failed before attempt'); };
		f.c.refreshAfterTransactionChange = async () => { redraws++; };
		await f.c.scheduleTransactionMaintenance();
		assert.equal(redraws, 0);
	}));
	for (const status of ['up_to_date', 'already_syncing', 'reclose_confirmation_required']) it(`does not redraw an uncommitted ${status} result`, () => fixture(async f => {
		let redraws = 0;
		f.c.syncManager.syncPendingDiffs = async () => ({ status, synced_count: 0, downloaded_count: 0, changes: { sent: {}, received: {} } });
		f.c.refreshAfterTransactionChange = async () => { redraws++; };
		await f.c.scheduleTransactionMaintenance();
		assert.equal(redraws, 0);
	}));
	it('does not redraw a committed response from an expired authentication generation', () => fixture(async f => {
		const entered = gate(), held = gate();
		let redraws = 0;
		f.c.syncManager.syncPendingDiffs = async () => { entered.release(); await held.promise; return { status: 'synced', synced_count: 1 }; };
		f.c.refreshAfterTransactionChange = async () => { redraws++; };
		const pending = f.c.scheduleTransactionMaintenance();
		try { await entered.promise; f.c.authController.authGeneration++; held.release(); await pending; assert.equal(redraws, 0); }
		finally { held.release(); await pending; }
	}));
	it('sends a new local version after a request arrives during the first actual send', () => fixture(async f => {
		assert.equal(typeof f.c.scheduleTransactionMaintenance, 'function');
		const sending = gate(), release = gate(), submitted = [];
		let localVersion = 1;
		f.c.syncManager.syncPendingDiffs = async () => {
			submitted.push(localVersion);
			if (submitted.length === 1) { sending.release(); await release.promise; }
		};
		const first = f.c.scheduleTransactionMaintenance(); let trailing;
		try {
			await sending.promise;
			localVersion = 2; trailing = f.c.scheduleTransactionMaintenance();
			release.release(); await Promise.all([first, trailing]);
			assert.deepEqual(submitted, [1, 2], 'a changed local version must not be dropped after the active send');
		} finally { release.release(); await Promise.all([first, trailing]); }
	}));
	for (const changed of ['generation', 'key']) it(`does not overwrite a new maintenance task when an older ${changed} task completes`, () => fixture(async f => {
		assert.equal(typeof f.c.scheduleTransactionMaintenance, 'function');
		const old = gate(), entered = gate(), current = gate(), currentEntered = gate();
		let runs = 0, currentRunning = 0, maxCurrentRunning = 0, oldValid, newValid;
		f.c.db.processCreditCardAutoSettlements = async (_date, value) => {
			runs++;
			if (runs === 1) { oldValid = value?.isSessionValid; entered.release(); await old.promise; }
			else {
				currentRunning++; maxCurrentRunning = Math.max(maxCurrentRunning, currentRunning);
				if (runs === 2) { newValid = value?.isSessionValid; currentEntered.release(); await current.promise; }
				currentRunning--;
			}
			return [];
		};
		const pending = f.c.scheduleTransactionMaintenance();
		let newer, trailing;
		try {
			await entered.promise;
			assert.equal(typeof oldValid, 'function'); assert.equal(oldValid(), true);
			if (changed === 'generation') f.c.authController.authGeneration++;
			else f.c.db.encryptionKey = {};
			assert.equal(oldValid(), false, 'DB must receive the real captured authentication guard');
			newer = f.c.scheduleTransactionMaintenance(); await currentEntered.promise;
			assert.equal(typeof newValid, 'function'); assert.equal(newValid(), true);
			old.release(); await pending;
			assert.equal(f.calls.filter(name => name === 'sync').length, 0);
			trailing = f.c.scheduleTransactionMaintenance();
			assert.equal(runs, 2, 'old completion must not clear the current task and start a parallel task');
			current.release(); await Promise.all([newer, trailing]);
			assert.ok(f.calls.filter(name => name === 'sync').length >= 1);
			assert.equal(maxCurrentRunning, 1, 'old completion must not allow parallel maintenance in the new session');
		} finally { old.release(); current.release(); await Promise.all([pending, newer, trailing]); }
	}));
	it('does not loop after a background send fails and does not refresh busy input candidates', () => fixture(async f => {
		assert.equal(typeof f.c.scheduleTransactionMaintenance, 'function');
		f.c.txInputController.submitBusy = true;
		f.c.syncManager.syncPendingDiffs = async () => { f.calls.push('sync'); throw new Error('offline'); };
		await f.c.scheduleTransactionMaintenance();
		assert.equal(f.calls.filter(name => name === 'sync').length, 1);
		assert.equal(f.calls.includes('suggestions'), false);
	}));
});
