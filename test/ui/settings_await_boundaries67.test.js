import assert from 'node:assert/strict';
import {useBrowser,transaction} from '../helpers/ui_fixture.js';
import {uiCase67,settings67,observeNativeEvent67} from '../helpers/ui_workflows67.js';
import {allRaw67} from '../helpers/settings_ui67.js';
import {unlockWorkflow,flushWorkflow,gateMethod,waitGate,releaseGate} from '../helpers/workflow_ui_fixture.js';
const fixture=useBrowser();

async function holdResult67(d,owner,name,match='true'){
	await d.evaluate(`(()=>{const owner=${owner},name=${JSON.stringify(name)},original=owner[name];owner[name]=async function(...args){if(!(${match}))return original.apply(this,args);owner[name]=original;const result=await original.apply(this,args);await new Promise(resolve=>window.__settingsRelease67=resolve);return result;};window.__restores67.push(()=>owner[name]=original);})()`);
}
const state67=d=>d.evaluate('({pin:document.querySelector("#input-pin").value,url:document.querySelector("#input-gas-url").value,category:document.querySelector("#select-point-offset-category").value,dirty:window.__yose_app.settingsController.pointDefaultsDirty,dialogs:window.__dialogs.length,notices:window.__workflowNotices.length,operations:window.__yose_app.settingsController.settingsOperations.size,savingUrl:window.__yose_app.settingsController.savingGasUrl})');
async function newDraft67(d){
	await unlockWorkflow(d);await d.evaluate('window.__yose_app.settingsController.renderSettings()');
	if(!await d.isVisible('#input-pin'))await d.click('#btn-toggle-key-details');
	await d.fill('#input-pin','NEW_PIN_DRAFT67');await d.fill('#input-gas-url','https://new-settings-draft67.example/exec');await d.select('#select-point-offset-category','cat_income_main');
	const state=await state67(d);assert.equal(state.pin,'NEW_PIN_DRAFT67');assert.equal(state.url,'https://new-settings-draft67.example/exec');assert.equal(state.category,'cat_income_main');assert.equal(state.dirty,true);return state;
}

for(const stage of ['security-read','database-export','private-export'])uiCase67(fixture,`cancels the old PIN save after its actual ${stage} response without touching the new settings draft`,async d=>{
	await settings67(d);if(!await d.isVisible('#input-pin'))await d.click('#btn-toggle-key-details');await d.fill('#input-pin','5678');await observeNativeEvent67(d,'#btn-save-pin');
	await holdResult67(d,stage==='security-read'?'window.__yose_app.db':'crypto.subtle',stage==='security-read'?'getSecurityKeyStates':'exportKey',stage==='security-read'?'true':`args[0]===${JSON.stringify(stage==='database-export'?'raw':'pkcs8')}`);
	try{
		await d.click('#btn-save-pin');await d.waitFor('typeof window.__settingsRelease67==="function"');const raw=await allRaw67(d);const expected=await newDraft67(d);assert.deepEqual(await allRaw67(d),raw);
		await d.evaluate('window.__settingsRelease67();window.__masterNativeJobs67[0]');assert.deepEqual(await allRaw67(d),raw);assert.deepEqual(await state67(d),expected);
	}finally{await d.evaluate('window.__settingsRelease67?.();Promise.allSettled(window.__masterNativeJobs67)');}
});

uiCase67(fixture,'keeps the actual committed GAS URL while an obsolete response preserves the new URL draft and manager',async d=>{
	await settings67(d);await d.fill('#input-gas-url','https://committed-url67.example/exec');await observeNativeEvent67(d,'#btn-save-gas-url');await holdResult67(d,'window.__yose_app.db','setSetting',"args[0]==='gas_url'");
	try{
		await d.click('#btn-save-gas-url');await d.waitFor('typeof window.__settingsRelease67==="function"');assert.equal(await d.evaluate('window.__yose_app.db.getSetting("gas_url")'),'https://committed-url67.example/exec');
		const expected=await newDraft67(d),raw=await allRaw67(d);await d.evaluate('window.__settingsNewManager67=window.__yose_app.syncManager');
		await d.evaluate('window.__settingsRelease67();window.__masterNativeJobs67[0]');assert.deepEqual(await allRaw67(d),raw);assert.deepEqual(await state67(d),expected);assert.equal(await d.evaluate('window.__yose_app.syncManager===window.__settingsNewManager67'),true);assert.equal(await d.evaluate('window.__settingsNewManager67.gasUrl'),'https://committed-url67.example/exec');
	}finally{await d.evaluate('window.__settingsRelease67?.();Promise.allSettled(window.__masterNativeJobs67)');}
});

