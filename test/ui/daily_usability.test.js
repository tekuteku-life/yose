import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, cashflow, settings, submit, waitForDialog, value } from '../helpers/ui_fixture.js';

describe('Daily usability improvements', { timeout: 120000 }, () => {
	const fixture = useBrowser();
	const gasUrl = 'https://yose.local/usability-gas';
	async function gas(d, response) {
		d.responses.set('/usability-gas', { json: response });
		await settings(d);
		await d.fill('#input-gas-url', gasUrl);
		await d.click('#btn-save-gas-url');
		await waitForDialog(d, 'URLを保存');
	}

	for (const [mode, count] of [['normal', 1], ['advance', 2], ['repay', 1], ['prepaid', 13], ['point', 2]]) {
		it(`confirms blank ${mode} amounts and saves only unknown planned records`, async () => {
			const d = fixture.driver;
			await d.click(`.mode-tab-btn[data-mode="${mode}"]`);
			await d.fill('#input-memo', '金額は後で入力');
			await d.setConfirm(false);
			await d.click('#btn-save-tx');
			await waitForDialog(d, '金額未入力');
			assert.equal((await records(d)).length, 0);
			assert.equal(await value(d, '#input-memo'), '金額は後で入力');
			await d.setConfirm(true);
			await d.click('#btn-save-tx');
			await d.waitFor(`(async () => (await window.__yose_app.db.getTransactions()).length === ${count})()`);
			assert.ok((await records(d)).every(tx => tx.status === 'planned' && tx.amount === 0 && tx.amount_pending));
			await d.waitFor('document.getElementById("recent-tx-list").textContent.includes("金額未入力")');
		});
	}

	it('retains session keys and input when reload is cancelled, and locks after an accepted reload', async () => {
		const d = fixture.driver;
		await d.fill('#input-memo', '更新を取消');
		d.nextConfirmAccept = false;
		await d.send('Page.reload', {}, d.sessionId);
		await d.waitFor(async () => d.dialogs.some(dialog => dialog.type === 'beforeunload'));
		assert.equal(await value(d, '#input-memo'), '更新を取消');
		assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'), true);
		d.nextConfirmAccept = true;
		await d.send('Page.reload', {}, d.sessionId);
		await d.waitFor('document.getElementById("auth-pin-container")?.style.display === "block"');
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
	});

	it('confirms back navigation repeatedly without losing input or adding history entries', async () => {
		const d = fixture.driver;
		await d.fill('#input-memo', '戻るを取消');
		await d.setConfirm(false);
		const length = await d.evaluate('history.length');
		for (let index = 0; index < 2; index++) {
			const before = await d.evaluate('window.__dialogs.length');
			await d.evaluate('history.back()');
			await d.waitFor(`window.__dialogs.length > ${before}`);
			await d.waitFor('history.state?.yoseGuard === true');
			assert.equal(await value(d, '#input-memo'), '戻るを取消');
			assert.equal(await d.evaluate('history.length'), length);
		}
	});

	it('registers a real standard virtual passkey and still requires PIN for decryption', async () => {
		const d = fixture.driver;
		await d.send('WebAuthn.enable', {}, d.sessionId);
		await d.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }, d.sessionId);
		await d.evaluate(`
			navigator.credentials.create = options => {
				window.__passkeyOptions = options;
				return CredentialsContainer.prototype.create.call(navigator.credentials, options);
			};
			navigator.credentials.get = async options => {
				const result = await CredentialsContainer.prototype.get.call(navigator.credentials, options);
				window.__passkeyGetCompleted = true;
				return result;
			};
		`);
		await settings(d);
		if (!await d.isVisible('#btn-register-webauthn')) await d.click('#btn-toggle-key-details');
		await d.click('#btn-register-webauthn');
		await waitForDialog(d, '登録しました');
		assert.equal(await d.evaluate('window.__passkeyOptions.publicKey.extensions.prf.eval.first.byteLength'), 32);
		assert.ok(await d.evaluate('(async () => (await window.__yose_app.db.getSecurityKey("webauthn_credential")).publicKeySpki)()'));
		assert.equal(await d.evaluate('window.__yose_app.db.getSecurityKey("webauthn_vault")'), null);
		if (!await d.isVisible('#btn-lock-now')) await d.click('#btn-toggle-key-details');
		await d.click('#btn-lock-now');
		await d.click('#btn-auth-webauthn');
		await d.waitFor('window.__passkeyGetCompleted && document.getElementById("auth-description").textContent.includes("パスキー認証が完了")');
		assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'), false);
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
	});

	for (const saveBeforeResponse of [false,true]) it(`preserves the entered GAS URL against a delayed settings read (${saveBeforeResponse ? 'after save' : 'before save'})`, async () => {
		const d=fixture.driver; await settings(d); await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		await d.evaluate(`const app=window.__yose_app,db=app.db,read=db.getSetting.bind(db);let delay=true;
			db.getSetting=async(...args)=>{const value=await read(...args);if(args[0]==='gas_url'&&delay){delay=false;await new Promise(resolve=>window.__releaseUrlRead=resolve);}return value;};
			window.__delayedSettings=app.settingsController.renderSettings(); void 0;`);
		await d.waitFor('typeof window.__releaseUrlRead === "function"');
		await d.fill('#input-gas-url',gasUrl);
		if (saveBeforeResponse) { await d.click('#btn-save-gas-url'); await waitForDialog(d,'URLを保存'); }
		await d.evaluate('window.__releaseUrlRead();window.__delayedSettings');
		assert.equal(await value(d,'#input-gas-url'),gasUrl);
		if (!saveBeforeResponse) { await d.click('#btn-save-gas-url'); await waitForDialog(d,'URLを保存'); }
		assert.equal(await d.evaluate('window.__yose_app.db.getSetting("gas_url")'),gasUrl);
		assert.equal(await d.evaluate('window.__yose_app.syncManager.gasUrl'),gasUrl);
		await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		assert.equal(await value(d,'#input-gas-url'),gasUrl);
	});
	it('keeps a new unsaved URL while an earlier submitted URL finishes saving', async () => {
		const d=fixture.driver; await settings(d); await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		await d.evaluate(`const db=window.__yose_app.db,save=db.setSetting.bind(db);db.setSetting=async(...args)=>{if(args[0]==='gas_url')await new Promise(resolve=>window.__finishUrlSave=resolve);return save(...args);};`);
		await d.fill('#input-gas-url',gasUrl); await d.click('#btn-save-gas-url'); await d.waitFor('typeof window.__finishUrlSave === "function"');
		await d.fill('#input-gas-url',gasUrl+'-new'); await d.evaluate('window.__finishUrlSave()'); await waitForDialog(d,'URLを保存');
		assert.equal(await d.evaluate('window.__yose_app.db.getSetting("gas_url")'),gasUrl);
		assert.equal(await d.evaluate('window.__yose_app.syncManager.gasUrl'),gasUrl);
		assert.equal(await value(d,'#input-gas-url'),gasUrl+'-new');
		await d.evaluate('window.__yose_app.settingsController.renderSettings()');
		assert.equal(await value(d,'#input-gas-url'),gasUrl+'-new');
	});
	it('downloads remote records from manual sync while preserving local uploads', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('local_upload')]);
		await gas(d, { success: true, pending_diffs: [transaction('remote_download')], archived_transactions: [], archive_months: [], snapshot: { schema_version: 2, last_closed_month: '2026-09', account_balances: {}, monthly_summaries: {} } });
		await d.click('#btn-header-sync');
		await d.waitFor('window.__dialogs.some(dialog => /^(差分同期完了:|同期に失敗しました:)/.test(dialog.message))');
		const completion = await d.evaluate('window.__dialogs.find(dialog => /^(差分同期完了:|同期に失敗しました:)/.test(dialog.message)).message');
		assert.match(completion, /^差分同期完了:/, completion);
		await d.waitFor('!window.__yose_app.syncManager.isSyncing');
		assert.deepEqual((await records(d)).map(tx => tx.id).sort(), ['local_upload', 'remote_download']);
		const actions = d.requests.filter(r => r.url === gasUrl).map(r => JSON.parse(r.body).action);
		assert.deepEqual(actions, ['fetch_state', 'fetch_master', 'push_diff', 'fetch_state']);
	});

	it('refuses to close unknown amounts and does not confirm them locally on network failure', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('unknown', { amount: 0, amount_pending: true, status: 'planned' })]);
		await cashflow(d);
		await d.click('#btn-close-month');
		await waitForDialog(d, '金額未入力');
		assert.equal((await records(d))[0].status, 'planned');
		await seed(d, [transaction('unknown', { amount: 200, amount_pending: false, status: 'planned' })]);
		await d.click('#btn-close-month');
		await waitForDialog(d, '未確定');
		await waitForDialog(d, '月締めに失敗');
		assert.equal((await records(d))[0].status, 'planned');
	});

	it('cancels a closed-month edit before writing and then recloses only after approval', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('closed', { date: '2026-09-20', target_month: '2026-09', sync_status: 'synced' })]);
		await gas(d, { success: true });
		await cashflow(d);
		await d.fill('#input-period-picker', '2026-09');
		await d.waitFor('document.querySelector("#month-tx-list [data-id=closed]") !== null');
		await d.click('#month-tx-list [data-id="closed"]');
		await d.fill('#edit-tx-amount', '222');
		await d.setConfirm(false);
		await submit(d, '#edit-tx-form');
		await waitForDialog(d, '再月締め');
		assert.equal((await records(d))[0].amount, 100);
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		await d.setConfirm(true);
		await submit(d, '#edit-tx-form');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransaction("closed")).sync_status === "synced")()');
		assert.equal((await records(d))[0].amount, 222);
	});

	it('selects all four asset periods and keeps the previous chart when the range is invalid', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async () => {
			const db = window.__yose_app.db; const config = await db.getMasterConfig();
			for (const account of config.accounts) account.initial_balance = account.id === 'acc_wallet' ? 1000 : 0;
			await db.saveMasterConfig(config);
			await db.saveSnapshot({ schema_version: 2, last_closed_month: '2026-09', account_balances: { acc_wallet: 1000 }, monthly_summaries: { '2025-12': { closing_balances: { acc_wallet: 800 } }, '2026-07': { closing_balances: { acc_wallet: 900 } }, '2026-09': { closing_balances: { acc_wallet: 1000 } } } });
		})()`);
		await seed(d, [transaction('asset_exp', { date: '2026-10-05', amount: 100 }), transaction('asset_inc', { date: '2026-10-15', type: 'income', amount: 200, category_id: 'cat_income_main', actual_category_id: 'cat_income_main' }), transaction('asset_plan', { amount: 500, status: 'planned' })]);
		await d.click('.tab-btn[data-analytics-target="assets"]');
		for (const mode of ['month', 'year', 'range', 'all']) {
			await d.select('#select-asset-period', mode);
			if (mode === 'range') {
				await d.fill('#asset-period-start', '2026-10-10');
				await d.fill('#asset-period-end', '2026-10-20');
				await d.click('#btn-apply-asset-period');
			}
			await d.waitFor(`document.getElementById('asset-history-card').dataset.period === '${mode}'`);
			assert.equal(await d.isVisible('#asset-history-card'), true);
			const chart = await d.evaluate('window.__yose_app.chartController.assetHistoryChart.config');
			assert.equal(chart.type, 'line');
			assert.equal(chart.data.datasets[0].data.at(-1), 1100);
			assert.equal(chart.data.labels.at(-1), '2026-10-20');
			if (mode === 'month') assert.equal(chart.data.labels[0], '2026-10-01');
			if (mode === 'all') assert.equal(chart.data.labels[0], '2025-12-31');
			if (mode === 'year') assert.equal(chart.data.labels[0], '2026-07-31');
			if (mode === 'range') { assert.equal(chart.data.labels[0], '2026-10-10'); assert.equal(chart.data.datasets[0].data[0], 900); }
			if (mode === 'year') {
				await d.click('#btn-period-prev');
				await d.waitFor('window.__yose_app.selectedYear === "2025" && window.__yose_app.chartController.assetHistoryChart.data.labels.at(-1) === "2025-12-31"');
				assert.equal(await d.evaluate('window.__yose_app.chartController.assetHistoryChart.data.datasets[0].data.at(-1)'), 800);
				await d.click('#btn-period-next');
				await d.waitFor('window.__yose_app.selectedYear === "2026" && window.__yose_app.chartController.assetHistoryChart.data.labels.at(-1) === "2026-10-20"');
			}
		}
		await d.select('#select-asset-period', 'range');
		const before = await d.evaluate('JSON.stringify(window.__yose_app.chartController.assetHistoryChart.config)');
		await d.fill('#asset-period-start', '2026-10-20');
		await d.fill('#asset-period-end', '2026-10-01');
		await d.click('#btn-apply-asset-period');
		await waitForDialog(d, '期間');
		assert.equal(await d.evaluate('JSON.stringify(window.__yose_app.chartController.assetHistoryChart.config)'), before);
	});
	it('restores a newer server record when an older closed-month deletion conflicts', async () => {
		const d = fixture.driver;
		const original = transaction('delete_conflict', { date: '2026-09-20', target_month: '2026-09', sync_status: 'synced' });
		await seed(d, [original]);
		await gas(d, { success: true, accepted_ids: [], conflicts: [{ ...original, amount: 999, is_deleted: false, updated_at: '2026-10-22T00:00:00Z' }] });
		await cashflow(d); await d.fill('#input-period-picker', '2026-09');
		await d.waitFor('document.querySelector("#month-tx-list [data-id=delete_conflict]") !== null');
		await d.click('#month-tx-list [data-id="delete_conflict"]');
		await d.waitFor('document.querySelector("#modal-edit-tx").classList.contains("active") && document.querySelector("#edit-tx-id").value==="delete_conflict" && window.__yose_app.txEditController.originalTransaction?.id==="delete_conflict" && document.querySelector("#btn-edit-delete-tx").checkVisibility({checkVisibilityCSS:true})');
		await d.evaluate('(()=>{const owner=window.__yose_app.txEditController,remove=owner.handleEditDelete;owner.handleEditDelete=function(...args){return window.__conflictDeletion=remove.apply(this,args);};})()');
		await d.click('#btn-edit-delete-tx');
		await d.evaluate('window.__conflictDeletion');
		await d.evaluate('window.__yose_app._transactionMaintenanceTask?.promise');
		assert.equal(await d.evaluate('document.getElementById("modal-edit-tx").classList.contains("active")'), false);
		const [latest] = await records(d);
		assert.equal(latest.amount, 999); assert.equal(latest.is_deleted, false);
		assert.match(await d.textContent('#month-tx-list [data-id="delete_conflict"]'), /999/);
	});

	it('moves adjacent tabs with real horizontal touch and ignores vertical touch', async () => {
		const d = fixture.driver;
		async function swipe(dx, dy) {
			await d.evaluate('window.scrollTo(0, 0)');
			const touch = (x, y) => [{ x, y, id: 1 }];
			await d.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(500, 40) }, d.sessionId);
			await d.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touch(500 + dx, 40 + dy) }, d.sessionId);
			await d.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, d.sessionId);
		}
		await swipe(-160, 5);
		await d.waitFor('document.querySelector(".tab-btn.active").dataset.analyticsTarget === "cashflow"');
		await swipe(5, 120);
		assert.equal(await d.evaluate('document.querySelector(".tab-btn.active").dataset.analyticsTarget'), 'cashflow');
		await swipe(-160, 5);
		await d.waitFor('document.querySelector(".tab-btn.active").dataset.analyticsTarget === "budget"');
		await swipe(160, 5);
		await d.waitFor('document.querySelector(".tab-btn.active").dataset.analyticsTarget === "cashflow"');
	});
	it('keeps asset month navigation independent of cashflow yearly granularity', async () => {
		const d = fixture.driver;
		await cashflow(d); await d.click('#control-granularity [data-granularity="yearly"]');
		await d.click('.tab-btn[data-analytics-target="assets"]'); await d.select('#select-asset-period', 'month');
		await d.click('#btn-period-prev'); await d.waitFor('window.__yose_app.currentMonth === "2026-09"');
		await d.click('#btn-period-next'); await d.waitFor('window.__yose_app.currentMonth === "2026-10"');
	});
});
