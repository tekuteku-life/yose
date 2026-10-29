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
	planRecurringTransactions,
	createPrepaidAmortizationTransactions,
	createAdvancePaymentTransactions,
	createAdvanceRepaymentTransaction,
	createPointPaymentTransactions,
	createCreditCardSettlementTransaction,
	evaluateCalculatorExpression,
	syncInsuranceRecurringRule
} from './logic/transaction_factory.js';

export {
	buildAssetHistory,
	calculateBalancesAndSummaries,
	aggregateDailySummaries,
	aggregateMonthlySummaries,
	aggregateYearlySummaries,
	calculateTotalAssetSummary,
	calculateTagSummary,
	calculateCrossAccrualActualSummary,
	formatDoughnutTooltipLabel,
	resolveTransactionDisplayInfo,
	filterTransactionsByCriteria
} from './logic/aggregator.js';

export {
	resolveAnnualTargets,
	roundTieredAmount,
	calculateAnnualBudgetDefaults,
	calculateAnnualBudgetProgress,
	generateAnnualTrajectory
} from './logic/budget_engine.js';

export { buildCategoryTrend } from './logic/category_trend.js';

