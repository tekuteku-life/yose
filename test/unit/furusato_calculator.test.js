import { it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateSalaryIncome, calculateBasicDeductions, calculateLifeInsurance, calculateHousingCredit, calculateFurusatoFromLedger, calculateCombinedFurusato } from '../../js/logic/furusato_calculator.js';
import { buildFurusatoSummary } from '../../js/logic/data_insights.js';
import { transaction } from '../helpers/ui_fixture.js';

export const calculation = (extra = {}) => ({ mode: 'income', base_year: 2025, ledger_confirmation: 'a'.repeat(64), tax_status: 'taxable', input_modes: {}, manual: { salary: 6000000, social_insurance: 800000, other_income: 0, other_deductions: 0, personal_gap: 0, other_gap: 0 }, life_enabled: false, young_dependent: false, housing: { enabled: false }, ...extra });
const config = setting => ({ annual_budgets: { 2026: { furusato_calculation: setting } } });
it('uses year-specific salary tables, four-thousand-yen bands and low-income exceptions', () => {
	assert.equal(calculateSalaryIncome(6000000, 2025), 4360000);
	assert.equal(calculateSalaryIncome(6003999, 2025), 4360000);
	assert.equal(calculateSalaryIncome(1900000, 2025), 1250000);
	assert.equal(calculateSalaryIncome(1900000, 2026), 1160000);
	assert.equal(calculateSalaryIncome(2192000, 2026), 1451000);
	assert.equal(calculateSalaryIncome(2194000, 2026), 1453000);
	assert.equal(calculateSalaryIncome(2198000, 2026), 1456000);
	assert.equal(calculateSalaryIncome(0, 2027), 0);
	assert.equal(calculateSalaryIncome(8500000, 2027), 6550000);
	assert.equal(calculateSalaryIncome(6000000, 2028), null);
});
it('uses different income and resident basic deductions for the income year', () => {
	assert.deepEqual(calculateBasicDeductions(4360000, 2025), { income: 680000, resident: 430000 });
	assert.deepEqual(calculateBasicDeductions(4360000, 2026), { income: 1040000, resident: 430000 });
	assert.deepEqual(calculateBasicDeductions(5000000, 2027), { income: 670000, resident: 430000 });
	assert.deepEqual(calculateBasicDeductions(24200000, 2025), { income: 320000, resident: 290000 });
	assert.deepEqual(calculateBasicDeductions(25100000, 2025), { income: 0, resident: 0 });
});
it('derives both life-insurance deductions and keeps the young-dependent increase out of resident tax', () => {
	const premiums = { life_general_new: 120000, life_general_old: 0, life_care: 0, life_pension_new: 0, life_pension_old: 0 };
	assert.deepEqual(calculateLifeInsurance(premiums, 2025, true), { resident: 28000, income: 40000 });
	assert.deepEqual(calculateLifeInsurance(premiums, 2026, true), { resident: 28000, income: 60000 });
	assert.deepEqual(calculateLifeInsurance({ ...premiums, life_general_old: 120000, life_care: 120000, life_pension_new: 120000, life_pension_old: 120000 }, 2025, false), { resident: 70000, income: 120000 });
});
it('rounds insurance fractions up and chooses the better old-only or mixed deduction', () => {
	assert.deepEqual(calculateLifeInsurance({ life_general_new: 12001 }, 2025, false), { resident: 12001, income: 12001 });
	assert.deepEqual(calculateLifeInsurance({ life_general_old: 70001, life_general_new: 1000 }, 2025, false), { resident: 35000, income: 42501 });
});
it('caps housing credit by the personal balance, acquisition price and eligible loan limit, rounds down to hundreds', () => {
	const loan = { enabled: true, applicable: true, balance: 30000000, price: 29000123, limit: 35000000, rate: 0.7 };
	assert.equal(calculateHousingCredit(loan), 203000);
	assert.equal(calculateHousingCredit({ ...loan, limit: 20000000 }), 140000);
	assert.equal(calculateHousingCredit({ ...loan, applicable: false }), 0);
	assert.equal(calculateHousingCredit({ ...loan, price: undefined }), null);
});
it('uses manually entered missing amounts as actual calculation inputs, not reference-only display', () => {
	const result = calculateFurusatoFromLedger([], config(calculation()), 2026);
	assert.deepEqual(result.missing, []);
	assert.equal(result.residentTaxable, 3130000); assert.equal(result.incomeTaxable, 2520000);
	assert.equal(result.residentTax, 310500); assert.equal(result.rate, 10);
	assert.equal(result.limit, Math.floor(310500 * 0.2 / 0.7979 + 2000));
	const lower = calculation(); lower.manual.social_insurance = 1200000;
	assert.ok(calculateFurusatoFromLedger([], config(lower), 2026).limit < result.limit);
});
it('uses arbitrary ledger names, deduplicates parent/child selection and ignores the manual override in ledger mode', () => {
	const c = config(calculation({ input_modes: { salary: 'ledger' } }));
	c.annual_budgets[2026].furusato_sources = { salary: [{ category_id: 'arbitrary', subcategory_id: null }, { category_id: 'arbitrary', subcategory_id: 'detail' }] };
	const rows = [transaction('gross', { type: 'income', category_id: 'arbitrary', subcategory_id: 'detail', date: '2025-12-31', target_month: '2026-01', amount: 7000000 }), transaction('planned', { type: 'income', category_id: 'arbitrary', date: '2025-01-01', status: 'planned' }), transaction('deleted', { is_deleted: true }), transaction('unknown', { type: 'income', category_id: 'arbitrary', date: '2025-01-01', amount_pending: true })];
	const result = calculateFurusatoFromLedger(rows, c, 2026, { ledgerFingerprint: 'a'.repeat(64) });
	assert.equal(result.values.salary.amount, 7000000); assert.equal(result.values.salary.count, 1);
	assert.equal(result.values.salary.source, 'ledger'); assert.ok(result.limit > 0);
});
it('distinguishes missing amounts, explicit zero and an assigned source with no acquired rows', () => {
	const setting = calculation(); delete setting.manual.social_insurance;
	assert.equal(calculateFurusatoFromLedger([], config(setting), 2026).limit, null);
	setting.manual.social_insurance = 0; assert.ok(calculateFurusatoFromLedger([], config(setting), 2026).limit > 0);
	setting.input_modes.social_insurance = 'ledger'; assert.equal(calculateFurusatoFromLedger([], config(setting), 2026).limit, null);
});
it('subtracts derived resident life deduction but never treats housing credit as an income deduction', () => {
	const baseline = calculation(); const before = calculateFurusatoFromLedger([], config(baseline), 2026);
	const life = calculation({ life_enabled: true }); life.manual.life_general_new = 100000;
	const insured = calculateFurusatoFromLedger([], config(life), 2026);
	assert.equal(insured.life.resident, 28000); assert.equal(insured.residentTaxable, before.residentTaxable - 28000);
	const housing = calculation({ housing: { enabled: true, applicable: true, balance: 30000000, price: 30000000, limit: 30000000, rate: 0.7, method: 'one_stop', first_year: false, carry_rate: 5, carry_limit: 97500 } });
	const mortgaged = calculateFurusatoFromLedger([], config(housing), 2026);
	assert.equal(mortgaged.housing.potential, 210000); assert.equal(mortgaged.residentTaxable, before.residentTaxable);
	assert.ok(mortgaged.limit <= before.limit);
});
it('requires tax return in the first mortgage deduction year and does not publish an unverified combined limit', () => {
	const h = { enabled: true, applicable: true, balance: 30000000, price: 30000000, limit: 30000000, rate: 0.7, method: 'one_stop', first_year: true, carry_rate: 5, carry_limit: 97500 };
	assert.equal(calculateFurusatoFromLedger([], config(calculation({ housing: h })), 2026).limit, null);
});
it('uses configured arbitrary donation categories or a manual donation total instead of names', () => {
	const setting = calculation({ input_modes: { donation: 'ledger' } }); const c = config(setting);
	c.annual_budgets[2026].furusato_sources = { donation: [{ category_id: 'arbitrary', subcategory_id: 'gift' }] };
	const rows = [transaction('gift', { category_id: 'arbitrary', subcategory_id: 'gift', amount: 10000 }), transaction('unrelated', { tags: ['ふるさと納税'], amount: 5000 })];
	const result = buildFurusatoSummary(rows, c, 2026);
	assert.deepEqual(result.records.map(row => row.id), ['gift']); assert.equal(result.confirmed, 10000);
	setting.input_modes.donation = 'manual'; setting.manual.donation = 23000;
	assert.equal(buildFurusatoSummary(rows, c, 2026).confirmed, 23000);
});

