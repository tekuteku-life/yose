/**
 * Yoseatsume Kakeibo - High-Level Domain Repository (YoseDB)
 */

import { buildDataMetadata } from '../logic/data_insights.js';
import { buildBulkEdit } from '../logic/bulk_edit.js';
import { dataIntegrity } from '../logic/data_integrity.js';
import { buildMasterMigration } from '../logic/master_maintenance.js';
import { buildAdvanceLink, linkedRepayment } from '../logic/advance_links.js';
import { DEFAULT_MASTER_CONFIG } from './defaults.js';
import { StorageEngine } from './storage_engine.js';
import { BackupMerger } from './backup_merger.js';
import { prepareReplacementData, assertReplacementReferences, IMPORT_CONFIRMATION_WORD } from './backup_replacement.js';
import { formatDate, calculateCreditCardDebitDate } from '../logic/date_utils.js';
import { canonicalJsonStringify } from '../crypto.js';
import { createCreditCardSettlementTransaction } from '../logic/transaction_factory.js';
import { SHARED_MASTER_FIELDS, sharedMasterConfig, mergeMasterConfigs } from '../logic/master_sync.js';

const transactionTimestamp = value => typeof value === 'string' ? Date.parse(value) || 0 : 0;

export class YoseDB extends StorageEngine {
	_replacementPlans = new WeakMap();
	// --- Master Config ---
	async getMasterConfig() {
		const raw = await this.getRaw('master_config', 'current');
		return await this.decryptRecord(raw);
	}

	async decodeBusinessState(raw) {
		const [master_config, summary_snapshot, transactions] = await Promise.all([
			this.decryptRecord(raw.master), this.decryptRecord(raw.snapshot), Promise.all(raw.transactions.map(record => this.decryptRecord(record)))
		]);
		return { master_config, summary_snapshot, transactions };
	}

	async mutateBusiness(build, { allowArchivedReferences = false, strict = false, isSessionValid = null } = {}) {
		const key = this.encryptionKey;
		const valid = () => this.encryptionKey === key && (!isSessionValid || isSessionValid());
		while (true) {
			if (!valid()) throw new Error('認証鍵または処理状態が変更されました。ロック解除後に確認し直してください。');
			const expected = await this.captureImportState();
			const before = await this.decodeBusinessState(expected);
			const { state: after, result } = build(structuredClone(before), before);
			dataIntegrity.assertChange(before, after, { strict, allowArchivedReferences });
			const replacements = {};
			if ((key && !expected.master?.encrypted) || canonicalJsonStringify(before.master_config) !== canonicalJsonStringify(after.master_config)) replacements.master = await this.encryptRecord(after.master_config);
			if ((key && !expected.snapshot?.encrypted) || canonicalJsonStringify(before.summary_snapshot) !== canonicalJsonStringify(after.summary_snapshot)) replacements.snapshot = await this.encryptRecord(after.summary_snapshot);
			if ((key && expected.transactions.some(raw => !raw.encrypted)) || canonicalJsonStringify(before.transactions) !== canonicalJsonStringify(after.transactions)) {
				const old = new Map(before.transactions.map((tx, i) => [tx.id, { tx, raw: expected.transactions[i] }]));
				replacements.transactions = await Promise.all(after.transactions.map(tx => {
					const previous = old.get(tx.id);
					if (previous && (!key || previous.raw.encrypted) && canonicalJsonStringify(previous.tx) === canonicalJsonStringify(tx)) return previous.raw;
					return this.encryptRecord(tx, { id: tx.id, target_month: tx.target_month, date: tx.date, sync_status: tx.sync_status, is_deleted: Boolean(tx.is_deleted) });
				}));
			}
			if (!valid()) throw new Error('暗号化中に認証鍵または処理状態が変更されました。');
			if (await this.replaceImportBatch(expected, replacements, valid)) return result;
		}
	}

	async saveMasterConfig(config, { expectedConfig = null, isSessionValid = null } = {}) {
		const requested = structuredClone(config);
		return this.mutateBusiness(state => {
			let updated = requested;
			if (expectedConfig) {
				const merged = mergeMasterConfigs(expectedConfig, requested, state.master_config);
				if (merged.conflicts.length) throw new Error(`設定が変更され競合しています。再度開いて確認してください: ${merged.conflicts.join('、')}`);
				updated = merged.config;
			}
			state.master_config = { ...updated, updated_at: new Date().toISOString() };
			return { state, result: state.master_config };
		}, { isSessionValid });
	}

	async mutateMasterConfig(mutator) {
		return this.mutateBusiness(state => {
			const result = mutator(state.master_config);
			if (result?.then) throw new Error('設定変更の処理は同期関数で指定してください。');
			if (result !== undefined) {
				if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('設定変更は設定オブジェクトを返す必要があります。');
				state.master_config = result;
			}
			state.master_config.updated_at = new Date().toISOString();
			return { state, result: state.master_config };
		});
	}

