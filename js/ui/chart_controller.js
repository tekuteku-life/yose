/**
 * Yoseatsume Kakeibo - Chart Visualization Controller
 * Dedicated Chart.js generator for daily, monthly, yearly, budget progress, category breakdown, tags, and assets.
 */

import { formatDoughnutTooltipLabel, escapeHtml } from '../logic.js';

export class ChartController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.chart = null;
		this.tagChart = null;
		this.categoryBreakdownChart = null;
		this.isDark = false;
		this.assetHistoryChart = null;
		this.categoryTrendChart = null;
		this.lastCategoryTrend = null;
	}

	destroy() {
		this.categoryTrendChart?.destroy(); this.categoryTrendChart = null;
		this.lastCategoryTrend = null;
		this.assetHistoryChart?.destroy(); this.assetHistoryChart = null;
		if (this.chart) {
			this.chart.destroy();
			this.chart = null;
		}
		if (this.tagChart) {
			this.tagChart.destroy();
			this.tagChart = null;
		}
		if (this.categoryBreakdownChart) {
			this.categoryBreakdownChart.destroy();
			this.categoryBreakdownChart = null;
		}
	}

	renderAssetHistory(history) {
		const canvas = document.getElementById('asset-history-chart');
		const fallback = document.getElementById('asset-history-fallback');
		if (!canvas) return;
		this.assetHistoryChart?.destroy();
		const data = { labels: history.points.map(point => point.date), datasets: [
			{ label: '純資産', data: history.points.map(point => point.net_assets), borderColor: '#2563eb' },
			{ label: '流動資産', data: history.points.map(point => point.liquid_assets), borderColor: '#10b981' },
			{ label: '投資資産（全口座）', data: history.points.map(point => point.investment_assets), borderColor: '#8b5cf6' },
			{ label: '取得原価（直近記録）', data: history.points.map(point => point.investment_acquisition_cost), borderColor: '#d97706', borderDash: [5, 3], spanGaps: false, stepped: 'before' },
			{ label: '口座評価額（預り金込・参考）', data: history.points.map(point => point.investment_valuation), borderColor: '#db2777' },
			{ label: '負債', data: history.points.map(point => point.liabilities), borderColor: '#ef4444' }
		] };
		if (window.Chart) {
			canvas.style.display = 'block'; fallback.style.display = 'none';
			this.assetHistoryChart = new window.Chart(canvas, { type: 'line', data, options: { responsive: true, maintainAspectRatio: false, animation: false } });
		} else {
			canvas.style.display = 'none'; fallback.style.display = 'block';
			fallback.innerHTML = `<table class="summary-table"><caption>資産・投資推移</caption><thead><tr><th>日付</th>${data.datasets.map(series => `<th>${escapeHtml(series.label)}</th>`).join('')}</tr></thead><tbody>${history.points.map((point, index) => `<tr><th>${escapeHtml(point.date)}</th>${data.datasets.map(series => `<td>${series.data[index] == null ? '未算出' : '¥' + series.data[index].toLocaleString()}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
		}
	}

	destroyMainChart() {
		if (this.chart) {
			this.chart.destroy();
			this.chart = null;
		}
	}

	updateThemeMode(isDark) {
		this.isDark = isDark;
		if (typeof window !== 'undefined' && window.Chart?.defaults) {
			window.Chart.defaults.color = isDark ? '#94a3b8' : '#64748b';
			window.Chart.defaults.borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
		}
		if (this.lastCategoryTrend) this.renderCategoryTrend(this.lastCategoryTrend);
	}

	renderCategoryTrend(trend) {
		this.lastCategoryTrend = trend;
		this.categoryTrendChart?.destroy(); this.categoryTrendChart = null;
		const canvas = document.getElementById('category-trend-chart');
		const container = document.getElementById('category-trend-chart-container');
		const fallback = document.getElementById('category-trend-fallback');
		if (!canvas || !container || !fallback) return;
		container.style.display = 'none'; fallback.style.display = 'block';
		if (!trend.series.length) { fallback.textContent = '対象の費目支出はありません。'; return; }
		if (window.Chart) {
			const palette = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#0891b2', '#65a30d'];
			container.style.display = 'block'; fallback.style.display = 'none';
			this.categoryTrendChart = new window.Chart(canvas, {
				type: 'line',
				data: { labels: trend.labels, datasets: trend.series.map(row => {
					let hash = 0; for (const char of row.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
					return { categoryId: row.id, label: row.name, data: row.values.slice(), borderColor: palette[hash % palette.length], fill: false, tension: 0.15 };
				}) },
				options: { responsive: true, maintainAspectRatio: false, animation: false, scales: { y: { beginAtZero: true } }, plugins: { legend: { position: 'bottom' } }, interaction: { mode: 'index', intersect: false } }
			});
		} else {
			fallback.innerHTML = `<table class="summary-table"><caption>費目ごとの支出推移</caption><thead><tr><th>期間</th>${trend.series.map(row => `<th>${escapeHtml(row.name)}</th>`).join('')}</tr></thead><tbody>${trend.labels.map((label, index) => `<tr><th>${escapeHtml(label)}</th>${trend.series.map(row => `<td>¥${escapeHtml(row.values[index].toLocaleString())}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
		}
	}

	getDoughnutTooltipOptions() {
		return {
			callbacks: {
				label: (context) => {
					const label = context.label || '';
					const value = typeof context.parsed === 'number' ? context.parsed : (Number(context.raw) || 0);
					const datasetValues = context.dataset?.data || [];
					return formatDoughnutTooltipLabel(label, value, datasetValues);
				}
			}
		};
	}

	renderChartForDaily(dailyData) {
		const canvas = document.getElementById('summary-chart');
		const fallback = document.getElementById('chart-fallback');
		if (!canvas) return;

		const days = Object.values(dailyData.days);
		const labels = days.map(d => String(d.day) + '日');
		const confirmedExp = days.map(d => d.expense_confirmed);
		const plannedExp = days.map(d => this.coordinator.showPlanned ? d.expense_planned : 0);
		const incomes = days.map(d => d.income_total);

		if (typeof window !== 'undefined' && window.Chart) {
			if (fallback) fallback.style.display = 'none';
			canvas.style.display = 'block';

			this.destroyMainChart();
			this.chart = new window.Chart(canvas, {
				type: 'bar',
				data: {
					labels,
					datasets: [
						{ label: '確定支出', data: confirmedExp, backgroundColor: '#ef4444', stack: 'exp' },
						{ label: '予定支出', data: plannedExp, backgroundColor: '#fca5a5', stack: 'exp' },
						{ label: '収入', data: incomes, backgroundColor: '#10b981' }
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					scales: { x: { stacked: true }, y: { beginAtZero: true } }
				}
			});
		} else if (fallback) {
			canvas.style.display = 'none';
			fallback.style.display = 'block';
			fallback.innerHTML = `<div>当月の日別集計データ表示中 (合計: 収入 ¥${dailyData.total_income.toLocaleString()} / 支出 ¥${dailyData.total_expense.toLocaleString()})</div>`;
		}
	}

	renderChartForMonthly(monthlyData) {
		const canvas = document.getElementById('summary-chart');
		const fallback = document.getElementById('chart-fallback');
		if (!canvas) return;

		const months = Object.values(monthlyData.months);
		const labels = months.map(m => m.month.slice(5) + '月');
		const incomes = months.map(m => m.income_total);
		const expenses = months.map(m => m.expense_total);

		if (typeof window !== 'undefined' && window.Chart) {
			if (fallback) fallback.style.display = 'none';
			canvas.style.display = 'block';

			this.destroyMainChart();
			this.chart = new window.Chart(canvas, {
				type: 'bar',
				data: {
					labels,
					datasets: [
						{ label: '収入', data: incomes, backgroundColor: '#10b981' },
						{ label: '支出', data: expenses, backgroundColor: '#ef4444' }
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					scales: { y: { beginAtZero: true } }
				}
			});
		} else if (fallback) {
			canvas.style.display = 'none';
			fallback.style.display = 'block';
			fallback.innerHTML = `<div>${monthlyData.year}年 月別収支 (年間収入: ¥${monthlyData.total_income.toLocaleString()} / 支出: ¥${monthlyData.total_expense.toLocaleString()})</div>`;
		}
	}

	renderChartForYearly(yearlyData) {
		const canvas = document.getElementById('summary-chart');
		const fallback = document.getElementById('chart-fallback');
		if (!canvas) return;

		const years = Object.values(yearlyData).sort((a, b) => a.year.localeCompare(b.year));
		const labels = years.map(y => y.year + '年');
		const incomes = years.map(y => y.income);
		const expenses = years.map(y => y.expense);

		if (typeof window !== 'undefined' && window.Chart) {
			if (fallback) fallback.style.display = 'none';
			canvas.style.display = 'block';

			this.destroyMainChart();
			this.chart = new window.Chart(canvas, {
				type: 'bar',
				data: {
					labels,
					datasets: [
						{ label: '年間収入', data: incomes, backgroundColor: '#10b981' },
						{ label: '年間支出', data: expenses, backgroundColor: '#ef4444' }
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					scales: { y: { beginAtZero: true } }
				}
			});
		} else if (fallback) {
			canvas.style.display = 'none';
			fallback.style.display = 'block';
			fallback.innerHTML = '<div>年次推移データ表示中</div>';
		}
	}

	renderChartForBudgetProgress(trajectory, year, expenseBudget, savingsTarget) {
		const canvas = document.getElementById('summary-chart');
		const fallback = document.getElementById('chart-fallback');
		if (!canvas) return;

		const labels = trajectory.map(t => `${Number(t.month)}月`);
		const cumExpenses = trajectory.map(t => t.cumulative_expense);
		const cumBudgetPace = trajectory.map(t => t.cumulative_budget_pace);
		const cumSavings = trajectory.map(t => t.cumulative_savings);
		const cumSavingsPace = trajectory.map(t => t.cumulative_savings_pace);

		if (typeof window !== 'undefined' && window.Chart) {
			if (fallback) fallback.style.display = 'none';
			canvas.style.display = 'block';

			this.destroyMainChart();
			this.chart = new window.Chart(canvas, {
				type: 'line',
				data: {
					labels,
					datasets: [
						{
							label: '累積支出実績',
							data: cumExpenses,
							borderColor: '#ef4444',
							backgroundColor: 'rgba(239, 68, 68, 0.1)',
							borderWidth: 2,
							tension: 0.1,
							fill: false
						},
						{
							label: '予算消化ペース基準',
							data: cumBudgetPace,
							borderColor: '#f59e0b',
							borderDash: [5, 5],
							borderWidth: 2,
							pointRadius: 0,
							fill: false
						},
						{
							label: '累積純貯蓄実績',
							data: cumSavings,
							borderColor: '#10b981',
							backgroundColor: 'rgba(16, 185, 129, 0.1)',
							borderWidth: 2,
							tension: 0.1,
							fill: false
						},
						{
							label: '目標貯蓄ペース基準',
							data: cumSavingsPace,
							borderColor: '#3b82f6',
							borderDash: [5, 5],
							borderWidth: 2,
							pointRadius: 0,
							fill: false
						}
					]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					scales: {
						y: {
							beginAtZero: true
						}
					}
				}
			});
		} else if (fallback) {
			canvas.style.display = 'none';
			fallback.style.display = 'block';
			fallback.innerHTML = `<div>${year}年 予算消化・貯蓄進捗データ表示中 (年間予算: ¥${expenseBudget.toLocaleString()} / 目標貯蓄: ¥${savingsTarget.toLocaleString()})</div>`;
		}
	}

	renderChartForAssets(totalAssetSummary) {
		const canvas = document.getElementById('summary-chart');
		const fallback = document.getElementById('chart-fallback');
		if (!canvas) return;

		const labels = ['流動資産 (預貯金等)', '投資資産 (証券・投信等)', '負債 (カード等)'];
		const values = [
			totalAssetSummary.total_liquid_assets,
			totalAssetSummary.total_investment_assets,
			totalAssetSummary.total_liabilities
		];
		const colors = ['#2563eb', '#10b981', '#ef4444'];

		if (typeof window !== 'undefined' && window.Chart) {
			if (fallback) fallback.style.display = 'none';
			canvas.style.display = 'block';

			this.destroyMainChart();
			this.chart = new window.Chart(canvas, {
				type: 'doughnut',
				data: {
					labels,
					datasets: [{ data: values, backgroundColor: colors }]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					plugins: {
						tooltip: this.getDoughnutTooltipOptions()
					}
				}
			});
		} else if (fallback) {
			canvas.style.display = 'none';
			fallback.style.display = 'block';
			fallback.innerHTML = `<div>総資産: ¥${totalAssetSummary.total_assets.toLocaleString()} (純資産: ¥${totalAssetSummary.total_net_assets.toLocaleString()})</div>`;
		}
	}

	renderChartForCategoryBreakdown(categoryItems = []) {
		const canvas = document.getElementById('category-breakdown-chart');
		const container = document.getElementById('category-breakdown-chart-container');
		if (!canvas) return;

		if (this.categoryBreakdownChart) {
			this.categoryBreakdownChart.destroy();
			this.categoryBreakdownChart = null;
		}

		const positiveItems = (categoryItems || []).filter(item => (item.amount || 0) > 0);
		if (positiveItems.length === 0) {
			canvas.style.display = 'none';
			if (container) container.style.display = 'none';
			return;
		}

		if (container) container.style.display = 'block';
		canvas.style.display = 'block';

		const labels = positiveItems.map(item => item.name);
		const data = positiveItems.map(item => item.amount);
		const palette = [
			'#3b82f6', '#10b981', '#f59e0b', '#ef4444',
			'#8b5cf6', '#ec4899', '#06b6d4', '#84cc16',
			'#f97316', '#14b8a6', '#6366f1', '#eab308'
		];

		if (typeof window !== 'undefined' && window.Chart) {
			this.categoryBreakdownChart = new window.Chart(canvas, {
				type: 'doughnut',
				data: {
					labels,
					datasets: [{
						data,
						backgroundColor: positiveItems.map((_, idx) => palette[idx % palette.length])
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					plugins: {
						legend: {
							position: 'right',
							labels: {
								color: this.isDark ? '#e2e8f0' : '#334155',
								font: { size: 11 }
							}
						},
						tooltip: this.getDoughnutTooltipOptions()
					}
				}
			});
		}
	}

	renderChartForTags(tagSummary) {
		const canvas = document.getElementById('tag-chart');
		if (!canvas) return;

		if (this.tagChart) {
			this.tagChart.destroy();
			this.tagChart = null;
		}

		const tagsList = tagSummary?.tagList || (Array.isArray(tagSummary?.tags) ? tagSummary.tags : Object.values(tagSummary?.tags || {}));

		if (!tagsList || tagsList.length === 0) {
			canvas.style.display = 'none';
			return;
		}

		const topTags = tagsList.filter(t => (t.expense ?? t.expense_total ?? 0) > 0).slice(0, 8);
		if (topTags.length === 0) {
			canvas.style.display = 'none';
			return;
		}
		canvas.style.display = 'block';

		const labels = topTags.map(t => t.tag || t.name);
		const data = topTags.map(t => t.expense ?? t.expense_total ?? 0);
		const palette = [
			'#3b82f6', '#10b981', '#f59e0b', '#ef4444',
			'#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'
		];

		if (typeof window !== 'undefined' && window.Chart) {
			this.tagChart = new window.Chart(canvas, {
				type: 'doughnut',
				data: {
					labels,
					datasets: [{
						data,
						backgroundColor: palette.slice(0, topTags.length)
					}]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false,
					plugins: {
						legend: {
							position: 'right',
							labels: {
								color: this.isDark ? '#e2e8f0' : '#334155',
								font: { size: 11 }
							}
						},
						tooltip: this.getDoughnutTooltipOptions()
					}
				}
			});
		}
	}
}


