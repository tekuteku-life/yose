import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, transaction, seed, cashflow, rowIds, value, settings, dialogs, waitForDialog } from '../helpers/ui_fixture.js';

describe('Analytics, pagination, and navigation', { timeout: 120000 }, () => {
	const fixture = useBrowser();

	for (const count of [0, 30, 31, 60, 61]) {
		it(`paginates exactly ${count} transactions with correct rows and boundary buttons`, async () => {
			const d = fixture.driver;
			await seed(d, Array.from({ length: count }, (_, i) => transaction(`page_${String(i).padStart(3, '0')}`, { created_at: `2026-10-20T03:00:${String(i % 60).padStart(2, '0')}Z` })));
			await cashflow(d);
			assert.equal((await rowIds(d)).length, Math.min(count, 30));
			assert.equal(await d.isVisible('#tx-pagination-controls'), count > 30);
			if (count === 0) assert.ok((await d.textContent('#month-tx-list')).includes('取引はありません'));
			if (count <= 30) return;
			const visited = [...await rowIds(d)];
			const pages = Math.ceil(count / 30);
			assert.equal(await d.evaluate('document.getElementById("btn-tx-prev-page").disabled'), true);
			for (let page = 2; page <= pages; page++) {
				await d.click('#btn-tx-next-page');
				await d.waitFor(`document.getElementById('tx-pagination-info').textContent.startsWith('${page} / ${pages}')`);
				visited.push(...await rowIds(d));
			}
			assert.equal(visited.length, count);
			assert.equal(new Set(visited).size, count);
			assert.equal(await d.evaluate('document.getElementById("btn-tx-next-page").disabled'), true);
			await d.click('#btn-tx-prev-page');
			await d.waitFor(`document.getElementById('tx-pagination-info').textContent.startsWith('${pages - 1} / ${pages}')`);
		});
	}

	it('recalculates next-page limits after the initial one-row list grows to three pages', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('initial')]);
		await cashflow(d);
		await seed(d, Array.from({ length: 60 }, (_, i) => transaction(`added_${i}`)));
		await d.click('.tab-btn[data-analytics-target="cashflow"]');
		await d.waitFor('document.getElementById("tx-pagination-info").textContent.includes("全 61 件")');
		await d.click('#btn-tx-next-page');
		await d.waitFor('document.getElementById("tx-pagination-info").textContent.startsWith("2 / 3") && document.querySelectorAll("#month-tx-list .tx-item").length === 30');
		assert.ok((await d.textContent('#tx-pagination-info')).startsWith('2 / 3'));
		await d.click('#btn-tx-next-page');
		await d.waitFor('document.getElementById("tx-pagination-info").textContent.startsWith("3 / 3") && document.querySelectorAll("#month-tx-list .tx-item").length === 1');
		assert.ok((await d.textContent('#tx-pagination-info')).startsWith('3 / 3'));
		assert.equal((await rowIds(d)).length, 1);
	});

	it('resets pages when filtering, handles no matches, and restores pagination when clearing', async () => {
		const d = fixture.driver;
		await seed(d, Array.from({ length: 65 }, (_, i) => transaction(`filter_${i}`, { memo: i < 31 ? '選択グループ' : 'その他' })));
		await cashflow(d);
		await d.click('#btn-tx-next-page');
		await d.fill('#input-tx-search', '選択グループ');
		assert.ok((await d.textContent('#tx-pagination-info')).startsWith('1 / 2'));
		await d.click('#btn-tx-next-page');
		assert.equal((await rowIds(d)).length, 1);
		await d.fill('#input-tx-search', '存在しない');
		assert.ok((await d.textContent('#month-tx-list')).includes('条件に一致する取引はありません'));
		assert.equal(await d.isVisible('#tx-pagination-controls'), false);
		await d.fill('#input-tx-search', '');
		assert.ok((await d.textContent('#tx-pagination-info')).startsWith('1 / 3'));
		await d.click('#btn-tx-next-page');
		assert.ok((await d.textContent('#tx-pagination-info')).startsWith('2 / 3'));
	});

	it('combines all five filters and matches actual categories, tags, and destination accounts', async () => {
		const d = fixture.driver;
		await seed(d, [
			transaction('match', { actual_category_id: 'cat_housing', tags: ['検索タグ'], memo: 'MiXeD メモ' }),
			transaction('no_status', { status: 'planned', actual_category_id: 'cat_housing', tags: ['検索タグ'], memo: 'MiXeD メモ' }),
			transaction('no_account', { account_id: 'acc_bank_main', actual_category_id: 'cat_housing', tags: ['検索タグ'], memo: 'MiXeD メモ' }),
			transaction('no_category', { tags: ['検索タグ'], memo: 'MiXeD メモ' }),
			transaction('no_tag', { actual_category_id: 'cat_housing', memo: 'MiXeD メモ' }),
			transaction('no_keyword', { actual_category_id: 'cat_housing', tags: ['検索タグ'] }),
			transaction('deleted', { is_deleted: true, actual_category_id: 'cat_housing', tags: ['検索タグ'], memo: 'MiXeD メモ' }),
			transaction('incoming_transfer', { type: 'transfer', account_id: 'acc_bank_main', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null })
		]);
		await cashflow(d);
		await d.select('#select-status-filter', 'confirmed');
		await d.select('#select-account-filter', 'acc_wallet');
		await d.select('#select-category-filter', 'cat_housing');
		await d.select('#select-tag-filter', '検索タグ');
		await d.fill('#input-tx-search', 'mixed');
		assert.deepEqual(await rowIds(d), ['match']);
		await d.fill('#input-tx-search', '');
		await d.select('#select-tag-filter', 'all');
		await d.select('#select-category-filter', 'all');
		assert.ok((await rowIds(d)).includes('incoming_transfer'));
		assert.equal((await rowIds(d)).includes('deleted'), false);
	});

	it('drills down from categories and tags, clears other filters, and expands the transaction card', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('food', { tags: ['食事'] }), transaction('housing', { category_id: 'cat_housing', actual_category_id: 'cat_housing', tags: ['家'] })]);
		await cashflow(d);
		await d.fill('#input-tx-search', '存在しない');
		await d.select('#select-status-filter', 'planned');
		await d.click('#card-month-tx-list .card-collapse-btn');
		assert.equal(await d.isVisible('#month-tx-list'), false);
		await d.click('#category-breakdown-list [data-filter-category="cat_food"]');
		await d.waitFor('document.getElementById("select-category-filter").value === "cat_food" && !document.getElementById("card-month-tx-list").classList.contains("collapsed") && Array.from(document.querySelectorAll("#month-tx-list .tx-item"), row => row.dataset.id).join() === "food"');
		assert.deepEqual(await rowIds(d), ['food']);
		assert.equal(await value(d, '#input-tx-search'), '');
		assert.equal(await value(d, '#select-status-filter'), 'all');
		await d.click('#tag-breakdown-list [data-filter-tag="家"]');
		await d.waitFor('document.getElementById("select-tag-filter").value === "家" && Array.from(document.querySelectorAll("#month-tx-list .tx-item"), row => row.dataset.id).join() === "housing"');
		assert.deepEqual(await rowIds(d), ['housing']);
		assert.equal(await value(d, '#select-category-filter'), 'all');
	});

	for (const source of ['assets', 'budget']) {
		it(`drills down from ${source} with the right active tab and account filter`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('wallet'), transaction('bank', { account_id: 'acc_bank_main' })]);
			await d.click(`.tab-btn[data-analytics-target="${source}"]`);
			await d.click('#account-balances-list [data-filter-account="acc_bank_main"]');
			await d.waitFor('document.getElementById("select-account-filter").value === "acc_bank_main"');
			assert.equal(await d.isVisible('#card-month-tx-list'), true);
			assert.equal(await d.evaluate('document.querySelector(".tab-btn.active").dataset.analyticsTarget'), 'cashflow');
			assert.deepEqual(await rowIds(d), ['bank']);
		});
	}

	it('selects daily rows and keeps the selected date inside the navigated month', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('oct', { date: '2026-10-19' }), transaction('sep', { date: '2026-09-19', target_month: '2026-09' })]);
		await cashflow(d);
		await d.click('#control-granularity [data-granularity="daily"]');
		await d.click('#breakdown-table-container [data-date="2026-10-19"]');
		assert.deepEqual(await rowIds(d), ['oct']);
		await d.click('#btn-period-prev');
		await d.waitFor('document.getElementById("period-display").textContent.includes("2026-09")');
		assert.ok((await d.textContent('#month-tx-list-title')).includes('2026-09-19'));
		assert.deepEqual(await rowIds(d), ['sep']);
	});

	it('navigates across year boundaries and jumps with the month picker', async () => {
		const d = fixture.driver;
		await cashflow(d);
		await d.fill('#input-period-picker', '2026-01');
		await d.click('#btn-period-prev');
		assert.ok((await d.textContent('#period-display')).includes('2025-12'));
		await d.click('#btn-period-next');
		assert.ok((await d.textContent('#period-display')).includes('2026-01'));
		await d.click('#control-granularity [data-granularity="yearly"]');
		await d.click('#btn-period-prev');
		assert.ok((await d.textContent('#period-display')).includes('2025年'));
		await d.fill('#input-period-picker', '2027-05');
		assert.ok((await d.textContent('#period-display')).includes('2027年'));
		assert.ok((await d.textContent('#month-tx-list-title')).includes('2027年'));
	});

	it('generates recurring transactions once and cancels closing without changing planned records', async () => {
		const d = fixture.driver;
		await cashflow(d);
		await d.click('#btn-generate-recurring');
		await waitForDialog(d, '件の定期予定');
		const first = await d.evaluate('window.__yose_app.db.getTransactions()');
		assert.equal(first.length, 1);
		assert.equal(first[0].status, 'planned');
		await d.click('#btn-generate-recurring');
		await waitForDialog(d, 'すでに生成');
		assert.equal((await d.evaluate('window.__yose_app.db.getTransactions()')).length, 1);
		await d.setConfirm(false);
		await d.click('#btn-close-month');
		assert.equal((await d.evaluate('window.__yose_app.db.getTransactions()'))[0].status, 'planned');
		assert.ok((await dialogs(d)).some(x => x.type === 'confirm'));
	});

	it('persists pane collapse through tab switches and reload / PIN unlock', async () => {
		const d = fixture.driver;
		await cashflow(d);
		await d.click('#card-category-breakdown .card-collapse-btn');
		assert.equal(await d.isVisible('#category-breakdown-list'), false);
		assert.equal(await d.evaluate('document.querySelector("#card-category-breakdown .card-collapse-btn").getAttribute("aria-expanded")'), 'false');
		await settings(d);
		await cashflow(d);
		assert.equal(await d.isVisible('#category-breakdown-list'), false);
		await d.navigate();
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden")');
		await cashflow(d);
		assert.equal(await d.isVisible('#category-breakdown-list'), false);
		await d.click('#card-category-breakdown .card-collapse-btn');
		assert.equal(await d.isVisible('#category-breakdown-list'), true);
	});

	it('handles Chart.js being unavailable while retaining usable analytics and transactions', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('fallback')]);
		await d.evaluate('delete window.Chart');
		await cashflow(d);
		assert.equal(await d.isVisible('#chart-fallback'), true);
		assert.ok((await d.textContent('#chart-fallback')).includes('月別収支'));
		assert.deepEqual(await rowIds(d), ['fallback']);
		await d.click('.tab-btn[data-analytics-target="assets"]');
		assert.equal(await d.isVisible('#chart-fallback'), true);
	});
});
