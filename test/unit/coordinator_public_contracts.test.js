import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppCoordinator } from '../../js/ui/coordinator.js';

const contracts = [
	['generateNewKeyPair', 'authController', []], ['updateKeyDisplay', 'authController', []],
	['ensureKeyUnlocked', 'authController', []], ['lockPrivateKey', 'authController', []],
	['updateNetworkBadge', 'syncStatusController', []], ['updateSyncBadge', 'syncStatusController', []],
	['handleManualSync', 'syncStatusController', []],
	['renderMonthTransactions', 'txListController', []], ['renderRecentTransactions', 'txListController', []],
	['openEditTransactionModal', 'txEditController', ['record-123']],
	['handleEditFormSubmit', 'txEditController', []], ['handleEditDelete', 'txEditController', ['record-123']],
	['setupInputForm', 'txInputController', []], ['switchInputMode', 'txInputController', ['point']],
	['populateMasterDropdowns', 'txInputController', []],
	['updateSubcategories', 'txInputController', ['cat-food', 'select-subcategory']],
	['setupTaxModal', 'txInputController', []], ['handleFormSubmit', 'txInputController', []],
	['setupSummaryView', 'summaryController', []], ['renderSummary', 'summaryController', []],
	['renderSettings', 'settingsController', []], ['setupMasterTabs', 'masterController', []],
	['renderMasterManagement', 'masterController', []],
	['openMasterModal', 'masterController', ['subcategory', { id: 'child' }, { id: 'parent' }]]
];
const synchronous = new Set(['updateKeyDisplay', 'updateNetworkBadge', 'setupInputForm', 'switchInputMode', 'setupTaxModal', 'setupSummaryView', 'setupMasterTabs']);

describe('AppCoordinator public delegation preserves the legacy interface', () => {
	for (const [method, owner, args] of contracts) it(`${method} preserves receiver, arguments, result and failure`, async () => {
		const app = Object.create(AppCoordinator.prototype), calls = [], result = { from: method };
		app[owner] = { [method](...received) { calls.push({ receiver: this, received }); return result; } };
		if (synchronous.has(method)) assert.equal(app[method](...args), result);
		else {
			let release;
			const child = new Promise(resolve => { release = resolve; });
			app[owner][method] = function(...received) { calls.push({ receiver: this, received }); return child; };
			const returned = app[method](...args); assert.ok(returned instanceof Promise);
			const completed = returned.then(value => ({ state: 'completed', value }));
			try {
				const first = await Promise.race([completed, new Promise(resolve => setImmediate(() => resolve({ state: 'pending' })))]);
				assert.equal(first.state, 'pending', 'facade must remain pending while the child operation is pending');
			} finally { release(result); }
			assert.equal((await completed).value, result);
		}
		assert.equal(calls.length, 1); assert.equal(calls[0].receiver, app[owner]); assert.deepEqual(calls[0].received, args);
		const failure = new Error(`${method} failed`);
		if (synchronous.has(method)) {
			app[owner][method] = () => { throw failure; };
			assert.throws(() => app[method](...args), error => error === failure);
		} else {
			let reject;
			app[owner][method] = () => new Promise((_resolve, fail) => { reject = fail; });
			const returned = app[method](...args); assert.ok(returned instanceof Promise);
			const assertion = assert.rejects(returned, error => error === failure); reject(failure); await assertion;
		}
	});
	it('sets up settings and annual budgets in order and propagates setup failure', () => {
		const app = Object.create(AppCoordinator.prototype), calls = [];
		app.settingsController = { setupSettingsView() { calls.push('settings'); } };
		app.budgetSettingsController = { setup() { calls.push('budget'); } };
		assert.equal(app.setupSettingsView(), undefined); assert.deepEqual(calls, ['settings', 'budget']);
		const failure = new Error('settings setup failed');
		app.settingsController.setupSettingsView = () => { throw failure; };
		assert.throws(() => app.setupSettingsView(), error => error === failure);
		assert.deepEqual(calls, ['settings', 'budget']);
	});
	for (const [property, owner] of [['privateKey', 'authController'], ['publicKey', 'authController'], ['publicKeyBase64', 'authController'], ['isKeyLocked', 'authController'], ['chart', 'chartController']]) it(`${property} stays live in both facade directions`, () => {
		const app = Object.create(AppCoordinator.prototype); app[owner] = {};
		const first = property === 'isKeyLocked' ? true : { first: property }, second = property === 'isKeyLocked' ? false : { second: property };
		app[property] = first; assert.equal(app[owner][property], first);
		app[owner][property] = second; assert.equal(app[property], second);
	});
});
