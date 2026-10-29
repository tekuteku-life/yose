/**
 * Yoseatsume Kakeibo - Sync & Network Status Controller
 * Manages Online/Offline badges, unsynced count indicators, and manual sync triggers.
 */

import { captureRenderSession, readInRenderSession } from './render_session.js';
import { formatSyncResult } from './sync_result.js';

export class SyncStatusController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.badgeGeneration = 0;
	}

	get db() {
		return this.coordinator.db;
	}

	get syncManager() {
		return this.coordinator.syncManager;
	}

	setupListeners() {
		this.bindSyncManager();
		// Header sync button
		const btnHeaderSync = document.getElementById('btn-header-sync');
		btnHeaderSync.addEventListener('click', async () => {
			await this.handleManualSync();
		});

		// Network status listeners
		window.addEventListener('online', () => this.updateNetworkBadge());
		window.addEventListener('offline', () => this.updateNetworkBadge());
	}

	bindSyncManager() {
		this._unsubscribeSync?.();
		this._unsubscribeMaster?.();
		const manager = this.syncManager;
		this._unsubscribeMaster = manager.onMasterChange(() => { if (manager === this.syncManager) return this.coordinator.refreshAllViews(); });
		this._unsubscribeSync = manager.onStateChange(() => { if (manager === this.syncManager) return this.updateSyncBadge(); });
	}

	updateNetworkBadge() {
		const badge = document.getElementById('network-badge');

		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			badge.textContent = 'Offline';
			badge.className = 'badge badge-danger';
		} else {
			badge.textContent = 'Online';
			badge.className = 'badge badge-success';
		}
	}

	async updateSyncBadge({ isSessionValid = null } = {}) {
		if (isSessionValid && !isSessionValid()) return;
		const manager = this.syncManager, generation = ++this.badgeGeneration;
		const valid = captureRenderSession(this.coordinator, () => manager === this.syncManager && generation === this.badgeGeneration && (!isSessionValid || isSessionValid()));
		const badge = document.getElementById('sync-badge');

		this.renderLastResult();
		const showProgress = () => {
			const syncing = this.syncManager.isSyncing;
			for (const id of ['btn-header-sync', 'btn-manual-sync']) {
				const button = document.getElementById(id);
				button.disabled = syncing;
			}
			badge.setAttribute('aria-busy', String(syncing));
			badge.setAttribute('aria-live', 'polite');
			if (syncing) {
				badge.textContent = '同期中…';
				badge.className = 'badge badge-info badge-syncing';
			}
			return syncing;
		};
		if (showProgress()) return;
		if (this.coordinator.isKeyLocked) {
			badge.textContent = 'ロック中';
			badge.className = 'badge badge-info';
			return;
		}
		const unsynced = await readInRenderSession(valid, () => this.db.getUnsyncedTransactions());
		if (!valid() || !unsynced) return;
		const masterPending = await readInRenderSession(valid, () => this.db.hasUnsyncedMasterConfig());
		if (!valid()) return;
		const importPending = await readInRenderSession(valid, () => this.db.getPendingImport());
		if (!valid()) return;
		if (showProgress()) return;
		const count = unsynced?.length || 0;
		const masterConflict = (this.syncManager.masterConflictPaths?.length || 0) > 0;
		badge.title = this.syncManager.lastError || '';
		if (count === 0 && !masterPending && !masterConflict && !importPending) {
			badge.textContent = this.syncManager.lastError ? '同期失敗' : '同期済';
			badge.className = this.syncManager.lastError ? 'badge badge-danger' : 'badge badge-success';
		} else {
			const masterText = importPending ? '完全取込が送信待ち' : masterConflict ? '設定の確認待ち' : masterPending ? '設定が未同期' : '';
			badge.textContent = `${this.syncManager.lastError ? '同期失敗 / ' : ''}${count ? `未同期: ${count}件` : ''}${count && masterText ? ' / ' : ''}${masterText}`;
			badge.className = this.syncManager.lastError ? 'badge badge-danger' : 'badge badge-info';
		}
	}

	renderLastResult() {
		const result = document.getElementById('sync-last-result');

		result.textContent = this.coordinator.isKeyLocked ? '' : formatSyncResult(this.syncManager.lastResult);
		result.hidden = !result.textContent;
	}

	async handleManualSync() {
		const manager = this.syncManager;
		const valid = captureRenderSession(this.coordinator, () => manager === this.syncManager);
		try {
			await this.coordinator.authController.ensureKeyUnlocked();
			if (!valid()) return;
			const res = await manager.syncBidirectional({ isSessionValid: valid, approveMasterConflict: async (_paths, details, validateChoices) => {
				if (!valid()) return null;
				const choices = await this.coordinator.masterConflictController.resolve(details, validateChoices);
				return valid() ? choices : null;
			}, approveReclose: async (changes, months) => {
				if (!valid()) return false;
				if (changes.some(tx => !tx.is_deleted && tx.target_month <= months.at(-1) && (tx.amount_pending || tx.status !== 'confirmed'))) {
					alert('締め済み月の変更には金額入力済みの確定明細が必要です。'); return false;
				}
				const approved = confirm(`${months.join('、')} は別端末でも月締め済みです。未同期の変更を反映して再月締めしますか？\n取消時は手元の未同期変更を保持します。`);
				return valid() && approved;
			} });
			if (!valid()) return;
			alert(formatSyncResult(res));
		} catch (err) {
			if (valid()) alert(formatSyncResult(manager.lastResult, err.message));
		} finally {
			if (valid()) {
				try { await this.coordinator.refreshAllViews({ isSessionValid: valid }); }
				catch (error) { if (valid()) console.warn('Sync view refresh deferred:', error.message); }
				if (valid()) this.renderLastResult();
			}
		}
	}
}

