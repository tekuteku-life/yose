import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, transaction } from '../helpers/ui_fixture.js';

const f=useBrowser({realCharts:true});
it('normalizes numeric and object historical category amounts before displaying yearly and budget totals',async()=>{
	const d=f.driver;
	await d.evaluate(`(async()=>{const app=window.__yose_app,c=app.summaryController,config=await app.db.getMasterConfig();app.selectedYear='2025';config.annual_budgets={2025:{expense_budget:1000,savings_target_amount:1000,savings_target_rate:50,category_budgets:{cat_food:1000}}};window.__legacy67={monthly_summaries:{'2025-01':{income_total:1000,expense_total:300,by_category:{cat_food:300},by_actual_category:{cat_housing:{total:300}}},'2025-02':{income_total:1000,expense_total:700,by_category:{cat_food:{total:700}},by_actual_category:{cat_housing:700}}}};
		window.__categoryJobs67=[];const original=c.renderCategoryBreakdownList;c.renderCategoryBreakdownList=function(...args){const job=original.apply(this,args);window.__categoryJobs67.push(job);return job;};
		c.renderBudgetAnalytics([],window.__legacy67,config);window.__normalizationConfig67=config;})()`);
	assert.equal(await d.textContent('#stat-budget-expense'),'¥1,000 / ¥1,000');
	const rows=await d.evaluate('[...document.querySelectorAll("#budget-category-progress-container tbody tr")].map(tr=>[...tr.cells].map(cell=>cell.textContent.trim()))');
	assert.deepEqual(rows[0].slice(1,5),['¥1,000','¥1,000','¥0','100%']);
	await d.evaluate('(async()=>{window.__yose_app.summaryController.renderYearlyAnalytics([],window.__legacy67,window.__normalizationConfig67);await Promise.all(window.__categoryJobs67);})()');
	assert.equal(await d.textContent('#stat-expense'),'¥1,000');assert.match(await d.textContent('#category-breakdown-list [data-filter-category="cat_food"]'),/1,000/);
	await d.evaluate('(async()=>{const app=window.__yose_app;app.useActualCategoryAxis=true;app.summaryController.renderYearlyAnalytics([],window.__legacy67,window.__normalizationConfig67);await Promise.all(window.__categoryJobs67);})()');
	assert.match(await d.textContent('#category-breakdown-list [data-filter-category="cat_housing"]'),/1,000/);
});

it('uses the same normalized historical values in previous-year budget category hints',async()=>{
	const d=f.driver;
	await d.evaluate(`(async()=>{const app=window.__yose_app,c=app.budgetSettingsController,state=await app.db.getAnalyticsState();state.summary_snapshot={monthly_summaries:{'2025-01':{expense_total:300,by_category:{cat_food:300}},'2025-02':{expense_total:700,by_category:{cat_food:{total:700}}}}};c.renderCategories({state,values:{category_budgets:{cat_food:1200}}},'2026');})()`);
	assert.match(await d.textContent('#budget-categories-list-container [data-cat-id="cat_food"]'),/前年実績\(2025年\): ¥1,000/);
	assert.equal(await d.evaluate('document.querySelector(".input-cat-budget[data-cat-id=cat_food]").value'),'1200');
});

it('supports omitted analytics render contexts with real aggregate output and keeps exact income and expense values',async()=>{
	const d=f.driver,txs=[transaction('api-expense',{amount:30}),transaction('api-income',{type:'income',amount:100,category_id:'cat_income_main',actual_category_id:'cat_income_main'})];
	await d.evaluate(`(async()=>{const app=window.__yose_app,c=app.summaryController,{calculateBalancesAndSummaries}=await import('/js/logic.js');window.__apiTx67=${JSON.stringify(txs)};window.__apiSummary67=calculateBalancesAndSummaries({account_balances:{acc_wallet:0}},window.__apiTx67,'2026-10');window.__categoryJobs67=[];const original=c.renderCategoryBreakdownList;c.renderCategoryBreakdownList=function(...args){const job=original.apply(this,args);window.__categoryJobs67.push(job);return job;};c.renderDailyAnalytics(window.__apiTx67,window.__apiSummary67);await Promise.all(window.__categoryJobs67);})()`);
	assert.equal(await d.textContent('#stat-income'),'¥100 / ¥100');assert.equal(await d.textContent('#stat-expense'),'¥30 / ¥30');
	await d.evaluate('(async()=>{const c=window.__yose_app.summaryController;c.renderMonthlyAnalytics(window.__apiTx67,null,null);await Promise.all(window.__categoryJobs67);})()');
	assert.equal(await d.textContent('#stat-income'),'¥100 / ¥100');assert.equal(await d.textContent('#stat-expense'),'¥30 / ¥30');
	const october=await d.evaluate('[...document.querySelectorAll("#breakdown-table-container tbody tr")].find(tr=>tr.cells[0].textContent.includes("2026-10")).textContent');assert.match(october,/100/);assert.match(october,/30/);
	const amounts=await d.evaluate('[...document.querySelectorAll("#breakdown-table-container tbody tr")].find(tr=>tr.cells[0].textContent.includes("2026-10"))&&[...[...document.querySelectorAll("#breakdown-table-container tbody tr")].find(tr=>tr.cells[0].textContent.includes("2026-10")).cells].slice(1).map(cell=>cell.textContent.trim())');assert.deepEqual(amounts,['¥100','¥30','+¥70','¥70']);
	await d.evaluate('(async()=>{const c=window.__yose_app.summaryController;c.renderYearlyAnalytics(window.__apiTx67,null);await Promise.all(window.__categoryJobs67);})()');
	assert.equal(await d.textContent('#stat-income'),'¥100');assert.equal(await d.textContent('#stat-expense'),'¥30');
	await d.evaluate('(async()=>{const app=window.__yose_app,{calculateTotalAssetSummary}=await import("/js/logic.js");app.summaryController.renderAssetsAnalytics(calculateTotalAssetSummary({},[]),{accounts:[]});await app.summaryController.renderAccountBalances(null);})()');
	assert.match(await d.textContent('#breakdown-table-container'),/登録なし/);
	assert.match(await d.textContent('#account-balances-list'),/¥0/);
});

