import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	formatDate,
	parseDate,
	addMonthsToMonthStr,
	getLastDayOfMonth,
	isWeekend,
	isHoliday,
	isBusinessDay,
	adjustDateForHoliday,
	calculateTax,
	generateUUID,
	generateRecurringTransactions,
	createPrepaidAmortizationTransactions,
	createAdvancePaymentTransactions,
	createAdvanceRepaymentTransaction,
	calculateBalancesAndSummaries,
	parseHolidayTextOrCsv,
	createPointPaymentTransactions,
	aggregateDailySummaries,
	aggregateMonthlySummaries,
	aggregateYearlySummaries,
	calculateTotalAssetSummary,
	escapeHtml,
	JAPANESE_HOLIDAYS_PRESET
} from '../../js/logic.js';

describe('js/logic.js - Unit Tests', () => {
	describe('Date Helpers', () => {
		it('formatDate formats Date object to YYYY-MM-DD with zero-padding', () => {
			const d = new Date(2026, 4, 3); // May 3, 2026
			assert.equal(formatDate(d), '2026-05-03');
		});

		it('parseDate parses YYYY-MM-DD to local Date', () => {
			const d = parseDate('2026-10-16');
			assert.equal(d.getFullYear(), 2026);
			assert.equal(d.getMonth(), 9); // 0-indexed October
			assert.equal(d.getDate(), 16);
		});

		it('addMonthsToMonthStr handles additions and subtractions across years', () => {
			assert.equal(addMonthsToMonthStr('2026-10', 0), '2026-10');
			assert.equal(addMonthsToMonthStr('2026-10', 2), '2026-12');
			assert.equal(addMonthsToMonthStr('2026-10', 3), '2027-01');
			assert.equal(addMonthsToMonthStr('2026-01', -1), '2025-12');
			assert.equal(addMonthsToMonthStr('2026-05', -6), '2025-11');
		});

		it('getLastDayOfMonth returns correct last day of month including leap years', () => {
			assert.equal(getLastDayOfMonth(2026, 1), 31);
			assert.equal(getLastDayOfMonth(2026, 2), 28);
			assert.equal(getLastDayOfMonth(2024, 2), 29); // leap year
			assert.equal(getLastDayOfMonth(2026, 4), 30);
		});

		it('isWeekend identifies Saturday and Sunday', () => {
			// 2026-10-17 is Saturday, 2026-10-18 is Sunday, 2026-10-19 is Monday
			assert.equal(isWeekend('2026-10-17'), true);
			assert.equal(isWeekend('2026-10-18'), true);
			assert.equal(isWeekend('2026-10-19'), false);
		});

		it('isHoliday checks if date is in holiday list', () => {
			const holidays = ['2026-01-01', '2026-10-12'];
			assert.equal(isHoliday('2026-10-12', holidays), true);
			assert.equal(isHoliday('2026-10-13', holidays), false);
			assert.equal(isHoliday('2026-10-12', null), false);
		});

		it('isBusinessDay checks non-weekend and non-holiday', () => {
			const holidays = ['2026-10-12']; // Sports Day (Monday)
			assert.equal(isBusinessDay('2026-10-12', holidays), false); // holiday
			assert.equal(isBusinessDay('2026-10-17', holidays), false); // Saturday
			assert.equal(isBusinessDay('2026-10-16', holidays), true);  // Friday (business day)
		});
	});

	describe('adjustDateForHoliday', () => {
		const holidays = ['2026-10-12']; // Monday

		it('rule "none" does not change date', () => {
			assert.equal(adjustDateForHoliday('2026-10-12', 'none', holidays), '2026-10-12');
			assert.equal(adjustDateForHoliday('2026-10-17', '', holidays), '2026-10-17');
		});

		it('rule "before" shifts to previous business day', () => {
			// 2026-10-12 (Mon holiday): shifts back to Sunday 10-11 -> Saturday 10-10 -> Friday 10-09
			assert.equal(adjustDateForHoliday('2026-10-12', 'before', holidays), '2026-10-09');
			// 2026-10-18 (Sun): shifts back to Saturday -> Friday 10-16
			assert.equal(adjustDateForHoliday('2026-10-18', 'before', holidays), '2026-10-16');
			// Already business day: stays same
			assert.equal(adjustDateForHoliday('2026-10-16', 'before', holidays), '2026-10-16');
		});

		it('rule "after" shifts to next business day', () => {
			// 2026-10-10 (Sat): Sunday 10-11 -> Monday 10-12 (holiday) -> Tuesday 10-13
			assert.equal(adjustDateForHoliday('2026-10-10', 'after', holidays), '2026-10-13');
			// 2026-10-12 (Mon holiday): shifts to Tuesday 10-13
			assert.equal(adjustDateForHoliday('2026-10-12', 'after', holidays), '2026-10-13');
		});
	});

	describe('calculateTax', () => {
		it('calculates 10% tax with floor rounding', () => {
			// base 999: 999 * 0.10 = 99.9 -> floor 99 -> total 1098
			const res = calculateTax(999, 0.10, 'floor');
			assert.equal(res.amount, 1098);
			assert.equal(res.tax_meta.base_amount, 999);
			assert.equal(res.tax_meta.tax_rate, 0.10);
			assert.equal(res.tax_meta.rounding, 'floor');
		});

		it('calculates 10% tax with round (四捨五入)', () => {
			// base 995: 995 * 0.10 = 99.5 -> round 100 -> total 1095
			const res = calculateTax(995, 0.10, 'round');
			assert.equal(res.amount, 1095);
			assert.equal(res.tax_meta.rounding, 'round');
		});

		it('calculates 8% reduced tax rate', () => {
			// base 1000 * 0.08 = 80 -> total 1080
			const res = calculateTax(1000, 0.08, 'floor');
			assert.equal(res.amount, 1080);
			assert.equal(res.tax_meta.tax_rate, 0.08);
		});

		it('handles zero or invalid base amounts', () => {
			const res = calculateTax('invalid', 0.10, 'floor');
			assert.equal(res.amount, 0);
			assert.equal(res.tax_meta.base_amount, 0);
		});
	});

	describe('generateUUID', () => {
		it('generates non-empty unique string with prefix', () => {
			const id1 = generateUUID('test');
			const id2 = generateUUID('test');
			assert.ok(id1.startsWith('test_'));
			assert.notEqual(id1, id2);
		});
	});

	describe('generateRecurringTransactions', () => {
		const rules = [
			{
				id: 'rec_rent',
				name: '家賃',
				is_active: true,
				start_date: '2026-04-01',
				end_date: '2028-03-31',
				frequency: 'interval_months',
				interval_months: 1,
				day_of_month: 27,
				holiday_adjustment: 'after',
				type: 'expense',
				amount: 120000,
				account_id: 'acc_bank_main',
				to_account_id: null,
				category_id: 'cat_housing',
				subcategory_id: 'sub_rent'
			},
			{
				id: 'rec_bimonthly',
				name: '隔月会費',
				is_active: true,
				start_date: '2026-04-01',
				end_date: null,
				frequency: 'interval_months',
				interval_months: 2,
				day_of_month: 15,
				holiday_adjustment: 'none',
				type: 'expense',
				amount: 5000,
				account_id: 'acc_bank_main'
			},
			{
				id: 'rec_inactive',
				name: '解約済',
				is_active: false,
				amount: 1000
			}
		];

		it('generates planned transactions for valid active rules in target month', () => {
			const gen = generateRecurringTransactions(rules, '2026-10', []);
			// 2026-10 is 6 months after 2026-04, so bimonthly (6 % 2 === 0) fires
			assert.equal(gen.length, 2);

			const rentTx = gen.find(t => t.recurring_rule_id === 'rec_rent');
			assert.ok(rentTx);
			assert.equal(rentTx.amount, 120000);
			assert.equal(rentTx.status, 'planned');
			assert.equal(rentTx.target_month, '2026-10');
			// 2026-10-27 is Tuesday, so holiday_adjustment 'after' keeps 2026-10-27
			assert.equal(rentTx.date, '2026-10-27');
		});

		it('skips rule when interval_months does not match target month', () => {
			// 2026-11 is 7 months after 2026-04 (7 % 2 !== 0), so bimonthly does not fire
			const gen = generateRecurringTransactions(rules, '2026-11', []);
			assert.equal(gen.length, 1);
			assert.equal(gen[0].recurring_rule_id, 'rec_rent');
		});

		it('shifts scheduled date when holiday adjustment rule is applied', () => {
			// Let 2026-10-27 be in holiday list
			const gen = generateRecurringTransactions(rules, '2026-10', ['2026-10-27']);
			const rentTx = gen.find(t => t.recurring_rule_id === 'rec_rent');
			assert.equal(rentTx.date, '2026-10-28'); // shifted to next day
			assert.equal(rentTx.target_month, '2026-10'); // target_month remains 2026-10
		});

		it('clamps day_of_month to last day of month if 31', () => {
			const endOfMonthRule = [{
				id: 'rec_eom',
				is_active: true,
				start_date: '2026-01-01',
				day_of_month: 31,
				holiday_adjustment: 'none',
				amount: 3000,
				account_id: 'acc_wallet'
			}];
			// April has 30 days
			const gen = generateRecurringTransactions(endOfMonthRule, '2026-04', []);
			assert.equal(gen[0].date, '2026-04-30');
		});

		it('skips generation if transaction for that rule and month already exists', () => {
			const existing = [{
				recurring_rule_id: 'rec_rent',
				target_month: '2026-10',
				is_deleted: false
			}];
			const gen = generateRecurringTransactions(rules, '2026-10', [], existing);
			assert.equal(gen.some(t => t.recurring_rule_id === 'rec_rent'), false);
		});

		it('returns empty array on invalid inputs', () => {
			assert.deepEqual(generateRecurringTransactions(null, '2026-10'), []);
			assert.deepEqual(generateRecurringTransactions([], null), []);
		});
	});

	describe('createPrepaidAmortizationTransactions', () => {
		it('creates 1 payment transfer + N monthly amortizations with remainder on 1st month', () => {
			// 10,000 yen divided into 3 months:
			// monthlyBase = Math.floor(10000 / 3) = 3333
			// remainder = 1
			// 1st month: 3334, 2nd month: 3333, 3rd month: 3333. Sum = 10000
			const records = createPrepaidAmortizationTransactions({
				paymentDate: '2026-10-15',
				totalAmount: 10000,
				payingAccountId: 'acc_card_a',
				categoryId: 'cat_social',
				subcategoryId: 'sub_leisure',
				amortizeMonths: 3,
				memo: '年間パスポート',
				tags: ['娯楽'],
				todayMonth: '2026-10'
			});

			assert.equal(records.length, 4); // 1 payment + 3 amortizations

			// Record 0: Payment record
			const payTx = records[0];
			assert.equal(payTx.type, 'transfer');
			assert.equal(payTx.account_id, 'acc_card_a');
			assert.equal(payTx.to_account_id, 'acc_prepaid');
			assert.equal(payTx.amount, 10000);
			assert.equal(payTx.status, 'confirmed');
			assert.equal(payTx.target_month, '2026-10');
			assert.ok(payTx.group_id);

			// Records 1..3: Amortizations
			const amort1 = records[1];
			const amort2 = records[2];
			const amort3 = records[3];

			assert.equal(amort1.group_id, payTx.group_id);
			assert.equal(amort1.type, 'expense');
			assert.equal(amort1.account_id, 'acc_prepaid');
			assert.equal(amort1.target_month, '2026-10');
			assert.equal(amort1.amount, 3334);
			assert.equal(amort1.status, 'confirmed'); // 2026-10 <= todayMonth 2026-10

			assert.equal(amort2.target_month, '2026-11');
			assert.equal(amort2.amount, 3333);
			assert.equal(amort2.status, 'planned'); // 2026-11 > todayMonth 2026-10

			assert.equal(amort3.target_month, '2026-12');
			assert.equal(amort3.amount, 3333);
			assert.equal(amort3.status, 'planned');

			const totalAmort = amort1.amount + amort2.amount + amort3.amount;
			assert.equal(totalAmort, 10000);
		});
	});

	describe('createAdvancePaymentTransactions & Repayment', () => {
		it('creates 2 linked records for advance payment (self expense + transfer to receivable)', () => {
			const records = createAdvancePaymentTransactions({
				date: '2026-10-16',
				payingAccountId: 'acc_card_a',
				selfAmount: 4000,
				advanceAmount: 6000,
				categoryId: 'cat_social',
				subcategoryId: 'sub_drinking',
				memo: '飲み会立替',
				tags: ['友人A']
			});

			assert.equal(records.length, 2);
			const [selfTx, advTx] = records;

			assert.equal(selfTx.group_id, advTx.group_id);

			// Self
			assert.equal(selfTx.type, 'expense');
			assert.equal(selfTx.amount, 4000);
			assert.equal(selfTx.account_id, 'acc_card_a');
			assert.equal(selfTx.to_account_id, null);

			// Advance
			assert.equal(advTx.type, 'transfer');
			assert.equal(advTx.amount, 6000);
			assert.equal(advTx.account_id, 'acc_card_a');
			assert.equal(advTx.to_account_id, 'acc_receivable');
		});

		it('creates advance repayment transaction from acc_receivable to receiving account', () => {
			const repayTx = createAdvanceRepaymentTransaction({
				date: '2026-10-17',
				receivingAccountId: 'acc_bank_main',
				amount: 6000,
				memo: '友人Aより立替分返金'
			});

			assert.equal(repayTx.type, 'transfer');
			assert.equal(repayTx.amount, 6000);
			assert.equal(repayTx.account_id, 'acc_receivable');
			assert.equal(repayTx.to_account_id, 'acc_bank_main');
			assert.equal(repayTx.status, 'confirmed');
		});
	});

	describe('calculateBalancesAndSummaries', () => {
		const snapshot = {
			last_closed_month: '2026-09',
			account_balances: {
				acc_wallet: 10000,
				acc_bank_main: 500000,
				acc_card_a: 0,
				acc_receivable: 0,
				acc_prepaid: 0
			}
		};

		const transactions = [
			// Past month (already included in snapshot, should be ignored for balance delta)
			{
				id: 'tx_old',
				target_month: '2026-09',
				type: 'expense',
				amount: 2000,
				account_id: 'acc_wallet',
				status: 'confirmed',
				is_deleted: false
			},
			// October Confirmed Income
			{
				id: 'tx_inc_1',
				target_month: '2026-10',
				type: 'income',
				amount: 300000,
				account_id: 'acc_bank_main',
				status: 'confirmed',
				is_deleted: false
			},
			// October Confirmed Expense
			{
				id: 'tx_exp_1',
				target_month: '2026-10',
				type: 'expense',
				amount: 5000,
				account_id: 'acc_wallet',
				category_id: 'cat_food',
				subcategory_id: 'sub_groceries',
				actual_category_id: 'cat_food',
				actual_subcategory_id: 'sub_groceries',
				status: 'confirmed',
				is_deleted: false
			},
			// October Planned Expense
			{
				id: 'tx_plan_1',
				target_month: '2026-10',
				type: 'expense',
				amount: 10000,
				account_id: 'acc_bank_main',
				category_id: 'cat_social',
				subcategory_id: 'sub_leisure',
				actual_category_id: 'cat_food',
				actual_subcategory_id: 'sub_dining_out',
				status: 'planned',
				is_deleted: false
			},
			// Deleted transaction (should be ignored)
			{
				id: 'tx_del',
				target_month: '2026-10',
				type: 'expense',
				amount: 99999,
				account_id: 'acc_wallet',
				status: 'confirmed',
				is_deleted: true
			}
		];

		it('calculates confirmed and projected balances accurately', () => {
			const summary = calculateBalancesAndSummaries(snapshot, transactions, '2026-10');

			// acc_wallet: 10,000 - 5,000 = 5,000
			assert.equal(summary.confirmed_balances.acc_wallet, 5000);
			assert.equal(summary.projected_balances.acc_wallet, 5000);

			// acc_bank_main:
			// confirmed: 500,000 + 300,000 = 800,000
			// projected: 800,000 - 10,000 (planned) = 790,000
			assert.equal(summary.confirmed_balances.acc_bank_main, 800000);
			assert.equal(summary.projected_balances.acc_bank_main, 790000);

			// Incomes
			assert.equal(summary.income_confirmed, 300000);
			assert.equal(summary.income_planned, 0);
			assert.equal(summary.income_total, 300000);

			// Expenses
			assert.equal(summary.expense_confirmed, 5000);
			assert.equal(summary.expense_planned, 10000);
			assert.equal(summary.expense_total, 15000);

			// Net income
			assert.equal(summary.net_income_confirmed, 295000);
			assert.equal(summary.net_income_total, 285000);

			// Category breakdown (Accounting)
			assert.equal(summary.by_category.cat_food.total, 5000);
			assert.equal(summary.by_category.cat_social.total, 10000);
			assert.equal(summary.by_category.cat_social.total_planned, 10000);

			// Actual Category breakdown
			// cat_food includes both 5000 (groceries) and 10000 (dining out planned)
			assert.equal(summary.by_actual_category.cat_food.total, 15000);
			assert.equal(summary.by_actual_category.cat_food.total_planned, 10000);
		});
	});

	describe('Holiday Import & Presets', () => {
		it('contains valid Japanese holidays preset spanning 2024 to 2028', () => {
			assert.ok(Array.isArray(JAPANESE_HOLIDAYS_PRESET));
			assert.ok(JAPANESE_HOLIDAYS_PRESET.length > 50);
			assert.ok(JAPANESE_HOLIDAYS_PRESET.includes('2026-01-01'));
			assert.ok(JAPANESE_HOLIDAYS_PRESET.includes('2026-10-12'));
		});

		it('parses holidays from plain text, CSV, and date formats', () => {
			const csv = `国民の祝日・休日月日,国民の祝日・休日名称
2026/01/01,元日
2026/01/12,成人の日
2026-02-11,建国記念の日`;
			const res = parseHolidayTextOrCsv(csv);
			assert.deepEqual(res, ['2026-01-01', '2026-01-12', '2026-02-11']);
		});

		it('parses holidays from JSON array and object structures', () => {
			// JSON array of strings
			const jsonArrStr = JSON.stringify(['2026-05-03', '2026-05-04', '2026-05-05']);
			assert.deepEqual(parseHolidayTextOrCsv(jsonArrStr), ['2026-05-03', '2026-05-04', '2026-05-05']);

			// JSON array of objects
			const jsonArrObj = JSON.stringify([
				{ date: '2026/11/03', name: '文化の日' },
				{ holiday_date: '2026-11-23', name: '勤労感謝の日' }
			]);
			assert.deepEqual(parseHolidayTextOrCsv(jsonArrObj), ['2026-11-03', '2026-11-23']);

			// JSON object dictionary
			const jsonObj = JSON.stringify({
				'2026-01-01': '元日',
				'2026-01-12': '成人の日'
			});
			assert.deepEqual(parseHolidayTextOrCsv(jsonObj), ['2026-01-01', '2026-01-12']);
		});

		it('handles empty or invalid inputs gracefully', () => {
			assert.deepEqual(parseHolidayTextOrCsv(''), []);
			assert.deepEqual(parseHolidayTextOrCsv(null), []);
			assert.deepEqual(parseHolidayTextOrCsv('no dates here at all'), []);
		});

		it('groupHolidaysByYear groups dates by year in sorted order', async () => {
			const { groupHolidaysByYear } = await import('../../js/logic.js');
			const holidays = [
				'2024-01-01', '2024-05-03', '2025-01-01', '2025-11-23', '2026-01-01', 'invalid'
			];
			const groups = groupHolidaysByYear(holidays);
			assert.deepEqual(Object.keys(groups).sort(), ['2024', '2025', '2026']);
			assert.deepEqual(groups['2024'], ['2024-01-01', '2024-05-03']);
			assert.deepEqual(groups['2025'], ['2025-01-01', '2025-11-23']);
			assert.deepEqual(groups['2026'], ['2026-01-01']);
			assert.deepEqual(groupHolidaysByYear(null), {});
		});
	});

	describe('createPointPaymentTransactions', () => {
		it('creates 2 linked records using dedicated point account (Case A)', () => {
			const txs = createPointPaymentTransactions({
				date: '2026-10-17',
				totalAmount: 5000,
				pointAmount: 1000,
				paymentAccountId: 'acc_card_main',
				pointAccountId: 'acc_point',
				categoryId: 'cat_food',
				memo: 'スーパー買い物',
				tags: ['食材']
			});

			assert.equal(txs.length, 2);
			const [txSelf, txPoint] = txs;

			assert.equal(txSelf.type, 'expense');
			assert.equal(txSelf.amount, 4000); // 5000 - 1000
			assert.equal(txSelf.account_id, 'acc_card_main');
			assert.equal(txSelf.category_id, 'cat_food');
			assert.equal(txSelf.is_point_split, true);
			assert.equal(txSelf.related_tx_id, txPoint.id);

			assert.equal(txPoint.type, 'expense');
			assert.equal(txPoint.amount, 1000);
			assert.equal(txPoint.account_id, 'acc_point');
			assert.equal(txPoint.category_id, 'cat_food');
			assert.equal(txPoint.is_point_split, true);
			assert.equal(txPoint.related_tx_id, txSelf.id);
		});

		it('creates 2 linked records using purchase expense + point offset income (Case B)', () => {
			const txs = createPointPaymentTransactions({
				date: '2026-10-17',
				totalAmount: 5000,
				pointUsed: 1500,
				payingAccountId: 'acc_bank_main',
				categoryId: 'cat_shopping',
				taxMeta: { rate: 0.10, base: 4545 },
				memo: '家電量販店',
				tags: ['家電']
			});

			assert.equal(txs.length, 2);
			const [txPurchase, txOffset] = txs;

			assert.equal(txPurchase.type, 'expense');
			assert.equal(txPurchase.amount, 5000);
			assert.equal(txPurchase.account_id, 'acc_bank_main');
			assert.equal(txPurchase.category_id, 'cat_shopping');
			assert.equal(txPurchase.is_point_split, true);
			assert.equal(txPurchase.tax_meta.rate, 0.10);

			assert.equal(txOffset.type, 'income');
			assert.equal(txOffset.amount, 1500);
			assert.equal(txOffset.account_id, 'acc_bank_main');
			assert.equal(txOffset.category_id, 'cat_point_income');
			assert.equal(txOffset.subcategory_id, 'sub_point_offset');
			assert.equal(txOffset.is_point_split, true);
			assert.equal(txOffset.related_tx_id, txPurchase.id);
		});
	});

	describe('Multi-Granularity Analytics: Daily, Monthly, Yearly', () => {
		const transactions = [
			{
				id: 'tx_d1',
				date: '2026-10-01',
				target_month: '2026-10',
				type: 'income',
				amount: 250000,
				status: 'confirmed',
				is_deleted: false
			},
			{
				id: 'tx_d2',
				date: '2026-10-01',
				target_month: '2026-10',
				type: 'expense',
				amount: 3000,
				category_id: 'cat_food',
				actual_category_id: 'cat_food',
				status: 'confirmed',
				is_deleted: false
			},
			{
				id: 'tx_d3',
				date: '2026-10-15',
				target_month: '2026-10',
				type: 'expense',
				amount: 1500,
				category_id: 'cat_daily',
				status: 'confirmed',
				is_deleted: false
			},
			{
				id: 'tx_d4',
				date: '2026-10-25',
				target_month: '2026-10',
				type: 'expense',
				amount: 80000,
				category_id: 'cat_social',
				actual_category_id: 'cat_housing',
				status: 'planned',
				is_deleted: false
			},
			{
				id: 'tx_nov',
				date: '2026-11-01',
				target_month: '2026-11',
				type: 'income',
				amount: 260000,
				status: 'confirmed',
				is_deleted: false
			}
		];

		it('aggregateDailySummaries aggregates transactions by day of month', () => {
			const res = aggregateDailySummaries(transactions, '2026-10');
			assert.equal(res.month, '2026-10');
			assert.equal(Object.keys(res.days).length, 31); // October has 31 days

			const day1 = res.days['2026-10-01'];
			assert.equal(day1.income_confirmed, 250000);
			assert.equal(day1.expense_confirmed, 3000);
			assert.equal(day1.net, 247000);
			assert.equal(day1.by_category.cat_food, 3000);

			const day25 = res.days['2026-10-25'];
			assert.equal(day25.expense_planned, 80000);
			assert.equal(day25.expense_total, 80000);

			assert.equal(res.total_income, 250000);
			assert.equal(res.total_expense, 84500);
			assert.equal(res.total_net, 165500);
		});

		it('aggregateMonthlySummaries aggregates across 12 months for target year', () => {
			const historical = {
				'2026-09': {
					total_income: 240000,
					total_expense: 150000,
					by_category: { cat_food: 40000 }
				}
			};
			const res = aggregateMonthlySummaries(transactions, '2026', historical);
			assert.equal(res.year, '2026');
			assert.equal(Object.keys(res.months).length, 12);

			// September from historical
			assert.equal(res.months['2026-09'].income_total, 240000);
			assert.equal(res.months['2026-09'].expense_total, 150000);
			assert.equal(res.months['2026-09'].net, 90000);

			// October from local transactions
			assert.equal(res.months['2026-10'].income_total, 250000);
			assert.equal(res.months['2026-10'].expense_total, 84500);

			// November from local transactions
			assert.equal(res.months['2026-11'].income_total, 260000);
		});

		it('aggregateYearlySummaries aggregates multi-year trends and savings rate', () => {
			const historical = {
				'2025-12': { total_income: 300000, total_expense: 200000 }
			};
			const res = aggregateYearlySummaries(transactions, historical);

			assert.ok(res['2025']);
			assert.equal(res['2025'].income, 300000);
			assert.equal(res['2025'].expense, 200000);
			assert.equal(res['2025'].net, 100000);
			assert.equal(res['2025'].savings_rate, 33.3);

			assert.ok(res['2026']);
			assert.equal(res['2026'].income, 510000); // 250000 + 260000
			assert.equal(res['2026'].expense, 84500);
			assert.ok(res['2026'].savings_rate > 80);
		});
	});

	describe('calculateTotalAssetSummary', () => {
		it('accurately computes liquid assets, liabilities, external assets and net assets', () => {
			const balances = {
				acc_bank_main: 1500000,
				acc_wallet: 30000,
				acc_card_main: -50000,
				acc_receivable: 20000
			};
			const accounts = [
				{ id: 'acc_bank_main', type: 'bank', is_asset: true },
				{ id: 'acc_wallet', type: 'cash', is_asset: true },
				{ id: 'acc_card_main', type: 'credit_card', is_asset: false },
				{ id: 'acc_receivable', type: 'receivable', is_asset: true }
			];
			const externalAssets = [
				{ id: 'sec_1', name: '全世界株式投信', market_value: 3000000, type: 'stock' },
				{ id: 'sec_2', name: '米国債券ETF', amount: 500000, type: 'stock' }
			];

			const res = calculateTotalAssetSummary(balances, accounts, externalAssets);

			// Liquid: 1,500,000 + 30,000 + 20,000 = 1,550,000
			assert.equal(res.liquid_assets, 1550000);
			assert.equal(res.total_liquid_assets, 1550000);

			// Liabilities: 50,000
			assert.equal(res.liabilities, 50000);
			assert.equal(res.total_liabilities, 50000);

			// External: 3,000,000 + 500,000 = 3,500,000
			assert.equal(res.external_assets_total, 3500000);
			assert.equal(res.total_external_assets, 3500000);

			// Total assets: 1,550,000 + 3,500,000 = 5,050,000
			assert.equal(res.total_assets, 5050000);

			// Net assets: 5,050,000 - 50,000 = 5,000,000
			assert.equal(res.net_assets, 5000000);
			assert.equal(res.total_net_assets, 5000000);

			// Breakdown by type
			assert.equal(res.by_type.bank, 1500000);
			assert.equal(res.by_type.cash, 30000);
			assert.equal(res.by_type.credit_card, -50000);
			assert.equal(res.by_type.stock, 3500000);
		});

		it('handles edge cases: unknown types, overdrafts, current_value and zero income', () => {
			// 1. Overdraft in asset account (negative balance) & unknown account type
			const balances = {
				acc_overdraft: -20000,
				acc_custom_type: 100000,
				acc_unknown_in_master: 5000
			};
			const accounts = [
				{ id: 'acc_overdraft', type: 'bank', is_asset: true },
				{ id: 'acc_custom_type', type: 'crypto_vault', is_asset: true }
			];
			const externalAssets = [
				{ id: 'ext_cur_val', name: '仮想通貨', current_value: 80000, type: 'crypto' },
				{ id: 'ext_unknown_type', name: '美術品', amount: 50000, type: 'rare_art' }
			];

			const res = calculateTotalAssetSummary(balances, accounts, externalAssets);

			// Overdraft should be added to liabilities (20,000)
			assert.equal(res.liabilities, 20000);
			// Liquid assets: 100000 + 5000 (unknown in master defaults to cash >= 0)
			assert.equal(res.liquid_assets, 105000);
			// External total: 80,000 + 50,000 = 130,000
			assert.equal(res.external_assets_total, 130000);
			// Total assets: 105,000 + 130,000 = 235,000
			assert.equal(res.total_assets, 235000);
			// Net assets: 235,000 - 20,000 = 215,000
			assert.equal(res.net_assets, 215000);
			// by_type.other has acc_custom_type (100,000) + ext_unknown_type (50,000) = 150,000
			assert.equal(res.by_type.other, 150000);
		});

		it('accurately computes summary when investment/asset accounts are integrated in master accounts', () => {
			const balances = {
				acc_wallet: 15000,
				acc_bank_main: 1000000,
				acc_nisa_katsu: 800000,
				acc_nisa_momo: 700000,
				acc_card_main: -30000
			};
			const accounts = [
				{ id: 'acc_wallet', type: 'cash', is_asset: true },
				{ id: 'acc_bank_main', type: 'bank', is_asset: true },
				{ id: 'acc_nisa_katsu', type: 'investment', is_asset: true },
				{ id: 'acc_nisa_momo', type: 'asset', is_asset: true },
				{ id: 'acc_card_main', type: 'credit_card', is_asset: false }
			];

			// No externalAssets needed!
			const res = calculateTotalAssetSummary(balances, accounts);

			// Liquid: 1,015,000
			assert.equal(res.liquid_assets, 1015000);
			// Investment / asset: 800,000 + 700,000 = 1,500,000
			assert.equal(res.investment_assets, 1500000);
			// Liabilities: 30,000
			assert.equal(res.liabilities, 30000);
			// Total assets: 1,015,000 + 1,500,000 = 2,515,000
			assert.equal(res.total_assets, 2515000);
			// Net assets: 2,515,000 - 30,000 = 2,485,000
			assert.equal(res.net_assets, 2485000);
		});
	});

	describe('Comprehensive Edge Cases & Branch Coverage', () => {
		it('calculateBalancesAndSummaries handles planned income and unclassified fallbacks', () => {
			const snap = {
				last_closed_month: '2026-09',
				account_balances: { acc_bank: 50000 }
			};
			const txs = [
				{
					id: 'tx_inc_planned',
					target_month: '2026-10',
					type: 'income',
					amount: 80000,
					account_id: 'acc_bank',
					status: 'planned',
					is_deleted: false
				},
				{
					id: 'tx_exp_unclass',
					target_month: '2026-10',
					type: 'expense',
					amount: 3000,
					account_id: 'acc_bank',
					status: 'planned',
					is_deleted: false
					// missing category_id and subcategory_id
				},
				{
					id: 'tx_trans_plan',
					target_month: '2026-10',
					type: 'transfer',
					amount: 10000,
					account_id: 'acc_bank',
					to_account_id: 'acc_wallet',
					status: 'planned',
					is_deleted: false
				}
			];

			const res = calculateBalancesAndSummaries(snap, txs, '2026-10');
			assert.equal(res.income_planned, 80000);
			assert.equal(res.expense_planned, 3000);
			assert.ok(res.by_category.cat_unclassified);
			assert.equal(res.by_category.cat_unclassified.total_planned, 3000);
			assert.equal(res.projected_balances.acc_bank, 50000 + 80000 - 3000 - 10000);
			assert.equal(res.projected_balances.acc_wallet, 10000);
		});

		it('aggregateDailySummaries and aggregateMonthlySummaries cover planned income and out-of-range dates', () => {
			const txs = [
				{
					id: 'tx_d_plan_inc',
					date: '2026-10-05',
					target_month: '2026-10',
					type: 'income',
					amount: 50000,
					status: 'planned',
					is_deleted: false
				},
				{
					id: 'tx_d_out_of_month',
					date: '2026-11-01',
					target_month: '2026-10',
					type: 'expense',
					amount: 9999,
					status: 'confirmed',
					is_deleted: false
				},
				{
					id: 'tx_d_diff_month',
					date: '2026-11-01',
					target_month: '2026-11',
					type: 'expense',
					amount: 1000,
					status: 'confirmed',
					is_deleted: false
				},
				{
					id: 'tx_d_deleted',
					date: '2026-10-05',
					target_month: '2026-10',
					type: 'income',
					amount: 10000,
					status: 'confirmed',
					is_deleted: true
				}
			];

			const daily = aggregateDailySummaries(txs, '2026-10');
			assert.equal(daily.days['2026-10-05'].income_planned, 50000);
			assert.equal(daily.days['2026-10-05'].income_total, 50000);

			// Monthly aggregation with planned income and historical deduplication
			const monthlyTxs = [
				{
					id: 'tx_m_plan_inc',
					target_month: '2026-05',
					type: 'income',
					amount: 30000,
					status: 'planned',
					is_deleted: false
				},
				{
					id: 'tx_m_deleted',
					target_month: '2026-05',
					type: 'income',
					amount: 9999,
					status: 'confirmed',
					is_deleted: true
				},
				{
					id: 'tx_m_other_year',
					target_month: '2025-05',
					type: 'income',
					amount: 9999,
					status: 'confirmed',
					is_deleted: false
				}
			];
			const historical = {
				'2026-01': { total_income: 100000, total_expense: 50000 }
			};
			const monthly = aggregateMonthlySummaries(monthlyTxs, '2026', historical);
			assert.equal(monthly.months['2026-05'].income_planned, 30000);
			assert.equal(monthly.months['2026-01'].income_total, 100000);
		});

		it('aggregateYearlySummaries handles object category breakdown and zero savings rate', () => {
			const historical = {
				'2024-01': {
					total_income: 0,
					total_expense: 50000,
					by_category: {
						cat_rent: { total: 40000 },
						cat_elec: { confirmed: 10000 }
					},
					by_actual_category: {
						cat_housing: { total: 50000 }
					}
				}
			};
			const txs = [
				{
					id: 'tx_y1',
					target_month: '2024-02',
					type: 'expense',
					amount: 20000,
					category_id: 'cat_rent',
					status: 'confirmed',
					is_deleted: false
				},
				{
					id: 'tx_y_del',
					target_month: '2024-02',
					type: 'income',
					amount: 99999,
					status: 'confirmed',
					is_deleted: true
				}
			];

			const res = aggregateYearlySummaries(txs, historical);
			assert.ok(res['2024']);
			assert.equal(res['2024'].expense, 70000); // 50,000 + 20,000
			assert.equal(res['2024'].income, 0);
			assert.equal(res['2024'].savings_rate, 0); // Income is 0 -> savings_rate is 0
			assert.equal(res['2024'].by_category.cat_rent, 60000);
			assert.equal(res['2024'].by_category.cat_elec, 10000);
			assert.equal(res['2024'].by_actual_category.cat_housing, 50000);
		});

		it('generateRecurringTransactions handles inactive rules, date clamping and intervals', () => {
			const rules = [
				{
					id: 'rec_inactive',
					name: '無効ルール',
					is_active: false,
					day_of_month: 10,
					amount: 5000,
					type: 'expense'
				},
				{
					id: 'rec_expired',
					name: '期限切れルール',
					is_active: true,
					start_date: '2025-01-01',
					end_date: '2025-12-31',
					day_of_month: 10,
					amount: 5000,
					type: 'expense'
				},
				{
					id: 'rec_future',
					name: '未来ルール',
					is_active: true,
					start_date: '2027-01-01',
					day_of_month: 10,
					amount: 5000,
					type: 'expense'
				},
				{
					id: 'rec_transfer',
					name: '定期振替',
					is_active: true,
					start_date: '2026-01-01',
					day_of_month: 15,
					amount: 20000,
					type: 'transfer',
					account_id: 'acc_bank',
					to_account_id: 'acc_wallet',
					holiday_adjustment: 'none'
				}
			];

			const txs = generateRecurringTransactions(rules, '2026-10');
			// Inactive, expired, future rules should be excluded
			assert.equal(txs.length, 1);
			assert.equal(txs[0].recurring_rule_id, 'rec_transfer');
			assert.equal(txs[0].type, 'transfer');
			assert.equal(txs[0].to_account_id, 'acc_wallet');
		});

		it('adjustDateForHoliday handles business days and holiday rules gracefully', () => {
			// 2026-10-14 is Wednesday (a normal business day)
			const resNone = adjustDateForHoliday('2026-10-14', 'none', []);
			assert.equal(resNone, '2026-10-14');

			const resBefore = adjustDateForHoliday('2026-10-14', 'before', []);
			assert.equal(resBefore, '2026-10-14');

			const resAfter = adjustDateForHoliday('2026-10-14', 'after', []);
			assert.equal(resAfter, '2026-10-14');
		});

		it('covers memo and alternative parameter fallbacks across transaction builders', () => {
			// 1. Point payment with empty memo, payingAccountId fallback and pointUsed fallback
			const ptA = createPointPaymentTransactions({
				date: '2026-10-20',
				totalAmount: 3000,
				pointUsed: 1000,
				payingAccountId: 'acc_wallet',
				pointAccountId: 'acc_point',
				memo: ''
			});
			assert.equal(ptA[0].memo, 'ポイント併用購入 (決済分)');
			assert.equal(ptA[1].memo, 'ポイント利用分');

			const ptB = createPointPaymentTransactions({
				date: '2026-10-20',
				totalAmount: 4000,
				pointAmount: 500,
				paymentAccountId: 'acc_card_a',
				memo: ''
			});
			assert.equal(ptB[0].memo, 'ポイント併用購入 (全額)');
			assert.equal(ptB[1].memo, 'ポイント相殺分');

			// 2. Advance payment with empty memo, and only self or only advance
			const advOnlySelf = createAdvancePaymentTransactions({
				date: '2026-10-20',
				payingAccountId: 'acc_wallet',
				selfAmount: 2500,
				advanceAmount: 0,
				memo: ''
			});
			assert.equal(advOnlySelf.length, 1);
			assert.equal(advOnlySelf[0].memo, '[自己負担]');

			const advOnlyLoan = createAdvancePaymentTransactions({
				date: '2026-10-20',
				payingAccountId: 'acc_wallet',
				selfAmount: 0,
				advanceAmount: 3500,
				memo: ''
			});
			assert.equal(advOnlyLoan.length, 1);
			assert.equal(advOnlyLoan[0].memo, '[立替分]');

			// 3. Advance repayment with empty memo
			const repay = createAdvanceRepaymentTransaction({
				date: '2026-10-22',
				receivingAccountId: 'acc_bank',
				amount: 3500,
				memo: ''
			});
			assert.equal(repay.memo, '[立替回収]');

			// 4. Prepaid amortization with empty memo
			const prep = createPrepaidAmortizationTransactions({
				paymentDate: '2026-10-01',
				payingAccountId: 'acc_card',
				totalAmount: 12000,
				amortizeMonths: 3,
				categoryId: 'cat_sub',
				subcategoryId: 'sub_leisure',
				memo: '',
				todayMonth: '2026-12' // So all months are <= todayMonth and get confirmed
			});
			assert.equal(prep[0].memo, '[前払一括支払]');
			assert.equal(prep[1].memo, '[前払分割 1/3]');
			assert.equal(prep[1].status, 'confirmed');

			// 5. Recurring rule fallback memo when both memo and name are omitted
			const fallbackRec = generateRecurringTransactions([
				{
					id: 'rec_no_name',
					is_active: true,
					day_of_month: 5,
					amount: 1000,
					account_id: 'acc_wallet'
				}
			], '2026-10');
			assert.equal(fallbackRec[0].memo, '定期支出');

			// 6. Holiday parsing edge branches (holiday_date property, non-date JSON, non-string input)
			const h1 = parseHolidayTextOrCsv(JSON.stringify([{ holiday_date: '2026-08-11' }, { other: 1 }, 99]));
			assert.deepEqual(h1, ['2026-08-11']);

			const h2 = parseHolidayTextOrCsv(JSON.stringify({ not_a_date: 'test' }));
			assert.deepEqual(h2, []);

			const h3 = parseHolidayTextOrCsv(null);
			assert.deepEqual(h3, []);
			const h4 = parseHolidayTextOrCsv(123);
			assert.deepEqual(h4, []);

			// 7. Defaults across all logic helpers
			const taxDef = calculateTax(1000); // default 0.10, 'floor'
			assert.equal(taxDef.amount, 1100);

			const uuidDef = generateUUID(); // default prefix 'tx'
			assert.ok(uuidDef.startsWith('tx_'));

			const assetDef = calculateTotalAssetSummary(); // default parameters
			assert.equal(assetDef.total_assets, 0);

			const adjEmpty = adjustDateForHoliday('', null);
			assert.equal(adjEmpty, '');

			// 8. Recurring transactions with missing day_of_month, type, amount
			const minRuleTxs = generateRecurringTransactions([
				{
					id: 'rec_minimal',
					is_active: true,
					account_id: 'acc_wallet'
				}
			], '2026-10');
			assert.equal(minRuleTxs[0].amount, 0);
			assert.equal(minRuleTxs[0].type, 'expense');
			assert.equal(minRuleTxs[0].date, '2026-10-01');

			// 9. Subcategory confirmed and planned breakdown in calculateBalancesAndSummaries
			const subcatRes = calculateBalancesAndSummaries({}, [
				{
					id: 'tx_sub_conf',
					target_month: '2026-10',
					type: 'expense',
					amount: 1500,
					account_id: 'acc_wallet',
					category_id: 'cat_food',
					subcategory_id: 'sub_groceries',
					status: 'confirmed',
					is_deleted: false
				},
				{
					id: 'tx_sub_plan',
					target_month: '2026-10',
					type: 'expense',
					amount: 2500,
					account_id: 'acc_wallet',
					category_id: 'cat_food',
					subcategory_id: 'sub_groceries',
					status: 'planned',
					is_deleted: false
				},
				{
					id: 'tx_trans_no_to',
					target_month: '2026-10',
					type: 'transfer',
					amount: 500,
					account_id: 'acc_wallet',
					// to_account_id missing
					status: 'confirmed',
					is_deleted: false
				}
			], '2026-10');
			assert.equal(subcatRes.by_category.cat_food.by_subcategory.sub_groceries.confirmed, 1500);
			assert.equal(subcatRes.by_category.cat_food.by_subcategory.sub_groceries.planned, 2500);
			assert.equal(subcatRes.by_category.cat_food.by_subcategory.sub_groceries.total, 4000);

			// 10. Future month transaction (> targetMonth) and custom actual category
			const futureRes = calculateBalancesAndSummaries({
				last_closed_month: '2026-09',
				account_balances: { acc_wallet: 10000 }
			}, [
				{
					id: 'tx_future',
					target_month: '2026-11', // Future month
					type: 'expense',
					amount: 2000,
					account_id: 'acc_wallet',
					status: 'confirmed',
					is_deleted: false
				},
				{
					id: 'tx_act_diff_conf',
					target_month: '2026-10',
					type: 'expense',
					amount: 3000,
					account_id: 'acc_wallet',
					category_id: 'cat_social',
					subcategory_id: 'sub_leisure',
					actual_category_id: 'cat_food',
					actual_subcategory_id: 'sub_groceries',
					status: 'confirmed',
					is_deleted: false
				},
				{
					id: 'tx_act_diff_plan',
					target_month: '2026-10',
					type: 'expense',
					amount: 1500,
					account_id: 'acc_wallet',
					category_id: 'cat_social',
					subcategory_id: 'sub_leisure',
					actual_category_id: 'cat_food',
					actual_subcategory_id: 'sub_groceries',
					status: 'planned',
					is_deleted: false
				},
				{
					id: 'tx_no_from_exp',
					target_month: '2026-10',
					type: 'expense',
					amount: 100,
					account_id: null, // missing fromAcc
					status: 'confirmed',
					is_deleted: false
				},
				{
					id: 'tx_no_from_inc',
					target_month: '2026-10',
					type: 'income',
					amount: 100,
					account_id: null, // missing fromAcc
					status: 'confirmed',
					is_deleted: false
				}
			], '2026-10');

			// tx_future applies to confirmedBalances (10000 - 2000 - 3000 = 5000)
			// but NOT to projectedBalances for 2026-10 (10000 - 3000 - 1500 = 5500)
			assert.equal(futureRes.confirmed_balances.acc_wallet, 5000);
			assert.equal(futureRes.projected_balances.acc_wallet, 5500);
			assert.equal(futureRes.by_actual_category.cat_food.by_subcategory.sub_groceries.confirmed, 3000);
			assert.equal(futureRes.by_actual_category.cat_food.by_subcategory.sub_groceries.planned, 1500);
			assert.equal(futureRes.by_actual_category.cat_food.by_subcategory.sub_groceries.total, 4500);

			// 11. Additional branch checks: isHoliday with non-array, adjustDateForHoliday with unknown rule
			assert.equal(isHoliday('2026-01-01', null), false);
			assert.equal(isHoliday('2026-01-01'), false);
			assert.equal(isBusinessDay('2026-10-14'), true);
			assert.equal(adjustDateForHoliday('2026-10-14', 'unknown_rule'), '2026-10-14');

			// 12. Advance repayment with custom memo and tags
			const repayWithMemo = createAdvanceRepaymentTransaction({
				date: '2026-10-25',
				receivingAccountId: 'acc_wallet',
				amount: 5000,
				memo: '田中さんより精算',
				tags: ['精算']
			});
			assert.equal(repayWithMemo.memo, '[立替回収] 田中さんより精算');
			assert.ok(repayWithMemo.tags.includes('精算'));

			// 14. Holiday parsing item.Date and invalid date matches
			const hDate = parseHolidayTextOrCsv(JSON.stringify([
				{ Date: '2026/05/03' },
				{ date: 'not_a_valid_date' },
				'string_with_no_date_match'
			]));
			assert.deepEqual(hDate, ['2026-05-03']);

			// 15. Prepaid amortization with 0 or negative months (clamped to 1)
			const prepZero = createPrepaidAmortizationTransactions({
				paymentDate: '2026-05-01',
				totalAmount: 5000,
				payingAccountId: 'acc_wallet',
				amortizeMonths: 0
			});
			assert.equal(prepZero.length, 2); // 1 payment + 1 month amortization

			// 16. Point payment with subcategoryId, actualCategory, actualSubcategory, tags, omitted categoryId
			const ptFull = createPointPaymentTransactions({
				date: '2026-06-01',
				totalAmount: 10000,
				pointAmount: 2000,
				payingAccountId: 'acc_card_a',
				pointAccountId: 'acc_point',
				subcategoryId: 'sub_spec',
				actualCategoryId: 'cat_act_spec',
				actualSubcategoryId: 'sub_act_spec',
				taxMeta: { rate: 0.10 },
				tags: ['特別']
			});
			assert.equal(ptFull[0].actual_category_id, 'cat_act_spec');
			assert.equal(ptFull[0].actual_subcategory_id, 'sub_act_spec');
			assert.ok(ptFull[0].tags.includes('特別'));

			// 17. Case B point payment with fallback actual category and tags
			const ptBFallback = createPointPaymentTransactions({
				date: '2026-06-01',
				totalAmount: 5000,
				pointAmount: 1000,
				paymentAccountId: 'acc_card_a',
				categoryId: 'cat_book',
				subcategoryId: 'sub_tech',
				// actualCategoryId and actualSubcategoryId omitted -> fallback
				tags: ['書籍']
			});
			assert.equal(ptBFallback[0].actual_category_id, 'cat_book');
			assert.equal(ptBFallback[0].actual_subcategory_id, 'sub_tech');
			assert.ok(ptBFallback[0].tags.includes('書籍'));

			// 18. Prepaid amortization with custom tags and actualCategoryId
			const prepTags = createPrepaidAmortizationTransactions({
				paymentDate: '2026-07-01',
				totalAmount: 10000,
				payingAccountId: 'acc_bank',
				categoryId: 'cat_learn',
				tags: ['自己投資']
			});
			assert.ok(prepTags[0].tags.includes('自己投資'));

			// 19. Holiday CSV with slash format, null items and zero tax rate
			const hSlash = parseHolidayTextOrCsv('2026/04/29,昭和の日\r\n2026/05/03,憲法記念日');
			assert.deepEqual(hSlash, ['2026-04-29', '2026-05-03']);

			const hNullItem = parseHolidayTextOrCsv(JSON.stringify([null, { name: 'no date' }]));
			assert.deepEqual(hNullItem, []);

			const taxZero = calculateTax(5000, 0);
			assert.equal(taxZero.amount, 5000);

			// 20. Omitted targetMonth / targetYear / historicalSummaries across aggregators
			const dDef = aggregateDailySummaries([]);
			assert.equal(dDef.month, formatDate(new Date()).slice(0, 7));

			const mDef = aggregateMonthlySummaries([]);
			assert.equal(mDef.year, String(new Date().getFullYear()));

			const yDef = aggregateYearlySummaries([]);
			assert.deepEqual(yDef, {});

			const bDef = calculateBalancesAndSummaries(null);
			assert.ok(bDef.confirmed_balances);
			assert.equal(bDef.target_month, formatDate(new Date()).slice(0, 7));

			// 21. Total asset summary with credit card overpayment vs debt
			const extNoType = calculateTotalAssetSummary(
				{ acc_card_refund: 5000, acc_card_debt: -7000, acc_no_type: 20000, acc_non_asset: 3000 },
				[
					{ id: 'acc_card_refund', type: 'credit_card' },
					{ id: 'acc_card_debt', type: 'credit_card' },
					{ id: 'acc_no_type' }, // missing type, missing is_asset
					{ id: 'acc_non_asset', type: 'cash', is_asset: false }
				],
				[
					{ name: '暗号資産', amount: 50000 } // missing type -> stock
				]
			);
			assert.equal(extNoType.by_type.stock, 50000);
			assert.equal(extNoType.by_type.cash, 23000); // 20000 + 3000
			assert.equal(extNoType.liquid_assets, 25000); // 20000 + 5000 (card refund) [acc_non_asset has is_asset: false]
			assert.equal(extNoType.liabilities, 7000); // 7000 card debt

			// 22. escapeHtml XSS protection
			assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
			assert.equal(escapeHtml(null), '');
			assert.equal(escapeHtml(undefined), '');
			assert.equal(escapeHtml("Tom & Jerry's"), "Tom &amp; Jerry&#39;s");
		});
	});
});

