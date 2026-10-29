import { it } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessBrowserDriver } from '../helpers/cdp_driver.js';
import { observeNativeEvent67 } from '../helpers/ui_workflows67.js';
const raw = d => d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
async function initial(t) {
	const d = new HeadlessBrowserDriver(); t.after(() => d.close()); await d.launch(); await d.navigate();
	await d.waitFor('document.querySelector("#auth-setup-container").style.display==="block"');
	await d.evaluate('window.__restores67=[]'); await observeNativeEvent67(d, '#btn-auth-setup');
	return d;
}

it('owns one initial PIN setup and ignores native repeated clicks while real key generation is pending', async t => {
	const d = await initial(t), before = await raw(d);
	await d.evaluate(`(()=>{const generate=crypto.subtle.generateKey;window.__setupEdCount67=0;crypto.subtle.generateKey=async function(...args){const result=await generate.apply(this,args);if(args[0]?.name==='Ed25519'&&++window.__setupEdCount67===1)await new Promise(resolve=>window.__setupRelease67=resolve);return result;};window.__restores67.push(()=>crypto.subtle.generateKey=generate);})()`);
	await d.evaluate(`(()=>{const db=window.__yose_app.db;window.__setupWrites67=0;for(const name of ['saveSecurityKey','putSecurityKeys']){const write=db[name];db[name]=function(...args){window.__setupWrites67++;return write.apply(this,args);};window.__restores67.push(()=>db[name]=write);}})()`);
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await d.waitFor('typeof window.__setupRelease67==="function"');
		assert.equal(await d.evaluate('document.querySelector("#auth-setup-container").getAttribute("aria-busy")'), 'true');
		assert.equal(await d.evaluate('[...document.querySelectorAll("#auth-setup-container input,#auth-setup-container button")].every(control=>control.disabled)'), true);
		assert.equal(await d.evaluate('Boolean(document.querySelector("#btn-auth-setup .spinner"))'), true);
		const point = await d.evaluate('(()=>{const r=document.querySelector("#btn-auth-setup").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};})()');
		for (let index = 0; index < 2; index++) { await d.send('Input.dispatchMouseEvent', { type:'mousePressed',button:'left',clickCount:1,...point }, d.sessionId); await d.send('Input.dispatchMouseEvent', { type:'mouseReleased',button:'left',clickCount:1,...point }, d.sessionId); }
		assert.equal(await d.evaluate('window.__masterNativeJobs67.length'), 1);
		await d.evaluate('void(window.__setupDirect67=window.__masterNativeOriginal67.call(document.querySelector("#btn-auth-setup"),new MouseEvent("click")))');
		assert.equal(await d.evaluate('typeof window.__setupDirect67?.then'), 'function'); await d.evaluate('window.__setupDirect67');
		assert.equal(await d.evaluate('window.__setupEdCount67'), 1); assert.equal(await d.evaluate('window.__setupWrites67'), 0); assert.deepEqual(await raw(d), before);
		await d.evaluate('window.__setupRelease67();window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'), true);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await observeNativeEvent67(d, '#btn-auth-pin');
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'), true);
	} finally { await d.evaluate('window.__setupRelease67?.()'); await d.evaluate('Promise.allSettled([window.__setupDirect67,window.__setupRetry67,...window.__masterNativeJobs67])'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
});

it('keeps both initial PIN and public keys absent when the second actual key write aborts', async t => {
	const d = await initial(t), before = await raw(d);
	await d.evaluate(`(()=>{const put=IDBObjectStore.prototype.put;let count=0;window.__setupWriteAbort67=false;IDBObjectStore.prototype.put=function(...args){const request=put.apply(this,args);if(this.name==='security_keys'&&++count===2){request.addEventListener('success',()=>{window.__setupWriteAbort67=true;this.transaction.abort();},{once:true});}return request;};window.__restoreSetupPut67=()=>IDBObjectStore.prototype.put=put;window.__restores67.push(window.__restoreSetupPut67);})()`);
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('window.__setupWriteAbort67'), true);
		assert.match(await d.textContent('#auth-error-msg'), /初期化エラー/);
		assert.equal(await d.evaluate('window.__yose_app._domInitialized'), false);
		assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'), false);
		assert.deepEqual(await raw(d), before, 'public key and PIN package are a single initial security-key commit');
		assert.equal(await d.evaluate('document.querySelector("#btn-auth-setup").disabled'), false);
		await d.evaluate('window.__restoreSetupPut67()');
		await d.click('#btn-auth-setup'); await d.evaluate('window.__masterNativeJobs67[1]');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'), true);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await observeNativeEvent67(d, '#btn-auth-pin');
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'), true);
	} finally { await d.evaluate('Promise.allSettled([window.__setupDirect67,window.__setupRetry67,...window.__masterNativeJobs67])'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
});

