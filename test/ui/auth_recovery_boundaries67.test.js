import assert from 'node:assert/strict';
import {it} from 'node:test';
import {HeadlessBrowserDriver} from '../helpers/cdp_driver.js';
import {useBrowser,value} from '../helpers/ui_fixture.js';
import {uiCase67,observeNativeEvent67} from '../helpers/ui_workflows67.js';
import {gateMethod,waitGate,releaseGate,unlockWorkflow} from '../helpers/workflow_ui_fixture.js';
const fixture=useBrowser();
const raw=d=>d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
for(const obsolete of [false,true])uiCase67(fixture,`treats an actual lock credential-read failure as ${obsolete?'obsolete cancellation':'a current public API error'}`,async d=>{
	await gateMethod(d,'window.__yose_app.db','getSecurityKey',{afterRead:true,reject:true});
	try{
		await d.evaluate('void(window.__lockReadJob67=window.__yose_app.authController.lockPrivateKey().then(()=>({ok:true}),error=>({ok:false,message:error.message})))');await waitGate(d);if(obsolete){await unlockWorkflow(d);await d.fill('#input-memo','NEW_LOCK_ERROR_DRAFT');}const before=await raw(d),count=await d.evaluate('window.__dialogs.length');await releaseGate(d);const result=await d.evaluate('window.__lockReadJob67');assert.equal(result.ok,obsolete);if(!obsolete)assert.match(result.message,/WORKFLOW_WRITE_FAILURE/);else assert.equal(await value(d,'#input-memo'),'NEW_LOCK_ERROR_DRAFT');assert.deepEqual(await raw(d),before);assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled([window.__lockReadJob67])');}
});

for(const boundary of [
	{name:'current recovery-state failure',fault:'recoveryRead',reject:true,obsolete:false},
	{name:'obsolete recovery-state failure',fault:'recoveryRead',reject:true,obsolete:true},
	{name:'obsolete recovery-state success',fault:'recoveryRead',reject:false,obsolete:true},
	{name:'current recovery lock-read failure',fault:'recoveryLock',reject:true,obsolete:false},
	{name:'obsolete recovery lock-read failure',fault:'recoveryLock',reject:true,obsolete:true},
	{name:'obsolete recovery lock-read success',fault:'recoveryLock',reject:false,obsolete:true}
])it(`keeps stored keys and the correct authentication UI after a ${boundary.name}`,async t=>{
	const d=new HeadlessBrowserDriver();t.after(()=>d.close());await d.launch();await d.navigate();await d.waitFor('document.querySelector("#auth-setup-container").style.display==="block"');await d.evaluate('window.__restores67=[];window.__workflowGates=[]');await observeNativeEvent67(d,'#btn-auth-setup');
	await d.evaluate(`(()=>{const db=window.__yose_app.db,states=db.getSecurityKeyStates,save=db.saveMasterConfig,read=db.getSecurityKey;let calls=0,failed=false;window.__setupFault67=false;const pause=async()=>{const gate={release:null};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);if(${boundary.reject})throw new Error('REAL_RECOVERY_RESPONSE_FAILURE');};db.getSecurityKeyStates=async function(...args){calls++;if(${JSON.stringify(boundary.fault)}==='recoveryRead'&&calls===1){window.__setupFault67=true;throw new Error('INITIAL_STATE_READ_FAILURE');}const result=await states.apply(this,args);if(${JSON.stringify(boundary.fault)}==='recoveryRead'&&calls===2)await pause();return result;};db.saveMasterConfig=async function(...args){if(${JSON.stringify(boundary.fault)}==='recoveryLock'&&!failed){failed=true;window.__setupFault67=true;throw new Error('INITIAL_MASTER_SAVE_FAILURE');}return save.apply(this,args);};db.getSecurityKey=async function(...args){const result=await read.apply(this,args);if(${JSON.stringify(boundary.fault)}==='recoveryLock'&&failed&&args[0]==='webauthn_credential'){failed=false;await pause();}return result;};window.__restores67.push(()=>{db.getSecurityKeyStates=states;db.saveMasterConfig=save;db.getSecurityKey=read;});})()`);
	try{
		await d.fill('#auth-setup-pin','1234');await d.click('#btn-auth-setup');await waitGate(d);assert.equal(await d.evaluate('window.__setupFault67'),true);if(boundary.obsolete)await d.evaluate('window.__yose_app.authController.lockPrivateKey()');const before=await raw(d),error=await d.evaluate('({text:document.querySelector("#auth-error-msg").textContent,display:document.querySelector("#auth-error-msg").style.display})'),count=await d.evaluate('window.__dialogs.length'),generation=await d.evaluate('window.__yose_app.authController.authGeneration');
		await releaseGate(d);await d.evaluate('window.__masterNativeJobs67[0]');assert.deepEqual(await raw(d),before);assert.equal(await d.evaluate('window.__yose_app.authController.authGeneration'),generation);assert.equal(await d.evaluate('document.querySelector("#btn-auth-setup").disabled'),false);if(boundary.obsolete)assert.deepEqual(await d.evaluate('({text:document.querySelector("#auth-error-msg").textContent,display:document.querySelector("#auth-error-msg").style.display})'),error);else{assert.equal(await d.evaluate('document.querySelector("#auth-error-msg").style.display'),'block');assert.match(await d.textContent('#auth-error-msg'),/初期化エラー.*REAL_RECOVERY_RESPONSE_FAILURE/);}assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);assert.deepEqual(d.pageErrors,[]);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())');}
});
