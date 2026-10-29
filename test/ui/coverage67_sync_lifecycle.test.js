import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
describe('review67 native synchronization listener lifecycle', { timeout: 120000 }, () => {
	it('binds once, detaches once, and invokes only one automatic sync after repeated binding', async () => {
		const result = await fixture.driver.evaluate(`(async()=>{
			const app=window.__yose_app,manager=app.syncManager,before=await app.db.captureImportState(),originalSync=manager.syncBidirectional,addWindow=window.addEventListener.bind(window),removeWindow=window.removeEventListener.bind(window),addDocument=document.addEventListener.bind(document),removeDocument=document.removeEventListener.bind(document);
			const calls={onlineAdd:0,onlineRemove:0,visibilityAdd:0,visibilityRemove:0,sync:0};let pending=null;
			window.addEventListener=(type,...args)=>{if(type==='online')calls.onlineAdd++;return addWindow(type,...args);};window.removeEventListener=(type,...args)=>{if(type==='online')calls.onlineRemove++;return removeWindow(type,...args);};
			document.addEventListener=(type,...args)=>{if(type==='visibilitychange')calls.visibilityAdd++;return addDocument(type,...args);};document.removeEventListener=(type,...args)=>{if(type==='visibilitychange')calls.visibilityRemove++;return removeDocument(type,...args);};
			manager.syncBidirectional=()=>{calls.sync++;pending=Promise.resolve({status:'synced'});return pending;};
			try{
				manager.attachEventListeners();const duplicateInitial={...calls};manager.detachEventListeners();manager.detachEventListeners();const detached={...calls};
				manager.attachEventListeners();manager.attachEventListeners();const rebound={...calls};window.dispatchEvent(new Event('online'));await pending;const afterOnline={...calls};
				manager.detachEventListeners();manager.detachEventListeners();window.dispatchEvent(new Event('online'));return {duplicateInitial,detached,rebound,afterOnline,final:{...calls},before,after:await app.db.captureImportState()};
			}finally{manager.detachEventListeners();manager.syncBidirectional=originalSync;window.addEventListener=addWindow;window.removeEventListener=removeWindow;document.addEventListener=addDocument;document.removeEventListener=removeDocument;manager.attachEventListeners();}
		})()`);
		assert.deepEqual(result.duplicateInitial, { onlineAdd: 0, onlineRemove: 0, visibilityAdd: 0, visibilityRemove: 0, sync: 0 });
		assert.deepEqual(result.detached, { onlineAdd: 0, onlineRemove: 1, visibilityAdd: 0, visibilityRemove: 1, sync: 0 });
		assert.deepEqual(result.rebound, { onlineAdd: 1, onlineRemove: 1, visibilityAdd: 1, visibilityRemove: 1, sync: 0 });
		assert.equal(result.afterOnline.sync, 1); assert.deepEqual(result.final, { onlineAdd: 1, onlineRemove: 2, visibilityAdd: 1, visibilityRemove: 2, sync: 1 }); assert.deepEqual(result.after, result.before);
	});
});
