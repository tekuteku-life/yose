import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, value } from '../helpers/ui_fixture.js';
import { rawWorkflow, flushWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67, observeExpectedDialog67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
const config67 = d => d.evaluate('window.__yose_app.db.getMasterConfig()');
async function untouched67(d) {
	await seed(d, [transaction('domain-kept67', { sync_status: 'synced' })]);
	return d.evaluate('window.__yose_app.db.getRaw("transactions","domain-kept67")');
}
async function saved67(d, form) {
	await d.click(`${form} button[type=submit]`); await flushWorkflow(d);
	await d.waitFor('!document.querySelector("#modal-master-item").classList.contains("active")');
}
for (const offset of [1, 2]) uiCase67(fixture, `creates a credit card with a real bank debit in offset ${offset} and preserves those settings when reopened`, async d => {
	const raw = await untouched67(d); await settings67(d, 'accounts'); await d.click('#btn-add-account'); await flushWorkflow(d);
	await d.fill('#m-acc-id', 'acc_credit_domain67'); await d.fill('#m-acc-name', 'Configured card67'); await d.select('#m-acc-type', 'credit_card');
	assert.equal(await d.isVisible('#m-acc-cc-fields'), true);
	await d.fill('#m-acc-closing-day', '15'); await d.fill('#m-acc-debit-day', '27'); await d.select('#m-acc-debit-offset', String(offset)); await d.select('#m-acc-debit-account', 'acc_bank_main');
	await saved67(d, '#form-master-account');
	const account = (await config67(d)).accounts.find(item => item.id === 'acc_credit_domain67');
	assert.deepEqual({ type: account.type, closing: account.closing_day, day: account.debit_day, offset: account.debit_month_offset, debit: account.debit_account_id, settlement: account.settlement_account_id }, { type: 'credit_card', closing: 15, day: 27, offset, debit: 'acc_bank_main', settlement: 'acc_bank_main' });
	await d.click('.btn-edit-account[data-id="acc_credit_domain67"]'); await flushWorkflow(d);
	assert.equal(await value(d, '#m-acc-type'), 'credit_card'); assert.equal(await value(d, '#m-acc-debit-offset'), String(offset)); assert.equal(await value(d, '#m-acc-debit-account'), 'acc_bank_main');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","domain-kept67")'), raw);
});

uiCase67(fixture, 'creates a maturity-valued insurance policy and the matching premium rule with its selected bank and classification', async d => {
	const raw = await untouched67(d); await settings67(d, 'accounts'); await d.click('#btn-add-account'); await flushWorkflow(d);
	await d.fill('#m-acc-id', 'acc_insurance_domain67'); await d.fill('#m-acc-name', 'Insurance domain67'); await d.select('#m-acc-type', 'insurance');
	assert.equal(await d.isVisible('#m-acc-insurance-fields'), true);
	await d.fill('#m-acc-maturity-date', '2031-12-31'); await d.fill('#m-acc-maturity-amount', '50000'); await d.fill('#m-acc-premium-amount', '700'); await d.fill('#m-acc-premium-day', '15'); await d.select('#m-acc-premium-pay-account', 'acc_bank_main'); await d.select('#m-acc-premium-cat', 'cat_housing'); await d.select('#m-acc-premium-sub', 'sub_rent');
	await saved67(d, '#form-master-account');
	const config = await config67(d), account = config.accounts.find(item => item.id === 'acc_insurance_domain67'), rules = config.recurring_rules.filter(item => item.linked_insurance_account_id === account.id);
	assert.equal(account.maturity_date, '2031-12-31'); assert.equal(account.maturity_amount, 50000); assert.equal(account.premium_amount, 700); assert.equal(rules.length, 1);
	assert.deepEqual({ amount: rules[0].amount, day: rules[0].day_of_month, account: rules[0].account_id, category: rules[0].category_id, child: rules[0].subcategory_id, actual: rules[0].actual_category_id, actualChild: rules[0].actual_subcategory_id, end: rules[0].end_date, active: rules[0].is_active }, { amount: 700, day: 15, account: 'acc_bank_main', category: 'cat_housing', child: 'sub_rent', actual: 'cat_housing', actualChild: 'sub_rent', end: '2031-12-31', active: true });
	await d.click('.btn-edit-account[data-id="acc_insurance_domain67"]'); await flushWorkflow(d); assert.equal(await value(d, '#m-acc-maturity-amount'), '50000'); assert.equal(await value(d, '#m-acc-premium-sub'), 'sub_rent');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","domain-kept67")'), raw);
});

uiCase67(fixture, 'creates an income category and preserves its actual selected type when renaming it', async d => {
	const raw = await untouched67(d); await settings67(d, 'categories'); await d.click('#btn-add-category'); await flushWorkflow(d);
	await d.fill('#m-cat-id', 'cat_income_domain67'); await d.fill('#m-cat-name', 'Income domain67'); await d.select('#m-cat-type', 'income'); await saved67(d, '#form-master-category');
	await d.click('.btn-edit-cat[data-id="cat_income_domain67"]'); await flushWorkflow(d); assert.equal(await value(d, '#m-cat-type'), 'income'); await d.fill('#m-cat-name', 'Renamed income67'); await saved67(d, '#form-master-category');
	const item = (await config67(d)).categories.find(row => row.id === 'cat_income_domain67'); assert.equal(item.name, 'Renamed income67'); assert.equal(item.type, 'income');
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","domain-kept67")'), raw);
});

uiCase67(fixture, 'rejects an empty or identical recurring transfer destination and saves exactly one rule after an explicit valid selection', async d => {
	await settings67(d, 'recurring'); await d.click('#btn-add-recurring'); await flushWorkflow(d);
	await d.fill('#m-rec-id', 'rec_transfer_domain67'); await d.fill('#m-rec-name', 'Transfer domain67'); await d.fill('#m-rec-amount', '300'); await d.select('#m-rec-type', 'transfer'); await d.select('#m-rec-account', 'acc_wallet');
	const raw = await rawWorkflow(d), count = await d.evaluate('window.__workflowJobs.filter(job=>job.name==="runMasterOperation").length');
	assert.equal(await d.evaluate('document.querySelector("#m-rec-to-account").validity.valueMissing'), true); await d.click('#form-master-recurring button[type=submit]');
	assert.equal(await d.evaluate('window.__workflowJobs.filter(job=>job.name==="runMasterOperation").length'), count, 'native required validation must reject the missing destination');
	await d.select('#m-rec-to-account', 'acc_wallet'); await observeExpectedDialog67(d, () => d.click('#form-master-recurring button[type=submit]'), /振替元とは異なる振替先/); assert.deepEqual(await rawWorkflow(d), raw);
	await d.select('#m-rec-to-account', 'acc_bank_main'); await saved67(d, '#form-master-recurring');
	const rules = (await config67(d)).recurring_rules.filter(item => item.id === 'rec_transfer_domain67'); assert.equal(rules.length, 1);
	assert.deepEqual({ type: rules[0].type, amount: rules[0].amount, from: rules[0].account_id, to: rules[0].to_account_id, category: rules[0].category_id, child: rules[0].subcategory_id }, { type: 'transfer', amount: 300, from: 'acc_wallet', to: 'acc_bank_main', category: null, child: null });
});

uiCase67(fixture, 'renders omitted optional legacy master collections and creates valid account, category and holiday collections through their real controls', async d => {
	// Persist the accepted old sparse master shape rather than mocking a DB return value.
	await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.putRaw("master_config",await db.encryptRecord({schema_version:2,point_payment_defaults:null}),"current");})()');
	await settings67(d, 'accounts'); assert.match(await d.textContent('#master-accounts-list'), /口座が登録されていません/); assert.match(await d.textContent('#master-categories-list'), /費目が登録されていません/); assert.match(await d.textContent('#master-recurring-list'), /定期ルールが登録されていません/); assert.match(await d.textContent('#master-holidays-list'), /祝日が登録されていません/);
	await d.click('#btn-add-account'); await flushWorkflow(d); await d.fill('#m-acc-id', 'acc_sparse67'); await d.fill('#m-acc-name', 'Recovered account67'); await saved67(d, '#form-master-account');
	await d.click('.master-tab-btn[data-master="categories"]'); await d.click('#btn-add-category'); await flushWorkflow(d); await d.fill('#m-cat-id', 'cat_sparse67'); await d.fill('#m-cat-name', 'Recovered category67'); await saved67(d, '#form-master-category');
	await d.click('.master-tab-btn[data-master="holidays"]'); await d.fill('#input-new-holiday', '2031-01-02'); await d.click('#btn-add-holiday'); await flushWorkflow(d);
	const config = await config67(d); assert.equal(config.accounts.length, 1); assert.equal(config.accounts[0].id, 'acc_sparse67'); assert.equal(config.categories.length, 1); assert.equal(config.categories[0].id, 'cat_sparse67'); assert.deepEqual(config.holidays, ['2031-01-02']); assert.equal(config.point_payment_defaults, null);
});
