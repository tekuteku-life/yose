import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, transaction, seed, records, value, cashflow, submit, dialogs, settings, waitForDialog } from '../helpers/ui_fixture.js';

describe('Transaction workflows and regressions', { timeout: 120000 }, () => {
	const fixture = useBrowser();

	it('registers income, transfers, and independent accounting / actual categories', async () => {
		const d = fixture.driver;
		await d.select('#input-type', 'income');
		assert.equal(await value(d, '#select-category'), 'cat_income_main');
		await d.fill('#input-amount', '300000');
		await d.select('#select-account', 'acc_bank_main');
		await d.fill('#input-memo', '給与');
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 1)()');
		const [income] = await records(d);
		assert.equal(income.type, 'income');
		assert.equal(income.account_id, 'acc_bank_main');
		assert.equal(income.actual_category_id, 'cat_income_main');

		await d.select('#input-type', 'transfer');
		assert.equal(await d.isVisible('#group-to-account'), true);
		assert.equal(await d.isVisible('#category-selection-container'), false);
		await d.fill('#input-amount', '1000');
		await d.select('#select-account', 'acc_bank_main');
		await d.select('#select-to-account', 'acc_wallet');
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 2)()');
		const transfer = (await records(d)).find(t => t.type === 'transfer');
		assert.equal(transfer.to_account_id, 'acc_wallet');
		assert.equal(transfer.category_id, null);

		await d.select('#input-type', 'expense');
		await d.click('#chk-sync-actual-category');
		assert.equal(await d.isVisible('#actual-category-container'), true);
		await d.select('#select-category', 'cat_social');
		await d.select('#select-subcategory', '');
		await d.select('#select-actual-category', 'cat_food');
		await d.select('#select-actual-subcategory', 'sub_dining_out');
		await d.fill('#input-amount', '2000');
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 3)()');
		const expense = (await records(d)).find(t => t.type === 'expense');
		assert.equal(expense.category_id, 'cat_social');
		assert.equal(expense.subcategory_id, null);
		assert.equal(expense.actual_category_id, 'cat_food');
		assert.equal(expense.actual_subcategory_id, 'sub_dining_out');
	});

	for (const mode of ['advance', 'prepaid', 'point', 'normal']) {
		it(`rebuilds expense categories when switching from income using the ${mode} mode button`, async () => {
			const d = fixture.driver;
			await d.select('#input-type', 'income');
			if (mode === 'normal') await d.click('.mode-tab-btn[data-mode="repay"]');
			await d.click(`.mode-tab-btn[data-mode="${mode}"]`);
			assert.equal(await value(d, '#input-type'), mode === 'normal' ? 'expense' : mode);
			assert.equal(await value(d, '#select-category'), 'cat_food');
			const options = await d.evaluate('Array.from(document.getElementById("select-category").options, o => o.value)');
			assert.equal(options.includes('cat_income_main'), false);
			assert.equal(await d.isVisible('#category-selection-container'), true);
		});
	}

	for (const [mode, field, message] of [
		['normal', '#input-amount', '金額を入力'],
		['advance', '#input-self-amount', '自己負担額または立替額'],
		['repay', '#input-repay-amount', '回収額'],
		['prepaid', '#input-prepaid-total', '一括支払総額'],
		['point', '#input-point-total', '購入総額']
	]) {
		it(`rejects empty amounts in ${mode} mode without saving or clearing the memo`, async () => {
			const d = fixture.driver;
			await d.click(`.mode-tab-btn[data-mode="${mode}"]`);
			await d.fill(field, '');
			await d.fill('#input-memo', '未保存メモ');
			await d.click('#btn-save-tx');
			await waitForDialog(d, message);
			assert.equal((await records(d)).length, 0);
			assert.equal(await value(d, '#input-memo'), '未保存メモ');
		});
	}

	it('uses native form validation for negative, fractional, and missing-date input', async () => {
		const d = fixture.driver;
		for (const amount of ['-1', '0.5']) {
			await d.fill('#input-amount', amount);
			await d.click('#btn-save-tx');
			assert.equal(await d.evaluate('document.getElementById("input-amount").validity.valid'), false);
			assert.equal((await records(d)).length, 0);
		}
		await d.fill('#input-amount', '10');
		await d.fill('#input-date', '');
		await d.click('#btn-save-tx');
		assert.equal(await d.evaluate('document.getElementById("input-date").validity.valueMissing'), true);
		assert.equal((await records(d)).length, 0);
	});

	for (const pointAccount of ['', 'acc_point']) {
		it(`registers point payments with ${pointAccount || 'offset income'} and preserves the purchase total`, async () => {
			const d = fixture.driver;
			await d.select('#input-type', 'point');
			await d.fill('#input-point-total', '1200');
			await d.fill('#input-point-used', '200');
			await d.select('#select-point-account', pointAccount);
			assert.equal(await d.textContent('#display-point-self-amount'), '¥1,000');
			await d.click('#btn-save-tx');
			await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 2)()');
			const txs = await records(d);
			assert.equal(txs[0].related_tx_id, txs[1].id);
			assert.equal(txs[1].related_tx_id, txs[0].id);
			assert.ok(txs.every(t => t.is_point_split === true));
			assert.equal(await d.evaluate('document.querySelectorAll("#recent-tx-list .badge-point").length'), 2);
			if (pointAccount) {
				assert.equal(txs.reduce((s, t) => s + t.amount, 0), 1200);
				assert.equal(txs.find(t => t.account_id === 'acc_point').amount, 200);
			} else {
				assert.equal(txs.find(t => t.type === 'expense').amount, 1200);
				assert.equal(txs.find(t => t.type === 'income').amount, 200);
			}
			assert.equal(await d.textContent('#display-point-self-amount'), '¥0');
		});
	}

	it('records advance self / lent amounts, manual repayment, and one-click settlement', async () => {
		const d = fixture.driver;
		await d.select('#input-type', 'advance');
		await d.fill('#input-self-amount', '1000');
		await d.fill('#input-adv-amount', '2000');
		await d.fill('#input-memo', '立替テスト');
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 2)()');
		const initial = await records(d);
		assert.equal(initial.find(t => t.type === 'expense').amount, 1000);
		const advance = initial.find(t => t.to_account_id === 'acc_receivable');
		assert.equal(advance.amount, 2000);
		await d.select('#input-type', 'repay');
		await d.select('#select-account', 'acc_bank_main');
		await d.fill('#input-repay-amount', '100');
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 3)()');
		assert.equal((await records(d)).find(t => t.account_id === 'acc_receivable').to_account_id, 'acc_bank_main');
		await d.select('#select-account', 'acc_bank_main');
		await d.click('.btn-settle-advance');
		await d.waitFor('document.getElementById("unsettled-advance-count").textContent === "0件"');
		const txs = await records(d);
		assert.equal(txs.find(t => t.id === advance.id).settlement_status, 'settled');
		assert.ok(txs.some(t => t.account_id === 'acc_receivable' && t.amount === 2000 && t.to_account_id === 'acc_bank_main'));
	});

	it('saves all ordinary edit fields without an installment confirmation', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('ordinary')]);
		await cashflow(d);
		await d.click('#month-tx-list .tx-item[data-id="ordinary"]');
		await d.fill('#edit-tx-date', '2026-11-02');
		await d.select('#edit-tx-account', 'acc_bank_main');
		await d.select('#edit-tx-status', 'planned');
		await d.fill('#edit-tx-amount', '222');
		await d.fill('#edit-tx-memo', '保存後');
		await d.fill('#edit-tx-tags', '編集, 確認');
		await d.select('#edit-tx-subcategory', '');
		await d.select('#edit-tx-actual-subcategory', '');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		const [tx] = await records(d);
		assert.equal(tx.date, '2026-11-02');
		assert.equal(tx.target_month, '2026-11');
		assert.equal(tx.account_id, 'acc_bank_main');
		assert.equal(tx.status, 'planned');
		assert.equal(tx.amount, 222);
		assert.equal(tx.memo, '保存後');
		assert.equal(tx.subcategory_id, null);
		assert.equal(tx.actual_subcategory_id, null);
		assert.deepEqual(tx.tags, ['編集', '確認']);
		assert.equal((await dialogs(d)).filter(x => x.type === 'confirm').length, 0);
	});

	it('cancels editing and deletion, then soft-deletes without opening the edit modal', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('cancel')]);
		await cashflow(d);
		await d.click('#month-tx-list .tx-item[data-id="cancel"]');
		await d.fill('#edit-tx-memo', '破棄');
		await d.click('#btn-close-edit-tx');
		assert.equal((await records(d))[0].memo, 'cancel');
		await d.setConfirm(false);
		await d.click('#month-tx-list .btn-delete-tx[data-id="cancel"]');
		assert.equal((await records(d))[0].is_deleted, false);
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
		await d.setConfirm(true);
		await d.click('#month-tx-list .btn-delete-tx[data-id="cancel"]');
		await d.waitFor('!document.querySelector("#month-tx-list .tx-item")');
		assert.equal((await records(d))[0].is_deleted, true);
		assert.equal((await records(d))[0].sync_status, 'unsynced');
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
	});

	async function prepaid(d) {
		await d.select('#input-type', 'prepaid');
		await d.fill('#input-prepaid-total', '1001');
		await d.fill('#input-prepaid-months', '3');
		await d.select('#select-category', 'cat_housing');
		await d.select('#select-subcategory', 'sub_utilities');
		await d.fill('#input-memo', '年払い');
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 4)()');
		await cashflow(d);
		return records(d);
	}

	it('preserves child classification and totals when only the prepaid parent memo is edited', async () => {
		const d = fixture.driver;
		const initial = await prepaid(d);
		const parent = initial.find(t => t.amortization_meta?.is_payment_record);
		await d.click(`#month-tx-list .tx-item[data-id="${parent.id}"]`);
		await d.fill('#edit-tx-memo', '年払い更新');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		const txs = await records(d);
		const children = txs.filter(t => t.type === 'expense');
		assert.equal(txs.find(t => t.id === parent.id).amount, 1001);
		assert.equal(children.reduce((s, t) => s + t.amount, 0), 1001);
		for (const child of children) {
			assert.equal(child.category_id, 'cat_housing');
			assert.equal(child.subcategory_id, 'sub_utilities');
			assert.equal(child.actual_category_id, 'cat_housing');
		}
	});

	it('preserves the exact total and remainder when only a prepaid child memo is edited', async () => {
		const d = fixture.driver;
		const initial = await prepaid(d);
		const child = initial.find(t => t.type === 'expense' && t.target_month === '2026-10');
		await d.click(`#month-tx-list .tx-item[data-id="${child.id}"]`);
		await d.fill('#edit-tx-memo', '子メモ更新');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		const txs = await records(d);
		assert.equal(txs.find(t => t.amortization_meta?.is_payment_record).amount, 1001);
		assert.deepEqual(txs.filter(t => t.type === 'expense').map(t => t.amount).sort(), initial.filter(t => t.type === 'expense').map(t => t.amount).sort());
	});

	it('redistributes an explicitly changed prepaid amount and can edit one child without cascading', async () => {
		const d = fixture.driver;
		const initial = await prepaid(d);
		const child = initial.find(t => t.type === 'expense' && t.target_month === '2026-10');
		await d.click(`#month-tx-list .tx-item[data-id="${child.id}"]`);
		await d.fill('#edit-tx-amount', '400');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		let txs = await records(d);
		assert.equal(txs.find(t => t.amortization_meta?.is_payment_record).amount, 1200);
		assert.deepEqual(txs.filter(t => t.type === 'expense').map(t => t.amount), [400, 400, 400]);
		assert.ok(txs.every(t => t.amortization_meta.total_amount === 1200));
		await d.click(`#month-tx-list .tx-item[data-id="${child.id}"]`);
		await d.setConfirm(false);
		await d.fill('#edit-tx-memo', '単独変更');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		txs = await records(d);
		assert.equal(txs.find(t => t.id === child.id).memo, '単独変更');
		assert.equal(txs.filter(t => t.id !== child.id).some(t => t.memo.includes('単独変更')), false);
	});

	it('supports calculator arithmetic, tax modes, backspace, cancellation, and edit amount targeting', async () => {
		const d = fixture.driver;
		await d.fill('#input-amount', '100');
		await d.click('#btn-open-tax-calc');
		await d.click('.calc-btn[data-calc-action="clear"]');
		for (const char of ['2', '+', '3', '×', '4']) await d.click(`.calc-btn[data-calc-insert="${char}"]`);
		await d.click('.calc-btn[data-calc-action="equals"]');
		assert.equal(await d.textContent('#calc-result-display'), '¥14');
		await d.click('.calc-btn[data-calc-action="backspace"]');
		assert.equal(await d.textContent('#calc-result-display'), '¥1');
		await d.click('#btn-close-tax-modal');
		assert.equal(await value(d, '#input-amount'), '100');
		for (const [amount, action, expected] of [['100', 'add8', '108'], ['108', 'sub8', '108'], ['110', 'sub10', '110']]) {
			await d.fill('#input-amount', amount);
			await d.click('#btn-open-tax-calc');
			await d.click(`.calc-btn[data-calc-tax="${action}"]`);
			await d.click('#btn-apply-tax');
			assert.equal(await value(d, '#input-amount'), expected);
		}
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 1)()');
		const [tx] = await records(d);
		assert.ok(tx.tax_meta);
		await d.click(`#recent-tx-list .tx-item[data-id="${tx.id}"]`);
		await d.click('#btn-edit-open-tax-calc');
		await d.click('.calc-btn[data-calc-tax="add10"]');
		await d.click('#btn-apply-tax');
		assert.equal(await value(d, '#edit-tx-amount'), '121');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		const edited = (await records(d))[0];
		assert.equal(edited.amount, 121);
		assert.equal(edited.tax_meta.base_amount, 110);
		assert.equal(edited.tax_meta.tax_amount, 11);
		assert.equal(edited.tax_meta.tax_rate, 0.1);
		await d.click(`#recent-tx-list .tx-item[data-id="${tx.id}"]`);
		await d.fill('#edit-tx-amount', '150');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		assert.equal((await records(d))[0].tax_meta, null);
		assert.equal(await value(d, '#input-amount'), '');
	});

	it('supports tag keyboard operations, deduplication, removal, and escaped memo / tag rendering', async () => {
		const d = fixture.driver;
		await d.fill('#input-tag-text', '重複');
		await d.fill('#input-tag-text', '重複');
		assert.equal(await d.evaluate('document.querySelectorAll(".tag-chip").length'), 1);
		await d.evaluate('document.getElementById("input-tag-text").value = "追加"');
		await d.key('#input-tag-text', 'Enter');
		assert.equal(await d.evaluate('document.querySelectorAll(".tag-chip").length'), 2);
		await d.key('#input-tag-text', 'Backspace');
		assert.equal(await d.evaluate('document.querySelectorAll(".tag-chip").length'), 1);
		await d.click('.tag-chip-del');
		assert.equal(await value(d, '#input-tags'), '');
		const payload = '<img src=x onerror="window.__xss=1">';
		await d.fill('#input-memo', payload);
		await d.fill('#input-tag-text', payload);
		await d.fill('#input-amount', '100');
		await d.click('#btn-save-tx');
		await d.waitFor('document.querySelector("#recent-tx-list .tx-item") !== null');
		assert.ok((await d.textContent('#recent-tx-list')).includes(payload));
		assert.equal(await d.evaluate('Boolean(window.__xss) || !!document.querySelector("#recent-tx-list img")'), false);
		await d.click('#input-memo');
		assert.equal(await d.isVisible('#memo-suggest-dropdown'), true);
		await d.key('#input-memo', 'Escape');
		assert.equal(await d.isVisible('#memo-suggest-dropdown'), false);
		await d.click('#input-tag-text');
		assert.equal(await d.isVisible('#tags-suggest-dropdown'), true);
		await d.key('#input-tag-text', 'Escape');
		assert.equal(await d.isVisible('#tags-suggest-dropdown'), false);
	});

	it('rejects a wrong PIN after reload, unlocks with Enter, and preserves encrypted data', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('persist')]);
		await d.navigate();
		assert.equal(await d.isVisible('#auth-screen'), true);
		assert.equal(await d.isVisible('#auth-setup-container'), false);
		assert.equal(await d.evaluate('window.__yose_app.db.encryptionKey'), null);
		await d.fill('#auth-pin-input', '9999');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-error-msg").textContent.includes("正しくありません")');
		assert.equal(await d.isVisible('#auth-screen'), true);
		await d.fill('#auth-pin-input', '1234');
		await d.key('#auth-pin-input', 'Enter');
		await d.waitFor('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden")');
		assert.equal((await records(d))[0].id, 'persist');
		const raw = await d.evaluate('window.__yose_app.db.getRaw("transactions", "persist")');
		assert.equal(raw.memo, undefined);
		assert.ok(raw.ciphertext);
	});
	it('keeps real CryptoKeys in the active session and clears them when locked', async () => {
		const d = fixture.driver;
		assert.equal(await d.evaluate(`(async () => {
			const { getActiveSession } = await import('./js/crypto.js');
			const session = getActiveSession();
			return session.dmk === window.__yose_app.db.encryptionKey && session.privateKey === window.__yose_app.privateKey;
		})()`), true);
		await settings(d);
		await d.click('#btn-toggle-key-details');
		await d.click('#btn-lock-now');
		assert.equal(await d.evaluate(`(async () => (await import('./js/crypto.js')).getActiveSession())()`), null);
	});

	it('converts an ordinary expense to a transfer and then income with the selected classifications', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('convert')]);
		await cashflow(d);
		await d.click('#month-tx-list .tx-item[data-id="convert"]');
		await d.select('#edit-tx-type', 'transfer');
		await d.select('#edit-tx-to-account', 'acc_bank_main');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		let tx = (await records(d))[0];
		assert.equal(tx.type, 'transfer');
		assert.equal(tx.to_account_id, 'acc_bank_main');
		assert.equal(tx.category_id, null);
		await d.click('#month-tx-list .tx-item[data-id="convert"]');
		await d.select('#edit-tx-type', 'income');
		await d.select('#edit-tx-category', 'cat_income_main');
		await d.select('#edit-tx-subcategory', 'sub_salary');
		await d.select('#edit-tx-actual-category', 'cat_point_income');
		await d.select('#edit-tx-actual-subcategory', 'sub_point_reward');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		tx = (await records(d))[0];
		assert.equal(tx.type, 'income');
		assert.equal(tx.to_account_id, null);
		assert.equal(tx.category_id, 'cat_income_main');
		assert.equal(tx.subcategory_id, 'sub_salary');
		assert.equal(tx.actual_category_id, 'cat_point_income');
		assert.equal(tx.actual_subcategory_id, 'sub_point_reward');
	});

	it('saves the prepaid parent date, account, and status while preserving its child schedule', async () => {
		const d = fixture.driver;
		const initial = await prepaid(d);
		const parent = initial.find(t => t.amortization_meta.is_payment_record);
		await d.click(`#month-tx-list .tx-item[data-id="${parent.id}"]`);
		await d.fill('#edit-tx-date', '2026-10-21');
		await d.select('#edit-tx-account', 'acc_bank_main');
		await d.select('#edit-tx-status', 'planned');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		const txs = await records(d);
		const updated = txs.find(t => t.id === parent.id);
		assert.equal(updated.date, '2026-10-21');
		assert.equal(updated.account_id, 'acc_bank_main');
		assert.equal(updated.status, 'planned');
		assert.deepEqual(txs.filter(t => t.type === 'expense').map(t => [t.date, t.account_id, t.status]), initial.filter(t => t.type === 'expense').map(t => [t.date, t.account_id, t.status]));
	});

	it('sends retroactive requests for the closed members of an edited prepaid group', async () => {
		const d = fixture.driver;
		const gasUrl = 'https://yose.local/mock-gas';
		const snapshot = { schema_version: 2, last_closed_month: '2026-09', account_balances: {}, monthly_summaries: { '2026-09': { expense_total: 400 } } };
		d.responses.set('/mock-gas', { json: { success: true, snapshot } });
		await d.fill('#input-date', '2026-09-20');
		await prepaid(d);
		const txs = await records(d);
		const currentChild = txs.find(t => t.type === 'expense' && t.target_month === '2026-10');
		await settings(d);
		await d.fill('#input-gas-url', gasUrl);
		await d.click('#btn-save-gas-url');
		await waitForDialog(d, 'URLを保存');
		await cashflow(d);
		await d.click(`#month-tx-list .tx-item[data-id="${currentChild.id}"]`);
		await d.fill('#edit-tx-amount', '400');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		await d.waitFor(async () => {
			const sent = d.requests.filter(r => r.url === gasUrl && r.method === 'POST').map(r => JSON.parse(r.body));
			return sent.filter(r => r.action === 'retroactive_update').length === 2 && sent.at(-1)?.action === 'push_diff' && !(await d.evaluate('window.__yose_app.syncManager.isSyncing'));
		});
		assert.equal((await d.evaluate('window.__yose_app.db.getSnapshot()')).monthly_summaries['2026-09'].expense_total, 400);
		const requests = d.requests.filter(r => r.url === gasUrl && r.method === 'POST').map(r => JSON.parse(r.body));
		const retro = requests.filter(r => r.action === 'retroactive_update');
		assert.deepEqual(retro.map(r => r.payload.transaction.id).sort(), txs.filter(t => t.target_month === '2026-09').map(t => t.id).sort());
		assert.ok(retro.every(r => r.signature && r.payload.transaction.sync_status === 'unsynced'));
	});

});
