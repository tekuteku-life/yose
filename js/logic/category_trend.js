/** Expense category time series; calendar dates for daily, accounting periods for longer views. */
import { aggregateMonthlySummaries, aggregateYearlySummaries } from './aggregator.js';
import { formatDate, getLastDayOfMonth } from './date_utils.js';

export function buildCategoryTrend(transactions = [], snapshot = {}, config = {}, {
	type = 'expense', historyOptions = {}, granularity = 'monthly', month = formatDate(new Date()).slice(0, 7), year = month.slice(0, 4), actualAxis = false, includePlanned = true
} = {}) {
	const visible = transactions.filter(tx => !tx.is_deleted && (includePlanned || tx.status === 'confirmed'));
	const axis = actualAxis ? 'by_actual_category' : 'by_category';
	let buckets;
	if (granularity === 'daily') {
		const [y, m] = month.split('-').map(Number);
		const days = new Map(Array.from({ length: getLastDayOfMonth(y, m) }, (_, index) => [`${month}-${String(index + 1).padStart(2, '0')}`, new Map()]));
		for (const tx of visible) {
			const values = days.get(tx.date);
			if (!values || tx.type !== type) continue;
			const id = (actualAxis ? tx.actual_category_id : null) || tx.category_id || 'cat_unclassified';
			values.set(id, (values.get(id) || 0) + (Number(tx.amount) || 0));
		}
		buckets = [...days].map(([label, values]) => ({ label, values }));
	} else if (type === 'income') {
		buckets = incomeBuckets(visible, snapshot, { granularity, year, actualAxis, historyOptions });
	} else {
		const data = granularity === 'yearly'
			? aggregateYearlySummaries(visible, snapshot?.monthly_summaries || {})
			: aggregateMonthlySummaries(visible, year, snapshot?.monthly_summaries || {}).months;
		buckets = Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, values: new Map(Object.entries(value[axis])) }));
	}
	const names = new Map((config?.categories || []).map(item => [item.id, String(item.name || item.id)]));
	const ids = new Set(buckets.flatMap(bucket => [...bucket.values.keys()]));
	const series = [...ids].map(id => ({ id, kind: 'category', name: names.get(id) || (id === 'cat_unclassified' ? '未分類' : id), values: buckets.map(bucket => Number(bucket.values.get(id)) || 0) }));
	if (buckets.some(bucket => bucket.unknown !== undefined)) series.push({ id: null, kind: 'unknown', name: '収入内訳未取得', values: buckets.map(bucket => bucket.unknown || 0) });
	return { labels: buckets.map(bucket => bucket.label), series };
}

function incomeBuckets(transactions, snapshot, { granularity, year, actualAxis, historyOptions }) {
	const summaries = snapshot?.monthly_summaries || {}, monthly = new Map();
	const ensure = label => { if (!monthly.has(label)) monthly.set(label, { label, values: new Map() }); return monthly.get(label); };
	if (granularity !== 'yearly') for (let m = 1; m <= 12; m++) ensure(`${year}-${String(m).padStart(2, '0')}`);
	const add = (bucket, id, amount) => bucket.values.set(id, (bucket.values.get(id) || 0) + amount);
	for (const tx of transactions) {
		const month = tx.target_month || tx.date?.slice(0, 7);
		if (!month || (granularity !== 'yearly' && !month.startsWith(`${year}-`))) continue;
		const bucket = ensure(month);
		if (summaries[month] || tx.type !== 'income') continue;
		add(bucket, (actualAxis ? tx.actual_category_id : null) || tx.category_id || 'cat_unclassified', Number(tx.amount) || 0);
	}
	for (const [month, summary] of Object.entries(summaries)) {
		if (granularity !== 'yearly' && !month.startsWith(`${year}-`)) continue;
		const bucket = ensure(month), map = summary[actualAxis ? 'by_actual_income_category' : 'by_income_category'];
		if (map) { for (const [id, item] of Object.entries(map)) add(bucket, id, item.total); continue; }
		const total = Number(summary.income_total ?? summary.income_confirmed ?? summary.total_income ?? 0);
		const original = transactions.filter(tx => tx.type === 'income' && tx.status === 'confirmed' && !tx.amount_pending && (tx.target_month || tx.date?.slice(0, 7)) === month);
		if (historyOptions.archiveMonths?.includes(month) && original.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0) === total) {
			for (const tx of original) add(bucket, (actualAxis ? tx.actual_category_id : null) || tx.category_id || 'cat_unclassified', Number(tx.amount) || 0);
		} else if (total) bucket.unknown = total;
	}
	if (granularity !== 'yearly') return [...monthly.values()].sort((a, b) => a.label.localeCompare(b.label));
	const annual = new Map();
	for (const bucket of monthly.values()) {
		const label = bucket.label.slice(0, 4);
		if (!annual.has(label)) annual.set(label, { label, values: new Map() });
		const target = annual.get(label);
		for (const [id, amount] of bucket.values) add(target, id, amount);
		if (bucket.unknown !== undefined) target.unknown = (target.unknown || 0) + bucket.unknown;
	}
	return [...annual.values()].sort((a, b) => a.label.localeCompare(b.label));
}
