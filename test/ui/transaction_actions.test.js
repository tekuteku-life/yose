import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, cashflow } from '../helpers/ui_fixture.js';
import { observeWorkflow, flushWorkflow, cleanupWorkflow, requireControl, gateMethod, waitGate, releaseGate, rawWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser();
const selected = d => d.evaluate('[...window.__yose_app.bulkEditController.selectedIds].sort()');
async function select(d, ids) {
	for (const id of ids) await d.click(`#month-tx-list [data-bulk-id="${id}"]`);
}
function actionCase(name, run) {
	it(name, async () => {
		const d = fixture.driver; await observeWorkflow(d);
		try { await run(d); }
		finally { await cleanupWorkflow(d); }
	});
}
async function bulkControl(d) { await requireControl(d, '#btn-bulk-delete'); }
async function confirmControl(d, id) { await requireControl(d, `.btn-confirm-tx[data-id="${id}"]`); }
async function capturePendingAction(d, start) {
	assert.ok(await d.evaluate(`window.__workflowJobs.length>${start}`), 'the real asynchronous action must be observed');
	await d.evaluate(`void(window.__oldAction=Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise)))`);
}

actionCase('bulk-deletes only the selected records across real list pages and keeps other encrypted rows unchanged', async d => {
	const originals = Array.from({ length: 32 }, (_, index) => transaction(`page-${index}`, { amount: index + 1, created_at: new Date(Date.UTC(2026, 9, 20, 3) - index).toISOString() }));
	await seed(d, originals); await cashflow(d); await bulkControl(d);
	await select(d, ['page-0']); await d.click('#btn-tx-next-page');
	await d.waitFor('window.__yose_app.txListController.currentPage===2&&Boolean(document.querySelector("[data-bulk-id=page-31]"))');
	await select(d, ['page-31']);
	const before = await d.evaluate('window.__yose_app.db.getAllRaw("transactions")');
	await d.click('#btn-bulk-delete'); await flushWorkflow(d);
	const after = await records(d);
	assert.deepEqual(after.filter(tx => tx.is_deleted).map(tx => tx.id).sort(), ['page-0', 'page-31']);
	for (const original of originals) {
		const current = after.find(tx => tx.id === original.id);
		if (['page-0', 'page-31'].includes(original.id)) {
			for (const key of Object.keys(original).filter(key => !['is_deleted', 'updated_at', 'sync_status'].includes(key))) assert.deepEqual(current[key], original[key], `${original.id}.${key}`);
		} else assert.deepEqual(await d.evaluate(`window.__yose_app.db.getRaw('transactions',${JSON.stringify(original.id)})`), before.find(row => row.id === original.id));
	}
	assert.deepEqual(await selected(d), []);
	assert.ok(await d.evaluate('window.__dialogs.some(dialog=>dialog.type==="confirm"&&dialog.message.includes("2"))'));
	assert.equal(await d.isVisible('#modal-edit-tx'), false);
});

for (const cancellation of ['delete', 'reclose']) actionCase(`retains selection and all raw originals when ${cancellation} approval is cancelled`, async d => {
	const overrides = cancellation === 'reclose' ? { date: '2022-10-20', target_month: '2022-10' } : {};
	await seed(d, ['cancel-a', 'cancel-b'].map(id => transaction(id, overrides)));
	if (cancellation === 'reclose') await d.evaluate('window.__yose_app.summaryController.setSelectedMonth("2022-10")');
	await cashflow(d); await bulkControl(d); await select(d, ['cancel-a', 'cancel-b']);
	const before = await rawWorkflow(d);
	await d.evaluate(`window.confirm=message=>{window.__dialogs.push({type:'confirm',message:String(message)});return ${cancellation === 'delete' ? 'false' : '!String(message).includes("再月締め")'};}`);
	await d.click('#btn-bulk-delete'); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before); assert.deepEqual(await selected(d), ['cancel-a', 'cancel-b']);
	if (cancellation === 'reclose') assert.ok(await d.evaluate('window.__dialogs.some(dialog=>dialog.message.includes("再月締め"))'));
});

actionCase('shows a failed bulk delete without clearing selection or partially saving and allows retry', async d => {
	await seed(d, ['failure-a', 'failure-b'].map(id => transaction(id))); await cashflow(d); await bulkControl(d); await select(d, ['failure-a', 'failure-b']);
	const before = await rawWorkflow(d);
	await gateMethod(d, 'window.__yose_app.db', 'bulkDeleteTransactions', { reject: true });
	await d.click('#btn-bulk-delete'); await waitGate(d); await releaseGate(d); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before); assert.deepEqual(await selected(d), ['failure-a', 'failure-b']);
	assert.equal(await d.evaluate('document.querySelector("#btn-bulk-delete").disabled'), false);
	assert.ok(await d.evaluate('document.body.textContent.includes("WORKFLOW_WRITE_FAILURE")||window.__dialogs.some(d=>d.message.includes("WORKFLOW_WRITE_FAILURE"))'));
	await d.evaluate('window.__restoreGate()'); await d.click('#btn-bulk-delete'); await flushWorkflow(d);
	assert.equal((await records(d)).filter(tx => tx.is_deleted).length, 2);
});

