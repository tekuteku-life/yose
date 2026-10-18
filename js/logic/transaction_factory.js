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

/**
 * Tax Calculation Helper
 * @param {number} baseAmount - Tax excluded amount
 * @param {number} taxRate - e.g. 0.08 or 0.10
 * @param {"floor" | "round"} rounding - Rounding method
 * @returns {{ amount: number, tax_meta: object }}
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
			id: generateUUID('tx_rec'),
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
			actual_subcategory_id: rule.actual_subcategory_id || rule.subcategory_id || null,
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
			actual_subcategory_id: actualSubcategoryId || subcategoryId,
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
	if (selfAmount > 0) {
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
			actual_subcategory_id: actualSubcategoryId || subcategoryId,
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
	if (advanceAmount > 0) {
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
		memo: memo ? `[立替回収] ${memo}` : '[立替回収]',
		tags: [...tags, '立替回収'],
		created_at: nowIso,
		updated_at: nowIso,
		is_deleted: false,
		sync_status: 'unsynced'
	};
}

/**
 * Create linked point payment transactions
 * @param {object} params
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
	actualSubcategoryId = null,
	taxMeta = null,
	memo = '',
	tags = []
}) {
	const total = Math.round(Number(totalAmount) || 0);
	const point = Math.round(Number(pointAmount ?? pointUsed) || 0);
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
			actual_subcategory_id: actualSubcategoryId || subcategoryId,
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
			actual_subcategory_id: actualSubcategoryId || subcategoryId,
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
		actual_subcategory_id: actualSubcategoryId || subcategoryId,
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

