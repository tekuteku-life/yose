import assert from 'node:assert/strict';
import { useBrowser, value } from '../helpers/ui_fixture.js';
import { rawWorkflow, flushWorkflow, gateMethod, waitGate, releaseGate, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 as observeNative67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();

async function settleNative67(d) {
	assert.equal(await d.evaluate('window.__masterNativeJobs67.length'), 1);
	assert.equal(await d.evaluate('typeof window.__masterNativeJobs67[0]?.then'), 'function');
	await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await flushWorkflow(d);
}
async function newInput67(d, requireClosedMaster = false) {
	await unlockWorkflow(d);
	if (requireClosedMaster) assert.equal(await d.isVisible('#modal-master-item'), false, 'authentication cancellation must close the old saving master modal');
	if (await d.isVisible('#modal-holiday-import')) await d.click('#btn-close-holiday-modal');
	const start = await d.evaluate('window.__workflowJobs.length');
	await d.click('.tab-btn[data-tab="tab-input"]');
	await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`);
	await d.waitFor('document.querySelector("#tab-input").classList.contains("active")&&!document.querySelector("#input-amount").disabled');
	await d.fill('#input-amount', '321'); await d.fill('#input-memo', 'NEW_MASTER_SESSION67');
}
for (const action of ['add', 'preset', 'text']) uiCase67(fixture, `does not save an old-session holiday ${action} after its actual master read and a real PIN unlock`, async d => {
	await settings67(d, 'holidays');
	const selector = action === 'add' ? '#btn-add-holiday' : action === 'preset' ? '#btn-import-holidays-preset' : '#btn-confirm-import-holidays';
	if (action === 'add') await d.fill('#input-new-holiday', '2031-01-02');
	if (action === 'preset') await d.evaluate('window.__yose_app.db.mutateMasterConfig(config=>{config.holidays=[]})');
	if (action === 'text') { await d.click('#btn-open-holiday-modal'); await d.fill('#txt-holiday-import-input', '2031-01-02'); }
	await observeNative67(d, selector);
	await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig', { afterRead: true });
	try {
		await d.click(selector); await waitGate(d);
		await newInput67(d);
		const before = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await settleNative67(d);
		assert.deepEqual(await rawWorkflow(d), before, 'old-session holiday input must not commit using the newly unlocked session');
		assert.equal(await value(d, '#input-amount'), '321'); assert.equal(await value(d, '#input-memo'), 'NEW_MASTER_SESSION67');
		assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

const rows = {
	account: ['accounts', '.btn-archive-account[data-id="acc_wallet"]'],
	category: ['categories', '.btn-archive-cat[data-id="cat_food"]'],
	subcategory: ['categories', '.btn-archive-subcat[data-cat-id="cat_food"][data-sub-id="sub_groceries"]'],
	'toggle recurring': ['recurring', '.btn-toggle-recurring[data-id="rec_rent"]'],
	'delete recurring': ['recurring', '.btn-delete-recurring[data-id="rec_rent"]']
};
for (const [kind, [tab, selector]] of Object.entries(rows)) uiCase67(fixture, `suppresses an old-session ${kind} action failure after actual storage preparation and PIN unlock`, async d => {
	await settings67(d, tab); await observeNative67(d, selector);
	await gateMethod(d, 'window.__yose_app.db', 'captureImportState', { afterRead: true });
	try {
		await d.click(selector); await waitGate(d); await newInput67(d);
		const before = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await settleNative67(d);
		assert.deepEqual(await rawWorkflow(d), before);
		assert.equal(await value(d, '#input-memo'), 'NEW_MASTER_SESSION67'); assert.equal(await value(d, '#input-amount'), '321');
		assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), [], 'an obsolete master failure must not notify the new authentication session');
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

const forms = {
	account: ['accounts', '.btn-edit-account[data-id="acc_wallet"]', '#m-acc-name', '#form-master-account'],
	category: ['categories', '.btn-edit-cat[data-id="cat_food"]', '#m-cat-name', '#form-master-category'],
	subcategory: ['categories', '.btn-edit-subcat[data-cat-id="cat_food"][data-sub-id="sub_groceries"]', '#m-sub-name', '#form-master-subcategory'],
	recurring: ['recurring', '.btn-edit-recurring[data-id="rec_rent"]', '#m-rec-name', '#form-master-recurring']
};
for (const [kind, [tab, open, name, form]] of Object.entries(forms)) uiCase67(fixture, `cancels the saving ${kind} modal on authentication change without applying or announcing its obsolete save`, async d => {
	await settings67(d, tab); await d.click(open); await flushWorkflow(d); await d.fill(name, `OLD_${kind.toUpperCase()}67`);
	await observeNative67(d, form, 'submit'); await gateMethod(d, 'window.__yose_app.db', 'captureImportState', { afterRead: true });
	try {
		await d.click(`${form} button[type=submit]`); await waitGate(d); await newInput67(d, true);
		const before = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await settleNative67(d);
		assert.deepEqual(await rawWorkflow(d), before); assert.equal(await value(d, '#input-memo'), 'NEW_MASTER_SESSION67');
		assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []); assert.equal(await d.isVisible('#modal-master-item'), false);
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

uiCase67(fixture, 'keeps an old committed holiday while its expired refresh cannot clear or release a newer holiday operation', async d => {
	await settings67(d, 'holidays'); await d.fill('#input-new-holiday', '2031-01-02'); await observeNative67(d, '#btn-add-holiday');
	await gateMethod(d, 'window.__yose_app', 'refreshAllViews');
	try {
		await d.click('#btn-add-holiday'); await waitGate(d);
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).holidays.includes("2031-01-02"))()'), true);
		await newInput67(d);
		const start = await d.evaluate('window.__workflowJobs.length'); await d.click('.tab-btn[data-tab="tab-settings"]');
		await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`); await d.click('.master-tab-btn[data-master="holidays"]');
		assert.equal(await d.evaluate('document.querySelector("#btn-add-holiday").disabled'), false, 'authentication cancellation must release the old static button owner');
		await d.fill('#input-new-holiday', '2032-01-03'); await gateMethod(d, 'window.__yose_app.db', 'getMasterConfig', { afterRead: true });
		await d.click('#btn-add-holiday'); await waitGate(d, 2);
		const raw = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d, 0); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await d.evaluate('document.querySelector("#btn-add-holiday").disabled'), true);
		assert.equal(await value(d, '#input-new-holiday'), '2032-01-03'); assert.deepEqual(await rawWorkflow(d), raw);
		assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
		await releaseGate(d, 1); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await flushWorkflow(d);
		assert.equal(await d.evaluate('(async()=>{const dates=(await window.__yose_app.db.getMasterConfig()).holidays;return dates.includes("2031-01-02")&&dates.includes("2032-01-03");})()'), true);
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

