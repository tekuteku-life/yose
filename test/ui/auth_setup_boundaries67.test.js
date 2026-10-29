import assert from 'node:assert/strict';
import {it} from 'node:test';
import {HeadlessBrowserDriver} from '../helpers/cdp_driver.js';
import {observeNativeEvent67} from '../helpers/ui_workflows67.js';
import {waitGate,releaseGate} from '../helpers/workflow_ui_fixture.js';
const raw=d=>d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
for(const boundary of [
	{name:'initial security-state read',path:'window.__yose_app.db',method:'getSecurityKeyStates'},
	{name:'native DMK generation',path:'crypto.subtle',method:'generateKey',match:'args[0]?.name==="AES-GCM"'},
	{name:'native signing-key generation',path:'crypto.subtle',method:'generateKey',match:'args[0]?.name==="Ed25519"'},
	{name:'native PIN wrapping',path:'crypto.subtle',method:'encrypt'},
	{name:'committed security-pair response',path:'window.__yose_app.db',method:'putSecurityKeys'},
	{name:'native committed-pair decryption',path:'crypto.subtle',method:'decrypt'},
	{name:'initial master read',path:'window.__yose_app.db',method:'getMasterConfig',occurrence:2},
	{name:'committed initial master response',path:'window.__yose_app.db',method:'saveMasterConfig'},
	{name:'initial snapshot read',path:'window.__yose_app.db',method:'getSnapshot',occurrence:2},
	{name:'committed initial snapshot response',path:'window.__yose_app.db',method:'saveSnapshot'}
])it(`does not continue an initial setup after its ${boundary.name} crosses a real lock`,async t=>{
	const d=new HeadlessBrowserDriver();t.after(()=>d.close());await d.launch();await d.navigate();await d.waitFor('document.querySelector("#auth-setup-container").style.display==="block"');await d.evaluate('window.__restores67=[];window.__workflowGates=[]');await observeNativeEvent67(d,'#btn-auth-setup');
	await d.evaluate(`(()=>{const object=${boundary.path},name=${JSON.stringify(boundary.method)},original=object[name];let calls=0;object[name]=async function(...args){const result=await original.apply(this,args);if((${boundary.match||'true'})&&++calls===${boundary.occurrence||1}){const gate={release:null};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);}return result;};window.__restores67.push(()=>object[name]=original);})()`);
	try{
		await d.fill('#auth-setup-pin','1234');await d.click('#btn-auth-setup');await waitGate(d);assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1);await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		const before=await raw(d),state=await d.evaluate('({generation:window.__yose_app.authController.authGeneration,epoch:window.__yose_app.db.keyGeneration,error:document.querySelector("#auth-error-msg").textContent,errorDisplay:document.querySelector("#auth-error-msg").style.display})'),count=await d.evaluate('window.__dialogs.length');
		await releaseGate(d);await d.evaluate('window.__masterNativeJobs67[0]');assert.deepEqual(await raw(d),before);assert.deepEqual(await d.evaluate('({generation:window.__yose_app.authController.authGeneration,epoch:window.__yose_app.db.keyGeneration,error:document.querySelector("#auth-error-msg").textContent,errorDisplay:document.querySelector("#auth-error-msg").style.display})'),state);assert.equal(await d.evaluate('window.__yose_app.isKeyLocked&&window.__yose_app.privateKey===null&&window.__yose_app.db.encryptionKey===null'),true);assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'),false);assert.equal(await d.evaluate('document.querySelector("#btn-auth-setup").disabled'),false);assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);assert.deepEqual(d.pageErrors,[]);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())');}
});

it('rejects a native initial PIN shorter than four characters without generating or saving keys',async t=>{
	const d=new HeadlessBrowserDriver();t.after(()=>d.close());await d.launch();await d.navigate();await d.waitFor('document.querySelector("#auth-setup-container").style.display==="block"');await d.evaluate('window.__restores67=[]');await observeNativeEvent67(d,'#btn-auth-setup');const before=await raw(d);await d.fill('#auth-setup-pin','123');await d.click('#btn-auth-setup');assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1);await d.evaluate('window.__masterNativeJobs67[0]');assert.deepEqual(await raw(d),before);assert.match(await d.textContent('#auth-error-msg'),/4桁以上/);assert.equal(await d.evaluate('document.querySelector("#btn-auth-setup").disabled'),false);assert.deepEqual(d.pageErrors,[]);
});
