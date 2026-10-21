/**
 * Yoseatsume Kakeibo - GAS Synchronization Client
 */

import { createSignedRequest, canonicalJsonStringify } from './crypto.js';

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
		this.isSyncing = false;
		this.lastSyncedAt = null;
		this.lastError = null;
		this._listenersAttached = false;
		this._onOnlineBound = null;
		this._onVisibilityBound = null;
	}

	setPrivateKey(key) {
		this.privateKey = key;
	}

	setGasUrl(url) {
		this.gasUrl = url;
	}

	attachEventListeners() {
		if (this._listenersAttached || typeof window === 'undefined') return;

		this._onOnlineBound = () => {
			this.syncPendingDiffs().catch(err => {
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

		const res = await this.fetch(this.gasUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'text/plain;charset=utf-8'
			},
			body: JSON.stringify(envelope),
			keepalive: keepalive
		});

		if (!res.ok) {
			throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
		}

		const text = await res.text();
		let data;
		try {
			data = JSON.parse(text);
		} catch (e) {
			throw new Error(`Invalid JSON response from server: ${text}`);
		}

		if (!data.success) {
			throw new Error(data.error || 'Server returned failure response');
		}

		return data;
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

	async syncBidirectional({ approveReclose = null } = {}) {
		if (this.isSyncing) return { status: 'already_syncing', synced_count: 0, downloaded_count: 0 };
		this.isSyncing = true; this.lastError = null;
		let stage = '受信';
		try {
			const first = await this.downloadTransactions();
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
				await this.db.saveMasterConfig(response.master_config);
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
