import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, transaction, seed, cashflow, rowIds, value } from '../helpers/ui_fixture.js';

const categoryIds = ['posted', 'actual', 'planned', 'deleted', 'unused', 'september', 'previous_year', 'year_boundary'];
const accountIds = ['source', 'destination', 'planned', 'deleted', 'unused', 'september'];

async function prepare(driver) {
	await driver.evaluate(`window.__yose_app.db.mutateMasterConfig(config => {
		config.categories.push(...${JSON.stringify(categoryIds)}.map(key => ({ id: 'cat_old_' + key, name: key === 'posted' ? '<img src=x onerror="window.__filterXss=true">' : '旧費目' + key, type: 'expense', is_archived: false, subcategories: [] })));
		config.accounts.push(...${JSON.stringify(accountIds)}.map(key => ({ id: 'acc_old_' + key, name: '旧口座' + key, type: 'cash', initial_balance: 0, is_archived: false })));
	})`);
	await seed(driver, [
		transaction('posted', { category_id: 'cat_old_posted', actual_category_id: 'cat_food', account_id: 'acc_old_source', tags: ['履歴'] }),
		transaction('actual', { category_id: 'cat_food', actual_category_id: 'cat_old_actual' }),
		transaction('transfer', { type: 'transfer', category_id: null, actual_category_id: null, to_account_id: 'acc_old_destination' }),
		transaction('planned_zero', { amount: 0, status: 'planned', category_id: 'cat_old_planned', actual_category_id: 'cat_old_planned', account_id: 'acc_old_planned' }),
		transaction('deleted', { is_deleted: true, category_id: 'cat_old_deleted', actual_category_id: 'cat_old_deleted', account_id: 'acc_old_deleted' }),
		transaction('september', { date: '2026-09-19', target_month: '2026-09', category_id: 'cat_old_september', actual_category_id: 'cat_old_september', account_id: 'acc_old_september' }),
		transaction('previous_year', { date: '2025-10-20', target_month: '2025-10', category_id: 'cat_old_previous_year', actual_category_id: 'cat_old_previous_year' }),
		transaction('year_boundary', { date: '2027-01-01', target_month: '2026-12', category_id: 'cat_old_year_boundary', actual_category_id: 'cat_old_year_boundary' }),
		transaction('other_day', { date: '2026-10-19', category_id: 'cat_old_actual', actual_category_id: 'cat_old_actual' })
	]);
	await driver.evaluate(`window.__yose_app.db.mutateMasterConfig(config => {
		config.categories.forEach(item => { if (item.id.startsWith('cat_old_')) item.is_archived = true; });
		config.accounts.forEach(item => { if (item.id.startsWith('acc_old_')) item.is_archived = true; });
	})`);
}

async function optionIds(driver, selector) {
	return driver.evaluate(`Array.from(document.querySelector(${JSON.stringify(selector)}).options, option => option.value)`);
}

async function waitRows(driver, ids) {
	await driver.waitFor(`JSON.stringify(Array.from(document.querySelectorAll('#month-tx-list .tx-item'), row => row.dataset.id).sort()) === ${JSON.stringify(JSON.stringify([...ids].sort()))}`);
}

