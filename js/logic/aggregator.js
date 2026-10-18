/**
 * Yoseatsume Kakeibo - Financial Aggregation & Asset Summary Module
 * Handles account balance calculation, daily/monthly/yearly aggregations, and total asset valuation.
 */

import { formatDate, getLastDayOfMonth } from './date_utils.js';

/**
 * Calculate balances and summaries from snapshot and transactions
 * @param {object} snapshot - summary_snapshot.json
 * @param {Array} transactions - all active transactions in local DB
 * @param {string} targetMonth - current selected month (YYYY-MM)
 */
export function calculateBalancesAndSummaries(snapshot = {}, transactions = [], targetMonth = formatDate(new Date()).slice(0, 7)) {
	const lastClosedMonth = snapshot?.last_closed_month || '1970-01';
	const initialBalances = snapshot?.account_balances ? { ...snapshot.account_balances } : {};

	// Confirmed balances: all confirmed transactions for target_month > lastClosedMonth
	const confirmedBalances = { ...initialBalances };
	// Projected balances: includes planned transactions for target_month <= targetMonth
	const projectedBalances = { ...initialBalances };

	const activeTransactions = transactions.filter(t => !t.is_deleted);

	// Apply transactions to balances
	for (const tx of activeTransactions) {
		if (tx.target_month <= lastClosedMonth) {
			// Already included in snapshot balances
			continue;
		}

		const isConfirmed = tx.status === 'confirmed';
		const isPlanned = tx.status === 'planned';
		const amount = Number(tx.amount) || 0;

		// Apply confirmed transactions up to now/targetMonth
		if (isConfirmed) {
			applyTxToBalances(confirmedBalances, tx.type, tx.account_id, tx.to_account_id, amount);
		}

		// Apply both confirmed and planned up to targetMonth for projected balances
		if ((isConfirmed || isPlanned) && tx.target_month <= targetMonth) {
			applyTxToBalances(projectedBalances, tx.type, tx.account_id, tx.to_account_id, amount);
		}
	}

	// Monthly breakdown for targetMonth
	const monthTxs = activeTransactions.filter(t => t.target_month === targetMonth);

	const summary = {
		target_month: targetMonth,
		income_confirmed: 0,
		income_planned: 0,
		income_total: 0,
		expense_confirmed: 0,
		expense_planned: 0,
		expense_total: 0,
		net_income_confirmed: 0,
		net_income_total: 0,
		by_category: {},
		by_actual_category: {},
		confirmed_balances: confirmedBalances,
		projected_balances: projectedBalances
	};

	for (const tx of monthTxs) {
		const amt = Number(tx.amount) || 0;
		const isConfirmed = tx.status === 'confirmed';

		if (tx.type === 'income') {
			if (isConfirmed) {
				summary.income_confirmed += amt;
			} else {
				summary.income_planned += amt;
			}
		} else if (tx.type === 'expense') {
			if (isConfirmed) {
				summary.expense_confirmed += amt;
			} else {
				summary.expense_planned += amt;
			}

			// Accounting category
			const catId = tx.category_id || 'cat_unclassified';
			const subId = tx.subcategory_id || 'sub_unclassified';
			if (!summary.by_category[catId]) {
				summary.by_category[catId] = { total_confirmed: 0, total_planned: 0, total: 0, by_subcategory: {} };
			}
			if (isConfirmed) {
				summary.by_category[catId].total_confirmed += amt;
			} else {
				summary.by_category[catId].total_planned += amt;
			}
			summary.by_category[catId].total += amt;

			if (!summary.by_category[catId].by_subcategory[subId]) {
				summary.by_category[catId].by_subcategory[subId] = { confirmed: 0, planned: 0, total: 0 };
			}
			if (isConfirmed) {
				summary.by_category[catId].by_subcategory[subId].confirmed += amt;
			} else {
				summary.by_category[catId].by_subcategory[subId].planned += amt;
			}
			summary.by_category[catId].by_subcategory[subId].total += amt;

			// Actual category
			const actCatId = tx.actual_category_id || catId;
			const actSubId = tx.actual_subcategory_id || subId;
			if (!summary.by_actual_category[actCatId]) {
				summary.by_actual_category[actCatId] = { total_confirmed: 0, total_planned: 0, total: 0, by_subcategory: {} };
			}
			if (isConfirmed) {
				summary.by_actual_category[actCatId].total_confirmed += amt;
			} else {
				summary.by_actual_category[actCatId].total_planned += amt;
			}
			summary.by_actual_category[actCatId].total += amt;

			if (!summary.by_actual_category[actCatId].by_subcategory[actSubId]) {
				summary.by_actual_category[actCatId].by_subcategory[actSubId] = { confirmed: 0, planned: 0, total: 0 };
			}
			if (isConfirmed) {
				summary.by_actual_category[actCatId].by_subcategory[actSubId].confirmed += amt;
			} else {
				summary.by_actual_category[actCatId].by_subcategory[actSubId].planned += amt;
			}
			summary.by_actual_category[actCatId].by_subcategory[actSubId].total += amt;
		}
	}

	summary.income_total = summary.income_confirmed + summary.income_planned;
	summary.expense_total = summary.expense_confirmed + summary.expense_planned;
	summary.net_income_confirmed = summary.income_confirmed - summary.expense_confirmed;
	summary.net_income_total = summary.income_total - summary.expense_total;

	return summary;
}

