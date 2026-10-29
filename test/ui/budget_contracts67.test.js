import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction } from '../helpers/ui_fixture.js';

const f=useBrowser();
async function settings(d){await d.click('[data-tab="tab-settings"]');await d.evaluate('window.__yose_app.settingsController.renderSettings()');await d.waitFor('Boolean(window.__yose_app.budgetSettingsController.draft)&&!window.__yose_app.budgetSettingsController.loading');}
it('shows derived deficits and validates a user-entered rate before saving any annual goal',async()=>{
	const d=f.driver;await seed(d,[transaction('salary67',{type:'income',amount:1000,category_id:'cat_income_main',actual_category_id:'cat_income_main'})]);await settings(d);
	await d.select('#setting-goal-basis','savings');await d.fill('#setting-savings-target-amount','1500');assert.equal(await d.evaluate('document.querySelector("#setting-expense-budget").value'),'-500');assert.match(await d.textContent('#budget-goal-notice'),/支出予算は不足額/);
	await d.select('#setting-goal-basis','expense');await d.fill('#setting-expense-budget','1500');assert.equal(await d.evaluate('document.querySelector("#setting-savings-target-amount").value'),'-500');assert.match(await d.textContent('#budget-goal-notice'),/目標貯蓄額は赤字額/);
	await d.select('#setting-goal-basis','rate');await d.fill('#setting-savings-target-rate','101');assert.match(await d.textContent('#budget-goal-notice'),/数値・範囲を確認/);assert.equal(await d.textContent('#budget-monthly-preview'),'月平均目安: 未算出');
	const before=await d.evaluate('window.__yose_app.db.captureImportState()');await d.evaluate('window.__yose_app.budgetSettingsController.save()');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
	assert.match((await d.evaluate('window.__dialogs')).map(dialog=>dialog.message).join('\n'),/対象年と目標の数値・範囲を確認/);
	assert.equal(await d.evaluate('document.querySelector("#setting-savings-target-rate").value'),'101');
});
it('compares category budgets by exact equality, remaining amounts and excess and calculates an empty previous year without a write',async()=>{
	const d=f.driver;await settings(d);await d.select('#setting-goal-basis','independent');await d.fill('#setting-expense-budget','1000');
	for(const [amount,message]of [[1000,'完全一致'],[900,'残り ¥100'],[1100,'超過 +¥100']]){await d.fill('.input-cat-budget[data-cat-id="cat_food"]',String(amount));assert.ok((await d.textContent('#budget-category-discrepancy')).includes(message));}
	const before=await d.evaluate('window.__yose_app.db.captureImportState()');await d.click('#btn-budget-auto-calc');
	assert.equal(await d.evaluate('document.querySelector("#setting-expense-budget").value'),'0');assert.equal(await d.evaluate('document.querySelector("#setting-savings-target-amount").value'),'0');assert.equal(await d.evaluate('document.querySelector("#setting-savings-target-rate").value'),'0');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.draft.dirty'),true);
	await d.evaluate('(()=>{const c=window.__yose_app.budgetSettingsController,render=c.render;c.render=function(...args){return window.__yearRender67=render.apply(this,args);};window.__restoreYear67=()=>c.render=render;})()');
	try {await d.fill('#setting-budget-year','');await d.evaluate('window.__yearRender67');assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.year'),'2026');}finally{await d.evaluate('(async()=>{try{await window.__yearRender67;}finally{window.__restoreYear67?.();}})()');}
});