	async getMasterSyncBase() {
		return this.decryptRecord(await this.getRaw('master_config', 'sync_base'));
	}

	async hasUnsyncedMasterConfig() {
		const base = await this.getMasterSyncBase() || sharedMasterConfig(DEFAULT_MASTER_CONFIG);
		return canonicalJsonStringify(sharedMasterConfig(await this.getMasterConfig())) !== canonicalJsonStringify(base);
	}

	buildRemoteCandidate(state, submittedLocal, acceptedShared, remoteState = null) {
		if (acceptedShared != null && (typeof acceptedShared !== 'object' || Array.isArray(acceptedShared))) throw new Error('受信設定の形式が不正です。');
		const next = structuredClone(state);
		const accepted = sharedMasterConfig(acceptedShared || state.master_config);
		const merged = mergeMasterConfigs(sharedMasterConfig(submittedLocal || state.master_config), sharedMasterConfig(state.master_config), accepted);
		if (merged.conflicts.length) throw new Error('設定が変更されました。最新の設定を再確認してください。');
		for (const field of SHARED_MASTER_FIELDS) delete next.master_config[field];
		Object.assign(next.master_config, merged.config);
		if (remoteState) {
			const records = [...(remoteState.archived_transactions || []), ...(remoteState.pending_diffs || [])];
			if (new Set(records.map(record => record.id)).size !== records.length) throw new Error('受信明細IDが重複しています。');
			const map = new Map(next.transactions.map(tx => [tx.id, tx]));
			for (const remote of records) {
				const current = map.get(remote.id);
				const localTime = transactionTimestamp(current?.updated_at), remoteTime = transactionTimestamp(remote.updated_at);
				if (current && (localTime > remoteTime || (localTime === remoteTime && current.sync_status === 'unsynced'))) continue;
				const candidate = { ...remote, sync_status: 'synced' };
				delete candidate.previous_target_month; delete candidate.reclose_approved_months;
				map.set(candidate.id, candidate);
			}
			next.transactions = [...map.values()];
			if (Object.hasOwn(remoteState, 'snapshot')) next.summary_snapshot = structuredClone(remoteState.snapshot);
		}
		return next;
	}

	async validateRemoteState(acceptedShared, remoteState, submittedLocal = null) {
		const state = await this.decodeBusinessState(await this.captureImportState());
		const next = this.buildRemoteCandidate(state, submittedLocal, acceptedShared, remoteState);
		dataIntegrity.assertChange(state, next, { allowArchivedReferences: true });
		return next;
	}

	async commitMasterSync(submittedLocal, acceptedShared, { isSessionValid = null, remoteState = null } = {}) {
		const key = this.encryptionKey;
		const valid = () => this.encryptionKey === key && (!isSessionValid || isSessionValid());
		while (true) {
			if (!valid()) throw new Error('認証がロックまたは変更されました。解除後に確認し直してください。');
			const expected = await this.captureImportState();
			const before = await this.decodeBusinessState(expected);
			const next = this.buildRemoteCandidate(before, submittedLocal, acceptedShared, remoteState);
			dataIntegrity.assertChange(before, next, { allowArchivedReferences: true });
			const replacements = { master: await this.encryptRecord(next.master_config), base: await this.encryptRecord(sharedMasterConfig(acceptedShared)) };
			if (remoteState) {
				replacements.snapshot = await this.encryptRecord(next.summary_snapshot);
				const remoteVersion = canonicalJsonStringify({ master_config: remoteState.master_config, snapshot: remoteState.snapshot, pending_diffs: remoteState.pending_diffs, archived_transactions: remoteState.archived_transactions, archive_months: remoteState.archive_months });
				if (replacements.snapshot.encrypted && remoteState.state_version === remoteVersion && Array.isArray(remoteState.archived_transactions) && Array.isArray(remoteState.pending_diffs) && Array.isArray(remoteState.archive_months)) {
					replacements.snapshot.archiveHistoryComplete = true;
					replacements.snapshot.archiveMonths = structuredClone(remoteState.archive_months);
				}
				const old = new Map(before.transactions.map((tx, i) => [tx.id, { tx, raw: expected.transactions[i] }]));
				replacements.transactions = await Promise.all(next.transactions.map(tx => {
					const previous = old.get(tx.id);
					return previous && canonicalJsonStringify(previous.tx) === canonicalJsonStringify(tx) ? previous.raw : this.encryptRecord(tx, { id: tx.id, target_month: tx.target_month, date: tx.date, sync_status: tx.sync_status, is_deleted: Boolean(tx.is_deleted) });
				}));
			}
			if (!valid()) throw new Error('認証がロックまたは変更されました。解除後に確認し直してください。');
			if (await this.replaceImportBatch(expected, replacements, valid)) {
				if (remoteState?.archive_months) await this.setSetting('downloaded_archive_months', remoteState.archive_months);
				return next.master_config;
			}
		}
	}

