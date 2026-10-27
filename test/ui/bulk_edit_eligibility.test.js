import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
const ids = ['old-a', 'old-b'];
async function setup(d, shared = false) {
	const rows = [...ids, 'outside'].map((id, index) => transaction(id, { date: `2022-10-${20 + index}`, target_month: '2022-10', amount: [100, 350, 999][index], group_id: shared ? 'legacy-import-group' : `ordinary-${id}`, subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries' }));
	await seed(d, rows);
	await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.categories.find(cat=>cat.id==='cat_food').subcategories.find(sub=>sub.id==='sub_groceries').is_archived=true;});app.summaryController.setSelectedMonth('2022-10');const c=app.bulkEditController,save=c.save.bind(c);c.save=(...args)=>window.__bulkSave=save(...args);})()`);
	return rows;
}
async function open(d, selectedIds = ids) {
	await cashflow(d);
	for (const id of selectedIds) await d.click(`#month-tx-list [data-bulk-id="${id}"]`);
	await d.click('#btn-bulk-edit');
	await d.waitFor(`(()=>{const c=window.__yose_app.bulkEditController;return document.querySelector('#modal-bulk-edit').classList.contains('active')&&c.originals.length===${selectedIds.length}&&${JSON.stringify(selectedIds)}.every(id=>c.originals.some(tx=>tx.id===id));})()`);
}
async function save(d) {
	await d.evaluate('window.__bulkSave=null');
	await d.click('#btn-save-bulk'); await d.waitFor('Boolean(window.__bulkSave)');
	await d.evaluate('window.__bulkSave');
}
const rows = d => d.evaluate(`Promise.all(${JSON.stringify(ids)}.map(id=>window.__yose_app.db.getTransaction(id)))`);
async function restrictionReason(d, field) {
	return d.evaluate(String.raw`(()=>{
		const apply=document.querySelector('#bulk-apply-${field}'),ids=(apply.getAttribute('aria-describedby')||'').split(/\s+/).filter(Boolean);
		const descriptions=ids.map(id=>{const node=document.getElementById(id);return {id,text:node?.textContent||'',visible:Boolean(node?.checkVisibility({checkVisibilityCSS:true}))};});
		return {disabled:apply.disabled,ids,descriptions,text:descriptions.map(item=>item.text).join(' ')};
	})()`);
}
async function expectRows(d, originals, patch, outsideRaw) {
	const updated = await rows(d);
	assert.equal(updated.length, 2);
	for (const before of originals) {
		const after = updated.find(tx => tx.id === before.id);
		for (const [field, value] of Object.entries(before)) if (!['updated_at', 'sync_status', 'reclose_approved_months', ...Object.keys(patch)].includes(field)) assert.deepEqual(after[field], value, `${before.id}.${field}`);
		for (const [field, value] of Object.entries(patch)) assert.deepEqual(after[field], value);
		assert.deepEqual(after.reclose_approved_months, ['2022-10']);
	}
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","outside")'), outsideRaw);
	assert.equal(await d.evaluate('document.querySelector("#bulk-edit-error").textContent'), '');
	return updated;
}

