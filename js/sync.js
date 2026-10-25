/**
 * Yoseatsume Kakeibo - GAS Synchronization Client
 */

import { createSignedRequest, canonicalJsonStringify } from './crypto.js';
import { DEFAULT_MASTER_CONFIG } from './db/defaults.js';
import { sharedMasterConfig, mergeMasterConfigs, resolveMasterConflicts } from './logic/master_sync.js';

class MasterConflictError extends Error {
	constructor(paths, cancelled, reason = null) {
		super(`設定マスタの確認が必要です（${paths.join('、')}）。`);
		this.name = 'MasterConflictError';
		this.paths = paths;
		this.cancelled = cancelled;
		this.reason = reason;
	}
}

export class SyncManager {
	/**
	 * @param {object} [options]
	 * @param {import('./db.js').YoseDB} [options.db]
	 * @param {CryptoKey} [options.privateKey]
	 * @param {string} [options.gasUrl]
	 * @param {Function} [options.customFetch]
	 */
	constructor({ db, privateKey = null, gasUrl = '', customFetch = null } = {}) {
		this.db = db;
		this.privateKey = privateKey;
		this.gasUrl = gasUrl;
		this.fetch = customFetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
		this._stateListeners = new Set();
		this._masterListeners = new Set();
		this._isSyncing = false;
		this._masterSyncRequested = false;
		this.requestTimeoutMs = 30000;
		this.lastSyncedAt = null;
		this.lastError = null;
		this.masterConflictPaths = [];
		this._listenersAttached = false;
		this._onOnlineBound = null;
		this._onVisibilityBound = null;
	}


	get isSyncing() { return this._isSyncing; }

	set isSyncing(value) {
		if (this._isSyncing === value) return;
		this._isSyncing = value;
		for (const listener of this._stateListeners) Promise.resolve().then(() => listener()).catch(error => console.warn('Sync status refresh failed:', error.message));
		if (!value && this._masterSyncRequested) void this.queueMasterSync();
	}

	onStateChange(listener) {
		this._stateListeners.add(listener);
		return () => this._stateListeners.delete(listener);
	}

	onMasterChange(listener) {
		this._masterListeners.add(listener);
		return () => this._masterListeners.delete(listener);
	}

