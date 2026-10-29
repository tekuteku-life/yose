import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createPrepaidAmortizationTransactions, createAdvancePaymentTransactions, createPointPaymentTransactions, createCreditCardSettlementTransaction, generateRecurringTransactions, calculateBalancesAndSummaries } from '../../js/logic.js';

const base = { date: '2026-10-01', paymentDate: '2026-10-01', payingAccountId: 'acc_wallet', categoryId: 'cat_a', subcategoryId: 'sub_a', actualCategoryId: 'cat_b', totalAmount: 100, selfAmount: 100, advanceAmount: 0, pointUsed: 0, amortizeMonths: 1, offsetCategoryId: 'cat_point_income', offsetSubcategoryId: 'sub_point_offset' };
const factories = [
	['prepaid', input => createPrepaidAmortizationTransactions(input)],
	['advance', input => createAdvancePaymentTransactions(input)],
	['point offset', input => createPointPaymentTransactions(input)],
	['point account', input => createPointPaymentTransactions({ ...input, pointUsed: 10, pointAccountId: 'acc_point' })],
	['recurring', input => generateRecurringTransactions([{ id: 'rule', is_active: true, type: 'expense', amount: 100, account_id: input.payingAccountId, category_id: input.categoryId, subcategory_id: input.subcategoryId, actual_category_id: input.actualCategoryId, ...(Object.hasOwn(input, 'actualSubcategoryId') ? { actual_subcategory_id: input.actualSubcategoryId } : {}) }], '2026-10')]
];

describe('Generated transaction integrity', () => {
	for (const [name, factory] of factories) {
		it(`${name} preserves explicit empty actual child and never borrows from another parent`, () => {
			for (const value of [null, '', undefined]) {
				const expenses = factory({ ...base, ...(value === undefined ? {} : { actualSubcategoryId: value }) }).filter(tx => tx.type === 'expense');
				assert.ok(expenses.length);
				assert.ok(expenses.every(tx => tx.actual_category_id === 'cat_b' && !tx.actual_subcategory_id));
			}
		});
		it(`${name} defaults an omitted actual child only when both parents match`, () => {
			const expenses = factory({ ...base, actualCategoryId: 'cat_a' }).filter(tx => tx.type === 'expense');
			assert.ok(expenses.every(tx => tx.actual_subcategory_id === 'sub_a'));
			assert.ok(factory({ ...base, actualCategoryId: 'cat_a', actualSubcategoryId: null }).filter(tx => tx.type === 'expense').every(tx => tx.actual_subcategory_id === null));
		});
	}
	it('keeps explicit null and different-parent omitted children unclassified in actual summaries', () => {
		for (const actual of [{ actual_category_id: 'cat_a', actual_subcategory_id: null }, { actual_category_id: 'cat_b' }]) {
			const tx = { id: 'tx', date: '2026-10-01', target_month: '2026-10', type: 'expense', status: 'confirmed', amount: 100, account_id: 'acc_wallet', category_id: 'cat_a', subcategory_id: 'sub_a', ...actual };
			const result = calculateBalancesAndSummaries({}, [tx], '2026-10');
			assert.equal(result.by_actual_category[actual.actual_category_id].by_subcategory.sub_unclassified.total, 100);
			assert.equal(result.by_actual_category[actual.actual_category_id].by_subcategory.sub_a, undefined);
		}
	});
	it('rejects point amounts larger than the purchase, with either point handling', () => {
		for (const pointAccountId of [null, 'acc_point']) assert.throws(() => createPointPaymentTransactions({ ...base, pointUsed: 101, pointAccountId }), /ポイント|総額/);
	});
	it('uses stable collision-free recurring IDs while respecting old random IDs and deleted schedules', () => {
		const rule = { id: 'rec.a/:b', is_active: true, type: 'expense', account_id: 'acc_wallet', category_id: 'cat_a', amount: 100 };
		const [first] = generateRecurringTransactions([rule], '2026-10');
		assert.equal(generateRecurringTransactions([rule], '2026-10')[0].id, first.id);
		assert.notEqual(generateRecurringTransactions([rule], '2026-11')[0].id, first.id);
		assert.notEqual(generateRecurringTransactions([{ ...rule, id: 'rec.a/:b_2026' }], '2026-10')[0].id, first.id);
		assert.notEqual(generateRecurringTransactions([{ ...rule, id: 'rec.a%2F:b' }], '2026-10')[0].id, first.id);
		assert.deepEqual(generateRecurringTransactions([rule], '2026-10', [], [{ ...first, id: 'legacy_random' }]), []);
		assert.equal(generateRecurringTransactions([rule], '2026-10', [], [{ ...first, is_deleted: true }])[0].id, first.id);
	});
	it('gives the same logical credit card settlement a stable ID across dates and devices', () => {
		const input = { payingAccountId: 'acc_wallet', creditCardId: 'card_/:2026-09', amount: 100, debitDate: '2026-10-20', billingCycle: '2026-09' };
		const first = createCreditCardSettlementTransaction(input);
		assert.equal(createCreditCardSettlementTransaction({ ...input, debitDate: '2026-10-21', amount: 200 }).id, first.id);
		assert.notEqual(createCreditCardSettlementTransaction({ ...input, billingCycle: '2026-10' }).id, first.id);
		for (const creditCardId of ['card_/:2026-09_', 'card_%2F:2026-09', 'card_/:2026']) assert.notEqual(createCreditCardSettlementTransaction({ ...input, creditCardId }).id, first.id);
	});
});
