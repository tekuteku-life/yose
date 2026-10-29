import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
const cases = [
	{ name: 'input accounting category', selector: '#select-category', owner: 'txInputController', method: 'updateSubcategories', read: 'getMasterConfig' },
	{ name: 'input actual category', selector: '#select-actual-category', owner: 'txInputController', method: 'updateSubcategories', read: 'getMasterConfig', actual: true },
	{ name: 'edit accounting category', selector: '#edit-tx-category', owner: 'txInputController', method: 'updateSubcategories', read: 'getMasterConfig', edit: true },
	{ name: 'edit actual category', selector: '#edit-tx-actual-category', owner: 'txInputController', method: 'updateSubcategories', read: 'getMasterConfig', edit: true, actual: true },
	{ name: 'edit transaction type', selector: '#edit-tx-type', owner: 'txEditController', method: 'populateTypeCategories', read: 'getMasterConfig', edit: true, editType: true },
	{ name: 'new master account', selector: '#btn-add-account', owner: 'masterController', method: 'openMasterModal', read: 'getMasterConfig', click: true, master: true },
	{ name: 'settings tab', selector: '.tab-btn[data-tab="tab-settings"]', owner: 'settingsController', method: 'renderSettings', read: 'getMasterConfig', tab: true },
	{ name: 'cashflow tab', selector: '.tab-btn[data-analytics-target="cashflow"]', owner: 'summaryController', method: 'renderSummary', read: 'getAnalyticsState', tab: true, summary: true }
];

async function nativeDown(d, selector) {
	await d.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
	for (const type of ['keyDown', 'keyUp']) await d.send('Input.dispatchKeyEvent', { type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 }, d.sessionId);
}

async function prepare(d, spec) {
	if (spec.master) {
		await d.click('.tab-btn[data-tab="tab-settings"]');
		await d.waitFor('document.querySelector("#master-accounts-list .master-item-row")');
	}
	if (spec.edit) {
		await seed(d, [transaction('native-edit')]); await cashflow(d);
		await d.click('#month-tx-list .tx-item[data-id="native-edit"]');
		await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-id").value==="native-edit"');
	}
	if (spec.actual) {
		const checkbox = spec.edit ? '#edit-chk-sync-actual-category' : '#chk-sync-actual-category';
		if (await d.evaluate(`document.querySelector(${JSON.stringify(checkbox)}).checked`)) await d.click(checkbox);
	}
	if (!spec.tab && !spec.click) await d.evaluate(`document.querySelector(${JSON.stringify(spec.selector)}).selectedIndex=0`);
}

async function installNativeGate(d, spec) {
	await d.evaluate(`(()=>{
		const app=window.__yose_app,owner=app[${JSON.stringify(spec.owner)}],name=${JSON.stringify(spec.method)},readName=${JSON.stringify(spec.read)};
		const target=owner[name],read=app.db[readName],decrypt=crypto.subtle.decrypt,finish=app.finishAppInit;
		let once=true,armed=false,invocation=0;
		window.__nativeJobs=[];window.__nativeSuccess=[];window.__nativeUnhandled=[];window.__nativeTrusted=[];
		const unhandled=event=>window.__nativeUnhandled.push(event.reason?.message||String(event.reason));
		window.addEventListener('unhandledrejection',unhandled);
		const control=document.querySelector(${JSON.stringify(spec.selector)}),eventType=${spec.tab || spec.click ? "'click'" : "'change'"};
		const trusted=event=>window.__nativeTrusted.push(event.isTrusted);control.addEventListener(eventType,trusted);
		app.db.setEncryptionKey(app.db.encryptionKey);
		// Force the selected real DB read cold, even if preceding metadata reused its master.
		app.db[readName]=function(...args){if(once){app.db.decryptedRecords.clear();armed=true;}return read.apply(this,args);};
		crypto.subtle.decrypt=async function(...args){const value=await decrypt.apply(this,args);if(once&&armed){once=false;armed=false;await new Promise(resolve=>window.__nativeRelease=resolve);}return value;};
		owner[name]=function(...args){
			const index=invocation++;
			// No rejection handler: native callers still expose genuine unhandled errors.
			const pending=target.apply(this,args).then(value=>{window.__nativeSuccess.push(index);return value;});
			window.__nativeJobs.push(pending);return pending;
		};
		app.finishAppInit=function(...args){const pending=finish.apply(this,args);window.__nativeInit=pending;return pending;};
		window.__nativeRestore=()=>{owner[name]=target;app.db[readName]=read;crypto.subtle.decrypt=decrypt;app.finishAppInit=finish;window.removeEventListener('unhandledrejection',unhandled);control.removeEventListener(eventType,trusted);};
	})()`);
}

