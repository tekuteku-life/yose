/**
 * Yoseatsume Kakeibo - Non-Destructive Backup Merger & Sanitizer (Requirement 3.14 & 3.15)
 */

import { FORBIDDEN_PROTOTYPE_KEYS } from './defaults.js';

export class BackupMerger {
	// Validate the entire payload before the first write, including collections consumed by the UI.
	static validateImportData(data, detectedType) {
		const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
		const requireType = (valid, field) => {
			if (!valid) throw new Error(`Invalid import data: ${field}`);
		};
		const requiredFields = {
			full_backup: ['transactions', 'master_config', 'summary_snapshot'],
			transactions: ['transactions'],
			master_config: ['master_config'],
			annual_budgets: ['annual_budgets'],
			summary_snapshot: ['summary_snapshot']
		};
		requireType(Object.hasOwn(requiredFields, detectedType), 'unknown export type');
		for (const field of requiredFields[detectedType]) requireType(Object.hasOwn(data, field), field);

		const objects = (value, field) => {
			requireType(Array.isArray(value), field);
			for (const item of value) requireType(isObject(item), `${field}[]`);
			return value;
		};
		const optionalStrings = (item, fields, prefix) => {
			for (const field of fields) {
				if (item[field] != null) requireType(typeof item[field] === 'string', `${prefix}.${field}`);
			}
		};
		const optionalNumbers = (item, fields, prefix) => {
			for (const field of fields) {
				if (item[field] != null) requireType(typeof item[field] === 'number' && Number.isFinite(item[field]), `${prefix}.${field}`);
			}
		};
		const numberMap = (map, prefix) => {
			requireType(isObject(map), prefix);
			optionalNumbers(map, Object.keys(map), prefix);
		};
		const objectField = (item, field, prefix) => {
			if (item[field] !== undefined) requireType(isObject(item[field]), `${prefix}.${field}`);
		};
		const categorySummary = (map, prefix) => {
			requireType(isObject(map), prefix);
			for (const value of Object.values(map)) {
				if (typeof value === 'number') {
					requireType(Number.isFinite(value), prefix);
				} else {
					requireType(isObject(value), prefix);
					optionalNumbers(value, ['total', 'confirmed', 'planned', 'total_confirmed', 'total_planned'], prefix);
					if (value.by_subcategory !== undefined) categorySummary(value.by_subcategory, `${prefix}.by_subcategory`);
				}
			}
		};
		const budgets = value => {
			requireType(isObject(value), 'annual_budgets');
			for (const budget of Object.values(value)) {
				requireType(isObject(budget), 'annual_budgets.year');
				optionalNumbers(budget, ['expense_budget', 'savings_target_amount', 'savings_target_rate', 'target_savings_rate'], 'annual_budgets.year');
				if (budget.category_budgets !== undefined) numberMap(budget.category_budgets, 'category_budgets');
			}
		};
		if (data.transactions !== undefined) {
			for (const tx of objects(data.transactions, 'transactions')) {
				optionalStrings(tx, ['id', 'date', 'target_month', 'type', 'status', 'memo', 'created_at', 'updated_at', 'account_id', 'to_account_id', 'category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id', 'group_id', 'previous_target_month'], 'transactions');
				optionalNumbers(tx, ['amount'], 'transactions');
				if (tx.tags !== undefined) requireType(Array.isArray(tx.tags) && tx.tags.every(tag => typeof tag === 'string'), 'transactions.tags');
				for (const field of ['tax_meta', 'amortization_meta', 'auto_settlement_meta']) {
					if (tx[field] != null) requireType(isObject(tx[field]), `transactions.${field}`);
				}
			}
		}
		if (data.master_config !== undefined) {
			const config = data.master_config;
			requireType(isObject(config), 'master_config');
			for (const field of ['accounts', 'categories', 'recurring_rules']) {
				if (config[field] === undefined) continue;
				for (const item of objects(config[field], `master_config.${field}`)) {
					optionalStrings(item, ['id', 'name', 'type', 'icon', 'updated_at', 'maturity_date', 'start_date', 'end_date', 'account_id', 'to_account_id', 'category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id', 'memo'], field);
					optionalNumbers(item, ['initial_balance', 'amount', 'day_of_month', 'closing_day', 'debit_day', 'debit_month_offset', 'premium_amount', 'premium_day', 'maturity_amount', 'interval_months', 'amortize_months'], field);
					if (item.subcategories !== undefined) {
						for (const sub of objects(item.subcategories, 'subcategories')) optionalStrings(sub, ['id', 'name'], 'subcategories');
					}
				}
			}
			if (config.holidays !== undefined) requireType(Array.isArray(config.holidays) && config.holidays.every(day => typeof day === 'string'), 'holidays');
			if (config.annual_budgets !== undefined) budgets(config.annual_budgets);
			objectField(config, 'collapsed_panes', 'master_config');
			objectField(config, 'synced_passkey_bundle', 'master_config');
		}
		if (data.annual_budgets !== undefined) budgets(data.annual_budgets);
		if (data.summary_snapshot !== undefined) {
			const snapshot = data.summary_snapshot;
			requireType(isObject(snapshot), 'summary_snapshot');
			if (snapshot.account_balances !== undefined) numberMap(snapshot.account_balances, 'account_balances');
			optionalStrings(snapshot, ['last_closed_month', 'calculated_at'], 'summary_snapshot');
			objectField(snapshot, 'monthly_summaries', 'summary_snapshot');
			for (const month of Object.values(snapshot.monthly_summaries || {})) {
				requireType(isObject(month), 'monthly_summaries.month');
				optionalNumbers(month, ['income_total', 'expense_total', 'net_income', 'income_confirmed', 'expense_confirmed', 'total_income', 'total_expense'], 'monthly_summaries.month');
				if (month.by_category !== undefined) categorySummary(month.by_category, 'by_category');
				if (month.by_actual_category !== undefined) categorySummary(month.by_actual_category, 'by_actual_category');
			}
			if (snapshot.external_assets !== undefined) {
				for (const asset of objects(snapshot.external_assets, 'external_assets')) optionalStrings(asset, ['name', 'updated_at'], 'external_assets');
			}
		}
	}

