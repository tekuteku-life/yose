import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MASTER_CONFIG, DEFAULT_SUMMARY_SNAPSHOT } from '../../js/db.js';
const { dataIntegrity } = await import('../../js/logic/data_integrity.js').catch(() => ({}));
const tx = (id = 't', extra = {}) => ({ id, date: '2026-10-20', target_month: '2026-10', type: 'expense', status: 'confirmed', amount: 10, account_id: 'acc_wallet', category_id: 'cat_food', subcategory_id: null, actual_category_id: 'cat_food', actual_subcategory_id: null, tags: [], is_deleted: false, ...extra });
const state = () => ({ master_config: structuredClone(DEFAULT_MASTER_CONFIG), transactions: [tx()], summary_snapshot: structuredClone(DEFAULT_SUMMARY_SNAPSHOT) });
const api = () => { assert.ok(dataIntegrity, 'Shared data-integrity validator must be implemented'); return dataIntegrity; };

describe('Shared data-integrity contract', () => {
	it('validates debit-account roles and dual-reference agreement', () => {
		for (const change of [
			card => { card.debit_account_id = card.id; },
			card => { card.debit_account_id = 'acc_card_a'; },
			card => { card.debit_account_id = 'acc_bank_main'; card.settlement_account_id = 'acc_wallet'; }
		]) {
			const before = state(), after = state();
			const card = { id: 'card-new', type: 'credit_card', initial_balance: 0 };
			change(card); after.master_config.accounts.push(card);
			assert.throws(() => api().assertChange(before, after));
		}
	});
	it('accepts valid data and keeps holiday-adjusted dates independent from the accounting month', () => {
		const s = state(); s.transactions[0].date = '2026-11-02';
		assert.deepEqual(api().issues(s), []);
	});
	for (const [name, extra] of [
		['unsafe ID', { id: '__proto__' }], ['missing date', { date: undefined }], ['invalid day', { date: '2026-02-30' }], ['invalid month', { target_month: '2026-99' }],
		['unknown type', { type: 'other' }], ['unknown status', { status: 'other' }], ['negative amount', { amount: -1 }], ['fractional yen', { amount: 1.5 }],
		['invalid update time', { updated_at: 'invalid' }], ['invalid creation time', { created_at: 'invalid' }],
		['string prepaid role', { group_id: 'prepaid', amortization_meta: { is_payment_record: 'false' } }],
		['prepaid parent expense', { group_id: 'prepaid', amortization_meta: { is_payment_record: true } }],
		['prepaid child transfer', { group_id: 'prepaid', type: 'transfer', to_account_id: 'acc_prepaid', amortization_meta: { is_payment_record: false } }],
		['prepaid without group', { amortization_meta: { is_payment_record: false } }],
		['unknown settlement card', { auto_settlement_meta: { card_id: 'missing', billing_cycle: '2026-10' } }],
		['invalid settlement cycle', { type: 'transfer', to_account_id: 'acc_card_a', auto_settlement_meta: { card_id: 'acc_card_a', billing_cycle: '2026-99' } }],
		['settlement destination mismatch', { type: 'transfer', to_account_id: 'acc_bank_main', auto_settlement_meta: { card_id: 'acc_card_a', billing_cycle: '2026-10' } }],
		['settlement source mismatch', { type: 'transfer', to_account_id: 'acc_card_a', auto_settlement_meta: { card_id: 'acc_card_a', billing_cycle: '2026-10', debit_account_id: 'acc_bank_main' } }],
		['string amount', { amount: '10' }], ['pending confirmed', { amount_pending: true, amount: 0 }], ['pending nonzero', { amount_pending: true, status: 'planned' }], ['string deleted flag', { is_deleted: 'false' }], ['invalid tags', { tags: 'tag' }], ['scalar tax metadata', { tax_meta: 1 }], ['array installment metadata', { amortization_meta: [] }], ['scalar settlement metadata', { auto_settlement_meta: 'bad' }],
		['missing account', { account_id: 'missing' }], ['missing category', { category_id: 'missing' }], ['child under wrong parent', { subcategory_id: 'sub_salary' }],
		['wrong income category', { category_id: 'cat_income_main' }], ['wrong actual category type', { actual_category_id: 'cat_income_main' }], ['missing actual child', { actual_subcategory_id: 'missing' }],
		['transfer without destination', { type: 'transfer', category_id: null, actual_category_id: null }], ['self-transfer', { type: 'transfer', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null }]
	]) it(`rejects ${name} before acceptance`, () => {
		const before = state(), after = state(); after.transactions[0] = tx('t', extra);
		assert.throws(() => api().assertChange(before, after));
		assert.ok(api().issues(after).length > 0);
	});
	it('validates all master IDs, nested children, insurance references, active rules and budgets', () => {
		for (const mutate of [
			s => s.master_config.accounts.push({ ...s.master_config.accounts[0] }),
			s => { s.master_config.categories[0].subcategories = [{ id: 'constructor', name: 'bad' }]; },
			s => { s.master_config.accounts[0].premium_category_id = 'missing'; },
			s => { s.master_config.accounts[0].premium_pay_account_id = 'missing'; },
			s => { s.master_config.recurring_rules[0].account_id = 'missing'; },
			s => { s.master_config.annual_budgets = { '2026': { expense_budget: 10, category_budgets: { missing: 10 } } }; }
		]) { const before = state(), after = state(); mutate(after); assert.throws(() => api().assertChange(before, after)); }
	});
	it('validates master enum, boolean, numeric and calendar domains while accepting documented boundaries', () => {
		for (const mutate of [
			s => { s.master_config.accounts[0].type = 'other'; },
			s => { s.master_config.accounts[0].is_asset = 'false'; },
			s => { s.master_config.accounts[0].initial_balance = 1.5; },
			s => { s.master_config.accounts[0].maturity_amount = 'bad'; },
			s => { s.master_config.recurring_rules[0].type = 'other'; },
			s => { s.master_config.recurring_rules[0].frequency = 'other'; },
			s => { s.master_config.recurring_rules[0].day_of_month = 0; },
			s => { s.master_config.recurring_rules[0].day_of_month = 32; },
			s => { s.master_config.recurring_rules[0].interval_months = 0; },
			s => { s.master_config.recurring_rules[0].amount = 1.2; },
			s => { s.master_config.recurring_rules[0].start_date = '2026-02-30'; },
			s => { s.master_config.recurring_rules[0].start_date = '2027-12-01'; s.master_config.recurring_rules[0].end_date = '2026-12-01'; },
			s => { s.master_config.accounts[0].premium_category_id = 'cat_food'; s.master_config.accounts[0].premium_subcategory_id = 'sub_salary'; },
			s => { s.master_config.annual_budgets = { bad: { expense_budget: 10 } }; },
			s => { s.master_config.annual_budgets = { '2026': { expense_budget: -1 } }; },
			s => { s.master_config.annual_budgets = { '2026': { category_budgets: { cat_food: 1.5 } } }; }
		]) { const before = state(), after = state(); mutate(after); assert.throws(() => api().assertChange(before, after)); }
		const valid = state(); valid.master_config.recurring_rules[0].day_of_month = 31; valid.master_config.recurring_rules[0].interval_months = 1; valid.master_config.accounts[0].initial_balance = -10; valid.master_config.accounts[0].closing_day = 99; valid.master_config.accounts[0].debit_day = 99; valid.master_config.accounts[0].premium_amount = null; valid.master_config.accounts[0].premium_day = null;
		assert.deepEqual(api().issues(valid), []);
	});
	it('blocks changing existing accounting, actual child and transfer targets to archived masters', () => {
		for (const [collection, id, field] of [
			['categories', 'cat_housing', 'category_id'], ['subcategories', 'sub_dining_out', 'actual_subcategory_id'], ['accounts', 'acc_bank_main', 'to_account_id']
		]) {
			const before = state();
			before.master_config.recurring_rules = [];
			if (collection === 'subcategories') before.master_config.categories.find(c => c.id === 'cat_food').subcategories.find(sub => sub.id === id).is_archived = true;
			else before.master_config[collection].find(item => item.id === id).is_archived = true;
			if (field === 'to_account_id') Object.assign(before.transactions[0], { type: 'transfer', category_id: null, actual_category_id: null, to_account_id: 'acc_point' });
			const after = structuredClone(before); after.transactions[0][field] = id;
			assert.throws(() => api().assertChange(before, after));
		}
	});
	it('validates all nested snapshot maps and their references', () => {
		for (const summary of [
			{ closing_balances: { missing: 10 } }, { by_category: { missing: 10 } },
			{ by_actual_category: { cat_food: { total: 10, by_subcategory: { missing: 10 } } } },
			{ by_category: { cat_food: { total: 10, by_subcategory: { sub_salary: 10 } } } },
			{ closing_balances: { acc_wallet: '10' } }
		]) { const before = state(), after = state(); after.summary_snapshot.monthly_summaries['2026-09'] = summary; assert.throws(() => api().assertChange(before, after)); }
		const allowed = state(); allowed.summary_snapshot.monthly_summaries['2026-09'] = { by_category: { cat_unclassified: { total: 10, by_subcategory: { sub_unclassified: 10 } } } };
		assert.deepEqual(api().issues(allowed), []);
	});
	it('permits historical archive references but blocks new or changed targets and active archived rules', () => {
		const before = state(); before.master_config.accounts[0].is_archived = true;
		const same = structuredClone(before); same.transactions[0].memo = '履歴を保持';
		assert.doesNotThrow(() => api().assertChange(before, same));
		const added = structuredClone(before); added.transactions.push(tx('new'));
		assert.throws(() => api().assertChange(before, added));
		assert.doesNotThrow(() => api().assertChange(before, added, { allowArchivedReferences: true }));
		const archive = state(), archived = state(); archived.master_config.accounts[0].is_archived = true;
		assert.doesNotThrow(() => api().assertChange(archive, archived));
		archived.master_config.recurring_rules.push({ id: 'active-archived', is_active: true, type: 'expense', amount: 10, account_id: 'acc_wallet', category_id: 'cat_food', day_of_month: 1 });
		assert.throws(() => api().assertChange(archive, archived));
	});
	it('allows repairing historical issues without allowing a different bad value or more duplicates', () => {
		const before = state(); before.transactions[0].account_id = 'missing-A';
		const unchanged = structuredClone(before); unchanged.transactions[0].memo = 'preserve';
		assert.doesNotThrow(() => api().assertChange(before, unchanged));
		assert.throws(() => api().assertChange(before, unchanged, { strict: true }));
		const worse = structuredClone(before); worse.transactions[0].account_id = 'missing-B';
		assert.throws(() => api().assertChange(before, worse));
		assert.doesNotThrow(() => api().assertChange(before, state()));
		const dup = state(); dup.transactions.push(tx());
		const more = structuredClone(dup); more.transactions.push(tx());
		assert.throws(() => api().assertChange(dup, more));
	});
	it('permits unrelated edits and repairs when a historical collection has the wrong shape', () => {
		const before = state(); before.master_config.accounts = {};
		const after = structuredClone(before); after.master_config.theme = 'dark';
		assert.doesNotThrow(() => api().assertChange(before, after));
		assert.doesNotThrow(() => api().assertChange(before, state()));
	});
	it('rejects duplicate natural recurring keys and unsafe dictionary keys without executing them', () => {
		const before = state(), after = state();
		after.transactions = [tx('a', { recurring_rule_id: 'rec_rent' }), tx('b', { recurring_rule_id: 'rec_rent' })];
		assert.throws(() => api().assertChange(before, after));
		const unsafe = state(); unsafe.master_config.annual_budgets = JSON.parse('{"__proto__":{}}');
		assert.throws(() => api().assertChange(before, unsafe));
		assert.equal({}.polluted, undefined);
	});
});
