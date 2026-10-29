import assert from 'node:assert/strict';
import {useBrowser,value} from '../helpers/ui_fixture.js';
import {uiCase67,settings67,observeNativeEvent67} from '../helpers/ui_workflows67.js';
import {waitGate,releaseGate,unlockWorkflow} from '../helpers/workflow_ui_fixture.js';
const fixture=useBrowser();
const raw=d=>d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
async function authenticator(d){
	await d.send('WebAuthn.enable',{},d.sessionId);await d.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true}},d.sessionId);
	await d.evaluate('navigator.credentials.create=options=>CredentialsContainer.prototype.create.call(navigator.credentials,options);navigator.credentials.get=options=>CredentialsContainer.prototype.get.call(navigator.credentials,options)');
}
async function keySettings(d){await settings67(d);if(!await d.isVisible('#btn-register-webauthn'))await d.click('#btn-toggle-key-details');}
async function register(d){await observeNativeEvent67(d,'#btn-register-webauthn');await d.click('#btn-register-webauthn');await d.evaluate('window.__masterNativeJobs67[0]');assert.equal(await d.evaluate('(async()=>Boolean((await window.__yose_app.db.getSecurityKey("webauthn_credential")).prfWrap))()'),true);}
// Keep the actual native/DB result; only its response delivery is delayed once.
async function holdResponse(d,path,method,{match='true',occurrence=1}={}){
	await d.evaluate(`(()=>{const object=${path},name=${JSON.stringify(method)},original=object[name];let calls=0;object[name]=async function(...args){const result=await original.apply(this,args);if((${match})&&++calls===${occurrence}){const gate={release:null,args};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);}return result;};window.__restores67.push(()=>object[name]=original);})()`);
}
for(const boundary of [
	{name:'PIN package decryption',prf:false,path:'crypto.subtle',method:'decrypt'},
	{name:'PRF initial credential read',prf:true,path:'window.__yose_app.db',method:'getSecurityKey',match:'args[0]==="webauthn_credential"'},
	{name:'PRF native assertion',prf:true,path:'navigator.credentials',method:'get'},
	{name:'PRF credential recheck',prf:true,path:'window.__yose_app.db',method:'getSecurityKey',match:'args[0]==="webauthn_credential"',occurrence:2},
	{name:'PRF package decryption',prf:true,path:'crypto.subtle',method:'decrypt'},
	{name:'successful PRF handler',prf:true,path:'window.__yose_app.authController',method:'unlockWithPasskey'}
])uiCase67(fixture,`keeps the new PIN session when an obsolete ${boundary.name} response is delivered`,async d=>{
	if(boundary.prf){await keySettings(d);await authenticator(d);await register(d);}
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');await observeNativeEvent67(d,boundary.prf?'#btn-auth-webauthn':'#btn-auth-pin');await holdResponse(d,boundary.path,boundary.method,boundary);
	try{
		if(!boundary.prf)await d.fill('#auth-pin-input','1234');await d.click(boundary.prf?'#btn-auth-webauthn':'#btn-auth-pin');await waitGate(d);await d.evaluate('void(window.__oldBoundaryJob67=window.__masterNativeJobs67[0])');
		await unlockWorkflow(d);await d.fill('#input-memo','NEW_BOUNDARY_DRAFT');const before=await raw(d),count=await d.evaluate('window.__dialogs.length'),state=await d.evaluate('({auth:window.__yose_app.authController.authGeneration,epoch:window.__yose_app.db.keyGeneration,error:document.querySelector("#auth-error-msg").style.display})');
		await releaseGate(d);await d.evaluate('window.__oldBoundaryJob67');assert.deepEqual(await raw(d),before);assert.deepEqual(await d.evaluate('({auth:window.__yose_app.authController.authGeneration,epoch:window.__yose_app.db.keyGeneration,error:document.querySelector("#auth-error-msg").style.display})'),state);assert.equal(await value(d,'#input-memo'),'NEW_BOUNDARY_DRAFT');assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")'),true);assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled([window.__oldBoundaryJob67,...window.__masterNativeJobs67])');}
});
for(const boundary of [
	{name:'security tuple read',path:'window.__yose_app.db',method:'getSecurityKeyStates'},
	{name:'native credential creation',path:'navigator.credentials',method:'create'},
	{name:'native PRF assertion',path:'navigator.credentials',method:'get'},
	{name:'native PRF wrapping',path:'crypto.subtle',method:'encrypt'},
	{name:'committed credential response',path:'window.__yose_app.db',method:'saveSecurityKey',match:'args[0]==="webauthn_credential"'}
])uiCase67(fixture,`does not publish an obsolete registration after its actual ${boundary.name}`,async d=>{
	await keySettings(d);await authenticator(d);await observeNativeEvent67(d,'#btn-register-webauthn');await holdResponse(d,boundary.path,boundary.method,boundary);
	try{
		await d.click('#btn-register-webauthn');await waitGate(d);await d.evaluate('void(window.__oldBoundaryJob67=window.__masterNativeJobs67[0])');await unlockWorkflow(d);await d.fill('#input-memo','NEW_REGISTRATION_DRAFT');const before=await raw(d),count=await d.evaluate('window.__dialogs.length');
		await releaseGate(d);await d.evaluate('window.__oldBoundaryJob67');assert.deepEqual(await raw(d),before);assert.equal(await value(d,'#input-memo'),'NEW_REGISTRATION_DRAFT');assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'),true);assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled([window.__oldBoundaryJob67,...window.__masterNativeJobs67])');}
});

