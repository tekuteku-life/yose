import {it} from 'node:test';
import assert from 'node:assert/strict';
import {useBrowser} from '../helpers/ui_fixture.js';
import {readyBudget67} from '../helpers/budget_ui67.js';
import {holdNativeKeyRegeneration67,finishNativeKeyRegeneration67} from '../helpers/auth_epoch67.js';
const f=useBrowser();
for(const kind of ['investment','budget','tax','tax-source'])for(const afterCommit of [false,true])it(`${kind} old ${afterCommit?'committed':'uncommitted'} save stays inactive during native key regeneration`,async()=>{
	const d=f.driver;
	try{
	if(kind==='investment'){await d.click('[data-analytics-target="assets"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');await d.fill('#investment-acquisition-cost','400');await d.fill('#investment-valuation','550');}
	if(kind==='budget'){await readyBudget67(d);await d.fill('#setting-expense-budget','1111');}
	if(kind.startsWith('tax')){await d.click('[data-tab="tab-tax"]');await d.evaluate('window.__yose_app.furusatoController.render()');await d.fill('#furusato-resident-tax','200000');await d.select('#furusato-tax-rate','20');if(kind==='tax-source')await d.select('#furusato-housing-carry','7');}
	await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,name=${JSON.stringify(kind==='investment'?'saveInvestmentObservation':'saveMasterConfig')},write=db[name];db[name]=async function(...args){db[name]=write;const result=${afterCommit}?await write.apply(this,args):undefined;await new Promise(resolve=>window.__oldRelease67=resolve);return ${afterCommit}?result:write.apply(this,args);};window.__restoreOld67=()=>db[name]=write;window.__oldJob67=Promise.resolve(${kind==='investment'?'app.insightsController.commitInvestment(app.insightsController.investmentDraft.accountId,app.insightsController.investmentDraft.date,{acquisition_cost:400,market_value:550},app.insightsController.investmentDraft.original)':kind==='budget'?'app.budgetSettingsController.save()':`app.furusatoController.save(${kind==='tax'})`}).catch(error=>{window.__oldError67=error.message;});})()`);
	await d.waitFor('typeof window.__oldRelease67==="function"');await holdNativeKeyRegeneration67(d);
	const raw=await d.evaluate('window.__yose_app.db.captureImportState()');const before=await d.evaluate(`(()=>{const app=window.__yose_app,c=app.${kind==='investment'?'insightsController':kind==='budget'?'budgetSettingsController':'furusatoController'},refresh=app.refreshAllViews;window.__oldRefreshCount67=0;app.refreshAllViews=function(...args){window.__oldRefreshCount67++;return refresh.apply(this,args);};window.__restoreRefresh67=()=>app.refreshAllViews=refresh;return {dialogs:window.__dialogs.length,toast:document.querySelector('#toast-notification').textContent,dirty:${kind==='investment'?'c.investmentDirty':kind==='budget'?'c.draft.dirty':kind==='tax'?'c.taxDirty':'c.sourceDirty'}};})()`);await d.evaluate('window.__oldRelease67();window.__oldJob67');
	assert.equal(await d.evaluate('window.__oldRefreshCount67'),0);assert.equal(await d.evaluate('window.__dialogs.length'),before.dialogs);assert.equal(await d.textContent('#toast-notification'),before.toast);assert.deepEqual(await d.evaluate(`window.__yose_app.${kind==='investment'?'insightsController.investmentDirty':kind==='budget'?'budgetSettingsController.draft.dirty':kind==='tax'?'furusatoController.taxDirty':'furusatoController.sourceDirty'}`),before.dirty);assert.equal(await d.evaluate(`window.__yose_app.${kind==='investment'?'insightsController.investmentBusy':kind==='budget'?'budgetSettingsController.saving':'furusatoController.taxBusy'}`),false);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
	}finally{await d.evaluate('(async()=>{try{window.__oldRelease67?.();await window.__oldJob67;}finally{window.__restoreOld67?.();window.__restoreRefresh67?.();}})()');await finishNativeKeyRegeneration67(d);}
});

for(const failure of [false,true])it(`old ledger digest ${failure?'failure':'success'} stays inactive during native key regeneration`,async()=>{
	const d=f.driver;
	try{
	await d.click('[data-tab="tab-tax"]');await d.evaluate('window.__yose_app.furusatoController.render()');
	await d.evaluate(`(()=>{const c=window.__yose_app.furusatoController,fp=c.fingerprint,confirm=c.confirmLedger;c.fingerprint=async function(...args){c.fingerprint=fp;const result=await fp.apply(this,args);await new Promise(resolve=>window.__oldRelease67=resolve);if(${failure})throw new Error('OLD_DIGEST67');return result;};c.confirmLedger=function(...args){return window.__oldJob67=confirm.apply(this,args);};window.__restoreOld67=()=>{c.fingerprint=fp;c.confirmLedger=confirm;};})()`);
	await d.click('#furusato-confirm-ledger');await d.waitFor('typeof window.__oldRelease67==="function"');await holdNativeKeyRegeneration67(d);
	const state=await d.evaluate('({token:window.__yose_app.furusatoController.confirmationToken,error:document.querySelector("#furusato-error").textContent,checked:document.querySelector("#furusato-confirm-ledger").checked})');const raw=await d.evaluate('window.__yose_app.db.captureImportState()');
	await d.evaluate('window.__oldRelease67();window.__oldJob67');
	assert.deepEqual(await d.evaluate('({token:window.__yose_app.furusatoController.confirmationToken,error:document.querySelector("#furusato-error").textContent,checked:document.querySelector("#furusato-confirm-ledger").checked})'),state);assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
	}finally{await d.evaluate('(async()=>{try{window.__oldRelease67?.();await window.__oldJob67;}finally{window.__restoreOld67?.();window.__restoreRefresh67?.();}})()');await finishNativeKeyRegeneration67(d);}
});

for(const kind of ['investment-save','investment-delete','tax','tax-source'])it(`releases the original ${kind} busy owner after a normal render replaces its draft`,async()=>{
	const d=f.driver;
	try{
		if(kind.startsWith('investment')){
			await d.click('[data-analytics-target="assets"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');
			if(kind==='investment-delete')await d.evaluate('(async()=>{const app=window.__yose_app,c=app.insightsController,draft=c.investmentDraft;await app.db.saveInvestmentObservation(draft.accountId,draft.date,{acquisition_cost:400,market_value:550},draft.original);await app.summaryController.renderSummary();})()');
		}else{
			await d.evaluate('(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.annual_budgets||={};c.annual_budgets[2026]||={};c.annual_budgets[2026].furusato_estimate={resident_tax:200000,income_tax_rate:20};});})()');
			await d.click('[data-tab="tab-tax"]');await d.evaluate('window.__yose_app.furusatoController.render()');
		}
		await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,name=${JSON.stringify(kind.startsWith('investment')?'saveInvestmentObservation':'saveMasterConfig')},write=db[name];db[name]=async function(...args){db[name]=write;await new Promise(resolve=>window.__oldRelease67=resolve);const result=await write.apply(this,args);window.__normalSaveResolved67=true;return result;};window.__restoreOld67=()=>db[name]=write;window.__draftBefore67=app.${kind.startsWith('investment')?'insightsController.investmentDraft':kind==='tax'?'furusatoController.taxDraft':'furusatoController.sourceDraft'};window.__oldJob67=${kind.startsWith('investment')?`app.insightsController.commitInvestment(app.insightsController.investmentDraft.accountId,app.insightsController.investmentDraft.date,${kind==='investment-delete'?'null':'{acquisition_cost:400,market_value:550}'},app.insightsController.investmentDraft.original)`:`app.furusatoController.save(${kind==='tax'})`};})()`);
		await d.waitFor('typeof window.__oldRelease67==="function"');
		await d.evaluate(kind.startsWith('investment')?'window.__yose_app.summaryController.renderSummary()':'window.__yose_app.furusatoController.render()');
		assert.equal(await d.evaluate(`window.__draftBefore67===window.__yose_app.${kind.startsWith('investment')?'insightsController.investmentDraft':kind==='tax'?'furusatoController.taxDraft':'furusatoController.sourceDraft'}`),false,'normal rendering must actually replace the non-dirty draft');
		assert.equal(await d.evaluate(`window.__yose_app.${kind.startsWith('investment')?'insightsController.investmentBusy':'furusatoController.taxBusy'}`),true);
		await d.evaluate('window.__oldRelease67();window.__oldJob67');
		assert.equal(await d.evaluate('window.__normalSaveResolved67'),true,'the actual DB save must resolve after draft replacement');
		assert.equal(await d.evaluate(`window.__yose_app.${kind.startsWith('investment')?'insightsController.investmentBusy':'furusatoController.taxBusy'}`),false);
		if(kind.startsWith('investment'))assert.deepEqual(await d.evaluate('(async()=>{const app=window.__yose_app,draft=window.__draftBefore67;return (await app.db.getMasterConfig()).accounts.find(a=>a.id===draft.accountId).investment_history?.[draft.date]??null;})()'),kind==='investment-delete'?null:{acquisition_cost:400,market_value:550});
		else if(kind==='tax')assert.deepEqual(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_estimate)()'),{resident_tax:200000,income_tax_rate:20});
		else assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_calculation.housing.carry_rate)()'),5);
	}finally{await d.evaluate('(async()=>{try{window.__oldRelease67?.();await window.__oldJob67;}finally{window.__restoreOld67?.();}})()');}
});
