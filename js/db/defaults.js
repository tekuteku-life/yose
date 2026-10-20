/**
 * Yoseatsume Kakeibo - Database Schema Constants & Default Configurations (Schema v2)
 */

export const DB_NAME = 'yose_kakeibo_db';
export const DB_VERSION = 1;

export const FORBIDDEN_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export const DEFAULT_MASTER_CONFIG = {
	schema_version: 2,
	updated_at: new Date().toISOString(),
	accounts: [
		{
			id: 'acc_wallet',
			name: '現金（財布）',
			type: 'cash',
			initial_balance: 15000,
			is_asset: true,
			sort_order: 1,
			is_archived: false
		},
		{
			id: 'acc_bank_main',
			name: 'メイン銀行',
			type: 'bank',
			initial_balance: 1000000,
			is_asset: true,
			sort_order: 2,
			is_archived: false
		},
		{
			id: 'acc_card_a',
			name: 'メインクレカ',
			type: 'credit_card',
			initial_balance: 0,
			is_asset: false,
			debit_account_id: 'acc_bank_main',
			settlement_account_id: 'acc_bank_main',
			sort_order: 3,
			is_archived: false
		},
		{
			id: 'acc_receivable',
			name: '立替金・貸付金',
			type: 'receivable',
			initial_balance: 0,
			is_asset: true,
			sort_order: 4,
			is_archived: false
		},
		{
			id: 'acc_prepaid',
			name: '前払費用（年払い・まとめ払い枠）',
			type: 'prepaid',
			initial_balance: 0,
			is_asset: true,
			sort_order: 5,
			is_archived: false
		},
		{
			id: 'acc_point',
			name: 'ポイント（共通ポイント・電子マネー）',
			type: 'point',
			initial_balance: 0,
			is_asset: true,
			sort_order: 6,
			is_archived: false
		},
		{
			id: 'acc_investment_main',
			name: '証券口座（積立NISA・投資信託）',
			type: 'investment',
			initial_balance: 1225000,
			is_asset: true,
			sort_order: 7,
			is_archived: false
		}
	],
	categories: [
		{
			id: 'cat_food',
			type: 'expense',
			name: '食費',
			sort_order: 1,
			is_archived: false,
			subcategories: [
				{ id: 'sub_groceries', name: '食料品', sort_order: 1, is_archived: false },
				{ id: 'sub_dining_out', name: '外食', sort_order: 2, is_archived: false }
			]
		},
		{
			id: 'cat_social',
			type: 'expense',
			name: '交際費・娯楽',
			sort_order: 2,
			is_archived: false,
			subcategories: [
				{ id: 'sub_drinking', name: '飲み会・友人食事', sort_order: 1, is_archived: false },
				{ id: 'sub_leisure', name: 'レジャー・サブスク', sort_order: 2, is_archived: false }
			]
		},
		{
			id: 'cat_housing',
			type: 'expense',
			name: '住居・通信',
			sort_order: 3,
			is_archived: false,
			subcategories: [
				{ id: 'sub_rent', name: '家賃', sort_order: 1, is_archived: false },
				{ id: 'sub_utilities', name: '水道光熱費', sort_order: 2, is_archived: false }
			]
		},
		{
			id: 'cat_income_main',
			type: 'income',
			name: '給与・賞与',
			sort_order: 4,
			is_archived: false,
			subcategories: [
				{ id: 'sub_salary', name: '本業給与', sort_order: 1, is_archived: false },
				{ id: 'sub_bonus', name: '賞与', sort_order: 2, is_archived: false }
			]
		},
		{
			id: 'cat_point_income',
			type: 'income',
			name: 'ポイント・還元相殺',
			sort_order: 5,
			is_archived: false,
			subcategories: [
				{ id: 'sub_point_offset', name: 'ポイント利用相殺', sort_order: 1, is_archived: false },
				{ id: 'sub_point_reward', name: 'ポイント獲得・還元', sort_order: 2, is_archived: false }
			]
		}
	],
	recurring_rules: [
		{
			id: 'rec_rent',
			name: '家賃引き落とし',
			is_active: true,
			start_date: '2026-04-01',
			end_date: '2028-03-31',
			frequency: 'interval_months',
			interval_months: 1,
			day_of_month: 27,
			holiday_adjustment: 'after',
			amortize_months: 1,
			type: 'expense',
			amount: 120000,
			account_id: 'acc_bank_main',
			to_account_id: null,
			category_id: 'cat_housing',
			subcategory_id: 'sub_rent',
			actual_category_id: 'cat_housing',
			actual_subcategory_id: 'sub_rent',
			memo: '定期：家賃'
		}
	],
	holidays: [
		'2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20',
		'2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
		'2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
		'2026-10-12', '2026-11-03', '2026-11-23'
	],
	annual_budgets: {}
};

export const DEFAULT_SUMMARY_SNAPSHOT = {
	schema_version: 2,
	last_closed_month: '2026-09',
	calculated_at: new Date().toISOString(),
	account_balances: {
		acc_wallet: 15000,
		acc_bank_main: 1000000,
		acc_card_a: 0,
		acc_receivable: 0,
		acc_prepaid: 0,
		acc_investment_main: 1225000
	},
	monthly_summaries: {}
};

