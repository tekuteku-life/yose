/**
 * Yoseatsume Kakeibo - Non-Destructive Backup Merger & Sanitizer (Requirement 3.14 & 3.15)
 */

import { FORBIDDEN_PROTOTYPE_KEYS } from './defaults.js';

export class BackupMerger {
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

		return localConfig;
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

