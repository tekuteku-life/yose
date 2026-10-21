import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow, settings } from '../helpers/ui_fixture.js';
const fixture = useBrowser();
const chart = d => d.evaluate('window.__yose_app.chartController.categoryTrendChart?.data || null');
async function waitTrend(d) { await d.waitFor('Boolean(window.__yose_app.chartController.categoryTrendChart)'); }
describe('category trend visualization', () => {
	it('renders monthly category series and keeps the existing doughnut and drilldown list', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('food', { amount: 20 }), transaction('housing', { category_id: 'cat_housing', actual_category_id: 'cat_housing', amount: 30 }), transaction('prior', { date: '2026-09-10', target_month: '2026-09', amount: 999 }), transaction('planned', { target_month: '2026-11', date: '2026-11-10', category_id: 'cat_housing', amount: 40, status: 'planned' })]);
		await d.evaluate(`(async()=>{const db=window.__yose_app.db; const snapshot=await db.getSnapshot();snapshot.monthly_summaries={'2026-09':{by_category:{cat_food:70},by_actual_category:{cat_food:70}}};await db.saveSnapshot(snapshot);})()`);
		await cashflow(d); await waitTrend(d);
		const data = await chart(d);
		assert.equal(data.labels.length, 12);
		assert.deepEqual(data.datasets.find(row => row.categoryId === 'cat_food').data.slice(8, 11), [70, 20, 0]);
		assert.deepEqual(data.datasets.find(row => row.categoryId === 'cat_housing').data.slice(8, 11), [0, 30, 40]);
		assert.equal(await d.isVisible('#category-breakdown-chart'), true);
		assert.ok((await d.textContent('#category-breakdown-list')).includes('食費'));
		await d.click('#category-breakdown-list [data-filter-category="cat_housing"]');
		await d.waitFor(`document.querySelectorAll('#month-tx-list .tx-item').length===1 && document.querySelector('#month-tx-list .tx-item')?.dataset.id==='housing'`);
	});
	it('switches planned visibility and actual classification and destroys the replaced chart', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('confirmed', { amount: 10, actual_category_id: 'cat_housing' }), transaction('planned', { amount: 30, status: 'planned', actual_category_id: 'cat_housing' })]);
		await cashflow(d); await waitTrend(d);
		await d.evaluate('window.__oldTrend=window.__yose_app.chartController.categoryTrendChart');
		await d.click('#btn-toggle-planned');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.data.datasets[0]?.data[9]===10');
		assert.equal(await d.evaluate('window.__oldTrend.destroyed'), true);
		await d.click('#btn-toggle-axis');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.data.datasets[0]?.categoryId==="cat_housing"');
		assert.equal((await chart(d)).datasets[0].data[9], 10);
	});
	it('uses transaction days and shows chronological yearly categories with archived names', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('deferred', { target_month: '2026-09', amount: 17 }), transaction('past', { date: '2025-12-01', target_month: '2025-12', amount: 19 })]);
		await d.evaluate(`window.__yose_app.db.mutateMasterConfig(config=>{config.categories.find(c=>c.id==='cat_food').is_archived=true;})`);
		await cashflow(d);
		await d.click('#control-granularity [data-granularity="daily"]');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.data.labels.length===31');
		assert.equal((await chart(d)).datasets[0].data[19], 17);
		assert.ok((await d.textContent('#category-trend-scope')).includes('取得済み'));
		await d.click('#control-granularity [data-granularity="yearly"]');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.data.labels.length===2');
		assert.deepEqual((await chart(d)).labels, ['2025', '2026']);
		assert.equal((await chart(d)).datasets[0].label, '食費');
	});
	it('renders an escaped time-series table without Chart.js and clears stale charts for empty data', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('fallback', { amount: 123 })]);
		await cashflow(d); await waitTrend(d);
		await d.evaluate(`(async()=>{window.__oldTrend=window.__yose_app.chartController.categoryTrendChart;window.Chart=undefined;await window.__yose_app.db.mutateMasterConfig(c=>{c.categories.find(x=>x.id==='cat_food').name='<img src=x onerror="window.__trendXss=1">';});await window.__yose_app.summaryController.renderSummary();})()`);
		assert.equal(await d.isVisible('#category-trend-fallback'), true);
		assert.ok((await d.textContent('#category-trend-fallback')).includes('123'));
		assert.ok((await d.textContent('#category-trend-fallback')).includes('<img'));
		assert.equal(await d.evaluate('Boolean(window.__trendXss)||Boolean(document.querySelector("#category-trend-fallback img"))'), false);
		assert.equal(await d.evaluate('window.__oldTrend.destroyed'), true);
		await d.evaluate(`(async()=>{await window.__yose_app.db.deleteTransaction('fallback');await window.__yose_app.summaryController.renderSummary();})()`);
		assert.ok((await d.textContent('#category-trend-fallback')).includes('ありません'));
		assert.equal(await chart(d), null);
	});
	it('replaces the trend on theme changes and destroys it when the visible series becomes empty', async () => {
		const d = fixture.driver; await seed(d, [transaction('theme')]); await cashflow(d); await waitTrend(d);
		const original = await chart(d);
		await d.evaluate('window.__oldTrend=window.__yose_app.chartController.categoryTrendChart');
		await settings(d); await d.click('#theme-radio-dark');
		await d.waitFor('window.__oldTrend.destroyed && window.__yose_app.chartController.isDark');
		assert.equal(await d.evaluate('window.__oldTrend.destroyed'), true);
		assert.deepEqual(await chart(d), original);
		await d.evaluate(`(async()=>{const app=window.__yose_app;window.__oldTrend=app.chartController.categoryTrendChart;await app.db.deleteTransaction('theme');await app.summaryController.renderSummary();})()`);
		assert.equal(await d.evaluate('window.__oldTrend.destroyed'), true);
		assert.equal(await chart(d), null);
		assert.ok((await d.textContent('#category-trend-fallback')).includes('ありません'));
	});
	it('does not let an older summary read overwrite a newer chart or breakdown', async () => {
		const d = fixture.driver; await seed(d, [transaction('race')]); await cashflow(d);
		await d.evaluate(`const app=window.__yose_app, get=app.db.getMasterConfig.bind(app.db);let first=true;
		app.db.getMasterConfig=async()=>{const config=await get();if(first){first=false;await new Promise(resolve=>window.__releaseSummary=resolve);}return config;};
		window.__oldSummary=app.summaryController.renderSummary();void 0;`);
		await d.waitFor('typeof window.__releaseSummary==="function"');
		await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.categories.find(x=>x.id==='cat_food').name='新版';});await app.summaryController.renderSummary();window.__releaseSummary();await window.__oldSummary;})()`);
		assert.equal((await chart(d)).datasets[0].label, '新版');
		assert.ok((await d.textContent('#category-breakdown-list')).includes('新版'));
	});
});
