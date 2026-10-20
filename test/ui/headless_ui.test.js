/**
 * Headless Chromium End-to-End UI Test Suite
 * Executes real browser DOM interactions, events, modals, charts, and IndexedDB/WebCrypto flows.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessBrowserDriver } from '../helpers/cdp_driver.js';

describe('Headless Chrome Comprehensive UI Test Suite', () => {
	let driver;

	before(async () => {
		driver = new HeadlessBrowserDriver();
		await driver.launch();
		await driver.navigate('/index.html');
	});

	after(async () => {
		if (driver) {
			await driver.close();
		}
	});

	it('1. Initial Auth Setup Gate & Lock/Unlock Lifecycle', async () => {
		// Auth screen should be visible in initial setup mode
		assert.equal(await driver.isVisible('#auth-screen'), true);
		assert.equal(await driver.isVisible('#auth-setup-container'), true);
		assert.equal(await driver.textContent('#auth-title'), 'よせあつめ家計簿 - 初期設定');

		// Short PIN (< 4 digits) should trigger validation error
		await driver.fill('#auth-setup-pin', '12');
		await driver.click('#btn-auth-setup');
		assert.equal(await driver.isVisible('#auth-error-msg'), true);
		const errText = await driver.textContent('#auth-error-msg');
		assert.ok(errText.includes('4桁以上'));

		// Valid PIN (1234) initializes DMK & Ed25519 keys and unlocks app
		await driver.fill('#auth-setup-pin', '1234');
		await driver.click('#btn-auth-setup');

		// Wait for async WebCrypto key generation and DB init
		for (let i = 0; i < 40; i++) {
			if (!(await driver.isVisible('#auth-screen'))) break;
			await new Promise(r => setTimeout(r, 100));
		}
		if (await driver.isVisible('#auth-screen')) {
			const debugErr = await driver.textContent('#auth-error-msg');
			console.error('DEBUG auth-error-msg:', debugErr, 'pageErrors:', driver.pageErrors, 'consoleErrors:', driver.consoleErrors);
		}
		assert.equal(await driver.isVisible('#auth-screen'), false);
		assert.equal(await driver.isVisible('#tab-input'), true);

		// Navigate to Settings, open key details if collapsed, click Lock Now (#btn-lock-now), and unlock with PIN
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		assert.equal(await driver.isVisible('#tab-settings'), true);
		await new Promise(r => setTimeout(r, 100));
		if (!(await driver.isVisible('#key-mgmt-details'))) {
			await driver.click('#btn-toggle-key-details');
		}
		await driver.click('#btn-lock-now');
		assert.equal(await driver.isVisible('#auth-screen'), true);
		assert.equal(await driver.isVisible('#auth-pin-container'), true);

		await driver.fill('#auth-pin-input', '1234');
		await driver.click('#btn-auth-pin');
		for (let i = 0; i < 30; i++) {
			if (!(await driver.isVisible('#auth-screen'))) break;
			await new Promise(r => setTimeout(r, 100));
		}
		assert.equal(await driver.isVisible('#auth-screen'), false);
	});

	it('2. Top 5-Tab Navigation & Exclusive KPI / Card Switching', async () => {
		// 1) Cashflow tab (💰 収支)
		await driver.click('.tab-btn[data-analytics-target="cashflow"]');
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.isVisible('#tab-summary'), true);
		assert.equal(await driver.isVisible('#cashflow-stat-grid'), true);
		assert.equal(await driver.isVisible('#budget-stat-grid'), false);
		assert.equal(await driver.isVisible('#asset-stat-grid'), false);
		assert.equal(await driver.isVisible('#card-monthly-operations'), true);
		assert.equal(await driver.isVisible('#card-month-tx-list'), true);
		assert.equal(await driver.textContent('#account-balances-title'), '口座別支出（収支）');

		// 2) Budget tab (🎯 予算・実績)
		await driver.click('.tab-btn[data-analytics-target="budget"]');
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.isVisible('#tab-summary'), true);
		assert.equal(await driver.isVisible('#budget-stat-grid'), true);
		assert.equal(await driver.isVisible('#cashflow-stat-grid'), false);
		assert.equal(await driver.isVisible('#asset-stat-grid'), false);
		assert.equal(await driver.isVisible('#card-monthly-operations'), false);
		assert.equal(await driver.isVisible('#card-month-tx-list'), false);
		assert.equal(await driver.textContent('#account-balances-title'), '口座別予算・実績');

		// 3) Assets tab (🏦 資産)
		await driver.click('.tab-btn[data-analytics-target="assets"]');
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.isVisible('#tab-summary'), true);
		assert.equal(await driver.isVisible('#asset-stat-grid'), true);
		assert.equal(await driver.isVisible('#cashflow-stat-grid'), false);
		assert.equal(await driver.isVisible('#budget-stat-grid'), false);
		assert.equal(await driver.isVisible('#card-monthly-operations'), false);
		assert.equal(await driver.isVisible('#card-month-tx-list'), false);
		assert.equal(await driver.textContent('#account-balances-title'), '口座別残高');

		// 4) Settings tab (⚙️ 設定・マスタ)
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		assert.equal(await driver.isVisible('#tab-settings'), true);
		assert.equal(await driver.isVisible('#tab-summary'), false);
		assert.equal(await driver.isVisible('#tab-input'), false);

		// 5) Input tab (📝 入力)
		await driver.click('.tab-btn[data-tab="tab-input"]');
		assert.equal(await driver.isVisible('#tab-input'), true);
		assert.equal(await driver.isVisible('#tab-summary'), false);
		assert.equal(await driver.isVisible('#tab-settings'), false);
	});

	it('3. Transaction Registration, Toast Notification & Recent Transactions Reflection', async () => {
		await driver.click('.tab-btn[data-tab="tab-input"]');

		// Test Quick Calculator Modal (#btn-open-tax-calc -> 1000 + 10% tax = 1100)
		await driver.click('#btn-open-tax-calc');
		assert.equal(await driver.isVisible('#modal-tax'), true);
		await driver.click('.calc-btn[data-calc-action="clear"]');
		await driver.click('.calc-btn[data-calc-insert="1"]');
		await driver.click('.calc-btn[data-calc-insert="0"]');
		await driver.click('.calc-btn[data-calc-insert="0"]');
		await driver.click('.calc-btn[data-calc-insert="0"]');
		await driver.click('.calc-btn[data-calc-tax="add10"]');
		assert.equal(await driver.textContent('#calc-result-display'), '¥1,100');
		await driver.click('#btn-apply-tax');
		assert.equal(await driver.isVisible('#modal-tax'), false);
		assert.equal(await driver.evaluate('document.getElementById("input-amount").value'), '1100');

		// Add tag chip via #input-tag-text
		await driver.fill('#input-tag-text', '週末まとめ買い');
		const chipText = await driver.textContent('#tags-chips-list');
		assert.ok(chipText.includes('週末まとめ買い'));

		// Fill memo and submit form
		await driver.fill('#input-memo', 'スーパー買い出し');
		await driver.click('#btn-save-tx');

		// Verify toast popup is active and visible immediately after registration
		const toastVisible = await driver.isVisible('#toast-notification');
		const toastText = await driver.textContent('#toast-notification');
		assert.equal(toastVisible, true);
		assert.ok(toastText.includes('登録が完了しました'));

		// Verify form fields were reset
		assert.equal(await driver.evaluate('document.getElementById("input-amount").value'), '');
		assert.equal(await driver.evaluate('document.getElementById("input-memo").value'), '');

		// Verify #recent-tx-list reflects the new transaction (Category > Subcategory, Memo, Tag, Amount)
		const recentHtml = await driver.textContent('#recent-tx-list');
		assert.ok(recentHtml.includes('食費'));
		assert.ok(recentHtml.includes('スーパー買い出し'));
		assert.ok(recentHtml.includes('#週末まとめ買い'));
		assert.ok(recentHtml.includes('-¥1,100'));

		// Register transaction with optional empty subcategory ("")
		await driver.fill('#input-amount', '500');
		await driver.select('#select-subcategory', '');
		await driver.fill('#input-memo', '中項目なしテスト');
		await driver.click('#btn-save-tx');

		const recentAfterEmptySub = await driver.textContent('#recent-tx-list');
		assert.ok(recentAfterEmptySub.includes('中項目なしテスト'));
		assert.ok(!recentAfterEmptySub.includes('undefined'));
	});

	it('4. Adding Category in Settings Propagates to Settings List, Input Dropdowns, and All Summary Tabs', async () => {
		// Go to Settings -> Categories Master tab
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		await driver.click('.master-tab-btn[data-master="categories"]');
		assert.equal(await driver.isVisible('#panel-master-categories'), true);

		// Open Add Category modal
		await driver.click('#btn-add-category');
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.isVisible('#modal-master-item'), true);

		await driver.fill('#m-cat-id', 'cat_pet_test');
		await driver.fill('#m-cat-name', 'ペット費');
		await driver.select('#m-cat-type', 'expense');
		await driver.evaluate('document.getElementById("form-master-category").requestSubmit()');
		await new Promise(r => setTimeout(r, 100));

		// 1) Verify in Settings #master-categories-list
		const masterCatListText = await driver.textContent('#master-categories-list');
		assert.ok(masterCatListText.includes('ペット費'), 'Added category should appear in #master-categories-list');

		// 2) Verify in Settings Annual Budget category list (#budget-categories-list-container)
		const budgetCatSetupText = await driver.textContent('#budget-categories-list-container');
		assert.ok(budgetCatSetupText.includes('ペット費'), 'Added category should appear in #budget-categories-list-container');

		// Set an annual budget for ペット費 so we can also verify it in Budget tab
		await driver.fill('#setting-expense-budget', '2400000');
		await driver.fill('.input-cat-budget[data-cat-id="cat_pet_test"]', '120000');
		await driver.click('#btn-save-annual-budget');
		await new Promise(r => setTimeout(r, 100));

		// 3) Verify in Input tab dropdowns (#select-category and #select-actual-category)
		await driver.click('.tab-btn[data-tab="tab-input"]');
		const inputCatOptions = await driver.evaluate(
			'Array.from(document.getElementById("select-category").options).map(o => ({ value: o.value, text: o.textContent }))'
		);
		assert.ok(inputCatOptions.some(o => o.value === 'cat_pet_test' && o.text.includes('ペット費')), 'Added category should appear in #select-category');

		const actualCatOptions = await driver.evaluate(
			'Array.from(document.getElementById("select-actual-category").options).map(o => ({ value: o.value, text: o.textContent }))'
		);
		assert.ok(actualCatOptions.some(o => o.value === 'cat_pet_test' && o.text.includes('ペット費')), 'Added category should appear in #select-actual-category');

		// Register an expense using the newly added category ペット費
		await driver.select('#select-category', 'cat_pet_test');
		await driver.fill('#input-amount', '4200');
		await driver.fill('#input-memo', 'ペットシーツ購入');
		await driver.click('#btn-save-tx');
		await new Promise(r => setTimeout(r, 100));

		// 4) Verify in Cashflow tab (#category-breakdown-list, #cross-matrix-table-container, #select-category-filter, #month-tx-list)
		await driver.click('.tab-btn[data-analytics-target="cashflow"]');
		const breakdownText = await driver.textContent('#category-breakdown-list');
		assert.ok(breakdownText.includes('ペット費'), 'Added category should appear in #category-breakdown-list');
		assert.ok(breakdownText.includes('¥4,200'), 'Category breakdown should show ¥4,200 for ペット費');

		const crossMatrixText = await driver.textContent('#cross-matrix-table-container');
		assert.ok(crossMatrixText.includes('ペット費'), 'Added category should appear in #cross-matrix-table-container');

		const filterCatOptions = await driver.evaluate(
			'Array.from(document.getElementById("select-category-filter").options).map(o => o.textContent)'
		);
		assert.ok(filterCatOptions.some(t => t.includes('ペット費')), 'Added category should appear in #select-category-filter');

		// 5) Verify in Budget tab (#budget-category-progress-container)
		await driver.click('.tab-btn[data-analytics-target="budget"]');
		const budgetProgressText = await driver.textContent('#budget-category-progress-container');
		assert.ok(budgetProgressText.includes('ペット費'), 'Added category should appear in #budget-category-progress-container');
		assert.ok(budgetProgressText.includes('¥120,000'), 'Budget progress should show ¥120,000 budget for ペット費');
		assert.ok(budgetProgressText.includes('¥4,200'), 'Budget progress should show ¥4,200 actual for ペット費');
	});

	it('5. Adding Subcategory in Settings Propagates to Settings Subcategory List, Input Dropdowns, and Transaction Titles', async () => {
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		await new Promise(r => setTimeout(r, 80));
		await driver.click('.master-tab-btn[data-master="categories"]');

		// Click "+ 内訳追加" on ペット費 (cat_pet_test)
		await driver.click('.btn-add-subcat[data-id="cat_pet_test"]');
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.isVisible('#modal-master-item'), true);

		await driver.fill('#m-sub-id', 'sub_catfood');
		await driver.fill('#m-sub-name', 'キャットフード');
		await driver.evaluate('document.getElementById("form-master-subcategory").requestSubmit()');
		await new Promise(r => setTimeout(r, 100));

		// 1) Verify in Settings #master-categories-list .subcat-list
		for (let i = 0; i < 20; i++) {
			const txt = await driver.textContent('#master-categories-list');
			if (txt && txt.includes('キャットフード')) break;
			await new Promise(r => setTimeout(r, 100));
		}
		const masterCatText = await driver.textContent('#master-categories-list');
		assert.ok(masterCatText.includes('キャットフード'), 'Added subcategory should appear in #master-categories-list');

		// 2) Verify in Input tab #select-subcategory when ペット費 is selected
		await driver.click('.tab-btn[data-tab="tab-input"]');
		await driver.select('#select-category', 'cat_pet_test');
		await new Promise(r => setTimeout(r, 80));

		const subOptions = await driver.evaluate(
			'Array.from(document.getElementById("select-subcategory").options).map(o => ({ value: o.value, text: o.textContent }))'
		);
		assert.ok(subOptions.some(o => o.value === 'sub_catfood' && o.text === 'キャットフード'), 'Added subcategory should appear in #select-subcategory');

		// 3) Register a transaction with ペット費 > キャットフード and verify in #recent-tx-list and #month-tx-list
		await driver.select('#select-subcategory', 'sub_catfood');
		await driver.fill('#input-amount', '2800');
		await driver.fill('#input-memo', 'プレミアムフード');
		await driver.click('#btn-save-tx');
		await new Promise(r => setTimeout(r, 100));

		const recentText = await driver.textContent('#recent-tx-list');
		assert.ok(recentText.includes('ペット費 > キャットフード'), 'Recent list should display ペット費 > キャットフード');

		await driver.click('.tab-btn[data-analytics-target="cashflow"]');
		const monthListText = await driver.textContent('#month-tx-list');
		assert.ok(monthListText.includes('ペット費 > キャットフード'), 'Monthly transaction list should display ペット費 > キャットフード');
	});

	it('6. Advance Payment Unsettled List & Prepaid Installment Bulk Edit Integrity', async () => {
		await driver.click('.tab-btn[data-tab="tab-input"]');

		// 1) Register an advance payment
		await driver.click('.mode-tab-btn[data-mode="advance"]');
		await driver.fill('#input-self-amount', '1500');
		await driver.fill('#input-adv-amount', '3500');
		await driver.fill('#input-memo', '同僚ランチ立替');
		await driver.click('#btn-save-tx');
		await new Promise(r => setTimeout(r, 100));

		// Switch to Repay mode and verify #unsettled-advance-list displays the unsettled advance
		await driver.click('.mode-tab-btn[data-mode="repay"]');
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.textContent('#unsettled-advance-count'), '1件');
		const unsettledText = await driver.textContent('#unsettled-advance-list');
		assert.ok(unsettledText.includes('同僚ランチ立替'));
		assert.ok(unsettledText.includes('¥3,500'));

		// Click one-click settle button (.btn-settle-advance)
		await driver.click('.btn-settle-advance');
		await new Promise(r => setTimeout(r, 100));
		assert.equal(await driver.textContent('#unsettled-advance-count'), '0件');

		// 2) Register a 12-month prepaid amortization transaction (¥12,000)
		await driver.click('.mode-tab-btn[data-mode="prepaid"]');
		await driver.fill('#input-prepaid-total', '12000');
		await driver.fill('#input-prepaid-months', '12');
		await driver.fill('#input-memo', 'クラウド年額契約');
		await driver.click('#btn-save-tx');
		await new Promise(r => setTimeout(r, 120));

		// Open parent payment record in Cashflow #month-tx-list and bulk-edit it
		await driver.click('.tab-btn[data-analytics-target="cashflow"]');
		const parentTxId = await driver.evaluate(`
			(async () => {
				const txs = await window.__yose_app.db.getTransactions();
				const p = txs.find(t => t.amortization_meta && t.amortization_meta.is_payment_record);
				return p ? p.id : null;
			})()
		`);
		assert.ok(parentTxId, 'Parent prepaid payment record should exist');

		await driver.click(`.tx-item[data-id="${parentTxId}"]`);
		assert.equal(await driver.isVisible('#modal-edit-tx'), true);
		assert.equal(await driver.evaluate('document.getElementById("edit-tx-amount").value'), '12000');

		// Save with cascade (confirm = true) keeping amount 12000 and updating memo
		driver.nextConfirmAccept = true;
		await driver.fill('#edit-tx-memo', '[前払一括支払] クラウド年額契約(更新)');
		await driver.evaluate('document.getElementById("edit-tx-form").requestSubmit()');
		await new Promise(r => setTimeout(r, 120));

		// Verify parent payment amount did NOT explode to 144000 and memo prefix was not duplicated
		const updatedParent = await driver.evaluate(`window.__yose_app.db.getTransaction(${JSON.stringify(parentTxId)})`);
		assert.equal(updatedParent.amount, 12000);
		assert.equal(updatedParent.memo, '[前払一括支払] クラウド年額契約(更新)');
	});

	it('7A. Recurring Rule XSS Defense (#master-recurring-list HTML Escaping)', async () => {
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		await new Promise(r => setTimeout(r, 80));
		await driver.click('.master-tab-btn[data-master="recurring"]');
		await driver.click('#btn-add-recurring');
		await new Promise(r => setTimeout(r, 80));
		await driver.fill('#m-rec-id', 'rec_xss_test');
		await driver.fill('#m-rec-name', '<img src="x" onerror="window.__xssTriggered = true">家賃テスト');
		await driver.fill('#m-rec-amount', '80000');
		await driver.evaluate('document.getElementById("form-master-recurring").requestSubmit()');
		await new Promise(r => setTimeout(r, 150));

		const xssTriggered = await driver.evaluate('Boolean(window.__xssTriggered)');
		const injectedImgCount = await driver.evaluate('document.querySelectorAll("#master-recurring-list img").length');
		assert.equal(xssTriggered, false, 'XSS payload in recurring rule name must not execute');
		assert.equal(injectedImgCount, 0, 'Recurring rule name must be HTML-escaped in #master-recurring-list');
	});

	it('7B. Archiving Accounts and Categories Excludes Them from Active Summary & Budget Lists', async () => {
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		await new Promise(r => setTimeout(r, 80));
		await driver.click('.master-tab-btn[data-master="accounts"]');
		await driver.click('#btn-add-account');
		await new Promise(r => setTimeout(r, 80));
		await driver.fill('#m-acc-id', 'acc_temp_archive');
		await driver.fill('#m-acc-name', '一時テスト口座');
		await driver.select('#m-acc-type', 'bank');
		await driver.fill('#m-acc-init-bal', '50000');
		await driver.evaluate('document.getElementById("form-master-account").requestSubmit()');
		await new Promise(r => setTimeout(r, 150));

		// Archive acc_temp_archive
		await driver.click('.btn-archive-account[data-id="acc_temp_archive"]');
		await new Promise(r => setTimeout(r, 150));

		// Check if archived account is excluded from #account-balances-list in Summary tabs
		await driver.click('.tab-btn[data-analytics-target="assets"]');
		await new Promise(r => setTimeout(r, 100));
		const accountBalancesText = await driver.textContent('#account-balances-list');
		assert.equal(
			accountBalancesText.includes('一時テスト口座'),
			false,
			'Archived account should not be shown in active #account-balances-list'
		);

		// Also archive cat_pet_test and verify it is excluded from active #budget-categories-list-container in Settings
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		await new Promise(r => setTimeout(r, 100));
		await driver.click('.master-tab-btn[data-master="categories"]');
		await driver.click('.btn-archive-cat[data-id="cat_pet_test"]');
		await new Promise(r => setTimeout(r, 150));

		const budgetCatContainerAfterArchive = await driver.textContent('#budget-categories-list-container');
		assert.equal(
			budgetCatContainerAfterArchive.includes('ペット費'),
			false,
			'Archived category should not be shown in active #budget-categories-list-container'
		);
	});

	it('7C. Yearly Granularity (#control-granularity yearly) Isolates Category Breakdown & KPI Cards to selectedYear', async () => {
		// Insert a transaction in previous year (2025-05-10, cat_hobby, ¥99,000)
		await driver.evaluate(`
			window.__yose_app.db.putTransaction({
				id: 'tx_prev_year_2025',
				group_id: 'grp_prev_2025',
				date: '2025-05-10',
				target_month: '2025-05',
				status: 'confirmed',
				type: 'expense',
				amount: 99000,
				account_id: 'acc_wallet',
				category_id: 'cat_hobby',
				subcategory_id: null,
				memo: '2025年の趣味支出',
				tags: ['2025年タグ'],
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				is_deleted: false,
				sync_status: 'unsynced'
			})
		`);
		await driver.click('.tab-btn[data-analytics-target="cashflow"]');
		await new Promise(r => setTimeout(r, 80));
		await driver.click('#control-granularity .segment-btn[data-granularity="yearly"]');
		await new Promise(r => setTimeout(r, 120));

		// Selected year is current year (2026); 2025-only category (趣味・娯楽 ¥99,000) should NOT leak into 2026's category breakdown!
		const yearlyCatBreakdown2026 = await driver.textContent('#category-breakdown-list');
		assert.equal(
			yearlyCatBreakdown2026.includes('¥99,000'),
			false,
			'Yearly category breakdown for 2026 must only aggregate 2026 transactions, not 2025 transactions'
		);
	});

	it('7D. Clicking an Account in #account-balances-list on Assets or Budget Tab Displays #card-month-tx-list', async () => {
		await driver.click('.tab-btn[data-analytics-target="assets"]');
		await new Promise(r => setTimeout(r, 100));
		await driver.click('#account-balances-list .tx-item[data-filter-account="acc_wallet"]');
		await new Promise(r => setTimeout(r, 120));
		assert.equal(
			await driver.isVisible('#card-month-tx-list'),
			true,
			'Clicking an account row to drill down into transactions from Assets tab should switch to or display #card-month-tx-list'
		);
	});
});
