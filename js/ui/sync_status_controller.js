/**
 * Yoseatsume Kakeibo - Sync & Network Status Controller
 * Manages Online/Offline badges, unsynced count indicators, and manual sync triggers.
 */

export class SyncStatusController {
	constructor(coordinator) {
		this.coordinator = coordinator;
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
		if (btnHeaderSync) {
			btnHeaderSync.addEventListener('click', async () => {
				await this.handleManualSync();
			});
		}

		// Network status listeners
		if (typeof window !== 'undefined') {
			window.addEventListener('online', () => this.updateNetworkBadge());
			window.addEventListener('offline', () => this.updateNetworkBadge());
		}
	}

	bindSyncManager() {
		this._unsubscribeSync?.();
		this._unsubscribeMaster?.();
		this._unsubscribeMaster = this.syncManager.onMasterChange(() => this.coordinator.refreshAllViews());
		this._unsubscribeSync = this.syncManager.onStateChange(() => this.updateSyncBadge());
	}

	updateNetworkBadge() {
		const badge = document.getElementById('network-badge');
		if (!badge) return;
		if (typeof navigator !== 'undefined' && !navigator.onLine) {
			badge.textContent = 'Offline';
			badge.className = 'badge badge-danger';
		} else {
			badge.textContent = 'Online';
			badge.className = 'badge badge-success';
		}
	}

	async updateSyncBadge() {
		const badge = document.getElementById('sync-badge');
		if (!badge) return;
		const showProgress = () => {
			const syncing = this.syncManager.isSyncing;
			for (const id of ['btn-header-sync', 'btn-manual-sync']) {
				const button = document.getElementById(id);
				if (button) button.disabled = syncing;
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
		const unsynced = await this.db.getUnsyncedTransactions();
		const masterPending = await this.db.hasUnsyncedMasterConfig();
		const importPending = await this.db.getPendingImport();
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

	async handleManualSync() {
		try {
			await this.coordinator.authController.ensureKeyUnlocked();
			const res = await this.syncManager.syncBidirectional({ approveMasterConflict: async (_paths, details, validateChoices) => this.coordinator.masterConflictController.resolve(details, validateChoices), approveReclose: async (changes, months) => {
				if (changes.some(tx => !tx.is_deleted && tx.target_month <= months.at(-1) && (tx.amount_pending || tx.status !== 'confirmed'))) {
					alert('締め済み月の変更には金額入力済みの確定明細が必要です。'); return false;
				}
				return confirm(`${months.join('、')} は別端末でも月締め済みです。未同期の変更を反映して再月締めしますか？\n取消時は手元の未同期変更を保持します。`);
			} });
			if (this.coordinator.isKeyLocked) return;
			if (res.status === 'already_syncing') alert('同期処理中です。完了をお待ちください。');
			else if (res.status === 'master_conflict_cancelled') alert(`設定の競合確認を取り消しました。今回の競合を上書きせず、手元とサーバーの設定を保持しています。\n完了済み: 送信 ${res.synced_count} 件 / 受信 ${res.downloaded_count} 件 / 未同期 ${res.pending_count} 件`);
			else if (res.status === 'master_conflict') alert(res.reason === 'local_changed' ? '確認中に手元の設定が変更されました。変更を保持しています。もう一度同期して最新の内容を比較してください。' : '設定の競合があるため、確認待ちです。手元とサーバーの設定を保持しています。');
			else if (res.status === 'approval_required') alert(`再月締めは未実行です。手元の変更は未同期として保持しています。受信 ${res.downloaded_count} 件 / 未同期 ${res.pending_count} 件`);
			else alert(`差分同期完了: 送信 ${res.synced_count} 件 / 受信 ${res.downloaded_count} 件 / 未同期 ${res.pending_count} 件`);
		} catch (err) {
			alert(`同期に失敗しました: ${err.message}`);
		} finally {
			if (!this.coordinator.isKeyLocked) await this.coordinator.refreshAllViews();
		}
	}
}

