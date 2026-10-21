/**
 * Yoseatsume Kakeibo - Financial Aggregation & Asset Summary Module
 * Handles account balance calculation, daily/monthly/yearly aggregations, and total asset valuation.
 */

import { formatDate, getLastDayOfMonth } from './date_utils.js';

/** 確認できる月末残高と確定明細から資産推移を作る。未取得の過去日を補完しない。 */
export function buildAssetHistory(snapshot = {}, transactions = [], accounts = [], options = {}) {
	const today = options.today || formatDate(new Date());
	const mode = options.mode || 'month';
	const month = options.month || today.slice(0, 7);
	const monthEnd = value => {
		const date = new Date(`${value}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + 1, 0);
		return date.toISOString().slice(0, 10);
	};
	const histories = { ...(snapshot.monthly_summaries || {}) };
	if (snapshot.last_closed_month && !histories[snapshot.last_closed_month]?.closing_balances) histories[snapshot.last_closed_month] = { closing_balances: snapshot.account_balances || {} };
	const anchors = Object.keys(histories).filter(key => histories[key]?.closing_balances).sort();
	const knownTransactions = transactions.filter(tx => !tx.is_deleted && tx.status === 'confirmed' && !tx.amount_pending);
	const earliest = [...anchors.map(key => monthEnd(key)), ...knownTransactions.filter(tx => !snapshot.last_closed_month || tx.target_month > snapshot.last_closed_month).map(tx => tx.date)].sort()[0] || today;
	let start = mode === 'month' ? month + '-01' : mode === 'year' ? `${options.year || today.slice(0, 4)}-01-01` : mode === 'range' ? options.start : earliest;
	let end = mode === 'month' ? monthEnd(month) : mode === 'year' ? `${options.year || today.slice(0, 4)}-12-31` : mode === 'range' ? options.end : today;
	const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
	if (!valid(start) || !valid(end) || start > end) throw new Error('期間の開始日・終了日を確認してください。');
	end = end < today ? end : today;
	const dates = new Set();
	const days = (Date.parse(end) - Date.parse(start)) / 86400000;
	if (mode === 'month' || (mode === 'range' && days <= 62)) {
		for (let date = new Date(start + 'T00:00:00Z'); date.toISOString().slice(0, 10) <= end; date.setUTCDate(date.getUTCDate() + 1)) dates.add(date.toISOString().slice(0, 10));
	} else {
		if (mode === 'range') dates.add(start);
		for (let date = new Date(start.slice(0, 7) + '-01T00:00:00Z'); date.toISOString().slice(0, 10) <= end; date.setUTCMonth(date.getUTCMonth() + 1)) {
			const last = monthEnd(date.toISOString().slice(0, 7));
			if (last >= start && last <= end) dates.add(last);
		}
		if (end >= start) dates.add(end);
	}
	let missing = false;
	const points = [];
	for (const date of [...dates].sort()) {
		const target = date.slice(0, 7);
		const exact = date === monthEnd(target) && histories[target]?.closing_balances;
		if (!exact && snapshot.last_closed_month && target <= snapshot.last_closed_month && !options.archiveMonths?.includes(target)) { missing = true; continue; }
		const anchor = anchors.filter(key => monthEnd(key) <= date).at(-1);
		const balances = exact ? { ...exact } : anchor ? { ...histories[anchor].closing_balances } : Object.fromEntries(accounts.map(account => [account.id, Number(account.initial_balance) || 0]));
		if (!exact) for (const tx of knownTransactions) {
			if (tx.date <= date && (!anchor || tx.target_month > anchor)) applyTxToBalances(balances, tx.type, tx.account_id, tx.to_account_id, Number(tx.amount) || 0);
		}
		const totals = calculateTotalAssetSummary(balances, accounts);
		points.push({ date, net_assets: totals.net_assets, liquid_assets: totals.liquid_assets, investment_assets: totals.investment_assets, liabilities: totals.liabilities });
	}
	return { mode, points, notice: missing ? '日別明細を取得できていない過去期間は、確認できる月末残高のみ表示している。手動同期で履歴を取得できる。' : points.length ? '' : '表示できる確定履歴はない。' };
}

/**
 * Calculate balances and summaries from snapshot and transactions
 * @param {Record<string, any>} snapshot - summary_snapshot.json
 * @param {Array} transactions - all active transactions in local DB
 * @param {string} targetMonth - current selected month (YYYY-MM)
 * @returns {Record<string, any>}
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
		const normalizedByCat = {};
		if (hist?.by_category) {
			for (const [cat, val] of Object.entries(hist.by_category)) {
				normalizedByCat[cat] = typeof val === 'number' ? val : Number(val?.total ?? val?.confirmed ?? 0);
			}
		}
		const normalizedByActCat = {};
		if (hist?.by_actual_category) {
			for (const [cat, val] of Object.entries(hist.by_actual_category)) {
				normalizedByActCat[cat] = typeof val === 'number' ? val : Number(val?.total ?? val?.confirmed ?? 0);
			}
		}

		months[monthKey] = {
			month: monthKey,
			income_confirmed: hist ? (hist.income_total ?? hist.income_confirmed ?? hist.total_income ?? 0) : 0,
			income_planned: 0,
			income_total: hist ? (hist.income_total ?? hist.income_confirmed ?? hist.total_income ?? 0) : 0,
			expense_confirmed: hist ? (hist.expense_total ?? hist.expense_confirmed ?? hist.total_expense ?? 0) : 0,
			expense_planned: 0,
			expense_total: hist ? (hist.expense_total ?? hist.expense_confirmed ?? hist.total_expense ?? 0) : 0,
			net: 0,
			by_category: normalizedByCat,
			by_actual_category: normalizedByActCat
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
		const inc = hist.income_total ?? hist.income_confirmed ?? hist.total_income ?? 0;
		const exp = hist.expense_total ?? hist.expense_confirmed ?? hist.total_expense ?? 0;
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
		loan: 0,
		point: 0,
		receivable: 0,
		prepaid: 0,
		investment: 0,
		insurance: 0,
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

	const investmentTypeSet = new Set(['investment', 'insurance', 'asset', 'stock', 'mutual_fund', 'crypto']);
	const liabilityTypeSet = new Set(['credit_card', 'loan']);

	for (const [accId, balance] of Object.entries(accountBalances)) {
		const acc = accountMap.get(accId);
		const type = acc?.type || 'cash';
		const isAsset = acc?.is_asset !== false && !liabilityTypeSet.has(type);

		if (liabilityTypeSet.has(type)) {
			if (balance < 0) {
				liabilities += Math.abs(balance);
			} else if (type === 'loan' && balance > 0) {
				liabilities += balance;
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
		confirmed_balances: accountBalances,
		by_type: byType
	};
}

/**
 * Calculate Tag Summary and breakdown (Requirement 3.18)
 * @param {Array} transactions - transaction records
 * @param {object} [options]
 * @param {boolean} [options.includePlanned=true] - include planned items
 * @param {string} [options.searchQuery] - optional search filter
 * @param {string} [options.filterTag] - optional tag filter query alias
 * @param {string} [options.targetMonth] - optional target_month filter
 * @returns {{ tags: Record<string, any>, tagList: Array<Record<string, any>>, total_expense: number, total_income: number, total_count: number }}
 */
export function calculateTagSummary(transactions = [], options = {}) {
	const includePlanned = options.includePlanned !== false;
	const searchQuery = (options.searchQuery || options.filterTag || '').trim().toLowerCase();
	const targetMonth = options.targetMonth || null;

	const activeTxs = transactions.filter(t => {
		if (t.is_deleted) return false;
		if (!includePlanned && t.status === 'planned') return false;
		if (targetMonth && t.target_month !== targetMonth) return false;
		return true;
	});

	const tagsMap = {};
	let totalExpense = 0;
	let totalIncome = 0;
	let totalCount = 0;

	for (const tx of activeTxs) {
		const amt = Number(tx.amount) || 0;
		if (tx.type === 'expense') totalExpense += amt;
		if (tx.type === 'income') totalIncome += amt;
		totalCount++;

		const rawTags = Array.isArray(tx.tags) && tx.tags.length > 0 ? tx.tags : ['(未設定)'];
		for (const tag of rawTags) {
			const cleanTag = String(tag || '').trim();
			if (!cleanTag) continue;

			if (!tagsMap[cleanTag]) {
				tagsMap[cleanTag] = {
					name: cleanTag,
					tag: cleanTag,
					expense: 0,
					expense_total: 0,
					income: 0,
					income_total: 0,
					net: 0,
					net_total: 0,
					count: 0
				};
			}

			if (tx.type === 'expense') {
				tagsMap[cleanTag].expense += amt;
				tagsMap[cleanTag].expense_total += amt;
				tagsMap[cleanTag].net -= amt;
				tagsMap[cleanTag].net_total -= amt;
			} else if (tx.type === 'income') {
				tagsMap[cleanTag].income += amt;
				tagsMap[cleanTag].income_total += amt;
				tagsMap[cleanTag].net += amt;
				tagsMap[cleanTag].net_total += amt;
			}
			tagsMap[cleanTag].count += 1;
		}
	}

	// Filter by search query if present
	let filteredTags = tagsMap;
	if (searchQuery) {
		filteredTags = {};
		for (const [tag, data] of Object.entries(tagsMap)) {
			if (tag.toLowerCase().includes(searchQuery)) {
				filteredTags[tag] = data;
			}
		}
	}

	const tagList = Object.values(filteredTags).sort((a, b) => b.expense - a.expense);

	return {
		tags: filteredTags,
		tagList,
		total_expense: totalExpense,
		total_income: totalIncome,
		total_count: totalCount
	};
}

/**
 * Calculate Accrual vs Actual Cross-Aggregation Matrix (Requirement 3.23)
 * @param {Array} transactions - transaction records
 * @param {string|Array|null} [targetMonthOrCategories=null] - filter by YYYY-MM string or categories master array
 * @param {boolean} [includePlanned=true] - include planned items
 * @returns {{ matrix: object, rowTotals: object, accrualTotals: object, colTotals: object, actualTotals: object, grandTotal: number, categories: any[], categoryIds: string[], actualCategories: string[] }}
 */
export function calculateCrossAccrualActualSummary(transactions = [], targetMonthOrCategories = null, includePlanned = true) {
	let targetMonth = null;
	let categoriesList = null;

	if (Array.isArray(targetMonthOrCategories)) {
		categoriesList = targetMonthOrCategories;
	} else if (typeof targetMonthOrCategories === 'string') {
		targetMonth = targetMonthOrCategories;
	}

	const activeTxs = (transactions || []).filter(t => {
		if (t.is_deleted) return false;
		if (t.type !== 'expense') return false; // Focus on expense cross-matrix
		if (!includePlanned && t.status === 'planned') return false;
		if (targetMonth && t.target_month !== targetMonth) return false;
		return true;
	});

	const matrix = {};
	const rowTotals = {};
	const colTotals = {};
	let grandTotal = 0;
	const catSet = new Set();
	const actCatSet = new Set();

	for (const tx of activeTxs) {
		const amt = Number(tx.amount) || 0;
		const catId = tx.category_id || 'cat_unclassified';
		const actCatId = tx.actual_category_id || catId;

		catSet.add(catId);
		actCatSet.add(actCatId);

		if (!matrix[catId]) {
			matrix[catId] = { _total: 0 };
		}
		matrix[catId][actCatId] = (matrix[catId][actCatId] || 0) + amt;
		matrix[catId]._total += amt;

		rowTotals[catId] = (rowTotals[catId] || 0) + amt;
		colTotals[actCatId] = (colTotals[actCatId] || 0) + amt;
		grandTotal += amt;
	}

	return {
		matrix,
		rowTotals,
		accrualTotals: rowTotals,
		colTotals,
		actualTotals: colTotals,
		grandTotal,
		categories: categoriesList && categoriesList.length > 0
			? categoriesList.filter(c => !c.is_archived && c.type !== 'income')
			: Array.from(catSet),
		categoryIds: Array.from(catSet),
		actualCategories: Array.from(actCatSet)
	};
}

/**
 * Format Doughnut Chart Tooltip Label with Amount and Percentage (Requirement 3.28)
 * @param {string} label - slice label
 * @param {number} value - slice numeric value
 * @param {number[]} datasetValues - all values in the dataset
 * @returns {string} formatted tooltip string e.g. "食費: ¥45,000 (32.1%)"
 */
export function formatDoughnutTooltipLabel(label = '', value = 0, datasetValues = []) {
	const numVal = Math.max(0, Number(value) || 0);
	const total = (datasetValues || []).reduce((sum, v) => sum + Math.max(0, Number(v) || 0), 0);
	const pct = total > 0 ? Math.round((numVal / total) * 1000) / 10 : 0;
	const prefix = label ? `${label}: ` : '';
	return `${prefix}¥${numVal.toLocaleString()} (${pct}%)`;
}

/**
 * Resolve Transaction Primary Title (Category > Subcategory) and Secondary Metadata (Requirement 3.29)
 * @param {Record<string, any>} tx - transaction record
 * @param {Record<string, any>} [masterConfig] - master configuration with categories & subcategories
 * @returns {{ icon: string, categoryName: string, subcategoryName: string, primaryTitle: string, memo: string, tags: string[] }}
 */
export function resolveTransactionDisplayInfo(tx = {}, masterConfig = {}) {
	const categories = masterConfig?.categories || [];
	const rootSubcategories = masterConfig?.subcategories || [];

	if (tx.type === 'transfer') {
		return {
			icon: '🔄',
			categoryName: '資金移動・振替',
			subcategoryName: '',
			primaryTitle: '🔄 資金移動・振替',
			memo: String(tx.memo || '').trim(),
			tags: Array.isArray(tx.tags) ? tx.tags.filter(Boolean) : []
		};
	}

	const catId = tx.category_id || '';
	const subId = tx.subcategory_id || '';
	const catObj = categories.find(c => c.id === catId);

	let subObj = null;
	if (catObj && Array.isArray(catObj.subcategories)) {
		subObj = catObj.subcategories.find(s => s.id === subId);
	}
	if (!subObj && subId) {
		subObj = rootSubcategories.find(s => s.id === subId);
		if (!subObj) {
			for (const c of categories) {
				if (Array.isArray(c.subcategories)) {
					const found = c.subcategories.find(s => s.id === subId);
					if (found) {
						subObj = found;
						break;
					}
				}
			}
		}
	}

	const icon = catObj?.icon || (tx.type === 'income' ? '💰' : '🏷️');
	const categoryName = catObj?.name || (catId || '未分類');
	const subcategoryName = subObj?.name || (subId || '');

	const primaryTitle = subcategoryName
		? `${icon} ${categoryName} > ${subcategoryName}`
		: `${icon} ${categoryName}`;

	return {
		icon,
		categoryName,
		subcategoryName,
		primaryTitle,
		memo: String(tx.memo || '').trim(),
		tags: Array.isArray(tx.tags) ? tx.tags.filter(Boolean) : []
	};
}

/**
 * Filter Transactions by Multi-Criteria: Status, Account, Category, Tag, and Keyword (Requirement 3.30 & 3.38)
 * @param {Array} transactions - list of transactions
 * @param {object} [filters]
 * @param {string} [filters.status='all'] - 'all' | 'confirmed' | 'planned'
 * @param {boolean} [filters.includePlanned=true] - whether to include planned transactions when status is 'all'
 * @param {string} [filters.accountId='all'] - 'all' or account ID (matches account_id or to_account_id)
 * @param {string} [filters.categoryId='all'] - 'all' or category ID (matches category_id or actual_category_id)
 * @param {string} [filters.tag='all'] - 'all' or tag string
 * @param {string} [filters.keyword=''] - case-insensitive keyword matching memo, category, subcategory, or tags
 * @param {Record<string, any>} [masterConfig] - master configuration for resolving category/subcategory names during keyword search
 * @returns {Array} filtered transactions
 */
export function filterTransactionsByCriteria(transactions = [], filters = {}, masterConfig = {}) {
	const status = filters.status || 'all';
	const includePlanned = filters.includePlanned !== undefined ? Boolean(filters.includePlanned) : true;
	const accountId = filters.accountId || 'all';
	const categoryId = filters.categoryId || 'all';
	const tag = filters.tag || 'all';
	const keyword = String(filters.keyword || '').trim().toLowerCase();

	return (transactions || []).filter(tx => {
		if (!tx || tx.is_deleted) return false;

		if (status === 'confirmed' && tx.status !== 'confirmed') return false;
		if (status === 'planned' && tx.status !== 'planned') return false;
		if (status === 'all' && !includePlanned && tx.status === 'planned') return false;

		if (accountId !== 'all') {
			const matchAccount = tx.account_id === accountId || tx.to_account_id === accountId;
			if (!matchAccount) return false;
		}

		if (categoryId !== 'all') {
			const matchAccrual = tx.category_id === categoryId;
			const matchActual = tx.actual_category_id === categoryId;
			if (!matchAccrual && !matchActual) return false;
		}

		if (tag !== 'all') {
			const txTags = Array.isArray(tx.tags) ? tx.tags : [];
			if (!txTags.includes(tag)) return false;
		}

		if (keyword) {
			const display = resolveTransactionDisplayInfo(tx, masterConfig);
			const searchable = [
				display.categoryName,
				display.subcategoryName,
				display.memo,
				...display.tags
			].join(' ').toLowerCase();
			if (!searchable.includes(keyword)) return false;
		}

		return true;
	});
}