	// --- Summary Snapshot ---
	async getSnapshot() {
		const raw = await this.getRaw('summary_snapshot', 'current');
		return await this.decryptRecord(raw);
	}

	async saveSnapshot(snapshot) {
		return this.mutateBusiness(state => { state.summary_snapshot = structuredClone(snapshot); return { state, result: snapshot }; }, { allowArchivedReferences: true });
	}

	// --- Transactions ---
	async getTransaction(id) {
		const raw = await this.getRaw('transactions', id);
		return await this.decryptRecord(raw);
	}

	async saveTransaction(transaction) {
		return await this.putTransaction(transaction);
	}

	async putTransaction(transaction, options = {}) {
		return (await this.putTransactions([transaction], options))[0];
	}

	async putTransactions(txList, { expectedTransactions = null, createOnly = false, expectedGroup = null } = {}) {
		const records = txList.map(transaction => {
			const updatedAt = transaction.updated_at || new Date().toISOString();
			return { ...structuredClone(transaction), updated_at: updatedAt, created_at: transaction.created_at || updatedAt, sync_status: transaction.sync_status || 'unsynced' };
		});
		return this.mutateBusiness(state => {
			const map = new Map(state.transactions.map(tx => [tx.id, tx]));
			if (new Set(records.map(tx => tx.id)).size !== records.length) throw new Error('明細IDが重複しています。');
			if (expectedGroup) {
				const ordered = list => [...list].sort((a, b) => a.id.localeCompare(b.id));
				if (canonicalJsonStringify(ordered(state.transactions.filter(tx => tx.group_id === expectedGroup.groupId))) !== canonicalJsonStringify(ordered(expectedGroup.records))) throw new Error('関連明細が変更されました。再確認してください。');
			}
			const expected = new Map((expectedTransactions || []).map(tx => [tx.id, tx]));
			for (const record of records) {
				if (createOnly && map.has(record.id)) throw new Error('同じIDの明細が既に存在します。');
				if (expectedTransactions && canonicalJsonStringify(map.get(record.id)) !== canonicalJsonStringify(expected.get(record.id))) throw new Error('明細が変更されました。再度開いて確認してください。');
				const current = map.get(record.id);
				if (current && typeof record.updated_at === 'string' && Number.isFinite(Date.parse(record.updated_at)) && canonicalJsonStringify(current) !== canonicalJsonStringify(record)) {
					record.updated_at = new Date(Math.max(Date.now(), transactionTimestamp(current.updated_at) + 1, transactionTimestamp(record.updated_at))).toISOString();
				}
				map.set(record.id, record);
			}
			state.transactions = [...map.values()];
			return { state, result: records };
		});
	}

	async deleteTransaction(id, soft = true) {
		const original = await this.getTransaction(id);
		if (!original) return null;
		if (soft) return this.putTransaction({ ...original, is_deleted: true, updated_at: new Date().toISOString(), sync_status: 'unsynced' }, { expectedTransactions: [original] });
		return this.mutateBusiness(state => {
			if (canonicalJsonStringify(state.transactions.find(tx => tx.id === id)) !== canonicalJsonStringify(original)) throw new Error('明細が変更されました。再確認してください。');
			state.transactions = state.transactions.filter(tx => tx.id !== id);
			return { state, result: true };
		}, { allowArchivedReferences: true });
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
		return this.mutateBusiness(state => {
			const next = this.buildRemoteCandidate(state, state.master_config, state.master_config, { pending_diffs: records });
			const current = new Map(state.transactions.map(tx => [tx.id, tx]));
			const count = next.transactions.filter(tx => canonicalJsonStringify(tx) !== canonicalJsonStringify(current.get(tx.id))).length;
			return { state: next, result: count };
		}, { allowArchivedReferences: true });
	}

	async approveTransactionReclose(submitted, months) {
		return this.mutateBusiness(state => {
			const current = state.transactions.find(tx => tx.id === submitted.id);
			if (canonicalJsonStringify(current) !== canonicalJsonStringify(submitted)) return { state, result: false };
			current.reclose_approved_months = months;
			return { state, result: true };
		}, { allowArchivedReferences: true });
	}