describe('historical bulk edit eligibility and original classification display', () => {
	for (const shared of [false, true]) it(`changes historical cash to card and active classifications despite different amounts, shared group=${shared}`, async () => {
		const d = fixture.driver; await setup(d, shared); await open(d);
		let originals = await rows(d);
		const outside = await d.evaluate('window.__yose_app.db.getRaw("transactions","outside")');
		for (const field of ['account_id', 'category_id', 'subcategory_id']) assert.equal(await d.evaluate(`document.querySelector('#bulk-apply-${field}').disabled`), false, `${field} must remain applicable`);
		assert.equal(await d.evaluate('document.querySelector("#bulk-value-amount").value'), '');
		assert.ok(await d.evaluate('[...document.querySelector("#bulk-value-account_id").options].some(o=>o.value==="acc_card_a"&&!o.disabled)'));
		await d.click('#bulk-apply-account_id'); await d.select('#bulk-value-account_id', 'acc_card_a'); await save(d);
		originals = await expectRows(d, originals, { account_id: 'acc_card_a' }, outside);
		assert.deepEqual(originals.map(tx => tx.amount), [100, 350]);
		assert.deepEqual(originals.map(tx => tx.subcategory_id), ['sub_groceries', 'sub_groceries']);
		await open(d); await d.click('#bulk-apply-subcategory_id'); await d.select('#bulk-value-subcategory_id', 'sub_dining_out'); await save(d);
		originals = await expectRows(d, originals, { subcategory_id: 'sub_dining_out' }, outside);
		await open(d); await d.click('#bulk-apply-category_id'); await d.select('#bulk-value-category_id', 'cat_housing');
		assert.equal(await d.evaluate('document.querySelector("#bulk-value-subcategory_id").value'), '');
		await d.click('#bulk-apply-subcategory_id'); await d.select('#bulk-value-subcategory_id', 'sub_rent'); await save(d);
		await expectRows(d, originals, { category_id: 'cat_housing', subcategory_id: 'sub_rent' }, outside);
	});
	it('shows the common archived original child on both axes instead of calling it unclassified', async () => {
		const d = fixture.driver; await setup(d); await open(d);
		for (const prefix of ['', 'actual_']) {
			const current = await d.evaluate(`(()=>{const p=document.querySelector('#bulk-value-${prefix}category_id'),c=document.querySelector('#bulk-value-${prefix}subcategory_id');return {parent:p.value,child:c.value,label:c.selectedOptions[0]?.textContent};})()`);
			assert.equal(current.parent, 'cat_food'); assert.equal(current.child, 'sub_groceries'); assert.match(current.label, /アーカイブ済み/);
		}
	});
	it('keeps all encrypted originals when the closed-month confirmation is cancelled', async () => {
		const d = fixture.driver; await setup(d); await open(d);
		await d.click('#bulk-apply-account_id'); await d.select('#bulk-value-account_id', 'acc_card_a');
		const before = await d.evaluate('window.__yose_app.db.captureImportState()');
		await d.setConfirm(false); await save(d);
		assert.ok(await d.evaluate('window.__dialogs.some(d=>d.type==="confirm"&&d.message.includes("再月締め"))'));
		assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'), before);
		assert.equal(await d.isVisible('#modal-bulk-edit'), true);
		assert.equal(await d.evaluate('document.querySelector("#bulk-value-account_id").value'), 'acc_card_a');
		assert.equal(await d.evaluate('document.querySelector("#btn-save-bulk").disabled'), false);
	});
	it('explains a same-group real financial restriction through visible accessible text and escapes hostile IDs', async () => {
		const d = fixture.driver, hostile = 'cause<img src=x onerror=window.__bulkReasonXss=1>';
		await seed(d, [transaction(hostile, { date: '2022-10-20', target_month: '2022-10', group_id: 'financial-group' }), transaction('unselected-point', { date: '2022-10-20', target_month: '2022-10', group_id: 'financial-group', is_point_split: true })]);
		await d.evaluate('window.__yose_app.summaryController.setSelectedMonth("2022-10")');
		await open(d, [hostile]);
		assert.equal(await d.evaluate('document.querySelector("#bulk-apply-account_id").disabled'), true);
		assert.equal(await d.evaluate('document.querySelector("#bulk-apply-memo").disabled'), false);
		assert.equal(await d.evaluate('Boolean(window.__bulkReasonXss)||Boolean(document.querySelector("#bulk-edit-fields img"))'), false);
		for (const field of ['account_id', 'category_id', 'subcategory_id']) {
			const reason = await restrictionReason(d, field);
			assert.ok(reason.ids.length > 0, `${field} must reference its restriction reason`);
			assert.ok(reason.descriptions.every(item => item.visible && item.text.length > 0)); assert.ok(reason.text.includes(hostile));
			assert.match(reason.text, /関連|ポイント|金融/);
		}
		assert.equal(await d.evaluate('Boolean(window.__bulkReasonXss)||Boolean(document.querySelector("#bulk-edit-fields img"))'), false);
	});
	it('explains mixed-type classification restrictions without disabling the shared account field', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('expense'), transaction('income', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main' })]);
		await open(d, ['expense', 'income']);
		assert.equal(await d.evaluate('document.querySelector("#bulk-apply-account_id").disabled'), false);
		const reason = await restrictionReason(d, 'category_id');
		assert.equal(reason.disabled, true); assert.ok(reason.ids.length > 0); assert.match(reason.text, /種別|収入|支出/);
		assert.ok(reason.descriptions.every(item => item.visible && item.text.length > 0));
	});
});