it('refuses a partial acquired year and an unknown income-levy tax status', () => {
	const setting = calculation({ ledger_confirmation: undefined, input_modes: { salary: 'ledger' } }); const c = config(setting);
	c.annual_budgets[2026].furusato_sources = { salary: [{ category_id: 'salary', subcategory_id: null }] };
	const rows = [transaction('one-month', { type: 'income', category_id: 'salary', date: '2025-01-25', amount: 500000 })];
	assert.equal(calculateFurusatoFromLedger(rows, c, 2026).limit, null);
	setting.input_modes.salary = 'manual'; setting.tax_status = 'unknown';
	assert.equal(calculateFurusatoFromLedger(rows, c, 2026).limit, null);
	setting.tax_status = 'exempt'; assert.equal(calculateFurusatoFromLedger(rows, c, 2026).limit, 0);
});
it('uses statutory personal differences in the high-income taper rather than the actual basic deduction gap', () => {
	const setting = calculation(); setting.manual.salary = 26150000;
	const result = calculateFurusatoFromLedger([], config(setting), 2026);
	assert.equal(result.rate, 40); assert.equal(result.missing.length, 0);
});
it('keeps zero levy exempt and refuses automatic tables beyond the supported years', () => {
	const setting = calculation({ tax_status: 'exempt' }); assert.equal(calculateFurusatoFromLedger([], config(setting), 2026).limit, 0);
	const c = { annual_budgets: { 2028: { furusato_calculation: calculation() } } };
	assert.equal(calculateFurusatoFromLedger([], c, 2028).limit, null);
});
it('compares return and one-stop mortgage interactions without reducing the special-cap levy basis', () => {
	const housing = { enabled: true, applicable: true, balance: 40000000, price: 40000000, limit: 40000000, rate: 1, method: 'return', first_year: true, carry_rate: 7, carry_limit: 136500 };
	const baseline = calculateFurusatoFromLedger([], config(calculation()), 2026);
	const result = calculateFurusatoFromLedger([], config(calculation({ housing })), 2026);
	assert.equal(result.residentTax, baseline.residentTax); assert.equal(result.housing.potential, 400000);
	assert.ok(result.limit >= 2000 && result.limit <= baseline.limit);
	assert.equal(result.housing.selfCost, 0);
});

