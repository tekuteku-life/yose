import {uiCase67} from '../helpers/ui_workflows67.js';
import assert from'node:assert/strict';
import{useBrowser,seed,transaction,records}from'../helpers/ui_fixture.js';
import{unlockWorkflow,flushWorkflow}from'../helpers/workflow_ui_fixture.js';
const f=useBrowser();
const source=id=>transaction(id,{type:'transfer',to_account_id:'acc_receivable',category_id:null,actual_category_id:null,amount:2400,settlement_status:'unsettled'});
for(const stage of ['source','links','master','approval','commit','refresh'])uiCase67(f,`old direct settlement stops at ${stage} after reauthentication`,async d=>{
await seed(d,[source('advance-old67')]);await d.click('.mode-tab-btn[data-mode="repay"]');await d.waitFor('document.querySelector(".btn-settle-advance[data-tx-id=advance-old67]")');await flushWorkflow(d);
	try{
	await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,c=app.txInputController,owner=${stage==='approval'||stage==='refresh'?'app':'db'},name=${JSON.stringify(({source:'getTransaction',links:'getTransactions',master:'getMasterConfig',approval:'approveClosedChanges',commit:'linkAdvanceRepayment',refresh:'refreshAllViews'})[stage])},read=owner[name],start=c.handleSettleAdvanceDirectly;const names=${stage==='refresh'?"['refreshAllViews','refreshAfterTransactionChange']":'[name]'},methods=new Map(names.map(n=>[n,owner[n]]));const restore=()=>{for(const [n,fn]of methods)owner[n]=fn;};for(const n of names)owner[n]=async function(...args){restore();const result=await methods.get(n).apply(this,args);await new Promise(resolve=>window.__settleRelease67=resolve);return result;};c.handleSettleAdvanceDirectly=function(...args){return window.__settleJob67=start.apply(this,args);};window.__restoreSettle67=()=>{restore();c.handleSettleAdvanceDirectly=start;};})()`);
	await d.click('.btn-settle-advance[data-tx-id="advance-old67"]');await d.waitFor('typeof window.__settleRelease67==="function"');
	await unlockWorkflow(d);await d.fill('#input-memo','NEW_INPUT67');
	const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),before=await d.evaluate('({memo:document.querySelector("#input-memo").value,dialogs:window.__dialogs.length,toast:document.querySelector("#toast-notification").textContent})');
	await d.evaluate(`(()=>{const manager=window.__yose_app.syncManager,sync=manager.syncPendingDiffs;window.__oldTransport67=0;manager.syncPendingDiffs=function(...args){window.__oldTransport67++;return sync.apply(this,args);};const restore=window.__restoreSettle67;window.__restoreSettle67=()=>{restore();manager.syncPendingDiffs=sync;};})()`);
	await d.evaluate('window.__settleRelease67();window.__settleJob67');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);assert.deepEqual(await d.evaluate('({memo:document.querySelector("#input-memo").value,dialogs:window.__dialogs.length,toast:document.querySelector("#toast-notification").textContent})'),before);assert.equal(await d.evaluate('window.__oldTransport67'),0);
	const saved=await records(d);assert.equal(saved.length,['commit','refresh'].includes(stage)?2:1);
	}finally{await d.evaluate('(async()=>{try{window.__settleRelease67?.();await window.__settleJob67;}finally{window.__restoreSettle67?.();}})()');}
});
uiCase67(f,'releases an expired settlement owner and preserves a new native settlement while the old response returns',async d=>{
	await seed(d,[source('old-owner67'),source('new-owner67')]);await d.click('.mode-tab-btn[data-mode="repay"]');await flushWorkflow(d);
	try{
		await d.evaluate(`(()=>{const c=window.__yose_app.txInputController,db=c.db,read=db.getTransaction,start=c.handleSettleAdvanceDirectly;window.__settleGates67=[];window.__settleJobs67=[];db.getTransaction=async function(id,...args){const result=await read.call(this,id,...args);if(['old-owner67','new-owner67'].includes(id)){const gate={id};window.__settleGates67.push(gate);await new Promise(resolve=>gate.release=resolve);}return result;};c.handleSettleAdvanceDirectly=function(...args){const result=start.apply(this,args);window.__settleJobs67.push(result);return result;};window.__restoreSettlementOwner67=()=>{db.getTransaction=read;c.handleSettleAdvanceDirectly=start;};})()`);
		await d.click('.btn-settle-advance[data-tx-id="old-owner67"]');await d.waitFor('window.__settleGates67.length===1');await unlockWorkflow(d);
		assert.equal(await d.evaluate('window.__yose_app.txInputController.settleBusy'),false,'authentication cancellation must release the expired owner');
		const transitionStart=await d.evaluate('window.__workflowJobs.length');await d.click('.mode-tab-btn[data-mode="repay"]');
		assert.ok(await d.evaluate(`window.__workflowJobs.slice(${transitionStart}).some(j=>j.name==='switchInputMode')`),'the new native mode transition must actually start');
		await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${transitionStart}).filter(j=>j.name==='switchInputMode').map(j=>j.promise))`);
		await d.click('.btn-settle-advance[data-tx-id="new-owner67"]');await d.waitFor('window.__settleGates67.length===2');
		const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),notices=await d.evaluate('({dialogs:window.__dialogs.length,toast:document.querySelector("#toast-notification").textContent})');
		await d.evaluate('window.__settleGates67[0].release();window.__settleJobs67[0]');assert.equal(await d.evaluate('window.__yose_app.txInputController.settleBusy'),true);assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);assert.deepEqual(await d.evaluate('({dialogs:window.__dialogs.length,toast:document.querySelector("#toast-notification").textContent})'),notices);
		await d.select('#select-account','acc_bank_main');await d.evaluate('window.__settleGates67[1].release();window.__settleJobs67[1]');
		const repayments=(await records(d)).filter(tx=>tx.advance_source_id);assert.equal(repayments.length,1);assert.equal(repayments[0].advance_source_id,'new-owner67');assert.equal(repayments[0].to_account_id,'acc_wallet');assert.equal(repayments[0].amount,2400);assert.equal(await d.evaluate('window.__yose_app.txInputController.settleBusy'),false);
	}finally{await d.evaluate('(async()=>{try{window.__settleGates67?.forEach(g=>g.release?.());await Promise.allSettled(window.__settleJobs67||[]);}finally{window.__restoreSettlementOwner67?.();}})()');}
});
for(const kind of ['absent','deleted','settled','ordinary','unknown-amount'])uiCase67(f,`rejects a direct settlement whose current source is ${kind}`,async d=>{
	if(kind!=='absent')await seed(d,[kind==='ordinary'?transaction('invalid-source67'):source('invalid-source67')]);
	if(kind==='deleted')await d.evaluate('window.__yose_app.db.deleteTransaction("invalid-source67")');
	if(kind==='settled'||kind==='unknown-amount')await d.evaluate(`(async()=>{const db=window.__yose_app.db,tx=await db.getTransaction('invalid-source67');await db.putTransaction({...tx,...${JSON.stringify(kind==='settled'?{settlement_status:'settled'}:{amount:0,amount_pending:true,status:'planned'})}},{expectedTransactions:[tx]});})()`);
	const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),dialogs=await d.evaluate('window.__dialogs.length');await d.evaluate('window.__yose_app.txInputController.handleSettleAdvanceDirectly("invalid-source67")');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);assert.equal((await records(d)).filter(tx=>tx.advance_source_id).length,0);assert.match((await d.evaluate(`window.__dialogs.slice(${dialogs})`)).map(n=>n.message).join('\n'),kind==='unknown-amount'?/金額未入力/:/精算済み|削除済み|変更/);assert.equal(await d.evaluate('window.__yose_app.txInputController.settleBusy'),false);
});
uiCase67(f,'retains a direct settlement source when closed-month approval is declined',async d=>{
	await seed(d,[source('closed-source67')]);await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({...await db.getSnapshot(),last_closed_month:"2026-10"});})()');await d.setConfirm(false);const raw=await d.evaluate('window.__yose_app.db.captureImportState()');await d.evaluate('window.__yose_app.txInputController.handleSettleAdvanceDirectly("closed-source67")');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);assert.equal(await d.evaluate('window.__yose_app.txInputController.settleBusy'),false);assert.ok((await d.evaluate('window.__dialogs')).some(n=>n.type==='confirm'&&n.message.includes('再月締め')));
});
for(const stage of ['read','refresh'])uiCase67(f,`reports a current direct-settlement ${stage} failure with the correct commit state`,async d=>{
	await seed(d,[source('fault-source67')]);const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),dialogs=await d.evaluate('window.__dialogs.length');
	await d.evaluate(`(()=>{const app=window.__yose_app,owner=${stage==='read'?'app.db':'app'},names=${stage==='read'?"['getTransaction']":"['refreshAllViews','refreshAfterTransactionChange']"},methods=new Map(names.map(n=>[n,owner[n]]));for(const name of names)owner[name]=async()=>{throw new Error('SETTLEMENT_FAULT67');};window.__restores67.push(()=>{for(const[name,fn]of methods)owner[name]=fn;});})()`);
	await d.evaluate('window.__yose_app.txInputController.handleSettleAdvanceDirectly("fault-source67")');const messages=(await d.evaluate(`window.__dialogs.slice(${dialogs})`)).map(n=>n.message).join('\n');assert.match(messages,/SETTLEMENT_FAULT67/);
	if(stage==='read'){assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);assert.match(messages,/精算の保存に失敗/);}else{assert.equal((await records(d)).filter(tx=>tx.advance_source_id==='fault-source67').length,1);assert.match(messages,/保存済み.*表示/);}
	assert.equal(await d.evaluate('window.__yose_app.txInputController.settleBusy'),false);
});