async function unlock(d) {
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
	await d.waitFor('!window.__yose_app.isKeyLocked&&Boolean(window.__nativeInit)');
	await d.evaluate('window.__nativeInit');
}

async function newState(d, spec) {
	if (spec.master) {
		await d.click('.tab-btn[data-tab="tab-settings"]');
		await d.click('#btn-add-account');
		await d.waitFor('document.querySelector("#modal-master-item").classList.contains("active")&&window.__nativeSuccess.some(index=>index>0)');
		await d.fill('#m-acc-name', 'NEW_NATIVE_MASTER');
		return currentState(d, spec);
	}
	if (spec.editType) {
		await cashflow(d); await d.click('#month-tx-list .tx-item[data-id="native-edit"]');
		await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-id").value==="native-edit"');
		await d.fill('#edit-tx-memo', 'NEW_NATIVE_EDIT');
		return currentState(d, spec);
	}
	if (spec.summary) {
		await d.click('#btn-period-next');
		await d.waitFor('document.querySelector("#period-display").textContent.includes("2026-11")&&window.__nativeSuccess.some(index=>index>0)');
		return d.evaluate('({month:window.__yose_app.currentMonth,period:document.querySelector("#period-display").textContent})');
	}
	if (spec.tab) {
		await d.fill('#input-gas-url', 'https://new-session.example/exec');
		await d.select('#select-point-offset-category', 'cat_income_main');
		return d.evaluate('({url:document.querySelector("#input-gas-url").value,parent:document.querySelector("#select-point-offset-category").value,child:document.querySelector("#select-point-offset-subcategory").value})');
	}
	await d.click('.tab-btn[data-tab="tab-input"]');
	await d.fill('#input-memo', 'NEW_NATIVE_SESSION');
	await d.select('#select-category', 'cat_housing');
	await d.waitFor('[...document.querySelector("#select-subcategory").options].some(option=>option.value==="sub_rent")');
	await d.select('#select-subcategory', 'sub_rent');
	if (await d.evaluate('document.querySelector("#chk-sync-actual-category").checked')) await d.click('#chk-sync-actual-category');
	await d.select('#select-actual-category', 'cat_housing');
	await d.waitFor('[...document.querySelector("#select-actual-subcategory").options].some(option=>option.value==="sub_rent")');
	await d.select('#select-actual-subcategory', 'sub_rent');
	return d.evaluate('({memo:document.querySelector("#input-memo").value,parent:document.querySelector("#select-category").value,child:document.querySelector("#select-subcategory").value,actualParent:document.querySelector("#select-actual-category").value,actualChild:document.querySelector("#select-actual-subcategory").value})');
}

async function currentState(d, spec) {
	if (spec.master) return d.evaluate('({active:document.querySelector("#modal-master-item").classList.contains("active"),title:document.querySelector("#master-modal-title").textContent,id:document.querySelector("#m-acc-id").value,name:document.querySelector("#m-acc-name").value})');
	if (spec.editType) return d.evaluate('({id:document.querySelector("#edit-tx-id").value,type:document.querySelector("#edit-tx-type").value,memo:document.querySelector("#edit-tx-memo").value,parent:document.querySelector("#edit-tx-category").value,child:document.querySelector("#edit-tx-subcategory").value,actualParent:document.querySelector("#edit-tx-actual-category").value,actualChild:document.querySelector("#edit-tx-actual-subcategory").value})');
	if (spec.summary) return d.evaluate('({month:window.__yose_app.currentMonth,period:document.querySelector("#period-display").textContent})');
	if (spec.tab) return d.evaluate('({url:document.querySelector("#input-gas-url").value,parent:document.querySelector("#select-point-offset-category").value,child:document.querySelector("#select-point-offset-subcategory").value})');
	return d.evaluate('({memo:document.querySelector("#input-memo").value,parent:document.querySelector("#select-category").value,child:document.querySelector("#select-subcategory").value,actualParent:document.querySelector("#select-actual-category").value,actualChild:document.querySelector("#select-actual-subcategory").value})');
}

