import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
const state = d => d.evaluate(`({memo:document.querySelector('#input-memo').value,category:document.querySelector('#select-category').value,child:document.querySelector('#select-subcategory').value,actual:document.querySelector('#select-actual-category').value,actualChild:document.querySelector('#select-actual-subcategory').value})`);
async function setup(d) {
	await seed(d, [transaction('memo-history', { memo: 'OLD_MEMO', subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries' })]);
	await d.evaluate(`(async()=>{
		const app=window.__yose_app,c=app.txInputController;
		await c.updateTagAndMemoSuggestions();
		const direct=c.handleMemoChange,callback=c.tagMemoInput.onMemoChange,finish=app.finishAppInit;
		window.__memoJobs=[];window.__memoRoutes=[];
		const record=value=>{window.__memoRoutes.push(typeof value==='string'?'string':'event');const pending=direct(value);window.__memoJobs.push(pending);return pending;};
		c.handleMemoChange=record;c.tagMemoInput.onMemoChange=record;
		app.finishAppInit=(...args)=>window.__memoNewInit=finish.apply(app,args);
		window.__restoreMemoCase=()=>{c.handleMemoChange=direct;c.tagMemoInput.onMemoChange=callback;app.finishAppInit=finish;if(window.__memoOriginalRead)app.db.getMasterConfig=window.__memoOriginalRead;if(window.__memoOriginalSub)c.updateSubcategories=window.__memoOriginalSub;};
	})()`);
	await setHousing(d);
}
async function setHousing(d) {
	if (await d.evaluate('document.querySelector("#chk-sync-actual-category").checked')) await d.click('#chk-sync-actual-category');
	for (const [parent, child] of [['#select-category', '#select-subcategory'], ['#select-actual-category', '#select-actual-subcategory']]) {
		await d.select(parent, 'cat_housing');
		await d.waitFor(`[...document.querySelector(${JSON.stringify(child)}).options].some(o=>o.value==='sub_rent')`);
		await d.select(child, 'sub_rent');
	}
	await d.click('#chk-sync-actual-category');
}
async function trigger(d, route = 'string') {
	if (route === 'string') await d.fill('#input-memo', 'OLD_MEMO');
	else await d.evaluate(`{
		const input=document.querySelector('#input-memo');input.value='OLD_MEMO';
		input.addEventListener('test-memo-change',event=>window.__yose_app.txInputController.handleMemoChange(event),{once:true});
		input.dispatchEvent(new Event('test-memo-change',{bubbles:true}));
	}`);
}
async function settle(d) { await d.evaluate('(async()=>{await Promise.all(window.__memoJobs);})()'); }
async function holdMaster(d, reject = false) {
	await d.evaluate(`{
		const app=window.__yose_app;window.__memoOriginalRead=app.db.getMasterConfig;const read=app.db.getMasterConfig.bind(app.db);let once=true;
		app.db.getMasterConfig=async(...args)=>{const config=await read(...args);if(once){once=false;await new Promise(resolve=>window.__releaseMemo=resolve);${reject ? "throw new Error('OLD_MEMO_READ_FAILURE');" : ''}}return config;};
	}`);
}
async function unlockNewSession(d) {
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
	await d.waitFor('!window.__yose_app.isKeyLocked && Boolean(window.__memoNewInit)');
	await d.evaluate('window.__memoNewInit');
	await setHousing(d); await d.fill('#input-memo', 'NEW_MEMO');
}
function memoCase(name, run) {
	it(name, async () => {
		const d = fixture.driver; await setup(d);
		try { await run(d); }
		finally { await d.evaluate('(async()=>{window.__releaseMemo?.();await Promise.all(window.__memoJobs);window.__restoreMemoCase();})()'); }
	});
}

for (const route of ['string', 'event']) memoCase(`applies ordinary memo history through the real ${route} callback path`, async d => {
	await trigger(d, route); await settle(d);
	assert.ok((await d.evaluate('window.__memoRoutes')).includes(route));
	assert.deepEqual(await state(d), { memo: 'OLD_MEMO', category: 'cat_food', child: 'sub_groceries', actual: 'cat_food', actualChild: 'sub_groceries' });
});

for (const route of ['string', 'event']) memoCase(`drops a delayed ${route} memo history after real lock/unlock without replacing new input`, async d => {
	await holdMaster(d); await trigger(d, route);
	await d.waitFor('typeof window.__releaseMemo==="function"');
	await unlockNewSession(d); const expected = await state(d);
	await d.evaluate('window.__releaseMemo()'); await settle(d);
	assert.deepEqual(await state(d), expected);
	assert.deepEqual(expected, { memo: 'NEW_MEMO', category: 'cat_housing', child: 'sub_rent', actual: 'cat_housing', actualChild: 'sub_rent' });
});

for (const child of ['select-subcategory', 'select-actual-subcategory']) memoCase(`keeps the originating memo session across the awaited ${child} refresh`, async d => {
	await d.evaluate(`{
		const c=window.__yose_app.txInputController;window.__memoOriginalSub=c.updateSubcategories;const update=c.updateSubcategories.bind(c);let once=true;
		c.updateSubcategories=async(...args)=>{const result=await update(...args);if(once&&args[1]===${JSON.stringify(child)}){once=false;window.__heldMemoChildGuard=args[4]?.isSessionValid;window.__heldMemoChildBefore=window.__heldMemoChildGuard?.();await new Promise(resolve=>window.__releaseMemo=resolve);}return result;};
	}`);
	await trigger(d); await d.waitFor('typeof window.__releaseMemo==="function"');
	await unlockNewSession(d); const expected = await state(d);
	await d.evaluate('window.__releaseMemo()'); await settle(d);
	assert.deepEqual(await state(d), expected);
	assert.equal(await d.evaluate('typeof window.__heldMemoChildGuard'), 'function');
	assert.equal(await d.evaluate('window.__heldMemoChildBefore'), true);
	assert.equal(await d.evaluate('window.__heldMemoChildGuard()'), false);
});

memoCase('does not apply an older string callback after the current memo and classifications change within one session', async d => {
	await holdMaster(d); await trigger(d); await d.waitFor('typeof window.__releaseMemo==="function"');
	await d.fill('#input-memo', 'NEW_MEMO'); await setHousing(d);
	const expected = await state(d);
	await d.evaluate('window.__releaseMemo()'); await settle(d);
	assert.deepEqual(await state(d), expected);
});

memoCase('suppresses an old memo read rejection after a new authentication session becomes active', async d => {
	await holdMaster(d, true); await trigger(d); await d.waitFor('typeof window.__releaseMemo==="function"');
	await unlockNewSession(d); const expected = await state(d);
	await d.evaluate('window.__dialogs=[];window.__releaseMemo()'); await settle(d);
	assert.deepEqual(await state(d), expected);
	assert.deepEqual(await d.evaluate('window.__dialogs.filter(d=>d.message.includes("OLD_MEMO_READ_FAILURE"))'), []);
});

memoCase('still reports a memo read failure belonging to the current session', async d => {
	await d.evaluate('window.__memoOriginalRead=window.__yose_app.db.getMasterConfig;window.__yose_app.db.getMasterConfig=async()=>{throw new Error("CURRENT_MEMO_READ_FAILURE");};');
	await trigger(d); await settle(d);
	assert.ok(await d.evaluate('window.__dialogs.some(d=>d.message.includes("CURRENT_MEMO_READ_FAILURE"))'));
});
