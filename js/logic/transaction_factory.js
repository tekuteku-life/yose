/**
 * Yoseatsume Kakeibo - Transaction Factory & Tax Calculation Module
 * Handles tax calculation, recurring scheduled transaction generation,
 * prepaid amortization splits, advance payments/repayments, and point-split payments.
 */

import {
	formatDate,
	addMonthsToMonthStr,
	getLastDayOfMonth,
	adjustDateForHoliday,
	generateUUID
} from './date_utils.js';

// An omitted child inherits only within the same parent; explicit empty values stay empty.
function actualChild(categoryId, subcategoryId, actualCategoryId, actualSubcategoryId) {
	return actualSubcategoryId !== undefined ? actualSubcategoryId : (actualCategoryId || categoryId) === categoryId ? (subcategoryId ?? null) : null;
}


function scheduledId(prefix, ownerId, period) {
	const owner = encodeURIComponent(ownerId);
	return `${prefix}_${owner.length}_${owner}_${period}`;
}

/**
 * Tax Calculation Helper
 * @param {number} baseAmount - Tax excluded amount
 * @param {number} taxRate - e.g. 0.08 or 0.10
 * @param {"floor" | "round"} rounding - Rounding method
 * @returns {{ amount: number, tax_meta: Record<string, any> }}
 */
export function calculateTax(baseAmount, taxRate = 0.10, rounding = 'floor') {
	const numBase = Math.round(Number(baseAmount) || 0);
	const rawTax = numBase * taxRate;
	const tax = rounding === 'round' ? Math.round(rawTax) : Math.floor(rawTax);
	const totalAmount = numBase + tax;

	return {
		amount: totalAmount,
		tax_meta: {
			input_mode: 'tax_excluded',
			base_amount: numBase,
			tax_amount: tax,
			tax_rate: taxRate,
			rounding: rounding
		}
	};
}

/**
 * Generate recurring scheduled transactions for a target month
 * @param {Array} recurringRules
 * @param {string} targetMonth - YYYY-MM
 * @param {string[]} holidays
 * @param {Array} existingTransactions
 * @param {string} [todayStr] - YYYY-MM-DD
 * @returns {Array} generated planned transactions
 */
