import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createBackgroundSyncRunner } from '../../js/background_sync_client.js';

function fixture({ state = 'activated', response = { type: 'result', value: { completed: true } }, fail = false, responseTimeoutMs = 1000 } = {}) {
	const worker = new EventTarget(); worker.state = state;
	const calls = { registrations: 0, cancelled: 0, closed: 0, dispatched: 0 };
	let port;
	worker.postMessage = message => {
		calls.dispatched++; assert.equal(message.type, 'YOSE_BACKGROUND_SYNC');
		if (fail) throw new Error('clone failure');
		if (response) setImmediate(() => port.onmessage({ data: response }));
	};
	const run = createBackgroundSyncRunner({
		container: { register: async (_url, options) => { calls.registrations++; assert.equal(options.type, 'module'); return { active: worker }; } },
		channel: () => {
			port = { close() { calls.closed++; }, postMessage(message) { if (message === 'cancel') calls.cancelled++; } };
			return { port1: port, port2: { close() { calls.closed++; } } };
		}, readyTimeoutMs: 20, responseTimeoutMs
	});
	return { run, worker, calls, port: () => port };
}

describe('Transient Service Worker message transport', () => {
	it('returns unavailable without a Service Worker API', async () => {
		assert.equal(await createBackgroundSyncRunner({ container: null })({}), null);
		assert.equal(await createBackgroundSyncRunner()({}), null);
	});
	it('falls back after registration rejection and retries preparation on the next attempt', async () => {
		let count = 0;
		const run = createBackgroundSyncRunner({ container: { register: async () => { count++; throw new Error('offline'); } } });
		assert.equal(await run({}), null); assert.equal(await run({}), null); assert.equal(count, 2);
	});
	it('falls back when registration throws synchronously or has no active worker', async () => {
		for (const register of [() => { throw new Error('not allowed'); }, async () => ({})]) assert.equal(await createBackgroundSyncRunner({ container: { register } })({}), null);
	});
	it('does not attach listeners when registration completes after preparation already timed out', async () => {
		let release, listeners = 0;
		const registered = new Promise(resolve => { release = resolve; });
		const run = createBackgroundSyncRunner({ container: { register: () => registered }, readyTimeoutMs: 5 });
		assert.equal(await run({}), null);
		release({ installing: { state: 'installing', addEventListener() { listeners++; } } });
		await new Promise(resolve => setImmediate(resolve)); assert.equal(listeners, 0);
	});
	it('supports a real MessageChannel and the waiting-worker registration shape', async () => {
		const worker = { state: 'activated', postMessage(_job, [port]) { port.postMessage({ type: 'result', value: 'native-channel' }); port.close(); } };
		const run = createBackgroundSyncRunner({ container: { register: async () => ({ waiting: worker }) } });
		assert.equal(await run({}), 'native-channel');
	});
	it('reuses registration, closes ports, and returns the worker result', async () => {
		const f = fixture(); assert.deepEqual(await f.run({}), { completed: true }); assert.deepEqual(await f.run({}), { completed: true });
		assert.equal(f.calls.registrations, 1); assert.equal(f.calls.dispatched, 2); assert.equal(f.calls.closed, 2);
	});
	for (const state of ['redundant', 'installing']) it(`does not dispatch to a ${state} worker that never activates`, async () => {
		const f = fixture({ state }); assert.equal(await f.run({}), null); assert.equal(f.calls.dispatched, 0);
	});
	it('waits for installation and only then dispatches', async () => {
		const f = fixture({ state: 'installing' }); const work = f.run({});
		setImmediate(() => { f.worker.state = 'installed'; f.worker.dispatchEvent(new Event('statechange')); f.worker.state = 'activated'; f.worker.dispatchEvent(new Event('statechange')); });
		assert.deepEqual(await work, { completed: true });
	});
	it('does not use a worker whose installation becomes redundant', async () => {
		const f = fixture({ state: 'installing' }); const work = f.run({});
		setImmediate(() => { f.worker.state = 'redundant'; f.worker.dispatchEvent(new Event('statechange')); });
		assert.equal(await work, null);
	});
	it('permits fallback on a protocol version mismatch before any sync is started', async () => {
		const f = fixture({ response: { type: 'unavailable' } }); assert.equal(await f.run({}), null);
	});
	it('reports worker errors and malformed replies without retrying', async () => {
		for (const response of [{ type: 'error', message: 'worker failed' }, {}]) {
			const f = fixture({ response }); await assert.rejects(f.run({}), /worker failed|応答が不正/); assert.equal(f.calls.dispatched, 1);
		}
	});
	it('reports message cloning failures and closes both ports', async () => {
		const f = fixture({ fail: true }); await assert.rejects(f.run({}), /clone failure/); assert.equal(f.calls.closed, 2);
	});
	it('cancels a running job without retrying or accepting late results', async () => {
		const f = fixture({ response: null }), abort = new AbortController(); const work = f.run({}, { signal: abort.signal });
		const rejected = assert.rejects(work, /取消|ロック/);
		while (!f.port()) await new Promise(resolve => setImmediate(resolve));
		abort.abort(); await rejected; assert.equal(f.calls.cancelled, 1); assert.equal(f.calls.closed, 1);
	});
	it('rejects a cancelled request before dispatch', async () => {
		const f = fixture(), abort = new AbortController(); abort.abort();
		await assert.rejects(f.run({}, { signal: abort.signal }), /取消|ロック/); assert.equal(f.calls.dispatched, 0);
	});
	it('rejects cancellation received while preparing the worker', async () => {
		const f = fixture({ state: 'installing' }), abort = new AbortController(); const work = f.run({}, { signal: abort.signal });
		setImmediate(() => { abort.abort(); f.worker.state = 'activated'; f.worker.dispatchEvent(new Event('statechange')); });
		await assert.rejects(work, /取消|ロック/); assert.equal(f.calls.dispatched, 0);
	});
	it('times out an unknown outcome and requests cancellation', async () => {
		const f = fixture({ response: null, responseTimeoutMs: 5 });
		await assert.rejects(f.run({}), /サーバーで処理済み/); assert.equal(f.calls.cancelled, 1);
	});
	it('rejects unreadable replies', async () => {
		const f = fixture({ response: null }); const work = f.run({}); const rejected = assert.rejects(work, /読み取れません/);
		while (!f.port()) await new Promise(resolve => setImmediate(resolve));
		f.port().onmessageerror(); await rejected;
	});
});
