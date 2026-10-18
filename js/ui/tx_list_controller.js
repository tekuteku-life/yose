/**
 * Yoseatsume Kakeibo - Transaction List Controller
 * Renders monthly transaction breakdown and recent transaction feeds with click-to-edit delegation.
 */

import {
	escapeHtml,
	resolveTransactionDisplayInfo,
	filterTransactionsByCriteria
} from '../logic.js';

export class TransactionListController {
	constructor(coordinator) {
		this.coordinator = coordinator;
	}

	get db() {
		return this.coordinator.db;
	}

	populateFilterDropdowns(txs = [], masterConfig = {}) {
		const catSelect = document.getElementById('select-category-filter');
		if (catSelect) {
			const currentCat = catSelect.value || 'all';
			const categories = (masterConfig?.categories || []).filter(c => !c.is_archived);
			catSelect.innerHTML = [
				'<option value="all">すべての費目</option>',
				...categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.icon || '🏷️')} ${escapeHtml(c.name)}</option>`)
			].join('');
			if (currentCat === 'all' || categories.some(c => c.id === currentCat)) {
				catSelect.value = currentCat;
			} else {
				catSelect.value = 'all';
			}
		}

		const tagSelect = document.getElementById('select-tag-filter');
		if (tagSelect) {
			const currentTag = tagSelect.value || 'all';
			const tagSet = new Set();
			for (const t of txs || []) {
				if (t && !t.is_deleted && Array.isArray(t.tags)) {
					for (const tag of t.tags) {
						const clean = String(tag || '').trim();
						if (clean) tagSet.add(clean);
					}
				}
			}
			const sortedTags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
			tagSelect.innerHTML = [
				'<option value="all">すべてのタグ</option>',
				...sortedTags.map(tag => `<option value="${escapeHtml(tag)}">🏷️ ${escapeHtml(tag)}</option>`)
			].join('');
			if (currentTag === 'all' || tagSet.has(currentTag)) {
				tagSelect.value = currentTag;
			} else {
				tagSelect.value = 'all';
			}
		}
	}

	renderTransactionItemHtml(t, masterConfig, includeDeleteBtn = false) {
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

		const display = resolveTransactionDisplayInfo(t, masterConfig);
		const memoHtml = display.memo
			? `<span class="tx-sub-memo">📝 ${escapeHtml(display.memo)}</span>`
			: '';
		const tagsHtml = display.tags.length > 0
			? `<span class="tx-sub-tags">${display.tags.map(tag => `<span class="badge" style="background: var(--bg-hover); color: var(--text-main); border: 1px solid var(--border); font-weight: 500;">#${escapeHtml(tag)}</span>`).join(' ')}</span>`
			: '';

		const subInfoHtml = (memoHtml || tagsHtml)
			? `<div class="tx-meta" style="margin-top: 2px;">${memoHtml}${memoHtml && tagsHtml ? ' ' : ''}${tagsHtml}</div>`
			: '';

		const amountPrefix = t.type === 'expense' ? '-' : t.type === 'income' ? '+' : '';
		const deleteBtnHtml = includeDeleteBtn
			? `<button class="btn btn-secondary btn-sm btn-delete-tx" data-id="${escapeHtml(t.id)}" style="margin-top: 4px;">削除</button>`
			: '';

		return `
			<div class="tx-item ${isPlanned ? 'planned' : ''} clickable" data-id="${escapeHtml(t.id)}">
				<div class="tx-info">
					<span class="tx-title">${escapeHtml(display.primaryTitle)} <span class="tx-edit-hint" title="タッチして編集">✏️</span></span>
					${subInfoHtml}
					<div class="tx-meta">
						<span>${escapeHtml(t.date)}</span>
						${badges.join(' ')}
						<span>${escapeHtml(t.type)}</span>
					</div>
				</div>
				<div style="text-align: right;">
					<div class="tx-amount ${escapeHtml(t.type)}">
						${amountPrefix}¥${Number(t.amount || 0).toLocaleString()}
					</div>
					${deleteBtnHtml}
				</div>
			</div>
		`;
	}

	async renderMonthTransactions() {
		const list = document.getElementById('month-tx-list');
		if (!list) return;

		const [txs, masterConfig] = await Promise.all([
			this.db.getTransactions({ target_month: this.coordinator.currentMonth }),
			this.db.getMasterConfig()
		]);

		this.populateFilterDropdowns(txs, masterConfig);

		const filterStatus = document.getElementById('select-status-filter')?.value || 'all';
		const filterCategory = document.getElementById('select-category-filter')?.value || 'all';
		const filterTag = document.getElementById('select-tag-filter')?.value || 'all';
		const filterKeyword = document.getElementById('input-tx-search')?.value || '';

		const filtered = filterTransactionsByCriteria(txs, {
			status: filterStatus,
			categoryId: filterCategory,
			tag: filterTag,
			keyword: filterKeyword
		}, masterConfig);

		if (filtered.length === 0) {
			list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">取引はありません</div>';
			return;
		}

		list.innerHTML = filtered.map(t => this.renderTransactionItemHtml(t, masterConfig, true)).join('');

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
		const [all, masterConfig] = await Promise.all([
			this.db.getTransactions(),
			this.db.getMasterConfig()
		]);
		const sorted = all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

		if (sorted.length === 0) {
			list.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">まだ入力はありません</div>';
			return;
		}

		list.innerHTML = sorted.map(t => this.renderTransactionItemHtml(t, masterConfig, false)).join('');

		list.querySelectorAll('.tx-item.clickable').forEach(item => {
			item.addEventListener('click', () => {
				const id = item.dataset.id;
				if (id) this.coordinator.txEditController.openEditTransactionModal(id);
			});
		});
	}
}


