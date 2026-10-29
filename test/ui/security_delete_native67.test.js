import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
const fixture = useBrowser();
it('atomically preserves every native security record when the delete request succeeds after its parent expires', async () => {
	const result = await fixture.driver.evaluate(`(async()=>{
		const db=window.__yose_app.db;await db.saveSecurityKey('delete-parent67',{id:'credential67',payload:'original'});await db.saveSecurityKey('unrelated-parent67',{id:'untouched67'});
		const raw=async()=>({business:await db.captureImportState(),settings:await db.getAllRaw('settings'),keys:await db.getAllRaw('security_keys')}),before=await raw(),key=db.encryptionKey,generation=db.keyGeneration,original=db.db.transaction.bind(db.db);let parent=true,entered=false,error=null;
		db.db.transaction=(...args)=>{const tx=original(...args);if(args[1]!=='readwrite')return tx;const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name),remove=store.delete.bind(store);if(name==='security_keys')store.delete=id=>{const request=remove(id);if(id==='delete-parent67')request.addEventListener('success',()=>{entered=true;parent=false;});return request;};return store;};return tx;};
		try{await db.deleteSecurityKey('delete-parent67',{isSessionValid:()=>parent});}catch(failure){error=failure.message;}finally{db.db.transaction=original;}
		return {entered,error,before,after:await raw(),sameKey:db.encryptionKey===key,sameGeneration:db.keyGeneration===generation};
	})()`);
	assert.equal(result.entered, true); assert.equal(result.sameKey, true); assert.equal(result.sameGeneration, true); assert.match(result.error || '', /IndexedDB delete aborted/); assert.deepEqual(result.after, result.before);
});
