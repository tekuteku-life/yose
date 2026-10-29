import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction } from '../helpers/ui_fixture.js';

const f = useBrowser({ realCharts: true });
async function observe(d) {
	await d.evaluate(`(()=>{const app=window.__yose_app,owner=app.summaryController;window.__analytics67=[];for(const name of ['renderSummary','renderCategoryBreakdownList','renderAccountBalances','renderAssetHistory','applyDrilldownFilter']){const original=owner[name];owner[name]=function(...args){const promise=original.apply(this,args);window.__analytics67.push(promise);return promise;};}})()`);
}
async function settle(d) {
	await d.evaluate('(async()=>{let count=-1;while(count!==window.__analytics67.length){count=window.__analytics67.length;await Promise.all(window.__analytics67);}})()');
}
async function tab(d, name) { await d.click(`.tab-btn[data-analytics-target="${name}"]`); await settle(d); }
async function readyState(d, { balances = {}, external = [], budgets = {}, accounts = [] } = {}) {
	await observe(d);
	await d.evaluate(`(async()=>{const app=window.__yose_app,db=app.db;await db.mutateMasterConfig(c=>{c.recurring_rules=[];c.annual_budgets=${JSON.stringify(budgets)};for(const a of c.accounts){a.initial_balance=0;if(a.type==='investment')a.investment_history={};}c.accounts.push(...${JSON.stringify(accounts)});});const config=await db.getMasterConfig();await db.saveSnapshot({schema_version:2,last_closed_month:null,account_balances:Object.fromEntries(config.accounts.map(a=>[a.id,${JSON.stringify(balances)}[a.id]||0])),monthly_summaries:{},external_assets:${JSON.stringify(external)}});})()`);
}

it('keeps tag totals, filtering, unknown-tag clicks and cross-axis totals consistent across periods', async () => {
	const d = f.driver; await readyState(d);
	await seed(d, [
		transaction('food-tag', { amount: 120, tags: ['食費'], actual_category_id: 'cat_housing' }),
		transaction('income-tag', { type: 'income', amount: 300, category_id: 'cat_income_main', actual_category_id: 'cat_income_main', tags: ['食費'] }),
		transaction('untagged', { amount: 30, tags: [] }),
		transaction('earlier-tag', { date: '2026-09-20', target_month: '2026-09', amount: 50, tags: ['前年ではない'] })
	]);
	await tab(d, 'cashflow');
	assert.match(await d.textContent('#tag-breakdown-list [data-filter-tag="食費"]'), /収入: ¥300/);
	assert.match(await d.textContent('#tag-breakdown-list [data-filter-tag="食費"]'), /支出: ¥120/);
	assert.match(await d.textContent('#cross-matrix-table-container'), /150/);
	const filter = await d.evaluate('document.querySelector("#select-tag-filter").value');
	await d.click('#tag-breakdown-list [data-filter-tag="(未設定)"]'); await settle(d);
	assert.equal(await d.evaluate('document.querySelector("#select-tag-filter").value'), filter);
	await d.fill('#input-tag-search', '食費'); assert.equal(await d.evaluate('document.querySelectorAll("#tag-breakdown-list [data-filter-tag]").length'), 1);
	await d.fill('#input-tag-search', '該当なし'); assert.match(await d.textContent('#tag-breakdown-list'), /該当するタグの取引はありません/);
	await d.fill('#input-tag-search', '');
	await d.click('#control-granularity [data-granularity="yearly"]'); await settle(d);
	assert.match(await d.textContent('#tag-breakdown-list'), /前年ではない/); assert.match(await d.textContent('#cross-matrix-table-container'), /200/);
	await d.click('#control-granularity [data-granularity="daily"]'); await settle(d);
	assert.equal((await d.textContent('#tag-breakdown-list')).includes('前年ではない'), false);
	await d.click('#tag-breakdown-list [data-filter-tag="食費"]'); await settle(d);
	assert.equal(await d.evaluate('document.querySelector("#select-tag-filter").value'), '食費');
	assert.deepEqual(await d.evaluate('[...document.querySelectorAll("#month-tx-list .tx-item")].map(el=>el.dataset.id).sort()'), ['food-tag', 'income-tag']);
});

