import { it, describe } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow, settings, value } from '../helpers/ui_fixture.js';
const f = useBrowser({ realCharts: true });
const range = d => d.evaluate(`(()=>{const c=window.__yose_app.chartController.categoryTrendChart;return {min:c.scales.y.min,max:c.scales.y.max,labels:c.data.labels.length,points:c.data.datasets[0].data.length};})()`);
async function plotPoint(d) { return d.evaluate(`(()=>{const c=window.__yose_app.chartController.categoryTrendChart;c.canvas.scrollIntoView({block:'center',behavior:'instant'});const r=c.canvas.getBoundingClientRect(),a=c.chartArea;return {x:r.left+(a.left+a.right)/2,y:r.top+a.bottom-10};})()`); }
async function incomeSeed(d) { await seed(d,[transaction('normal',{amount:100}),transaction('spike',{date:'2026-10-21',amount:100000}),transaction('salary',{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',amount:1000}),transaction('planned-income',{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',amount:500,status:'planned'})]);await cashflow(d); }
async function observeBudgetSettings(d) {
	await d.evaluate(`{const c=window.__yose_app.settingsController,render=c.renderSettings;window.__budgetSettingsPending=null;window.__restoreBudgetSettings=()=>{c.renderSettings=render;};c.renderSettings=(...args)=>{const pending=render.apply(c,args);window.__budgetSettingsPending=pending;return pending;};}`);
}
async function completeBudgetSettings(d) {
	await d.waitFor('Boolean(window.__budgetSettingsPending)');
	await d.evaluate('(async()=>{try{await window.__budgetSettingsPending;}finally{window.__restoreBudgetSettings();}})()');
	await d.waitFor('window.__yose_app.budgetSettingsController.year==="2026" && Boolean(window.__yose_app.budgetSettingsController.draft) && !window.__yose_app.budgetSettingsController.loading && !document.querySelector("#setting-goal-basis").disabled');
}
describe('real Chart.js trend controls', () => {
	it('changes only the money axis on native Ctrl+wheel, resets it, and leaves regular wheel alone', async () => {
		const d=f.driver;await incomeSeed(d);await d.click('#control-granularity [data-granularity="daily"]');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.scales.y?.max>10000');
		const before=await range(d), p=await plotPoint(d);
		await d.send('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY:-300,modifiers:2},d.sessionId);
		await d.waitFor(`window.__yose_app.chartController.categoryTrendChart.scales.y.max-window.__yose_app.chartController.categoryTrendChart.scales.y.min<${before.max-before.min}`);
		const after=await range(d);assert.equal(after.labels,before.labels);assert.equal(after.points,before.points);
		await d.click('#category-trend-reset');assert.deepEqual(await range(d),before);
		await d.send('Input.dispatchMouseEvent',{type:'mouseWheel',...await plotPoint(d),deltaX:0,deltaY:-60},d.sessionId);
		assert.deepEqual(await range(d),before);
		await d.send('Input.dispatchMouseEvent',{type:'mouseWheel',...await plotPoint(d),deltaX:0,deltaY:-120,modifiers:2},d.sessionId);
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart.options.scales.y.min!==undefined');await d.click('#category-trend-series input');
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart.options.scales.y.min===undefined'),true);
	});
	it('thins long asset markers while preserving data, gaps and benchmark radii', async () => {
		const d=f.driver;await d.evaluate(`window.__yose_app.chartController.renderAssetHistory({points:Array.from({length:365},(_,i)=>({date:String(i),net_assets:i,liquid_assets:i,investment_assets:0,investment_acquisition_cost:i===0?null:i,investment_valuation:i,liabilities:0}))})`);
		const result=await d.evaluate(`(()=>{const c=window.__yose_app.chartController.assetHistoryChart;return {n:c.data.datasets[0].data.length,r:c.data.datasets[0].pointRadius,missing:c.data.datasets[3].pointRadius[0]};})()`);
		assert.equal(result.n,365);assert.ok(result.r.filter(Boolean).length<=40);assert.equal(result.missing,0);
	});
	it('switches income trends, breakdown and drilldown and keeps hidden series through redraws', async () => {
		const d=f.driver;await incomeSeed(d);await d.select('#category-trend-type','income');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.data.datasets[0]?.categoryId==="cat_income_main"');
		assert.ok((await d.textContent('#category-breakdown-list')).includes('1,500'));
		const beforeView=await d.evaluate(`(async()=>({kpi:document.querySelector('#cashflow-stat-grid').textContent,list:document.querySelector('#category-breakdown-list').textContent,filters:[...document.querySelectorAll('#card-month-tx-list select')].map(x=>x.value),raw:await window.__yose_app.db.captureImportState()}))()`);
		await d.click('#category-trend-series input');
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart.isDatasetVisible(0)'),false);
		assert.ok((await d.textContent('#category-trend-series')).includes('選択されていません'));
		assert.deepEqual(await d.evaluate(`(async()=>({kpi:document.querySelector('#cashflow-stat-grid').textContent,list:document.querySelector('#category-breakdown-list').textContent,filters:[...document.querySelectorAll('#card-month-tx-list select')].map(x=>x.value),raw:await window.__yose_app.db.captureImportState()}))()`),beforeView);
		await d.evaluate('window.__yose_app.summaryController.renderSummary()');
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart.isDatasetVisible(0)'),false);
		await d.click('#category-trend-series input');
		assert.deepEqual(await d.evaluate(`(async()=>({kpi:document.querySelector('#cashflow-stat-grid').textContent,list:document.querySelector('#category-breakdown-list').textContent,filters:[...document.querySelectorAll('#card-month-tx-list select')].map(x=>x.value),raw:await window.__yose_app.db.captureImportState()}))()`),beforeView);
		await d.click('#category-breakdown-list [data-filter-category="cat_income_main"]');
		assert.equal(await value(d,'#select-type-filter'),'income');
	});
	it('derives budget settings and progress from confirmed and planned income and updates them when income changes', async () => {
		const d=f.driver;await incomeSeed(d);await settings(d);await d.select('#setting-goal-basis','rate');await d.fill('#setting-savings-target-rate','20');
		assert.equal(await value(d,'#setting-expense-budget'),'1200');assert.equal(await value(d,'#setting-savings-target-amount'),'300');
		assert.equal(await d.evaluate('document.querySelector("#setting-expense-budget").readOnly'),true);
		await d.click('#btn-save-annual-budget');await d.waitFor('window.__dialogs.some(x=>x.message.includes("保存しました"))');
		await d.click('.tab-btn[data-analytics-target="budget"]');
		await d.waitFor('document.querySelector("#stat-budget-expense").textContent.includes("1,200")');
		await seed(d,[transaction('more',{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',amount:500})]);
		await d.evaluate('window.__yose_app.refreshAllViews()');assert.ok((await d.textContent('#stat-budget-expense')).includes('1,600'));
	});
	it('zooms via native two-touch pinch and cancels gestures on lock', async () => {
		const d=f.driver;await incomeSeed(d);await d.click('#control-granularity [data-granularity="daily"]');
		await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.scales.y?.max>10000');
		const p=await plotPoint(d), before=await range(d);
		const points=distance=>[{x:p.x-distance,y:p.y,id:1},{x:p.x+distance,y:p.y,id:2}];
		await d.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(20)},d.sessionId);
		await d.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(60)},d.sessionId);
		await d.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},d.sessionId);
		const after=await range(d);assert.ok(after.max-after.min<before.max-before.min);
		await d.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(20)},d.sessionId);await d.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]},d.sessionId);
		await d.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]},d.sessionId);await d.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:p.x,y:p.y-10,id:1}]},d.sessionId);await d.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]},d.sessionId);assert.deepEqual(await range(d),after);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart'),null);
		await d.fill('#auth-pin-input','1234');await d.click('#btn-auth-pin');
		await d.waitFor('!window.__yose_app.isKeyLocked');
		await cashflow(d);await d.waitFor('Boolean(window.__yose_app.chartController.categoryTrendChart)');
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart.isDatasetVisible(0)'),true);
	});
	it('keeps an unsaved budget draft through refresh and rejects stale or locked saves', async () => {
		const d=f.driver;await incomeSeed(d);await observeBudgetSettings(d);await settings(d);await completeBudgetSettings(d);
		await d.select('#setting-goal-basis','rate');await d.fill('#setting-savings-target-rate','25');
		await d.waitFor('window.__yose_app.budgetSettingsController.draft.values.savings_target_rate===25 && window.__yose_app.budgetSettingsController.draft.dirty');
		await d.evaluate('window.__yose_app.refreshAllViews()');
		assert.equal(await value(d,'#setting-savings-target-rate'),'25');
		await d.evaluate(`window.__yose_app.db.mutateMasterConfig(c=>{c.annual_budgets[2026]={goal_basis:'rate',savings_target_rate:40};})`);
		await d.click('#btn-save-annual-budget');
		await d.waitFor('window.__dialogs.some(x=>x.message.includes("失敗"))');
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getAnnualBudget("2026")).savings_target_rate)()'),40);
	});
	it('waits for the actual settings transition even when delayed metadata leaves the old budget inputs enabled', async () => {
		const d=f.driver;await incomeSeed(d);await settings(d);await d.evaluate('window.__yose_app.settingsController.renderSettings()');await cashflow(d);
		await d.evaluate(`{const c=window.__yose_app.insightsController,render=c.renderMetadata.bind(c);let once=true;c.renderMetadata=async()=>{if(once){once=false;await new Promise(r=>window.__releaseBudgetMetadata=r);}return render();};}`);
		await observeBudgetSettings(d);await settings(d);await d.waitFor('typeof window.__releaseBudgetMetadata==="function"');
		assert.equal(await d.evaluate('Boolean(window.__yose_app.budgetSettingsController.draft) && !window.__yose_app.budgetSettingsController.loading && !document.querySelector("#setting-goal-basis").disabled'),true);
		await d.evaluate('window.__settingsTransitionDone=false;window.__budgetSettingsPending.then(()=>{window.__settingsTransitionDone=true;});void 0;');
		assert.equal(await d.evaluate('window.__settingsTransitionDone'),false);
		await d.evaluate('window.__releaseBudgetMetadata()');await completeBudgetSettings(d);
		assert.equal(await d.evaluate('window.__settingsTransitionDone'),true);
		await d.select('#setting-goal-basis','rate');await d.fill('#setting-savings-target-rate','25');
		await d.waitFor('window.__yose_app.budgetSettingsController.draft.values.savings_target_rate===25 && window.__yose_app.budgetSettingsController.draft.dirty');
		await d.evaluate('window.__yose_app.refreshAllViews()');assert.equal(await value(d,'#setting-savings-target-rate'),'25');
	});

	it('keeps legend and checkbox selection together, resets zoom on period changes and renders safe fallback tables', async () => {
		const d=f.driver;await incomeSeed(d);
		const hit=await d.evaluate(`(()=>{const c=window.__yose_app.chartController.categoryTrendChart;c.canvas.scrollIntoView({block:'center'});const r=c.canvas.getBoundingClientRect(),h=c.legend.legendHitBoxes[0];return {x:r.left+h.left+h.width/2,y:r.top+h.top+h.height/2};})()`);
		await d.send('Input.dispatchMouseEvent',{type:'mousePressed',...hit,button:'left',clickCount:1},d.sessionId);await d.send('Input.dispatchMouseEvent',{type:'mouseReleased',...hit,button:'left',clickCount:1},d.sessionId);
		await d.waitFor('document.querySelector("#category-trend-series input").checked===false');
		await d.evaluate(`window.Chart=undefined;window.__yose_app.summaryController.renderSummary()`);
		assert.ok(!(await d.textContent('#category-trend-fallback')).includes('食費'));
		await d.click('#category-trend-series input');
		assert.ok((await d.textContent('#category-trend-fallback')).includes('食費'));
	});

	it('zooms every time chart about its pointer value and removes old listeners on redraw', async () => {
		const d=f.driver;await incomeSeed(d);
		for(const slot of ['chart','categoryTrendChart','assetHistoryChart']) {
			if(slot==='assetHistoryChart') { await d.click('.tab-btn[data-analytics-target="assets"]');await d.waitFor('Boolean(window.__yose_app.chartController.assetHistoryChart?.scales.y)'); }
			const setup=await d.evaluate(`(()=>{const c=window.__yose_app.chartController.${slot};c.canvas.scrollIntoView({block:'center'});const r=c.canvas.getBoundingClientRect(),a=c.chartArea,y=a.bottom-(a.bottom-a.top)*0.2;return {x:r.left+(a.left+a.right)/2,y:r.top+y,value:c.scales.y.getValueForPixel(y),span:c.scales.y.max-c.scales.y.min};})()`);
			await d.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:setup.x,y:setup.y,deltaX:0,deltaY:-120,modifiers:2},d.sessionId);
			const after=await d.evaluate(`(()=>{const c=window.__yose_app.chartController.${slot},r=c.canvas.getBoundingClientRect();return {value:c.scales.y.getValueForPixel(${setup.y}-r.top),span:c.scales.y.max-c.scales.y.min};})()`);
			assert.ok(after.span<setup.span);assert.ok(Math.abs(after.value-setup.value)<Math.max(1,setup.span*0.001));
			await d.evaluate('window.__yose_app.summaryController.renderSummary()');
			const reset=await d.evaluate(`(()=>{const c=window.__yose_app.chartController.${slot};return c.scales.y.max-c.scales.y.min;})()`);
			await d.send('Input.dispatchMouseEvent',{type:'mouseWheel',x:setup.x,y:setup.y,deltaX:0,deltaY:-120,modifiers:2},d.sessionId);
			const twice=await d.evaluate(`(()=>{const c=window.__yose_app.chartController.${slot};return c.scales.y.max-c.scales.y.min;})()`);assert.ok(Math.abs(twice/reset-after.span/setup.span)<0.001);
		}
	});
	it('keeps stable selection through period, theme, rename and newly introduced series, with escaped names', async () => {
		const d=f.driver;await incomeSeed(d);await d.click('#category-trend-series input');
		await d.click('#control-granularity [data-granularity="daily"]');await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.data.labels.length===31');
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart.isDatasetVisible(0)'),false);
		await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.categories.find(x=>x.id==='cat_food').name='<img src=x onerror="window.__seriesXss=1">';});app.chartController.updateThemeMode(true);await app.summaryController.renderSummary();})()`);
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart.isDatasetVisible(0)'),false);
		assert.equal(await d.evaluate('Boolean(window.__seriesXss)||Boolean(document.querySelector("#category-trend-series img"))'),false);
		await seed(d,[transaction('new-category',{category_id:'cat_housing',actual_category_id:'cat_housing'})]);await d.evaluate('window.__yose_app.summaryController.renderSummary()');
		assert.equal(await d.evaluate('(()=>{const c=window.__yose_app.chartController.categoryTrendChart;return c.isDatasetVisible(c.data.datasets.findIndex(x=>x.categoryId==="cat_housing"));})()'),true);
		await d.evaluate('window.Chart=undefined;window.__yose_app.summaryController.renderSummary()');const foodIndex=await d.evaluate('window.__yose_app.chartController.lastCategoryTrend.series.findIndex(x=>x.id==="cat_food")');await d.click(`#category-trend-series label:nth-of-type(${foodIndex+1}) input`);
		assert.ok((await d.textContent('#category-trend-fallback')).includes('<img'));assert.equal(await d.evaluate('Boolean(document.querySelector("#category-trend-fallback img"))'),false);
	});
	it('preserves primary inputs across all budget modes, zero income and auto-calculation', async () => {
		const d=f.driver;await incomeSeed(d);await settings(d);
		await d.fill('#setting-expense-budget','1800');await d.fill('#setting-savings-target-amount','300');await d.fill('#setting-savings-target-rate','20');
		await d.select('#setting-goal-basis','savings');assert.equal(await value(d,'#setting-expense-budget'),'1200');
		await d.select('#setting-goal-basis','expense');assert.equal(await value(d,'#setting-expense-budget'),'1800');assert.equal(await value(d,'#setting-savings-target-amount'),'-300');
		await d.select('#setting-goal-basis','independent');assert.equal(await value(d,'#setting-savings-target-amount'),'300');
		await d.select('#setting-goal-basis','rate');await d.click('.tab-btn[data-analytics-target="cashflow"]');await d.click('#btn-toggle-planned');await settings(d);
		assert.equal(await value(d,'#setting-expense-budget'),'1200');
		await d.fill('#setting-budget-year','2027');await d.waitFor('document.querySelector("#budget-basis-income").textContent.includes("2027")');
		await d.fill('#setting-expense-budget','200');await d.select('#setting-goal-basis','expense');assert.equal(await value(d,'#setting-savings-target-amount'),'-200');assert.equal(await value(d,'#setting-savings-target-rate'),'');
		await d.click('#btn-budget-auto-calc');await d.waitFor('document.querySelector("#setting-goal-basis").value==="independent"');
	});
	it('keeps unrelated master edits and prevents locked encrypted saves from changing storage or new drafts', async () => {
		const d=f.driver;await incomeSeed(d);await settings(d);await d.select('#setting-goal-basis','rate');await d.fill('#setting-savings-target-rate','20');
		await d.evaluate(`window.__yose_app.db.mutateMasterConfig(c=>{c.accounts[0].name='別の編集';})`);await d.click('#btn-save-annual-budget');await d.waitFor('window.__dialogs.some(x=>x.message.includes("保存しました"))');
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).accounts[0].name)()'),'別の編集');
		await d.waitFor('!window.__yose_app.budgetSettingsController.saving && window.__yose_app.budgetSettingsController.draft?.baseline.annual_budgets?.[2026]?.savings_target_rate===20');
		await d.fill('#setting-savings-target-rate','25');
		await d.evaluate(`(async()=>{window.__beforeBudgetRaw=await window.__yose_app.db.getRaw('master_config','current');const db=window.__yose_app.db;window.__origEncrypt=db.encryptRecord.bind(db);let once=true;db.encryptRecord=async(...args)=>{const result=await window.__origEncrypt(...args);if(once){once=false;await new Promise(r=>window.__releaseBudgetEncryption=r);}return result;};})()`);
		await d.evaluate(`const c=window.__yose_app.budgetSettingsController,save=c.save.bind(c);c.save=()=>window.__pendingBudgetSave=save();`);
		await d.click('#btn-save-annual-budget');await d.waitFor('Boolean(window.__releaseBudgetEncryption)');
		assert.equal(await d.evaluate('document.querySelector("#setting-budget-year").disabled'),true);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		await d.fill('#auth-pin-input','1234');await d.click('#btn-auth-pin');await d.waitFor('!window.__yose_app.isKeyLocked');await settings(d);
		await d.waitFor('window.__yose_app.budgetSettingsController.draft && !window.__yose_app.budgetSettingsController.loading && !document.querySelector("#setting-savings-target-rate").disabled');
		await d.waitFor(`(()=>{const c=window.__yose_app.budgetSettingsController,input=document.querySelector('#setting-savings-target-rate');if(c.loading||input.disabled||!c.draft)return false;input.value='30';input.dispatchEvent(new Event('input',{bubbles:true}));return c.draft.values.savings_target_rate===30&&c.draft.dirty;})()`);await d.evaluate('window.__releaseBudgetEncryption();window.__pendingBudgetSave');
		await d.waitFor('!window.__yose_app.budgetSettingsController.saving');
		assert.equal(await value(d,'#setting-savings-target-rate'),'30');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("master_config","current")'),await d.evaluate('window.__beforeBudgetRaw'));
	});
	it('keeps unverified income history separate and non-clickable even beside an identically named real category', async () => {
		const d=f.driver;await incomeSeed(d);
		await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.categories.find(x=>x.id==='cat_income_main').name='収入内訳未取得';});const s=await app.db.getSnapshot();s.monthly_summaries['2026-09']={income_total:123};await app.db.saveSnapshot(s);})()`);
		await d.select('#category-trend-type','income');await d.click('#control-granularity [data-granularity="yearly"]');
		await d.waitFor('document.querySelector("#category-breakdown-list [data-income-unknown]")');
		assert.equal(await d.evaluate('document.querySelector("#category-breakdown-list [data-income-unknown]").hasAttribute("data-filter-category")'),false);
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart.data.datasets.length'),2);
	});

	it('drops delayed reads from another budget year and resets amount zoom on period redraw', async () => {
		const d=f.driver;await incomeSeed(d);await settings(d);
		await d.evaluate(`const app=window.__yose_app,get=app.db.getAnalyticsState.bind(app.db);let once=true;app.db.getAnalyticsState=async()=>{const state=await get();if(once){once=false;await new Promise(r=>window.__releaseBudgetRead=r);}return state;};window.__oldBudgetRead=app.budgetSettingsController.render();void 0;`);
		await d.waitFor('Boolean(window.__releaseBudgetRead)');await d.fill('#setting-budget-year','2027');await d.waitFor('document.querySelector("#budget-basis-income").textContent.includes("2027")');
		await d.evaluate('window.__releaseBudgetRead();window.__oldBudgetRead');assert.equal(await value(d,'#setting-budget-year'),'2027');
		await cashflow(d);const p=await plotPoint(d);await d.send('Input.dispatchMouseEvent',{type:'mouseWheel',...p,deltaX:0,deltaY:-120,modifiers:2},d.sessionId);
		await d.click('#control-granularity [data-granularity="daily"]');await d.waitFor('window.__yose_app.chartController.categoryTrendChart?.data.labels.length===31');
		assert.equal(await d.evaluate('window.__yose_app.chartController.categoryTrendChart.options.scales.y.min===undefined'),true);
	});

	it('shows unavailable overflow goals with missing target lines while retaining actual amounts', async () => {
		const d=f.driver;await seed(d,[transaction('big',{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',amount:Number.MAX_SAFE_INTEGER}),transaction('one',{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',amount:1})]);
		await d.evaluate(`window.__yose_app.db.saveAnnualBudget('2026',{goal_basis:'rate',savings_target_rate:20})`);await d.click('.tab-btn[data-analytics-target="budget"]');
		await d.waitFor('document.querySelector("#stat-budget-expense").textContent.includes("未算出")');assert.ok((await d.textContent('#stat-budget-pace-status')).includes('未算出'));
		const datasets=await d.evaluate('window.__yose_app.chartController.chart.data.datasets');assert.ok(datasets.find(x=>x.seriesKey==='budget:expense-pace').data.every(x=>x===null));assert.ok(datasets.find(x=>x.seriesKey==='budget:savings').data.some(x=>x>0));
	});
	it('retains an unclassified income filter and distinguishes explicit zero and derived negative rates', async () => {
		const d=f.driver;await incomeSeed(d);await seed(d,[transaction('unclassified',{type:'income',category_id:null,actual_category_id:null,amount:200})]);await d.select('#category-trend-type','income');
		await d.click('#category-breakdown-list [data-filter-category="cat_unclassified"]');await d.waitFor('document.querySelectorAll("#month-tx-list .tx-item").length===1 && document.querySelector("#month-tx-list .tx-item").dataset.id==="unclassified"');assert.equal(await value(d,'#select-category-filter'),'cat_unclassified');
		for(const budget of [{goal_basis:'rate',savings_target_rate:0},{goal_basis:'expense',expense_budget:2000}]) {
			await d.evaluate(`window.__yose_app.db.saveAnnualBudget('2026',${JSON.stringify(budget)})`);await d.click('.tab-btn[data-analytics-target="budget"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');assert.ok(!(await d.textContent('#label-budget-rate-eval')).includes('未設定'));
		}
	});
	it('freezes old budget inputs while a new year is loading and rejects a basis/input tuple CAS mix', async () => {
		const d=f.driver;await incomeSeed(d);await d.evaluate(`window.__yose_app.db.saveAnnualBudget('2026',{expense_budget:800,savings_target_amount:200,savings_target_rate:20})`);await settings(d);
		await d.select('#setting-goal-basis','rate');await d.evaluate(`const budgetController=window.__yose_app.budgetSettingsController,oldSave=budgetController.save.bind(budgetController);budgetController.save=()=>window.__pendingTupleSave=oldSave();window.__yose_app.db.mutateMasterConfig(c=>{c.annual_budgets[2026].savings_target_rate=30;})`);await d.click('#btn-save-annual-budget');await d.waitFor('window.__dialogs.some(x=>x.message.includes("競合"))');await d.evaluate('window.__pendingTupleSave');
		await d.evaluate(`const app=window.__yose_app,get=app.db.getAnalyticsState.bind(app.db);let once=true;app.db.getAnalyticsState=async()=>{const state=await get();if(once){once=false;await new Promise(r=>window.__releaseNewYear=r);}return state;};`);
		await d.fill('#setting-budget-year','2027');await d.waitFor('Boolean(window.__releaseNewYear)');
		assert.equal(await d.evaluate('document.querySelector("#setting-expense-budget").disabled'),true);assert.equal(await d.evaluate('document.querySelector("#btn-save-annual-budget").disabled'),true);
		await d.evaluate('window.__releaseNewYear()');await d.waitFor('document.querySelector("#budget-basis-income").textContent.includes("2027")');assert.equal(await value(d,'#setting-expense-budget'),'');
	});

	it('keeps a failed year read from enabling a form displaying another year and recovers without a write', async () => {
		const d=f.driver;await d.evaluate(`(async()=>{await window.__yose_app.db.saveAnnualBudget('2026',{expense_budget:800});await window.__yose_app.db.saveAnnualBudget('2027',{expense_budget:2000});})()`);await settings(d);
		await d.waitFor('document.querySelector("#setting-expense-budget").value==="800"');await d.fill('#setting-budget-year','2027');await d.waitFor('document.querySelector("#setting-expense-budget").value==="2000"');
		await d.evaluate(`(async()=>{const db=window.__yose_app.db;window.__goodBudgetRead=db.getAnalyticsState.bind(db);window.__beforeReadFailure=await db.captureImportState();db.getAnalyticsState=async()=>{throw new Error('年度取得失敗');};})()`);
		await d.fill('#setting-budget-year','2026');await d.waitFor('document.querySelector("#budget-goal-notice").textContent.includes("年度取得失敗")');
		assert.equal(await d.evaluate('document.querySelector("#btn-save-annual-budget").disabled'),true);assert.equal(await d.evaluate('document.querySelector("#setting-expense-budget").disabled'),true);
		await d.evaluate('window.__yose_app.budgetSettingsController.save()');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),await d.evaluate('window.__beforeReadFailure'));
		await d.evaluate('window.__yose_app.db.getAnalyticsState=window.__goodBudgetRead;window.__yose_app.budgetSettingsController.render()');assert.equal(await value(d,'#setting-expense-budget'),'800');assert.equal(await d.evaluate('document.querySelector("#btn-save-annual-budget").disabled'),false);
	});

	it('keeps explicit zero rates in current and legacy settings while leaving an unset rate blank', async () => {
		const d=f.driver;await settings(d);
		for(const [entry,expected] of [[{savings_target_rate:0},'0'],[{target_savings_rate:0},'0'],[{},'']]) {
			await d.evaluate(`(async()=>{await window.__yose_app.db.mutateMasterConfig(config=>{config.annual_budgets[2026]=${JSON.stringify(entry)};});await window.__yose_app.budgetSettingsController.render();})()`);const saved=await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).annual_budgets[2026])()');assert.equal(Object.hasOwn(saved,'savings_target_rate'),Object.hasOwn(entry,'savings_target_rate'));assert.equal(Object.hasOwn(saved,'target_savings_rate'),Object.hasOwn(entry,'target_savings_rate'));assert.equal(await value(d,'#setting-savings-target-rate'),expected);
		}
	});

});