async function cleanup(d) {
	await d.evaluate('window.__nativeRelease?.()');
	// Only teardown attaches rejection handlers, after the native completion assertions.
	try { await d.evaluate('(async()=>{let count=-1;while(count!==window.__nativeJobs.length){count=window.__nativeJobs.length;await Promise.allSettled(window.__nativeJobs);}})()'); }
	finally { await d.evaluate('window.__nativeRestore?.()'); }
}

for (const spec of [...cases, { ...cases[0], name: 'input category after same-key generation reset', sameKey: true }]) it(`ignores an expired native ${spec.name} AES read without an unhandled rejection or new-session overwrite`, async () => {
	const d = fixture.driver; await prepare(d, spec); await installNativeGate(d, spec);
	try {
		if (spec.tab || spec.click) await d.click(spec.selector); else await nativeDown(d, spec.selector);
		await d.waitFor('typeof window.__nativeRelease==="function"');
		assert.ok(await d.evaluate('window.__nativeTrusted.includes(true)'), 'the real native event must enter the product listener');
		if (spec.sameKey) await d.evaluate('window.__yose_app.db.setEncryptionKey(window.__yose_app.db.encryptionKey)');
		else await unlock(d);
		const expected = await newState(d, spec);
		const dialogs = await d.evaluate('window.__dialogs.length');
		await d.evaluate('window.__nativeRelease()');
		await d.waitFor(`window.__nativeSuccess.includes(0)||window.__nativeUnhandled.length>0||window.__dialogs.length>${dialogs}`);
		assert.deepEqual(await d.evaluate('window.__nativeUnhandled'), []);
		assert.deepEqual(d.pageErrors, []);
		assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
		assert.ok(await d.evaluate('window.__nativeSuccess.includes(0)'), 'the expired real leaf must settle successfully');
		assert.deepEqual(await currentState(d, spec), expected);
	} finally { await cleanup(d); }
});

it('still applies an active native category change and its real child read', async () => {
	const d = fixture.driver;
	await d.evaluate('window.__activeNativeChange=false;document.querySelector("#select-category").selectedIndex=0;document.querySelector("#select-category").addEventListener("change",event=>window.__activeNativeChange=event.isTrusted,{once:true})');
	const next = await d.evaluate('document.querySelector("#select-category").options[1].value');
	const children = await d.evaluate(`(async()=>{const config=await window.__yose_app.db.getMasterConfig();return config.categories.find(category=>category.id===${JSON.stringify(next)}).subcategories.filter(child=>!child.is_archived).map(child=>child.id);})()`);
	await nativeDown(d, '#select-category');
	await d.waitFor(`window.__activeNativeChange&&document.querySelector('#select-category').value===${JSON.stringify(next)}&&Boolean([...document.querySelector('#select-subcategory').options].find(option=>option.value===${JSON.stringify(children[0])}))`);
	assert.equal(await d.evaluate('document.querySelector("#select-category").value'), next);
	assert.deepEqual(await d.evaluate('[...document.querySelector("#select-subcategory").options].map(option=>option.value).filter(Boolean)'), children);
});

