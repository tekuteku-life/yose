import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow, rowIds } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
const many = count => Array.from({ length: count }, (_, i) => transaction(`nav_${String(i).padStart(3, '0')}`));
const page = (d, current, total = 3) => d.waitFor(`document.querySelector('#tx-pagination-info').textContent.startsWith('${current} / ${total}') && document.querySelector('#select-tx-page').value === '${current}'`);
const atTop = d => d.waitFor(`(() => {
	const top = document.querySelector('#tx-pagination-controls-top').getBoundingClientRect();
	const bottom = Math.max(...[...document.querySelectorAll('header,.nav-tabs')].map(e => e.getBoundingClientRect().bottom));
	const atDocumentEnd = scrollY >= document.documentElement.scrollHeight - innerHeight - 1;
	return top.top >= bottom + 10 && (top.top <= bottom + 16 || atDocumentEnd) && document.querySelector('#month-tx-list .tx-item').getBoundingClientRect().top < innerHeight;
})()`);
const holdPageRead = d => d.evaluate(`{
	const app = window.__yose_app, read = app.db.getTransactions.bind(app.db), go = app.txListController.goToPage.bind(app.txListController);
	let once = true;
	app.db.getTransactions = async (...args) => { const rows = await read(...args); if (once) { once = false; await new Promise(r => window.__pageRelease = r); } return rows; };
	app.txListController.goToPage = (...args) => { window.__pagePromise = go(...args); return window.__pagePromise; };
}`);

it('synchronizes upper/lower buttons and direct page selection with boundary states and selected rows', async () => {
	const d = fixture.driver; await seed(d, many(65)); await cashflow(d);
	assert.equal(await d.isVisible('#tx-pagination-controls-top'), true);
	await d.click('#btn-bulk-select-page');
	const first = await rowIds(d);
	await d.click('#btn-tx-next-page-top'); await page(d, 2);
	assert.equal((await rowIds(d)).length, 30);
	assert.ok(!(await rowIds(d)).some(id => first.includes(id)));
	assert.equal(await d.textContent('#tx-pagination-info-top'), await d.textContent('#tx-pagination-info'));
	await d.select('#select-tx-page', '3'); await page(d, 3);
	assert.equal((await rowIds(d)).length, 5);
	assert.equal(await d.evaluate('document.querySelector("#btn-tx-next-page-top").disabled && document.querySelector("#btn-tx-next-page").disabled'), true);
	await d.click('#btn-tx-prev-page'); await page(d, 2);
	await d.select('#select-tx-page', '1'); await page(d, 1);
	assert.equal(await d.evaluate('document.querySelectorAll("#month-tx-list input[data-bulk-id]:checked").length'), 30);
	assert.equal(await d.evaluate('document.querySelector("#btn-tx-prev-page-top").disabled && document.querySelector("#btn-tx-prev-page").disabled'), true);
});

it('scrolls explicit lower and upper page changes and number selection to the unobscured list top', async () => {
	const d = fixture.driver; await seed(d, many(90)); await cashflow(d);
	await d.click('#btn-tx-next-page'); await page(d, 2); await atTop(d);
	await d.click('#btn-tx-next-page-top'); await page(d, 3); await atTop(d);
	await d.click('#btn-tx-prev-page'); await page(d, 2); await atTop(d);
	await d.select('#select-tx-page', '1'); await page(d, 1); await atTop(d);
	await d.evaluate('window.scrollTo(0,document.querySelector("#month-tx-list").offsetTop+400)');
	const before = await d.evaluate('scrollY');
	await d.evaluate('window.__yose_app.txListController.renderMonthTransactions()');
	assert.equal(await d.evaluate('scrollY'), before, 'background refresh must preserve the current reading position');
});

it('accepts a real keyboard selection of the last page and synchronizes rows, controls, and scroll', async () => {
	const d = fixture.driver; await seed(d, many(65)); await cashflow(d);
	await d.evaluate('document.querySelector("#select-tx-page").focus()');
	for (const type of ['keyDown', 'keyUp']) await d.send('Input.dispatchKeyEvent', { type, key: 'End', code: 'End', windowsVirtualKeyCode: 35, nativeVirtualKeyCode: 35 }, d.sessionId);
	await page(d, 3); await atTop(d);
	assert.equal((await rowIds(d)).length, 5);
	assert.equal(await d.textContent('#tx-pagination-info-top'), await d.textContent('#tx-pagination-info'));
	assert.equal(await d.evaluate('document.querySelector("#btn-tx-next-page-top").disabled && document.querySelector("#btn-tx-next-page").disabled'), true);
});

it('normalizes both controls and direct choices when rows shrink, become empty, and grow again', async () => {
	const d = fixture.driver; await seed(d, many(65)); await cashflow(d); await d.select('#select-tx-page', '3'); await page(d, 3);
	await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.putTransactions((await app.db.getTransactions()).slice(31).map(tx=>({...tx,is_deleted:true})));await app.txListController.renderMonthTransactions();})()`);
	await page(d, 2, 2); assert.equal((await rowIds(d)).length, 1);
	assert.equal(await d.evaluate('document.querySelector("#select-tx-page").options.length'), 2);
	await d.fill('#input-tx-search', '存在しない');
	await d.waitFor('document.querySelector("#month-tx-list").textContent.includes("条件に一致する取引はありません")');
	for (const id of ['tx-pagination-controls', 'tx-pagination-controls-top']) assert.equal(await d.isVisible(`#${id}`), false);
	assert.equal(await d.evaluate('window.__yose_app.txListController.currentPage'), 1);
	await d.fill('#input-tx-search', ''); await page(d, 1, 2);
	await d.fill('#input-tx-search', 'nav_000');
	await d.waitFor('document.querySelectorAll("#month-tx-list .tx-item").length===1');
	assert.equal(await d.isVisible('#tx-pagination-controls-top'), false);
	assert.equal(await d.isVisible('#tx-pagination-controls'), false);
});

