import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
describe('native IndexedDB archive metadata atomicity', { timeout: 120000 }, () => {
	for (const fault of ['metadata-write', 'metadata-success-invalidation']) it(`preserves every encrypted original when ${fault} occurs in the native settings store`, async () => {
		const d = fixture.driver;
		const result = await d.evaluate(`(async()=>{
			const db=window.__yose_app.db,local=await db.getMasterConfig(),accepted=structuredClone(local); accepted.accounts[0].name='remote metadata transaction';
			await db.setSetting('downloaded_archive_months',['2026-08']); await db.setSetting('device-only-value',{private:'preserve'});
			const state=async()=>({business:await db.captureImportState(),settings:await db.getAllRaw('settings')}),before=await state(),transaction=db.db.transaction.bind(db.db);
			let valid=true,entered=false,error=null;
			db.db.transaction=(...args)=>{const tx=transaction(...args),objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name),put=store.put.bind(store);if(name==='settings')store.put=(value,key)=>{if(key!=='downloaded_archive_months')return put(value,key);entered=true;if(${JSON.stringify(fault)}==='metadata-write')throw new Error('native metadata write fault');const request=put(value,key);request.addEventListener('success',()=>{valid=false;});return request;};return store;};return tx;};
			try {await db.commitMasterSync(local,accepted,{remoteState:{master_config:accepted,pending_diffs:[],archived_transactions:[],snapshot:await db.getSnapshot(),archive_months:['2026-09']},isSessionValid:()=>valid});}
			catch(failure){error=failure.message;}
			finally{db.db.transaction=transaction;}
			return {before,after:await state(),entered,error};
		})()`);
		assert.equal(result.entered, true); assert.ok(result.error, 'metadata failure or caller invalidation must reject the entire native transaction');
		assert.deepEqual(result.after, result.before);
	});
});
