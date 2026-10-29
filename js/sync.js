/**
 * Yoseatsume Kakeibo - GAS Synchronization Client
 */

import { createSignedRequest, canonicalJsonStringify } from './crypto.js';
import { DEFAULT_MASTER_CONFIG } from './db/defaults.js';
import { sharedMasterConfig, mergeMasterConfigs, resolveMasterConflicts } from './logic/master_sync.js';
import { businessChanges, countBusinessChanges, unionBusinessChanges } from './logic/sync_changes.js';

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
	 * @param {Function} [options.captureSession]
	 */
	constructor({ db, privateKey = null, gasUrl = '', customFetch = null, captureSession = null } = {}) {
		this.db = db;
		this.captureSession = captureSession;
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
		this.lastResult = null;
		this._attempt = null;
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

	beginAttempt(parent = null) {
		const valid = this.sessionGuard({ requirePrivateKey: false, parent });
		this.assertSession(valid);
		const attempt = { valid, sent: {}, received: {}, result: { status: 'syncing', synced_count: 0, downloaded_count: 0, pending_count: 0, pending_master: false, changes: { sent: {}, received: {} }, partial: false, error: null } };
		this._attempt = attempt; this.lastResult = attempt.result; this.lastError = null; this.isSyncing = true;
		return attempt;
	}

	recordChanges(direction, ids, attempt) {
		if (!attempt || this._attempt !== attempt || !attempt.valid()) return;
		unionBusinessChanges(attempt[direction], ids);
		attempt.result.changes = { sent: countBusinessChanges(attempt.sent), received: countBusinessChanges(attempt.received) };
	}

	recordCommitted(attempt, committed) {
		if (!attempt || this._attempt !== attempt || !attempt.valid()) return;
		attempt.result.synced_count += committed.synced_count || 0;
		attempt.result.downloaded_count += committed.downloaded_count || 0;
		this.recordChanges('received', committed.change_ids, attempt);
	}

	async finishAttempt(attempt, outcome) {
		if (this._attempt !== attempt || !attempt.valid()) return { ...attempt.result, ...outcome };
		Object.assign(attempt.result, outcome);
		attempt.result.partial = attempt.result.status !== 'synced' && (attempt.result.synced_count > 0 || attempt.result.downloaded_count > 0 || attempt.result.import_completed || Object.keys(attempt.result.changes.sent).length > 0 || Object.keys(attempt.result.changes.received).length > 0);
		const pending = (await this.db.getUnsyncedTransactions()).length;
		if (this._attempt !== attempt || !attempt.valid()) return { ...attempt.result, ...outcome };
		const master = await this.db.hasUnsyncedMasterConfig();
		if (this._attempt !== attempt || !attempt.valid()) return { ...attempt.result, ...outcome };
		Object.assign(attempt.result, { pending_count: pending, pending_master: master });
		return attempt.result;
	}

	async failAttempt(attempt, error) {
		if (this._attempt !== attempt || !attempt.valid()) return;
		this.lastError = error.message;
		try { await this.finishAttempt(attempt, { status: 'failed', error: error.message }); }
		catch (_) { if (this._attempt === attempt && attempt.valid()) Object.assign(attempt.result, { status: 'failed', error: error.message }); }
	}

	endAttempt(attempt) {
		if (this._attempt === attempt) { this._attempt = null; this.isSyncing = false; }
	}

	assertPointAcknowledgement(sent, response) {
		const master = response?.master_config;
		if (!master || typeof master !== 'object' || Array.isArray(master) || canonicalJsonStringify(sent?.point_payment_defaults ?? null) !== canonicalJsonStringify(master.point_payment_defaults ?? null)) throw new Error('GASがポイント相殺設定を受理したことを確認できません。手元の設定を保持しています。GASを更新して同期し直してください。');
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
		const attempt = this.beginAttempt();
		let pendingCount = 0;
		try {
			await this.flushPendingImport({ isSessionValid: attempt.valid });
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			this.assertSession(attempt.valid);
			const remote = await this.sendRequest('fetch_master', {}, { isSessionValid: attempt.valid });
			this.assertSession(attempt.valid);
			await this.syncSharedMaster(remote.master_config, null, { isSessionValid: attempt.valid });
			return await this.finishAttempt(attempt, { status: 'synced' });
		} catch (error) {
			if (error instanceof MasterConflictError) return await this.finishAttempt(attempt, this.masterConflictOutcome(error, 0, 0, pendingCount, attempt));
			await this.failAttempt(attempt, error); throw error;
		}
		finally { this.endAttempt(attempt); }
	}

	async flushPendingImport({ isSessionValid: parent = null } = {}) {
		if (!this.db.getPendingImport) return;
		const attempt = this._attempt;
		const origin = this.sessionGuard({ requirePrivateKey: false, parent });
		const privateKey = this.privateKey;
		const isSessionValid = () => Boolean(privateKey) && origin();
		const checkSession = () => {
			if (!isSessionValid()) throw new Error('認証がロックまたは変更されました。解除後に完全インポートを同期し直してください。');
		};
		let pending = await this.db.getPendingImport();
		this.assertSession(origin);
		if (!pending) return;
		checkSession();
		if (pending.base_version === undefined) {
			const remote = await this.sendRequest('fetch_state', {}, { isSessionValid });
			checkSession();
			if (typeof remote.state_version !== 'string') throw new Error('完全インポート同期には GAS の更新が必要です。手元のデータと送信待ちを保持しています。');
			const bound = { ...pending, base_version: remote.state_version };
			if (!await this.db.updatePendingImport(pending, bound, { isSessionValid })) throw new Error('完全インポートの送信待ちが変更されました。再度同期してください。');
			pending = bound;
		}
		checkSession();
		const response = await this.sendRequest('replace_import', { import_id: pending.id, data: pending.data, base_version: pending.base_version }, { isSessionValid });
		checkSession();
		if (Object.hasOwn(pending.data, 'master_config')) this.assertPointAcknowledgement(pending.data.master_config, response);
		if (response.import_id !== pending.id) throw new Error('完全インポートの同期応答を確認できませんでした。送信待ちを保持しています。');
		if (Array.isArray(pending.data.transactions) && (typeof response.imported_at !== 'string' || !Number.isFinite(Date.parse(response.imported_at)))) throw new Error('完全インポートの受理時刻を確認できませんでした。送信待ちを保持しています。');
		if (!await this.db.acknowledgePendingImport(pending, Object.hasOwn(response, 'master_config') ? response.master_config : undefined, { isSessionValid, importedAt: response.imported_at, importedSnapshot: response.snapshot })) throw new Error('完全インポートの送信待ちが変更されました。再度同期してください。');
		checkSession();
		if (attempt && this._attempt === attempt && attempt.valid()) Object.assign(attempt.result, { import_completed: true, import_changes_unknown: true });
		this.masterConflictPaths = [];
	}

	masterConflictOutcome(error, syncedCount, downloadedCount, pendingCount, attempt) {
		if (this._attempt === attempt && attempt.valid()) { this.masterConflictPaths = [...error.paths]; this.lastError = null; }
		return {
			status: error.cancelled ? 'master_conflict_cancelled' : 'master_conflict',
			conflict_paths: [...error.paths],
			reason: error.reason,
			synced_count: syncedCount,
			downloaded_count: downloadedCount,
			pending_count: pendingCount
		};
	}

	async syncSharedMaster(remoteConfig, approveMasterConflict = null, { remoteState = null, isSessionValid: parent = null } = {}) {
		if (remoteConfig != null && (typeof remoteConfig !== 'object' || Array.isArray(remoteConfig))) throw new Error('受信設定の形式が不正です。');
		const attempt = this._attempt, isSessionValid = this.sessionGuard({ parent });
		this.assertSession(isSessionValid);
		const local = await this.db.getMasterConfig();
		this.assertSession(isSessionValid);
		if (remoteConfig == null) {
			await this.db.validateRemoteState(sharedMasterConfig(local), remoteState || {}, local);
			this.assertSession(isSessionValid);
			if (remoteState) { const committed = await this.db.commitSyncResponse([], remoteState, { isSessionValid }); this.assertSession(isSessionValid); this.recordCommitted(attempt, committed); return { downloaded_count: committed.downloaded_count }; }
			return { downloaded_count: 0 };
		}
		const remote = sharedMasterConfig(remoteConfig);
		const sharedLocal = sharedMasterConfig(local);
		let base = await this.db.getMasterSyncBase();
		if (!base) {
			base = { schema_version: 2 };
			if (Object.keys(remote).some(key => key !== 'schema_version')) {
				base = sharedMasterConfig(DEFAULT_MASTER_CONFIG);
				if (canonicalJsonStringify(sharedLocal) !== canonicalJsonStringify(base)) delete base.point_payment_defaults;
			}
		}
		this.assertSession(isSessionValid);
		const mergeResult = mergeMasterConfigs(base, sharedLocal, remote);
		const { conflicts } = mergeResult;
		let config = mergeResult.config;
		if (conflicts.length) {
			this.masterConflictPaths = [...conflicts];
			if (!approveMasterConflict) throw new MasterConflictError(conflicts, false);
			const validateChoices = async choices => {
				this.assertSession(isSessionValid);
				let selections;
				if (choices === true) selections = new Map(mergeResult.conflictDetails.map(detail => [detail.id, 'local']));
				else {
					if (!choices || typeof choices !== 'object' || Array.isArray(choices) || ![Object.prototype, null].includes(Object.getPrototypeOf(choices))) throw new Error('競合項目ごとに採用する設定を選択してください。');
					selections = new Map(Object.entries(choices));
				}
				const candidate = resolveMasterConflicts(mergeResult, selections);
				await this.db.validateRemoteState(candidate, remoteState || {}, local);
				this.assertSession(isSessionValid);
				return candidate;
			};
			const choices = await approveMasterConflict(conflicts, mergeResult.conflictDetails, validateChoices);
			this.assertSession(isSessionValid);
			if (!choices) throw new MasterConflictError(conflicts, true);
			if (canonicalJsonStringify(sharedMasterConfig(await this.db.getMasterConfig())) !== canonicalJsonStringify(sharedLocal)) throw new MasterConflictError(conflicts, false, 'local_changed');
			config = await validateChoices(choices);
		}
		await this.db.validateRemoteState(config, remoteState || {}, local);
		if (!isSessionValid()) throw new Error('認証がロックまたは変更されました。解除後に設定を確認し直してください。');
		let accepted = remote;
		if (canonicalJsonStringify(config) !== canonicalJsonStringify(remote)) {
			const response = await this.sendRequest('update_master', { master_config: config, base_version: canonicalJsonStringify(remote) }, { isSessionValid });
			this.assertSession(isSessionValid);
			if (response.master_conflict) throw new Error('設定マスタが別端末で更新されました。手元の変更を保持しています。手動差分同期で再取得してください。');
			this.assertPointAcknowledgement(config, response);
			accepted = response.master_config;
			this.recordChanges('sent', businessChanges({ master_config: remote }, { master_config: accepted }), attempt);
			if (response.snapshot) remoteState = { ...remoteState, snapshot: response.snapshot };
		}
		const detail = await this.db.commitMasterSync(local, accepted, { isSessionValid, remoteState, includeChanges: true });
		this.assertSession(isSessionValid);
		const committed = detail.config;
		this.recordCommitted(attempt, detail);
		this.masterConflictPaths = [];
		if (canonicalJsonStringify(sharedMasterConfig(committed)) !== canonicalJsonStringify(sharedLocal)) {
			for (const listener of this._masterListeners) Promise.resolve().then(() => { if (isSessionValid()) return listener(); }).catch(error => console.warn('Master view refresh failed:', error.message));
		}
		return { downloaded_count: detail.downloaded_count };
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
		window.removeEventListener('online', this._onOnlineBound);
		document.removeEventListener('visibilitychange', this._onVisibilityBound);
		this._listenersAttached = false;
	}

	/**
	 * Send signed request to GAS Web App
	 */
	async sendRequest(action, payload, { keepalive = false, isSessionValid: parent = null } = {}) {
		if (!this.gasUrl) {
			throw new Error('GAS Web App URL is not configured');
		}
		if (!this.privateKey) {
			throw new Error('Ed25519 Private Key is not loaded or unlocked');
		}
		if (!this.fetch) {
			throw new Error('Fetch API is not available');
		}

		const origin = this.sessionGuard({ parent });
		this.assertSession(origin);
		const envelope = await createSignedRequest(action, payload, this.privateKey);
		this.assertSession(origin);

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
		try { const response = await Promise.race([request(), timeout]); this.assertSession(origin); return response; }
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
		const attempt = this.beginAttempt(options.isSessionValid || null);
		try { return await this.finishAttempt(attempt, await this.pushPending({ ...options, isSessionValid: attempt.valid })); }
		catch (error) {
			if (error instanceof MasterConflictError) return await this.finishAttempt(attempt, this.masterConflictOutcome(error, 0, 0, (await this.db.getUnsyncedTransactions()).length, attempt));
			await this.failAttempt(attempt, error); throw error;
		}
		finally { this.endAttempt(attempt); }
	}

	sessionGuard({ requirePrivateKey = true, parent }) {
		const privateKey = this.privateKey, encryptionKey = this.db?.encryptionKey, generation = this.db?.keyGeneration;
		const owner = this.captureSession ? this.captureSession() : null;
		return () => (!requirePrivateKey || Boolean(privateKey)) && this.privateKey === privateKey && this.db?.encryptionKey === encryptionKey && this.db?.keyGeneration === generation && (!parent || parent()) && (!owner || owner());
	}

	assertSession(isSessionValid) {
		if (!isSessionValid()) throw new Error('認証がロックまたは変更されました。解除後に同期し直してください。');
	}

	async pushPending({ keepalive = false, isSessionValid: parent = null } = {}) {
		const attempt = this._attempt, isSessionValid = this.sessionGuard({ requirePrivateKey: false, parent });
		this.assertSession(isSessionValid);
		await this.flushPendingImport({ isSessionValid });
		const unsynced = await this.db.getUnsyncedTransactions();
		this.assertSession(isSessionValid);
		if (!unsynced?.length) return { status: 'up_to_date', synced_count: 0, downloaded_count: 0 };
		const remoteMaster = await this.sendRequest('fetch_master', {}, { keepalive, isSessionValid });
		this.assertSession(isSessionValid);
		await this.syncSharedMaster(remoteMaster.master_config, null, { isSessionValid });
		this.assertSession(isSessionValid);
		const response = await this.sendRequest('push_diff', { transactions: unsynced }, { keepalive, isSessionValid });
		const committed = await this.db.commitSyncResponse(unsynced, { ...response, accepted_ids: response.accepted_ids || unsynced.map(tx => tx.id) }, { isSessionValid });
		this.assertSession(isSessionValid);
		this.recordCommitted(attempt, committed);
		this.lastSyncedAt = new Date().toISOString();
		return { status: 'synced', synced_count: committed.synced_count, downloaded_count: committed.downloaded_count, response };
	}

	async downloadTransactions(approveMasterConflict = null, { isSessionValid: parent = null } = {}) {
		const isSessionValid = this.sessionGuard({ parent });
		this.assertSession(isSessionValid);
		await this.flushPendingImport({ isSessionValid });
		this.assertSession(isSessionValid);
		const response = await this.sendRequest('fetch_state', {}, { isSessionValid });
		this.assertSession(isSessionValid);
		const committed = await this.syncSharedMaster(response.master_config, approveMasterConflict, { remoteState: response, isSessionValid });
		this.assertSession(isSessionValid);
		return { response, count: committed.downloaded_count };
	}

	async syncBidirectional({ approveReclose = null, approveMasterConflict = null, isSessionValid = null } = {}) {
		if (this.isSyncing) return { status: 'already_syncing', synced_count: 0, downloaded_count: 0 };
		const attempt = this.beginAttempt(isSessionValid);
		let stage = '受信';
		let syncedCount = 0, downloadedCount = 0;
		let pendingCount = 0;
		try {
			const first = await this.downloadTransactions(approveMasterConflict, { isSessionValid: attempt.valid });
			this.assertSession(attempt.valid);
			downloadedCount += first.count;
			attempt.result.downloaded_count = downloadedCount;
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			const closed = (await this.db.getSnapshot())?.last_closed_month;
			const pending = await this.db.getUnsyncedTransactions();
			const archivedMonths = new Map((first.response.archived_transactions || []).map(record => [record.id, record.target_month]));
			const affectedMonths = tx => [tx.target_month, tx.previous_target_month, archivedMonths.get(tx.id)].filter(month => month && closed && month <= closed);
			const awaiting = pending.filter(tx => affectedMonths(tx).some(month => !tx.reclose_approved_months?.includes(month)));
			this.assertSession(attempt.valid);
			if (awaiting.length) {
				const months = [...new Set(awaiting.flatMap(affectedMonths))].sort();
				if (!approveReclose || !await approveReclose(awaiting, months)) return await this.finishAttempt(attempt, { status: 'approval_required', synced_count: 0, downloaded_count: first.count, pending_count: pending.length });
				this.assertSession(attempt.valid);
				for (const tx of awaiting) {
					if (!await this.db.approveTransactionReclose(tx, months, { isSessionValid: attempt.valid })) return await this.finishAttempt(attempt, { status: 'approval_required', synced_count: 0, downloaded_count: first.count, pending_count: (await this.db.getUnsyncedTransactions()).length });
				}
			}
			stage = '送信';
			const uploaded = await this.pushPending({ isSessionValid: attempt.valid });
			this.assertSession(attempt.valid);
			syncedCount = uploaded.synced_count;
			downloadedCount += uploaded.downloaded_count;
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			stage = '再受信';
			const last = await this.downloadTransactions(approveMasterConflict, { isSessionValid: attempt.valid });
			this.assertSession(attempt.valid);
			downloadedCount += last.count;
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			this.assertSession(attempt.valid);
			this.lastSyncedAt = new Date().toISOString();
			return await this.finishAttempt(attempt, { status: 'synced', synced_count: uploaded.synced_count, downloaded_count: downloadedCount, pending_count: (await this.db.getUnsyncedTransactions()).length });
		} catch (error) {
			if (error instanceof MasterConflictError) return await this.finishAttempt(attempt, this.masterConflictOutcome(error, syncedCount, downloadedCount, pendingCount, attempt));
			const failure = new Error(`${stage}: ${error.message}`); await this.failAttempt(attempt, failure); throw failure;
		}
		finally { this.endAttempt(attempt); }
	}

	/**
	 * Request Month Closing
	 */
	async closeMonth(targetMonth, { approvedPlanned = [] } = {}) {
		if (this.isSyncing) throw new Error('Another sync operation is in progress');
		const attempt = this.beginAttempt();
		const isSessionValid = this.sessionGuard({ parent: attempt.valid });
		try {
			await this.pushPending({ isSessionValid });
			this.assertSession(isSessionValid);
			const response = await this.sendRequest('close_month', {
				target_month: targetMonth,
				approved_planned: approvedPlanned.map(tx => ({ id: tx.id, version: transactionContentVersion(tx) }))
			}, { isSessionValid });
			const committed = await this.db.commitSyncResponse([], response, { isSessionValid });
			this.assertSession(isSessionValid);
			this.recordCommitted(attempt, committed);
			await this.finishAttempt(attempt, { status: 'synced' });
			this.assertSession(isSessionValid);
			this.lastSyncedAt = new Date().toISOString(); return response;
		} catch (error) { await this.failAttempt(attempt, error); throw error; }
		finally { this.endAttempt(attempt); }
	}

	/**
	 * Send retroactive update for a past closed month
	 */
	async sendRetroactiveUpdate(transaction, { expectedTransaction = undefined } = {}) {
		if (this.isSyncing) {
			throw new Error('Another sync operation is in progress');
		}
		const attempt = this.beginAttempt();
		const isSessionValid = this.sessionGuard({ parent: attempt.valid });

		try {
			const requested = structuredClone(transaction);
			const original = await this.db.getTransaction(requested.id) || null;
			const expected = expectedTransaction === undefined ? original : structuredClone(expectedTransaction);
			if (canonicalJsonStringify(expected) !== canonicalJsonStringify(original)) throw new Error('明細が変更されました。再確認してください。');
			const alreadySaved = original && canonicalJsonStringify(requested) === canonicalJsonStringify(original);
			await this.flushPendingImport({ isSessionValid });
			this.assertSession(isSessionValid);
			let submitted;
			if (alreadySaved) {
				const current = await this.db.getTransaction(requested.id) || null;
				if (canonicalJsonStringify(current) !== canonicalJsonStringify(original)) throw new Error('明細が変更されました。再確認してください。');
				submitted = current;
			} else {
				submitted = await this.db.putTransaction(requested, { expectedTransactions: expected ? [expected] : [], isSessionValid });
			}
			const remoteMaster = await this.sendRequest('fetch_master', {}, { isSessionValid });
			this.assertSession(isSessionValid);
			await this.syncSharedMaster(remoteMaster.master_config, null, { isSessionValid });
			this.assertSession(isSessionValid);

			const response = await this.sendRequest('retroactive_update', {
				transaction: submitted,
				...(submitted.previous_target_month ? { previous_target_month: submitted.previous_target_month } : {})
			}, { isSessionValid });

			const committed = await this.db.commitSyncResponse([submitted], { ...response, accepted_ids: response.conflict ? [] : [submitted.id] }, { isSessionValid });
			this.assertSession(isSessionValid);
			this.recordCommitted(attempt, committed);
			await this.finishAttempt(attempt, { status: 'synced', synced_count: committed.synced_count, downloaded_count: committed.downloaded_count });
			this.assertSession(isSessionValid);

			this.lastSyncedAt = new Date().toISOString();
			return response;
		} catch (err) {
			await this.failAttempt(attempt, err);
			throw err;
		} finally {
			this.endAttempt(attempt);
		}
	}

	/**
	 * Fetch current remote state (master_config, snapshot, pending_diffs)
	 */
	async fetchRemoteState() {
		if (this.isSyncing) {
			throw new Error('Another sync operation is in progress');
		}
		const attempt = this.beginAttempt();
		let pendingCount = 0;
		try {
			await this.flushPendingImport({ isSessionValid: attempt.valid });
			pendingCount = (await this.db.getUnsyncedTransactions()).length;
			this.assertSession(attempt.valid);
			const { response, count } = await this.downloadTransactions(null, { isSessionValid: attempt.valid });
			await this.finishAttempt(attempt, { status: 'synced', downloaded_count: count });
			return response;
		} catch (error) {
			if (error instanceof MasterConflictError) return await this.finishAttempt(attempt, this.masterConflictOutcome(error, 0, 0, pendingCount, attempt));
			await this.failAttempt(attempt, error); throw error;
		} finally {
			this.endAttempt(attempt);
		}
	}

}


export function transactionContentVersion(transaction) {
	const content = { ...transaction };
	delete content.sync_status; delete content.previous_target_month; delete content.reclose_approved_months;
	return canonicalJsonStringify(content);
}
