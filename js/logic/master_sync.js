/** Shared master projection and deterministic three-way reconciliation. */
import { canonicalJsonStringify } from '../crypto.js';

export const SHARED_MASTER_FIELDS = ['schema_version', 'accounts', 'categories', 'recurring_rules', 'holidays', 'annual_budgets'];
const same = (a, b) => canonicalJsonStringify(a) === canonicalJsonStringify(b);

function assertSafe(value) {
	if (!value || typeof value !== 'object') return;
	for (const key of Object.keys(value)) {
		if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('設定マスタに不正なキーが含まれています');
		assertSafe(value[key]);
	}
}

export function sharedMasterConfig(config) {
	assertSafe(config);
	const shared = {};
	for (const key of SHARED_MASTER_FIELDS) if (config?.[key] !== undefined) shared[key] = structuredClone(config[key]);
	return shared;
}

export function mergeMasterConfigs(base, local, remote) {
	assertSafe(base); assertSafe(local); assertSafe(remote);
	const conflicts = [];
	const merge = (before, here, there, path) => {
		if (same(here, there) || same(before, there)) return here;
		if (same(before, here)) return there;
		if ([before, here, there].every(value => Array.isArray(value))) {
			if ([...before, ...here, ...there].every(value => value && typeof value === 'object' && typeof value.id === 'string')) {
				const previous = new Map(before.map(item => [item.id, item]));
				const ours = new Map(here.map(item => [item.id, item]));
				const theirs = new Map(there.map(item => [item.id, item]));
				return [...new Set([...here, ...there, ...before].map(item => item.id))].map(id => merge(previous.get(id), ours.get(id), theirs.get(id), `${path}.${id}`)).filter(item => item !== undefined);
			}
			if ([...before, ...here, ...there].every(value => typeof value === 'string')) {
				return [...new Set([...here, ...there])].filter(value => before.includes(value) ? here.includes(value) && there.includes(value) : true);
			}
		}
		if ([here, there].every(value => value && !Array.isArray(value) && typeof value === 'object') && (before === undefined || (before && !Array.isArray(before) && typeof before === 'object'))) {
			const merged = {};
			for (const key of new Set([...Object.keys(before || {}), ...Object.keys(here), ...Object.keys(there)])) {
				const value = merge(before?.[key], here[key], there[key], path ? `${path}.${key}` : key);
				if (value !== undefined) merged[key] = value;
			}
			return merged;
		}
		conflicts.push(path);
		return here;
	};
	return { config: structuredClone(merge(base, local, remote, '')), conflicts };
}

export function assertMasterReferences(config) {
	assertSafe(config);
	const keyed = (items, label) => {
		if (!Array.isArray(items)) throw new Error(`${label}の設定形式が不正です`);
		const ids = new Set();
		for (const item of items) {
			if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error(`${label}のIDが不正または重複しています`);
			ids.add(item.id);
		}
		return ids;
	};
	const accounts = keyed(config.accounts || [], '口座');
	const categories = keyed(config.categories || [], '費目');
	keyed(config.recurring_rules || [], '定期設定');
	const subcategories = new Map((config.categories || []).map(category => [category.id, keyed(category.subcategories || [], '中項目')]));
	const requireRef = (value, ids, label) => { if (value && !ids.has(value)) throw new Error(`${label}の参照先が存在しません。設定を確認してください`); };
	for (const account of config.accounts || []) {
		requireRef(account.debit_account_id, accounts, '引落口座');
		requireRef(account.settlement_account_id, accounts, '精算口座');
	}
	for (const rule of config.recurring_rules || []) {
		for (const field of ['account_id', 'to_account_id']) requireRef(rule[field], accounts, '定期設定口座');
		for (const prefix of ['', 'actual_']) {
			requireRef(rule[`${prefix}category_id`], categories, '定期設定費目');
			requireRef(rule[`${prefix}subcategory_id`], subcategories.get(rule[`${prefix}category_id`]) || new Set(), '定期設定中項目');
		}
	}
}
