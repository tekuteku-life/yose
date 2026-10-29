import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow } from '../helpers/ui_fixture.js';
import { observeWorkflow, cleanupWorkflow, gateMethod, waitGate, releaseGate, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser();
const rule = id => ({ id, name: id, is_active: true, frequency: 'monthly', start_date: '2026-01-01', day_of_month: 15, holiday_adjustment: 'none', amount: 100, type: 'expense', account_id: 'acc_wallet', to_account_id: null, category_id: 'cat_food', subcategory_id: 'sub_groceries', actual_category_id: 'cat_food', actual_subcategory_id: 'sub_groceries' });
async function setup(d, status) {
	await seed(d, [transaction('entered', { amount: 100, date: '2026-09-30', target_month: '2026-10', subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries', status, memo: '手入力済み' })]);
	await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.recurring_rules=${JSON.stringify([rule('first'), rule('second')])};});const controller=app.summaryController,generate=controller.handleGenerateRecurring;window.__generationJobs=[];controller.handleGenerateRecurring=function(...args){const pending=generate.apply(this,args);window.__generationJobs.push(pending);return pending;};window.__restoreGeneration=()=>controller.handleGenerateRecurring=generate;})()`);
	await cashflow(d);
}
async function clickAndFinish(d) {
	await d.click('#btn-generate-recurring');
	await d.evaluate('(async()=>{await Promise.all(window.__generationJobs);})()');
}
for (const status of ['planned', 'confirmed']) it(`shows one generated and one manual exclusion for entered ${status} records and remains idempotent`, async () => {
	const d = fixture.driver; await setup(d, status);
	try {
		const original = await d.evaluate('window.__yose_app.db.getRaw("transactions","entered")');
		await clickAndFinish(d);
		let rows = await d.evaluate('window.__yose_app.db.getTransactions()');
		assert.equal(rows.length, 2);
		assert.equal(rows.find(row => row.id !== 'entered').recurring_rule_id, 'second');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","entered")'), original);
		const message = await d.evaluate('window.__dialogs.filter(d=>d.type==="alert").at(-1).message');
		assert.match(message, /(?:生成[^\n]*1\s*件|1\s*件[^\n]*生成)/);
		assert.match(message, /(?:入力済み|除外)[^\n]*1\s*件/);
		await clickAndFinish(d);
		rows = await d.evaluate('window.__yose_app.db.getTransactions()'); assert.equal(rows.length, 2);
	} finally { await d.evaluate('window.__restoreGeneration?.()'); }
});

it('does not generate old-session recurring records after an actual lock and unlock', async () => {
	const d = fixture.driver; await observeWorkflow(d); await setup(d, 'confirmed');
	try {
		await gateMethod(d, 'window.__yose_app.db', 'generateRecurringForMonth');
		const before = await d.evaluate('window.__yose_app.db.getAllRaw("transactions")');
		await d.click('#btn-generate-recurring'); await waitGate(d);
		await unlockWorkflow(d);
		assert.equal(await d.evaluate('window.__workflowGates[0].args[2].isSessionValid()'), false);
		const dialogs = await d.evaluate('window.__dialogs.length');
		await releaseGate(d);
		await d.evaluate('(async()=>{await Promise.allSettled(window.__generationJobs);})()');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("transactions")'), before);
		assert.equal(await d.evaluate('window.__dialogs.length'), dialogs);
	} finally { await cleanupWorkflow(d); await d.evaluate('window.__restoreGeneration?.()'); }
});

it('reports committed recurring generation separately from a failed local view refresh', async () => {
	const d = fixture.driver; await setup(d, 'confirmed');
	await d.evaluate('window.__generationRefresh=window.__yose_app.refreshAfterTransactionChange;window.__yose_app.refreshAfterTransactionChange=async()=>{throw new Error("GENERATION_REFRESH_FAILURE");};window.__dialogs=[];');
	try {
		await clickAndFinish(d);
		const rows = await d.evaluate('window.__yose_app.db.getTransactions()');
		assert.equal(rows.length, 2); assert.equal(rows.find(row => row.id !== 'entered').recurring_rule_id, 'second');
		const alerts = await d.evaluate('window.__dialogs.filter(dialog=>dialog.type==="alert").map(dialog=>dialog.message)');
		assert.equal(alerts.length, 1, 'one contextual result must explain that the generation is already saved');
		assert.match(alerts[0], /保存済み/); assert.match(alerts[0], /表示|更新/); assert.match(alerts[0], /GENERATION_REFRESH_FAILURE/);
		assert.match(alerts[0], /(?:生成|予定)[^\n]*1\s*件|1\s*件[^\n]*(?:生成|予定)/);
		assert.match(alerts[0], /(?:入力済み|除外)[^\n]*1\s*件/);
		assert.doesNotMatch(alerts[0], /生成に失敗/);
		const savedIds = rows.map(row => row.id).sort();
		await d.evaluate('window.__yose_app.refreshAfterTransactionChange=window.__generationRefresh');
		await clickAndFinish(d);
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getTransactions().then(rows=>rows.map(row=>row.id).sort())'), savedIds);
	} finally { await d.evaluate('window.__yose_app.refreshAfterTransactionChange=window.__generationRefresh;window.__restoreGeneration?.()'); }
});
