import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, cashflow } from '../helpers/ui_fixture.js';
import { unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const f=useBrowser();
async function setup(d){await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.recurring_rules=[{id:'generation-edge67',name:'生成境界',is_active:true,frequency:'monthly',start_date:'2026-01-01',day_of_month:15,holiday_adjustment:'none',amount:100,type:'expense',account_id:'acc_wallet',to_account_id:null,category_id:'cat_food',subcategory_id:'sub_groceries',actual_category_id:'cat_food',actual_subcategory_id:'sub_groceries'}];});const owner=app.summaryController,generate=owner.handleGenerateRecurring;owner.handleGenerateRecurring=function(...args){return window.__genJob67=generate.apply(this,args);};window.__restoreGeneration67=()=>owner.handleGenerateRecurring=generate;})()`);await cashflow(d);}
async function cleanup(d){await d.evaluate('(async()=>{try{window.__genRelease67?.();await window.__genJob67;}finally{window.__restoreDependency67?.();window.__restoreGeneration67?.();}})()');}
for(const expired of [false,true])it(`${expired?'silences an obsolete':'reports an active'} recurring read failure`,async()=>{
	const d=f.driver;await setup(d);const before=await d.evaluate('window.__yose_app.db.captureImportState()');
	try{
	await d.evaluate(`(()=>{const db=window.__yose_app.db,read=db.getMasterConfig;db.getMasterConfig=async function(...args){db.getMasterConfig=read;await read.apply(this,args);await new Promise(resolve=>window.__genRelease67=resolve);throw new Error('GEN_READ_FAILURE67');};window.__restoreDependency67=()=>db.getMasterConfig=read;})()`);
	await d.click('#btn-generate-recurring');await d.waitFor('typeof window.__genRelease67==="function"');if(expired)await unlockWorkflow(d);const dialogs=await d.evaluate('window.__dialogs.length');await d.evaluate('window.__genRelease67();window.__genJob67');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);const notices=await d.evaluate(`window.__dialogs.slice(${dialogs})`);if(expired)assert.deepEqual(notices,[]);else assert.match(notices.map(item=>item.message).join('\n'),/定期予定の生成に失敗しました: GEN_READ_FAILURE67/);assert.equal(await d.evaluate('document.querySelector("#btn-generate-recurring").disabled'),false);
	}finally{await cleanup(d);}
});
for(const stage of ['read','commit'])it(`keeps recurring generation within its originating session after the ${stage} dependency resolves`,async()=>{
	const d=f.driver;await setup(d);
	try{
	await d.evaluate(`(()=>{const db=window.__yose_app.db,name=${JSON.stringify(stage==='read'?'getMasterConfig':'generateRecurringForMonth')},original=db[name];db[name]=async function(...args){db[name]=original;const result=await original.apply(this,args);window.__genRaw67=await db.captureImportState();await new Promise(resolve=>window.__genRelease67=resolve);return result;};window.__restoreDependency67=()=>db[name]=original;})()`);
	await d.click('#btn-generate-recurring');await d.waitFor('typeof window.__genRelease67==="function"');await unlockWorkflow(d);const dialogs=await d.evaluate('window.__dialogs.length');await d.evaluate('window.__genRelease67();window.__genJob67');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),await d.evaluate('window.__genRaw67'));assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);
	const rows=await d.evaluate('window.__yose_app.db.getTransactions()');assert.equal(rows.length,stage==='commit'?1:0);if(stage==='commit'){assert.equal(rows[0].amount,100);assert.equal(rows[0].recurring_rule_id,'generation-edge67');}
	}finally{await cleanup(d);}
});
for(const [failure,expired]of [[true,false],[true,true],[false,true]])it(`retains a committed recurring record when following refresh ${failure?'fails':'finishes'} ${expired?'after PIN unlock':'in the active session'}`,async()=>{
	const d=f.driver;await setup(d);
	try{
	await d.evaluate(`(()=>{const app=window.__yose_app,refresh=app.refreshAfterTransactionChange;let once=true;app.refreshAfterTransactionChange=async function(...args){const result=await refresh.apply(this,args);if(once){once=false;window.__genRaw67=await app.db.captureImportState();await new Promise(resolve=>window.__genRelease67=resolve);${failure?"throw new Error('GEN_DISPLAY_FAILURE67');":''}}return result;};window.__restoreDependency67=()=>app.refreshAfterTransactionChange=refresh;})()`);
	await d.click('#btn-generate-recurring');await d.waitFor('typeof window.__genRelease67==="function"');if(expired)await unlockWorkflow(d);const dialogs=await d.evaluate('window.__dialogs.length');await d.evaluate('window.__genRelease67();window.__genJob67');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),await d.evaluate('window.__genRaw67'));const rows=await d.evaluate('window.__yose_app.db.getTransactions()');assert.equal(rows.length,1);assert.equal(rows[0].amount,100);assert.equal(rows[0].recurring_rule_id,'generation-edge67');const notices=await d.evaluate(`window.__dialogs.slice(${dialogs})`);if(expired)assert.deepEqual(notices,[]);else assert.match(notices.map(item=>item.message).join('\n'),/1 件は保存済み.*表示の更新に失敗しました: GEN_DISPLAY_FAILURE67/s);assert.equal(await d.evaluate('document.querySelector("#btn-generate-recurring").disabled'),false);
	}finally{await cleanup(d);}
});
