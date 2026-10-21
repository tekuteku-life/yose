/**
 * Yoseatsume Kakeibo - Transaction List Controller
 * Renders monthly transaction breakdown and recent transaction feeds with click-to-edit delegation.
 */

import {
	formatDate,
	escapeHtml,
	resolveTransactionDisplayInfo,
	filterTransactionsByCriteria
} from '../logic.js';

export class TransactionListController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.currentPage = 1;
		this.pageSize = 30;
		this.totalPages = 1;
		this._paginationEventsAttached = false;
	}

	get db() {
		return this.coordinator.db;
	}

	populateFilterDropdowns(txs = [], masterConfig = {}) {
		const accSelect = document.getElementById('select-account-filter');
		if (accSelect) {
			const currentAcc = accSelect.value || 'all';
			const accounts = (masterConfig?.accounts || []).filter(a => !a.is_archived);
			accSelect.innerHTML = [
				'<option value="all">すべての口座</option>',
				...accounts.map(a => `<option value="${escapeHtml(a.id)}">🏦 ${escapeHtml(a.name)}</option>`)
			].join('');
			if (currentAcc === 'all' || accounts.some(a => a.id === currentAcc)) {
				accSelect.value = currentAcc;
			} else {
				accSelect.value = 'all';
			}
		}

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
						${t.amount_pending ? '金額未入力' : `${amountPrefix}¥${Number(t.amount || 0).toLocaleString()}`}
					</div>
					${deleteBtnHtml}
				</div>
			</div>
		`;
	}

	async renderMonthTransactions() {
		const list = document.getElementById('month-tx-list');
		if (!list) return;

		const granularity = this.coordinator.analyticsGranularity || 'monthly';
		let txs = [];
		const titleEl = document.getElementById('month-tx-list-title');

		if (granularity === 'yearly') {
			const targetYear = this.coordinator.selectedYear || new Date().getFullYear();
			if (titleEl) titleEl.textContent = `📋 ${targetYear}年 (年間) の明細一覧`;
			const all = await this.db.getTransactions({ includeDeleted: false });
			txs = all.filter(t => t.date && t.date.startsWith(String(targetYear)));
		} else if (granularity === 'daily') {
			const targetDate = this.coordinator.selectedDate || (formatDate ? formatDate(new Date()) : new Date().toISOString().slice(0, 10));
			if (titleEl) titleEl.textContent = `📋 ${targetDate} (日別) の明細一覧`;
			const all = await this.db.getTransactions({ includeDeleted: false });
			txs = all.filter(t => t.date === targetDate);
		} else {
			const targetMonth = this.coordinator.currentMonth || (new Date().toISOString().slice(0, 7));
			if (titleEl) titleEl.textContent = `📋 ${targetMonth} (月別) の明細一覧`;
			txs = await this.db.getTransactions({ target_month: targetMonth });
		}

		txs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''));

		const masterConfig = await this.db.getMasterConfig();

		this.populateFilterDropdowns(txs, masterConfig);

		const filterStatus = document.getElementById('select-status-filter')?.value || 'all';
		const filterAccount = document.getElementById('select-account-filter')?.value || 'all';
		const filterCategory = document.getElementById('select-category-filter')?.value || 'all';
		const filterTag = document.getElementById('select-tag-filter')?.value || 'all';
		const filterKeyword = document.getElementById('input-tx-search')?.value || '';

		const filtered = filterTransactionsByCriteria(txs, {
			status: filterStatus,
			includePlanned: this.coordinator.showPlanned,
			accountId: filterAccount,
			categoryId: filterCategory,
			tag: filterTag,
			keyword: filterKeyword
		}, masterConfig);

		const paginationControls = document.getElementById('tx-pagination-controls');
		const paginationInfo = document.getElementById('tx-pagination-info');
		const btnPrev = document.getElementById('btn-tx-prev-page');
		const btnNext = document.getElementById('btn-tx-next-page');

		this.totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
		if (filtered.length === 0) {
			const emptyMsg = txs.length > 0 ? '条件に一致する取引はありません' : '取引はありません';
			list.innerHTML = `<div style="color: var(--text-muted); padding: 12px; text-align: center;">${emptyMsg}</div>`;
			if (paginationControls) paginationControls.style.display = 'none';
			return;
		}

		// Pagination logic
		const totalCount = filtered.length;
		const totalPages = this.totalPages;
		if (this.currentPage > totalPages) this.currentPage = totalPages;
		if (this.currentPage < 1) this.currentPage = 1;

		const startIdx = (this.currentPage - 1) * this.pageSize;
		const pageItems = filtered.slice(startIdx, startIdx + this.pageSize);

		list.innerHTML = pageItems.map(t => this.renderTransactionItemHtml(t, masterConfig, true)).join('');

		// Update pagination controls
		if (paginationControls) {
			if (totalCount > this.pageSize) {
				paginationControls.style.display = 'flex';
				if (paginationInfo) {
					paginationInfo.textContent = `${this.currentPage} / ${totalPages} ページ (全 ${totalCount} 件)`;
				}
				if (btnPrev) btnPrev.disabled = this.currentPage <= 1;
				if (btnNext) btnNext.disabled = this.currentPage >= totalPages;
			} else {
				paginationControls.style.display = 'none';
			}
		}

		if (!this._paginationEventsAttached && paginationControls) {
			btnPrev?.addEventListener('click', () => {
				if (this.currentPage > 1) {
					this.currentPage--;
					this.renderMonthTransactions();
				}
			});
			btnNext?.addEventListener('click', () => {
				if (this.currentPage < this.totalPages) {
					this.currentPage++;
					this.renderMonthTransactions();
				}
			});
			this._paginationEventsAttached = true;
		}

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


