import { it } from 'node:test';
import assert from 'node:assert/strict';
import { settings } from './ui_fixture.js';
import { observeWorkflow, flushWorkflow, cleanupWorkflow } from './workflow_ui_fixture.js';

export function uiCase67(fixture, name, run) {
	it(name, async () => {
		const d = fixture.driver; await observeWorkflow(d);
		await d.evaluate(`(()=>{
			const app=window.__yose_app;window.__restores67=[];
			const watch=(owner,name)=>{const original=owner[name];owner[name]=function(...args){const promise=original.apply(this,args);if(promise&&typeof promise.then==='function'){const job={name,promise,settled:false};window.__workflowJobs.push(job);promise.then(()=>job.settled=true,()=>job.settled=true);}return promise;};window.__restores67.push(()=>owner[name]=original);};
			for(const owner of [app.authController,app.masterController])for(const name of Object.getOwnPropertyNames(Object.getPrototypeOf(owner)))if(name!=='constructor'&&typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(owner),name)?.value==='function')watch(owner,name);
			for(const name of ['refreshAllViews','refreshAfterTransactionChange','scheduleTransactionMaintenance','finishAppInit'])watch(app,name);
		})()`);
		try { await run(d); }
		finally {
			try { await cleanupWorkflow(d); }
			finally { await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
		}
	});
}

export async function settings67(d, master = null) {
	await settings(d); await flushWorkflow(d);
	await d.waitFor('!window.__yose_app.budgetSettingsController.loading&&!window.__yose_app.budgetSettingsController.saving&&Boolean(window.__yose_app.budgetSettingsController.draft)');
	if (master) await d.click(`.master-tab-btn[data-master="${master}"]`);
}

export async function failNextWrite67(d, store = null) {
	await d.evaluate(`(()=>{
		const database=window.__yose_app.db.db,transaction=database.transaction;let once=true;window.__failedWrite67=false;
		database.transaction=function(names,mode,...args){const pending=transaction.call(this,names,mode,...args);if(once&&mode==='readwrite'&&(${JSON.stringify(store)}===null||Array.from(typeof names==='string'?[names]:names).includes(${JSON.stringify(store)}))){once=false;window.__failedWrite67=true;queueMicrotask(()=>pending.abort());}return pending;};
		window.__restores67.push(()=>database.transaction=transaction);
	})()`);
}

export async function assertFailedWrite67(d, before) {
	await flushWorkflow(d);
	assert.equal(await d.evaluate('window.__failedWrite67'), true, 'the real IndexedDB write must actually abort');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'), before);
}

export async function observeExpectedDialog67(d, action, pattern) {
	const before = await d.evaluate('window.__dialogs.length'); await action(); await flushWorkflow(d);
	await d.waitFor(`window.__dialogs.length>${before}`);
	assert.match((await d.evaluate(`window.__dialogs.slice(${before})`)).map(dialog => dialog.message).join('\n'), pattern);
}

// Delegate to the actual registered async listener and retain its returned Promise.
export async function observeNativeEvent67(d, selector, type = 'click') {
	const target = await d.send('Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})`, returnByValue: false, objectGroup: 'master-session67' }, d.sessionId);
	const events = await d.send('DOMDebugger.getEventListeners', { objectId: target.result.objectId }, d.sessionId);
	const listeners = events.listeners.filter(listener => listener.type === type);
	assert.equal(listeners.length, 1, `Expected one real ${type} listener on ${selector}`);
	const listener = listeners[0];
	await d.send('Runtime.callFunctionOn', { objectId: (listener.originalHandler || listener.handler).objectId, functionDeclaration: 'function(){window.__masterNativeOriginal67=this;}' }, d.sessionId);
	await d.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)}),original=window.__masterNativeOriginal67,capture=${listener.useCapture};window.__masterNativeJobs67=[];const observe=function(...args){const pending=original.apply(this,args);window.__masterNativeJobs67.push(pending);return pending;};element.removeEventListener(${JSON.stringify(type)},original,capture);element.addEventListener(${JSON.stringify(type)},observe,capture);window.__restores67.push(()=>{element.removeEventListener(${JSON.stringify(type)},observe,capture);element.addEventListener(${JSON.stringify(type)},original,capture);});})()`);
}
