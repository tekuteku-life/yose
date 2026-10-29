import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, cashflow } from '../helpers/ui_fixture.js';
import { observeWorkflow, flushWorkflow, cleanupWorkflow, gateMethod, waitGate, releaseGate, rawWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser();
const cases = {
	input: { root: '#tx-form', save: '#btn-save-tx', memo: '#input-memo', disabled: '#select-to-account', gate: 'putTransactions', entry: 'handleFormSubmit' },
	edit: { root: '#modal-edit-tx', save: '#edit-tx-form button[type=submit]', memo: '#edit-tx-memo', disabled: '#edit-tx-to-account', gate: 'getTransaction', entry: 'handleEditFormSubmit' },
	bulk: { root: '#modal-bulk-edit', save: '#btn-save-bulk', memo: '#bulk-value-memo', disabled: '#bulk-value-date', gate: 'bulkEditTransactions', entry: 'save' }
};
async function prepare(d, kind, { fresh = true, second = false } = {}) {
	const config = cases[kind];
	if (kind === 'input') {
		await d.click('.tab-btn[data-tab="tab-input"]'); await d.fill('#input-amount', '123');
	} else {
		if (fresh) await seed(d, [transaction('form-a'), transaction('form-b')]);
		await cashflow(d);
		if (kind === 'edit') {
			const id = second ? 'form-b' : 'form-a';
			await d.click(`#month-tx-list .tx-item[data-id="${id}"]`);
			await d.waitFor(`document.querySelector('#modal-edit-tx').classList.contains('active')&&document.querySelector('#edit-tx-id').value===${JSON.stringify(id)}`);
		} else {
			await d.click(`#month-tx-list [data-bulk-id="${second ? 'form-b' : 'form-a'}"]`); await d.click('#btn-bulk-edit');
			await d.waitFor('document.querySelector("#modal-bulk-edit").classList.contains("active")&&Boolean(document.querySelector("#bulk-apply-memo"))');
			await d.click('#bulk-apply-memo');
		}
	}
	await d.fill(config.memo, second ? 'NEW_SESSION_DRAFT' : 'STARTING_DRAFT');
	await d.evaluate(`document.querySelector(${JSON.stringify(config.disabled)}).disabled=true`);
}
async function busySurface(d, kind) {
	const config = cases[kind];
	return d.evaluate(`(()=>{const root=document.querySelector(${JSON.stringify(config.root)}),button=document.querySelector(${JSON.stringify(config.save)});const controls=[...root.querySelectorAll('input,select,textarea,button')${kind === 'input' ? ",...document.querySelectorAll('#tab-input .mode-tab-btn')" : ''}];return {enabled:controls.filter(el=>!el.matches(':disabled')).map(el=>el.id||el.type),ariaBusy:root.getAttribute('aria-busy')==='true'||Boolean(root.querySelector('[aria-busy="true"]')),spinner:Boolean(button.querySelector('.spinner')?.checkVisibility()),text:button.textContent,live:Boolean(root.matches('[aria-live],[role=status]')||root.querySelector('[aria-live],[role=status]'))};})()`);
}
async function assertBusy(d, kind) {
	const surface = await busySurface(d, kind);
	assert.deepEqual(surface.enabled, [], `${kind}: every form control and related button must be disabled`);
	assert.equal(surface.ariaBusy, true); assert.equal(surface.spinner, true); assert.equal(surface.live, true);
	assert.match(surface.text, /登録中|保存中|処理中/);
}
function formCase(name, run) {
	it(name, async () => {
		const d = fixture.driver; await observeWorkflow(d);
		try { await run(d); }
		finally { await cleanupWorkflow(d); }
	});
}

for (const kind of ['input', 'bulk']) formCase(`${kind}: owns the frozen draft and accessible busy state at the first approval await`, async d => {
	const config = cases[kind]; await prepare(d, kind);
	await gateMethod(d, 'window.__yose_app', 'approveClosedChanges');
	await d.click(config.save); await waitGate(d);
	await assertBusy(d, kind);
	await d.evaluate(`document.querySelector(${JSON.stringify(config.memo)}).value='CHANGED_DURING_FIRST_AWAIT';${kind === 'input' ? "document.querySelector('#input-amount').value='999';" : ''}`);
	await releaseGate(d); await flushWorkflow(d);
	const saved = await records(d);
	if (kind === 'input') assert.deepEqual(saved.map(tx => [tx.amount, tx.memo]), [[123, 'STARTING_DRAFT']]);
	else {
		assert.equal(saved.find(tx => tx.id === 'form-a').memo, 'STARTING_DRAFT');
		assert.equal(saved.find(tx => tx.id === 'form-b').memo, 'form-b');
	}
});

for (const kind of Object.keys(cases)) formCase(`${kind}: freezes the starting draft, disables the whole form, and shows accessible progress before async work settles`, async d => {
	const config = cases[kind]; await prepare(d, kind);
	await gateMethod(d, 'window.__yose_app.db', config.gate);
	await d.click(config.save); await waitGate(d); await assertBusy(d, kind);
	// Even an already queued callback or a programmatic DOM write cannot change the captured submission.
	await d.evaluate(`document.querySelector(${JSON.stringify(config.memo)}).value='LATE_DOM_VALUE';document.querySelector(${JSON.stringify(config.save)}).click()`);
	assert.equal(await d.evaluate('window.__workflowGates.length'), 1);
	await releaseGate(d); await flushWorkflow(d);
	const saved = await records(d);
	if (kind === 'input') assert.deepEqual(saved.map(tx => [tx.amount, tx.memo]), [[123, 'STARTING_DRAFT']]);
	else {
		assert.equal(saved.find(tx => tx.id === 'form-a').memo, 'STARTING_DRAFT');
		assert.equal(saved.find(tx => tx.id === 'form-b').memo, 'form-b');
	}
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(config.disabled)}).disabled`), true, 'pre-existing disabled state must survive cleanup');
});

for (const kind of Object.keys(cases)) formCase(`${kind}: keeps input and encrypted originals on failure and restores the original disabled states`, async d => {
	const config = cases[kind]; await prepare(d, kind); const before = await rawWorkflow(d);
	await gateMethod(d, 'window.__yose_app.db', config.gate, { reject: true });
	await d.click(config.save); await waitGate(d); await assertBusy(d, kind);
	await releaseGate(d); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before);
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(config.memo)}).value`), 'STARTING_DRAFT');
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(config.memo)}).matches(':disabled')`), false);
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(config.disabled)}).disabled`), true);
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(config.save)}).disabled`), false);
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(config.root)}).getAttribute('aria-busy')==='true'||Boolean(document.querySelector(${JSON.stringify(config.root)}).querySelector('[aria-busy="true"]'))`), false);
	assert.ok(await d.evaluate('document.body.textContent.includes("WORKFLOW_WRITE_FAILURE")||window.__dialogs.some(dialog=>dialog.message.includes("WORKFLOW_WRITE_FAILURE"))'));
});

