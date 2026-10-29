import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, settings, value } from '../helpers/ui_fixture.js';
import { flushWorkflow, rawWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
for (const archived of ['parent', 'child']) uiCase67(fixture, `identifies an archived point-default ${archived} as the current unavailable choice and recovers through an explicit valid selection`, async d => {
	await d.evaluate(`window.__yose_app.db.mutateMasterConfig(config=>{const parent=config.categories.find(item=>item.id===config.point_payment_defaults.category_id);${archived === 'parent' ? 'parent.is_archived=true;' : 'parent.subcategories.find(item=>item.id===config.point_payment_defaults.subcategory_id).is_archived=true;'}})`);
	const before = await rawWorkflow(d); await settings67(d);
	const selected = await d.evaluate(`(()=>{const option=document.querySelector(${JSON.stringify(archived === 'parent' ? '#select-point-offset-category' : '#select-point-offset-subcategory')}).selectedOptions[0];return {disabled:option.disabled,text:option.textContent};})()`);
	assert.equal(selected.disabled, true); assert.match(selected.text, /アーカイブ済み.*現在値/); assert.deepEqual(await rawWorkflow(d), before);
	await d.select('#select-point-offset-category', 'cat_income_main'); await d.click('#btn-save-point-defaults'); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).point_payment_defaults)()'), { category_id: 'cat_income_main', subcategory_id: null });
});
uiCase67(fixture, 'cancels a forced cache reload without navigating, clearing caches or changing encrypted data', async d => {
	await settings67(d); await d.evaluate('(async()=>{window.__cacheCancel67=true;const cache=await caches.open("yose67-cancel-kept");await cache.put("/cache-cancel67.txt",new Response("CACHE_CONTENT_67"));})()'); const before = await rawWorkflow(d);
	await d.setConfirm(false); await d.click('#btn-force-cache-clear'); await flushWorkflow(d);
	assert.equal(await d.evaluate('window.__cacheCancel67'), true); assert.equal(await d.evaluate('window.__yose_app.allowNavigation'), false); assert.deepEqual(await rawWorkflow(d), before);
	assert.ok((await d.evaluate('caches.keys()')).includes('yose67-cancel-kept'));
	assert.equal(await d.evaluate('(async()=>{const cached=await caches.match("/cache-cancel67.txt");return cached?cached.text():null;})()'), 'CACHE_CONTENT_67');
});
uiCase67(fixture, 'closes an offered update through its header control while retaining the current page and data', async d => {
	await settings67(d); const before = await rawWorkflow(d); d.responses.set('/version.json', { json: { version: '99.0.0' } });
	await d.click('#btn-check-app-update'); await d.waitFor('document.querySelector("#modal-app-update").classList.contains("active")');
	await d.click('#btn-close-app-update-modal'); assert.equal(await d.isVisible('#modal-app-update'), false); assert.deepEqual(await rawWorkflow(d), before);
});
it('performs an explicitly approved version update through the real reload while keeping every financial and PIN-key record', async () => {
	const d = fixture.driver; await seed(d, [transaction('reload-kept67', { sync_status: 'synced' })]); await settings(d); await d.evaluate('window.__yose_app.settingsController.renderSettings()');
	const before = await rawWorkflow(d), keys = await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")');
	await d.evaluate('window.__oldVersionDocument67=true'); d.responses.set('/version.json', { json: { version: '99.0.0' } });
	await d.click('#btn-check-app-update'); await d.waitFor('document.querySelector("#modal-app-update").classList.contains("active")');
	await d.click('#btn-confirm-app-update');
	await d.waitFor('!window.__oldVersionDocument67&&window.__yose_app?.db?.db&&document.querySelector("#auth-pin-container").style.display==="block"');
	assert.equal(await d.evaluate('sessionStorage.getItem("yose_update_attempted_version")'), '99.0.0');
	assert.deepEqual(await rawWorkflow(d), before); assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("security_keys")'), keys);
	await d.evaluate('(()=>{const app=window.__yose_app,init=app.finishAppInit;app.finishAppInit=function(...args){const pending=init.apply(this,args);window.__versionReady67=pending;return pending;};})()');
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.waitFor('Boolean(window.__versionReady67)'); await d.evaluate('window.__versionReady67');
	assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getTransaction("reload-kept67")).amount)()'), 100);
});
