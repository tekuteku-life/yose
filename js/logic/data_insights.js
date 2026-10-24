import { FURUSATO_FIELDS, calculateFurusatoFromLedger, getFurusatoDonationData } from './furusato_calculator.js';
export { FURUSATO_TAX_RATES, estimateFurusatoLimit } from './furusato_calculator.js';
import { sharedMasterConfig } from './master_sync.js';

/** 取得済み業務JSONの論理サイズと、非削除明細の暦期間平均である。 */
export function buildDataMetadata(state) {
	const transactions = state.transactions || [];
	const active = transactions.filter(tx => !tx.is_deleted);
	const dates = active.map(tx => tx.date).filter(Boolean).sort();
	const firstDate = dates[0] || null, lastDate = dates.at(-1) || null;
	const monthIndex = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7));
	const months = firstDate ? monthIndex(lastDate) - monthIndex(firstDate) + 1 : 0;
	const years = firstDate ? Number(lastDate.slice(0, 4)) - Number(firstDate.slice(0, 4)) + 1 : 0;
	const business = { master_config: sharedMasterConfig(state.master_config), summary_snapshot: state.summary_snapshot || {}, transactions };
	return { count: active.length, deleted: transactions.length - active.length, confirmed: active.filter(tx => tx.status === 'confirmed').length, planned: active.filter(tx => tx.status === 'planned').length,
		firstDate, lastDate, months, years, monthlyAverage: months ? active.length / months : 0, yearlyAverage: years ? active.length / years : 0,
		bytes: new TextEncoder().encode(JSON.stringify(business)).length };
}

export function buildFurusatoSummary(transactions, config, year, options = {}) {
	const donations = getFurusatoDonationData(transactions, config, year);
	const previous = transactions.filter(tx => !tx.is_deleted && !tx.amount_pending && tx.type === 'income' && tx.status === 'confirmed' && tx.date.startsWith(`${Number(year) - 1}-`));
	const limit = (options.calculation || calculateFurusatoFromLedger(transactions, config, year)).limit;
	return { ...donations, previousIncome: previous.reduce((total, tx) => total + tx.amount, 0), previousCount: previous.length, limit, remaining: limit === null || donations.confirmed === null ? null : limit - donations.confirmed };
}


export const FURUSATO_SOURCE_FIELDS = FURUSATO_FIELDS;
/** 本人が明示した計上分類から、通知書確認用の取得済み明細だけを集計する。 */
export function buildFurusatoLedgerSummary(transactions, config, year, sources = config.annual_budgets?.[year]?.furusato_sources || {}) {
	return Object.fromEntries(Object.entries(FURUSATO_SOURCE_FIELDS).map(([field, definition]) => {
		const selected = sources[field] || [];
		const total = target => {
			const rows = transactions.filter(tx => !tx.is_deleted && !tx.amount_pending && tx.status === 'confirmed' && tx.type === definition.type && tx.date.startsWith(`${target}-`) && selected.some(source => source.category_id === tx.category_id && (source.subcategory_id === null || source.subcategory_id === tx.subcategory_id)));
			return { amount: rows.reduce((sum, tx) => sum + tx.amount, 0), count: rows.length };
		};
		return [field, { configured: selected.length > 0, previous: total(Number(year) - 1), current: total(year) }];
	}));
}
