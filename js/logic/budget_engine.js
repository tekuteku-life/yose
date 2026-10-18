/**
 * Yoseatsume Kakeibo - Annual Budget, Savings Target & Trajectory Engine
 * Handles tiered rounding, default budget pre-population from prior year actuals,
 * annual/category progress evaluation, and 12-month trajectory generation.
 */

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Lightly rounds an amount according to tiered algorithm (Requirement 3.14):
 * - Amount >= 1,000,000 yen -> rounded to nearest 10,000 yen (Math.round(amt / 10000) * 10000)
 * - Amount >= 10,000 yen -> rounded to nearest 1,000 yen (Math.round(amt / 1000) * 1000)
 * - Amount < 10,000 yen -> rounded to nearest 100 yen (Math.round(amt / 100) * 100)
 * @param {number} amt
 * @returns {number}
 */
export function roundTieredAmount(amt) {
	const n = Math.max(0, Math.round(Number(amt) || 0));
	if (n >= 1000000) {
		return Math.round(n / 10000) * 10000;
	} else if (n >= 10000) {
		return Math.round(n / 1000) * 1000;
	} else {
		return Math.round(n / 100) * 100;
	}
}

/**
 * Calculates default annual budget, savings targets, and category budgets based on previous year actuals with tiered rounding.
 * (Requirement 3.14)
 * @param {object} [params]
 * @param {object} [params.previousYearSummary] - Overall summary ({ income, expense, net, savings_rate, by_category }) or null
 * @param {Array<object>} [params.pastTransactions] - Array of transactions from the previous year
 * @param {Array<object>} [params.categories] - Array of category masters ({ id, name, type, ... })
 * @param {string|number} [params.targetYear] - Target year (YYYY)
 * @returns {object} { expense_budget, savings_target_amount, savings_target_rate, category_budgets }
 */
export function calculateAnnualBudgetDefaults({
	previousYearSummary = null,
	pastTransactions = [],
	categories = [],
	targetYear = null
} = {}) {
	// 1. Calculate category actuals
	const catActuals = {};
	const prevYearStr = targetYear ? String(Number(targetYear) - 1) : null;

	// From past transactions if available
	if (Array.isArray(pastTransactions)) {
		for (const tx of pastTransactions) {
			if (!tx || tx.is_deleted) continue;
			if (prevYearStr && tx.date && !tx.date.startsWith(prevYearStr)) continue;
			if (tx.type === 'expense') {
				const catId = tx.category_id || 'cat_unclassified';
				if (!FORBIDDEN_KEYS.includes(catId)) {
					catActuals[catId] = (catActuals[catId] || 0) + (Number(tx.amount) || 0);
				}
			}
		}
	}

	// From previousYearSummary.by_category if available and not yet set
	if (previousYearSummary?.by_category && typeof previousYearSummary.by_category === 'object') {
		for (const [catId, val] of Object.entries(previousYearSummary.by_category)) {
			if (FORBIDDEN_KEYS.includes(catId)) continue;
			const amt = typeof val === 'object' ? Number(val?.total || 0) : Number(val || 0);
			if (amt > 0 && !catActuals[catId]) {
				catActuals[catId] = amt;
			}
		}
	}

	// Calculate rounded category budgets
	const category_budgets = {};
	if (Array.isArray(categories) && categories.length > 0) {
		for (const cat of categories) {
			if (!cat || !cat.id || FORBIDDEN_KEYS.includes(cat.id)) continue;
			if (cat.type && cat.type !== 'expense') continue;
			const actual = catActuals[cat.id] || 0;
			category_budgets[cat.id] = roundTieredAmount(actual);
		}
	} else {
		for (const [catId, actual] of Object.entries(catActuals)) {
			category_budgets[catId] = roundTieredAmount(actual);
		}
	}

	// Calculate overall expense budget
	let rawExpense = 0;
	if (previousYearSummary?.expense !== undefined) {
		rawExpense = Number(previousYearSummary.expense) || 0;
	} else {
		rawExpense = Object.values(catActuals).reduce((sum, v) => sum + v, 0);
	}
	const expense_budget = roundTieredAmount(rawExpense);

	// Calculate savings target amount
	let rawNet = 0;
	if (previousYearSummary?.net !== undefined) {
		rawNet = Number(previousYearSummary.net) || 0;
	} else if (previousYearSummary?.income !== undefined) {
		rawNet = (Number(previousYearSummary.income) || 0) - rawExpense;
	}
	const savings_target_amount = rawNet > 0 ? roundTieredAmount(rawNet) : 0;

	// Calculate savings target rate
	let savings_target_rate = 0;
	if (previousYearSummary?.savings_rate !== undefined) {
		savings_target_rate = Math.max(0, Math.round(Number(previousYearSummary.savings_rate) || 0));
	} else if (previousYearSummary?.income && rawNet > 0) {
		const inc = Number(previousYearSummary.income) || 0;
		if (inc > 0) {
			savings_target_rate = Math.max(0, Math.round((rawNet / inc) * 100));
		}
	}

	return {
		expense_budget,
		savings_target_amount,
		savings_target_rate,
		category_budgets
	};
}