	async commitSyncResponse(submitted, response, { isSessionValid = null } = {}) {
		const originals = new Map((Array.isArray(submitted) ? submitted : submitted ? [submitted] : []).map(tx => [tx.id, tx]));
		const ids = new Set(response.accepted_ids || []);
		return this.mutateBusiness(state => {
			let synced = 0;
			for (const tx of state.transactions) {
				if (ids.has(tx.id) && tx.sync_status === 'unsynced' && canonicalJsonStringify(tx) === canonicalJsonStringify(originals.get(tx.id))) {
					tx.sync_status = 'synced'; delete tx.previous_target_month; delete tx.reclose_approved_months; synced++;
				}
			}
			const records = [...(response.conflicts || []), ...(response.transaction ? [response.transaction] : []), ...(response.archived_transactions || []), ...(response.pending_diffs || [])];
			const next = this.buildRemoteCandidate(state, state.master_config, state.master_config, { pending_diffs: records, ...(Object.hasOwn(response, 'snapshot') ? { snapshot: response.snapshot } : {}) });
			const map = new Map(state.transactions.map(tx => [tx.id, tx]));
			const downloaded = next.transactions.filter(tx => canonicalJsonStringify(tx) !== canonicalJsonStringify(map.get(tx.id))).length;
			return { state: next, result: { synced_count: synced, downloaded_count: downloaded } };
		}, { allowArchivedReferences: true, isSessionValid });
	}

	async markTransactionsSynced(ids, submittedTransactions = null) {
		if (!Array.isArray(ids) || ids.length === 0) return 0;
		const originals = submittedTransactions || (await this.getTransactions({ includeDeleted: true })).filter(tx => ids.includes(tx.id));
		return (await this.commitSyncResponse(originals, { accepted_ids: ids })).synced_count;
	}

	// --- Security Keys ---
	async getSecurityKey(key) {
		return await this.getRaw('security_keys', key);
	}

	async saveSecurityKey(key, value, { isSessionValid = () => true } = {}) {
		return await this.putRaw('security_keys', value, key, isSessionValid);
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
		if (!BackupMerger.isValidYearKey(yearStr)) throw new Error('Invalid budget year: must be a 4-digit year');
		const config = await this.mutateMasterConfig(config => {
			if (!config.annual_budgets) config.annual_budgets = {};
			config.annual_budgets[yearStr] = BackupMerger.normalizeBudgetEntry(budget);
		});
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
		if (await this.getPendingImport()) throw new Error('完全インポートが送信待ちです。先に同期してください。');
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
		if (Array.isArray(data.transactions) && new Set(data.transactions.map(tx => tx.id)).size !== data.transactions.length) throw new Error('取込明細IDが重複しています。');

		return this.mutateBusiness(state => {
			const stats = { addedTransactions: 0, updatedTransactions: 0, skippedTransactions: 0, addedAccounts: 0, addedCategories: 0, addedSubcategories: 0, addedRecurringRules: 0, addedHolidays: 0, addedBudgets: 0 };
			const map = new Map(state.transactions.map(tx => [tx.id, tx]));
			for (const imported of data.transactions || []) {
				if (!BackupMerger.isSafeKey(imported.id)) throw new Error('Invalid import data: 明細IDが不正です');
				const current = map.get(imported.id);
				if (current && transactionTimestamp(imported.updated_at) <= transactionTimestamp(current.updated_at)) { stats.skippedTransactions++; continue; }
				const updated = { ...structuredClone(imported), sync_status: 'unsynced', updated_at: imported.updated_at || new Date().toISOString(), created_at: imported.created_at || imported.updated_at || new Date().toISOString() };
				map.set(imported.id, updated);
				if (current) stats.updatedTransactions++; else stats.addedTransactions++;
			}
			state.transactions = [...map.values()];
			if (data.master_config) BackupMerger.mergeMasterConfig(state.master_config, data.master_config, stats);
			else if (data.annual_budgets) BackupMerger.mergeMasterConfig(state.master_config, { annual_budgets: data.annual_budgets }, stats);
			BackupMerger.validateImportData(data, detectedType, state.master_config.categories);
			if (data.summary_snapshot) BackupMerger.mergeSummarySnapshot(state.summary_snapshot, data.summary_snapshot);
			return { state, result: { success: true, stats, detectedType } };
		}, { allowArchivedReferences: true });
	}

	async getAnalyticsState() {
		const key = this.encryptionKey;
		while (true) {
			const before = await this.captureImportState();
			const raw = await this.captureImportState();
			if (key !== this.encryptionKey) throw new Error('認証状態が変更されました。');
			if (canonicalJsonStringify(before) !== canonicalJsonStringify(raw)) continue;
			const state = await this.decodeBusinessState(raw);
			if (key !== this.encryptionKey) throw new Error('認証状態が変更されました。');
			const complete = Boolean(raw.snapshot?.encrypted && raw.snapshot.archiveHistoryComplete === true && Array.isArray(raw.snapshot.archiveMonths));
			return { ...state, historyOptions: { historyComplete: complete, archiveMonths: complete ? raw.snapshot.archiveMonths : [] } };
		}
	}

