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

const FIELD_LABELS = {
	schema_version: 'データ形式', accounts: '口座', categories: '費目', subcategories: '中項目', recurring_rules: '定期設定', holidays: '祝日', annual_budgets: '年度予算', category_budgets: '費目別予算',
	name: '名称', type: '種別', initial_balance: '初期残高', is_asset: '資産への算入', sort_order: '表示順', is_archived: 'アーカイブ状態',
	debit_account_id: '引落口座', settlement_account_id: '精算口座', closing_day: '締日', debit_day: '引落日', debit_month_offset: '引落月',
	is_active: '有効状態', start_date: '開始日', end_date: '終了日', frequency: '繰返し頻度', interval_months: '繰返し月数', day_of_month: '対象日', holiday_adjustment: '休日調整', amortize_months: '按分月数',
	amount: '金額', account_id: '決済口座', to_account_id: '振替先口座', category_id: '計上費目', subcategory_id: '計上中項目', actual_category_id: '実態費目', actual_subcategory_id: '実態中項目', memo: 'メモ', tags: 'タグ',
	expense_budget: '支出予算', savings_target_amount: '貯蓄目標額', savings_target_rate: '貯蓄目標率', target_savings_rate: '目標貯蓄率'
};

function valueAtSegments(root, segments) {
	let value = root;
	for (const segment of segments) {
		if (typeof segment === 'string') value = value[segment];
		else value = value.find(item => item.id === segment.id);
	}
	return value;
}

function conflictLabel(segments, roots) {
	if (!segments.length) return '設定マスタ全体';
	const labels = [];
	for (let index = 0; index < segments.length; index++) {
		const segment = segments[index];
		if (typeof segment !== 'string') {
			const record = roots.map(root => valueAtSegments(root, segments.slice(0, index + 1))).find(value => value?.name);
			labels[labels.length - 1] += `「${record?.name || '名称未設定の項目'}」`;
		} else if (segments[index - 1] === 'category_budgets') {
			const category = roots.flatMap(root => Array.isArray(root?.categories) ? root.categories : []).find(item => item.id === segment);
			labels.push(category?.name ? `費目「${category.name}」` : '名称未設定の費目');
		} else if (segments[index - 1] === 'annual_budgets') labels.push(`${segment}年`);
		else labels.push(Object.hasOwn(FIELD_LABELS, segment) ? FIELD_LABELS[segment] : `項目「${segment}」`);
	}
	return labels.join(' / ');
}


function referenceDisplayName(root, segments, value) {
	if (typeof value !== 'string' || !value) return undefined;
	const field = segments.at(-1);
	const named = record => typeof record?.name === 'string' && record.name.trim() ? record.name : undefined;
	if (['account_id', 'to_account_id', 'debit_account_id', 'settlement_account_id'].includes(field)) {
		return named(Array.isArray(root?.accounts) ? root.accounts.find(account => account.id === value) : undefined);
	}
	const categories = Array.isArray(root?.categories) ? root.categories : [];
	if (['category_id', 'actual_category_id'].includes(field)) return named(categories.find(category => category.id === value));
	if (!['subcategory_id', 'actual_subcategory_id'].includes(field)) return undefined;
	const record = valueAtSegments(root, segments.slice(0, -1));
	const parentId = record?.[field === 'actual_subcategory_id' ? 'actual_category_id' : 'category_id'];
	const category = categories.find(item => item.id === parentId);
	const parentName = named(category);
	const subName = named(Array.isArray(category?.subcategories) ? category.subcategories.find(item => item.id === value) : undefined);
	return parentName && subName ? `${parentName} > ${subName}` : undefined;
}

export function mergeMasterConfigs(base, local, remote) {
	assertSafe(base); assertSafe(local); assertSafe(remote);
	const conflicts = [], conflictDetails = [];
	const merge = (before, here, there, path, segments) => {
		if (same(here, there) || same(before, there)) return here;
		if (same(before, here)) return there;
		if ([before, here, there].every(value => Array.isArray(value))) {
			if ([...before, ...here, ...there].every(value => value && typeof value === 'object' && typeof value.id === 'string')) {
				const previous = new Map(before.map(item => [item.id, item]));
				const ours = new Map(here.map(item => [item.id, item]));
				const theirs = new Map(there.map(item => [item.id, item]));
				return [...new Set([...here, ...there, ...before].map(item => item.id))].map(id => merge(previous.get(id), ours.get(id), theirs.get(id), `${path}.${id}`, [...segments, { id }])).filter(item => item !== undefined);
			}
			if ([...before, ...here, ...there].every(value => typeof value === 'string')) {
				return [...new Set([...here, ...there])].filter(value => before.includes(value) ? here.includes(value) && there.includes(value) : true);
			}
		}
		if ([here, there].every(value => value && !Array.isArray(value) && typeof value === 'object') && (before === undefined || (before && !Array.isArray(before) && typeof before === 'object'))) {
			const merged = {};
			for (const key of new Set([...Object.keys(before || {}), ...Object.keys(here), ...Object.keys(there)])) {
				const value = merge(before?.[key], here[key], there[key], path ? `${path}.${key}` : key, [...segments, key]);
				if (value !== undefined) merged[key] = value;
			}
			return merged;
		}
		conflicts.push(path);
		const localDisplayName = referenceDisplayName(local, segments, here);
		const remoteDisplayName = referenceDisplayName(remote, segments, there);
		conflictDetails.push({
			...(localDisplayName === undefined ? {} : { localDisplayName }), ...(remoteDisplayName === undefined ? {} : { remoteDisplayName }),
			id: `conflict-${conflictDetails.length}`, path, label: conflictLabel(segments, [local, remote, base]), segments: structuredClone(segments),
			localValue: structuredClone(here), remoteValue: structuredClone(there), hasLocal: here !== undefined, hasRemote: there !== undefined
		});
		return here;
	};
	return { config: structuredClone(merge(base, local, remote, '', [])), conflicts, conflictDetails };
}

