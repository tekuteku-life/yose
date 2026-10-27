import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
async function open(d) {
	await seed(d, [transaction('bulk-back-a'), transaction('bulk-back-b')]);
	await cashflow(d);
	await d.click('#btn-bulk-select-page');
	await reopen(d);
	await d.evaluate('window.__backEvents=0;window.addEventListener("popstate",()=>window.__backEvents++);window.__unloads=0;window.addEventListener("beforeunload",()=>window.__unloads++);');
}
async function reopen(d) {
	await d.click('#btn-bulk-edit');
	await d.waitFor('document.querySelector("#modal-bulk-edit").classList.contains("active") && window.__yose_app.bulkEditController.originals.length===2 && document.querySelector("main").inert');
}
async function close(d, action) {
	if (action === 'back') {
		const count = await d.evaluate('window.__backEvents');
		await d.evaluate('history.back()');
		await d.waitFor(`window.__backEvents>${count} && history.state?.yoseGuard`);
	} else if (action === 'escape') await d.key('#bulk-apply-memo', 'Escape');
	else if (action === 'backdrop') {
		await d.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 2, y: 2, button: 'left', clickCount: 1 }, d.sessionId);
		await d.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 }, d.sessionId);
	} else await d.click(action === 'cancel' ? '#btn-cancel-bulk' : '#btn-close-bulk');
}
async function originalState(d) {
	return d.evaluate('window.__yose_app.db.captureImportState()');
}
async function unchangedPage(d) {
	assert.equal(await d.evaluate('window.__unloads'), 0);
	assert.equal(await d.evaluate('window.__yose_app.allowNavigation === true'), false);
	assert.equal(d.dialogs.some(item => item.type === 'beforeunload'), false);
	assert.equal(await d.evaluate('window.__dialogs.some(item=>/前のページ|画面を閉じて/.test(item.message))'), false);
}

