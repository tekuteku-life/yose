import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow, waitForDialog } from '../helpers/ui_fixture.js';

const fixture = useBrowser({ realCharts: true });
beforeEach(async () => {
	await fixture.driver.evaluate(`{
		window.__closeRequests=[];
		const controller=window.__yose_app.summaryController,close=controller.handleCloseMonth.bind(controller);
		controller.handleCloseMonth=(...args)=>{const pending=close(...args);window.__closeRequests.push(pending);return pending;};
		window.__plotEvents=[];
		window.Chart.register({id:'test-focused-event-observer',afterEvent(chart,args){window.__plotEvents.push({canvas:chart.canvas?.id,type:args.event.native.type,inChartArea:args.inChartArea,touches:args.event.native.touches?.length||0});}});
	}`);
});
const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
async function yearly(d) {
	await cashflow(d);
	await d.click('#control-granularity [data-granularity="yearly"]');
	await d.waitFor('document.querySelector("#period-display").textContent.includes("2026年")');
	await d.evaluate('window.__closedMonths=[];window.__yose_app.syncManager.closeMonth=async(month,options)=>{window.__closedMonths.push({month,options});};');
}
async function finish(d) {
	await d.waitFor('window.__closeRequests.length>0');
	await d.evaluate('(async()=>{const pending=window.__closeRequests.splice(0);await Promise.all(pending);})()');
	await d.waitFor('!document.querySelector("#btn-close-month").disabled && !window.__yose_app.summaryController.closingMonths');
}
async function move(d, slot, expression, touch = false) {
	const point = await d.evaluate(`(()=>{const c=window.__yose_app.chartController.${slot};c.canvas.scrollIntoView({block:'center',behavior:'instant'});const p=${expression},r=c.canvas.getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y};})()`);
	if (touch) await d.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }, d.sessionId);
	else await d.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }, d.sessionId);
}
async function trackedMove(d, slot, expression, touch = false) {
	const before = await d.evaluate('window.__plotEvents.length');
	const canvas = await d.evaluate(`window.__yose_app.chartController.${slot}.canvas.id`);
	await move(d, slot, expression, touch);
	await d.waitFor(`window.__plotEvents.slice(${before}).some(e=>e.canvas===${JSON.stringify(canvas)}&&e.type===${JSON.stringify(touch ? 'touchstart' : 'mousemove')})`);
}
const tooltip = (d, slot) => d.evaluate(`(()=>{const c=window.__yose_app.chartController.${slot},t=c.tooltip;return {visible:t.opacity>0,items:(t.dataPoints||[]).map(p=>({date:p.label,label:p.dataset.label,value:p.parsed.y,index:p.dataIndex})),body:t.body,hover:c.getActiveElements().length,active:t.getActiveElements().length};})()`);
const observedValue = async (d, slot) => (await tooltip(d, slot)).items.map(({ date, label, value }) => ({ date, label, value }));
async function chartState(d, slot) {
	const { visible, hover, active } = await tooltip(d, slot);
	return { visible, hover, active };
}
async function sampleTrend(d) {
	await cashflow(d);
	await d.evaluate(`window.__yose_app.chartController.renderCategoryTrend({type:'expense',labels:['1月','2月','3月'],series:[{id:'a',kind:'category',name:'食費',values:[1000,1000,1000]},{id:'b',kind:'category',name:'家賃',values:[8000,8000,8000]}]})`);
	await trackedMove(d, 'categoryTrendChart', 'c.getDatasetMeta(0).data[1]');
	assert.deepEqual(await observedValue(d, 'categoryTrendChart'), [{ date: '2月', label: '食費', value: 1000 }]);
}