	static isSafeKey(key) {
		return typeof key === 'string' && key.length > 0 && !FORBIDDEN_PROTOTYPE_KEYS.has(key);
	}

	static isValidYearKey(year) {
		const yearStr = String(year || '');
		return BackupMerger.isSafeKey(yearStr) && /^\d{4}$/.test(yearStr);
	}

	static sanitizeCategoryBudgets(rawCategoryBudgets) {
		const clean = {};
		if (rawCategoryBudgets && typeof rawCategoryBudgets === 'object') {
			for (const [catId, val] of Object.entries(rawCategoryBudgets)) {
				if (BackupMerger.isSafeKey(catId)) {
					clean[catId] = Math.max(0, Number(val) || 0);
				}
			}
		}
		return clean;
	}

	static normalizeBudgetEntry(entry) {
		if (!entry || typeof entry !== 'object') {
			return {
				expense_budget: 0,
				savings_target_amount: 0,
				savings_target_rate: 0,
				category_budgets: {}
			};
		}
		return {
			expense_budget: Math.max(0, Number(entry.expense_budget) || 0),
			savings_target_amount: Math.max(0, Number(entry.savings_target_amount) || 0),
			savings_target_rate: Math.max(0, Number(entry.savings_target_rate ?? entry.target_savings_rate) || 0),
			category_budgets: BackupMerger.sanitizeCategoryBudgets(entry.category_budgets)
		};
	}

