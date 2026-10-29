import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, cashflow, value } from '../helpers/ui_fixture.js';
import { flushWorkflow, rawWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67, observeExpectedDialog67, failNextWrite67, assertFailedWrite67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
async function openEdit67(d, id = 'target67') {
	await cashflow(d); await d.click(`#month-tx-list .tx-item[data-id="${id}"]`); await flushWorkflow(d);
	await d.waitFor(`document.querySelector('#modal-edit-tx').classList.contains('active')&&document.querySelector('#edit-tx-id').value===${JSON.stringify(id)}`);
}
async function failRefresh67(d) {
	await d.evaluate(`(()=>{const app=window.__yose_app,original=app.refreshAfterTransactionChange;app.refreshAfterTransactionChange=async()=>{throw new Error('VISIBLE_REFRESH_FAULT67')};window.__restores67.push(()=>app.refreshAfterTransactionChange=original);})()`);
}
for (const mode of ['advance', 'repay', 'prepaid', 'point']) uiCase67(fixture, `rejects an explicit zero ${mode} amount without treating it as an unknown planned amount`, async d => {
	await d.click(`.mode-tab-btn[data-mode="${mode}"]`); await flushWorkflow(d);
	const input = { advance: '#input-self-amount', repay: '#input-repay-amount', prepaid: '#input-prepaid-total', point: '#input-point-total' }[mode];
	await d.fill(input, '0'); await d.fill('#input-memo', 'KEEP_ZERO_DRAFT67'); const before = await rawWorkflow(d);
	if (mode === 'repay' || mode === 'prepaid') {
		const entered = await d.evaluate('window.__workflowJobs.filter(job=>job.name==="handleFormSubmit").length');
		assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(input)}).validity.rangeUnderflow`), true);
		await d.click('#btn-save-tx'); await flushWorkflow(d);
		assert.equal(await d.evaluate('window.__workflowJobs.filter(job=>job.name==="handleFormSubmit").length'), entered);
		assert.ok(await d.evaluate(`document.querySelector(${JSON.stringify(input)}).validationMessage.length>0`));
	} else await observeExpectedDialog67(d, () => d.click('#btn-save-tx'), /金額|総額|立替額|回収額/);
	assert.deepEqual(await rawWorkflow(d), before); assert.equal(await value(d, input), '0'); assert.equal(await value(d, '#input-memo'), 'KEEP_ZERO_DRAFT67');
});
for (const action of ['input', 'edit', 'delete', 'bulk-delete', 'confirm', 'point-defaults']) uiCase67(fixture, `reports a committed ${action} separately from its failed local view refresh and leaves other raw records unchanged`, async d => {
	await seed(d, [transaction('target67', { status: action === 'confirm' ? 'planned' : 'confirmed' }), transaction('other67', { sync_status: 'synced' })]);
	const other = await d.evaluate('window.__yose_app.db.getRaw("transactions","other67")');
	if (action === 'edit' || action === 'delete') await openEdit67(d);
	else if (action === 'bulk-delete' || action === 'confirm') await cashflow(d);
	else if (action === 'point-defaults') { await settings67(d); await d.select('#select-point-offset-category', 'cat_income_main'); }
	if (action === 'input') { await d.fill('#input-amount', '123'); await d.fill('#input-memo', 'COMMITTED_INPUT67'); }
	if (action === 'edit') await d.fill('#edit-tx-memo', 'COMMITTED_EDIT67');
	if (action === 'bulk-delete') await d.click('#month-tx-list [data-bulk-id="target67"]');
	await failRefresh67(d); const dialogs = await d.evaluate('window.__dialogs.length');
	const selectors = { input: '#btn-save-tx', edit: '#edit-tx-form button[type="submit"]', delete: '#btn-edit-delete-tx', 'bulk-delete': '#btn-bulk-delete', confirm: '.btn-confirm-tx[data-id="target67"]', 'point-defaults': '#btn-save-point-defaults' };
	await d.click(selectors[action]); await flushWorkflow(d);
	const all = await records(d), target = all.find(tx => tx.id === 'target67');
	if (action === 'input') assert.ok(all.some(tx => tx.memo === 'COMMITTED_INPUT67' && tx.amount === 123));
	if (action === 'edit') { assert.equal(target.memo, 'COMMITTED_EDIT67'); assert.equal(await d.isVisible('#modal-edit-tx'), false); }
	if (action === 'delete' || action === 'bulk-delete') assert.equal(target.is_deleted, true);
	if (action === 'confirm') assert.equal(target.status, 'confirmed');
	if (action === 'bulk-delete') assert.equal(await d.evaluate('window.__yose_app.bulkEditController.selectedIds.size'), 0);
	if (action === 'point-defaults') {
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).point_payment_defaults.category_id)()'), 'cat_income_main');
		assert.match(await d.textContent('#point-defaults-error'), /設定は保存済み.*表示/);
	} else {
		const messages = (await d.evaluate(`window.__dialogs.slice(${dialogs})`)).filter(item => item.type === 'alert');
		assert.equal(messages.length, 1); assert.match(messages[0].message, /保存済み.*表示/); assert.match(messages[0].message, /VISIBLE_REFRESH_FAULT67/);
	}
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","other67")'), other);
});
uiCase67(fixture, 'retains the batch selection and every remaining original when a selected record disappears before deletion starts', async d => {
	await seed(d, [transaction('target67'), transaction('other67')]); await cashflow(d); await d.click('#month-tx-list [data-bulk-id="target67"]');
	await d.evaluate('window.__yose_app.db.deleteTransaction("target67")'); const before = await rawWorkflow(d);
	await observeExpectedDialog67(d, () => d.click('#btn-bulk-delete'), /選択した明細が変更/);
	assert.deepEqual(await rawWorkflow(d), before); assert.equal(await d.evaluate('window.__yose_app.bulkEditController.selectedIds.has("target67")'), true);
});
uiCase67(fixture, 'retains an unsaved single edit when its real database write aborts before local commit', async d => {
	await seed(d, [transaction('target67')]); await openEdit67(d); await d.fill('#edit-tx-memo', 'UNCOMMITTED67'); const before = await rawWorkflow(d);
	await failNextWrite67(d, 'transactions'); await observeExpectedDialog67(d, () => d.click('#edit-tx-form button[type="submit"]'), /保存に失敗/);
	await assertFailedWrite67(d, before); assert.equal(await value(d, '#edit-tx-memo'), 'UNCOMMITTED67'); assert.equal(await d.isVisible('#modal-edit-tx'), true);
});
uiCase67(fixture, 'rejects row confirmation on a real write abort, leaves its editor closed and restores its action', async d => {
	await seed(d, [transaction('target67', { status: 'planned' })]); await cashflow(d); const before = await rawWorkflow(d);
	await failNextWrite67(d, 'transactions'); await observeExpectedDialog67(d, () => d.click('.btn-confirm-tx[data-id="target67"]'), /予定を確定できませんでした/);
	await assertFailedWrite67(d, before); assert.equal(await d.isVisible('#modal-edit-tx'), false);
	assert.equal(await d.evaluate('document.querySelector(".btn-confirm-tx[data-id=target67]").disabled'), false);
});
uiCase67(fixture, 'preserves a known planned record when the user cancels its closed-month row confirmation approval', async d => {
	await seed(d, [transaction('target67', { status: 'planned' })]); await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({...await db.getSnapshot(),last_closed_month:"2026-10"});})()');
	await cashflow(d); const before = await rawWorkflow(d); await d.setConfirm(false); await d.click('.btn-confirm-tx[data-id="target67"]'); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before); assert.equal((await records(d))[0].status, 'planned');
});
uiCase67(fixture, 'uses the selected transaction-date month for the native daily income drilldown, even when target months differ', async d => {
	await seed(d, [transaction('date-in67', { type: 'income', date: '2026-10-12', target_month: '2026-11', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', amount: 123 }), transaction('date-out67', { type: 'income', date: '2026-09-30', target_month: '2026-10', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', amount: 456 })]);
	await cashflow(d); await d.click('#control-granularity [data-granularity="daily"]'); await d.select('#category-trend-type', 'income'); await flushWorkflow(d);
	await d.click('#category-breakdown-list [data-filter-category="cat_income_main"]'); await flushWorkflow(d);
	assert.equal(await d.evaluate('window.__yose_app.txListController.calendarMonthFilter'), '2026-10');
	assert.deepEqual(await d.evaluate('[...document.querySelectorAll("#month-tx-list .tx-item")].map(row=>row.dataset.id)'), ['date-in67']);
	assert.match(await d.textContent('#month-tx-list-title'), /2026-10.*取引日別/);
});
uiCase67(fixture, 'resets a now absent tag filter to all after a genuine record change and native search refresh', async d => {
	await seed(d, [transaction('target67', { tags: ['obsolete67'] }), transaction('other67')]); await cashflow(d); await d.select('#select-tag-filter', 'obsolete67'); await flushWorkflow(d);
	await d.evaluate('(async()=>{const db=window.__yose_app.db,tx=await db.getTransaction("target67");await db.putTransaction({...tx,tags:[]},{expectedTransactions:[tx]});})()');
	await d.fill('#input-tx-search', ''); await flushWorkflow(d);
	assert.equal(await value(d, '#select-tag-filter'), 'all'); assert.equal(await d.evaluate('document.querySelectorAll("#month-tx-list .tx-item").length'), 2);
});
