import { canonicalJsonStringify, getSubtle } from '../crypto.js';

export const FURUSATO_TAX_RATES = [0, 5, 10, 20, 23, 33, 40, 45];
export const FURUSATO_FIELDS = {
	salary: { label: '給与・賞与（税引前）', type: 'income' },
	other_income: { label: 'その他所得（必要経費控除後）', type: 'income' },
	social_insurance: { label: '社会保険料', type: 'expense' },
	other_deductions: { label: 'その他の住民税所得控除', type: 'expense' },
	personal_gap: { label: '扶養等の公定人的控除差（基礎以外）', type: 'expense' },
	other_gap: { label: 'その他の所得税控除差（負数可）', type: 'expense' },
	salary_deduction: { label: '給与所得控除等', type: 'expense', auto: true },
	resident_basic: { label: '住民税基礎控除', type: 'expense', auto: true },
	income_basic: { label: '所得税基礎控除', type: 'expense', auto: true },
	adjustment_credit: { label: '調整控除', type: 'expense', auto: true },
	life_general_new: { label: '一般生命保険料（新契約）', type: 'expense', life: true },
	life_general_old: { label: '一般生命保険料（旧契約）', type: 'expense', life: true },
	life_care: { label: '介護医療保険料', type: 'expense', life: true },
	life_pension_new: { label: '個人年金保険料（新契約）', type: 'expense', life: true },
	life_pension_old: { label: '個人年金保険料（旧契約）', type: 'expense', life: true },
	donation: { label: 'ふるさと納税寄附額', type: 'expense' },
	income_tax: { label: '支払所得税（参考）', type: 'expense', reference: true },
	resident_tax: { label: '支払住民税（参考）', type: 'expense', reference: true }
};
export function estimateFurusatoLimit(input, year) {
	if (input == null || Number(year) < 2015 || Number(year) > 2037) return null;
	if (!Number.isSafeInteger(input.resident_tax) || input.resident_tax < 0 || !FURUSATO_TAX_RATES.includes(input.income_tax_rate)) throw new Error('住民税所得割額と特例控除用税率を確認してください。');
	const result = input.resident_tax === 0 ? 0 : Math.floor(input.resident_tax * .2 / (.9 - input.income_tax_rate * .01021) + 2000);
	return Number.isSafeInteger(result) ? result : null;
}
export function getFurusatoSetting(config, year) {
	const annual = config.annual_budgets?.[year] || {};
	return { mode: annual.furusato_estimate ? 'notice' : 'income', base_year: Number(year) - 1, tax_status: 'unknown', input_modes: {}, manual: {}, life_enabled: false, young_dependent: false, housing: { enabled: false }, ...structuredClone(annual.furusato_calculation || {}) };
}
export function getFurusatoInputMode(field, setting, sources) {
	return setting.input_modes?.[field] || (sources[field]?.length ? 'ledger' : FURUSATO_FIELDS[field].auto ? 'auto' : field === 'donation' ? 'legacy' : 'manual');
}
export function selectFurusatoRows(transactions, field, sources, year) {
	return transactions.filter(tx => !tx.is_deleted && tx.type === FURUSATO_FIELDS[field].type && tx.date.startsWith(`${year}-`) && (sources[field] || []).some(s => s.category_id === tx.category_id && (s.subcategory_id === null || s.subcategory_id === tx.subcategory_id)));
}
export function getFurusatoDonationData(transactions, config, year) {
	const setting = getFurusatoSetting(config, year), sources = config.annual_budgets?.[year]?.furusato_sources || {}, mode = getFurusatoInputMode('donation', setting, sources);
	const records = (mode === 'manual' ? [] : mode === 'ledger' ? selectFurusatoRows(transactions, 'donation', sources, year) : transactions.filter(tx => {
		if (tx.is_deleted || tx.type !== 'expense' || !tx.date.startsWith(`${year}-`)) return false;
		const category = (config.categories || []).find(c => c.id === tx.category_id);
		return tx.tags?.includes('ふるさと納税') || category?.name === 'ふるさと納税' || category?.subcategories?.some(sub => sub.id === tx.subcategory_id && sub.name === 'ふるさと納税');
	})).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
	const total = status => {
		const value = mode === 'manual' ? (status === 'confirmed' ? setting.manual.donation ?? null : 0) : records.filter(tx => tx.status === status && !tx.amount_pending).reduce((sum, tx) => sum + tx.amount, 0);
		return Number.isSafeInteger(value) && value >= 0 ? value : null;
	};
	return { records, confirmed: total('confirmed'), planned: total('planned'), pending: mode === 'manual' && total('confirmed') === null ? 1 : records.filter(tx => tx.amount_pending).length };
}
export async function getFurusatoLedgerFingerprint(transactions, config, year) {
	const setting = getFurusatoSetting(config, year), sources = config.annual_budgets?.[year]?.furusato_sources || {};
	const fields = Object.keys(FURUSATO_FIELDS).filter(field => field !== 'donation' && !FURUSATO_FIELDS[field].reference && (!FURUSATO_FIELDS[field].life || setting.life_enabled) && getFurusatoInputMode(field, setting, sources) === 'ledger').sort();
	const selected = Object.fromEntries(fields.map(field => [field, [...(sources[field] || [])].map(s => ({ category_id: s.category_id, subcategory_id: s.subcategory_id })).sort((a, b) => canonicalJsonStringify(a).localeCompare(canonicalJsonStringify(b)))]));
	const rows = transactions.filter(tx => !tx.is_deleted && tx.date.startsWith(`${setting.base_year}-`) && fields.some(field => tx.type === FURUSATO_FIELDS[field].type && (selected[field] || []).some(s => s.category_id === tx.category_id && (s.subcategory_id === null || s.subcategory_id === tx.subcategory_id)))).map(tx => Object.fromEntries(['id', 'date', 'type', 'category_id', 'subcategory_id', 'amount', 'status', 'amount_pending', 'is_deleted'].map(key => [key, tx[key] ?? null]))).sort((a, b) => a.id.localeCompare(b.id));
	const digest = await getSubtle().digest('SHA-256', new TextEncoder().encode(canonicalJsonStringify({ base_year: setting.base_year, sources: selected, rows })));
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function calculateSalaryIncome(gross, year) {
	if (![2025, 2026, 2027].includes(Number(year)) || !Number.isSafeInteger(gross) || gross < 0) return null;
	if (year == 2025 && gross < 1900000) return gross < 651000 ? 0 : gross - 650000;
	if (year != 2025) {
		if (gross < 2191000) return gross < 741000 ? 0 : gross - 740000;
		if (gross < 2193000) return 1451000;
		if (gross < 2196000) return 1453000;
		if (gross < 2200000) return 1456000;
	}
	const band = Math.floor(gross / 4000) * 4000;
	return Math.floor(gross < 3600000 ? band / 10 * 7 - 80000 : gross < 6600000 ? band / 10 * 8 - 440000 : gross < 8500000 ? Number(BigInt(gross) * 9n / 10n) - 1100000 : gross - 1950000);
}
export function calculateBasicDeductions(total, year) {
	const resident = ![2025, 2026, 2027].includes(Number(year)) ? null : total <= 24000000 ? 430000 : total <= 24500000 ? 290000 : total <= 25000000 ? 150000 : 0;
	let income = null;
	if ([2025, 2026, 2027].includes(Number(year))) {
		if (total > 23500000) income = total <= 24000000 ? 480000 : total <= 24500000 ? 320000 : total <= 25000000 ? 160000 : 0;
		else if (year == 2025) income = total <= 1320000 ? 950000 : total <= 3360000 ? 880000 : total <= 4890000 ? 680000 : total <= 6550000 ? 630000 : 580000;
		else income = total <= 4890000 ? 1040000 : total <= 6550000 ? 670000 : 620000;
	}
	return { income, resident };
}
export function calculateLifeInsurance(premiums, year, young) {
	const piece = (amount = 0, limits) => Math.ceil(amount <= limits[0] ? amount : amount <= limits[1] ? amount / 2 + limits[0] / 2 : amount <= limits[2] ? amount / 4 + limits[0] / 2 + limits[1] / 4 : limits[3]);
	const calculate = (isIncome) => {
		const newLimits = isIncome ? [20000, 40000, 80000, 40000] : [12000, 32000, 56000, 28000];
		const oldLimits = isIncome ? [25000, 50000, 100000, 50000] : [15000, 40000, 70000, 35000];
		const generalLimits = isIncome && year >= 2026 && young ? [30000, 60000, 120000, 60000] : newLimits;
		const combine = (fresh, old, limits) => Math.max(piece(old, oldLimits), Math.min(limits[3], piece(fresh, limits) + piece(old, oldLimits)));
		return Math.min(isIncome ? 120000 : 70000, combine(premiums.life_general_new, premiums.life_general_old, generalLimits) + piece(premiums.life_care, newLimits) + combine(premiums.life_pension_new, premiums.life_pension_old, newLimits));
	};
	return { resident: calculate(false), income: calculate(true) };
}
export function calculateHousingCredit(housing) {
	if (!housing?.enabled || housing.applicable === false) return 0;
	if (![housing.balance, housing.price, housing.limit].every(v => Number.isSafeInteger(v) && v >= 0) || !Number.isFinite(housing.rate) || housing.rate < 0 || housing.rate > 2) return null;
	const [coefficient, exponent = '0'] = String(housing.rate).split('e'), [whole, fraction = ''] = coefficient.split('.');
	const decimals = fraction.length - Number(exponent), numerator = BigInt(whole + fraction) * 10n ** BigInt(Math.max(0, -decimals)), denominator = 10n ** BigInt(Math.max(0, decimals));
	return Number(BigInt(Math.min(housing.balance, housing.price, housing.limit)) * numerator / (denominator * 10000n) * 100n);
}

// 区分一次関数をmin/maxの交点で分割し、税率境界と控除競合を保持する。
const constant = (value, end) => [{ lo: 0, hi: end, m: 0, b: value }];
const scale = (segments, factor) => segments.map(s => ({ ...s, m: s.m * factor, b: s.b * factor }));
const at = (segments, x) => segments.find(s => s.lo <= x && s.hi >= x) || segments.at(-1);
const valueAt = (segments, x) => { const s = at(segments, x); return s.m * x + s.b; };
function combine(a, b, operation) {
	const points = [...new Set([...a, ...b].flatMap(s => [s.lo, s.hi]))].sort((x, y) => x - y), result = [];
	for (let i = 1; i < points.length; i++) {
		const lo = points[i - 1], hi = points[i], left = at(a, (lo + hi) / 2), right = at(b, (lo + hi) / 2);
		const cuts = [lo, hi], crossing = (right.b - left.b) / (left.m - right.m);
		if (operation !== 'add' && crossing > lo && crossing < hi) cuts.splice(1, 0, crossing);
		for (let j = 1; j < cuts.length; j++) {
			const from = cuts[j - 1], to = cuts[j], x = (from + to) / 2;
			const s = operation === 'add' ? { m: left.m + right.m, b: left.b + right.b } : ((left.m * x + left.b <= right.m * x + right.b) === (operation === 'min') ? left : right);
			result.push({ lo: from, hi: to, m: s.m, b: s.b });
		}
	}
	return result;
}
const add = (a, b) => combine(a, b, 'add');
const subtract = (a, b) => add(a, scale(b, -1));
const min = (a, b) => combine(a, b, 'min');
const max = (a, b) => combine(a, b, 'max');
function progressive(taxable, end) {
	const bounds = [0, 1950000, 3300000, 6950000, 9000000, 18000000, 40000000], rates = [.05, .1, .2, .23, .33, .4, .45];
	return bounds.reduce((sum, bound, i) => add(sum, scale(max(constant(0, end), min(subtract(taxable, constant(bound, end)), constant(i === bounds.length - 1 ? Number.MAX_SAFE_INTEGER : bounds[i + 1] - bound, end))), rates[i])), constant(0, end));
}
/** 端数処理を省いた連続税額で、2千円負担を維持する連続区間を求める。 */
export function calculateCombinedFurusato({ incomeTaxable, incomeBasic, totalIncome, residentTax, rate, baseLimit, housing, donation = 0 }) {
	const end = Math.max(1, baseLimit - 2000, donation - 2000), c = value => constant(value, end), x = [{ lo: 0, hi: end, m: 1, b: 0 }];
	const potential = calculateHousingCredit(housing), returnMode = housing?.method === 'return';
	const burden = donationX => {
		const deductible = returnMode ? max(c(0), subtract(min(add(donationX, c(2000)), c(totalIncome * .4)), c(2000))) : c(0);
		const taxable = max(c(0), subtract(c(incomeTaxable), deductible)), incomeBody = progressive(taxable, end);
		const income = scale(max(c(0), subtract(incomeBody, c(potential))), 1.021);
		const carry = potential ? min(min(max(c(0), subtract(c(potential), incomeBody)), scale(add(taxable, c(Math.max(incomeBasic - 480000, 0))), housing.carry_rate / 100)), c(Math.min(housing.carry_limit, residentTax))) : c(0);
		const basic = scale(max(c(0), subtract(min(add(donationX, c(2000)), c(totalIncome * .3)), c(2000))), .1);
		const special = min(scale(donationX, .9 - rate * .01021), c(residentTax * .2));
		const extra = returnMode ? c(0) : scale(special, rate * .01021 / (.9 - rate * .01021));
		const resident = max(c(0), subtract(subtract(subtract(subtract(c(residentTax), carry), basic), special), extra));
		return { total: add(income, resident), carry };
	};
	const baseline = valueAt(burden(c(0)).total, 0), after = burden(x), loss = subtract(x, subtract(c(baseline), after.total));
	let prefix = Math.max(0, baseLimit - 2000);
	for (const s of loss) {
		if (s.lo >= prefix) break;
		const hi = Math.min(s.hi, prefix);
		if (s.m * s.lo + s.b > .000001) { prefix = s.lo; break; }
		if (s.m * hi + s.b > .000001) { prefix = Math.max(s.lo, -s.b / s.m); break; }
	}
	const limit = residentTax === 0 ? 0 : Math.min(baseLimit, Math.floor(prefix + 2000 + .0000001));
	const actualX = Math.max(0, donation - 2000), benefit = baseline - valueAt(after.total, actualX);
	return { limit, potential, carry: valueAt(after.carry, actualX), selfCost: donation - benefit };
}
export function calculateFurusatoFromLedger(transactions, config, year, { ledgerFingerprint = null } = {}) {
	const setting = getFurusatoSetting(config, year), sources = config.annual_budgets?.[year]?.furusato_sources || {}, missing = [], values = {};
	const read = (field, automatic = null, optional = false) => {
		const mode = getFurusatoInputMode(field, setting, sources), rows = selectFurusatoRows(transactions, field, sources, setting.base_year).filter(tx => !tx.amount_pending && tx.status === 'confirmed');
		let amount = mode === 'auto' ? automatic : mode === 'ledger' ? (rows.length ? rows.reduce((sum, tx) => sum + tx.amount, 0) : null) : setting.manual?.[field] ?? (optional ? 0 : null);
		values[field] = { amount, count: mode === 'ledger' ? rows.length : 0, source: mode };
		if (mode === 'ledger' && (!ledgerFingerprint || setting.ledger_confirmation !== ledgerFingerprint)) { missing.push(`${FURUSATO_FIELDS[field].label}の年額確認`); amount = null; }
		if (amount === null || !Number.isSafeInteger(amount) || (field !== 'other_gap' && amount < 0)) { missing.push(FURUSATO_FIELDS[field].label); return 0; }
		return amount;
	};
	if (setting.mode === 'notice') return { limit: estimateFurusatoLimit(config.annual_budgets?.[year]?.furusato_estimate, year), missing, values };
	const salary = read('salary'), social = read('social_insurance'), other = read('other_income'), deductions = read('other_deductions'), personal = read('personal_gap'), gap = read('other_gap');
	const salaryIncome = calculateSalaryIncome(salary, year), salaryDeduction = read('salary_deduction', salaryIncome === null ? null : salary - salaryIncome);
	const totalIncome = Math.max(0, salary - salaryDeduction) + other, basics = calculateBasicDeductions(totalIncome, year);
	const residentBasic = read('resident_basic', basics.resident), incomeBasic = read('income_basic', basics.income);
	const premiums = Object.fromEntries(Object.entries(FURUSATO_FIELDS).filter(([, def]) => def.life).map(([field]) => [field, setting.life_enabled ? read(field, null, true) : 0]));
	const life = calculateLifeInsurance(premiums, year, setting.young_dependent);
	const taxable = amount => Math.floor(Math.max(0, amount) / 1000) * 1000;
	const residentTaxable = taxable(totalIncome - social - residentBasic - deductions - life.resident), incomeTaxable = taxable(totalIncome - social - incomeBasic - deductions - personal - gap - life.income);
	const statutory = 50000 + personal;
	const adjustment = totalIncome > 25000000 ? 0 : Math.floor(.05 * (residentTaxable <= 2000000 ? Math.min(statutory, residentTaxable) : Math.max(statutory - (residentTaxable - 2000000), 50000)));
	const adjustmentCredit = read('adjustment_credit', adjustment);
	const residentTax = setting.tax_status === 'exempt' ? 0 : Math.max(0, residentTaxable * .1 - adjustmentCredit);
	const rateBase = residentTaxable - statutory - Math.max(incomeBasic - 480000, 0);
	const rate = rateBase < 0 ? 0 : rateBase <= 1950000 ? 5 : rateBase <= 3300000 ? 10 : rateBase <= 6950000 ? 20 : rateBase <= 9000000 ? 23 : rateBase <= 18000000 ? 33 : rateBase <= 40000000 ? 40 : 45;
	if (setting.tax_status === 'unknown') missing.push('所得割の課税・非課税区分');
	const housing = setting.housing || { enabled: false }, potential = calculateHousingCredit(housing);
	if (potential === null || (housing.enabled && housing.applicable !== false && (!['one_stop', 'return'].includes(housing.method) || ![5, 7].includes(housing.carry_rate) || housing.carry_limit !== (housing.carry_rate === 5 ? 97500 : 136500) || (housing.first_year && housing.method !== 'return')))) missing.push('住宅ローン控除の適用条件');
	if (![totalIncome, residentTaxable, incomeTaxable, residentTax, salary + other + social + deductions + Math.abs(gap) + personal].every(Number.isSafeInteger)) missing.push('安全な円整数の範囲');
	const baseLimit = Number.isSafeInteger(residentTax) ? estimateFurusatoLimit({ resident_tax: residentTax, income_tax_rate: rate }, year) : null;
	if (baseLimit === null) missing.push('対応する寄附年の税制');
	if (setting.tax_status === 'exempt') return { limit: 0, baseLimit: 0, missing: [], values, totalIncome, residentTaxable, incomeTaxable, residentTax: 0, incomeBasic, rate, adjustmentCredit, life, housing: { potential } };
	const result = { limit: null, baseLimit, progressMissing: getFurusatoDonationData(transactions, config, year).confirmed === null ? ['寄附額（未入力または円整数の範囲外）'] : [], missing: [...new Set(missing)], values, totalIncome, residentTaxable, incomeTaxable, residentTax, incomeBasic, rate, adjustmentCredit, life, housing: { potential } };
	if (!result.missing.length) {
		const donation = getFurusatoDonationData(transactions, config, year).confirmed;
		const combined = calculateCombinedFurusato({ incomeTaxable, incomeBasic, totalIncome, residentTax, rate, baseLimit, housing, donation: donation ?? 0 });
		if (donation === null) combined.selfCost = null;
		result.limit = combined.limit; result.housing = combined;
	}
	return result;
}
