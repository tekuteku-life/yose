import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const f = useBrowser();
it('rejects expired parent render contexts before reading data or changing any visible or stored state', async () => {
	const d = f.driver;
	const result = await d.evaluate(`(async()=>{
		const app=window.__yose_app,db=app.db,raw=await db.captureImportState(),html=document.querySelector('main').innerHTML,reads=[];
		const names=['getAnalyticsState','getMasterConfig','getTransactions','getPendingImport','getDataMetadata'],restores=names.map(name=>{const original=db[name];db[name]=function(...args){reads.push(name);return original.apply(this,args);};return()=>db[name]=original;});
		try{
			const options={isSessionValid:()=>false};
			await app.summaryController.renderSummary(options);await app.summaryController.renderAssetHistory(null,options);
			await app.summaryController.renderAccountBalances(null,[],null,options);await app.summaryController.renderCategoryBreakdownList({},null,app.summaryController.renderVersion,options);
			await app.settingsController.backupImportController.renderPending(options);
			await app.budgetSettingsController.render(options);await app.furusatoController.render(null,options);await app.insightsController.renderMetadata(options);await app.maintenanceController.refresh(options);
			return {reads,htmlUnchanged:html===document.querySelector('main').innerHTML,rawUnchanged:JSON.stringify(raw)===JSON.stringify(await db.captureImportState())};
		}finally{restores.forEach(restore=>restore());}
	})()`);
	assert.deepEqual(result,{reads:[],htmlUnchanged:true,rawUnchanged:true});
});

it('keeps initial component callbacks without a loaded draft from creating or changing business data', async () => {
	const d=f.driver;
	const result=await d.evaluate(`(async()=>{const app=window.__yose_app,raw=await app.db.captureImportState(),html=document.querySelector('main').innerHTML;
		const {BudgetSettingsController}=await import('/js/ui/budget_settings_controller.js'),{InsightsController}=await import('/js/ui/insights_controller.js'),{FurusatoController}=await import('/js/ui/furusato_controller.js');
		const budget=new BudgetSettingsController(app),insight=new InsightsController(app),tax=new FurusatoController(app);
		budget.preview();budget.autoCalculate();await budget.save();insight.loadInvestmentDraft();await insight.saveInvestment();tax.preview();await tax.saveFurusato();await tax.saveFurusatoSources();
		return{rawUnchanged:JSON.stringify(raw)===JSON.stringify(await app.db.captureImportState()),htmlUnchanged:html===document.querySelector('main').innerHTML,drafts:[budget.draft??null,insight.investmentDraft,tax.taxDraft,tax.sourceDraft]};
	})()`);
	assert.deepEqual(result,{rawUnchanged:true,htmlUnchanged:true,drafts:[null,null,null,null]});
});

it('shows an investment observation as committed when only the following display refresh fails',async()=>{
	const d=f.driver;
	await d.click('[data-analytics-target="assets"]');
	await d.evaluate(`(()=>{const app=window.__yose_app,owner=app.insightsController,original=owner.commitInvestment;window.__investment67=[];owner.commitInvestment=function(...args){const p=original.apply(this,args);window.__investment67.push(p);return p;};app.refreshAllViews=async()=>{throw new Error('DISPLAY_FAILURE67');};})()`);
	await d.fill('#investment-date','2026-10-19');await d.fill('#investment-acquisition-cost','400');await d.fill('#investment-valuation','550');
	const account=await d.evaluate('document.querySelector("#investment-account").value');
	await d.click('#btn-save-investment');await d.evaluate('Promise.all(window.__investment67)');
	assert.match(await d.textContent('#investment-error'),/保存済みです。表示を更新してください。DISPLAY_FAILURE67/);
	assert.deepEqual(await d.evaluate(`(async()=>{const c=await window.__yose_app.db.getMasterConfig();return c.accounts.find(a=>a.id===${JSON.stringify(account)}).investment_history['2026-10-19'];})()`),{acquisition_cost:400,market_value:550});
	assert.equal(await d.evaluate('document.querySelector("#btn-save-investment").disabled'),false);
});

it('treats late analytics callbacks after an actual lock as no-ops before any business read or write',async()=>{
	const d=f.driver;await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	const result=await d.evaluate(`(async()=>{const app=window.__yose_app,raw=await app.db.captureImportState(),html=document.querySelector('main').innerHTML,dialogs=window.__dialogs.length,reads=[],restores=[];for(const name of ['getAnalyticsState','getMasterConfig','getTransactions']){const read=app.db[name];app.db[name]=function(...args){reads.push(name);return read.apply(this,args);};restores.push(()=>app.db[name]=read);}try{
		await app.insightsController.commitInvestment('acc_investment_main','2026-10-20',{acquisition_cost:10,market_value:20},null);await app.furusatoController.confirmLedger();await app.summaryController.handleGenerateRecurring();await app.summaryController.generateRecurring();await app.maintenanceController.migrate();await app.refreshAllViews();await app.refreshAfterTransactionChange();await app.scheduleTransactionMaintenance();app.chartController.drawTime('chart','summary','summary-chart','chart-fallback','旧描画','line',{labels:[],datasets:[]});
		return{reads,rawSame:JSON.stringify(raw)===JSON.stringify(await app.db.captureImportState()),htmlSame:html===document.querySelector('main').innerHTML,dialogsSame:dialogs===window.__dialogs.length,task:app._transactionMaintenanceTask??null,chart:app.chartController.chart};
	}finally{restores.forEach(restore=>restore());}})()`);
	assert.deepEqual(result,{reads:[],rawSame:true,htmlSame:true,dialogsSame:true,task:null,chart:null});
});
