/**
 * Yoseatsume Kakeibo - High-Level Domain Repository (YoseDB)
 */

import { buildMasterMigration } from '../logic/master_maintenance.js';
import { DEFAULT_MASTER_CONFIG, DEFAULT_SUMMARY_SNAPSHOT } from './defaults.js';
import { StorageEngine } from './storage_engine.js';
import { BackupMerger } from './backup_merger.js';
import { formatDate, calculateCreditCardDebitDate } from '../logic/date_utils.js';
import { canonicalJsonStringify } from '../crypto.js';
import { createCreditCardSettlementTransaction } from '../logic/transaction_factory.js';
import { SHARED_MASTER_FIELDS, sharedMasterConfig, mergeMasterConfigs, assertMasterReferences } from '../logic/master_sync.js';

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


	async getMasterSyncBase() {
		return this.decryptRecord(await this.getRaw('master_config', 'sync_base'));
	}

	async hasUnsyncedMasterConfig() {
		const base = await this.getMasterSyncBase() || sharedMasterConfig(DEFAULT_MASTER_CONFIG);
		return canonicalJsonStringify(sharedMasterConfig(await this.getMasterConfig())) !== canonicalJsonStringify(base);
	}

	async commitMasterSync(submittedLocal, acceptedShared, { isSessionValid = null } = {}) {
		const encryptionKey = this.encryptionKey;
		const checkSession = () => {
			if (this.encryptionKey !== encryptionKey || (isSessionValid && !isSessionValid())) throw new Error('認証がロックまたは変更されました。解除後に設定を確認し直してください。');
		};
		const accepted = sharedMasterConfig(acceptedShared);
		while (true) {
			checkSession();
			const raw = await this.getRaw('master_config', 'current');
			const baseRaw = await this.getRaw('master_config', 'sync_base');
			const current = await this.decryptRecord(raw);
			const merged = mergeMasterConfigs(sharedMasterConfig(submittedLocal), sharedMasterConfig(current), accepted).config;
			assertMasterReferences(merged);
			const replacement = { ...current };
			for (const field of SHARED_MASTER_FIELDS) delete replacement[field];
			Object.assign(replacement, merged);
			const encrypted = await this.encryptRecord(replacement);
			const encryptedBase = await this.encryptRecord(accepted);
			checkSession();
			if (await this.compareAndPutRawBatch('master_config', [
				{ key: 'current', expected: raw, replacement: encrypted },
				{ key: 'sync_base', expected: baseRaw, replacement: encryptedBase }
			])) return replacement;
		}
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
		return (await this.putTransactions([transaction]))[0];
	}

	async putTransactions(txList) {
		const records = txList.map(transaction => {
			const updatedAt = transaction.updated_at || new Date().toISOString();
			return {
				...transaction,
				updated_at: updatedAt,
				created_at: transaction.created_at || updatedAt,
				sync_status: transaction.sync_status || 'unsynced'
			};
		});
		const encrypted = await Promise.all(records.map(record => this.encryptRecord(record, {
			id: record.id,
			target_month: record.target_month,
			date: record.date,
			sync_status: record.sync_status,
			is_deleted: record.is_deleted || false
		})));
		await this.putAllRaw('transactions', encrypted);
		return records;
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

	async mergeRemoteTransactions(records) {
		BackupMerger.validateImportData({ transactions: records }, 'transactions');
		let count = 0;
		for (const remote of records) {
			if (!remote.id) throw new Error('Remote transaction ID is missing');
			while (true) {
				const raw = await this.getRaw('transactions', remote.id);
				const local = await this.decryptRecord(raw);
				const localTime = Date.parse(local?.updated_at || '') || 0;
				const remoteTime = Date.parse(remote.updated_at || '') || 0;
				if (local && (localTime > remoteTime || (localTime === remoteTime && local.sync_status === 'unsynced'))) break;
				const candidate = { ...remote, sync_status: 'synced' };
				delete candidate.previous_target_month; delete candidate.reclose_approved_months;
				if (canonicalJsonStringify(local) === canonicalJsonStringify(candidate)) break;
				const encrypted = await this.encryptRecord(candidate, { id: candidate.id, target_month: candidate.target_month, date: candidate.date, sync_status: 'synced', is_deleted: Boolean(candidate.is_deleted) });
				if (await this.compareAndPutRaw('transactions', candidate.id, raw, encrypted)) { count++; break; }
			}
		}
		return count;
	}

	async approveTransactionReclose(submitted, months) {
		const raw = await this.getRaw('transactions', submitted.id);
		const current = await this.decryptRecord(raw);
		if (canonicalJsonStringify(current) !== canonicalJsonStringify(submitted)) return false;
		const approved = { ...current, reclose_approved_months: months };
		const encrypted = await this.encryptRecord(approved, { id: approved.id, target_month: approved.target_month, date: approved.date, sync_status: approved.sync_status, is_deleted: Boolean(approved.is_deleted) });
		return this.compareAndPutRaw('transactions', approved.id, raw, encrypted);
	}

	async markTransactionsSynced(ids, submittedTransactions = null) {
		if (!Array.isArray(ids) || ids.length === 0) return 0;
		const submitted = submittedTransactions ? new Map(submittedTransactions.map(tx => [tx.id, tx])) : null;
		let count = 0;
		for (const id of ids) {
			const raw = await this.getRaw('transactions', id);
			const tx = await this.decryptRecord(raw);
			if (!tx || tx.sync_status !== 'unsynced') continue;
			if (submitted && canonicalJsonStringify(tx) !== canonicalJsonStringify(submitted.get(id))) continue;
			const acknowledged = { ...tx, sync_status: 'synced' };
			delete acknowledged.previous_target_month;
			delete acknowledged.reclose_approved_months;
			const replacement = await this.encryptRecord(acknowledged, {
				id: tx.id,
				target_month: tx.target_month,
				date: tx.date,
				sync_status: acknowledged.sync_status,
				is_deleted: tx.is_deleted || false
			});
			if (await this.compareAndPutRaw('transactions', id, raw, replacement)) count++;
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

	// --- Backup Export / Import (Requirement 3.15 & 3.26) ---
	async exportFullData() {
		const config = await this.getMasterConfig();
		const snapshot = await this.getSnapshot();
		const transactions = await this.getTransactions({ includeDeleted: true });
		return {
			schema_version: 2,
			export_type: 'full_backup',
			exported_at: new Date().toISOString(),
			master_config: config,
			summary_snapshot: snapshot,
			transactions
		};
	}

	async exportTransactionsData() {
		const transactions = await this.getTransactions({ includeDeleted: true });
		return {
			schema_version: 2,
			export_type: 'transactions',
			exported_at: new Date().toISOString(),
			transactions
		};
	}

	async exportMasterConfigData() {
		const config = await this.getMasterConfig();
		return {
			schema_version: 2,
			export_type: 'master_config',
			exported_at: new Date().toISOString(),
			master_config: config
		};
	}

	async exportAnnualBudgetsData() {
		const config = await this.getMasterConfig();
		return {
			schema_version: 2,
			export_type: 'annual_budgets',
			exported_at: new Date().toISOString(),
			annual_budgets: config?.annual_budgets || {}
		};
	}

	async exportSummarySnapshotData() {
		const snapshot = await this.getSnapshot();
		return {
			schema_version: 2,
			export_type: 'summary_snapshot',
			exported_at: new Date().toISOString(),
			summary_snapshot: snapshot
		};
	}

	async importFullData(data) {
		if (!data) {
			throw new Error('Invalid data schema version');
		}
		if (typeof data !== 'object') {
			throw new Error('Invalid data schema or payload');
		}

		if (Array.isArray(data)) {
			data = {
				schema_version: 2,
				export_type: 'transactions',
				transactions: data
			};
		}

		if (data.schema_version !== undefined && data.schema_version !== 2) {
			throw new Error('Invalid data schema version');
		}

		let detectedType = data.export_type || null;
		if (!detectedType) {
			if (data.master_config && data.summary_snapshot && data.transactions) {
				detectedType = 'full_backup';
			} else if (Array.isArray(data.transactions)) {
				detectedType = 'transactions';
			} else if (data.annual_budgets && typeof data.annual_budgets === 'object' && !data.master_config) {
				detectedType = 'annual_budgets';
			} else if (data.master_config && typeof data.master_config === 'object') {
				detectedType = 'master_config';
			} else if (data.summary_snapshot && typeof data.summary_snapshot === 'object') {
				detectedType = 'summary_snapshot';
			} else {
				detectedType = 'unknown';
			}
		}

		BackupMerger.validateImportData(data, detectedType);

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

		// 3. Standalone Annual Budgets Merge (when annual_budgets is provided without master_config)
		if (data.annual_budgets && typeof data.annual_budgets === 'object' && !data.master_config) {
			const localConfig = await this.getMasterConfig() || { ...DEFAULT_MASTER_CONFIG };
			BackupMerger.mergeMasterConfig(localConfig, { annual_budgets: data.annual_budgets }, stats);
			await this.saveMasterConfig(localConfig);
		}

		// 4. Summary Snapshot Non-Destructive Merge
		if (data.summary_snapshot && typeof data.summary_snapshot === 'object') {
			const localSnapshot = await this.getSnapshot() || { ...DEFAULT_SUMMARY_SNAPSHOT };
			BackupMerger.mergeSummarySnapshot(localSnapshot, data.summary_snapshot);
			await this.saveSnapshot(localSnapshot);
		}

		return { success: true, stats, detectedType };
	}

	// --- Advance Unsettled Tracking (Requirement 3.20) ---
	async getUnsettledAdvancePayments() {
		const txs = await this.getTransactions();
		return txs.filter(t =>
			((t.type === 'transfer' && t.to_account_id === 'acc_receivable') || t.type === 'advance_payment') &&
			t.settlement_status !== 'settled'
		);
	}

	// --- Tag Management (Requirement 3.18) ---
	async getUniqueTags() {
		const txs = await this.getTransactions();
		const set = new Set();
		for (const t of txs) {
			if (Array.isArray(t.tags)) {
				for (const tag of t.tags) {
					const clean = String(tag || '').trim();
					if (clean) set.add(clean);
				}
			}
		}
		return Array.from(set).sort((a, b) => a.localeCompare(b, 'ja'));
	}

	// --- Memo Autocomplete History (Requirement 3.19) ---
	async getMemoHistory() {
		const txs = await this.getTransactions();
		// Sort by date ascending so latest transaction for each memo overwrites earlier ones
		txs.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
		const map = {};
		for (const t of txs) {
			const memo = String(t.memo || '').trim();
			if (!memo) continue;
			map[memo] = {
				category_id: t.category_id || null,
				subcategory_id: t.subcategory_id || null,
				actual_category_id: t.actual_category_id || null,
				actual_subcategory_id: t.actual_subcategory_id || null,
				date: t.date
			};
		}
		return map;
	}

	// --- Credit Card Auto Settlement (Requirement 3.21) ---
	async processCreditCardAutoSettlements(todayStr = formatDate(new Date())) {
		const config = await this.getMasterConfig();
		if (!config || !Array.isArray(config.accounts)) return [];

		const creditCards = config.accounts.filter(a =>
			!a.is_archived &&
			a.type === 'credit_card' &&
			a.debit_account_id
		);
		if (creditCards.length === 0) return [];

		const allTxs = await this.getTransactions();
		const generatedSettlements = [];

		for (const card of creditCards) {
			const closingDay = card.closing_day || 15;
			const debitDay = card.debit_day || 10;
			const offset = card.debit_month_offset ?? 1;
			const debitAccountId = card.debit_account_id;

			const currentCycleInfo = calculateCreditCardDebitDate(todayStr, closingDay, debitDay, offset, config.holidays || []);

			// Check past 2 cycles and current cycle
			const prev1 = calculateCreditCardDebitDate(currentCycleInfo.billingPeriodStart, closingDay, debitDay, offset, config.holidays || []);
			const prev2Date = new Date(prev1.billingPeriodStart);
			prev2Date.setDate(prev2Date.getDate() - 1);
			const prev2 = calculateCreditCardDebitDate(formatDate(prev2Date), closingDay, debitDay, offset, config.holidays || []);

			for (const cycleInfo of [prev2, prev1, currentCycleInfo]) {
				if (todayStr < cycleInfo.debitDate) continue;

				// Check duplicate settlement
				const alreadySettled = allTxs.some(t =>
					!t.is_deleted &&
					t.type === 'transfer' &&
					t.to_account_id === card.id &&
					t.auto_settlement_meta?.card_id === card.id &&
					t.auto_settlement_meta?.billing_cycle === cycleInfo.billingCycle
				);
				if (alreadySettled) continue;

				// Sum expenses for that cycle
				const periodExpenses = allTxs.filter(t =>
					!t.is_deleted &&
					t.account_id === card.id &&
					t.type === 'expense' &&
					t.date >= cycleInfo.billingPeriodStart &&
					t.date <= cycleInfo.billingPeriodEnd
				);
				const totalAmount = periodExpenses.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

				if (totalAmount > 0) {
					const settlementTx = createCreditCardSettlementTransaction({
						payingAccountId: debitAccountId,
						creditCardId: card.id,
						amount: totalAmount,
						debitDate: cycleInfo.debitDate,
						billingCycle: cycleInfo.billingCycle,
						todayStr
					});
					await this.putTransaction(settlementTx);
					allTxs.push(settlementTx);
					generatedSettlements.push(settlementTx);
				}
			}
		}

		return generatedSettlements;
	}

	async getTransactionsByGroupId(groupId) {
		return this.getTransactions({ group_id: groupId });
	}

	// --- Installment / Split Transaction Cascading Update (Requirement 3.22) ---
	async updateInstallmentGroup(groupId, updates = {}, amountAdjustment = null, editedTransaction = null) {
		if (!groupId) return 0;
		const all = await this.getTransactions({ group_id: groupId, includeDeleted: true });
		const activeGroupTxs = all.filter(t => !t.is_deleted);
		if (activeGroupTxs.length === 0) return 0;

		const paymentTx = activeGroupTxs.find(t => t.amortization_meta?.is_payment_record);
		const amortTxs = activeGroupTxs.filter(t => !t.amortization_meta?.is_payment_record && t.type === 'expense');

		let newTotal = amountAdjustment?.newTotalAmount;
		if (newTotal === undefined && paymentTx && updates.amount !== undefined) {
			newTotal = updates.amount;
		}
		if (newTotal === undefined && updates.total_amount !== undefined) {
			newTotal = updates.total_amount;
		}

		const cleanMemo = updates.memo !== undefined
			? String(updates.memo).replace(/^(\[(?:前払一括支払|前払分割\s*\d+\/\d+)\]\s*)+/, '')
			: undefined;

		const nowIso = new Date().toISOString();
		const updatedTxs = [];

		if (paymentTx) {
			if (newTotal !== undefined) {
				paymentTx.amount = Math.round(Number(newTotal) || 0);
				paymentTx.tax_meta = null;
				if (paymentTx.amortization_meta) {
					paymentTx.amortization_meta.total_amount = paymentTx.amount;
				}
			}
			if (cleanMemo !== undefined) paymentTx.memo = `[前払一括支払] ${cleanMemo}`;
			if (updates.tags !== undefined) paymentTx.tags = Array.from(new Set([...updates.tags, '前払費用支払']));
			paymentTx.updated_at = nowIso;
			paymentTx.sync_status = 'unsynced';
			updatedTxs.push(paymentTx);
		}

		if (amortTxs.length > 0) {
			const count = amortTxs.length;
			let monthlyBase = null;
			let remainder = 0;
			if (newTotal !== undefined) {
				monthlyBase = Math.floor(newTotal / count);
				remainder = newTotal - (monthlyBase * count);
			}

			// Sort by date/target_month
			amortTxs.sort((a, b) => {
				const da = a.target_month || a.date || '';
				const db = b.target_month || b.date || '';
				return da.localeCompare(db);
			});

			for (let i = 0; i < amortTxs.length; i++) {
				const atx = amortTxs[i];
				if (monthlyBase !== null) {
					atx.amount = i === 0 ? monthlyBase + remainder : monthlyBase;
					atx.tax_meta = null;
					if (atx.amortization_meta) atx.amortization_meta.total_amount = newTotal;
				}
				if (updates.category_id !== undefined) atx.category_id = updates.category_id;
				if (updates.subcategory_id !== undefined) atx.subcategory_id = updates.subcategory_id;
				if (updates.actual_category_id !== undefined) atx.actual_category_id = updates.actual_category_id;
				if (updates.actual_subcategory_id !== undefined) atx.actual_subcategory_id = updates.actual_subcategory_id;
				if (cleanMemo !== undefined) atx.memo = cleanMemo;
				if (updates.tags !== undefined) atx.tags = updates.tags;
				atx.updated_at = nowIso;
				atx.sync_status = 'unsynced';
				updatedTxs.push(atx);
			}
		}

		if (editedTransaction) {
			const target = updatedTxs.find(t => t.id === editedTransaction.id);
			if (target) Object.assign(target, editedTransaction);
		}
		for (const record of updatedTxs) {
			if (newTotal !== undefined && newTotal > 0) record.amount_pending = false;
			if (updates.reclose_approved_months) record.reclose_approved_months = updates.reclose_approved_months;
		}
		await this.putTransactions(updatedTxs);
		return updatedTxs.length;
	}
	async migrateArchivedMaster(source, target, expectedRecords, expectedConfig, approvedMonths) {
		const rawMaster = await this.getRaw('master_config', 'current');
		const config = await this.decryptRecord(rawMaster);
		if (canonicalJsonStringify(config) !== canonicalJsonStringify(expectedConfig)) throw new Error('設定が変更されたため、一覧を更新して再確認する必要がある');
		const rawRecords = await this.getAllRaw('transactions');
		const records = await Promise.all(rawRecords.map(raw => this.decryptRecord(raw)));
		const planned = buildMasterMigration(expectedRecords, config, source, target);
		const current = buildMasterMigration(records, config, source, target);
		const orderedOriginals = (rows, plan) => rows.filter(row => plan.some(item => item.id === row.id)).sort((a, b) => a.id.localeCompare(b.id));
		if (canonicalJsonStringify(orderedOriginals(expectedRecords, planned)) !== canonicalJsonStringify(orderedOriginals(records, current))) throw new Error('対象明細が変更されたため、一覧を更新して再確認する必要がある');
		const timestamp = new Date().toISOString();
		const replacements = current.map(record => ({ ...record, updated_at: timestamp, sync_status: 'unsynced', reclose_approved_months: approvedMonths }));
		const encrypted = await Promise.all(replacements.map(record => this.encryptRecord(record, { id: record.id, target_month: record.target_month, date: record.date, sync_status: record.sync_status, is_deleted: false })));
		if (!await this.compareAndPutMaintenanceBatch(rawMaster, rawRecords, encrypted)) throw new Error('処理中に設定または明細が変更されたため、再確認する必要がある');
		return replacements;
	}

}

