import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
const fixture = useBrowser();
it('uses native get/getKey presence and distinct cloned values as the security observation reference', async () => {
	const r = await fixture.driver.evaluate(`(async()=>{
		const db=window.__yose_app.db;await db.putSecurityKeys({zero:0,no:false,empty:'',nil:null,obj:{nested:{n:1}}},()=>true);
		return await new Promise((resolve,reject)=>{const tx=db.db.transaction(['security_keys'],'readonly'),s=tx.objectStore('security_keys'),values={},keys={};let clone;
			for(const k of ['zero','no','empty','nil','absent']){const a=s.get(k),b=s.getKey(k);a.onsuccess=()=>values[k]={present:a.result!==undefined,value:a.result};b.onsuccess=()=>keys[k]=b.result===undefined?null:b.result;}
			const first=s.get('obj');first.onsuccess=()=>{first.result.nested.n=99;const second=s.get('obj');second.onsuccess=()=>clone=second.result;};tx.oncomplete=()=>resolve({values,keys,clone});tx.onabort=()=>reject(tx.error);
		});
	})()`);
	assert.deepEqual(r, { values: { zero: { present: true, value: 0 }, no: { present: true, value: false }, empty: { present: true, value: '' }, nil: { present: true, value: null }, absent: { present: false } }, keys: { zero: 'zero', no: 'no', empty: 'empty', nil: 'nil', absent: null }, clone: { nested: { n: 1 } } });
});
it('rejects a stale observation after an independent native connection changes the record and preserves every original', async () => {
	const r = await fixture.driver.evaluate(`(async()=>{
		const db=window.__yose_app.db;await db.putSecurityKeys({cas_slot:{v:1},delete_slot:{keep:true}},()=>true);
		const expected={cas_slot:{exists:true,value:{v:1}},delete_slot:{exists:true,value:{keep:true}}},other=await new Promise((resolve,reject)=>{const q=indexedDB.open(db.db.name,db.db.version);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
		try{await new Promise((resolve,reject)=>{const t=other.transaction(['security_keys'],'readwrite');t.objectStore('security_keys').put({v:2,foreign:true},'cas_slot');t.oncomplete=resolve;t.onabort=()=>reject(t.error);});
			const raw=async()=>({business:await db.captureImportState(),settings:await db.getAllRaw('settings'),keys:await db.getAllRaw('security_keys')}),before=await raw();let error;
			try{await db.putSecurityKeys({cas_slot:{v:3},added:'bad'},()=>true,{expectedSecurityKeys:expected,deleteKeys:['delete_slot']});}catch(e){error={name:e.name,code:e.code};}
			return{error,before,after:await raw(),actual:await db.getSecurityKey('cas_slot')};
		}finally{other.close();}
	})()`);
	assert.deepEqual(r.error, { name: 'SecurityKeyConflictError', code: 'SECURITY_KEYS_CHANGED' }); assert.deepEqual(r.after, r.before); assert.deepEqual(r.actual, { v: 2, foreign: true });
});
for (const stage of ['read', 'put', 'delete']) it(`rolls back every native security put and delete when only the parent expires at actual ${stage} success`, async () => {
	const r = await fixture.driver.evaluate(`(async()=>{
		const db=window.__yose_app.db;await db.putSecurityKeys({cas_slot:{v:1},delete_slot:{keep:true},unrelated:'keep'},()=>true);
		const raw=async()=>({business:await db.captureImportState(),settings:await db.getAllRaw('settings'),keys:await db.getAllRaw('security_keys')}),before=await raw(),key=db.encryptionKey,generation=db.keyGeneration,original=db.db.transaction.bind(db.db);let parent=true,entered=false,error;
		db.db.transaction=(...args)=>{const tx=original(...args);if(args[1]!=='readwrite')return tx;const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name);if(name!=='security_keys')return store;const method=${JSON.stringify(stage === 'read' ? 'get' : stage)},fn=store[method].bind(store);store[method]=(...a)=>{const q=fn(...a);q.addEventListener('success',()=>{if(!entered){entered=true;parent=false;}});return q;};return store;};return tx;};
		try{await db.putSecurityKeys({cas_slot:{v:2},added:'must rollback'},()=>parent,{expectedSecurityKeys:{cas_slot:{exists:true,value:{v:1}}},deleteKeys:['delete_slot']});}catch(e){error=e.message;}finally{db.db.transaction=original;}
		return{entered,error,before,after:await raw(),sameKey:key===db.encryptionKey,sameGeneration:generation===db.keyGeneration};
	})()`);
	assert.equal(r.entered, true); assert.ok(r.error); assert.equal(r.sameKey, true); assert.equal(r.sameGeneration, true); assert.deepEqual(r.after, r.before);
});
it('serializes the expected read and writes against a second native connection in the same security transaction', async () => {
	const r = await fixture.driver.evaluate(`(async()=>{
		const db=window.__yose_app.db;await db.putSecurityKeys({cas_slot:{v:1},delete_slot:{keep:true}},()=>true);
		const other=await new Promise((resolve,reject)=>{const q=indexedDB.open(db.db.name,db.db.version);q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);}),original=db.db.transaction.bind(db.db);let queued=false,foreign,seen;
		db.db.transaction=(...args)=>{const tx=original(...args);if(args[1]!=='readwrite')return tx;const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=objectStore(name);if(name!=='security_keys')return store;const get=store.get.bind(store);store.get=k=>{const q=get(k);q.addEventListener('success',()=>{if(queued)return;queued=true;foreign=new Promise((resolve,reject)=>{const t=other.transaction(['security_keys'],'readwrite'),s=t.objectStore('security_keys'),read=s.get('cas_slot');read.onsuccess=()=>{seen=read.result;s.put({v:3,foreign:true},'cas_slot');};t.oncomplete=resolve;t.onabort=()=>reject(t.error);});});return q;};return store;};return tx;};
		try{await db.putSecurityKeys({cas_slot:{v:2}},()=>true,{expectedSecurityKeys:{cas_slot:{exists:true,value:{v:1}}},deleteKeys:['delete_slot']});if(foreign)await foreign;return{queued,seen,actual:await db.getSecurityKey('cas_slot'),deleted:await db.getSecurityKey('delete_slot')};}finally{db.db.transaction=original;if(foreign)await foreign;other.close();}
	})()`);
	assert.equal(r.queued, true); assert.deepEqual(r.seen, { v: 2 }); assert.deepEqual(r.actual, { v: 3, foreign: true }); assert.equal(r.deleted, null);
});
it('permits exactly one of two concurrent native CAS batches to commit the same observed material', async () => {
	const r = await fixture.driver.evaluate(`(async()=>{
		const db=window.__yose_app.db,{YoseDB}=await import('/js/db.js'),second=await new YoseDB(indexedDB).init();await db.putSecurityKeys({cas_slot:{v:1},delete_slot:'keep'},()=>true);
		const before={business:await db.captureImportState(),settings:await db.getAllRaw('settings')},expected={cas_slot:{exists:true,value:{v:1}}};
		try{const outcomes=await Promise.allSettled([db.putSecurityKeys({cas_slot:{v:2,writer:'A'}},()=>true,{expectedSecurityKeys:expected,deleteKeys:['delete_slot']}),second.putSecurityKeys({cas_slot:{v:2,writer:'B'}},()=>true,{expectedSecurityKeys:expected})]);
			return{outcomes:outcomes.map(x=>x.status==='fulfilled'?{status:x.status}:{status:x.status,name:x.reason.name,code:x.reason.code}),value:await db.getSecurityKey('cas_slot'),deleted:await db.getSecurityKey('delete_slot'),before,after:{business:await db.captureImportState(),settings:await db.getAllRaw('settings')}};
		}finally{second.db.close();}
	})()`);
	assert.deepEqual(r.outcomes, [{ status: 'fulfilled' }, { status: 'rejected', name: 'SecurityKeyConflictError', code: 'SECURITY_KEYS_CHANGED' }]); assert.deepEqual(r.value, { v: 2, writer: 'A' }); assert.equal(r.deleted, null); assert.deepEqual(r.after, r.before);
});
for (const action of ['expire', 'abort']) it(`rejects a native readonly observation when its actual read ${action === 'expire' ? 'outlives the parent' : 'transaction aborts'}`, async () => {
	const r = await fixture.driver.evaluate(`(async()=>{
		const db=window.__yose_app.db;await db.putSecurityKeys({observed_slot:{v:1}},()=>true);if(typeof db.getSecurityKeyStates!=='function')return{missing:true};
		const raw=async()=>({business:await db.captureImportState(),settings:await db.getAllRaw('settings'),keys:await db.getAllRaw('security_keys')}),before=await raw(),original=db.db.transaction.bind(db.db);let parent=true,entered=false,error;
		db.db.transaction=(...args)=>{const tx=original(...args);if(args[1]!=='readonly'||!args[0].includes('security_keys'))return tx;const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const s=objectStore(name),get=s.get.bind(s);s.get=k=>{const q=get(k);q.addEventListener('success',()=>{if(entered)return;entered=true;${action === 'expire' ? 'parent=false;' : 'tx.abort();'}});return q;};return s;};return tx;};
		try{await db.getSecurityKeyStates(['observed_slot'],{isSessionValid:()=>parent});}catch(e){error=e.message;}finally{db.db.transaction=original;}return{entered,error,before,after:await raw()};
	})()`);
	assert.notEqual(r.missing, true, 'readonly presence API must exist'); assert.equal(r.entered, true); assert.ok(r.error); assert.deepEqual(r.after, r.before);
});
it('keeps the complete native batch uncommitted after an actual write transaction abort with a valid parent', async () => {
	const r = await fixture.driver.evaluate(`(async()=>{
		const db=window.__yose_app.db;await db.putSecurityKeys({abort_slot:{v:1},delete_slot:'keep'},()=>true);
		const raw=async()=>({business:await db.captureImportState(),settings:await db.getAllRaw('settings'),keys:await db.getAllRaw('security_keys')}),before=await raw(),original=db.db.transaction.bind(db.db);let entered=false,error;
		db.db.transaction=(...args)=>{const tx=original(...args);if(args[1]!=='readwrite')return tx;const objectStore=tx.objectStore.bind(tx);tx.objectStore=name=>{const s=objectStore(name),put=s.put.bind(s);s.put=(...a)=>{const q=put(...a);q.addEventListener('success',()=>{if(!entered){entered=true;tx.abort();}});return q;};return s;};return tx;};
		try{await db.putSecurityKeys({abort_slot:{v:2},added:'bad'},()=>true,{expectedSecurityKeys:{abort_slot:{exists:true,value:{v:1}}},deleteKeys:['delete_slot']});}catch(e){error=e.message;}finally{db.db.transaction=original;}return{entered,error,before,after:await raw()};
	})()`);
	assert.equal(r.entered, true); assert.ok(r.error); assert.deepEqual(r.after, r.before);
});
