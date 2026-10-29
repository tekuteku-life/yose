import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, value } from '../helpers/ui_fixture.js';
import { flushWorkflow, rawWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
for (const tax of ['add10', 'add8', 'sub10', 'sub8']) for (const base of [0, 1000]) uiCase67(fixture, `applies ${tax} to the actual calculator amount ${base} with complete tax metadata`, async d => {
	await d.fill('#input-amount', String(base)); await d.click('#btn-open-tax-calc');
	await d.waitFor('document.querySelector("#modal-tax").classList.contains("active")');
	await d.click(`.calc-btn[data-calc-tax="${tax}"]`);
	const rate = tax.endsWith('10') ? .1 : .08, added = tax.startsWith('add'), taxAmount = added ? Math.floor(base * rate) : Math.floor(base * (rate === .1 ? 10 / 110 : 8 / 108));
	const amount = added ? base + taxAmount : base;
	assert.equal(await d.textContent('#calc-result-display'), `¥${amount.toLocaleString()}`);
	await d.click('#btn-apply-tax');
	assert.equal(await value(d, '#input-amount'), String(amount)); assert.equal(await d.isVisible('#modal-tax'), false);
	const meta = await d.evaluate('window.__yose_app.currentTaxMeta');
	assert.deepEqual({ base: meta.base_amount, tax: meta.tax_amount, rate: meta.tax_rate, rounding: meta.rounding }, { base: added ? base : base - taxAmount, tax: taxAmount, rate, rounding: 'floor' });
});
uiCase67(fixture, 'turns a one-character calculator expression back into zero and clears its tax summary', async d => {
	await d.fill('#input-amount', '7'); await d.click('#btn-open-tax-calc'); await d.click('.calc-btn[data-calc-action="backspace"]');
	assert.equal(await d.textContent('#calc-result-display'), '¥0'); await d.click('#btn-apply-tax');
	assert.equal(await value(d, '#input-amount'), '0'); assert.equal(await d.evaluate('window.__yose_app.currentTaxMeta'), null);
});
uiCase67(fixture, 'applies a genuine income memo classification to both current axes without saving the new draft', async d => {
	await seed(d, [transaction('income-memory67', { type: 'income', category_id: 'cat_income_main', subcategory_id: 'sub_salary', actual_category_id: 'cat_income_main', actual_subcategory_id: 'sub_salary', memo: 'INCOME_MEMORY67' })]);
	await d.evaluate('window.__yose_app.txInputController.populateMasterDropdowns()'); await flushWorkflow(d);
	await d.select('#input-type', 'income'); await flushWorkflow(d); await d.select('#select-category', 'cat_point_income'); await flushWorkflow(d);
	const before = await rawWorkflow(d); await d.fill('#input-memo', 'INCOME_MEMORY67'); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate('["select-category","select-subcategory","select-actual-category","select-actual-subcategory"].map(id=>document.getElementById(id).value)'), ['cat_income_main', 'sub_salary', 'cat_income_main', 'sub_salary']);
	assert.deepEqual(await rawWorkflow(d), before);
});
uiCase67(fixture, 'does not apply a historical memo whose real child was archived after that transaction was saved', async d => {
	await seed(d, [transaction('memo-old67', { category_id: 'cat_food', subcategory_id: 'sub_groceries', actual_category_id: 'cat_food', actual_subcategory_id: 'sub_groceries', memo: 'ARCHIVED_MEMORY67' })]);
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(config=>{config.categories.find(c=>c.id==="cat_food").subcategories.find(s=>s.id==="sub_groceries").is_archived=true;})');
	await d.evaluate('window.__yose_app.txInputController.populateMasterDropdowns()'); await d.select('#select-category', 'cat_housing'); await flushWorkflow(d); await d.select('#select-subcategory', 'sub_rent');
	const before = await rawWorkflow(d); await d.fill('#input-memo', 'ARCHIVED_MEMORY67'); await flushWorkflow(d);
	assert.equal(await value(d, '#select-category'), 'cat_housing'); assert.equal(await value(d, '#select-subcategory'), 'sub_rent'); assert.deepEqual(await rawWorkflow(d), before);
});