/**
 * Evaluate pace status from consumption rate vs expected monthly pace rate
 * @param {number} consumptionRate
 * @param {number} budget
 * @param {number} expectedPaceRate
 * @returns {"on_pace" | "ahead" | "caution" | "over_budget"}
 */
function evaluatePaceStatus(consumptionRate, budget, expectedPaceRate) {
	if (consumptionRate > 100) {
		return 'over_budget';
	}
	if (budget > 0) {
		if (consumptionRate > expectedPaceRate + 5) {
			return 'caution';
		}
		if (consumptionRate < expectedPaceRate - 5) {
			return 'ahead';
		}
	}
	return 'on_pace';
}

/**
 * Calculates annual budget and savings targets progress and pace metrics (Requirement 3.14).
 * @param {object} [params]
 * @returns {object}
 */
export function calculateAnnualBudgetProgress({
	yearlySummary = null,
	budgetConfig = null,
	currentMonth = null,
	expenseBudget = null,
	expenseActual = null,
	savingsTargetAmount = null,
	savingsTargetRate = null,
	incomeActual = null,
	netSavingsActual = null,
	currentMonthIndex = null,
	categoryBudgets = null,
	categoryActuals = null
} = {}) {
	const finalExpenseBudget = expenseBudget !== null
		? Math.max(0, Number(expenseBudget) || 0)
		: Math.max(0, Number(budgetConfig?.expense_budget) || 0);
	const finalSavingsTargetAmount = savingsTargetAmount !== null
		? Math.max(0, Number(savingsTargetAmount) || 0)
		: Math.max(0, Number(budgetConfig?.savings_target_amount) || 0);
	const finalSavingsTargetRate = savingsTargetRate !== null
		? Math.max(0, Number(savingsTargetRate) || 0)
		: Math.max(0, Number(budgetConfig?.savings_target_rate ?? budgetConfig?.target_savings_rate) || 0);

	const finalExpenseActual = expenseActual !== null
		? Number(expenseActual) || 0
		: Number(yearlySummary?.expense) || 0;
	const finalIncomeActual = incomeActual !== null
		? Number(incomeActual) || 0
		: Number(yearlySummary?.income) || 0;
	const finalNetSavingsActual = netSavingsActual !== null
		? Number(netSavingsActual) || 0
		: Number(yearlySummary?.net !== undefined ? yearlySummary.net : (finalIncomeActual - finalExpenseActual)) || 0;

	// Expense budget metrics
	const expenseRemaining = finalExpenseBudget - finalExpenseActual;
	const expenseConsumptionRate = finalExpenseBudget > 0
		? Math.round((finalExpenseActual / finalExpenseBudget) * 1000) / 10
		: 0;

	// Month pace
	const rawMonth = currentMonthIndex !== null ? currentMonthIndex : currentMonth;
	const month = typeof rawMonth === 'number' && rawMonth >= 1 && rawMonth <= 12
		? rawMonth
		: (new Date().getMonth() + 1);
	const expectedPaceRate = Math.round((month / 12) * 1000) / 10;

	const paceStatus = evaluatePaceStatus(expenseConsumptionRate, finalExpenseBudget, expectedPaceRate);

	// Savings target metrics
	const isDeficit = finalNetSavingsActual < 0;
	const savingsAchievementRate = finalSavingsTargetAmount > 0
		? (isDeficit ? 0 : Math.round((finalNetSavingsActual / finalSavingsTargetAmount) * 1000) / 10)
		: 0;
	const savingsRemaining = Math.max(0, finalSavingsTargetAmount - finalNetSavingsActual);

	const savingsActualRate = finalIncomeActual > 0
		? Math.round((finalNetSavingsActual / finalIncomeActual) * 1000) / 10
		: 0;
	const savingsRateAchieved = finalSavingsTargetRate > 0 && savingsActualRate >= finalSavingsTargetRate;

	// Category budgets & progress metrics (Requirement 3.14)
	const finalCategoryBudgets = categoryBudgets !== null
		? categoryBudgets
		: (budgetConfig?.category_budgets || {});

	const rawCatActuals = categoryActuals !== null
		? categoryActuals
		: (yearlySummary?.by_category || {});

	const category_progress = {};
	let totalCategoryBudget = 0;

	if (finalCategoryBudgets && typeof finalCategoryBudgets === 'object') {
		for (const [catId, bAmt] of Object.entries(finalCategoryBudgets)) {
			if (FORBIDDEN_KEYS.includes(catId)) continue;
			const catBudget = Math.max(0, Number(bAmt) || 0);
			totalCategoryBudget += catBudget;

			const catActVal = rawCatActuals[catId];
			const catActual = Number(catActVal?.total ?? catActVal ?? 0) || 0;
			const catRemaining = catBudget - catActual;
			const catConsumptionRate = catBudget > 0
				? Math.round((catActual / catBudget) * 1000) / 10
				: 0;

			category_progress[catId] = {
				budget: catBudget,
				actual: catActual,
				remaining: catRemaining,
				consumption_rate: catConsumptionRate,
				pace_status: evaluatePaceStatus(catConsumptionRate, catBudget, expectedPaceRate)
			};
		}
	}

	return {
		expense_budget: finalExpenseBudget,
		expense_actual: finalExpenseActual,
		expense_remaining: expenseRemaining,
		expense_consumption_rate: expenseConsumptionRate,
		expected_pace_rate: expectedPaceRate,
		pace_status: paceStatus,
		savings_target_amount: finalSavingsTargetAmount,
		savings_actual: finalNetSavingsActual,
		savings_achievement_rate: savingsAchievementRate,
		savings_remaining: savingsRemaining,
		is_deficit: isDeficit,
		savings_target_rate: finalSavingsTargetRate,
		savings_actual_rate: savingsActualRate,
		savings_rate_achieved: savingsRateAchieved,
		category_progress,
		total_category_budget: totalCategoryBudget,
		budget_discrepancy: finalExpenseBudget - totalCategoryBudget
	};
}

