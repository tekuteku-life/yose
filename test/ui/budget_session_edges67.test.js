import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
import { readyBudget67 } from '../helpers/budget_ui67.js';
import { unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const f=useBrowser();
async function settings(d){await readyBudget67(d);}
it('does not report a budget read failure into a newly unlocked year draft',async()=>{
	const d=f.driver;await settings(d);
	try{
	await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,read=db.getAnalyticsState;db.getAnalyticsState=async function(...args){db.getAnalyticsState=read;await read.apply(this,args);await new Promise(resolve=>window.__budgetRelease67=resolve);throw new Error('OLD_BUDGET_READ67');};window.__restoreBudget67=()=>db.getAnalyticsState=read;window.__budgetJob67=app.budgetSettingsController.render();})()`);
	await d.waitFor('typeof window.__budgetRelease67==="function"');await unlockWorkflow(d);await settings(d);await d.fill('#setting-expense-budget','3000');assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.draft.values.expense_budget'),3000);assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.draft.dirty'),true);
	const raw=await d.evaluate('window.__yose_app.db.captureImportState()'),state=await d.evaluate('({draft:window.__yose_app.budgetSettingsController.draft.values,notice:document.querySelector("#budget-goal-notice").textContent,disabled:document.querySelector("#setting-expense-budget").disabled,loading:window.__yose_app.budgetSettingsController.loading})');
	await d.evaluate('window.__budgetRelease67();window.__budgetJob67');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);assert.deepEqual(await d.evaluate('({draft:window.__yose_app.budgetSettingsController.draft.values,notice:document.querySelector("#budget-goal-notice").textContent,disabled:document.querySelector("#setting-expense-budget").disabled,loading:window.__yose_app.budgetSettingsController.loading})'),state);
	}finally{await d.evaluate('(async()=>{try{window.__budgetRelease67?.();await window.__budgetJob67;}finally{window.__restoreBudget67?.();}})()');}
});
it('retains a new annual goal draft when an already committed old save returns after PIN unlock',async()=>{
	const d=f.driver;await settings(d);await d.fill('#setting-expense-budget','1000');
	try{
	await d.evaluate(`(()=>{const app=window.__yose_app,db=app.db,write=db.saveMasterConfig;db.saveMasterConfig=async function(...args){db.saveMasterConfig=write;const result=await write.apply(this,args);window.__committedBudget67=await db.captureImportState();await new Promise(resolve=>window.__budgetRelease67=resolve);return result;};window.__restoreBudget67=()=>db.saveMasterConfig=write;window.__budgetJob67=app.budgetSettingsController.save();})()`);
	await d.waitFor('typeof window.__budgetRelease67==="function"');await unlockWorkflow(d);await settings(d);await d.fill('#setting-expense-budget','3000');assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.draft.values.expense_budget'),3000);assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.draft.dirty'),true);
	const state=await d.evaluate('({draft:window.__yose_app.budgetSettingsController.draft.values,amount:document.querySelector("#setting-expense-budget").value,saving:window.__yose_app.budgetSettingsController.saving,disabled:document.querySelector("#btn-save-annual-budget").disabled,dialogs:window.__dialogs.length})');
	await d.evaluate('window.__budgetRelease67();window.__budgetJob67');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),await d.evaluate('window.__committedBudget67'));assert.deepEqual(await d.evaluate('({draft:window.__yose_app.budgetSettingsController.draft.values,amount:document.querySelector("#setting-expense-budget").value,saving:window.__yose_app.budgetSettingsController.saving,disabled:document.querySelector("#btn-save-annual-budget").disabled,dialogs:window.__dialogs.length})'),state);assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].expense_budget)()'),1000);
	}finally{await d.evaluate('(async()=>{try{window.__budgetRelease67?.();await window.__budgetJob67;}finally{window.__restoreBudget67?.();}})()');}
});
