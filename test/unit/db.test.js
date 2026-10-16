import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB, DEFAULT_MASTER_CONFIG, DEFAULT_SUMMARY_SNAPSHOT } from '../../js/db.js';

describe('js/db.js - Unit Tests', () => {
  let db;

  beforeEach(async () => {
    db = new YoseDB(null); // null uses MemoryDatabase fallback in Node
    await db.init();
  });

  describe('Initialization & Defaults', () => {
    it('initializes with default master config and summary snapshot', async () => {
      const config = await db.getMasterConfig();
      assert.ok(config);
      assert.equal(config.schema_version, 2);
      assert.equal(config.accounts.length, 6); // Includes acc_point

      const snapshot = await db.getSnapshot();
      assert.ok(snapshot);
      assert.equal(snapshot.schema_version, 2);
      assert.equal(snapshot.last_closed_month, '2026-09');
    });

    it('saves and retrieves updated master config', async () => {
      const config = await db.getMasterConfig();
      config.accounts.push({
        id: 'acc_paypay',
        name: 'PayPay',
        type: 'electronic_money',
        initial_balance: 5000,
        is_asset: true,
        sort_order: 7,
        is_archived: false
      });
      await db.saveMasterConfig(config);

      const retrieved = await db.getMasterConfig();
      assert.equal(retrieved.accounts.length, 7);
      assert.ok(retrieved.accounts.some(a => a.id === 'acc_paypay'));
    });

    it('saves and retrieves updated summary snapshot', async () => {
      const snapshot = await db.getSnapshot();
      snapshot.last_closed_month = '2026-10';
      snapshot.account_balances.acc_wallet = 20000;
      await db.saveSnapshot(snapshot);

      const retrieved = await db.getSnapshot();
      assert.equal(retrieved.last_closed_month, '2026-10');
      assert.equal(retrieved.account_balances.acc_wallet, 20000);
    });
  });

  describe('Transactions CRUD and Filtering', () => {
    it('creates, reads, updates, and soft-deletes a transaction', async () => {
      const tx = {
        id: 'tx_test_1',
        group_id: 'grp_1',
        date: '2026-10-16',
        target_month: '2026-10',
        status: 'confirmed',
        type: 'expense',
        amount: 3500,
        account_id: 'acc_wallet',
        memo: 'ランチ',
        tags: ['食事'],
        is_deleted: false
      };

      // Create
      const saved = await db.putTransaction(tx);
      assert.equal(saved.id, 'tx_test_1');
      assert.equal(saved.sync_status, 'unsynced');
      assert.ok(saved.created_at);
      assert.ok(saved.updated_at);

      // Read
      const retrieved = await db.getTransaction('tx_test_1');
      assert.equal(retrieved.amount, 3500);

      // Update
      retrieved.amount = 4000;
      await db.putTransaction(retrieved);
      const updated = await db.getTransaction('tx_test_1');
      assert.equal(updated.amount, 4000);

      // Soft delete
      await db.deleteTransaction('tx_test_1', true);
      const afterDelete = await db.getTransaction('tx_test_1');
      assert.equal(afterDelete.is_deleted, true);
      assert.equal(afterDelete.sync_status, 'unsynced');

      // Normal query excludes deleted
      const activeList = await db.getTransactions();
      assert.equal(activeList.length, 0);

      // Query with includeDeleted: true includes deleted
      const allList = await db.getTransactions({ includeDeleted: true });
      assert.equal(allList.length, 1);

      // Hard delete
      await db.deleteTransaction('tx_test_1', false);
      const hardDeleted = await db.getTransaction('tx_test_1');
      assert.equal(hardDeleted, null);

      // Soft delete non-existent
      const nonExistent = await db.deleteTransaction('not_found', true);
      assert.equal(nonExistent, null);
    });

    it('filters transactions by month, status, group, type, and account', async () => {
      const txs = [
        {
          id: 'tx_oct_1',
          group_id: 'grp_A',
          date: '2026-10-01',
          target_month: '2026-10',
          status: 'confirmed',
          type: 'expense',
          amount: 1000,
          account_id: 'acc_wallet',
          is_deleted: false
        },
        {
          id: 'tx_oct_2',
          group_id: 'grp_A',
          date: '2026-10-02',
          target_month: '2026-10',
          status: 'planned',
          type: 'expense',
          amount: 2000,
          account_id: 'acc_card_a',
          is_deleted: false
        },
        {
          id: 'tx_nov_1',
          group_id: 'grp_B',
          date: '2026-11-01',
          target_month: '2026-11',
          status: 'planned',
          type: 'transfer',
          amount: 5000,
          account_id: 'acc_bank_main',
          to_account_id: 'acc_card_a',
          is_deleted: false
        }
      ];

      await db.putTransactions(txs);

      // Month filter
      const octTxs = await db.getTransactions({ target_month: '2026-10' });
      assert.equal(octTxs.length, 2);

      // Status filter
      const plannedTxs = await db.getTransactions({ status: 'planned' });
      assert.equal(plannedTxs.length, 2);

      // Group filter
      const grpATxs = await db.getTransactions({ group_id: 'grp_A' });
      assert.equal(grpATxs.length, 2);

      // Type filter
      const transferTxs = await db.getTransactions({ type: 'transfer' });
      assert.equal(transferTxs.length, 1);

      // Account filter (matches account_id or to_account_id)
      const cardTxs = await db.getTransactions({ account_id: 'acc_card_a' });
      assert.equal(cardTxs.length, 2); // tx_oct_2 and tx_nov_1
    });

    it('tracks unsynced transactions and marks them synced', async () => {
      await db.putTransactions([
        { id: 'tx_s1', target_month: '2026-10', amount: 100, is_deleted: false },
        { id: 'tx_s2', target_month: '2026-10', amount: 200, is_deleted: false }
      ]);

      const unsyncedBefore = await db.getUnsyncedTransactions();
      assert.equal(unsyncedBefore.length, 2);

      const count = await db.markTransactionsSynced(['tx_s1']);
      assert.equal(count, 1);

      const txS1 = await db.getTransaction('tx_s1');
      assert.equal(txS1.sync_status, 'synced');

      const unsyncedAfter = await db.getUnsyncedTransactions();
      assert.equal(unsyncedAfter.length, 1);
      assert.equal(unsyncedAfter[0].id, 'tx_s2');
    });
  });

  describe('Security Keys and Settings', () => {
    it('stores and retrieves security keys', async () => {
      await db.saveSecurityKey('test_key', { a: 1, b: 'two' });
      const val = await db.getSecurityKey('test_key');
      assert.deepEqual(val, { a: 1, b: 'two' });

      const nonExistent = await db.getSecurityKey('non_existent');
      assert.equal(nonExistent, null);

      await db.deleteSecurityKey('test_key');
      const afterDelete = await db.getSecurityKey('test_key');
      assert.equal(afterDelete, null);
    });

    it('stores and retrieves app settings with default fallback', async () => {
      const defaultVal = await db.getSetting('gas_url', 'http://default.url');
      assert.equal(defaultVal, 'http://default.url');

      await db.setSetting('gas_url', 'https://script.google.com/macros/s/xyz/exec');
      const savedVal = await db.getSetting('gas_url');
      assert.equal(savedVal, 'https://script.google.com/macros/s/xyz/exec');
    });
  });

  describe('Backup Export and Import', () => {
    it('exports complete database to JSON backup', async () => {
      await db.putTransaction({
        id: 'tx_backup_1',
        target_month: '2026-10',
        amount: 1500,
        is_deleted: false
      });

      const backup = await db.exportFullData();
      assert.equal(backup.schema_version, 2);
      assert.ok(backup.exported_at);
      assert.ok(backup.master_config);
      assert.ok(backup.summary_snapshot);
      assert.equal(backup.transactions.length, 1);
      assert.equal(backup.transactions[0].id, 'tx_backup_1');
    });

    it('imports backup into database and rejects invalid schema version', async () => {
      const backupData = {
        schema_version: 2,
        exported_at: new Date().toISOString(),
        master_config: {
          schema_version: 2,
          accounts: [{ id: 'acc_imported', name: 'Imported Bank', is_archived: false }]
        },
        summary_snapshot: {
          schema_version: 2,
          last_closed_month: '2026-08',
          account_balances: { acc_imported: 50000 }
        },
        transactions: [
          { id: 'tx_imp_1', target_month: '2026-09', amount: 500, is_deleted: false }
        ]
      };

      const success = await db.importFullData(backupData);
      assert.equal(success, true);

      const cfg = await db.getMasterConfig();
      assert.equal(cfg.accounts[0].id, 'acc_imported');

      const tx = await db.getTransaction('tx_imp_1');
      assert.equal(tx.amount, 500);

      // Rejects schema_version 1
      await assert.rejects(
        async () => {
          await db.importFullData({ schema_version: 1 });
        },
        /Invalid data schema version/
      );
    });
  });

  describe('IndexedDB Browser Engine Path', () => {
    it('initializes and executes operations via native indexedDB interface', async () => {
      const { createMockIndexedDB } = await import('../helpers/idb_mock.js');
      const mockIDB = createMockIndexedDB();
      const idbDb = new YoseDB(mockIDB);
      await idbDb.init();

      // Master config
      const cfg = await idbDb.getMasterConfig();
      assert.ok(cfg);
      cfg.accounts[0].name = 'Renamed Wallet';
      await idbDb.saveMasterConfig(cfg);
      const updatedCfg = await idbDb.getMasterConfig();
      assert.equal(updatedCfg.accounts[0].name, 'Renamed Wallet');

      // Snapshot
      const snap = await idbDb.getSnapshot();
      assert.ok(snap);
      snap.last_closed_month = '2026-10';
      await idbDb.saveSnapshot(snap);
      const updatedSnap = await idbDb.getSnapshot();
      assert.equal(updatedSnap.last_closed_month, '2026-10');

      // Transactions
      const tx = {
        id: 'tx_idb_1',
        date: '2026-10-16',
        target_month: '2026-10',
        amount: 3000,
        type: 'expense',
        is_deleted: false
      };
      await idbDb.putTransaction(tx);
      const fetchedTx = await idbDb.getTransaction('tx_idb_1');
      assert.equal(fetchedTx.amount, 3000);

      const allTxs = await idbDb.getTransactions({ target_month: '2026-10' });
      assert.equal(allTxs.length, 1);

      // Delete
      await idbDb.deleteTransaction('tx_idb_1', false);
      const afterDel = await idbDb.getTransaction('tx_idb_1');
      assert.equal(afterDel, null);

      // Security key
      await idbDb.saveSecurityKey('key1', 'val1');
      const kVal = await idbDb.getSecurityKey('key1');
      assert.equal(kVal, 'val1');

      // Setting
      await idbDb.setSetting('theme', 'dark');
      const sVal = await idbDb.getSetting('theme');
      assert.equal(sVal, 'dark');
    });
  });
});
