/** Expense category time series; calendar dates for daily, accounting periods for longer views. */
import { aggregateMonthlySummaries, aggregateYearlySummaries } from './aggregator.js';
import { formatDate, getLastDayOfMonth } from './date_utils.js';

export function buildCategoryTrend(transactions = [], snapshot = {}, config = {}, {
	granularity = 'monthly', month = formatDate(new Date()).slice(0, 7), year = month.slice(0, 4), actualAxis = false, includePlanned = true
} = {}) {
	const visible = transactions.filter(tx => !tx.is_deleted && (includePlanned || tx.status === 'confirmed'));
	const axis = actualAxis ? 'by_actual_category' : 'by_category';
	let buckets;
	if (granularity === 'daily') {
		const [y, m] = month.split('-').map(Number);
		const days = new Map(Array.from({ length: getLastDayOfMonth(y, m) }, (_, index) => [`${month}-${String(index + 1).padStart(2, '0')}`, new Map()]));
		for (const tx of visible) {
			const values = days.get(tx.date);
			if (!values || tx.type !== 'expense') continue;
			const id = (actualAxis ? tx.actual_category_id : null) || tx.category_id || 'cat_unclassified';
			values.set(id, (values.get(id) || 0) + (Number(tx.amount) || 0));
		}
		buckets = [...days].map(([label, values]) => ({ label, values }));
	} else {
		const data = granularity === 'yearly'
			? aggregateYearlySummaries(visible, snapshot?.monthly_summaries || {})
			: aggregateMonthlySummaries(visible, year, snapshot?.monthly_summaries || {}).months;
		buckets = Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, values: new Map(Object.entries(value[axis])) }));
	}
	const names = new Map((config?.categories || []).map(item => [item.id, String(item.name || item.id)]));
	const ids = new Set(buckets.flatMap(bucket => [...bucket.values.keys()]));
	const series = [...ids].map(id => ({ id, name: names.get(id) || (id === 'cat_unclassified' ? '未分類' : id), values: buckets.map(bucket => Number(bucket.values.get(id)) || 0) }));
	return { labels: buckets.map(bucket => bucket.label), series };
}
