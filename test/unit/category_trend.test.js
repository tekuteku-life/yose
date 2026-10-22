import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
const { buildCategoryTrend } = await import('../../js/logic/category_trend.js').catch(() => ({}));
const config = { categories: [{ id: 'food', name: '食費' }, { id: 'old', name: '旧費目', is_archived: true }, { id: 'housing', name: '住居' }] };
const tx = (extra = {}) => ({ type: 'expense', status: 'confirmed', date: '2026-10-20', target_month: '2026-10', amount: 10, category_id: 'food', actual_category_id: 'housing', ...extra });
function build(transactions = [], snapshot = {}, options = {}) {
	assert.equal(typeof buildCategoryTrend, 'function', 'category trend must be implemented');
	return buildCategoryTrend(transactions, snapshot, config, { granularity: 'monthly', month: '2026-10', year: '2026', includePlanned: true, ...options });
}
const series = (data, id) => data.series.find(row => row.id === id);
describe('category expense time series', () => {
	it('supports default periods and absent snapshot or category master data', () => {
		const defaults = buildCategoryTrend();
		assert.equal(defaults.labels.length, 12); assert.deepEqual(defaults.series, []);
		const absent = buildCategoryTrend([tx()], null, null, { month: '2026-10' });
		assert.equal(series(absent, 'food').name, 'food'); assert.equal(series(absent, 'food').values[9], 10);
		const unnamed = buildCategoryTrend([tx()], {}, { categories: [{ id: 'food', name: '' }] }, { month: '2026-10' });
		assert.equal(series(unnamed, 'food').name, 'food');
	});
	it('accumulates same-day zero and planned amounts and falls back from an unset actual category', () => {
		const rows = [tx({ amount: 0 }), tx({ amount: 5, actual_category_id: null }), tx({ amount: 7, status: 'planned', actual_category_id: null })];
		assert.equal(series(build(rows, {}, { granularity: 'daily', actualAxis: true }), 'food').values[19], 12);
		assert.equal(series(build(rows, {}, { granularity: 'daily', actualAxis: true, includePlanned: false }), 'food').values[19], 5);
		assert.equal(series(build([tx({ category_id: null, actual_category_id: null })], {}, { granularity: 'daily', actualAxis: true }), 'cat_unclassified').values[19], 10);
	});
	it('retains empty historical category buckets without inventing an expense', () => {
		const data = build([], { monthly_summaries: { '2026-10': { by_category: { old: 0 } } } });
		assert.equal(series(data, 'old').values[9], 0);
	});
	it('uses a calendar month of transaction dates for daily series, independent of accounting month', () => {
		const data = build([tx({ target_month: '2026-09' }), tx({ date: '2026-11-01' }), tx({ is_deleted: true }), tx({ type: 'income' }), tx({ type: 'transfer' })], {}, { granularity: 'daily' });
		assert.equal(data.labels.length, 31); assert.equal(data.labels[19], '2026-10-20');
		assert.equal(series(data, 'food').values[19], 10); assert.equal(series(data, 'food').values.reduce((a, b) => a + b), 10);
	});
	it('uses snapshot values once while retaining all twelve monthly buckets', () => {
		const data = build([tx({ target_month: '2026-09', amount: 999 }), tx(), tx({ target_month: '2025-10' })], { monthly_summaries: { '2026-09': { by_category: { old: { total: 70 } }, by_actual_category: { housing: 70 } } } });
		assert.equal(data.labels.length, 12); assert.equal(data.labels[8], '2026-09');
		assert.equal(series(data, 'old').values[8], 70); assert.equal(series(data, 'old').name, '旧費目');
		assert.equal(series(data, 'food').values[8], 0); assert.equal(series(data, 'food').values[9], 10);
	});
	it('honors planned visibility and accounting versus actual classification', () => {
		const rows = [tx(), tx({ status: 'planned', amount: 30 })];
		assert.equal(series(build(rows), 'food').values[9], 40);
		assert.equal(series(build(rows, {}, { includePlanned: false }), 'food').values[9], 10);
		assert.equal(series(build(rows, {}, { actualAxis: true }), 'housing').values[9], 40);
		assert.equal(series(build([tx({ actual_category_id: null })], {}, { actualAxis: true }), 'food').values[9], 10);
	});
	it('keeps confirmed snapshots with planned hidden and selects the matching historical classification axis', () => {
		const snapshot = { monthly_summaries: { '2026-10': { by_category: { food: { total: 70 } }, by_actual_category: { housing: { total: 80 } } } } };
		const rows = [tx({ amount: 999 }), tx({ amount: 888, status: 'planned' })];
		assert.equal(series(build(rows, snapshot, { includePlanned: false }), 'food').values[9], 70);
		assert.equal(series(build(rows, snapshot, { includePlanned: false, actualAxis: true }), 'housing').values[9], 80);
	});
	it('sorts annual series chronologically and uses accounting years across deferred dates', () => {
		const data = build([tx({ target_month: '2027-01', date: '2026-12-31' }), tx()], { monthly_summaries: { '2025-12': { by_category: { old: 60 } } } }, { granularity: 'yearly' });
		assert.deepEqual(data.labels, ['2025', '2026', '2027']); assert.deepEqual(series(data, 'old').values, [60, 0, 0]); assert.deepEqual(series(data, 'food').values, [0, 10, 10]);
	});
	it('keeps zero-valued categories, resolves unknown and unclassified names, and does not mutate inputs', () => {
		const rows = [tx({ amount: 0 }), tx({ category_id: 'unknown' }), tx({ category_id: null })], original = structuredClone(rows);
		const data = build(rows);
		assert.equal(series(data, 'food').values[9], 0); assert.equal(series(data, 'unknown').name, 'unknown'); assert.equal(series(data, 'cat_unclassified').name, '未分類');
		assert.deepEqual(rows, original);
	});
	it('returns a leap-month calendar and empty datasets without inventing historical daily values', () => {
		const data = build([], { monthly_summaries: { '2024-02': { by_category: { food: 99 } } } }, { granularity: 'daily', month: '2024-02' });
		assert.equal(data.labels.length, 29); assert.deepEqual(data.series, []);
		assert.deepEqual(build([], {}, { granularity: 'yearly' }).series, []);
	});
});
