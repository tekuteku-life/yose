import assert from 'node:assert/strict';
import { it } from 'node:test';
import { HeadlessBrowserDriver } from '../helpers/cdp_driver.js';
import { useBrowser, value } from '../helpers/ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
import { gateMethod, waitGate, releaseGate } from '../helpers/workflow_ui_fixture.js';
import { holdNativeKeyRegeneration67, finishNativeKeyRegeneration67 } from '../helpers/auth_epoch67.js';
const fixture = useBrowser();
async function conflict(d, start, prefix, success) {
	const alerts = (await d.evaluate(`window.__dialogs.slice(${start})`)).filter(dialog => dialog.type === 'alert').map(dialog => dialog.message);
	assert.ok(alerts.some(message => prefix.test(message) && /競合|変更/.test(message)), 'a current-session CAS conflict must explain the changed key material');
	assert.equal(alerts.some(message => success.test(message)), false);
}
const raw = d => d.evaluate('(async()=>({business:await window.__yose_app.db.captureImportState(),security:await window.__yose_app.db.getAllRaw("security_keys"),settings:await window.__yose_app.db.getAllRaw("settings")}))()');

// A separate native IDB connection represents an independent tab/storage writer.
async function writeForeign(d, entries) {
	await d.evaluate(`(async()=>{const current=window.__yose_app.db.db;const other=await new Promise((resolve,reject)=>{const request=indexedDB.open(current.name,current.version);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});try{await new Promise((resolve,reject)=>{const tx=other.transaction('security_keys','readwrite');tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(tx.error||new Error('FOREIGN_SECURITY_ABORT'));for(const [key,value]of Object.entries(${JSON.stringify(entries)}))tx.objectStore('security_keys').put(value,key);});}finally{other.close();}})()`);
}
async function foreignPair(d, pin = '1234') {
	const entries = await d.evaluate(`(async()=>{const c=await import('./js/crypto.js'),db=window.__yose_app.db,pair=await c.generateEd25519KeyPair(),dmk=db.encryptionKey||await c.generateDatabaseMasterKey();const dmkRaw=await c.exportKeyRaw(dmk),privateKeyPkcs8=await c.exportPrivateKeyPkcs8(pair.privateKey);try{const entries={public_key_base64:await c.exportPublicKeyBase64(pair.publicKey),master_keys_package:await c.encryptMasterKeysWithPin({dmkRaw,privateKeyPkcs8},${JSON.stringify(pin)})};const credential=await db.getSecurityKey('webauthn_credential');if(credential){delete credential.prfWrap;entries.webauthn_credential=credential;}return entries;}finally{dmkRaw.fill(0);privateKeyPkcs8.fill(0);}})()`);
	await writeForeign(d, entries);
}
async function observeSecurityWrite(d, key) {
	await d.evaluate(`(()=>{const db=window.__yose_app.db;let once=true;for(const name of ['saveSecurityKey','deleteSecurityKey','putSecurityKeys']){const original=db[name];db[name]=async function(...args){const match=name==='putSecurityKeys'?(Object.hasOwn(args[0],${JSON.stringify(key)})||(args[2]?.deleteKeys||[]).includes(${JSON.stringify(key)})):args[0]===${JSON.stringify(key)};if(once&&match){once=false;const gate={release:null};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);}return original.apply(this,args);};window.__restores67.push(()=>db[name]=original);}})()`);
}
async function keySettings(d) { await settings67(d); if (!await d.isVisible('#btn-register-webauthn')) await d.click('#btn-toggle-key-details'); }
async function authenticator(d) {
	await d.send('WebAuthn.enable', {}, d.sessionId);
	await d.send('WebAuthn.addVirtualAuthenticator', { options:{ protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true,hasPrf:true } }, d.sessionId);
	await d.evaluate('navigator.credentials.create=options=>CredentialsContainer.prototype.create.call(navigator.credentials,options);navigator.credentials.get=options=>CredentialsContainer.prototype.get.call(navigator.credentials,options)');
}
async function register(d) { await observeNativeEvent67(d, '#btn-register-webauthn'); await d.click('#btn-register-webauthn'); await d.evaluate('window.__masterNativeJobs67[0]'); return d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'); }
async function pinResults(d, pins) {
	await observeNativeEvent67(d, '#btn-auth-pin'); const result = {};
	for (const pin of pins) {
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); const index = await d.evaluate('window.__masterNativeJobs67.length');
		await d.fill('#auth-pin-input', pin); await d.click('#btn-auth-pin'); await d.evaluate(`window.__masterNativeJobs67[${index}]`);
		result[pin] = await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")');
	}
	return result;
}

uiCase67(fixture, 'keeps a completed new PIN when older native regeneration resumes its precommit crypto', async d => {
	try {
		await holdNativeKeyRegeneration67(d); await observeNativeEvent67(d, '#btn-save-pin'); await d.fill('#input-pin', '5678'); await d.click('#btn-save-pin'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('window.__dialogs.some(dialog=>dialog.message.includes("PINコードを正常に更新"))'), true);
		const before = await raw(d), publicKey = await d.evaluate('window.__yose_app.publicKeyBase64'), count = await d.evaluate('window.__dialogs.length');
		await finishNativeKeyRegeneration67(d);
		assert.deepEqual(await raw(d), before); assert.equal(await d.evaluate('window.__yose_app.publicKeyBase64'), publicKey);
		await conflict(d, count, /鍵ペアの再生成に失敗/, /新しいEd25519鍵ペアを生成/);
		assert.deepEqual(await pinResults(d, ['1234','5678']), {1234:false,5678:true});
	} finally { await finishNativeKeyRegeneration67(d); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67||[])'); }
});

