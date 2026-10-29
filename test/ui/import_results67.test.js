import assert from 'node:assert/strict';
import { useBrowser, seed, transaction } from '../helpers/ui_fixture.js';
import { rawWorkflow, flushWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
const variants = [
	['full_backup', '全データ', ['master_config', 'summary_snapshot', 'transactions']],
	['transactions', '取引明細', ['transactions']],
	['master_config', 'マスタ設定', ['master_config']],
	['annual_budgets', '年間予算', ['annual_budgets']],
	['summary_snapshot', '残高スナップショット', ['summary_snapshot']]
];
const message = (label, [added, updated, skipped, accounts, categories, children, recurring, holidays, budgets]) => [
	`【${label}差分ORマージ完了】`,
	`・明細: 追加 ${added}件 / 更新 ${updated}件 / スキップ ${skipped}件`,
	`・口座マスタ: 追加 ${accounts}件`,
	`・大項目マスタ: 追加 ${categories}件 (内訳中項目: 追加 ${children}件)`,
	`・定期ルール: 追加 ${recurring}件`,
	`・祝日: 新規追加 ${holidays}件`,
	`・年間予算: 追加/更新 ${budgets}件`
].join('\n');
for (const [type, label, keys] of variants) uiCase67(fixture, `shows the exact ${label} import identity and all nine zero/nonzero counts from real JSON files`, async d => {
	await seed(d, [transaction('import_updated67'), transaction('import_skipped67')]);
	await settings67(d);
	await d.evaluate('(()=>{const db=window.__yose_app.db,original=db.importFullData;window.__importJobs67=[];db.importFullData=function(...args){const pending=original.apply(this,args);window.__importJobs67.push(pending);return pending;};window.__restores67.push(()=>db.importFullData=original);})()');
	const empty = { master_config: {}, transactions: [], annual_budgets: {}, summary_snapshot: {} };
	await d.importFile(JSON.stringify({ schema_version: 2, export_type: type, ...Object.fromEntries(keys.map(key => [key, empty[key]])) }));
	await d.evaluate('Promise.all(window.__importJobs67)'); await flushWorkflow(d);
	assert.equal(await d.evaluate('window.__dialogs.filter(item=>item.type==="alert").at(-1).message'), message(label, Array(9).fill(0)));
	const incoming = {
		transactions: [transaction('import_added67'), transaction('import_updated67', { amount: 222, updated_at: '2026-10-20T03:00:01Z' }), transaction('import_skipped67', { amount: 999, updated_at: '2026-10-19T03:00:00Z' })],
		master_config: {
			accounts: [{ id: 'import_acc67', name: 'Imported account67', type: 'cash', initial_balance: 0, is_asset: true }],
			categories: [{ id: 'import_cat67', name: 'Imported category67', type: 'expense', subcategories: [{ id: 'import_sub67', name: 'Imported child67' }] }],
			recurring_rules: [{ id: 'import_rec67', name: 'Imported recurring67', type: 'expense', amount: 1, account_id: 'import_acc67', category_id: 'import_cat67', subcategory_id: 'import_sub67', day_of_month: 1, is_active: false }],
			holidays: ['2032-01-01'], annual_budgets: { '2032': { expense_budget: 100, category_budgets: { cat_food: 50 } } }
		},
		annual_budgets: { '2032': { expense_budget: 100, category_budgets: { cat_food: 50 } } },
		summary_snapshot: { monthly_summaries: { '2026-09': { income_total: 200, expense_total: 100, net_income: 100 } } }
	};
	await d.importFile(JSON.stringify({ schema_version: 2, export_type: type, ...Object.fromEntries(keys.map(key => [key, incoming[key]])) }));
	await d.evaluate('Promise.all(window.__importJobs67)'); await flushWorkflow(d);
	const hasTx = keys.includes('transactions'), hasMaster = keys.includes('master_config'), hasBudget = hasMaster || keys.includes('annual_budgets');
	assert.equal(await d.evaluate('window.__dialogs.filter(item=>item.type==="alert").at(-1).message'), message(label, [hasTx ? 1 : 0, hasTx ? 1 : 0, hasTx ? 1 : 0, ...Array(5).fill(hasMaster ? 1 : 0), hasBudget ? 1 : 0]));
	if (hasTx) assert.deepEqual(await d.evaluate('(async()=>{const db=window.__yose_app.db;return Promise.all(["import_added67","import_updated67","import_skipped67"].map(async id=>[id,(await db.getTransaction(id)).amount]));})()'), [['import_added67', 100], ['import_updated67', 222], ['import_skipped67', 100]]);
	if (hasMaster) assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).categories.find(item=>item.id==="import_cat67").subcategories[0].id)()'), 'import_sub67');
	if (hasBudget) assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).annual_budgets["2032"].expense_budget)()'), 100);
	if (keys.includes('summary_snapshot')) assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getSnapshot()).monthly_summaries["2026-09"].net_income)()'), 100);
	const before = await rawWorkflow(d);
	await d.importFile(JSON.stringify({ schema_version: 2, export_type: 'unsupported67', transactions: [transaction('rejected_import67')] })); await flushWorkflow(d);
	await d.evaluate('Promise.allSettled(window.__importJobs67)');
	assert.match(await d.evaluate('window.__dialogs.filter(item=>item.type==="alert").at(-1).message'), /インポート失敗.*unknown export type/);
	assert.deepEqual(await rawWorkflow(d), before);
	assert.equal(await d.evaluate('document.querySelector("#file-import-input").value'), '');
});
