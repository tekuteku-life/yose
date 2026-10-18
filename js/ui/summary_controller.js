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
	escapeHtml
} from '../logic.js';

export class SummaryController {
	constructor(coordinator) {
		this.coordinator = coordinator;
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

	setupSummaryView() {
		// Target toggle: Cashflow vs Assets
		document.querySelectorAll('#control-view-target .segment-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				document.querySelectorAll('#control-view-target .segment-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				this.coordinator.analyticsTarget = btn.dataset.target;
				this.renderSummary();
			});
		});

		// Granularity toggle: Daily vs Monthly vs Yearly
		document.querySelectorAll('#control-granularity .segment-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				document.querySelectorAll('#control-granularity .segment-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				this.coordinator.analyticsGranularity = btn.dataset.granularity;
				this.renderSummary();
			});
		});

		// Period Navigator (Requirement 3.16)
		document.getElementById('btn-period-prev')?.addEventListener('click', () => {
			if (this.coordinator.analyticsTarget === 'budget' || this.coordinator.analyticsGranularity === 'yearly') {
				this.coordinator.selectedYear = String(Number(this.coordinator.selectedYear) - 1);
			} else if (this.coordinator.analyticsGranularity === 'daily') {
				this.coordinator.currentMonth = addMonthsToMonthStr(this.coordinator.currentMonth, -1);
				this.coordinator.selectedYear = this.coordinator.currentMonth.slice(0, 4);
			} else if (this.coordinator.analyticsGranularity === 'monthly') {
				this.coordinator.selectedYear = String(Number(this.coordinator.selectedYear) - 1);
				this.coordinator.currentMonth = `${this.coordinator.selectedYear}-${this.coordinator.currentMonth.slice(5, 7)}`;
			}
			this.renderSummary();
		});

		document.getElementById('btn-period-next')?.addEventListener('click', () => {
			if (this.coordinator.analyticsTarget === 'budget' || this.coordinator.analyticsGranularity === 'yearly') {
				this.coordinator.selectedYear = String(Number(this.coordinator.selectedYear) + 1);
			} else if (this.coordinator.analyticsGranularity === 'daily') {
				this.coordinator.currentMonth = addMonthsToMonthStr(this.coordinator.currentMonth, 1);
				this.coordinator.selectedYear = this.coordinator.currentMonth.slice(0, 4);
			} else if (this.coordinator.analyticsGranularity === 'monthly') {
				this.coordinator.selectedYear = String(Number(this.coordinator.selectedYear) + 1);
				this.coordinator.currentMonth = `${this.coordinator.selectedYear}-${this.coordinator.currentMonth.slice(5, 7)}`;
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
				this.coordinator.currentMonth = val;
				this.coordinator.selectedYear = val.slice(0, 4);
				this.renderSummary();
				this.coordinator.txListController.renderMonthTransactions();
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
	}

	async handleGenerateRecurring() {
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
		// Check if any planned items exist in this month
		const monthTxs = await this.db.getTransactions({ target_month: this.coordinator.currentMonth });
		const plannedTxs = monthTxs.filter(t => t.status === 'planned');

		if (plannedTxs.length > 0) {
			const confirmMsg = `${this.coordinator.currentMonth} には未確定の予定（planned）が ${plannedTxs.length} 件あります。\nすべて確定（confirmed）にして月締めを実行しますか？`;
			if (!confirm(confirmMsg)) {
				return;
			}
			for (const t of plannedTxs) {
				t.status = 'confirmed';
				t.sync_status = 'unsynced';
				await this.db.putTransaction(t);
			}
		}

		try {
			const btn = document.getElementById('btn-close-month');
			if (btn) btn.disabled = true;
			await this.syncManager.closeMonth(this.coordinator.currentMonth);
			alert(`${this.coordinator.currentMonth} の月締めが正常に完了しました！アーカイブが保存されました。`);
		} catch (err) {
			alert(`月締めに失敗しました: ${err.message}`);
		} finally {
			const btn = document.getElementById('btn-close-month');
			if (btn) btn.disabled = false;
			await this.coordinator.refreshAllViews();
		}
	}

	async renderSummary() {
		const periodDisplay = document.getElementById('period-display');
		if (periodDisplay) {
			if (this.coordinator.analyticsTarget === 'budget') {
				periodDisplay.textContent = `📅 ${this.coordinator.selectedYear}年 (年間予算・進捗) ▾`;
			} else if (this.coordinator.analyticsGranularity === 'daily') {
				periodDisplay.textContent = `📅 ${this.coordinator.currentMonth} (日別) ▾`;
			} else if (this.coordinator.analyticsGranularity === 'monthly') {
				periodDisplay.textContent = `📅 ${this.coordinator.selectedYear}年 (月別) ▾`;
			} else {
				periodDisplay.textContent = `📅 全期間 (年別推移) ▾`;
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

		// Update top asset KPI cards
		const statTotal = document.getElementById('stat-total-assets');
		const statLiquid = document.getElementById('stat-liquid-assets');
		const statExt = document.getElementById('stat-external-assets');
		const statLiab = document.getElementById('stat-liabilities');

		if (statTotal) statTotal.textContent = `¥${totalAssetSummary.total_net_assets.toLocaleString()}`;
		if (statLiquid) statLiquid.textContent = `¥${totalAssetSummary.total_liquid_assets.toLocaleString()}`;
		if (statExt) statExt.textContent = `¥${totalAssetSummary.total_investment_assets.toLocaleString()}`;
		if (statLiab) statLiab.textContent = `¥${totalAssetSummary.total_liabilities.toLocaleString()}`;

		// Render External Assets breakdown list if element exists
		const extList = document.getElementById('summary-external-assets-list');
		if (extList) {
			this.renderExternalAssetsBreakdown(snapshot?.external_assets || []);
		}

		// Render Internal Account balances list
		await this.renderAccountBalances(summary);

		// Branch on view target: Cashflow vs Budget vs Assets
		const cashflowGrid = document.getElementById('cashflow-stat-grid');
		const budgetGrid = document.getElementById('budget-stat-grid');
		const catCard = document.getElementById('card-category-breakdown');
		const budgetCatCard = document.getElementById('card-budget-category-progress');
		const chartTitle = document.getElementById('chart-title');
		const tableTitle = document.getElementById('table-title');

		if (this.coordinator.analyticsTarget === 'budget') {
			if (cashflowGrid) cashflowGrid.style.display = 'none';
			if (budgetGrid) budgetGrid.style.display = 'grid';
			if (catCard) catCard.style.display = 'none';
			if (budgetCatCard) budgetCatCard.style.display = 'block';
			if (chartTitle) chartTitle.textContent = `${this.coordinator.selectedYear}年 年間予算・貯蓄目標の進捗推移`;
			if (tableTitle) tableTitle.textContent = `${this.coordinator.selectedYear}年 月別予算消化・貯蓄実績一覧`;
			this.renderBudgetAnalytics(transactions, snapshot, config);
		} else if (this.coordinator.analyticsTarget === 'cashflow') {
			if (budgetGrid) budgetGrid.style.display = 'none';
			if (budgetCatCard) budgetCatCard.style.display = 'none';
			if (cashflowGrid) cashflowGrid.style.display = 'grid';
			if (catCard) catCard.style.display = 'block';

			if (this.coordinator.analyticsGranularity === 'daily') {
				if (chartTitle) chartTitle.textContent = `${this.coordinator.currentMonth} 日別収支推移・内訳`;
				if (tableTitle) tableTitle.textContent = `${this.coordinator.currentMonth} 日別集計表`;
				this.renderDailyAnalytics(transactions, summary);
			} else if (this.coordinator.analyticsGranularity === 'monthly') {
				if (chartTitle) chartTitle.textContent = `${this.coordinator.selectedYear}年 月別収支推移・内訳`;
				if (tableTitle) tableTitle.textContent = `${this.coordinator.selectedYear}年 月別集計表`;
				this.renderMonthlyAnalytics(transactions, snapshot);
			} else {
				if (chartTitle) chartTitle.textContent = '年別収支推移・貯蓄率推移';
				if (tableTitle) tableTitle.textContent = '年次推移集計表';
				this.renderYearlyAnalytics(transactions, snapshot);
			}
		} else {
			// Assets Target
			if (budgetGrid) budgetGrid.style.display = 'none';
			if (budgetCatCard) budgetCatCard.style.display = 'none';
			if (cashflowGrid) cashflowGrid.style.display = 'none';
			if (catCard) catCard.style.display = 'none';
			if (chartTitle) chartTitle.textContent = '資産構成比・内部口座/外部資産内訳';
			if (tableTitle) tableTitle.textContent = '資産種別・口座別残高一覧';
			this.renderAssetsAnalytics(totalAssetSummary, config, snapshot?.external_assets || []);
		}

		// Render Transactions List for current month
		await this.coordinator.txListController.renderMonthTransactions();
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
						<span class="tx-title">${a.name}</span>
						<span class="tx-meta">更新日: ${(a.updated_at || '-').slice(0, 10)}</span>
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
								<tr>
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
			}
		}

		// Category breakdown list
		this.renderCategoryBreakdownList(this.coordinator.useActualCategoryAxis ? summary.by_actual_category : summary.by_category);

		// Chart
		this.chartController.renderChartForDaily(dailyData);
	}

	renderMonthlyAnalytics(transactions, snapshot) {
		const monthlyData = aggregateMonthlySummaries(transactions, this.coordinator.selectedYear, snapshot?.monthly_summaries || {});

		// Update cashflow stat cards
		const statInc = document.getElementById('stat-income');
		const statExp = document.getElementById('stat-expense');
		const statNet = document.getElementById('stat-net-income');
		const statBal = document.getElementById('stat-confirmed-balance');
		const lblInc = document.getElementById('label-stat-income');
		const lblExp = document.getElementById('label-stat-expense');
		const lblNet = document.getElementById('label-stat-net');
		const lblBal = document.getElementById('label-stat-savings-rate');

		if (lblInc) lblInc.textContent = `${this.coordinator.selectedYear}年 年間収入`;
		if (statInc) statInc.textContent = `¥${monthlyData.total_income.toLocaleString()}`;
		if (lblExp) lblExp.textContent = `${this.coordinator.selectedYear}年 年間支出`;
		if (statExp) statExp.textContent = `¥${monthlyData.total_expense.toLocaleString()}`;
		if (lblNet) lblNet.textContent = `${this.coordinator.selectedYear}年 年間収支差額`;
		if (statNet) statNet.textContent = `¥${monthlyData.total_net.toLocaleString()}`;
		const rate = monthlyData.total_income > 0 ? Math.round((monthlyData.total_net / monthlyData.total_income) * 1000) / 10 : 0;
		if (lblBal) lblBal.textContent = '年間貯蓄率';
		if (statBal) statBal.textContent = `${rate}%`;

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
							return `
								<tr>
									<td><strong>${m.month}</strong></td>
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

		// Category breakdown list
		const combinedCats = {};
		for (const m of Object.values(monthlyData.months)) {
			const src = this.coordinator.useActualCategoryAxis ? m.by_actual_category : m.by_category;
			if (src) {
				for (const [k, v] of Object.entries(src)) {
					const val = typeof v === 'number' ? v : (v.total || 0);
					combinedCats[k] = (combinedCats[k] || 0) + val;
				}
			}
		}
		const catObj = {};
		for (const [k, v] of Object.entries(combinedCats)) {
			catObj[k] = { total: v, total_confirmed: v, total_planned: 0 };
		}
		this.renderCategoryBreakdownList(catObj);

		// Chart
		this.chartController.renderChartForMonthly(monthlyData);
	}

	renderYearlyAnalytics(transactions, snapshot) {
		const yearlyData = aggregateYearlySummaries(transactions, snapshot?.monthly_summaries || {});

		let totalInc = 0;
		let totalExp = 0;
		for (const y of Object.values(yearlyData)) {
			totalInc += y.income;
			totalExp += y.expense;
		}
		const totalNet = totalInc - totalExp;
		const avgRate = totalInc > 0 ? Math.round((totalNet / totalInc) * 1000) / 10 : 0;

		const statInc = document.getElementById('stat-income');
		const statExp = document.getElementById('stat-expense');
		const statNet = document.getElementById('stat-net-income');
		const statBal = document.getElementById('stat-confirmed-balance');
		const lblInc = document.getElementById('label-stat-income');
		const lblExp = document.getElementById('label-stat-expense');
		const lblNet = document.getElementById('label-stat-net');
		const lblBal = document.getElementById('label-stat-savings-rate');

		if (lblInc) lblInc.textContent = '全期間 累計収入';
		if (statInc) statInc.textContent = `¥${totalInc.toLocaleString()}`;
		if (lblExp) lblExp.textContent = '全期間 累計支出';
		if (statExp) statExp.textContent = `¥${totalExp.toLocaleString()}`;
		if (lblNet) lblNet.textContent = '全期間 累計純貯蓄';
		if (statNet) statNet.textContent = `¥${totalNet.toLocaleString()}`;
		if (lblBal) lblBal.textContent = '平均貯蓄率';
		if (statBal) statBal.textContent = `${avgRate}%`;

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

		// Category breakdown list
		const combinedCats = {};
		for (const y of Object.values(yearlyData)) {
			const src = this.coordinator.useActualCategoryAxis ? y.by_actual_category : y.by_category;
			if (src) {
				for (const [k, v] of Object.entries(src)) {
					const val = typeof v === 'number' ? v : (v.total || 0);
					combinedCats[k] = (combinedCats[k] || 0) + val;
				}
			}
		}
		const catObj = {};
		for (const [k, v] of Object.entries(combinedCats)) {
			catObj[k] = { total: v, total_confirmed: v, total_planned: 0 };
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
			const categories = (config?.categories || []).filter(c => !c.type || c.type === 'expense');
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
								const catName = catObj ? `${catObj.icon || '🏷️'} ${escapeHtml(catObj.name)}` : escapeHtml(catId);
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
		const investmentTypes = new Set(['investment', 'asset', 'stock', 'mutual_fund', 'crypto']);

		const liquidAccounts = accounts.filter(a => !a.is_archived && a.type !== 'credit_card' && !investmentTypes.has(a.type));
		const investmentAccounts = accounts.filter(a => !a.is_archived && investmentTypes.has(a.type));

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
					<tr style="background: #f8fafc; font-weight: 700;">
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
					<tr style="background: #f8fafc; font-weight: 700;">
						<td colspan="4">投資資産 (証券・投信・NISA等)</td>
					</tr>
					${investmentAccounts.map(a => {
						const bal = totalAssetSummary.confirmed_balances?.[a.id] || 0;
						const pct = Math.round((Math.max(0, bal) / Math.max(1, totalNet)) * 1000) / 10;
						return `
							<tr>
								<td>${escapeHtml(a.name)}</td>
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
					<tr style="background: #f8fafc; font-weight: 700;">
						<td colspan="4">負債・立替金等</td>
					</tr>
					<tr>
						<td>クレジットカード・未払枠</td>
						<td>負債 (credit_card)</td>
						<td style="font-weight: 600; color: var(--danger);">-¥${totalAssetSummary.liabilities.toLocaleString()}</td>
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
			list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">内訳データはありません</div>';
			return;
		}

		const totalExpense = entries.reduce((sum, [, data]) => sum + (data.total || 0), 0);

		list.innerHTML = entries
			.sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
			.map(([catId, data]) => {
				const amt = data.total || 0;
				const pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 1000) / 10 : 0;
				const catName = catMap.get(catId) || catId;
				return `
					<div class="tx-item">
						<div class="tx-info">
							<span class="tx-title">${escapeHtml(catName)}</span>
							<span class="tx-meta">構成比: ${pct}%</span>
						</div>
						<div style="text-align: right; font-weight: 700; color: var(--primary);">
							¥${amt.toLocaleString()}
						</div>
					</div>
				`;
			}).join('');
	}

	async renderAccountBalances(summary) {
		const list = document.getElementById('account-balances-list');
		if (!list) return;
		const config = await this.db.getMasterConfig();
		const accounts = config?.accounts || [];

		list.innerHTML = accounts.map(acc => {
			const conf = summary.confirmed_balances[acc.id] || 0;
			const proj = summary.projected_balances[acc.id] || 0;
			return `
				<div class="tx-item">
					<div class="tx-info">
						<span class="tx-title">${escapeHtml(acc.name)}</span>
						<span class="tx-meta">${escapeHtml(acc.type)}</span>
					</div>
					<div style="text-align: right;">
						<div style="font-weight: 700; color: var(--primary);">¥${conf.toLocaleString()}</div>
						<div style="font-size: 0.8rem; color: var(--text-muted);">予測: ¥${proj.toLocaleString()}</div>
					</div>
				</div>
			`;
		}).join('');
	}
}

