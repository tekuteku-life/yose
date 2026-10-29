import assert from 'node:assert/strict';
import { allRaw67 } from '../helpers/settings_ui67.js';
import { useBrowser, value } from '../helpers/ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
import { flushWorkflow, unlockWorkflow, rawWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture=useBrowser();
const state67=d=>d.evaluate('({category:document.querySelector("#select-point-offset-category").value,child:document.querySelector("#select-point-offset-subcategory").value,generation:window.__yose_app.settingsController.pointDefaultsGeneration,dirty:window.__yose_app.settingsController.pointDefaultsDirty,saving:window.__yose_app.settingsController.savingPointDefaults,error:document.querySelector("#point-defaults-error").textContent,disabled:document.querySelector("#btn-save-point-defaults").disabled,dialogs:window.__dialogs.length,notices:window.__workflowNotices.length})');

async function hold67(d,owner,name,{committed=false,reject=false}={}){
	await d.evaluate(`(()=>{const owner=${owner},name=${JSON.stringify(name)},original=owner[name];owner[name]=async function(...args){owner[name]=original;const result=${committed} ? await original.apply(this,args) : undefined;await new Promise(resolve=>window.__pointRelease67=resolve);${reject?"throw new Error('POINT_BOUNDARY_FAULT67');":`return ${committed} ? result : original.apply(this,args);`}};window.__restores67.push(()=>owner[name]=original);})()`);
}

for(const stage of ['latest-read','committed','old-save-reject','old-reload-reject'])uiCase67(fixture,`preserves the new point-settings draft after the old ${stage} operation completes`,async d=>{
	await settings67(d);await d.select('#select-point-offset-category','cat_income_main');
	const reload=stage==='old-reload-reject';
	await hold67(d,'window.__yose_app.db',stage==='committed'?'saveMasterConfig':'getMasterConfig',{committed:stage==='committed',reject:stage.endsWith('reject')});
	try{
		await d.click(reload?'#btn-reload-point-defaults':'#btn-save-point-defaults');await d.waitFor('typeof window.__pointRelease67==="function"');
		await d.evaluate(`void(window.__oldPointJob67=window.__workflowJobs.filter(job=>job.name===${JSON.stringify(reload?'reloadPointDefaults':'savePointDefaults')}).at(-1).promise)`);
		if(stage==='committed')assert.deepEqual(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).point_payment_defaults)()'),{category_id:'cat_income_main',subcategory_id:null});
		await unlockWorkflow(d);await d.evaluate('window.__yose_app.settingsController.renderSettings()');await d.select('#select-point-offset-category','');
		const before=await allRaw67(d),keys=await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'),state=await state67(d);
		assert.equal(state.category,'');assert.equal(state.dirty,true);assert.equal(state.saving,false);assert.equal(state.disabled,false);
		await d.evaluate('window.__pointRelease67();window.__oldPointJob67');assert.deepEqual(await allRaw67(d),before);assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'),keys);assert.deepEqual(await state67(d),state);
	}finally{await d.evaluate('window.__pointRelease67?.();window.__oldPointJob67');}
});

for(const archived of ['parent','child'])uiCase67(fixture,`rejects a point-default ${archived} archived by a real writer after it was selected`,async d=>{
	await settings67(d);
	if(archived==='parent')await d.select('#select-point-offset-category','cat_income_main');
	else{await d.select('#select-point-offset-category','cat_point_income');await d.select('#select-point-offset-subcategory','sub_point_offset');}
	const category=await value(d,'#select-point-offset-category'),child=await value(d,'#select-point-offset-subcategory');
	await d.evaluate(`window.__yose_app.db.mutateMasterConfig(config=>{const parent=config.categories.find(item=>item.id===${JSON.stringify(category)});${archived==='parent'?'parent.is_archived=true;':`parent.subcategories.find(item=>item.id===${JSON.stringify(child)}).is_archived=true;`}})`);
	const before=await allRaw67(d);await d.click('#btn-save-point-defaults');await flushWorkflow(d);
	assert.deepEqual(await allRaw67(d),before);assert.match(await d.textContent('#point-defaults-error'),/有効な収入費目と内訳/);assert.equal(await value(d,'#select-point-offset-category'),category);assert.equal(await value(d,'#select-point-offset-subcategory'),child);assert.equal(await d.evaluate('window.__yose_app.settingsController.savingPointDefaults'),false);
});

