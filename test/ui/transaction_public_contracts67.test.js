import assert from 'node:assert/strict';
import {useBrowser,seed,seedLegacy,transaction,cashflow,records} from '../helpers/ui_fixture.js';
import {uiCase67} from '../helpers/ui_workflows67.js';
import {flushWorkflow,rawWorkflow,gateMethod,waitGate,releaseGate} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
uiCase67(f,'uses the list public defaults and preserves accepted blank tags and legacy transaction labels',async d=>{
	await d.evaluate('window.__yose_app.txListController.populateFilterDropdowns()');
	for(const name of ['account','category','tag'])assert.equal(await d.evaluate(`document.querySelector('#select-${name}-filter').value`),'all');
	assert.equal(await d.evaluate('document.querySelectorAll("#select-category-filter option").length'),2);
	const legacy=transaction('legacy-label67',{type:'advance_payment',tags:['','   ','kept']});
	const html=await d.evaluate(`window.__yose_app.txListController.renderTransactionItemHtml(${JSON.stringify(legacy)}, {})`);
	assert.match(html,/advance_payment/);assert.doesNotMatch(html,/btn-delete-tx|data-bulk-id/);
	await d.evaluate(`window.__yose_app.txListController.populateFilterDropdowns([${JSON.stringify(legacy)},${JSON.stringify(transaction('deleted67',{is_deleted:true,tags:['deleted']}))}],{})`);
	assert.deepEqual(await d.evaluate('[...document.querySelectorAll("#select-tag-filter option")].map(o=>o.value)'),['all','kept']);
});
uiCase67(f,'keeps current classification when the public category refresh is repeated and accepts omitted optional targets',async d=>{
	await d.evaluate('window.__yose_app.txInputController.populateCategoryDropdowns()');
	assert.equal(await d.evaluate('document.querySelector("#select-category").value'),'cat_food');
	const before=await rawWorkflow(d),html=await d.evaluate('document.querySelector("#tx-form").innerHTML');
	await d.evaluate('window.__yose_app.txInputController.replaceOptionsKeepingSelection(null,"unused");window.__yose_app.updateSubcategories("cat_food","missing-optional-target67")');
	assert.equal(await d.evaluate('document.querySelector("#tx-form").innerHTML'),html);assert.deepEqual(await rawWorkflow(d),before);
});
uiCase67(f,'shows empty registration choices for an accepted old master without account or category collections',async d=>{
	await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({schema_version:2,last_closed_month:null,account_balances:{},monthly_summaries:{}});await db.saveMasterConfig({schema_version:2});})()');const before=await rawWorkflow(d);
	await d.evaluate('window.__yose_app.txInputController.populateMasterDropdowns()');
	for(const selector of ['#select-account','#select-category','#select-actual-category'])assert.equal(await d.evaluate(`(()=>{const s=document.querySelector(${JSON.stringify(selector)});return s.options.length===1&&s.selectedOptions[0].disabled&&s.selectedOptions[0].hasAttribute('data-unavailable');})()`),true);
	await d.evaluate('window.__yose_app.txInputController.populateCategoryDropdowns("expense",{keepUnavailable:false})');
	for(const selector of ['#select-category','#select-actual-category'])assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(selector)}).options.length`),0);
	assert.equal(await d.evaluate('document.querySelector("#select-point-account").options.length'),1);
	assert.deepEqual(await rawWorkflow(d),before);
});
uiCase67(f,'keeps the calculator expression nonempty through default opening, clearing and single-character backspace',async d=>{
	await d.evaluate('window.__yose_app.txInputController.openCalculatorFor()');
	assert.equal(await d.textContent('#calc-expr-display'),'0');
	await d.click('[data-calc-insert="1"]');await d.click('[data-calc-action="backspace"]');assert.equal(await d.textContent('#calc-expr-display'),'0');
	await d.click('[data-calc-insert="2"]');await d.click('[data-calc-insert="+"]');await d.click('[data-calc-insert="3"]');await d.click('[data-calc-action="equals"]');assert.equal(await d.textContent('#calc-result-display'),'¥5');
	await d.click('[data-calc-action="clear"]');assert.equal(await d.textContent('#calc-expr-display'),'0');await d.click('#btn-apply-tax');assert.equal(await d.evaluate('document.querySelector("#input-amount").value'),'0');
});
uiCase67(f,'explicitly clears classifications and tags in a batch of accepted records with omitted old tags',async d=>{
	const legacy=transaction('bulk-old67');delete legacy.tags;
	const other=transaction('bulk-other67',{amount:200});delete other.tags;
	await seedLegacy(d,[legacy,other]);await cashflow(d);
	await d.click('#btn-bulk-select-page');await d.click('#btn-bulk-edit');await flushWorkflow(d);
	await d.waitFor('document.querySelector("#modal-bulk-edit").classList.contains("active")');
	for(const field of ['category_id','actual_category_id','tags']){await d.click(`#bulk-apply-${field}`);if(field!=='tags')await d.select(`#bulk-value-${field}`,'');else await d.fill('#bulk-value-tags','');}
	await d.click('#btn-save-bulk');await flushWorkflow(d);
	for(const tx of await records(d)){assert.equal(tx.category_id,null);assert.equal(tx.actual_category_id,null);assert.deepEqual(tx.tags,[]);}
});
uiCase67(f,'rejects public batch reentry and selection release while a genuine deletion owns the form',async d=>{
	await seed(d,[transaction('bulk-busy67')]);await cashflow(d);await d.click('[data-bulk-id="bulk-busy67"]');
	await gateMethod(d,'window.__yose_app.db','bulkDeleteTransactions');await d.click('#btn-bulk-delete');await waitGate(d);
	const state=await d.evaluate('({selected:[...window.__yose_app.bulkEditController.selectedIds],busy:window.__yose_app.bulkEditController.busy,dialogs:window.__dialogs.length})');
	await d.evaluate('(async()=>{const c=window.__yose_app.bulkEditController;c.clearSelection();await c.open();await c.save();await c.deleteSelected();})()');
	assert.deepEqual(await d.evaluate('({selected:[...window.__yose_app.bulkEditController.selectedIds],busy:window.__yose_app.bulkEditController.busy,dialogs:window.__dialogs.length})'),state);
	assert.equal(await d.evaluate('window.__workflowGates.length'),1);await releaseGate(d);await flushWorkflow(d);assert.equal((await records(d))[0].is_deleted,true);
});
uiCase67(f,'renders genuine in-flight confirmation and batch ownership without enabling a second action',async d=>{
	const original=transaction('planned-busy67',{status:'planned'});await seed(d,[original]);await cashflow(d);
	await gateMethod(d,'window.__yose_app.db','confirmPlannedTransaction');await d.click('.btn-confirm-tx[data-id="planned-busy67"]');await waitGate(d);
	const raw=await rawWorkflow(d);await d.evaluate(`(async()=>{const c=window.__yose_app.txListController;await c.confirmTransaction(null);await c.confirmTransaction(${JSON.stringify(original)});await c.confirmTransaction({...${JSON.stringify(original)},id:'absent-button67'});})()`);
	assert.deepEqual(await rawWorkflow(d),raw);assert.equal(await d.evaluate('window.__workflowGates.length'),1);
	const html=await d.evaluate(`(async()=>window.__yose_app.txListController.renderTransactionItemHtml(${JSON.stringify(original)},await window.__yose_app.db.getMasterConfig(),true))()`);
	assert.match(html,/aria-busy="true"/);assert.match(html,/確定中/);assert.match(html,/disabled/);await releaseGate(d);await flushWorkflow(d);assert.equal((await records(d))[0].status,'confirmed');
});
uiCase67(f,'keeps pagination unchanged for invalid public requests and does not scroll hidden list panels',async d=>{
	await seed(d,Array.from({length:31},(_,i)=>transaction(`page-edge67-${i}`)));await cashflow(d);
	for(const page of [0,-1,1,3,1.5,NaN])await d.evaluate(`window.__yose_app.txListController.goToPage(${Number.isNaN(page)?'NaN':page})`);
	assert.equal(await d.evaluate('window.__yose_app.txListController.currentPage'),1);
	await d.click('[data-tab="tab-settings"]');await flushWorkflow(d);
	const scrollBefore=await d.evaluate(`(()=>{const original=Element.prototype.scrollIntoView;window.__pageScroll67=0;Element.prototype.scrollIntoView=function(...args){window.__pageScroll67++;return original.apply(this,args);};window.__restores67.push(()=>Element.prototype.scrollIntoView=original);return window.scrollY;})()`);
	await d.evaluate('window.__yose_app.txListController.goToPage(2)');
	assert.equal(await d.evaluate('window.__pageScroll67'),0);assert.equal(await d.evaluate('window.scrollY'),scrollBefore);
	assert.equal(await d.evaluate('window.__yose_app.txListController.currentPage'),2);assert.equal(await d.evaluate('document.querySelectorAll("#month-tx-list .tx-item").length'),1);
});
