import { formatDoughnutTooltipLabel, escapeHtml } from '../logic.js';
import { markerRadii } from '../logic/chart_geometry.js';
import { ChartViewport } from './chart_viewport.js';
import { registerFocusedInteraction, focusedBoundary } from './chart_interaction.js';

export class ChartController {
	constructor(coordinator) {
		this.coordinator = coordinator; this.chart = null; this.tagChart = null; this.categoryBreakdownChart = null;
		this.assetHistoryChart = null; this.categoryTrendChart = null; this.lastCategoryTrend = null; this.isDark = false;
		this.viewports = new Map(); this.selection = new Map(); this.timeViews = new Map();
	}

	drop(slot) {
		this.viewports.get(slot)?.destroy(); this.viewports.delete(slot);
		this[slot]?.destroy(); this[slot] = null;
	}

	destroy() {
		for (const slot of ['chart', 'tagChart', 'categoryBreakdownChart', 'assetHistoryChart', 'categoryTrendChart']) this.drop(slot);
		this.selection.clear(); this.timeViews.clear(); this.lastCategoryTrend = null;
		for (const prefix of ['summary', 'asset-history', 'category-trend']) document.getElementById(`${prefix}-series`)?.replaceChildren();
	}

	destroyMainChart() { this.drop('chart'); }

	updateThemeMode(isDark) {
		this.isDark = isDark;
		if (window.Chart?.defaults) {
			window.Chart.defaults.color = isDark ? '#94a3b8' : '#64748b';
			window.Chart.defaults.borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
		}
		for (const args of [...this.timeViews.values()]) this.drawTime(...args);
	}