for(const stage of ['metadata','credential'])uiCase67(fixture,`keeps the new settings draft when an old render finishes its actual ${stage} response`,async d=>{
	await settings67(d);await holdResult67(d,stage==='metadata'?'window.__yose_app.insightsController':'window.__yose_app.db',stage==='metadata'?'renderMetadata':'getSecurityKey',stage==='metadata'?'true':"args[0]==='webauthn_credential'");
	try{
		await d.evaluate('void(window.__oldSettingsRender67=window.__yose_app.settingsController.renderSettings())');await d.waitFor('typeof window.__settingsRelease67==="function"');const expected=await newDraft67(d),raw=await allRaw67(d);
		await d.evaluate('window.__settingsRelease67();window.__oldSettingsRender67');assert.deepEqual(await allRaw67(d),raw);assert.deepEqual(await state67(d),expected);
	}finally{await d.evaluate('window.__settingsRelease67?.();window.__oldSettingsRender67');}
});

uiCase67(fixture,'rejects a late nonempty file component event while actually locked without any file read or database transaction',async d=>{
	await settings67(d);await observeNativeEvent67(d,'#file-import-input','change');await d.evaluate('window.__yose_app.authController.lockPrivateKey()');await flushWorkflow(d);const raw=await allRaw67(d),dialogs=await d.evaluate('window.__dialogs.length'),generation=await d.evaluate('window.__yose_app.authController.authGeneration');assert.equal(Number.isInteger(generation),true);
	await d.evaluate(`(()=>{const database=window.__yose_app.db.db,transaction=database.transaction,text=File.prototype.text;window.__lateFile67={reads:0,transactions:0,events:[]};database.transaction=function(...args){window.__lateFile67.transactions++;return transaction.apply(this,args);};File.prototype.text=function(...args){window.__lateFile67.reads++;return text.apply(this,args);};window.__restoreLateFile67=()=>{database.transaction=transaction;File.prototype.text=text;};window.__restores67.push(window.__restoreLateFile67);const input=document.querySelector('#file-import-input'),transfer=new DataTransfer();transfer.items.add(new File(['[]'],'late-import67.json',{type:'application/json'}));input.files=transfer.files;input.addEventListener('change',event=>window.__lateFile67.events.push(event.isTrusted),{once:true});input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
	assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1);await d.evaluate('window.__masterNativeJobs67[0]');assert.deepEqual(await d.evaluate('window.__lateFile67'),{reads:0,transactions:0,events:[false]});await d.evaluate('window.__restoreLateFile67()');assert.deepEqual(await allRaw67(d),raw);assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);assert.equal(await d.evaluate('window.__yose_app.authController.authGeneration'),generation);assert.equal(await d.evaluate('window.__yose_app.settingsController.settingsOperations.size'),0);
});

uiCase67(fixture,'keeps a newer pending file selection when an old real import commit response returns after PIN unlock',async d=>{
	await settings67(d);await observeNativeEvent67(d,'#file-import-input','change');await gateMethod(d,'window.__yose_app.db','importFullData',{afterRead:true});
	try{
		await d.evaluate(`(()=>{const input=document.querySelector('#file-import-input'),transfer=new DataTransfer();transfer.items.add(new File([${JSON.stringify(JSON.stringify([transaction('old-import-committed67',{amount:432})]))}],'old-import67.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await waitGate(d);assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getTransaction("old-import-committed67")).amount)()'),432);await unlockWorkflow(d);await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		await gateMethod(d,'File.prototype','text',{afterRead:true});await d.evaluate(`(()=>{const input=document.querySelector('#file-import-input'),transfer=new DataTransfer();transfer.items.add(new File(['[]'],'new-import67.json',{type:'application/json'}));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);await waitGate(d,2);
		assert.equal(await d.evaluate('document.querySelector("#file-import-input").files[0].name'),'new-import67.json');assert.equal(await d.evaluate('window.__yose_app.settingsController.settingsOperations.size'),1);const raw=await allRaw67(d),dialogs=await d.evaluate('window.__dialogs.length');
		await releaseGate(d,0);await d.evaluate('window.__masterNativeJobs67[0]');assert.deepEqual(await allRaw67(d),raw);assert.equal(await d.evaluate('document.querySelector("#file-import-input").files[0].name'),'new-import67.json');assert.equal(await d.evaluate('window.__yose_app.settingsController.settingsOperations.size'),1);assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');await releaseGate(d,1);await d.evaluate('Promise.all(window.__masterNativeJobs67)');assert.deepEqual(await allRaw67(d),raw);
	}finally{await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.());Promise.allSettled(window.__masterNativeJobs67)');}
});

for(const action of ['export','json-read','json-save'])uiCase67(fixture,`silences the ${action} failure when an actual lock occurs between its Promise rejection and the settings catch`,async d=>{
	await settings67(d);const save=action==='json-save';
	if(save){await d.click('#btn-view-master-json');await flushWorkflow(d);const config=await d.evaluate('JSON.parse(document.querySelector("#txt-master-json").value)');config.accounts[0].name='COMMITTED_JSON_REACTION67';await d.fill('#txt-master-json',JSON.stringify(config));}
	if(action==='export')await d.click('#btn-open-export-modal');
	const selector=action==='export'?'#btn-export-transactions':save?'#btn-save-master-json':'#btn-view-master-json';await observeNativeEvent67(d,selector);
	const rawBefore=await allRaw67(d),dialogs=await d.evaluate('window.__dialogs.length'),generation=await d.evaluate('window.__yose_app.authController.authGeneration');assert.equal(Number.isInteger(generation),true);
	await d.evaluate(`(()=>{
		const app=window.__yose_app,owner=${save?'app.masterController':'app.db'},name=${JSON.stringify(action==='export'?'exportTransactionsData':save?'saveMasterConfigAndSync':'getMasterConfig')},original=owner[name];window.__settingsReaction67=[];
		owner[name]=function(...args){owner[name]=original;return original.apply(this,args).then(result=>{window.__settingsReaction67.push('real-result');queueMicrotask(()=>{${save?'':"queueMicrotask(()=>{"}window.__settingsReaction67.push('lock');window.__settingsReactionLock67=app.authController.lockPrivateKey();${save?'':'});'}});throw new Error('SETTINGS_REACTION_FAULT67');});};window.__restores67.push(()=>owner[name]=original);
	})()`);
	await d.click(selector);assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1);await d.evaluate('window.__masterNativeJobs67[0]');await d.evaluate('window.__settingsReactionLock67');
	assert.deepEqual(await d.evaluate('window.__settingsReaction67'),['real-result','lock']);assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'),true);assert.equal(await d.evaluate('window.__yose_app.authController.authGeneration'),generation+1);assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs}).map(item=>item.message)`),['秘密鍵およびDB暗号化セッションをロックしました'],'only the actual user-requested lock may notify; the obsolete settings failure must stay silent');
	if(save){const raw=await allRaw67(d);await unlockWorkflow(d);assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).accounts[0].name)()'),'COMMITTED_JSON_REACTION67');assert.deepEqual(await allRaw67(d),raw);}else assert.deepEqual(await allRaw67(d),rawBefore);
});

async function registerNative67(d){
	await d.send('WebAuthn.enable',{},d.sessionId);await d.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',ctap2Version:'ctap2_1',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}},d.sessionId);
	await d.evaluate('navigator.credentials.create=options=>CredentialsContainer.prototype.create.call(navigator.credentials,options);navigator.credentials.get=options=>CredentialsContainer.prototype.get.call(navigator.credentials,options)');
}
async function keySettings67(d){await settings67(d);if(!await d.isVisible('#btn-register-webauthn'))await d.click('#btn-toggle-key-details');}

uiCase67(fixture,'does not publish an old successful native passkey registration result into the new settings draft',async d=>{
	await registerNative67(d);await keySettings67(d);await observeNativeEvent67(d,'#btn-register-webauthn');await holdResult67(d,'window.__yose_app.authController','registerPasskey');
	try{
		await d.click('#btn-register-webauthn');await d.waitFor('typeof window.__settingsRelease67==="function"');assert.ok(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'));
		const expected=await newDraft67(d),raw=await allRaw67(d);await d.evaluate('window.__settingsRelease67();window.__masterNativeJobs67[0]');assert.deepEqual(await allRaw67(d),raw);assert.deepEqual(await state67(d),expected);
	}finally{await d.evaluate('window.__settingsRelease67?.();Promise.allSettled(window.__masterNativeJobs67)');}
});

for(const stage of ['security-read','committed-delete','master-read','legacy-cleanup'])uiCase67(fixture,`preserves the new settings draft after native passkey removal reaches its ${stage} response`,async d=>{
	await registerNative67(d);await keySettings67(d);await observeNativeEvent67(d,'#btn-register-webauthn');await d.click('#btn-register-webauthn');await d.evaluate('Promise.all(window.__masterNativeJobs67)');await flushWorkflow(d);assert.ok(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")'));
	if(stage==='legacy-cleanup')await d.evaluate('window.__yose_app.db.mutateMasterConfig(config=>{config.synced_passkey_bundle={legacy:true};})');
	await observeNativeEvent67(d,'#btn-clear-webauthn');
	await holdResult67(d,'window.__yose_app.db',({'security-read':'getSecurityKeyStates','committed-delete':'putSecurityKeys','master-read':'getMasterConfig','legacy-cleanup':'mutateMasterConfig'})[stage]);
	try{
		await d.click('#btn-clear-webauthn');await d.waitFor('typeof window.__settingsRelease67==="function"');
		assert.equal(Boolean(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_credential")')),stage==='security-read');
		if(stage==='legacy-cleanup')assert.equal(await d.evaluate('(async()=>Object.hasOwn(await window.__yose_app.db.getMasterConfig(),"synced_passkey_bundle"))()'),false);
		const expected=await newDraft67(d),raw=await allRaw67(d);await d.evaluate('window.__settingsRelease67();window.__masterNativeJobs67[0]');assert.deepEqual(await allRaw67(d),raw);assert.deepEqual(await state67(d),expected);
	}finally{await d.evaluate('window.__settingsRelease67?.();Promise.allSettled(window.__masterNativeJobs67)');}
});