it('matches independent mortgage, filing and carry-over calculations at the exact two-thousand-yen boundary', () => {
	const common = { incomeTaxable: 2520000, incomeBasic: 1040000, totalIncome: 4360000, residentTax: 310500, rate: 10, baseLimit: 79829 };
	for (const [potential, method, carryRate, carryLimit, limit, carry, cost] of [[210000, 'return', 5, 97500, 2000, 63300, 2300], [400000, 'return', 7, 136500, 2000, 136500, 10100], [400000, 'one_stop', 7, 136500, 79829, 136500, 2153.628274219827]]) {
		const housing = { enabled: true, applicable: true, balance: potential * 100, price: potential * 100, limit: potential * 100, rate: 1, method, carry_rate: carryRate, carry_limit: carryLimit };
		const result = calculateCombinedFurusato({ ...common, housing, donation: 80000 });
		assert.equal(result.limit, limit); assert.equal(result.carry, carry); assert.ok(Math.abs(result.selfCost - cost) < .000001);
		const boundary = calculateCombinedFurusato({ ...common, housing, donation: limit }); assert.ok(boundary.selfCost <= 2000.000001);
		const over = calculateCombinedFurusato({ ...common, housing, donation: limit + 1 }); assert.ok(over.selfCost > 2000);
	}
});
it('splits income-tax brackets and applies gross donation caps before subtracting two thousand', () => {
	const crossing = { incomeTaxable: 1955000, incomeBasic: 1040000, totalIncome: 3796800, residentTax: 254000, rate: 10, baseLimit: 65667, housing: { enabled: false, method: 'return' } };
	assert.equal(calculateCombinedFurusato({ ...crossing, donation: 20000 }).limit, 7000);
	assert.ok(Math.abs(calculateCombinedFurusato({ ...crossing, donation: 20000 }).selfCost - 2663.65) < .000001);
	assert.ok(Math.abs(calculateCombinedFurusato({ ...crossing, donation: 7001 }).selfCost - 2000.05105) < .000001);
	const capped = calculateCombinedFurusato({ incomeTaxable: 960000, incomeBasic: 1040000, totalIncome: 2000000, residentTax: 154500, rate: 5, baseLimit: 38398, housing: { enabled: false, method: 'return' }, donation: 1000000 });
	assert.ok(Math.abs(capped.selfCost - 868562.1) < .000001);
});
it('keeps an unentered manual donation unknown rather than treating it as zero', () => {
	const setting = calculation({ input_modes: { donation: 'manual' } }), c = config(setting);
	const summary = buildFurusatoSummary([], c, 2026);
	assert.equal(summary.confirmed, null); assert.equal(summary.remaining, null); assert.equal(summary.pending, 1);
	assert.equal(calculateFurusatoFromLedger([], c, 2026).housing.selfCost, null);
	setting.manual.donation = 0;
	assert.equal(buildFurusatoSummary([], c, 2026).confirmed, 0); assert.equal(calculateFurusatoFromLedger([], c, 2026).housing.selfCost, 0);
});
it('requires a resident basic override for years outside the automatic table scope', () => {
	assert.deepEqual(calculateBasicDeductions(4000000, 2019), { income: null, resident: null });
	const setting = calculation({ manual: { ...calculation().manual, salary_deduction: 1640000, income_basic: 380000 }, input_modes: { salary_deduction: 'manual', income_basic: 'manual' } });
	const c = { annual_budgets: { 2019: { furusato_calculation: setting } } };
	assert.equal(calculateFurusatoFromLedger([], c, 2019).limit, null);
	setting.input_modes.resident_basic = 'manual'; setting.manual.resident_basic = 330000;
	assert.ok(calculateFurusatoFromLedger([], c, 2019).limit > 0);
});
it('keeps salary table bands integral at a thousand-yen taxable boundary', () => {
	assert.equal(calculateSalaryIncome(2624000, 2026), 1756800);
	const setting = calculation(); setting.manual.salary = 2624000; setting.manual.social_insurance = 26800;
	assert.equal(calculateFurusatoFromLedger([], config(setting), 2026).residentTaxable, 1300000);
});
it('computes the exact housing percentage at a hundred-yen boundary', () => {
	assert.equal(calculateHousingCredit({ enabled: true, applicable: true, balance: 700000, price: 700000, limit: 700000, rate: .7 }), 4900);
});
it('keeps overflowing donation aggregates uncalculated', () => {
	const rows = [transaction('a', { tags: ['ふるさと納税'], amount: Number.MAX_SAFE_INTEGER }), transaction('b', { tags: ['ふるさと納税'], amount: 1 })];
	const summary = buildFurusatoSummary(rows, config(calculation()), 2026);
	assert.equal(summary.confirmed, null); assert.equal(summary.remaining, null);
	assert.equal(calculateFurusatoFromLedger(rows, config(calculation()), 2026).housing.selfCost, null);
});
it('applies the no-income salary bands immediately below the first thousand-yen income', () => {
	assert.equal(calculateSalaryIncome(650999, 2025), 0); assert.equal(calculateSalaryIncome(651000, 2025), 1000);
	assert.equal(calculateSalaryIncome(740999, 2026), 0); assert.equal(calculateSalaryIncome(741000, 2026), 1000);
});
it('covers the published basic-deduction taper and all special-tax-rate brackets with manual basic overrides', () => {
	for (const [income, expected] of [[1320000, 950000], [1320001, 880000], [3360001, 680000], [4890001, 630000], [6550001, 580000], [23500001, 480000], [24000001, 320000], [24500001, 160000], [25000001, 0]]) assert.equal(calculateBasicDeductions(income, 2025).income, expected);
	assert.equal(calculateBasicDeductions(7000000, 2026).income, 620000);
	for (const [amount, rate] of [[0, 0], [2000000, 5], [3350000, 10], [7000000, 20], [9050000, 23], [18050000, 33], [40050000, 40], [40051000, 45]]) {
		const setting = calculation(); Object.assign(setting.manual, { salary: 0, social_insurance: 0, other_income: amount, salary_deduction: 0, resident_basic: 0, income_basic: 480000 });
		Object.assign(setting.input_modes, { salary_deduction: 'manual', resident_basic: 'manual', income_basic: 'manual' });
		assert.equal(calculateFurusatoFromLedger([], config(setting), 2026).rate, rate);
	}
});
it('refuses unsafe intermediate sums even when each recorded annual amount is a safe integer', () => {
	const setting = calculation(); setting.manual.salary = Number.MAX_SAFE_INTEGER; setting.manual.other_income = Number.MAX_SAFE_INTEGER;
	const result = calculateFurusatoFromLedger([], config(setting), 2026);
	assert.equal(result.limit, null); assert.ok(result.missing.some(value => value.includes('安全な円整数')));
});
