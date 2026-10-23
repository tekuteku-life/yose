import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow, records, waitForDialog } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
const renderMethod = list => list === 'month-tx-list' ? 'renderMonthTransactions' : 'renderRecentTransactions';

async function prepare(d, list = 'month-tx-list') {
	await seed(d, [transaction('pointer')]);
	await d.evaluate('window.__yose_app.txListController.renderRecentTransactions()');
	if (list === 'month-tx-list') await cashflow(d);
}

// Gate the final real IndexedDB read, preserving all original values and rendering code.
async function pendingRender(d, list) {
	await d.evaluate(`{
		const db = window.__yose_app.db, getMaster = db.getMasterConfig.bind(db), getTransactions = db.getTransactions.bind(db);
		window.__pointerReadReady = false; window.__pointerTransactionsReady = false; window.__pointerRenderDone = false;
		db.getTransactions = async (...args) => { const value = await getTransactions(...args); db.getTransactions = getTransactions; window.__pointerTransactionsReady = true; return value; };
		db.getMasterConfig = async (...args) => { const value = await getMaster(...args); db.getMasterConfig = getMaster; window.__pointerReadReady = true; await new Promise(resolve => window.__releasePointerRead = resolve); return value; };
		window.__yose_app.txListController.${renderMethod(list)}().then(() => window.__pointerRenderDone = true);
		void 0;
	}`);
	await d.waitFor('window.__pointerReadReady && window.__pointerTransactionsReady');
}

async function point(d, list, deletion = false) {
	return d.evaluate(`(() => {
		window.__pressedRow = document.querySelector('#${list} [data-id="pointer"]');
		const target = ${deletion ? "window.__pressedRow.querySelector('.btn-delete-tx')" : 'window.__pressedRow'};
		target.scrollIntoView({ block: 'center', behavior: 'instant' });
		const rect = target.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
	})()`);
}

const mouse = (d, type, position) => d.send('Input.dispatchMouseEvent', { type, ...position, button: 'left', clickCount: 1 }, d.sessionId);

