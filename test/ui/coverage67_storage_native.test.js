import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
describe('review67 native IndexedDB session rollback', { timeout: 120000 }, () => {
	it('reopens an existing version-one database without recreating stores or replacing encrypted data', async () => {
		const result = await fixture.driver.evaluate(`(async()=>{
			const db=window.__yose_app.db,{StorageEngine}=await import('./js/db/storage_engine.js'),before={business:await db.captureImportState(),keys:await db.getAllRaw('security_keys'),settings:await db.getAllRaw('settings')};let upgrades=0;
			const reopened=await new StorageEngine({open:(...args)=>{const request=indexedDB.open(...args);request.addEventListener('upgradeneeded',()=>upgrades++);return request;}}).init();
			try{return {upgrades,version:reopened.db.version,stores:[...reopened.db.objectStoreNames],before,after:{business:{master:await reopened.getRaw('master_config','current'),snapshot:await reopened.getRaw('summary_snapshot','current'),transactions:await reopened.getAllRaw('transactions'),pending:await reopened.getRaw('master_config','pending_import'),base:await reopened.getRaw('master_config','sync_base')},keys:await reopened.getAllRaw('security_keys'),settings:await reopened.getAllRaw('settings')}};}finally{reopened.db.close();}
		})()`);
		assert.equal(result.version, 1); assert.equal(result.upgrades, 0); assert.deepEqual(result.stores.sort(), ['master_config', 'security_keys', 'settings', 'summary_snapshot', 'transactions']); assert.deepEqual(result.after, result.before);
	});
	for (const operation of ['putSecurityKeys', 'putRaw']) it(`rolls back ${operation} after a native write observes a real key invalidation`, async () => {
		const result = await fixture.driver.evaluate(`(async()=>{
			const db=window.__yose_app.db,raw=async()=>({business:await db.captureImportState(),keys:await db.getAllRaw('security_keys'),settings:await db.getAllRaw('settings')}),before=await raw(),key=db.encryptionKey,generation=db.keyGeneration,original=db.db.transaction.bind(db.db); let entered=false,error=null;
			db.db.transaction=(...args)=>{const tx=original(...args),objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name),put=store.put.bind(store);if(name==='security_keys')store.put=(...values)=>{const request=put(...values);request.addEventListener('success',()=>{entered=true;db.clearEncryptionKey();});return request;};return store;};return tx;};
			try{if(${JSON.stringify(operation)}==='putSecurityKeys')await db.putSecurityKeys({test_signing:{cipher:'one'},test_recovery:{cipher:'two'}},()=>db.keyGeneration===generation);else await db.putRaw('security_keys',{cipher:'one'},'test_signing',()=>db.keyGeneration===generation);}catch(failure){error=failure.message;}finally{db.db.transaction=original;db.setEncryptionKey(key);}
			return {entered,error,before,after:await raw()};
		})()`);
		assert.equal(result.entered, true); assert.deepEqual(result.after, result.before); assert.match(result.error, /認証鍵|認証状態が変更|abort|中止/i);
	});
	for (const operation of ['putAllRaw', 'deleteRaw']) it(`preserves all encrypted rows when the native ${operation} transaction is explicitly aborted`, async () => {
		const result = await fixture.driver.evaluate(`(async()=>{
			const db=window.__yose_app.db,row={id:'native-kept',type:'expense',status:'confirmed',date:'2026-10-20',target_month:'2026-10',amount:100,account_id:'acc_wallet',category_id:'cat_food'};await db.putTransaction(row);
			const before=await db.captureImportState(),transaction=db.db.transaction.bind(db.db);let entered=false,error=null;
			db.db.transaction=(...args)=>{const tx=transaction(...args);if(args[1]!=='readwrite')return tx;const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name),method=${JSON.stringify(operation)}==='deleteRaw'?'delete':'put',write=store[method].bind(store);store[method]=(...values)=>{const request=write(...values);request.addEventListener('success',()=>{entered=true;tx.abort();});return request;};return store;};return tx;};
			try{if(${JSON.stringify(operation)}==='deleteRaw')await db.deleteRaw('transactions','native-kept');else await db.putAllRaw('transactions',[await db.encryptRecord({...row,id:'native-new'},{id:'native-new'})]);}catch(failure){error=failure.message;}finally{db.db.transaction=transaction;}
			return {before,after:await db.captureImportState(),entered,error};
		})()`);
		assert.equal(result.entered, true); assert.match(result.error, /IndexedDB.*aborted/); assert.deepEqual(result.after, result.before);
	});
	it('rejects a native replacement invalidated during its raw reads before writing any store', async () => {
		const result = await fixture.driver.evaluate(`(async()=>{
			const db=window.__yose_app.db,before=await db.captureImportState(),key=db.encryptionKey,generation=db.keyGeneration,original=db.db.transaction.bind(db.db);let entered=false,error=null;
			db.db.transaction=(...args)=>{const tx=original(...args);if(args[1]!=='readwrite')return tx;const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name),get=store.get.bind(store);if(name==='master_config')store.get=(...values)=>{const request=get(...values);request.addEventListener('success',()=>{if(!entered){entered=true;db.setEncryptionKey(key);}});return request;};return store;};return tx;};
			try{await db.replaceImportBatch(before,{},()=>db.keyGeneration===generation);}catch(failure){error=failure.message;}finally{db.db.transaction=original;}
			return {before,after:await db.captureImportState(),entered,error};
		})()`);
		assert.equal(result.entered, true); assert.match(result.error, /認証または同期状態が変更/); assert.deepEqual(result.after, result.before);
	});
});
