import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction } from '../helpers/ui_fixture.js';

const f=useBrowser({realCharts:true});
async function observe(d){await d.evaluate(`(()=>{const c=window.__yose_app.summaryController,render=c.renderSummary;window.__periodJobs67=[];c.renderSummary=function(...args){const job=render.apply(this,args);window.__periodJobs67.push(job);return job;};})()`);}
async function settle(d){await d.evaluate('(async()=>{let count=-1;while(count!==window.__periodJobs67.length){count=window.__periodJobs67.length;await Promise.all(window.__periodJobs67);}})()');}
it('keeps a selected day within the next month and ignores an empty month-picker change',async()=>{
	const d=f.driver;await observe(d);await seed(d,[transaction('last-day67',{date:'2026-01-31',target_month:'2026-01',amount:100})]);await d.click('[data-analytics-target="cashflow"]');await settle(d);await d.fill('#input-period-picker','2026-01');await settle(d);await d.click('#control-granularity [data-granularity="daily"]');await settle(d);await d.click('#breakdown-table-container [data-date="2026-01-31"]');
	assert.equal(await d.evaluate('window.__yose_app.selectedDate'),'2026-01-31');const raw=await d.evaluate('window.__yose_app.db.captureImportState()');await d.fill('#input-period-picker','2026-02');await settle(d);assert.equal(await d.evaluate('window.__yose_app.selectedDate'),'2026-02-28');assert.equal(await d.evaluate('window.__yose_app.currentMonth'),'2026-02');
	await d.fill('#input-period-picker','');await settle(d);assert.equal(await d.evaluate('window.__yose_app.currentMonth'),'2026-02');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
});
for(const fallback of [false,true])it(`opens the quick month selector through ${fallback?'the older focus/click API':'the native showPicker API'}`,async()=>{
	const d=f.driver;await observe(d);await d.click('[data-analytics-target="cashflow"]');await settle(d);
	try{
	await d.evaluate(`(()=>{const prototype=HTMLInputElement.prototype,show=prototype.showPicker;window.__pickerCalls67=0;window.__restorePicker67=()=>prototype.showPicker=show;${fallback?"prototype.showPicker=undefined;":"prototype.showPicker=function(...args){window.__pickerCalls67++;return show.apply(this,args);};"}})()`);
	await d.click('#period-display');assert.equal(await d.evaluate('document.querySelector("#input-period-picker").value'),'2026-10');
	if(fallback)assert.equal(await d.evaluate('document.activeElement.id'),'input-period-picker');else assert.equal(await d.evaluate('window.__pickerCalls67'),1);
	await d.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},d.sessionId);await d.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27},d.sessionId);
	}finally{await d.evaluate('window.__restorePicker67?.()');}
});
it('does not turn minimal deletion tombstones into period totals or supplement optional legacy display collections',async()=>{
	const d=f.driver;await observe(d);await seed(d,[transaction('active67',{amount:130,tags:['有効']}),{id:'minimal-deleted67',is_deleted:true,updated_at:'2026-10-20T00:00:00Z'},{id:'date-deleted67',is_deleted:true,date:'2026-10-20',updated_at:'2026-10-20T00:00:00Z'}]);await d.click('[data-analytics-target="cashflow"]');await settle(d);
	const raw=await d.evaluate('window.__yose_app.db.captureImportState()');
	await d.evaluate(`(async()=>{const app=window.__yose_app,c=app.summaryController,config=await app.db.getMasterConfig(),transactions=await app.db.getTransactions({includeDeleted:true});c.renderTagAnalytics(transactions);c.renderCrossMatrix(transactions,config);await c.renderAccountBalances(null,transactions,config);})()`);
	assert.match(await d.textContent('#tag-breakdown-list [data-filter-tag="有効"]'),/支出: ¥130/);assert.match(await d.textContent('#account-balances-list [data-filter-account="acc_wallet"]'),/1件/);assert.equal(await d.evaluate('document.querySelector("#cross-matrix-table-container tfoot td:last-child").textContent'),'¥130');
	await d.evaluate(`(async()=>{const app=window.__yose_app,c=app.summaryController,{calculateTotalAssetSummary}=await import('/js/logic.js');c.renderAssetsAnalytics(calculateTotalAssetSummary({},[]),{schema_version:2});app.analyticsTarget='assets';await c.renderAccountBalances(null,[],{schema_version:2});})()`);
	assert.match(await d.textContent('#breakdown-table-container'),/登録なし/);assert.equal(await d.evaluate('document.querySelectorAll("#account-balances-list .tx-item").length'),0);
	await d.evaluate(`(()=>{const app=window.__yose_app;app.selectedYear='2027';app.summaryController.renderBudgetAnalytics([],{schema_version:2},{schema_version:2});})()`);assert.equal(await d.textContent('#stat-budget-expense'),'¥0 / ¥0');assert.match(await d.textContent('#label-budget-expense-pace'),/基準ペース: 8.3%/);assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
});
