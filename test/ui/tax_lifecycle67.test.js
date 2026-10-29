import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
import { unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const f=useBrowser();
async function tax(d){await d.click('[data-tab="tab-tax"]');await d.evaluate('window.__yose_app.furusatoController.render()');}
for(const expired of [false,true])it(`keeps a failed ledger digest ${expired?'from an old session silent':'visible and unconfirmed'}`,async()=>{
	const d=f.driver;await tax(d);
	try{
	await d.evaluate(`(()=>{const c=window.__yose_app.furusatoController,fp=c.fingerprint,confirm=c.confirmLedger;c.fingerprint=async function(){await new Promise(resolve=>window.__digestRelease67=resolve);throw new Error('DIGEST_FAILURE67');};c.confirmLedger=function(...args){return window.__digestJob67=confirm.apply(this,args);};window.__restoreDigest67=()=>{c.fingerprint=fp;c.confirmLedger=confirm;};})()`);
	await d.click('#furusato-confirm-ledger');await d.waitFor('typeof window.__digestRelease67==="function"');const before=await d.evaluate('window.__yose_app.db.captureImportState()');
	if(expired)await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.evaluate('window.__digestRelease67();window.__digestJob67');
	assert.equal(await d.evaluate('document.querySelector("#furusato-confirm-ledger").checked'),false);
	assert.equal(await d.textContent('#furusato-error'),expired?'':'DIGEST_FAILURE67');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
	}finally{await d.evaluate('(async()=>{try{window.__digestRelease67?.();await window.__digestJob67;}finally{window.__restoreDigest67?.();}})()');}
});
for(const stage of ['read','commit'])it(`does not apply an old tax ${stage} completion to a newly unlocked notice draft`,async()=>{
	const d=f.driver;await tax(d);await d.fill('#furusato-resident-tax','200000');await d.select('#furusato-tax-rate','20');
	try{
	await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,name=${JSON.stringify(stage==='read'?'getMasterConfig':'saveMasterConfig')},original=db[name],c=app.furusatoController,save=c.save;let armed=false;db[name]=async function(...args){if(armed){armed=false;db[name]=original;const result=await original.apply(this,args);window.__taxRawAtGate67=await db.captureImportState();await new Promise(resolve=>window.__taxRelease67=resolve);return result;}return original.apply(this,args);};c.save=function(...args){armed=true;return window.__taxJob67=save.apply(this,args);};window.__restoreTax67=()=>{db[name]=original;c.save=save;};})()`);
	await d.click('#btn-save-furusato');await d.waitFor('typeof window.__taxRelease67==="function"');
	const raw=await d.evaluate('window.__taxRawAtGate67');
	await unlockWorkflow(d);await tax(d);await d.fill('#furusato-resident-tax','300000');const before=await d.evaluate('({draft:window.__yose_app.furusatoController.taxDraft,amount:document.querySelector("#furusato-resident-tax").value,error:document.querySelector("#furusato-error").textContent,busy:window.__yose_app.furusatoController.taxBusy,dialogs:window.__dialogs.length})');
	await d.evaluate('window.__taxRelease67();window.__taxJob67');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
	assert.deepEqual(await d.evaluate('({draft:window.__yose_app.furusatoController.taxDraft,amount:document.querySelector("#furusato-resident-tax").value,error:document.querySelector("#furusato-error").textContent,busy:window.__yose_app.furusatoController.taxBusy,dialogs:window.__dialogs.length})'),before);
	const annual=await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).annual_budgets?.[2026]?.furusato_estimate??null)()');assert.deepEqual(annual,stage==='commit'?{resident_tax:200000,income_tax_rate:20}:null);
	}finally{await d.evaluate('(async()=>{try{window.__taxRelease67?.();await window.__taxJob67;}finally{window.__restoreTax67?.();}})()');}
});
it('reports a saved tax notice separately from a failed following refresh',async()=>{
	const d=f.driver;await tax(d);await d.fill('#furusato-resident-tax','200000');await d.select('#furusato-tax-rate','20');
	await d.evaluate(`(()=>{const app=window.__yose_app,c=app.furusatoController,save=c.save;c.save=function(...args){return window.__taxJob67=save.apply(this,args);};app.refreshAllViews=async()=>{throw new Error('TAX_DISPLAY_FAILURE67');};})()`);
	await d.click('#btn-save-furusato');await d.evaluate('window.__taxJob67');assert.match(await d.textContent('#furusato-error'),/保存済みです。表示を更新してください。TAX_DISPLAY_FAILURE67/);
	assert.deepEqual(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_estimate)()'),{resident_tax:200000,income_tax_rate:20});assert.equal(await d.evaluate('document.querySelector("#btn-save-furusato").disabled'),false);
});
it('saves the seven percent housing carry band and ignores a year outside the supported selector range',async()=>{
	const d=f.driver;await tax(d);
	await d.select('#furusato-housing-carry','7');await d.evaluate(`(()=>{const c=window.__yose_app.furusatoController,save=c.save;c.save=function(...args){return window.__taxJob67=save.apply(this,args);};})()`);
	await d.click('#btn-save-furusato-sources');await d.evaluate('window.__taxJob67');
	const housing=await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_calculation.housing)()');assert.equal(housing.carry_rate,7);assert.equal(housing.carry_limit,136500);
	const before=await d.evaluate('window.__yose_app.db.captureImportState()');await d.fill('#furusato-donation-year','10000');assert.equal(await d.evaluate('window.__yose_app.selectedYear'),'2026');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
});
