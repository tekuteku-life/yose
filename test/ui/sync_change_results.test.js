import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, settings } from '../helpers/ui_fixture.js';
import { observeWorkflow, flushWorkflow, cleanupWorkflow, gateMethod, waitGate, releaseGate, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser();
function resultSections(message) {
	const markers = [...message.matchAll(/送信|受信/g)], sections = {};
	// The business summaries follow the retained transaction totals. Inspect each
	// direction's final section so a count on the other side cannot satisfy it.
	for (let index = 0; index < markers.length; index++) sections[markers[index][0]] = message.slice(markers[index].index, markers[index + 1]?.index ?? message.length);
	assert.ok(sections['送信'], 'sent result must have its own section');
	assert.ok(sections['受信'], 'received result must have its own section');
	return sections;
}
async function manualResult(d, result) {
	await settings(d); await d.evaluate('window.__yose_app.settingsController.renderSettings()');
	await d.evaluate(`{window.__yose_app.syncManager.syncBidirectional=async()=>(${JSON.stringify(result)});window.__dialogs=[];}`);
	await d.click('#btn-manual-sync'); await flushWorkflow(d);
	return d.evaluate('window.__dialogs.filter(dialog=>dialog.type==="alert").map(dialog=>dialog.message).join("\\n")');
}
function syncCase(name, run) {
	it(name, async () => {
		const d = fixture.driver; await observeWorkflow(d);
		try { await run(d); }
		finally { await cleanupWorkflow(d); }
	});
}

syncCase('displays changed business fields and their counts alongside the retained transaction totals', async d => {
	const message = await manualResult(d, { status: 'synced', synced_count: 12, downloaded_count: 13, pending_count: 0, pending_master: false, changes: { sent: { accounts: 2, recurring_rules: 4, annual_budgets: 6, point_payment_defaults: 1 }, received: { categories: 3, holidays: 5, investment_history: 7, summary_snapshot: 1 } } });
	assert.match(message, /送信\s*12\s*件/); assert.match(message, /受信\s*13\s*件/);
	const sections = resultSections(message);
	for (const [direction, expected] of [['送信', [['口座', 2], ['定期', 4], ['年度|予算', 6], ['ポイント', 1]]], ['受信', [['費目|内訳', 3], ['祝日', 5], ['投資|評価', 7], ['月締め|スナップショット', 1]]]]) {
		for (const [label, count] of expected) assert.match(sections[direction], new RegExp(`(?:${label})[^\\d\\n]{0,30}${count}(?:\\s*件|(?=\\s|[、,）)]|$))`), `${direction}: ${label} ${count}`);
	}
	assert.doesNotMatch(sections['送信'], /費目|内訳|祝日|投資|評価|月締め|スナップショット/);
	assert.doesNotMatch(sections['受信'], /口座|定期|年度|予算|ポイント/);
});

syncCase('explicitly says no business changes when both sent and received maps are empty', async d => {
	const message = await manualResult(d, { status: 'synced', synced_count: 0, downloaded_count: 0, pending_count: 0, pending_master: false, changes: { sent: {}, received: {} } });
	assert.match(message, /変更なし/); assert.doesNotMatch(message, /設定.*(?:すべて|全件).*変更/);
});

syncCase('distinguishes an acknowledged replacement import with unknown detail from no business changes', async d => {
	const message = await manualResult(d, { status: 'synced', synced_count: 0, downloaded_count: 0, pending_count: 0, pending_master: false, changes: { sent: {}, received: {} }, import_completed: true, import_changes_unknown: true });
	assert.match(message, /完全取込.*送信済み/);
	assert.match(message, /内訳.*確認できません|内訳.*不明/);
	assert.doesNotMatch(message, /変更なし/);
});

for (const status of ['master_conflict_cancelled', 'approval_required']) syncCase(`keeps completed received changes separate from ${status} and pending master state`, async d => {
	const message = await manualResult(d, { status, synced_count: 0, downloaded_count: 2, pending_count: 1, pending_master: true, changes: { sent: {}, received: { accounts: 2 } } });
	assert.match(message, /口座[^\d\n]{0,30}2/); assert.match(message, /設定.*(?:未同期|確認待ち|送信待ち)|(?:未同期|確認待ち|送信待ち).*設定/);
	assert.doesNotMatch(message, /差分同期完了|すべて.*完了/);
	assert.match(message, status === 'master_conflict_cancelled' ? /取消|取り消|確認待ち/ : /再月締め|承認/);
});

syncCase('shows the last committed business result in the settings view without requiring another sync', async d => {
	await settings(d);
	await d.evaluate(`{window.__yose_app.syncManager.lastResult={status:'synced',synced_count:0,downloaded_count:0,pending_count:0,pending_master:false,changes:{sent:{accounts:23},received:{holidays:29}}};}`);
	await d.evaluate('window.__yose_app.settingsController.renderSettings()');
	await d.evaluate('window.__yose_app.syncStatusController.updateSyncBadge()'); await flushWorkflow(d);
	const visible = await d.evaluate('document.querySelector("#tab-settings").innerText');
	assert.match(visible, /口座[^\d\n]{0,30}23/); assert.match(visible, /祝日[^\d\n]{0,30}29/);
});

syncCase('retains confirmed partial changes when a later synchronization stage fails', async d => {
	await settings(d); await d.evaluate('window.__yose_app.settingsController.renderSettings()');
	await d.evaluate(`{const manager=window.__yose_app.syncManager;manager.syncBidirectional=async()=>{manager.lastResult={status:'failed',synced_count:0,downloaded_count:2,pending_count:1,pending_master:true,changes:{sent:{},received:{accounts:2}}};throw new Error('LATER_SYNC_FAILURE');};window.__dialogs=[];}`);
	await d.click('#btn-manual-sync'); await flushWorkflow(d);
	const text = await d.evaluate('window.__dialogs.map(d=>d.message).join("\\n")+document.querySelector("#tab-settings").innerText');
	assert.match(text, /LATER_SYNC_FAILURE/); assert.match(text, /口座[^\d\n]{0,30}2/); assert.doesNotMatch(text, /差分同期完了/);
});

for (const change of ['manager', 'authentication']) syncCase(`suppresses completion from an old manual-sync ${change} owner`, async d => {
	await settings(d); await d.evaluate('window.__yose_app.settingsController.renderSettings()');
	await d.evaluate(`{window.__yose_app.syncManager.syncBidirectional=async()=>({status:'synced',synced_count:99,downloaded_count:0,pending_count:0,pending_master:false,changes:{sent:{accounts:99},received:{}}});}`);
	await gateMethod(d, 'window.__yose_app.syncManager', 'syncBidirectional');
	await d.click('#btn-manual-sync'); await waitGate(d);
	if (change === 'authentication') await unlockWorkflow(d);
	else await d.evaluate(`(async()=>{const {SyncManager}=await import('./js/sync.js');const app=window.__yose_app;app.syncManager=new SyncManager({db:app.db,privateKey:app.privateKey});app.syncStatusController.bindSyncManager();})()`);
	const count = await d.evaluate('window.__dialogs.length');
	await releaseGate(d); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${count})`), []);
});