actionCase('rejects deletion of a referenced advance source alone while preserving selected originals', async d => {
	await seed(d, [transaction('source', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null }), transaction('repayment', { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null, advance_source_id: 'source' })]);
	await cashflow(d); await bulkControl(d); await select(d, ['source']); const before = await rawWorkflow(d);
	await d.click('#btn-bulk-delete'); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before); assert.deepEqual(await selected(d), ['source']);
	assert.ok(await d.evaluate('document.body.textContent.includes("ひも付け")||window.__dialogs.some(d=>/ひも付け|関連/.test(d.message))'));
});

actionCase('blocks repeated bulk deletion and selection changes while its real database operation is pending', async d => {
	await seed(d, [transaction('busy-delete-a'), transaction('busy-delete-b')]); await cashflow(d); await bulkControl(d); await select(d, ['busy-delete-a']);
	await gateMethod(d, 'window.__yose_app.db', 'bulkDeleteTransactions');
	await d.click('#btn-bulk-delete'); await waitGate(d);
	for (const id of ['btn-bulk-delete', 'btn-bulk-edit', 'btn-bulk-select-page', 'btn-bulk-clear']) assert.equal(await d.evaluate(`document.getElementById('${id}').matches(':disabled')`), true, id);
	assert.equal(await d.evaluate('[...document.querySelectorAll("#month-tx-list [data-bulk-id]")].every(input=>input.matches(":disabled"))'), true);
	assert.equal(await d.evaluate('Boolean(document.querySelector("#btn-bulk-delete .spinner")?.checkVisibility())'), true);
	await d.evaluate('document.querySelector("#btn-bulk-delete").click();document.querySelector("#btn-bulk-clear").click();document.querySelector("[data-bulk-id=busy-delete-b]").click()');
	assert.deepEqual(await selected(d), ['busy-delete-a']); assert.equal(await d.evaluate('window.__workflowGates.length'), 1);
	await releaseGate(d); await flushWorkflow(d);
	assert.deepEqual((await records(d)).filter(tx => tx.is_deleted).map(tx => tx.id), ['busy-delete-a']);
});

