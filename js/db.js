/**
 * Yoseatsume Kakeibo - IndexedDB & Local Storage Manager (Schema v2)
 */

import { encryptObject, decryptObject } from './crypto.js';

export const DB_NAME = 'yose_kakeibo_db';
export const DB_VERSION = 1;

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
  ]
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

/**
 * Lightweight In-Memory fallback store for environments without native IndexedDB
 */
class MemoryDatabase {
  constructor() {
    this.stores = {
      transactions: new Map(),
      master_config: new Map(),
      summary_snapshot: new Map(),
      security_keys: new Map(),
      settings: new Map()
    };
  }

  async get(storeName, key) {
    const val = this.stores[storeName]?.get(key);
    return val !== undefined ? JSON.parse(JSON.stringify(val)) : null;
  }

  async put(storeName, key, value) {
    this.stores[storeName]?.set(key, JSON.parse(JSON.stringify(value)));
    return key;
  }

  async delete(storeName, key) {
    return this.stores[storeName]?.delete(key);
  }

  async getAll(storeName) {
    const store = this.stores[storeName];
    if (!store) return [];
    return Array.from(store.values()).map(v => JSON.parse(JSON.stringify(v)));
  }
}

/**
 * YoseDB Class
 */
export class YoseDB {
  constructor(customIndexedDB = null) {
    this.idb = customIndexedDB || (typeof window !== 'undefined' ? window.indexedDB : null);
    this.db = null;
    this.memoryDb = null;
    this.encryptionKey = null;
  }

  setEncryptionKey(key) {
    this.encryptionKey = key;
  }

  clearEncryptionKey() {
    this.encryptionKey = null;
  }

  isEncrypted() {
    return this.encryptionKey !== null && this.encryptionKey !== undefined;
  }

