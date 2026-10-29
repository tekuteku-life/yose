import { it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import vm from 'node:vm';
import { AppCoordinator } from '../../js/ui/coordinator.js';
import { productionSource, coverageGlobals } from '../../scripts/coverage_tools.js';

const filename = path.resolve('js/app.js');
const source = productionSource(filename).replace(/^import[^;]+;/m, '').replace(/^export\s*\{[^}]+\};/m, '');

function entry(t, readyState, { fail = false, existing = null } = {}) {
	const listeners = [], calls = [], errors = [];
	let logged;
	const errorLogged = new Promise(resolve => { logged = resolve; });
	t.mock.method(AppCoordinator.prototype, 'init', function() { calls.push(this); return fail ? Promise.reject(new Error('database open failed')) : Promise.resolve(); });
	const window = { addEventListener(name, listener) { listeners.push({ name, listener }); }, ...(existing ? { __yose_app: existing } : {}) };
	const context = vm.createContext({ ...coverageGlobals(), AppCoordinator, window, document: { readyState }, console: { error(...args) { errors.push(args); logged(); } } });
	new vm.Script(source, { filename }).runInContext(context);
	return { window, listeners, calls, errors, errorLogged };
}

it('registers the browser entry before parsing finishes and starts exactly once', t => {
	const f = entry(t, 'loading');
	assert.equal(f.calls.length, 0); assert.equal(f.window.__yose_app, undefined);
	assert.deepEqual(f.listeners.map(item => item.name), ['DOMContentLoaded']);
	f.listeners[0].listener(); const app = f.window.__yose_app;
	f.listeners[0].listener();
	assert.ok(app instanceof AppCoordinator); assert.deepEqual(f.calls, [app]); assert.equal(f.window.__yose_app, app);
});

it('starts immediately after DOM readiness and retains an already mounted application', t => {
	const f = entry(t, 'complete');
	assert.equal(f.listeners.length, 0); assert.deepEqual(f.calls, [f.window.__yose_app]);
	const existing = f.window.__yose_app;
	const second = entry(t, 'complete', { existing });
	assert.equal(second.window.__yose_app, existing); assert.equal(second.calls.length, 0);
});

it('reports a failed asynchronous initialization through the entry error channel', async t => {
	const f = entry(t, 'complete', { fail: true }); await f.errorLogged;
	assert.equal(f.calls.length, 1); assert.equal(f.errors.length, 1);
	assert.equal(f.errors[0][0], 'Failed to initialize AppController:'); assert.match(f.errors[0][1].message, /database open failed/);
});

it('keeps the imported entry usable outside a browser without starting an application', () => {
	const context = vm.createContext({ ...coverageGlobals(), AppCoordinator });
	assert.doesNotThrow(() => new vm.Script(source, { filename }).runInContext(context));
});