function applyTxToBalances(balances, type, accountId, toAccountId, amount) {
	if (type === 'expense') {
		if (accountId) {
			balances[accountId] = (balances[accountId] || 0) - amount;
		}
	} else if (type === 'income') {
		if (accountId) {
			balances[accountId] = (balances[accountId] || 0) + amount;
		}
	} else if (type === 'transfer') {
		if (accountId) {
			balances[accountId] = (balances[accountId] || 0) - amount;
		}
		if (toAccountId) {
			balances[toAccountId] = (balances[toAccountId] || 0) + amount;
		}
	}
}

/**
 * Aggregate transactions by day for a given month
 */
export function aggregateDailySummaries(transactions = [], targetMonth = formatDate(new Date()).slice(0, 7)) {
	const [y, m] = targetMonth.split('-').map(Number);
	const lastDay = getLastDayOfMonth(y, m);
	const days = {};

	for (let d = 1; d <= lastDay; d++) {
		const dayStr = `${targetMonth}-${String(d).padStart(2, '0')}`;
		days[dayStr] = {
			date: dayStr,
			day: d,
			income_confirmed: 0,
			income_planned: 0,
			income_total: 0,
			expense_confirmed: 0,
			expense_planned: 0,
			expense_total: 0,
			net: 0,
			by_category: {},
			by_actual_category: {}
		};
	}

	for (const tx of transactions) {
		if (tx.is_deleted || tx.target_month !== targetMonth) continue;
		const dayKey = tx.date;
		if (!days[dayKey]) continue;

		const amt = Number(tx.amount) || 0;
		const isConfirmed = tx.status === 'confirmed';

		if (tx.type === 'income') {
			if (isConfirmed) days[dayKey].income_confirmed += amt;
			else days[dayKey].income_planned += amt;
			days[dayKey].income_total += amt;
		} else if (tx.type === 'expense') {
			if (isConfirmed) days[dayKey].expense_confirmed += amt;
			else days[dayKey].expense_planned += amt;
			days[dayKey].expense_total += amt;

			const catId = tx.category_id || 'cat_unclassified';
			days[dayKey].by_category[catId] = (days[dayKey].by_category[catId] || 0) + amt;

			const actCatId = tx.actual_category_id || catId;
			days[dayKey].by_actual_category[actCatId] = (days[dayKey].by_actual_category[actCatId] || 0) + amt;
		}
	}

	let totalIncome = 0;
	let totalExpense = 0;
	for (const d of Object.values(days)) {
		d.net = d.income_total - d.expense_total;
		totalIncome += d.income_total;
		totalExpense += d.expense_total;
	}

	return {
		month: targetMonth,
		days,
		total_income: totalIncome,
		total_expense: totalExpense,
		total_net: totalIncome - totalExpense
	};
}

