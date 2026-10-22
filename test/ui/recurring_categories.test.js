import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, settings, submit, value, seedLegacy, transaction } from '../helpers/ui_fixture.js';

async function prepare(d, overrides = null) {
	await d.evaluate(`(async () => {
		const app = window.__yose_app, config = await app.db.getMasterConfig();
		config.recurring_rules = ${JSON.stringify(overrides === null ? [] : [{ id: 'rec_categories', name: '分類確認', is_active: false, type: 'expense', amount: 100, account_id: 'acc_wallet', category_id: 'cat_food', subcategory_id: 'sub_groceries', actual_category_id: 'cat_food', actual_subcategory_id: 'sub_groceries', day_of_month: 10, ...overrides }])};
		await app.db.saveMasterConfig(config); await app.refreshAllViews();
	})()`);
	await settings(d, 'recurring');
	await d.click(overrides === null ? '#btn-add-recurring' : '.btn-edit-recurring[data-id="rec_categories"]');
	await d.waitFor('document.getElementById("m-rec-cat")');
}

async function same(d, checked, hidden = checked) {
	assert.deepEqual(await d.evaluate(`({ checked: document.getElementById('m-rec-sync-actual')?.checked, hidden: document.getElementById('m-rec-actual-classification')?.hidden })`), { checked, hidden });
	assert.equal(await d.isVisible('#m-rec-actual-classification'), !hidden);
}

async function save(d) {
	await submit(d, '#form-master-recurring');
	await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
	return d.evaluate('(async () => (await window.__yose_app.db.getMasterConfig()).recurring_rules.at(-1))()');
}

