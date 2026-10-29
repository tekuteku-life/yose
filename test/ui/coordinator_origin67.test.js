import assert from 'node:assert/strict';
import { useBrowser, value, seed, transaction, cashflow } from '../helpers/ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
import { gateMethod, waitGate, releaseGate, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
import { holdNativeKeyRegeneration67, finishNativeKeyRegeneration67 } from '../helpers/auth_epoch67.js';
const fixture = useBrowser();
const raw = d => d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');

for (const phase of ['gas', 'theme', 'panes']) uiCase67(fixture, `keeps the newer initialized manager, theme, panes and draft after an old ${phase} read returns`, async d => {
	await settings67(d);
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>({...c,theme:"system",collapsed_panes:{...c.collapsed_panes,"card-theme-setting":false}}))');
	if (phase === 'gas') await gateMethod(d, 'window.__yose_app.db', 'getSetting', { afterRead: true });
	else await d.evaluate(`(()=>{
		const app=window.__yose_app,name=${JSON.stringify(phase === 'theme' ? 'initTheme' : 'applyCollapsedPanesState')},entry=app[name],read=app.db.getMasterConfig;let armed=false,once=true;
		app[name]=function(...args){armed=true;try{return entry.apply(this,args);}finally{armed=false;}};
		app.db.getMasterConfig=async function(...args){const hold=armed&&once;if(hold)once=false;const result=await read.apply(this,args);if(hold){const gate={release:null};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);}return result;};
		window.__restores67.push(()=>{app[name]=entry;app.db.getMasterConfig=read;});
	})()`);
	try {
		await d.evaluate('void(window.__oldFinish67=window.__yose_app.finishAppInit())'); await waitGate(d);
		await unlockWorkflow(d);
		const start = await d.evaluate('window.__workflowJobs.length'); await d.click('[data-tab="tab-settings"]');
		await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`);
		await observeNativeEvent67(d, '#btn-save-gas-url'); await d.fill('#input-gas-url', 'https://new-init67.example/exec'); await d.click('#btn-save-gas-url'); await d.evaluate('window.__masterNativeJobs67[0]');
		await d.click('#theme-radio-dark'); await d.evaluate('window.__yose_app.pendingDisplaySettings');
		await d.click('#card-theme-setting .card-collapse-title'); await d.evaluate('window.__yose_app.pendingDisplaySettings');
		await d.click('[data-tab="tab-input"]'); await d.fill('#input-amount', '2468'); await d.fill('#input-memo', 'new initialization draft');
		await d.evaluate('void(window.__expectedManager67=window.__yose_app.syncManager)');
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__oldFinish67');
		assert.equal(await d.evaluate('window.__yose_app.syncManager===window.__expectedManager67'), true);
		assert.equal(await d.evaluate('window.__yose_app.syncManager.gasUrl'), 'https://new-init67.example/exec');
		assert.equal(await d.evaluate('window.__yose_app.currentThemePreference'), 'dark');
		assert.equal(await d.evaluate('localStorage.getItem("yose_theme_preference")'), 'dark');
		assert.equal(await d.evaluate('document.querySelector("#card-theme-setting").classList.contains("collapsed")'), true);
		assert.equal(await d.evaluate('document.querySelector("#card-theme-setting .card-collapse-title").getAttribute("aria-expanded")'), 'false');
		assert.equal(await value(d, '#input-amount'), '2468'); assert.equal(await value(d, '#input-memo'), 'new initialization draft');
		assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__oldFinish67])'); }
});

uiCase67(fixture, 'passes the captured manual synchronization predicate to the real manager before a new native authentication intent', async d => {
	await settings67(d);
	await d.evaluate(`(()=>{const manager=window.__yose_app.syncManager,original=manager.syncBidirectional;manager.syncBidirectional=async function(options){window.__manualOptions67=options;await new Promise(resolve=>window.__manualRelease67=resolve);return original.call(this,options);};window.__restores67.push(()=>manager.syncBidirectional=original);})()`);
	await observeNativeEvent67(d, '#btn-manual-sync');
	try {
		await d.click('#btn-manual-sync'); await d.waitFor('typeof window.__manualRelease67==="function"');
		const hadParent = await d.evaluate('typeof window.__manualOptions67.isSessionValid==="function"');
		const startedValid = await d.evaluate('window.__manualOptions67.isSessionValid?.()');
		await holdNativeKeyRegeneration67(d);
		const expired = await d.evaluate('window.__manualOptions67.isSessionValid?.()===false');
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await d.evaluate('window.__manualRelease67()'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(hadParent, true); assert.equal(startedValid, true); assert.equal(expired, true);
		assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__manualRelease67?.()'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await finishNativeKeyRegeneration67(d); }
});

for (const committed of [false, true]) uiCase67(fixture, `keeps a ${committed ? 'committed pane update and silences its old failure' : 'queued pane update uncommitted'} after native authentication changes`, async d => {
	await settings67(d);
	await d.evaluate('window.__yose_app.setPaneCollapsed("card-theme-setting",false)');
	await gateMethod(d, 'window.__yose_app.db', 'mutateMasterConfig', { afterRead: committed, reject: committed });
	await d.evaluate('(()=>{const app=window.__yose_app,original=app.setPaneCollapsed;app.setPaneCollapsed=function(...args){return window.__oldPane67=original.apply(this,args);};window.__restores67.push(()=>app.setPaneCollapsed=original);})()');
	try {
		await d.click('#card-theme-setting .card-collapse-title'); await waitGate(d);
		await holdNativeKeyRegeneration67(d);
		const before = await raw(d), notices = await d.evaluate('window.__workflowNotices.length');
		await releaseGate(d); await d.evaluate('window.__oldPane67');
		assert.deepEqual(await raw(d), before);
		assert.deepEqual(await d.evaluate(`window.__workflowNotices.slice(${notices})`), []);
		assert.equal(await d.evaluate('document.querySelector("#card-theme-setting").classList.contains("collapsed")'), true);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__oldPane67])'); await finishNativeKeyRegeneration67(d); }
});

uiCase67(fixture, 'ignores an already expired pane parent before changing DOM or queuing persistence', async d => {
	await settings67(d); const before = await raw(d);
	const collapsed = await d.evaluate('document.querySelector("#card-theme-setting").classList.contains("collapsed")');
	await d.evaluate(`window.__yose_app.setPaneCollapsed("card-theme-setting",${!collapsed},{isSessionValid:()=>false})`);
	assert.equal(await d.evaluate('document.querySelector("#card-theme-setting").classList.contains("collapsed")'), collapsed);
	assert.deepEqual(await raw(d), before);
});

uiCase67(fixture, 'does not display the old startup version response after a newer PIN session is ready', async d => {
	await d.evaluate(`(()=>{const fetch=window.fetch;let once=true;window.fetch=async function(url,options){const result=await fetch.apply(this,arguments);if(once&&String(url).includes('version.json')){once=false;await new Promise(resolve=>window.__oldVersionRelease67=resolve);return new Response(JSON.stringify({version:'99.9.9'}),{status:200,headers:{'Content-Type':'application/json'}});}return result;};window.__restores67.push(()=>window.fetch=fetch);})()`);
	try {
		await d.evaluate('void(window.__oldVersion67=window.__yose_app.checkStartupUpdate())'); await d.waitFor('typeof window.__oldVersionRelease67==="function"');
		await unlockWorkflow(d); const before = await raw(d);
		await d.evaluate('window.__oldVersionRelease67();window.__oldVersion67');
		assert.equal(await d.isVisible('#modal-app-update'), false); assert.equal(await d.evaluate('window.__yose_app.availableUpdateVersion'), null);
		assert.deepEqual(await raw(d), before);
	} finally { await d.evaluate('window.__oldVersionRelease67?.()'); await d.evaluate('Promise.allSettled([window.__oldVersion67])'); }
});

uiCase67(fixture, 'does not prompt for an obsolete closed-month approval after its real snapshot read returns', async d => {
	await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({...await db.getSnapshot(),last_closed_month:"2026-10"});})()');
	await gateMethod(d, 'window.__yose_app.db', 'getSnapshot', { afterRead: true });
	try {
		await d.evaluate('void(window.__oldApproval67=window.__yose_app.approveClosedChanges([{target_month:"2026-10",status:"confirmed",amount_pending:false}]))'); await waitGate(d);
		await unlockWorkflow(d); const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); const approved = await d.evaluate('window.__oldApproval67');
		assert.equal(approved, null); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []); assert.deepEqual(await raw(d), before);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__oldApproval67])'); }
});

for (const initiallyExpired of [true, false]) uiCase67(fixture, `cancels a closed-month approval with only its parent ${initiallyExpired ? 'already false before reading' : 'expiring during the real snapshot read'}`, async d => {
	await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({...await db.getSnapshot(),last_closed_month:"2026-10"});})()');
	await d.evaluate(`window.__approvalParent67=${!initiallyExpired};window.__approvalReads67=0;(()=>{const db=window.__yose_app.db,read=db.getSnapshot;db.getSnapshot=function(...args){window.__approvalReads67++;return read.apply(this,args);};window.__restores67.push(()=>db.getSnapshot=read);})()`);
	if (!initiallyExpired) await gateMethod(d, 'window.__yose_app.db', 'getSnapshot', { afterRead: true });
	try {
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length'), epoch = await d.evaluate('({auth:window.__yose_app.authController.authGeneration,db:window.__yose_app.db.keyGeneration})');
		await d.evaluate('void(window.__parentApproval67=window.__yose_app.approveClosedChanges([{target_month:"2026-10",status:"confirmed",amount_pending:false}],[],{isSessionValid:()=>window.__approvalParent67}))');
		if (!initiallyExpired) { await waitGate(d); await d.evaluate('window.__approvalParent67=false'); await releaseGate(d); }
		assert.equal(await d.evaluate('window.__parentApproval67'), null);
		assert.equal(await d.evaluate('window.__approvalReads67'), initiallyExpired ? 0 : 1);
		assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
		assert.deepEqual(await d.evaluate('({auth:window.__yose_app.authController.authGeneration,db:window.__yose_app.db.keyGeneration})'), epoch);
		assert.deepEqual(await raw(d), before);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__parentApproval67])'); }
});

uiCase67(fixture, 'propagates the real edit owner to closed-month approval and keeps the newer editor after direct cancellation', async d => {
	await seed(d, [transaction('approval-a67', {sync_status:'synced'}), transaction('approval-b67', {sync_status:'synced'})]);
	await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({...await db.getSnapshot(),last_closed_month:"2026-10"});})()');
	await cashflow(d); await d.click('#month-tx-list .tx-item[data-id="approval-a67"]');
	await d.evaluate('window.__workflowJobs.filter(j=>j.name==="openEditTransactionModal").at(-1).promise');
	await d.fill('#edit-tx-memo', 'OLD_APPROVAL_DRAFT');
	await d.evaluate('(()=>{const app=window.__yose_app,approve=app.approveClosedChanges;app.approveClosedChanges=function(...args){window.__editApprovalOptions67=args[2];return approve.apply(this,args);};window.__restores67.push(()=>app.approveClosedChanges=approve);})()');
	await gateMethod(d, 'window.__yose_app.db', 'getSnapshot', { afterRead: true });
	try {
		await d.click('#edit-tx-form button[type="submit"]'); await waitGate(d);
		await d.evaluate('void(window.__oldEditApproval67=window.__workflowJobs.filter(j=>j.name==="handleEditFormSubmit").at(-1).promise)');
		const parentPassed = await d.evaluate('typeof window.__editApprovalOptions67?.isSessionValid==="function"');
		const parentWasValid = await d.evaluate('window.__editApprovalOptions67?.isSessionValid?.()');
		const epoch = await d.evaluate('({auth:window.__yose_app.authController.authGeneration,db:window.__yose_app.db.keyGeneration})');
		// This is the public cancellation boundary; the normal close action correctly rejects busy saves.
		await d.evaluate('window.__yose_app.txEditController.cancelPendingOperations()');
		await d.click('#month-tx-list .tx-item[data-id="approval-b67"]'); await d.evaluate('window.__workflowJobs.filter(j=>j.name==="openEditTransactionModal").at(-1).promise');
		await d.fill('#edit-tx-memo', 'NEW_APPROVAL_DRAFT');
		const draft = await d.evaluate('window.__yose_app.txEditController.captureValues()'), before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__oldEditApproval67');
		assert.equal(parentPassed, true); assert.equal(parentWasValid, true); assert.equal(await d.evaluate('window.__editApprovalOptions67.isSessionValid()'), false);
		assert.equal(await value(d, '#edit-tx-id'), 'approval-b67'); assert.equal(await d.evaluate('window.__yose_app.txEditController.captureValues()'), draft);
		assert.equal(await d.isVisible('#modal-edit-tx'), true); assert.equal(await d.evaluate('document.querySelector("#edit-tx-form button[type=submit]").disabled'), false);
		assert.deepEqual(await d.evaluate('({auth:window.__yose_app.authController.authGeneration,db:window.__yose_app.db.keyGeneration})'), epoch);
		assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__oldEditApproval67])'); }
});

uiCase67(fixture, 'does not replace an active initialization owner when an already expired finish request arrives', async d => {
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>({...c,theme:"dark"}))');
	await gateMethod(d, 'window.__yose_app.db', 'getSetting', { afterRead: true });
	try {
		await d.evaluate('void(window.__activeFinish67=window.__yose_app.finishAppInit())'); await waitGate(d);
		await d.evaluate('void(window.__activeOwner67=window.__yose_app.initializationOwner)');
		await d.evaluate('window.__yose_app.finishAppInit({isSessionValid:()=>false})');
		const ownerKept = await d.evaluate('window.__yose_app.initializationOwner===window.__activeOwner67');
		await releaseGate(d); await d.evaluate('window.__activeFinish67');
		assert.equal(ownerKept, true); assert.equal(await d.evaluate('window.__yose_app.currentThemePreference'), 'dark');
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__activeFinish67])'); }
});
