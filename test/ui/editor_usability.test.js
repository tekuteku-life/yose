import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, seedLegacy, transaction, records, cashflow, submit, value } from '../helpers/ui_fixture.js';

describe('Editor and mobile usability', { timeout: 120000 }, () => {
	const fixture = useBrowser();
	async function typeText(d, selector, text) {
		await d.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
	}
	async function open(d, tx = transaction('edit', { tags: ['既存'] }), legacy = false) {
		await (legacy ? seedLegacy : seed)(d, [tx]);
		await cashflow(d);
		await d.click(`#month-tx-list [data-id="${tx.id}"]`);
		await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active")');
	}

	it('keeps mobile tabs on one line and scrolls the tab strip without page overflow', async () => {
		const d = fixture.driver;
		await d.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true }, d.sessionId);
		const layout = await d.evaluate(`(() => {
			const nav = document.querySelector('.nav-tabs');
			return { tops: Array.from(nav.children, e => e.getBoundingClientRect().top), scroll: nav.scrollWidth, width: nav.clientWidth, page: document.documentElement.scrollWidth, viewport: innerWidth, wrap: Array.from(nav.children, e => getComputedStyle(e).whiteSpace) };
		})()`);
		assert.equal(new Set(layout.tops).size, 1);
		assert.ok(layout.wrap.every(v => v === 'nowrap'));
		assert.ok(layout.scroll > layout.width);
		assert.equal(layout.page, layout.viewport);
		assert.ok(await d.evaluate('Array.from(document.querySelectorAll(".mode-tab-btn"), el => getComputedStyle(el).whiteSpace).every(value => value === "nowrap")'));
		await d.click('.mode-tab-btn[data-mode="point"]');
		assert.ok(await d.evaluate('document.querySelector(".mode-tabs").scrollLeft > 0'));
		assert.equal(await d.evaluate('document.documentElement.scrollWidth'), await d.evaluate('innerWidth'));
		await d.click('.tab-btn[data-tab="tab-settings"]');
		assert.ok(await d.evaluate('document.querySelector(".nav-tabs").scrollLeft > 0'));
		assert.equal(await d.isVisible('#tab-settings'), true);
	});

	it('edits independent tag chips, removes and deduplicates tags, and saves', async () => {
		const d = fixture.driver;
		await open(d);
		assert.equal(await d.evaluate('document.querySelectorAll("#edit-tags-chips-list .tag-chip").length'), 1);
		await typeText(d, '#edit-tag-text', '追加');
		await d.key('#edit-tag-text', 'Enter');
		await typeText(d, '#edit-tag-text', '追加');
		await d.key('#edit-tag-text', 'Enter');
		assert.equal(await d.evaluate('document.querySelectorAll("#edit-tags-chips-list .tag-chip").length'), 2);
		await d.click('#edit-tags-chips-list .tag-chip-del');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		assert.deepEqual((await records(d))[0].tags, ['追加']);
		assert.equal(await value(d, '#input-tags'), '');
		assert.equal(await d.evaluate('document.querySelector("main").inert'), false);
	});

	for (const mode of ['new', 'edit']) {
		it(`replaces partial ${mode} tags and memos with selected suggestions using real clicks`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('history', { tags: ['候補タグ'], memo: '候補メモ' })]);
			await d.evaluate('window.__yose_app.txInputController.updateTagAndMemoSuggestions()');
			if (mode === 'edit') await open(d);
			const tag = mode === 'new' ? '#input-tag-text' : '#edit-tag-text';
			const dropdown = mode === 'new' ? '#tags-suggest-dropdown' : '#edit-tags-suggest-dropdown';
			await typeText(d, tag, '候');
			await d.click(`${dropdown} .suggest-item`);
			assert.equal(await value(d, tag), '');
			const tags = await value(d, mode === 'new' ? '#input-tags' : '#edit-tx-tags');
			assert.ok(tags.includes('候補タグ'));
			assert.equal(tags.split(',').map(v => v.trim()).includes('候'), false);
			const memo = mode === 'new' ? '#input-memo' : '#edit-tx-memo';
			await d.fill(memo, '候');
			await d.click(`${mode === 'new' ? '#memo-suggest-dropdown' : '#edit-memo-suggest-dropdown'} .suggest-item`);
			assert.equal(await value(d, memo), '候補メモ');
		});
	}

	it('places save to the right of cancel and separates deletion below it', async () => {
		const d = fixture.driver;
		await open(d);
		const boxes = await d.evaluate(`['#btn-cancel-edit-tx', '#edit-tx-form button[type=submit]', '#btn-edit-delete-tx'].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom }; })`);
		assert.ok(boxes[1].left > boxes[0].left);
		assert.ok(boxes[2].top >= boxes[1].bottom);
	});

	it('closes an unchanged editor on back without leaving or confirming, preserving history', async () => {
		const d = fixture.driver;
		await open(d);
		const before = await d.evaluate('({ length: history.length, dialogs: window.__dialogs.length })');
		await d.evaluate('history.back()');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active") && history.state?.yoseGuard');
		assert.equal(await d.evaluate('window.__dialogs.length'), before.dialogs);
		assert.equal(await d.evaluate('history.length'), before.length);
		assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'), true);
	});

	it('retains dirty edits when back is cancelled and discards only the editor after approval', async () => {
		const d = fixture.driver;
		await open(d);
		await d.fill('#edit-tx-memo', '未保存');
		await d.setConfirm(false);
		for (let i = 0; i < 2; i++) {
			const count = await d.evaluate('window.__dialogs.length');
			await d.evaluate('history.back()');
			await d.waitFor(`window.__dialogs.length > ${count} && history.state?.yoseGuard`);
			assert.equal(await d.isVisible('#modal-edit-tx'), true);
			assert.equal(await value(d, '#edit-tx-memo'), '未保存');
		}
		await d.setConfirm(true);
		await d.evaluate('history.back()');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active") && history.state?.yoseGuard');
		assert.equal((await records(d))[0].memo, 'edit');
	});

	it('confirms close and cancel for pending tags, and allows reverted values without confirmation', async () => {
		const d = fixture.driver;
		await open(d);
		await typeText(d, '#edit-tag-text', '未確定');
		await d.setConfirm(false);
		await d.click('#btn-close-edit-tx');
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		await d.click('#btn-cancel-edit-tx');
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		await d.fill('#edit-tag-text', '');
		await d.click('#edit-tags-chips-list .tag-chip-del[data-tag-index="1"]');
		const count = await d.evaluate('window.__dialogs.length');
		await d.click('#btn-cancel-edit-tx');
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
		assert.equal(await d.evaluate('window.__dialogs.length'), count);
	});

	it('locks background scrolling and interaction across a nested calculator and restores on close', async () => {
		const d = fixture.driver;
		await open(d);
		await d.waitFor('document.querySelector("main").inert');
		assert.equal(await d.evaluate('getComputedStyle(document.body).position'), 'fixed');
		assert.equal(await d.evaluate('getComputedStyle(document.querySelector("#modal-edit-tx .modal")).overscrollBehaviorY'), 'contain');
		await d.click('#btn-edit-open-tax-calc');
		await d.waitFor('document.getElementById("modal-edit-tx").inert && !document.getElementById("modal-tax").inert');
		await d.click('#btn-close-tax-modal');
		await d.waitFor('!document.getElementById("modal-edit-tx").inert && document.querySelector("main").inert');
		await d.click('#btn-close-edit-tx');
		await d.waitFor('!document.querySelector("main").inert');
		assert.notEqual(await d.evaluate('getComputedStyle(document.body).position'), 'fixed');
	});


	it('handles Escape on the top calculator and then confirms dirty editor discard', async () => {
		const d = fixture.driver;
		await open(d);
		await d.fill('#edit-tx-memo', '変更あり');
		await d.click('#btn-edit-open-tax-calc');
		await d.key('#btn-close-tax-modal', 'Escape');
		await d.waitFor('!document.getElementById("modal-tax").classList.contains("active")');
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		await d.setConfirm(false);
		await d.key('#edit-tx-memo', 'Escape');
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		await d.setConfirm(true);
		await d.key('#edit-tx-memo', 'Escape');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
	});

	it('preserves IME Enter and escapes tag and memo suggestion HTML', async () => {
		const d = fixture.driver;
		await open(d, transaction('escaped', { tags: ['<img src=x onerror=alert(1)>'], memo: '<svg onload=alert(1)>' }));
		await typeText(d, '#edit-tag-text', '変換中');
		await d.evaluate('document.getElementById("edit-tag-text").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }))');
		assert.equal(await value(d, '#edit-tag-text'), '変換中');
		assert.equal(await d.evaluate('document.querySelector("#edit-tags-chips-list img")'), null);
		await d.fill('#edit-tx-memo', '<svg');
		assert.equal(await d.evaluate('document.querySelector("#edit-memo-suggest-dropdown svg")'), null);
		await d.click('#edit-memo-suggest-dropdown .suggest-item');
		assert.equal(await value(d, '#edit-tx-memo'), '<svg onload=alert(1)>');
	});

	it('restores scroll position and interaction after wheel attempts at both modal edges and deletion', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('scroll')]);
		await cashflow(d);
		await d.evaluate('document.querySelector("main").style.minHeight = "4000px"; window.scrollTo(0, 500); document.querySelector("#month-tx-list [data-id=scroll]").focus()');
		const original = await d.evaluate('scrollY');
		await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("scroll")');
		await d.waitFor('document.querySelector("main").inert');
		const locked = await d.evaluate('scrollY');
		for (const edge of ['bottom', 'top']) {
			const point = await d.evaluate(`(() => { const modal = document.querySelector('#modal-edit-tx .modal'); modal.scrollTop = ${edge === 'bottom' ? 'modal.scrollHeight' : '0'}; const r = modal.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
			await d.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...point, deltaX: 0, deltaY: edge === 'bottom' ? 600 : -600 }, d.sessionId);
			await d.send('Runtime.evaluate', { expression: 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))', awaitPromise: true }, d.sessionId);
			assert.equal(await d.evaluate('scrollY'), locked);
		}
		await d.click('#btn-edit-delete-tx');
		await d.waitFor('!document.querySelector("main").inert');
		assert.equal(await d.evaluate('scrollY'), original);
		assert.equal((await records(d))[0].is_deleted, true);
	});

	it('selects only the suggested tag with a real touch sequence', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('touch_history', { tags: ['タッチ候補'] })]);
		await open(d);
		await typeText(d, '#edit-tag-text', 'タッチ');
		const point = await d.evaluate(`(() => { const el = document.querySelector('#edit-tags-suggest-dropdown .suggest-item'); el.scrollIntoView({block:'nearest'}); const r=el.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2 }; })()`);
		await d.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }, d.sessionId);
		await d.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, d.sessionId);
		await d.waitFor('document.getElementById("edit-tx-tags").value.includes("タッチ候補")');
		assert.equal((await value(d, '#edit-tx-tags')).split(',').map(s => s.trim()).includes('タッチ'), false);
	});

	it('closes the calculator first on back and restores the original focus after closing the editor', async () => {
		const d = fixture.driver;
		await open(d);
		await d.click('#btn-close-edit-tx');
		await d.evaluate('document.querySelector(".tab-btn.active").focus(); window.__yose_app.txEditController.openEditTransactionModal("edit")');
		await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active")');
		await d.fill('#edit-tx-memo', '電卓の背後で編集中');
		await d.click('#btn-edit-open-tax-calc');
		const dialogsBefore = await d.evaluate('window.__dialogs.length');
		await d.evaluate('history.back()');
		await d.waitFor('history.state?.yoseGuard && !document.getElementById("modal-tax").classList.contains("active")');
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		assert.equal(await d.evaluate('document.querySelector("main").inert'), true);
		assert.equal(await value(d, '#edit-tx-memo'), '電卓の背後で編集中');
		assert.equal(await d.evaluate('window.__dialogs.length'), dialogsBefore);
		await d.setConfirm(false);
		await d.evaluate('history.back()');
		await d.waitFor(`window.__dialogs.length > ${dialogsBefore} && history.state?.yoseGuard`);
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		await d.setConfirm(true);
		await d.click('#btn-close-edit-tx');
		await d.waitFor('document.activeElement.classList.contains("tab-btn")');
	});

	for (const mode of ['new', 'edit']) {
		it(`replaces partial ${mode} tags when a suggestion is selected with Tab and Enter`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('keyboard_history', { tags: ['キーボード候補'] })]);
			await d.evaluate('window.__yose_app.txInputController.updateTagAndMemoSuggestions()');
			if (mode === 'edit') await open(d);
			const text = mode === 'new' ? '#input-tag-text' : '#edit-tag-text';
			const suggestion = mode === 'new' ? '#tags-suggest-dropdown .suggest-item' : '#edit-tags-suggest-dropdown .suggest-item';
			await typeText(d, text, 'キーボード');
			await d.key(text, 'Tab');
			assert.equal(await d.evaluate('document.activeElement.classList.contains("suggest-item")'), true);
			await d.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, d.sessionId);
			await d.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, d.sessionId);
			const tags = (await value(d, mode === 'new' ? '#input-tags' : '#edit-tx-tags')).split(',').map(s => s.trim());
			assert.ok(tags.includes('キーボード候補'));
			assert.equal(tags.includes('キーボード'), false);
		});
	}

	for (const trigger of ['explicit', 'bfcache']) {
		it(`keeps authentication operable after ${trigger} locking with an open editor`, async () => {
			const d = fixture.driver;
			await open(d);
			if (trigger === 'explicit') await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
			else await d.evaluate('window.dispatchEvent(new PageTransitionEvent("pagehide")); window.dispatchEvent(new PageTransitionEvent("pageshow", {persisted:true}))');
			await d.waitFor('!document.getElementById("auth-screen").classList.contains("hidden")');
			assert.equal(await d.evaluate('document.getElementById("auth-screen").inert'), false);
			assert.equal(await d.isVisible('#modal-edit-tx'), false);
			await d.fill('#auth-pin-input', '1234');
			await d.click('#btn-auth-pin');
			await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
			assert.equal(await d.evaluate('document.querySelector("main").inert'), false);
		});
	}
	it('preserves archived account and category references when saving unrelated edits', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async () => {
			const db = window.__yose_app.db, config = await db.getMasterConfig();
			config.accounts.push({ id: 'old_acc', name: '旧口座', type: 'bank', is_archived: true });
			config.categories.push({ id: 'old_cat', name: '旧費目', type: 'expense', is_archived: true, subcategories: [{ id: 'old_sub', name: '旧内訳', is_archived: true }] });
			await db.saveMasterConfig(config);
		})()`);
		await open(d, transaction('archived', { account_id: 'old_acc', to_account_id: 'old_acc', category_id: 'old_cat', subcategory_id: 'old_sub', actual_category_id: 'old_cat', actual_subcategory_id: 'old_sub' }), true);
		for (const [selector, expected] of [['#edit-tx-account', 'old_acc'], ['#edit-tx-category', 'old_cat'], ['#edit-tx-subcategory', 'old_sub'], ['#edit-tx-to-account', 'old_acc'], ['#edit-tx-actual-category', 'old_cat'], ['#edit-tx-actual-subcategory', 'old_sub']]) assert.equal(await value(d, selector), expected);
		await d.fill('#edit-tx-memo', 'メモだけ更新');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		const tx = (await records(d)).find(t => t.id === 'archived');
		assert.equal(tx.account_id, 'old_acc');
		assert.equal(tx.category_id, 'old_cat');
		assert.equal(tx.subcategory_id, 'old_sub');
		assert.equal(tx.actual_category_id, 'old_cat');
		assert.equal(tx.actual_subcategory_id, 'old_sub');
		await d.evaluate(`(async () => { const db=window.__yose_app.db, config=await db.getMasterConfig(); config.accounts.push({id:'old_to',name:'旧振替先',type:'bank',is_archived:true}); await db.saveMasterConfig(config); })()`);
		await open(d, transaction('archived_transfer', { type: 'transfer', account_id: 'old_acc', to_account_id: 'old_to', category_id: null, actual_category_id: null }), true);
		assert.equal(await value(d, '#edit-tx-to-account'), 'old_to');
		await d.fill('#edit-tx-memo', '振替先を維持');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		assert.equal((await records(d)).find(t => t.id === 'archived_transfer').to_account_id, 'old_to');
	});

	for (const parent of ['missing_parent', 'parent_without_children']) {
		it(`preserves missing child IDs for ${parent} during unrelated edits`, async () => {
			const d = fixture.driver;
			if (parent === 'parent_without_children') await d.evaluate(`(async () => { const db=window.__yose_app.db, config=await db.getMasterConfig(); config.categories.push({id:'parent_without_children',name:'内訳なし',type:'expense'}); await db.saveMasterConfig(config); })()`);
			await open(d, transaction('missing_child_tx', { category_id: parent, subcategory_id: 'missing_child', actual_category_id: parent, actual_subcategory_id: 'missing_actual_child' }), true);
			assert.equal(await value(d, '#edit-tx-subcategory'), 'missing_child');
			assert.equal(await value(d, '#edit-tx-actual-subcategory'), 'missing_actual_child');
			await d.fill('#edit-tx-memo', '参照を維持');
			await submit(d, '#edit-tx-form');
			await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
			const tx=(await records(d))[0];
			assert.equal(tx.subcategory_id, 'missing_child');
			assert.equal(tx.actual_subcategory_id, 'missing_actual_child');
		});
	}
	it('keeps explicit empty subcategories instead of replacing them with the first active choice', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async () => {
			const db = window.__yose_app.db, config = await db.getMasterConfig();
			config.categories.find(c => c.id === 'cat_food').subcategories = [{ id: 'sub_first', name: '先頭' }];
			await db.saveMasterConfig(config);
		})()`);
		await open(d, transaction('empty', { subcategory_id: null, actual_subcategory_id: null }));
		assert.equal(await value(d, '#edit-tx-subcategory'), '');
		assert.equal(await value(d, '#edit-tx-actual-subcategory'), '');
		await d.click('#btn-close-edit-tx');
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
	});

	it('discards a delayed child dropdown render after its parent category changes', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async () => {
			const app=window.__yose_app, db=app.db, config=await db.getMasterConfig();
			config.recurring_rules=[]; config.point_payment_defaults=null; config.categories=[{id:'race_a',name:'A',type:'expense',subcategories:[{id:'sub_a',name:'A内訳'}]},{id:'race_b',name:'B',type:'expense',subcategories:[{id:'sub_b',name:'B内訳'}]}];
			await db.saveMasterConfig(config); await app.txInputController.populateMasterDropdowns();
			const read=db.getMasterConfig.bind(db), update=app.txInputController.updateSubcategories.bind(app.txInputController);
			window.__holdRead=true;
			db.getMasterConfig=async () => { const result=await read(); if(window.__holdRead){window.__holdRead=false; await new Promise(resolve => window.__releaseChildRead=resolve);} return result; };
			app.txInputController.updateSubcategories=async (...args) => { await update(...args); if(args[0]==='race_a')window.__staleDone=true; };
		})()`);
		await d.select('#select-category', 'race_a');
		await d.waitFor('Boolean(window.__releaseChildRead)');
		await d.select('#select-category', 'race_b');
		await d.waitFor('document.getElementById("select-subcategory").value === "sub_b"');
		await d.evaluate('window.__releaseChildRead()');
		await d.waitFor('window.__staleDone');
		assert.equal(await value(d, '#select-category'), 'race_b');
		assert.equal(await value(d, '#select-subcategory'), 'sub_b');
	});

});