describe('List rendering during pointer operations', () => {
	for (const list of ['month-tx-list', 'recent-tx-list']) it(`preserves the pressed row in ${list} and opens the latest stored transaction`, async () => {
		const d = fixture.driver; await prepare(d, list);
		await d.evaluate(`(async () => { const db=window.__yose_app.db, tx=await db.getTransaction('pointer'); await db.putTransaction({...tx, amount:400}); })()`);
		await pendingRender(d, list);
		const position = await point(d, list);
		await mouse(d, 'mousePressed', position);
		await d.evaluate('window.__releasePointerRead()');
		assert.equal(await d.evaluate('window.__pressedRow.isConnected'), true, 'render must retain the actual pressed node until click dispatch finishes');
		assert.equal(await d.evaluate('window.__pointerRenderDone'), false);
		await mouse(d, 'mouseReleased', position);
		await d.waitFor('window.__pointerRenderDone && document.getElementById("modal-edit-tx").classList.contains("active") && document.getElementById("edit-tx-amount").value === "400"');
		assert.equal((await records(d))[0].amount, 400);
	});
	it('keeps the delete button through redraw and performs deletion once without opening the editor', async () => {
		const d = fixture.driver; await prepare(d); await pendingRender(d, 'month-tx-list');
		const position = await point(d, 'month-tx-list', true);
		await mouse(d, 'mousePressed', position); await d.evaluate('window.__releasePointerRead()');
		assert.equal(await d.evaluate('window.__pressedRow.isConnected'), true);
		await mouse(d, 'mouseReleased', position); await waitForDialog(d, '削除しますか');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransaction("pointer")).is_deleted)()');
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
		assert.equal((await d.evaluate('window.__dialogs')).filter(dialog => dialog.message.includes('削除しますか')).length, 1);
	});
	for (const release of ['outside', 'cancel', 'blur']) it(`finishes the pending render after ${release} without synthesizing a row click`, async () => {
		const d = fixture.driver; await prepare(d); await pendingRender(d, 'month-tx-list');
		const position = await point(d, 'month-tx-list');
		if (release === 'cancel') await d.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...position, id: 1 }] }, d.sessionId);
		else await mouse(d, 'mousePressed', position);
		await d.evaluate('window.__releasePointerRead()');
		assert.equal(await d.evaluate('window.__pressedRow.isConnected'), true);
		if (release === 'cancel') await d.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }, d.sessionId);
		else if (release === 'outside') await mouse(d, 'mouseReleased', { x: 1, y: 1 });
		else { await d.evaluate('window.dispatchEvent(new Event("blur"))'); await mouse(d, 'mouseReleased', { x: 1, y: 1 }); }
		await d.waitFor('window.__pointerRenderDone');
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
		assert.equal((await records(d)).length, 1);
	});
	it('waits for every active touch before applying the pending list', async () => {
		const d = fixture.driver; await prepare(d); await pendingRender(d, 'month-tx-list');
		const position = await point(d, 'month-tx-list');
		const first = { x: position.x - 10, y: position.y, id: 1 }, second = { x: position.x + 10, y: position.y, id: 2 };
		await d.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first, second] }, d.sessionId);
		await d.evaluate('window.__releasePointerRead()');
		await d.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [second] }, d.sessionId);
		assert.equal(await d.evaluate('window.__pressedRow.isConnected && !window.__pointerRenderDone'), true);
		await d.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }, d.sessionId);
		await d.waitFor('window.__pointerRenderDone');
	});
	it('invalidates pending lists on lock and renders afresh after unlocking', async () => {
		const d = fixture.driver; await prepare(d); await pendingRender(d, 'month-tx-list');
		const position = await point(d, 'month-tx-list'); await mouse(d, 'mousePressed', position);
		await d.evaluate('window.__releasePointerRead()');
		assert.equal(await d.evaluate('window.__pressedRow.isConnected'), true);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		await d.waitFor('window.__pointerRenderDone && !document.getElementById("auth-screen").classList.contains("hidden")');
		assert.equal(await d.evaluate('window.__pressedRow.isConnected'), true, 'an invalidated result must not write its DOM after lock');
		await mouse(d, 'mouseReleased', { x: 1, y: 1 });
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		await cashflow(d);
		assert.match(await d.textContent('#month-tx-list'), /pointer/);
	});
	for (const list of ['month-tx-list', 'recent-tx-list']) it(`applies only the newest requested data after a pending pointer operation in ${list}`, async () => {
		const d = fixture.driver; await prepare(d, list); await pendingRender(d, list);
		const position = await point(d, list); await mouse(d, 'mousePressed', position);
		await d.evaluate('window.__releasePointerRead()');
		await d.evaluate(`(async () => { const app=window.__yose_app, tx=await app.db.getTransaction('pointer'); await app.db.putTransaction({...tx,amount:700}); window.__latestPointerRenderDone=false; app.txListController.${renderMethod(list)}().then(()=>window.__latestPointerRenderDone=true); })()`);
		await mouse(d, 'mouseReleased', { x: 1, y: 1 });
		await d.waitFor('window.__latestPointerRenderDone && window.__pointerRenderDone');
		assert.match(await d.textContent('#' + list), /700/);
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
	});
	for (const list of ['month-tx-list', 'recent-tx-list']) it(`does not roll back a completed newer render when an older read finishes in ${list}`, async () => {
		const d = fixture.driver; await prepare(d, list); await pendingRender(d, list);
		await d.evaluate(`(async () => { const app=window.__yose_app, tx=await app.db.getTransaction('pointer'); await app.db.putTransaction({...tx,amount:700}); await app.txListController.${renderMethod(list)}(); })()`);
		assert.match(await d.textContent('#' + list), /700/);
		await d.evaluate('window.__releasePointerRead()'); await d.waitFor('window.__pointerRenderDone');
		assert.match(await d.textContent('#' + list), /700/);
	});
	for (const list of ['month-tx-list', 'recent-tx-list']) it(`keeps a pressed row until an empty result can be applied in ${list}`, async () => {
		const d = fixture.driver; await prepare(d, list);
		await d.evaluate(`(async () => { const db=window.__yose_app.db, tx=await db.getTransaction('pointer'); await db.putTransaction({...tx,is_deleted:true}); })()`);
		await pendingRender(d, list);
		const position = await point(d, list); await mouse(d, 'mousePressed', position);
		await d.evaluate('window.__releasePointerRead()');
		assert.equal(await d.evaluate('window.__pressedRow.isConnected'), true);
		await mouse(d, 'mouseReleased', { x: 1, y: 1 }); await d.waitFor('window.__pointerRenderDone');
		assert.match(await d.textContent('#' + list), /取引はありません|まだ入力はありません/);
		assert.equal(await d.evaluate(`document.querySelectorAll('#${list} .tx-item').length`), 0);
	});
	it('rechecks a new press when the previous release timer runs', async () => {
		const d = fixture.driver; await prepare(d); await pendingRender(d, 'month-tx-list');
		await d.evaluate(`window.__heldPointerTimers=[]; window.__holdPointerTimers=true; window.__realPointerTimeout=window.setTimeout.bind(window); window.setTimeout=(callback,delay,...args)=>window.__realPointerTimeout(delay===0&&window.__holdPointerTimers?()=>window.__heldPointerTimers.push(()=>callback(...args)):callback,delay,...args);`);
		const position = await point(d, 'month-tx-list'); await mouse(d, 'mousePressed', position);
		await d.evaluate('window.__releasePointerRead()');
		await mouse(d, 'mouseReleased', { x: 1, y: 1 });
		await d.waitFor('window.__heldPointerTimers.length > 0');
		await mouse(d, 'mousePressed', position);
		await d.evaluate('window.__heldPointerTimers.splice(0).forEach(run=>run())');
		assert.equal(await d.evaluate('window.__pressedRow.isConnected && !window.__pointerRenderDone'), true);
		await d.evaluate('window.__holdPointerTimers=false; window.setTimeout=window.__realPointerTimeout; void 0;');
		await mouse(d, 'mouseReleased', { x: 1, y: 1 }); await d.waitFor('window.__pointerRenderDone');
	});
	it('does not open a record deleted while its old row is still pressed', async () => {
		const d = fixture.driver; await prepare(d); await pendingRender(d, 'month-tx-list');
		await d.evaluate(`const editor=window.__yose_app.txEditController, open=editor.openEditTransactionModal.bind(editor); window.__deletedOpenStarted=false; window.__deletedOpenDone=false; editor.openEditTransactionModal=async(...args)=>{window.__deletedOpenStarted=true;try{return await open(...args);}finally{window.__deletedOpenDone=true;}}; void 0;`);
		const position = await point(d, 'month-tx-list'); await mouse(d, 'mousePressed', position);
		await d.evaluate('window.__releasePointerRead()');
		await d.evaluate(`(async () => { const db=window.__yose_app.db, tx=await db.getTransaction('pointer'); await db.putTransaction({...tx,is_deleted:true}); })()`);
		await mouse(d, 'mouseReleased', position);
		await d.waitFor('window.__pointerRenderDone && window.__deletedOpenStarted && window.__deletedOpenDone');
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
		assert.equal((await records(d))[0].is_deleted, true);
	});
});