/**
 * Aggregate transactions by month for a given year (1 to 12)
 */
export function aggregateMonthlySummaries(transactions = [], targetYear = String(new Date().getFullYear()), historicalSummaries = {}) {
	const months = {};
	for (let m = 1; m <= 12; m++) {
		const monthKey = `${targetYear}-${String(m).padStart(2, '0')}`;
		const hist = historicalSummaries[monthKey];
		months[monthKey] = {
			month: monthKey,
			income_confirmed: hist ? (hist.income_confirmed || hist.total_income || 0) : 0,
			income_planned: 0,
			income_total: hist ? (hist.income_confirmed || hist.total_income || 0) : 0,
			expense_confirmed: hist ? (hist.expense_confirmed || hist.total_expense || 0) : 0,
			expense_planned: 0,
			expense_total: hist ? (hist.expense_confirmed || hist.total_expense || 0) : 0,
			net: 0,
			by_category: hist?.by_category ? { ...hist.by_category } : {},
			by_actual_category: hist?.by_actual_category ? { ...hist.by_actual_category } : {}
		};
	}

	for (const tx of transactions) {
		if (tx.is_deleted) continue;
		const mKey = tx.target_month;
		if (!mKey || !mKey.startsWith(`${targetYear}-`)) continue;
		if (!months[mKey]) continue;

		// If month is already in historical summaries, don't double count local transactions
		if (historicalSummaries[mKey]) continue;

		const amt = Number(tx.amount) || 0;
		const isConfirmed = tx.status === 'confirmed';

		if (tx.type === 'income') {
			if (isConfirmed) months[mKey].income_confirmed += amt;
			else months[mKey].income_planned += amt;
			months[mKey].income_total += amt;
		} else if (tx.type === 'expense') {
			if (isConfirmed) months[mKey].expense_confirmed += amt;
			else months[mKey].expense_planned += amt;
			months[mKey].expense_total += amt;

			const catId = tx.category_id || 'cat_unclassified';
			months[mKey].by_category[catId] = (months[mKey].by_category[catId] || 0) + amt;

			const actCatId = tx.actual_category_id || catId;
			months[mKey].by_actual_category[actCatId] = (months[mKey].by_actual_category[actCatId] || 0) + amt;
		}
	}

	let totalIncome = 0;
	let totalExpense = 0;
	for (const m of Object.values(months)) {
		m.net = m.income_total - m.expense_total;
		totalIncome += m.income_total;
		totalExpense += m.expense_total;
	}

	return {
		year: targetYear,
		months,
		total_income: totalIncome,
		total_expense: totalExpense,
		total_net: totalIncome - totalExpense
	};
}

/**
 * Aggregate transactions by year across all available data
 */
