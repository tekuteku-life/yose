/** Strict validation for explicit, destructive backup replacement. */
import { BackupMerger } from './backup_merger.js';
import { assertMasterReferences, sharedMasterConfig } from '../logic/master_sync.js';

export const IMPORT_CONFIRMATION_WORD = '完全インポート';
const FIELDS = {
	full_backup: ['transactions', 'master_config', 'summary_snapshot'],
	transactions: ['transactions'],
	master_config: ['master_config'],
	annual_budgets: ['annual_budgets'],
	summary_snapshot: ['summary_snapshot']
};

export function prepareReplacementData(input) {
	if (Array.isArray(input)) input = { schema_version: 2, export_type: 'transactions', transactions: input };
	if (!input || typeof input !== 'object' || (input.schema_version !== undefined && input.schema_version !== 2)) throw new Error('Invalid import schema version');
	const assertSafe = value => {
		if (!value || typeof value !== 'object') return;
		for (const [key, nested] of Object.entries(value)) {
			if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('不正なキーが含まれています');
			assertSafe(nested);
		}
	};
	assertSafe(input);
	const booleans = (item, fields) => {
		for (const field of fields) if (item[field] !== undefined && typeof item[field] !== 'boolean') throw new Error(`Invalid import data: ${field} must be boolean`);
	};
	const present = ['transactions', 'master_config', 'annual_budgets', 'summary_snapshot'].filter(key => Object.hasOwn(input, key));
	const detectedType = input.export_type || (present.length === 3 && present.includes('master_config') && present.includes('summary_snapshot') && present.includes('transactions') ? 'full_backup' : present.length === 1 ? present[0] : 'unknown');
	BackupMerger.validateImportData(input, detectedType);
	if (present.some(key => !FIELDS[detectedType].includes(key))) throw new Error('Invalid import data: 種別外のデータが含まれています');
	const data = { schema_version: 2, export_type: detectedType };
	for (const field of FIELDS[detectedType]) data[field] = structuredClone(input[field]);
	if (data.master_config) {
		for (const field of ['accounts', 'categories', 'recurring_rules', 'holidays']) {
			if (!Array.isArray(data.master_config[field])) throw new Error(`Invalid import data: master_config.${field}`);
		}
		for (const account of data.master_config.accounts) booleans(account, ['is_archived', 'is_asset']);
		for (const category of data.master_config.categories) {
			booleans(category, ['is_archived']);
			for (const sub of category.subcategories || []) booleans(sub, ['is_archived']);
		}
		for (const rule of data.master_config.recurring_rules) booleans(rule, ['is_active']);
		const collapsed = data.master_config.collapsed_panes;
		data.master_config = { ...sharedMasterConfig(data.master_config), schema_version: 2 };
		if (collapsed) data.master_config.collapsed_panes = collapsed;
	}
	if (data.transactions) {
		const ids = new Set();
		for (const tx of data.transactions) {
			if (!BackupMerger.isSafeKey(tx.id) || ids.has(tx.id)) throw new Error('Invalid import data: 明細IDが不正または重複しています');
			ids.add(tx.id);
			booleans(tx, ['is_deleted', 'amount_pending', 'is_payment_record', 'is_point_split']);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(tx.date || '') || !Number.isFinite(Date.parse(tx.date)) || new Date(tx.date).toISOString().slice(0, 10) !== tx.date || !/^\d{4}-(0[1-9]|1[0-2])$/.test(tx.target_month || '')) throw new Error('Invalid import data: 明細の日付・計上月が不正です');
			if (!['expense', 'income', 'transfer'].includes(tx.type) || !['confirmed', 'planned'].includes(tx.status) || typeof tx.amount !== 'number' || !Number.isFinite(tx.amount) || tx.amount < 0 || !BackupMerger.isSafeKey(tx.account_id)) throw new Error('Invalid import data: 明細の必須値が不正です');
			if (tx.type === 'transfer' && (!BackupMerger.isSafeKey(tx.to_account_id) || tx.account_id === tx.to_account_id)) throw new Error('Invalid import data: 振替先口座が不正です');
		}
	}
	if (data.summary_snapshot) {
		const month = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
		if (data.summary_snapshot.last_closed_month != null && !month(data.summary_snapshot.last_closed_month)) throw new Error('Invalid import data: last_closed_month');
		for (const key of Object.keys(data.summary_snapshot.monthly_summaries || {})) if (!month(key)) throw new Error('Invalid import data: monthly_summaries month');
	}
	return { data, detectedType };
}

export function assertReplacementReferences(config, transactions, snapshot) {
	assertMasterReferences(config);
	const accounts = new Set((config.accounts || []).map(item => item.id));
	const categories = new Map((config.categories || []).map(item => [item.id, new Set((item.subcategories || []).map(sub => sub.id))]));
	const ref = (id, collection, label) => { if (id && !collection.has(id)) throw new Error(`${label}の参照先「${id}」が見つかりません`); };
	for (const account of config.accounts || []) ref(account.premium_pay_account_id, accounts, '保険料支払口座');
	for (const tx of transactions.filter(item => !item.is_deleted)) {
		for (const field of ['account_id', 'to_account_id']) ref(tx[field], accounts, `明細「${tx.id}」の口座`);
		for (const prefix of ['', 'actual_']) {
			ref(tx[`${prefix}category_id`], categories, `明細「${tx.id}」の費目`);
			ref(tx[`${prefix}subcategory_id`], categories.get(tx[`${prefix}category_id`]) || new Set(), `明細「${tx.id}」の中項目`);
		}
	}
	for (const [year, budget] of Object.entries(config.annual_budgets || {})) {
		if (!BackupMerger.isValidYearKey(year)) throw new Error('Invalid import data: 予算年度が不正です');
		for (const id of Object.keys(budget.category_budgets || {})) ref(id, categories, '年間予算の費目');
	}
	for (const id of Object.keys(snapshot?.account_balances || {})) ref(id, accounts, 'スナップショットの口座');
}