	/** Keep all observations; selection changes visibility and marker density only. */
	drawTime(slot, prefix, canvasId, fallbackId, title, type, source, options = {}) {
		if (this.coordinator.isKeyLocked) return;
		this.drop(slot);
		const args = [slot, prefix, canvasId, fallbackId, title, type, source, options]; this.timeViews.set(slot, args);
		const canvas = document.getElementById(canvasId), fallback = document.getElementById(fallbackId), controls = document.getElementById(`${prefix}-series`), reset = document.getElementById(`${prefix}-reset`);
		if (!canvas || !fallback || !controls) return;
		reset.parentElement.style.display = 'flex';
		const datasets = source.datasets.map(dataset => {
			const key = JSON.stringify([prefix, dataset.seriesKey]);
			const row = { ...dataset, data: dataset.data.slice(), hidden: this.selection.get(key) === false };
			if (type === 'line') { row.pointRadius = markerRadii(row.data, dataset.pointRadius ?? 3); row.pointHoverRadius = 5; row.pointHitRadius = 8; }
			return row;
		});
		const toggle = index => {
			if (this.coordinator.isKeyLocked || !source.datasets[index]) return;
			const key = JSON.stringify([prefix, source.datasets[index].seriesKey]); this.selection.set(key, this.selection.get(key) === false);
			this.drawTime(...args);
		};
		controls.replaceChildren();
		datasets.forEach((dataset, index) => {
			const label = document.createElement('label'), input = document.createElement('input'); input.type = 'checkbox'; input.checked = !dataset.hidden;
			input.addEventListener('change', () => toggle(index)); label.append(input, document.createTextNode(dataset.label)); controls.append(label);
		});
		if (datasets.length && datasets.every(row => row.hidden)) { const status = document.createElement('span'); status.textContent = '表示項目が選択されていません'; status.role = 'status'; controls.append(status); }
		const container = prefix === 'category-trend' ? document.getElementById('category-trend-chart-container') : null;
		if (window.Chart && datasets.length) {
			canvas.style.display = 'block'; fallback.style.display = 'none'; if (container) container.style.display = 'block';
			this[slot] = new window.Chart(canvas, {
				type, data: { labels: source.labels.slice(), datasets },
				plugins: [focusedBoundary],
				options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: registerFocusedInteraction(window.Chart), intersect: true }, ...options, scales: structuredClone(options.scales || { y: {} }),
					plugins: { legend: { position: 'bottom', onClick: (_event, item) => toggle(item.datasetIndex) },
						tooltip: { callbacks: { label: context => `${context.dataset.label}: ¥${context.parsed.y.toLocaleString('ja-JP')}` } } } }
			});
			this.viewports.set(slot, new ChartViewport(this[slot], canvas, reset, () => !this.coordinator.isKeyLocked));
		} else {
			canvas.style.display = 'none'; fallback.style.display = 'block'; if (container) container.style.display = 'none'; reset.disabled = true;
			const visible = datasets.filter(row => !row.hidden);
			fallback.innerHTML = datasets.length ? `<table class="summary-table"><caption>${escapeHtml(title)}</caption><thead><tr><th>期間</th>${visible.map(row => `<th>${escapeHtml(row.label)}</th>`).join('')}</tr></thead><tbody>${source.labels.map((label, index) => `<tr><th>${escapeHtml(label)}</th>${visible.map(row => `<td>${row.data[index] == null ? '未算出' : '¥' + escapeHtml(row.data[index].toLocaleString())}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '対象の費目データはありません。';
		}
	}

	renderAssetHistory(history) {
		const fields = [['net_assets','純資産','#2563eb'],['liquid_assets','流動資産','#10b981'],['investment_assets','投資資産（全口座）','#8b5cf6'],['investment_acquisition_cost','取得原価（直近記録）','#d97706'],['investment_valuation','口座評価額（預り金込・参考）','#db2777'],['liabilities','負債','#ef4444']];
		this.drawTime('assetHistoryChart','asset-history','asset-history-chart','asset-history-fallback','資産・投資推移','line', {
			labels: history.points.map(point => point.date), datasets: fields.map(([field, label, borderColor]) => ({ seriesKey: field, label, borderColor, data: history.points.map(point => point[field]), ...(field === 'investment_acquisition_cost' ? { spanGaps: false, stepped: 'before', borderDash: [5,3] } : {}) }))
		}, { scales: { y: { beginAtZero: true } } });
	}

	renderCategoryTrend(trend) {
		this.lastCategoryTrend = trend;
		const palette = ['#2563eb','#059669','#d97706','#dc2626','#7c3aed','#db2777','#0891b2','#65a30d'];
		this.drawTime('categoryTrendChart','category-trend','category-trend-chart','category-trend-fallback',`費目ごとの${trend.type === 'income' ? '収入' : '支出'}推移`,'line', {
			labels: trend.labels, datasets: trend.series.map(row => {
				const key = JSON.stringify([trend.type || 'expense', row.kind || 'category', row.id]);
				let hash = 0; for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
				return { seriesKey: key, categoryId: row.id, label: row.name, data: row.values, borderColor: palette[hash % palette.length], fill: false, tension: 0.15 };
			})
		}, { scales: { y: { beginAtZero: true } } });
	}

	renderChartForDaily(dailyData) {
		const days = Object.values(dailyData.days);
		this.drawTime('chart','summary','summary-chart','chart-fallback','日別収支','bar', { labels: days.map(d => `${d.day}日`), datasets: [
			{ seriesKey: 'expense:confirmed', label: '確定支出', data: days.map(d => d.expense_confirmed), backgroundColor: '#ef4444', stack: 'exp' },
			{ seriesKey: 'expense:planned', label: '予定支出', data: days.map(d => this.coordinator.showPlanned ? d.expense_planned : 0), backgroundColor: '#fca5a5', stack: 'exp' },
			{ seriesKey: 'income', label: '収入', data: days.map(d => d.income_total), backgroundColor: '#10b981' }
		] }, { scales: { x: { stacked: true }, y: { beginAtZero: true } } });
	}

	renderChartForMonthly(monthlyData) {
		const months = Object.values(monthlyData.months);
		this.renderCashflowTotals(months.map(m => `${m.month.slice(5)}月`), months.map(m => m.income_total), months.map(m => m.expense_total), `${monthlyData.year}年 月別収支`);
	}

	renderChartForYearly(yearlyData) {
		const years = Object.values(yearlyData).sort((a,b) => a.year.localeCompare(b.year));
		this.renderCashflowTotals(years.map(y => `${y.year}年`), years.map(y => y.income), years.map(y => y.expense));
	}

	renderCashflowTotals(labels, incomes, expenses, title = '収支推移') {
		this.drawTime('chart','summary','summary-chart','chart-fallback',title,'bar', { labels, datasets: [
			{ seriesKey: 'income', label: '収入', data: incomes, backgroundColor: '#10b981' },
			{ seriesKey: 'expense', label: '支出', data: expenses, backgroundColor: '#ef4444' }
		] }, { scales: { y: { beginAtZero: true } } });
	}

	renderChartForBudgetProgress(trajectory, year, expenseBudget, savingsTarget) {
		this.drawTime('chart','summary','summary-chart','chart-fallback',`${year}年 予算消化・貯蓄進捗`,'line', { labels: trajectory.map(t => `${Number(t.month)}月`), datasets: [
			{ seriesKey:'budget:expense',label:'累積支出実績',data:trajectory.map(t=>t.cumulative_expense),borderColor:'#ef4444',fill:false },
			{ seriesKey:'budget:expense-pace',label:'予算消化ペース基準',data:trajectory.map(t=>t.cumulative_budget_pace),borderColor:'#f59e0b',borderDash:[5,5],pointRadius:0 },
			{ seriesKey:'budget:savings',label:'累積純貯蓄実績',data:trajectory.map(t=>t.cumulative_savings),borderColor:'#10b981',fill:false },
			{ seriesKey:'budget:savings-pace',label:'目標貯蓄ペース基準',data:trajectory.map(t=>t.cumulative_savings_pace),borderColor:'#3b82f6',borderDash:[5,5],pointRadius:0 }
		] }, { scales: { y: { beginAtZero: true } } });
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


	renderChartForAssets(totalAssetSummary) {
		this.drop('chart'); this.timeViews.delete('chart');
		document.getElementById('summary-series')?.replaceChildren();
		const reset = document.getElementById('summary-reset'); if (reset) reset.parentElement.style.display = 'none';
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