export function resolveMasterConflicts(mergeResult, choices) {
	assertSafe(mergeResult);
	if (!(choices instanceof Map)) throw new Error('競合項目の選択にはMapが必要です');
	if (!mergeResult || !Array.isArray(mergeResult.conflictDetails)) throw new Error('競合情報が不正です');
	const details = mergeResult.conflictDetails;
	const ids = new Set();
	for (const detail of details) {
		if (!detail || typeof detail.id !== 'string' || !detail.id || ids.has(detail.id) || !Array.isArray(detail.segments)) throw new Error('競合情報が不正または重複しています');
		ids.add(detail.id);
		if (!choices.has(detail.id) || !['local', 'remote'].includes(choices.get(detail.id))) throw new Error('すべての競合項目で手元またはサーバーを選択してください');
		if (typeof detail.hasLocal !== 'boolean' || typeof detail.hasRemote !== 'boolean' || detail.hasLocal !== (detail.localValue !== undefined) || detail.hasRemote !== (detail.remoteValue !== undefined)) throw new Error('競合値の有無が不正です');
		for (const segment of detail.segments) {
			if (typeof segment === 'string') {
				if (['__proto__', 'constructor', 'prototype'].includes(segment)) throw new Error('競合パスに不正なキーが含まれています');
			} else if (!segment || typeof segment !== 'object' || Array.isArray(segment) || Object.keys(segment).length !== 1 || typeof segment.id !== 'string') throw new Error('競合パスが不正です');
		}
	}
	if (choices.size !== ids.size || [...choices.keys()].some(id => !ids.has(id))) throw new Error('未知の競合項目が選択されています');
	let resolved = structuredClone(mergeResult.config);
	for (const detail of details) {
		const useLocal = choices.get(detail.id) === 'local';
		const present = useLocal ? detail.hasLocal : detail.hasRemote;
		const value = structuredClone(useLocal ? detail.localValue : detail.remoteValue);
		if (!detail.segments.length) { resolved = present ? value : undefined; continue; }
		let parent = resolved;
		for (const segment of detail.segments.slice(0, -1)) {
			if (typeof segment === 'string') {
				if (!parent || typeof parent !== 'object' || Array.isArray(parent) || !Object.hasOwn(parent, segment)) throw new Error('競合パスの参照先が不正です');
				parent = parent[segment];
			} else {
				if (!Array.isArray(parent)) throw new Error('競合パスの配列参照が不正です');
				parent = parent.find(item => item?.id === segment.id);
				if (!parent) throw new Error('競合パスの項目参照が不正です');
			}
		}
		const finalSegment = detail.segments.at(-1);
		if (typeof finalSegment === 'string') {
			if (!parent || typeof parent !== 'object' || Array.isArray(parent)) throw new Error('競合パスの参照先が不正です');
			if (present) parent[finalSegment] = value;
			else delete parent[finalSegment];
		} else {
			if (!Array.isArray(parent)) throw new Error('競合パスの配列参照が不正です');
			const index = parent.findIndex(item => item?.id === finalSegment.id);
			if (!present) { if (index !== -1) parent.splice(index, 1); }
			else {
				if (!value || typeof value !== 'object' || value.id !== finalSegment.id) throw new Error('競合値のID参照が不正です');
				if (index === -1) parent.push(value);
				else parent[index] = value;
			}
		}
	}
	return resolved;
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
	const requireRef = (value, ids, label) => { if (value && !ids.has(value)) throw new Error(`${label}の参照先「${value}」が存在しません。選択を変更してください`); };
	for (const account of config.accounts || []) {
		requireRef(account.debit_account_id, accounts, `口座「${account.name || account.id}」の引落口座`);
		requireRef(account.settlement_account_id, accounts, `口座「${account.name || account.id}」の精算口座`);
	}
	for (const rule of config.recurring_rules || []) {
		for (const field of ['account_id', 'to_account_id']) requireRef(rule[field], accounts, `定期設定「${rule.name || rule.id}」の${field === 'account_id' ? '決済口座' : '振替先口座'}`);
		for (const prefix of ['', 'actual_']) {
			requireRef(rule[`${prefix}category_id`], categories, `定期設定「${rule.name || rule.id}」の${prefix ? '実態' : '計上'}費目`);
			requireRef(rule[`${prefix}subcategory_id`], subcategories.get(rule[`${prefix}category_id`]) || new Set(), `定期設定「${rule.name || rule.id}」の${prefix ? '実態' : '計上'}中項目`);
		}
	}
}
