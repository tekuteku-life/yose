import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, settings } from '../helpers/ui_fixture.js';
import { observeWorkflow, flushWorkflow, cleanupWorkflow, requireControl, gateMethod, waitGate, releaseGate, rawWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser();
const income = 'custom-offset-income', child = 'custom-offset-child';
const incomeName = '独自収入<img src=x onerror=window.__pointXss=1>', childName = '任意の相殺内訳';
async function configure(d, value = { category_id: income, subcategory_id: child }) {
	await d.evaluate(`window.__yose_app.db.mutateMasterConfig(config=>{
		config.categories.push({id:${JSON.stringify(income)},name:${JSON.stringify(incomeName)},type:'income',is_archived:false,subcategories:[{id:${JSON.stringify(child)},name:${JSON.stringify(childName)},is_archived:false}]});
		config.accounts.push({id:'custom-point-account',name:'独自ポイント口座',type:'point',is_asset:true,initial_balance:0,is_archived:false});
		config.point_payment_defaults=${JSON.stringify(value)};return config;
	})`);
	await d.evaluate('window.__yose_app.txInputController.populateMasterDropdowns()');
}
async function points(d, account = '') {
	await d.click('.tab-btn[data-tab="tab-input"]'); await d.click('.mode-tab-btn[data-mode="point"]');
	await d.fill('#input-point-total', '1200'); await d.fill('#input-point-used', '200'); await d.select('#select-point-account', account);
}
async function openDefaults(d) {
	await settings(d); await d.evaluate('window.__yose_app.settingsController.renderSettings()');
	for (const selector of ['#select-point-offset-category', '#select-point-offset-subcategory', '#btn-save-point-defaults']) await requireControl(d, selector);
	await d.waitFor(`[...document.querySelector('#select-point-offset-category').options].some(option=>option.value===${JSON.stringify(income)})`);
}
async function saveDefaults(d, expected) {
	await d.click('#btn-save-point-defaults');
	await d.waitFor(`(async()=>JSON.stringify((await window.__yose_app.db.getMasterConfig()).point_payment_defaults)===${JSON.stringify(JSON.stringify(expected))})()`);
	await flushWorkflow(d);
}
function pointCase(name, run) {
	it(name, async () => {
		const d = fixture.driver; await observeWorkflow(d);
		try { await run(d); }
		finally { await cleanupWorkflow(d); }
	});
}

pointCase('saves a user-chosen income parent and optional child from settings without fixed IDs or unsafe HTML', async d => {
	await configure(d, null); await openDefaults(d);
	const options = await d.evaluate('[...document.querySelector("#select-point-offset-category").options].map(option=>({value:option.value,text:option.textContent}))');
	assert.equal(options.some(option => option.value === 'cat_food'), false);
	assert.equal(options.find(option => option.value === income).text, incomeName);
	await d.select('#select-point-offset-category', income); await d.select('#select-point-offset-subcategory', child);
	await saveDefaults(d, { category_id: income, subcategory_id: child });
	await d.select('#select-point-offset-category', 'cat_income_main');
	assert.equal(await d.evaluate('document.querySelector("#select-point-offset-subcategory").value'), '');
	await saveDefaults(d, { category_id: 'cat_income_main', subcategory_id: null });
	await d.select('#select-point-offset-category', ''); await saveDefaults(d, null);
	assert.equal(await d.evaluate('Boolean(window.__pointXss)||Boolean(document.querySelector("#select-point-offset-category img"))'), false);
});

for (const subcategory of [child, null]) pointCase(`uses the configured offset classification, optional child=${subcategory}, while preserving both purchase axes and old records`, async d => {
	await configure(d, { category_id: income, subcategory_id: subcategory });
	await seed(d, [transaction('old-point-history', { type: 'income', category_id: 'cat_point_income', subcategory_id: 'sub_point_offset', actual_category_id: 'cat_point_income', actual_subcategory_id: 'sub_point_offset' })]);
	const old = await d.evaluate('window.__yose_app.db.getRaw("transactions","old-point-history")');
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.categories.find(cat=>cat.id==="cat_point_income").is_archived=true;})');
	await points(d);
	await d.select('#select-category', 'cat_food'); await d.waitFor('[...document.querySelector("#select-subcategory").options].some(o=>o.value==="sub_groceries")'); await d.select('#select-subcategory', 'sub_groceries');
	await d.click('#chk-sync-actual-category'); await d.select('#select-actual-category', 'cat_housing');
	await d.waitFor('[...document.querySelector("#select-actual-subcategory").options].some(o=>o.value==="sub_rent")'); await d.select('#select-actual-subcategory', 'sub_rent');
	await d.click('#btn-save-tx'); await flushWorkflow(d);
	const saved = (await records(d)).filter(tx => tx.id !== 'old-point-history'); assert.equal(saved.length, 2);
	const purchase = saved.find(tx => tx.type === 'expense'), offset = saved.find(tx => tx.type === 'income');
	assert.deepEqual([purchase.amount, purchase.account_id, purchase.category_id, purchase.subcategory_id, purchase.actual_category_id, purchase.actual_subcategory_id], [1200, 'acc_wallet', 'cat_food', 'sub_groceries', 'cat_housing', 'sub_rent']);
	assert.deepEqual([offset.amount, offset.account_id, offset.category_id, offset.subcategory_id, offset.actual_category_id, offset.actual_subcategory_id], [200, 'acc_wallet', income, subcategory, income, subcategory]);
	assert.equal(purchase.related_tx_id, offset.id); assert.equal(offset.related_tx_id, purchase.id);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","old-point-history")'), old);
});

