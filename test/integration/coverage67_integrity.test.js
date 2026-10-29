import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dataIntegrity } from '../../js/logic/data_integrity.js';
import { createSignedRequest, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';

const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const clone = value => structuredClone(value);
const tax = () => ({ mode: 'income', base_year: 2026, tax_status: 'taxable', life_enabled: false, young_dependent: false, manual: {}, input_modes: {}, housing: { enabled: false } });
function validState() {
	return {
		master_config: { schema_version: 2, accounts: [{ id: 'wallet', name: '財布', type: 'cash', initial_balance: 0 }, { id: 'bank', name: '銀行', type: 'bank', initial_balance: 0 }, { id: 'card', name: 'カード', type: 'credit_card', initial_balance: 0 }, { id: 'invest', name: '投資', type: 'investment', initial_balance: 0, investment_history: { '2026-10-01': { invested_amount: -10, market_value: 20 } } }], categories: [{ id: 'food', type: 'expense', name: '食費', subcategories: [{ id: 'meal', name: '食事' }] }, { id: 'salary', type: 'income', name: '給与', subcategories: [{ id: 'pay', name: '本業' }] }], recurring_rules: [], holidays: [], annual_budgets: { '2026': { furusato_calculation: tax() } } },
		transactions: [{ id: 'settlement', type: 'transfer', status: 'confirmed', date: '2026-10-01', target_month: '2026-10', amount: 100, account_id: 'bank', to_account_id: 'card', category_id: null, actual_category_id: null, auto_settlement_meta: { card_id: 'card', debit_account_id: 'bank', billing_cycle: '2026-09' }, updated_at: '2026-10-01T00:00:00Z' }],
		summary_snapshot: { schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} }
	};
}
const cases = [
	['unknown account type', 'master', 'enum', 'accounts.wallet.type', s => { s.master_config.accounts[0].type = 'unknown'; }],
	['nonstr name', 'master', 'string', 'accounts.wallet.name', s => { s.master_config.accounts[0].name = 1; }],
	['investment history shape', 'master', 'shape', 'accounts.invest.investment_history', s => { s.master_config.accounts[3].investment_history = []; }],
	['investment on wrong role', 'master', 'shape', 'accounts.wallet.investment_history', s => { s.master_config.accounts[0].investment_history = {}; }],
	['investment invalid date', 'master', 'date', 'accounts.invest.investment_history.2026-02-30', s => { s.master_config.accounts[3].investment_history = { '2026-02-30': { invested_amount: 0, market_value: 0 } }; }],
	['investment value shape', 'master', 'shape', 'accounts.invest.investment_history.2026-10-01', s => { s.master_config.accounts[3].investment_history['2026-10-01'] = null; }],
	['card own debit', 'master', 'account_role', 'accounts.card.debit_account_id', s => { s.master_config.accounts[2].debit_account_id = 'card'; }],
	['card debit role', 'master', 'account_role', 'accounts.card.debit_account_id', s => { s.master_config.accounts[2].debit_account_id = 'invest'; }],
	['card unequal debit refs', 'master', 'account_role', 'accounts.card.debit_account_id', s => { s.master_config.accounts[2].debit_account_id = 'wallet'; s.master_config.accounts[2].settlement_account_id = 'bank'; }],
	['insurance income category', 'master', 'category_type', 'accounts.wallet.premium_category_id', s => { s.master_config.accounts[0].premium_category_id = 'salary'; }],
	['unknown category type', 'master', 'enum', 'categories.food.type', s => { s.master_config.categories[0].type = 'unknown'; }],
	['pending confirmed amount', 'tx', 'pending', 'transactions.settlement.amount_pending', s => { s.transactions[0].amount_pending = true; }],
	['invalid timestamp', 'tx', 'timestamp', 'transactions.settlement.updated_at', s => { s.transactions[0].updated_at = 'invalid'; }],
	['invalid meta shape', 'tx', 'shape', 'transactions.settlement.tax_meta', s => { s.transactions[0].tax_meta = []; }],
	['invalid tags', 'tx', 'shape', 'transactions.settlement.tags', s => { s.transactions[0].tags = [1]; }],
	['amortization role flag', 'tx', 'amortization', 'transactions.settlement.amortization_meta.is_payment_record', s => { s.transactions[0].amortization_meta = { is_payment_record: 'true' }; s.transactions[0].group_id = 'group'; }],
	['amortization absent group', 'tx', 'amortization', 'transactions.settlement.group_id', s => { s.transactions[0].amortization_meta = { is_payment_record: true }; }],
	['amortization wrong role', 'tx', 'amortization', 'transactions.settlement.amortization_meta.is_payment_record', s => { s.transactions[0].amortization_meta = { is_payment_record: false }; s.transactions[0].group_id = 'group'; }],
	['card role', 'tx', 'account_role', 'transactions.settlement.auto_settlement_meta.card_id', s => { s.transactions[0].to_account_id = 'wallet'; s.transactions[0].auto_settlement_meta.card_id = 'wallet'; }],
	['missing card', 'tx', 'reference', 'transactions.settlement.auto_settlement_meta.card_id', s => { s.transactions[0].auto_settlement_meta.card_id = 'missing'; }],
	['settlement target', 'tx', 'settlement', 'transactions.settlement.auto_settlement_meta.card_id', s => { s.transactions[0].to_account_id = 'wallet'; }],
	['settlement source', 'tx', 'settlement', 'transactions.settlement.auto_settlement_meta.debit_account_id', s => { s.transactions[0].auto_settlement_meta.debit_account_id = 'wallet'; }],
	['settlement missing source', 'tx', 'reference', 'transactions.settlement.auto_settlement_meta.debit_account_id', s => { s.transactions[0].auto_settlement_meta.debit_account_id = 'missing'; }],
	['billing month', 'tx', 'month', 'transactions.settlement.auto_settlement_meta.billing_cycle', s => { s.transactions[0].auto_settlement_meta.billing_cycle = '2026-13'; }],
	['previous month', 'tx', 'month', 'transactions.settlement.previous_target_month', s => { s.transactions[0].previous_target_month = '2026-13'; }],
	['duplicate settlement', 'tx', 'duplicate_settlement', 'transactions.settlement.["card","2026-09"]', s => { s.transactions.push({ ...clone(s.transactions[0]), id: 'second' }); }],
	['tax unknown key', 'master', 'shape', 'annual_budgets.2026.furusato_calculation.unknown', s => { s.master_config.annual_budgets['2026'].furusato_calculation.unknown = 1; }],
	['tax status', 'master', 'enum', 'annual_budgets.2026.furusato_calculation.tax_status', s => { s.master_config.annual_budgets['2026'].furusato_calculation.tax_status = 'wrong'; }],
	['tax mode', 'master', 'enum', 'annual_budgets.2026.furusato_calculation.mode', s => { s.master_config.annual_budgets['2026'].furusato_calculation.mode = 'wrong'; }],
	['tax flag', 'master', 'boolean', 'annual_budgets.2026.furusato_calculation.young_dependent', s => { s.master_config.annual_budgets['2026'].furusato_calculation.young_dependent = 1; }],
	['tax manual shape', 'master', 'shape', 'annual_budgets.2026.furusato_calculation.manual', s => { s.master_config.annual_budgets['2026'].furusato_calculation.manual = []; }],
	['tax manual unknown field', 'master', 'shape', 'annual_budgets.2026.furusato_calculation.manual.unknown', s => { s.master_config.annual_budgets['2026'].furusato_calculation.manual = { unknown: 1 }; }],
	['tax input shape', 'master', 'shape', 'annual_budgets.2026.furusato_calculation.input_modes', s => { s.master_config.annual_budgets['2026'].furusato_calculation.input_modes = false; }],
	['tax input mode', 'master', 'enum', 'annual_budgets.2026.furusato_calculation.input_modes.salary', s => { s.master_config.annual_budgets['2026'].furusato_calculation.input_modes = { salary: 'auto' }; }],
	['tax donation mode', 'master', 'enum', 'annual_budgets.2026.furusato_calculation.input_modes.donation', s => { s.master_config.annual_budgets['2026'].furusato_calculation.input_modes = { donation: 'auto' }; }],
	['housing shape', 'master', 'shape', 'annual_budgets.2026.furusato_calculation.housing', s => { s.master_config.annual_budgets['2026'].furusato_calculation.housing = null; }],
	['housing unknown key', 'master', 'shape', 'annual_budgets.2026.furusato_calculation.housing.unknown', s => { s.master_config.annual_budgets['2026'].furusato_calculation.housing.unknown = 0; }],
	['housing enabled flag', 'master', 'boolean', 'annual_budgets.2026.furusato_calculation.housing.enabled', s => { s.master_config.annual_budgets['2026'].furusato_calculation.housing.enabled = 'true'; }],
	['housing carry pair', 'master', 'enum', 'annual_budgets.2026.furusato_calculation.housing.carry_rate', s => { s.master_config.annual_budgets['2026'].furusato_calculation.housing.carry_rate = 5; }],
	['tax config shape', 'master', 'shape', 'annual_budgets.2026.furusato_calculation', s => { s.master_config.annual_budgets['2026'].furusato_calculation = []; }],
	['tax source unknown key', 'master', 'shape', 'annual_budgets.2026.furusato_sources.unknown', s => { s.master_config.annual_budgets['2026'].furusato_sources = { unknown: [] }; }],
	['category budget shape', 'master', 'shape', 'annual_budgets.2026.category_budgets', s => { s.master_config.annual_budgets['2026'].category_budgets = []; }],
	['investment duplicate basis', 'master', 'shape', 'accounts.invest.investment_history.2026-10-01', s => { s.master_config.accounts[3].investment_history['2026-10-01'].acquisition_cost = 10; }],
	['investment negative valuation', 'master', 'number', 'accounts.invest.investment_history.2026-10-01.market_value', s => { s.master_config.accounts[3].investment_history['2026-10-01'].market_value = -1; }],
	['insurance maturity date', 'master', 'date', 'accounts.invest.maturity_date', s => { s.master_config.accounts[3].maturity_date = '2026-02-30'; }],
	['closed month', 'snapshot', 'month', 'summary_snapshot.last_closed_month', s => { s.summary_snapshot.last_closed_month = '2026-13'; }],
	['balances shape', 'snapshot', 'shape', 'summary_snapshot.account_balances', s => { s.summary_snapshot.account_balances = []; }],
	['monthly shape', 'snapshot', 'shape', 'summary_snapshot.monthly_summaries', s => { s.summary_snapshot.monthly_summaries = []; }],
	['monthly key', 'snapshot', 'shape', 'summary_snapshot.monthly_summaries.2026-13', s => { s.summary_snapshot.monthly_summaries = { '2026-13': {} }; }],
	['category summary shape', 'snapshot', 'shape', 'summary_snapshot.monthly_summaries.2026-09.by_category.food', s => { s.summary_snapshot.monthly_summaries = { '2026-09': { by_category: { food: null } } }; }],
	['category map shape', 'snapshot', 'shape', 'summary_snapshot.monthly_summaries.2026-09.by_category', s => { s.summary_snapshot.monthly_summaries = { '2026-09': { by_category: [] } }; }],
	['external assets shape', 'snapshot', 'shape', 'external_assets', s => { s.summary_snapshot.external_assets = [null]; }]
];