export function aggregateYearlySummaries(transactions = [], historicalSummaries = {}) {
	const years = {};

	// First collect from historical monthly summaries
	for (const [mKey, hist] of Object.entries(historicalSummaries)) {
		const yKey = mKey.slice(0, 4);
		if (!years[yKey]) {
			years[yKey] = {
				year: yKey,
				income: 0,
				expense: 0,
				net: 0,
				savings_rate: 0,
				by_category: {},
				by_actual_category: {}
			};
		}
		const inc = hist.income_confirmed || hist.total_income || 0;
		const exp = hist.expense_confirmed || hist.total_expense || 0;
		years[yKey].income += inc;
		years[yKey].expense += exp;

		if (hist.by_category) {
			for (const [cat, val] of Object.entries(hist.by_category)) {
				const catAmt = typeof val === 'number' ? val : (val.total || val.confirmed || 0);
				years[yKey].by_category[cat] = (years[yKey].by_category[cat] || 0) + catAmt;
			}
		}
		if (hist.by_actual_category) {
			for (const [cat, val] of Object.entries(hist.by_actual_category)) {
				const catAmt = typeof val === 'number' ? val : (val.total || val.confirmed || 0);
				years[yKey].by_actual_category[cat] = (years[yKey].by_actual_category[cat] || 0) + catAmt;
			}
		}
	}

	// Then add transactions for unclosed months
	for (const tx of transactions) {
		if (tx.is_deleted) continue;
		const mKey = tx.target_month;
		if (!mKey || historicalSummaries[mKey]) continue;

		const yKey = mKey.slice(0, 4);
		if (!years[yKey]) {
			years[yKey] = {
				year: yKey,
				income: 0,
				expense: 0,
				net: 0,
				savings_rate: 0,
				by_category: {},
				by_actual_category: {}
			};
		}

		const amt = Number(tx.amount) || 0;
		if (tx.type === 'income') {
			years[yKey].income += amt;
		} else if (tx.type === 'expense') {
			years[yKey].expense += amt;

			const catId = tx.category_id || 'cat_unclassified';
			years[yKey].by_category[catId] = (years[yKey].by_category[catId] || 0) + amt;

			const actCatId = tx.actual_category_id || catId;
			years[yKey].by_actual_category[actCatId] = (years[yKey].by_actual_category[actCatId] || 0) + amt;
		}
	}

	for (const y of Object.values(years)) {
		y.net = y.income - y.expense;
		y.savings_rate = y.income > 0 ? Math.round((y.net / y.income) * 1000) / 10 : 0;
	}

	return years;
}

/**
 * Calculate total assets including internal accounts and external assets
 */
export function calculateTotalAssetSummary(accountBalances = {}, accountsMaster = [], externalAssets = []) {
	let liquidAssets = 0;
	let investmentAssets = 0;
	let liabilities = 0;
	const byType = {
		cash: 0,
		bank: 0,
		credit_card: 0,
		point: 0,
		receivable: 0,
		prepaid: 0,
		investment: 0,
		asset: 0,
		stock: 0,
		mutual_fund: 0,
		crypto: 0,
		other: 0
	};

	const accountMap = new Map();
	for (const acc of accountsMaster) {
		accountMap.set(acc.id, acc);
	}

	const investmentTypeSet = new Set(['investment', 'asset', 'stock', 'mutual_fund', 'crypto']);

	for (const [accId, balance] of Object.entries(accountBalances)) {
		const acc = accountMap.get(accId);
		const type = acc?.type || 'cash';
		const isAsset = acc?.is_asset !== false && type !== 'credit_card';

		if (type === 'credit_card') {
			if (balance < 0) {
				liabilities += Math.abs(balance);
			} else {
				liquidAssets += balance;
			}
		} else if (isAsset && balance >= 0) {
			if (investmentTypeSet.has(type)) {
				investmentAssets += balance;
			} else {
				liquidAssets += balance;
			}
		} else if (balance < 0) {
			liabilities += Math.abs(balance);
		}

		if (byType[type] !== undefined) {
			byType[type] += balance;
		} else {
			byType.other += balance;
		}
	}

	let externalTotal = 0;
	for (const item of externalAssets) {
		const amt = Number(item.amount ?? item.market_value ?? item.current_value ?? 0) || 0;
		externalTotal += amt;
		const type = item.type || 'stock';
		if (byType[type] !== undefined) {
			byType[type] += amt;
		} else {
			byType.other += amt;
		}
	}

	const totalInvestmentAssets = investmentAssets + externalTotal;
	const totalAssets = liquidAssets + totalInvestmentAssets;
	const netAssets = totalAssets - liabilities;

	return {
		liquid_assets: liquidAssets,
		investment_assets: totalInvestmentAssets,
		liabilities,
		external_assets_total: externalTotal,
		total_assets: totalAssets,
		net_assets: netAssets,
		total_liquid_assets: liquidAssets,
		total_external_assets: externalTotal,
		total_investment_assets: totalInvestmentAssets,
		total_liabilities: liabilities,
		total_net_assets: netAssets,
		by_type: byType
	};
}