for (const readFails of [false, true]) it(`keeps an already committed initial key pair and recovers with its existing PIN after a later setup failure${readFails ? ' and a temporary package read failure' : ''}`, async t => {
	const d = await initial(t);
	await d.evaluate(`(()=>{const app=window.__yose_app,save=app.db.saveMasterConfig,read=app.db.getSecurityKey,generate=crypto.subtle.generateKey;let once=true;window.__setupEdCount67=0;crypto.subtle.generateKey=function(...args){if(args[0]?.name==='Ed25519')window.__setupEdCount67++;return generate.apply(this,args);};app.db.saveMasterConfig=async function(...args){const result=await save.apply(this,args);if(once){once=false;throw new Error('SETUP_POST_PAIR_COMMIT_FAULT');}return result;};window.__restores67.push(()=>{app.db.saveMasterConfig=save;app.db.getSecurityKey=read;crypto.subtle.generateKey=generate;});})()`);
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.ok(await d.evaluate('window.__yose_app.db.getRaw("security_keys","master_keys_package")'));
		const before = await raw(d);
		if (readFails) {
			await d.evaluate(`(()=>{const db=window.__yose_app.db;let once=true;for(const name of ['getSecurityKey','getSecurityKeyStates']){const read=db[name];if(typeof read!=='function')continue;db[name]=function(...args){const target=name==='getSecurityKeyStates'?args[0].includes('master_keys_package'):args[0]==='master_keys_package';if(once&&target){once=false;window.__setupRecoveryReadFailed67=true;return Promise.reject(new Error('TEMPORARY_SETUP_PACKAGE_READ'));}return read.apply(this,args);};window.__restores67.push(()=>db[name]=read);}})()`);
			// Directly invoke the real listener to verify the guarded entry even after the visible UI moved to PIN recovery.
			await d.evaluate('void(window.__setupRetry67=window.__masterNativeOriginal67.call(document.querySelector("#btn-auth-setup"),new MouseEvent("click")))'); await d.evaluate('window.__setupRetry67');
			assert.equal(await d.evaluate('window.__setupRecoveryReadFailed67'), true);
			assert.equal(await d.evaluate('window.__setupEdCount67'), 1); assert.deepEqual(await raw(d), before);
			assert.equal(await d.evaluate('document.querySelector("#auth-error-msg").style.display'), 'block'); assert.notEqual(await d.textContent('#auth-error-msg'), '');
			await d.evaluate('void(window.__setupRetry67=window.__masterNativeOriginal67.call(document.querySelector("#btn-auth-setup"),new MouseEvent("click")))'); await d.evaluate('window.__setupRetry67');
		}
		assert.equal(await d.evaluate('document.querySelector("#auth-setup-container").style.display'), 'none');
		assert.equal(await d.evaluate('document.querySelector("#auth-pin-container").style.display'), 'block');
		assert.equal(await d.evaluate('window.__setupEdCount67'), 1, 'retry must check the persisted key package before generating another DMK/signing pair');
		assert.deepEqual(await raw(d), before);
		await observeNativeEvent67(d, '#btn-auth-pin'); await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")'), true);
		assert.deepEqual(await raw(d), before);
	} finally { await d.evaluate('Promise.allSettled([window.__setupDirect67,window.__setupRetry67,...window.__masterNativeJobs67])'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
});

it('does not release the newer setup owner when an invalidated old key-generation job finally completes', async t => {
	const d = await initial(t);
	await d.evaluate(`(()=>{const generate=crypto.subtle.generateKey;window.__setupReleases67=[];crypto.subtle.generateKey=async function(...args){const result=await generate.apply(this,args);if(args[0]?.name==='Ed25519')await new Promise(resolve=>window.__setupReleases67.push(resolve));return result;};window.__restores67.push(()=>crypto.subtle.generateKey=generate);})()`);
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await d.waitFor('window.__setupReleases67.length===1');
		await d.evaluate('window.__yose_app.authController.invalidateSession()');
		assert.equal(await d.evaluate('document.querySelector("#btn-auth-setup").disabled'), false, 'the public invalidation boundary releases only its obsolete setup owner');
		await d.fill('#auth-setup-pin', '5678'); await d.click('#btn-auth-setup'); await d.waitFor('window.__setupReleases67.length===2');
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await d.evaluate('window.__setupReleases67[0]();window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('document.querySelector("#btn-auth-setup").disabled'), true);
		assert.equal(await d.evaluate('document.querySelector("#auth-setup-container").getAttribute("aria-busy")'), 'true');
		assert.equal(await d.evaluate('document.querySelector("#auth-setup-pin").value'), '5678');
		assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
		await d.evaluate('window.__setupReleases67[1]();window.__masterNativeJobs67[1]');
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await observeNativeEvent67(d, '#btn-auth-pin');
		await d.fill('#auth-pin-input', '5678'); await d.click('#btn-auth-pin'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'), true);
	} finally { await d.evaluate('window.__setupReleases67.forEach(release=>release())'); await d.evaluate('Promise.allSettled([window.__setupDirect67,window.__setupRetry67,...window.__masterNativeJobs67])'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
});

it('keeps normal startup version detection alive after the completed setup releases its busy owner', async t => {
	const d = await initial(t);
	await d.evaluate(`(()=>{const app=window.__yose_app,fetch=window.fetch,check=app.checkStartupUpdate;window.fetch=async function(url,options){const response=await fetch.apply(this,arguments);if(String(url).includes('version.json')){await new Promise(resolve=>window.__setupVersionRelease67=resolve);return new Response(JSON.stringify({version:'99.9.9'}),{status:200,headers:{'Content-Type':'application/json'}});}return response;};app.checkStartupUpdate=function(...args){return window.__setupVersionJob67=check.apply(this,args);};window.__restores67.push(()=>{window.fetch=fetch;app.checkStartupUpdate=check;});})()`);
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await d.evaluate('window.__masterNativeJobs67[0]');
		await d.waitFor('typeof window.__setupVersionRelease67==="function"');
		assert.equal(await d.evaluate('Boolean(window.__yose_app.authController.setupOperation)'), false);
		assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'), true);
		await d.evaluate('window.__setupVersionRelease67();window.__setupVersionJob67');
		assert.equal(await d.isVisible('#modal-app-update'), true); assert.equal(await d.textContent('#modal-new-version-text'), 'v99.9.9');
	} finally { await d.evaluate('window.__setupVersionRelease67?.()'); await d.evaluate('Promise.allSettled([window.__setupVersionJob67,...window.__masterNativeJobs67])'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
});

it('hides a successfully created initial PIN gate before the actual view metadata refresh finishes', async t => {
	const d = await initial(t);
	await d.evaluate(`(()=>{const db=window.__yose_app.db,read=db.getDataMetadata;let once=true;db.getDataMetadata=async function(...args){const result=await read.apply(this,args);if(once){once=false;await new Promise(resolve=>window.__setupMetadataRelease67=resolve);}return result;};window.__restores67.push(()=>db.getDataMetadata=read);})()`);
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await d.waitFor('typeof window.__setupMetadataRelease67==="function"');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")'), true);
		await d.evaluate('window.__setupMetadataRelease67();window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('document.querySelectorAll("#data-metadata li").length'), 5);
	} finally { await d.evaluate('window.__setupMetadataRelease67?.()'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
});
