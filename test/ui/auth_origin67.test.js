import assert from 'node:assert/strict';
import { useBrowser, value, seed, transaction } from '../helpers/ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
import { gateMethod, waitGate, releaseGate, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
import { holdNativeKeyRegeneration67, finishNativeKeyRegeneration67 } from '../helpers/auth_epoch67.js';
const fixture = useBrowser();
const raw = d => d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
async function freshSettings(d) { const start = await d.evaluate('window.__workflowJobs.length'); await d.click('[data-tab="tab-settings"]'); await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(j=>j.promise))`); if (!await d.isVisible('#btn-register-webauthn')) await d.click('#btn-toggle-key-details'); }
async function authenticator(d) {
	await d.send('WebAuthn.enable', {}, d.sessionId);
	await d.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }, d.sessionId);
	await d.evaluate('navigator.credentials.create=options=>CredentialsContainer.prototype.create.call(navigator.credentials,options);navigator.credentials.get=options=>CredentialsContainer.prototype.get.call(navigator.credentials,options)');
}

uiCase67(fixture, 'does not reopen a stale lock screen or notify after a newer native PIN unlock completed', async d => {
	await gateMethod(d, 'window.__yose_app.db', 'getSecurityKey', { afterRead: true });
	try {
		await d.evaluate('void(window.__oldLock67=window.__yose_app.authController.lockPrivateKey())'); await waitGate(d);
		await unlockWorkflow(d);
		await d.fill('#input-memo', 'new unlock draft');
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__oldLock67');
		assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'), true);
		assert.equal(await value(d, '#input-memo'), 'new unlock draft');
		assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), false);
		assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__oldLock67])'); }
});

uiCase67(fixture, 'silences an obsolete native key-regeneration failure after a new PIN session without changing keys or draft', async d => {
	try {
		await holdNativeKeyRegeneration67(d); await unlockWorkflow(d);
		await d.fill('#input-memo', 'new key-session draft');
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await finishNativeKeyRegeneration67(d);
		assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
		assert.equal(await value(d, '#input-memo'), 'new key-session draft'); assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), false);
	} finally { await finishNativeKeyRegeneration67(d); }
});

uiCase67(fixture, 'captures passkey registration before its first awaited unlock check and never adopts the later PIN session', async d => {
	await settings67(d); await freshSettings(d); await authenticator(d);
	await observeNativeEvent67(d, '#btn-register-webauthn');
	await gateMethod(d, 'window.__yose_app.authController', 'ensureKeyUnlocked', { afterRead: true });
	try {
		await d.click('#btn-register-webauthn'); await waitGate(d);
		await unlockWorkflow(d); await freshSettings(d);
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length'), auth = await d.evaluate('window.__yose_app.authController.authGeneration');
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('window.__yose_app.authController.authGeneration'), auth, 'an expired old registration must not start a fresh intent in the new session');
		assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

uiCase67(fixture, 'does not delete the newly registered passkey when an old native removal reaches its security write after reauthentication', async d => {
	await settings67(d); await freshSettings(d); await authenticator(d);
	await observeNativeEvent67(d, '#btn-register-webauthn'); await d.click('#btn-register-webauthn'); await d.evaluate('window.__masterNativeJobs67[0]');
	await observeNativeEvent67(d, '#btn-clear-webauthn');
	await gateMethod(d, 'window.__yose_app.db', 'putSecurityKeys');
	try {
		await d.click('#btn-clear-webauthn'); await waitGate(d);
		await d.evaluate('void(window.__oldClear67=window.__masterNativeJobs67[0])');
		assert.deepEqual(await d.evaluate('window.__workflowGates[0].args[2].deleteKeys'), ['webauthn_credential', 'webauthn_vault']);
		await unlockWorkflow(d); await freshSettings(d);
		await observeNativeEvent67(d, '#btn-register-webauthn'); await d.click('#btn-register-webauthn'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.ok(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'));
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__oldClear67');
		assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__oldClear67,...(window.__masterNativeJobs67||[])])'); }
});

for (const succeeded of [false, true]) uiCase67(fixture, `keeps the newer authentication gate unchanged after an obsolete native PIN ${succeeded ? 'success' : 'failure'}`, async d => {
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await observeNativeEvent67(d, '#btn-auth-pin');
	await gateMethod(d, succeeded ? 'window.__yose_app.authController' : 'window.__yose_app.db', succeeded ? 'restoreMasterKeys' : 'getSecurityKey', { afterRead: true });
	try {
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await waitGate(d);
		await d.evaluate('void(window.__oldUnlock67=window.__masterNativeJobs67[0])');
		if (succeeded) { await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await d.fill('#auth-pin-input', '9999'); }
		else { await unlockWorkflow(d); await d.fill('#input-memo', 'new successful PIN draft'); }
		const before = await raw(d), state = await d.evaluate('({hidden:document.querySelector("#auth-screen").classList.contains("hidden"),pin:document.querySelector("#auth-pin-input").value,error:document.querySelector("#auth-error-msg").style.display,locked:window.__yose_app.isKeyLocked})');
		await releaseGate(d); await d.evaluate('window.__oldUnlock67');
		assert.deepEqual(await d.evaluate('({hidden:document.querySelector("#auth-screen").classList.contains("hidden"),pin:document.querySelector("#auth-pin-input").value,error:document.querySelector("#auth-error-msg").style.display,locked:window.__yose_app.isKeyLocked})'), state);
		assert.deepEqual(await raw(d), before);
		if (!succeeded) assert.equal(await value(d, '#input-memo'), 'new successful PIN draft');
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__oldUnlock67,...(window.__masterNativeJobs67||[])])'); }
});

uiCase67(fixture, 'rejects unavailable passkey registration without taking ownership from a pending native PIN unlock', async d => {
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await observeNativeEvent67(d, '#btn-auth-pin');
	await gateMethod(d, 'window.__yose_app.db', 'getSecurityKey', { afterRead: true });
	try {
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await waitGate(d);
		const generation = await d.evaluate('window.__yose_app.authController.authGeneration');
		const rejected = await d.evaluate('(async()=>{try{await window.__yose_app.authController.registerPasskey();return false;}catch(error){return /ロック|認証/.test(error.message);}})()');
		const preserved = await d.evaluate(`window.__yose_app.authController.authGeneration===${generation}`);
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(rejected, true); assert.equal(preserved, true);
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")'), true);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

uiCase67(fixture, 'keeps the newer native PIN restoration and its key claim when the old owned-DMK read completes', async d => {
	await seed(d, [transaction('owned-dmk-kept67', {sync_status:'synced'})]);
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await observeNativeEvent67(d, '#btn-auth-pin');
	await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig', { afterRead: true });
	try {
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await waitGate(d);
		assert.equal(await d.evaluate('window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.db.encryptionKey)&&window.__yose_app.privateKey===null'), true);
		await d.evaluate('void(window.__candidateKey67=window.__yose_app.db.encryptionKey)');
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.evaluate('window.__masterNativeJobs67[1]');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&window.__yose_app.db.encryptionKey!==window.__candidateKey67'), true);
		await d.fill('#input-memo', 'new owned DMK draft');
		await d.evaluate('window.__newClaim67={key:window.__yose_app.db.encryptionKey,epoch:window.__yose_app.db.keyGeneration,privateKey:window.__yose_app.privateKey}');
		const before = await raw(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.deepEqual(await d.evaluate('({key:window.__yose_app.db.encryptionKey===window.__newClaim67.key,epoch:window.__yose_app.db.keyGeneration===window.__newClaim67.epoch,private:window.__yose_app.privateKey===window.__newClaim67.privateKey,unlocked:!window.__yose_app.isKeyLocked,hidden:document.querySelector("#auth-screen").classList.contains("hidden")})'), {key:true,epoch:true,private:true,unlocked:true,hidden:true});
		assert.equal(await value(d, '#input-memo'), 'new owned DMK draft'); assert.deepEqual(await raw(d), before); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

uiCase67(fixture, 'hides the successfully unlocked PIN gate while the actual view metadata refresh remains pending', async d => {
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await observeNativeEvent67(d, '#btn-auth-pin');
	await gateMethod(d, 'window.__yose_app.db', 'getDataMetadata', { afterRead: true });
	try {
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await waitGate(d);
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")'), true);
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('document.querySelectorAll("#data-metadata li").length'), 5);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

uiCase67(fixture, 'rejects an unavailable clear component without confirming or taking ownership from a pending native PIN unlock', async d => {
	await settings67(d); await freshSettings(d); await authenticator(d);
	await observeNativeEvent67(d, '#btn-register-webauthn'); await d.click('#btn-register-webauthn'); await d.evaluate('window.__masterNativeJobs67[0]');
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await observeNativeEvent67(d, '#btn-auth-pin'); await gateMethod(d, 'window.__yose_app.db', 'getSecurityKey', {afterRead:true});
	try {
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await waitGate(d);
		await d.evaluate('void(window.__pendingClearPin67=window.__masterNativeJobs67[0])');
		const generation = await d.evaluate('window.__yose_app.authController.authGeneration'), before = await raw(d), count = await d.evaluate('window.__dialogs.length');
		await observeNativeEvent67(d, '#btn-clear-webauthn');
		await d.evaluate('document.querySelector("#btn-clear-webauthn").addEventListener("click",event=>window.__clearComponentTrusted67=event.isTrusted,{once:true})');
		// This is the real component listener boundary; the locked page correctly blocks trusted background pointer clicks.
		await d.evaluate('document.querySelector("#btn-clear-webauthn").click()');
		assert.equal(await d.evaluate('window.__masterNativeJobs67.length'), 1); assert.equal(await d.evaluate('window.__clearComponentTrusted67'), false);
		assert.equal(await d.evaluate('typeof window.__masterNativeJobs67[0]?.then'), 'function'); await d.evaluate('window.__masterNativeJobs67[0]');
		const ownerKept = await d.evaluate(`window.__yose_app.authController.authGeneration===${generation}`);
		await releaseGate(d); await d.evaluate('window.__pendingClearPin67');
		assert.equal(ownerKept, true); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`), []); assert.deepEqual(await raw(d), before);
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")'), true);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled([window.__pendingClearPin67,...(window.__masterNativeJobs67||[])])'); }
});

