import assert from 'node:assert/strict';

/** Hold actual Ed25519 generation after a native key-regeneration intent changes authentication. */
export async function holdNativeKeyRegeneration67(d) {
	await d.click('[data-tab="tab-settings"]');
	if (await d.evaluate('document.querySelector("#btn-generate-key").offsetParent===null')) await d.click('#btn-toggle-key-details');
	await d.evaluate(`(()=>{
		const generate=crypto.subtle.generateKey,owner=window.__yose_app.authController,original=owner.generateNewKeyPair;let once=true;
		crypto.subtle.generateKey=async function(...args){const result=await generate.apply(this,args);if(once&&args[0]?.name==='Ed25519'){once=false;await new Promise(resolve=>window.__nativeKeyRelease67=resolve);}return result;};
		owner.generateNewKeyPair=function(...args){return window.__nativeKeyJob67=original.apply(this,args);};
		window.__restoreNativeKey67=()=>{crypto.subtle.generateKey=generate;owner.generateNewKeyPair=original;};
		window.__nextPromptText='1234';
		window.__nativeKeyBefore67={auth:owner.authGeneration,db:window.__yose_app.db.keyGeneration,key:window.__yose_app.db.encryptionKey,privateKey:owner.privateKey};
	})()`);
	await d.click('#btn-generate-key');
	await d.waitFor('typeof window.__nativeKeyRelease67==="function"');
	const state=await d.evaluate('({before:{auth:window.__nativeKeyBefore67.auth,db:window.__nativeKeyBefore67.db},auth:window.__yose_app.authController.authGeneration,db:window.__yose_app.db.keyGeneration,keySame:window.__yose_app.db.encryptionKey===window.__nativeKeyBefore67.key,privateSame:window.__yose_app.privateKey===window.__nativeKeyBefore67.privateKey})');
	assert.equal(state.auth,state.before.auth+1);
	assert.equal(state.db,state.before.db);
	assert.equal(state.keySame,true);
	assert.equal(state.privateSame,true);
}

export async function finishNativeKeyRegeneration67(d) {
	await d.evaluate('(async()=>{try{window.__nativeKeyRelease67?.();await window.__nativeKeyJob67;}finally{window.__restoreNativeKey67?.();}})()');
}
