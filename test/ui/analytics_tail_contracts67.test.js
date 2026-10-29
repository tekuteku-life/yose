import assert from 'node:assert/strict';
import {useBrowser,seed,transaction,cashflow} from '../helpers/ui_fixture.js';
import {uiCase67} from '../helpers/ui_workflows67.js';
import {flushWorkflow,rawWorkflow} from '../helpers/workflow_ui_fixture.js';
const f=useBrowser();
uiCase67(f,'uses the actual expense axis in a native daily category breakdown',async d=>{
	await seed(d,[transaction('daily-actual67',{amount:123,category_id:'cat_food',actual_category_id:'cat_housing'})]);const raw=await d.evaluate('window.__yose_app.db.getAllRaw("transactions")');await cashflow(d);await d.click('#control-granularity [data-granularity="daily"]');await d.click('#btn-toggle-axis');await flushWorkflow(d);await d.evaluate('window.__yose_app.summaryController.renderSummary()');
	assert.equal(await d.evaluate('window.__yose_app.analyticsGranularity'),'daily');assert.equal(await d.evaluate('window.__yose_app.useActualCategoryAxis'),true);assert.match(await d.textContent('#category-breakdown-list [data-filter-category="cat_housing"]'),/123/);assert.equal(await d.evaluate('Boolean(document.querySelector("#category-breakdown-list [data-filter-category=cat_food]"))'),false);assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("transactions")'),raw);
});
uiCase67(f,'renders tax source choices without adding absent legacy category collections',async d=>{
	await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({schema_version:2,last_closed_month:null,account_balances:{},monthly_summaries:{}});await db.saveMasterConfig({schema_version:2});})()');const raw=await rawWorkflow(d);await d.click('[data-tab="tab-tax"]');await d.evaluate('window.__yose_app.furusatoController.render()');
	assert.equal(await d.evaluate('document.querySelectorAll("#furusato-source-salary option").length'),0);assert.equal(await d.evaluate('document.querySelectorAll("#furusato-source-income_tax option").length'),0);assert.equal(await d.textContent('#furusato-error'),'');assert.deepEqual(await rawWorkflow(d),raw);
});
uiCase67(f,'keeps a category-wide tax source selectable when that category omits its subcategory collection',async d=>{
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{delete c.categories.find(x=>x.id==="cat_food").subcategories;})');const raw=await rawWorkflow(d);await d.click('[data-tab="tab-tax"]');await d.evaluate('window.__yose_app.furusatoController.render()');
	const sources=await d.evaluate('[...document.querySelector("#furusato-source-income_tax").options].map(o=>JSON.parse(o.value)).filter(o=>o.category_id==="cat_food")');assert.deepEqual(sources,[{category_id:'cat_food',subcategory_id:null}]);assert.equal(await d.textContent('#furusato-error'),'');assert.deepEqual(await rawWorkflow(d),raw);
});