describe('Recurring classification grouping and shared subcategory wording', { timeout: 180000 }, () => {
	const fixture = useBrowser();
	it('starts new rules grouped and saves changed accounting parent and child to both axes', async () => {
		const d = fixture.driver; await prepare(d); await same(d, true);
		await d.fill('#m-rec-name', '分類を共有'); await d.fill('#m-rec-amount', '2500');
		await d.select('#m-rec-cat', 'cat_housing'); await d.select('#m-rec-sub', 'sub_rent');
		assert.equal(await value(d, '#m-rec-actual-cat'), 'cat_housing');
		assert.equal(await value(d, '#m-rec-actual-sub'), 'sub_rent');
		const rule = await save(d);
		assert.equal(rule.category_id, 'cat_housing'); assert.equal(rule.actual_category_id, 'cat_housing');
		assert.equal(rule.subcategory_id, 'sub_rent'); assert.equal(rule.actual_subcategory_id, 'sub_rent');
	});
	it('opens equal saved classifications grouped without changing their values', async () => {
		const d = fixture.driver; await prepare(d, {}); await same(d, true);
		const rule = await save(d);
		assert.equal(rule.category_id, 'cat_food'); assert.equal(rule.actual_category_id, 'cat_food');
		assert.equal(rule.subcategory_id, 'sub_groceries'); assert.equal(rule.actual_subcategory_id, 'sub_groceries');
	});
	for (const [label, overrides, category, child] of [
		['different parents', { actual_category_id: 'cat_housing', actual_subcategory_id: 'sub_rent' }, 'cat_housing', 'sub_rent'],
		['different children', { actual_subcategory_id: 'sub_dining_out' }, 'cat_food', 'sub_dining_out'],
		['an explicit empty actual child', { actual_subcategory_id: null }, 'cat_food', ''],
		['an omitted child under a different actual parent', { actual_category_id: 'cat_housing', actual_subcategory_id: undefined }, 'cat_housing', '']
	]) {
		it(`keeps ${label} separate and preserves the effective saved classifications`, async () => {
			const d = fixture.driver; await prepare(d, overrides); await same(d, false);
			assert.equal(await value(d, '#m-rec-actual-cat'), category); assert.equal(await value(d, '#m-rec-actual-sub'), child);
			const rule = await save(d);
			assert.equal(rule.category_id, 'cat_food'); assert.equal(rule.subcategory_id, 'sub_groceries');
			assert.equal(rule.actual_category_id, category); assert.equal(rule.actual_subcategory_id, child || null);
		});
	}
	it('groups legacy omitted actual fields by the same effective parent and child as recurring generation', async () => {
		const d = fixture.driver; await prepare(d, { actual_category_id: undefined, actual_subcategory_id: undefined }); await same(d, true);
		assert.equal(await value(d, '#m-rec-actual-sub'), 'sub_groceries');
		const rule = await save(d); assert.equal(rule.actual_category_id, 'cat_food'); assert.equal(rule.actual_subcategory_id, 'sub_groceries');
	});
	it('initializes independent fields from the latest grouped values and supports regrouping', async () => {
		const d = fixture.driver; await prepare(d, { actual_category_id: 'cat_housing', actual_subcategory_id: 'sub_rent' });
		await d.click('#m-rec-sync-actual'); await same(d, true);
		await d.select('#m-rec-cat', 'cat_social'); await d.select('#m-rec-sub', 'sub_leisure');
		await d.click('#m-rec-sync-actual'); await same(d, false);
		assert.equal(await value(d, '#m-rec-actual-cat'), 'cat_social'); assert.equal(await value(d, '#m-rec-actual-sub'), 'sub_leisure');
		await d.select('#m-rec-actual-cat', 'cat_housing');
		assert.equal(await value(d, '#m-rec-actual-sub'), '');
		const rule = await save(d); assert.equal(rule.category_id, 'cat_social'); assert.equal(rule.subcategory_id, 'sub_leisure');
		assert.equal(rule.actual_category_id, 'cat_housing'); assert.equal(rule.actual_subcategory_id, null);
	});
	it('keeps grouped state after a type change and saves no classifications for transfers', async () => {
		const d = fixture.driver; await prepare(d); await d.fill('#m-rec-name', '振替分類'); await d.fill('#m-rec-amount', '100');
		await d.select('#m-rec-type', 'income'); await same(d, true);
		await d.select('#m-rec-cat', 'cat_income_main'); await d.select('#m-rec-sub', 'sub_salary');
		assert.equal(await value(d, '#m-rec-actual-sub'), 'sub_salary');
		await d.select('#m-rec-type', 'transfer'); assert.equal(await d.isVisible('#m-rec-classification'), false);
		await d.select('#m-rec-to-account', 'acc_bank_main');
		const rule = await save(d);
		for (const key of ['category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id']) assert.equal(rule[key], null, key);
	});
	it('preserves untouched archived classifications in inactive rules but excludes them from new rules', async () => {
		const d = fixture.driver; await prepare(d, {}); await d.click('#btn-close-master-modal');
		await d.evaluate(`(async () => { const app=window.__yose_app, config=await app.db.getMasterConfig(); const category=config.categories.find(c=>c.id==='cat_food');category.is_archived=true;category.subcategories[0].is_archived=true;await app.db.saveMasterConfig(config);await app.refreshAllViews(); })()`);
		await d.click('.btn-edit-recurring[data-id="rec_categories"]'); await same(d, true);
		assert.equal(await value(d, '#m-rec-cat'), 'cat_food'); assert.equal(await value(d, '#m-rec-sub'), 'sub_groceries');
		const rule = await save(d); assert.equal(rule.category_id, 'cat_food'); assert.equal(rule.actual_subcategory_id, 'sub_groceries');
		await d.click('#btn-add-recurring');
		assert.equal(await d.evaluate('Array.from(document.getElementById("m-rec-cat").options).some(o=>o.value==="cat_food")'), false);
	});
	it('uses the transaction subcategory wording in recurring, insurance premium, and maintenance selectors', async () => {
		const d = fixture.driver; await prepare(d);
		for (const id of ['m-rec-sub', 'm-rec-actual-sub']) assert.equal(await d.evaluate(`document.getElementById('${id}').options[0].textContent`), '（指定なし / 費目のみ）');
		await d.click('#btn-close-master-modal'); await settings(d, 'accounts'); await d.click('#btn-add-account'); await d.select('#m-acc-type', 'insurance');
		assert.equal(await d.evaluate('document.getElementById("m-acc-premium-sub").options[0].textContent'), '（指定なし / 費目のみ）');
		await d.setConfirm(true); await d.click('#btn-close-master-modal');
		await d.evaluate(`(async () => { const db=window.__yose_app.db, config=await db.getMasterConfig();config.categories.find(c=>c.id==='cat_food').is_archived=true;await db.saveMasterConfig(config); })()`);
		await seedLegacy(d, [transaction('wording_maintenance')]); await settings(d); await d.click('#maintenance-panel summary'); await d.click('#btn-refresh-maintenance');
		await d.waitFor('document.getElementById("maintenance-source").options.length>0');
		assert.equal(await d.evaluate('document.getElementById("maintenance-subcategory").options[0].textContent'), '（指定なし / 費目のみ）');
	});
});