  async init() {
    if (!this.idb) {
      this.memoryDb = new MemoryDatabase();
      // Initialize defaults
      const existingConfig = await this.memoryDb.get('master_config', 'current');
      if (!existingConfig) {
        await this.memoryDb.put('master_config', 'current', DEFAULT_MASTER_CONFIG);
      }
      const existingSnapshot = await this.memoryDb.get('summary_snapshot', 'current');
      if (!existingSnapshot) {
        await this.memoryDb.put('summary_snapshot', 'current', DEFAULT_SUMMARY_SNAPSHOT);
      }
      return this;
    }

    return new Promise((resolve, reject) => {
      const request = this.idb.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(request.error);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Transactions store
        if (!db.objectStoreNames.contains('transactions')) {
          const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
          txStore.createIndex('target_month', 'target_month', { unique: false });
          txStore.createIndex('date', 'date', { unique: false });
          txStore.createIndex('group_id', 'group_id', { unique: false });
          txStore.createIndex('status', 'status', { unique: false });
          txStore.createIndex('sync_status', 'sync_status', { unique: false });
          txStore.createIndex('type', 'type', { unique: false });
        }

        // Master config store
        if (!db.objectStoreNames.contains('master_config')) {
          db.createObjectStore('master_config');
        }

        // Summary snapshot store
        if (!db.objectStoreNames.contains('summary_snapshot')) {
          db.createObjectStore('summary_snapshot');
        }

        // Security keys store
        if (!db.objectStoreNames.contains('security_keys')) {
          db.createObjectStore('security_keys');
        }

        // App settings store
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };

      request.onsuccess = async () => {
        this.db = request.result;

        try {
          // Initialize defaults if not present
          const currentConfig = await this.getMasterConfig();
          if (!currentConfig || !currentConfig.accounts || currentConfig.accounts.length === 0) {
            await this.saveMasterConfig(DEFAULT_MASTER_CONFIG);
          }

          const currentSnapshot = await this.getSnapshot();
          if (!currentSnapshot || !currentSnapshot.account_balances) {
            await this.saveSnapshot(DEFAULT_SUMMARY_SNAPSHOT);
          }

          resolve(this);
        } catch (err) {
          reject(err);
        }
      };
    });
  }

  // --- Master Config ---
  async getMasterConfig() {
    let raw = null;
    if (this.memoryDb) {
      raw = await this.memoryDb.get('master_config', 'current');
    } else {
      raw = await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['master_config'], 'readonly');
        const req = tx.objectStore('master_config').get('current');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    if (!raw) return null;
    if (raw.encrypted) {
      if (!this.encryptionKey) {
        throw new Error('Database is locked: encryption key not set');
      }
      return await decryptObject({ iv: raw.iv, ciphertext: raw.ciphertext }, this.encryptionKey);
    }
    return raw;
  }

  async saveMasterConfig(config) {
    const updated = {
      ...config,
      updated_at: new Date().toISOString()
    };

    let toStore = updated;
    if (this.encryptionKey) {
      const encrypted = await encryptObject(updated, this.encryptionKey);
      toStore = {
        encrypted: true,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext
      };
    }

    if (this.memoryDb) {
      await this.memoryDb.put('master_config', 'current', toStore);
      return updated;
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['master_config'], 'readwrite');
      const req = tx.objectStore('master_config').put(toStore, 'current');
      req.onsuccess = () => resolve(updated);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Summary Snapshot ---
  async getSnapshot() {
    let raw = null;
    if (this.memoryDb) {
      raw = await this.memoryDb.get('summary_snapshot', 'current');
    } else {
      raw = await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['summary_snapshot'], 'readonly');
        const req = tx.objectStore('summary_snapshot').get('current');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    if (!raw) return null;
    if (raw.encrypted) {
      if (!this.encryptionKey) {
        throw new Error('Database is locked: encryption key not set');
      }
      return await decryptObject({ iv: raw.iv, ciphertext: raw.ciphertext }, this.encryptionKey);
    }
    return raw;
  }

  async saveSnapshot(snapshot) {
    let toStore = snapshot;
    if (this.encryptionKey) {
      const encrypted = await encryptObject(snapshot, this.encryptionKey);
      toStore = {
        encrypted: true,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext
      };
    }

    if (this.memoryDb) {
      await this.memoryDb.put('summary_snapshot', 'current', toStore);
      return snapshot;
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['summary_snapshot'], 'readwrite');
      const req = tx.objectStore('summary_snapshot').put(toStore, 'current');
      req.onsuccess = () => resolve(snapshot);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Transactions ---
  async getTransaction(id) {
    let raw = null;
    if (this.memoryDb) {
      raw = await this.memoryDb.get('transactions', id);
    } else {
      raw = await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['transactions'], 'readonly');
        const req = tx.objectStore('transactions').get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    }

    if (!raw) return null;
    if (raw.encrypted) {
      if (!this.encryptionKey) {
        throw new Error('Database is locked: encryption key not set');
      }
      return await decryptObject({ iv: raw.iv, ciphertext: raw.ciphertext }, this.encryptionKey);
    }
    return raw;
  }

  async saveTransaction(transaction) {
    return await this.putTransaction(transaction);
  }

  async putTransaction(transaction) {
    const record = {
      ...transaction,
      updated_at: new Date().toISOString(),
      sync_status: transaction.sync_status || 'unsynced'
    };
    if (!record.created_at) {
      record.created_at = record.updated_at;
    }

    let toStore = record;
    if (this.encryptionKey) {
      const encrypted = await encryptObject(record, this.encryptionKey);
      toStore = {
        id: record.id,
        encrypted: true,
        iv: encrypted.iv,
        ciphertext: encrypted.ciphertext,
        target_month: record.target_month,
        date: record.date,
        sync_status: record.sync_status,
        is_deleted: record.is_deleted || false
      };
    }

    if (this.memoryDb) {
      await this.memoryDb.put('transactions', toStore.id, toStore);
      return record;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['transactions'], 'readwrite');
      const req = tx.objectStore('transactions').put(toStore);
      req.onsuccess = () => resolve(record);
      req.onerror = () => reject(req.error);
    });
  }

  async putTransactions(txList) {
    const results = [];
    for (const t of txList) {
      const saved = await this.putTransaction(t);
      results.push(saved);
    }
    return results;
  }

  async deleteTransaction(id, soft = true) {
    if (soft) {
      const tx = await this.getTransaction(id);
      if (tx) {
        tx.is_deleted = true;
        tx.updated_at = new Date().toISOString();
        tx.sync_status = 'unsynced';
        return await this.putTransaction(tx);
      }
      return null;
    } else {
      if (this.memoryDb) {
        return await this.memoryDb.delete('transactions', id);
      }
      return new Promise((resolve, reject) => {
        const tx = this.db.transaction(['transactions'], 'readwrite');
        const req = tx.objectStore('transactions').delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      });
    }
  }

  async getTransactions(filter = {}) {
    let all = [];
    if (this.memoryDb) {
      all = await this.memoryDb.getAll('transactions');
    } else {
      all = await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['transactions'], 'readonly');
        const req = tx.objectStore('transactions').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    }

    const decrypted = [];
    for (const item of all) {
      if (item.encrypted) {
        if (!this.encryptionKey) {
          throw new Error('Database is locked: encryption key not set');
        }
        const dec = await decryptObject({ iv: item.iv, ciphertext: item.ciphertext }, this.encryptionKey);
        decrypted.push(dec);
      } else {
        decrypted.push(item);
      }
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
    if (this.memoryDb) {
      return await this.memoryDb.get('security_keys', key);
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['security_keys'], 'readonly');
      const req = tx.objectStore('security_keys').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async saveSecurityKey(key, value) {
    if (this.memoryDb) {
      await this.memoryDb.put('security_keys', key, value);
      return value;
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['security_keys'], 'readwrite');
      const req = tx.objectStore('security_keys').put(value, key);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteSecurityKey(key) {
    if (this.memoryDb) {
      return await this.memoryDb.delete('security_keys', key);
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['security_keys'], 'readwrite');
      const req = tx.objectStore('security_keys').delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // --- Settings ---
  async getSetting(key, defaultValue = null) {
    if (this.memoryDb) {
      const val = await this.memoryDb.get('settings', key);
      return val !== null && val !== undefined ? val : defaultValue;
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['settings'], 'readonly');
      const req = tx.objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result !== undefined ? req.result : defaultValue);
      req.onerror = () => reject(req.error);
    });
  }

  async setSetting(key, value) {
    if (this.memoryDb) {
      await this.memoryDb.put('settings', key, value);
      return value;
    }
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(['settings'], 'readwrite');
      const req = tx.objectStore('settings').put(value, key);
      req.onsuccess = () => resolve(value);
      req.onerror = () => reject(req.error);
    });
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
      transactions: transactions
    };
  }

  async importFullData(data) {
    if (!data || data.schema_version !== 2) {
      throw new Error('Invalid data schema version');
    }
    if (data.master_config) {
      await this.saveMasterConfig(data.master_config);
    }
    if (data.summary_snapshot) {
      await this.saveSnapshot(data.summary_snapshot);
    }
    if (Array.isArray(data.transactions)) {
      for (const tx of data.transactions) {
        await this.putTransaction(tx);
      }
    }
    return true;
  }
}