for (const phase of ['read', 'committed-save']) uiCase67(fixture, `keeps the new master JSON draft and original after an old ${phase} finishes in another authentication session`, async d => {
	await settings67(d);
	if (phase === 'committed-save') {
		await d.click('#btn-view-master-json'); await flushWorkflow(d); const config = JSON.parse(await value(d, '#txt-master-json')); config.accounts[0].name = 'OLD_JSON_SAVE67'; await d.fill('#txt-master-json', JSON.stringify(config));
	}
	const selector = phase === 'read' ? '#btn-view-master-json' : '#btn-save-master-json'; await observeNative67(d, selector);
	await gateMethod(d, phase === 'read' ? 'window.__yose_app.db' : 'window.__yose_app', phase === 'read' ? 'getMasterConfig' : 'refreshAllViews', { afterRead: phase === 'read' });
	try {
		await d.click(selector); await waitGate(d); await newInput67(d);
		await d.evaluate('window.__yose_app.db.mutateMasterConfig(config=>{config.accounts[0].name="NEW_JSON_ORIGINAL67"})');
		const start = await d.evaluate('window.__workflowJobs.length'); await d.click('.tab-btn[data-tab="tab-settings"]'); await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`);
		if (await d.isVisible('#master-json-editor')) await d.click('#btn-view-master-json');
		await d.click('#btn-view-master-json');
		if (phase === 'read') await d.evaluate('window.__masterNativeJobs67[window.__masterNativeJobs67.length-1]');
		else await d.waitFor('document.querySelector("#master-json-editor").style.display!=="none"');
		const config = JSON.parse(await value(d, '#txt-master-json')); assert.equal(config.accounts[0].name, 'NEW_JSON_ORIGINAL67'); config.accounts[0].name = 'NEW_JSON_DRAFT67'; await d.fill('#txt-master-json', JSON.stringify(config));
		const text = await value(d, '#txt-master-json'), original = await d.evaluate('structuredClone(window.__yose_app.settingsController.jsonExpectedConfig)'), raw = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await d.evaluate('window.__masterNativeJobs67[0]'); await flushWorkflow(d);
		assert.equal(await value(d, '#txt-master-json'), text); assert.deepEqual(await d.evaluate('window.__yose_app.settingsController.jsonExpectedConfig'), original);
		assert.deepEqual(await rawWorkflow(d), raw); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

uiCase67(fixture, 'ignores an old holiday API response after PIN unlock opens a new holiday import draft', async d => {
	await settings67(d, 'holidays'); await d.click('#btn-open-holiday-modal');
	d.responses.set('https://holidays-jp.github.io/api/v1/date.json', { json: { '2031-01-02': 'OLD_API67' } });
	await observeNative67(d, '#btn-fetch-holiday-api'); await gateMethod(d, 'window', 'fetch', { afterRead: true });
	try {
		await d.click('#btn-fetch-holiday-api'); await waitGate(d); await newInput67(d);
		const start = await d.evaluate('window.__workflowJobs.length'); await d.click('.tab-btn[data-tab="tab-settings"]'); await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`);
		await d.click('.master-tab-btn[data-master="holidays"]'); await d.click('#btn-open-holiday-modal'); await d.fill('#txt-holiday-import-input', '2035-01-02');
		const raw = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d); await settleNative67(d);
		assert.equal(await value(d, '#txt-holiday-import-input'), '2035-01-02'); assert.equal(await d.isVisible('#modal-holiday-import'), true);
		assert.deepEqual(await rawWorkflow(d), raw); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});

