import { it } from 'node:test';
import assert from 'node:assert/strict';
import { buildCategoryTrend } from '../../js/logic/category_trend.js';
import { transaction } from '../helpers/ui_fixture.js';
const rows = [transaction('income', { type: 'income', category_id: 'salary', actual_category_id: 'bonus', amount: 100 }), transaction('planned', { type: 'income', category_id: 'salary', actual_category_id: null, status: 'planned', amount: 50 }), transaction('expense')];
const config = { categories: [{ id: 'salary', name: '給与', type: 'income', is_archived: true }, { id: 'bonus', name: '賞与', type: 'income' }] };
const build = (tx = rows, snapshot = {}, options = {}) => buildCategoryTrend(tx, snapshot, config, { type: 'income', month: '2026-10', year: '2026', ...options });
const sum = trend => trend.series.reduce((s, row) => s + row.values.reduce((a, b) => a + b, 0), 0);
it('selects income only across daily, monthly and annual scopes and planned/actual axes', () => {
	assert.equal(sum(build()), 150); assert.equal(sum(build(rows, {}, { includePlanned: false })), 100);
	assert.equal(build().series[0].name, '給与');
	assert.equal(build(rows, {}, { actualAxis: true }).series.find(r => r.id === 'bonus').values[9], 100);
	assert.equal(sum(build(rows, {}, { granularity: 'yearly' })), 150);
	assert.equal(build(rows, {}, { granularity: 'daily' }).series[0].values[19], 150);
	assert.equal(sum(build(rows.map(r => ({ ...r, is_deleted: true })))), 0);
});
it('uses accounting months but calendar days and never double counts frozen income maps', () => {
	const snapshot = { monthly_summaries: { '2026-10': { income_total: 70, by_income_category: { salary: { total: 70, by_subcategory: { sub_unclassified: 70 } } }, by_actual_income_category: { bonus: { total: 70, by_subcategory: { sub_unclassified: 70 } } } } } };
	assert.equal(sum(build(rows, snapshot)), 70);
	assert.equal(build(rows, snapshot, { actualAxis: true }).series[0].id, 'bonus');
	assert.equal(sum(build(rows.map(r => ({ ...r, target_month: '2025-10' })))), 0);
	assert.equal(sum(build(rows.map(r => ({ ...r, target_month: '2025-10' })), {}, { granularity: 'daily' })), 150);
});
it('labels unverified historical income as unknown without colliding with real category IDs', () => {
	const snapshot = { monthly_summaries: { '2026-10': { income_total: 100 } } };
	let trend = build(rows, snapshot);
	assert.equal(sum(trend), 100); assert.equal(trend.series[0].id, null); assert.equal(trend.series[0].kind, 'unknown');
	trend = build(rows, snapshot, { historyOptions: { archiveMonths: ['2026-10'] } });
	assert.equal(trend.series[0].id, 'salary'); assert.equal(sum(trend), 100);
	trend = build(rows, { monthly_summaries: { '2026-10': { income_total: 101 } } }, { historyOptions: { archiveMonths: ['2026-10'] } });
	assert.equal(trend.series[0].id, null); assert.equal(sum(trend), 101);
});

it('keeps a real income category named like the unknown series distinct', () => {
	const data=buildCategoryTrend([transaction('real',{type:'income',category_id:'income_unknown',actual_category_id:'income_unknown',amount:50})], {monthly_summaries:{'2026-09':{income_total:100}}}, {categories:[{id:'income_unknown',name:'収入内訳未取得',type:'income'}]}, {type:'income',year:'2026'});
	assert.equal(data.series.length,2);assert.equal(data.series.find(r=>r.id===null).values[8],100);assert.equal(data.series.find(r=>r.id==='income_unknown').values[9],50);
});
