import assert from 'node:assert/strict';
import { useBrowser, value } from '../helpers/ui_fixture.js';
import { gateMethod, waitGate, releaseGate, flushWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
const fullRaw67 = d => d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');
async function freshSettings67(d) {
	const start = await d.evaluate('window.__workflowJobs.length'); await d.click('.tab-btn[data-tab="tab-settings"]');
	await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`);
}
async function unlockPin67(d, pin) {
	await d.evaluate('(()=>{const app=window.__yose_app,original=app.finishAppInit;window.__newPinReady67=null;app.finishAppInit=function(...args){const pending=original.apply(this,args);window.__newPinReady67=pending;return pending;};window.__restores67.push(()=>app.finishAppInit=original);})()');
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await d.fill('#auth-pin-input', pin); await d.click('#btn-auth-pin');
	await d.waitFor('Boolean(window.__newPinReady67)'); await d.evaluate('window.__newPinReady67');
}
for (const concurrent of [false, true]) uiCase67(fixture, `discards an old GAS URL save after PIN unlock${concurrent ? ' without releasing the newer pending save owner' : ' while preserving the new URL draft and manager'}`, async d => {
	await settings67(d); await d.fill('#input-gas-url', 'https://old-session67.example/exec'); await observeNativeEvent67(d, '#btn-save-gas-url');
	await gateMethod(d, 'window.__yose_app.db', 'setSetting');
	try {
		await d.click('#btn-save-gas-url'); await waitGate(d); await unlockWorkflow(d); await freshSettings67(d);
		await d.evaluate('window.__newUrlManager67=window.__yose_app.syncManager'); await d.fill('#input-gas-url', 'https://new-session67.example/exec');
		const before = await fullRaw67(d), dialogs = await d.evaluate('window.__dialogs.length');
		if (concurrent) {
			assert.equal(await d.evaluate('document.querySelector("#btn-save-gas-url").disabled'), false, 'authentication cancellation must release the old URL button');
			await gateMethod(d, 'window.__yose_app.db', 'setSetting'); await d.click('#btn-save-gas-url'); await waitGate(d, 2);
		}
		await releaseGate(d, 0); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.deepEqual(await fullRaw67(d), before, 'obsolete URL input must not become a new-session settings write');
		assert.equal(await value(d, '#input-gas-url'), 'https://new-session67.example/exec');
		assert.equal(await d.evaluate('window.__yose_app.syncManager===window.__newUrlManager67'), true);
		assert.equal(await d.evaluate('window.__newUrlManager67.gasUrl'), ''); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
		if (concurrent) {
			assert.equal(await d.evaluate('document.querySelector("#btn-save-gas-url").disabled'), true);
			assert.equal(await d.evaluate('window.__yose_app.settingsController.savingGasUrl'), true);
			await releaseGate(d, 1); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await flushWorkflow(d);
			assert.equal(await d.evaluate('window.__yose_app.db.getSetting("gas_url")'), 'https://new-session67.example/exec');
			assert.equal(await d.evaluate('window.__newUrlManager67.gasUrl'), 'https://new-session67.example/exec');
		}
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

for (const stage of ['encryption', 'committed']) uiCase67(fixture, `keeps the new PIN draft and silences the obsolete PIN save at its ${stage} boundary`, async d => {
	await settings67(d); if (!await d.isVisible('#input-pin')) await d.click('#btn-toggle-key-details'); await d.fill('#input-pin', '5678'); await observeNativeEvent67(d, '#btn-save-pin');
	await gateMethod(d, stage === 'encryption' ? 'crypto.subtle' : 'window.__yose_app.db', stage === 'encryption' ? 'encrypt' : 'saveSecurityKey', { afterRead: true });
	try {
		await d.click('#btn-save-pin'); await waitGate(d);
		if (stage === 'encryption') await unlockWorkflow(d); else await unlockPin67(d, '5678');
		await freshSettings67(d); if (!await d.isVisible('#input-pin')) await d.click('#btn-toggle-key-details'); await d.fill('#input-pin', '8765');
		const before = await fullRaw67(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); assert.equal(await d.evaluate('typeof window.__masterNativeJobs67[0]?.then'), 'function'); await d.evaluate('window.__masterNativeJobs67[0]'); await flushWorkflow(d);
		assert.deepEqual(await fullRaw67(d), before); assert.equal(await value(d, '#input-pin'), '8765');
		assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), [], 'an old PIN failure or committed completion must not notify the newly unlocked session');
		assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), false);
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});