export function generateRecurringTransactions(
	recurringRules,
	targetMonth,
	holidays = [],
	existingTransactions = [],
	todayStr = formatDate(new Date())
) {
	if (!Array.isArray(recurringRules) || !targetMonth) {
		return [];
	}

	const [tYear, tMonth] = targetMonth.split('-').map(Number);
	const generated = [];

	for (const rule of recurringRules) {
		if (!rule.is_active) continue;

		// Check start and end date
		if (rule.start_date) {
			const startMonth = rule.start_date.slice(0, 7);
			if (targetMonth < startMonth) continue;
		}
		if (rule.end_date) {
			const endMonth = rule.end_date.slice(0, 7);
			if (targetMonth > endMonth) continue;
		}

		// Interval months check
		if (rule.frequency === 'interval_months' && rule.start_date && (rule.interval_months || 1) > 1) {
			const [sYear, sMonth] = rule.start_date.slice(0, 7).split('-').map(Number);
			const diffMonths = (tYear - sYear) * 12 + (tMonth - sMonth);
			if (diffMonths < 0 || diffMonths % rule.interval_months !== 0) {
				continue;
			}
		}

		// Check if already generated for this rule and target month
		const alreadyExists = existingTransactions.some(
			tx => tx.recurring_rule_id === rule.id &&
				tx.target_month === targetMonth &&
				!tx.is_deleted
		);
		if (alreadyExists) continue;

		// Compute scheduled day
		const lastDay = getLastDayOfMonth(tYear, tMonth);
		let day = rule.day_of_month || 1;
		if (day >= 31 || day > lastDay) {
			day = lastDay;
		}

		const scheduledDateStr = `${tYear}-${String(tMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		const adjustedDateStr = adjustDateForHoliday(scheduledDateStr, rule.holiday_adjustment || 'none', holidays);

		const nowIso = new Date().toISOString();
		const tx = {
			id: scheduledId('tx_rec', rule.id, targetMonth),
			group_id: `grp_rec_${rule.id}_${targetMonth}`,
			date: adjustedDateStr,
			target_month: targetMonth,
			status: 'planned',
			type: rule.type || 'expense',
			amount: rule.amount || 0,
			tax_meta: null,
			account_id: rule.account_id,
			to_account_id: rule.to_account_id || null,
			category_id: rule.category_id || null,
			subcategory_id: rule.subcategory_id || null,
			actual_category_id: rule.actual_category_id || rule.category_id || null,
			actual_subcategory_id: actualChild(rule.category_id, rule.subcategory_id, rule.actual_category_id, rule.actual_subcategory_id),
			recurring_rule_id: rule.id,
			amortization_meta: null,
			memo: rule.memo || rule.name || '定期支出',
			tags: ['定期'],
			created_at: nowIso,
			updated_at: nowIso,
			is_deleted: false,
			sync_status: 'unsynced'
		};

		generated.push(tx);
	}

	return generated;
}

/**
 * Create transactions for Annual / Lump-sum prepaid split amortization (前払費用の月次償却)
 * Requirements:
 * 1. Payment record (1 record): Transfer from paying account to acc_prepaid (full amount, confirmed)
 * 2. Monthly amortization records (N records): Expense from acc_prepaid (each month, 1st confirmed, rest planned)
 * 3. Remainder adjustment rule: 2nd month and later = Math.floor(total / months), remainder added to 1st month.
 */
export function createPrepaidAmortizationTransactions({
	paymentDate,
	totalAmount,
	payingAccountId,
	categoryId,
	subcategoryId,
	actualCategoryId,
	actualSubcategoryId,
	amortizeMonths = 12,
	memo = '',
	tags = [],
	todayMonth = formatDate(new Date()).slice(0, 7)
}) {
	const total = Math.round(Number(totalAmount) || 0);
	const months = Math.max(1, Math.round(Number(amortizeMonths) || 1));
	const groupId = generateUUID('grp_prepaid');
	const nowIso = new Date().toISOString();
	const paymentTargetMonth = paymentDate.slice(0, 7);

	// 1. Payment Record
	const paymentTx = {
		id: generateUUID('tx_prep_pay'),
		group_id: groupId,
		date: paymentDate,
		target_month: paymentTargetMonth,
		status: 'confirmed',
		type: 'transfer',
		amount: total,
		tax_meta: null,
		account_id: payingAccountId,
		to_account_id: 'acc_prepaid',
		category_id: null,
		subcategory_id: null,
		actual_category_id: null,
		actual_subcategory_id: null,
		recurring_rule_id: null,
		amortization_meta: {
			is_payment_record: true,
			total_amount: total,
			amortize_months: months
		},
		memo: memo ? `[前払一括支払] ${memo}` : '[前払一括支払]',
		tags: [...tags, '前払費用支払'],
		created_at: nowIso,
		updated_at: nowIso,
		is_deleted: false,
		sync_status: 'unsynced'
	};

	// 2. Amortization Records
	const monthlyBase = Math.floor(total / months);
	const remainder = total - (monthlyBase * months);
	const amortRecords = [];

	for (let i = 0; i < months; i++) {
		const amortTargetMonth = addMonthsToMonthStr(paymentTargetMonth, i);
		const amount = i === 0 ? monthlyBase + remainder : monthlyBase;
		const isPastOrCurrent = amortTargetMonth <= todayMonth;
		const amortStatus = isPastOrCurrent ? 'confirmed' : 'planned';

		const [y, m] = amortTargetMonth.split('-');
		const amortDate = `${y}-${m}-01`;

		const amortTx = {
			id: generateUUID('tx_prep_amort'),
			group_id: groupId,
			date: amortDate,
			target_month: amortTargetMonth,
			status: amortStatus,
			type: 'expense',
			amount: amount,
			tax_meta: null,
			account_id: 'acc_prepaid',
			to_account_id: null,
			category_id: categoryId,
			subcategory_id: subcategoryId,
			actual_category_id: actualCategoryId || categoryId,
			actual_subcategory_id: actualChild(categoryId, subcategoryId, actualCategoryId, actualSubcategoryId),
			recurring_rule_id: null,
			amortization_meta: {
				is_payment_record: false,
				total_amount: total,
				total_months: months,
				current_month_index: i + 1,
				original_payment_date: paymentDate
			},
			memo: memo ? `[前払分割 ${i + 1}/${months}] ${memo}` : `[前払分割 ${i + 1}/${months}]`,
			tags: [...tags, '前払償却'],
			created_at: nowIso,
			updated_at: nowIso,
			is_deleted: false,
			sync_status: 'unsynced'
		};

		amortRecords.push(amortTx);
	}

	return [paymentTx, ...amortRecords];
}

/**
 * Create Advance Payment Transactions (立替払い)
 * 1. Self expense
 * 2. Advance transfer from paying account to acc_receivable
 */
export function createAdvancePaymentTransactions({
	includeEmpty = false,
	date,
	payingAccountId,
	selfAmount = 0,
	advanceAmount = 0,
	categoryId,
	subcategoryId,
	actualCategoryId,
	actualSubcategoryId,
	taxMeta = null,
	memo = '',
	tags = []
}) {
	const groupId = generateUUID('grp_advance');
	const nowIso = new Date().toISOString();
	const targetMonth = date.slice(0, 7);
	const records = [];

	// Self expense
	if (selfAmount > 0 || includeEmpty) {
		records.push({
			id: generateUUID('tx_adv_self'),
			group_id: groupId,
			date: date,
			target_month: targetMonth,
			status: 'confirmed',
			type: 'expense',
			amount: Math.round(selfAmount),
			tax_meta: taxMeta,
			account_id: payingAccountId,
			to_account_id: null,
			category_id: categoryId,
			subcategory_id: subcategoryId,
			actual_category_id: actualCategoryId || categoryId,
			actual_subcategory_id: actualChild(categoryId, subcategoryId, actualCategoryId, actualSubcategoryId),
			recurring_rule_id: null,
			amortization_meta: null,
			memo: memo ? `[自己負担] ${memo}` : '[自己負担]',
			tags: [...tags],
			created_at: nowIso,
			updated_at: nowIso,
			is_deleted: false,
			sync_status: 'unsynced'
		});
	}

	// Advance loan to receivable
	if (advanceAmount > 0 || includeEmpty) {
		records.push({
			id: generateUUID('tx_adv_loan'),
			group_id: groupId,
			date: date,
			target_month: targetMonth,
			status: 'confirmed',
			type: 'transfer',
			amount: Math.round(advanceAmount),
			tax_meta: null,
			account_id: payingAccountId,
			to_account_id: 'acc_receivable',
			category_id: null,
			subcategory_id: null,
			actual_category_id: null,
			actual_subcategory_id: null,
			recurring_rule_id: null,
			amortization_meta: null,
			memo: memo ? `[立替分] ${memo}` : '[立替分]',
			tags: [...tags, '立替'],
			created_at: nowIso,
			updated_at: nowIso,
			is_deleted: false,
			sync_status: 'unsynced'
		});
	}

	return records;
}

/**
 * Create Advance Repayment Transaction (立替金回収)
 * Transfer from acc_receivable to receiving account
 */
export function createAdvanceRepaymentTransaction({
	date,
	receivingAccountId,
	amount,
	memo = '',
	tags = []
}) {
	const nowIso = new Date().toISOString();
	return {
		id: generateUUID('tx_adv_repay'),
		group_id: generateUUID('grp_repay'),
		date: date,
		target_month: date.slice(0, 7),
		status: 'confirmed',
		type: 'transfer',
		amount: Math.round(amount),
		tax_meta: null,
		account_id: 'acc_receivable',
		to_account_id: receivingAccountId,
		category_id: null,
		subcategory_id: null,
		actual_category_id: null,
		actual_subcategory_id: null,
		recurring_rule_id: null,
		amortization_meta: null,
		memo: memo || '立替回収',
		tags: Array.from(new Set([...tags, '立替回収'])),
		created_at: nowIso,
		updated_at: nowIso,
		is_deleted: false,
		sync_status: 'unsynced'
	};
}

/**
 * Create linked point payment transactions
 * @param {Record<string, any>} params
 * @returns {object[]} array of 2 linked transactions
 */
export function createPointPaymentTransactions({
	date,
	totalAmount,
	pointAmount,
	pointUsed,
	paymentAccountId,
	payingAccountId,
	pointAccountId = null,
	categoryId = 'cat_daily',
	subcategoryId = null,
	actualCategoryId = null,
	actualSubcategoryId = undefined,
	taxMeta = null,
	memo = '',
	tags = []
}) {
	const total = Math.round(Number(totalAmount) || 0);
	const point = Math.round(Number(pointAmount ?? pointUsed) || 0);
	if (point < 0 || point > total) throw new Error('ポイント利用額は0以上、購入総額以下にしてください。');
	const selfAmount = Math.max(0, total - point);
	const targetMonth = date.slice(0, 7);
	const nowIso = new Date().toISOString();
	const payAcc = paymentAccountId || payingAccountId;

	const buyId = generateUUID('tx_pt_buy');
	const offsetId = generateUUID('tx_pt_off');

	// Case A: Using a dedicated point account (e.g. acc_point)
	if (pointAccountId) {
		const txSelf = {
			id: buyId,
			date,
			target_month: targetMonth,
			type: 'expense',
			amount: selfAmount,
			tax_meta: taxMeta,
			account_id: payAcc,
			to_account_id: null,
			category_id: categoryId,
			subcategory_id: subcategoryId,
			actual_category_id: actualCategoryId || categoryId,
			actual_subcategory_id: actualChild(categoryId, subcategoryId, actualCategoryId, actualSubcategoryId),
			recurring_rule_id: null,
			amortization_meta: null,
			memo: memo ? `${memo} (自己負担分)` : 'ポイント併用購入 (決済分)',
			tags: [...tags, 'ポイント併用'],
			is_point_split: true,
			related_tx_id: offsetId,
			status: 'confirmed',
			sync_status: 'unsynced',
			is_deleted: false,
			created_at: nowIso,
			updated_at: nowIso
		};

		const txPoint = {
			id: offsetId,
			date,
			target_month: targetMonth,
			type: 'expense',
			amount: point,
			account_id: pointAccountId,
			to_account_id: null,
			category_id: categoryId,
			subcategory_id: subcategoryId,
			actual_category_id: actualCategoryId || categoryId,
			actual_subcategory_id: actualChild(categoryId, subcategoryId, actualCategoryId, actualSubcategoryId),
			recurring_rule_id: null,
			amortization_meta: null,
			memo: memo ? `${memo} (ポイント利用分)` : 'ポイント利用分',
			tags: [...tags, 'ポイント併用'],
			is_point_split: true,
			related_tx_id: buyId,
			status: 'confirmed',
			sync_status: 'unsynced',
			is_deleted: false,
			created_at: nowIso,
			updated_at: nowIso
		};

		return [txSelf, txPoint];
	}

	// Case B: Point offset on the payment account (Purchase expense + Point discount/income offset)
	const txPurchase = {
		id: buyId,
		date,
		target_month: targetMonth,
		type: 'expense',
		amount: total,
		tax_meta: taxMeta,
		account_id: payAcc,
		to_account_id: null,
		category_id: categoryId,
		subcategory_id: subcategoryId,
		actual_category_id: actualCategoryId || categoryId,
		actual_subcategory_id: actualChild(categoryId, subcategoryId, actualCategoryId, actualSubcategoryId),
		recurring_rule_id: null,
		amortization_meta: null,
		memo: memo ? `${memo} (購入全額)` : 'ポイント併用購入 (全額)',
		tags: [...tags, 'ポイント併用'],
		is_point_split: true,
		related_tx_id: offsetId,
		status: 'confirmed',
		sync_status: 'unsynced',
		is_deleted: false,
		created_at: nowIso,
		updated_at: nowIso
	};

	const txOffset = {
		id: offsetId,
		date,
		target_month: targetMonth,
		type: 'income',
		amount: point,
		account_id: payAcc,
		to_account_id: null,
		category_id: 'cat_point_income',
		subcategory_id: 'sub_point_offset',
		actual_category_id: 'cat_point_income',
		actual_subcategory_id: 'sub_point_offset',
		recurring_rule_id: null,
		amortization_meta: null,
		memo: memo ? `${memo} (ポイント相殺)` : 'ポイント相殺分',
		tags: [...tags, 'ポイント併用'],
		is_point_split: true,
		related_tx_id: buyId,
		status: 'confirmed',
		sync_status: 'unsynced',
		is_deleted: false,
		created_at: nowIso,
		updated_at: nowIso
	};

	return [txPurchase, txOffset];
}

/**
 * Create Credit Card Settlement Transfer Transaction (Requirement 3.21)
 * @param {object} params
 * @param {string} params.payingAccountId - e.g. 'acc_bank_main'
 * @param {string} params.creditCardId - e.g. 'acc_card_a'
 * @param {number} params.amount - settlement amount
 * @param {string} params.debitDate - YYYY-MM-DD
 * @param {string} params.billingCycle - YYYY-MM
 * @param {string} [params.todayStr] - YYYY-MM-DD
 */
export function createCreditCardSettlementTransaction({
	payingAccountId,
	creditCardId,
	amount,
	debitDate,
	billingCycle,
	todayStr = formatDate(new Date())
}) {
	const nowIso = new Date().toISOString();
	const numAmount = Math.round(Number(amount) || 0);

	return {
		id: scheduledId('tx_cc_settle', creditCardId, billingCycle),
		group_id: scheduledId('grp_cc_settle', creditCardId, billingCycle),
		date: debitDate,
		target_month: debitDate.slice(0, 7),
		status: 'confirmed',
		type: 'transfer',
		amount: numAmount,
		tax_meta: null,
		account_id: payingAccountId,
		to_account_id: creditCardId,
		category_id: null,
		subcategory_id: null,
		actual_category_id: null,
		actual_subcategory_id: null,
		recurring_rule_id: null,
		amortization_meta: null,
		auto_settlement_meta: {
			card_id: creditCardId,
			billing_cycle: billingCycle,
			debit_account_id: payingAccountId
		},
		memo: `[クレカ引落相殺] ${billingCycle}利用分`,
		tags: ['クレカ引落', '口座振替'],
		created_at: nowIso,
		updated_at: nowIso,
		is_deleted: false,
		sync_status: 'unsynced'
	};
}

/**
 * Evaluate Calculator Expression safely with optional Tax Action (Requirement 3.25)
 * @param {string} expression - e.g. "1500 + 500", "200 × 5"
 * @param {string|null} [taxAction] - '+10%', '+8%', 'inc10%', 'inc8%'
 * @param {'floor'|'round'} [rounding] - 'floor' or 'round'
 * @returns {{ success: boolean, amount: number, result: number, base_amount: number, tax_meta: Record<string, any>|null, error?: string }}
 */
export function evaluateCalculatorExpression(expression = '', taxAction = null, rounding = 'floor') {
	let raw = String(expression || '').trim();
	if (!raw) {
		return { success: true, amount: 0, result: 0, base_amount: 0, tax_meta: null };
	}

	// Normalize arithmetic symbols
	raw = raw.replace(/×/g, '*').replace(/÷/g, '/');

	// Disallow any characters other than digits, operators, spaces, parentheses, decimal points
	if (/[^0-9+\-*/().\s]/.test(raw)) {
		return { success: false, amount: 0, result: 0, base_amount: 0, tax_meta: null, error: 'Invalid characters in expression' };
	}

	let evaluated = 0;
	try {
		const fn = new Function(`"use strict"; return (${raw});`);
		const val = fn();
		if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
			return { success: false, amount: 0, result: 0, base_amount: 0, tax_meta: null, error: 'Division by zero' };
		}
		evaluated = Math.round(val);
	} catch (err) {
		return { success: false, amount: 0, result: 0, base_amount: 0, tax_meta: null, error: err.message };
	}

	let finalAmount = evaluated;
	let baseAmount = evaluated;
	let taxMeta = null;

	if (taxAction) {
		if (taxAction === '+10%' || taxAction === 'add10' || taxAction === '+8%' || taxAction === 'add8') {
			const rate = (taxAction === '+10%' || taxAction === 'add10') ? 0.10 : 0.08;
			const res = calculateTax(evaluated, rate, rounding);
			finalAmount = res.amount;
			baseAmount = res.tax_meta.base_amount;
			taxMeta = res.tax_meta;
		} else if (taxAction === 'inc10%' || taxAction === 'sub10' || taxAction === 'inc8%' || taxAction === 'sub8') {
			const rate = (taxAction === 'inc10%' || taxAction === 'sub10') ? 0.10 : 0.08;
			const factor = (taxAction === 'inc10%' || taxAction === 'sub10') ? (10 / 110) : (8 / 108);
			const rawTax = evaluated * factor;
			const tax = rounding === 'round' ? Math.round(rawTax) : Math.floor(rawTax);
			baseAmount = evaluated - tax;
			finalAmount = evaluated;
			taxMeta = {
				input_mode: 'tax_included_extracted',
				base_amount: baseAmount,
				tax_amount: tax,
				tax_rate: rate,
				rounding
			};
		}
	}

	const safeFinal = Math.max(0, finalAmount);
	return {
		success: true,
		amount: safeFinal,
		result: safeFinal,
		base_amount: Math.max(0, baseAmount),
		tax_meta: taxMeta
	};
}

/**
 * Synchronize an Insurance Account's recurring expense rule (`rec_ins_<id>`) in master_config (Requirement 3.35).
 * Automatically creates, updates, or deactivates the linked recurring rule when an insurance account is saved/updated.
 * @param {Record<string, any>} config - master_config object
 * @param {Record<string, any>} account - account object from master_config.accounts
 * @param {string} [todayStr] - YYYY-MM-DD
 * @returns {object|null} the created/updated recurring rule, or null
 */
export function syncInsuranceRecurringRule(config, account, todayStr = formatDate(new Date())) {
	if (!config || !account || !account.id) return null;
	if (!Array.isArray(config.recurring_rules)) {
		config.recurring_rules = [];
	}

	const ruleId = `rec_ins_${account.id}`;
	const existingIdx = config.recurring_rules.findIndex(r => r && r.id === ruleId);
	const premiumAmount = Math.max(0, Math.round(Number(account.premium_amount) || 0));
	const isInsuranceActive = account.type === 'insurance' && !account.is_archived && premiumAmount > 0 && Boolean(account.premium_pay_account_id);

	if (!isInsuranceActive) {
		if (existingIdx !== -1) {
			config.recurring_rules[existingIdx].is_active = false;
			return config.recurring_rules[existingIdx];
		}
		return null;
	}

	const ruleObj = {
		id: ruleId,
		name: `[保険料] ${account.name || account.id}`,
		type: 'expense',
		amount: premiumAmount,
		account_id: account.premium_pay_account_id,
		to_account_id: null,
		category_id: account.premium_category_id || (config.categories?.[0]?.id || 'cat_food'),
		subcategory_id: account.premium_subcategory_id || '',
		actual_category_id: account.premium_category_id || (config.categories?.[0]?.id || 'cat_food'),
		actual_subcategory_id: account.premium_subcategory_id || '',
		frequency: 'monthly',
		interval_months: 1,
		day_of_month: Math.min(31, Math.max(1, Math.round(Number(account.premium_day) || 27))),
		holiday_adjustment: 'after',
		start_date: existingIdx !== -1 && config.recurring_rules[existingIdx].start_date
			? config.recurring_rules[existingIdx].start_date
			: `${todayStr.slice(0, 7)}-01`,
		end_date: account.maturity_date || null,
		is_active: true,
		linked_insurance_account_id: account.id
	};

	if (existingIdx !== -1) {
		config.recurring_rules[existingIdx] = {
			...config.recurring_rules[existingIdx],
			...ruleObj
		};
		return config.recurring_rules[existingIdx];
	} else {
		config.recurring_rules.push(ruleObj);
		return ruleObj;
	}
}


