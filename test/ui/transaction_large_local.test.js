import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow } from '../helpers/ui_fixture.js';
import { observeWorkflow, flushWorkflow, cleanupWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser({ commandTimeoutMs: 180000 });

it('commits and renders consecutive encrypted create/edit/delete operations before a 13000-row synchronization fetch is released', { timeout: 240000 }, async t => {
	const d = fixture.driver; await observeWorkflow(d);
	try {
		await seed(d, Array.from({ length: 13000 }, (_, index) => transaction(`large-${index}`, { date: '2026-10-01', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z' })));
		await d.evaluate(`(async()=>{
			const app=window.__yose_app,manager=app.syncManager;
			window.__largeRemoteMaster=await app.db.getMasterConfig();window.__largeRemoteSnapshot=await app.db.getSnapshot();
			manager.setGasUrl('https://yose.local/large-pending');
			let first=true;
			manager.fetch=async(_url,options)=>{const request=JSON.parse(options.body);if(first&&request.action==='fetch_state'){first=false;window.__largeFetchEntered=true;await new Promise(resolve=>window.__largeReleaseFetch=()=>{window.__largeFetchReleased=true;resolve();});}
				if(request.action==='update_master')window.__largeRemoteMaster=request.payload.master_config;
				return {ok:true,text:async()=>JSON.stringify({success:true,master_config:window.__largeRemoteMaster,summary_snapshot:window.__largeRemoteSnapshot,pending_diffs:[],archived_transactions:[]})};};
			app.db.setEncryptionKey(app.db.encryptionKey);
			window.__largeNetwork=manager.syncBidirectional();window.__largeNetwork.catch(()=>{});
		})()`);
		await d.waitFor('window.__largeFetchEntered===true', 120000);
		await d.evaluate(`(()=>{
			const proto=IDBObjectStore.prototype,originals={put:proto.put,delete:proto.delete,clear:proto.clear},decrypt=crypto.subtle.decrypt;
			window.__largePerf={put:0,delete:0,clear:0,decrypt:0};
			for(const name of ['put','delete','clear'])proto[name]=function(...args){if(this.name==='transactions')window.__largePerf[name]++;return originals[name].apply(this,args);};
			crypto.subtle.decrypt=function(...args){window.__largePerf.decrypt++;return decrypt.apply(this,args);};
			window.__largeRestorePerf=()=>{for(const name of ['put','delete','clear'])proto[name]=originals[name];crypto.subtle.decrypt=decrypt;};
		})()`);
		const phases = [];
		await d.fill('#input-amount', '321'); await d.fill('#input-memo', 'LARGE_LOCAL_NEW');
		await d.click('#btn-save-tx'); await flushWorkflow(d);
		await d.waitFor('document.querySelector("#recent-tx-list").textContent.includes("LARGE_LOCAL_NEW")', 120000);
		const id = await d.evaluate('[...document.querySelectorAll("#recent-tx-list .tx-item")].find(row=>row.textContent.includes("LARGE_LOCAL_NEW")).dataset.id');
		assert.equal(await d.evaluate('Boolean(window.__largeFetchReleased)'), false);
		phases.push({ phase: 'cold create', ...await d.evaluate('window.__largePerf') });
		await cashflow(d);
		await d.evaluate('window.__largePerf={put:0,delete:0,clear:0,decrypt:0}');
		await d.click(`#month-tx-list .tx-item[data-id="${id}"]`);
		await d.waitFor(`document.querySelector('#modal-edit-tx').classList.contains('active')&&document.querySelector('#edit-tx-id').value===${JSON.stringify(id)}`, 120000);
		await d.fill('#edit-tx-memo', 'LARGE_LOCAL_EDITED'); await d.fill('#edit-tx-amount', '654');
		await d.click('#edit-tx-form button[type="submit"]'); await flushWorkflow(d);
		await d.waitFor(`document.querySelector('#month-tx-list .tx-item[data-id="${id}"]').textContent.includes('LARGE_LOCAL_EDITED')`, 120000);
		assert.equal(await d.evaluate('Boolean(window.__largeFetchReleased)'), false);
		assert.deepEqual(await d.evaluate(`(async()=>{const tx=await window.__yose_app.db.getTransaction(${JSON.stringify(id)});return [tx.amount,tx.memo,tx.is_deleted];})()`), [654, 'LARGE_LOCAL_EDITED', false]);
		phases.push({ phase: 'warm edit', ...await d.evaluate('window.__largePerf') });
		await d.evaluate('window.__largePerf={put:0,delete:0,clear:0,decrypt:0}');
		await d.click(`#month-tx-list .btn-delete-tx[data-id="${id}"]`); await flushWorkflow(d);
		await d.waitFor(`!document.querySelector('#month-tx-list .tx-item[data-id="${id}"]')`, 120000);
		assert.equal(await d.evaluate(`(async()=> (await window.__yose_app.db.getTransaction(${JSON.stringify(id)})).is_deleted)()`), true);
		assert.equal(await d.evaluate('Boolean(window.__largeFetchReleased)'), false);
		phases.push({ phase: 'warm delete', ...await d.evaluate('window.__largePerf') });
		t.diagnostic(JSON.stringify({ rows: 13000, encrypted: true, indexedDB: true, fetchReleased: false, phases }));
		for (const phase of phases) {
			assert.deepEqual({ put: phase.put, delete: phase.delete, clear: phase.clear }, { put: 1, delete: 0, clear: 0 }, phase.phase);
			assert.ok(phase.decrypt <= (phase.phase === 'cold create' ? 13040 : 20), `${phase.phase}: AES decrypt count=${phase.decrypt}`);
		}
	} finally {
		await d.evaluate('window.__largeRestorePerf?.();window.__largeReleaseFetch?.()');
		await d.evaluate('Promise.allSettled([window.__largeNetwork])');
		await cleanupWorkflow(d);
	}
});
