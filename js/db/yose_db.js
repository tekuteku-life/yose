/**
 * Yoseatsume Kakeibo - High-Level Domain Repository (YoseDB)
 */

import { DEFAULT_MASTER_CONFIG } from './defaults.js';
import { StorageEngine } from './storage_engine.js';
import { BackupMerger } from './backup_merger.js';

export class YoseDB extends StorageEngine {
	// --- Master Config ---
	async getMasterConfig() {
		const raw = await this.getRaw('master_config', 'current');
		return await this.decryptRecord(raw);
	}

	async saveMasterConfig(config) {
		const updated = {
			...config,
			updated_at: new Date().toISOString()
		};
		const toStore = await this.encryptRecord(updated);
		await this.putRaw('master_config', toStore, 'current');
		return updated;
	}

	// --- Summary Snapshot ---
	async getSnapshot() {
		const raw = await this.getRaw('summary_snapshot', 'current');
		return await this.decryptRecord(raw);
	}

	async saveSnapshot(snapshot) {
		const toStore = await this.encryptRecord(snapshot);
		await this.putRaw('summary_snapshot', toStore, 'current');
		return snapshot;
	}

	// --- Transactions ---
	async getTransaction(id) {
		const raw = await this.getRaw('transactions', id);
		return await this.decryptRecord(raw);
	}

	async saveTransaction(transaction) {
		return await this.putTransaction(transaction);
	}

	async putTransaction(transaction) {
		const record = {
			...transaction,
			updated_at: transaction.updated_at || new Date().toISOString(),
			sync_status: transaction.sync_status || 'unsynced'
		};
		if (!record.created_at) {
			record.created_at = record.updated_at;
		}

		const toStore = await this.encryptRecord(record, {
			id: record.id,
			target_month: record.target_month,
			date: record.date,
			sync_status: record.sync_status,
			is_deleted: record.is_deleted || false
		});

		await this.putRaw('transactions', toStore);
		return record;
	}

	async putTransactions(txList) {
		const results = [];
		for (const t of txList) {
			results.push(await this.putTransaction(t));
		}
		return results;
	}

	async deleteTransaction(id, soft = true) {
		if (soft) {
			const tx = await this.getTransaction(id);
			if (!tx) return null;
			tx.is_deleted = true;
			tx.updated_at = new Date().toISOString();
			tx.sync_status = 'unsynced';
			return await this.putTransaction(tx);
		}
		return await this.deleteRaw('transactions', id);
	}

	async getTransactions(filter = {}) {
		const all = await this.getAllRaw('transactions');
		const candidateItems = all.filter(raw => {
			if (!filter.includeDeleted && raw.is_deleted) return false;
			if (filter.target_month && raw.target_month && raw.target_month !== filter.target_month) return false;
			if (filter.sync_status && raw.sync_status && raw.sync_status !== filter.sync_status) return false;
			return true;
		});

		const decrypted = [];
		for (const item of candidateItems) {
			decrypted.push(await this.decryptRecord(item));
		}

		return decrypted.filter(t => {
			if (!filter.includeDeleted && t.is_deleted) return false;
			if (filter.target_month && t.target_month !== filter.target_month) return false;
			if (filter.status && t.status !== filter.status) return false;
			if (filter.group_id && t.group_id !== filter.group_id) return false;
			if (filter.sync_status && t.sync_status !== filter.sync_status) return false;
			if (filter.type && t.type !== filter.type) return false;
			if (filter.account_id && t.account_id !== filter.account_id && t.to_account_id !== filter.account_id) return false;
			return true;
		});
	}

	async getUnsyncedTransactions() {
		return await this.getTransactions({ sync_status: 'unsynced', includeDeleted: true });
	}

	async markTransactionsSynced(ids) {
		if (!Array.isArray(ids) || ids.length === 0) return 0;
		let count = 0;
		for (const id of ids) {
			const tx = await this.getTransaction(id);
			if (tx && tx.sync_status === 'unsynced') {
				tx.sync_status = 'synced';
				await this.putTransaction(tx);
				count++;
			}
		}
		return count;
	}

	// --- Security Keys ---
	async getSecurityKey(key) {
		return await this.getRaw('security_keys', key);
	}

