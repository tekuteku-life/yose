import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
async function setup(d, fail = false) {
	await seed(d, ['edit-closed', 'delete-closed'].map(id => transaction(id, { date: '2026-09-20', target_month: '2026-09', sync_status: 'synced' })));
	await d.evaluate(`(async()=>{
		const app=window.__yose_app,manager=app.syncManager,master=await app.db.getMasterConfig();
		app.currentMonth='2026-09';app.selectedYear='2026';manager.setGasUrl('https://yose.local/reclose');
		window.__closedJobs=[];window.__closedRestores=[];window.__closedSent=[];window.__closedReleases=[];
		const observe=(object,name)=>{const original=object[name];if(typeof original!=='function')return;object[name]=function(...args){const promise=original.apply(this,args),job={name,promise,settled:false};window.__closedJobs.push(job);Promise.resolve(promise).then(()=>job.settled=true,()=>job.settled=true);return promise;};window.__closedRestores.push(()=>object[name]=original);};
		observe(app.txEditController,'handleEditFormSubmit');observe(app.txEditController,'handleEditDelete');observe(app,'scheduleTransactionMaintenance');
		const fetch=manager.fetch;window.__closedRestores.push(()=>manager.fetch=fetch);
		manager.fetch=async(_url,options)=>{
			const request=JSON.parse(options.body);let response={success:true};
			if(request.action==='fetch_master'||request.action==='update_master')response.master_config=request.payload.master_config||master;
			if(request.action==='push_diff'){
				const submitted=structuredClone(request.payload.transactions),index=window.__closedSent.length;window.__closedSent.push(submitted);
				if(index<2)await new Promise(resolve=>window.__closedReleases[index]=resolve);
				${fail ? "if(index===0)throw new Error('RECLOSE_BACKGROUND_FAILURE');" : ''}
				response.accepted_ids=submitted.map(row=>row.id);response.pending_diffs=submitted.map(row=>({...row,sync_status:'synced'}));
				response.snapshot={...await app.db.getSnapshot(),account_balances:{...(await app.db.getSnapshot()).account_balances,acc_wallet:index===0?123456:654321}};
			}
			return {ok:true,status:200,text:async()=>JSON.stringify(response)};
		};
	})()`);
	await cashflow(d);
}
async function openEdit(d, memo) {
	await d.click('#month-tx-list [data-id="edit-closed"]');
	await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active")&&document.getElementById("edit-tx-id").value==="edit-closed"');
	await d.fill('#edit-tx-memo', memo);
	await d.click('#edit-tx-form button[type="submit"]');
}
async function finishLocal(d, name) {
	await d.evaluate(`(async()=>{const job=window.__closedJobs.filter(job=>job.name===${JSON.stringify(name)}).at(-1);if(!job)throw new Error('actual local operation not observed');await job.promise;})()`);
}
async function cleanup(d) {
	await d.evaluate('window.__closedReleases?.forEach(release=>release?.())');
	// A trailing request can reach its gate after the first release; release it when entered.
	await d.evaluate(`(async()=>{window.__closedReleases.forEach(release=>release?.());const timer=setInterval(()=>window.__closedReleases.forEach(release=>release?.()),10);try{await Promise.allSettled(window.__closedJobs.map(job=>job.promise));}finally{clearInterval(timer);window.__closedRestores.reverse().forEach(restore=>restore());}})()`);
}

