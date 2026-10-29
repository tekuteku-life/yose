import assert from 'node:assert/strict';
import {useBrowser,seed,transaction,cashflow,records} from '../helpers/ui_fixture.js';
import {uiCase67} from '../helpers/ui_workflows67.js';
import {flushWorkflow,rawWorkflow,unlockWorkflow} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
async function restore67(d){await d.evaluate('(async()=>{try{window.__awaitRelease67?.();await window.__awaitJob67;}finally{window.__restoreAwait67?.();}})()');}
async function newEditor67(d){await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("new67")');await d.fill('#edit-tx-memo','NEW_DRAFT67');await d.fill('#edit-tx-amount','987');}
async function editorState67(d){return d.evaluate('({id:document.querySelector("#edit-tx-id").value,memo:document.querySelector("#edit-tx-memo").value,modal:document.querySelector("#modal-edit-tx").className,html:document.querySelector("#edit-tx-form").innerHTML,values:window.__yose_app.txEditController.captureValues(),initialValues:window.__yose_app.txEditController.initialValues,original:window.__yose_app.txEditController.originalTransaction,busy:window.__yose_app.txEditController.busy,dialogs:window.__dialogs.length,toast:document.querySelector("#toast-notification").textContent})');}
for(const stage of ['group','accounting','actual','suggestions'])uiCase67(f,`does not replace a new editor after the old ${stage} response returns`,async d=>{
	await seed(d,[transaction('old67'),transaction('new67',{type:'income',amount:986,status:'planned',category_id:'cat_income_main',actual_category_id:'cat_income_main',tags:['new67']})]);
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,owner=${stage==='group'?'app.db':'app.txInputController'},name=${JSON.stringify(stage==='group'?'getTransactions':stage==='suggestions'?'updateTagAndMemoSuggestions':'updateSubcategories')},original=owner[name];let calls=0;owner[name]=async function(...args){const result=await original.apply(this,args);if(${stage==='group'?'args[0]?.group_id==="grp_old67"':`++calls===${stage==='actual'?2:1}`}){owner[name]=original;await new Promise(resolve=>window.__awaitRelease67=resolve);}return result;};window.__restoreAwait67=()=>owner[name]=original;window.__awaitJob67=app.txEditController.openEditTransactionModal('old67');})()`);
		await d.waitFor('typeof window.__awaitRelease67==="function"');await unlockWorkflow(d);await newEditor67(d);const raw=await rawWorkflow(d),state=await editorState67(d);
		await d.evaluate('window.__awaitRelease67();window.__awaitJob67');assert.deepEqual(await rawWorkflow(d),raw);assert.deepEqual(await editorState67(d),state);
	}finally{await restore67(d);}
});
for(const expired of [false,true])for(const action of ['editor-open','bulk-open','type-change'])uiCase67(f,`${action} read failure ${expired?'from an old authentication stays silent':'is reported in its current authentication'}`,async d=>{
	await seed(d,[transaction('old67'),transaction('new67',{type:'income',amount:986,status:'planned',category_id:'cat_income_main',actual_category_id:'cat_income_main',tags:['new67']})]);await cashflow(d);
	if(action==='type-change')await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("old67")');
	if(action==='bulk-open')await d.click('[data-bulk-id="old67"]');
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,name=${JSON.stringify(action==='editor-open'?'getTransaction':action==='bulk-open'?'getTransactions':'getMasterConfig')},read=db[name];db[name]=async function(...args){db[name]=read;await read.apply(this,args);await new Promise(resolve=>window.__awaitRelease67=resolve);throw new Error('AWAIT_READ_FAULT67');};window.__restoreAwait67=()=>db[name]=read;${action==='type-change'?"const c=app.txEditController,populate=c.populateTypeCategories,restore=window.__restoreAwait67;c.populateTypeCategories=function(...args){const job=populate.apply(this,args);window.__awaitJob67=job.catch(()=>{});return job;};window.__restoreAwait67=()=>{restore();c.populateTypeCategories=populate;};":`window.__awaitJob67=app.${action==='editor-open'?'txEditController.openEditTransactionModal("old67")':'bulkEditController.open()'};`}})()`);
		if(action==='type-change')await d.select('#edit-tx-type','income');
		await d.waitFor('typeof window.__awaitRelease67==="function"');if(expired){await unlockWorkflow(d);await newEditor67(d);}
		const raw=await rawWorkflow(d),before=await editorState67(d);
		await d.evaluate('window.__awaitRelease67();window.__awaitJob67');await Promise.resolve();
		assert.deepEqual(await rawWorkflow(d),raw);
		if(expired)assert.deepEqual(await editorState67(d),before);
		else{const messages=await d.evaluate(`window.__dialogs.slice(${before.dialogs})`);assert.equal(messages.length,1);assert.match(messages[0].message,/AWAIT_READ_FAULT67/);}
	}finally{await restore67(d);}
});
for(const action of ['bulk-save','bulk-delete','single-delete','single-save'])for(const stage of ['commit','refresh'])uiCase67(f,`${action} keeps committed originals and a new editor when its old ${stage} response returns`,async d=>{
	await seed(d,[transaction('old67'),transaction('new67',{type:'income',amount:986,status:'planned',category_id:'cat_income_main',actual_category_id:'cat_income_main',tags:['new67']})]);await cashflow(d);
	if(action.startsWith('bulk')){await d.click('[data-bulk-id="old67"]');if(action==='bulk-save'){await d.click('#btn-bulk-edit');await flushWorkflow(d);await d.click('#bulk-apply-memo');await d.fill('#bulk-value-memo','SAVED_OLD67');}}
	else {await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("old67")');if(action==='single-save')await d.fill('#edit-tx-memo','SAVED_OLD67');}
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,owner=${stage==='refresh'?'app':'app.db'},name=${JSON.stringify(stage==='refresh'?'refreshAfterTransactionChange':({'bulk-save':'bulkEditTransactions','bulk-delete':'bulkDeleteTransactions','single-delete':'putTransaction','single-save':'putTransaction'})[action])},original=owner[name];owner[name]=async function(...args){owner[name]=original;const result=await original.apply(this,args);await new Promise(resolve=>window.__awaitRelease67=resolve);return result;};window.__restoreAwait67=()=>owner[name]=original;window.__awaitJob67=app.${({'bulk-save':'bulkEditController.save()','bulk-delete':'bulkEditController.deleteSelected()','single-delete':'txEditController.handleEditDelete("old67")','single-save':'txEditController.handleEditFormSubmit()'})[action]};})()`);
		await d.waitFor('typeof window.__awaitRelease67==="function"');const atGate=await rawWorkflow(d);
		const saved=(await records(d)).find(tx=>tx.id==='old67');if(action.endsWith('delete'))assert.equal(saved.is_deleted,true);else assert.equal(saved.memo,'SAVED_OLD67');
		await unlockWorkflow(d);await newEditor67(d);const before=await editorState67(d);
		await d.evaluate('window.__awaitRelease67();window.__awaitJob67');assert.deepEqual(await rawWorkflow(d),atGate);assert.deepEqual(await editorState67(d),before);
	}finally{await restore67(d);}
});
uiCase67(f,'reports a committed batch edit even when refreshing its list fails',async d=>{
	await seed(d,[transaction('old67')]);await cashflow(d);await d.click('[data-bulk-id="old67"]');await d.click('#btn-bulk-edit');await flushWorkflow(d);await d.click('#bulk-apply-memo');await d.fill('#bulk-value-memo','COMMITTED_BULK67');
	const before=await d.evaluate('window.__dialogs.length');await d.evaluate(`(()=>{const app=window.__yose_app,refresh=app.refreshAfterTransactionChange;app.refreshAfterTransactionChange=async()=>{throw new Error('BULK_DISPLAY_FAULT67');};window.__restores67.push(()=>app.refreshAfterTransactionChange=refresh);})()`);
	await d.click('#btn-save-bulk');await flushWorkflow(d);assert.equal((await records(d))[0].memo,'COMMITTED_BULK67');
	const messages=await d.evaluate(`window.__dialogs.slice(${before})`);assert.equal(messages.length,1);assert.match(messages[0].message,/保存済み.*BULK_DISPLAY_FAULT67/);assert.equal(await d.isVisible('#modal-bulk-edit'),false);
});
for(const stage of ['delete-read','save-refresh-reject'])uiCase67(f,`cancels old batch ${stage} without touching the newly authenticated editor`,async d=>{
	await seed(d,[transaction('old67'),transaction('new67',{type:'income',amount:986,status:'planned',category_id:'cat_income_main',actual_category_id:'cat_income_main',tags:['new67']})]);await cashflow(d);await d.click('[data-bulk-id="old67"]');
	if(stage==='save-refresh-reject'){await d.click('#btn-bulk-edit');await flushWorkflow(d);await d.click('#bulk-apply-memo');await d.fill('#bulk-value-memo','SAVED_BEFORE_FAILURE67');}
	try{
		await d.evaluate(`(()=>{const app=window.__yose_app,owner=${stage==='delete-read'?'app.db':'app'},name=${JSON.stringify(stage==='delete-read'?'getTransactions':'refreshAfterTransactionChange')},read=owner[name];owner[name]=async function(...args){owner[name]=read;const result=${stage==='delete-read'?'await read.apply(this,args)':'undefined'};await new Promise(resolve=>window.__awaitRelease67=resolve);${stage==='delete-read'?'return result;':"throw new Error('OLD_REFRESH_FAILURE67');"}};window.__restoreAwait67=()=>owner[name]=read;window.__awaitJob67=app.bulkEditController.${stage==='delete-read'?'deleteSelected()':'save()'};})()`);
		await d.waitFor('typeof window.__awaitRelease67==="function"');await unlockWorkflow(d);await newEditor67(d);const raw=await rawWorkflow(d),state=await editorState67(d);
		await d.evaluate('window.__awaitRelease67();window.__awaitJob67');assert.deepEqual(await rawWorkflow(d),raw);assert.deepEqual(await editorState67(d),state);
		assert.equal((await records(d)).find(t=>t.id==='old67').memo,stage==='delete-read'?'old67':'SAVED_BEFORE_FAILURE67');
	}finally{await restore67(d);}
});
