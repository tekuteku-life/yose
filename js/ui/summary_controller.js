/**
 * Yoseatsume Kakeibo - Summary & Analytics Controller
 * Manages Summary dashboard, KPI cards, multi-granularity analytics, quick month picker, and recurring generation.
 */

import {
	addMonthsToMonthStr,
	calculateBalancesAndSummaries,
	calculateTotalAssetSummary,
	aggregateDailySummaries,
	aggregateMonthlySummaries,
	aggregateYearlySummaries,
	calculateAnnualBudgetProgress,
	resolveAnnualTargets,
	generateAnnualTrajectory,
	calculateTagSummary,
	calculateCrossAccrualActualSummary,
	escapeHtml
} from '../logic.js';
import { buildAssetHistory, formatDate } from '../logic.js';
import { applyInvestmentValuations } from '../logic/investment.js';
import { buildCategoryTrend } from '../logic/category_trend.js';
import { captureRenderSession, readInRenderSession } from './render_session.js';

export class SummaryController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.tagSearchQuery = '';
		this.categoryType = 'expense';
		this.incomeBreakdown = [];
		this.lastTransactions = null;
		this.assetPeriod = 'month';
		this.renderVersion = 0;
		this.closingMonths = false; this.closingAuthGeneration = null;
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
		this.coordinator.txListController.calendarMonthFilter = null;
		const day = Number(this.coordinator.selectedDate.slice(8, 10));
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
		document.getElementById('select-asset-period').addEventListener('change', event => {
			this.assetPeriod = event.target.value;
			document.getElementById('asset-custom-period').style.display = this.assetPeriod === 'range' ? 'flex' : 'none';
			this.renderAssetHistory();
		});
		document.getElementById('btn-apply-asset-period').addEventListener('click', () => this.renderAssetHistory());
		// Granularity toggle: Daily vs Monthly vs Yearly
		document.querySelectorAll('#control-granularity .segment-btn').forEach(btn => {
			btn.addEventListener('click', () => {
				document.querySelectorAll('#control-granularity .segment-btn').forEach(b => b.classList.remove('active'));
				btn.classList.add('active');
				this.coordinator.txListController.calendarMonthFilter = null;
				this.coordinator.analyticsGranularity = btn.dataset.granularity;
				{
					this.coordinator.txListController.currentPage = 1;
				}
				this.renderSummary();
			});
		});

		// Period Navigator (Requirement 3.16 & 3.36)
		document.getElementById('btn-period-prev').addEventListener('click', () => {
			if (this.usesYearNavigation()) {
				this.coordinator.selectedYear = String(Number(this.coordinator.selectedYear) - 1);
				this.setSelectedMonth(`${this.coordinator.selectedYear}-${this.coordinator.currentMonth.slice(5, 7)}`);
			} else {
				// daily and monthly both shift by 1 month and update selectedYear
				this.setSelectedMonth(addMonthsToMonthStr(this.coordinator.currentMonth, -1));
			}
			this.renderSummary();
		});

		document.getElementById('btn-period-next').addEventListener('click', () => {
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
		periodDisplay.addEventListener('click', () => {
			{
				periodPicker.value = this.coordinator.currentMonth;
				if (typeof periodPicker.showPicker === 'function') {
					periodPicker.showPicker();
				} else {
					periodPicker.focus();
					periodPicker.click();
				}
			}
		});

		periodPicker.addEventListener('change', (e) => {
			const val = e.target.value;
			if (val && /^\d{4}-\d{2}$/.test(val)) {
				this.setSelectedMonth(val);
				this.renderSummary();
			}
		});

		const btnPlanned = document.getElementById('btn-toggle-planned');
		btnPlanned.addEventListener('click', () => {
			this.coordinator.showPlanned = !this.coordinator.showPlanned;
			btnPlanned.textContent = `予定: ${this.coordinator.showPlanned ? 'ON' : 'OFF'}`;
			this.renderSummary();
		});

		document.getElementById('category-trend-type').addEventListener('change', event => { this.categoryType = event.target.value; void this.renderSummary(); });
		document.getElementById('select-type-filter').addEventListener('change', () => { this.coordinator.txListController.currentPage = 1; void this.coordinator.txListController.renderMonthTransactions(); });
		const btnAxis = document.getElementById('btn-toggle-axis');
		btnAxis.addEventListener('click', () => {
			this.coordinator.useActualCategoryAxis = !this.coordinator.useActualCategoryAxis;
			btnAxis.textContent = this.coordinator.useActualCategoryAxis ? '📦 実態分類ベース' : '🏷️ 計上分類ベース';
			this.renderSummary();
		});

		document.getElementById('select-status-filter').addEventListener('change', () => {
			this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		document.getElementById('select-account-filter').addEventListener('change', () => {
			this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		document.getElementById('select-category-filter').addEventListener('change', () => {
			this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		document.getElementById('select-tag-filter').addEventListener('change', () => {
			this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		document.getElementById('input-tx-search').addEventListener('input', () => {
			this.coordinator.txListController.currentPage = 1;
			this.coordinator.txListController.renderMonthTransactions();
		});

		// Recurring generation button
		document.getElementById('btn-generate-recurring').addEventListener('click', async () => {
			await this.handleGenerateRecurring();
		});

		// Month close button
		document.getElementById('btn-close-month').addEventListener('click', async () => {
			await this.handleCloseMonth();
		});

		// Tag search filter listener (Requirement 3.18)
		document.getElementById('input-tag-search').addEventListener('input', (e) => {
			this.tagSearchQuery = (e.target.value || '').trim();
			if (this.lastTransactions) {
				this.renderTagAnalytics(this.lastTransactions);
			}
		});
	}

	async handleGenerateRecurring() {
		if (this.generatingRecurring || this.coordinator.isKeyLocked) return;
		const operation = this.recurringOperation = (this.recurringOperation || 0) + 1;
		const valid = captureRenderSession(this.coordinator, () => operation === this.recurringOperation);
		this.generatingRecurring = true;
		const button = document.getElementById('btn-generate-recurring');
		button.disabled = true;
		try { await this.generateRecurring(valid); }
		catch (error) { if (valid()) alert(`定期予定の生成に失敗しました: ${error.message}`); }
		finally { if (operation === this.recurringOperation) { this.generatingRecurring = false; button.disabled = false; } }
	}

	cancelRecurring() {
		this.recurringOperation = (this.recurringOperation || 0) + 1;
		this.generatingRecurring = false;
		const button = document.getElementById('btn-generate-recurring');
		button.disabled = false;
	}

	async generateRecurring(isSessionValid = null) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid()) return;
		const targetMonth = this.coordinator.currentMonth;
		const config = await this.db.getMasterConfig();
		if (!valid()) return;
		const { generated, skipped_count } = await this.db.generateRecurringForMonth(targetMonth, config, { isSessionValid: valid });
		if (!valid()) return;
		if (generated.length === 0) {
			alert(`${targetMonth} の定期予定はすでに生成または入力済みであるか、対象ルールがありません。\n入力済みのため除外 ${skipped_count} 件`);
			return;
		}
		try { await this.coordinator.refreshAfterTransactionChange({ isSessionValid: valid }); }
		catch (error) {
			if (valid()) alert(`定期予定 ${generated.length} 件は保存済みです。\n入力済みのため除外 ${skipped_count} 件\n表示の更新に失敗しました: ${error.message}`);
			return;
		}
		if (valid()) alert(`${generated.length} 件の定期予定（planned）を生成しました。\n入力済みのため除外 ${skipped_count} 件`);
	}

	async handleCloseMonth() {
		const btn = document.getElementById('btn-close-month');
		if (this.closingMonths || btn.disabled || this.coordinator.isKeyLocked) return;
		this.closingMonths = true;
		btn.disabled = true;
		const annual = this.coordinator.analyticsGranularity === 'yearly';
		const year = this.coordinator.selectedYear;
		const months = annual ? Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`) : [this.coordinator.currentMonth];
		const completed = [];
		let submitted = false;
		let current = months[0];
		const authGeneration = this.coordinator.authController.authGeneration;
		this.closingAuthGeneration = authGeneration;
		const valid = captureRenderSession(this.coordinator);
		const assertSession = () => {
			if (!valid()) throw new Error('認証状態が変更されました。ロックを解除して再実行してください。');
		};
		try {
			const plans = [];
			for (const month of months) {
				current = month;
				const records = await this.db.getTransactions({ target_month: month });
				assertSession();
				if (records.some(tx => tx.amount_pending)) { alert(`${month}: 金額未入力の予定があります。金額を入力してから月締めしてください。`); return; }
				plans.push(records.filter(tx => tx.status === 'planned'));
			}
			if (annual) {
				const count = plans.reduce((sum, planned) => sum + planned.length, 0);
				const future = months.at(-1) > formatDate(new Date()).slice(0, 7) ? '\n未来の月も対象です。締めた月には定期予定を生成できなくなります。' : '';
				if (!confirm(`${year}年の12か月（${months[0]}〜${months.at(-1)}）を1月から順に月締めします。\n手元の未確定の予定 ${count} 件を確定します。締め済みの月は再締めします。${future}\n途中で失敗した場合、完了済みの月締めは保持されます。実行しますか？`)) return;
			} else if (plans[0].length && !confirm(`${months[0]} には未確定の予定が ${plans[0].length} 件あります。内容を確認して確定・月締めしますか？`)) return;
			for (const [index, month] of months.entries()) {
				current = month; assertSession();
				if (annual) btn.textContent = `🔒 ${month} を月締め中（${index + 1}/12）`;
				submitted = true;
				await this.syncManager.closeMonth(month, { approvedPlanned: plans[index] });
				if (!valid()) return;
				completed.push(month);
			}
			alert(annual ? `${year}年の12か月の月締めが完了しました。アーカイブが保存されました。` : `${months[0]} の月締めが正常に完了しました！アーカイブが保存されました。`);
		} catch (error) {
			if (valid()) alert(annual ? `年の一括月締めに失敗しました。\n完了済み: ${completed.join('、') || 'なし'}\n停止した月: ${current}\n${error.message}\n停止した月のサーバー反映状況を同期で確認してから再実行してください。` : `月締めに失敗しました: ${error.message}`);
		} finally {
			if (submitted && valid()) {
				try { await this.coordinator.refreshAllViews({ generateSettlements: false, isSessionValid: valid }); }
				catch (error) { if (valid()) alert(`月締めの処理結果は変更されませんが、表示更新に失敗しました。再表示してください: ${error.message}`); }
			}
			if (valid() && this.closingAuthGeneration === authGeneration) {
				this.closingMonths = false; this.closingAuthGeneration = null;
				btn.disabled = false;
				this.renderClosingAction();
			}
		}
	}

	cancelClosing() {
		this.closingMonths = false; this.closingAuthGeneration = null;
		const btn = document.getElementById('btn-close-month');
		btn.disabled = false;
		this.renderClosingAction();
	}

	renderClosingAction() {
		if (this.closingMonths) return;
		const annual = this.coordinator.analyticsGranularity === 'yearly';
		document.getElementById('monthly-operations-title').textContent = annual ? '年次アクション' : '月次アクション';
		document.getElementById('btn-close-month').textContent = annual ? `🔒 ${this.coordinator.selectedYear}年を一括月締めする (GASへ送信)` : '🔒 この月を月締めする (GASへ送信)';
		document.getElementById('closing-scope-notice').textContent = annual ? `${this.coordinator.selectedYear}年の1〜12月が対象です。定期予定の生成は選択月のみが対象です。` : `${this.coordinator.currentMonth} が月締め・定期予定生成の対象です。`;
	}

	async renderSummary({ isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid()) return;
		const renderId = ++this.renderVersion;
		const target = this.coordinator.analyticsTarget;
		const granularity = this.coordinator.analyticsGranularity;
		this.renderClosingAction();

		const periodDisplay = document.getElementById('period-display');
		{
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

		const assetState = await readInRenderSession(valid, () => this.db.getAnalyticsState());
		if (!valid() || !assetState || renderId !== this.renderVersion) return;
		const snapshot = assetState.summary_snapshot;
		const config = { ...assetState.master_config, accounts: assetState.master_config.accounts || [] };
		const transactions = assetState.transactions.filter(tx => !tx.is_deleted);

		const summary = calculateBalancesAndSummaries(snapshot, target === 'assets' ? transactions.filter(tx => tx.status !== 'confirmed' || tx.date <= formatDate(new Date())) : transactions, this.coordinator.currentMonth);
		if (target === 'assets') {
			const valued = applyInvestmentValuations(summary.confirmed_balances, config.accounts, transactions, formatDate(new Date()), snapshot, assetState.historyOptions);
			for (const account of config.accounts.filter(a => a.type === 'investment')) {
				summary.projected_balances[account.id] = (summary.projected_balances[account.id] || 0) + (valued[account.id] || 0) - (summary.confirmed_balances[account.id] || 0);
			}
			summary.confirmed_balances = valued;
		}
		const totalAssetSummary = calculateTotalAssetSummary(
			summary.confirmed_balances,
			config.accounts,
			snapshot?.external_assets || []
		);

		// Top KPI card grids: exclusive visibility per tab
		const assetStatGrid = document.getElementById('asset-stat-grid');
		const cashflowGrid = document.getElementById('cashflow-stat-grid');
		const budgetGrid = document.getElementById('budget-stat-grid');

		assetStatGrid.style.display = target === 'assets' ? 'grid' : 'none';
		cashflowGrid.style.display = target === 'cashflow' ? 'grid' : 'none';
		budgetGrid.style.display = target === 'budget' ? 'grid' : 'none';

		// Update asset KPI cards when target === 'assets'
		if (target === 'assets') {
			const statTotal = document.getElementById('stat-total-assets');
			const statLiquid = document.getElementById('stat-liquid-assets');
			const statExt = document.getElementById('stat-external-assets');
			const statLiab = document.getElementById('stat-liabilities');

			statTotal.textContent = `¥${totalAssetSummary.total_net_assets.toLocaleString()}`;
			statLiquid.textContent = `¥${totalAssetSummary.total_liquid_assets.toLocaleString()}`;
			statExt.textContent = `¥${totalAssetSummary.total_investment_assets.toLocaleString()}`;
			statLiab.textContent = `¥${totalAssetSummary.total_liabilities.toLocaleString()}`;
		}

		// Cards visibility
		const historyCard = document.getElementById('asset-history-card');
		historyCard.style.display = target === 'assets' ? 'block' : 'none';
		document.getElementById('investment-record-card').style.display = target === 'assets' ? 'block' : 'none';
		document.getElementById('furusato-card').style.display = 'none';
		if (target === 'budget') await this.coordinator.furusatoController.render(assetState, { isSessionValid: valid });
		if (target === 'assets') { this.coordinator.insightsController.renderInvestment(config); await this.renderAssetHistory(assetState, { isSessionValid: valid }); }
		if (!valid() || renderId !== this.renderVersion) return;
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
		monthlyOpsCard.style.display = target === 'cashflow' ? 'block' : 'none';

		// Granularity selector (daily/monthly/yearly) is relevant for cashflow
		granularityRow.style.display = target === 'cashflow' ? 'flex' : 'none';

		// Tag and Cross matrix cards are primarily for cashflow
		tagCard.style.display = target === 'cashflow' ? 'block' : 'none';
		crossCard.style.display = target === 'cashflow' ? 'block' : 'none';
		monthTxListCard.style.display = target === 'cashflow' ? 'block' : 'none';

		if (target === 'budget') {
			catCard.style.display = 'none';
			budgetCatCard.style.display = 'block';
			chartTitle.textContent = `${this.coordinator.selectedYear}年 年間予算・貯蓄目標の進捗推移`;
			tableTitle.textContent = `${this.coordinator.selectedYear}年 月別予算消化・貯蓄実績一覧`;
			accountBalancesTitle.textContent = '口座別予算・実績';
			this.renderBudgetAnalytics(transactions, snapshot, config);
		} else if (target === 'cashflow') {
			budgetCatCard.style.display = 'none';
			catCard.style.display = 'block';
			accountBalancesTitle.textContent = '口座別支出（収支）';
			const type = this.categoryType, typeName = type === 'income' ? '収入' : '支出';
			const scope = document.getElementById('category-trend-scope');
			scope.textContent = granularity === 'daily' ? `${this.coordinator.currentMonth}の取得済み明細を取引日で集計します。未取得の日別明細は含みません。` : `計上月と保存済み月次集計に基づく取得済み範囲の${typeName}推移です。`;
			const title = document.getElementById('category-trend-title');
			title.textContent = `${granularity === 'daily' ? this.coordinator.currentMonth + ' 取引日別' : granularity === 'monthly' ? this.coordinator.selectedYear + '年 月別' : '年別'} 費目ごとの${typeName}推移（${this.coordinator.useActualCategoryAxis ? '実態分類' : '計上分類'}）`;
			document.getElementById('category-trend-chart').setAttribute('aria-label', `費目ごとの${typeName}推移`);
			const options = { type, granularity, month: this.coordinator.currentMonth, year: this.coordinator.selectedYear, actualAxis: this.coordinator.useActualCategoryAxis, includePlanned: this.coordinator.showPlanned, historyOptions: assetState.historyOptions };
			const trend = buildCategoryTrend(transactions, snapshot, config, options);
			this.chartController.renderCategoryTrend({ ...trend, type });
			const breakdownTrend = type === 'income' && granularity === 'yearly' ? buildCategoryTrend(transactions, snapshot, config, { ...options, granularity: 'monthly' }) : trend;
			this.incomeBreakdown = breakdownTrend.series.map(row => ({ id: row.id, name: row.name, amount: row.values.reduce((sum, value, index) => sum + (granularity !== 'monthly' || breakdownTrend.labels[index] === this.coordinator.currentMonth ? value : 0), 0) }));


			if (granularity === 'daily') {
				chartTitle.textContent = `${this.coordinator.currentMonth} 日別収支推移・内訳`;
				tableTitle.textContent = `${this.coordinator.currentMonth} 日別集計表`;
				this.renderDailyAnalytics(transactions, summary, config, renderId);
			} else if (granularity === 'monthly') {
				chartTitle.textContent = `${this.coordinator.selectedYear}年 月別収支推移 (当月: ${this.coordinator.currentMonth})`;
				tableTitle.textContent = `${this.coordinator.selectedYear}年 月別集計表`;
				this.renderMonthlyAnalytics(transactions, snapshot, summary, config, renderId);
			} else {
				chartTitle.textContent = `${this.coordinator.selectedYear}年 年別収支推移・貯蓄率推移`;
				tableTitle.textContent = '年次推移集計表';
				this.renderYearlyAnalytics(transactions, snapshot, config, renderId);
			}
		} else {
			// Assets Target
			budgetCatCard.style.display = 'none';
			catCard.style.display = 'none';
			chartTitle.textContent = '資産構成比・内部口座/外部資産内訳';
			tableTitle.textContent = '資産種別・口座別残高一覧';
			accountBalancesTitle.textContent = '口座別残高';
			this.renderAssetsAnalytics(totalAssetSummary, config, snapshot?.external_assets || []);
		}

		// Render Account Balances / Expenses / Budget Breakdown
		await this.renderAccountBalances(summary, transactions, config, { isSessionValid: valid });
		if (!valid() || renderId !== this.renderVersion) return;

		// Render Tag Analytics & Breakdown (when in cashflow)
		if (target === 'cashflow') {
			this.lastTransactions = transactions;
			this.renderTagAnalytics(transactions);
			this.renderCrossMatrix(transactions, config);
			await this.coordinator.txListController.renderMonthTransactions({ isSessionValid: valid });
		}
	}

	async renderAssetHistory(assetState = null, { isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid()) return;
		const generation = this.assetHistoryGeneration = (this.assetHistoryGeneration || 0) + 1;
		try {
			const today = formatDate(new Date());
			const start = document.getElementById('asset-period-start'), end = document.getElementById('asset-period-end');
			if (!start.value) start.value = this.coordinator.currentMonth + '-01';
			if (!end.value) end.value = today;
			const state = assetState || await this.db.getAnalyticsState();
			const { summary_snapshot: snapshot, transactions, master_config: config, historyOptions } = state;
			if (!valid() || generation !== this.assetHistoryGeneration) return;
			const history = buildAssetHistory(snapshot, transactions, config.accounts, {
				mode: this.assetPeriod, month: this.coordinator.currentMonth, year: this.coordinator.selectedYear, start: start.value, end: end.value, today,
				...historyOptions, investmentAccountId: document.getElementById('asset-investment-account').value
			});
			this.chartController.renderAssetHistory(history);
			document.getElementById('asset-history-notice').textContent = history.notice + (history.points.some(point => point.investment_acquisition_cost === null) ? ' 保有商品の取得原価が未記録の期間・口座があります。取得原価を記録してください。' : '');
			document.getElementById('asset-history-card').dataset.period = this.assetPeriod;
		} catch (error) { if (valid() && generation === this.assetHistoryGeneration) alert(error.message); }
	}

	async applyDrilldownFilter({ accountId = 'all', categoryId = 'all', tag = 'all', type = 'all' } = {}) {
		const valid = captureRenderSession(this.coordinator);
		if (!valid()) return;
		if (this.coordinator.analyticsTarget !== 'cashflow') {
			this.coordinator.analyticsTarget = 'cashflow';
			const tabBtns = document.querySelectorAll('.tab-btn');
			tabBtns.forEach(b => {
				b.classList.toggle('active', b.dataset.analyticsTarget === 'cashflow' || b.dataset.tab === 'tab-cashflow');
			});
			await this.renderSummary({ isSessionValid: valid });
			if (!valid()) return;
		}

		this.coordinator.txListController.currentPage = 1;
		const statusSelect = document.getElementById('select-status-filter');
		const accSelect = document.getElementById('select-account-filter');
		const catSelect = document.getElementById('select-category-filter');
		const tagSelect = document.getElementById('select-tag-filter');
		const searchInput = document.getElementById('input-tx-search');

		document.getElementById('select-type-filter').value = type;
		this.coordinator.txListController.calendarMonthFilter = type === 'income' && this.coordinator.analyticsGranularity === 'daily' ? this.coordinator.currentMonth : null;
		statusSelect.value = 'all';
		searchInput.value = '';

		await this.coordinator.txListController.renderMonthTransactions({ isSessionValid: valid });
		if (!valid()) return;

		accSelect.value = accountId;
		catSelect.value = categoryId;
		tagSelect.value = tag;

		await this.coordinator.txListController.renderMonthTransactions({ isSessionValid: valid });
		if (!valid()) return;

		const txCard = document.getElementById('card-month-tx-list');
		{
			await this.coordinator.setPaneCollapsed('card-month-tx-list', false, { isSessionValid: valid });
			if (!valid()) return;
			if (typeof txCard.scrollIntoView === 'function') {
				txCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
			}
		}
	}

	periodTransactions(transactions) {
		const annual = this.coordinator.analyticsTarget === 'budget' || this.coordinator.analyticsGranularity === 'yearly';
		return transactions.filter(tx => {
			const period = tx.target_month || tx.date || '';
			return annual ? period.startsWith(this.coordinator.selectedYear) : period.slice(0, 7) === this.coordinator.currentMonth;
		});
	}

	renderTagAnalytics(transactions) {
		const list = document.getElementById('tag-breakdown-list');


		const relevantTxs = this.periodTransactions(transactions);

		const tagSummary = calculateTagSummary(relevantTxs, {
			searchQuery: this.tagSearchQuery || '',
			filterTag: this.tagSearchQuery || ''
		});

		const tagsList = tagSummary.tagList;

		if (tagsList.length === 0) {
			list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">該当するタグの取引はありません</div>';
		} else {
			list.innerHTML = tagsList.map(t => {
				const tagName = t.tag;
				const expenseAmt = t.expense;
				const incomeAmt = t.income;
				const netAmt = t.net;
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


		const relevantTxs = this.periodTransactions(transactions);

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



	renderDailyAnalytics(transactions, summary, config = null, renderId = this.renderVersion) {
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

		lblInc.textContent = '当月収入 (確定/予定込)';
		statInc.textContent = `¥${summary.income_confirmed.toLocaleString()} / ¥${summary.income_total.toLocaleString()}`;
		lblExp.textContent = '当月支出 (確定/予定込)';
		statExp.textContent = `¥${summary.expense_confirmed.toLocaleString()} / ¥${summary.expense_total.toLocaleString()}`;
		lblNet.textContent = '当月収支差額 (貯蓄)';
		statNet.textContent = `¥${(summary.income_total - summary.expense_total).toLocaleString()}`;
		lblBal.textContent = '現在確定残高 / 予測';
		const totalConf = Object.values(summary.confirmed_balances).reduce((a, b) => a + b, 0);
		const totalProj = Object.values(summary.projected_balances).reduce((a, b) => a + b, 0);
		statBal.textContent = `¥${totalConf.toLocaleString()} / ¥${totalProj.toLocaleString()}`;

		// Table
		const tableContainer = document.getElementById('breakdown-table-container');
		{
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
						this.coordinator.selectedDate = row.dataset.date;
						tableContainer.querySelectorAll('.clickable-row').forEach(r => r.classList.remove('active'));
						row.classList.add('active');
						this.coordinator.txListController.currentPage = 1;
						this.coordinator.txListController.renderMonthTransactions();
					});
				});
			}
		}

		// Category breakdown list
		this.renderCategoryBreakdownList(this.coordinator.useActualCategoryAxis ? summary.by_actual_category : summary.by_category, config, renderId);

		// Chart
		this.chartController.renderChartForDaily(dailyData);
	}

	renderMonthlyAnalytics(transactions, snapshot, summary, config = null, renderId = this.renderVersion) {
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
			lblInc.textContent = `当月収入 (${this.coordinator.currentMonth})`;
			statInc.textContent = `¥${summary.income_confirmed.toLocaleString()} / ¥${summary.income_total.toLocaleString()}`;
			lblExp.textContent = `当月支出 (${this.coordinator.currentMonth})`;
			statExp.textContent = `¥${summary.expense_confirmed.toLocaleString()} / ¥${summary.expense_total.toLocaleString()}`;
			lblNet.textContent = `当月収支差額 (貯蓄)`;
			statNet.textContent = `¥${(summary.income_total - summary.expense_total).toLocaleString()}`;
			lblBal.textContent = `年間貯蓄率 (${this.coordinator.selectedYear}年)`;
			const rate = monthlyData.total_income > 0 ? Math.round((monthlyData.total_net / monthlyData.total_income) * 1000) / 10 : 0;
			statBal.textContent = `${rate}% (確定残高: ¥${Object.values(summary.confirmed_balances).reduce((a, b) => a + b, 0).toLocaleString()})`;
		}

		// Table
		const tableContainer = document.getElementById('breakdown-table-container');
		{
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
		this.renderCategoryBreakdownList(catData, config, renderId);

		// Chart
		this.chartController.renderChartForMonthly(monthlyData);
	}

	renderYearlyAnalytics(transactions, snapshot, config = null, renderId = this.renderVersion) {
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

		lblInc.textContent = `${selectedYear}年 年間収入`;
		statInc.textContent = `¥${(targetYearData.income || 0).toLocaleString()}`;
		lblExp.textContent = `${selectedYear}年 年間支出`;
		statExp.textContent = `¥${(targetYearData.expense || 0).toLocaleString()}`;
		lblNet.textContent = `${selectedYear}年 年間純貯蓄`;
		statNet.textContent = `¥${(targetYearData.net || 0).toLocaleString()}`;
		lblBal.textContent = `${selectedYear}年 貯蓄率`;
		statBal.textContent = `${targetYearData.savings_rate || 0}%`;

		// Table
		const tableContainer = document.getElementById('breakdown-table-container');
		{
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
				const val = v;
				catObj[k] = { total: val, total_confirmed: val, total_planned: 0 };
			}
		}
		this.renderCategoryBreakdownList(catObj, config, renderId);

		// Chart
		this.chartController.renderChartForYearly(yearlyData);
	}

	renderBudgetAnalytics(transactions, snapshot, config) {
		const currentYear = this.coordinator.selectedYear;
		const budgetConfig = config?.annual_budgets?.[currentYear] || {};
		const monthlyData = aggregateMonthlySummaries(transactions, currentYear, snapshot?.monthly_summaries || {});
		const targets = resolveAnnualTargets(budgetConfig, monthlyData.total_income);
		const expenseBudget = targets.expense_budget, savingsTarget = targets.savings_target_amount, targetRate = targets.savings_target_rate;

		const money = value => value === null ? '未算出' : `¥${value.toLocaleString()}`;
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
			for (const [catId, amount] of Object.entries(m.by_category)) {
				yearlyCategoryActuals[catId] = (yearlyCategoryActuals[catId] || 0) + amount;
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
				goal_basis: budgetConfig.goal_basis,
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

		{
			statExp.textContent = `${money(expenseBudget)} / ¥${expenseActual.toLocaleString()}`;
		}
		{
			barExp.style.width = `${Math.min(100, Math.max(0, progress.expense_consumption_rate))}%`;
			if (progress.pace_status === 'over_budget') {
				barExp.style.background = 'var(--danger)';
			} else if (progress.pace_status === 'caution') {
				barExp.style.background = '#f59e0b';
			} else {
				barExp.style.background = '#3b82f6';
			}
		}
		{
			lblExpPace.textContent = targets.valid ? `消化率: ${progress.expense_consumption_rate}% (基準ペース: ${progress.expected_pace_rate}%, 残: ${money(progress.expense_remaining)})` : '目標・残額は未算出です。';
		}

		{
			statSav.textContent = `${money(savingsTarget)} / ¥${savingsActual.toLocaleString()}`;
		}
		{
			barSav.style.width = `${Math.min(100, Math.max(0, progress.savings_achievement_rate))}%`;
			barSav.style.background = progress.is_deficit ? 'var(--danger)' : '#10b981';
		}
		{
			if (!targets.valid) {
				lblSavRate.textContent = '目標・残額は未算出です。';
			} else if (progress.is_deficit) {
				lblSavRate.textContent = `達成率: 0% (年間収支赤字: ¥${Math.abs(savingsActual).toLocaleString()})`;
			} else {
				lblSavRate.textContent = `達成率: ${progress.savings_achievement_rate}% (目標残: ${money(progress.savings_remaining)})`;
			}
		}

		{
			statRate.textContent = `${targetRate === null ? '未算出' : Math.round(targetRate * 100) / 100 + '%'} / ${progress.savings_actual_rate}%`;
		}
		{
			if (targetRate === null) {
				lblRateEval.textContent = '目標貯蓄率: 未算出';
			} else if (targetRate < 0) {
				lblRateEval.textContent = '目標貯蓄率: 赤字の派生率です。';
			} else if (targetRate === 0) {
				lblRateEval.textContent = budgetConfig.goal_basis && budgetConfig.goal_basis !== 'independent' ? '目標貯蓄率: 0%' : '目標貯蓄率: 未設定';
			} else if (progress.savings_rate_achieved) {
				lblRateEval.textContent = '✅ 目標貯蓄率を達成中';
			} else {
				const diff = Math.round((targetRate - progress.savings_actual_rate) * 10) / 10;
				lblRateEval.textContent = `⏳ 目標貯蓄率まであと ${diff}%`;
			}
		}

		{
			let paceText = targets.valid ? '順調' : '未算出';
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
		{
			lblPaceDesc.textContent = !targets.valid ? '収入または目標の合計が計算範囲を超えています。' : `経過${currentMonthIndex}ヶ月時点 (標準消化ペース: ${progress.expected_pace_rate}%)${expenseBudget < 0 || savingsTarget < 0 ? '・目標に不足/赤字額があります。' : ''}`;
		}

		// Trajectory for table and chart
		const trajectory = generateAnnualTrajectory({
			year: currentYear,
			monthlySummaries: monthlyData.months,
			expenseBudget,
			savingsTarget,
			linked: budgetConfig.goal_basis && budgetConfig.goal_basis !== 'independent',
			targetsValid: targets.valid
		});

		// Table
		const tableContainer = document.getElementById('breakdown-table-container');
		{
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
									<td style="color: var(--text-muted);">${money(t.monthly_budget_allowance)}</td>
									<td style="font-weight: 600; color: ${expExceeded ? 'var(--danger)' : 'var(--text-main)'};">
										¥${t.cumulative_expense.toLocaleString()}
									</td>
									<td style="color: var(--text-muted);">${money(t.cumulative_budget_pace)}</td>
									<td style="color: ${t.monthly_savings >= 0 ? '#10b981' : 'var(--danger)'};">
										${t.monthly_savings >= 0 ? '+' : ''}¥${t.monthly_savings.toLocaleString()}
									</td>
									<td style="font-weight: 600; color: ${t.cumulative_savings >= 0 ? '#10b981' : 'var(--danger)'};">
										¥${t.cumulative_savings.toLocaleString()}
									</td>
									<td style="color: var(--text-muted); font-weight: ${savOnTrack ? '600' : 'normal'};">
										${money(t.cumulative_savings_pace)}
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
		{
			const categories = (config?.categories || []).filter(c => !c.is_archived && (!c.type || c.type === 'expense'));
			const catMap = new Map();
			for (const c of categories) {
				catMap.set(c.id, c);
			}

			const catEntries = Object.entries(progress.category_progress);
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

	async renderCategoryBreakdownList(categoriesData, config = null, renderId = this.renderVersion, { isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid()) return;
		const list = document.getElementById('category-breakdown-list');


		config = config || await this.db.getMasterConfig();
		if (!valid() || renderId !== this.renderVersion) return;
		const catMap = new Map();
		for (const c of config?.categories || []) {
			catMap.set(c.id, c.name);
			if (c.subcategories) {
				for (const s of c.subcategories) {
					catMap.set(s.id, s.name);
				}
			}
		}

		const income = this.categoryType === 'income';
		const items = income ? this.incomeBreakdown : Object.entries(categoriesData || {}).map(([id, data]) => ({ id, name: catMap.get(id) || id, amount: data.total || 0 }));
		const sorted = items.slice().sort((a, b) => b.amount - a.amount), total = sorted.reduce((sum, item) => sum + item.amount, 0);
		this.chartController.renderChartForCategoryBreakdown(sorted);
		list.innerHTML = sorted.length ? sorted.map(item => {
			const pct = total > 0 ? Math.round(item.amount / total * 1000) / 10 : 0;
			return `<div class="tx-item ${item.id === null ? '' : 'clickable'}" ${item.id === null ? 'data-income-unknown' : `data-filter-category="${escapeHtml(item.id)}"`}><div class="tx-info"><span class="tx-title">${escapeHtml(item.name)}</span><span class="tx-meta">構成比: ${pct}%${item.id === null ? '・過去月の収入内訳を取得できていません。' : ''}</span></div><div style="font-weight:700">¥${item.amount.toLocaleString()}</div></div>`;
		}).join('') : '<div>内訳データはありません</div>';
		list.querySelectorAll('[data-filter-category]').forEach(item => item.addEventListener('click', () => { void this.applyDrilldownFilter({ categoryId: item.dataset.filterCategory, type: income ? 'income' : 'all' }); }));

	}

	async renderAccountBalances(summary, transactions = [], config = null, { isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid()) return;
		const list = document.getElementById('account-balances-list');

		const cfg = config || await this.db.getMasterConfig();
		if (!valid()) return;
		const accounts = (cfg?.accounts || []).filter(a => !a.is_archived);
		const target = this.coordinator.analyticsTarget;

		if (target === 'cashflow') {
			// Filter transactions for relevant period (daily/monthly: currentMonth, yearly: selectedYear)
			const relevantTxs = this.periodTransactions(transactions).filter(tx => !tx.is_deleted);

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
				const stat = accStats[acc.id];
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
			const yearTxs = this.periodTransactions(transactions).filter(tx => !tx.is_deleted && tx.type === 'expense');
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

