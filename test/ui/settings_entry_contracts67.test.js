import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
import { allRaw67 } from '../helpers/settings_ui67.js';
import { flushWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser();


async function countDatabase67(d) {
	await d.evaluate(`(()=>{
		const app=window.__yose_app,restores=[];window.__settingsDatabase67={transactions:0,reads:0};
		const database=app.db.db,transaction=database.transaction;database.transaction=function(...args){window.__settingsDatabase67.transactions++;return transaction.apply(this,args);};restores.push(()=>database.transaction=transaction);
		for(const name of ['getMasterConfig','getSetting','getSecurityKey','getSecurityKeyStates'])if(typeof app.db[name]==='function'){const original=app.db[name];app.db[name]=function(...args){window.__settingsDatabase67.reads++;return original.apply(this,args);};restores.push(()=>app.db[name]=original);}
		window.__restoreSettingsDatabase67=()=>restores.reverse().forEach(restore=>restore());window.__restores67.push(window.__restoreSettingsDatabase67);
	})()`);
}

async function componentEvent67(d, selector, type='click') {
	await observeNativeEvent67(d,selector,type);
	await d.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});window.__componentEvent67=[];element.addEventListener(${JSON.stringify(type)},event=>window.__componentEvent67.push({trusted:event.isTrusted,type:event.type}),{once:true});${type==='click'?'element.click();':`element.dispatchEvent(new Event(${JSON.stringify(type)},{bubbles:true}));`}})()`);
	assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1,'the registered application listener must actually run once');
	await d.evaluate('Promise.all(window.__masterNativeJobs67)');
	assert.deepEqual(await d.evaluate('window.__componentEvent67'),[{trusted:false,type}]);
}

for(const selector of ['#btn-save-pin','#btn-save-gas-url','#btn-save-master-json','#btn-view-master-json'])uiCase67(fixture,`ignores a component event on ${selector} after an actual lock without starting a database operation`,async d=>{
	await settings67(d);await d.evaluate('window.__yose_app.authController.lockPrivateKey()');await flushWorkflow(d);
	assert.equal(await d.evaluate('document.querySelector("#auth-screen").classList.contains("hidden")'),false);
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`),false);
	const before=await allRaw67(d),state=await d.evaluate('({generation:window.__yose_app.authController.authGeneration,dialogs:window.__dialogs.length,notices:window.__workflowNotices.length,editor:document.querySelector("#master-json-editor").style.display,text:document.querySelector("#txt-master-json").value})');
	assert.equal(Number.isInteger(state.generation),true,'the authentication generation must exist before the component event');
	await countDatabase67(d);await componentEvent67(d,selector);
	assert.deepEqual(await d.evaluate('window.__settingsDatabase67'),{transactions:0,reads:0});await d.evaluate('window.__restoreSettingsDatabase67()');
	assert.deepEqual(await allRaw67(d),before);assert.deepEqual(await d.evaluate('({generation:window.__yose_app.authController.authGeneration,dialogs:window.__dialogs.length,notices:window.__workflowNotices.length,editor:document.querySelector("#master-json-editor").style.display,text:document.querySelector("#txt-master-json").value})'),state);
	assert.equal(await d.evaluate('window.__yose_app.settingsController.settingsOperations.size'),0);
});

uiCase67(fixture,'ignores an empty file-change component notification without reading data or acquiring a save owner',async d=>{
	await settings67(d);const before=await allRaw67(d),dialogs=await d.evaluate('window.__dialogs.length');
	assert.equal(await d.evaluate('document.querySelector("#file-import-input").files.length'),0);
	await countDatabase67(d);await componentEvent67(d,'#file-import-input','change');assert.deepEqual(await d.evaluate('window.__settingsDatabase67'),{transactions:0,reads:0});await d.evaluate('window.__restoreSettingsDatabase67()');
	assert.deepEqual(await allRaw67(d),before);assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);assert.equal(await d.evaluate('window.__yose_app.settingsController.settingsOperations.size'),0);
});

uiCase67(fixture,'ignores a late component change from a theme radio that the native selection already unchecked',async d=>{
	await settings67(d);await d.click('#theme-radio-dark');await d.evaluate('window.__yose_app.pendingDisplaySettings');
	assert.equal(await d.evaluate('document.querySelector("#theme-radio-system").checked'),false);
	assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).theme)()'),'dark');const before=await allRaw67(d);
	await countDatabase67(d);await componentEvent67(d,'#theme-radio-system','change');assert.deepEqual(await d.evaluate('window.__settingsDatabase67'),{transactions:0,reads:0});await d.evaluate('window.__restoreSettingsDatabase67()');
	assert.equal(await d.evaluate('window.__yose_app.currentThemePreference'),'dark');assert.equal(await d.evaluate('document.documentElement.dataset.theme'),'dark');assert.deepEqual(await allRaw67(d),before);
});

for(const expired of [false,true])uiCase67(fixture,`${expired?'silences an obsolete':'reports an active'} master JSON read fault without replacing the current editor`,async d=>{
	await settings67(d);await observeNativeEvent67(d,'#btn-view-master-json');
	await d.evaluate(`(()=>{const db=window.__yose_app.db,read=db.getMasterConfig;db.getMasterConfig=async function(...args){db.getMasterConfig=read;await read.apply(this,args);await new Promise(resolve=>window.__jsonReadRelease67=resolve);throw new Error('SETTINGS_JSON_READ67');};window.__restores67.push(()=>db.getMasterConfig=read);})()`);
	try{
		await d.click('#btn-view-master-json');await d.waitFor('typeof window.__jsonReadRelease67==="function"');await d.evaluate('void(window.__oldJsonListener67=window.__masterNativeJobs67[0])');
		if(expired){await unlockWorkflow(d);await d.evaluate('window.__yose_app.settingsController.renderSettings()');await d.click('#btn-view-master-json');await d.evaluate('window.__masterNativeJobs67[1]');await d.fill('#txt-master-json','NEW_JSON_DRAFT67');}
		const raw=await allRaw67(d),state=await d.evaluate('({display:document.querySelector("#master-json-editor").style.display,value:document.querySelector("#txt-master-json").value,dialogs:window.__dialogs.length})');
		if(expired){assert.equal(state.display,'block');assert.equal(state.value,'NEW_JSON_DRAFT67');}
		await d.evaluate('window.__jsonReadRelease67();window.__oldJsonListener67');assert.deepEqual(await allRaw67(d),raw);
		if(expired)assert.deepEqual(await d.evaluate('({display:document.querySelector("#master-json-editor").style.display,value:document.querySelector("#txt-master-json").value,dialogs:window.__dialogs.length})'),state);
		else{assert.equal(await d.evaluate('window.__dialogs.length'),state.dialogs+1);assert.match(await d.evaluate('window.__dialogs.at(-1).message'),/マスタJSON.*SETTINGS_JSON_READ67/);assert.equal(await d.evaluate('document.querySelector("#master-json-editor").style.display'),'none');}
	}finally{await d.evaluate('window.__jsonReadRelease67?.();window.__oldJsonListener67');}
});