for(const boundary of [
	{name:'startup package read',path:'window.__yose_app.db',method:'getSecurityKey',occurrence:1},
	{name:'startup public-key read',path:'window.__yose_app.db',method:'getSecurityKey',occurrence:2},
	{name:'startup public-key import',path:'crypto.subtle',method:'importKey',match:'args[0]==="raw"&&args[2]?.name==="Ed25519"'}
])uiCase67(fixture,`ignores an obsolete public auth-gate initialization after its ${boundary.name}`,async d=>{
	await holdResponse(d,boundary.path,boundary.method,boundary);
	try{
		await d.evaluate('void(window.__oldBoundaryJob67=window.__yose_app.authController.initSecurityAndAuthGate())');await waitGate(d);await unlockWorkflow(d);await d.fill('#input-memo','NEW_STARTUP_DRAFT');const before=await raw(d),count=await d.evaluate('window.__dialogs.length');
		await releaseGate(d);await d.evaluate('window.__oldBoundaryJob67');assert.deepEqual(await raw(d),before);assert.equal(await value(d,'#input-memo'),'NEW_STARTUP_DRAFT');assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'),true);assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled([window.__oldBoundaryJob67])');}
});

for(const prf of [false,true])for(const sameEpoch of [false,true])uiCase67(fixture,`silences a failed real finish response after a completed ${prf?'PRF':'PIN'} unlock loses its successful session ${sameEpoch?'by a same-key epoch update':'by native reauthentication'}`,async d=>{
	if(prf){await keySettings(d);await authenticator(d);await register(d);}
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');await observeNativeEvent67(d,prf?'#btn-auth-webauthn':'#btn-auth-pin');
	await d.evaluate(`(()=>{const app=window.__yose_app,original=app.finishAppInit;let once=true;app.finishAppInit=async function(...args){const result=await original.apply(this,args);if(once){once=false;const gate={release:null};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);throw new Error('DELAYED_FINISH_FAILURE');}return result;};window.__restores67.push(()=>app.finishAppInit=original);})()`);
	try{
		if(!prf)await d.fill('#auth-pin-input','1234');await d.click(prf?'#btn-auth-webauthn':'#btn-auth-pin');await waitGate(d);await d.evaluate('void(window.__oldBoundaryJob67=window.__masterNativeJobs67[0])');assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'),true);
		if(sameEpoch)await d.evaluate('window.__yose_app.db.setEncryptionKey(window.__yose_app.db.encryptionKey)');else await unlockWorkflow(d);await d.fill('#input-memo','NEW_FINISH_DRAFT');const before=await raw(d),error=await d.evaluate('({text:document.querySelector("#auth-error-msg").textContent,display:document.querySelector("#auth-error-msg").style.display})'),count=await d.evaluate('window.__dialogs.length');
		await releaseGate(d);await d.evaluate('window.__oldBoundaryJob67');assert.deepEqual(await raw(d),before);assert.deepEqual(await d.evaluate('({text:document.querySelector("#auth-error-msg").textContent,display:document.querySelector("#auth-error-msg").style.display})'),error);assert.equal(await value(d,'#input-memo'),'NEW_FINISH_DRAFT');assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled([window.__oldBoundaryJob67,...window.__masterNativeJobs67])');}
});

uiCase67(fixture,'rejects a real PRF credential replaced before the final restored-key credential read',async d=>{
	await keySettings(d);await authenticator(d);await register(d);const first=await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")');await register(d);const second=await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")');assert.notEqual(first.credentialId,second.credentialId);
	await d.evaluate(`window.__yose_app.db.saveSecurityKey('webauthn_credential',${JSON.stringify(first)})`);await d.evaluate('window.__yose_app.authController.lockPrivateKey()');await observeNativeEvent67(d,'#btn-auth-webauthn');
	await d.evaluate(`(()=>{const db=window.__yose_app.db,original=db.getSecurityKey;let calls=0;db.getSecurityKey=async function(...args){if(args[0]==='webauthn_credential'&&++calls===3){const gate={release:null};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);}return original.apply(this,args);};window.__restores67.push(()=>db.getSecurityKey=original);})()`);
	try{
		await d.click('#btn-auth-webauthn');await waitGate(d);await d.evaluate(`window.__yose_app.db.saveSecurityKey('webauthn_credential',${JSON.stringify(second)})`);const before=await raw(d);await releaseGate(d);await d.evaluate('window.__masterNativeJobs67[0]');assert.deepEqual(await raw(d),before);assert.equal(await d.evaluate('window.__yose_app.isKeyLocked&&window.__yose_app.privateKey===null&&window.__yose_app.db.encryptionKey===null'),true);assert.equal(await d.evaluate('document.querySelector("#auth-error-msg").style.display'),'block');assert.match(await d.textContent('#auth-error-msg'),/パスキー|失敗/);
		await unlockWorkflow(d);assert.equal(await d.evaluate('(async()=>Boolean((await window.__yose_app.db.getSecurityKey("webauthn_credential")).prfWrap))()'),true);
	}finally{await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())');await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');}
});
