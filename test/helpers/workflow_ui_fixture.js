import assert from 'node:assert/strict';

// Observe the real asynchronous entry points without replacing their behavior.
export async function observeWorkflow(d) {
	await d.evaluate(`(() => {
		const app=window.__yose_app, restores=[];
		window.__workflowJobs=[];window.__workflowGates=[];window.__workflowGateRestores=[];window.__workflowNotices=[];
		const toast=app.showToast;app.showToast=function(message,...args){window.__workflowNotices.push(String(message));return toast.call(this,message,...args);};restores.push(()=>app.showToast=toast);
		const observe=(object,name)=>{
			const original=object[name];if(typeof original!=='function')return;
			object[name]=function(...args){const result=original.apply(this,args);if(result&&typeof result.then==='function'){const job={name,promise:result,settled:false};window.__workflowJobs.push(job);result.then(()=>job.settled=true,()=>job.settled=true);}return result;};
			restores.push(()=>object[name]=original);
		};
		for(const object of [app.txInputController,app.txEditController,app.txListController,app.bulkEditController,app.settingsController,app.syncStatusController]){
			for(const name of Object.getOwnPropertyNames(Object.getPrototypeOf(object)))if(name!=='constructor'&&typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(object),name)?.value==='function')observe(object,name);
			if(Object.hasOwn(object,'handleMemoChange'))observe(object,'handleMemoChange');
		}
		for(const name of ['putTransactions','putTransaction','bulkEditTransactions','bulkDeleteTransactions','confirmPlannedTransaction','mutateMasterConfig','saveMasterConfig'])observe(app.db,name);
		window.__restoreWorkflow=()=>{for(const restore of restores.reverse())restore();};
	})()`);
}

export async function flushWorkflow(d) {
	await d.evaluate(`(async()=>{let count=-1;while(count!==window.__workflowJobs.length){count=window.__workflowJobs.length;await Promise.allSettled(window.__workflowJobs.map(job=>job.promise));}})()`);
}

export async function cleanupWorkflow(d) {
	await d.evaluate('window.__workflowGates?.forEach(gate=>gate.release?.())');
	try { await flushWorkflow(d); }
	finally { await d.evaluate('window.__workflowGateRestores?.reverse().forEach(restore=>restore());window.__restoreWorkflow?.()'); }
}

export async function requireControl(d, selector) {
	assert.equal(await d.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), true, `Required workflow control is absent: ${selector}`);
}

// Gate one read/write before its original implementation and restore it afterward.
export async function gateMethod(d, objectPath, method, { reject = false, repeat = false, afterRead = false } = {}) {
	assert.equal(await d.evaluate(`typeof ${objectPath}[${JSON.stringify(method)}]`), 'function', `Required API is absent: ${method}`);
	await d.evaluate(`(() => {
		const object=${objectPath},name=${JSON.stringify(method)},original=object[name];let count=0;
		window.__restoreGate=()=>object[name]=original;window.__workflowGateRestores.push(window.__restoreGate);
		object[name]=async function(...args){
			const result=${afterRead} ? await original.apply(this,args) : undefined;
			const index=count++;if(${repeat}||index===0){const gate={args,index,release:null};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);${reject ? "throw new Error('WORKFLOW_WRITE_FAILURE');" : ''}}
			return ${afterRead} ? result : original.apply(this,args);
		};
	})()`);
}

export async function waitGate(d, count = 1) {
	await d.waitFor(`window.__workflowGates.length>=${count}&&typeof window.__workflowGates[${count - 1}].release==='function'`);
}

export async function releaseGate(d, index = 0) {
	await d.evaluate(`window.__workflowGates[${index}].release()`);
}

export const rawWorkflow = d => d.evaluate('window.__yose_app.db.captureImportState()');

export async function unlockWorkflow(d) {
	await d.evaluate(`(()=>{const app=window.__yose_app,finish=app.finishAppInit;window.__unlockInit=null;app.finishAppInit=function(...args){const result=finish.apply(this,args);window.__unlockInit=result;return result;};window.__restoreUnlock=()=>app.finishAppInit=finish;})()`);
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
	await d.waitFor('!window.__yose_app.isKeyLocked&&Boolean(window.__unlockInit)');
	try { await d.evaluate('window.__unlockInit'); }
	finally { await d.evaluate('window.__restoreUnlock()'); }
}
