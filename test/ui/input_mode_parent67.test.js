import {it} from 'node:test';
import assert from 'node:assert/strict';
import {useBrowser} from '../helpers/ui_fixture.js';
import {observeNativeEvent67} from '../helpers/ui_workflows67.js';
import {observeWorkflow,cleanupWorkflow} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
it('does not cancel a native income-mode change when a later request has an already invalid parent',async()=>{
	const d=f.driver;await observeWorkflow(d);await d.evaluate('window.__restores67=[]');
	try{
		await observeNativeEvent67(d,'#input-type','change');
		await d.evaluate(`(()=>{const db=window.__yose_app.db,read=db.getMasterConfig;db.getMasterConfig=async function(...args){db.getMasterConfig=read;const result=await read.apply(this,args);await new Promise(resolve=>window.__modeRelease67=resolve);return result;};window.__restoreMode67=()=>db.getMasterConfig=read;})()`);
		const raw=await d.evaluate('window.__yose_app.db.captureImportState()');await d.select('#input-type','income');await d.waitFor('typeof window.__modeRelease67==="function"');
		assert.equal(await d.evaluate('window.__yose_app.txInputController.switchInputMode("prepaid",{isSessionValid:()=>false})'),false);
		await d.evaluate('window.__modeRelease67();Promise.all(window.__masterNativeJobs67)');
		assert.equal(await d.evaluate('document.querySelector("#input-type").value'),'income');assert.equal(await d.evaluate('window.__yose_app.currentMode'),'normal');assert.equal(await d.evaluate('document.querySelector("#select-category").value'),'cat_income_main');assert.equal(await d.isVisible('#prepaid-fields'),false);assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
	}finally{
		await d.evaluate('window.__modeRelease67?.()');await cleanupWorkflow(d);await d.evaluate('window.__restoreMode67?.();window.__restores67.reverse().forEach(fn=>fn())');
	}
});