	async getDataMetadata() {
		return buildDataMetadata(await this.getAnalyticsState());
	}

	async bulkEditTransactions(originals, patch, approvedMonths, { isSessionValid = null } = {}) {
		const expected = structuredClone(originals);
		const changes = structuredClone(patch);
		return this.mutateBusiness(state => {
			for (const original of expected) if (canonicalJsonStringify(state.transactions.find(tx => tx.id === original.id)) !== canonicalJsonStringify(original)) throw new Error('明細が変更されました。開き直して確認してください。');
			const records = buildBulkEdit(expected, changes, state.transactions).map((record, i) => {
				const original = expected[i];
				if (!record.previous_target_month && original.target_month !== record.target_month) record.previous_target_month = original.target_month;
				record.reclose_approved_months = [...new Set([...(original.reclose_approved_months || []), ...approvedMonths])].sort();
				const closed = state.summary_snapshot?.last_closed_month;
				const required = [original.target_month, record.target_month, record.previous_target_month].filter(month => month && closed && month <= closed);
				if (required.some(month => !record.reclose_approved_months.includes(month))) throw new Error('締め済み月の承認が不足しています。最新の締め状態を確認してください。');
				if (record.target_month <= closed && (record.status !== 'confirmed' || record.amount_pending)) throw new Error('締め済み月には金額入力済みの確定明細が必要です。');
				record.updated_at = new Date(Math.max(Date.now(), transactionTimestamp(original.updated_at) + 1)).toISOString();
				record.sync_status = 'unsynced';
				return record;
			});
			const updated = new Map(records.map(record => [record.id, record]));
			state.transactions = state.transactions.map(record => updated.get(record.id) || record);
			return { state, result: records };
		}, { isSessionValid });
	}