uiCase67(fixture, 'keeps a newer saving category modal active when an old committed account refresh finishes after PIN unlock', async d => {
	await settings67(d, 'accounts'); await d.click('.btn-edit-account[data-id="acc_wallet"]'); await flushWorkflow(d); await d.fill('#m-acc-name', 'OLD_COMMITTED_ACCOUNT67');
	await observeNative67(d, '#form-master-account', 'submit'); await gateMethod(d, 'window.__yose_app', 'refreshAllViews');
	let stage = 'old-save';
	try {
		await d.click('#form-master-account button[type=submit]'); await waitGate(d); await d.evaluate('void(window.__oldMasterNative67=window.__masterNativeJobs67[0])');
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).accounts.find(item=>item.id==="acc_wallet").name)()'), 'OLD_COMMITTED_ACCOUNT67');
		stage = 'unlock'; await newInput67(d, true);
		stage = 'new-settings';
		const start = await d.evaluate('window.__workflowJobs.length'); await d.click('.tab-btn[data-tab="tab-settings"]'); await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`); await d.click('.master-tab-btn[data-master="categories"]');
		stage = 'new-open'; const openStart = await d.evaluate('window.__workflowJobs.length'); await d.click('.btn-edit-cat[data-id="cat_food"]'); await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${openStart}).map(job=>job.promise))`); await d.fill('#m-cat-name', 'NEW_SAVING_CATEGORY67');
		await observeNative67(d, '#form-master-category', 'submit'); await gateMethod(d, 'window.__yose_app.db', 'captureImportState', { afterRead: true });
		stage = 'new-save'; await d.click('#form-master-category button[type=submit]'); await waitGate(d, 2);
		const state = await d.evaluate('({values:window.__yose_app.masterController.captureValues(),generation:window.__yose_app.masterController.openGeneration,submitting:window.__yose_app.masterController.submittingVersion})'), raw = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		assert.equal(await d.evaluate('document.querySelector("#form-master-category button[type=submit]").disabled'), true);
		stage = 'old-completion'; await releaseGate(d, 0); await d.evaluate('window.__oldMasterNative67');
		assert.equal(await d.isVisible('#modal-master-item'), true); assert.equal(await value(d, '#m-cat-id'), 'cat_food');
		assert.deepEqual(await d.evaluate('({values:window.__yose_app.masterController.captureValues(),generation:window.__yose_app.masterController.openGeneration,submitting:window.__yose_app.masterController.submittingVersion})'), state);
		assert.equal(await d.evaluate('document.querySelector("#form-master-category button[type=submit]").disabled'), true); assert.deepEqual(await rawWorkflow(d), raw); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
		stage = 'new-completion'; await releaseGate(d, 1); await d.evaluate('window.__masterNativeJobs67[0]'); await flushWorkflow(d);
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).categories.find(item=>item.id==="cat_food").name)()'), 'NEW_SAVING_CATEGORY67');
	} catch (error) { throw new Error(`master ownership stage=${stage}: ${error.message}`, { cause: error }); }
	finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled([...window.__masterNativeJobs67,window.__oldMasterNative67])'); }
});

