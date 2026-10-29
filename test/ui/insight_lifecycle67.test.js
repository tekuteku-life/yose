import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
import { unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const f=useBrowser();
for(const stage of ['metadata','tax'])for(const expired of [false,true])it(`${stage} read failure ${expired?'from an expired session stays silent':'is displayed in the originating session'}`,async()=>{
	const d=f.driver;
	try {
	if(stage==='tax'){await d.click('[data-tab="tab-tax"]');await d.evaluate('window.__yose_app.furusatoController.render()');}
	const before=await d.evaluate('window.__yose_app.db.captureImportState()');
	await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,name=${JSON.stringify(stage==='metadata'?'getDataMetadata':'getAnalyticsState')},read=db[name];let once=true;db[name]=async function(...args){if(once){once=false;await new Promise(resolve=>window.__readRelease67=resolve);throw new Error('READ_FAILURE67');}return read.apply(this,args);};window.__restoreRead67=()=>db[name]=read;window.__readJob67=${stage==='metadata'?'app.insightsController.renderMetadata()':'app.furusatoController.render()'};})()`);
	await d.waitFor('typeof window.__readRelease67==="function"');
	if(expired)await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.evaluate('window.__readRelease67();window.__readJob67');
	const text=await d.textContent(stage==='metadata'?'#data-metadata':'#furusato-error');
	if(expired)assert.equal(text,'');else assert.match(text,/READ_FAILURE67/);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
	} finally { await d.evaluate('(async()=>{try{window.__readRelease67?.();await window.__readJob67;}finally{window.__restoreRead67?.();}})()'); }
});
for(const afterCommit of [false,true])it(`keeps a new investment draft intact after an old ${afterCommit?'committed':'uncommitted'} save returns from another authentication session`,async()=>{
	const d=f.driver;
	try {
	await d.click('[data-analytics-target="assets"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');
	const before=await d.evaluate('window.__yose_app.db.captureImportState()');
	await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,write=db.saveInvestmentObservation,owner=app.insightsController,draft=structuredClone(owner.investmentDraft);window.__account67=draft.accountId;window.__restoreWrite67=()=>db.saveInvestmentObservation=write;db.saveInvestmentObservation=async function(...args){db.saveInvestmentObservation=write;const result=${afterCommit} ? await write.apply(this,args) : undefined;window.__rawAtGate67=await db.captureImportState();await new Promise(resolve=>window.__writeRelease67=resolve);return ${afterCommit} ? result : write.apply(this,args);};window.__writeJob67=owner.commitInvestment(draft.accountId,draft.date,{acquisition_cost:400,market_value:550},draft.original);})()`);
	await d.waitFor('typeof window.__writeRelease67==="function"');
	const atGate=await d.evaluate('window.__rawAtGate67');if(!afterCommit)assert.deepEqual(atGate,before);else assert.notDeepEqual(atGate,before);
	await unlockWorkflow(d);await d.click('[data-analytics-target="assets"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');
	await d.fill('#investment-acquisition-cost','900');await d.fill('#investment-valuation','950');
	const draft=await d.evaluate('({draft:window.__yose_app.insightsController.investmentDraft,cost:document.querySelector("#investment-acquisition-cost").value,value:document.querySelector("#investment-valuation").value,error:document.querySelector("#investment-error").textContent,busy:window.__yose_app.insightsController.investmentBusy})');
	await d.evaluate('window.__writeRelease67();window.__writeJob67');
	assert.deepEqual(await d.evaluate('({draft:window.__yose_app.insightsController.investmentDraft,cost:document.querySelector("#investment-acquisition-cost").value,value:document.querySelector("#investment-valuation").value,error:document.querySelector("#investment-error").textContent,busy:window.__yose_app.insightsController.investmentBusy})'),draft);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),atGate);
	} finally { await d.evaluate('(async()=>{try{window.__writeRelease67?.();await window.__writeJob67;}finally{window.__restoreWrite67?.();}})()'); }
});
it('falls back to all investment accounts when a selected account stops contributing to assets',async()=>{
	const d=f.driver;await d.click('[data-analytics-target="assets"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');
	const account=await d.evaluate('document.querySelector("#investment-account").value');await d.select('#asset-investment-account',account);
	await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{const account=c.accounts.find(a=>a.id===${JSON.stringify(account)});account.is_asset=false;account.is_archived=true;});app.insightsController.renderInvestment(await app.db.getMasterConfig());})()`);
	assert.equal(await d.evaluate('document.querySelector("#asset-investment-account").value'),'all');
	assert.equal(await d.evaluate(`Boolean([...document.querySelector('#asset-investment-account').options].find(o=>o.value===${JSON.stringify(account)}))`),false);
	assert.equal(await d.evaluate('document.querySelector("#btn-save-investment").disabled'),true);
});
