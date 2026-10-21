import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seedLegacy, transaction, records, cashflow, settings, submit, waitForDialog, value } from '../helpers/ui_fixture.js';

async function nativeKey(d, selector, key) {
	await d.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
	const code = key === 'Enter' ? 'Enter' : 'Space';
	const virtualKey = key === 'Enter' ? 13 : 32;
	await d.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey, text: key === 'Enter' ? '\r' : ' ' }, d.sessionId);
	await d.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey }, d.sessionId);
}

async function prepare(d, overrides = {}) {
	await d.evaluate(`(async () => {
		const db = window.__yose_app.db;
		const config = await db.getMasterConfig();
		config.recurring_rules = [];
		config.categories = [
			{ id: 'cat_food', name: '食費', type: 'expense', subcategories: [{ id: 'sub_a', name: '通常' }, { id: 'sub_b', name: '別分類' }] },
			{ id: 'cat_other', name: 'その他', type: 'expense', subcategories: [{ id: 'sub_c', name: '通常' }] },
			{ id: 'cat_old', name: '旧費目', type: 'expense', is_archived: true, subcategories: [{ id: 'sub_old', name: '旧中項目', is_archived: true }] }
		];
		await db.saveMasterConfig(config);
	})()`);
	await seedLegacy(d, [transaction('edit_same', overrides)]);
	await cashflow(d);
	await d.click('#month-tx-list [data-id="edit_same"]');
	await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active") && document.getElementById("edit-tx-id").value === "edit_same"');
}

async function sameState(d) {
	return d.evaluate(`({ checked: document.getElementById('edit-chk-sync-actual-category')?.checked, visible: document.getElementById('edit-actual-category-container')?.checkVisibility() })`);
}

async function save(d) {
	await submit(d, '#edit-tx-form');
	await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
	return (await records(d)).find(tx => tx.id === 'edit_same');
}

