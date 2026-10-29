import { it } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessBrowserDriver } from '../helpers/cdp_driver.js';
import { useBrowser, seed, transaction, records, value } from '../helpers/ui_fixture.js';
import { flushWorkflow, rawWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67, observeExpectedDialog67, failNextWrite67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
async function keys67(d) { await settings67(d); if (!await d.isVisible('#btn-generate-key')) await d.click('#btn-toggle-key-details'); }
async function register67(d) {
	await d.send('WebAuthn.enable', {}, d.sessionId);
	await d.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }, d.sessionId);
	await d.evaluate('navigator.credentials.create=options=>CredentialsContainer.prototype.create.call(navigator.credentials,options);navigator.credentials.get=options=>CredentialsContainer.prototype.get.call(navigator.credentials,options)');
	await keys67(d); await observeExpectedDialog67(d, () => d.click('#btn-register-webauthn'), /登録しました/);
}
uiCase67(fixture, 'regenerates signing keys with a valid PIN and no registered passkey while preserving encrypted business records', async d => {
	await seed(d, [transaction('key-kept67')]); await keys67(d);
	const before = await rawWorkflow(d), oldPublic = await d.evaluate('window.__yose_app.db.getSecurityKey("public_key_base64")');
	await d.evaluate('window.__nextPromptText="1234"'); await observeExpectedDialog67(d, () => d.click('#btn-generate-key'), /新しいEd25519鍵ペアを生成/);
	const newPublic = await d.evaluate('window.__yose_app.db.getSecurityKey("public_key_base64")'); assert.notEqual(newPublic, oldPublic); assert.deepEqual(await rawWorkflow(d), before);
	await unlockWorkflow(d); assert.equal((await records(d))[0].id, 'key-kept67'); assert.equal(await d.evaluate('window.__yose_app.publicKeyBase64'), newPublic);
});
uiCase67(fixture, 'refuses PIN unlock when its encrypted key package was removed by another operation', async d => {
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await d.evaluate('window.__yose_app.db.deleteSecurityKey("master_keys_package")'); const before = await rawWorkflow(d);
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await flushWorkflow(d);
	assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), true); assert.equal(await d.evaluate('window.__yose_app.privateKey'), null); assert.deepEqual(await rawWorkflow(d), before);
	assert.match(await d.textContent('#auth-error-msg'), /PINコードが正しくありません|復号できません/);
});
uiCase67(fixture, 'keeps every stored key and financial record when the public key-generation facade is called while actually locked', async d => {
	await seed(d, [transaction('locked-regeneration67', { sync_status: 'synced' })]); await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	const raw = await rawWorkflow(d), keys = await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'), dialogs = await d.evaluate('window.__dialogs.length');
	await d.evaluate('window.__yose_app.generateNewKeyPair()'); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), raw); assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'), keys);
	assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs}).map(item=>item.message)`), ['DBがロックされています。先にロックを解除してください。']);
	assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), true); assert.equal(await d.evaluate('window.__yose_app.privateKey'), null);
});
for (const stage of ['proof', 'public-key', 'final-generation']) uiCase67(fixture, `rejects an obsolete PIN restoration at its ${stage} boundary and keeps business records unchanged`, async d => {
	await seed(d, [transaction('auth-kept67')]); await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); const before = await rawWorkflow(d);
	await d.evaluate(`(()=>{
		const app=window.__yose_app;let once=true,count=0;
		const restore=app.authController.restoreMasterKeys;app.authController.restoreMasterKeys=function(unpacked,...args){window.__unpacked67=unpacked;return restore.call(this,unpacked,...args);};window.__restores67.push(()=>app.authController.restoreMasterKeys=restore);
		${stage === 'proof' ? `const verify=crypto.subtle.verify;crypto.subtle.verify=async function(...args){const value=await verify.apply(this,args);if(once){once=false;await new Promise(resolve=>window.__authRelease67=resolve);}return value;};window.__restores67.push(()=>crypto.subtle.verify=verify);` : `const read=app.db.getSecurityKey;app.db.getSecurityKey=async function(...args){if(args[0]==='public_key_base64'&&++count===2&&once){once=false;${stage === 'public-key' ? '' : 'const value=await read.apply(this,args);'}await new Promise(resolve=>window.__authRelease67=resolve);${stage === 'public-key' ? '' : 'return value;'}}return read.apply(this,args);};window.__restores67.push(()=>app.db.getSecurityKey=read);`}
	})()`);
	try {
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.waitFor('typeof window.__authRelease67==="function"');
		if (stage === 'public-key') await d.evaluate('(async()=>{const {generateEd25519KeyPair,exportPublicKeyBase64}=await import("./js/crypto.js"),keys=await generateEd25519KeyPair();await window.__yose_app.db.saveSecurityKey("public_key_base64",await exportPublicKeyBase64(keys.publicKey));})()');
		else await d.evaluate('dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));');
		await d.evaluate('window.__authRelease67()'); await flushWorkflow(d);
		assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), true); assert.equal(await d.evaluate('window.__yose_app.privateKey'), null); assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'), false);
		assert.deepEqual(await d.evaluate('({database:window.__unpacked67.dmkRaw.every(byte=>byte===0),private:window.__unpacked67.privateKeyPkcs8.every(byte=>byte===0)})'), { database: true, private: true });
		assert.deepEqual(await rawWorkflow(d), before);
	} finally { await d.evaluate('window.__authRelease67?.()'); }
});
for (const action of ['cancel', 'legacy-cleanup', 'write-failure']) uiCase67(fixture, `preserves PIN fallback and handles passkey removal ${action} through the real registration and settings UI`, async d => {
	await register67(d);
	if (action === 'legacy-cleanup') await d.evaluate('window.__yose_app.db.mutateMasterConfig(config=>{config.synced_passkey_bundle={legacy:true}})');
	const before = await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'); assert.ok(before);
	if (action === 'cancel') await d.setConfirm(false);
	if (action === 'write-failure') await failNextWrite67(d, 'security_keys');
	await d.click('#btn-clear-webauthn'); await flushWorkflow(d);
	if (action === 'legacy-cleanup') {
		assert.equal(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'), null);
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).synced_passkey_bundle)()'), undefined);
		await unlockWorkflow(d); assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), false);
	} else {
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'), before);
		if (action === 'write-failure') { assert.equal(await d.evaluate('window.__failedWrite67'), true); assert.ok((await d.evaluate('window.__dialogs')).some(item=>/WebAuthn解除エラー/.test(item.message))); }
	}
});

it('reports an initial setup storage failure while keeping the authentication screen active and initialization incomplete', async t => {
	const d = new HeadlessBrowserDriver(); t.after(() => d.close()); await d.launch(); await d.navigate();
	await d.waitFor('document.querySelector("#auth-setup-container").style.display==="block"');
	const before = await d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
	await d.evaluate('(()=>{const db=window.__yose_app.db.db,tx=db.transaction;let once=true;db.transaction=function(...args){const value=tx.apply(this,args);if(once&&args[1]==="readwrite"){once=false;queueMicrotask(()=>value.abort())}return value;};})()');
	await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await d.waitFor('document.querySelector("#auth-error-msg").textContent.includes("初期化エラー")');
	assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'), false); assert.equal(await d.evaluate('window.__yose_app._domInitialized'), false); assert.deepEqual(d.pageErrors, []);
	assert.deepEqual(await d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()'), before, 'the failed first setup write must leave no partial public/PIN keys or business/settings records');
});
