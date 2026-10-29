import assert from 'node:assert/strict';
import { useBrowser, value } from '../helpers/ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
import { gateMethod, waitGate, releaseGate, flushWorkflow } from '../helpers/workflow_ui_fixture.js';
import { holdNativeKeyRegeneration67, finishNativeKeyRegeneration67 } from '../helpers/auth_epoch67.js';
const fixture = useBrowser();

uiCase67(fixture, 'rejects the old PIN package atomically after native signing-key replacement and preserves an unlockable key pair', async d => {
	await settings67(d);
	const business = await d.evaluate('window.__yose_app.db.captureImportState()');
	try {
		await holdNativeKeyRegeneration67(d);
		await observeNativeEvent67(d, '#btn-save-pin');
		await gateMethod(d, 'window.__yose_app.db', 'saveSecurityKey');
		await d.fill('#input-pin', '5678'); await d.click('#btn-save-pin'); await waitGate(d);
		await d.evaluate('void(window.__oldPinJob67=window.__masterNativeJobs67[0])');
		assert.equal(await d.evaluate('window.__workflowGates[0].args[0]'), 'master_keys_package');
		assert.equal(await d.evaluate('typeof window.__workflowGates[0].args[2]?.isSessionValid'), 'function', 'the same session predicate must reach the atomic DB writer');
		assert.equal(await d.evaluate('window.__workflowGates[0].args[2].isSessionValid()'), true);
		await d.evaluate('window.__pinStart67={auth:window.__yose_app.authController.authGeneration,db:window.__yose_app.db.keyGeneration,privateKey:window.__yose_app.privateKey}');
		await finishNativeKeyRegeneration67(d);
		assert.deepEqual(await d.evaluate('({authSame:window.__pinStart67.auth===window.__yose_app.authController.authGeneration,dbSame:window.__pinStart67.db===window.__yose_app.db.keyGeneration,privateSame:window.__pinStart67.privateKey===window.__yose_app.privateKey})'), { authSame: true, dbSame: true, privateSame: false });
		const expectedKeys = await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")');
		const dialogStart = await d.evaluate('window.__dialogs.length');
		const atomicValid = await d.evaluate('window.__workflowGates[0].args[2].isSessionValid()');
		await releaseGate(d); await d.evaluate('window.__oldPinJob67');
		const keys = await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")');
		const draft = await value(d, '#input-pin');
		const disabled = await d.evaluate('document.querySelector("#btn-save-pin").disabled');
		const notices = await d.evaluate(`window.__dialogs.slice(${dialogStart})`);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		await observeNativeEvent67(d, '#btn-auth-pin');
		await d.fill('#auth-pin-input', '5678'); await d.click('#btn-auth-pin'); await d.evaluate('window.__masterNativeJobs67[0]');
		const wrongPinLocked = await d.evaluate('window.__yose_app.isKeyLocked&&window.__yose_app.db.encryptionKey===null');
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.evaluate('window.__masterNativeJobs67[1]'); await flushWorkflow(d);
		const originalPinUnlocked = await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")');
		assert.equal(atomicValid, false, 'private-key replacement alone must invalidate the predicate already passed into DB');
		assert.deepEqual(keys, expectedKeys, 'an obsolete PIN package must not overwrite the new signing key package');
		assert.equal(draft, '5678'); assert.equal(disabled, false); assert.deepEqual(notices, []);
		assert.equal(wrongPinLocked, true); assert.equal(originalPinUnlocked, true, 'the PIN used for regeneration must still unlock the matching signing/public keys');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'), business);
	} finally {
		await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())');
		await finishNativeKeyRegeneration67(d);
		await d.evaluate('Promise.allSettled([window.__oldPinJob67,...(window.__masterNativeJobs67||[])])');
	}
});
