import assert from 'node:assert/strict';
import {useBrowser,value} from '../helpers/ui_fixture.js';
import {uiCase67,observeNativeEvent67} from '../helpers/ui_workflows67.js';
import {gateMethod,waitGate,releaseGate,unlockWorkflow} from '../helpers/workflow_ui_fixture.js';
import {holdNativeKeyRegeneration67,finishNativeKeyRegeneration67} from '../helpers/auth_epoch67.js';
const fixture=useBrowser();
const raw=d=>d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
async function save(d,amount,memo){await d.fill('#input-amount',String(amount));await d.fill('#input-memo',memo);const index=await d.evaluate('window.__masterNativeJobs67.length');await d.click('#btn-save-tx');await d.evaluate(`window.__masterNativeJobs67[${index}]`);}
async function countProcess(d){await d.evaluate('(()=>{const db=window.__yose_app.db,original=db.processCreditCardAutoSettlements;window.__maintenancePasses67=0;db.processCreditCardAutoSettlements=function(...args){window.__maintenancePasses67++;return original.apply(this,args);};window.__restores67.push(()=>db.processCreditCardAutoSettlements=original);})()');}
for(const expired of [false,true])uiCase67(fixture,`handles a newer real save queued during background read failure ${expired?'without rescheduling after native authentication expires':'with exactly one follow-up pass'}`,async d=>{
	await countProcess(d);await gateMethod(d,'window.__yose_app.db','processCreditCardAutoSettlements',{afterRead:true,reject:true});await observeNativeEvent67(d,'#tx-form','submit');
	try{
		await save(d,101,'FIRST_MAINTENANCE_SAVE');await waitGate(d);await d.evaluate('void(window.__oldMaintenance67=window.__yose_app._transactionMaintenanceTask.promise)');await save(d,202,'SECOND_MAINTENANCE_SAVE');assert.equal(await d.evaluate('window.__yose_app._transactionMaintenanceTask.requested'),true);
		const rows=await d.evaluate('window.__yose_app.db.getTransactions()');assert.deepEqual(rows.map(row=>row.amount).sort((a,b)=>a-b),[101,202]);
		if(expired)await holdNativeKeyRegeneration67(d);else await d.fill('#input-memo','NEXT_UNSAVED_MAINTENANCE_DRAFT');const before=await raw(d),count=await d.evaluate('window.__dialogs.length');
		await releaseGate(d);await d.evaluate('window.__oldMaintenance67');assert.equal(await d.evaluate('window.__maintenancePasses67'),expired?1:2);assert.equal(await d.evaluate('window.__yose_app._transactionMaintenanceTask'),null);assert.deepEqual(await d.evaluate('window.__yose_app.db.getTransactions()'),rows);assert.deepEqual(await raw(d),before);assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);if(!expired)assert.equal(await value(d,'#input-memo'),'NEXT_UNSAVED_MAINTENANCE_DRAFT');
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled([window.__oldMaintenance67,...window.__masterNativeJobs67])');if(expired)await finishNativeKeyRegeneration67(d);}
});
uiCase67(fixture,'cancels actual background work on lock without changing the newer PIN session or input after its old read returns',async d=>{
	await gateMethod(d,'window.__yose_app.db','processCreditCardAutoSettlements',{afterRead:true});await observeNativeEvent67(d,'#tx-form','submit');
	try{
		await save(d,303,'LOCKED_MAINTENANCE_SAVE');await waitGate(d);await d.evaluate('void(window.__oldMaintenance67=window.__yose_app._transactionMaintenanceTask.promise)');await unlockWorkflow(d);await d.fill('#input-memo','NEW_BACKGROUND_DRAFT');const before=await raw(d),count=await d.evaluate('window.__dialogs.length');await releaseGate(d);await d.evaluate('window.__oldMaintenance67');assert.equal(await value(d,'#input-memo'),'NEW_BACKGROUND_DRAFT');assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'),true);assert.deepEqual(await raw(d),before);assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled([window.__oldMaintenance67,...window.__masterNativeJobs67])');}
});