uiCase67(fixture, 'keeps the real lock intent when clear confirmation returns after authentication was invalidated', async d => {
	await settings67(d); await freshSettings(d); await authenticator(d);
	await observeNativeEvent67(d, '#btn-register-webauthn'); await d.click('#btn-register-webauthn'); await d.evaluate('window.__masterNativeJobs67[0]');
	await observeNativeEvent67(d, '#btn-clear-webauthn'); const before = await raw(d), generation = await d.evaluate('window.__yose_app.authController.authGeneration');
	await d.evaluate(`(()=>{const confirm=window.confirm;let once=true;window.confirm=function(message){const answer=confirm.call(this,message);if(once){once=false;window.__clearConfirmLock67=window.__yose_app.authController.lockPrivateKey();}return answer;};window.__restores67.push(()=>window.confirm=confirm);})()`);
	try {
		await d.click('#btn-clear-webauthn'); await d.evaluate('Promise.all([window.__masterNativeJobs67[0],window.__clearConfirmLock67])');
		assert.equal(await d.evaluate('window.__yose_app.authController.authGeneration'), generation + 1, 'only the actual lock intent may advance authentication');
		assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), true); assert.deepEqual(await raw(d), before);
		assert.equal(await d.evaluate('window.__dialogs.some(dialog=>dialog.message.includes("WebAuthn連携を解除しました"))'), false);
	} finally { await d.evaluate('Promise.allSettled([window.__clearConfirmLock67,...(window.__masterNativeJobs67||[])])'); }
});
