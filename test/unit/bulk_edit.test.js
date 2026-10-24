import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bulkEditableFields, buildBulkEdit } from '../../js/logic/bulk_edit.js';
import { transaction } from '../helpers/ui_fixture.js';
const a = transaction('a'); const b = transaction('b');
describe('bulk transaction edits', () => {
	it('enables only the intersection of applicable fields for mixed transaction types', () => {
		const mixed = [a, { ...b, type: 'transfer', to_account_id: 'acc_bank_main', category_id: null, actual_category_id: null }];
		assert.ok(bulkEditableFields(mixed, mixed).includes('memo'));
		assert.ok(!bulkEditableFields(mixed, mixed).includes('category_id'));
		assert.ok(!bulkEditableFields(mixed, mixed).includes('to_account_id'));
		assert.ok(bulkEditableFields([a, b], [a, b]).includes('actual_subcategory_id'));
	});
	for (const special of [{ type: 'transfer', to_account_id: 'acc_prepaid', category_id: null, actual_category_id: null, amortization_meta: { is_payment_record: true, total_amount: 100, months: 1 } }, { type: 'transfer', to_account_id: 'acc_card_a', category_id: null, actual_category_id: null, auto_settlement_meta: { card_id: 'acc_card_a', billing_cycle: '2026-09', debit_account_id: 'acc_wallet' } }, { is_point_split: true }, { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null, advance_source_id: 'source' }, { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null }, { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null }, { group_id: a.group_id }]) {
		it(`limits related records to descriptive fields: ${JSON.stringify(special)}`, () => {
			const rows = [a, { ...b, ...special }];
			assert.deepEqual(bulkEditableFields(rows, rows), ['memo', 'tags']);
			assert.throws(() => buildBulkEdit(rows, { amount: 9 }, rows), /項目/);
		});
	}
	it('changes only explicitly selected fields, preserves links and resets tax only for amount changes', () => {
		const original = { ...a, tax_meta: { rate: 10 }, subcategory_id: 'old' };
		const r = buildBulkEdit([original, b], { memo: '', tags: ['寄附'], category_id: 'new' }, [original, b]);
		assert.equal(r[0].memo, ''); assert.deepEqual(r[0].tags, ['寄附']); assert.equal(r[0].subcategory_id, null);
		assert.deepEqual(r[0].tax_meta, { rate: 10 }); assert.equal(r[0].amount, a.amount); assert.equal(r[0].id, a.id);
		assert.equal(buildBulkEdit([original], { amount: 10 }, [original])[0].tax_meta, null);
		assert.equal(original.memo, 'a');
	});
	it('rejects no selection, no changes, unsupported fields, invalid amounts/status, and deleted rows', () => {
		assert.throws(() => buildBulkEdit([], { memo: 'x' }, []));
		assert.throws(() => buildBulkEdit([a], {}, [a]));
		for (const patch of [{ id: 'new' }, { amount: -1 }, { amount: 1.5 }, { status: 'invalid' }, { memo: 4 }, { tags: 'bad' }, { date: '2026-02-30' }, { target_month: '2026-13' }]) assert.throws(() => buildBulkEdit([a], patch, [a]));
		assert.throws(() => buildBulkEdit([{ ...a, is_deleted: true }], { memo: 'x' }, []));
	});
});

it('keeps accounting and actual classification independent, clears explicit tags, and accepts pending zero', () => {
	const original = { ...a, actual_subcategory_id: 'actualOld', tags: ['old'] };
	const r = buildBulkEdit([original], { actual_category_id: 'actualNew', tags: [] }, [original])[0];
	assert.equal(r.category_id, original.category_id); assert.equal(r.actual_category_id, 'actualNew'); assert.equal(r.actual_subcategory_id, null); assert.deepEqual(r.tags, []);
	const pending = { ...a, amount: 0, amount_pending: true, status: 'planned' };
	assert.equal(buildBulkEdit([pending], { amount: 0 }, [pending])[0].amount_pending, false);
	assert.throws(() => buildBulkEdit([pending], { status: 'confirmed' }, [pending]));
});
