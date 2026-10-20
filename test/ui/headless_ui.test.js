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

	it('8. Tag & Memo Custom Suggestion Dropdown Placement, Interactivity & Dismissal', async () => {
		await driver.click('.tab-btn[data-tab="tab-input"]');

		// Focus on #input-memo
		await driver.evaluate(`
			(() => {
				const memo = document.getElementById('input-memo');
				memo.focus();
				memo.dispatchEvent(new Event('input', { bubbles: true }));
			})()
		`);
		await new Promise(r => setTimeout(r, 80));

		// Suggestion dropdown (#memo-suggest-dropdown) should exist, be positioned below the input, and contain previous memos
		assert.equal(await driver.isVisible('#memo-suggest-dropdown'), true, '#memo-suggest-dropdown should be visible on memo focus/input');
		const memoSuggestText = await driver.textContent('#memo-suggest-dropdown');
		assert.ok(memoSuggestText.includes('スーパー買い出し'), 'Memo dropdown should include previously registered memo');

		// Clicking a candidate should fill #input-memo, auto-select category/subcategory, and close the dropdown
		await driver.click('#memo-suggest-dropdown .suggest-item[data-value="スーパー買い出し"]');
		assert.equal(await driver.evaluate('document.getElementById("input-memo").value'), 'スーパー買い出し');
		assert.equal(await driver.isVisible('#memo-suggest-dropdown'), false, 'Memo dropdown should close after candidate selection');

		// Category should be auto-selected to 食費 (cat_food)
		assert.equal(await driver.evaluate('document.getElementById("select-category").value'), 'cat_food');

		// Clicking outside should close suggestion dropdown
		await driver.evaluate(`
			(() => {
				const memo = document.getElementById('input-memo');
				memo.focus();
				memo.dispatchEvent(new Event('input', { bubbles: true }));
			})()
		`);
		assert.equal(await driver.isVisible('#memo-suggest-dropdown'), true);
		await driver.click('body');
		assert.equal(await driver.isVisible('#memo-suggest-dropdown'), false, 'Clicking outside should close memo suggestion dropdown');

		// Tag suggestion dropdown (#tags-suggest-dropdown)
		await driver.evaluate(`
			(() => {
				const tagInput = document.getElementById('input-tag-text');
				tagInput.focus();
				tagInput.dispatchEvent(new Event('input', { bubbles: true }));
			})()
		`);
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.isVisible('#tags-suggest-dropdown'), true, '#tags-suggest-dropdown should be visible on tag focus/input');
		const tagSuggestText = await driver.textContent('#tags-suggest-dropdown');
		assert.ok(tagSuggestText.includes('週末まとめ買い'), 'Tag dropdown should include previously registered tag');

		// Clicking candidate adds chip and closes dropdown
		await driver.click('#tags-suggest-dropdown .suggest-item[data-value="週末まとめ買い"]');
		assert.equal(await driver.isVisible('#tags-suggest-dropdown'), false, 'Tag dropdown should close after candidate selection');
		const currentChips = await driver.textContent('#tags-chips-list');
		assert.ok(currentChips.includes('週末まとめ買い'), 'Tag chip should be added');
	});

	it('9. Credit Card Master Account Settings & Debit Bank Account Selection & Display', async () => {
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		await new Promise(r => setTimeout(r, 80));
		await driver.click('.master-tab-btn[data-master="accounts"]');

		// 1) Verify acc_card_a in #master-accounts-list displays debit bank account info
		const cardRowText = await driver.evaluate(`
			(() => {
				const row = document.querySelector('.btn-edit-account[data-id="acc_card_a"]')?.closest('.master-item-row');
				return row ? row.textContent : '';
			})()
		`);
		assert.ok(cardRowText.includes('メイン銀行'), 'Credit card row in account list should display linked debit account name');

		// 2) Open Edit Account modal for acc_card_a
		await driver.click('.btn-edit-account[data-id="acc_card_a"]');
		await new Promise(r => setTimeout(r, 100));
		assert.equal(await driver.isVisible('#modal-master-item'), true);

		// #m-acc-debit-account dropdown should be populated with bank accounts and acc_bank_main should be selected
		const debitAccVal = await driver.evaluate('document.getElementById("m-acc-debit-account").value');
		assert.equal(debitAccVal, 'acc_bank_main', 'Debit account select in credit card modal should select acc_bank_main');

		// Set closing day to 15, debit day to 10, save
		await driver.fill('#m-acc-closing-day', '15');
		await driver.fill('#m-acc-debit-day', '10');
		await driver.select('#m-acc-debit-account', 'acc_bank_main');
		await driver.evaluate('document.getElementById("form-master-account").requestSubmit()');
		await new Promise(r => setTimeout(r, 120));

		// Check updated debit info in #master-accounts-list
		let updatedCardRow = '';
		for (let i = 0; i < 20; i++) {
			updatedCardRow = await driver.evaluate(`
				(() => {
					const row = document.querySelector('.btn-edit-account[data-id="acc_card_a"]')?.closest('.master-item-row');
					return row ? row.textContent : '';
				})()
			`);
			if (updatedCardRow && updatedCardRow.includes('15日')) break;
			await new Promise(r => setTimeout(r, 100));
		}
		assert.ok(updatedCardRow.includes('15日'), 'Credit card row should show closing day');
		assert.ok(updatedCardRow.includes('10日'), 'Credit card row should show debit day');
		assert.ok(updatedCardRow.includes('メイン銀行'), 'Credit card row should show debit account');
	});

	it('10. Cashflow Granularity (Daily, Monthly, Yearly) & Transaction List Alignment & Pagination', async () => {
		// Insert test transactions across 2026:
		// tx_2026_feb in 2026-02-15 (¥15,000)
		// tx_today in 2026-10-20 (¥3,000)
		await driver.evaluate(`
			Promise.all([
				window.__yose_app.db.putTransaction({
					id: 'tx_2026_feb',
					group_id: 'grp_2026_feb',
					date: '2026-02-15',
					target_month: '2026-02',
					status: 'confirmed',
					type: 'expense',
					amount: 15000,
					account_id: 'acc_wallet',
					category_id: 'cat_food',
					subcategory_id: null,
					memo: '2026年2月支出',
					tags: [],
					created_at: new Date('2026-02-15T12:00:00Z').toISOString(),
					updated_at: new Date('2026-02-15T12:00:00Z').toISOString(),
					is_deleted: false,
					sync_status: 'unsynced'
				}),
				window.__yose_app.db.putTransaction({
					id: 'tx_today_oct',
					group_id: 'grp_today_oct',
					date: '2026-10-20',
					target_month: '2026-10',
					status: 'confirmed',
					type: 'expense',
					amount: 3000,
					account_id: 'acc_wallet',
					category_id: 'cat_food',
					subcategory_id: null,
					memo: '本日10月20日支出',
					tags: [],
					created_at: new Date('2026-10-20T12:00:00Z').toISOString(),
					updated_at: new Date('2026-10-20T12:00:00Z').toISOString(),
					is_deleted: false,
					sync_status: 'unsynced'
				})
			])
		`);

		await driver.click('.tab-btn[data-analytics-target="cashflow"]');
		await new Promise(r => setTimeout(r, 100));

		// 1) Monthly mode (default for 2026-10)
		await driver.click('#control-granularity .segment-btn[data-granularity="monthly"]');
		await new Promise(r => setTimeout(r, 120));
		let monthList = await driver.textContent('#month-tx-list');
		assert.ok(monthList.includes('本日10月20日支出'), 'Monthly list should include October transaction');
		assert.equal(monthList.includes('2026年2月支出'), false, 'Monthly list for October must NOT include February transaction');
		assert.equal(monthList.includes('2025年の趣味支出'), false, 'Monthly list for October must NOT include 2025 transaction');

		// 2) Yearly mode (2026)
		await driver.click('#control-granularity .segment-btn[data-granularity="yearly"]');
		await new Promise(r => setTimeout(r, 150));
		let yearlyList = await driver.textContent('#month-tx-list');
		assert.ok(yearlyList.includes('本日10月20日支出'), 'Yearly list for 2026 should include October transaction');
		assert.ok(yearlyList.includes('2026年2月支出'), 'Yearly list for 2026 should include February transaction');
		assert.equal(yearlyList.includes('2025年の趣味支出'), false, 'Yearly list for 2026 must NOT include 2025 transaction');
		const yearlyTitle = await driver.textContent('#month-tx-list-title');
		assert.ok(yearlyTitle.includes('年'), 'Header should indicate yearly transactions');

		// 3) Daily mode (2026-10-20)
		await driver.click('#control-granularity .segment-btn[data-granularity="daily"]');
		await new Promise(r => setTimeout(r, 150));
		let dailyList = await driver.textContent('#month-tx-list');
		assert.ok(dailyList.includes('本日10月20日支出'), 'Daily list for 2026-10-20 should include today transaction');
		assert.equal(dailyList.includes('2026年2月支出'), false, 'Daily list must NOT include other date transaction');
		const dailyTitle = await driver.textContent('#month-tx-list-title');
		assert.ok(dailyTitle.includes('日'), 'Header should indicate daily transactions');

		// 4) Pagination verification with multiple transactions
		await driver.evaluate(`
			(() => {
				const txs = [];
				for (let i = 1; i <= 35; i++) {
					txs.push({
						id: 'tx_bulk_page_' + i,
						group_id: 'grp_bulk_' + i,
						date: '2026-03-01',
						target_month: '2026-03',
						status: 'confirmed',
						type: 'expense',
						amount: 100 * i,
						account_id: 'acc_wallet',
						category_id: 'cat_food',
						subcategory_id: null,
						memo: '大量明細テスト_' + i,
						tags: [],
						created_at: new Date('2026-03-01T10:00:00Z').toISOString(),
						updated_at: new Date('2026-03-01T10:00:00Z').toISOString(),
						is_deleted: false,
						sync_status: 'unsynced'
					});
				}
				return window.__yose_app.db.putTransactions(txs);
			})()
		`);

		await driver.click('#control-granularity .segment-btn[data-granularity="yearly"]');
		await new Promise(r => setTimeout(r, 150));
		assert.equal(await driver.isVisible('#tx-pagination-controls'), true, 'Pagination controls should be visible when items exceed page size');
		const pageInfo = await driver.textContent('#tx-pagination-info');
		assert.ok(pageInfo.includes('ページ'), 'Pagination info should display current page');
	});

	it('11. Settings Tab Complete Verification (Annual Budget, Theme Switching, Backup Modal, Version Check)', async () => {
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		await new Promise(r => setTimeout(r, 100));

		// 1) Theme mode switching (system -> dark -> light -> system)
		await driver.click('#theme-radio-dark');
		await new Promise(r => setTimeout(r, 80));
		let themeAttr = await driver.evaluate('document.documentElement.getAttribute("data-theme")');
		assert.equal(themeAttr, 'dark', 'DOM data-theme should be dark after selecting dark radio');

		await driver.click('#theme-radio-light');
		await new Promise(r => setTimeout(r, 80));
		themeAttr = await driver.evaluate('document.documentElement.getAttribute("data-theme")');
		assert.equal(themeAttr, 'light', 'DOM data-theme should be light after selecting light radio');

		await driver.click('#theme-radio-system');
		await new Promise(r => setTimeout(r, 80));
		themeAttr = await driver.evaluate('document.documentElement.getAttribute("data-theme")');
		assert.ok(themeAttr === 'light' || themeAttr === 'dark', 'DOM data-theme should resolve to light or dark when system');

		// 2) Annual Budget settings persistence
		await driver.fill('#setting-budget-year', '2026');
		await driver.fill('#setting-expense-budget', '3600000');
		await driver.fill('#setting-savings-target-amount', '720000');
		await driver.fill('#setting-savings-target-rate', '20');

		// Check monthly preview updates
		const previewText = await driver.textContent('#budget-monthly-preview');
		assert.ok(previewText.includes('¥300,000'), 'Preview should show ¥300,000 monthly expense budget');
		assert.ok(previewText.includes('¥60,000'), 'Preview should show ¥60,000 monthly savings target');

		// Save annual budget
		await driver.click('#btn-save-annual-budget');
		await new Promise(r => setTimeout(r, 150));

		// Verify saved in DB
		const savedBudget = await driver.evaluate('window.__yose_app.db.getAnnualBudget("2026")');
		assert.ok(savedBudget, 'Annual budget for 2026 should be saved in DB');
		assert.equal(savedBudget.expense_budget, 3600000);
		assert.equal(savedBudget.savings_target_amount, 720000);
		assert.equal(savedBudget.savings_target_rate, 20);

		// 3) Backup Export Modal open & close
		await driver.click('#btn-open-export-modal');
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.isVisible('#modal-export-json'), true, 'Export modal should be visible');

		// Verify export buttons exist
		assert.equal(await driver.isVisible('#btn-export-full'), true);
		assert.equal(await driver.isVisible('#btn-export-transactions'), true);
		assert.equal(await driver.isVisible('#btn-export-master'), true);
		assert.equal(await driver.isVisible('#btn-export-budgets'), true);
		assert.equal(await driver.isVisible('#btn-export-snapshot'), true);

		await driver.click('#btn-close-export-modal');
		await new Promise(r => setTimeout(r, 80));
		assert.equal(await driver.isVisible('#modal-export-json'), false, 'Export modal should close after clicking close');

		// 4) App Version check badge and update check trigger
		const badgeText = await driver.textContent('#badge-current-version');
		assert.ok(badgeText.startsWith('v1.'), 'Current version badge should display valid SemVer');

		await driver.click('#btn-check-app-update');
		await new Promise(r => setTimeout(r, 100));
		assert.equal(await driver.isVisible('#update-status-msg'), true, 'Update status message should become visible');
	});

	it('12. Summary Tabs Multi-Criteria Filtering, Axis & Planned Toggles, Drilldowns & Empty States', async () => {
		// 1) Planned Transaction Toggle: Add planned transaction for 2026-10
		await driver.evaluate(`
			window.__yose_app.db.putTransaction({
				id: 'tx_planned_trip',
				group_id: 'grp_planned_trip',
				date: '2026-10-28',
				target_month: '2026-10',
				status: 'planned',
				type: 'expense',
				amount: 25000,
				account_id: 'acc_wallet',
				category_id: 'cat_hobby',
				subcategory_id: null,
				memo: '秋の旅行予定',
				tags: ['旅行予定タグ'],
				created_at: new Date('2026-10-20T14:00:00Z').toISOString(),
				updated_at: new Date('2026-10-20T14:00:00Z').toISOString(),
				is_deleted: false,
				sync_status: 'unsynced'
			})
		`);

		await driver.click('.tab-btn[data-analytics-target="cashflow"]');
		await new Promise(r => setTimeout(r, 100));
		await driver.click('#control-granularity .segment-btn[data-granularity="monthly"]');
		await new Promise(r => setTimeout(r, 100));

		// Initially showPlanned is true (予定: ON)
		let listText = await driver.textContent('#month-tx-list');
		assert.ok(listText.includes('秋の旅行予定'), 'Planned transaction should appear when planned toggle is initially ON');

		// Toggle Planned to OFF
		await driver.click('#btn-toggle-planned');
		await new Promise(r => setTimeout(r, 120));
		let plannedBtnText = await driver.textContent('#btn-toggle-planned');
		assert.ok(plannedBtnText.includes('OFF'), 'Planned button should show OFF');

		listText = await driver.textContent('#month-tx-list');
		assert.equal(listText.includes('秋の旅行予定'), false, 'Planned transaction should be hidden when planned toggle is OFF');

		// Toggle Planned back to ON
		await driver.click('#btn-toggle-planned');
		await new Promise(r => setTimeout(r, 120));
		plannedBtnText = await driver.textContent('#btn-toggle-planned');
		assert.ok(plannedBtnText.includes('ON'), 'Planned button should show ON');
		listText = await driver.textContent('#month-tx-list');
		assert.ok(listText.includes('秋の旅行予定'), 'Planned transaction should appear when planned toggle is ON again');

		// 2) Axis Toggle (🏷️ 計上分類ベース <-> 📦 実態分類ベース)
		await driver.evaluate(`
			window.__yose_app.db.putTransaction({
				id: 'tx_axis_diff_test',
				group_id: 'grp_axis_diff_test',
				date: '2026-10-22',
				target_month: '2026-10',
				status: 'confirmed',
				type: 'expense',
				amount: 8800,
				account_id: 'acc_wallet',
				category_id: 'cat_food',
				actual_category_id: 'cat_housing',
				subcategory_id: null,
				memo: '食費計上だが実態は住居通信',
				tags: [],
				created_at: new Date('2026-10-22T10:00:00Z').toISOString(),
				updated_at: new Date('2026-10-22T10:00:00Z').toISOString(),
				is_deleted: false,
				sync_status: 'unsynced'
			})
		`);

		// Refresh summary
		await driver.click('.tab-btn[data-analytics-target="cashflow"]');
		await new Promise(r => setTimeout(r, 100));

		// In default accrual axis (計上分類), 8800 is counted under 食費
		let catBreakdownText = await driver.textContent('#category-breakdown-list');
		assert.ok(catBreakdownText.includes('食費'), 'Accrual category breakdown should show 食費');

		// Toggle to Actual Category axis (実態分類ベース)
		await driver.click('#btn-toggle-axis');
		await new Promise(r => setTimeout(r, 120));
		let axisBtnText = await driver.textContent('#btn-toggle-axis');
		assert.ok(axisBtnText.includes('実態分類ベース'), 'Axis toggle button text should switch to 実態分類ベース');

		// Category breakdown should now include 住居・通信 with ¥8,800
		catBreakdownText = await driver.textContent('#category-breakdown-list');
		assert.ok(catBreakdownText.includes('住居・通信'), 'Actual category breakdown should include 住居・通信');
		assert.ok(catBreakdownText.includes('¥8,800'), 'Category breakdown should show ¥8,800 under 住居・通信');

		// Toggle back to Accrual axis
		await driver.click('#btn-toggle-axis');
		await new Promise(r => setTimeout(r, 120));
		axisBtnText = await driver.textContent('#btn-toggle-axis');
		assert.ok(axisBtnText.includes('計上分類ベース'), 'Axis toggle button text should switch back to 計上分類ベース');

		// 3) Multi-Criteria Filtering (Status, Account, Category, Keyword)
		// Select Status: confirmed
		await driver.select('#select-status-filter', 'confirmed');
		// Select Account: acc_wallet
		await driver.select('#select-account-filter', 'acc_wallet');
		// Search keyword: '本日10月20日'
		await driver.fill('#input-tx-search', '本日10月20日');
		await new Promise(r => setTimeout(r, 100));

		listText = await driver.textContent('#month-tx-list');
		assert.ok(listText.includes('本日10月20日支出'), 'Filtered list should match keyword and criteria');
		assert.equal(listText.includes('食費計上だが実態は日用品'), false, 'Non-matching keyword should be excluded');

		// Test Empty State when criteria matches 0 items
		await driver.fill('#input-tx-search', 'まったく存在しないキーワードXYZ123');
		await new Promise(r => setTimeout(r, 100));
		listText = await driver.textContent('#month-tx-list');
		assert.ok(listText.includes('条件に一致する取引はありません') || listText.includes('取引はありません'), 'Empty state should be displayed cleanly');

		// Clear search filter
		await driver.fill('#input-tx-search', '');
		await driver.select('#select-status-filter', 'all');
		await driver.select('#select-account-filter', 'all');
		await new Promise(r => setTimeout(r, 100));

		// 4) Period navigation (Prev, Next, and Month Picker jump)
		await driver.click('#btn-period-prev');
		await new Promise(r => setTimeout(r, 100));
		let periodText = await driver.textContent('#period-display');
		assert.ok(periodText.includes('2026-09'), 'Period display should navigate to previous month 2026-09');

		await driver.click('#btn-period-next');
		await new Promise(r => setTimeout(r, 100));
		periodText = await driver.textContent('#period-display');
		assert.ok(periodText.includes('2026-10'), 'Period display should navigate to next month 2026-10');

		// Quick jump using Month Picker input (#input-period-picker)
		await driver.evaluate(`
			(() => {
				const picker = document.getElementById('input-period-picker');
				picker.value = '2026-05';
				picker.dispatchEvent(new Event('change', { bubbles: true }));
			})()
		`);
		await new Promise(r => setTimeout(r, 100));
		periodText = await driver.textContent('#period-display');
		assert.ok(periodText.includes('2026-05'), 'Period display should jump to 2026-05 after picker change');

		// Return back to 2026-10
		await driver.evaluate(`
			(() => {
				const picker = document.getElementById('input-period-picker');
				picker.value = '2026-10';
				picker.dispatchEvent(new Event('change', { bubbles: true }));
			})()
		`);
		await new Promise(r => setTimeout(r, 100));
		periodText = await driver.textContent('#period-display');
		assert.ok(periodText.includes('2026-10'), 'Period display should return to 2026-10');
	});
});
