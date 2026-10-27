import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as bulk from '../../js/logic/bulk_edit.js';
import { transaction } from '../helpers/ui_fixture.js';

const row = (id, overrides = {}) => transaction(id, { date: '2022-10-20', target_month: '2022-10', group_id: 'legacy-import-group', subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries', ...(overrides.type === 'transfer' ? { category_id: null, subcategory_id: null, actual_category_id: null, actual_subcategory_id: null } : {}), ...overrides });
const normalFields = ['memo', 'tags', 'date', 'target_month', 'status', 'amount', 'account_id', 'category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id'];
function capabilities(selected, all) {
	assert.equal(typeof bulk.bulkEditCapabilities, 'function', 'UI and persistence must share the capability/reason API');
	const result = bulk.bulkEditCapabilities(selected, all);
	assert.ok(result.reasons && typeof result.reasons === 'object');
	assert.deepEqual(result.fields, bulk.bulkEditableFields(selected, all));
	return result;
}
function reasonContains(result, field, id) {
	assert.ok(Object.hasOwn(result.reasons, field), `${field} must explain why it is unavailable`);
	assert.ok(JSON.stringify(result.reasons[field]).includes(id), `${field} reason must identify the affected selected record`);
}

describe('bulk edit eligibility for historical ordinary records', () => {
	it('edits ordinary transfers without financial linkage and keeps their classifications empty', () => {
		const records = [row('transfer-a', { type: 'transfer', to_account_id: 'acc_bank_main', category_id: null, subcategory_id: null, actual_category_id: null, actual_subcategory_id: null }), row('transfer-b', { type: 'transfer', to_account_id: 'acc_bank_main', category_id: null, subcategory_id: null, actual_category_id: null, actual_subcategory_id: null, amount: 350 })];
		const result = capabilities(records, records);
		assert.ok(result.fields.includes('to_account_id'));
		for (const field of ['category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id']) assert.ok(!result.fields.includes(field));
		assert.deepEqual(bulk.buildBulkEdit(records, { to_account_id: 'acc_card_a' }, records), records.map(tx => ({ ...tx, to_account_id: 'acc_card_a' })));
	});
	it('retains the existing child when explicitly retaining the same parent and preserves unchanged tax amounts', () => {
		const original = row('same-parent', { tax_meta: { tax_rate: 0.1, base_amount: 91, tax_amount: 9 } });
		const [updated] = bulk.buildBulkEdit([original], { category_id: original.category_id, actual_category_id: original.actual_category_id, amount: original.amount }, [original]);
		assert.deepEqual(updated, { ...original, amount_pending: false });
	});
	it('explains a minimal deletion marker without requiring financial fields or a date', () => {
		const marker = { id: 'deleted-marker', is_deleted: true }, result = capabilities([marker], [marker]);
		assert.deepEqual(result.fields, []);
		reasonContains(result, 'account_id', marker.id);
		assert.ok(JSON.stringify(result.reasons.account_id).includes('削除'));
	});
	it('protects an ungrouped selected record and multiple reverse references even when selection is outside the related-record list', () => {
		const selected = row('ungrouped-source', { group_id: undefined });
		const references = [row('first-reference', { related_tx_id: selected.id, group_id: '__proto__' }), row('second-reference', { related_tx_id: selected.id, group_id: '__proto__' })];
		const before = structuredClone([selected, ...references]), result = capabilities([selected], references);
		assert.deepEqual(result.fields, ['memo', 'tags']);
		reasonContains(result, 'account_id', selected.id);
		for (const reference of references) assert.ok(JSON.stringify(result.reasons.account_id).includes(reference.id));
		assert.deepEqual([selected, ...references], before);
	});
	for (const status of ['confirmed', 'planned']) it(`retains ordinary fields for ${status} history despite a shared group and different values`, () => {
		const rows = [row('old-a', { status, amount: 100 }), row('old-b', { status, amount: 350, date: '2022-10-21', account_id: 'acc_bank_main' })];
		for (const selected of [rows, [rows[0]]]) assert.deepEqual(bulk.bulkEditableFields(selected, rows).slice().sort(), normalFields.slice().sort());
	});
	it('changes only specified ordinary fields without altering amounts, classifications, groups or unselected rows', () => {
		const rows = [row('old-a', { amount: 100 }), row('old-b', { amount: 350 }), row('outside', { amount: 999 })], before = structuredClone(rows);
		const updated = bulk.buildBulkEdit(rows.slice(0, 2), { account_id: 'acc_card_a' }, rows);
		assert.deepEqual(updated, before.slice(0, 2).map(tx => ({ ...tx, account_id: 'acc_card_a' })));
		assert.deepEqual(rows, before);
	});
	it('returns no restrictions for eligible fields and handles empty or deleted selection', () => {
		const a = row('ordinary');
		const result = capabilities([a], [a]);
		assert.deepEqual(result.fields.slice().sort(), normalFields.slice().sort());
		for (const field of normalFields) assert.ok(!result.reasons[field] || JSON.stringify(result.reasons[field]) === '[]');
		assert.deepEqual(capabilities([], [a]).fields, []);
		assert.deepEqual(capabilities([{ ...a, is_deleted: true }], [a]).fields, []);
	});
	it('explains mixed income/expense classification restrictions while keeping the common account field', () => {
		const rows = [row('expense'), row('income', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', subcategory_id: null, actual_subcategory_id: null })];
		const result = capabilities(rows, rows);
		assert.ok(result.fields.includes('account_id'));
		for (const field of ['category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id']) {
			assert.ok(!result.fields.includes(field));
			reasonContains(result, field, 'expense'); reasonContains(result, field, 'income');
		}
	});
	it('does not turn deleted financial siblings or prototype-like ordinary group names into relationships', () => {
		const a = row('ordinary', { group_id: '__proto__' }), deleted = row('deleted-point', { group_id: '__proto__', is_point_split: true, is_deleted: true });
		assert.deepEqual(bulk.bulkEditableFields([a], [a, deleted]).slice().sort(), normalFields.slice().sort());
	});
});

describe('bulk edit protection for actual financial relationships', () => {
	for (const role of [
		{ amortization_meta: {} },
		{ type: 'transfer', to_account_id: 'acc_card_a', auto_settlement_meta: { card_id: 'acc_card_a', billing_cycle: '2022-10' } },
		{ is_advance_split: true },
		{ is_point_split: true },
		{ account_id: 'acc_prepaid' },
		{ to_account_id: 'acc_receivable', type: 'transfer' },
		{ advance_source_id: 'unloaded-source', type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet' },
		{ related_tx_id: 'unloaded-point' }
	]) it(`protects the selected financial role and gives record-specific reasons: ${JSON.stringify(role)}`, () => {
		const a = row('protected-record', role), result = capabilities([a], [a]);
		assert.deepEqual(result.fields, ['memo', 'tags']);
		for (const field of ['date', 'amount', 'account_id', 'category_id', 'subcategory_id']) reasonContains(result, field, a.id);
		assert.throws(() => bulk.buildBulkEdit([a], { amount: 20 }, [a]), /項目/);
	});
	it('protects an unmarked selected row when a live financial role exists elsewhere in its group', () => {
		const a = row('selected-ordinary'), sibling = row('unselected-point', { is_point_split: true });
		const result = capabilities([a], [a, sibling]);
		assert.deepEqual(result.fields, ['memo', 'tags']);
		reasonContains(result, 'account_id', a.id);
		assert.throws(() => bulk.buildBulkEdit([a], { account_id: 'acc_card_a' }, [a, sibling]), /項目/);
	});
	for (const field of ['related_tx_id', 'advance_source_id']) it(`protects a selected record referenced through ${field} without relying on a shared group`, () => {
		const a = row('selected-source', field === 'advance_source_id' ? { type: 'transfer', to_account_id: 'acc_receivable' } : {});
		const reference = row('reference', { group_id: 'separate-financial-group', ...(field === 'advance_source_id' ? { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet' } : {}), [field]: a.id });
		assert.deepEqual(bulk.bulkEditableFields([a], [a, reference]), ['memo', 'tags']);
		const result = capabilities([a], [a, reference]); reasonContains(result, 'account_id', a.id);
	});
});