	async saveSecurityKey(key, value) {
		return await this.putRaw('security_keys', value, key);
	}

	async deleteSecurityKey(key) {
		return await this.deleteRaw('security_keys', key);
	}

	// --- Settings ---
	async getSetting(key, defaultValue = null) {
		const val = await this.getRaw('settings', key);
		return val !== null && val !== undefined ? val : defaultValue;
	}

	async setSetting(key, value) {
		return await this.putRaw('settings', value, key);
	}

	// --- Annual Budgets (Requirement 3.14) ---
	async getAnnualBudget(year) {
		const yearStr = String(year || '');
		if (!BackupMerger.isValidYearKey(yearStr)) {
			return BackupMerger.normalizeBudgetEntry(null);
		}
		const config = await this.getMasterConfig();
		const entry = Object.prototype.hasOwnProperty.call(config?.annual_budgets || {}, yearStr)
			? config.annual_budgets[yearStr]
			: null;
		return BackupMerger.normalizeBudgetEntry(entry);
	}

	async saveAnnualBudget(year, budget) {
		const yearStr = String(year || '');
		if (!BackupMerger.isValidYearKey(yearStr)) {
			throw new Error('Invalid budget year: must be a 4-digit year');
		}
		const config = await this.getMasterConfig() || { ...DEFAULT_MASTER_CONFIG };
		if (!config.annual_budgets || typeof config.annual_budgets !== 'object') {
			config.annual_budgets = {};
		}
		config.annual_budgets[yearStr] = BackupMerger.normalizeBudgetEntry(budget);
		await this.saveMasterConfig(config);
		return config.annual_budgets[yearStr];
	}

	// --- Backup Export / Import ---
	async exportFullData() {
		const config = await this.getMasterConfig();
		const snapshot = await this.getSnapshot();
		const transactions = await this.getTransactions({ includeDeleted: true });
		return {
			schema_version: 2,
			exported_at: new Date().toISOString(),
			master_config: config,
			summary_snapshot: snapshot,
			transactions
		};
	}

	async importFullData(data) {
		if (!data || data.schema_version !== 2) {
			throw new Error('Invalid data schema version');
		}

		const stats = {
			addedTransactions: 0,
			updatedTransactions: 0,
			skippedTransactions: 0,
			addedAccounts: 0,
			addedCategories: 0,
			addedSubcategories: 0,
			addedRecurringRules: 0,
			addedHolidays: 0,
			addedBudgets: 0
		};

		// 1. Transactions Non-Destructive Merge
		if (Array.isArray(data.transactions)) {
			for (const importedTx of data.transactions) {
				if (!importedTx || typeof importedTx !== 'object' || !BackupMerger.isSafeKey(importedTx.id)) continue;
				const localTx = await this.getTransaction(importedTx.id);
				if (!localTx) {
					await this.putTransaction(importedTx);
					stats.addedTransactions++;
				} else {
					const localTime = localTx.updated_at ? new Date(localTx.updated_at).getTime() : 0;
					const importedTime = importedTx.updated_at ? new Date(importedTx.updated_at).getTime() : 0;
					if (importedTime > localTime) {
						await this.putTransaction(importedTx);
						stats.updatedTransactions++;
					} else {
						stats.skippedTransactions++;
					}
				}
			}
		}

		// 2. Master Config Non-Destructive Union Merge
		if (data.master_config && typeof data.master_config === 'object') {
			const localConfig = await this.getMasterConfig() || { ...DEFAULT_MASTER_CONFIG };
			BackupMerger.mergeMasterConfig(localConfig, data.master_config, stats);
			await this.saveMasterConfig(localConfig);
		}

		// 3. Summary Snapshot Non-Destructive Merge
		if (data.summary_snapshot && typeof data.summary_snapshot === 'object') {
			const localSnapshot = await this.getSnapshot() || { ...DEFAULT_SUMMARY_SNAPSHOT };
			BackupMerger.mergeSummarySnapshot(localSnapshot, data.summary_snapshot);
			await this.saveSnapshot(localSnapshot);
		}

		return { success: true, stats };
	}
}
