import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, settings, waitForDialog } from '../helpers/ui_fixture.js';
import { observeNativeEvent67 } from '../helpers/ui_workflows67.js';

const fixture = useBrowser();
async function authenticator(d, prf = true) {
	await d.send('WebAuthn.enable', {}, d.sessionId);
	await d.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true, hasPrf: prf } }, d.sessionId);
	await nativeCredentials(d);
}
async function nativeCredentials(d) {
	await d.evaluate(`navigator.credentials.create = options => CredentialsContainer.prototype.create.call(navigator.credentials, options);
		navigator.credentials.get = options => CredentialsContainer.prototype.get.call(navigator.credentials, options);`);
}
async function register(d) {
	await settings(d);
	if (!await d.isVisible('#btn-register-webauthn')) await d.click('#btn-toggle-key-details');
	await d.click('#btn-register-webauthn'); await waitForDialog(d, '登録しました');
}
async function lock(d) {
	if (!await d.isVisible('#btn-lock-now')) await d.click('#btn-toggle-key-details');
	await d.click('#btn-lock-now');
	await d.waitFor('!document.getElementById("auth-screen").classList.contains("hidden")');
}
async function pin(d, value = '1234') {
	await d.fill('#auth-pin-input', value); await d.click('#btn-auth-pin');
	await d.waitFor('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden")');
}

// Observe the real initialization promise; an already initialized DOM is not a ready unlocked view.
async function observeAppInit(d) {
	await d.evaluate(`{
		const app=window.__yose_app;
		window.__prfInitOriginal=app.finishAppInit;
		window.__prfInitPromise=null;
		app.finishAppInit=(...args)=>{const pending=window.__prfInitOriginal.apply(app,args);window.__prfInitPromise=pending;return pending;};
	}`);
}
async function awaitAppInit(d) {
	await d.waitFor('Boolean(window.__prfInitPromise) && document.getElementById("auth-screen").classList.contains("hidden")');
	await d.evaluate('(async()=>{try{await window.__prfInitPromise;}finally{window.__yose_app.finishAppInit=window.__prfInitOriginal;}})()');
}

