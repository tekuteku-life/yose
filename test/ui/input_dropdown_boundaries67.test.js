import assert from 'node:assert/strict';
import {useBrowser} from '../helpers/ui_fixture.js';
import {uiCase67} from '../helpers/ui_workflows67.js';
import {unlockWorkflow,rawWorkflow} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
for(const stage of ['categories','suggestions','unsettled','accounting-detail'])uiCase67(f,`preserves a new registration after an old dropdown ${stage} response`,async d=>{
	try{
		await d.evaluate(`(()=>{const c=window.__yose_app.txInputController,name=${JSON.stringify(({categories:'populateCategoryDropdowns',suggestions:'updateTagAndMemoSuggestions',unsettled:'renderUnsettledAdvanceList','accounting-detail':'updateSubcategories'})[stage])},read=c[name];c[name]=async function(...args){c[name]=read;const result=await read.apply(this,args);await new Promise(resolve=>window.__dropdownRelease67=resolve);return result;};window.__restoreDropdown67=()=>c[name]=read;window.__dropdownJob67=c.${stage==='accounting-detail'?'populateCategoryDropdowns("expense")':'populateMasterDropdowns()'};})()`);
		await d.waitFor('typeof window.__dropdownRelease67==="function"');await unlockWorkflow(d);
		const transition=await d.evaluate('window.__workflowJobs.length');await d.select('#input-type','income');assert.ok(await d.evaluate(`window.__workflowJobs.slice(${transition}).some(j=>j.name==='switchInputMode')`));await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${transition}).filter(j=>j.name==='switchInputMode').map(j=>j.promise))`);
		await d.waitFor('document.querySelector("#select-category").value==="cat_income_main"');await d.select('#select-account','acc_bank_main');await d.fill('#input-memo','NEW_DROPDOWN67');
		const raw=await rawWorkflow(d),state=await d.evaluate('(async()=>({form:(await import("./js/ui/form_busy.js")).captureFormValues(document.querySelector("#tx-form")),tags:window.__yose_app.txInputController.confirmedTags,dialogs:window.__dialogs.length,point:document.querySelector("#point-offset-notice").textContent}))()');
		await d.evaluate('window.__dropdownRelease67();window.__dropdownJob67');assert.deepEqual(await rawWorkflow(d),raw);assert.deepEqual(await d.evaluate('(async()=>({form:(await import("./js/ui/form_busy.js")).captureFormValues(document.querySelector("#tx-form")),tags:window.__yose_app.txInputController.confirmedTags,dialogs:window.__dialogs.length,point:document.querySelector("#point-offset-notice").textContent}))()'),state);
	}finally{await d.evaluate('(async()=>{try{window.__dropdownRelease67?.();await window.__dropdownJob67;}finally{window.__restoreDropdown67?.();}})()');}
});