	async saveInvestmentObservation(accountId, date, value, expectedValue, { isSessionValid = null } = {}) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('評価記録の日付を確認してください。');
		if (value !== null && !Number.isSafeInteger(value?.acquisition_cost)) throw new Error('保有商品の取得原価を入力してください。');
		const requested = structuredClone(value), expected = structuredClone(expectedValue);
		return this.mutateBusiness(state => {
			const account = state.master_config.accounts.find(a => a.id === accountId);
			if (!account || account.type !== 'investment' || account.is_archived) throw new Error('投資口座が変更されています。口座を確認してください。');
			const current = account.investment_history?.[date] || null;
			if (canonicalJsonStringify(current) !== canonicalJsonStringify(expected)) throw new Error('同日の投資記録が変更されています。日付を選び直して確認してください。');
			account.investment_history ||= {};
			if (requested === null) delete account.investment_history[date];
			else account.investment_history[date] = requested;
			state.master_config.updated_at = new Date().toISOString();
			return { state, result: requested };
		}, { isSessionValid });
	}

	async getPendingImport() {
		return this.decryptRecord(await this.getRaw('master_config', 'pending_import'));
	}

	async captureImportState() {
		const [transactions, master, snapshot, pending, base] = await Promise.all([
			this.getAllRaw('transactions'), this.getRaw('master_config', 'current'), this.getRaw('summary_snapshot', 'current'), this.getRaw('master_config', 'pending_import'), this.getRaw('master_config', 'sync_base')
		]);
		return { transactions, master, snapshot, pending, base };
	}

	async prepareReplacementImport(input, { replacePending = false } = {}) {
		const encryptionKey = this.encryptionKey;
		if (!encryptionKey) throw new Error('データがロックされています。解除してから確認してください。');
		const { data, detectedType } = prepareReplacementData(input);
		const expected = await this.captureImportState();
		if (expected.pending) {
			if (!replacePending) throw new Error('完全インポートが送信待ちです。先に同期するか、送信待ちのやり直しを選択してください。');
			const previous = await this.decryptRecord(expected.pending);
			if (detectedType !== previous.detectedType && detectedType !== 'full_backup') throw new Error('送信待ちと同じ種別、または全データのJSONを選択してください。');
		}
		const currentMaster = await this.decryptRecord(expected.master);
		const currentSnapshot = await this.decryptRecord(expected.snapshot);
		const master = data.master_config || (data.annual_budgets ? { ...currentMaster, annual_budgets: data.annual_budgets } : currentMaster);
		const snapshot = data.summary_snapshot || currentSnapshot;
		const transactions = data.transactions || await Promise.all(expected.transactions.map(raw => this.decryptRecord(raw)));
		assertReplacementReferences(master, transactions, snapshot);
		if (this.encryptionKey !== encryptionKey) throw new Error('確認中に認証鍵が変更されました');
		const content = { id: crypto.randomUUID(), created_at: new Date().toISOString(), data, detectedType, expected, master, snapshot, transactions };
		const plan = { ...content, encryptionKey };
		this._replacementPlans.set(plan, { version: canonicalJsonStringify(content), encryptionKey });
		return plan;
	}

	async commitReplacementImport(plan, { confirmation = '', isSessionValid = () => Boolean(true) } = {}) {
		if (confirmation !== IMPORT_CONFIRMATION_WORD) throw new Error('確認の文字が一致しません');
		const prepared = this._replacementPlans?.get(plan);
		const version = prepared?.version;
		const contentOf = value => ({ id: value.id, created_at: value.created_at, data: value.data, detectedType: value.detectedType, expected: value.expected, master: value.master, snapshot: value.snapshot, transactions: value.transactions });
		const unchanged = () => Boolean(version && canonicalJsonStringify(contentOf(plan)) === version);
		if (!unchanged()) throw new Error('確認内容が変更されました。ファイルを選択して確認し直してください。');
		const encryptionKey = prepared.encryptionKey;
		const valid = () => Boolean(encryptionKey && plan.encryptionKey === encryptionKey && this.encryptionKey === encryptionKey && isSessionValid());
		if (!valid()) throw new Error('認証または同期状態が変更されました');
		const content = structuredClone(contentOf(plan));
		const { data, detectedType } = prepareReplacementData(content.data);
		if (detectedType !== content.detectedType) throw new Error('確認した取込種別が変更されました');
		assertReplacementReferences(content.master, content.transactions, content.snapshot);
		const replacements = {};
		if (data.transactions) {
			const now = new Date(content.transactions.reduce((latest, tx) => Math.max(latest, transactionTimestamp(tx.updated_at)), Date.now()) + 1).toISOString();
			data.transactions = data.transactions.map(tx => {
				const next = { ...tx, created_at: tx.created_at || now, updated_at: now, sync_status: 'unsynced' };
				delete next.previous_target_month;
				delete next.reclose_approved_months;
				return next;
			});
			replacements.transactions = await Promise.all(data.transactions.map(tx => this.encryptRecord(tx, { id: tx.id, target_month: tx.target_month, date: tx.date, sync_status: tx.sync_status, is_deleted: Boolean(tx.is_deleted) })));
		}
		if (data.master_config || data.annual_budgets) replacements.master = await this.encryptRecord(content.master);
		if (data.summary_snapshot || data.transactions) replacements.snapshot = await this.encryptRecord(content.snapshot);
		const pendingData = structuredClone(data);
		if (pendingData.master_config) pendingData.master_config = sharedMasterConfig(pendingData.master_config);
		const pending = { id: content.id, created_at: content.created_at, detectedType, data: pendingData };
		replacements.pending = await this.encryptRecord(pending);
		if (!valid()) throw new Error('暗号化中に認証または同期状態が変更されました');
		if (!unchanged()) throw new Error('暗号化中に確認内容が変更されました。確認し直してください。');
		if (!await this.replaceImportBatch(content.expected, replacements, valid)) throw new Error('確認中にデータが変更されました。ファイルを選択して確認し直してください。');
		this._replacementPlans.delete(plan);
		return { success: true, detectedType, transactionCount: data.transactions?.length || 0 };
	}

	async updatePendingImport(submitted, replacement, { isSessionValid = () => Boolean(true) } = {}) {
		const encryptionKey = this.encryptionKey;
		if (!encryptionKey) throw new Error('データがロックされています');
		const expected = await this.captureImportState();
		if (canonicalJsonStringify(await this.decryptRecord(expected.pending)) !== canonicalJsonStringify(submitted)) return false;
		if (replacement.id !== submitted.id || canonicalJsonStringify(replacement.data) !== canonicalJsonStringify(submitted.data)) throw new Error('送信待ちデータの変更はできません');
		const pending = await this.encryptRecord(replacement);
		const valid = () => this.encryptionKey === encryptionKey && isSessionValid();
		if (!valid()) throw new Error('認証鍵が変更されました');
		return this.replaceImportBatch(expected, { pending }, valid);
	}

	async acknowledgePendingImport(submitted, acceptedMaster = undefined, { isSessionValid = () => Boolean(true), importedAt = null, importedSnapshot = undefined } = {}) {
		const encryptionKey = this.encryptionKey;
		if (!encryptionKey) throw new Error('データがロックされています');
		if (importedAt !== null && (typeof importedAt !== 'string' || !Number.isFinite(Date.parse(importedAt)))) throw new Error('完全インポートの確定日時が不正です');
		const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
		if (acceptedMaster !== undefined && !object(acceptedMaster)) throw new Error('完全インポートの設定マスタ応答が不正です');
		if (importedSnapshot !== undefined && !object(importedSnapshot)) throw new Error('完全インポートの集計 snapshot 応答が不正です');
		const submission = structuredClone(submitted);
		const accepted = acceptedMaster === undefined ? undefined : sharedMasterConfig(structuredClone(acceptedMaster));
		const snapshot = importedSnapshot === undefined ? undefined : structuredClone(importedSnapshot);
		const expected = await this.captureImportState();
		if (canonicalJsonStringify(await this.decryptRecord(expected.pending)) !== canonicalJsonStringify(submission)) return false;
		prepareReplacementData(submission.data);
		const state = await this.decodeBusinessState(expected);
		if (accepted !== undefined) assertReplacementReferences(accepted, submission.data.transactions || [], snapshot === undefined ? submission.data.summary_snapshot || {} : snapshot);
		const next = structuredClone(state);
		const replacements = { pending: null };
		if (snapshot !== undefined) next.summary_snapshot = snapshot;
		if (submission.data.transactions) {
			const sent = new Map(submission.data.transactions.map(tx => [tx.id, tx]));
			for (const current of next.transactions) {
				const submittedTransaction = sent.get(current.id);
				if (!submittedTransaction) continue;
				const matches = canonicalJsonStringify(current) === canonicalJsonStringify(submittedTransaction);
				if (!matches && !importedAt) continue;
				current.updated_at = importedAt ? (matches ? importedAt : new Date(Math.max(transactionTimestamp(current.updated_at), Date.parse(importedAt) + 1)).toISOString()) : current.updated_at;
				current.sync_status = matches ? 'synced' : 'unsynced';
			}
		}
		dataIntegrity.assertChange(state, next, { allowArchivedReferences: true });
		if (snapshot !== undefined) replacements.snapshot = await this.encryptRecord(next.summary_snapshot);
		if (submission.data.transactions) {
			const originals = new Map(state.transactions.map((tx, index) => [tx.id, { tx, raw: expected.transactions[index] }]));
			replacements.transactions = await Promise.all(next.transactions.map(tx => {
				const original = originals.get(tx.id);
				if (canonicalJsonStringify(original.tx) === canonicalJsonStringify(tx)) return original.raw;
				return this.encryptRecord(tx, { id: tx.id, target_month: tx.target_month, date: tx.date, sync_status: tx.sync_status, is_deleted: Boolean(tx.is_deleted) });
			}));
		}
		if (accepted !== undefined && ['full_backup', 'master_config', 'annual_budgets'].includes(submission.detectedType)) replacements.base = await this.encryptRecord(accepted);
		const valid = () => this.encryptionKey === encryptionKey && isSessionValid();
		if (!valid()) throw new Error('認証鍵が変更されました');
		return this.replaceImportBatch(expected, replacements, valid);
	}

	// --- Advance Unsettled Tracking (Requirement 3.20) ---
	async linkAdvanceRepayment(source, repayment, { approvedMonths = [], create = false } = {}) {
		return this.mutateBusiness(state => {
			const current = new Map(state.transactions.map(tx => [tx.id, tx]));
			if (canonicalJsonStringify(current.get(source.id)) !== canonicalJsonStringify(source)
				|| (create ? current.has(repayment.id) : canonicalJsonStringify(current.get(repayment.id)) !== canonicalJsonStringify(repayment))) throw new Error('対象明細が変更されました。開き直して確認してください。');
			if (create && source.settlement_status === 'settled') throw new Error('対象の立替明細は精算済みです。');
			const candidates = create ? [...state.transactions, repayment] : state.transactions;
			const changed = buildAdvanceLink(source, repayment, candidates, state.master_config, approvedMonths);
			for (const tx of changed) {
				tx.updated_at = new Date(Math.max(Date.now(), transactionTimestamp(tx.updated_at) + 1)).toISOString(); tx.sync_status = 'unsynced';
				current.set(tx.id, tx);
			}
			state.transactions = [...current.values()];
			return { state, result: changed };
		});
	}

	async unlinkAdvanceRepayment(repayment, { approvedMonths = [] } = {}) {
		return this.mutateBusiness(state => {
			const current = state.transactions.find(tx => tx.id === repayment.id);
			if (!current || current.is_deleted || !current.advance_source_id || canonicalJsonStringify(current) !== canonicalJsonStringify(repayment)) throw new Error('ひも付け明細が変更されました。開き直して確認してください。');
			delete current.advance_source_id;
			current.updated_at = new Date(Math.max(Date.now(), transactionTimestamp(current.updated_at) + 1)).toISOString();
			current.sync_status = 'unsynced'; current.reclose_approved_months = approvedMonths;
			return { state, result: [current] };
		});
	}

	async getUnsettledAdvancePayments() {
		const txs = await this.getTransactions();
		return txs.filter(t =>
			((t.type === 'transfer' && t.to_account_id === 'acc_receivable') || t.type === 'advance_payment') &&
			t.settlement_status !== 'settled' && !linkedRepayment(t.id, txs)
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
		return this.mutateBusiness(state => {
			const config = state.master_config;
			if (!config || !Array.isArray(config.accounts)) return { state, result: [] };

			const creditCards = config.accounts.filter(a =>
				!a.is_archived &&
				a.type === 'credit_card' &&
				a.debit_account_id && config.accounts.some(paying => paying.id === a.debit_account_id && !paying.is_archived && ['bank', 'cash', 'asset'].includes(paying.type))
			);
			if (creditCards.length === 0) return { state, result: [] };

			const allTxs = state.transactions.filter(tx => !tx.is_deleted);
			const generatedSettlements = [];

			for (const card of creditCards) {
				const closingDay = card.closing_day || 15;
				const debitDay = card.debit_day || 10;
				const offset = card.debit_month_offset ?? 1;
				const debitAccountId = card.debit_account_id;

				const currentCycleInfo = calculateCreditCardDebitDate(todayStr, closingDay, debitDay, offset, config.holidays || []);

				// Check past 2 cycles and current cycle
				const prev1Date = new Date(currentCycleInfo.billingPeriodStart);
				prev1Date.setDate(prev1Date.getDate() - 1);
				const prev1 = calculateCreditCardDebitDate(formatDate(prev1Date), closingDay, debitDay, offset, config.holidays || []);
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
						t.status === 'confirmed' && !t.amount_pending &&
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
						if (state.transactions.some(tx => tx.id === settlementTx.id)) continue;
						state.transactions.push(settlementTx);
						allTxs.push(settlementTx);
						generatedSettlements.push(settlementTx);
					}
				}
			}

			return { state, result: generatedSettlements };
		});
	}

	async getTransactionsByGroupId(groupId) {
		return this.getTransactions({ group_id: groupId });
	}

	// --- Installment / Split Transaction Cascading Update (Requirement 3.22) ---
	async updateInstallmentGroup(groupId, updates = {}, amountAdjustment = null, editedTransaction = null, { expectedTransactions = null } = {}) {
		if (!groupId) return 0;
		const all = await this.getTransactions({ group_id: groupId, includeDeleted: true });
		const activeGroupTxs = structuredClone(all).filter(t => !t.is_deleted);
		if (activeGroupTxs.length === 0) return 0;
		const roleProblems = dataIntegrity.issues({ master_config: await this.getMasterConfig(), transactions: activeGroupTxs, summary_snapshot: {} }).filter(issue => issue.code === 'amortization' || issue.path.includes('.amortization_meta'));
		if (roleProblems.length) throw new Error(`前払グループの補助情報が不正です。確認して修復してください: ${roleProblems.map(issue => issue.message).join(' / ')}`);

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
			if (newTotal !== undefined && newTotal >= 0) record.amount_pending = false;
			if (updates.reclose_approved_months) record.reclose_approved_months = updates.reclose_approved_months;
		}
		await this.putTransactions(updatedTxs, { expectedTransactions: expectedTransactions || all, expectedGroup: { groupId, records: expectedTransactions || all } });
		return updatedTxs.length;
	}
	async migrateArchivedMaster(source, target, expectedRecords, expectedConfig, approvedMonths) {
		return this.mutateBusiness(state => {
			const config = state.master_config, records = state.transactions;
			if (canonicalJsonStringify(config) !== canonicalJsonStringify(expectedConfig)) throw new Error('設定が変更されたため、一覧を更新して再確認してください。');
			const planned = buildMasterMigration(expectedRecords, config, source, target);
			const current = buildMasterMigration(records, config, source, target);
			const orderedOriginals = (rows, plan) => rows.filter(row => plan.some(item => item.id === row.id)).sort((a, b) => a.id.localeCompare(b.id));
			if (canonicalJsonStringify(orderedOriginals(expectedRecords, planned)) !== canonicalJsonStringify(orderedOriginals(records, current))) throw new Error('対象明細が変更されたため、一覧を更新して再確認してください。');
			const timestamp = new Date().toISOString();
			const replacements = current.map(record => ({ ...record, updated_at: timestamp, sync_status: 'unsynced', reclose_approved_months: approvedMonths }));
			state.transactions = records.map(record => replacements.find(item => item.id === record.id) || record);
			return { state, result: replacements };
		});
	}

}

