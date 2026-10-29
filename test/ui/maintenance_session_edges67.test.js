import assert from 'node:assert/strict';
import { useBrowser, seedLegacy, transaction } from '../helpers/ui_fixture.js';
import { flushWorkflow, gateMethod, waitGate, releaseGate, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
const fullRaw = d => d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
const view = d => d.evaluate('({html:document.querySelector("#maintenance-panel").innerHTML,fields:["maintenance-source","maintenance-target","maintenance-subcategory"].map(id=>[id,document.getElementById(id).value,document.getElementById(id).disabled]),busy:window.__yose_app.maintenanceController.busy,loading:window.__yose_app.maintenanceController.loading,refresh:window.__yose_app.maintenanceController.refreshGeneration,operation:window.__yose_app.maintenanceController.migrationOperation})');

async function prepare(d) {
	await d.evaluate(`(()=>{const controller=window.__yose_app.maintenanceController;window.__maintenanceJobs67=[];for(const name of ['refresh','migrate']){const original=controller[name];controller[name]=function(...args){const promise=original.apply(this,args);window.__maintenanceJobs67.push({name,promise});return promise;};window.__restores67.push(()=>controller[name]=original);}})()`);
	await d.evaluate(`window.__yose_app.db.mutateMasterConfig(config=>{
		config.categories.find(item=>item.id==='cat_food').is_archived=true;
		config.accounts.push({id:'old_cash_maint67',name:'Other archived cash',type:'cash',initial_balance:0,is_asset:true,is_archived:true},{id:'new_cash_maint67',name:'New cash target',type:'cash',initial_balance:0,is_asset:true,is_archived:false});
	})`);
	await seedLegacy(d, [transaction('migration-aes67', { amount: 125, subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries', sync_status: 'synced' }), transaction('other-source67', { amount: 31, account_id: 'old_cash_maint67', category_id: 'cat_housing', actual_category_id: 'cat_housing', sync_status: 'synced' })]);
	await settings67(d);
	const start = await d.evaluate('window.__maintenanceJobs67.length'); await d.click('#maintenance-panel summary');
	await d.waitFor(`document.querySelector('#maintenance-panel').open&&window.__maintenanceJobs67.length>${start}`);
	await d.evaluate('Promise.allSettled(window.__maintenanceJobs67.map(job=>job.promise))');
	await d.select('#maintenance-source', 'category:cat_food'); await d.select('#maintenance-target', 'cat_housing'); await d.select('#maintenance-subcategory', 'sub_rent');
	assert.match(await d.textContent('#maintenance-records'), /migration-aes67/);
}

async function newSelection(d) {
	await unlockWorkflow(d);
	const start = await d.evaluate('window.__workflowJobs.length'); await d.click('.tab-btn[data-tab="tab-settings"]');
	await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`);
	const refresh = await d.evaluate('window.__maintenanceJobs67.length'); await d.click('#btn-refresh-maintenance');
	await d.waitFor(`window.__maintenanceJobs67.length>${refresh}`); await d.evaluate(`window.__maintenanceJobs67[${refresh}].promise`);
	await d.select('#maintenance-source', 'account:old_cash_maint67'); await d.select('#maintenance-target', 'new_cash_maint67');
	assert.match(await d.textContent('#maintenance-records'), /other-source67/);
	assert.equal(await d.evaluate('document.querySelector("#btn-migrate-maintenance").disabled'), false);
}

async function cryptoGate(d, method) {
	await d.evaluate(`(()=>{const original=crypto.subtle[${JSON.stringify(method)}];let once=true;window.__maintenanceCryptoCalls67=0;crypto.subtle[${JSON.stringify(method)}]=async function(...args){const result=await original.apply(this,args);if(once){once=false;window.__maintenanceCryptoCalls67++;await new Promise(resolve=>window.__maintenanceCryptoRelease67=resolve);}return result;};window.__restores67.push(()=>crypto.subtle[${JSON.stringify(method)}]=original);})()`);
}

async function finish(d) {
	await d.evaluate('window.__maintenanceCryptoRelease67?.();window.__workflowGates.forEach(gate=>gate.release?.())');
	await d.evaluate('Promise.allSettled(window.__maintenanceJobs67.map(job=>job.promise))');
	await d.evaluate('Promise.allSettled([window.__maintenanceTransport67])');
	await flushWorkflow(d);
}

uiCase67(fixture, 'keeps the new maintenance selection when a real obsolete AES read fails, and makes closed toggles inert', async d => {
	await prepare(d);
	await d.evaluate(`(()=>{const panel=document.querySelector('#maintenance-panel'),read=window.__yose_app.db.getMasterConfig;window.__maintenanceCloseReads67=0;window.__maintenanceToggle67=0;const toggled=()=>window.__maintenanceToggle67++;panel.addEventListener('toggle',toggled);window.__yose_app.db.getMasterConfig=function(...args){window.__maintenanceCloseReads67++;return read.apply(this,args);};window.__restores67.push(()=>{window.__yose_app.db.getMasterConfig=read;panel.removeEventListener('toggle',toggled);});})()`);
	const rawBeforeClose = await fullRaw(d), status = await d.textContent('#maintenance-refresh-status');
	await d.click('#maintenance-panel summary'); await d.waitFor('!document.querySelector("#maintenance-panel").open&&window.__maintenanceToggle67===1');
	await d.evaluate('Promise.allSettled(window.__maintenanceJobs67.map(job=>job.promise))');
	assert.equal(await d.evaluate('window.__maintenanceCloseReads67'), 0); assert.equal(await d.textContent('#maintenance-refresh-status'), status); assert.deepEqual(await fullRaw(d), rawBeforeClose);
	await d.click('#maintenance-panel summary'); await d.waitFor('document.querySelector("#maintenance-panel").open&&window.__maintenanceToggle67===2'); await d.evaluate('Promise.allSettled(window.__maintenanceJobs67.map(job=>job.promise))');
	assert.ok(await d.evaluate('window.__maintenanceCloseReads67>0'));
	await d.evaluate(`(()=>{const db=window.__yose_app.db;db.decryptedRecords.clear();window.__maintenanceReadErrors67=[];for(const name of ['getMasterConfig','getTransactions']){const read=db[name];db[name]=async function(...args){try{return await read.apply(this,args);}catch(error){window.__maintenanceReadErrors67.push(error.message);throw error;}};window.__restores67.push(()=>db[name]=read);}})()`);
	await cryptoGate(d, 'decrypt');
	try {
		await d.click('#btn-refresh-maintenance'); await d.waitFor('typeof window.__maintenanceCryptoRelease67==="function"');
		await d.evaluate('void(window.__maintenanceOld67=window.__maintenanceJobs67.at(-1).promise)');
		await newSelection(d); const raw = await fullRaw(d), display = await view(d), dialogs = await d.evaluate('window.__dialogs.length');
		await d.evaluate('window.__maintenanceCryptoRelease67()'); await d.evaluate('window.__maintenanceOld67');
		assert.equal(await d.evaluate('window.__maintenanceCryptoCalls67'), 1); assert.ok((await d.evaluate('window.__maintenanceReadErrors67')).some(message=>/認証鍵|世代/.test(message)));
		assert.deepEqual(await fullRaw(d), raw); assert.deepEqual(await view(d), display); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await finish(d); }
});

uiCase67(fixture, 'cancels a migration held inside real AES encryption without changing any new-session raw store or UI', async d => {
	await prepare(d); await cryptoGate(d, 'encrypt');
	try {
		await d.click('#btn-migrate-maintenance'); await d.waitFor('typeof window.__maintenanceCryptoRelease67==="function"');
		await d.evaluate('void(window.__maintenanceOld67=window.__maintenanceJobs67.find(job=>job.name==="migrate").promise)');
		await newSelection(d); const raw = await fullRaw(d), display = await view(d), dialogs = await d.evaluate('window.__dialogs.length');
		await d.evaluate('window.__maintenanceCryptoRelease67()'); await d.evaluate('window.__maintenanceOld67');
		assert.equal(await d.evaluate('window.__maintenanceCryptoCalls67'), 1);
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getTransaction("migration-aes67")).category_id)()'), 'cat_food');
		assert.deepEqual(await fullRaw(d), raw); assert.deepEqual(await view(d), display); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await finish(d); }
});

uiCase67(fixture, 'keeps a real committed migration and the new selection when its old DB response arrives after PIN unlock', async d => {
	await prepare(d); await gateMethod(d, 'window.__yose_app.db', 'migrateArchivedMaster', { afterRead: true });
	try {
		await d.click('#btn-migrate-maintenance'); await waitGate(d);
		assert.deepEqual(await d.evaluate('(async()=>{const row=await window.__yose_app.db.getTransaction("migration-aes67");return [row.category_id,row.actual_category_id,row.subcategory_id,row.amount,row.memo];})()'), ['cat_housing', 'cat_housing', 'sub_rent', 125, 'migration-aes67']);
		await d.evaluate('void(window.__maintenanceOld67=window.__maintenanceJobs67.find(job=>job.name==="migrate").promise)');
		await newSelection(d);
		await d.evaluate('(()=>{const manager=window.__yose_app.syncManager,original=manager.syncPendingDiffs;window.__maintenanceSyncStarts67=0;manager.syncPendingDiffs=function(...args){window.__maintenanceSyncStarts67++;return original.apply(this,args);};window.__restores67.push(()=>manager.syncPendingDiffs=original);})()');
		const raw = await fullRaw(d), display = await view(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__maintenanceOld67');
		assert.deepEqual(await fullRaw(d), raw); assert.deepEqual(await view(d), display); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []); assert.equal(await d.evaluate('window.__maintenanceSyncStarts67'), 0);
	} finally { await finish(d); }
});

uiCase67(fixture, 'suppresses an old maintenance background toast when a real signed transport fails after reauthentication', async d => {
	await prepare(d);
	const endpoint = 'https://maintenance-session67.fixture/exec'; d.responses.set(endpoint, { error: 'Failed' });
	await d.evaluate(`(()=>{const manager=window.__yose_app.syncManager,original=manager.syncPendingDiffs;manager.setGasUrl(${JSON.stringify(endpoint)});manager.syncPendingDiffs=function(...args){const pending=original.apply(this,args);window.__maintenanceTransport67=pending;window.__maintenanceTransportOutcome67=pending.then(result=>({result}),error=>({error:error.message}));return pending;};window.__restores67.push(()=>manager.syncPendingDiffs=original);})()`);
	await gateMethod(d, 'window.__yose_app.syncManager', 'fetch');
	try {
		await d.click('#btn-migrate-maintenance'); await waitGate(d);
		assert.equal(await d.evaluate('(async()=>{const {verifySignedRequest}=await import("./js/crypto.js");return (await verifySignedRequest(JSON.parse(window.__workflowGates[0].args[1].body),window.__yose_app.publicKey)).valid;})()'), true);
		await d.evaluate('window.__maintenanceJobs67.find(job=>job.name==="migrate").promise');
		await newSelection(d); const raw = await fullRaw(d), display = await view(d), notices = await d.evaluate('window.__workflowNotices.length'), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); const outcome = await d.evaluate('window.__maintenanceTransportOutcome67'); await d.evaluate('Promise.allSettled([window.__maintenanceTransport67])');
		assert.match(outcome.error, /GASに接続|Failed to fetch/); assert.ok(d.requests.some(request=>request.url===endpoint));
		assert.deepEqual(await fullRaw(d), raw); assert.deepEqual(await view(d), display); assert.deepEqual(await d.evaluate(`window.__workflowNotices.slice(${notices})`), []); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await finish(d); }
});
