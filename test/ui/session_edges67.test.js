import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow, value } from '../helpers/ui_fixture.js';
import { flushWorkflow, rawWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
uiCase67(fixture, 'keeps the real locked session unchanged when exposed controller entry points are called directly', async d => {
	await seed(d, [transaction('guarded67')]); await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await flushWorkflow(d);
	const before = await rawWorkflow(d), fields = await d.evaluate('[...document.querySelectorAll("#tx-form input,#tx-form select")].map(input=>[input.id,input.value])');
	await d.evaluate(`(async()=>{
		const app=window.__yose_app,read=app.db.getMasterConfig;window.__lockedReads67=0;app.db.getMasterConfig=function(...args){window.__lockedReads67++;return read.apply(this,args)};window.__restores67.push(()=>app.db.getMasterConfig=read);
		for(const [owner,name,args] of [
			[app.txInputController,'populateMasterDropdowns',[]],[app.txInputController,'populateCategoryDropdowns',['expense']],[app.txInputController,'updateSubcategories',['cat_food','select-subcategory']],[app.txInputController,'updateTagAndMemoSuggestions',[]],[app.txInputController,'renderUnsettledAdvanceList',[]],[app.txInputController,'switchInputMode',['point']],[app.txInputController,'handleFormSubmit',[]],
			[app.txEditController,'populateTypeCategories',['expense']],[app.txEditController,'handleEditFormSubmit',[]],[app.txEditController,'handleEditDelete',['guarded67']],[app.txEditController,'openEditTransactionModal',['guarded67']],
			[app.txListController,'renderMonthTransactions',[]],[app.txListController,'renderRecentTransactions',[]],
			[app.settingsController,'renderSettings',[]],[app.settingsController,'renderPendingImport',[]],[app.settingsController,'savePointDefaults',[]],[app.settingsController,'reloadPointDefaults',[]],
			[app.masterController,'renderMasterManagement',[]],[app.masterController,'openMasterModal',['account',null]],
			[app.bulkEditController,'open',[]],[app.bulkEditController,'save',[]],[app.bulkEditController,'deleteSelected',[]]
		])await owner[name](...args);
	})()`);
	assert.equal(await d.evaluate('window.__lockedReads67'), 0); assert.deepEqual(await rawWorkflow(d), before);
	assert.deepEqual(await d.evaluate('[...document.querySelectorAll("#tx-form input,#tx-form select")].map(input=>[input.id,input.value])'), fields);
	assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'), false); assert.equal(await d.isVisible('#modal-edit-tx'), false); assert.equal(await d.isVisible('#modal-master-item'), false);
});

const entries = { input: 'handleFormSubmit', edit: 'handleEditFormSubmit', delete: 'handleEditDelete', 'bulk-delete': 'deleteSelected', confirm: 'confirmTransaction', 'point-defaults': 'savePointDefaults' };
for (const action of Object.keys(entries)) uiCase67(fixture, `silences an expired committed ${action} refresh failure after actual PIN unlock opens a new editor`, async d => {
	await seed(d, [transaction('old67', { status: action === 'confirm' ? 'planned' : 'confirmed' }), transaction('new67', { sync_status: 'synced' })]);
	if (action === 'edit' || action === 'delete') {
		await cashflow(d); await d.click('#month-tx-list .tx-item[data-id="old67"]'); await flushWorkflow(d); await d.fill('#edit-tx-memo', 'OLD_SAVED67');
	} else if (action === 'bulk-delete' || action === 'confirm') await cashflow(d);
	else if (action === 'point-defaults') { await settings67(d); await d.select('#select-point-offset-category', 'cat_income_main'); }
	if (action === 'input') { await d.fill('#input-amount', '123'); await d.fill('#input-memo', 'OLD_SAVED67'); }
	if (action === 'bulk-delete') await d.click('#month-tx-list [data-bulk-id="old67"]');
	await d.evaluate('(()=>{const app=window.__yose_app,refresh=app.refreshAfterTransactionChange;app.refreshAfterTransactionChange=async()=>{await new Promise(resolve=>window.__expiredRefreshRelease67=resolve);throw new Error("EXPIRED_VIEW_FAULT67")};window.__restores67.push(()=>app.refreshAfterTransactionChange=refresh);})()');
	const selectors = { input: '#btn-save-tx', edit: '#edit-tx-form button[type=submit]', delete: '#btn-edit-delete-tx', 'bulk-delete': '#btn-bulk-delete', confirm: '.btn-confirm-tx[data-id="old67"]', 'point-defaults': '#btn-save-point-defaults' };
	try {
		await d.click(selectors[action]); await d.waitFor('typeof window.__expiredRefreshRelease67==="function"');
		await d.evaluate(`void(window.__expiredOperation67=window.__workflowJobs.find(job=>job.name===${JSON.stringify(entries[action])}).promise)`);
		await unlockWorkflow(d); await cashflow(d); await d.click('#month-tx-list .tx-item[data-id="new67"]'); await flushWorkflowNewOnly(d);
		await d.fill('#edit-tx-memo', 'NEW_PIN_DRAFT67'); const expected = await d.evaluate('window.__yose_app.txEditController.captureValues()'), before = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		await d.evaluate('window.__expiredRefreshRelease67()'); await d.evaluate('window.__expiredOperation67'); await flushWorkflow(d);
		assert.equal(await d.evaluate('document.querySelector("#modal-edit-tx").classList.contains("active")'), true); assert.equal(await value(d, '#edit-tx-id'), 'new67'); assert.equal(await d.evaluate('window.__yose_app.txEditController.captureValues()'), expected);
		assert.deepEqual(await rawWorkflow(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__expiredRefreshRelease67?.()'); }
});
async function flushWorkflowNewOnly(d) {
	await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-id").value==="new67"');
	// The old save intentionally remains pending; await the new editor's real operation only.
	await d.evaluate('window.__workflowJobs.filter(job=>job.name==="openEditTransactionModal").at(-1).promise');
}
