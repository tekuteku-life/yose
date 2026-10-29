import assert from 'node:assert/strict';
import {useBrowser,seed,transaction,cashflow,records} from '../helpers/ui_fixture.js';
import {uiCase67} from '../helpers/ui_workflows67.js';
import {flushWorkflow,rawWorkflow,unlockWorkflow} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
uiCase67(f,'edits accepted ungrouped transactions with omitted tags while preserving expense classifications',async d=>{
	const tx=transaction('ungrouped67');delete tx.group_id;delete tx.tags;await seed(d,[tx]);
	const before=await rawWorkflow(d);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("ungrouped67")');
	assert.equal(await d.evaluate('document.querySelector("#edit-tx-account").value'),'acc_wallet');assert.equal(await d.evaluate('document.querySelector("#edit-tx-category").value'),'cat_food');assert.equal(await d.evaluate('document.querySelector("#edit-tx-tags").value'),'');
	await d.evaluate('window.__yose_app.txEditController.populateTypeCategories("expense")');assert.equal(await d.evaluate('document.querySelector("#edit-tx-category").value'),'cat_food');
	await d.select('#edit-tx-type','transfer');await flushWorkflow(d);assert.equal(await d.isVisible('#edit-tx-to-account-group'),true);assert.equal(await d.isVisible('#edit-tx-cat-container'),false);
	await d.select('#edit-tx-type','expense');await flushWorkflow(d);assert.equal(await d.evaluate('document.querySelector("#edit-tx-category").value'),'cat_food');assert.deepEqual(await rawWorkflow(d),before);
	await d.setConfirm(false);await d.click('#btn-edit-delete-tx');await flushWorkflow(d);assert.deepEqual(await rawWorkflow(d),before);assert.equal(await d.isVisible('#modal-edit-tx'),true);
});
uiCase67(f,'refuses an old edit after a real complete import removes its original row',async d=>{
	await seed(d,[transaction('removed-edit67')]);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("removed-edit67")');await d.fill('#edit-tx-memo','UNSAVED_OLD67');
	await d.evaluate('(async()=>{const db=window.__yose_app.db,plan=await db.prepareReplacementImport({export_type:"transactions",transactions:[]});await db.commitReplacementImport(plan,{confirmation:"完全インポート"});})()');
	const raw=await rawWorkflow(d),dialogs=await d.evaluate('window.__dialogs.length');await d.click('#edit-tx-form button[type="submit"]');await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d),raw);assert.match((await d.evaluate(`window.__dialogs.slice(${dialogs})`)).map(v=>v.message).join('\n'),/明細が削除または変更/);assert.equal(await d.evaluate('document.querySelector("#edit-tx-memo").value'),'UNSAVED_OLD67');
});
uiCase67(f,'treats public deletion of a missing or already deleted row as an idle no-op',async d=>{
	await seed(d,[transaction('already-deleted67')]);await d.evaluate('window.__yose_app.db.deleteTransaction("already-deleted67")');const raw=await rawWorkflow(d),dialogs=await d.evaluate('window.__dialogs.length');
	await d.evaluate('(async()=>{const c=window.__yose_app.txEditController;await c.handleEditDelete("absent67");await c.handleEditDelete("already-deleted67");})()');
	assert.deepEqual(await rawWorkflow(d),raw);assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);assert.equal(await d.evaluate('window.__yose_app.txEditController.busy'),false);
});
for(const action of ['edit-read','edit-type-child','delete-error'])uiCase67(f,`keeps a new editor and originals after the old ${action} finishes`,async d=>{
	await seed(d,[transaction('old-data67'),transaction('new-data67',{amount:999,status:'planned'})]);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("old-data67")');await d.fill('#edit-tx-memo','OLD_UNSAVED67');
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,owner=${action==='edit-type-child'?'app.txInputController':'app.db'},name=${JSON.stringify(action==='edit-type-child'?'updateSubcategories':'getTransaction')},original=owner[name];owner[name]=async function(...args){owner[name]=original;const result=await original.apply(this,args);await new Promise(resolve=>window.__dataRelease67=resolve);${action==='delete-error'?"throw new Error('OLD_DELETE_FAULT67');":'return result;'}};window.__restoreData67=()=>owner[name]=original;window.__dataJob67=app.txEditController.${action==='edit-read'?'handleEditFormSubmit()':action==='edit-type-child'?'populateTypeCategories("expense")':'handleEditDelete("old-data67")'};})()`);
		await d.waitFor('typeof window.__dataRelease67==="function"');await unlockWorkflow(d);await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("new-data67")');await d.fill('#edit-tx-memo','NEW_DATA_DRAFT67');
		const raw=await rawWorkflow(d),state=await d.evaluate('({values:window.__yose_app.txEditController.captureValues(),baseline:window.__yose_app.txEditController.initialValues,original:window.__yose_app.txEditController.originalTransaction,busy:window.__yose_app.txEditController.busy,dialogs:window.__dialogs.length})');
		await d.evaluate('window.__dataRelease67();window.__dataJob67');assert.deepEqual(await rawWorkflow(d),raw);assert.deepEqual(await d.evaluate('({values:window.__yose_app.txEditController.captureValues(),baseline:window.__yose_app.txEditController.initialValues,original:window.__yose_app.txEditController.originalTransaction,busy:window.__yose_app.txEditController.busy,dialogs:window.__dialogs.length})'),state);
	}finally{await d.evaluate('(async()=>{try{window.__dataRelease67?.();await window.__dataJob67;}finally{window.__restoreData67?.();}})()');}
});
for(const mode of ['repay','prepaid'])uiCase67(f,`rejects explicit zero ${mode} from the public submit API as well as native validation`,async d=>{
	await d.click(`.mode-tab-btn[data-mode="${mode}"]`);await flushWorkflow(d);const selector=mode==='repay'?'#input-repay-amount':'#input-prepaid-total';await d.fill(selector,'0');const raw=await rawWorkflow(d),dialogs=await d.evaluate('window.__dialogs.length');
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(selector)}).validity.rangeUnderflow`),true);await d.evaluate('window.__yose_app.handleFormSubmit()');await flushWorkflow(d);assert.deepEqual(await rawWorkflow(d),raw);assert.match((await d.evaluate(`window.__dialogs.slice(${dialogs})`)).map(v=>v.message).join('\n'),mode==='repay'?/回収額/:/一括支払総額/);
});
uiCase67(f,'uses twelve months for an omitted public prepayment period and preserves independent empty actual detail',async d=>{
	await d.click('.mode-tab-btn[data-mode="prepaid"]');await flushWorkflow(d);await d.fill('#input-prepaid-total','1200');await d.fill('#input-prepaid-months','');await d.click('#chk-sync-actual-category');await d.select('#select-actual-subcategory','');
	await d.evaluate('window.__yose_app.handleFormSubmit()');await flushWorkflow(d);const all=await records(d),children=all.filter(t=>t.type==='expense');
	assert.equal(children.length,12);assert.equal(children.reduce((n,t)=>n+t.amount,0),1200);for(const tx of children)assert.equal(tx.actual_subcategory_id,null);
});
uiCase67(f,'accepts empty optional memo callbacks without replacing the current registration draft',async d=>{
	await d.fill('#input-memo','KEEP_OPTIONAL_MEMO67');const raw=await rawWorkflow(d),value=await d.evaluate('document.querySelector("#input-memo").value');await d.evaluate('window.__yose_app.txInputController.handleMemoChange()');assert.equal(await d.evaluate('document.querySelector("#input-memo").value'),value);assert.deepEqual(await rawWorkflow(d),raw);
});
