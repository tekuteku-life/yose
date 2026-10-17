/**
 * Yoseatsume Kakeibo - Core Financial & Calculation Logic (Schema v2)
 */

/**
 * Format Date object to YYYY-MM-DD
 */
export function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Parse YYYY-MM-DD to Date in local time
 */
export function parseDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Add months to a YYYY-MM string
 */
export function addMonthsToMonthStr(monthStr, monthsToAdd) {
  const [y, m] = monthStr.split('-').map(Number);
  const totalMonths = (y * 12 + (m - 1)) + monthsToAdd;
  const newY = Math.floor(totalMonths / 12);
  const newM = (totalMonths % 12) + 1;
  return `${newY}-${String(newM).padStart(2, '0')}`;
}

/**
 * Get last day of month for a given year and month (1-indexed month)
 */
export function getLastDayOfMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/**
 * Check if a date string (YYYY-MM-DD) is Saturday or Sunday
 */
export function isWeekend(dateStr) {
  const d = parseDate(dateStr);
  const day = d.getDay();
  return day === 0 || day === 6;
}

/**
 * Check if a date string is in the holidays list
 */
export function isHoliday(dateStr, holidays = []) {
  return Array.isArray(holidays) && holidays.includes(dateStr);
}

/**
 * Check if a date string is a business day (not weekend and not holiday)
 */
export function isBusinessDay(dateStr, holidays = []) {
  return !isWeekend(dateStr) && !isHoliday(dateStr, holidays);
}

/**
 * Adjust date for weekends and Japanese holidays based on rule
 * @param {string} dateStr - YYYY-MM-DD
 * @param {"none" | "before" | "after"} adjustmentRule
 * @param {string[]} holidays
 * @returns {string} adjusted date string (YYYY-MM-DD)
 */
export function adjustDateForHoliday(dateStr, adjustmentRule = 'none', holidays = []) {
  if (!adjustmentRule || adjustmentRule === 'none') {
    return dateStr;
  }

  const d = parseDate(dateStr);

  if (adjustmentRule === 'before') {
    while (!isBusinessDay(formatDate(d), holidays)) {
      d.setDate(d.getDate() - 1);
    }
  } else if (adjustmentRule === 'after') {
    while (!isBusinessDay(formatDate(d), holidays)) {
      d.setDate(d.getDate() + 1);
    }
  }

  return formatDate(d);
}

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
 * Generate a unique ID with optional prefix
 */
export function generateUUID(prefix = 'tx') {
  const rnd = Math.random().toString(36).substring(2, 9);
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}_${rnd}`;
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

    // Date can shift across month boundary, but target_month remains targetMonth
    const status = 'planned';

    const nowIso = new Date().toISOString();
    const tx = {
      id: generateUUID('tx_rec'),
      group_id: `grp_rec_${rule.id}_${targetMonth}`,
      date: adjustedDateStr,
      target_month: targetMonth,
      status: status,
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
    
    // Scheduled date for amortization: 1st of that month or same day of payment
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
 * Built-in Japanese Public Holidays Preset (2024 - 2028)
 */
export const JAPANESE_HOLIDAYS_PRESET = [
  // 2024
  '2024-01-01', '2024-01-08', '2024-02-11', '2024-02-12', '2024-02-23',
  '2024-03-20', '2024-04-29', '2024-05-03', '2024-05-04', '2024-05-05', '2024-05-06',
  '2024-07-15', '2024-08-11', '2024-08-12', '2024-09-16', '2024-09-22', '2024-09-23',
  '2024-10-14', '2024-11-03', '2024-11-04', '2024-11-23',
  // 2025
  '2025-01-01', '2025-01-13', '2025-02-11', '2025-02-23', '2025-02-24',
  '2025-03-20', '2025-04-29', '2025-05-03', '2025-05-04', '2025-05-05', '2025-05-06',
  '2025-07-21', '2025-08-11', '2025-09-15', '2025-09-23',
  '2025-10-13', '2025-11-03', '2025-11-23', '2025-11-24',
  // 2026
  '2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23',
  '2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
  '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
  '2026-10-12', '2026-11-03', '2026-11-23',
  // 2027
  '2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23',
  '2027-03-21', '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05',
  '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
  '2027-10-11', '2027-11-03', '2027-11-23',
  // 2028
  '2028-01-01', '2028-01-10', '2028-02-11', '2028-02-23',
  '2028-03-20', '2028-04-29', '2028-05-03', '2028-05-04', '2028-05-05',
  '2028-07-17', '2028-08-11', '2028-09-18', '2028-09-22',
  '2028-10-09', '2028-11-03', '2028-11-23'
];

/**
 * Parse text, CSV, or JSON string containing holiday dates
 * @param {string} raw - user input, CSV string, or JSON
 * @returns {string[]} sorted, unique array of YYYY-MM-DD date strings
 */
export function parseHolidayTextOrCsv(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const found = new Set();

  // Try JSON parse first
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach(item => {
        if (typeof item === 'string') {
          const m = item.match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/);
          if (m) found.add(normalizeDateStr(m[0]));
        } else if (item && typeof item === 'object') {
          const dateVal = item.date || item.Date || item.holiday_date;
          if (dateVal) {
            const m = String(dateVal).match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/);
            if (m) found.add(normalizeDateStr(m[0]));
          }
        }
      });
    } else if (parsed && typeof parsed === 'object') {
      // e.g. { "2026-01-01": "元日", ... }
      Object.keys(parsed).forEach(k => {
        const m = k.match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/);
        if (m) found.add(normalizeDateStr(m[0]));
      });
    }
  } catch (e) {
    // Not JSON, parse line by line or CSV regex
  }

  // Regex scan across text/CSV
  const regex = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    found.add(`${y}-${m}-${d}`);
  }

  return Array.from(found).sort();
}

function normalizeDateStr(str) {
  const [y, m, d] = str.replace(/\//g, '-').split('-');
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
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
/**
 * Groups a list of holiday date strings by year in ascending order.
 * @param {string[]} holidays
 * @returns {Record<string, string[]>}
 */
export function groupHolidaysByYear(holidays) {
  if (!Array.isArray(holidays)) return {};
  const groups = {};
  for (const h of holidays) {
    if (typeof h === 'string' && /^\d{4}-\d{2}-\d{2}/.test(h)) {
      const year = h.slice(0, 4);
      if (!groups[year]) groups[year] = [];
      groups[year].push(h);
    }
  }
  for (const y of Object.keys(groups)) {
    groups[y].sort();
  }
  return groups;
}

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

/**
 * Safely escape HTML characters to prevent XSS injection
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