for (const invalid of ['unset', 'archived parent', 'archived child']) pointCase(`explains ${invalid} offset defaults and rejects the whole purchase without changing raw state`, async d => {
	await configure(d, invalid === 'unset' ? null : { category_id: income, subcategory_id: child });
	if (invalid !== 'unset') await d.evaluate(`window.__yose_app.db.mutateMasterConfig(c=>{const parent=c.categories.find(cat=>cat.id===${JSON.stringify(income)});${invalid === 'archived parent' ? 'parent' : 'parent.subcategories[0]'}.is_archived=true;})`);
	await points(d); await requireControl(d, '#point-offset-notice');
	const notice = await d.evaluate('document.querySelector("#point-offset-notice").textContent');
	assert.match(notice, invalid === 'unset' ? /未設定|設定.*必要/ : /アーカイブ|無効|再設定/);
	if (invalid !== 'unset') assert.ok(notice.includes(incomeName));
	assert.equal(await d.evaluate('Boolean(document.querySelector("#point-offset-notice img"))||Boolean(window.__pointXss)'), false);
	const before = await rawWorkflow(d); await d.click('#btn-save-tx'); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before); assert.equal((await records(d)).length, 0);
	assert.equal(await d.evaluate('document.querySelector("#input-point-total").value'), '1200');
});

pointCase('continues to accept an arbitrary active point account when offset defaults are unset', async d => {
	await configure(d, null); await points(d, 'custom-point-account');
	await d.click('#btn-save-tx'); await flushWorkflow(d);
	const saved = await records(d); assert.equal(saved.length, 2); assert.ok(saved.every(tx => tx.type === 'expense'));
	assert.deepEqual(saved.map(tx => [tx.account_id, tx.amount]).sort(), [['acc_wallet', 1000], ['custom-point-account', 200]].sort());
});

pointCase('rejects a default archived after submission without partially saving the two point records', async d => {
	await configure(d); await points(d);
	await gateMethod(d, 'window.__yose_app.db', 'putTransactions');
	await d.click('#btn-save-tx'); await waitGate(d);
	await d.evaluate(`window.__yose_app.db.mutateMasterConfig(c=>{c.categories.find(cat=>cat.id===${JSON.stringify(income)}).subcategories[0].is_archived=true;})`);
	const before = await rawWorkflow(d); await releaseGate(d); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before); assert.equal((await records(d)).length, 0);
	assert.equal(await d.evaluate('document.querySelector("#input-point-total").value'), '1200');
});

pointCase('recovers from a conflicting default by explicitly reloading, keeps a rejected reload draft, and writes only after a later save', async d => {
	await configure(d, null); await openDefaults(d);
	await d.select('#select-point-offset-category', income); await d.select('#select-point-offset-subcategory', child);
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.point_payment_defaults={category_id:"cat_income_main",subcategory_id:null};})');
	const before = await rawWorkflow(d);
	await d.click('#btn-save-point-defaults'); await flushWorkflow(d);
	assert.match(await d.evaluate('document.querySelector("#point-defaults-error").textContent'), /変更|競合|確認/);
	assert.deepEqual(await rawWorkflow(d), before);
	assert.equal(await d.evaluate('document.querySelector("#select-point-offset-category").value'), income);
	assert.equal(await d.evaluate('document.querySelector("#select-point-offset-subcategory").value'), child);
	await requireControl(d, '#btn-reload-point-defaults'); await d.setConfirm(false);
	const count = await d.evaluate('window.__dialogs.length');
	await d.click('#btn-reload-point-defaults'); await flushWorkflow(d);
	assert.equal(await d.evaluate('window.__dialogs.length'), count + 1);
	assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /破棄|読み直/);
	assert.equal(await d.evaluate('document.querySelector("#select-point-offset-category").value'), income);
	assert.equal(await d.evaluate('document.querySelector("#select-point-offset-subcategory").value'), child);
	assert.deepEqual(await rawWorkflow(d), before);
	await d.setConfirm(true); await d.click('#btn-reload-point-defaults'); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate('[document.querySelector("#select-point-offset-category").value,document.querySelector("#select-point-offset-subcategory").value]'), ['cat_income_main', '']);
	assert.deepEqual(await rawWorkflow(d), before, 'explicit reload must never save configuration');
	await d.select('#select-point-offset-category', income); await d.select('#select-point-offset-subcategory', child);
	await saveDefaults(d, { category_id: income, subcategory_id: child });
});

