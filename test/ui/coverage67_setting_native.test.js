import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
describe('review67 native setting session guard', { timeout: 120000 }, () => {
	it('aborts an actual IndexedDB setting put if authentication expires before transaction completion', async () => {
		const result = await fixture.driver.evaluate(`(async()=>{
			const db=window.__yose_app.db;await db.setSetting('guarded-url','https://old.fixture/exec');const capture=async()=>({business:await db.captureImportState(),settings:await db.getAllRaw('settings'),keys:await db.getAllRaw('security_keys')}),before=await capture(),key=db.encryptionKey,generation=db.keyGeneration,original=db.db.transaction.bind(db.db);let entered=false,error=null;
			db.db.transaction=(...args)=>{const tx=original(...args);if(args[1]!=='readwrite')return tx;const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name),put=store.put.bind(store);if(name==='settings')store.put=(value,id)=>{const request=put(value,id);if(id==='guarded-url')request.addEventListener('success',()=>{entered=true;db.clearEncryptionKey();});return request;};return store;};return tx;};
			try{await db.setSetting('guarded-url','https://expired.fixture/exec',{isSessionValid:()=>db.keyGeneration===generation});}catch(failure){error=failure.message;}finally{db.db.transaction=original;db.setEncryptionKey(key);}
			return {entered,error,before,after:await capture()};
		})()`);
		assert.equal(result.entered, true); assert.match(result.error || '', /IndexedDB write aborted/); assert.deepEqual(result.after, result.before);
	});
});
