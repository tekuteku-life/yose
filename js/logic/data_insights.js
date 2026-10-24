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

export const FURUSATO_TAX_RATES = [0, 5, 10, 20, 23, 33, 40, 45];
/** 住民税特例控除の20%上限から求める参考値（2015〜2037年）である。 */
export function estimateFurusatoLimit(input, year) {
	if (input == null || Number(year) < 2015 || Number(year) > 2037) return null;
	if (!Number.isSafeInteger(input.resident_tax) || input.resident_tax < 0 || !FURUSATO_TAX_RATES.includes(input.income_tax_rate)) throw new Error('住民税所得割額と特例控除用税率を確認してください。');
	return input.resident_tax === 0 ? 0 : Math.floor(input.resident_tax * 0.2 / (0.9 - input.income_tax_rate / 100 * 1.021) + 2000);
}

export function buildFurusatoSummary(transactions, config, year) {
	const name = 'ふるさと納税';
	const categories = config.categories || [];
	const records = transactions.filter(tx => {
		if (tx.is_deleted || tx.type !== 'expense' || !tx.date.startsWith(`${year}-`)) return false;
		const category = categories.find(c => c.id === tx.category_id);
		return tx.tags?.includes(name) || category?.name === name || category?.subcategories?.some(s => s.id === tx.subcategory_id && s.name === name);
	}).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
	const sum = status => records.filter(tx => tx.status === status && !tx.amount_pending).reduce((total, tx) => total + tx.amount, 0);
	const previous = transactions.filter(tx => !tx.is_deleted && !tx.amount_pending && tx.type === 'income' && tx.status === 'confirmed' && tx.date.startsWith(`${Number(year) - 1}-`));
	const limit = estimateFurusatoLimit(config.annual_budgets?.[year]?.furusato_estimate, year);
	return { records, confirmed: sum('confirmed'), planned: sum('planned'), pending: records.filter(tx => tx.amount_pending).length,
		previousIncome: previous.reduce((total, tx) => total + tx.amount, 0), previousCount: previous.length, limit, remaining: limit === null ? null : limit - sum('confirmed') };
}


export const FURUSATO_SOURCE_FIELDS = {
	salary: { label: '給与・賞与（税引前）', type: 'income' },
	income_tax: { label: '所得税', type: 'expense' },
	resident_tax: { label: '住民税', type: 'expense' },
	social_insurance: { label: '社会保険料', type: 'expense' }
};
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
