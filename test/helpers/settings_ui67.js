export const allRaw67 = d => d.evaluate(`(async()=>{
	const database=window.__yose_app.db.db,names=Array.from(database.objectStoreNames),tx=database.transaction(names,'readonly');
	const request=pending=>new Promise((resolve,reject)=>{pending.onsuccess=()=>resolve(pending.result);pending.onerror=()=>reject(pending.error);});
	return Promise.all(names.map(async name=>{const store=tx.objectStore(name),keys=request(store.getAllKeys()),values=request(store.getAll());return [name,{keys:await keys,values:await values}];}));
})()`);