describe('Section title controls and matching edit classifications', { timeout: 180000 }, () => {
	const fixture = useBrowser();
	it('toggles every existing pane by its title and blank bar while preserving state and aria', async () => {
		const d = fixture.driver;
		await cashflow(d);
		const ids = await d.evaluate(`Array.from(document.querySelectorAll('#tab-summary .card[id], #tab-settings .card[id]')).filter(card => card.querySelector('.card-collapse-btn')).map(card => card.id)`);
		assert.ok(ids.length > 10);
		for (const id of ids) {
			await d.evaluate(`document.getElementById(${JSON.stringify(id)}).querySelector('.card-title').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
			assert.equal(await d.evaluate(`document.getElementById(${JSON.stringify(id)}).classList.contains('collapsed')`), true, id);
			assert.deepEqual(await d.evaluate(`Array.from(document.getElementById(${JSON.stringify(id)}).querySelectorAll('.card-title button[aria-expanded]'), el => el.getAttribute('aria-expanded'))`), ['false', 'false'], id);
			await d.waitFor(`(async () => (await window.__yose_app.db.getMasterConfig()).collapsed_panes[${JSON.stringify(id)}] === true)()`);
			await d.evaluate(`window.__yose_app.setupCollapsiblePanes(); window.__yose_app.applyCollapsedPanesState()`);
			await d.evaluate(`document.getElementById(${JSON.stringify(id)}).querySelector('.card-collapse-title').click()`);
			assert.equal(await d.evaluate(`document.getElementById(${JSON.stringify(id)}).classList.contains('collapsed')`), false, id);
			await d.waitFor(`(async () => (await window.__yose_app.db.getMasterConfig()).collapsed_panes[${JSON.stringify(id)}] === false)()`);
		}
	});
	it('keeps the annual budget title readable and its controls usable at 390px', async () => {
		const d = fixture.driver;
		await d.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, d.sessionId);
		await settings(d);
		const layout = await d.evaluate(`(() => {
			const bar = document.querySelector('#card-annual-budget-setting .card-title');
			const title = bar.querySelector('.card-collapse-title');
			const rect = title.getBoundingClientRect();
			const style = getComputedStyle(title);
			return { width: rect.width, height: rect.height, line: parseFloat(style.lineHeight), scroll: bar.scrollWidth, client: bar.clientWidth, controls: Array.from(bar.querySelectorAll('button'), el => { const box = el.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width }; }), viewport: innerWidth };
		})()`);
		assert.equal(layout.viewport, 390);
		assert.ok(layout.width >= 180, `Title needs at least ten full-width characters: ${JSON.stringify(layout)}`);
		assert.ok(layout.height <= layout.line * 3 + 1, `Title must fit within three readable lines: ${JSON.stringify(layout)}`);
		assert.ok(layout.scroll <= layout.client + 1, JSON.stringify(layout));
		assert.ok(layout.controls.every(box => box.left >= 0 && box.right <= 390 && box.width > 0), JSON.stringify(layout));
		await d.click('#btn-budget-auto-calc');
		await waitForDialog(d, '推奨予算値を試算');
		assert.equal(await d.evaluate('document.getElementById("card-annual-budget-setting").classList.contains("collapsed")'), false);
		await d.click('#card-annual-budget-setting .card-collapse-title');
		assert.equal(await d.evaluate('document.getElementById("card-annual-budget-setting").classList.contains("collapsed")'), true);
		await d.waitFor('(async () => (await window.__yose_app.db.getMasterConfig()).collapsed_panes["card-annual-budget-setting"] === true)()');
		await d.click('#card-annual-budget-setting .card-collapse-btn');
		assert.equal(await d.evaluate('document.getElementById("card-annual-budget-setting").classList.contains("collapsed")'), false);
		assert.equal(await d.evaluate('document.querySelector("#card-annual-budget-setting .card-collapse-title").getAttribute("aria-expanded")'), 'true');
	});
	it('supports native Enter and Space, keeps right button single firing, and restores saved collapse on reload', async () => {
		const d = fixture.driver;
		await settings(d);
		const title = '#card-theme-setting .card-collapse-title';
		await nativeKey(d, title, 'Enter');
		assert.equal(await d.evaluate('document.getElementById("card-theme-setting").classList.contains("collapsed")'), true);
		await nativeKey(d, title, ' ');
		assert.equal(await d.evaluate('document.getElementById("card-theme-setting").classList.contains("collapsed")'), false);
		await d.click('#card-theme-setting .card-collapse-btn');
		await d.waitFor('(async () => (await window.__yose_app.db.getMasterConfig()).collapsed_panes["card-theme-setting"] === true)()');
		await d.send('Page.reload', {}, d.sessionId);
		await d.waitFor('document.getElementById("auth-pin-container")?.style.display === "block"');
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("card-theme-setting").classList.contains("collapsed")');
		assert.equal(await d.evaluate('document.querySelector("#card-theme-setting .card-collapse-title").getAttribute("aria-expanded")'), 'false');
	});
	it('preserves title bar controls, nested labels, links and editable text without collapsing', async () => {
		const d = fixture.driver;
		await cashflow(d);
		await d.click('#btn-toggle-planned');
		assert.equal(await d.evaluate('document.getElementById("card-summary-chart").classList.contains("collapsed")'), false);
		await d.fill('#select-status-filter', 'confirmed');
		assert.equal(await d.evaluate('document.getElementById("card-month-tx-list").classList.contains("collapsed")'), false);
		await d.evaluate(`const title = document.querySelector('#card-summary-chart .card-title'); title.insertAdjacentHTML('beforeend', '<label id="test-label"><input id="test-check" type="checkbox"><span>チェック</span></label><a id="test-link" href="#test">リンク</a><span id="test-editable" contenteditable="true">入力</span>');`);
		for (const selector of ['#test-label span', '#test-link', '#test-editable']) {
			await d.click(selector);
			assert.equal(await d.evaluate('document.getElementById("card-summary-chart").classList.contains("collapsed")'), false, selector);
		}
		assert.equal(await d.evaluate('document.getElementById("test-check").checked'), true);
	});
	for (const [name, overrides, checked] of [
		['both absent subcategories', {}, true],
		['same nonempty subcategories', { subcategory_id: 'sub_a', actual_subcategory_id: 'sub_a' }, true],
		['different parent only', { actual_category_id: 'cat_other' }, false],
		['different child only', { subcategory_id: 'sub_a', actual_subcategory_id: 'sub_b' }, false],
		['missing actual child with populated accounting child', { subcategory_id: 'sub_a', actual_category_id: null, actual_subcategory_id: null }, false],
		['same archived classifications', { category_id: 'cat_old', actual_category_id: 'cat_old', subcategory_id: 'sub_old', actual_subcategory_id: 'sub_old' }, true]
	]) {
		it(`initializes ${name} without treating initial display as unsaved edits`, async () => {
			const d = fixture.driver;
			await prepare(d, overrides);
			assert.deepEqual(await sameState(d), { checked, visible: !checked });
			await d.click('#btn-close-edit-tx');
			assert.equal(await d.evaluate('document.getElementById("modal-edit-tx").classList.contains("active")'), false);
			assert.equal(await d.evaluate('window.__dialogs.some(dialog => dialog.message.includes("破棄"))'), false);
		});
	}
	it('mirrors parent and child changes while checked, then persists both classifications', async () => {
		const d = fixture.driver;
		await prepare(d);
		await d.fill('#edit-tx-category', 'cat_other');
		await d.waitFor('document.getElementById("edit-tx-subcategory").value === "sub_c" && document.getElementById("edit-tx-actual-category").value === "cat_other"');
		await d.fill('#edit-tx-category', 'cat_food');
		await d.waitFor('document.getElementById("edit-tx-subcategory").value === "sub_a"');
		await d.fill('#edit-tx-subcategory', 'sub_b');
		assert.equal(await value(d, '#edit-tx-actual-subcategory'), 'sub_b');
		const tx = await save(d);
		assert.deepEqual([tx.category_id, tx.subcategory_id, tx.actual_category_id, tx.actual_subcategory_id], ['cat_food', 'sub_b', 'cat_food', 'sub_b']);
	});
	it('preserves current parent, child and separate actual selection after a stale category response', async () => {
		const d = fixture.driver;
		await prepare(d, { subcategory_id: 'sub_a', actual_subcategory_id: 'sub_a' });
		await d.evaluate(`
			const db = window.__yose_app.db; const original = db.getMasterConfig.bind(db); let first = true;
			db.getMasterConfig = async () => { const config = await original(); if (first) { first = false; await new Promise(resolve => { window.__releaseCategory = resolve; }); } return config; };
			const select = document.getElementById('edit-tx-category'); select.value = 'cat_other'; select.dispatchEvent(new Event('change', { bubbles: true }));
		`);
		await d.waitFor('typeof window.__releaseCategory === "function"');
		await d.fill('#edit-tx-category', 'cat_food');
		await d.waitFor('document.getElementById("edit-tx-subcategory").value === "sub_a"');
		await d.fill('#edit-tx-subcategory', 'sub_b');
		await d.click('#edit-chk-sync-actual-category');
		await d.fill('#edit-tx-actual-category', 'cat_other');
		await d.waitFor('document.getElementById("edit-tx-actual-subcategory").value === "sub_c"');
		await d.evaluate('window.__releaseCategory()');
		await d.waitFor('document.getElementById("edit-tx-subcategory").value === "sub_b"');
		const tx = await save(d);
		assert.deepEqual([tx.category_id, tx.subcategory_id, tx.actual_category_id, tx.actual_subcategory_id], ['cat_food', 'sub_b', 'cat_other', 'sub_c']);
	});
	it('keeps matching unknown category and child IDs through an unedited save', async () => {
		const d = fixture.driver;
		await prepare(d, { category_id: 'unknown_cat', actual_category_id: 'unknown_cat', subcategory_id: 'unknown_sub', actual_subcategory_id: 'unknown_sub' });
		assert.deepEqual(await sameState(d), { checked: true, visible: false });
		const tx = await save(d);
		assert.deepEqual([tx.category_id, tx.subcategory_id, tx.actual_category_id, tx.actual_subcategory_id], ['unknown_cat', 'unknown_sub', 'unknown_cat', 'unknown_sub']);
	});
	it('allows separate edits after unchecking, resets actual to current accounting on recheck and resets on reopen', async () => {
		const d = fixture.driver;
		await prepare(d, { subcategory_id: 'sub_a', actual_subcategory_id: 'sub_a' });
		await d.click('#edit-chk-sync-actual-category');
		await d.fill('#edit-tx-actual-category', 'cat_other');
		await d.waitFor('document.getElementById("edit-tx-actual-subcategory").value === "sub_c"');
		await d.click('#edit-chk-sync-actual-category');
		await d.click('#edit-chk-sync-actual-category');
		assert.equal(await value(d, '#edit-tx-actual-category'), 'cat_food');
		await d.fill('#edit-tx-actual-subcategory', 'sub_b');
		const tx = await save(d);
		assert.deepEqual([tx.subcategory_id, tx.actual_subcategory_id], ['sub_a', 'sub_b']);
		await d.click('#month-tx-list [data-id="edit_same"]');
		await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active")');
		assert.deepEqual(await sameState(d), { checked: false, visible: true });
	});
	it('recognizes checkbox-only changes as dirty on back and preserves the edit after cancelling discard', async () => {
		const d = fixture.driver;
		await prepare(d);
		await d.click('#edit-chk-sync-actual-category');
		await d.setConfirm(false);
		await d.evaluate('history.back()');
		await waitForDialog(d, '編集中の変更を破棄');
		assert.equal(await d.evaluate('document.getElementById("modal-edit-tx").classList.contains("active")'), true);
		assert.deepEqual(await sameState(d), { checked: false, visible: true });
		await d.setConfirm(true); await d.click('#btn-close-edit-tx');
		assert.equal((await records(d))[0].actual_category_id, 'cat_food');
	});
	it('keeps classification hidden for transfers and saves null values after a checked classification change', async () => {
		const d = fixture.driver;
		await prepare(d, { type: 'transfer', to_account_id: 'acc_bank', category_id: null, actual_category_id: null });
		assert.equal(await d.isVisible('#edit-tx-cat-container'), false);
		await d.fill('#edit-tx-type', 'expense');
		assert.equal(await d.isVisible('#edit-chk-sync-actual-category'), true);
		await d.fill('#edit-tx-type', 'transfer');
		const tx = await save(d);
		assert.deepEqual([tx.category_id, tx.subcategory_id, tx.actual_category_id, tx.actual_subcategory_id], [null, null, null, null]);
	});
	it('persists mirrored classifications to every expense in a prepaid cascade', async () => {
		const d = fixture.driver;
		await prepare(d);
		await d.click('#btn-close-edit-tx');
		await d.evaluate(`(async () => { const { createPrepaidAmortizationTransactions } = await import('./js/logic.js'); const txs = createPrepaidAmortizationTransactions({ paymentDate: '2026-10-20', totalAmount: 1200, amortizeMonths: 3, payingAccountId: 'acc_wallet', categoryId: 'cat_food', subcategoryId: 'sub_a', actualCategoryId: 'cat_food', actualSubcategoryId: 'sub_a' }); await window.__yose_app.db.putTransactions(txs); window.__cascadeId = txs.find(tx => tx.type === 'expense').id; await window.__yose_app.refreshAllViews(); })()`);
		const id = await d.evaluate('window.__cascadeId');
		await d.click(`#month-tx-list [data-id="${id}"]`);
		await d.waitFor(`document.getElementById('modal-edit-tx').classList.contains('active') && document.getElementById('edit-tx-id').value === ${JSON.stringify(id)}`);
		assert.equal((await sameState(d)).checked, true);
		await d.fill('#edit-tx-subcategory', 'sub_b');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		const txs = (await records(d)).filter(tx => tx.id !== 'edit_same' && tx.type === 'expense');
		assert.equal(txs.length, 3);
		assert.ok(txs.every(tx => tx.category_id === 'cat_food' && tx.actual_category_id === 'cat_food' && tx.subcategory_id === 'sub_b' && tx.actual_subcategory_id === 'sub_b'));
	});
});
