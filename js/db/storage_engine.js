/**
 * Yoseatsume Kakeibo - Low-Level Storage Engine & AES-GCM-256 At-Rest Wrapper
 */

import { encryptObject, decryptObject } from '../crypto.js';
import {
	DB_NAME,
	DB_VERSION,
	DEFAULT_MASTER_CONFIG,
	DEFAULT_SUMMARY_SNAPSHOT
} from './defaults.js';

/**
 * Lightweight In-Memory fallback store for environments without native IndexedDB
 */
export class MemoryDatabase {
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
		return Boolean(this.stores[storeName]?.delete(key));
	}

	async getAll(storeName) {
		const store = this.stores[storeName];
		if (!store) return [];
		return Array.from(store.values()).map(v => JSON.parse(JSON.stringify(v)));
	}
}

/**
 * Base Storage Engine abstracting IndexedDB, MemoryDatabase, and AES-GCM-256 encryption
 */
export class StorageEngine {
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

			request.onerror = () => reject(request.error);

			request.onupgradeneeded = (event) => {
				const db = event.target.result;

				if (!db.objectStoreNames.contains('transactions')) {
					const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
					txStore.createIndex('target_month', 'target_month', { unique: false });
					txStore.createIndex('date', 'date', { unique: false });
					txStore.createIndex('group_id', 'group_id', { unique: false });
					txStore.createIndex('status', 'status', { unique: false });
					txStore.createIndex('sync_status', 'sync_status', { unique: false });
					txStore.createIndex('type', 'type', { unique: false });
				}

				for (const storeName of ['master_config', 'summary_snapshot', 'security_keys', 'settings']) {
					if (!db.objectStoreNames.contains(storeName)) {
						db.createObjectStore(storeName);
					}
				}
			};

			request.onsuccess = () => {
				this.db = request.result;
				const tx = this.db.transaction(['master_config', 'summary_snapshot'], 'readwrite');
				const configStore = tx.objectStore('master_config');
				const snapshotStore = tx.objectStore('summary_snapshot');

				const configReq = configStore.get('current');
				configReq.onsuccess = () => {
					if (!configReq.result) {
						configStore.put(DEFAULT_MASTER_CONFIG, 'current');
					}
				};

				const snapshotReq = snapshotStore.get('current');
				snapshotReq.onsuccess = () => {
					if (!snapshotReq.result) {
						snapshotStore.put(DEFAULT_SUMMARY_SNAPSHOT, 'current');
					}
				};

				tx.oncomplete = () => resolve(this);
				tx.onerror = () => reject(tx.error);
			};
		});
	}

	async getRaw(storeName, key) {
		if (this.memoryDb) {
			return await this.memoryDb.get(storeName, key);
		}
		return new Promise((resolve, reject) => {
			const tx = this.db.transaction([storeName], 'readonly');
			const req = tx.objectStore(storeName).get(key);
			req.onsuccess = () => resolve(req.result !== undefined ? req.result : null);
			req.onerror = () => reject(req.error);
		});
	}

	async putRaw(storeName, value, key = undefined) {
		if (this.memoryDb) {
			const targetKey = key !== undefined ? key : value.id;
			await this.memoryDb.put(storeName, targetKey, value);
			return value;
		}
		return new Promise((resolve, reject) => {
			const tx = this.db.transaction([storeName], 'readwrite');
			const store = tx.objectStore(storeName);
			const req = key !== undefined ? store.put(value, key) : store.put(value);
			req.onsuccess = () => resolve(value);
			req.onerror = () => reject(req.error);
		});
	}

	async deleteRaw(storeName, key) {
		if (this.memoryDb) {
			return await this.memoryDb.delete(storeName, key);
		}
		return new Promise((resolve, reject) => {
			const tx = this.db.transaction([storeName], 'readwrite');
			const req = tx.objectStore(storeName).delete(key);
			req.onsuccess = () => resolve(true);
			req.onerror = () => reject(req.error);
		});
	}

	async getAllRaw(storeName) {
		if (this.memoryDb) {
			return await this.memoryDb.getAll(storeName);
		}
		return new Promise((resolve, reject) => {
			const tx = this.db.transaction([storeName], 'readonly');
			const req = tx.objectStore(storeName).getAll();
			req.onsuccess = () => resolve(req.result || []);
			req.onerror = () => reject(req.error);
		});
	}

	async encryptRecord(payload, extraMeta = {}) {
		if (!this.encryptionKey) {
			return payload;
		}
		const encrypted = await encryptObject(payload, this.encryptionKey);
		return {
			...extraMeta,
			encrypted: true,
			iv: encrypted.iv,
			ciphertext: encrypted.ciphertext
		};
	}

	async decryptRecord(raw) {
		if (!raw) return null;
		if (raw.encrypted) {
			if (!this.encryptionKey) {
				throw new Error('Database is locked: encryption key not set');
			}
			return await decryptObject({ iv: raw.iv, ciphertext: raw.ciphertext }, this.encryptionKey);
		}
		return raw;
	}
}

