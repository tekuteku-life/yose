import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runBackgroundSync, attachBackgroundSyncWorker } from '../../js/background_sync_worker.js';
import { CURRENT_APP_VERSION } from '../../js/version.js';
import { YoseDB } from '../../js/db.js';
import { generateEd25519KeyPair, getSubtle } from '../../js/crypto.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';

async function fixture() {
	const db = new YoseDB(); await db.init();
	const { privateKey } = await generateEd25519KeyPair();
	db.setEncryptionKey(await getSubtle().generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
	const remote = { master_config: sharedMasterConfig(await db.getMasterConfig()), snapshot: await db.getSnapshot(), pending_diffs: [], archived_transactions: [], archive_months: [] };
	const job = { type: 'YOSE_BACKGROUND_SYNC', version: CURRENT_APP_VERSION, privateKey, encryptionKey: db.encryptionKey, gasUrl: 'https://gas.test/exec', state: await db.captureImportState(), archiveMonths: [], requestTimeoutMs: 30000 };
	return { job, fetch: async () => ({ ok: true, text: async () => JSON.stringify({ success: true, ...remote }) }) };
}

function scopeFixture() {
	let handler, work; const messages = [];
	const scope = { location: { origin: 'https://yose.test' }, addEventListener: (_name, value) => { handler = value; } };
	const port = { start() {}, close() {}, postMessage(value) { messages.push(value); }, onmessage: null };
	attachBackgroundSyncWorker(scope);
	return { scope, messages, port, dispatch(data, extra = {}) {
		handler({ data, source: { type: 'window' }, origin: scope.location.origin, ports: [port], waitUntil: value => { work = value; }, ...extra });
		return work;
	} };
}

describe('Worker memory and message trust boundaries', () => {
	it('uses only a memory database even when IndexedDB is available, and releases keys after completion', async () => {
		const f = await fixture(), previous = globalThis.window, previousFetch = globalThis.fetch; let opened = 0;
		globalThis.window = { indexedDB: { open() { opened++; throw new Error('persistent DB must not be opened'); } } };
		globalThis.fetch = f.fetch;
		try {
			const output = await runBackgroundSync(f.job);
			assert.equal(output.result.status, 'synced'); assert.equal(output.error, null); assert.equal(opened, 0);
			assert.equal(f.job.privateKey, null); assert.equal(f.job.encryptionKey, null); assert.equal(f.job.state, null);
		} finally { globalThis.fetch = previousFetch; if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
	});
	it('rejects missing or cancelled authentication without retaining keys', async () => {
		for (const mode of ['missing', 'encryption', 'cancelled']) {
			const f = await fixture(), abort = new AbortController();
			if (mode === 'missing') f.job.privateKey = null; else if (mode === 'encryption') f.job.encryptionKey = null; else abort.abort();
			await assert.rejects(runBackgroundSync(f.job, { signal: abort.signal, fetch: f.fetch }), /取消|ロック/);
			assert.equal(f.job.privateKey, null); assert.equal(f.job.encryptionKey, null); assert.equal(f.job.state, null);
		}
	});
	it('checks the wall-clock deadline even when a timeout callback cannot run', async context => {
		const f = await fixture(); context.mock.timers.enable({ apis: ['Date'] });
		const work = runBackgroundSync(f.job, { fetch: f.fetch });
		context.mock.timers.tick(120001);
		await assert.rejects(work, /認証|取消|ロック/); assert.equal(f.job.privateKey, null);
	});
	it('refuses to process a complete import without persistent base-version binding', async () => {
		const f = await fixture(); f.job.state.pending = { encrypted: true, ciphertext: 'pending-import' };
		await assert.rejects(runBackgroundSync(f.job, { fetch: async () => { assert.fail('must not send complete imports from the worker'); } }), /完全インポート/);
		assert.equal(f.job.privateKey, null);
	});
	it('ignores unrelated messages, missing ports, workers, and foreign origins', () => {
		const f = scopeFixture();
		for (const [data, extra] of [[{}, {}], [{ type: 'YOSE_BACKGROUND_SYNC' }, { ports: [] }], [{ type: 'YOSE_BACKGROUND_SYNC' }, { source: null }], [{ type: 'YOSE_BACKGROUND_SYNC' }, { source: { type: 'serviceworker' } }], [{ type: 'YOSE_BACKGROUND_SYNC' }, { origin: 'https://other.test' }]]) assert.equal(f.dispatch(data, extra), undefined);
		assert.deepEqual(f.messages, []);
	});
	it('rejects an old protocol before starting a synchronization', () => {
		const f = scopeFixture(); assert.equal(f.dispatch({ type: 'YOSE_BACKGROUND_SYNC', version: '0.0.0' }), undefined);
		assert.deepEqual(f.messages, [{ type: 'unavailable' }]);
	});
	it('extends the message lifetime through all requests and returns encrypted results', async () => {
		const f = await fixture(), scope = scopeFixture(), previous = globalThis.fetch; globalThis.fetch = f.fetch;
		try {
			const work = scope.dispatch(f.job); assert.ok(work instanceof Promise); await work;
			assert.equal(scope.messages[0].type, 'result'); assert.equal(scope.messages[0].value.result.status, 'synced');
			assert.equal(scope.messages[0].value.state.master.encrypted, true); assert.equal(f.job.encryptionKey, null);
		} finally { globalThis.fetch = previous; }
	});
	it('honors cancellation without exposing request or key details in the failure reply', async () => {
		const f = await fixture(), scope = scopeFixture();
		const work = scope.dispatch(f.job);
		scope.port.onmessage({ data: 'unrelated' }); scope.port.onmessage({ data: 'cancel' });
		await work;
		assert.equal(scope.messages[0].type, 'error'); assert.match(scope.messages[0].message, /サーバーで処理済み/);
		assert.equal(f.job.privateKey, null);
	});
	it('cancels a job after the maximum lifetime', async context => {
		const f = await fixture(), scope = scopeFixture(); context.mock.timers.enable({ apis: ['setTimeout'] });
		const work = scope.dispatch(f.job); context.mock.timers.tick(120000); await work;
		assert.equal(scope.messages[0].type, 'error'); assert.equal(f.job.encryptionKey, null);
	});
	it('registers the worker message handler in the actual worker global scope', async () => {
		const previousSelf = globalThis.self, previousScope = globalThis.ServiceWorkerGlobalScope; let registered = false;
		globalThis.ServiceWorkerGlobalScope = class {};
		globalThis.self = { addEventListener(type) { assert.equal(type, 'message'); registered = true; } };
		try { await import('../../js/background_sync_worker.js?worker-global-test'); assert.equal(registered, true); }
		finally {
			if (previousSelf === undefined) delete globalThis.self; else globalThis.self = previousSelf;
			if (previousScope === undefined) delete globalThis.ServiceWorkerGlobalScope; else globalThis.ServiceWorkerGlobalScope = previousScope;
		}
	});
});