it('keeps a newer page when an earlier asynchronous page request completes later', async () => {
	const d = fixture.driver; await seed(d, many(90)); await cashflow(d); await holdPageRead(d);
	await d.click('#btn-tx-next-page-top'); await d.waitFor('typeof window.__pageRelease==="function"');
	await d.evaluate('window.__oldPage=window.__pagePromise;document.querySelector("#btn-tx-next-page-top").click()');
	await page(d, 3); await atTop(d);
	const ids = await rowIds(d);
	await d.evaluate('window.scrollBy(0,350)'); const before = await d.evaluate('scrollY');
	await d.evaluate('(async()=>{window.__pageRelease();await window.__oldPage;})()');
	assert.deepEqual(await rowIds(d), ids); assert.equal(await d.evaluate('scrollY'), before);
});

it('cancels a pending page scroll on tab round-trip even before the replacement render starts', async () => {
	const d = fixture.driver; await seed(d, many(90)); await cashflow(d); await holdPageRead(d);
	await d.click('#btn-tx-next-page-top'); await d.waitFor('typeof window.__pageRelease==="function"');
	await d.evaluate(`{
		window.__yose_app.summaryController.renderSummary=async()=>{};
		document.querySelector('[data-tab="tab-settings"]').click();
		document.querySelector('[data-analytics-target="cashflow"]').click();
		window.scrollTo(0,document.querySelector('#month-tx-list').offsetTop+400);
	}`);
	const before = await d.evaluate('scrollY');
	await d.evaluate('(async()=>{window.__pageRelease();await window.__pagePromise;})()');
	await page(d, 2); assert.equal(await d.evaluate('scrollY'), before);
});

it('cancels pending page scrolling when a later filter event precedes its delayed render', async () => {
	const d = fixture.driver; await seed(d, many(90)); await cashflow(d); await holdPageRead(d);
	await d.click('#btn-tx-next-page-top'); await d.waitFor('typeof window.__pageRelease==="function"');
	await d.evaluate(`{
		const c=window.__yose_app.txListController, render=c.renderMonthTransactions.bind(c);
		c.renderMonthTransactions=()=>{window.__filterPromise=(async()=>{await new Promise(r=>window.__filterRelease=r);return render();})();return window.__filterPromise;};
		const input=document.querySelector('#input-tx-search');input.value='nav_';input.dispatchEvent(new Event('input',{bubbles:true}));
		window.scrollTo(0,document.querySelector('#month-tx-list').offsetTop+400);
	}`);
	const before = await d.evaluate('scrollY');
	await d.evaluate('(async()=>{window.__pageRelease();await window.__pagePromise;})()');
	assert.equal(await d.evaluate('scrollY'), before);
	await d.evaluate('(async()=>{window.__filterRelease();await window.__filterPromise;})()'); await page(d, 1);
});

it('discards a page request completed after the encryption key is locked', async () => {
	const d = fixture.driver; await seed(d, many(65)); await cashflow(d); await holdPageRead(d);
	await d.click('#btn-tx-next-page-top'); await d.waitFor('typeof window.__pageRelease==="function"');
	await d.evaluate('window.__yose_app.authController.showLockScreen()');
	const before = await d.evaluate('scrollY');
	await d.evaluate('(async()=>{window.__pageRelease();await window.__pagePromise;})()');
	assert.equal(await d.evaluate('scrollY'), before);
	assert.equal(await d.isVisible('#auth-screen'), true);
});

it('visibly labels the type filter at 320px and combines each type with existing filters', async () => {
	const d = fixture.driver;
	await d.send('Emulation.setDeviceMetricsOverride', {width:320,height:800,deviceScaleFactor:1,mobile:false}, d.sessionId);
	await seed(d, ['income','expense','transfer'].flatMap(type => {
		const classification = { type, category_id: type === 'income' ? 'cat_income_main' : type === 'transfer' ? null : 'cat_food', actual_category_id: type === 'income' ? 'cat_income_main' : type === 'transfer' ? null : 'cat_food', to_account_id: type === 'transfer' ? 'acc_bank_main' : null };
		return [transaction(`${type}_yes`, { ...classification, tags: ['対象'] }), transaction(`${type}_no`, classification)];
	}));
	await cashflow(d);
	assert.equal(await d.evaluate('document.querySelector("label[for=select-type-filter]").textContent.includes("収支種別")'), true);
	assert.equal(await d.evaluate('[...document.querySelectorAll(".tx-filters,.tx-filters label,.tx-filters input,.tx-filters select")].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})'), true);
	await d.select('#select-tag-filter','対象');
	for (const type of ['income','expense','transfer']) {
		await d.select('#select-type-filter',type);
		await d.waitFor(`document.querySelectorAll('#month-tx-list .tx-item').length===1 && document.querySelector('#month-tx-list .tx-item').dataset.id==='${type}_yes'`);
		assert.deepEqual(await rowIds(d), [`${type}_yes`]);
	}
	await d.select('#select-type-filter','all'); await d.waitFor('document.querySelectorAll("#month-tx-list .tx-item").length===3');
});