describe('Archived settings in period transaction filters', { timeout: 120000 }, () => {
	const fixture = useBrowser();

	it('includes only referenced archived settings from both axes and both transfer sides without dropping live settings', async () => {
		const d = fixture.driver;
		await prepare(d);
		await cashflow(d);
		const categories = await optionIds(d, '#select-category-filter');
		const accounts = await optionIds(d, '#select-account-filter');
		for (const id of ['cat_old_posted', 'cat_old_actual', 'cat_old_planned', 'cat_housing']) assert.ok(categories.includes(id), id);
		for (const id of ['cat_old_deleted', 'cat_old_unused', 'cat_old_september', 'cat_old_previous_year', 'cat_old_year_boundary']) assert.equal(categories.includes(id), false, id);
		for (const id of ['acc_old_source', 'acc_old_destination', 'acc_old_planned', 'acc_bank_main']) assert.ok(accounts.includes(id), id);
		for (const id of ['acc_old_deleted', 'acc_old_unused', 'acc_old_september']) assert.equal(accounts.includes(id), false, id);
		assert.equal(await d.evaluate('document.querySelector("#select-category-filter option[value=cat_old_posted]").textContent'), '🏷️ <img src=x onerror="window.__filterXss=true">');
		assert.equal(await d.evaluate('Boolean(window.__filterXss) || Boolean(document.querySelector("#select-category-filter img"))'), false);
	});

	it('filters archived actual categories and transfer destinations and drills down from archived category totals', async () => {
		const d = fixture.driver;
		await prepare(d);
		await cashflow(d);
		await d.select('#select-category-filter', 'cat_old_actual');
		await waitRows(d, ['actual', 'other_day']);
		await d.select('#select-category-filter', 'all');
		await d.select('#select-account-filter', 'acc_old_destination');
		await waitRows(d, ['transfer']);
		await d.click('#category-breakdown-list [data-filter-category="cat_old_posted"]');
		await waitRows(d, ['posted']);
		assert.equal(await value(d, '#select-category-filter'), 'cat_old_posted');
		assert.equal(await value(d, '#select-account-filter'), 'all');
	});

	it('retains zero amount planned candidates and selected archived settings despite other filters and planned OFF', async () => {
		const d = fixture.driver;
		await prepare(d);
		await cashflow(d);
		await d.select('#select-category-filter', 'cat_old_planned');
		await waitRows(d, ['planned_zero']);
		await d.click('#btn-toggle-planned');
		await waitRows(d, []);
		await d.select('#select-status-filter', 'confirmed');
		await d.select('#select-account-filter', 'acc_old_source');
		await d.select('#select-tag-filter', '履歴');
		await d.fill('#input-tx-search', '一致しない');
		await d.waitFor('document.getElementById("month-tx-list").textContent.includes("条件に一致する取引はありません")');
		assert.equal(await value(d, '#select-category-filter'), 'cat_old_planned');
		assert.ok((await optionIds(d, '#select-category-filter')).includes('cat_old_actual'));
		assert.ok((await optionIds(d, '#select-account-filter')).includes('acc_old_planned'));
	});

	it('rebuilds candidates on month and year changes, preserves existing selections, and resets absent selections', async () => {
		const d = fixture.driver;
		await prepare(d);
		await cashflow(d);
		await d.select('#select-category-filter', 'cat_old_actual');
		await d.click('#control-granularity [data-granularity="yearly"]');
		await d.waitFor('document.getElementById("month-tx-list-title").textContent.includes("2026年")');
		assert.equal(await value(d, '#select-category-filter'), 'cat_old_actual');
		assert.ok((await optionIds(d, '#select-category-filter')).includes('cat_old_september'));
		assert.ok((await optionIds(d, '#select-category-filter')).includes('cat_old_year_boundary'));
		await d.select('#select-category-filter', 'cat_old_year_boundary');
		await waitRows(d, ['year_boundary']);
		assert.equal((await optionIds(d, '#select-category-filter')).includes('cat_old_previous_year'), false);
		await d.click('#btn-period-prev');
		await d.waitFor('document.getElementById("month-tx-list-title").textContent.includes("2025年")');
		assert.equal(await value(d, '#select-category-filter'), 'all');
		assert.deepEqual(await rowIds(d), ['previous_year']);
		await d.click('#btn-period-next');
		await d.click('#control-granularity [data-granularity="monthly"]');
		await d.select('#select-account-filter', 'acc_old_source');
		await d.click('#btn-period-prev');
		await d.waitFor('document.getElementById("month-tx-list-title").textContent.includes("2026-09")');
		assert.equal(await value(d, '#select-account-filter'), 'all');
		assert.deepEqual(await rowIds(d), ['september']);
		assert.ok((await optionIds(d, '#select-account-filter')).includes('acc_old_september'));
		assert.equal((await optionIds(d, '#select-account-filter')).includes('acc_old_source'), false);
	});

	it('does not let a delayed old period replace newer candidates or rows', async () => {
		const d = fixture.driver;
		await prepare(d);
		await cashflow(d);
		await d.evaluate(`(() => {
			const db = window.__yose_app.db;
			const read = db.getTransactions.bind(db);
			db.getTransactions = async (...args) => {
				const result = await read(...args);
				if (args[0]?.target_month === '2026-09') {
					window.__oldFilterReadWaiting = true;
					await new Promise(resolve => { window.__releaseOldFilterRead = resolve; });
				}
				return result;
			};
			const controller = window.__yose_app.txListController;
			const render = controller.renderMonthTransactions.bind(controller);
			window.__filterRenderJobs = [];
			controller.renderMonthTransactions = (...args) => {
				const promise = render(...args);
				window.__filterRenderJobs.push(promise);
				return promise;
			};
		})()`);
		await d.click('#btn-period-prev');
		await d.waitFor('window.__oldFilterReadWaiting');
		await d.click('#btn-period-next');
		await d.waitFor('window.__filterRenderJobs.length >= 2');
		await d.evaluate('window.__filterRenderJobs.at(-1)');
		await d.evaluate('window.__releaseOldFilterRead(); Promise.all(window.__filterRenderJobs)');
		assert.equal((await rowIds(d)).includes('september'), false);
		assert.equal((await rowIds(d)).includes('posted'), true);
		assert.ok((await optionIds(d, '#select-category-filter')).includes('cat_old_posted'));
		assert.equal((await optionIds(d, '#select-category-filter')).includes('cat_old_september'), false);
	});

	it('limits daily choices to the selected date and preserves only still-referenced archived selections', async () => {
		const d = fixture.driver;
		await prepare(d);
		await cashflow(d);
		await d.select('#select-category-filter', 'cat_old_actual');
		await d.click('#control-granularity [data-granularity="daily"]');
		await d.click('#breakdown-table-container [data-date="2026-10-19"]');
		await waitRows(d, ['other_day']);
		assert.equal(await value(d, '#select-category-filter'), 'cat_old_actual');
		assert.equal((await optionIds(d, '#select-category-filter')).includes('cat_old_posted'), false);
		assert.equal((await optionIds(d, '#select-account-filter')).includes('acc_old_source'), false);
		await d.click('#breakdown-table-container [data-date="2026-10-20"]');
		await waitRows(d, ['actual']);
		await d.select('#select-category-filter', 'cat_old_posted');
		await d.click('#breakdown-table-container [data-date="2026-10-19"]');
		await waitRows(d, ['other_day']);
		assert.equal(await value(d, '#select-category-filter'), 'all');
	});
});
