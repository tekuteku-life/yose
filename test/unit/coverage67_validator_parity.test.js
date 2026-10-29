import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dataIntegrity } from '../../js/logic/data_integrity.js';
import { DEFAULT_MASTER_CONFIG } from '../../js/db/defaults.js';
import { productionSource, coverageGlobals } from '../../scripts/coverage_tools.js';
import { transaction } from '../helpers/ui_fixture.js';

// This is a unit contract for the shared programmatic validator. It is not
// evidence that a cyclic or already rejected object can arrive through GAS JSON.
// The original complete GAS file is executed; no function body/state is replaced.
const gasPath = fileURLToPath(new URL('../../gas/Code.gs', import.meta.url));
const generated = vm.runInNewContext(`${productionSource(gasPath)}\ncreateDataIntegrityValidator();`, { ...coverageGlobals() });
const normalize = value => JSON.parse(JSON.stringify(value));
const state = () => ({ master_config: structuredClone(DEFAULT_MASTER_CONFIG), transactions: [transaction('existing')], summary_snapshot: { account_balances: {}, monthly_summaries: {} } });
const diagnosticCases = [
	['nonobject master', 'shape', 'master_config', s => { s.master_config = []; }],
	['nonarray accounts', 'shape', 'accounts', s => { s.master_config.accounts = {}; }],
	['nonobject account', 'shape', 'accounts', s => { s.master_config.accounts.push(null); }],
	['nonarray transactions', 'shape', 'transactions', s => { s.transactions = {}; }],
	['nonobject transaction', 'shape', 'transactions', s => { s.transactions = [null]; }],
	['unsafe transaction ID', 'id', 'transactions.id', s => { s.transactions[0].id = '__proto__'; }],
	['duplicate transaction ID', 'duplicate', 'transactions.existing', s => { s.transactions.push(structuredClone(s.transactions[0])); }],
	['nonobject snapshot', 'shape', 'summary_snapshot', s => { s.summary_snapshot = false; }],
	['nonarray external assets', 'shape', 'external_assets', s => { s.summary_snapshot.external_assets = {}; }],
	['nonobject external asset', 'shape', 'external_assets', s => { s.summary_snapshot.external_assets = [null]; }],
	['tombstone missing timestamp', 'timestamp', 'transactions.existing.updated_at', s => { s.transactions[0] = { id: 'existing', is_deleted: true }; }],
	['tombstone wrong timestamp type', 'timestamp', 'transactions.existing.updated_at', s => { s.transactions[0] = { id: 'existing', is_deleted: true, updated_at: 1 }; }],
	['tombstone invalid timestamp', 'timestamp', 'transactions.existing.updated_at', s => { s.transactions[0] = { id: 'existing', is_deleted: true, updated_at: 'invalid' }; }],
	['invalid tag list', 'shape', 'transactions.existing.tags', s => { s.transactions[0].tags = {}; }],
	['invalid tax metadata', 'shape', 'transactions.existing.tax_meta', s => { s.transactions[0].tax_meta = false; }],
	['invalid prepayment metadata', 'shape', 'transactions.existing.amortization_meta', s => { s.transactions[0].amortization_meta = 1; }],
	['invalid settlement metadata', 'shape', 'transactions.existing.auto_settlement_meta', s => { s.transactions[0].auto_settlement_meta = 'invalid'; }],
	['nonobject annual budgets', 'shape', 'annual_budgets', s => { s.master_config.annual_budgets = []; }],
	['nonobject annual entry', 'shape', 'annual_budgets.2026', s => { s.master_config.annual_budgets = { '2026': null }; }],
	['nonarray holidays', 'shape', 'holidays', s => { s.master_config.holidays = {}; }],
	['invalid category child list', 'shape', 'categories.cat_food.subcategories', s => { s.master_config.categories.find(row => row.id === 'cat_food').subcategories = {}; }],
	['unknown transaction source month', 'month', 'transactions.existing.previous_target_month', s => { s.transactions[0].previous_target_month = '2026-13'; }],
	['nonarray approvals', 'shape', 'transactions.existing.reclose_approved_months', s => { s.transactions[0].reclose_approved_months = null; }]
];
diagnosticCases.push(
	['planned unknown amount not zero', 'pending', 'transactions.existing.amount_pending', s => { s.transactions[0].status = 'planned'; s.transactions[0].amount_pending = true; }],
	['advance repayment wrong role', 'advance_link', 'transactions.existing.advance_source_id', s => { s.transactions[0].advance_source_id = 'missing'; }],
	['duplicate advance repayment', 'advance_link', 'transactions.second.advance_source_id', s => { s.transactions = ['first', 'second'].map(id => transaction(id, { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null, advance_source_id: 'missing-source' })); }],
	['duplicate recurring key', 'duplicate_recurring', 'transactions.recurring.["same-rule","2026-10"]', s => { s.transactions = ['first', 'second'].map(id => transaction(id, { recurring_rule_id: 'same-rule' })); }],
	['unknown goal basis', 'enum', 'annual_budgets.2026.goal_basis', s => { s.master_config.annual_budgets = { '2026': { goal_basis: 'unknown' } }; }],
	['tax missing source parent', 'reference', 'annual_budgets.2026.furusato_sources.salary.subcategory_id', s => { s.master_config.annual_budgets = { '2026': { furusato_sources: { salary: [{ category_id: 'missing', subcategory_id: 'missing-child' }] } } }; }],
	['tax expense source using income role', 'category_type', 'annual_budgets.2026.furusato_sources.social_insurance', s => { s.master_config.annual_budgets = { '2026': { furusato_sources: { social_insurance: [{ category_id: 'cat_income_main', subcategory_id: null }] } } }; }],
	['tax overlap wildcard child', 'shape', 'annual_budgets.2026.furusato_sources', s => { s.master_config.annual_budgets = { '2026': { furusato_sources: { salary: [{ category_id: 'cat_income_main', subcategory_id: 'sub_salary' }], other_income: [{ category_id: 'cat_income_main', subcategory_id: null }] } } }; }],
	['tax overlap exact child', 'shape', 'annual_budgets.2026.furusato_sources', s => { s.master_config.annual_budgets = { '2026': { furusato_sources: { salary: [{ category_id: 'cat_income_main', subcategory_id: 'sub_salary' }], other_income: [{ category_id: 'cat_income_main', subcategory_id: 'sub_salary' }] } } }; }],
	['income child under missing parent', 'reference', 'summary_snapshot.monthly_summaries.2026-09.by_income_category.missing.by_subcategory.missing-child', s => { s.summary_snapshot.monthly_summaries = { '2026-09': { income_total: 1, by_income_category: { missing: { total: 1, by_subcategory: { 'missing-child': 1 } } }, by_actual_income_category: { cat_unclassified: { total: 1, by_subcategory: { sub_unclassified: 1 } } } } }; }]
);

