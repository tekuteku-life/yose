import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seedLegacy, transaction, settings } from '../helpers/ui_fixture.js';
import { unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const f=useBrowser();
async function prepare(d){
	await d.evaluate(`(async()=>{const db=window.__yose_app.db;await db.mutateMasterConfig(c=>{c.accounts.find(a=>a.id==='acc_wallet').is_archived=true;c.accounts.push({id:'cash67',name:'移行先現金',type:'cash',is_asset:true,is_archived:false},{id:'assetFalse67',name:'資産外',type:'cash',is_asset:false,is_archived:false},{id:'archived67',name:'旧現金',type:'cash',is_asset:true,is_archived:true});});await db.setSetting('downloaded_archive_months',['2025-12']);})()`);
	await seedLegacy(d,[transaction('account-legacy67',{memo:'',status:'planned',amount:0,amount_pending:true})]);await settings(d);await d.click('#maintenance-panel summary');
	await d.evaluate('window.__yose_app.maintenanceController.refresh()');await d.select('#maintenance-source','account:acc_wallet');await d.select('#maintenance-target','cash67');
}
it('offers only compatible active accounts and migrates an unknown planned amount without changing its content',async()=>{
	const d=f.driver;await prepare(d);
	assert.deepEqual(await d.evaluate('[...document.querySelector("#maintenance-target").options].map(o=>o.value)'),['cash67']);
	assert.equal(await d.evaluate('document.querySelector("#maintenance-subcategory-group").hidden'),true);
	assert.match(await d.textContent('#maintenance-records'),/account-legacy67/);assert.match(await d.textContent('#maintenance-records'),/金額未入力/);
	assert.match(await d.textContent('#maintenance-scope'),/2025-12/);
	await d.evaluate(`(()=>{const c=window.__yose_app.maintenanceController,original=c.migrate;c.migrate=function(...args){return window.__migration67=original.apply(this,args);};})()`);
	await d.click('#btn-migrate-maintenance');await d.evaluate('window.__migration67');
	const row=await d.evaluate('window.__yose_app.db.getTransaction("account-legacy67")');assert.equal(row.account_id,'cash67');assert.equal(row.amount,0);assert.equal(row.amount_pending,true);assert.equal(row.status,'planned');assert.equal(row.memo,'');
	assert.equal(await d.evaluate('document.querySelector("#maintenance-source").options.length'),0);
});
it('does not commit an old migration after approval completes in a newly unlocked session',async()=>{
	const d=f.driver;await prepare(d);
	try {
	await d.evaluate(`(()=>{const app=window.__yose_app,approve=app.approveClosedChanges;app.approveClosedChanges=async function(...args){app.approveClosedChanges=approve;const result=await approve.apply(this,args);await new Promise(resolve=>window.__migrationRelease67=resolve);return result;};const c=app.maintenanceController,original=c.migrate;c.migrate=function(...args){return window.__migration67=original.apply(this,args);};window.__restoreMigration67=()=>{app.approveClosedChanges=approve;c.migrate=original;};})()`);
	await d.click('#btn-migrate-maintenance');await d.waitFor('typeof window.__migrationRelease67==="function"');
	await unlockWorkflow(d);const before=await d.evaluate('window.__yose_app.db.captureImportState()');const dialogs=await d.evaluate('window.__dialogs.length');
	await d.evaluate('window.__migrationRelease67();window.__migration67');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
	assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);
	assert.deepEqual(await d.evaluate('({busy:window.__yose_app.maintenanceController.busy,loading:window.__yose_app.maintenanceController.loading,disabled:document.querySelector("#btn-migrate-maintenance").disabled,source:document.querySelector("#maintenance-source").value,target:document.querySelector("#maintenance-target").value})'),{busy:false,loading:false,disabled:false,source:'account:acc_wallet',target:'cash67'});
	} finally {await d.evaluate('(async()=>{try{window.__migrationRelease67?.();await window.__migration67;}finally{window.__restoreMigration67?.();}})()');}
});

it('leaves a newly started migration busy when an old approval finally returns',async()=>{
	const d=f.driver;await prepare(d);
	try {
	await d.evaluate(`(()=>{const app=window.__yose_app,approve=app.approveClosedChanges,c=app.maintenanceController,migrate=c.migrate;window.__migrationGates67=[];window.__migrationJobs67=[];app.approveClosedChanges=async function(...args){const value=await approve.apply(this,args);await new Promise(resolve=>window.__migrationGates67.push(resolve));return value;};c.migrate=function(...args){const job=migrate.apply(this,args);window.__migrationJobs67.push(job);return job;};window.__restoreMigration67=()=>{app.approveClosedChanges=approve;c.migrate=migrate;};})()`);
	await d.click('#btn-migrate-maintenance');await d.waitFor('window.__migrationGates67.length===1');await unlockWorkflow(d);
	assert.equal(await d.evaluate('document.querySelector("#btn-migrate-maintenance").disabled'),false);
	await d.click('#btn-migrate-maintenance');await d.waitFor('window.__migrationGates67.length===2');const before=await d.evaluate('window.__yose_app.db.captureImportState()');const dialogs=await d.evaluate('window.__dialogs.length');
	await d.evaluate('window.__migrationGates67[0]();window.__migrationJobs67[0]');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);
	assert.equal(await d.evaluate('window.__yose_app.maintenanceController.busy'),true);assert.equal(await d.evaluate('document.querySelector("#maintenance-target").disabled'),true);
	await d.evaluate('window.__migrationGates67[1]();window.__migrationJobs67[1]');assert.equal((await d.evaluate('window.__yose_app.db.getTransaction("account-legacy67")')).account_id,'cash67');
	} finally {await d.evaluate('(async()=>{try{window.__migrationGates67?.forEach(release=>release());await Promise.allSettled(window.__migrationJobs67||[]);}finally{window.__restoreMigration67?.();}})()');}
});

it('does not apply an old committed migration display completion to the newly unlocked selection',async()=>{
	const d=f.driver;await prepare(d);
	try {
	await d.evaluate(`(()=>{const app=window.__yose_app,refresh=app.refreshAllViews,c=app.maintenanceController,migrate=c.migrate;let once=true;app.refreshAllViews=async function(...args){if(once){once=false;await new Promise(resolve=>window.__migrationRelease67=resolve);}return refresh.apply(this,args);};c.migrate=function(...args){return window.__migration67=migrate.apply(this,args);};window.__restoreMigration67=()=>{app.refreshAllViews=refresh;c.migrate=migrate;};})()`);
	await d.click('#btn-migrate-maintenance');await d.waitFor('typeof window.__migrationRelease67==="function"');assert.equal((await d.evaluate('window.__yose_app.db.getTransaction("account-legacy67")')).account_id,'cash67');
	await unlockWorkflow(d);const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),html=await d.textContent('#maintenance-panel'),dialogs=await d.evaluate('window.__dialogs.length');
	await d.evaluate('window.__migrationRelease67();window.__migration67');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);assert.equal(await d.textContent('#maintenance-panel'),html);assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);
	} finally {await d.evaluate('(async()=>{try{window.__migrationRelease67?.();await window.__migration67;}finally{window.__restoreMigration67?.();}})()');}
});