describe('Bulk edit cancellation and browser navigation', { timeout: 120000 }, () => {
	for (const action of ['back', 'cancel', 'escape', 'header', 'backdrop']) {
		it(`closes a clean bulk editor with ${action} while retaining selection, originals and focus`, async () => {
			const d = fixture.driver; await open(d);
			const before = await originalState(d), dialogs = await d.evaluate('window.__dialogs.length');
			await close(d, action);
			await d.waitFor('!document.querySelector("#modal-bulk-edit").classList.contains("active") && !document.querySelector("main").inert');
			assert.equal(await d.evaluate('document.activeElement.id'), 'btn-bulk-edit');
			assert.deepEqual(await d.evaluate('[...window.__yose_app.bulkEditController.selectedIds].sort()'), ['bulk-back-a', 'bulk-back-b']);
			assert.equal(await d.evaluate('window.__dialogs.length'), dialogs);
			assert.deepEqual(await originalState(d), before);
			await unchangedPage(d);
		});
	}
	for (const action of ['back', 'cancel', 'escape', 'header', 'backdrop']) {
		it(`retains a dirty draft after rejecting ${action}, then discards only after approval`, async () => {
			const d = fixture.driver; await open(d);
			const before = await originalState(d);
			await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', '破棄対象');
			await d.setConfirm(false);
			for (let i = 0; i < 2; i++) {
				const count = await d.evaluate('window.__dialogs.length');
				await close(d, action);
				assert.equal(await d.isVisible('#modal-bulk-edit'), true);
				assert.equal(await d.evaluate('document.querySelector("#bulk-value-memo").value'), '破棄対象');
				const dialogs = await d.evaluate(`window.__dialogs.slice(${count})`);
				assert.equal(dialogs.length, 1); assert.match(dialogs[0].message, /一括編集の変更を破棄/);
			}
			await d.setConfirm(true); await close(d, action);
			await d.waitFor('!document.querySelector("#modal-bulk-edit").classList.contains("active")');
			assert.deepEqual(await originalState(d), before);
			assert.equal(await d.evaluate('window.__yose_app.bulkEditController.selectedIds.size'), 2);
			await reopen(d);
			assert.equal(await d.evaluate('document.querySelector("#bulk-value-memo").value'), '');
			assert.equal(await d.evaluate('document.querySelector("#bulk-apply-memo").checked'), false);
			await unchangedPage(d);
		});
	}
	for (const [width, height] of [[1280, 720], [390, 640], [640, 360], [320, 480]]) {
		it(`keeps cancel, save and header close operable while scrolling at ${width}x${height}`, async () => {
			const d = fixture.driver;
			await d.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, d.sessionId);
			await open(d);
			for (const bottom of [false, true]) {
				await d.evaluate(`(()=>{const body=document.querySelector('#bulk-edit-body');if(body) body.scrollTop=${bottom ? 'body.scrollHeight' : '0'};})()`);
				if (bottom) await d.click('#bulk-apply-actual_subcategory_id');
				const buttons = await d.evaluate(`['btn-close-bulk','btn-cancel-bulk','btn-save-bulk'].map(id=>{const el=document.getElementById(id);if(!el)return {id,visible:false};const r=el.getBoundingClientRect(),target=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {id,visible:r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&(target===el||el.contains(target))};})`);
				assert.deepEqual(buttons.filter(button => !button.visible), [], `buttons must be in view, bottom=${bottom}`);
				if (!bottom) {
					const position = await d.evaluate('(()=>{const r=document.querySelector("#bulk-edit-body").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,background:scrollY};})()');
					await d.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: position.x, y: position.y, deltaX: 0, deltaY: 400 }, d.sessionId);
					await d.waitFor('document.querySelector("#bulk-edit-body").scrollTop>0');
					assert.equal(await d.evaluate('scrollY'), position.background);
					assert.equal(await d.evaluate('document.querySelector("#modal-bulk-edit .modal").scrollTop'), 0);
				}
			}
			assert.ok(await d.evaluate('document.querySelector("#bulk-edit-body").scrollHeight>document.querySelector("#bulk-edit-body").clientHeight'));
			assert.equal(await d.evaluate('document.documentElement.scrollWidth>innerWidth'), false);
			await d.click('#btn-cancel-bulk');
			assert.equal(await d.isVisible('#modal-bulk-edit'), false);
		});
	}
	it('blocks every dismissal during save, then restores cancellation after failure without changing originals', async () => {
		const d = fixture.driver; await open(d);
		const before = await originalState(d);
		await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', '失敗後も保持');
		await d.evaluate(`(()=>{const c=window.__yose_app.bulkEditController,save=c.save.bind(c);c.save=()=>window.__saveBulk=save();c.db.bulkEditTransactions=async()=>{window.__saveEntered=true;await new Promise(resolve=>window.__releaseBulk=resolve);throw new Error('一括保存失敗の試験');};})()`);
		await d.click('#btn-save-bulk'); await d.waitFor('window.__saveEntered');
		const count = await d.evaluate('window.__dialogs.length');
		for (const id of ['btn-cancel-bulk', 'btn-close-bulk', 'btn-save-bulk']) assert.equal(await d.evaluate(`Boolean(document.getElementById('${id}')?.disabled)`), true, `${id} must exist and be disabled during save`);
		await close(d, 'back'); await close(d, 'escape'); await close(d, 'backdrop');
		// Native disabled buttons reject a click; the driver deliberately refuses disabled controls.
		await d.evaluate('document.getElementById("btn-cancel-bulk").click();document.getElementById("btn-close-bulk").click();');
		assert.equal(await d.isVisible('#modal-bulk-edit'), true);
		assert.equal(await d.evaluate('window.__dialogs.length'), count);
		await d.evaluate('(async()=>{window.__releaseBulk();await window.__saveBulk;})()');
		assert.match(await d.evaluate('document.getElementById("bulk-edit-error").textContent'), /一括保存失敗/);
		assert.equal(await d.evaluate('document.getElementById("btn-cancel-bulk").disabled'), false);
		assert.equal(await d.evaluate('document.getElementById("bulk-value-memo").value'), '失敗後も保持');
		await d.setConfirm(false); await close(d, 'back');
		assert.equal(await d.isVisible('#modal-bulk-edit'), true);
		await d.setConfirm(true); await close(d, 'cancel');
		assert.equal(await d.isVisible('#modal-bulk-edit'), false);
		assert.deepEqual(await originalState(d), before);
		await unchangedPage(d);
	});
});