for (const axis of ['accounting', 'actual', 'type']) it(`does not apply an old native edit ${axis} read to a reopened same-parent transaction in the same authentication session`, async () => {
	const d = fixture.driver;
	await seed(d, [transaction('same-session-a', { category_id: 'cat_housing', subcategory_id: 'sub_rent', actual_category_id: 'cat_housing', actual_subcategory_id: 'sub_rent' }), transaction('same-session-b', { category_id: 'cat_food', subcategory_id: 'sub_dining_out', actual_category_id: 'cat_food', actual_subcategory_id: 'sub_dining_out' })]);
	const raw = await d.evaluate('Promise.all(["same-session-a","same-session-b"].map(id=>window.__yose_app.db.getRaw("transactions",id)))');
	await cashflow(d); await d.click('#month-tx-list .tx-item[data-id="same-session-a"]');
	await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-id").value==="same-session-a"');
	if (axis === 'actual') await d.click('#edit-chk-sync-actual-category');
	const selector = axis === 'type' ? '#edit-tx-type' : axis === 'actual' ? '#edit-tx-actual-category' : '#edit-tx-category';
	await d.evaluate(`(()=>{
		const app=window.__yose_app,owner=${axis === 'type' ? 'app.txEditController' : 'app.txInputController'},name=${JSON.stringify(axis === 'type' ? 'populateTypeCategories' : 'updateSubcategories')},original=owner[name],read=app.db.getMasterConfig;
		let once=true,armed=false;window.__sameEditJobs=[];window.__sameEditTrusted=false;
		const control=document.querySelector(${JSON.stringify(selector)});control.selectedIndex=${axis === 'type' ? 0 : -1};
		const trusted=event=>window.__sameEditTrusted=event.isTrusted;control.addEventListener('change',trusted);
		owner[name]=function(...args){if(once&&${axis === 'type' ? 'true' : `args[1]===${JSON.stringify(axis === 'actual' ? 'edit-tx-actual-subcategory' : 'edit-tx-subcategory')}`})armed=true;const pending=original.apply(this,args);window.__sameEditJobs.push(pending);return pending;};
		app.db.getMasterConfig=async function(...args){const value=await read.apply(this,args);if(once&&armed){once=false;await new Promise(resolve=>window.__sameEditRelease=resolve);}return value;};
		window.__sameEditSession={auth:app.authController.authGeneration,key:app.db.keyGeneration};
		window.__sameEditRestore=()=>{owner[name]=original;app.db.getMasterConfig=read;control.removeEventListener('change',trusted);};
	})()`);
	try {
		await nativeDown(d, selector); await d.waitFor('typeof window.__sameEditRelease==="function"');
		assert.equal(await d.evaluate('window.__sameEditTrusted'), true);
		await d.click('#btn-close-edit-tx'); await d.click('#month-tx-list .tx-item[data-id="same-session-b"]');
		await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active")&&document.querySelector("#edit-tx-id").value==="same-session-b"&&document.querySelector("#edit-tx-subcategory").value==="sub_dining_out"&&document.querySelector("#edit-tx-actual-subcategory").value==="sub_dining_out"');
		await d.fill('#edit-tx-memo', 'NEW_SAME_AUTH_DRAFT');
		const expected = await d.evaluate('window.__yose_app.txEditController.captureValues()');
		const dialogs = await d.evaluate('window.__dialogs.length');
		await d.evaluate('window.__sameEditRelease()'); await d.evaluate('window.__sameEditJobs[0]');
		assert.deepEqual(await d.evaluate('({auth:window.__yose_app.authController.authGeneration,key:window.__yose_app.db.keyGeneration})'), await d.evaluate('window.__sameEditSession'));
		assert.equal(await d.evaluate('document.querySelector("#modal-edit-tx").classList.contains("active")'), true);
		assert.equal(await d.evaluate('window.__yose_app.txEditController.captureValues()'), expected);
		assert.deepEqual(await d.evaluate('Promise.all(["same-session-a","same-session-b"].map(id=>window.__yose_app.db.getRaw("transactions",id)))'), raw);
		assert.deepEqual(await d.evaluate(`window.__dialogs.slice(${dialogs})`), []);
	} finally {
		await d.evaluate('window.__sameEditRelease?.()');
		try { await d.evaluate('(async()=>{let count=-1;while(count!==window.__sameEditJobs.length){count=window.__sameEditJobs.length;await Promise.allSettled(window.__sameEditJobs);}})()'); }
		finally { await d.evaluate('window.__sameEditRestore()'); }
	}
});
