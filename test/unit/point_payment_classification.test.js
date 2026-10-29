import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPointPaymentTransactions } from '../../js/logic/transaction_factory.js';

const input = { date: '2026-10-20', totalAmount: 1000, pointUsed: 100, payingAccountId: 'my-wallet', categoryId: 'my-expense', subcategoryId: 'my-child', actualCategoryId: 'actual-expense', actualSubcategoryId: 'actual-child', offsetCategoryId: 'my-reward-income', offsetSubcategoryId: 'my-offset-child', memo: '任意ID', tags: ['任意'] };

describe('Point payments use configured classifications without fixed IDs', () => {
	it('applies explicit offset classifications to both axes while preserving the purchase', () => {
		const [purchase, offset] = createPointPaymentTransactions(input);
		assert.deepEqual([purchase.category_id, purchase.subcategory_id, purchase.actual_category_id, purchase.actual_subcategory_id], ['my-expense', 'my-child', 'actual-expense', 'actual-child']);
		assert.deepEqual([offset.category_id, offset.subcategory_id, offset.actual_category_id, offset.actual_subcategory_id], ['my-reward-income', 'my-offset-child', 'my-reward-income', 'my-offset-child']);
		assert.equal(purchase.amount, 1000); assert.equal(offset.amount, 100);
		assert.equal(purchase.account_id, 'my-wallet'); assert.equal(offset.account_id, 'my-wallet');
		assert.equal(purchase.related_tx_id, offset.id); assert.equal(offset.related_tx_id, purchase.id);
	});
	it('supports an explicitly unclassified child under the configured income category', () => {
		const rows = createPointPaymentTransactions({ ...input, offsetSubcategoryId: null });
		assert.equal(rows[1].category_id, 'my-reward-income');
		assert.equal(rows[1].subcategory_id, null); assert.equal(rows[1].actual_subcategory_id, null);
	});
	for (const value of [undefined, null, '']) {
		it(`rejects an unconfigured offset parent ${String(value)} instead of using a fixed ID`, () => {
			assert.throws(() => createPointPaymentTransactions({ ...input, offsetCategoryId: value }), /設定|相殺|費目/);
		});
	}
	it('keeps dedicated point account payments independent of offset settings', () => {
		const rows = createPointPaymentTransactions({ ...input, pointAccountId: 'my-points', offsetCategoryId: null, offsetSubcategoryId: null });
		assert.deepEqual(rows.map(row => row.type), ['expense', 'expense']);
		assert.deepEqual(rows.map(row => row.amount), [900, 100]);
		assert.deepEqual(rows.map(row => row.account_id), ['my-wallet', 'my-points']);
		assert.ok(rows.every(row => row.category_id === 'my-expense' && row.actual_category_id === 'actual-expense'));
	});
	for (const pointUsed of [0, 1000]) {
		it(`preserves the existing two-row accounting structure at point usage ${pointUsed}`, () => {
			const rows = createPointPaymentTransactions({ ...input, pointUsed });
			assert.equal(rows.length, 2);
			assert.equal(rows[0].amount, 1000); assert.equal(rows[1].amount, pointUsed);
			assert.equal(rows[1].category_id, 'my-reward-income');
		});
	}
	it('does not invent a fixed purchase category when the purchase is unclassified', () => {
		const { categoryId, ...unclassified } = input;
		const rows = createPointPaymentTransactions({ ...unclassified, subcategoryId: null, actualCategoryId: null, actualSubcategoryId: null });
		assert.deepEqual([rows[0].category_id, rows[0].subcategory_id, rows[0].actual_category_id, rows[0].actual_subcategory_id], [null, null, null, null]);
	});
});
