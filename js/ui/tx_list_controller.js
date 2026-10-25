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
		this.calendarMonthFilter = null;
		this.pageSize = 30;
		this.totalPages = 1;
		this._navigationGeneration = 0;
		this._renderGeneration = 0;
		this._recentRenderGeneration = 0;
		this._listPointers = new Map();
		this._listWaiters = new Set();
	}

	get db() {
		return this.coordinator.db;
	}

	setupInteractionGuard() {
		// A later user action cancels scrolling, even before its async render starts.
		for (const type of ['click', 'input', 'change']) document.addEventListener(type, () => { this._navigationGeneration++; }, true);
		for (const suffix of ['', '-top']) {
			document.getElementById(`btn-tx-prev-page${suffix}`).addEventListener('click', () => { void this.goToPage(this.currentPage - 1); });
			document.getElementById(`btn-tx-next-page${suffix}`).addEventListener('click', () => { void this.goToPage(this.currentPage + 1); });
		}
		document.getElementById('select-tx-page').addEventListener('change', event => { void this.goToPage(Number(event.target.value)); });
		document.addEventListener('pointerdown', event => {
			if (!(event.target instanceof Element)) return;
			const list = event.target.closest('#month-tx-list, #recent-tx-list');
			if (list) this._listPointers.set(event.pointerId, { list });
		}, true);
		const release = event => {
			const pointer = this._listPointers.get(event.pointerId);
			if (!pointer) return;
			// Keep the target alive through mouseup and its following click dispatch.
			setTimeout(() => {
				if (this._listPointers.get(event.pointerId) !== pointer) return;
				this._listPointers.delete(event.pointerId);
				this.releaseListWaiters();
			}, 0);
		};
		window.addEventListener('pointerup', release, true);
		window.addEventListener('pointercancel', release, true);
		const clear = () => { this._listPointers.clear(); this.releaseListWaiters(); };
		window.addEventListener('blur', clear);
		document.addEventListener('visibilitychange', () => { if (document.hidden) clear(); });
	}

	releaseListWaiters() {
		for (const waiter of this._listWaiters) {
			if ([...this._listPointers.values()].some(pointer => pointer.list === waiter.list)) continue;
			this._listWaiters.delete(waiter);
			waiter.resolve();
		}
	}

	async waitForListIdle(list) {
		while ([...this._listPointers.values()].some(pointer => pointer.list === list)) {
			await new Promise(resolve => this._listWaiters.add({ list, resolve }));
		}
	}

	cancelPendingRenders() {
		this._renderGeneration++; this._recentRenderGeneration++; this._navigationGeneration++;
		this._listPointers.clear(); this.releaseListWaiters();
	}

	async goToPage(page) {
		if (!Number.isInteger(page) || page < 1 || page > this.totalPages || page === this.currentPage || this.coordinator.isKeyLocked) return;
		const operation = ++this._navigationGeneration;
		this.currentPage = page;
		const generation = await this.renderMonthTransactions();
		if (generation !== this._renderGeneration || operation !== this._navigationGeneration || this.coordinator.isKeyLocked || this.coordinator.analyticsTarget !== 'cashflow' || !document.getElementById('tab-summary').classList.contains('active')) return;
		const top = document.getElementById('tx-pagination-controls-top');
		const target = top.checkVisibility() ? top : document.getElementById('month-tx-list');
		if (!target.checkVisibility()) return;
		const headerBottom = Math.max(...Array.from(document.querySelectorAll('header, .nav-tabs'), element => element.getBoundingClientRect().bottom));
		target.style.scrollMarginTop = `${headerBottom + 12}px`;
		target.scrollIntoView({ block: 'start', behavior: 'instant' });
	}

	updatePagination(totalCount) {
		for (const suffix of ['', '-top']) {
			document.getElementById(`tx-pagination-controls${suffix}`).style.display = this.totalPages > 1 ? 'flex' : 'none';
			document.getElementById(`tx-pagination-info${suffix}`).textContent = `${this.currentPage} / ${this.totalPages} ページ (全 ${totalCount} 件)`;
			document.getElementById(`btn-tx-prev-page${suffix}`).disabled = this.currentPage <= 1;
			document.getElementById(`btn-tx-next-page${suffix}`).disabled = this.currentPage >= this.totalPages;
		}
		const select = document.getElementById('select-tx-page');
		select.innerHTML = Array.from({ length: this.totalPages }, (_, i) => `<option value="${i + 1}">${i + 1}ページ</option>`).join('');
		select.value = String(this.currentPage);
	}

	populateFilterDropdowns(txs = [], masterConfig = {}) {
		const referencedAccounts = new Set();
		const referencedCategories = new Set();
		for (const tx of txs) {
			if (!tx || tx.is_deleted) continue;
			referencedAccounts.add(tx.account_id);
			referencedAccounts.add(tx.to_account_id);
			referencedCategories.add(tx.category_id);
			referencedCategories.add(tx.actual_category_id);
		}
		const accSelect = document.getElementById('select-account-filter');
		if (accSelect) {
			const currentAcc = accSelect.value || 'all';
			const accounts = (masterConfig?.accounts || []).filter(a => !a.is_archived || referencedAccounts.has(a.id));
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
			const categories = (masterConfig?.categories || []).filter(c => !c.is_archived || referencedCategories.has(c.id));
			catSelect.innerHTML = [
				'<option value="all">すべての費目</option>',
				'<option value="cat_unclassified">未分類</option>',
				...categories.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.icon || '🏷️')} ${escapeHtml(c.name)}</option>`)
			].join('');
			if (currentCat === 'all' || currentCat === 'cat_unclassified' || categories.some(c => c.id === currentCat)) {
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
				${includeDeleteBtn ? `<label class="bulk-check-label" title="この明細を選択"><input type="checkbox" data-bulk-id="${escapeHtml(t.id)}" aria-label="${escapeHtml(t.date + ' ' + (t.memo || '') + 'を選択')}" ${this.coordinator.bulkEditController?.selectedIds.has(t.id) ? 'checked' : ''}></label>` : ''}
				<div class="tx-info">
					<span class="tx-title">${escapeHtml(display.primaryTitle)} <span class="tx-edit-hint" title="タッチして編集">✏️</span></span>
					${subInfoHtml}
					<div class="tx-meta">
						<span>${escapeHtml(t.date)}</span>
						${badges.join(' ')}
						<span>${escapeHtml(({ income: '収入', expense: '支出', transfer: '振替' })[t.type] || t.type)}</span>
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
		const generation = ++this._renderGeneration;
		const key = this.db.encryptionKey;
		const list = document.getElementById('month-tx-list');
		if (!list) return;

		const granularity = this.coordinator.analyticsGranularity || 'monthly';
		let txs = [];
		const titleEl = document.getElementById('month-tx-list-title');
		let title;

		if (this.calendarMonthFilter && document.getElementById('select-type-filter')?.value === 'income') {
			const all = await this.db.getTransactions({ includeDeleted: false });
			txs = all.filter(tx => tx.date?.slice(0, 7) === this.calendarMonthFilter);
			title = `📋 ${this.calendarMonthFilter} (取引日別の当月) の明細一覧`;
		} else if (granularity === 'yearly') {
			const targetYear = this.coordinator.selectedYear || new Date().getFullYear();
			title = `📋 ${targetYear}年 (年間) の明細一覧`;
			const all = await this.db.getTransactions({ includeDeleted: false });
			txs = all.filter(t => t.target_month && t.target_month.startsWith(`${targetYear}-`));
		} else if (granularity === 'daily') {
			const targetDate = this.coordinator.selectedDate || (formatDate ? formatDate(new Date()) : new Date().toISOString().slice(0, 10));
			title = `📋 ${targetDate} (日別) の明細一覧`;
			const all = await this.db.getTransactions({ includeDeleted: false });
			txs = all.filter(t => t.date === targetDate);
		} else {
			const targetMonth = this.coordinator.currentMonth || (new Date().toISOString().slice(0, 7));
			title = `📋 ${targetMonth} (月別) の明細一覧`;
			txs = await this.db.getTransactions({ target_month: targetMonth });
		}

		txs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''));

		if (generation !== this._renderGeneration) return;
		const masterConfig = await this.db.getMasterConfig();
		await this.waitForListIdle(list);
		if (generation !== this._renderGeneration || key !== this.db.encryptionKey || this.coordinator.isKeyLocked) return;
		if (titleEl) titleEl.textContent = title;

		this.populateFilterDropdowns(txs, masterConfig);

		const filterStatus = document.getElementById('select-status-filter')?.value || 'all';
		const filterAccount = document.getElementById('select-account-filter')?.value || 'all';
		const filterCategory = document.getElementById('select-category-filter')?.value || 'all';
		const filterTag = document.getElementById('select-tag-filter')?.value || 'all';
		const filterKeyword = document.getElementById('input-tx-search')?.value || '';

		const filtered = filterTransactionsByCriteria(txs, {
			status: filterStatus,
			type: document.getElementById('select-type-filter')?.value || 'all',
			categoryAxis: document.getElementById('select-type-filter')?.value === 'income' ? (this.coordinator.useActualCategoryAxis ? 'actual' : 'accounting') : 'both',
			includePlanned: this.coordinator.showPlanned,
			accountId: filterAccount,
			categoryId: filterCategory,
			tag: filterTag,
			keyword: filterKeyword
		}, masterConfig);

		this.coordinator.bulkEditController?.reconcile(filtered);
		this.totalPages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
		this.currentPage = Math.max(1, Math.min(this.currentPage, this.totalPages));
		this.updatePagination(filtered.length);
		if (filtered.length === 0) {
			const emptyMsg = txs.length > 0 ? '条件に一致する取引はありません' : '取引はありません';
			list.innerHTML = `<div style="color: var(--text-muted); padding: 12px; text-align: center;">${emptyMsg}</div>`;
			return generation;
		}
		const startIdx = (this.currentPage - 1) * this.pageSize;
		const pageItems = filtered.slice(startIdx, startIdx + this.pageSize);
		list.innerHTML = pageItems.map(t => this.renderTransactionItemHtml(t, masterConfig, true)).join('');

		// Attach click listeners to .tx-item.clickable (ignoring clicks on delete button)
		list.querySelectorAll('.tx-item.clickable').forEach(item => {
			item.addEventListener('click', (e) => {
				if (e.target.closest('.btn-delete-tx, .bulk-check-label')) return;
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
					try { await this.coordinator.txEditController.handleEditDelete(id); }
					catch (error) { alert(`明細の削除に失敗しました: ${error.message}`); }
				}
			});
		});
		return generation;
	}

	async renderRecentTransactions() {
		const generation = ++this._recentRenderGeneration, key = this.db.encryptionKey;
		const list = document.getElementById('recent-tx-list');
		if (!list) return;
		const [all, masterConfig] = await Promise.all([
			this.db.getTransactions(),
			this.db.getMasterConfig()
		]);
		await this.waitForListIdle(list);
		if (generation !== this._recentRenderGeneration || key !== this.db.encryptionKey || this.coordinator.isKeyLocked) return;
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