describe('PRF passkey unlock in Chromium', () => {
	for (const attempt of ['cancel', 'wrong-pin']) it(`keeps the existing keys and never reports successful regeneration on ${attempt}`, async () => {
		const d=fixture.driver; await seed(d,[transaction('kept')]); await authenticator(d); await register(d);
		const before=await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")');
		await d.evaluate(`window.__dialogs=[];window.__nextPromptText=${attempt === 'cancel' ? 'null' : '"wrong-pin"'};`);
		await d.click('#btn-generate-key'); await waitForDialog(d, attempt === 'cancel' ? '中止しました' : '再生成に失敗');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'),before);
		const alerts=(await d.evaluate('window.__dialogs')).filter(dialog=>dialog.type==='alert');
		assert.equal(alerts.some(dialog=>/新しい.*鍵ペアを生成/.test(dialog.message)),false,'an unsuccessful attempt must not display success');
		await lock(d); await d.click('#btn-auth-webauthn'); await d.waitFor('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden")');
		assert.equal((await records(d))[0].id,'kept');
	});
	it('unlocks encrypted records without entering PIN, including after a reload, and removes the passkey cleanly', async () => {
		const d = fixture.driver; await seed(d, [transaction('encrypted_record')]); await authenticator(d); await register(d);
		const saved = await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")');
		assert.ok(saved.prfWrap?.ciphertext); assert.equal(saved.prfOutput, undefined);
		await lock(d); assert.match(await d.textContent('#btn-auth-webauthn'), /解除/);
		await observeAppInit(d); await d.click('#btn-auth-webauthn'); await awaitAppInit(d);
		assert.equal((await records(d))[0].id, 'encrypted_record');
		assert.equal(await d.evaluate('document.getElementById("auth-pin-input").value'), '');
		await d.evaluate('window.__passkeyReloadPending=true');
		await d.send('Page.reload', {}, d.sessionId); await d.waitFor('!window.__passkeyReloadPending && !document.getElementById("auth-screen")?.classList.contains("hidden") && document.getElementById("auth-webauthn-container")?.style.display === "block"');
		await nativeCredentials(d); await observeAppInit(d); await d.click('#btn-auth-webauthn');
		await awaitAppInit(d);
		assert.equal((await records(d))[0].amount, 100);
		await settings(d); await d.waitFor('document.querySelector("#tab-settings").classList.contains("active") && document.querySelector("#btn-toggle-key-details").checkVisibility({checkVisibilityCSS:true}) && !document.querySelector("#btn-toggle-key-details").disabled'); await d.click('#btn-toggle-key-details'); await d.waitFor('document.querySelector("#btn-clear-webauthn").checkVisibility({checkVisibilityCSS:true}) && !document.querySelector("#btn-clear-webauthn").disabled'); await d.click('#btn-clear-webauthn'); await waitForDialog(d, '解除しました');
		assert.equal(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'), null);
		await lock(d); assert.equal(await d.isVisible('#btn-auth-webauthn'), false); await pin(d);
	});
	it('retains PIN fallback when PRF is unavailable', async () => {
		const d = fixture.driver; await authenticator(d, false); await register(d);
		assert.equal(await d.evaluate('(async () => Boolean((await window.__yose_app.db.getSecurityKey("webauthn_credential")).prfWrap))()'), false);
		await lock(d); await d.click('#btn-auth-webauthn');
		await d.waitFor('document.getElementById("auth-description").textContent.includes("PINを入力")');
		assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'), false); await pin(d);
	});
	for (const failure of ['cancel', 'missing-prf', 'tampered-wrap']) it(`keeps data locked on ${failure} and still accepts PIN`, async () => {
		const d = fixture.driver; await seed(d, [transaction('kept')]); await authenticator(d); await register(d);
		if (failure === 'tampered-wrap') await d.evaluate(`(async () => { const db=window.__yose_app.db; const c=await db.getSecurityKey('webauthn_credential'); c.prfWrap.ciphertext='invalid'; await db.saveSecurityKey('webauthn_credential',c); })()`);
		await lock(d);
		if (failure === 'cancel') await d.evaluate(`navigator.credentials.get=async()=>{throw new DOMException('cancel','NotAllowedError');};`);
		if (failure === 'missing-prf') await d.evaluate(`navigator.credentials.get=async options=>{ const c=await CredentialsContainer.prototype.get.call(navigator.credentials,options); c.getClientExtensionResults=()=>({}); return c; };`);
		await d.click('#btn-auth-webauthn'); await d.waitFor('document.getElementById("auth-error-msg").style.display === "block"');
		assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'), false);
		assert.equal(await d.evaluate('(async()=> (await import("./js/crypto.js")).hasActiveSession())()'), false);
		await pin(d); assert.equal((await records(d))[0].id, 'kept');
	});
	it('preserves the old registration if registration is cancelled or the app is locked while waiting', async () => {
		const d=fixture.driver; await authenticator(d); await register(d);
		const original=await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")');
		await d.evaluate(`navigator.credentials.create=async()=>{throw new DOMException('cancel','NotAllowedError');};`);
		await d.click('#btn-register-webauthn'); await waitForDialog(d, 'WebAuthn登録エラー');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'), original);
		await d.evaluate(`window.__createdUserHandles=[]; navigator.credentials.create=options=>{window.__createdUserHandles.push(Array.from(options.publicKey.user.id));return CredentialsContainer.prototype.create.call(navigator.credentials,options);};`);
		await d.evaluate(`navigator.credentials.get=async options=> { const c=await CredentialsContainer.prototype.get.call(navigator.credentials,options); await window.__yose_app.authController.lockPrivateKey(); return c; };`);
		await d.click('#btn-register-webauthn'); await waitForDialog(d, 'WebAuthn登録エラー');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'), original);
		assert.notEqual(await d.evaluate('btoa(String.fromCharCode(...window.__createdUserHandles[0]))'),original.userHandle);
		await nativeCredentials(d); await d.click('#btn-auth-webauthn');
		await d.waitFor('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden")');
	});
	it('recovers the committed signing keys with PIN after locking immediately after their transaction commits', async () => {
		const d=fixture.driver; await authenticator(d); await register(d);
		const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),previous=await d.evaluate('window.__yose_app.db.getSecurityKey("public_key_base64")'),count=await d.evaluate('window.__dialogs.length');
		await d.evaluate(`(()=>{window.__restores67=[];const db=window.__yose_app.db,commit=db.putSecurityKeys;db.putSecurityKeys=async function(...args){const result=await commit.apply(this,args);window.__yose_app.authController.invalidateSession();return result;};window.__restores67.push(()=>db.putSecurityKeys=commit);window.__nextPromptText='1234';})()`);
		await observeNativeEvent67(d,'#btn-generate-key');
		try {
			await d.click('#btn-generate-key'); assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1); await d.evaluate('window.__masterNativeJobs67[0]');
			assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'),false); assert.equal(await d.evaluate('window.__yose_app.privateKey'),null);
			assert.notEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("public_key_base64")'),previous);
			assert.equal(await d.evaluate('(async()=>Boolean((await window.__yose_app.db.getSecurityKey("webauthn_credential")).prfWrap))()'),false);
			assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
			assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count}).filter(dialog=>dialog.type==='alert')`),[],'old regeneration completion must suppress notifications and retain the committed pair');
			await d.evaluate('window.__yose_app.authController.showLockScreen()'); await observeAppInit(d); await pin(d); await awaitAppInit(d);
			assert.equal(await d.evaluate('(async()=>window.__yose_app.publicKeyBase64===await window.__yose_app.db.getSecurityKey("public_key_base64"))()'),true);
			assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
		} finally { await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
	});
	it('keeps a committed PIN change locked when the session is invalidated immediately after saving', async () => {
		const d=fixture.driver; await settings(d); await d.click('#btn-toggle-key-details');
		const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),previous=await d.evaluate('window.__yose_app.db.getSecurityKey("master_keys_package")'),publicKey=await d.evaluate('window.__yose_app.db.getSecurityKey("public_key_base64")'),count=await d.evaluate('window.__dialogs.length');
		await d.evaluate(`(()=>{window.__restores67=[];const app=window.__yose_app,db=app.db,save=db.saveSecurityKey;db.saveSecurityKey=async function(...args){const result=await save.apply(this,args);if(args[0]==='master_keys_package')app.authController.invalidateSession();return result;};window.__restores67.push(()=>db.saveSecurityKey=save);})()`);
		await observeNativeEvent67(d,'#btn-save-pin');
		try {
			await d.fill('#input-pin','5678'); await d.click('#btn-save-pin');
			assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1); await d.evaluate('Promise.all(window.__masterNativeJobs67)');
			assert.equal(await d.evaluate('window.__yose_app.authController.isKeyLocked'),true);
			assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'),false); assert.equal(await d.evaluate('window.__yose_app.privateKey'),null);
			assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw); assert.notDeepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("master_keys_package")'),previous); assert.equal(await d.evaluate('window.__yose_app.db.getSecurityKey("public_key_base64")'),publicKey);
			assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[],'obsolete PIN completion must preserve its committed package and suppress the old success notification');
			await d.evaluate('window.__yose_app.authController.showLockScreen()'); await pin(d,'5678');
		} finally { await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
	});
	for (const failure of ['get-cancel', 'save-failure']) it(`keeps the prior registration usable after a replacement ${failure}`, async () => {
		const d=fixture.driver; await authenticator(d); await register(d);
		const original=await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")');
		if (failure==='get-cancel') await d.evaluate(`navigator.credentials.get=async()=>{throw new DOMException('cancel','NotAllowedError');};`);
		else await d.evaluate(`const db=window.__yose_app.db; window.__saveSecurityKey=db.saveSecurityKey.bind(db); db.saveSecurityKey=async(key,...args)=>{if(key==='webauthn_credential') throw new Error('保存失敗'); return window.__saveSecurityKey(key,...args);};`);
		await d.click('#btn-register-webauthn'); await waitForDialog(d,'WebAuthn登録エラー');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'),original);
		if (failure==='save-failure') await d.evaluate('window.__yose_app.db.saveSecurityKey=window.__saveSecurityKey');
		await nativeCredentials(d); await lock(d); await d.click('#btn-auth-webauthn');
		await d.waitFor('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden")');
	});
	for (const action of ['relock','unregister']) it(`rejects a delayed assertion after ${action}`, async () => {
		const d=fixture.driver; await authenticator(d); await register(d); await lock(d);
		await d.evaluate(`(()=>{window.__restores67=[];const get=navigator.credentials.get;navigator.credentials.get=async options=>{const c=await CredentialsContainer.prototype.get.call(navigator.credentials,options);await new Promise(resolve=>window.__finishAssertion=resolve);return c;};window.__restores67.push(()=>navigator.credentials.get=get);})()`);
		await observeNativeEvent67(d,'#btn-auth-webauthn');
		try {
			await d.click('#btn-auth-webauthn'); await d.waitFor('typeof window.__finishAssertion === "function"');
			if (action==='relock') await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
			else await d.evaluate('window.__yose_app.db.deleteSecurityKey("webauthn_credential")');
			const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),keys=await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'),count=await d.evaluate('window.__dialogs.length'),error=await d.evaluate('({display:document.querySelector("#auth-error-msg").style.display,text:document.querySelector("#auth-error-msg").textContent})');
			await d.evaluate('window.__finishAssertion();window.__masterNativeJobs67[0]');
			if(action==='relock') {
				assert.deepEqual(await d.evaluate('({display:document.querySelector("#auth-error-msg").style.display,text:document.querySelector("#auth-error-msg").textContent})'),error);
				assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`),[]);
			}else assert.equal(await d.evaluate('document.querySelector("#auth-error-msg").style.display'),'block');
			assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw); assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'),keys);
			assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'),false); assert.equal(await d.evaluate('window.__yose_app.syncManager.privateKey'),null);
			assert.equal(await d.evaluate('(async()=> (await import("./js/crypto.js")).hasActiveSession())()'),false);
			await observeAppInit(d); await pin(d); await awaitAppInit(d);
		} finally { await d.evaluate('window.__finishAssertion?.()'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await d.evaluate('window.__restores67.reverse().forEach(restore=>restore())'); }
	});
	for (const wrong of ['dmk','signing-key']) it(`rejects a decryptable wrap containing a different ${wrong}`, async () => {
		const d=fixture.driver; await seed(d,[transaction('kept')]); await authenticator(d); await register(d);
		await d.evaluate(`(async()=>{
			const c=await import('./js/crypto.js'),app=window.__yose_app,db=app.db,stored=await db.getSecurityKey('webauthn_credential');
			const auth=await c.authenticateWithWebAuthn(stored);
			const dmkRaw=${wrong==='dmk' ? 'crypto.getRandomValues(new Uint8Array(32))' : 'await c.exportKeyRaw(db.encryptionKey)'};
			const privateKeyPkcs8=await c.exportPrivateKeyPkcs8(${wrong==='signing-key' ? '(await c.generateEd25519KeyPair()).privateKey' : 'app.privateKey'});
			stored.prfWrap=await c.encryptMasterKeysWithPrf({dmkRaw,privateKeyPkcs8},auth.prfOutput,stored);
			await db.saveSecurityKey('webauthn_credential',stored);
		})()`);
		await lock(d); await d.click('#btn-auth-webauthn'); await d.waitFor('document.getElementById("auth-error-msg").style.display === "block"');
		assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'),false);
		assert.equal(await d.evaluate('window.__yose_app.syncManager.privateKey'),null);
		assert.equal(await d.evaluate('(async()=> (await import("./js/crypto.js")).hasActiveSession())()'),false);
		await pin(d); assert.equal((await records(d))[0].id,'kept');
	});
	it('waits for the actual unlocked view refresh before clicking keys when metadata is delayed', async () => {
		const d=fixture.driver; await authenticator(d); await register(d);
		await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		await lock(d); await observeAppInit(d);
		await d.evaluate(`{
			const db=window.__yose_app.db, read=db.getDataMetadata.bind(db);let once=true;
			db.getDataMetadata=async(...args)=>{const data=await read(...args);if(once){once=false;await new Promise(r=>window.__prfMetadataRelease=r);}return data;};
		}`);
		try {
		await d.click('#btn-auth-webauthn'); await d.waitFor('typeof window.__prfMetadataRelease==="function"');
		assert.equal(await d.evaluate('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden")'),true);
		assert.equal(await d.textContent('#data-metadata'),'');
		await d.evaluate('window.__prfMetadataRelease()'); await awaitAppInit(d);
		assert.equal(await d.evaluate('document.querySelectorAll("#data-metadata li").length'),5);
		await settings(d); if (!await d.isVisible('#btn-generate-key')) await d.click('#btn-toggle-key-details');
		await d.evaluate('window.__dialogs=[];window.__nextPromptText=null');
		await d.click('#btn-generate-key'); await waitForDialog(d,'再生成を中止しました');
		assert.equal(await d.evaluate('window.__dialogs.some(d=>d.type==="confirm") && window.__dialogs.some(d=>d.type==="prompt")'),true);
		} finally { await d.evaluate('window.__prfMetadataRelease?.()'); await d.evaluate('window.__prfInitPromise'); await d.evaluate('window.__yose_app.finishAppInit=window.__prfInitOriginal'); }
	});
	it('preserves PRF unlock after PIN changes and invalidates it on signing key regeneration', async () => {
		const d=fixture.driver; await authenticator(d); await register(d);
		await d.fill('#input-pin','5678'); await d.click('#btn-save-pin'); await waitForDialog(d,'PINコードを正常に更新');
		await lock(d); await observeAppInit(d); await d.click('#btn-auth-webauthn'); await awaitAppInit(d);
		await settings(d); if (!await d.isVisible('#btn-generate-key')) await d.click('#btn-toggle-key-details');
		await d.evaluate('window.__nextPromptText="5678"');
		await d.click('#btn-generate-key'); await waitForDialog(d,'新しいEd25519鍵ペアを生成し、PINで保護しました。');
		assert.equal(await d.evaluate('(async()=>Boolean((await window.__yose_app.db.getSecurityKey("webauthn_credential")).prfWrap))()'),false);
		await lock(d); await pin(d,'5678');
	});
});
