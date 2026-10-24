/**
 * Yoseatsume Kakeibo - Annual Budget, Savings Target & Trajectory Engine
 * Handles tiered rounding, default budget pre-population from prior year actuals,
 * annual/category progress evaluation, and 12-month trajectory generation.
 */

/** Resolve current annual goals without persisting derived amounts. */
export function resolveAnnualTargets(config = {}, income = 0) {
	const basis = config.goal_basis ?? 'independent';
	let expense = config.expense_budget ?? 0, savings = config.savings_target_amount ?? 0, rate = config.savings_target_rate ?? config.target_savings_rate ?? 0;
	const invalid = { valid: false, expense_budget: null, savings_target_amount: null, savings_target_rate: null };
	if (!Number.isSafeInteger(income) || income < 0 || !['independent', 'rate', 'savings', 'expense'].includes(basis)) return invalid;
	if (basis === 'rate') {
		if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) return invalid;
		const [decimal, exponentText] = String(rate).toLowerCase().split('e');
		const fractionDigits = (decimal.split('.')[1] || '').length, exponent = Number(exponentText || 0) - fractionDigits;
		const digits = BigInt(decimal.replace('.', ''));
		const numerator = exponent >= 0 ? digits * 10n ** BigInt(exponent) : digits;
		const denominator = 100n * (exponent < 0 ? 10n ** BigInt(-exponent) : 1n);
		savings = Number(BigInt(income) * numerator / denominator); expense = income - savings;
	} else if (basis === 'savings' || basis === 'expense') {
		const primary = basis === 'savings' ? savings : expense;
		if (!Number.isSafeInteger(primary) || primary < 0) return invalid;
		if (basis === 'savings') expense = income - savings; else savings = income - expense;
		rate = income > 0 ? savings / income * 100 : null;
	} else if (![expense, savings].every(n => Number.isSafeInteger(n) && n >= 0) || typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 100) return invalid;
	if (![expense, savings].every(Number.isSafeInteger)) return invalid;
	return { valid: true, expense_budget: expense, savings_target_amount: savings, savings_target_rate: rate };
}

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
 * @param {Record<string, any>} [params]
 * @returns {{ expense_budget: number, savings_target_amount: number, savings_target_rate: number, category_budgets: Record<string, number> }}
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
 * @param {Record<string, any>} [params]
 * @returns {Record<string, any>}
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
	let finalExpenseBudget = expenseBudget !== null
		? Math.max(0, Number(expenseBudget) || 0)
		: Math.max(0, Number(budgetConfig?.expense_budget) || 0);
	let finalSavingsTargetAmount = savingsTargetAmount !== null
		? Math.max(0, Number(savingsTargetAmount) || 0)
		: Math.max(0, Number(budgetConfig?.savings_target_amount) || 0);
	let finalSavingsTargetRate = savingsTargetRate !== null
		? Math.max(0, Number(savingsTargetRate) || 0)
		: Math.max(0, Number(budgetConfig?.savings_target_rate ?? budgetConfig?.target_savings_rate) || 0);

	const invalidGoals = budgetConfig && !resolveAnnualTargets(budgetConfig, incomeActual ?? yearlySummary?.income ?? 0).valid;
	if (budgetConfig?.goal_basis && budgetConfig.goal_basis !== 'independent') {
		const targets = resolveAnnualTargets(budgetConfig, incomeActual ?? yearlySummary?.income ?? 0);
		finalExpenseBudget = targets.expense_budget; finalSavingsTargetAmount = targets.savings_target_amount; finalSavingsTargetRate = targets.savings_target_rate;
	}

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

	const paceStatus = finalExpenseBudget < 0 || (budgetConfig?.goal_basis && budgetConfig.goal_basis !== 'independent' && finalExpenseBudget === 0 && finalExpenseActual > 0) ? 'over_budget' : evaluatePaceStatus(expenseConsumptionRate, finalExpenseBudget, expectedPaceRate);

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
		budget_discrepancy: finalExpenseBudget - totalCategoryBudget,
		...(invalidGoals ? { expense_budget: null, expense_remaining: null, expense_consumption_rate: null, pace_status: 'unavailable', savings_target_amount: null, savings_remaining: null, savings_achievement_rate: null, savings_target_rate: null, savings_rate_achieved: false, budget_discrepancy: null } : {})
	};
}

/**
 * Generates monthly trajectory data for 12 months of the year for Chart.js rendering (Requirement 3.14).
 * @param {Record<string, any>} [params]
 * @returns {Array<Record<string, any>>}
 */
export function generateAnnualTrajectory({
	year = String(new Date().getFullYear()),
	monthlySummaries = {},
	expenseBudget = 0,
	savingsTarget = 0,
	linked = false,
	targetsValid = true
} = {}) {
	const trajectory = [];
	const budget = linked ? Number(expenseBudget) || 0 : Math.max(0, Number(expenseBudget) || 0);
	const targetSavings = linked ? Number(savingsTarget) || 0 : Math.max(0, Number(savingsTarget) || 0);

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
			monthly_budget_allowance: targetsValid ? Math.round(budget / 12) : null,
			cumulative_expense: cumExpense,
			cumulative_budget_pace: targetsValid ? Math.round((budget / 12) * m) : null,
			monthly_savings: mNet,
			cumulative_savings: cumSavings,
			cumulative_savings_pace: targetsValid ? Math.round((targetSavings / 12) * m) : null
		});
	}

	return trajectory;
}

