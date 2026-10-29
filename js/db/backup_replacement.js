/** Strict validation for explicit, destructive backup replacement. */
import { BackupMerger } from './backup_merger.js';
import { sharedMasterConfig } from '../logic/master_sync.js';
import { dataIntegrity } from '../logic/data_integrity.js';

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
		for (const tx of data.transactions) {
			booleans(tx, ['is_deleted', 'amount_pending', 'is_payment_record', 'is_point_split']);
			if (tx.is_deleted === true) continue;
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
	dataIntegrity.assertChange(null, { master_config: config, transactions, summary_snapshot: snapshot }, { strict: true, allowArchivedReferences: true });
}