	async queueMasterSync() {
		this._masterSyncRequested = true;
		if (this.isSyncing || !this.gasUrl || !this.privateKey || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
		this._masterSyncRequested = false;
		try { await this.syncMaster(); }
		catch (error) { console.warn('Master sync deferred:', error.message); }
	}

	async syncMaster() {
		if (this.isSyncing) return { status: 'already_syncing' };
		this.isSyncing = true; this.lastError = null;
		let pendingCount = 0;
		try {
			await this.flushPendingImport();
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			const remote = await this.sendRequest('fetch_master', {});
			await this.syncSharedMaster(remote.master_config);
			return { status: 'synced' };
		} catch (error) {
			if (error instanceof MasterConflictError) return this.masterConflictOutcome(error, 0, 0, pendingCount);
			this.lastError = error.message; throw error;
		}
		finally { this.isSyncing = false; }
	}

	async flushPendingImport() {
		if (!this.db.getPendingImport) return;
		const privateKey = this.privateKey, encryptionKey = this.db.encryptionKey;
		const isSessionValid = () => Boolean(privateKey) && this.privateKey === privateKey && this.db.encryptionKey === encryptionKey;
		const checkSession = () => {
			if (!isSessionValid()) throw new Error('認証がロックまたは変更されました。解除後に完全インポートを同期し直してください。');
		};
		let pending = await this.db.getPendingImport();
		if (!pending) return;
		checkSession();
		if (pending.base_version === undefined) {
			const remote = await this.sendRequest('fetch_state', {});
			checkSession();
			if (typeof remote.state_version !== 'string') throw new Error('完全インポート同期には GAS の更新が必要です。手元のデータと送信待ちを保持しています。');
			const bound = { ...pending, base_version: remote.state_version };
			if (!await this.db.updatePendingImport(pending, bound, { isSessionValid })) throw new Error('完全インポートの送信待ちが変更されました。再度同期してください。');
			pending = bound;
		}
		checkSession();
		const response = await this.sendRequest('replace_import', { import_id: pending.id, data: pending.data, base_version: pending.base_version });
		checkSession();
		if (response.import_id !== pending.id) throw new Error('完全インポートの同期応答を確認できませんでした。送信待ちを保持しています。');
		if (Array.isArray(pending.data.transactions) && (typeof response.imported_at !== 'string' || !Number.isFinite(Date.parse(response.imported_at)))) throw new Error('完全インポートの受理時刻を確認できませんでした。送信待ちを保持しています。');
		if (!await this.db.acknowledgePendingImport(pending, Object.hasOwn(response, 'master_config') ? response.master_config : undefined, { isSessionValid, importedAt: response.imported_at, importedSnapshot: response.snapshot })) throw new Error('完全インポートの送信待ちが変更されました。再度同期してください。');
		this.masterConflictPaths = [];
	}

	masterConflictOutcome(error, syncedCount = 0, downloadedCount = 0, pendingCount = 0) {
		this.masterConflictPaths = [...error.paths];
		this.lastError = null;
		return {
			status: error.cancelled ? 'master_conflict_cancelled' : 'master_conflict',
			conflict_paths: [...error.paths],
			reason: error.reason,
			synced_count: syncedCount,
			downloaded_count: downloadedCount,
			pending_count: pendingCount
		};
	}

	async syncSharedMaster(remoteConfig, approveMasterConflict = null, { remoteState = null } = {}) {
		if (remoteConfig != null && (typeof remoteConfig !== 'object' || Array.isArray(remoteConfig))) throw new Error('受信設定の形式が不正です。');
		const privateKey = this.privateKey, encryptionKey = this.db.encryptionKey;
		const isSessionValid = () => this.privateKey !== null && this.privateKey === privateKey && this.db.encryptionKey === encryptionKey;
		const local = await this.db.getMasterConfig();
		if (remoteConfig == null) {
			await this.db.validateRemoteState(sharedMasterConfig(local), remoteState || {}, local);
			if (remoteState) await this.db.commitSyncResponse([], remoteState, { isSessionValid });
			return;
		}
		const remote = sharedMasterConfig(remoteConfig);
		const sharedLocal = sharedMasterConfig(local);
		const base = await this.db.getMasterSyncBase() || (Object.keys(remote).some(key => key !== 'schema_version') ? sharedMasterConfig(DEFAULT_MASTER_CONFIG) : { schema_version: 2 });
		const mergeResult = mergeMasterConfigs(base, sharedLocal, remote);
		const { conflicts } = mergeResult;
		let config = mergeResult.config;
		if (conflicts.length) {
			this.masterConflictPaths = [...conflicts];
			if (!approveMasterConflict) throw new MasterConflictError(conflicts, false);
			const validateChoices = async choices => {
				let selections;
				if (choices === true) selections = new Map(mergeResult.conflictDetails.map(detail => [detail.id, 'local']));
				else {
					if (!choices || typeof choices !== 'object' || Array.isArray(choices) || ![Object.prototype, null].includes(Object.getPrototypeOf(choices))) throw new Error('競合項目ごとに採用する設定を選択してください。');
					selections = new Map(Object.entries(choices));
				}
				const candidate = resolveMasterConflicts(mergeResult, selections);
				await this.db.validateRemoteState(candidate, remoteState || {}, local);
				return candidate;
			};
			const choices = await approveMasterConflict(conflicts, mergeResult.conflictDetails, validateChoices);
			if (!choices) throw new MasterConflictError(conflicts, true);
			if (!isSessionValid()) throw new Error('認証がロックまたは変更されました。解除後に設定を確認し直してください。');
			if (canonicalJsonStringify(sharedMasterConfig(await this.db.getMasterConfig())) !== canonicalJsonStringify(sharedLocal)) throw new MasterConflictError(conflicts, false, 'local_changed');
			config = await validateChoices(choices);
		}
		await this.db.validateRemoteState(config, remoteState || {}, local);
		if (!isSessionValid()) throw new Error('認証がロックまたは変更されました。解除後に設定を確認し直してください。');
		let accepted = remote;
		if (canonicalJsonStringify(config) !== canonicalJsonStringify(remote)) {
			const response = await this.sendRequest('update_master', { master_config: config, base_version: canonicalJsonStringify(remote) });
			if (response.master_conflict) throw new Error('設定マスタが別端末で更新されました。手元の変更を保持しています。手動差分同期で再取得してください。');
			accepted = response.master_config || config;
			if (response.snapshot) remoteState = { ...remoteState, snapshot: response.snapshot };
		}
		const committed = await this.db.commitMasterSync(local, accepted, { isSessionValid, remoteState });
		this.masterConflictPaths = [];
		if (canonicalJsonStringify(sharedMasterConfig(committed)) !== canonicalJsonStringify(sharedLocal)) {
			for (const listener of this._masterListeners) Promise.resolve().then(() => listener()).catch(error => console.warn('Master view refresh failed:', error.message));
		}
	}

	setPrivateKey(key) {
		this.privateKey = key;
	}

	setGasUrl(url) {
		this.gasUrl = url;
	}

	attachEventListeners() {
		if (this._listenersAttached || typeof window === 'undefined') return;

		this._onOnlineBound = async () => {
			await this.syncBidirectional().catch(err => {
				console.warn('Online auto-sync failed:', err);
			});
		};

		this._onVisibilityBound = () => {
			if (document.visibilityState === 'hidden') {
				this.syncPendingDiffs({ keepalive: true }).catch(err => {
					console.warn('Visibilitychange sync failed:', err);
				});
			}
		};

		window.addEventListener('online', this._onOnlineBound);
		document.addEventListener('visibilitychange', this._onVisibilityBound);
		this._listenersAttached = true;
	}

	detachEventListeners() {
		if (!this._listenersAttached || typeof window === 'undefined') return;
		if (this._onOnlineBound) window.removeEventListener('online', this._onOnlineBound);
		if (this._onVisibilityBound) document.removeEventListener('visibilitychange', this._onVisibilityBound);
		this._listenersAttached = false;
	}

	/**
	 * Send signed request to GAS Web App
	 */
	async sendRequest(action, payload, { keepalive = false } = {}) {
		if (!this.gasUrl) {
			throw new Error('GAS Web App URL is not configured');
		}
		if (!this.privateKey) {
			throw new Error('Ed25519 Private Key is not loaded or unlocked');
		}
		if (!this.fetch) {
			throw new Error('Fetch API is not available');
		}

		const envelope = await createSignedRequest(action, payload, this.privateKey);

		const abort = new AbortController();
		let timer;
		const timeout = new Promise((_, reject) => {
			timer = setTimeout(() => {
				abort.abort();
				reject(new Error('同期通信がタイムアウトしました。サーバーで処理済みの可能性があります。接続を確認し、手動差分同期で最新状態を再取得してください。'));
			}, this.requestTimeoutMs);
		});
		const request = async () => {
			const res = await this.fetch(this.gasUrl, {
				method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
				body: JSON.stringify(envelope), keepalive, signal: abort.signal,
				credentials: 'omit', redirect: 'follow'
			});
			if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
			const text = await res.text();
			let data;
			try { data = JSON.parse(text); }
			catch (error) { throw new Error(`Invalid JSON response from server: ${text}`); }
			if (!data?.success) throw new Error(data?.error || 'Server returned failure response');
			return data;
		};
		try { return await Promise.race([request(), timeout]); }
		catch (error) {
			if (error.name === 'AbortError') throw new Error('同期通信がタイムアウトしました。サーバーで処理済みの可能性があります。接続を確認し、手動差分同期で最新状態を再取得してください。');
			if (error instanceof TypeError || /Failed to fetch|fetch error|NetworkError/i.test(error.message)) throw new Error(`GASに接続できませんでした。ネット接続、GASの公開権限、保存URL（デプロイ済みの /exec）を確認してください。手元の変更は保持しています。詳細: ${error.message}`);
			throw error;
		} finally { clearTimeout(timer); }

	}

	async sendAction(action, payload, options) {
		return this.sendRequest(action, payload, options);
	}

	/**
	 * Push all unsynced transactions (pending diffs) to GAS
	 */
	async syncPendingDiffs(options = {}) {
		if (this.isSyncing) return { status: 'already_syncing' };
		this.isSyncing = true; this.lastError = null;
		try { return await this.pushPending(options); }
		catch (error) {
			if (error instanceof MasterConflictError) return this.masterConflictOutcome(error, 0, 0, (await this.db.getUnsyncedTransactions()).length);
			this.lastError = error.message; throw error;
		}
		finally { this.isSyncing = false; }
	}

	sessionGuard() {
		const privateKey = this.privateKey, encryptionKey = this.db.encryptionKey;
		return () => Boolean(privateKey) && this.privateKey === privateKey && this.db.encryptionKey === encryptionKey;
	}

	assertSession(isSessionValid) {
		if (!isSessionValid()) throw new Error('認証がロックまたは変更されました。解除後に同期し直してください。');
	}

	async pushPending({ keepalive = false } = {}) {
		const isSessionValid = this.sessionGuard();
		await this.flushPendingImport();
		const unsynced = await this.db.getUnsyncedTransactions();
		if (!unsynced?.length) return { status: 'up_to_date', synced_count: 0 };
		const remoteMaster = await this.sendRequest('fetch_master', {}, { keepalive });
		await this.syncSharedMaster(remoteMaster.master_config);
		this.assertSession(isSessionValid);
		const response = await this.sendRequest('push_diff', { transactions: unsynced }, { keepalive });
		const committed = await this.db.commitSyncResponse(unsynced, { ...response, accepted_ids: response.accepted_ids || unsynced.map(tx => tx.id) }, { isSessionValid });
		this.lastSyncedAt = new Date().toISOString();
		return { status: 'synced', synced_count: committed.synced_count, response };
	}

	async downloadTransactions(approveMasterConflict = null) {
		await this.flushPendingImport();
		const response = await this.sendRequest('fetch_state', {});
		const before = new Map((await this.db.getTransactions({ includeDeleted: true })).map(tx => [tx.id, canonicalJsonStringify(tx)]));
		await this.syncSharedMaster(response.master_config, approveMasterConflict, { remoteState: response });
		let count = 0;
		for (const tx of await this.db.getTransactions({ includeDeleted: true })) if (before.get(tx.id) !== canonicalJsonStringify(tx)) count++;
		return { response, count };
	}

	async syncBidirectional({ approveReclose = null, approveMasterConflict = null } = {}) {
		if (this.isSyncing) return { status: 'already_syncing', synced_count: 0, downloaded_count: 0 };
		this.isSyncing = true; this.lastError = null;
		let stage = '受信';
		let syncedCount = 0, downloadedCount = 0;
		let pendingCount = 0;
		try {
			const first = await this.downloadTransactions(approveMasterConflict);
			downloadedCount += first.count;
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			const closed = (await this.db.getSnapshot())?.last_closed_month;
			const pending = await this.db.getUnsyncedTransactions();
			const affectedMonths = tx => [tx.target_month, tx.previous_target_month, ...(first.response.archived_transactions || []).filter(remote => remote.id === tx.id).map(remote => remote.target_month)].filter(month => month && closed && month <= closed);
			const awaiting = pending.filter(tx => affectedMonths(tx).some(month => !tx.reclose_approved_months?.includes(month)));
			if (awaiting.length) {
				const months = [...new Set(awaiting.flatMap(affectedMonths))].sort();
				if (!approveReclose || !await approveReclose(awaiting, months)) return { status: 'approval_required', synced_count: 0, downloaded_count: first.count, pending_count: pending.length };
				for (const tx of awaiting) {
					if (!await this.db.approveTransactionReclose(tx, months)) return { status: 'approval_required', synced_count: 0, downloaded_count: first.count, pending_count: (await this.db.getUnsyncedTransactions()).length };
				}
			}
			stage = '送信';
			const uploaded = await this.pushPending();
			syncedCount = uploaded.synced_count;
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			stage = '再受信';
			const last = await this.downloadTransactions(approveMasterConflict);
			downloadedCount += last.count;
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			this.lastSyncedAt = new Date().toISOString();
			return { status: 'synced', synced_count: uploaded.synced_count, downloaded_count: first.count + last.count, pending_count: (await this.db.getUnsyncedTransactions()).length };
		} catch (error) {
			if (error instanceof MasterConflictError) return this.masterConflictOutcome(error, syncedCount, downloadedCount, pendingCount);
			this.lastError = `${stage}: ${error.message}`; throw new Error(this.lastError);
		}
		finally { this.isSyncing = false; }
	}

	/**
	 * Request Month Closing
	 */
	async closeMonth(targetMonth, { approvedPlanned = [] } = {}) {
		if (this.isSyncing) throw new Error('Another sync operation is in progress');
		this.isSyncing = true; this.lastError = null;
		const isSessionValid = this.sessionGuard();
		try {
			await this.pushPending();
			this.assertSession(isSessionValid);
			const response = await this.sendRequest('close_month', {
				target_month: targetMonth,
				approved_planned: approvedPlanned.map(tx => ({ id: tx.id, version: transactionContentVersion(tx) }))
			});
			await this.db.commitSyncResponse([], response, { isSessionValid });
			this.lastSyncedAt = new Date().toISOString(); return response;
		} catch (error) { this.lastError = error.message; throw error; }
		finally { this.isSyncing = false; }
	}

	/**
	 * Send retroactive update for a past closed month
	 */
	async sendRetroactiveUpdate(transaction, { expectedTransaction = undefined } = {}) {
		if (this.isSyncing) {
			throw new Error('Another sync operation is in progress');
		}
		this.isSyncing = true;
		this.lastError = null;
		const isSessionValid = this.sessionGuard();

		try {
			const requested = structuredClone(transaction);
			const original = await this.db.getTransaction(requested.id) || null;
			const expected = expectedTransaction === undefined ? original : structuredClone(expectedTransaction);
			if (canonicalJsonStringify(expected) !== canonicalJsonStringify(original)) throw new Error('明細が変更されました。再確認してください。');
			const alreadySaved = original && canonicalJsonStringify(requested) === canonicalJsonStringify(original);
			await this.flushPendingImport();
			this.assertSession(isSessionValid);
			let submitted;
			if (alreadySaved) {
				const current = await this.db.getTransaction(requested.id) || null;
				if (canonicalJsonStringify(current) !== canonicalJsonStringify(original)) throw new Error('明細が変更されました。再確認してください。');
				submitted = current;
			} else {
				submitted = await this.db.putTransaction(requested, { expectedTransactions: expected ? [expected] : [] });
			}
			const remoteMaster = await this.sendRequest('fetch_master', {});
			await this.syncSharedMaster(remoteMaster.master_config);
			this.assertSession(isSessionValid);

			const response = await this.sendRequest('retroactive_update', {
				transaction: submitted,
				...(submitted.previous_target_month ? { previous_target_month: submitted.previous_target_month } : {})
			});

			await this.db.commitSyncResponse([submitted], { ...response, accepted_ids: response.conflict ? [] : [submitted.id] }, { isSessionValid });

			this.lastSyncedAt = new Date().toISOString();
			return response;
		} catch (err) {
			this.lastError = err.message;
			throw err;
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * Fetch current remote state (master_config, snapshot, pending_diffs)
	 */
	async fetchRemoteState() {
		if (this.isSyncing) {
			throw new Error('Another sync operation is in progress');
		}
		this.isSyncing = true;
		let pendingCount = 0;
		try {
			await this.flushPendingImport();
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			const { response } = await this.downloadTransactions();
			return response;
		} catch (error) {
			if (error instanceof MasterConflictError) return this.masterConflictOutcome(error, 0, 0, pendingCount);
			this.lastError = error.message; throw error;
		} finally {
			this.isSyncing = false;
		}
	}

}


export function transactionContentVersion(transaction) {
	const content = { ...transaction };
	delete content.sync_status; delete content.previous_target_month; delete content.reclose_approved_months;
	return canonicalJsonStringify(content);
}
