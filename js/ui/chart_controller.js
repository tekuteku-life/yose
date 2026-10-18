/**
 * Yoseatsume Kakeibo - Chart Visualization Controller
 * Dedicated Chart.js generator for daily, monthly, yearly, budget progress, and assets.
 */

export class ChartController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.chart = null;
	}

	destroy() {
		if (this.chart) {
			this.chart.destroy();
			this.chart = null;
		}
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

			this.destroy();
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

			this.destroy();
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

			this.destroy();
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

			this.destroy();
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

			this.destroy();
			this.chart = new window.Chart(canvas, {
				type: 'doughnut',
				data: {
					labels,
					datasets: [{ data: values, backgroundColor: colors }]
				},
				options: {
					responsive: true,
					maintainAspectRatio: false
				}
			});
		} else if (fallback) {
			canvas.style.display = 'none';
			fallback.style.display = 'block';
			fallback.innerHTML = `<div>総資産: ¥${totalAssetSummary.total_assets.toLocaleString()} (純資産: ¥${totalAssetSummary.total_net_assets.toLocaleString()})</div>`;
		}
	}
}

