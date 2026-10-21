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
		const unsynced = await this.db.getUnsyncedTransactions();
		const count = unsynced ? unsynced.length : 0;
		if (count === 0) {
			badge.textContent = '同期済';
			badge.className = 'badge badge-success';
		} else {
			badge.textContent = `未同期: ${count}件`;
			badge.className = 'badge badge-info';
		}
	}

	async handleManualSync() {
		try {
			await this.coordinator.authController.ensureKeyUnlocked();
			const res = await this.syncManager.syncBidirectional({ approveReclose: async (changes, months) => {
				if (changes.some(tx => !tx.is_deleted && tx.target_month <= months.at(-1) && (tx.amount_pending || tx.status !== 'confirmed'))) {
					alert('締め済み月の変更には金額入力済みの確定明細が必要です。'); return false;
				}
				return confirm(`${months.join('、')} は別端末でも月締め済みです。未同期の変更を反映して再月締めしますか？\n取消時は手元の未同期変更を保持します。`);
			} });
			if (res.status === 'already_syncing') alert('同期処理中です。完了をお待ちください。');
			else if (res.status === 'approval_required') alert(`再月締めは未実行です。手元の変更は未同期として保持しています。受信 ${res.downloaded_count} 件 / 未同期 ${res.pending_count} 件`);
			else alert(`差分同期完了: 送信 ${res.synced_count} 件 / 受信 ${res.downloaded_count} 件 / 未同期 ${res.pending_count} 件`);
		} catch (err) {
			alert(`同期に失敗しました: ${err.message}`);
		} finally {
			await this.coordinator.refreshAllViews();
		}
	}
}