actionCase('invalidates an old bulk deletion on real lock/unlock and preserves the new session selection, busy owner and notifications', async d => {
	await seed(d, [transaction('old-delete'), transaction('new-delete')]); await cashflow(d); await bulkControl(d); await select(d, ['old-delete']);
	const before = await rawWorkflow(d);
	await gateMethod(d, 'window.__yose_app.db', 'bulkDeleteTransactions', { repeat: true });
	const start = await d.evaluate('window.__workflowJobs.length');
	await d.click('#btn-bulk-delete'); await waitGate(d); await capturePendingAction(d, start);
	await unlockWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before); assert.deepEqual(await selected(d), []);
	await cashflow(d); await select(d, ['new-delete']); await d.click('#btn-bulk-delete'); await waitGate(d, 2);
	assert.equal(await d.evaluate('document.querySelector("#btn-bulk-delete").disabled'), true);
	const notices = await d.evaluate('({dialogs:window.__dialogs.length,toasts:window.__workflowNotices.length})');
	await releaseGate(d); await d.evaluate('window.__oldAction');
	assert.deepEqual(await rawWorkflow(d), before); assert.deepEqual(await selected(d), ['new-delete']);
	assert.equal(await d.evaluate('document.querySelector("#btn-bulk-delete").disabled'), true);
	assert.equal(await d.evaluate('Boolean(document.querySelector("#btn-bulk-delete .spinner")?.checkVisibility())'), true);
	assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${notices.dialogs})`), []);
	assert.deepEqual(await d.evaluate(`window.__workflowNotices.slice(${notices.toasts})`), []);
	await releaseGate(d, 1); await flushWorkflow(d);
	assert.deepEqual((await records(d)).filter(tx => tx.is_deleted).map(tx => tx.id), ['new-delete']);
});

for (const amount of [0, 125]) actionCase(`confirms a known planned amount ${amount} without opening the editor or changing business fields`, async d => {
	const original = transaction('planned', { status: 'planned', amount, subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries', memo: '入力済み予定', tags: ['保持'] });
	await seed(d, [original, transaction('unknown', { status: 'planned', amount: 0, amount_pending: true }), transaction('already')]);
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.categories.find(cat=>cat.id==="cat_food").subcategories.find(sub=>sub.id==="sub_groceries").is_archived=true;})');
	await cashflow(d); await confirmControl(d, 'planned');
	assert.equal(await d.evaluate('Boolean(document.querySelector(".btn-confirm-tx[data-id=unknown],.btn-confirm-tx[data-id=already]"))'), false);
	const outside = await d.evaluate('window.__yose_app.db.getRaw("transactions","unknown")');
	await d.click('.btn-confirm-tx[data-id="planned"]'); await flushWorkflow(d);
	const updated = (await records(d)).find(tx => tx.id === original.id);
	assert.equal(updated.status, 'confirmed');
	for (const key of Object.keys(original).filter(key => !['status', 'updated_at', 'sync_status'].includes(key))) assert.deepEqual(updated[key], original[key], key);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","unknown")'), outside);
	assert.equal(await d.isVisible('#modal-edit-tx'), false);
});

actionCase('blocks a second row confirmation while saving and leaves a later unrelated editor open', async d => {
	await seed(d, [transaction('confirm-busy', { status: 'planned' }), transaction('other-editor')]); await cashflow(d); await confirmControl(d, 'confirm-busy');
	await gateMethod(d, 'window.__yose_app.db', 'confirmPlannedTransaction');
	await d.click('.btn-confirm-tx[data-id="confirm-busy"]'); await waitGate(d);
	assert.equal(await d.evaluate('document.querySelector(".btn-confirm-tx[data-id=confirm-busy]").disabled'), true);
	assert.equal(await d.evaluate('Boolean(document.querySelector(".btn-confirm-tx[data-id=confirm-busy] .spinner"))'), true);
	await d.evaluate('document.querySelector(".btn-confirm-tx[data-id=confirm-busy]").click()');
	assert.equal(await d.evaluate('window.__workflowGates.length'), 1);
	await d.click('#month-tx-list .tx-item[data-id="other-editor"]');
	await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-id").value==="other-editor"');
	await d.fill('#edit-tx-memo', '別編集を保持'); await releaseGate(d); await flushWorkflow(d);
	assert.equal(await d.isVisible('#modal-edit-tx'), true); assert.equal(await d.evaluate('document.querySelector("#edit-tx-memo").value'), '別編集を保持');
	assert.equal((await records(d)).find(tx => tx.id === 'confirm-busy').status, 'confirmed');
});

actionCase('invalidates an old row confirmation on lock/unlock without committing or disturbing a new session editor', async d => {
	await seed(d, [transaction('old-confirm', { status: 'planned' }), transaction('new-editor')]); await cashflow(d); await confirmControl(d, 'old-confirm');
	const before = await rawWorkflow(d);
	await gateMethod(d, 'window.__yose_app.db', 'confirmPlannedTransaction');
	const start = await d.evaluate('window.__workflowJobs.length');
	await d.click('.btn-confirm-tx[data-id="old-confirm"]'); await waitGate(d); await capturePendingAction(d, start);
	await unlockWorkflow(d); assert.deepEqual(await rawWorkflow(d), before);
	await cashflow(d); await d.click('#month-tx-list .tx-item[data-id="new-editor"]');
	await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-id").value==="new-editor"');
	await d.fill('#edit-tx-memo', 'NEW_SESSION_EDIT');
	await gateMethod(d, 'window.__yose_app.db', 'putTransaction');
	await d.click('#edit-tx-form button[type=submit]'); await waitGate(d, 2);
	const notices = await d.evaluate('({dialogs:window.__dialogs.length,toasts:window.__workflowNotices.length})');
	await releaseGate(d); await d.evaluate('window.__oldAction');
	assert.deepEqual(await rawWorkflow(d), before);
	assert.equal(await d.isVisible('#modal-edit-tx'), true);
	assert.equal(await d.evaluate('document.querySelector("#edit-tx-id").value'), 'new-editor');
	assert.equal(await d.evaluate('document.querySelector("#edit-tx-memo").value'), 'NEW_SESSION_EDIT');
	assert.equal(await d.evaluate('document.querySelector("#edit-tx-form button[type=submit]").disabled'), true);
	assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${notices.dialogs})`), []);
	assert.deepEqual(await d.evaluate(`window.__workflowNotices.slice(${notices.toasts})`), []);
	await releaseGate(d, 1); await flushWorkflow(d);
	const saved = await records(d);
	assert.equal(saved.find(tx => tx.id === 'old-confirm').status, 'planned');
	assert.equal(saved.find(tx => tx.id === 'new-editor').memo, 'NEW_SESSION_EDIT');
});
