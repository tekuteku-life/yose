/** Run a short synchronization independently of the page, without persistent keys. */
import { YoseDB } from './db.js';
import { SyncManager } from './sync.js';
import { CURRENT_APP_VERSION } from './version.js';

/** @param {any} job @param {{ signal?: AbortSignal, fetch?: Function }} [options] */
export async function runBackgroundSync(job, { signal, fetch: request = globalThis.fetch } = {}) {
	const db = new YoseDB();
	// The worker must never open or modify the user's persistent database.
	db.idb = null;
	let manager;
	const deadline = Date.now() + 120000;
	const valid = () => !signal?.aborted && Date.now() < deadline;
	try {
		if (!job.privateKey || !job.encryptionKey || !valid()) throw new Error('同期が取消またはロックされました。');
		if (job.state.pending) throw new Error('完全インポートは画面を開いたまま同期してください。');
		await db.init();
		db.setEncryptionKey(job.encryptionKey);
		const state = structuredClone(job.state), stores = db.memoryDb.stores;
		stores.transactions = new Map(state.transactions.map(record => [record.id, record]));
		stores.master_config = new Map([['current', state.master], ['pending_import', state.pending], ['sync_base', state.base]]);
		stores.summary_snapshot.set('current', state.snapshot);
		stores.settings.set('downloaded_archive_months', structuredClone(job.archiveMonths));
		manager = new SyncManager({ db, privateKey: job.privateKey, gasUrl: job.gasUrl, captureSession: () => valid,
			customFetch: (url, options) => request(url, { ...options, signal: signal ? AbortSignal.any([signal, options.signal]) : options.signal }) });
		manager.requestTimeoutMs = job.requestTimeoutMs;
		const attempt = manager.beginAttempt();
		let error = null;
		try { await manager.syncBidirectionalInPage({}, attempt); }
		catch (failure) { error = failure.message; }
		if (!valid()) throw new Error('同期が取消またはロックされました。');
		return { state: await db.captureImportState(), archiveMonths: await db.getSetting('downloaded_archive_months', []),
			result: manager.lastResult, changeIds: { sent: attempt.sent, received: attempt.received }, lastSyncedAt: manager.lastSyncedAt, conflictPaths: manager.masterConflictPaths, error };
	} finally {
		manager?.setPrivateKey(null);
		db.clearEncryptionKey();
		if (db.memoryDb) for (const store of Object.values(db.memoryDb.stores)) store.clear();
		job.privateKey = null; job.encryptionKey = null; job.state = null;
	}
}

export function attachBackgroundSyncWorker(scope) {
	scope.addEventListener('message', event => {
		const port = event.ports[0];
		if (event.data?.type !== 'YOSE_BACKGROUND_SYNC' || !port || event.source?.type !== 'window' || event.origin !== scope.location.origin) return;
		if (event.data.version !== CURRENT_APP_VERSION) { port.postMessage({ type: 'unavailable' }); port.close(); return; }
		const abort = new AbortController();
		const timer = setTimeout(() => abort.abort(), 120000);
		port.onmessage = message => { if (message.data === 'cancel') abort.abort(); };
		port.start();
		event.waitUntil((async () => {
			try { port.postMessage({ type: 'result', value: await runBackgroundSync(event.data, { signal: abort.signal }) }); }
			catch (_) { port.postMessage({ type: 'error', message: 'バックグラウンド同期の完了を確認できませんでした。サーバーで処理済みの場合があります。アプリに戻って再同期してください。' }); }
			finally { clearTimeout(timer); port.close(); }
		})());
	});
}

if (typeof ServiceWorkerGlobalScope !== 'undefined') attachBackgroundSyncWorker(self);
