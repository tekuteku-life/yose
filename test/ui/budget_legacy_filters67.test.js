import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
import { readyBudget67 } from '../helpers/budget_ui67.js';

const f=useBrowser();
it('filters category budget drafts without altering hidden amounts and handles an older snapshot without monthly summaries',async()=>{
	const d=f.driver;
	await d.evaluate('window.__yose_app.db.saveSnapshot({schema_version:2,last_closed_month:null,account_balances:{}})');
	await readyBudget67(d);
	await d.fill('.input-cat-budget[data-cat-id="cat_food"]','1200');assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.draft.values.category_budgets.cat_food'),1200);const raw=await d.evaluate('window.__yose_app.db.captureImportState()');
	await d.fill('#input-budget-cat-search','食費');
	assert.deepEqual(await d.evaluate('[...document.querySelectorAll(".budget-cat-item")].filter(row=>row.style.display!=="none").map(row=>row.dataset.catId)'),['cat_food']);
	await d.fill('#input-budget-cat-search','該当しない67');assert.equal(await d.evaluate('[...document.querySelectorAll(".budget-cat-item")].every(row=>row.style.display==="none")'),true);
	await d.fill('#input-budget-cat-search','');assert.equal(await d.evaluate('document.querySelector(".input-cat-budget[data-cat-id=cat_food]").value'),'1200');
	assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.draft.values.category_budgets.cat_food'),1200);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
	await d.click('#btn-budget-auto-calc');assert.equal(await d.evaluate('document.querySelector("#setting-expense-budget").value'),'0');assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.draft.income'),0);assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),raw);
	assert.equal(await d.evaluate('(async()=>Object.hasOwn(await window.__yose_app.db.getSnapshot(),"monthly_summaries"))()'),false);
});

it('shows an unknown savings rate for zero income and retains the selected year while its input is being cleared',async()=>{
	const d=f.driver;await readyBudget67(d);await d.select('#setting-goal-basis','expense');await d.fill('#setting-expense-budget','0');assert.match(await d.textContent('#budget-goal-notice'),/収入が0円のため貯蓄率は未算出/);
	await d.evaluate(`(()=>{const c=window.__yose_app.budgetSettingsController,render=c.render;c.render=function(...args){return window.__yearJob67=render.apply(this,args);};window.__restoreYear67=()=>c.render=render;})()`);
	try{await d.click('#setting-budget-year');await d.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65},d.sessionId);await d.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:2,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65},d.sessionId);await d.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8},d.sessionId);await d.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8,nativeVirtualKeyCode:8},d.sessionId);assert.equal(await d.evaluate('document.querySelector("#setting-budget-year").value'),'');assert.equal(await d.evaluate('window.__yose_app.budgetSettingsController.year'),'2026');await d.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9},d.sessionId);await d.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,nativeVirtualKeyCode:9},d.sessionId);await d.evaluate('window.__yearJob67');assert.equal(await d.evaluate('document.querySelector("#setting-budget-year").value'),'2026');}
	finally{await d.evaluate('(async()=>{try{await window.__yearJob67;}finally{window.__restoreYear67?.();}})()');}
});
