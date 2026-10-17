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
			const res = await this.syncManager.syncPendingDiffs();
			if (res.status === 'up_to_date') {
				alert('同期対象の未同期データはありません（すべて最新です）');
			} else {
				alert(`差分同期完了: ${res.synced_count} 件のデータを同期しました`);
			}
		} catch (err) {
			alert(`同期に失敗しました: ${err.message}`);
		} finally {
			await this.coordinator.refreshAllViews();
		}
	}
}

