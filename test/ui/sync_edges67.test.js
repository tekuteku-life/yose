import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, value } from '../helpers/ui_fixture.js';
import { flushWorkflow, rawWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
async function signedRemote67(d, { closed = false, fail = false } = {}) {
	await d.evaluate(`(async()=>{
		const app=window.__yose_app,manager=app.syncManager,{verifySignedRequest}=await import('./js/crypto.js');
		const config=await app.db.getMasterConfig(),snapshot=await app.db.getSnapshot();${closed ? 'snapshot.last_closed_month="2026-10";' : ''}
		window.__syncRequests67=[];const fetch=manager.fetch,url=manager.gasUrl;manager.setGasUrl('https://signed67.fixture/exec');
		manager.fetch=async(_url,options)=>{const request=JSON.parse(options.body);if(!(await verifySignedRequest(request,app.publicKey)).valid)throw new Error('real signature invalid');window.__syncRequests67.push(request.action);${fail ? "throw new TypeError('Failed to fetch');" : "return {ok:true,text:async()=>JSON.stringify({success:true,master_config:config,snapshot,pending_diffs:[],archived_transactions:[],archive_months:[],...(request.action==='push_diff'?{accepted_ids:request.payload.transactions.map(tx=>tx.id)}:{})})};"}};
		window.__restores67.push(()=>{manager.fetch=fetch;manager.setGasUrl(url)});
	})()`);
}
for (const kind of ['approve', 'cancel', 'planned', 'unknown']) uiCase67(fixture, `handles a newly received closed month for ${kind} pending changes through real signed manual synchronization`, async d => {
	await seed(d, [transaction('closed-sync67', { status: kind === 'planned' || kind === 'unknown' ? 'planned' : 'confirmed', ...(kind === 'unknown' ? { amount: 0, amount_pending: true } : {}) })]);
	await signedRemote67(d, { closed: true }); await settings67(d);
	const original = await d.evaluate('window.__yose_app.db.getRaw("transactions","closed-sync67")');
	if (kind === 'cancel') await d.setConfirm(false);
	await d.click('#btn-manual-sync'); await flushWorkflow(d);
	const saved = await d.evaluate('window.__yose_app.db.getTransaction("closed-sync67")'), requests = await d.evaluate('window.__syncRequests67');
	if (kind === 'approve') {
		assert.ok(requests.includes('push_diff')); assert.equal(saved.sync_status, 'synced');
		assert.ok((await d.evaluate('window.__dialogs')).some(item=>item.type==='confirm'&&item.message.includes('2026-10')));
	} else {
		assert.equal(requests.includes('push_diff'), false); assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","closed-sync67")'), original);
		assert.equal(saved.sync_status, 'unsynced');
		if (kind !== 'cancel') assert.ok((await d.evaluate('window.__dialogs')).some(item=>/金額入力済みの確定明細が必要/.test(item.message)));
		assert.match(await d.textContent('#sync-last-result'), /再月締めは未実行/);
	}
	assert.equal(await d.evaluate('window.__yose_app.syncManager.isSyncing'), false);
});
uiCase67(fixture, 'shows a synchronization failure with no pending transactions instead of claiming everything is synchronized', async d => {
	await signedRemote67(d, { fail: true }); await settings67(d); const before = await rawWorkflow(d);
	await d.click('#btn-manual-sync'); await flushWorkflow(d);
	assert.deepEqual(await rawWorkflow(d), before); assert.equal(await d.textContent('#sync-badge'), '同期失敗');
	assert.match(await d.evaluate('document.querySelector("#sync-badge").className'), /badge-danger/); assert.match(await d.textContent('#sync-last-result'), /同期に失敗/);
});
uiCase67(fixture, 'retains the latest completed sync result when its final full-view refresh fails', async d => {
	await signedRemote67(d); await settings67(d);
	await d.evaluate('(()=>{const app=window.__yose_app,refresh=app.refreshAllViews,warn=console.warn;window.__syncWarnings67=[];console.warn=(...args)=>window.__syncWarnings67.push(args.join(" "));app.refreshAllViews=async()=>{throw new Error("FINAL_VIEW_FAULT67")};window.__restores67.push(()=>{app.refreshAllViews=refresh;console.warn=warn});})()');
	await d.click('#btn-manual-sync'); await flushWorkflow(d);
	assert.equal(await d.evaluate('window.__yose_app.syncManager.lastResult.status'), 'synced');
	assert.match(await d.textContent('#sync-last-result'), /差分同期完了/);
	assert.ok((await d.evaluate('window.__syncWarnings67')).some(text=>text.includes('FINAL_VIEW_FAULT67')));
});
for (const event of ['state', 'master']) uiCase67(fixture, `ignores an old manager ${event} callback genuinely queued before PIN reinitialization replaces that manager`, async d => {
	await signedRemote67(d); await settings67(d);
	await d.evaluate(`(()=>{
		const app=window.__yose_app,manager=app.syncManager,register=${event === 'state' ? 'manager.onStateChange' : 'manager.onMasterChange'},name=${JSON.stringify(event === 'state' ? 'onStateChange' : 'onMasterChange')};let once=true;
		manager[name]=function(listener){return register.call(this,async(...args)=>{if(once){once=false;await new Promise(resolve=>window.__oldCallbackRelease67=resolve);}return listener(...args)});};app.syncStatusController.bindSyncManager();
		window.__restores67.push(()=>manager[name]=register);
		const fetch=manager.fetch;manager.fetch=async(...args)=>{const response=await fetch.apply(manager,args);${event === 'master' ? `const data=JSON.parse(await response.text());data.master_config.accounts[0].name='Received before callback67';return {...response,text:async()=>JSON.stringify(data)};` : 'await new Promise(resolve=>window.__oldRequestRelease67=resolve);return response;'}};
		window.__oldSyncOutcome67=manager.syncMaster().then(value=>({value}),error=>({error:error.message}));
		window.__restores67.push(()=>manager.fetch=fetch);
	})()`);
	try {
		await d.waitFor('typeof window.__oldCallbackRelease67==="function"');
		await unlockWorkflow(d); await d.click('.tab-btn[data-tab="tab-input"]'); await d.fill('#input-amount', '456'); await d.fill('#input-memo', 'NEW_MANAGER_DRAFT67');
		const before = await d.evaluate('({generation:window.__yose_app.authController.authGeneration,memo:document.querySelector("#input-memo").value,amount:document.querySelector("#input-amount").value,busy:window.__yose_app.syncManager.isSyncing})');
		await d.evaluate('window.__oldRequestRelease67?.();window.__oldCallbackRelease67()'); await d.evaluate('window.__oldSyncOutcome67'); await flushWorkflow(d);
		assert.deepEqual(await d.evaluate('({generation:window.__yose_app.authController.authGeneration,memo:document.querySelector("#input-memo").value,amount:document.querySelector("#input-amount").value,busy:window.__yose_app.syncManager.isSyncing})'), before);
	} finally { await d.evaluate('window.__oldRequestRelease67?.();window.__oldCallbackRelease67?.()'); await d.evaluate('window.__oldSyncOutcome67'); }
});
