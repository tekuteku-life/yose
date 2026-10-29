import assert from 'node:assert/strict';
import { it } from 'node:test';
import { HeadlessBrowserDriver } from '../helpers/cdp_driver.js';
import { useBrowser } from '../helpers/ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
import { gateMethod, waitGate, releaseGate } from '../helpers/workflow_ui_fixture.js';
const fixture = useBrowser();
const raw = d => d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
async function prepare(d, prf, supportsPrf = true) {
	if (prf) {
		await settings67(d); if (!await d.isVisible('#btn-register-webauthn')) await d.click('#btn-toggle-key-details');
		await d.send('WebAuthn.enable', {}, d.sessionId);
		await d.send('WebAuthn.addVirtualAuthenticator', {options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:supportsPrf}}, d.sessionId);
		await d.evaluate('navigator.credentials.create=options=>CredentialsContainer.prototype.create.call(navigator.credentials,options);navigator.credentials.get=options=>CredentialsContainer.prototype.get.call(navigator.credentials,options)');
		await observeNativeEvent67(d, '#btn-register-webauthn'); await d.click('#btn-register-webauthn'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('(async()=>Boolean((await window.__yose_app.db.getSecurityKey("webauthn_credential")).prfWrap))()'), supportsPrf);
	}
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await observeNativeEvent67(d, prf ? '#btn-auth-webauthn' : '#btn-auth-pin');
}
async function clickUnlock(d, prf) { if (!prf) await d.fill('#auth-pin-input', '1234'); await d.click(prf ? '#btn-auth-webauthn' : '#btn-auth-pin'); }

for (const prf of [false, true]) uiCase67(fixture, `treats the obsolete native ${prf ? 'PRF' : 'PIN'} owned-key epoch failure as cancellation without clearing the newer claim`, async d => {
	await prepare(d, prf); await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig', {afterRead:true});
	try {
		await clickUnlock(d, prf); await waitGate(d);
		await d.evaluate('window.__yose_app.db.setEncryptionKey(window.__yose_app.db.encryptionKey);window.__epochClaim67={key:window.__yose_app.db.encryptionKey,epoch:window.__yose_app.db.keyGeneration,auth:window.__yose_app.authController.authGeneration}');
		const before = await raw(d), error = await d.evaluate('({text:document.querySelector("#auth-error-msg").textContent,display:document.querySelector("#auth-error-msg").style.display})'), count = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.deepEqual(await d.evaluate('({key:window.__yose_app.db.encryptionKey===window.__epochClaim67.key,epoch:window.__yose_app.db.keyGeneration===window.__epochClaim67.epoch,auth:window.__yose_app.authController.authGeneration===window.__epochClaim67.auth})'), {key:true,epoch:true,auth:true});
		assert.deepEqual(await d.evaluate('({text:document.querySelector("#auth-error-msg").textContent,display:document.querySelector("#auth-error-msg").style.display})'), error);
		assert.equal(await d.evaluate('window.__yose_app.privateKey'), null); assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

for (const prf of [false, true]) uiCase67(fixture, `still reports a current native ${prf ? 'PRF' : 'PIN'} AES failure after clearing its own temporary DB key`, async d => {
	await prepare(d, prf);
	await d.evaluate('(async()=>{const db=window.__yose_app.db,c=await import("./js/crypto.js"),record=await db.getRaw("master_config","current"),bytes=c.base64ToBytes(record.ciphertext);bytes[0]^=1;await db.putRaw("master_config",{...record,ciphertext:c.bytesToBase64(bytes)},"current");})()');
	const before = await raw(d); await clickUnlock(d, prf); await d.evaluate('window.__masterNativeJobs67[0]');
	assert.equal(await d.evaluate('document.querySelector("#auth-error-msg").style.display'), 'block');
	assert.match(await d.textContent('#auth-error-msg'), /PIN|復号|失敗/);
	assert.equal(await d.evaluate('window.__yose_app.db.encryptionKey'), null); assert.equal(await d.evaluate('window.__yose_app.privateKey'), null);
	assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), true); assert.deepEqual(await raw(d), before);
});

it('does not turn an obsolete initial-setup restoration into a new lock intent or clear the newer DB key epoch', async t => {
	const d = new HeadlessBrowserDriver(); t.after(() => d.close()); await d.launch(); await d.navigate(); await d.waitFor('document.querySelector("#auth-setup-container").style.display==="block"');
	await d.evaluate('window.__restores67=[];window.__workflowGates=[];window.__workflowGateRestores=[]'); await observeNativeEvent67(d, '#btn-auth-setup'); await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig', {afterRead:true});
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await waitGate(d);
		await d.evaluate('window.__yose_app.db.setEncryptionKey(window.__yose_app.db.encryptionKey);window.__epochClaim67={key:window.__yose_app.db.encryptionKey,epoch:window.__yose_app.db.keyGeneration,auth:window.__yose_app.authController.authGeneration}');
		const before = await raw(d), error = await d.evaluate('({text:document.querySelector("#auth-error-msg").textContent,display:document.querySelector("#auth-error-msg").style.display})');
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.deepEqual(await d.evaluate('({key:window.__yose_app.db.encryptionKey===window.__epochClaim67.key,epoch:window.__yose_app.db.keyGeneration===window.__epochClaim67.epoch,auth:window.__yose_app.authController.authGeneration===window.__epochClaim67.auth})'), {key:true,epoch:true,auth:true});
		assert.deepEqual(await d.evaluate('({text:document.querySelector("#auth-error-msg").textContent,display:document.querySelector("#auth-error-msg").style.display})'), error);
		assert.equal(await d.evaluate('document.querySelector("#btn-auth-setup").disabled'), false); assert.deepEqual(await raw(d), before);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await d.evaluate('window.__workflowGateRestores.reverse().forEach(restore=>restore());window.__restores67.reverse().forEach(restore=>restore())'); }
});

