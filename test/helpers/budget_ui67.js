import assert from 'node:assert/strict';

export async function readyBudget67(d, year='2026'){
	await d.evaluate(`(()=>{const c=window.__yose_app.settingsController,render=c.renderSettings;window.__budgetTransitions67=[];c.renderSettings=function(...args){const job=render.apply(this,args);window.__budgetTransitions67.push(job);return job;};window.__restoreBudgetTransition67=()=>c.renderSettings=render;})()`);
	try{
		await d.click('[data-tab="tab-settings"]');
		await d.evaluate('(async()=>{let count=-1;while(count!==window.__budgetTransitions67.length){count=window.__budgetTransitions67.length;await Promise.all(window.__budgetTransitions67);}})()');
		assert.ok(await d.evaluate('window.__budgetTransitions67.length>0'),'the actual settings transition must start');
		await d.waitFor(`(()=>{const c=window.__yose_app.budgetSettingsController,input=document.querySelector('#setting-expense-budget');return document.querySelector('#tab-settings').classList.contains('active')&&c.year===${JSON.stringify(year)}&&c.draft&&!c.loading&&!c.saving&&!input.disabled&&!input.readOnly&&!document.querySelector('#btn-save-annual-budget').disabled;})()`);
	}finally{await d.evaluate('window.__restoreBudgetTransition67?.()');}
}
