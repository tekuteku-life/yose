import assert from 'node:assert/strict';
import { useBrowser, value } from '../helpers/ui_fixture.js';
import { flushWorkflow, rawWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67, failNextWrite67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
const forms = {
	account: { tab: 'accounts', add: '#btn-add-account', id: '#m-acc-id', name: '#m-acc-name', save: '#form-master-account button[type=submit]', prefix: 'acc_', row: '.btn-edit-account' },
	category: { tab: 'categories', add: '#btn-add-category', id: '#m-cat-id', name: '#m-cat-name', save: '#form-master-category button[type=submit]', prefix: 'cat_', row: '.btn-edit-cat' },
	subcategory: { tab: 'categories', add: '.btn-add-subcat[data-id="cat_food"]', id: '#m-sub-id', name: '#m-sub-name', save: '#form-master-subcategory button[type=submit]', prefix: 'sub_', row: '.btn-edit-subcat' }
};
for (const kind of Object.keys(forms)) uiCase67(fixture, `assigns an automatic ID for an empty new ${kind} ID after a genuine write failure and retries without duplicating the item`, async d => {
	const form = forms[kind]; await settings67(d, form.tab); await d.click(form.add); await flushWorkflow(d);
	await d.waitFor('document.querySelector("#modal-master-item").classList.contains("active")');
	await d.fill(form.id, ''); await d.fill(form.name, `AUTOMATIC_${kind}67`);
	const before = await rawWorkflow(d); await failNextWrite67(d, 'master_config');
	await d.click(form.save); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate(`({attemptedWrite:window.__failedWrite67,valueMissing:document.querySelector(${JSON.stringify(form.id)}).validity.valueMissing})`), { attemptedWrite: true, valueMissing: false }, 'blank new IDs must reach the actual auto-ID save rather than native required validation');
	assert.deepEqual(await rawWorkflow(d), before); assert.equal(await d.isVisible('#modal-master-item'), true); assert.equal(await value(d, form.id), '');
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(form.save)}).disabled`), false);
	assert.ok((await d.evaluate('window.__dialogs')).some(item=>/設定の保存に失敗/.test(item.message)));
	await d.click(form.save); await flushWorkflow(d); await d.waitFor('!document.querySelector("#modal-master-item").classList.contains("active")');
	const saved = await d.evaluate(`(async()=>{const config=await window.__yose_app.db.getMasterConfig(),rows=${kind === 'account' ? 'config.accounts' : kind === 'category' ? 'config.categories' : 'config.categories.find(item=>item.id==="cat_food").subcategories'};return rows.filter(item=>item.name===${JSON.stringify(`AUTOMATIC_${kind}67`)});})()`);
	assert.equal(saved.length, 1); assert.match(saved[0].id, new RegExp(`^${form.prefix}[a-z0-9]+$`));
	const visible = await d.evaluate(`[...document.querySelectorAll(${JSON.stringify(form.row)})].map(button=>button.dataset.${kind === 'subcategory' ? 'subId' : 'id'})`);
	assert.ok(visible.includes(saved[0].id), 'the saved generated identity must be referenced by the visible edit action');
	if (kind === 'subcategory') assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(`.btn-edit-subcat[data-sub-id="${saved[0].id}"]`)}).dataset.catId`), 'cat_food');
});
