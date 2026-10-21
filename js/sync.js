/**
 * Yoseatsume Kakeibo - GAS Synchronization Client
 */

import { createSignedRequest, canonicalJsonStringify } from './crypto.js';
import { DEFAULT_MASTER_CONFIG } from './db/defaults.js';
import { sharedMasterConfig, mergeMasterConfigs, assertMasterReferences } from './logic/master_sync.js';

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
		try {
			const remote = await this.sendRequest('fetch_master', {});
			await this.syncSharedMaster(remote.master_config);
			return { status: 'synced' };
		} catch (error) { this.lastError = error.message; throw error; }
		finally { this.isSyncing = false; }
	}

	async syncSharedMaster(remoteConfig, approveMasterConflict = null) {
		if (!remoteConfig) return;
		const remote = sharedMasterConfig(remoteConfig);
		const local = await this.db.getMasterConfig();
		const sharedLocal = sharedMasterConfig(local);
		const base = await this.db.getMasterSyncBase() || (Object.keys(remote).some(key => key !== 'schema_version') ? sharedMasterConfig(DEFAULT_MASTER_CONFIG) : { schema_version: 2 });
		const { config, conflicts } = mergeMasterConfigs(base, sharedLocal, remote);
		if (conflicts.length && (!approveMasterConflict || !await approveMasterConflict(conflicts))) throw new Error(`設定マスタが競合しています（${conflicts.join('、')}）。手元とサーバーを保持しました。手動差分同期で解決してください。`);
		assertMasterReferences(config);
		let accepted = remote;
		if (canonicalJsonStringify(config) !== canonicalJsonStringify(remote)) {
			const response = await this.sendRequest('update_master', { master_config: config, base_version: canonicalJsonStringify(remote) });
			if (response.master_conflict) throw new Error('設定マスタが別端末で更新されました。手元の変更を保持しています。手動差分同期で再取得してください。');
			accepted = response.master_config || config;
		}
		const committed = await this.db.commitMasterSync(local, accepted);
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
		catch (error) { this.lastError = error.message; throw error; }
		finally { this.isSyncing = false; }
	}

	async pushPending({ keepalive = false } = {}) {
		const unsynced = await this.db.getUnsyncedTransactions();
		if (!unsynced?.length) return { status: 'up_to_date', synced_count: 0 };
		const snapshot = await this.db.getSnapshot();
		const retroactive = unsynced.filter(tx => tx.previous_target_month || (snapshot?.last_closed_month && tx.target_month <= snapshot.last_closed_month));
		const ids = new Set(retroactive.map(tx => tx.id));
		const pending = unsynced.filter(tx => !ids.has(tx.id));
		let response = null, count = 0;
		for (const transaction of retroactive) {
			response = await this.sendRequest('retroactive_update', { transaction, ...(transaction.previous_target_month ? { previous_target_month: transaction.previous_target_month } : {}) }, { keepalive });
			if (response.conflict && response.transaction) await this.db.mergeRemoteTransactions([response.transaction]);
			else count += await this.db.markTransactionsSynced([transaction.id], [transaction]);
			if (response.snapshot) await this.db.saveSnapshot(response.snapshot);
		}
		if (pending.length) {
			response = await this.sendRequest('push_diff', { transactions: pending }, { keepalive });
			if (response.conflicts?.length) await this.db.mergeRemoteTransactions(response.conflicts);
			count += await this.db.markTransactionsSynced(response.accepted_ids || pending.map(tx => tx.id), pending);
			if (response.snapshot) await this.db.saveSnapshot(response.snapshot);
		}
		this.lastSyncedAt = new Date().toISOString();
		return { status: 'synced', synced_count: count, response };
	}

	async downloadTransactions() {
		const response = await this.sendRequest('fetch_state', {});
		const count = await this.db.mergeRemoteTransactions([...(response.archived_transactions || []), ...(response.pending_diffs || [])]);
		if (response.snapshot) await this.db.saveSnapshot(response.snapshot);
		if (response.archive_months) await this.db.setSetting('downloaded_archive_months', response.archive_months);
		return { response, count };
	}

	async syncBidirectional({ approveReclose = null, approveMasterConflict = null } = {}) {
		if (this.isSyncing) return { status: 'already_syncing', synced_count: 0, downloaded_count: 0 };
		this.isSyncing = true; this.lastError = null;
		let stage = '受信';
		try {
			const first = await this.downloadTransactions();
			await this.syncSharedMaster(first.response.master_config, approveMasterConflict);
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
			stage = '再受信';
			const last = await this.downloadTransactions();
			await this.syncSharedMaster(last.response.master_config, approveMasterConflict);
			this.lastSyncedAt = new Date().toISOString();
			return { status: 'synced', synced_count: uploaded.synced_count, downloaded_count: first.count + last.count, pending_count: (await this.db.getUnsyncedTransactions()).length };
		} catch (error) { this.lastError = `${stage}: ${error.message}`; throw new Error(this.lastError); }
		finally { this.isSyncing = false; }
	}

	/**
	 * Request Month Closing
	 */
	async closeMonth(targetMonth, { approvedPlanned = [] } = {}) {
		if (this.isSyncing) throw new Error('Another sync operation is in progress');
		this.isSyncing = true; this.lastError = null;
		try {
			await this.pushPending();
			const response = await this.sendRequest('close_month', {
				target_month: targetMonth,
				approved_planned: approvedPlanned.map(tx => ({ id: tx.id, version: transactionContentVersion(tx) }))
			});
			if (response.archived_transactions) await this.db.mergeRemoteTransactions(response.archived_transactions);
			if (response.snapshot) await this.db.saveSnapshot(response.snapshot);
			this.lastSyncedAt = new Date().toISOString(); return response;
		} catch (error) { this.lastError = error.message; throw error; }
		finally { this.isSyncing = false; }
	}

	/**
	 * Send retroactive update for a past closed month
	 */
	async sendRetroactiveUpdate(transaction) {
		if (this.isSyncing) {
			throw new Error('Another sync operation is in progress');
		}
		this.isSyncing = true;
		this.lastError = null;

		try {
			// First save locally
			const submitted = await this.db.putTransaction(transaction);

			const response = await this.sendRequest('retroactive_update', {
				transaction: submitted,
				...(submitted.previous_target_month ? { previous_target_month: submitted.previous_target_month } : {})
			});

			// Mark transaction as synced
			if (response.conflict && response.transaction) await this.db.mergeRemoteTransactions([response.transaction]);
			else await this.db.markTransactionsSynced([submitted.id], [submitted]);

			// Update local snapshot with newly cascaded snapshot from server
			if (response.snapshot) {
				await this.db.saveSnapshot(response.snapshot);
			}

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
		try {
			const response = await this.sendRequest('fetch_state', {});
			if (response.master_config) {
				await this.syncSharedMaster(response.master_config);
			}
			if (response.snapshot) {
				await this.db.saveSnapshot(response.snapshot);
			}
			await this.db.mergeRemoteTransactions([...(response.archived_transactions || []), ...(response.pending_diffs || [])]);
			return response;
		} finally {
			this.isSyncing = false;
		}
	}

	/**
	 * Register initial public key to GAS backend (Write-Once setup)
	 * @param {string} publicKeyBase64
	 */
	async registerInitialKey(publicKeyBase64) {
		if (this.isSyncing) {
			throw new Error('Another sync operation is in progress');
		}
		this.isSyncing = true;
		try {
			const response = await this.sendRequest('register_initial_key', {
				publicKey: publicKeyBase64
			});
			return response;
		} catch (err) {
			this.lastError = err.message;
			throw err;
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