const recurringRule = () => ({ id: 'rule', type: 'expense', account_id: 'wallet', category_id: 'food', subcategory_id: 'meal', amount: 10, is_active: true, start_date: '2026-10-01', end_date: '2027-01-01' });
for (const [field, value, code] of [['frequency', 'unknown', 'enum'], ['holiday_adjustment', 'unknown', 'enum'], ['start_date', '2026-02-30', 'date'], ['end_date', '2026-09-01', 'date']]) cases.push([`rule ${field}`, 'master', code, `recurring_rules.rule.${field}`, s => { s.master_config.recurring_rules = [{ ...recurringRule(), [field]: value }]; }]);
cases.push(
	['archived recurring account', 'master', 'archived', 'recurring_rules.rule.account_id', s => { s.master_config.recurring_rules = [recurringRule()]; s.master_config.accounts[0].is_archived = true; }],
	['archived recurring child', 'master', 'archived', 'recurring_rules.rule.category_id', s => { s.master_config.recurring_rules = [recurringRule()]; s.master_config.categories[0].subcategories[0].is_archived = true; }],
	['invalid holiday', 'master', 'date', 'holidays', s => { s.master_config.holidays = ['2026-02-30']; }],
	['tax estimate shape', 'master', 'shape', 'annual_budgets.2026.furusato_estimate', s => { s.master_config.annual_budgets['2026'].furusato_estimate = null; }],
	['tax source shape', 'master', 'shape', 'annual_budgets.2026.furusato_sources', s => { s.master_config.annual_budgets['2026'].furusato_sources = null; }],
	['tax source row shape', 'master', 'shape', 'annual_budgets.2026.furusato_sources.salary', s => { s.master_config.annual_budgets['2026'].furusato_sources = { salary: [null] }; }],
	['tax source type', 'master', 'category_type', 'annual_budgets.2026.furusato_sources.salary', s => { s.master_config.annual_budgets['2026'].furusato_sources = { salary: [{ category_id: 'food', subcategory_id: 'meal' }] }; }],
	['tax source overlap', 'master', 'shape', 'annual_budgets.2026.furusato_sources', s => { s.master_config.annual_budgets['2026'].furusato_sources = { salary: [{ category_id: 'salary', subcategory_id: null }], other_income: [{ category_id: 'salary', subcategory_id: 'pay' }] }; }],
	['tax confirmation digest', 'master', 'shape', 'annual_budgets.2026.furusato_calculation.ledger_confirmation', s => { s.master_config.annual_budgets['2026'].furusato_calculation.ledger_confirmation = 'invalid'; }]
);
const incomeSummary = () => ({ income_total: 30, by_income_category: { salary: { total: 30, by_subcategory: { pay: 30 } } }, by_actual_income_category: { salary: { total: 30, by_subcategory: { pay: 30 } } } });
for (const field of ['by_income_category', 'by_actual_income_category']) {
	for (const [label, code, suffix, change] of [
		['map shape', 'shape', '', s => { s[field] = []; }],
		['value shape', 'shape', '.salary', s => { s[field].salary = null; }],
		['missing children', 'shape', '.salary', s => { delete s[field].salary.by_subcategory; }],
		['wrong category role', 'category_type', '.food', s => { s[field] = { food: { total: 30, by_subcategory: { meal: 30 } } }; }],
		['child mismatch', 'sum', '.salary', s => { s[field].salary.by_subcategory.pay = 29; }],
		['total mismatch', 'sum', '', s => { s[field].salary.total = 29; s[field].salary.by_subcategory.pay = 29; }],
		['subtotal overflow', 'number', '.salary', s => { s[field].salary.by_subcategory = { pay: Number.MAX_SAFE_INTEGER, sub_unclassified: 1 }; }],
		['total overflow', 'number', '', s => { s[field] = { salary: { total: Number.MAX_SAFE_INTEGER, by_subcategory: { pay: Number.MAX_SAFE_INTEGER } }, cat_unclassified: { total: 1, by_subcategory: { sub_unclassified: 1 } } }; }]
	]) cases.push([`${field} ${label}`, 'snapshot', code, `summary_snapshot.monthly_summaries.2026-09.${field}${suffix}`, state => { const s = incomeSummary(); change(s); state.summary_snapshot.monthly_summaries = { '2026-09': s }; }]);
}