/**
 * Generates monthly trajectory data for 12 months of the year for Chart.js rendering (Requirement 3.14).
 * @param {object} [params]
 * @param {string} [params.year] - YYYY
 * @param {object} [params.monthlySummaries] - Keyed by YYYY-MM
 * @param {number} [params.expenseBudget]
 * @param {number} [params.savingsTarget]
 * @returns {Array<object>}
 */
export function generateAnnualTrajectory({
	year = String(new Date().getFullYear()),
	monthlySummaries = {},
	expenseBudget = 0,
	savingsTarget = 0
} = {}) {
	const trajectory = [];
	const budget = Math.max(0, Number(expenseBudget) || 0);
	const targetSavings = Math.max(0, Number(savingsTarget) || 0);

	let cumExpense = 0;
	let cumSavings = 0;

	for (let m = 1; m <= 12; m++) {
		const mStr = String(m).padStart(2, '0');
		const periodKey = `${year}-${mStr}`;
		const hist = monthlySummaries[periodKey] || {};

		const mExp = Number(hist.expense_total || hist.expense_confirmed || hist.expense || 0);
		const mInc = Number(hist.income_total || hist.income_confirmed || hist.income || 0);
		const mNet = Number(hist.net !== undefined ? hist.net : (mInc - mExp));

		cumExpense += mExp;
		cumSavings += mNet;

		trajectory.push({
			month: mStr,
			month_str: periodKey,
			monthly_expense: mExp,
			monthly_budget_allowance: Math.round(budget / 12),
			cumulative_expense: cumExpense,
			cumulative_budget_pace: Math.round((budget / 12) * m),
			monthly_savings: mNet,
			cumulative_savings: cumSavings,
			cumulative_savings_pace: Math.round((targetSavings / 12) * m)
		});
	}

	return trajectory;
}

