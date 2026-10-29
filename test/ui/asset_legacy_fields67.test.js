import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const f=useBrowser({realCharts:true});
it('keeps independently optional insurance maturity date and amount visible without inventing stored values',async()=>{
	const d=f.driver;
	await d.evaluate(`(async()=>{const app=window.__yose_app,db=app.db;await db.mutateMasterConfig(c=>{c.recurring_rules=[];for(const account of c.accounts){account.initial_balance=0;if(account.type==='investment')account.investment_history={};}c.accounts.push({id:'date-only67',name:'満期日だけ',type:'insurance',is_asset:true,initial_balance:0,maturity_date:'2030-12-31'},{id:'amount-only67',name:'満期額だけ',type:'insurance',is_asset:true,initial_balance:0,maturity_amount:800});});const c=await db.getMasterConfig();await db.saveSnapshot({schema_version:2,last_closed_month:null,account_balances:Object.fromEntries(c.accounts.map(a=>[a.id,0])),monthly_summaries:{},external_assets:[]});window.__assetJobs67=[];const owner=app.summaryController,render=owner.renderSummary;owner.renderSummary=function(...args){const job=render.apply(this,args);window.__assetJobs67.push(job);return job;};})()`);
	const before=await d.evaluate('window.__yose_app.db.captureImportState()');
	await d.click('[data-analytics-target="assets"]');await d.evaluate('Promise.all(window.__assetJobs67)');
	const date=await d.textContent('#account-balances-list [data-filter-account="date-only67"]'),amount=await d.textContent('#account-balances-list [data-filter-account="amount-only67"]');
	assert.match(date,/満期: 2030-12-31/);assert.equal(amount.includes('満期:'),false);
	const table=await d.evaluate('[...document.querySelectorAll("#breakdown-table-container tbody tr")].filter(tr=>tr.cells[0].textContent.includes("満期日だけ")||tr.cells[0].textContent.includes("満期額だけ")).map(tr=>tr.cells[0].textContent)');
	assert.equal(table.length,2);assert.match(table[0],/満期: 2030-12-31/);assert.equal(table[0].includes('満期額:'),false);assert.match(table[1],/満期: 未設定/);assert.match(table[1],/満期額: ¥800/);
	assert.equal(await d.textContent('#stat-total-assets'),'¥0');
	assert.deepEqual(await d.evaluate('(async()=>{const c=await window.__yose_app.db.getMasterConfig();return{dateHasAmount:Object.hasOwn(c.accounts.find(a=>a.id==="date-only67"),"maturity_amount"),amountHasDate:Object.hasOwn(c.accounts.find(a=>a.id==="amount-only67"),"maturity_date")};})()'),{dateHasAmount:false,amountHasDate:false});
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
});

it('keeps an unsaved investment draft when its observation table background is clicked',async()=>{
	const d=f.driver;await d.click('[data-analytics-target="assets"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');await d.fill('#investment-acquisition-cost','123');await d.fill('#investment-valuation','456');
	const before=await d.evaluate('window.__yose_app.db.captureImportState()'),draft=await d.evaluate('window.__yose_app.insightsController.investmentDraft');await d.click('#investment-observations caption');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);assert.deepEqual(await d.evaluate('window.__yose_app.insightsController.investmentDraft'),draft);
	assert.equal(await d.evaluate('document.querySelector("#investment-acquisition-cost").value'),'123');assert.equal(await d.evaluate('document.querySelector("#investment-valuation").value'),'456');assert.equal(await d.evaluate('window.__yose_app.insightsController.investmentDirty'),true);
});