uiCase67(fixture, 'rejects a stale-memory PIN package during the explicit postcommit regeneration-response fault model', async d => {
	try {
		await holdNativeKeyRegeneration67(d); await gateMethod(d, 'window.__yose_app.db', 'putSecurityKeys', { afterRead:true });
		await d.evaluate('window.__nativeKeyRelease67()'); await waitGate(d);
		assert.notEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("public_key_base64")'), await d.evaluate('window.__yose_app.publicKeyBase64'));
		await observeNativeEvent67(d, '#btn-save-pin'); const before = await raw(d), count = await d.evaluate('window.__dialogs.length');
		await d.fill('#input-pin', '5678'); await d.click('#btn-save-pin'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.deepEqual(await raw(d), before); assert.equal(await value(d, '#input-pin'), '5678'); assert.equal(await d.evaluate('document.querySelector("#btn-save-pin").disabled'), false);
		await conflict(d, count, /PIN更新に失敗/, /PINコードを正常に更新/);
		await releaseGate(d); await finishNativeKeyRegeneration67(d);
		assert.deepEqual(await raw(d), before); assert.deepEqual(await pinResults(d, ['5678','1234']), {1234:true,5678:false});
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await finishNativeKeyRegeneration67(d); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67||[])'); }
});

uiCase67(fixture, 'does not publish an old PRF registration after an independent native writer replaces its root key pair', async d => {
	await keySettings(d); await authenticator(d); await register(d); await observeNativeEvent67(d, '#btn-register-webauthn'); await observeSecurityWrite(d, 'webauthn_credential');
	try {
		await d.click('#btn-register-webauthn'); await waitGate(d); const generation = await d.evaluate('window.__yose_app.authController.authGeneration');
		await foreignPair(d); const before = await raw(d), count = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('window.__yose_app.authController.authGeneration'), generation); assert.deepEqual(await raw(d), before);
		await conflict(d, count, /WebAuthn登録エラー/, /^パスキーを登録しました/);
		assert.deepEqual(await pinResults(d, ['1234']), {1234:true});
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67||[])'); }
});

uiCase67(fixture, 'does not delete a newer real PRF credential from an independent native storage writer', async d => {
	await keySettings(d); await authenticator(d); const original = await register(d), newer = await register(d);
	assert.notEqual(original.credentialId, newer.credentialId); await writeForeign(d, {webauthn_credential:original});
	await observeNativeEvent67(d, '#btn-clear-webauthn'); await observeSecurityWrite(d, 'webauthn_credential');
	try {
		await d.click('#btn-clear-webauthn'); await waitGate(d); const generation = await d.evaluate('window.__yose_app.authController.authGeneration');
		await writeForeign(d, {webauthn_credential:newer}); const before = await raw(d), count = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('window.__yose_app.authController.authGeneration'), generation); assert.deepEqual(await raw(d), before);
		await conflict(d, count, /WebAuthn解除エラー/, /WebAuthn連携を解除しました/);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await observeNativeEvent67(d, '#btn-auth-webauthn'); await d.click('#btn-auth-webauthn'); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('!window.__yose_app.isKeyLocked&&Boolean(window.__yose_app.privateKey)&&document.querySelector("#auth-screen").classList.contains("hidden")'), true);
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67||[])'); }
});

uiCase67(fixture, 'allows an ordinary native transaction to finish while signing-key generation remains pending', async d => {
	try {
		await holdNativeKeyRegeneration67(d); await d.click('[data-tab="tab-input"]'); await d.fill('#input-amount', '321'); await d.fill('#input-memo', 'NORMAL_DURING_KEY_CAS');
		const account = await value(d, '#select-account'); await observeNativeEvent67(d, '#tx-form', 'submit'); await d.click('#btn-save-tx'); await d.evaluate('window.__masterNativeJobs67[0]');
		const rows = await d.evaluate('window.__yose_app.db.getTransactions()'); assert.equal(rows.length, 1); assert.equal(rows[0].amount, 321); assert.equal(rows[0].account_id, account); assert.equal(rows[0].memo, 'NORMAL_DURING_KEY_CAS');
		assert.equal(await d.evaluate('document.querySelector("#btn-save-tx").disabled'), false); assert.equal(await value(d, '#input-amount'), '');
		await finishNativeKeyRegeneration67(d); assert.deepEqual(await d.evaluate('window.__yose_app.db.getTransactions()'), rows);
	} finally { await finishNativeKeyRegeneration67(d); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67||[])'); }
});

it('retains another native writer initial key pair when the old setup reaches its security commit', async t => {
	const d = new HeadlessBrowserDriver(); t.after(() => d.close()); await d.launch(); await d.navigate(); await d.waitFor('document.querySelector("#auth-setup-container").style.display==="block"');
	await d.evaluate('window.__restores67=[];window.__workflowGates=[]'); await observeNativeEvent67(d, '#btn-auth-setup'); await observeSecurityWrite(d, 'master_keys_package');
	try {
		await d.fill('#auth-setup-pin', '1234'); await d.click('#btn-auth-setup'); await waitGate(d); await foreignPair(d, '5678'); const before = await raw(d);
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.deepEqual(await raw(d), before); assert.equal(await d.evaluate('document.querySelector("#auth-pin-container").style.display'), 'block');
		assert.deepEqual(await pinResults(d, ['1234','5678']), {1234:false,5678:true});
	} finally { await d.evaluate('window.__workflowGates.forEach(g=>g.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67||[])'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
});
