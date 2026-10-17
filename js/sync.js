/**
 * Yoseatsume Kakeibo - GAS Synchronization Client
 */

import { createSignedRequest } from './crypto.js';

export class SyncManager {
  /**
   * @param {object} options
   * @param {import('./db.js').YoseDB} options.db
   * @param {CryptoKey} [options.privateKey]
   * @param {string} [options.gasUrl]
   * @param {Function} [options.customFetch]
   */
  constructor({ db, privateKey = null, gasUrl = '', customFetch = null } = {}) {
    this.db = db;
    this.privateKey = privateKey;
    this.gasUrl = gasUrl;
    this.fetch = customFetch || (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : null);
    this.isSyncing = false;
    this.lastSyncedAt = null;
    this.lastError = null;
    this._listenersAttached = false;
    this._onOnlineBound = null;
    this._onVisibilityBound = null;
  }

  setPrivateKey(key) {
    this.privateKey = key;
  }

  setGasUrl(url) {
    this.gasUrl = url;
  }

  attachEventListeners() {
    if (this._listenersAttached || typeof window === 'undefined') return;

    this._onOnlineBound = () => {
      this.syncPendingDiffs().catch(err => {
        console.warn('Online auto-sync failed:', err);
      });
    };

    this._onVisibilityBound = () => {
      if (document.visibilityState === 'hidden') {
        this.syncPendingDiffs({ keepalive: true }).catch(err => {
          console.warn('Visibilitychange sync failed:', err);
        });
      }
    };

    window.addEventListener('online', this._onOnlineBound);
    document.addEventListener('visibilitychange', this._onVisibilityBound);
    this._listenersAttached = true;
  }

  detachEventListeners() {
    if (!this._listenersAttached || typeof window === 'undefined') return;
    if (this._onOnlineBound) window.removeEventListener('online', this._onOnlineBound);
    if (this._onVisibilityBound) document.removeEventListener('visibilitychange', this._onVisibilityBound);
    this._listenersAttached = false;
  }

  /**
   * Send signed request to GAS Web App
   */
  async sendRequest(action, payload, { keepalive = false } = {}) {
    if (!this.gasUrl) {
      throw new Error('GAS Web App URL is not configured');
    }
    if (!this.privateKey) {
      throw new Error('Ed25519 Private Key is not loaded or unlocked');
    }
    if (!this.fetch) {
      throw new Error('Fetch API is not available');
    }

    const envelope = await createSignedRequest(action, payload, this.privateKey);

    const res = await this.fetch(this.gasUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8'
      },
      body: JSON.stringify(envelope),
      keepalive: keepalive
    });

    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`Invalid JSON response from server: ${text}`);
    }

    if (!data.success) {
      throw new Error(data.error || 'Server returned failure response');
    }

    return data;
  }

  async sendAction(action, payload, options) {
    return this.sendRequest(action, payload, options);
  }

  /**
   * Push all unsynced transactions (pending diffs) to GAS
   */
  async syncPendingDiffs({ keepalive = false } = {}) {
    if (this.isSyncing) return { status: 'already_syncing' };

    const unsynced = await this.db.getUnsyncedTransactions();
    if (!unsynced || unsynced.length === 0) {
      return { status: 'up_to_date', synced_count: 0 };
    }

    this.isSyncing = true;
    this.lastError = null;

    try {
      const response = await this.sendRequest('push_diff', {
        transactions: unsynced
      }, { keepalive });

      // Mark local transactions as synced
      const syncedIds = unsynced.map(t => t.id);
      await this.db.markTransactionsSynced(syncedIds);

      // If server returned updated snapshot, save it
      if (response.snapshot) {
        await this.db.saveSnapshot(response.snapshot);
      }

      this.lastSyncedAt = new Date().toISOString();
      return {
        status: 'synced',
        synced_count: syncedIds.length,
        response: response
      };
    } catch (err) {
      this.lastError = err.message;
      throw err;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Request Month Closing
   */
  async closeMonth(targetMonth) {
    if (this.isSyncing) {
      throw new Error('Another sync operation is in progress');
    }

    // Ensure all local transactions for targetMonth and before are pushed first
    await this.syncPendingDiffs();

    this.isSyncing = true;
    this.lastError = null;

    try {
      const response = await this.sendRequest('close_month', {
        target_month: targetMonth
      });

      if (response.snapshot) {
        await this.db.saveSnapshot(response.snapshot);
      }

      this.lastSyncedAt = new Date().toISOString();
      return response;
    } catch (err) {
      this.lastError = err.message;
      throw err;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Send retroactive update for a past closed month
   */
  async sendRetroactiveUpdate(transaction) {
    if (this.isSyncing) {
      throw new Error('Another sync operation is in progress');
    }
    this.isSyncing = true;
    this.lastError = null;

    try {
      // First save locally
      await this.db.putTransaction(transaction);

      const response = await this.sendRequest('retroactive_update', {
        transaction: transaction
      });

      // Mark transaction as synced
      await this.db.markTransactionsSynced([transaction.id]);

      // Update local snapshot with newly cascaded snapshot from server
      if (response.snapshot) {
        await this.db.saveSnapshot(response.snapshot);
      }

      this.lastSyncedAt = new Date().toISOString();
      return response;
    } catch (err) {
      this.lastError = err.message;
      throw err;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Fetch current remote state (master_config, snapshot, pending_diffs)
   */
  async fetchRemoteState() {
    if (this.isSyncing) {
      throw new Error('Another sync operation is in progress');
    }
    this.isSyncing = true;
    try {
      const response = await this.sendRequest('fetch_state', {});
      if (response.master_config) {
        await this.db.saveMasterConfig(response.master_config);
      }
      if (response.snapshot) {
        await this.db.saveSnapshot(response.snapshot);
      }
      if (Array.isArray(response.pending_diffs)) {
        for (const tx of response.pending_diffs) {
          tx.sync_status = 'synced';
          await this.db.putTransaction(tx);
        }
      }
      return response;
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Register initial public key to GAS backend (Write-Once setup)
   * @param {string} publicKeyBase64
   */
  async registerInitialKey(publicKeyBase64) {
    if (this.isSyncing) {
      throw new Error('Another sync operation is in progress');
    }
    this.isSyncing = true;
    try {
      const response = await this.sendRequest('register_initial_key', {
        publicKey: publicKeyBase64
      });
      return response;
    } catch (err) {
      this.lastError = err.message;
      throw err;
    } finally {
      this.isSyncing = false;
    }
  }
}

