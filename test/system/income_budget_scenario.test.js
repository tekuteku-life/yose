import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { SyncManager } from '../../js/sync.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { canonicalJsonStringify, generateDatabaseMasterKey, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { YoseDB } from '../../js/db.js';
import { buildCategoryTrend } from '../../js/logic/category_trend.js';
import * as budget from '../../js/logic/budget_engine.js';
import { transaction } from '../helpers/ui_fixture.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');
it('takes closed income breakdown from GAS through encrypted snapshot import and recomputes linked annual targets', async () => {
	const rows = [transaction('salary', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', subcategory_id: 'sub_salary', actual_subcategory_id: 'sub_salary', amount: 1000, date: '2026-09-20', target_month: '2026-09' })];
	const frozen = gas.computeMonthlySummary(rows, {});
	assert.equal(frozen.by_income_category?.cat_income_main.total, 1000);
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.importFullData({ summary_snapshot: { last_closed_month: '2026-09', monthly_summaries: { '2026-09': frozen } } });
	await db.saveAnnualBudget('2026', { goal_basis: 'rate', savings_target_rate: 20 });
	await db.putTransactions([transaction('next', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', amount: 500, status: 'planned' })]);
	const state = await db.getAnalyticsState();
	const trend = buildCategoryTrend([...rows, ...state.transactions], state.summary_snapshot, state.master_config, { type: 'income', year: '2026' });
	assert.equal(trend.series[0].values[8], 1000); assert.equal(trend.series[0].values[9], 500);
	const p = budget.calculateAnnualBudgetProgress({ budgetConfig: state.master_config.annual_budgets[2026], incomeActual: 1500 });
	assert.equal(p.expense_budget, 1200); assert.equal(p.savings_target_amount, 300);
});

it('sends linked goals and closed income maps through real signatures into another encrypted DB and replacement imports', async () => {
	const env=new MockGasEnvironment();env.setupGlobals();
	try {
		const db=new YoseDB();await db.init();db.setEncryptionKey(await generateDatabaseMasterKey());
		const keys=await generateEd25519KeyPair();PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS',await exportPublicKeyBase64(keys.publicKey));
		gas.saveJsonFile('master_config.json',sharedMasterConfig(await db.getMasterConfig()));gas.saveJsonFile('summary_snapshot.json',await db.getSnapshot());
		const fetch=async(_url,options)=>({ok:true,text:async()=>JSON.stringify(gas.doPost({postData:{contents:options.body}}))});
		const sync=new SyncManager({db,privateKey:keys.privateKey,gasUrl:'https://gas.test',customFetch:fetch});
				await db.saveAnnualBudget('2026',{goal_basis:'rate',savings_target_rate:20,furusato_estimate:{resident_tax:200000,income_tax_rate:20}});
		await sync.syncMaster();
		await db.putTransaction(transaction('salary',{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',amount:1000}));
		await sync.syncPendingDiffs();assert.equal((await sync.closeMonth('2026-10')).success,true);
		const copy=new YoseDB();await copy.init();copy.setEncryptionKey(await generateDatabaseMasterKey());
		const receiver=new SyncManager({db:copy,privateKey:keys.privateKey,gasUrl:'https://gas.test',customFetch:fetch});await receiver.fetchRemoteState();
		assert.equal((await copy.getAnnualBudget('2026')).goal_basis,'rate');assert.equal((await copy.getAnnualBudget('2026')).savings_target_rate,20);
		const snapshot=await copy.getSnapshot();assert.equal(snapshot.monthly_summaries['2026-10'].by_actual_income_category.cat_income_main.total,1000);
		const exported=await copy.exportFullData();
		await copy.commitReplacementImport(await copy.prepareReplacementImport(exported),{confirmation:'完全インポート'});
		assert.equal((await copy.getAnnualBudget('2026')).goal_basis,'rate');assert.equal((await copy.getAnnualBudget('2026')).furusato_estimate.resident_tax,200000);
		const remoteBefore=gas.loadJsonFile('master_config.json'),bad=structuredClone(remoteBefore);bad.annual_budgets[2026].goal_basis='bad';
		await assert.rejects(sync.sendRequest('update_master',{master_config:bad,base_version:canonicalJsonStringify(remoteBefore)}));assert.deepEqual(gas.loadJsonFile('master_config.json'),remoteBefore);
		const before=await copy.captureImportState();exported.master_config.annual_budgets[2026].goal_basis='bad';
		await assert.rejects(copy.prepareReplacementImport(exported));assert.deepEqual(await copy.captureImportState(),before);
		await db.saveAnnualBudget('2026',{...(await db.getAnnualBudget('2026')),goal_basis:'expense',expense_budget:2000});
		const other=gas.loadJsonFile('master_config.json');other.annual_budgets[2026].savings_target_rate=30;gas.saveJsonFile('master_config.json',other);
		assert.equal((await sync.syncMaster()).status,'master_conflict');assert.equal(gas.loadJsonFile('master_config.json').annual_budgets[2026].goal_basis,'rate');
	} finally { env.teardownGlobals(); }
});
it('closes valid inherited-name income and expense categories, children and accounts without inherited values', () => {
	for(const type of ['income','expense']) {
		const s=gas.computeMonthlySummary([transaction('own',{type,account_id:'toString',category_id:'toString',actual_category_id:'valueOf',subcategory_id:'toString',actual_subcategory_id:'valueOf',amount:100})]);
		const a=type==='income'?s.by_income_category:s.by_category, b=type==='income'?s.by_actual_income_category:s.by_actual_category;
		assert.equal(a.toString.total,100);assert.equal(a.toString.by_subcategory.toString,100);assert.equal(b.valueOf.total,100);assert.equal(b.valueOf.by_subcategory.valueOf,100);
		assert.equal(s.closing_balances.toString,type==='income'?100:-100);
	}
});