uiCase67(fixture,'retains a committed point default and reports the saved state when its immediate notice renderer fails',async d=>{
	await settings67(d);await d.select('#select-point-offset-category','cat_income_main');
	const before=await rawWorkflow(d),keys=await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")');
	await d.evaluate(`(()=>{const controller=window.__yose_app.txInputController,render=controller.renderPointOffsetNotice;controller.renderPointOffsetNotice=function(...args){controller.renderPointOffsetNotice=render;render.apply(this,args);throw new Error('POINT_NOTICE_FAULT67');};window.__restores67.push(()=>controller.renderPointOffsetNotice=render);})()`);
	await d.click('#btn-save-point-defaults');await flushWorkflow(d);
	assert.deepEqual(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).point_payment_defaults)()'),{category_id:'cat_income_main',subcategory_id:null});
	assert.match(await d.textContent('#point-defaults-error'),/設定は保存済みです。POINT_NOTICE_FAULT67/);assert.equal(await d.evaluate('window.__yose_app.settingsController.savingPointDefaults'),false);assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'),keys);
	const after=await rawWorkflow(d);for(const key of Object.keys(before).filter(key=>key!=='master'))assert.deepEqual(after[key],before[key],`unrelated import state ${key} must not change`);
});

uiCase67(fixture,'ignores queued component changes while a real point-default save owns its disabled controls',async d=>{
	await settings67(d);await d.select('#select-point-offset-category','cat_income_main');await hold67(d,'window.__yose_app.db','getMasterConfig');
	try{
		await d.click('#btn-save-point-defaults');await d.waitFor('typeof window.__pointRelease67==="function"');const before=await state67(d);assert.equal(before.saving,true);assert.equal(before.disabled,true);
		for(const selector of ['#select-point-offset-category','#select-point-offset-subcategory']){
			assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(selector)}).disabled`),true);await observeNativeEvent67(d,selector,'change');
			await d.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});window.__pointEvents67=[];element.addEventListener('change',event=>window.__pointEvents67.push(event.isTrusted),{once:true});element.dispatchEvent(new Event('change',{bubbles:true}));})()`);
			assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1);assert.deepEqual(await d.evaluate('window.__pointEvents67'),[false]);assert.deepEqual(await state67(d),before);
		}
	}finally{await d.evaluate('window.__pointRelease67?.()');await flushWorkflow(d);}
});

uiCase67(fixture,'refuses a second settings owner while the native GAS save is actually pending',async d=>{
	await settings67(d);await d.fill('#input-gas-url','https://pending-settings67.example/exec');await observeNativeEvent67(d,'#btn-save-gas-url');await hold67(d,'window.__yose_app.db','setSetting');
	try{
		await d.click('#btn-save-gas-url');await d.waitFor('typeof window.__pointRelease67==="function"');
		assert.equal(await d.evaluate('window.__yose_app.settingsController.settingsOperations.size'),1);
		assert.equal(await d.evaluate('window.__yose_app.settingsController.beginSettingsOperation(document.querySelector("#details-gas-url"),document.querySelector("#btn-save-gas-url"))'),null);
		assert.equal(await d.evaluate('window.__yose_app.settingsController.settingsOperations.size'),1);assert.equal(await d.evaluate('document.querySelector("#btn-save-gas-url").disabled'),true);
		await d.evaluate('window.__pointRelease67();window.__masterNativeJobs67[0]');assert.equal(await d.evaluate('window.__yose_app.db.getSetting("gas_url")'),'https://pending-settings67.example/exec');assert.equal(await d.evaluate('window.__yose_app.settingsController.settingsOperations.size'),0);
	}finally{await d.evaluate('window.__pointRelease67?.();Promise.allSettled(window.__masterNativeJobs67)');}
});