	static mergeMasterConfig(localConfig, importedConfig, stats) {
		// 1. Accounts: union by id
		if (Array.isArray(importedConfig.accounts)) {
			if (!Array.isArray(localConfig.accounts)) localConfig.accounts = [];
			const existingAccIds = new Set(localConfig.accounts.map(a => a.id));
			for (const acc of importedConfig.accounts) {
				if (acc && BackupMerger.isSafeKey(acc.id) && !existingAccIds.has(acc.id)) {
					localConfig.accounts.push(acc);
					existingAccIds.add(acc.id);
					stats.addedAccounts++;
				}
			}
		}

		// 2. Categories & Subcategories: recursive union by id
		if (Array.isArray(importedConfig.categories)) {
			if (!Array.isArray(localConfig.categories)) localConfig.categories = [];
			const catMap = new Map(localConfig.categories.map(c => [c.id, c]));
			for (const impCat of importedConfig.categories) {
				if (!impCat || !BackupMerger.isSafeKey(impCat.id)) continue;
				if (!catMap.has(impCat.id)) {
					localConfig.categories.push(impCat);
					catMap.set(impCat.id, impCat);
					stats.addedCategories++;
					if (Array.isArray(impCat.subcategories)) {
						stats.addedSubcategories += impCat.subcategories.length;
					}
				} else {
					const targetCat = catMap.get(impCat.id);
					if (!Array.isArray(targetCat.subcategories)) {
						targetCat.subcategories = [];
					}
					const existingSubIds = new Set(targetCat.subcategories.map(s => s.id));
					if (Array.isArray(impCat.subcategories)) {
						for (const sub of impCat.subcategories) {
							if (sub && BackupMerger.isSafeKey(sub.id) && !existingSubIds.has(sub.id)) {
								targetCat.subcategories.push(sub);
								existingSubIds.add(sub.id);
								stats.addedSubcategories++;
							}
						}
					}
				}
			}
		}

		// 3. Recurring Rules: union by id
		if (Array.isArray(importedConfig.recurring_rules)) {
			if (!Array.isArray(localConfig.recurring_rules)) localConfig.recurring_rules = [];
			const existingRuleIds = new Set(localConfig.recurring_rules.map(r => r.id));
			for (const rule of importedConfig.recurring_rules) {
				if (rule && BackupMerger.isSafeKey(rule.id) && !existingRuleIds.has(rule.id)) {
					localConfig.recurring_rules.push(rule);
					existingRuleIds.add(rule.id);
					stats.addedRecurringRules++;
				}
			}
		}

		// 4. Holidays: Set union & sort
		if (Array.isArray(importedConfig.holidays)) {
			const localHolidays = Array.isArray(localConfig.holidays) ? localConfig.holidays : [];
			const prevCount = localHolidays.length;
			const unionSet = new Set([...localHolidays, ...importedConfig.holidays]);
			localConfig.holidays = Array.from(unionSet).sort();
			stats.addedHolidays = localConfig.holidays.length - prevCount;
		}

		// 5. Annual Budgets: union by year key & non-destructive category_budgets merge
		if (importedConfig.annual_budgets && typeof importedConfig.annual_budgets === 'object') {
			if (!localConfig.annual_budgets || typeof localConfig.annual_budgets !== 'object') {
				localConfig.annual_budgets = {};
			}
			for (const [yKey, bVal] of Object.entries(importedConfig.annual_budgets)) {
				if (!BackupMerger.isValidYearKey(yKey) || !bVal || typeof bVal !== 'object') continue;
				const normalized = BackupMerger.normalizeBudgetEntry(bVal);

				if (!Object.prototype.hasOwnProperty.call(localConfig.annual_budgets, yKey)) {
					localConfig.annual_budgets[yKey] = normalized;
					stats.addedBudgets++;
				} else {
					if (!localConfig.annual_budgets[yKey].category_budgets || typeof localConfig.annual_budgets[yKey].category_budgets !== 'object') {
						localConfig.annual_budgets[yKey].category_budgets = {};
					}
					for (const [cId, cVal] of Object.entries(normalized.category_budgets)) {
						if (!Object.prototype.hasOwnProperty.call(localConfig.annual_budgets[yKey].category_budgets, cId)) {
							localConfig.annual_budgets[yKey].category_budgets[cId] = cVal;
						}
					}
				}
			}
		}

		// 6. Collapsed Panes: safe boolean map merge (Requirement 3.37)
		if (importedConfig.collapsed_panes && typeof importedConfig.collapsed_panes === 'object' && !Array.isArray(importedConfig.collapsed_panes)) {
			if (!localConfig.collapsed_panes || typeof localConfig.collapsed_panes !== 'object' || Array.isArray(localConfig.collapsed_panes)) {
				localConfig.collapsed_panes = {};
			}
			for (const [paneId, isCollapsed] of Object.entries(importedConfig.collapsed_panes)) {
				if (BackupMerger.isSafeKey(paneId) && !Object.prototype.hasOwnProperty.call(localConfig.collapsed_panes, paneId)) {
					localConfig.collapsed_panes[paneId] = Boolean(isCollapsed);
				}
			}
		}

		delete localConfig.synced_passkey_bundle;

	}

	static mergeSummarySnapshot(localSnapshot, importedSnapshot) {
		if (importedSnapshot.monthly_summaries && typeof importedSnapshot.monthly_summaries === 'object') {
			if (!localSnapshot.monthly_summaries || typeof localSnapshot.monthly_summaries !== 'object') {
				localSnapshot.monthly_summaries = {};
			}
			for (const [mKey, mVal] of Object.entries(importedSnapshot.monthly_summaries)) {
				if (!BackupMerger.isSafeKey(mKey) || !/^\d{4}-\d{2}$/.test(mKey)) continue;
				if (!mVal || typeof mVal !== 'object') continue;
				if (!Object.prototype.hasOwnProperty.call(localSnapshot.monthly_summaries, mKey)) {
					localSnapshot.monthly_summaries[mKey] = mVal;
				}
			}
		}
		if (importedSnapshot.last_closed_month) {
			if (!localSnapshot.last_closed_month || importedSnapshot.last_closed_month > localSnapshot.last_closed_month) {
				localSnapshot.last_closed_month = importedSnapshot.last_closed_month;
			}
		}
		return localSnapshot;
	}
}

