/**
 * Yoseatsume Kakeibo - Summary & Analytics Controller
 * Manages Summary dashboard, KPI cards, multi-granularity analytics, quick month picker, and recurring generation.
 */

import {
	addMonthsToMonthStr,
	generateRecurringTransactions,
	calculateBalancesAndSummaries,
	calculateTotalAssetSummary,
	aggregateDailySummaries,
	aggregateMonthlySummaries,
	aggregateYearlySummaries,
	calculateAnnualBudgetProgress,
	generateAnnualTrajectory,
	calculateTagSummary,
	calculateCrossAccrualActualSummary,
	escapeHtml
} from '../logic.js';
import { buildAssetHistory, formatDate } from '../logic.js';

export class SummaryController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.tagSearchQuery = '';
		this.lastTransactions = null;
		this.assetPeriod = 'month';
	}

	get db() {
		return this.coordinator.db;
	}

	get syncManager() {
		return this.coordinator.syncManager;
	}

	get chartController() {
		return this.coordinator.chartController;
	}

	setSelectedMonth(month) {
		const day = Number((this.coordinator.selectedDate || '').slice(8, 10)) || 1;
		const [year, monthNumber] = month.split('-').map(Number);
		const lastDay = new Date(year, monthNumber, 0).getDate();
		this.coordinator.currentMonth = month;
		this.coordinator.selectedYear = month.slice(0, 4);
		this.coordinator.selectedDate = `${month}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
		this.coordinator.txListController.currentPage = 1;
	}

	usesYearNavigation() {
		if (this.coordinator.analyticsTarget === 'assets') return this.assetPeriod === 'year';
		return this.coordinator.analyticsTarget === 'budget' || this.coordinator.analyticsGranularity === 'yearly';
	}

	setupSummaryView() {
		document.getElementById('select-asset-period')?.addEventListener('change', event => {
			this.assetPeriod = event.target.value;
			document.getElementById('asset-custom-period').style.display = this.assetPeriod === 'range' ? 'flex' : 'none';
			this.renderAssetHistory();
		});
		document.getElementById('btn-apply-asset-period')?.addEventListener('click', () => this.renderAssetHistory());
		// Granularity toggle: Daily vs Monthly vs Yearly
		document.querySelectorAll('#control-granularity .segment-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				document.querySelectorAll('#control-granularity .segment-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				this.coordinator.analyticsGranularity = btn.dataset.granularity;
				if (this.coordinator.txListController) {
					this.coordinator.txListController.currentPage = 1;
				}
				this.renderSummary();
			});
		});

		// Period Navigator (Requirement 3.16 & 3.36)
		document.getElementById('btn-period-prev')?.addEventListener('click', () => {
			if (this.usesYearNavigation()) {
				this.coordinator.selectedYear = String(Number(this.coordinator.selectedYear) - 1);
				this.setSelectedMonth(`${this.coordinator.selectedYear}-${this.coordinator.currentMonth.slice(5, 7)}`);
			} else {
				// daily and monthly both shift by 1 month and update selectedYear
				this.setSelectedMonth(addMonthsToMonthStr(this.coordinator.currentMonth, -1));
			}
			this.renderSummary();
		});

		document.getElementById('btn-period-next')?.addEventListener('click', () => {
			if (this.usesYearNavigation()) {
				this.coordinator.selectedYear = String(Number(this.coordinator.selectedYear) + 1);
				this.setSelectedMonth(`${this.coordinator.selectedYear}-${this.coordinator.currentMonth.slice(5, 7)}`);
			} else {
				// daily and monthly both shift by 1 month and update selectedYear
				this.setSelectedMonth(addMonthsToMonthStr(this.coordinator.currentMonth, 1));
			}
			this.renderSummary();
		});

		// Quick Month Picker direct jump (Requirement 3.16)
		const periodDisplay = document.getElementById('period-display');
		const periodPicker = document.getElementById('input-period-picker');
		periodDisplay?.addEventListener('click', () => {
			if (periodPicker) {
				periodPicker.value = this.coordinator.currentMonth || `${this.coordinator.selectedYear}-01`;
				if (typeof periodPicker.showPicker === 'function') {
					periodPicker.showPicker();
				} else {
					periodPicker.focus();
					periodPicker.click();
				}
			}
		});

		periodPicker?.addEventListener('change', (e) => {
			const val = e.target.value;
			if (val && /^\d{4}-\d{2}$/.test(val)) {
				this.setSelectedMonth(val);
				this.renderSummary();
			}
		});

		const btnPlanned = document.getElementById('btn-toggle-planned');
		btnPlanned?.addEventListener('click', () => {
			this.coordinator.showPlanned = !this.coordinator.showPlanned;
			btnPlanned.textContent = `予定: ${this.coordinator.showPlanned ? 'ON' : 'OFF'}`;
			this.renderSummary();
		});

		const btnAxis = document.getElementById('btn-toggle-axis');
		btnAxis?.addEventListener('click', () => {
			this.coordinator.useActualCategoryAxis = !this.coordinator.useActualCategoryAxis;
			btnAxis.textContent = this.coordinator.useActualCategoryAxis ? '📦 実態分類ベース' : '🏷️ 計上分類ベース';
			this.renderSummary();
		});

		document.getElementById('select-status-filter')?.addEventListener('change', () => {
			if (this.coordinator.txListController) this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		document.getElementById('select-account-filter')?.addEventListener('change', () => {
			if (this.coordinator.txListController) this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		document.getElementById('select-category-filter')?.addEventListener('change', () => {
			if (this.coordinator.txListController) this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		document.getElementById('select-tag-filter')?.addEventListener('change', () => {
			if (this.coordinator.txListController) this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		document.getElementById('input-tx-search')?.addEventListener('input', () => {
			if (this.coordinator.txListController) this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		// Recurring generation button
		document.getElementById('btn-generate-recurring')?.addEventListener('click', async () => {
			await this.handleGenerateRecurring();
		});

		// Month close button
		document.getElementById('btn-close-month')?.addEventListener('click', async () => {
			await this.handleCloseMonth();
		});

		// Tag search filter listener (Requirement 3.18)
		document.getElementById('input-tag-search')?.addEventListener('input', (e) => {
			this.tagSearchQuery = (e.target.value || '').trim();
			if (this.lastTransactions) {
				this.renderTagAnalytics(this.lastTransactions);
			}
		});
	}

	async handleGenerateRecurring() {
		const snapshot = await this.db.getSnapshot();
		if (snapshot?.last_closed_month && this.coordinator.currentMonth <= snapshot.last_closed_month) {
			alert('締め済み月に予定は生成できません。未締めの月を選択してください。'); return;
		}
		const config = await this.db.getMasterConfig();
		const existing = await this.db.getTransactions({ target_month: this.coordinator.currentMonth, includeDeleted: true });
		const generated = generateRecurringTransactions(
			config.recurring_rules || [],
			this.coordinator.currentMonth,
			config.holidays || [],
			existing
		);

		if (generated.length === 0) {
			alert(`${this.coordinator.currentMonth} の定期予定はすでに生成されているか、対象ルールがありません`);
			return;
		}

		await this.db.putTransactions(generated);
		alert(`${generated.length} 件の定期予定（planned）を生成しました`);
		await this.coordinator.refreshAllViews();
	}

	async handleCloseMonth() {
		const btn = document.getElementById('btn-close-month');
		if (btn?.disabled) return;
		if (btn) btn.disabled = true;
		try {
			const records = await this.db.getTransactions({ target_month: this.coordinator.currentMonth });
			if (records.some(tx => tx.amount_pending)) { alert('金額未入力の予定があります。金額を入力してから月締めしてください。'); return; }
			const planned = records.filter(tx => tx.status === 'planned');
			if (planned.length && !confirm(`${this.coordinator.currentMonth} には未確定の予定が ${planned.length} 件あります。内容を確認して確定・月締めしますか？`)) return;
			await this.syncManager.closeMonth(this.coordinator.currentMonth, { approvedPlanned: planned });
			alert(`${this.coordinator.currentMonth} の月締めが正常に完了しました！アーカイブが保存されました。`);
		} catch (error) { alert(`月締めに失敗しました: ${error.message}`); }
		finally { if (btn) btn.disabled = false; await this.coordinator.refreshAllViews(); }
	}

	async renderSummary() {
		const target = this.coordinator.analyticsTarget || 'cashflow';
		const granularity = this.coordinator.analyticsGranularity || 'monthly';

		const periodDisplay = document.getElementById('period-display');
		if (periodDisplay) {
			if (target === 'budget') {
				periodDisplay.textContent = `📅 ${this.coordinator.selectedYear}年 (年間予算・進捗) ▾`;
			} else if (target === 'assets') {
				periodDisplay.textContent = `📅 ${this.coordinator.currentMonth} (現在残高・推移) ▾`;
			} else if (granularity === 'daily') {
				periodDisplay.textContent = `📅 ${this.coordinator.currentMonth} (日別) ▾`;
			} else if (granularity === 'monthly') {
				periodDisplay.textContent = `📅 ${this.coordinator.currentMonth} (月別推移) ▾`;
			} else {
				periodDisplay.textContent = `📅 ${this.coordinator.selectedYear}年 (年別推移) ▾`;
			}
		}

		const snapshot = await this.db.getSnapshot();
		const config = await this.db.getMasterConfig();
		const transactions = await this.db.getTransactions({ includeDeleted: false });

		const summary = calculateBalancesAndSummaries(snapshot, transactions, this.coordinator.currentMonth);
		const totalAssetSummary = calculateTotalAssetSummary(
			summary.confirmed_balances,
			config?.accounts || [],
			snapshot?.external_assets || []
		);

		// Top KPI card grids: exclusive visibility per tab
		const assetStatGrid = document.getElementById('asset-stat-grid');
		const cashflowGrid = document.getElementById('cashflow-stat-grid');
		const budgetGrid = document.getElementById('budget-stat-grid');

		if (assetStatGrid) assetStatGrid.style.display = target === 'assets' ? 'grid' : 'none';
		if (cashflowGrid) cashflowGrid.style.display = target === 'cashflow' ? 'grid' : 'none';
		if (budgetGrid) budgetGrid.style.display = target === 'budget' ? 'grid' : 'none';

		// Update asset KPI cards when target === 'assets'
		if (target === 'assets') {
			const statTotal = document.getElementById('stat-total-assets');
			const statLiquid = document.getElementById('stat-liquid-assets');
			const statExt = document.getElementById('stat-external-assets');
			const statLiab = document.getElementById('stat-liabilities');

			if (statTotal) statTotal.textContent = `¥${totalAssetSummary.total_net_assets.toLocaleString()}`;
			if (statLiquid) statLiquid.textContent = `¥${totalAssetSummary.total_liquid_assets.toLocaleString()}`;
			if (statExt) statExt.textContent = `¥${totalAssetSummary.total_investment_assets.toLocaleString()}`;
			if (statLiab) statLiab.textContent = `¥${totalAssetSummary.total_liabilities.toLocaleString()}`;
		}

		// Cards visibility
		const historyCard = document.getElementById('asset-history-card');
		if (historyCard) historyCard.style.display = target === 'assets' ? 'block' : 'none';
		if (target === 'assets') await this.renderAssetHistory();
		const cardPeriodControls = document.getElementById('card-period-controls');
		const granularityRow = document.getElementById('granularity-control-row');
		const catCard = document.getElementById('card-category-breakdown');
		const budgetCatCard = document.getElementById('card-budget-category-progress');
		const tagCard = document.getElementById('card-tag-analytics');
		const crossCard = document.getElementById('card-cross-matrix');
		const monthlyOpsCard = document.getElementById('card-monthly-operations');
		const monthTxListCard = document.getElementById('card-month-tx-list');
		const chartCard = document.getElementById('card-summary-chart');
		const breakdownTableCard = document.getElementById('card-breakdown-table');
		const accountBalancesCard = document.getElementById('card-account-balances');

		const chartTitle = document.getElementById('chart-title');
		const tableTitle = document.getElementById('table-title');
		const accountBalancesTitle = document.getElementById('account-balances-title');

		// Monthly operations is shown ONLY on cashflow tab
		if (monthlyOpsCard) monthlyOpsCard.style.display = target === 'cashflow' ? 'block' : 'none';

		// Granularity selector (daily/monthly/yearly) is relevant for cashflow
		if (granularityRow) granularityRow.style.display = target === 'cashflow' ? 'flex' : 'none';

		// Tag and Cross matrix cards are primarily for cashflow
		if (tagCard) tagCard.style.display = target === 'cashflow' ? 'block' : 'none';
		if (crossCard) crossCard.style.display = target === 'cashflow' ? 'block' : 'none';
		if (monthTxListCard) monthTxListCard.style.display = target === 'cashflow' ? 'block' : 'none';

		if (target === 'budget') {
			if (catCard) catCard.style.display = 'none';
			if (budgetCatCard) budgetCatCard.style.display = 'block';
			if (chartTitle) chartTitle.textContent = `${this.coordinator.selectedYear}年 年間予算・貯蓄目標の進捗推移`;
			if (tableTitle) tableTitle.textContent = `${this.coordinator.selectedYear}年 月別予算消化・貯蓄実績一覧`;
			if (accountBalancesTitle) accountBalancesTitle.textContent = '口座別予算・実績';
			this.renderBudgetAnalytics(transactions, snapshot, config);
		} else if (target === 'cashflow') {
			if (budgetCatCard) budgetCatCard.style.display = 'none';
			if (catCard) catCard.style.display = 'block';
			if (accountBalancesTitle) accountBalancesTitle.textContent = '口座別支出（収支）';

			if (granularity === 'daily') {
				if (chartTitle) chartTitle.textContent = `${this.coordinator.currentMonth} 日別収支推移・内訳`;
				if (tableTitle) tableTitle.textContent = `${this.coordinator.currentMonth} 日別集計表`;
				this.renderDailyAnalytics(transactions, summary);
			} else if (granularity === 'monthly') {
				if (chartTitle) chartTitle.textContent = `${this.coordinator.selectedYear}年 月別収支推移 (当月: ${this.coordinator.currentMonth})`;
				if (tableTitle) tableTitle.textContent = `${this.coordinator.selectedYear}年 月別集計表`;
				this.renderMonthlyAnalytics(transactions, snapshot, summary);
			} else {
				if (chartTitle) chartTitle.textContent = `${this.coordinator.selectedYear}年 年別収支推移・貯蓄率推移`;
				if (tableTitle) tableTitle.textContent = '年次推移集計表';
				this.renderYearlyAnalytics(transactions, snapshot);
			}
		} else {
			// Assets Target
			if (budgetCatCard) budgetCatCard.style.display = 'none';
			if (catCard) catCard.style.display = 'none';
			if (chartTitle) chartTitle.textContent = '資産構成比・内部口座/外部資産内訳';
			if (tableTitle) tableTitle.textContent = '資産種別・口座別残高一覧';
			if (accountBalancesTitle) accountBalancesTitle.textContent = '口座別残高';
			this.renderAssetsAnalytics(totalAssetSummary, config, snapshot?.external_assets || []);
		}

		// Render Account Balances / Expenses / Budget Breakdown
		await this.renderAccountBalances(summary, transactions, config);

		// Render Tag Analytics & Breakdown (when in cashflow)
		if (target === 'cashflow') {
			this.lastTransactions = transactions;
			this.renderTagAnalytics(transactions);
			this.renderCrossMatrix(transactions, config);
			await this.coordinator.txListController.renderMonthTransactions();
		}
	}

	async renderAssetHistory() {
		try {
			const today = formatDate(new Date());
			const start = document.getElementById('asset-period-start');
			const end = document.getElementById('asset-period-end');
			if (!start.value) start.value = this.coordinator.currentMonth + '-01';
			if (!end.value) end.value = today;
			const history = buildAssetHistory(await this.db.getSnapshot(), await this.db.getTransactions(), (await this.db.getMasterConfig())?.accounts || [], {
				mode: this.assetPeriod, month: this.coordinator.currentMonth, year: this.coordinator.selectedYear, start: start.value, end: end.value, today,
				archiveMonths: await this.db.getSetting('downloaded_archive_months', [])
			});
			this.chartController.renderAssetHistory(history);
			document.getElementById('asset-history-notice').textContent = history.notice;
			document.getElementById('asset-history-card').dataset.period = this.assetPeriod;
		} catch (error) { alert(error.message); }
	}

	async applyDrilldownFilter({ accountId = 'all', categoryId = 'all', tag = 'all' } = {}) {
		if (this.coordinator.analyticsTarget !== 'cashflow') {
			this.coordinator.analyticsTarget = 'cashflow';
			const tabBtns = document.querySelectorAll('.tab-btn');
			tabBtns.forEach(b => {
				b.classList.toggle('active', b.dataset.analyticsTarget === 'cashflow' || b.dataset.tab === 'tab-cashflow');
			});
			await this.renderSummary();
		}

		this.coordinator.txListController.currentPage = 1;
		const statusSelect = document.getElementById('select-status-filter');
		const accSelect = document.getElementById('select-account-filter');
		const catSelect = document.getElementById('select-category-filter');
		const tagSelect = document.getElementById('select-tag-filter');
		const searchInput = document.getElementById('input-tx-search');

		if (statusSelect) statusSelect.value = 'all';
		if (searchInput) searchInput.value = '';

		await this.coordinator.txListController.renderMonthTransactions();

		if (accSelect) accSelect.value = accountId;
		if (catSelect) catSelect.value = categoryId;
		if (tagSelect) tagSelect.value = tag;

		await this.coordinator.txListController.renderMonthTransactions();

		const txCard = document.getElementById('card-month-tx-list');
		if (txCard) {
			await this.coordinator.setPaneCollapsed('card-month-tx-list', false);
			if (typeof txCard.scrollIntoView === 'function') {
				txCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		}
	}

	renderTagAnalytics(transactions) {
		const list = document.getElementById('tag-breakdown-list');
		if (!list) return;

		let relevantTxs = transactions;
		if (this.coordinator.analyticsTarget === 'budget' || this.coordinator.analyticsGranularity === 'yearly') {
			relevantTxs = transactions.filter(t => (t.target_month || t.date || '').startsWith(this.coordinator.selectedYear));
		} else if (this.coordinator.analyticsGranularity === 'daily' || this.coordinator.analyticsGranularity === 'monthly') {
			relevantTxs = transactions.filter(t => (t.target_month || t.date || '').slice(0, 7) === this.coordinator.currentMonth);
		}

		const tagSummary = calculateTagSummary(relevantTxs, {
			searchQuery: this.tagSearchQuery || '',
			filterTag: this.tagSearchQuery || ''
		});

		const tagsList = tagSummary.tagList || (Array.isArray(tagSummary.tags) ? tagSummary.tags : Object.values(tagSummary.tags || {}));

		if (tagsList.length === 0) {
			list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">該当するタグの取引はありません</div>';
		} else {
			list.innerHTML = tagsList.map(t => {
				const tagName = t.tag || t.name;
				const expenseAmt = t.expense ?? t.expense_total ?? 0;
				const incomeAmt = t.income ?? t.income_total ?? 0;
				const netAmt = t.net ?? t.net_total ?? 0;
				return `
					<div class="tx-item clickable" data-filter-tag="${escapeHtml(tagName)}" title="タッチしてこのタグの明細一覧を表示">
						<div class="tx-info">
							<span class="tx-title">🏷️ ${escapeHtml(tagName)} <span style="font-size: 0.75rem; color: var(--text-muted);">🔍</span></span>
							<span class="tx-meta">${t.count}件 (収入: ¥${incomeAmt.toLocaleString()})</span>
						</div>
						<div style="text-align: right;">
							<div style="font-weight: 700; color: var(--danger);">支出: ¥${expenseAmt.toLocaleString()}</div>
							<div style="font-size: 0.8rem; color: ${netAmt >= 0 ? 'var(--success)' : 'var(--danger)'};">
								差引: ¥${netAmt.toLocaleString()}
							</div>
						</div>
					</div>
				`;
			}).join('');

			list.querySelectorAll('.tx-item[data-filter-tag]').forEach(item => {
				item.addEventListener('click', () => {
					const tagVal = item.dataset.filterTag;
					if (tagVal && tagVal !== '(未設定)') {
						this.applyDrilldownFilter({ tag: tagVal });
					}
				});
			});
		}

		this.chartController.renderChartForTags(tagSummary);
	}

	renderCrossMatrix(transactions, config) {
		const container = document.getElementById('cross-matrix-table-container');
		if (!container) return;

		let relevantTxs = transactions;
		if (this.coordinator.analyticsTarget === 'budget' || this.coordinator.analyticsGranularity === 'yearly') {
			relevantTxs = transactions.filter(t => (t.target_month || t.date || '').startsWith(this.coordinator.selectedYear));
		} else if (this.coordinator.analyticsGranularity === 'daily' || this.coordinator.analyticsGranularity === 'monthly') {
			relevantTxs = transactions.filter(t => (t.target_month || t.date || '').slice(0, 7) === this.coordinator.currentMonth);
		}

		const categories = config?.categories || [];
		const summary = calculateCrossAccrualActualSummary(relevantTxs, categories);

		if (summary.categories.length === 0) {
			container.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">費目マスタが設定されていません</div>';
			return;
		}

		const theadHtml = `
			<thead>
				<tr>
					<th>計上 ＼ 実態</th>
					${summary.categories.map(c => `<th>${escapeHtml(c.name)}</th>`).join('')}
					<th class="cross-matrix-total-col">計上合計</th>
				</tr>
			</thead>
		`;

		const tbodyHtml = `
			<tbody>
				${summary.categories.map(rCat => `
					<tr>
						<th>${escapeHtml(rCat.name)}</th>
						${summary.categories.map(cCat => {
							const amt = summary.matrix[rCat.id]?.[cCat.id] || 0;
							return `<td>${amt > 0 ? '¥' + amt.toLocaleString() : '-'}</td>`;
						}).join('')}
						<td class="cross-matrix-total-col">¥${(summary.accrualTotals[rCat.id] || 0).toLocaleString()}</td>
					</tr>
				`).join('')}
			</tbody>
		`;

		const tfootHtml = `
			<tfoot>
				<tr class="cross-matrix-total-row">
					<th>実態合計</th>
					${summary.categories.map(cCat => `<td>¥${(summary.actualTotals[cCat.id] || 0).toLocaleString()}</td>`).join('')}
					<td class="cross-matrix-total-col">¥${summary.grandTotal.toLocaleString()}</td>
				</tr>
			</tfoot>
		`;

		container.innerHTML = `<table class="cross-matrix-table">${theadHtml}${tbodyHtml}${tfootHtml}</table>`;
	}

	renderExternalAssetsBreakdown(assets) {
		const list = document.getElementById('summary-external-assets-list');
		if (!list) return;

		if (!assets || assets.length === 0) {
			list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">保有外部資産は登録されていません（設定マスタより追加できます）</div>';
			return;
		}

		list.innerHTML = assets.map(a => {
			const val = Number(a.market_value ?? a.current_value ?? a.amount ?? 0);
			return `
				<div class="tx-item">
					<div class="tx-info">
						<span class="tx-title">${escapeHtml(a.name)}</span>
						<span class="tx-meta">更新日: ${escapeHtml((a.updated_at || '-').slice(0, 10))}</span>
					</div>
					<div style="font-weight: 700; color: #10b981; font-size: 1.05rem;">
						¥${val.toLocaleString()}
					</div>
				</div>
			`;
		}).join('');
	}

	renderDailyAnalytics(transactions, summary) {
		const dailyData = aggregateDailySummaries(transactions, this.coordinator.currentMonth);

		// Update cashflow stat cards
		const statInc = document.getElementById('stat-income');
		const statExp = document.getElementById('stat-expense');
		const statNet = document.getElementById('stat-net-income');
		const statBal = document.getElementById('stat-confirmed-balance');
		const lblInc = document.getElementById('label-stat-income');
		const lblExp = document.getElementById('label-stat-expense');
		const lblNet = document.getElementById('label-stat-net');
		const lblBal = document.getElementById('label-stat-savings-rate');

		if (lblInc) lblInc.textContent = '当月収入 (確定/予定込)';
		if (statInc) statInc.textContent = `¥${summary.income_confirmed.toLocaleString()} / ¥${summary.income_total.toLocaleString()}`;
		if (lblExp) lblExp.textContent = '当月支出 (確定/予定込)';
		if (statExp) statExp.textContent = `¥${summary.expense_confirmed.toLocaleString()} / ¥${summary.expense_total.toLocaleString()}`;
		if (lblNet) lblNet.textContent = '当月収支差額 (貯蓄)';
		if (statNet) statNet.textContent = `¥${(summary.income_total - summary.expense_total).toLocaleString()}`;
		if (lblBal) lblBal.textContent = '現在確定残高 / 予測';
		const totalConf = Object.values(summary.confirmed_balances).reduce((a, b) => a + b, 0);
		const totalProj = Object.values(summary.projected_balances).reduce((a, b) => a + b, 0);
		if (statBal) statBal.textContent = `¥${totalConf.toLocaleString()} / ¥${totalProj.toLocaleString()}`;

		// Table
		const tableContainer = document.getElementById('breakdown-table-container');
		if (tableContainer) {
			const days = Object.values(dailyData.days).filter(d => d.income_total > 0 || d.expense_total > 0);
			if (days.length === 0) {
				tableContainer.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">当月の日別取引データはありません</div>';
			} else {
				tableContainer.innerHTML = `
					<table class="summary-table">
						<thead>
							<tr>
								<th>日付</th>
								<th>確定収入</th>
								<th>確定支出</th>
								<th>予定支出</th>
								<th>収支差額</th>
							</tr>
						</thead>
						<tbody>
							${days.map(d => `
								<tr class="clickable-row ${this.coordinator.selectedDate === d.date ? 'active' : ''}" data-date="${d.date}" style="cursor: pointer;">
									<td><strong>${d.date.slice(5)}</strong></td>
									<td style="color: #10b981;">¥${d.income_confirmed.toLocaleString()}</td>
									<td style="color: var(--danger);">¥${d.expense_confirmed.toLocaleString()}</td>
									<td style="color: var(--text-muted);">¥${d.expense_planned.toLocaleString()}</td>
									<td style="font-weight: 600; color: ${d.net >= 0 ? '#10b981' : 'var(--danger)'};">
										${d.net >= 0 ? '+' : ''}¥${d.net.toLocaleString()}
									</td>
								</tr>
							`).join('')}
						</tbody>
					</table>
				`;

				tableContainer.querySelectorAll('.clickable-row').forEach(row => {
					row.addEventListener('click', () => {
						const date = row.dataset.date;
						if (date) {
							this.coordinator.selectedDate = date;
							tableContainer.querySelectorAll('.clickable-row').forEach(r => r.classList.remove('active'));
							row.classList.add('active');
							if (this.coordinator.txListController) {
								this.coordinator.txListController.currentPage = 1;
								this.coordinator.txListController.renderMonthTransactions();
							}
						}
					});
				});
			}
		}

		// Category breakdown list
		this.renderCategoryBreakdownList(this.coordinator.useActualCategoryAxis ? summary.by_actual_category : summary.by_category);

		// Chart
		this.chartController.renderChartForDaily(dailyData);
	}

	renderMonthlyAnalytics(transactions, snapshot, summary) {
		const monthlyData = aggregateMonthlySummaries(transactions, this.coordinator.selectedYear, snapshot?.monthly_summaries || {});

		// Update cashflow stat cards: display currentMonth stats with year reference
		const statInc = document.getElementById('stat-income');
		const statExp = document.getElementById('stat-expense');
		const statNet = document.getElementById('stat-net-income');
		const statBal = document.getElementById('stat-confirmed-balance');
		const lblInc = document.getElementById('label-stat-income');
		const lblExp = document.getElementById('label-stat-expense');
		const lblNet = document.getElementById('label-stat-net');
		const lblBal = document.getElementById('label-stat-savings-rate');

		if (summary) {
			if (lblInc) lblInc.textContent = `当月収入 (${this.coordinator.currentMonth})`;
			if (statInc) statInc.textContent = `¥${summary.income_confirmed.toLocaleString()} / ¥${summary.income_total.toLocaleString()}`;
			if (lblExp) lblExp.textContent = `当月支出 (${this.coordinator.currentMonth})`;
			if (statExp) statExp.textContent = `¥${summary.expense_confirmed.toLocaleString()} / ¥${summary.expense_total.toLocaleString()}`;
			if (lblNet) lblNet.textContent = `当月収支差額 (貯蓄)`;
			if (statNet) statNet.textContent = `¥${(summary.income_total - summary.expense_total).toLocaleString()}`;
			if (lblBal) lblBal.textContent = `年間貯蓄率 (${this.coordinator.selectedYear}年)`;
			const rate = monthlyData.total_income > 0 ? Math.round((monthlyData.total_net / monthlyData.total_income) * 1000) / 10 : 0;
			if (statBal) statBal.textContent = `${rate}% (確定残高: ¥${Object.values(summary.confirmed_balances).reduce((a, b) => a + b, 0).toLocaleString()})`;
		}

		// Table
		const tableContainer = document.getElementById('breakdown-table-container');
		if (tableContainer) {
			let cumulative = 0;
			const rows = Object.values(monthlyData.months);
			tableContainer.innerHTML = `
				<table class="summary-table">
					<thead>
						<tr>
							<th>月</th>
							<th>収入</th>
							<th>支出</th>
							<th>収支差額</th>
							<th>累積差額</th>
						</tr>
					</thead>
					<tbody>
						${rows.map(m => {
							cumulative += m.net;
							const isCurrentSelected = m.month === this.coordinator.currentMonth;
							return `
								<tr style="${isCurrentSelected ? 'background: var(--bg-hover); font-weight: 700;' : ''}">
									<td><strong>${m.month}${isCurrentSelected ? ' 📍' : ''}</strong></td>
									<td style="color: #10b981;">¥${m.income_total.toLocaleString()}</td>
									<td style="color: var(--danger);">¥${m.expense_total.toLocaleString()}</td>
									<td style="font-weight: 600; color: ${m.net >= 0 ? '#10b981' : 'var(--danger)'};">
										${m.net >= 0 ? '+' : ''}¥${m.net.toLocaleString()}
									</td>
									<td style="font-weight: 600;">¥${cumulative.toLocaleString()}</td>
								</tr>
							`;
						}).join('')}
					</tbody>
				</table>
			`;
		}

		// Category breakdown list: aggregate for currentMonth in monthly mode to match selected month
		const catData = summary ? (this.coordinator.useActualCategoryAxis ? summary.by_actual_category : summary.by_category) : {};
		this.renderCategoryBreakdownList(catData);

		// Chart
		this.chartController.renderChartForMonthly(monthlyData);
	}

	renderYearlyAnalytics(transactions, snapshot) {
		const yearlyData = aggregateYearlySummaries(transactions, snapshot?.monthly_summaries || {});
		const selectedYear = this.coordinator.selectedYear;
		const targetYearData = yearlyData[selectedYear] || { income: 0, expense: 0, net: 0, savings_rate: 0 };

		const statInc = document.getElementById('stat-income');
		const statExp = document.getElementById('stat-expense');
		const statNet = document.getElementById('stat-net-income');
		const statBal = document.getElementById('stat-confirmed-balance');
		const lblInc = document.getElementById('label-stat-income');
		const lblExp = document.getElementById('label-stat-expense');
		const lblNet = document.getElementById('label-stat-net');
		const lblBal = document.getElementById('label-stat-savings-rate');

		if (lblInc) lblInc.textContent = `${selectedYear}年 年間収入`;
		if (statInc) statInc.textContent = `¥${(targetYearData.income || 0).toLocaleString()}`;
		if (lblExp) lblExp.textContent = `${selectedYear}年 年間支出`;
		if (statExp) statExp.textContent = `¥${(targetYearData.expense || 0).toLocaleString()}`;
		if (lblNet) lblNet.textContent = `${selectedYear}年 年間純貯蓄`;
		if (statNet) statNet.textContent = `¥${(targetYearData.net || 0).toLocaleString()}`;
		if (lblBal) lblBal.textContent = `${selectedYear}年 貯蓄率`;
		if (statBal) statBal.textContent = `${targetYearData.savings_rate || 0}%`;

		// Table
		const tableContainer = document.getElementById('breakdown-table-container');
		if (tableContainer) {
			const years = Object.values(yearlyData).sort((a, b) => a.year.localeCompare(b.year));
			tableContainer.innerHTML = `
				<table class="summary-table">
					<thead>
						<tr>
							<th>年</th>
							<th>収入</th>
							<th>支出</th>
							<th>年間収支差額</th>
							<th>貯蓄率</th>
						</tr>
					</thead>
					<tbody>
						${years.map(y => `
							<tr>
								<td><strong>${y.year}年</strong></td>
								<td style="color: #10b981;">¥${y.income.toLocaleString()}</td>
								<td style="color: var(--danger);">¥${y.expense.toLocaleString()}</td>
								<td style="font-weight: 600; color: ${y.net >= 0 ? '#10b981' : 'var(--danger)'};">
									${y.net >= 0 ? '+' : ''}¥${y.net.toLocaleString()}
								</td>
								<td style="font-weight: 600;">${y.savings_rate}%</td>
							</tr>
						`).join('')}
					</tbody>
				</table>
			`;
		}

		// Category breakdown list: aggregate for selectedYear in yearly mode to isolate current year
		const src = this.coordinator.useActualCategoryAxis ? targetYearData.by_actual_category : targetYearData.by_category;
		const catObj = {};
		if (src) {
			for (const [k, v] of Object.entries(src)) {
				const val = typeof v === 'number' ? v : (v.total || 0);
				catObj[k] = { total: val, total_confirmed: val, total_planned: 0 };
			}
		}
		this.renderCategoryBreakdownList(catObj);

		// Chart
		this.chartController.renderChartForYearly(yearlyData);
	}

	renderBudgetAnalytics(transactions, snapshot, config) {
		const currentYear = this.coordinator.selectedYear || String(new Date().getFullYear());
		const budgetConfig = config?.annual_budgets?.[currentYear] || {};
		const expenseBudget = Number(budgetConfig.expense_budget) || 0;
		const savingsTarget = Number(budgetConfig.savings_target_amount) || 0;
		const targetRate = Number(budgetConfig.savings_target_rate ?? budgetConfig.target_savings_rate) || 0;

		const monthlyData = aggregateMonthlySummaries(transactions, currentYear, snapshot?.monthly_summaries || {});
		const expenseActual = monthlyData.total_expense;
		const incomeActual = monthlyData.total_income;
		const savingsActual = monthlyData.total_net;

		const now = new Date();
		const currentYearNum = Number(currentYear);
		let currentMonthIndex = 12;
		if (currentYearNum === now.getFullYear()) {
			currentMonthIndex = now.getMonth() + 1;
		} else if (currentYearNum > now.getFullYear()) {
			currentMonthIndex = 1;
		}

		const yearlyCategoryActuals = {};
		for (const m of Object.values(monthlyData.months)) {
			if (m.by_category) {
				for (const [catId, val] of Object.entries(m.by_category)) {
					const amt = typeof val === 'object' ? Number(val.total || 0) : Number(val || 0);
					yearlyCategoryActuals[catId] = (yearlyCategoryActuals[catId] || 0) + amt;
				}
			}
		}

		const progress = calculateAnnualBudgetProgress({
			yearlySummary: {
				expense: expenseActual,
				income: incomeActual,
				net: savingsActual,
				by_category: yearlyCategoryActuals
			},
			budgetConfig: {
				expense_budget: expenseBudget,
				savings_target_amount: savingsTarget,
				savings_target_rate: targetRate,
				category_budgets: budgetConfig.category_budgets || {}
			},
			currentMonth: currentMonthIndex,
			expenseBudget,
			expenseActual,
			savingsTargetAmount: savingsTarget,
			savingsTargetRate: targetRate,
			incomeActual,
			netSavingsActual: savingsActual,
			currentMonthIndex,
			categoryBudgets: budgetConfig.category_budgets || {},
			categoryActuals: yearlyCategoryActuals
		});

		// Update KPI cards
		const statExp = document.getElementById('stat-budget-expense');
		const barExp = document.getElementById('bar-budget-expense');
		const lblExpPace = document.getElementById('label-budget-expense-pace');
		const statSav = document.getElementById('stat-budget-savings');
		const barSav = document.getElementById('bar-budget-savings');
		const lblSavRate = document.getElementById('label-budget-savings-rate');
		const statRate = document.getElementById('stat-budget-rate');
		const lblRateEval = document.getElementById('label-budget-rate-eval');
		const statPaceStatus = document.getElementById('stat-budget-pace-status');
		const lblPaceDesc = document.getElementById('label-budget-pace-desc');

		if (statExp) {
			statExp.textContent = `¥${expenseBudget.toLocaleString()} / ¥${expenseActual.toLocaleString()}`;
		}
		if (barExp) {
			barExp.style.width = `${Math.min(100, Math.max(0, progress.expense_consumption_rate))}%`;
			if (progress.pace_status === 'over_budget') {
				barExp.style.background = 'var(--danger)';
			} else if (progress.pace_status === 'caution') {
				barExp.style.background = '#f59e0b';
			} else {
				barExp.style.background = '#3b82f6';
			}
		}
		if (lblExpPace) {
			lblExpPace.textContent = `消化率: ${progress.expense_consumption_rate}% (基準ペース: ${progress.expected_pace_rate}%, 残: ¥${progress.expense_remaining.toLocaleString()})`;
		}

		if (statSav) {
			statSav.textContent = `¥${savingsTarget.toLocaleString()} / ¥${savingsActual.toLocaleString()}`;
		}
		if (barSav) {
			barSav.style.width = `${Math.min(100, Math.max(0, progress.savings_achievement_rate))}%`;
			barSav.style.background = progress.is_deficit ? 'var(--danger)' : '#10b981';
		}
		if (lblSavRate) {
			if (progress.is_deficit) {
				lblSavRate.textContent = `達成率: 0% (年間収支赤字: ¥${Math.abs(savingsActual).toLocaleString()})`;
			} else {
				lblSavRate.textContent = `達成率: ${progress.savings_achievement_rate}% (目標残: ¥${progress.savings_remaining.toLocaleString()})`;
			}
		}

		if (statRate) {
			statRate.textContent = `${targetRate}% / ${progress.savings_actual_rate}%`;
		}
		if (lblRateEval) {
			if (targetRate <= 0) {
				lblRateEval.textContent = '目標貯蓄率: 未設定';
			} else if (progress.savings_rate_achieved) {
				lblRateEval.textContent = '✅ 目標貯蓄率を達成中';
			} else {
				const diff = Math.round((targetRate - progress.savings_actual_rate) * 10) / 10;
				lblRateEval.textContent = `⏳ 目標貯蓄率まであと ${diff}%`;
			}
		}

		if (statPaceStatus) {
			let paceText = '順調';
			let paceColor = '#10b981';
			if (progress.pace_status === 'ahead') {
				paceText = '⚡ 抑制中 (余裕あり)';
				paceColor = '#3b82f6';
			} else if (progress.pace_status === 'caution') {
				paceText = '⚠️ ペース超過注意';
				paceColor = '#f59e0b';
			} else if (progress.pace_status === 'over_budget') {
				paceText = '🚨 予算超過';
				paceColor = 'var(--danger)';
			}
			statPaceStatus.textContent = paceText;
			statPaceStatus.style.color = paceColor;
		}
		if (lblPaceDesc) {
			lblPaceDesc.textContent = `経過${currentMonthIndex}ヶ月時点 (標準消化ペース: ${progress.expected_pace_rate}%)`;
		}

		// Trajectory for table and chart
		const trajectory = generateAnnualTrajectory({
			year: currentYear,
			monthlySummaries: monthlyData.months,
			expenseBudget,
			savingsTarget
		});

		// Table
		const tableContainer = document.getElementById('breakdown-table-container');
		if (tableContainer) {
			tableContainer.innerHTML = `
				<table class="summary-table">
					<thead>
						<tr>
							<th>月</th>
							<th>支出実績</th>
							<th>月割予算目安</th>
							<th>累積支出</th>
							<th>累積予算目安</th>
							<th>当月純貯蓄</th>
							<th>累積純貯蓄</th>
							<th>累積目標目安</th>
						</tr>
					</thead>
					<tbody>
						${trajectory.map(t => {
							const expExceeded = expenseBudget > 0 && t.cumulative_expense > t.cumulative_budget_pace;
							const savOnTrack = savingsTarget > 0 && t.cumulative_savings >= t.cumulative_savings_pace;
							return `
								<tr>
									<td><strong>${Number(t.month)}月</strong></td>
									<td style="color: var(--danger);">¥${t.monthly_expense.toLocaleString()}</td>
									<td style="color: var(--text-muted);">¥${t.monthly_budget_allowance.toLocaleString()}</td>
									<td style="font-weight: 600; color: ${expExceeded ? 'var(--danger)' : 'var(--text-main)'};">
										¥${t.cumulative_expense.toLocaleString()}
									</td>
									<td style="color: var(--text-muted);">¥${t.cumulative_budget_pace.toLocaleString()}</td>
									<td style="color: ${t.monthly_savings >= 0 ? '#10b981' : 'var(--danger)'};">
										${t.monthly_savings >= 0 ? '+' : ''}¥${t.monthly_savings.toLocaleString()}
									</td>
									<td style="font-weight: 600; color: ${t.cumulative_savings >= 0 ? '#10b981' : 'var(--danger)'};">
										¥${t.cumulative_savings.toLocaleString()}
									</td>
									<td style="color: var(--text-muted); font-weight: ${savOnTrack ? '600' : 'normal'};">
										¥${t.cumulative_savings_pace.toLocaleString()}
									</td>
								</tr>
							`;
						}).join('')}
					</tbody>
				</table>
			`;
		}

		// Category budget progress breakdown list (Requirement 3.14)
		const catProgressContainer = document.getElementById('budget-category-progress-container');
		if (catProgressContainer) {
			const categories = (config?.categories || []).filter(c => !c.is_archived && (!c.type || c.type === 'expense'));
			const catMap = new Map();
			for (const c of categories) {
				catMap.set(c.id, c);
			}

			const catEntries = Object.entries(progress.category_progress || {});
			if (catEntries.length === 0) {
				catProgressContainer.innerHTML = `
					<div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.9rem;">
						費目別年間予算は未設定です。<br>「設定」タブの「🎯 年間予算・貯蓄目標の設定」から各費目の年間予算を設定できます。
					</div>
				`;
			} else {
				// Sort by budget descending
				catEntries.sort((a, b) => b[1].budget - a[1].budget);

				catProgressContainer.innerHTML = `
					<table class="summary-table">
						<thead>
							<tr>
								<th>費目</th>
								<th>年間予算</th>
								<th>支出実績</th>
								<th>残予算</th>
								<th>消化率 (進捗)</th>
								<th>ペース判定</th>
							</tr>
						</thead>
						<tbody>
							${catEntries.map(([catId, p]) => {
								const catObj = catMap.get(catId);
								const catName = catObj ? `${escapeHtml(catObj.icon || '🏷️')} ${escapeHtml(catObj.name)}` : escapeHtml(catId);
								let statusBadge = '<span class="badge badge-success">順調</span>';
								let barColor = '#10b981';
								if (p.pace_status === 'ahead') {
									statusBadge = '<span class="badge badge-info">抑制中</span>';
									barColor = '#3b82f6';
								} else if (p.pace_status === 'caution') {
									statusBadge = '<span class="badge badge-warning" style="background:#f59e0b; color:#fff;">注意</span>';
									barColor = '#f59e0b';
								} else if (p.pace_status === 'over_budget') {
									statusBadge = '<span class="badge badge-danger">予算超過</span>';
									barColor = 'var(--danger)';
								}

								return `
									<tr>
										<td><strong>${catName}</strong></td>
										<td style="font-weight: 600;">¥${p.budget.toLocaleString()}</td>
										<td style="color: var(--danger);">¥${p.actual.toLocaleString()}</td>
										<td style="color: ${p.remaining >= 0 ? 'var(--text-main)' : 'var(--danger)'};">
											¥${p.remaining.toLocaleString()}
										</td>
										<td style="min-width: 130px;">
											<div style="display: flex; align-items: center; gap: 8px;">
												<div style="flex: 1; background: #e2e8f0; height: 6px; border-radius: 3px; overflow: hidden;">
													<div style="background: ${barColor}; height: 100%; width: ${Math.min(100, Math.max(0, p.consumption_rate))}%;"></div>
												</div>
												<span style="font-size: 0.8rem; font-weight: 600; min-width: 38px;">${p.consumption_rate}%</span>
											</div>
										</td>
										<td>${statusBadge}</td>
									</tr>
								`;
							}).join('')}
						</tbody>
					</table>
				`;
			}
		}

		// Chart
		this.chartController.renderChartForBudgetProgress(trajectory, currentYear, expenseBudget, savingsTarget);
	}

	renderAssetsAnalytics(totalAssetSummary, config, externalAssets = []) {
		const tableContainer = document.getElementById('breakdown-table-container');
		if (!tableContainer) return;

		const totalNet = totalAssetSummary.total_net_assets || 1;
		const accounts = config?.accounts || [];
		const investmentTypes = new Set(['investment', 'insurance', 'asset', 'stock', 'mutual_fund', 'crypto']);
		const liabilityTypes = new Set(['credit_card', 'loan']);

		const liquidAccounts = accounts.filter(a => !a.is_archived && !liabilityTypes.has(a.type) && !investmentTypes.has(a.type));
		const investmentAccounts = accounts.filter(a => !a.is_archived && investmentTypes.has(a.type));
		const liabilityAccounts = accounts.filter(a => !a.is_archived && liabilityTypes.has(a.type));

		tableContainer.innerHTML = `
			<table class="summary-table">
				<thead>
					<tr>
						<th>資産 / 口座名</th>
						<th>分類・種別</th>
						<th>評価額 / 残高</th>
						<th>構成比</th>
					</tr>
				</thead>
				<tbody>
					<tr class="summary-category-header" style="font-weight: 700;">
						<td colspan="4">流動資産 (預貯金・現金等)</td>
					</tr>
					${liquidAccounts.map(a => {
						const bal = totalAssetSummary.confirmed_balances?.[a.id] || 0;
						const pct = Math.round((Math.max(0, bal) / Math.max(1, totalNet)) * 1000) / 10;
						return `
							<tr>
								<td>${escapeHtml(a.name)}</td>
								<td>${escapeHtml(a.type)}</td>
								<td style="font-weight: 600; color: var(--primary);">¥${bal.toLocaleString()}</td>
								<td>${pct}%</td>
							</tr>
						`;
					}).join('') || '<tr><td colspan="4" style="color:var(--text-muted); text-align:center;">登録なし</td></tr>'}
					<tr class="summary-category-header" style="font-weight: 700;">
						<td colspan="4">投資・保険資産 (証券・投信・NISA・積立保険等)</td>
					</tr>
					${investmentAccounts.map(a => {
						const bal = totalAssetSummary.confirmed_balances?.[a.id] || 0;
						const pct = Math.round((Math.max(0, bal) / Math.max(1, totalNet)) * 1000) / 10;
						const insMeta = a.type === 'insurance' && (a.maturity_date || a.maturity_amount)
							? `<div style="font-size: 0.75rem; color: var(--text-muted);">満期: ${escapeHtml(a.maturity_date || '未設定')}${a.maturity_amount ? ` / 満期額: ¥${Number(a.maturity_amount).toLocaleString()}` : ''}</div>`
							: '';
						return `
							<tr>
								<td>${escapeHtml(a.name)}${insMeta}</td>
								<td>${escapeHtml(a.type)}</td>
								<td style="font-weight: 600; color: #10b981;">¥${bal.toLocaleString()}</td>
								<td>${pct}%</td>
							</tr>
						`;
					}).join('')}
					${externalAssets.map(ast => {
						const val = Number(ast.market_value ?? ast.current_value ?? ast.amount ?? 0);
						const pct = Math.round((val / Math.max(1, totalNet)) * 1000) / 10;
						return `
							<tr>
								<td>${escapeHtml(ast.name)}</td>
								<td>外部資産</td>
								<td style="font-weight: 600; color: #10b981;">¥${val.toLocaleString()}</td>
								<td>${pct}%</td>
							</tr>
						`;
					}).join('')}
					<tr class="summary-category-header" style="font-weight: 700;">
						<td colspan="4">負債 (クレジットカード・ローン等)</td>
					</tr>
					${liabilityAccounts.map(a => {
						const bal = totalAssetSummary.confirmed_balances?.[a.id] || 0;
						const formattedBal = `${bal < 0 ? '-' : ''}¥${Math.abs(bal).toLocaleString()}`;
						return `
							<tr>
								<td>${escapeHtml(a.name)}</td>
								<td>負債 (${escapeHtml(a.type)})</td>
								<td style="font-weight: 600; color: var(--danger);">${formattedBal}</td>
								<td>-</td>
							</tr>
						`;
					}).join('')}
					<tr>
						<td><strong>負債合計</strong></td>
						<td>負債 (credit_card / loan)</td>
						<td style="font-weight: 700; color: var(--danger);">-¥${totalAssetSummary.liabilities.toLocaleString()}</td>
						<td>-</td>
					</tr>
				</tbody>
			</table>
		`;

		// Render Asset Allocation Chart
		this.chartController.renderChartForAssets(totalAssetSummary);
	}

	async renderCategoryBreakdownList(categoriesData) {
		const list = document.getElementById('category-breakdown-list');
		if (!list) return;

		const config = await this.db.getMasterConfig();
		const catMap = new Map();
		for (const c of config?.categories || []) {
			catMap.set(c.id, c.name);
			if (c.subcategories) {
				for (const s of c.subcategories) {
					catMap.set(s.id, s.name);
				}
			}
		}

		const entries = Object.entries(categoriesData || {});
		if (entries.length === 0) {
			this.chartController.renderChartForCategoryBreakdown([]);
			list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">内訳データはありません</div>';
			return;
		}

		const sortedEntries = entries.sort((a, b) => (b[1].total || 0) - (a[1].total || 0));
		const totalExpense = sortedEntries.reduce((sum, [, data]) => sum + (data.total || 0), 0);

		const chartItems = sortedEntries.map(([catId, data]) => ({
			id: catId,
			name: catMap.get(catId) || catId,
			amount: data.total || 0
		}));
		this.chartController.renderChartForCategoryBreakdown(chartItems);

		list.innerHTML = sortedEntries
			.map(([catId, data]) => {
				const amt = data.total || 0;
				const pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 1000) / 10 : 0;
				const catName = catMap.get(catId) || catId;
				return `
					<div class="tx-item clickable" data-filter-category="${escapeHtml(catId)}" title="タッチしてこの費目の明細一覧を表示">
						<div class="tx-info">
							<span class="tx-title">${escapeHtml(catName)} <span style="font-size: 0.75rem; color: var(--text-muted);">🔍</span></span>
							<span class="tx-meta">構成比: ${pct}%</span>
						</div>
						<div style="text-align: right; font-weight: 700; color: var(--primary);">
							¥${amt.toLocaleString()}
						</div>
					</div>
				`;
			}).join('');

		list.querySelectorAll('.tx-item[data-filter-category]').forEach(item => {
			item.addEventListener('click', () => {
				const catId = item.dataset.filterCategory;
				if (catId) {
					this.applyDrilldownFilter({ categoryId: catId });
				}
			});
		});
	}

	async renderAccountBalances(summary, transactions = [], config = null) {
		const list = document.getElementById('account-balances-list');
		if (!list) return;
		const cfg = config || await this.db.getMasterConfig();
		const accounts = (cfg?.accounts || []).filter(a => !a.is_archived);
		const target = this.coordinator.analyticsTarget || 'cashflow';
		const granularity = this.coordinator.analyticsGranularity || 'monthly';

		if (target === 'cashflow') {
			// Filter transactions for relevant period (daily/monthly: currentMonth, yearly: selectedYear)
			let relevantTxs = transactions;
			if (granularity === 'yearly') {
				relevantTxs = transactions.filter(t => !t.is_deleted && (t.target_month || t.date || '').startsWith(this.coordinator.selectedYear));
			} else {
				relevantTxs = transactions.filter(t => !t.is_deleted && (t.target_month || t.date || '').slice(0, 7) === this.coordinator.currentMonth);
			}

			// Calculate expenses and inflows per account
			const accStats = {};
			for (const a of accounts) {
				accStats[a.id] = { expense: 0, income: 0, count: 0 };
			}
			for (const tx of relevantTxs) {
				const amt = Number(tx.amount) || 0;
				if (tx.type === 'expense' && tx.account_id && accStats[tx.account_id]) {
					accStats[tx.account_id].expense += amt;
					accStats[tx.account_id].count++;
				} else if (tx.type === 'income' && tx.account_id && accStats[tx.account_id]) {
					accStats[tx.account_id].income += amt;
					accStats[tx.account_id].count++;
				}
			}

			list.innerHTML = accounts.map(acc => {
				const stat = accStats[acc.id] || { expense: 0, income: 0, count: 0 };
				const net = stat.income - stat.expense;
				return `
					<div class="tx-item clickable" data-filter-account="${escapeHtml(acc.id)}" title="タッチしてこの口座の明細一覧を表示">
						<div class="tx-info">
							<span class="tx-title">${escapeHtml(acc.name)} <span style="font-size: 0.75rem; color: var(--text-muted);">🔍</span></span>
							<span class="tx-meta">${escapeHtml(acc.type)} (${stat.count}件 / 収入: ¥${stat.income.toLocaleString()})</span>
						</div>
						<div style="text-align: right;">
							<div style="font-weight: 700; color: var(--danger);">支出: ¥${stat.expense.toLocaleString()}</div>
							<div style="font-size: 0.8rem; color: ${net >= 0 ? 'var(--success)' : 'var(--danger)'};">
								差引: ¥${net.toLocaleString()}
							</div>
						</div>
					</div>
				`;
			}).join('');
		} else if (target === 'budget') {
			// Annual account expense actuals and monthly average for selectedYear
			const yearTxs = transactions.filter(t => !t.is_deleted && t.type === 'expense' && (t.target_month || t.date || '').startsWith(this.coordinator.selectedYear));
			const accExpenses = {};
			let totalExp = 0;
			for (const a of accounts) {
				accExpenses[a.id] = 0;
			}
			for (const tx of yearTxs) {
				if (tx.account_id && accExpenses[tx.account_id] !== undefined) {
					const amt = Number(tx.amount) || 0;
					accExpenses[tx.account_id] += amt;
					totalExp += amt;
				}
			}

			list.innerHTML = accounts.map(acc => {
				const exp = accExpenses[acc.id] || 0;
				const monthlyAvg = Math.round(exp / 12);
				const share = totalExp > 0 ? Math.round((exp / totalExp) * 1000) / 10 : 0;
				return `
					<div class="tx-item clickable" data-filter-account="${escapeHtml(acc.id)}" title="タッチしてこの口座の明細一覧を表示">
						<div class="tx-info">
							<span class="tx-title">${escapeHtml(acc.name)} <span style="font-size: 0.75rem; color: var(--text-muted);">🔍</span></span>
							<span class="tx-meta">年間構成比: ${share}% / 月割平均: ¥${monthlyAvg.toLocaleString()}/月</span>
						</div>
						<div style="text-align: right;">
							<div style="font-weight: 700; color: var(--primary);">年間支出: ¥${exp.toLocaleString()}</div>
						</div>
					</div>
				`;
			}).join('');
		} else {
			// Assets: Confirmed and Projected Balances
			list.innerHTML = accounts.map(acc => {
				const conf = summary?.confirmed_balances?.[acc.id] || 0;
				const proj = summary?.projected_balances?.[acc.id] || 0;
				const insInfo = acc.type === 'insurance' && acc.maturity_date
					? ` | 満期: ${escapeHtml(acc.maturity_date)}`
					: '';
				return `
					<div class="tx-item clickable" data-filter-account="${escapeHtml(acc.id)}" title="タッチしてこの口座の明細一覧を表示">
						<div class="tx-info">
							<span class="tx-title">${escapeHtml(acc.name)} <span style="font-size: 0.75rem; color: var(--text-muted);">🔍</span></span>
							<span class="tx-meta">${escapeHtml(acc.type)}${insInfo}</span>
						</div>
						<div style="text-align: right;">
							<div style="font-weight: 700; color: var(--primary);">¥${conf.toLocaleString()}</div>
							<div style="font-size: 0.8rem; color: var(--text-muted);">月末予測: ¥${proj.toLocaleString()}</div>
						</div>
					</div>
				`;
			}).join('');
		}

		list.querySelectorAll('.tx-item[data-filter-account]').forEach(item => {
			item.addEventListener('click', () => {
				const accId = item.dataset.filterAccount;
				if (accId) {
					this.applyDrilldownFilter({ accountId: accId });
				}
			});
		});
	}
}

