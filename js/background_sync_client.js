/** One transient worker job per synchronization; no durable authentication material. */
import { CURRENT_APP_VERSION } from './version.js';

export function createBackgroundSyncRunner({ container = globalThis.navigator?.serviceWorker, channel = () => new MessageChannel(), readyTimeoutMs = 5000, responseTimeoutMs = 135000 } = {}) {
	const prepare = () => container ? Promise.resolve().then(() => container.register(new URL('./background_sync_worker.js', import.meta.url), { type: 'module', updateViaCache: 'none' })).catch(() => null) : null;
	let registration = prepare();
	/** @param {any} job @param {{ signal?: AbortSignal }} [options] */
	return async (job, { signal } = {}) => {
		if (!container) return null;
		if (signal?.aborted) throw new Error('同期が取消またはロックされました。');
		if (!registration) registration = prepare();
		let readyTimer, finished = false, detach = () => {};
		const worker = await Promise.race([
			registration.then(async registered => {
				if (finished) return null;
				const active = registered?.active || registered?.installing || registered?.waiting;
				if (!active || active.state === 'redundant') return null;
				if (active.state === 'activated') return active;
				return new Promise(resolve => {
					const changed = () => {
						if (active.state !== 'activated' && active.state !== 'redundant') return;
						active.removeEventListener('statechange', changed); resolve(active.state === 'activated' ? active : null);
					};
					detach = () => active.removeEventListener('statechange', changed);
					active.addEventListener('statechange', changed);
				});
			}),
			new Promise(resolve => { readyTimer = setTimeout(() => resolve(null), readyTimeoutMs); })
		]).finally(() => { finished = true; clearTimeout(readyTimer); detach(); });
		if (signal?.aborted) throw new Error('同期が取消またはロックされました。');
		if (!worker) { registration = null; return null; }
		return new Promise((resolve, reject) => {
			const { port1, port2 } = channel();
			const finish = (value, error = null) => {
				clearTimeout(timer); signal?.removeEventListener('abort', cancel); port1.onmessage = null; port1.onmessageerror = null; port1.close();
				if (error) reject(error); else resolve(value);
			};
			const cancel = () => { port1.postMessage('cancel'); finish(null, new Error('同期が取消またはロックされました。')); };
			const timer = setTimeout(() => { port1.postMessage('cancel'); finish(null, new Error('バックグラウンド同期の応答を確認できませんでした。サーバーで処理済みの場合があります。再同期してください。')); }, responseTimeoutMs);
			port1.onmessage = event => {
				if (event.data?.type === 'result') finish(event.data.value);
				else if (event.data?.type === 'unavailable') finish(null);
				else finish(null, new Error(event.data?.message || 'バックグラウンド同期の応答が不正です。'));
			};
			port1.onmessageerror = () => finish(null, new Error('バックグラウンド同期の応答を読み取れませんでした。再同期してください。'));
			signal?.addEventListener('abort', cancel, { once: true });
			try { worker.postMessage({ ...job, type: 'YOSE_BACKGROUND_SYNC', version: CURRENT_APP_VERSION }, [port2]); }
			catch (error) { port2.close(); finish(null, error); }
		});
	};
}
