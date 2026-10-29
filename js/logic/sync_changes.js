/** Business identities changed by a committed synchronization stage. */
import { canonicalJsonStringify } from '../crypto.js';

const same = (a, b) => canonicalJsonStringify(a ?? null) === canonicalJsonStringify(b ?? null);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = id => typeof id === 'string' && id.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(id);
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const mapRows = rows => new Map((Array.isArray(rows) ? rows : []).filter(row => object(row) && safeId(row.id)).map(row => [row.id, row]));
const history = value => Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([day, entry]) => date(day) && object(entry)));
const budgets = value => Object.fromEntries(Object.entries(object(value) ? value : {}).filter(([year, entry]) => /^\d{4}$/.test(year) && object(entry)));
export function businessChanges(before, after) {
	const changes = {};
	const add = (field, id) => { (changes[field] ||= []).push(String(id)); };
	for (const field of ['accounts', 'categories', 'recurring_rules']) {
		const previous = mapRows(before?.master_config?.[field]), current = mapRows(after?.master_config?.[field]);
		for (const id of new Set([...previous.keys(), ...current.keys()])) {
			const old = previous.get(id), value = current.get(id);
			if (field === 'accounts') {
				const omitHistory = account => account ? Object.fromEntries(Object.entries(account).filter(([key]) => key !== 'investment_history')) : null;
				if (!same(omitHistory(old), omitHistory(value))) add(field, id);
				const oldHistory = history(old?.investment_history), currentHistory = history(value?.investment_history);
				for (const day of new Set([...Object.keys(oldHistory), ...Object.keys(currentHistory)])) if (!same(oldHistory[day], currentHistory[day])) add('investment_history', `${id}/${day}`);
			} else if (!same(old, value)) add(field, id);
		}
	}
	const previous = before?.master_config || {}, current = after?.master_config || {};
	const oldHolidays = new Set((Array.isArray(previous.holidays) ? previous.holidays : []).filter(date)), holidays = new Set((Array.isArray(current.holidays) ? current.holidays : []).filter(date));
	for (const day of new Set([...oldHolidays, ...holidays])) if (oldHolidays.has(day) !== holidays.has(day)) add('holidays', day);
	const oldBudgets = budgets(previous.annual_budgets), currentBudgets = budgets(current.annual_budgets);
	for (const year of new Set([...Object.keys(oldBudgets), ...Object.keys(currentBudgets)])) if (!same(oldBudgets[year], currentBudgets[year])) add('annual_budgets', year);
	if (!same(previous.point_payment_defaults, current.point_payment_defaults)) add('point_payment_defaults', 'current');
	const financialSnapshot = snapshot => object(snapshot) ? Object.fromEntries(Object.entries(snapshot).filter(([key]) => !['calculated_at', 'updated_at'].includes(key))) : null;
	if (!same(financialSnapshot(before?.summary_snapshot), financialSnapshot(after?.summary_snapshot))) add('summary_snapshot', 'current');
	return changes;
}

export function countBusinessChanges(changes) {
	return Object.fromEntries(Object.entries(changes).filter(([, ids]) => ids.length).map(([field, ids]) => [field, new Set(ids).size]));
}

export function unionBusinessChanges(target, changes) {
	for (const [field, ids] of Object.entries(changes || {})) target[field] = [...new Set([...(target[field] || []), ...ids])];
	return target;
}
