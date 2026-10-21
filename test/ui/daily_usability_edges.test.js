import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, records, cashflow, settings, submit, waitForDialog, value } from '../helpers/ui_fixture.js';

describe('Usability migration and operation boundaries', { timeout: 180000 }, () => {
	const fixture = useBrowser();
	it('keeps the passkey controls open when settings are refreshed asynchronously', async () => {
		const d = fixture.driver;
		await settings(d);
		await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		assert.equal(await d.isVisible('#btn-register-webauthn'), false);
		await d.click('#btn-toggle-key-details');
		await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		assert.equal(await d.isVisible('#btn-register-webauthn'), true);
		await d.click('#btn-toggle-key-details');
		await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		assert.equal(await d.isVisible('#btn-register-webauthn'), false);
	});
	for (const legacy of ['encrypted', 'plaintext']) {
		it(`migrates the ${legacy} legacy vault only after a valid PIN and preserves existing keys`, async () => {
			const d = fixture.driver;
			const before = await d.evaluate(`(async () => {
				const c = await import('./js/crypto.js');
				const db = window.__yose_app.db;
				await db.putTransaction({ id: 'legacy_record', amount: 123, target_month: '2026-10', date: '2026-10-20', status: 'confirmed', type: 'expense', account_id: 'acc_wallet' });
				const dmk = c.bytesToBase64(await c.exportKeyRaw(db.encryptionKey));
				const priv = c.bytesToBase64(await c.exportPrivateKeyPkcs8(window.__yose_app.privateKey));
				await db.saveSecurityKey('webauthn_credential_id', 'legacy_id');
				await db.saveSecurityKey('webauthn_vault', ${legacy === 'plaintext' ? '{ dmk, priv }' : "{ ciphertext: 'old-prf-ciphertext', iv: 'old-iv', prfSalt: 'old-salt' }"});
				const config = await db.getMasterConfig(); config.synced_passkey_bundle = { credentialId: 'legacy_id', vault: { ciphertext: 'legacy' } };
				await db.saveMasterConfig(config);
				return { dmk, priv, pkg: await db.getSecurityKey('master_keys_package'), vault: await db.getSecurityKey('webauthn_vault') };
			})()`);
			await d.send('Page.reload', {}, d.sessionId);
			await d.waitFor('document.getElementById("auth-pin-container")?.style.display === "block"');
			await d.fill('#auth-pin-input', 'wrong'); await d.click('#btn-auth-pin');
			await d.waitFor('document.getElementById("auth-error-msg").textContent.includes("正しく")');
			assert.deepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_vault")'), before.vault);
			assert.deepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("master_keys_package")'), before.pkg);
			await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
			await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
			assert.equal((await records(d))[0].amount, 123);
			assert.deepEqual(await d.evaluate(`(async () => { const c = await import('./js/crypto.js'); return { dmk: c.bytesToBase64(await c.exportKeyRaw(window.__yose_app.db.encryptionKey)), priv: c.bytesToBase64(await c.exportPrivateKeyPkcs8(window.__yose_app.privateKey)) }; })()`), { dmk: before.dmk, priv: before.priv });
			assert.equal(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_vault")'), null);
			assert.equal(await d.evaluate('(async () => (await window.__yose_app.db.getMasterConfig()).synced_passkey_bundle === undefined)()'), true);
			await settings(d);
			if (!await d.isVisible('#btn-register-webauthn')) await d.click('#btn-toggle-key-details');
			await d.click('#btn-register-webauthn');
			await waitForDialog(d, 'WebAuthn登録エラー');
			await d.click('#btn-lock-now');
			await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
			await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		});
	}

	it('distinguishes explicit zero and a points-only payment from a blank amount', async () => {
		const d = fixture.driver;
		await d.fill('#input-amount', '0'); await d.click('#btn-save-tx');
		assert.equal((await records(d)).length, 0);
		assert.equal(await d.evaluate('window.__dialogs.at(-1).type'), 'alert');
		await d.click('.mode-tab-btn[data-mode="point"]');
		await d.fill('#input-point-used', '100'); await d.click('#btn-save-tx');
		await waitForDialog(d, '購入総額');
		assert.equal((await records(d)).length, 0);
	});

	it('preserves unknown flags on memo edits and clears all recalculated prepaid amounts', async () => {
		const d = fixture.driver;
		await d.click('.mode-tab-btn[data-mode="prepaid"]'); await d.fill('#input-prepaid-months', '3'); await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 4)()');
		const parent = (await records(d)).find(tx => tx.amortization_meta.is_payment_record);
		await cashflow(d); await d.click(`#month-tx-list [data-id="${parent.id}"]`);
		await d.fill('#edit-tx-memo', '予定を維持'); await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		assert.ok((await records(d)).every(tx => tx.amount_pending));
		const child = (await records(d)).find(tx => tx.type === 'expense' && tx.target_month === '2026-10');
		await d.click(`#month-tx-list [data-id="${child.id}"]`);
		await d.fill('#edit-tx-amount', '10'); await d.setConfirm(false); await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		assert.equal((await records(d)).find(tx => tx.id === child.id).amount_pending, false);
		assert.ok((await records(d)).filter(tx => tx.id !== child.id).every(tx => tx.amount_pending));
		await d.setConfirm(true);
		await d.click(`#month-tx-list [data-id="${parent.id}"]`);
		await d.fill('#edit-tx-amount', '1001'); await submit(d, '#edit-tx-form');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransaction(' + JSON.stringify(parent.id) + ')).amount === 1001)()');
		assert.ok((await records(d)).every(tx => !tx.amount_pending));
	});

	it('does not settle an advance whose amount is unknown', async () => {
		const d = fixture.driver;
		await d.click('.mode-tab-btn[data-mode="advance"]'); await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 2)()');
		const before = await records(d);
		await d.click('.mode-tab-btn[data-mode="repay"]');
		await d.click('.btn-settle-advance'); await waitForDialog(d, '金額未入力');
		assert.deepEqual(await records(d), before);
	});

	for (const operation of ['new', 'recurring', 'delete', 'prepaid']) {
		it(`cancels closed-month ${operation} before any save`, async () => {
			const d = fixture.driver;
			if (operation === 'new') {
				await d.fill('#input-date', '2026-09-20'); await d.fill('#input-amount', '100');
				await d.setConfirm(false); await d.click('#btn-save-tx');
				await waitForDialog(d, '再月締め'); assert.equal((await records(d)).length, 0);
				assert.equal(await value(d, '#input-amount'), '100'); return;
			}
			if (operation === 'recurring') {
				await d.evaluate(`(async () => { const db = window.__yose_app.db; const config = await db.getMasterConfig(); config.recurring_rules = [{ id: 'closed_rule', is_active: true, day_of_month: 20, amount: 100, account_id: 'acc_wallet', type: 'expense' }]; await db.saveMasterConfig(config); })()`);
			} else {
				await d.evaluate(`(async () => { const { createPrepaidAmortizationTransactions } = await import('./js/logic.js'); await window.__yose_app.db.putTransactions(createPrepaidAmortizationTransactions({ paymentDate: '2026-09-20', totalAmount: 1001, amortizeMonths: 3, payingAccountId: 'acc_wallet', categoryId: 'cat_food' })); })()`);
			}
			const before = await records(d);
			await cashflow(d); await d.fill('#input-period-picker', '2026-09');
			await d.evaluate(`window.confirm = message => { window.__dialogs.push({ type: 'confirm', message }); return !message.includes('再月締め'); };`);
			if (operation === 'recurring') await d.click('#btn-generate-recurring');
			else {
				const parent = before.find(tx => tx.amortization_meta.is_payment_record);
				await d.waitFor(`document.querySelector('#month-tx-list [data-id="${parent.id}"]') !== null`);
				await d.click(`#month-tx-list [data-id="${parent.id}"]`);
				if (operation === 'delete') await d.click('#btn-edit-delete-tx');
				else { await d.fill('#edit-tx-memo', '保存しない'); await submit(d, '#edit-tx-form'); }
			}
			await waitForDialog(d, operation === 'recurring' ? '締め済み月に予定' : '再月締め'); assert.deepEqual(await records(d), before);
		});
	}

	it('allows back navigation only after approval', async () => {
		const d = fixture.driver;
		d.responses.set('/away.html', { body: '<!doctype html><title>Previous page</title>', contentType: 'text/html' });
		await d.send('Page.navigate', { url: d.origin + '/away.html' }, d.sessionId);
		await d.waitFor('location.pathname === "/away.html" && document.readyState === "complete"');
		await d.navigate(); await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
		await d.waitFor('history.state?.yoseGuard === true');
		await d.evaluate('history.back()');
		await d.waitFor('location.pathname === "/away.html"');
	});

	it('cancels a different-page navigation and requires PIN after a BFCache restoration', async () => {
		const d = fixture.driver;
		await d.fill('#input-memo', '離脱を取消'); d.nextConfirmAccept = false;
		await d.send('Page.navigate', { url: d.origin + '/manifest.json' }, d.sessionId);
		await d.waitFor(async () => d.dialogs.some(dialog => dialog.type === 'beforeunload'));
		assert.equal(await value(d, '#input-memo'), '離脱を取消');
		await d.evaluate('dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })); dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));');
		await d.waitFor('!document.getElementById("auth-screen").classList.contains("hidden")');
		assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'), false);
	});

	it('does not ask twice when an application update has already been confirmed', async () => {
		const d = fixture.driver;
		await settings(d); await d.click('#btn-force-cache-clear');
		await d.waitFor('document.getElementById("auth-pin-container")?.style.display === "block"');
		assert.equal(d.dialogs.filter(dialog => dialog.type === 'beforeunload').length, 0);
	});

	it('ignores excluded, cancelled, short, and multi-touch swipes and does not wrap tab ends', async () => {
		const d = fixture.driver;
		await d.evaluate(`
			window.__swipe = (selector, options = {}) => {
				const el = document.querySelector(selector);
				const startX = options.edge ? 1 : 500;
				const make = (x, id = 1) => new Touch({ identifier: id, target: el, clientX: x, clientY: 100 });
				el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: options.multi ? [make(startX), make(startX + 10, 2)] : [make(startX)] }));
				el.dispatchEvent(new TouchEvent(options.cancel ? 'touchcancel' : 'touchend', { bubbles: true, changedTouches: [make(startX + (options.dx ?? -150))], touches: [] }));
			};
			const scroll = document.createElement('div'); scroll.id = 'swipe-scroll'; scroll.style.cssText = 'width:100px;overflow-x:auto'; scroll.innerHTML = '<div style="width:1000px">scroll</div>'; document.body.append(scroll);
		`);
		for (const [target, options] of [['#input-memo', {}], ['#swipe-scroll div', {}], ['header .brand', { edge: true }], ['header .brand', { cancel: true }], ['header .brand', { multi: true }], ['header .brand', { dx: -10 }], ['header .brand', { dx: 150 }]]) {
			await d.evaluate(`window.__swipe(${JSON.stringify(target)}, ${JSON.stringify(options)})`);
			assert.equal(await d.evaluate('document.querySelector(".tab-btn.active").dataset.tab'), 'tab-input');
		}
		await d.click('#btn-open-tax-calc'); await d.evaluate('window.__swipe("header .brand")');
		assert.equal(await d.evaluate('document.querySelector(".tab-btn.active").dataset.tab'), 'tab-input');
		await d.click('#btn-close-tax-modal');
		await d.click('.tab-btn[data-analytics-target="cashflow"]');
		await d.evaluate('window.__swipe("#summary-chart")');
		assert.equal(await d.evaluate('document.querySelector(".tab-btn.active").dataset.analyticsTarget'), 'cashflow');
		await settings(d); await d.evaluate('window.__swipe("header .brand")');
		assert.equal(await d.evaluate('document.querySelector(".tab-btn.active").dataset.tab'), 'tab-settings');
	});
});