describe('review67 JS and signed GAS integrity use the intended diagnostic path', () => {
	let env, keys;
	const raw = () => env.spreadsheet.getSheets().map(sheet => [sheet.name, [...sheet.rows]]);
	async function post(action, payload) { const request = await createSignedRequest(action, payload, keys.privateKey); return gas.doPost({ postData: { contents: JSON.stringify(request) } }); }
	beforeEach(async () => {
		env = new MockGasEnvironment(); env.setupGlobals(); keys = await generateEd25519KeyPair(); PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		const state = validState(); gas.saveJsonFile('master_config.json', state.master_config); gas.saveJsonFile('summary_snapshot.json', state.summary_snapshot); gas.saveJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] });
	});
	afterEach(() => env.teardownGlobals());
	for (const [name, kind, code, path, change] of cases) it(`rejects ${name} at ${path} with all stored sheet bytes intact`, async () => {
		const valid = validState(); assert.deepEqual(dataIntegrity.issues(valid), [], 'the unmodified control must be valid');
		const invalid = clone(valid); change(invalid); const issues = dataIntegrity.issues(invalid);
		assert.ok(issues.some(issue => issue.code === code && issue.path === path), JSON.stringify(issues));
		const before = raw(), base = gas.handleAction('fetch_state', {}).state_version;
		const actions = kind === 'tx' ? ['push_diff', 'retroactive_update'] : kind === 'master' ? ['update_master', 'replace_import'] : ['replace_import'];
		for (const action of actions) {
			const payload = action === 'push_diff' ? { transactions: invalid.transactions } : action === 'retroactive_update' ? { transaction: invalid.transactions[0] } : action === 'update_master' ? { master_config: invalid.master_config, base_version: gas.canonicalJsonStringify(valid.master_config) } : { import_id: `invalid-${name.replaceAll(' ', '-')}`, base_version: base, data: { schema_version: 2, export_type: 'full_backup', ...invalid } };
			if (name === 'duplicate settlement' && action === 'retroactive_update') continue;
			const response = await post(action, payload); assert.equal(response.success, false, action); assert.ok(String(response.error).includes(path), `${action}: ${response.error}`); assert.deepEqual(raw(), before);
		}
		const control = await post('replace_import', { import_id: 'valid-control', base_version: base, data: { schema_version: 2, export_type: 'full_backup', ...valid } });
		assert.equal(control.success, true, control.error); const stored = gas.handleAction('fetch_state', {}); assert.equal(stored.pending_diffs[0].amount, 100); assert.equal(stored.pending_diffs[0].to_account_id, 'card'); assert.equal(stored.master_config.accounts[3].investment_history['2026-10-01'].invested_amount, -10);
	});
	it('accepts documented housing applicability and automatic/legacy input modes', async () => {
		const state = validState(), calc = state.master_config.annual_budgets['2026'].furusato_calculation;
		calc.input_modes = { salary_deduction: 'auto', donation: 'legacy', salary: 'ledger', other_income: 'manual' }; calc.manual = { other_gap: -1 }; calc.housing = { enabled: true, applicable: false, first_year: false, method: 'return', carry_rate: 7, carry_limit: 136500 };
		assert.deepEqual(dataIntegrity.issues(state), []); const response = await post('update_master', { master_config: state.master_config, base_version: gas.canonicalJsonStringify(validState().master_config) }); assert.equal(response.success, true, response.error); assert.deepEqual(response.master_config.annual_budgets['2026'].furusato_calculation, calc);
	});
	it('accepts complete income maps, numeric historical expenses, card month-end days, and legacy optional settlement debit refs', async () => {
		const state = validState(); state.summary_snapshot.monthly_summaries = { '2026-09': { ...incomeSummary(), by_category: { food: 0 }, by_actual_category: { food: 0 }, closing_balances: { bank: 0 } } }; state.master_config.accounts[2].closing_day = 99; state.master_config.accounts[2].debit_day = 99; delete state.transactions[0].auto_settlement_meta.debit_account_id;
		assert.deepEqual(dataIntegrity.issues(state), []); const response = await post('replace_import', { import_id: 'historical-control', base_version: gas.handleAction('fetch_state', {}).state_version, data: { schema_version: 2, export_type: 'full_backup', ...state } }); assert.equal(response.success, true, response.error); assert.equal(gas.handleAction('fetch_state', {}).snapshot.monthly_summaries['2026-09'].income_total, 30);
	});
	it('rejects programmatic cyclic input and nonobject master without mutating caller data', () => {
		const cyclic = {}; cyclic.loop = cyclic; assert.ok(dataIntegrity.issues({ master_config: cyclic }).some(issue => issue.code === 'shape' && issue.path.includes('loop'))); assert.equal(cyclic.loop, cyclic);
		assert.ok(dataIntegrity.issues({ master_config: [] }).some(issue => issue.path === 'master_config')); assert.deepEqual(dataIntegrity.issues(), []);
	});
});