it('reflects closed-month edits and deletion before reclose responses, then resends the newest local versions', async () => {
	const d = fixture.driver; await setup(d);
	try {
		await openEdit(d, 'first local edit');
		await d.waitFor('typeof window.__closedReleases[0]==="function"');
		assert.equal(await d.evaluate('window.__closedJobs.find(job=>job.name==="handleEditFormSubmit").settled'), true, 'local save must finish before the reclose response');
		assert.ok((await d.textContent('#month-tx-list [data-id="edit-closed"]')).includes('first local edit'));
		await openEdit(d, 'second local edit'); await finishLocal(d, 'handleEditFormSubmit');
		assert.ok((await d.textContent('#month-tx-list [data-id="edit-closed"]')).includes('second local edit'));
		await d.click('#month-tx-list .btn-delete-tx[data-id="delete-closed"]'); await finishLocal(d, 'handleEditDelete');
		assert.equal(await d.evaluate('Boolean(document.querySelector("#month-tx-list [data-id=delete-closed]"))'), false);
		assert.equal(await d.evaluate('window.__closedSent.length'), 1, 'the active request must coalesce later local changes');
		assert.equal(await d.evaluate('window.__yose_app.db.getTransaction("edit-closed").then(row=>row.sync_status)'), 'unsynced');
		await d.evaluate('window.__closedReleases[0]()');
		await d.waitFor('typeof window.__closedReleases[1]==="function"');
		const second = await d.evaluate('window.__closedSent[1]');
		assert.equal(second.find(row => row.id === 'edit-closed').memo, 'second local edit');
		assert.equal(second.find(row => row.id === 'delete-closed').is_deleted, true);
		assert.equal(await d.evaluate('window.__yose_app.db.getTransaction("edit-closed").then(row=>row.sync_status)'), 'unsynced', 'old ACK must not mark the newer local edit synced');
		await d.evaluate('(async()=>{const app=window.__yose_app;app.analyticsTarget="assets";document.querySelector(".tab-btn[data-analytics-target=assets]").click();await app.summaryController.renderSummary();await app.txEditController.openEditTransactionModal("edit-closed");})()');
		await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-id").value==="edit-closed"&&document.querySelector("#edit-tx-memo").value==="second local edit"');
		await d.fill('#edit-tx-memo', 'next unsaved draft');
		await d.evaluate('window.__closedReleases[1]()');
		await d.evaluate('(async()=>{await Promise.allSettled(window.__closedJobs.filter(job=>job.name==="scheduleTransactionMaintenance").map(job=>job.promise));})()');
		assert.equal(await d.evaluate('window.__yose_app.db.getTransaction("edit-closed").then(row=>row.memo)'), 'second local edit');
		assert.equal(await d.evaluate('window.__yose_app.db.getTransaction("edit-closed").then(row=>row.sync_status)'), 'synced');
		assert.equal(await d.evaluate('window.__yose_app.db.getTransaction("delete-closed").then(row=>row.is_deleted&&row.sync_status==="synced")'), true);
		assert.equal(await d.evaluate('window.__yose_app.db.getSnapshot().then(snapshot=>snapshot.account_balances.acc_wallet)'), 654321);
		assert.match(await d.textContent('#account-balances-list'), /654,321/);
		assert.equal(await d.evaluate('document.querySelector("#edit-tx-memo").value'), 'next unsaved draft');
		assert.equal(await d.evaluate('document.querySelector("#modal-edit-tx").classList.contains("active")&&!document.querySelector("#edit-tx-memo").disabled'), true);
		assert.equal(await d.evaluate('window.__dialogs.some(dialog=>dialog.type==="alert"&&/再計算|遡及|過去締め/.test(dialog.message))'), false);
	} finally { await cleanup(d); }
});

it('keeps a closed-month edit saved and usable after background reclose failure without a blocking alert', async () => {
	const d = fixture.driver; await setup(d, true);
	try {
		await openEdit(d, 'saved before offline');
		await d.waitFor('typeof window.__closedReleases[0]==="function"');
		assert.equal(await d.evaluate('window.__closedJobs.find(job=>job.name==="handleEditFormSubmit").settled'), true);
		assert.ok((await d.textContent('#month-tx-list [data-id="edit-closed"]')).includes('saved before offline'));
		await d.evaluate('window.__closedReleases[0]()');
		await d.evaluate('(async()=>{await Promise.allSettled(window.__closedJobs.filter(job=>job.name==="scheduleTransactionMaintenance").map(job=>job.promise));})()');
		assert.equal(await d.evaluate('window.__yose_app.db.getTransaction("edit-closed").then(row=>row.memo)'), 'saved before offline');
		assert.equal(await d.evaluate('window.__yose_app.db.getTransaction("edit-closed").then(row=>row.sync_status)'), 'unsynced');
		assert.match(await d.textContent('#sync-badge'), /失敗|未同期/);
		assert.equal(await d.evaluate('window.__dialogs.some(dialog=>dialog.type==="alert"&&/RECLOSE_BACKGROUND_FAILURE|遡及|再計算/.test(dialog.message))'), false);
		await d.click('#month-tx-list [data-id="edit-closed"]');
		await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-memo").value==="saved before offline"');
		assert.equal(await d.evaluate('document.querySelector("#edit-tx-memo").disabled'), false);
	} finally { await cleanup(d); }
});
