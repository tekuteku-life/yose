import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { productionSource, coverageGlobals } from '../../scripts/coverage_tools.js';

const filename = path.resolve('sw.js');
const source = productionSource(filename);
const currentCache = JSON.parse(fs.readFileSync('version.json', 'utf8')).cache_name;

function worker({ cacheHit, network, cacheError, putError, keys = [currentCache, 'old-cache'] } = {}) {
	const handlers = new Map();
	const calls = { added: [], deleted: [], put: [], fetch: [], skip: 0, claim: 0 };
	const cache = {
		addAll: async urls => { calls.added.push(...urls); },
		put: async (request, response) => { if (putError) throw putError; calls.put.push({ request, response }); }
	};
	const caches = {
		open: async () => { if (cacheError) throw cacheError; return cache; },
		keys: async () => keys,
		delete: async key => { calls.deleted.push(key); return true; },
		match: async request => request === './index.html' ? 'offline-index' : cacheHit
	};
	const self = {
		addEventListener: (name, handler) => handlers.set(name, handler),
		skipWaiting: () => { calls.skip++; },
		clients: { claim: () => { calls.claim++; } }
	};
	const context = vm.createContext({ ...coverageGlobals(), self, caches, URL, fetch: async request => {
		calls.fetch.push(request);
		if (network instanceof Error) throw network;
		return network;
	} });
	new vm.Script(source, { filename }).runInContext(context);
	async function dispatch(name, values = {}) {
		let work, response;
		handlers.get(name)({ ...values, waitUntil: value => { work = value; }, respondWith: value => { response = value; } });
		if (work) await work;
		const result = response ? await response : undefined;
		await new Promise(resolve => setImmediate(resolve));
		return { result, intercepted: Boolean(response) };
	}
	return { calls, dispatch };
}

const request = (url = 'https://yose.local/js/app.js', method = 'GET', accept = null) => ({ url, method, headers: { get: () => accept } });

describe('Service worker original-source lifecycle and fetch boundaries', () => {
	it('installs all local scripts, activates without deleting the active cache, and claims clients', async () => {
		const w = worker();
		await w.dispatch('install');
		assert.equal(w.calls.skip, 1);
		for (const file of fs.readdirSync('js', { recursive: true }).filter(file => file.endsWith('.js'))) assert.ok(w.calls.added.includes('./js/' + file));
		await w.dispatch('activate');
		assert.deepEqual(w.calls.deleted, ['old-cache']);
		assert.equal(w.calls.claim, 1);
	});
	it('rejects failed installation without taking over existing clients', async () => {
		const w = worker({ cacheError: new Error('cache unavailable') });
		await assert.rejects(w.dispatch('install'), /cache unavailable/);
		assert.equal(w.calls.skip, 0);
	});
	it('separates skip-waiting, full cache deletion, and unknown messages', async () => {
		const w = worker();
		await w.dispatch('message', { data: 'unknown' });
		assert.equal(w.calls.skip, 0);
		await w.dispatch('message', { data: 'SKIP_WAITING' });
		assert.equal(w.calls.skip, 1);
		assert.deepEqual(w.calls.deleted, []);
		await w.dispatch('message', { data: 'CLEAR_ALL_CACHES' });
		assert.deepEqual(w.calls.deleted, [currentCache, 'old-cache']);
	});
	for (const req of [request(undefined, 'POST'), request('data:text/plain,hello'), request('https://yose.local/version.json?time=1'), request('https://script.google.com/macros/s/api/exec')]) {
		it(`leaves network-only or unsupported request alone: ${req.method} ${req.url}`, async () => {
			const w = worker();
			assert.equal((await w.dispatch('fetch', { request: req })).intercepted, false);
			assert.deepEqual(w.calls.fetch, []);
		});
	}
	it('returns a cache hit without network access', async () => {
		const w = worker({ cacheHit: 'cached' });
		assert.equal((await w.dispatch('fetch', { request: request() })).result, 'cached');
		assert.deepEqual(w.calls.fetch, []);
	});
	it('caches a clone of a successful basic response for HTTPS and HTTP', async () => {
		for (const scheme of ['https', 'http']) {
			const network = new Response('network body', { status: 200 });
			Object.defineProperty(network, 'type', { value: 'basic' });
			const w = worker({ network });
			const req = request(`${scheme}://yose.local/js/app.js`);
			assert.equal((await w.dispatch('fetch', { request: req })).result, network);
			assert.equal(w.calls.put[0].request, req);
			assert.notEqual(w.calls.put[0].response, network);
			assert.equal(await w.calls.put[0].response.text(), 'network body');
			assert.equal(await network.text(), 'network body');
		}
	});
	for (const [status, type] of [[503, 'basic'], [200, 'cors']]) {
		it(`does not cache an unsuccessful or non-basic network result ${status}/${type}`, async () => {
			const network = new Response('response', { status });
			Object.defineProperty(network, 'type', { value: type });
			const w = worker({ network });
			assert.equal((await w.dispatch('fetch', { request: request() })).result, network);
			assert.deepEqual(w.calls.put, []);
		});
	}
	for (const failure of ['open', 'put']) {
		it(`preserves the successful response when cache ${failure} fails`, async () => {
			const network = new Response('successful response', { status: 200 });
			Object.defineProperty(network, 'type', { value: 'basic' });
			const w = worker({ network, cacheError: failure === 'open' ? new Error('quota') : null, putError: failure === 'put' ? new Error('quota') : null });
			assert.equal((await w.dispatch('fetch', { request: request() })).result, network);
		});
	}
	for (const accept of ['text/html,application/xhtml+xml', 'application/json', null]) {
		it(`falls back to index only for offline HTML requests ${accept}`, async () => {
			const w = worker({ network: new Error('offline') });
			assert.equal((await w.dispatch('fetch', { request: request(undefined, 'GET', accept) })).result, accept?.includes('text/html') ? 'offline-index' : undefined);
		});
	}
});