for (const prf of [false, true]) uiCase67(fixture, `does not adopt a later DB epoch from a delayed successful native ${prf ? 'PRF' : 'PIN'} restoration`, async d => {
	await prepare(d, prf); await gateMethod(d, 'window.__yose_app.authController', 'restoreMasterKeys', {afterRead:true});
	try {
		await clickUnlock(d, prf); await waitGate(d);
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'), true);
		await d.evaluate('window.__yose_app.db.setEncryptionKey(window.__yose_app.db.encryptionKey);window.__epochClaim67={key:window.__yose_app.db.encryptionKey,epoch:window.__yose_app.db.keyGeneration,auth:window.__yose_app.authController.authGeneration}');
		const before = await raw(d), state = await d.evaluate('({hidden:document.querySelector("#auth-screen").classList.contains("hidden"),pin:document.querySelector("#auth-pin-input").value,error:document.querySelector("#auth-error-msg").style.display})');
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.deepEqual(await d.evaluate('({hidden:document.querySelector("#auth-screen").classList.contains("hidden"),pin:document.querySelector("#auth-pin-input").value,error:document.querySelector("#auth-error-msg").style.display})'), state);
		assert.deepEqual(await d.evaluate('({key:window.__yose_app.db.encryptionKey===window.__epochClaim67.key,epoch:window.__yose_app.db.keyGeneration===window.__epochClaim67.epoch,auth:window.__yose_app.authController.authGeneration===window.__epochClaim67.auth})'), {key:true,epoch:true,auth:true});
		assert.deepEqual(await raw(d), before);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

uiCase67(fixture, 'does not apply an expired successful no-PRF fallback after the caller DB epoch is cleared', async d => {
	await prepare(d, true, false); await gateMethod(d, 'window.__yose_app.authController', 'unlockWithPasskey', {afterRead:true});
	try {
		await clickUnlock(d, true); await waitGate(d);
		await d.evaluate('window.__yose_app.db.clearEncryptionKey()');
		const description = await d.textContent('#auth-description'), before = await raw(d);
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.textContent('#auth-description'), description); assert.deepEqual(await raw(d), before);
		assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), true);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

it('does not rebase a delayed successful initial restoration onto a later DB epoch before initial business writes', async t => {
	const d = new HeadlessBrowserDriver(); t.after(() => d.close()); await d.launch(); await d.navigate(); await d.waitFor('document.querySelector("#auth-setup-container").style.display==="block"');
	await d.evaluate('window.__restores67=[];window.__workflowGates=[];window.__workflowGateRestores=[]'); await observeNativeEvent67(d, '#btn-auth-setup'); await gateMethod(d, 'window.__yose_app.authController', 'restoreMasterKeys', {afterRead:true});
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await waitGate(d);
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)'), true);
		await d.evaluate('window.__yose_app.db.setEncryptionKey(window.__yose_app.db.encryptionKey)');
		const before = await raw(d);
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.deepEqual(await raw(d), before); assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'), false);
		assert.equal(await d.evaluate('document.querySelector("#btn-auth-setup").disabled'), false);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await d.evaluate('window.__workflowGateRestores.reverse().forEach(restore=>restore());window.__restores67.reverse().forEach(restore=>restore())'); }
});
