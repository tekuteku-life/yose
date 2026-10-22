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
	calculateAnnualBudgetProgress,
	generateAnnualTrajectory,
	roundTieredAmount,
	calculateAnnualBudgetDefaults,
	escapeHtml,
	JAPANESE_HOLIDAYS_PRESET,
	calculateCreditCardDebitDate,
	createCreditCardSettlementTransaction,
	evaluateCalculatorExpression,
	calculateTagSummary,
	calculateCrossAccrualActualSummary,
	formatDoughnutTooltipLabel,
	resolveTransactionDisplayInfo,
	filterTransactionsByCriteria,
	syncInsuranceRecurringRule
} from '../../js/logic.js';

describe('js/logic.js - Unit Tests', () => {
	it('keeps repayment user text and deduplicates tags without mutating their source', () => {
		const tags = ['旅行', '立替回収', '旅行', '立替回収'];
		const tx = createAdvanceRepaymentTransaction({ date: '2026-10-20', receivingAccountId: 'acc_wallet', amount: 1200, memo: 'そのまま残すメモ', tags });
		assert.equal(tx.memo, 'そのまま残すメモ');
		assert.deepEqual(tx.tags, ['旅行', '立替回収']);
		assert.deepEqual(tags, ['旅行', '立替回収', '旅行', '立替回収']);
		const defaultTx = createAdvanceRepaymentTransaction({ date: '2026-10-20', receivingAccountId: 'acc_wallet', amount: 1200 });
		assert.equal(defaultTx.memo, '立替回収');
		assert.deepEqual(defaultTx.tags, ['立替回収']);
	});

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
			assert.equal(res.tax_meta.tax_amount, 99);
			assert.equal(res.tax_meta.tax_rate, 0.10);
			assert.equal(res.tax_meta.rounding, 'floor');
		});

		it('calculates 10% tax with round (四捨五入)', () => {
			// base 995: 995 * 0.10 = 99.5 -> round 100 -> total 1095
			const res = calculateTax(995, 0.10, 'round');
			assert.equal(res.amount, 1095);
			assert.equal(res.tax_meta.tax_amount, 100);
			assert.equal(res.tax_meta.rounding, 'round');
		});

		it('calculates 8% reduced tax rate', () => {
			// base 1000 * 0.08 = 80 -> total 1080
			const res = calculateTax(1000, 0.08, 'floor');
			assert.equal(res.amount, 1080);
			assert.equal(res.tax_meta.tax_amount, 80);
			assert.equal(res.tax_meta.tax_rate, 0.08);
		});

		it('handles zero or invalid base amounts', () => {
			const res = calculateTax('invalid', 0.10, 'floor');
			assert.equal(res.amount, 0);
			assert.equal(res.tax_meta.base_amount, 0);
			assert.equal(res.tax_meta.tax_amount, 0);
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
			// Confirmed balances mapping included
			assert.deepEqual(res.confirmed_balances, balances);
		});

		it('aggregateMonthlySummaries normalizes historical category objects to numeric amounts', () => {
			const historicalSummaries = {
				'2026-01': {
					income_confirmed: 300000,
					expense_confirmed: 200000,
					by_category: {
						cat_food: { total: 50000, confirmed: 50000 },
						cat_util: 15000
					},
					by_actual_category: {
						cat_food: { total: 50000 },
						cat_util: 15000
					}
				}
			};

			const res = aggregateMonthlySummaries([], '2026', historicalSummaries);
			const jan = res.months['2026-01'];
			assert.equal(jan.by_category.cat_food, 50000);
			assert.equal(jan.by_category.cat_util, 15000);
			assert.equal(jan.by_actual_category.cat_food, 50000);
			assert.equal(jan.by_actual_category.cat_util, 15000);
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
			assert.equal(repay.memo, '立替回収');

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
			assert.equal(repayWithMemo.memo, '田中さんより精算');
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

	describe('Annual Budget & Savings Target Progress Logic (Requirement 3.14)', () => {
		const budgetConfig = {
			expense_budget: 3600000,
			savings_target_amount: 1200000,
			savings_target_rate: 25.0
		};

		it('accurately computes progress when spending and savings are on track', () => {
			const yearlySummary = {
				income: 4800000,
				expense: 2400000,
				net: 2400000,
				savings_rate: 50.0
			};

			const progress = calculateAnnualBudgetProgress({
				yearlySummary,
				budgetConfig,
				currentMonth: 8 // August (8 / 12 = 66.7% expected pace)
			});

			assert.equal(progress.expense_budget, 3600000);
			assert.equal(progress.expense_actual, 2400000);
			assert.equal(progress.expense_remaining, 1200000);
			assert.equal(progress.expense_consumption_rate, 66.7);
			assert.equal(progress.expected_pace_rate, 66.7);
			assert.equal(progress.pace_status, 'on_pace');

			assert.equal(progress.savings_target_amount, 1200000);
			assert.equal(progress.savings_actual, 2400000);
			assert.equal(progress.savings_achievement_rate, 200.0);
			assert.equal(progress.savings_remaining, 0);
			assert.equal(progress.is_deficit, false);

			assert.equal(progress.savings_target_rate, 25.0);
			assert.equal(progress.savings_actual_rate, 50.0);
			assert.equal(progress.savings_rate_achieved, true);
		});

		it('identifies ahead-of-pace status when consumption is significantly lower than month pace', () => {
			const yearlySummary = {
				income: 2000000,
				expense: 1000000,
				net: 1000000
			};

			const progress = calculateAnnualBudgetProgress({
				yearlySummary,
				budgetConfig,
				currentMonth: 6 // June (50.0% expected pace, actual is 27.8%)
			});

			assert.equal(progress.expense_consumption_rate, 27.8);
			assert.equal(progress.expected_pace_rate, 50.0);
			assert.equal(progress.pace_status, 'ahead');
		});

		it('identifies caution status when consumption exceeds expected pace by over 5%', () => {
			const yearlySummary = {
				income: 3000000,
				expense: 2400000,
				net: 600000
			};

			const progress = calculateAnnualBudgetProgress({
				yearlySummary,
				budgetConfig,
				currentMonth: 6 // June: expected pace 50.0%, actual is 66.7% (> 55%)
			});

			assert.equal(progress.expense_consumption_rate, 66.7);
			assert.equal(progress.expected_pace_rate, 50.0);
			assert.equal(progress.pace_status, 'caution');
		});

		it('identifies over_budget when consumption rate exceeds 100%', () => {
			const yearlySummary = {
				income: 4000000,
				expense: 4000000,
				net: 0
			};

			const progress = calculateAnnualBudgetProgress({
				yearlySummary,
				budgetConfig,
				currentMonth: 10
			});

			assert.equal(progress.expense_consumption_rate, 111.1);
			assert.equal(progress.expense_remaining, -400000);
			assert.equal(progress.pace_status, 'over_budget');
		});

		it('handles deficit (negative net income) safely without NaN or negative achievement rate', () => {
			const yearlySummary = {
				income: 2000000,
				expense: 3000000,
				net: -1000000
			};

			const progress = calculateAnnualBudgetProgress({
				yearlySummary,
				budgetConfig,
				currentMonth: 10
			});

			assert.equal(progress.is_deficit, true);
			assert.equal(progress.savings_actual, -1000000);
			assert.equal(progress.savings_achievement_rate, 0);
			assert.equal(progress.savings_remaining, 2200000); // 1200000 - (-1000000)
			assert.equal(progress.savings_actual_rate, -50.0);
			assert.equal(progress.savings_rate_achieved, false);
		});

		it('gracefully handles empty, missing, or zero parameters without division by zero', () => {
			const def = calculateAnnualBudgetProgress();
			assert.equal(def.expense_budget, 0);
			assert.equal(def.expense_consumption_rate, 0);
			assert.equal(def.savings_achievement_rate, 0);
			assert.equal(def.pace_status, 'on_pace');

			const zeroBudget = calculateAnnualBudgetProgress({
				yearlySummary: { expense: 100000, income: 150000 },
				budgetConfig: { expense_budget: 0, savings_target_amount: 0, savings_target_rate: 0 }
			});
			assert.equal(zeroBudget.expense_consumption_rate, 0);
			assert.equal(zeroBudget.savings_achievement_rate, 0);

			// Test direct flat arguments and target_savings_rate alias
			const flatArgs = calculateAnnualBudgetProgress({
				expenseBudget: 3600000,
				expenseActual: 1800000,
				savingsTargetAmount: 1200000,
				savingsTargetRate: 25,
				incomeActual: 3000000,
				netSavingsActual: 1200000,
				currentMonthIndex: 6
			});
			assert.equal(flatArgs.expense_budget, 3600000);
			assert.equal(flatArgs.expense_consumption_rate, 50.0);
			assert.equal(flatArgs.expected_pace_rate, 50.0);
			assert.equal(flatArgs.pace_status, 'on_pace');
			assert.equal(flatArgs.savings_achievement_rate, 100.0);
			assert.equal(flatArgs.savings_actual_rate, 40.0);
			assert.equal(flatArgs.savings_rate_achieved, true);

			// Test target_savings_rate inside budgetConfig
			const aliasConfig = calculateAnnualBudgetProgress({
				yearlySummary: { expense: 100000, income: 200000, net: 100000 },
				budgetConfig: { expense_budget: 1200000, savings_target_amount: 600000, target_savings_rate: 30 },
				currentMonth: 1
			});
			assert.equal(aliasConfig.savings_target_rate, 30);
			assert.equal(aliasConfig.savings_actual_rate, 50.0);
			assert.equal(aliasConfig.savings_rate_achieved, true);
		});

		it('generates 12-month trajectory data for Chart.js', () => {
			const monthlySummaries = {
				'2026-01': { expense_total: 250000, income_total: 400000, net: 150000 },
				'2026-02': { expense_total: 200000, income_total: 400000, net: 200000 },
				'2026-03': { expense_total: 300000, income_total: 400000, net: 100000 }
			};

			const trajectory = generateAnnualTrajectory({
				year: '2026',
				monthlySummaries,
				expenseBudget: 3600000,
				savingsTarget: 1200000
			});

			assert.equal(trajectory.length, 12);
			assert.equal(trajectory[0].month, '01');
			assert.equal(trajectory[0].month_str, '2026-01');
			assert.equal(trajectory[0].monthly_expense, 250000);
			assert.equal(trajectory[0].monthly_budget_allowance, 300000); // 3600000 / 12
			assert.equal(trajectory[0].cumulative_expense, 250000);
			assert.equal(trajectory[0].cumulative_budget_pace, 300000);

			assert.equal(trajectory[1].month, '02');
			assert.equal(trajectory[1].cumulative_expense, 450000); // 250000 + 200000
			assert.equal(trajectory[1].cumulative_budget_pace, 600000); // 300000 * 2
			assert.equal(trajectory[1].cumulative_savings, 350000); // 150000 + 200000
			assert.equal(trajectory[1].cumulative_savings_pace, 200000); // (1200000 / 12) * 2

			// Omitted parameters default safely
			const defTraj = generateAnnualTrajectory();
			assert.equal(defTraj.length, 12);
			assert.equal(defTraj[0].monthly_budget_allowance, 0);
		});

		it('roundTieredAmount rounds numbers according to tiered scale', () => {
			// >= 1,000,000 -> nearest 10,000
			assert.equal(roundTieredAmount(3624800), 3620000);
			assert.equal(roundTieredAmount(3626200), 3630000);
			assert.equal(roundTieredAmount(1000000), 1000000);

			// >= 10,000 -> nearest 1,000
			assert.equal(roundTieredAmount(54321), 54000);
			assert.equal(roundTieredAmount(54890), 55000);
			assert.equal(roundTieredAmount(10000), 10000);

			// < 10,000 -> nearest 100
			assert.equal(roundTieredAmount(9876), 9900);
			assert.equal(roundTieredAmount(1234), 1200);
			assert.equal(roundTieredAmount(543), 500);
			assert.equal(roundTieredAmount(49), 0);

			// Edge cases: 0, negative, invalid
			assert.equal(roundTieredAmount(0), 0);
			assert.equal(roundTieredAmount(-5000), 0);
			assert.equal(roundTieredAmount(null), 0);
			assert.equal(roundTieredAmount(undefined), 0);
			assert.equal(roundTieredAmount('not-a-number'), 0);
		});

		it('calculateAnnualBudgetDefaults pre-populates rounded values from previous year data', () => {
			const categories = [
				{ id: 'cat_food', name: '食費', type: 'expense' },
				{ id: 'cat_housing', name: '住居費', type: 'expense' },
				{ id: 'cat_income_main', name: '給与', type: 'income' },
				{ id: 'cat_transfer', name: '振替', type: 'transfer' }
			];

			const pastTransactions = [
				{ id: 'tx_1', date: '2025-03-15', type: 'expense', amount: 54321, category_id: 'cat_food' },
				{ id: 'tx_2', date: '2025-06-20', type: 'expense', amount: 1254321, category_id: 'cat_housing' },
				{ id: 'tx_3', date: '2025-09-10', type: 'expense', amount: 9876, category_id: 'cat_food' },
				// Transaction from different year (should be filtered out when targetYear is 2026)
				{ id: 'tx_4', date: '2024-12-01', type: 'expense', amount: 999999, category_id: 'cat_food' },
				// Deleted transaction (should be ignored)
				{ id: 'tx_5', date: '2025-07-01', type: 'expense', amount: 500000, category_id: 'cat_food', is_deleted: true }
			];

			const previousYearSummary = {
				income: 5000000,
				expense: 1318518, // 54321 + 1254321 + 9876 = 1318518
				net: 3681482,
				savings_rate: 73.6
			};

			const defaults = calculateAnnualBudgetDefaults({
				previousYearSummary,
				pastTransactions,
				categories,
				targetYear: 2026
			});

			// Expense budget rounded to nearest 10,000: 1318518 -> 1320000
			assert.equal(defaults.expense_budget, 1320000);
			// Savings target amount rounded to nearest 10,000: 3681482 -> 3680000
			assert.equal(defaults.savings_target_amount, 3680000);
			// Savings target rate rounded to integer: 73.6 -> 74
			assert.equal(defaults.savings_target_rate, 74);

			// Category budgets
			// cat_food: 54321 + 9876 = 64197 -> rounded to nearest 1,000: 64000
			assert.equal(defaults.category_budgets.cat_food, 64000);
			// cat_housing: 1254321 -> rounded to nearest 10,000: 1250000
			assert.equal(defaults.category_budgets.cat_housing, 1250000);
			// income and transfer categories should be excluded
			assert.equal(defaults.category_budgets.cat_income_main, undefined);
			assert.equal(defaults.category_budgets.cat_transfer, undefined);
		});

		it('calculateAnnualBudgetDefaults supports by_category from previousYearSummary and prototype safety', () => {
			const previousYearSummary = {
				income: 4000000,
				expense: 2500000,
				net: 1500000,
				by_category: {
					cat_food: { total: 456789 },
					cat_social: 34567,
					__proto__: { total: 999999 }
				}
			};

			const defaults = calculateAnnualBudgetDefaults({
				previousYearSummary,
				targetYear: '2026'
			});

			assert.equal(defaults.expense_budget, 2500000);
			assert.equal(defaults.savings_target_amount, 1500000);
			assert.equal(defaults.savings_target_rate, 38); // 1500000 / 4000000 = 37.5 -> 38
			// cat_food: 456789 (>= 10,000 and < 1,000,000 -> rounds to 1,000s) -> 457000
			assert.equal(defaults.category_budgets.cat_food, 457000);
			// cat_social: 34567 -> 35000
			assert.equal(defaults.category_budgets.cat_social, 35000);
			// Prototype pollution defense
			assert.equal(Object.prototype.hasOwnProperty.call(defaults.category_budgets, '__proto__'), false);

			// Test branch: previousYearSummary without expense, but with income (net calculated as income - expense)
			const noExpSummary = { income: 3000000 };
			const txsOnly = [
				{ id: 'tx_a', date: '2025-01-01', type: 'expense', amount: 800000, category_id: 'cat_rent' }
			];
			const derivedDefaults = calculateAnnualBudgetDefaults({
				previousYearSummary: noExpSummary,
				pastTransactions: txsOnly,
				targetYear: 2026
			});
			assert.equal(derivedDefaults.expense_budget, 800000);
			assert.equal(derivedDefaults.savings_target_amount, 2200000); // 3000000 - 800000 = 2200000
			assert.equal(derivedDefaults.savings_target_rate, 73); // 2200000 / 3000000 = 73.3% -> 73%

			// Empty parameters test
			const emptyDefaults = calculateAnnualBudgetDefaults();
			assert.equal(emptyDefaults.expense_budget, 0);
			assert.equal(emptyDefaults.savings_target_amount, 0);
			assert.equal(emptyDefaults.savings_target_rate, 0);
			assert.deepEqual(emptyDefaults.category_budgets, {});
		});

		it('calculateAnnualBudgetProgress computes category-level progress and discrepancy', () => {
			const budgetConfig = {
				expense_budget: 3600000,
				savings_target_amount: 1200000,
				savings_target_rate: 25,
				category_budgets: {
					cat_food: 600000,
					cat_housing: 1440000,
					cat_entertainment: 240000,
					cat_utilities: 120000
				}
			};

			const yearlySummary = {
				expense: 1500000,
				income: 2500000,
				net: 1000000,
				by_category: {
					cat_food: { total: 350000 },        // month 6 pace is 50%, 350k/600k = 58.3% -> caution
					cat_housing: { total: 720000 },     // 720k/1440k = 50.0% -> on_pace
					cat_entertainment: { total: 260000 }, // 260k/240k = 108.3% -> over_budget
					cat_utilities: { total: 30000 }      // 30k/120k = 25.0% -> ahead
				}
			};

			const progress = calculateAnnualBudgetProgress({
				yearlySummary,
				budgetConfig,
				currentMonth: 6
			});

			assert.equal(progress.total_category_budget, 2400000);
			assert.equal(progress.budget_discrepancy, 1200000); // 3600000 - 2400000

			// cat_food
			const foodProg = progress.category_progress.cat_food;
			assert.equal(foodProg.budget, 600000);
			assert.equal(foodProg.actual, 350000);
			assert.equal(foodProg.remaining, 250000);
			assert.equal(foodProg.consumption_rate, 58.3);
			assert.equal(foodProg.pace_status, 'caution');

			// cat_housing
			const houseProg = progress.category_progress.cat_housing;
			assert.equal(houseProg.budget, 1440000);
			assert.equal(houseProg.actual, 720000);
			assert.equal(houseProg.consumption_rate, 50.0);
			assert.equal(houseProg.pace_status, 'on_pace');

			// cat_entertainment
			const entProg = progress.category_progress.cat_entertainment;
			assert.equal(entProg.budget, 240000);
			assert.equal(entProg.actual, 260000);
			assert.equal(entProg.consumption_rate, 108.3);
			assert.equal(entProg.pace_status, 'over_budget');

			// cat_utilities
			const utilProg = progress.category_progress.cat_utilities;
			assert.equal(utilProg.budget, 120000);
			assert.equal(utilProg.actual, 30000);
			assert.equal(utilProg.consumption_rate, 25.0);
			assert.equal(utilProg.pace_status, 'ahead');

			// Prototype pollution defense in category budgets
			const hackedConfig = {
				expense_budget: 100000,
				category_budgets: {
					__proto__: 999999,
					cat_normal: 50000
				}
			};
			const hackedProgress = calculateAnnualBudgetProgress({
				budgetConfig: hackedConfig,
				categoryActuals: { cat_normal: 25000 }
			});
			assert.equal(Object.prototype.hasOwnProperty.call(hackedProgress.category_progress, '__proto__'), false);
			assert.equal(hackedProgress.category_progress.cat_normal.budget, 50000);
		});
	});

	describe('Tag Analytics & Summary (Requirement 3.18)', () => {
		const sampleTxs = [
			{ id: 'tx_1', type: 'expense', amount: 3000, status: 'confirmed', target_month: '2026-10', tags: ['ランチ', '外食'], is_deleted: false },
			{ id: 'tx_2', type: 'expense', amount: 5000, status: 'confirmed', target_month: '2026-10', tags: ['外食', '飲み会'], is_deleted: false },
			{ id: 'tx_3', type: 'expense', amount: 2000, status: 'planned', target_month: '2026-10', tags: ['ランチ'], is_deleted: false },
			{ id: 'tx_4', type: 'income', amount: 20000, status: 'confirmed', target_month: '2026-10', tags: ['副業'], is_deleted: false },
			{ id: 'tx_5', type: 'expense', amount: 1500, status: 'confirmed', target_month: '2026-10', tags: [], is_deleted: false },
			{ id: 'tx_del', type: 'expense', amount: 9999, status: 'confirmed', target_month: '2026-10', tags: ['外食'], is_deleted: true }
		];

		it('aggregates expense, income, and count by tag', () => {
			const res = calculateTagSummary(sampleTxs, { includePlanned: true });
			assert.ok(res.tags['外食']);
			assert.equal(res.tags['外食'].expense_total, 8000); // 3000 + 5000
			assert.equal(res.tags['外食'].count, 2);

			assert.ok(res.tags['ランチ']);
			assert.equal(res.tags['ランチ'].expense_total, 5000); // 3000 + 2000 (planned)
			assert.equal(res.tags['ランチ'].count, 2);

			assert.ok(res.tags['副業']);
			assert.equal(res.tags['副業'].income_total, 20000);
			assert.equal(res.tags['副業'].count, 1);

			// Untagged
			assert.ok(res.tags['(未設定)']);
			assert.equal(res.tags['(未設定)'].expense_total, 1500);

			assert.equal(res.total_expense, 11500);
			assert.equal(res.total_income, 20000);
		});

		it('excludes planned transactions when includePlanned is false', () => {
			const res = calculateTagSummary(sampleTxs, { includePlanned: false });
			assert.equal(res.tags['ランチ'].expense_total, 3000);
			assert.equal(res.tags['ランチ'].count, 1);
			assert.equal(res.total_expense, 9500);
		});

		it('filters tags by searchQuery and filterTag alias and provides sorted tagList', () => {
			const res = calculateTagSummary(sampleTxs, { filterTag: '食' });
			assert.ok(res.tags['外食']);
			assert.equal(Object.keys(res.tags).length, 1);
			assert.ok(Array.isArray(res.tagList));
			assert.equal(res.tagList.length, 1);
			assert.equal(res.tagList[0].tag, '外食');
			assert.equal(res.tagList[0].expense, 8000);
		});

		it('handles empty transactions list cleanly', () => {
			const res = calculateTagSummary([]);
			assert.deepEqual(res.tags, {});
			assert.deepEqual(res.tagList, []);
			assert.equal(res.total_expense, 0);
			assert.equal(res.total_income, 0);
		});
	});

	describe('Accrual vs Actual Cross-Aggregation Matrix (Requirement 3.23)', () => {
		const sampleCrossTxs = [
			{ id: 'c1', type: 'expense', amount: 5000, status: 'confirmed', target_month: '2026-10', category_id: 'cat_social', actual_category_id: 'cat_food', is_deleted: false },
			{ id: 'c2', type: 'expense', amount: 3000, status: 'confirmed', target_month: '2026-10', category_id: 'cat_food', actual_category_id: 'cat_food', is_deleted: false },
			{ id: 'c3', type: 'expense', amount: 10000, status: 'confirmed', target_month: '2026-10', category_id: 'cat_housing', actual_category_id: 'cat_fixed', is_deleted: false },
			{ id: 'c4', type: 'expense', amount: 4000, status: 'planned', target_month: '2026-10', category_id: 'cat_social', actual_category_id: 'cat_entertainment', is_deleted: false },
			{ id: 'c5', type: 'income', amount: 200000, status: 'confirmed', target_month: '2026-10', category_id: 'cat_salary', actual_category_id: 'cat_salary', is_deleted: false },
			{ id: 'cdel', type: 'expense', amount: 99999, status: 'confirmed', target_month: '2026-10', category_id: 'cat_social', actual_category_id: 'cat_food', is_deleted: true }
		];

		it('calculates 2D pivot matrix, row totals, column totals, and grand total', () => {
			const res = calculateCrossAccrualActualSummary(sampleCrossTxs, '2026-10', true);

			assert.ok(res.matrix.cat_social);
			assert.equal(res.matrix.cat_social.cat_food, 5000);
			assert.equal(res.matrix.cat_social.cat_entertainment, 4000);
			assert.equal(res.matrix.cat_social._total, 9000);
			assert.equal(res.rowTotals.cat_social, 9000);

			assert.equal(res.matrix.cat_food.cat_food, 3000);
			assert.equal(res.rowTotals.cat_food, 3000);

			assert.equal(res.matrix.cat_housing.cat_fixed, 10000);
			assert.equal(res.rowTotals.cat_housing, 10000);

			// Column totals
			assert.equal(res.colTotals.cat_food, 8000); // 5000 + 3000
			assert.equal(res.colTotals.cat_entertainment, 4000);
			assert.equal(res.colTotals.cat_fixed, 10000);

			// Grand total (5000 + 3000 + 10000 + 4000)
			assert.equal(res.grandTotal, 22000);

			// Categories list
			assert.deepEqual(res.categories.sort(), ['cat_food', 'cat_housing', 'cat_social'].sort());
			assert.deepEqual(res.actualCategories.sort(), ['cat_entertainment', 'cat_fixed', 'cat_food'].sort());
		});

		it('excludes planned transactions when includePlanned is false', () => {
			const res = calculateCrossAccrualActualSummary(sampleCrossTxs, '2026-10', false);
			assert.equal(res.rowTotals.cat_social, 5000);
			assert.equal(res.grandTotal, 18000);
			assert.equal(res.actualCategories.includes('cat_entertainment'), false);
		});

		it('handles missing categories with unclassified fallback', () => {
			const untypedTx = [{ id: 'u1', type: 'expense', amount: 1200, status: 'confirmed', target_month: '2026-10', category_id: null, actual_category_id: null, is_deleted: false }];
			const res = calculateCrossAccrualActualSummary(untypedTx);
			assert.equal(res.matrix.cat_unclassified.cat_unclassified, 1200);
			assert.equal(res.grandTotal, 1200);
		});

		it('returns clean zero state for empty list', () => {
			const res = calculateCrossAccrualActualSummary([]);
			assert.deepEqual(res.matrix, {});
			assert.equal(res.grandTotal, 0);
		});

		it('supports categories list as second argument for UI controller matrix rendering', () => {
			const categoriesMaster = [
				{ id: 'cat_social', name: '交際費', type: 'expense', is_archived: false },
				{ id: 'cat_food', name: '食費', type: 'expense', is_archived: false },
				{ id: 'cat_salary', name: '給与', type: 'income', is_archived: false }
			];
			const res = calculateCrossAccrualActualSummary(sampleCrossTxs, categoriesMaster, true);
			assert.ok(res.accrualTotals);
			assert.ok(res.actualTotals);
			assert.equal(res.accrualTotals.cat_social, 9000);
			assert.equal(res.actualTotals.cat_food, 8000);
			assert.equal(res.categories.length, 2); // Excludes income category
			assert.equal(res.categories[0].name, '交際費');
		});
	});

	describe('Credit Card Debit Date & Settlement (Requirement 3.21)', () => {
		const holidays = ['2026-10-12', '2026-11-23']; // 10-12 Sports day, 11-23 Labor day

		it('calculates billing cycle and debit date for 15th closing, 10th debit, offset 1', () => {
			// Date <= 15: inside current cycle
			const res1 = calculateCreditCardDebitDate('2026-10-14', 15, 10, 1, holidays);
			assert.equal(res1.billingCycle, '2026-10');
			assert.equal(res1.billingPeriodStart, '2026-09-16');
			assert.equal(res1.billingPeriodEnd, '2026-10-15');
			// Nov 10, 2026 is Tuesday (business day)
			assert.equal(res1.debitDate, '2026-11-10');

			// Date > 15: inside next cycle
			const res2 = calculateCreditCardDebitDate('2026-10-16', 15, 10, 1, holidays);
			assert.equal(res2.billingCycle, '2026-11');
			assert.equal(res2.billingPeriodStart, '2026-10-16');
			assert.equal(res2.billingPeriodEnd, '2026-11-15');
			assert.equal(res2.debitDate, '2026-12-10');
		});

		it('handles month-end (99) closing and debit dates across month lengths', () => {
			// Month-end closing (99) and month-end debit (99)
			const resFeb = calculateCreditCardDebitDate('2026-02-10', 99, 99, 1, holidays);
			assert.equal(resFeb.billingCycle, '2026-02');
			assert.equal(resFeb.billingPeriodEnd, '2026-02-28');
			// March 31, 2026 is Tuesday
			assert.equal(resFeb.debitDate, '2026-03-31');

			const resApr = calculateCreditCardDebitDate('2026-04-10', 99, 99, 1, holidays);
			assert.equal(resApr.billingPeriodEnd, '2026-04-30');
			// May 31, 2026 is Sunday -> shifts to June 1 (Monday)
			assert.equal(resApr.debitDate, '2026-06-01');
		});

		it('shifts debit date to next business day on weekend and holiday', () => {
			// Jan 2026: Closing 15, Debit 10, Offset 1 -> Feb 10
			// Suppose debit day is 10, and Oct 10, 2026 is Saturday -> shifts to Monday 12 (holiday) -> Tuesday 13
			const resSat = calculateCreditCardDebitDate('2026-09-05', 15, 10, 1, holidays);
			// 09-05 <= 15 -> cycle 2026-09 -> debit Oct 10, 2026
			// Oct 10 is Saturday -> Oct 11 is Sunday -> Oct 12 is holiday -> shifts to Oct 13!
			assert.equal(resSat.rawDebitDate, '2026-10-10');
			assert.equal(resSat.debitDate, '2026-10-13');
		});

		it('creates valid credit card settlement transfer transaction', () => {
			const tx = createCreditCardSettlementTransaction({
				payingAccountId: 'acc_bank_main',
				creditCardId: 'acc_card_a',
				amount: 75400,
				debitDate: '2026-11-10',
				billingCycle: '2026-10',
				todayStr: '2026-10-18'
			});

			assert.equal(tx.type, 'transfer');
			assert.equal(tx.account_id, 'acc_bank_main');
			assert.equal(tx.to_account_id, 'acc_card_a');
			assert.equal(tx.amount, 75400);
			assert.equal(tx.date, '2026-11-10');
			assert.equal(tx.target_month, '2026-11');
			assert.equal(tx.status, 'confirmed');
			assert.ok(tx.auto_settlement_meta);
			assert.equal(tx.auto_settlement_meta.card_id, 'acc_card_a');
			assert.equal(tx.auto_settlement_meta.billing_cycle, '2026-10');
		});
	});

	describe('Integrated Quick Calculator Evaluation (Requirement 3.25)', () => {
		it('evaluates simple and chained arithmetic operations', () => {
			assert.equal(evaluateCalculatorExpression('1500 + 500').amount, 2000);
			assert.equal(evaluateCalculatorExpression('3000 - 1200').amount, 1800);
			assert.equal(evaluateCalculatorExpression('250 * 4').amount, 1000);
			assert.equal(evaluateCalculatorExpression('250 × 4').amount, 1000);
			assert.equal(evaluateCalculatorExpression('1000 / 4').amount, 250);
			assert.equal(evaluateCalculatorExpression('1000 ÷ 4').amount, 250);
			assert.equal(evaluateCalculatorExpression('100 + 200 * 2').amount, 500);
		});

		it('applies tax actions correctly (+10%, +8%, inc10%, inc8%) with floor and round', () => {
			// +10%
			const tax10 = evaluateCalculatorExpression('1000', '+10%', 'floor');
			assert.equal(tax10.amount, 1100);
			assert.equal(tax10.tax_meta.tax_rate, 0.10);
			assert.equal(tax10.tax_meta.base_amount, 1000);
			assert.equal(tax10.tax_meta.tax_amount, 100);

			// +8%
			const tax8 = evaluateCalculatorExpression('1000', '+8%', 'floor');
			assert.equal(tax8.amount, 1080);
			assert.equal(tax8.tax_meta.tax_rate, 0.08);
			assert.equal(tax8.tax_meta.tax_amount, 80);

			// inc10% (内税10%: 1100 -> tax 100, base 1000)
			const inc10 = evaluateCalculatorExpression('1100', 'inc10%', 'floor');
			assert.equal(inc10.amount, 1100);
			assert.equal(inc10.base_amount, 1000);
			assert.equal(inc10.tax_meta.tax_amount, 100);

			// Keypad button data attributes: add10, add8, sub10, sub8
			const add10 = evaluateCalculatorExpression('2000', 'add10', 'floor');
			assert.equal(add10.amount, 2200);
			assert.equal(add10.result, 2200);
			assert.equal(add10.tax_meta.base_amount, 2000);
			assert.equal(add10.tax_meta.tax_amount, 200);

			const sub10 = evaluateCalculatorExpression('2200', 'sub10', 'floor');
			assert.equal(sub10.amount, 2200);
			assert.equal(sub10.result, 2200);
			assert.equal(sub10.base_amount, 2000);
			assert.equal(sub10.tax_meta.tax_amount, 200);

			const add8 = evaluateCalculatorExpression('1000', 'add8', 'floor');
			assert.equal(add8.amount, 1080);
			assert.equal(add8.result, 1080);
			assert.equal(add8.tax_meta.tax_amount, 80);

			const sub8 = evaluateCalculatorExpression('1080', 'sub8', 'floor');
			assert.equal(sub8.amount, 1080);
			assert.equal(sub8.result, 1080);
			assert.equal(sub8.tax_meta.tax_amount, 80);
		});

		it('handles division by zero and malformed input safely without crashing', () => {
			const divZero = evaluateCalculatorExpression('1000 / 0');
			assert.equal(divZero.success, false);
			assert.equal(divZero.amount, 0);

			const empty = evaluateCalculatorExpression('');
			assert.equal(empty.amount, 0);

			const malformed = evaluateCalculatorExpression('++--');
			assert.equal(malformed.amount, 0);

			const invalidChars = evaluateCalculatorExpression('100 + abc');
			assert.equal(invalidChars.success, false);
			assert.equal(invalidChars.amount, 0);
			assert.equal(invalidChars.error, 'Invalid characters in expression');
		});
	});

	describe('Doughnut Chart Tooltip & Transaction List Display / Multi-Filtering (Requirements 3.27–3.30)', () => {
		it('formatDoughnutTooltipLabel formats slice label, amount, and percentage with zero-division safety', () => {
			assert.equal(
				formatDoughnutTooltipLabel('食費', 45000, [45000, 30000, 25000]),
				'食費: ¥45,000 (45%)'
			);
			assert.equal(
				formatDoughnutTooltipLabel('日用品', 10000, [45000, 10000, 15000]),
				'日用品: ¥10,000 (14.3%)'
			);
			// Zero total safety
			assert.equal(
				formatDoughnutTooltipLabel('未分類', 0, [0, 0]),
				'未分類: ¥0 (0%)'
			);
			// Default / empty arguments
			assert.equal(
				formatDoughnutTooltipLabel(),
				'¥0 (0%)'
			);
		});

		it('resolveTransactionDisplayInfo resolves category, subcategory, transfer, and fallbacks', () => {
			const masterConfig = {
				categories: [
					{
						id: 'cat_food',
						name: '食費',
						icon: '🍽️',
						subcategories: [
							{ id: 'sub_groceries', name: '食料品' }
						]
					},
					{
						id: 'cat_housing',
						name: '住居費',
						icon: '🏠',
						subcategories: []
					},
					{
						id: 'cat_other',
						name: 'その他',
						icon: '📦',
						subcategories: [
							{ id: 'sub_cross_nested', name: '別カテゴリ内サブ' }
						]
					}
				],
				subcategories: [
					{ id: 'sub_root_item', name: 'ルート中項目' }
				]
			};

			// 1. Standard expense with nested subcategory
			const info1 = resolveTransactionDisplayInfo({
				type: 'expense',
				category_id: 'cat_food',
				subcategory_id: 'sub_groceries',
				memo: 'スーパー買い出し',
				tags: ['週末', '自炊']
			}, masterConfig);
			assert.equal(info1.primaryTitle, '🍽️ 食費 > 食料品');
			assert.equal(info1.categoryName, '食費');
			assert.equal(info1.subcategoryName, '食料品');
			assert.equal(info1.memo, 'スーパー買い出し');
			assert.deepEqual(info1.tags, ['週末', '自炊']);

			// 2. Category only (no subcategory)
			const info2 = resolveTransactionDisplayInfo({
				type: 'expense',
				category_id: 'cat_housing',
				subcategory_id: '',
				memo: ''
			}, masterConfig);
			assert.equal(info2.primaryTitle, '🏠 住居費');
			assert.equal(info2.subcategoryName, '');
			assert.equal(info2.memo, '');
			assert.deepEqual(info2.tags, []);

			// 3. Root subcategory lookup & cross-category nested subcategory lookup
			const infoRootSub = resolveTransactionDisplayInfo({
				type: 'expense',
				category_id: 'cat_housing',
				subcategory_id: 'sub_root_item'
			}, masterConfig);
			assert.equal(infoRootSub.primaryTitle, '🏠 住居費 > ルート中項目');

			const infoCrossSub = resolveTransactionDisplayInfo({
				type: 'expense',
				category_id: 'cat_housing',
				subcategory_id: 'sub_cross_nested'
			}, masterConfig);
			assert.equal(infoCrossSub.primaryTitle, '🏠 住居費 > 別カテゴリ内サブ');

			// 4. Transfer transaction
			const infoTransfer = resolveTransactionDisplayInfo({
				type: 'transfer',
				memo: '口座振替',
				tags: ['定期']
			}, masterConfig);
			assert.equal(infoTransfer.primaryTitle, '🔄 資金移動・振替');
			assert.equal(infoTransfer.memo, '口座振替');
			assert.deepEqual(infoTransfer.tags, ['定期']);

			// 5. Unclassified / Income default icon fallback
			const infoIncome = resolveTransactionDisplayInfo({
				type: 'income',
				category_id: 'cat_salary_custom',
				subcategory_id: 'sub_unknown'
			}, {});
			assert.equal(infoIncome.primaryTitle, '💰 cat_salary_custom > sub_unknown');

			const infoEmpty = resolveTransactionDisplayInfo();
			assert.equal(infoEmpty.primaryTitle, '🏷️ 未分類');
		});

		it('filterTransactionsByCriteria filters by status, category (accrual/actual), tag, and keyword (AND logic)', () => {
			const masterConfig = {
				categories: [
					{
						id: 'cat_food',
						name: '食費',
						icon: '🍽️',
						subcategories: [{ id: 'sub_groceries', name: '食料品' }]
					},
					{
						id: 'cat_ent',
						name: '交際費',
						icon: '🍻',
						subcategories: [{ id: 'sub_drink', name: '飲み会' }]
					}
				]
			};

			const txs = [
				{
					id: 'tx_1',
					status: 'confirmed',
					type: 'expense',
					category_id: 'cat_food',
					subcategory_id: 'sub_groceries',
					actual_category_id: 'cat_food',
					memo: 'イオンで野菜購入',
					tags: ['自炊', '特売'],
					is_deleted: false
				},
				{
					id: 'tx_2',
					status: 'planned',
					type: 'expense',
					category_id: 'cat_ent',
					subcategory_id: 'sub_drink',
					actual_category_id: 'cat_food', // Actual category is food
					memo: '歓送迎会ディナー',
					tags: ['会社', 'イベント'],
					is_deleted: false
				},
				{
					id: 'tx_3',
					status: 'confirmed',
					type: 'transfer',
					memo: 'メインバンクから財布へ',
					tags: [],
					is_deleted: false
				},
				{
					id: 'tx_deleted',
					status: 'confirmed',
					type: 'expense',
					category_id: 'cat_food',
					memo: '削除済み',
					is_deleted: true
				},
				null
			];

			// Default (all active)
			const allActive = filterTransactionsByCriteria(txs, {}, masterConfig);
			assert.equal(allActive.length, 3);

			// Filter by status
			const confirmedOnly = filterTransactionsByCriteria(txs, { status: 'confirmed' }, masterConfig);
			assert.equal(confirmedOnly.length, 2);
			const plannedOnly = filterTransactionsByCriteria(txs, { status: 'planned' }, masterConfig);
			assert.equal(plannedOnly.length, 1);
			assert.equal(plannedOnly[0].id, 'tx_2');

			// Filter by categoryId (matches either category_id OR actual_category_id)
			const foodTxs = filterTransactionsByCriteria(txs, { categoryId: 'cat_food' }, masterConfig);
			assert.equal(foodTxs.length, 2); // tx_1 (accrual=food) and tx_2 (actual=food)

			const entTxs = filterTransactionsByCriteria(txs, { categoryId: 'cat_ent' }, masterConfig);
			assert.equal(entTxs.length, 1);
			assert.equal(entTxs[0].id, 'tx_2');

			// Filter by tag
			const tagTxs = filterTransactionsByCriteria(txs, { tag: '自炊' }, masterConfig);
			assert.equal(tagTxs.length, 1);
			assert.equal(tagTxs[0].id, 'tx_1');

			// Filter by keyword (matches memo, category name, subcategory name, or tag)
			const kwMemo = filterTransactionsByCriteria(txs, { keyword: 'イオン' }, masterConfig);
			assert.equal(kwMemo.length, 1);
			assert.equal(kwMemo[0].id, 'tx_1');

			const kwSubcat = filterTransactionsByCriteria(txs, { keyword: '飲み会' }, masterConfig);
			assert.equal(kwSubcat.length, 1);
			assert.equal(kwSubcat[0].id, 'tx_2');

			const kwTag = filterTransactionsByCriteria(txs, { keyword: 'イベント' }, masterConfig);
			assert.equal(kwTag.length, 1);
			assert.equal(kwTag[0].id, 'tx_2');

			// Combined AND filter
			const combined = filterTransactionsByCriteria(txs, {
				status: 'confirmed',
				categoryId: 'cat_food',
				tag: '特売',
				keyword: '食料品'
			}, masterConfig);
			assert.equal(combined.length, 1);
			assert.equal(combined[0].id, 'tx_1');

			// Empty call fallback
			assert.deepEqual(filterTransactionsByCriteria(), []);

			// Filter by accountId (matches either account_id OR to_account_id) (Requirement 3.38)
			const txsWithAccounts = [
				{ id: 'tx_a1', account_id: 'acc_bank', to_account_id: null, is_deleted: false },
				{ id: 'tx_a2', account_id: 'acc_wallet', to_account_id: 'acc_bank', is_deleted: false },
				{ id: 'tx_a3', account_id: 'acc_card', to_account_id: null, is_deleted: false }
			];
			const bankFiltered = filterTransactionsByCriteria(txsWithAccounts, { accountId: 'acc_bank' }, masterConfig);
			assert.equal(bankFiltered.length, 2);
			assert.equal(bankFiltered[0].id, 'tx_a1');
			assert.equal(bankFiltered[1].id, 'tx_a2');
		});
	});

	describe('Loan Liability, Insurance Account & Recurring Sync (Requirements 3.34 & 3.35)', () => {
		it('calculateTotalAssetSummary aggregates loan as liability and insurance as asset', () => {
			const balances = {
				acc_bank: 500000,
				acc_ins_1: 1200000,
				acc_loan_1: -3000000,
				acc_loan_overpaid: 10000
			};
			const accounts = [
				{ id: 'acc_bank', name: 'メイン銀行', type: 'bank', is_asset: true },
				{ id: 'acc_ins_1', name: '学資保険', type: 'insurance', is_asset: true, maturity_date: '2035-03-31', maturity_amount: 2000000 },
				{ id: 'acc_loan_1', name: '住宅ローン', type: 'loan', is_asset: false },
				{ id: 'acc_loan_overpaid', name: '完済ローン過払', type: 'loan', is_asset: false }
			];

			const summary = calculateTotalAssetSummary(balances, accounts, []);
			assert.equal(summary.liquid_assets, 500000);
			assert.equal(summary.total_investment_assets, 1200000); // insurance included in investment/long-term assets
			assert.equal(summary.by_type.insurance, 1200000);
			assert.equal(summary.by_type.loan, -2990000); // -3,000,000 + 10,000
			assert.equal(summary.liabilities, 3010000); // 3,000,000 + 10,000 (both negative and positive loan balances treated as liability)
			assert.equal(summary.net_assets, -1310000); // 500,000 + 1,200,000 - 3,010,000
		});

		it('syncInsuranceRecurringRule creates, updates, and deactivates linked recurring rule', () => {
			// Null/invalid guard
			assert.equal(syncInsuranceRecurringRule(null, null), null);
			assert.equal(syncInsuranceRecurringRule({}, { id: '' }), null);

			const config = {
				categories: [{ id: 'cat_ins', name: '保険' }]
				// recurring_rules intentionally omitted to test array initialization
			};

			// Non-insurance account returns null when no existing rule
			const nonIns = syncInsuranceRecurringRule(config, { id: 'acc_bank', type: 'bank' }, '2026-10-19');
			assert.equal(nonIns, null);
			assert.ok(Array.isArray(config.recurring_rules));

			// Create new insurance recurring rule
			const insAcc = {
				id: 'acc_life_ins',
				name: '終身保険',
				type: 'insurance',
				is_archived: false,
				maturity_date: '2040-12-31',
				maturity_amount: 5000000,
				premium_amount: 15000,
				premium_day: 27,
				premium_pay_account_id: 'acc_bank_main',
				premium_category_id: 'cat_ins',
				premium_subcategory_id: ''
			};

			const createdRule = syncInsuranceRecurringRule(config, insAcc, '2026-10-19');
			assert.ok(createdRule);
			assert.equal(createdRule.id, 'rec_ins_acc_life_ins');
			assert.equal(createdRule.name, '[保険料] 終身保険');
			assert.equal(createdRule.amount, 15000);
			assert.equal(createdRule.day_of_month, 27);
			assert.equal(createdRule.account_id, 'acc_bank_main');
			assert.equal(createdRule.category_id, 'cat_ins');
			assert.equal(createdRule.subcategory_id, '');
			assert.equal(createdRule.start_date, '2026-10-01');
			assert.equal(createdRule.end_date, '2040-12-31');
			assert.equal(createdRule.is_active, true);
			assert.equal(config.recurring_rules.length, 1);

			// Update existing insurance recurring rule (preserves start_date)
			insAcc.premium_amount = 18000;
			insAcc.maturity_date = '2045-12-31';
			const updatedRule = syncInsuranceRecurringRule(config, insAcc, '2026-11-05');
			assert.equal(updatedRule.amount, 18000);
			assert.equal(updatedRule.end_date, '2045-12-31');
			assert.equal(updatedRule.start_date, '2026-10-01');
			assert.equal(config.recurring_rules.length, 1);

			// Archiving or zeroing premium deactivates existing rule
			insAcc.is_archived = true;
			const deactivatedRule = syncInsuranceRecurringRule(config, insAcc, '2026-11-05');
			assert.equal(deactivatedRule.is_active, false);
		});
	});
});


describe('Canonical GAS snapshot aggregation regression', () => {
	it('reads canonical snapshot totals in monthly and yearly summaries and respects explicit zero', () => {
		const history = {
			'2026-08': { income_total: 1000, expense_total: 200, net_income: 800 },
			'2026-09': { income_total: 0, expense_total: 0, total_income: 999, total_expense: 888 }
		};
		const monthly = aggregateMonthlySummaries([], '2026', history);
		assert.equal(monthly.months['2026-08'].expense_total, 200);
		assert.equal(monthly.months['2026-09'].income_total, 0);
		assert.equal(monthly.total_income, 1000);
		assert.equal(monthly.total_expense, 200);
		const yearly = aggregateYearlySummaries([], history)['2026'];
		assert.equal(yearly.income, 1000);
		assert.equal(yearly.expense, 200);
		assert.equal(yearly.net, 800);
	});
});
