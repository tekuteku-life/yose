/**
 * Yoseatsume Kakeibo - Transaction List Controller
 * Renders monthly transaction breakdown and recent transaction feeds with click-to-edit delegation.
 */

import { escapeHtml } from '../logic.js';

export class TransactionListController {
	constructor(coordinator) {
		this.coordinator = coordinator;
	}

	get db() {
		return this.coordinator.db;
	}

	async renderMonthTransactions() {
		const list = document.getElementById('month-tx-list');
		if (!list) return;
		const filterStatus = document.getElementById('select-status-filter')?.value || 'all';

		const txs = await this.db.getTransactions({ target_month: this.coordinator.currentMonth });
		const filtered = txs.filter(t => {
			if (filterStatus === 'confirmed') return t.status === 'confirmed';
			if (filterStatus === 'planned') return t.status === 'planned';
			return true;
		});

		if (filtered.length === 0) {
			list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">取引はありません</div>';
			return;
		}

		list.innerHTML = filtered.map(t => {
			const isPlanned = t.status === 'planned';
			const statusBadge = isPlanned
				? '<span class="badge badge-warning">予定</span>'
				: '<span class="badge badge-success">確定</span>';

			const badges = [statusBadge];
			if (t.is_advance_split || t.account_id === 'acc_receivable') {
				badges.push('<span class="badge badge-advance">立替</span>');
			}
			if (t.is_point_split || (t.tags && (t.tags.includes('ポイント併用') || t.tags.includes('point_offset')))) {
				badges.push('<span class="badge badge-point">ポイント</span>');
			}

			return `
				<div class="tx-item ${isPlanned ? 'planned' : ''} clickable" data-id="${t.id}">
					<div class="tx-info">
						<span class="tx-title">${escapeHtml(t.memo || '(メモなし)')} <span class="tx-edit-hint" title="タッチして編集">✏️</span></span>
						<div class="tx-meta">
							<span>${t.date}</span>
							${badges.join(' ')}
							<span>${t.type}</span>
						</div>
					</div>
					<div style="text-align: right;">
						<div class="tx-amount ${t.type}">
							${t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''}¥${t.amount.toLocaleString()}
						</div>
						<button class="btn btn-secondary btn-sm btn-delete-tx" data-id="${t.id}" style="margin-top: 4px;">削除</button>
					</div>
				</div>
			`;
		}).join('');

		// Attach click listeners to .tx-item.clickable (ignoring clicks on delete button)
		list.querySelectorAll('.tx-item.clickable').forEach(item => {
			item.addEventListener('click', (e) => {
				if (e.target.closest('.btn-delete-tx')) return;
				const id = item.dataset.id;
				if (id) this.coordinator.txEditController.openEditTransactionModal(id);
			});
		});

		// Attach delete listeners
		list.querySelectorAll('.btn-delete-tx').forEach(btn => {
			btn.addEventListener('click', async (e) => {
				e.stopPropagation();
				const id = btn.dataset.id;
				if (confirm('この明細を削除しますか？')) {
					await this.coordinator.txEditController.handleEditDelete(id);
				}
			});
		});
	}

	async renderRecentTransactions() {
		const list = document.getElementById('recent-tx-list');
		if (!list) return;
		const all = await this.db.getTransactions();
		const sorted = all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

		if (sorted.length === 0) {
			list.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">まだ入力はありません</div>';
			return;
		}

		list.innerHTML = sorted.map(t => {
			const badges = [];
			if (t.is_advance_split || t.account_id === 'acc_receivable') {
				badges.push('<span class="badge badge-advance">立替</span>');
			}
			if (t.is_point_split || (t.tags && (t.tags.includes('ポイント併用') || t.tags.includes('point_offset')))) {
				badges.push('<span class="badge badge-point">ポイント</span>');
			}

			return `
				<div class="tx-item clickable" data-id="${t.id}">
					<div class="tx-info">
						<span class="tx-title">${escapeHtml(t.memo || '(メモなし)')} <span class="tx-edit-hint" title="タッチして編集">✏️</span></span>
						<div class="tx-meta">
							<span>${t.date}</span>
							${badges.join(' ')}
							<span>${t.type}</span>
							<span>${t.status}</span>
						</div>
					</div>
					<div class="tx-amount ${t.type}">
						¥${t.amount.toLocaleString()}
					</div>
				</div>
			`;
		}).join('');

		list.querySelectorAll('.tx-item.clickable').forEach(item => {
			item.addEventListener('click', () => {
				const id = item.dataset.id;
				if (id) this.coordinator.txEditController.openEditTransactionModal(id);
			});
		});
	}
}