uiCase67(fixture, 'retains a new pending JSON save owner and original when an old committed JSON refresh completes', async d => {
	await settings67(d); await d.click('#btn-view-master-json'); await flushWorkflow(d);
	const config = JSON.parse(await value(d, '#txt-master-json')); config.accounts[0].name = 'OLD_COMMITTED_JSON67'; await d.fill('#txt-master-json', JSON.stringify(config));
	await observeNative67(d, '#btn-save-master-json'); await gateMethod(d, 'window.__yose_app', 'refreshAllViews');
	try {
		await d.click('#btn-save-master-json'); await waitGate(d); await newInput67(d);
		await d.evaluate('window.__yose_app.db.mutateMasterConfig(current=>{current.accounts[0].name="NEW_JSON_ORIGINAL67"})');
		const start = await d.evaluate('window.__workflowJobs.length'); await d.click('.tab-btn[data-tab="tab-settings"]'); await d.evaluate(`Promise.allSettled(window.__workflowJobs.slice(${start}).map(job=>job.promise))`);
		if (await d.isVisible('#master-json-editor')) await d.click('#btn-view-master-json'); await d.click('#btn-view-master-json');
		await d.waitFor('document.querySelector("#master-json-editor").style.display!=="none"&&JSON.parse(document.querySelector("#txt-master-json").value).accounts[0].name==="NEW_JSON_ORIGINAL67"');
		const changed = JSON.parse(await value(d, '#txt-master-json')); changed.accounts[0].name = 'NEW_JSON_PENDING67'; await d.fill('#txt-master-json', JSON.stringify(changed));
		await gateMethod(d, 'window.__yose_app.db', 'captureImportState', { afterRead: true }); await d.click('#btn-save-master-json'); await waitGate(d, 2);
		const text = await value(d, '#txt-master-json'), original = await d.evaluate('structuredClone(window.__yose_app.settingsController.jsonExpectedConfig)'), raw = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		assert.equal(await d.evaluate('document.querySelector("#btn-save-master-json").disabled'), true, 'the new real JSON save must own the disabled button');
		await releaseGate(d, 0); await d.evaluate('window.__masterNativeJobs67[0]');
		assert.equal(await value(d, '#txt-master-json'), text); assert.deepEqual(await d.evaluate('window.__yose_app.settingsController.jsonExpectedConfig'), original); assert.equal(await d.isVisible('#master-json-editor'), true);
		assert.equal(await d.evaluate('document.querySelector("#btn-save-master-json").disabled'), true); assert.deepEqual(await rawWorkflow(d), raw); assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
		await releaseGate(d, 1); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); await flushWorkflow(d);
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).accounts[0].name)()'), 'NEW_JSON_PENDING67');
	} finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); }
});
