import assert from 'node:assert/strict';
import {useBrowser,seed,transaction,cashflow,records} from '../helpers/ui_fixture.js';
import {uiCase67} from '../helpers/ui_workflows67.js';
import {flushWorkflow,rawWorkflow,unlockWorkflow} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
uiCase67(f,'recovers all filters when a stale drilldown refers to absent account, category and tag choices',async d=>{
	await seed(d,[transaction('filter-kept67')]);await cashflow(d);const raw=await d.evaluate('window.__yose_app.db.getAllRaw("transactions")');
	await d.evaluate('window.__yose_app.summaryController.applyDrilldownFilter({accountId:"removed-account67",categoryId:"removed-category67",tag:"removed-tag67"})');
	for(const type of ['account','category','tag'])assert.equal(await d.evaluate(`document.querySelector('#select-${type}-filter').value`),'all');
	assert.deepEqual(await d.evaluate('[...document.querySelectorAll("#month-tx-list .tx-item")].map(e=>e.dataset.id)'),['filter-kept67']);assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("transactions")'),raw);
});
uiCase67(f,'receives legal remote transactions without creation timestamps and sorts dated siblings without changing their raw records',async d=>{
	const a=transaction('remote-no-created-a67',{sync_status:'synced'}),b=transaction('remote-no-created-b67',{sync_status:'synced'}),c=transaction('remote-created67',{sync_status:'synced',created_at:'2026-10-20T04:00:00Z'});delete a.created_at;delete b.created_at;
	await d.evaluate(`window.__yose_app.db.commitSyncResponse([],{pending_diffs:${JSON.stringify([a,b,c])}})`);const all=await records(d);for(const id of [a.id,b.id])assert.equal(Object.hasOwn(all.find(t=>t.id===id),'created_at'),false);
	const raw=await d.evaluate('window.__yose_app.db.getAllRaw("transactions")');await cashflow(d);const ids=await d.evaluate('[...document.querySelectorAll("#month-tx-list .tx-item")].map(e=>e.dataset.id)');assert.equal(ids[0],c.id);assert.deepEqual(new Set(ids.slice(1)),new Set([a.id,b.id]));assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("transactions")'),raw);
});
for(const period of ['yearly','daily','income-month'])uiCase67(f,`does not apply an expired ${period} transaction read to a new authenticated list`,async d=>{
	await seed(d,[transaction('period-old67'),transaction('period-new67',{memo:'MATCH_NEW67'})]);await cashflow(d);await d.click(`#control-granularity [data-granularity="${period==='yearly'?'yearly':'daily'}"]`);await flushWorkflow(d);
	if(period==='income-month')await d.evaluate('window.__yose_app.summaryController.applyDrilldownFilter({type:"income"})');
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,read=db.getTransactions;db.getTransactions=async function(...args){db.getTransactions=read;const result=await read.apply(this,args);await new Promise(resolve=>window.__listRelease67=resolve);return result;};window.__restoreList67=()=>db.getTransactions=read;window.__listJob67=app.txListController.renderMonthTransactions();})()`);
		await d.waitFor('typeof window.__listRelease67==="function"');await unlockWorkflow(d);await seed(d,[transaction('period-after67',{memo:'MATCH_NEW67',amount:777,...(period==='income-month'?{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main'}:{})})]);await d.fill('#input-tx-search','MATCH_NEW67');await d.evaluate('window.__yose_app.txListController.renderMonthTransactions()');
		assert.equal(await d.evaluate('Boolean(document.querySelector("#month-tx-list [data-id=period-after67]"))'),true);const raw=await rawWorkflow(d),state=await d.evaluate('({html:document.querySelector("#month-tx-list").innerHTML,title:document.querySelector("#month-tx-list-title").textContent,search:document.querySelector("#input-tx-search").value,filters:[...document.querySelectorAll(".tx-filters select")].map(e=>e.value),dialogs:window.__dialogs.length})');
		await d.evaluate('window.__listRelease67();window.__listJob67');assert.deepEqual(await rawWorkflow(d),raw);assert.deepEqual(await d.evaluate('({html:document.querySelector("#month-tx-list").innerHTML,title:document.querySelector("#month-tx-list-title").textContent,search:document.querySelector("#input-tx-search").value,filters:[...document.querySelectorAll(".tx-filters select")].map(e=>e.value),dialogs:window.__dialogs.length})'),state);
	}finally{await d.evaluate('(async()=>{try{window.__listRelease67?.();await window.__listJob67;}finally{window.__restoreList67?.();}})()');}
});
uiCase67(f,'filters income by its actual category when the native axis selector uses actual classification',async d=>{
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.categories.push({id:"income-actual67",name:"実態収入67",type:"income",subcategories:[]});})');
	await seed(d,[transaction('actual-income67',{type:'income',category_id:'cat_income_main',actual_category_id:'income-actual67',amount:200}),transaction('accounting-income67',{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',amount:300})]);await cashflow(d);await d.select('#select-type-filter','income');await d.click('#btn-toggle-axis');await flushWorkflow(d);await d.select('#select-category-filter','income-actual67');await flushWorkflow(d);
	assert.equal(await d.evaluate('window.__yose_app.useActualCategoryAxis'),true);assert.deepEqual(await d.evaluate('[...document.querySelectorAll("#month-tx-list .tx-item")].map(e=>e.dataset.id)'),['actual-income67']);assert.match(await d.textContent('#month-tx-list'),/200/);
});
uiCase67(f,'preserves a committed confirmation without old refresh or notifications after native lock and PIN unlock',async d=>{
	await seed(d,[transaction('confirmed-old67',{status:'planned'}),transaction('editor-new67')]);await cashflow(d);
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,write=db.confirmPlannedTransaction,c=app.txListController,start=c.confirmTransaction;db.confirmPlannedTransaction=async function(...args){db.confirmPlannedTransaction=write;const result=await write.apply(this,args);await new Promise(resolve=>window.__listRelease67=resolve);return result;};c.confirmTransaction=function(...args){return window.__listJob67=start.apply(this,args);};window.__restoreList67=()=>{db.confirmPlannedTransaction=write;c.confirmTransaction=start;};})()`);
		await d.click('.btn-confirm-tx[data-id="confirmed-old67"]');await d.waitFor('typeof window.__listRelease67==="function"');assert.equal((await records(d)).find(t=>t.id==='confirmed-old67').status,'confirmed');const raw=await rawWorkflow(d);
		await unlockWorkflow(d);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("editor-new67")');await d.fill('#edit-tx-memo','NEW_AFTER_CONFIRM67');
		const state=await d.evaluate('({values:window.__yose_app.txEditController.captureValues(),baseline:window.__yose_app.txEditController.initialValues,dialogs:window.__dialogs.length,toast:document.querySelector("#toast-notification").textContent})');
		await d.evaluate(`(()=>{const app=window.__yose_app,refresh=app.refreshAfterTransactionChange;window.__oldConfirmRefresh67=0;app.refreshAfterTransactionChange=function(...args){window.__oldConfirmRefresh67++;return refresh.apply(this,args);};const restore=window.__restoreList67;window.__restoreList67=()=>{restore();app.refreshAfterTransactionChange=refresh;};})()`);
		await d.evaluate('window.__listRelease67();window.__listJob67');assert.equal(await d.evaluate('window.__oldConfirmRefresh67'),0);assert.deepEqual(await rawWorkflow(d),raw);assert.deepEqual(await d.evaluate('({values:window.__yose_app.txEditController.captureValues(),baseline:window.__yose_app.txEditController.initialValues,dialogs:window.__dialogs.length,toast:document.querySelector("#toast-notification").textContent})'),state);
	}finally{await d.evaluate('(async()=>{try{window.__listRelease67?.();await window.__listJob67;}finally{window.__restoreList67?.();}})()');}
});
uiCase67(f,'releases a real pending pointer render when Chromium hides the page and restores visibility',async d=>{
	await seed(d,[transaction('visible-pointer67')]);await cashflow(d);
	let target=null,point=null;
	try{
		point=await d.evaluate(`(()=>{const e=document.querySelector('#month-tx-list .tx-item');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()`);
		await d.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},d.sessionId);
		await d.evaluate(`(()=>{const app=window.__yose_app;window.__visibilityEvents67=[];const listen=()=>window.__visibilityEvents67.push(document.hidden);document.addEventListener('visibilitychange',listen);window.__removeVisibility67=()=>document.removeEventListener('visibilitychange',listen);window.__pointerVisibilityDone67=false;window.__pointerVisibilityJob67=app.txListController.renderMonthTransactions().then(()=>window.__pointerVisibilityDone67=true);})()`);
		await d.waitFor('window.__yose_app.txListController._listWaiters.size===1');assert.equal(await d.evaluate('window.__pointerVisibilityDone67'),false);
		const {targetInfo}=await d.send('Target.getTargetInfo',{},d.sessionId);target=(await d.send('Target.createTarget',{url:'about:blank',browserContextId:targetInfo.browserContextId,background:false})).targetId;
		await d.waitFor('document.hidden&&window.__pointerVisibilityDone67');assert.ok(await d.evaluate('window.__visibilityEvents67.includes(true)'));assert.equal(await d.evaluate('window.__yose_app.txListController._listPointers.size'),0);
		await d.send('Page.bringToFront',{},d.sessionId);await d.waitFor('!document.hidden');assert.ok(await d.evaluate('window.__visibilityEvents67.includes(false)'));await d.evaluate('window.__pointerVisibilityJob67');assert.equal(await d.isVisible('#modal-edit-tx'),false);
	}finally{
		if(target)await d.send('Page.bringToFront',{},d.sessionId);
		if(point)await d.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:1,y:1,button:'left',clickCount:1},d.sessionId);
		if(target)await d.send('Target.closeTarget',{targetId:target});
		await d.evaluate('(async()=>{try{await window.__pointerVisibilityJob67;}finally{window.__removeVisibility67?.();}})()');
	}
});