pointCase('preserves a dirty default and all raw state when its explicit reload read fails, then allows retry', async d => {
	await configure(d); await openDefaults(d); await requireControl(d, '#btn-reload-point-defaults');
	await d.select('#select-point-offset-category', 'cat_income_main');
	const before = await rawWorkflow(d);
	await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig', { reject: true });
	await d.click('#btn-reload-point-defaults'); await waitGate(d);
	assert.equal(await d.evaluate('[...document.querySelectorAll("#card-point-payment-defaults button,#card-point-payment-defaults select")].every(control=>control.matches(":disabled"))'), true);
	assert.equal(await d.evaluate('Boolean(document.querySelector("#btn-reload-point-defaults .spinner")?.checkVisibility())'), true);
	await releaseGate(d); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before);
	assert.deepEqual(await d.evaluate('[document.querySelector("#select-point-offset-category").value,document.querySelector("#select-point-offset-subcategory").value]'), ['cat_income_main', '']);
	assert.match(await d.evaluate('document.querySelector("#point-defaults-error").textContent'), /WORKFLOW_WRITE_FAILURE/);
	assert.equal(await d.evaluate('document.querySelector("#btn-reload-point-defaults").disabled'), false);
	await d.evaluate('window.__restoreGate()'); await d.click('#btn-reload-point-defaults'); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate('[document.querySelector("#select-point-offset-category").value,document.querySelector("#select-point-offset-subcategory").value]'), [income, child]);
	assert.deepEqual(await rawWorkflow(d), before);
});

pointCase('invalidates an old reload on real authentication change without replacing or releasing a new default save', async d => {
	await configure(d); await openDefaults(d); await requireControl(d, '#btn-reload-point-defaults');
	await d.select('#select-point-offset-category', 'cat_income_main');
	await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig');
	const start = await d.evaluate('window.__workflowJobs.length');
	await d.click('#btn-reload-point-defaults'); await waitGate(d);
	assert.ok(await d.evaluate(`window.__workflowJobs.length>${start}`));
	await d.evaluate(`void(window.__oldReload=Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise)))`);
	await unlockWorkflow(d); await openDefaults(d);
	assert.deepEqual(await d.evaluate('[document.querySelector("#select-point-offset-category").value,document.querySelector("#select-point-offset-subcategory").value]'), [income, child], 'lock discards the unsaved old selection');
	await d.select('#select-point-offset-category', 'cat_income_main');
	await gateMethod(d, 'window.__yose_app.db', 'saveMasterConfig');
	await d.click('#btn-save-point-defaults'); await waitGate(d, 2);
	const count = await d.evaluate('({dialogs:window.__dialogs.length,toasts:window.__workflowNotices.length})');
	await releaseGate(d); await d.evaluate('window.__oldReload');
	assert.equal(await d.evaluate('document.querySelector("#select-point-offset-category").value'), 'cat_income_main');
	assert.equal(await d.evaluate('document.querySelector("#btn-save-point-defaults").disabled'), true);
	assert.equal(await d.evaluate('Boolean(document.querySelector("#btn-save-point-defaults .spinner")?.checkVisibility())'), true);
	assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count.dialogs})`), []);
	assert.deepEqual(await d.evaluate(`window.__workflowNotices.slice(${count.toasts})`), []);
	await releaseGate(d, 1); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).point_payment_defaults)()'), { category_id: 'cat_income_main', subcategory_id: null });
});

pointCase('keeps reloaded defaults and their new original when an earlier settings read finishes afterward', async d => {
	await configure(d); await openDefaults(d); await requireControl(d, '#btn-reload-point-defaults');
	await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig', { afterRead: true });
	await d.evaluate('void(window.__staleSettings=window.__yose_app.settingsController.renderSettings())'); await waitGate(d);
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.point_payment_defaults={category_id:"cat_income_main",subcategory_id:null};})');
	const before = await rawWorkflow(d);
	await d.evaluate('document.querySelector("#master-summary-info").textContent="WAITING_FOR_OTHER_SECTION"');
	const start = await d.evaluate('window.__workflowJobs.length');
	await d.click('#btn-reload-point-defaults');
	assert.ok(await d.evaluate(`window.__workflowJobs.length>${start}`));
	await d.evaluate(`void(window.__currentReload=Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise)))`);
	await d.evaluate('window.__currentReload');
	assert.deepEqual(await d.evaluate('[document.querySelector("#select-point-offset-category").value,document.querySelector("#select-point-offset-subcategory").value]'), ['cat_income_main', '']);
	await releaseGate(d); await d.evaluate('window.__staleSettings'); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate('[document.querySelector("#select-point-offset-category").value,document.querySelector("#select-point-offset-subcategory").value]'), ['cat_income_main', '']);
	assert.notEqual(await d.evaluate('document.querySelector("#master-summary-info").textContent'), 'WAITING_FOR_OTHER_SECTION', 'unrelated sections still render');
	assert.deepEqual(await rawWorkflow(d), before);
	await d.select('#select-point-offset-category', income); await d.select('#select-point-offset-subcategory', child);
	await saveDefaults(d, { category_id: income, subcategory_id: child });
});