describe('review67 shared JS/generated GAS programmatic validator parity', () => {
	it('keeps normal states and absent optional inputs valid, returning the exact requested object', () => {
		for (const value of [undefined, {}, state(), { transactions: [{ id: 'deleted', is_deleted: true, updated_at: '2026-10-01T00:00:00Z' }] }]) {
			assert.deepEqual(dataIntegrity.issues(value), []); assert.deepEqual(normalize(generated.issues(value)), []);
			assert.equal(dataIntegrity.assertChange({}, value), value); assert.equal(generated.assertChange({}, value), value);
		}
	});
	for (const [label, code, path, change] of diagnosticCases) it(`keeps the ${label} diagnostic identical without mutating programmatic input`, () => {
		const control = state(); assert.deepEqual(dataIntegrity.issues(control), []); assert.deepEqual(normalize(generated.issues(control)), []);
		const value = state(); change(value); const before = structuredClone(value), expected = dataIntegrity.issues(value), actual = normalize(generated.issues(value));
		assert.ok(expected.some(issue => issue.code === code && issue.path === path), JSON.stringify(expected)); assert.deepEqual(actual, expected); assert.deepEqual(value, before);
		assert.throws(() => generated.assertChange({}, value, { strict: true }), error => String(error.message).includes(path)); assert.deepEqual(value, before);
	});
	it('rejects a programmatic cycle with the same path while preserving the cycle identity', () => {
		const value = {}; value.cycle = value; const input = { master_config: value }, js = dataIntegrity.issues(input), gas = normalize(generated.issues(input)); assert.ok(js.some(issue => issue.code === 'shape' && issue.path === 'data.master_config.cycle')); assert.deepEqual(gas, js); assert.equal(value.cycle, value);
	});
	it('allows an unchanged legacy reference problem and its repair, rejecting worsening and strict replay', () => {
		const before = state(); before.transactions[0].account_id = 'missing-old'; const after = structuredClone(before); after.transactions[0].memo = 'unrelated edit';
		for (const api of [dataIntegrity, generated]) {
			assert.equal(api.assertChange(before, after), after); assert.throws(() => api.assertChange(before, after, { strict: true }), /transactions.existing.account_id/);
			const worsened = structuredClone(after); worsened.transactions[0].account_id = 'different-missing'; assert.throws(() => api.assertChange(before, worsened), /transactions.existing.account_id/); const repaired = state(); assert.equal(api.assertChange(before, repaired), repaired);
		}
		assert.equal(before.transactions[0].account_id, 'missing-old'); assert.equal(after.transactions[0].memo, 'unrelated edit');
	});
	for (const [field, archived, sub] of [
		['account_id', 'account', false], ['to_account_id', 'account', false], ['category_id', 'category', false], ['actual_category_id', 'category', false], ['subcategory_id', 'category', true], ['actual_subcategory_id', 'category', true]
	]) it(`rejects a new archived ${field} while preserving an unchanged historical reference`, () => {
		const before = state(); before.master_config.recurring_rules = [];
		if (archived === 'account') before.master_config.accounts.find(row => row.id === 'acc_bank_main').is_archived = true;
		else { const category = before.master_config.categories.find(row => row.id === 'cat_food'); if (sub) category.subcategories[0].is_archived = true; else category.is_archived = true; }
		if (field === 'to_account_id') Object.assign(before.transactions[0], { type: 'transfer', category_id: null, actual_category_id: null, to_account_id: 'acc_wallet', account_id: 'acc_bank_main' });
		const after = structuredClone(before), target = archived === 'account' ? 'acc_bank_main' : sub ? before.master_config.categories.find(row => row.id === 'cat_food').subcategories[0].id : 'cat_food';
		if (field === 'to_account_id') after.transactions[0].account_id = 'acc_wallet';
		else if (field === 'account_id') before.transactions[0].account_id = 'acc_wallet';
		else if (field.endsWith('category_id') && !field.endsWith('subcategory_id')) before.transactions[0][field] = 'cat_housing';
		else if (sub) { before.transactions[0][field] = null; if (field.startsWith('actual_')) { before.transactions[0].actual_category_id = 'cat_food'; after.transactions[0].actual_category_id = 'cat_food'; } }
		after.transactions[0][field] = target;
		for (const api of [dataIntegrity, generated]) {
			assert.throws(() => api.assertChange(before, after), error => String(error.message).includes(`transactions.existing.${field}`)); assert.equal(api.assertChange(before, after, { allowArchivedReferences: true }), after); const retained = structuredClone(after); retained.transactions[0].memo = 'historical reference kept'; assert.equal(api.assertChange(after, retained), retained);
		}
	});
	for (const archived of ['parent', 'child']) it(`compares archived point-default ${archived} references as the same complete pair`, () => {
		const before = state(), defaults = before.master_config.point_payment_defaults, parent = before.master_config.categories.find(row => row.id === defaults.category_id); before.master_config.recurring_rules = [];
		if (archived === 'parent') parent.is_archived = true; else parent.subcategories.find(row => row.id === defaults.subcategory_id).is_archived = true;
		const selected = structuredClone(before); before.master_config.point_payment_defaults = null;
		for (const api of [dataIntegrity, generated]) { assert.throws(() => api.assertChange(before, selected), /point_payment_defaults.*アーカイブ/); const retained = structuredClone(selected); retained.master_config.point_payment_defaults = { subcategory_id: defaults.subcategory_id, category_id: defaults.category_id }; retained.master_config.theme = 'dark'; assert.equal(api.assertChange(selected, retained), retained); }
	});
});
