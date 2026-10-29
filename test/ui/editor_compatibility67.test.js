import assert from 'node:assert/strict';
import {useBrowser,seed,transaction,records} from '../helpers/ui_fixture.js';
import {uiCase67} from '../helpers/ui_workflows67.js';
import {flushWorkflow,rawWorkflow,unlockWorkflow} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
uiCase67(f,'opens an accepted uncategorized transaction with a master that omits its category collection',async d=>{
	await seed(d,[transaction('uncategorized-old67',{category_id:null,actual_category_id:null})]);
	await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({...await db.getSnapshot(),last_closed_month:null,monthly_summaries:{}});await db.mutateMasterConfig(c=>{delete c.categories;c.recurring_rules=[];c.point_payment_defaults=null;});})()');const raw=await rawWorkflow(d);
	await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("uncategorized-old67")');
	assert.equal(await d.isVisible('#modal-edit-tx'),true);for(const name of ['category','actual-category'])assert.equal(await d.evaluate(`document.querySelector('#edit-tx-${name}').options.length`),0);
	assert.equal(await d.evaluate('document.querySelector("#edit-tx-subcategory").value'),'');await d.evaluate('window.__yose_app.txEditController.populateTypeCategories("expense")');assert.deepEqual(await rawWorkflow(d),raw);
});
uiCase67(f,'reads legacy category-type omission as expense without rewriting the encrypted legacy master',async d=>{
	await seed(d,[transaction('legacy-category67')]);
	await d.evaluate('(async()=>{const db=window.__yose_app.db,config=await db.getMasterConfig();delete config.categories.find(c=>c.id==="cat_food").type;await db.putRaw("master_config",await db.encryptRecord(config),"current");})()');
	const raw=await rawWorkflow(d);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("legacy-category67")');assert.equal(await d.isVisible('#modal-edit-tx'),true);for(const name of ['category','actual-category'])assert.equal(await d.evaluate(`document.querySelector('#edit-tx-${name}').value`),'cat_food');
	await d.evaluate('window.__yose_app.txEditController.populateTypeCategories("expense")');assert.equal(await d.evaluate('document.querySelector("#edit-tx-category").value'),'cat_food');assert.deepEqual(await rawWorkflow(d),raw);assert.equal(await d.evaluate('(async()=>Object.hasOwn((await window.__yose_app.db.getMasterConfig()).categories.find(c=>c.id==="cat_food"),"type"))()'),false);
});
async function prepayment(d){await d.click('.mode-tab-btn[data-mode="prepaid"]');await flushWorkflow(d);await d.fill('#input-prepaid-total','1200');await d.fill('#input-prepaid-months','2');await d.fill('#input-memo','GROUP_ORIGINAL67');await d.click('#btn-save-tx');await flushWorkflow(d);const all=await records(d),children=all.filter(t=>t.type==='expense');assert.equal(children.length,2);return children;}
uiCase67(f,'rejects a whole prepayment edit when another real writer changes its sibling',async d=>{
	const [first,second]=await prepayment(d);await d.evaluate(`window.__yose_app.txEditController.openEditTransactionModal(${JSON.stringify(first.id)})`);await d.fill('#edit-tx-memo','UNSAVED_GROUP67');await d.evaluate(`(async()=>{const db=window.__yose_app.db,tx=await db.getTransaction(${JSON.stringify(second.id)});await db.putTransaction({...tx,memo:'CHANGED_SIBLING67'},{expectedTransactions:[tx]});})()`);
	const raw=await rawWorkflow(d),dialogs=await d.evaluate('window.__dialogs.length');await d.click('#edit-tx-form button[type="submit"]');await flushWorkflow(d);assert.deepEqual(await rawWorkflow(d),raw);assert.match((await d.evaluate(`window.__dialogs.slice(${dialogs})`)).map(n=>n.message).join('\n'),/関連明細が変更/);assert.equal(await d.evaluate('document.querySelector("#edit-tx-memo").value'),'UNSAVED_GROUP67');
});
uiCase67(f,'cancels an old group read without changing a newly authenticated editor',async d=>{
	const [first]=await prepayment(d);await seed(d,[transaction('new-group-editor67',{amount:999,status:'planned'})]);await d.evaluate(`window.__yose_app.txEditController.openEditTransactionModal(${JSON.stringify(first.id)})`);await d.fill('#edit-tx-memo','OLD_GROUP_DRAFT67');
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,read=db.getTransactionsByGroupId;db.getTransactionsByGroupId=async function(...args){db.getTransactionsByGroupId=read;const result=await read.apply(this,args);await new Promise(resolve=>window.__compatRelease67=resolve);return result;};window.__restoreCompat67=()=>db.getTransactionsByGroupId=read;window.__compatJob67=app.txEditController.handleEditFormSubmit();})()`);
		await d.waitFor('typeof window.__compatRelease67==="function"');await unlockWorkflow(d);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("new-group-editor67")');await d.fill('#edit-tx-memo','NEW_GROUP_DRAFT67');
		const raw=await rawWorkflow(d),state=await d.evaluate('({values:window.__yose_app.txEditController.captureValues(),initial:window.__yose_app.txEditController.initialValues,original:window.__yose_app.txEditController.originalTransaction,busy:window.__yose_app.txEditController.busy,dialogs:window.__dialogs.length})');
		await d.evaluate('window.__compatRelease67();window.__compatJob67');assert.deepEqual(await rawWorkflow(d),raw);assert.deepEqual(await d.evaluate('({values:window.__yose_app.txEditController.captureValues(),initial:window.__yose_app.txEditController.initialValues,original:window.__yose_app.txEditController.originalTransaction,busy:window.__yose_app.txEditController.busy,dialogs:window.__dialogs.length})'),state);
	}finally{await d.evaluate('(async()=>{try{window.__compatRelease67?.();await window.__compatJob67;}finally{window.__restoreCompat67?.();}})()');}
});
uiCase67(f,'rejects public editor open and close requests while an actual save owns its busy form',async d=>{
	await seed(d,[transaction('busy-editor67'),transaction('other-editor67')]);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("busy-editor67")');await d.fill('#edit-tx-memo','FROZEN_EDITOR67');
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,write=db.putTransaction;db.putTransaction=async function(...args){db.putTransaction=write;await new Promise(resolve=>window.__compatRelease67=resolve);return write.apply(this,args);};window.__restoreCompat67=()=>db.putTransaction=write;window.__compatJob67=app.txEditController.handleEditFormSubmit();})()`);await d.waitFor('typeof window.__compatRelease67==="function"');
		const state=await d.evaluate('({values:window.__yose_app.txEditController.captureValues(),id:window.__yose_app.txEditController.originalTransaction.id,dialogs:window.__dialogs.length})');assert.equal(await d.evaluate('window.__yose_app.txEditController.requestClose()'),false);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("other-editor67")');assert.deepEqual(await d.evaluate('({values:window.__yose_app.txEditController.captureValues(),id:window.__yose_app.txEditController.originalTransaction.id,dialogs:window.__dialogs.length})'),state);
		await d.evaluate('window.__compatRelease67();window.__compatJob67');assert.equal((await records(d)).find(t=>t.id==='busy-editor67').memo,'FROZEN_EDITOR67');assert.equal(await d.isVisible('#modal-edit-tx'),false);
	}finally{await d.evaluate('(async()=>{try{window.__compatRelease67?.();await window.__compatJob67;}finally{window.__restoreCompat67?.();}})()');}
});