it('preserves legacy external valuations and insurance maturity details in assets and numeric fallbacks', async () => {
	const d = f.driver; await readyState(d, {
		balances: { acc_wallet: 400, 'card-67': -50, 'insurance-67': 20, 'loan-67': 10 },
		external: [{ id: 'market', name: '時価外部', market_value: 100 }, { id: 'current', name: '現在外部', current_value: 200 }, { id: 'amount', name: '金額外部', amount: 300 }, { id: 'unknown', name: '評価未入力' }],
		accounts: [{ id: 'insurance-67', name: '保険67', type: 'insurance', is_asset: true, initial_balance: 0, maturity_date: '2030-12-31', maturity_amount: 800 }, { id: 'loan-67', name: 'ローン67', type: 'loan', initial_balance: 0 }, { id: 'card-67', name: 'カード67', type: 'credit_card', initial_balance: 0 }]
	});
	await tab(d, 'assets');
	const text = await d.textContent('#breakdown-table-container');
	for (const expected of ['時価外部', '¥100', '現在外部', '¥200', '金額外部', '¥300', '評価未入力', '2030-12-31', '¥800', 'ローン67']) assert.ok(text.includes(expected), expected);
	assert.equal(await d.textContent('#stat-total-assets'), '¥960');
	const rows = await d.evaluate('[...document.querySelectorAll("#breakdown-table-container tbody tr")].map(row=>row.textContent)');
	assert.match(rows.find(row => row.includes('カード67')), /-¥50/); assert.match(rows.find(row => row.includes('ローン67')), /¥10/);
	const assets = await d.evaluate('[...document.querySelectorAll("#breakdown-table-container tbody tr")].map(row=>[...row.querySelectorAll("td")].map(cell=>cell.textContent.trim()))');
	for (const [name, amount] of [['時価外部', '¥100'], ['現在外部', '¥200'], ['金額外部', '¥300'], ['評価未入力', '¥0']]) {
		const row = assets.find(cells => cells[0] === name); assert.ok(row, name); assert.equal(row[1], '外部資産'); assert.equal(row[2], amount);
	}
	assert.match(await d.textContent('#account-balances-list'), /満期: 2030-12-31/);
	await d.evaluate('window.Chart=undefined'); await tab(d, 'assets');
	assert.match(await d.textContent('#chart-fallback'), /総資産/); assert.match(await d.textContent('#asset-history-fallback'), /純資産/);
});

for (const [expense, income, expected] of [[900, 1200, '注意'], [850, 1200, '順調'], [1100, 1000, '予算超過']]) it(`shows annual budget status and category amounts for expense ${expense}`, async () => {
	const d = f.driver; await readyState(d, { budgets: { 2026: { expense_budget: 1000, savings_target_amount: 100, savings_target_rate: 20, category_budgets: { cat_food: 900, cat_housing: 100 } } } });
	await seed(d, [transaction('expense', { amount: expense }), transaction('salary', { amount: income, type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main' })]);
	await tab(d, 'budget');
	assert.match(await d.textContent('#stat-budget-pace-status'), new RegExp(expected));
	assert.ok((await d.textContent('#stat-budget-expense')).includes(`¥${expense.toLocaleString()}`));
	assert.match(await d.textContent('#budget-category-progress-container'), /食費/);
	const categories = await d.evaluate('[...document.querySelectorAll("#budget-category-progress-container tbody tr")].map(row=>[...row.querySelectorAll("td")].map(cell=>cell.textContent.trim()))');
	const food = categories.find(cells => cells[0].includes('食費')), housing = categories.find(cells => cells[0].includes('住居'));
	assert.deepEqual(food.slice(1, 4), ['¥900', `¥${expense.toLocaleString()}`, `¥${(900 - expense).toLocaleString()}`]);
	assert.equal(food[5], expense > 900 ? '予算超過' : '注意');
	assert.match(food[4], new RegExp(`${Math.round(expense / 900 * 1000) / 10}%`));
	assert.deepEqual(housing.slice(1, 4), ['¥100', '¥0', '¥100']); assert.equal(housing[5], '抑制中'); assert.match(housing[4], /0%/);
	if (expense === 900) assert.match(await d.textContent('#label-budget-rate-eval'), /達成中/);
	if (expense > income) assert.match(await d.textContent('#label-budget-savings-rate'), /赤字/);
});

it('keeps optional render contexts equivalent to the visible summary and handles empty series without Chart', async () => {
	const d = f.driver; await readyState(d);
	await seed(d, [transaction('component', { amount: 123 })]); await tab(d, 'cashflow');
	const result = await d.evaluate(`(async()=>{const app=window.__yose_app,owner=app.summaryController,{calculateBalancesAndSummaries}=await import('./js/logic.js'),state=await app.db.getAnalyticsState(),summary=calculateBalancesAndSummaries(state.summary_snapshot,state.transactions,app.currentMonth);const before=document.querySelector('#account-balances-list').textContent;await owner.renderAccountBalances(summary,state.transactions);const after=document.querySelector('#account-balances-list').textContent;await owner.renderCategoryBreakdownList(summary.by_category);const categories=document.querySelector('#category-breakdown-list').textContent;await owner.applyDrilldownFilter();const filters=[...document.querySelectorAll('#card-month-tx-list select')].slice(0,4).map(el=>el.value);window.Chart=undefined;app.chartController.drawTime('chart','summary','summary-chart','chart-fallback','空の推移','line',{labels:[],datasets:[]});return {before,after,categories,filters,fallback:document.querySelector('#chart-fallback').textContent};})()`);
	assert.equal(result.before, result.after); assert.match(result.categories, /123/); assert.ok(result.filters.every(value => value === 'all'));
	assert.match(result.fallback, /対象の費目データはありません/);
});

it('renders empty assets from an accepted legacy master with omitted optional collections', async () => {
	const d = f.driver; await observe(d);
	await d.evaluate(`(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({schema_version:2,last_closed_month:null,account_balances:{},monthly_summaries:{}});await db.saveMasterConfig({schema_version:2});})()`);
	const before = await d.evaluate('window.__yose_app.db.captureImportState()');
	await tab(d, 'cashflow'); assert.match(await d.textContent('#tag-breakdown-list'), /該当するタグ/);
	await tab(d, 'assets'); assert.equal(await d.textContent('#stat-total-assets'), '¥0'); assert.match(await d.textContent('#breakdown-table-container'), /登録なし/);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'), before);
});
