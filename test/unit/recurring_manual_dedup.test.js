import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as factory from '../../js/logic/transaction_factory.js';
import { transaction } from '../helpers/ui_fixture.js';

const month = '2026-10';
const rule = (id = 'rule-a', changes = {}) => ({ id, is_active: true, type: 'expense', amount: 100, account_id: 'acc_wallet', to_account_id: null, category_id: 'cat_food', subcategory_id: 'sub_groceries', actual_category_id: 'cat_food', actual_subcategory_id: 'sub_groceries', day_of_month: 15, start_date: '2026-01-01', frequency: 'monthly', memo: '定期購入', ...changes });
const manual = (id = 'manual-a', changes = {}) => transaction(id, { amount: 100, subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries', recurring_rule_id: null, ...changes });
const generate = (rules, existing) => factory.generateRecurringTransactions(rules, month, [], existing, '2026-10-20');

describe('Recurring generation consumes matching manual entries once', () => {
	for (const status of ['planned', 'confirmed']) {
		it(`skips a matching known-amount ${status} manual entry despite a different date and memo`, () => {
			const original = manual('entered', { status, date: '2026-09-30', memo: '手入力の別メモ' });
			const before = structuredClone(original);
			assert.deepEqual(generate([rule()], [original]), []);
			assert.deepEqual(original, before);
		});
	}
	for (const [field, value] of Object.entries({ target_month: '2026-11', type: 'income', account_id: 'acc_bank_a', to_account_id: 'acc_bank_a', category_id: 'cat_housing', subcategory_id: 'sub_dining_out', amount: 101 })) {
		it(`generates when manual ${field} differs`, () => {
			const generated = generate([rule()], [manual('different', { [field]: value })]);
			assert.equal(generated.length, 1);
			assert.equal(generated[0].recurring_rule_id, 'rule-a');
		});
	}
	it('does not add actual classifications, memo or date to the user-selected matching key', () => {
		assert.deepEqual(generate([rule()], [manual('different-actual', { actual_category_id: 'cat_housing', actual_subcategory_id: 'sub_rent' })]), []);
	});
	it('consumes one manual entry for only one of two identical rules in setting order', () => {
		const generated = generate([rule('first'), rule('second')], [manual()]);
		assert.equal(generated.length, 1);
		assert.equal(generated[0].recurring_rule_id, 'second');
	});
	it('consumes two manual entries for two rules without changing either entry', () => {
		const existing = [manual('z'), manual('a')], before = structuredClone(existing);
		assert.deepEqual(generate([rule('first'), rule('second')], existing), []);
		assert.deepEqual(existing, before);
	});
	it('prioritizes linked-rule satisfaction and never borrows another rule record', () => {
		const generated = generate([rule('first'), rule('second')], [manual('linked', { recurring_rule_id: 'first' })]);
		assert.equal(generated.length, 1);
		assert.equal(generated[0].recurring_rule_id, 'second');
	});
	it('excludes deleted entries from manual satisfaction', () => {
		assert.equal(generate([rule()], [manual('deleted', { is_deleted: true })]).length, 1);
	});
	it('distinguishes explicit zero from an unknown amount', () => {
		assert.deepEqual(generate([rule('zero', { amount: 0 })], [manual('known-zero', { amount: 0 })]), []);
		assert.equal(generate([rule('zero', { amount: 0 })], [manual('unknown-zero', { amount: 0, amount_pending: true })]).length, 1);
	});
	for (const changes of [{ is_point_split: true }, { is_advance_split: true }, { amortization_meta: {} }, { auto_settlement_meta: { card_id: 'card' } }, { related_tx_id: 'linked-other' }, { advance_source_id: 'source' }]) {
		it(`does not consume a special financial record ${Object.keys(changes)[0]}`, () => {
			assert.equal(generate([rule()], [manual('special', changes)]).length, 1);
		});
	}
	it('allows an ordinary legacy shared group to satisfy a rule', () => {
		assert.deepEqual(generate([rule()], [manual('ordinary', { group_id: 'legacy-import-group' })]), []);
	});
	for (const peerMonth of ['2026-10', '2026-09']) it(`does not consume a normal-looking member of a real financial group with a ${peerMonth} peer`, () => {
		const rows = [manual('ordinary-child', { group_id: 'financial-group' }), manual('point-role', { group_id: 'financial-group', amount: 1, is_point_split: true, target_month: peerMonth })];
		const result = generate([rule()], rows);
		assert.equal(result.length, 1); assert.equal(result[0].recurring_rule_id, 'rule-a');
	});
	it('matches a transfer only when both accounts match', () => {
		const transferRule = rule('transfer', { type: 'transfer', to_account_id: 'acc_bank_a', category_id: null, subcategory_id: null });
		const entered = manual('transfer-entry', { type: 'transfer', to_account_id: 'acc_bank_a', category_id: null, subcategory_id: null });
		assert.deepEqual(generate([transferRule], [entered]), []);
		assert.equal(generate([transferRule], [{ ...entered, to_account_id: 'acc_bank_b' }]).length, 1);
	});
	it('returns exact generated and skipped counts for active eligible rules only', () => {
		assert.equal(typeof factory.planRecurringTransactions, 'function', 'generation plans must expose counts');
		const plan = factory.planRecurringTransactions([rule('linked'), rule('manual'), rule('new'), rule('inactive', { is_active: false })], month, [], [manual('linked-row', { recurring_rule_id: 'linked' }), manual('manual-row')]);
		assert.equal(plan.generated.length, 1); assert.equal(plan.generated[0].recurring_rule_id, 'new');
		assert.equal(plan.skipped_count, 2);
	});
});
