/**
 * Yoseatsume Kakeibo - Core Financial & Calculation Logic Entrypoint Facade (Schema v2)
 * Re-exports modular calculation engines from ./logic/ for 100% backward compatibility.
 */

export {
	formatDate,
	parseDate,
	addMonthsToMonthStr,
	getLastDayOfMonth,
	isWeekend,
	isHoliday,
	isBusinessDay,
	adjustDateForHoliday,
	JAPANESE_HOLIDAYS_PRESET,
	parseHolidayTextOrCsv,
	groupHolidaysByYear,
	generateUUID,
	escapeHtml,
	calculateCreditCardDebitDate
} from './logic/date_utils.js';

export {
	calculateTax,
	generateRecurringTransactions,
	createPrepaidAmortizationTransactions,
	createAdvancePaymentTransactions,
	createAdvanceRepaymentTransaction,
	createPointPaymentTransactions,
	createCreditCardSettlementTransaction,
	evaluateCalculatorExpression
} from './logic/transaction_factory.js';

export {
	calculateBalancesAndSummaries,
	aggregateDailySummaries,
	aggregateMonthlySummaries,
	aggregateYearlySummaries,
	calculateTotalAssetSummary,
	calculateTagSummary,
	calculateCrossAccrualActualSummary
} from './logic/aggregator.js';

export {
	roundTieredAmount,
	calculateAnnualBudgetDefaults,
	calculateAnnualBudgetProgress,
	generateAnnualTrajectory
} from './logic/budget_engine.js';

