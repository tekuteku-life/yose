import {it} from 'node:test';
import assert from 'node:assert/strict';
import {useBrowser} from '../helpers/ui_fixture.js';
import {unlockWorkflow} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
for(const stage of ['summary','list-first','list-second','pane'])it(`old drilldown cannot reset new filters or scroll after ${stage} returns`,async()=>{
	const d=f.driver;
	try{
	await d.click('[data-analytics-target="assets"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');
	await d.evaluate(`(()=>{const app=window.__yose_app,c=app.summaryController,owner=${stage==='summary'?'c':stage==='pane'?'app':'app.txListController'},name=${JSON.stringify(stage==='summary'?'renderSummary':stage==='pane'?'setPaneCollapsed':'renderMonthTransactions')},render=owner[name];let calls=0;owner[name]=async function(...args){const result=await render.apply(this,args);calls++;if(calls===${stage==='list-second'?2:1})await new Promise(resolve=>window.__release67=resolve);return result;};window.__restore67=()=>owner[name]=render;window.__old67=c.applyDrilldownFilter({accountId:'acc_wallet',categoryId:'cat_food'});})()`);
	await d.waitFor('typeof window.__release67==="function"');await unlockWorkflow(d);
	await d.select('#select-status-filter','planned');await d.fill('#input-tx-search','new session');await d.evaluate('window.__yose_app.txListController.renderMonthTransactions()');await d.evaluate(`(()=>{const card=document.querySelector('#card-month-tx-list'),scroll=card.scrollIntoView;window.__drillScrollCount67=0;card.scrollIntoView=function(...args){window.__drillScrollCount67++;return scroll.apply(this,args);};const restore=window.__restore67;window.__restore67=()=>{restore();card.scrollIntoView=scroll;};})()`);
	const raw=await d.evaluate('window.__yose_app.db.captureImportState()');const state=await d.evaluate('({status:document.querySelector("#select-status-filter").value,search:document.querySelector("#input-tx-search").value,account:document.querySelector("#select-account-filter").value,category:document.querySelector("#select-category-filter").value})');
	await d.evaluate('window.__release67();window.__old67');
	assert.deepEqual(await d.evaluate('({status:document.querySelector("#select-status-filter").value,search:document.querySelector("#input-tx-search").value,account:document.querySelector("#select-account-filter").value,category:document.querySelector("#select-category-filter").value})'),state);
	assert.equal(await d.evaluate('window.__drillScrollCount67'),0);assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
	}finally{await d.evaluate('(async()=>{try{window.__release67?.();await window.__old67;}finally{window.__restore67?.();}})()');}
});
it('leaves the locked screen, filters and raw originals unchanged when a default drilldown callback arrives late',async()=>{
	const d=f.driver;await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	const before=await d.evaluate('(async()=>({html:document.querySelector("#tab-summary").innerHTML,raw:await window.__yose_app.db.captureImportState(),dialogs:window.__dialogs.length}))()');
	await d.evaluate('window.__yose_app.summaryController.applyDrilldownFilter()');
	assert.deepEqual(await d.evaluate('(async()=>({html:document.querySelector("#tab-summary").innerHTML,raw:await window.__yose_app.db.captureImportState(),dialogs:window.__dialogs.length}))()'),before);
});