describe('annual closing and focused chart tooltips', () => {
	it('closes all twelve selected-year months in order with their approved planned records', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('jan', { target_month: '2026-01', status: 'planned' }), transaction('dec', { target_month: '2026-12', status: 'planned' }), transaction('other', { target_month: '2025-12', status: 'planned' })]);
		await yearly(d);
		assert.match(await d.textContent('#btn-close-month'), /2026年.*一括/);
		await d.click('#btn-close-month'); await waitForDialog(d, '12か月'); await finish(d);
		const calls = await d.evaluate('window.__closedMonths');
		assert.deepEqual(calls.map(c => c.month), months);
		assert.deepEqual(calls[0].options.approvedPlanned.map(t => t.id), ['jan']);
		assert.deepEqual(calls[11].options.approvedPlanned.map(t => t.id), ['dec']);
		assert.deepEqual(calls[1].options.approvedPlanned, []);
		const confirms = await d.evaluate('window.__dialogs.filter(d=>d.type==="confirm").map(d=>d.message)');
		assert.ok(confirms.some(text => text.includes('2 件') && text.includes('2026-01') && text.includes('2026-12') && text.includes('未来')));
		await waitForDialog(d, '12か月の月締めが完了');
	});
	it('cancels a whole year before closing anything and blocks an unknown December amount in preflight', async () => {
		const d = fixture.driver; await yearly(d); await d.setConfirm(false);
		await d.click('#btn-close-month'); await finish(d);
		assert.deepEqual(await d.evaluate('window.__closedMonths'), []);
		await d.setConfirm(true); await seed(d, [transaction('unknown', { target_month: '2026-12', status: 'planned', amount: 0, amount_pending: true })]);
		await d.click('#btn-close-month'); await waitForDialog(d, '金額未入力'); await finish(d);
		assert.deepEqual(await d.evaluate('window.__closedMonths'), []);
	});
	it('reports completed and failed months, stops, and can retry the year', async () => {
		const d = fixture.driver; await yearly(d);
		await d.evaluate('window.__yose_app.syncManager.closeMonth=async(month)=>{if(month==="2026-03")throw new Error("通信失敗");window.__closedMonths.push(month);};');
		await d.click('#btn-close-month'); await waitForDialog(d, '通信失敗'); await finish(d);
		assert.deepEqual(await d.evaluate('window.__closedMonths'), months.slice(0, 2));
		const message = await d.evaluate('window.__dialogs.at(-1).message');
		for (const month of months.slice(0, 3)) assert.ok(message.includes(month));
		await d.evaluate('window.__closedMonths=[];window.__yose_app.syncManager.closeMonth=async(month)=>window.__closedMonths.push(month);');
		await d.click('#btn-close-month'); await finish(d);
		assert.deepEqual(await d.evaluate('window.__closedMonths'), months);
	});
	it('keeps the captured year through navigation and rejects duplicate starts', async () => {
		const d = fixture.driver; await yearly(d);
		await d.evaluate('window.__yose_app.syncManager.closeMonth=async(month)=>{window.__closedMonths.push(month);if(month==="2026-01")await new Promise(r=>window.__releaseClose=r);};');
		await d.click('#btn-close-month'); await d.waitFor('Boolean(window.__releaseClose)');
		await d.click('#btn-period-next');
		await d.evaluate('window.__yose_app.summaryController.handleCloseMonth()');
		assert.deepEqual(await d.evaluate('window.__closedMonths'), ['2026-01']);
		await d.evaluate('window.__releaseClose()'); await finish(d);
		assert.deepEqual(await d.evaluate('window.__closedMonths'), months);
		assert.match(await d.textContent('#btn-close-month'), /2027年/);
	});
	it('stops the batch after a lock invalidates the original authentication session', async () => {
		const d = fixture.driver; await yearly(d);
		await d.evaluate('window.__yose_app.syncManager.closeMonth=async(month)=>{window.__closedMonths.push(month);window.__yose_app.authController.lockPrivateKey();};');
		await d.click('#btn-close-month'); await finish(d);
		assert.deepEqual(await d.evaluate('window.__closedMonths'), ['2026-01']);
	});
	it('keeps monthly closing for daily and monthly displays', async () => {
		const d = fixture.driver; await cashflow(d);
		await d.evaluate('window.__closedMonths=[];window.__yose_app.syncManager.closeMonth=async(month)=>window.__closedMonths.push(month);');
		for (const mode of ['daily', 'monthly']) {
			await d.click(`#control-granularity [data-granularity="${mode}"]`);
			await d.waitFor('document.querySelector("#btn-close-month").textContent.includes("この月")');
			await d.click('#btn-close-month'); await finish(d);
		}
		assert.deepEqual(await d.evaluate('window.__closedMonths'), ['2026-10', '2026-10']);
	});
	it('shows one series and a yen amount on a point, a line midpoint and a native touch', async () => {
		const d = fixture.driver; await cashflow(d);
		await d.evaluate(`window.__yose_app.chartController.renderCategoryTrend({type:'expense',labels:['2026-01','2026-02'],series:[{id:'a',kind:'category',name:'食費',values:[1000,1000]},{id:'b',kind:'category',name:'家賃',values:[8000,8000]}]})`);
		for (const [position, touch] of [['c.getDatasetMeta(0).data[0]', false], ['{x:(c.chartArea.left+c.chartArea.right)/2,y:c.getDatasetMeta(0).data[0].y}', false], ['c.getDatasetMeta(1).data[1]', true]]) {
			await move(d, 'categoryTrendChart', position, touch);
			await d.waitFor(`(()=>{const t=window.__yose_app.chartController.categoryTrendChart.tooltip;return t.opacity>0&&t.dataPoints?.length===1&&t.dataPoints[0].dataset.label===${JSON.stringify(touch ? '家賃' : '食費')};})()`);
			const result = await tooltip(d, 'categoryTrendChart');
			assert.equal(result.items.length, 1);
			assert.equal(result.items[0].label, touch ? '家賃' : '食費');
			assert.match(JSON.stringify(result.body), touch ? /¥8,000/ : /¥1,000/);
			if (touch) await d.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, d.sessionId);
		}
		await move(d, 'categoryTrendChart', '{x:(c.chartArea.left+c.chartArea.right)/2,y:(c.chartArea.top+c.chartArea.bottom)/2}', true);
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart.tooltip.opacity===0');
		await d.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, d.sessionId);
	});
	it('limits asset, budget and all cashflow bar tooltips to a single visible series', async () => {
		const d = fixture.driver; await cashflow(d);
		await d.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false }, d.sessionId);
		await d.evaluate(`window.__yose_app.chartController.renderCashflowTotals(['1月','2月'],[9000,9000],[1000,1000])`);
		await move(d, 'chart', 'c.getDatasetMeta(1).data[0].getCenterPoint()');
		await d.waitFor('window.__yose_app.chartController.chart.tooltip.opacity>0');
		assert.deepEqual(await observedValue(d, 'chart'), [{ date: '1月', label: '支出', value: 1000 }]);
		await d.click('.tab-btn[data-analytics-target="budget"]');
		await d.evaluate(`window.__yose_app.chartController.renderChartForBudgetProgress([{month:'01',cumulative_expense:1000,cumulative_budget_pace:4000,cumulative_savings:7000,cumulative_savings_pace:10000},{month:'02',cumulative_expense:1000,cumulative_budget_pace:4000,cumulative_savings:7000,cumulative_savings_pace:10000}],'2026')`);
		await move(d, 'chart', 'c.getDatasetMeta(1).data[0]');
		await d.waitFor('window.__yose_app.chartController.chart.tooltip.opacity>0');
		assert.deepEqual(await observedValue(d, 'chart'), [{ date: '1月', label: '予算消化ペース基準', value: 4000 }]);
		await d.click('.tab-btn[data-analytics-target="assets"]');
		await d.waitFor('Boolean(window.__yose_app.chartController.assetHistoryChart)');
		await d.evaluate(`window.__yose_app.chartController.renderAssetHistory({points:[{date:'2026-01-01',net_assets:10000,liquid_assets:2000,investment_assets:3000,investment_acquisition_cost:4000,investment_valuation:5000,liabilities:1000},{date:'2026-01-02',net_assets:10000,liquid_assets:2000,investment_assets:3000,investment_acquisition_cost:8000,investment_valuation:5000,liabilities:1000}]})`);
		await move(d, 'assetHistoryChart', 'c.getDatasetMeta(3).data[0]');
		await d.waitFor('window.__yose_app.chartController.assetHistoryChart.tooltip.opacity>0');
		assert.deepEqual(await observedValue(d, 'assetHistoryChart'), [{ date: '2026-01-01', label: '取得原価（直近記録）', value: 4000 }]);
	});
	it('does not hit missing spans or hidden lines and chooses only one overlapping series', async () => {
		const d = fixture.driver; await cashflow(d);
		await d.evaluate(`window.__yose_app.chartController.renderCategoryTrend({type:'expense',labels:['1月','2月','3月'],series:[{id:'a',kind:'category',name:'欠測あり',values:[1000,null,1000]},{id:'b',kind:'category',name:'別系列',values:[7000,7000,7000]}]})`);
		await move(d, 'categoryTrendChart', 'c.getDatasetMeta(1).data[1]');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart.tooltip.opacity>0');
		await move(d, 'categoryTrendChart', '{x:c.getDatasetMeta(0).data[1].x,y:c.scales.y.getPixelForValue(1000)}');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart.tooltip.opacity===0');
		assert.equal((await tooltip(d, 'categoryTrendChart')).visible, false);
		await d.evaluate(`window.__yose_app.chartController.renderCategoryTrend({type:'expense',labels:['1月','2月','3月'],series:[{id:'a',kind:'category',name:'重なる系列A',values:[1000,1000,1000]},{id:'b',kind:'category',name:'重なる系列B',values:[1000,1000,1000]}]})`);
		await move(d, 'categoryTrendChart', 'c.getDatasetMeta(0).data[1]');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart.tooltip.opacity>0');
		assert.equal((await tooltip(d, 'categoryTrendChart')).items.length, 1);
		await d.click('#category-trend-series input');
		await move(d, 'categoryTrendChart', 'c.getDatasetMeta(1).data[1]');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart.tooltip.dataPoints?.[0]?.dataset.label==="重なる系列B"');
		assert.deepEqual((await tooltip(d, 'categoryTrendChart')).items.map(i => i.label), ['重なる系列B']);
	});
	for (const target of ['axis', 'legend']) it(`clears tooltip and hover when native mouse movement reaches the ${target}`, async () => {
		const d = fixture.driver; await sampleTrend(d);
		assert.deepEqual(await chartState(d, 'categoryTrendChart'), { visible: true, hover: 1, active: 1 });
		const position = target === 'axis' ? '{x:(c.chartArea.left+c.chartArea.right)/2,y:c.chartArea.bottom+12}' : '(()=>{const h=c.legend.legendHitBoxes[0];return {x:h.left+h.width/2,y:h.top+h.height/2};})()';
		await trackedMove(d, 'categoryTrendChart', position);
		assert.equal(await d.evaluate('window.__plotEvents.at(-1).inChartArea'), false);
		assert.deepEqual(await chartState(d, 'categoryTrendChart'), { visible: false, hover: 0, active: 0 });
		if (target === 'legend') {
			const point = await d.evaluate(`(()=>{const c=window.__yose_app.chartController.categoryTrendChart,h=c.legend.legendHitBoxes[0],r=c.canvas.getBoundingClientRect();window.__oldTrendChart=c;return {x:r.left+h.left+h.width/2,y:r.top+h.top+h.height/2};})()`);
			for (const type of ['mousePressed', 'mouseReleased']) await d.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 }, d.sessionId);
			await d.waitFor('window.__yose_app.chartController.categoryTrendChart!==window.__oldTrendChart && !window.__yose_app.chartController.categoryTrendChart.isDatasetVisible(0)');
			assert.equal(await d.evaluate('document.querySelector("#category-trend-series input").checked'), false);
		}
	});
	it('clears an active tooltip for a native pinch whose first finger starts outside the plot', async () => {
		const d = fixture.driver; await sampleTrend(d);
		const points = await d.evaluate(`(()=>{const c=window.__yose_app.chartController.categoryTrendChart,r=c.canvas.getBoundingClientRect(),a=c.chartArea,x=r.left+(a.left+a.right)/2;return [{x,y:r.top+a.bottom+12,id:1},{x,y:r.top+a.bottom-72,id:2}];})()`);
		const before = await d.evaluate('window.__plotEvents.length');
		try {
			await d.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points }, d.sessionId);
			await d.waitFor(`window.__plotEvents.slice(${before}).some(e=>e.canvas==='category-trend-chart'&&e.type==='touchstart'&&e.touches===2)`);
			assert.equal(await d.evaluate('window.__plotEvents.at(-1).inChartArea'), false);
			assert.deepEqual(await chartState(d, 'categoryTrendChart'), { visible: false, hover: 0, active: 0 });
		} finally { await d.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, d.sessionId); }
	});
	it('keeps stepped acquisition cost dates and amounts on the held interval and its vertical boundary', async () => {
		const d = fixture.driver;
		await d.click('.tab-btn[data-analytics-target="assets"]');
		await d.waitFor('Boolean(window.__yose_app.chartController.assetHistoryChart)');
		await d.evaluate(`window.__yose_app.chartController.renderAssetHistory({points:['01','11','21'].map((day,index)=>({date:'2026-01-'+day,net_assets:10000,liquid_assets:null,investment_assets:null,investment_acquisition_cost:1000+index*100,investment_valuation:null,liabilities:null}))})`);
		const actual = [];
		for (const position of [
			'{x:c.getDatasetMeta(3).data[1].x,y:(c.getDatasetMeta(3).data[0].y+c.getDatasetMeta(3).data[1].y)/2}',
			'{x:c.getDatasetMeta(3).data[1].x-20,y:c.getDatasetMeta(3).data[0].y}',
			'{x:c.getDatasetMeta(3).data[1].x-2,y:c.getDatasetMeta(3).data[1].y}'
		]) {
			await trackedMove(d, 'assetHistoryChart', position);
			actual.push(await observedValue(d, 'assetHistoryChart'));
		}
		assert.deepEqual(actual, [
			[{ date: '2026-01-11', label: '取得原価（直近記録）', value: 1100 }],
			[{ date: '2026-01-01', label: '取得原価（直近記録）', value: 1000 }],
			[{ date: '2026-01-01', label: '取得原価（直近記録）', value: 1000 }]
		]);
	});
	it('selects actual negative and zero observations on a curved line and after money-axis zoom', async () => {
		const d = fixture.driver; await cashflow(d);
		await d.evaluate(`window.__yose_app.chartController.renderCategoryTrend({type:'expense',labels:['1月','2月','3月'],series:[{id:'a',kind:'category',name:'増減',values:[-1000,0,-1000]},{id:'b',kind:'category',name:'基準',values:[5000,5000,5000]}]})`);
		for (const [index, value] of [[0, -1000], [1, 0]]) {
			await trackedMove(d, 'categoryTrendChart', `c.getDatasetMeta(0).data[${index}]`);
			assert.deepEqual(await observedValue(d, 'categoryTrendChart'), [{ date: `${index + 1}月`, label: '増減', value }]);
		}
		await trackedMove(d, 'categoryTrendChart', '(()=>{const m=c.getDatasetMeta(0),x=m.data[0].x+(m.data[1].x-m.data[0].x)/4;return m.dataset.interpolate({x},"x");})()');
		assert.deepEqual(await observedValue(d, 'categoryTrendChart'), [{ date: '1月', label: '増減', value: -1000 }]);
		assert.match(JSON.stringify((await tooltip(d, 'categoryTrendChart')).body), /¥-1,000/);
		const setup = await d.evaluate(`(()=>{const c=window.__yose_app.chartController.categoryTrendChart,p=c.getDatasetMeta(0).data[1],r=c.canvas.getBoundingClientRect();return {x:r.left+p.x,y:r.top+p.y,span:c.scales.y.max-c.scales.y.min};})()`);
		await d.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: setup.x, y: setup.y, deltaX: 0, deltaY: -120, modifiers: 2 }, d.sessionId);
		await d.waitFor(`(()=>{const y=window.__yose_app.chartController.categoryTrendChart.scales.y;return y.max-y.min<${setup.span};})()`);
		await trackedMove(d, 'categoryTrendChart', 'c.getDatasetMeta(0).data[1]');
		assert.deepEqual(await observedValue(d, 'categoryTrendChart'), [{ date: '2月', label: '増減', value: 0 }]);
		assert.match(JSON.stringify((await tooltip(d, 'categoryTrendChart')).body), /¥0/);
	});
});