it('uses only explicitly configured navigation targets and shows and closes update and toast feedback',async()=>{
	const d=f.driver;
	for(const [tab,panel,target]of [['tab-input','tab-input',null],['tab-cashflow','tab-summary','cashflow'],['tab-budget','tab-summary','budget'],['tab-assets','tab-summary','assets'],['tab-tax','tab-tax',null],['tab-settings','tab-settings',null]]){
		await d.click('.tab-btn[data-tab="'+tab+'"]');
		assert.equal(await d.evaluate(`document.querySelector('#${panel}').classList.contains('active')`),true);
		if(target)assert.equal(await d.evaluate('window.__yose_app.analyticsTarget'),target);
	}
	await d.evaluate('window.__yose_app.showUpdateModal("9.9.9")');assert.equal(await d.isVisible('#modal-app-update'),true);assert.equal(await d.textContent('#modal-new-version-text'),'v9.9.9');
	await d.evaluate('window.__yose_app.hideUpdateModal()');assert.equal(await d.isVisible('#modal-app-update'),false);
	await d.evaluate('window.__yose_app.showToast(undefined,30)');assert.equal(await d.textContent('#toast-notification'),'✅ 登録が完了しました');
	await d.waitFor('document.querySelector("#toast-notification").style.display==="none"');
});

it('renders empty budget settings for an accepted master with omitted optional category collections',async()=>{
	const d=f.driver;
	await d.evaluate(`(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({schema_version:2,last_closed_month:null,account_balances:{},monthly_summaries:{}});await db.saveMasterConfig({schema_version:2});window.__legacyRaw67=await db.captureImportState();await window.__yose_app.settingsController.renderSettings();})()`);
	assert.match(await d.textContent('#budget-categories-list-container'),/費目が登録されていません/);
	assert.deepEqual(await d.evaluate('(()=>{const c=window.__yose_app.budgetSettingsController;return {year:c.year,draftYear:{schema_version:c.draft.state.master_config.schema_version,hasAccounts:Object.hasOwn(c.draft.state.master_config,"accounts"),hasCategories:Object.hasOwn(c.draft.state.master_config,"categories")},loading:c.loading,saving:c.saving,yearDisabled:document.querySelector("#setting-budget-year").disabled,basisDisabled:document.querySelector("#setting-goal-basis").disabled,expenseDisabled:document.querySelector("#setting-expense-budget").disabled,expenseReadOnly:document.querySelector("#setting-expense-budget").readOnly,saveDisabled:document.querySelector("#btn-save-annual-budget").disabled};})()'),{year:'2026',draftYear:{schema_version:2,hasAccounts:false,hasCategories:false},loading:false,saving:false,yearDisabled:false,basisDisabled:false,expenseDisabled:false,expenseReadOnly:false,saveDisabled:false});
	assert.equal(await d.evaluate('(async()=>JSON.stringify(window.__legacyRaw67)===JSON.stringify(await window.__yose_app.db.captureImportState()))()'),true);
});

it('keeps tag, cross-table and account totals on the same month and year boundaries without counting deleted entries',async()=>{
	const d=f.driver,txs=[transaction('current67',{amount:130,tags:['共通']}),transaction('earlier67',{amount:50,tags:['共通'],date:'2026-09-20',target_month:'2026-09'}),transaction('deleted67',{amount:10,tags:['共通'],is_deleted:true})];
	await d.click('[data-analytics-target="cashflow"]');await d.evaluate('window.__yose_app.summaryController.renderSummary()');
	await d.evaluate(`(async()=>{const config=await window.__yose_app.db.getMasterConfig();config.accounts=config.accounts.filter(a=>a.id==='acc_wallet');config.categories=config.categories.filter(c=>c.id==='cat_food');window.__periodConfig67=config;window.__periodTx67=${JSON.stringify(txs)};})()`);
	for(const [target,granularity,amount,count]of [['cashflow','daily',130,1],['cashflow','monthly',130,1],['cashflow','yearly',180,2],['budget','monthly',180,2]]){
		await d.evaluate(`(async()=>{const app=window.__yose_app,c=app.summaryController;app.analyticsTarget=${JSON.stringify(target)};app.analyticsGranularity=${JSON.stringify(granularity)};c.renderTagAnalytics(window.__periodTx67);c.renderCrossMatrix(window.__periodTx67,window.__periodConfig67);await c.renderAccountBalances(null,window.__periodTx67,window.__periodConfig67);})()`);
		assert.match(await d.textContent('#tag-breakdown-list [data-filter-tag="共通"]'),new RegExp(`${count}件`));assert.match(await d.textContent('#tag-breakdown-list [data-filter-tag="共通"]'),new RegExp(`支出: ¥${amount}`));
		assert.deepEqual(await d.evaluate('[...document.querySelector("#cross-matrix-table-container tbody tr").cells].slice(1).map(td=>td.textContent)'),['¥'+amount,'¥'+amount]);
		const account=await d.textContent('#account-balances-list [data-filter-account="acc_wallet"]');assert.ok(account.includes('¥'+amount));if(target==='cashflow')assert.ok(account.includes(`${count}件`));
	}
});