for (const kind of Object.keys(cases)) formCase(`${kind}: an expired save cannot release, notify, or replace a new session's busy form`, async d => {
	const config = cases[kind]; await prepare(d, kind);
	const method = kind === 'edit' ? 'putTransaction' : config.gate;
	await gateMethod(d, 'window.__yose_app.db', method, { repeat: true });
	await d.click(config.save); await waitGate(d);
	await d.evaluate(`void(window.__firstSubmission=window.__workflowJobs.find(job=>job.name===${JSON.stringify(config.entry)}).promise)`);
	await unlockWorkflow(d);
	assert.equal(await d.evaluate(`window.__yose_app.${kind === 'input' ? 'txInputController.submitBusy' : kind === 'edit' ? 'txEditController.busy' : 'bulkEditController.busy'}`), false, 'authentication invalidation must release the old owner');
	await prepare(d, kind, { fresh: false, second: true });
	await d.click(config.save); await waitGate(d, 2); await assertBusy(d, kind);
	const dialogs = await d.evaluate('window.__dialogs.length');
	await releaseGate(d); await d.evaluate('window.__firstSubmission');
	await assertBusy(d, kind);
	assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(config.memo)}).value`), 'NEW_SESSION_DRAFT');
	assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	await releaseGate(d, 1); await flushWorkflow(d);
	const saved = await records(d);
	assert.equal(saved.filter(tx => tx.memo === 'STARTING_DRAFT').length, 0);
	assert.equal(saved.filter(tx => tx.memo === 'NEW_SESSION_DRAFT').length, 1);
});

formCase('a queued same-memo classification response cannot mutate a busy registration or its captured draft', async d => {
	await prepare(d, 'input');
	await d.evaluate(`{const c=window.__yose_app.txInputController;c.memoHistoryMap.OLD_MEMO={category_id:'cat_food',subcategory_id:'sub_groceries'};document.querySelector('#input-memo').value='OLD_MEMO';}`);
	await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig');
	await d.evaluate('void(window.__oldMemo=window.__yose_app.txInputController.handleMemoChange("OLD_MEMO"))'); await waitGate(d);
	await d.select('#select-category', 'cat_housing');
	await d.waitFor('[...document.querySelector("#select-subcategory").options].some(o=>o.value==="sub_rent")'); await d.select('#select-subcategory', 'sub_rent');
	await gateMethod(d, 'window.__yose_app.db', 'putTransactions');
	await d.click('#btn-save-tx'); await waitGate(d, 2); await assertBusy(d, 'input');
	await releaseGate(d); await d.evaluate('window.__oldMemo');
	assert.equal(await d.evaluate('document.querySelector("#select-category").value'), 'cat_housing');
	assert.equal(await d.evaluate('document.querySelector("#select-subcategory").value'), 'sub_rent');
	await releaseGate(d, 1); await flushWorkflow(d);
	const [saved] = await records(d);
	assert.deepEqual([saved.memo, saved.category_id, saved.subcategory_id], ['OLD_MEMO', 'cat_housing', 'sub_rent']);
});
