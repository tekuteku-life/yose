/**
 * Yoseatsume Kakeibo - Low-Level Storage Engine & AES-GCM-256 At-Rest Wrapper
 */

import { encryptObject, decryptObject, canonicalJsonStringify } from '../crypto.js';
import {
	DB_NAME,
	DB_VERSION,
	DEFAULT_MASTER_CONFIG,
	DEFAULT_SUMMARY_SNAPSHOT
} from './defaults.js';

function securityValueSignature(value, ancestors = new Set()) {
	if (value === null) return 'null';
	const type = typeof value;
	if (type !== 'object') {
		return JSON.stringify([type, Object.is(value, -0) ? '-0' : String(value)]);
	}
	const prototype = Object.getPrototypeOf(value);
	if ((!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) || ancestors.has(value)) throw new TypeError('認証鍵の期待値を比較できません。');
	ancestors.add(value);
	const fields = Reflect.ownKeys(value);
	const encoded = fields.sort().map(key => [key, securityValueSignature(value[key], ancestors)]);
	ancestors.delete(value);
	return JSON.stringify([Array.isArray(value) ? 'array' : 'record', encoded]);
}

function prepareSecurityExpectations(expected) {
	if (expected === null) return null;
	const prepared = structuredClone(expected);
	if (!prepared || Array.isArray(prepared) || Object.getPrototypeOf(prepared) !== Object.prototype || Object.keys(prepared).length === 0) throw new TypeError('認証鍵の期待状態が不正です。');
	return Object.entries(prepared).map(([key, state]) => {
		if (!state || Object.getPrototypeOf(state) !== Object.prototype || typeof state.exists !== 'boolean' || Object.keys(state).length !== (state.exists ? 2 : 1) || (state.exists && !Object.hasOwn(state, 'value'))) throw new TypeError('認証鍵の期待状態が不正です。');
		return [key, { exists: state.exists, signature: state.exists ? securityValueSignature(state.value) : null }];
	});
}

function assertSecurityExpectations(expected, states) {
	for (const [key, state] of expected) {
		const actual = states[key];
		if (actual.exists !== state.exists || (actual.exists && securityValueSignature(actual.value) !== state.signature)) {
			throw Object.assign(new Error('認証鍵が変更されました。再認証してやり直してください。'), { name: 'SecurityKeyConflictError', code: 'SECURITY_KEYS_CHANGED' });
		}
	}
}

// Both requests belong to the caller's transaction, so absence and null are distinct.
function readSecurityStates(store, keys, isSessionValid, complete, fail) {
	const states = Object.create(null);
	let remaining = keys.length;
	for (const key of keys) {
		let received = 0;
		const value = store.get(key), presence = store.getKey(key);
		const ready = () => {
			if (!isSessionValid()) { fail(new Error('認証状態が変更されました。')); return; }
			if (++received !== 2) return;
			states[key] = presence.result === undefined ? { exists: false } : { exists: true, value: value.result };
			if (--remaining === 0) complete(states);
		};
		value.onsuccess = presence.onsuccess = ready;
	}
}

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
		this.keyGeneration = 0;
		this.decryptedRecords = new Map();
		this.decryptingRecords = new Map();
	}

	setEncryptionKey(key) {
		this.encryptionKey = key;
		this.keyGeneration++;
		this.decryptedRecords.clear();
		this.decryptingRecords.clear();
	}

	clearEncryptionKey() {
		this.setEncryptionKey(null);
	}

	isEncrypted() {
		return this.encryptionKey !== null && this.encryptionKey !== undefined;
	}

	async init() {
		if (!this.idb) {
			this.memoryDb = new MemoryDatabase();
			await this.memoryDb.put('master_config', 'current', DEFAULT_MASTER_CONFIG);
			await this.memoryDb.put('summary_snapshot', 'current', DEFAULT_SUMMARY_SNAPSHOT);
			return this;
		}

		return new Promise((resolve, reject) => {
			const request = this.idb.open(DB_NAME, DB_VERSION);

			request.onerror = () => reject(request.error);

			request.onupgradeneeded = (event) => {
				const db = event.target.result;

				// Version 1 is created only from the empty version-zero database.
				const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
				txStore.createIndex('target_month', 'target_month', { unique: false });
				txStore.createIndex('date', 'date', { unique: false });
				txStore.createIndex('group_id', 'group_id', { unique: false });
				txStore.createIndex('status', 'status', { unique: false });
				txStore.createIndex('sync_status', 'sync_status', { unique: false });
				txStore.createIndex('type', 'type', { unique: false });

				for (const storeName of ['master_config', 'summary_snapshot', 'security_keys', 'settings']) {
					db.createObjectStore(storeName);
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

	async putRaw(storeName, value, key = undefined, isSessionValid = () => true) {
		if (!isSessionValid()) throw new Error('認証状態が変更されました。');
		if (this.memoryDb) {
			const targetKey = key !== undefined ? key : value.id;
			await this.memoryDb.put(storeName, targetKey, value);
			return value;
		}
		return new Promise((resolve, reject) => {
			const tx = this.db.transaction([storeName], 'readwrite');
			tx.oncomplete = () => resolve(value);
			tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
			tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
			const store = tx.objectStore(storeName);
			const req = key !== undefined ? store.put(value, key) : store.put(value);
			req.onsuccess = () => { if (!isSessionValid()) tx.abort(); };
			req.onerror = () => reject(req.error);
		});
	}

	async getSecurityKeyStates(keys, { isSessionValid = () => true } = {}) {
		if (!isSessionValid()) throw new Error('認証状態が変更されました。');
		if (!Array.isArray(keys) || keys.some(key => typeof key !== 'string')) throw new TypeError('認証鍵の指定が不正です。');
		const selected = [...new Set(keys)];
		if (selected.length === 0) return {};
		if (this.memoryDb) {
			const store = this.memoryDb.stores.security_keys;
			return Object.fromEntries(selected.map(key => [key, store.has(key) ? { exists: true, value: structuredClone(store.get(key)) } : { exists: false }]));
		}
		return new Promise((resolve, reject) => {
			const tx = this.db.transaction(['security_keys'], 'readonly');
			let result, failure;
			const abort = error => { failure = error; tx.abort(); };
			tx.oncomplete = () => isSessionValid() ? resolve(structuredClone(result)) : reject(new Error('認証状態が変更されました。'));
			tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('認証鍵の読取を中止しました。'));
			readSecurityStates(tx.objectStore('security_keys'), selected, isSessionValid, states => { result = states; }, abort);
		});
	}

	async putSecurityKeys(entries, isSessionValid, { expectedSecurityKeys = null, deleteKeys = [] } = {}) {
		const prepared = structuredClone(entries);
		if (!isSessionValid()) throw new Error('認証状態が変更されました。');
		const expected = prepareSecurityExpectations(expectedSecurityKeys);
		if (!Array.isArray(deleteKeys) || deleteKeys.some(key => typeof key !== 'string')) throw new TypeError('認証鍵の削除指定が不正です。');
		const removed = [...new Set(deleteKeys)];
		if (this.memoryDb) {
			const store = this.memoryDb.stores.security_keys;
			if (expected) assertSecurityExpectations(expected, Object.fromEntries(expected.map(([key]) => [key, store.has(key) ? { exists: true, value: store.get(key) } : { exists: false }])));
			for (const [key, value] of Object.entries(prepared)) store.set(key, value);
			for (const key of removed) store.delete(key);
			return;
		}
		return new Promise((resolve, reject) => {
			const tx = this.db.transaction(['security_keys'], 'readwrite');
			const store = tx.objectStore('security_keys');
			let failure;
			const abort = error => { failure = error; tx.abort(); };
			tx.oncomplete = () => resolve(undefined);
			tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('認証鍵の保存を中止しました。'));
			const guard = request => { request.onsuccess = () => { if (!isSessionValid()) abort(new Error('認証状態が変更されました。')); }; };
			const write = states => {
				try {
					if (!isSessionValid()) throw new Error('認証状態が変更されました。');
					if (expected) assertSecurityExpectations(expected, states);
					for (const [key, value] of Object.entries(prepared)) guard(store.put(value, key));
					for (const key of removed) guard(store.delete(key));
				} catch (error) { abort(error); }
			};
			if (expected) readSecurityStates(store, expected.map(([key]) => key), isSessionValid, write, abort);
			else write(null);
		});
	}

	async putAllRaw(storeName, values) {
		if (values.length === 0) return;
		if (this.memoryDb) {
			const prepared = values.map(value => JSON.parse(JSON.stringify(value)));
			const store = this.memoryDb.stores[storeName];
			for (const value of prepared) store.set(value.id, value);
			return;
		}
		return new Promise((resolve, reject) => {
			const transaction = this.db.transaction([storeName], 'readwrite');
			transaction.oncomplete = () => resolve(undefined);
			transaction.onerror = () => reject(transaction.error || new Error('IndexedDB batch write failed'));
			transaction.onabort = () => reject(transaction.error || new Error('IndexedDB batch write aborted'));
			try {
				const store = transaction.objectStore(storeName);
				for (const value of values) store.put(value);
			} catch (error) {
				transaction.abort();
				reject(error);
			}
		});
	}

	async replaceImportBatch(expected, replacements, isSessionValid) {
		const same = (a, b) => canonicalJsonStringify(a ?? null) === canonicalJsonStringify(b ?? null);
		const sameTransactions = records => same([...records].sort((a, b) => a.id.localeCompare(b.id)), [...expected.transactions].sort((a, b) => a.id.localeCompare(b.id)));
		const matches = (transactions, master, snapshot, pending, base) => sameTransactions(transactions) && same(master, expected.master) && same(snapshot, expected.snapshot) && same(pending, expected.pending) && same(base, expected.base);
		const prepared = structuredClone(replacements);
		const previous = new Map(expected.transactions.map(record => [record.id, record]));
		const changed = prepared.transactions?.filter(record => !same(previous.get(record.id), record)) || [];
		const retained = prepared.transactions ? new Set(prepared.transactions.map(record => record.id)) : null;
		const removed = retained ? [...previous.keys()].filter(id => !retained.has(id)) : [];
		if (this.memoryDb) {
			const stores = this.memoryDb.stores;
			if (!isSessionValid()) throw new Error('認証または同期状態が変更されました');
			if (!matches(stores.transactions.values(), stores.master_config.get('current'), stores.summary_snapshot.get('current'), stores.master_config.get('pending_import'), stores.master_config.get('sync_base'))) return false;
			const settings = Object.hasOwn(prepared, 'archiveMonths') ? new Map(stores.settings).set('downloaded_archive_months', prepared.archiveMonths) : null;
			if (prepared.transactions) stores.transactions = new Map(prepared.transactions.map(value => [value.id, value]));
			if (Object.hasOwn(prepared, 'master')) stores.master_config.set('current', prepared.master);
			if (Object.hasOwn(prepared, 'snapshot')) stores.summary_snapshot.set('current', prepared.snapshot);
			if (Object.hasOwn(prepared, 'base')) stores.master_config.set('sync_base', prepared.base);
			if (Object.hasOwn(prepared, 'pending')) stores.master_config.set('pending_import', prepared.pending);
			if (settings) stores.settings = settings;
			return true;
		}
		return new Promise((resolve, reject) => {
			const names = ['transactions', 'master_config', 'summary_snapshot'];
			if (Object.hasOwn(prepared, 'archiveMonths')) names.push('settings');
			const transaction = this.db.transaction(names, 'readwrite');
			let applied = false;
			transaction.oncomplete = () => resolve(applied);
			transaction.onerror = () => reject(transaction.error || new Error('完全インポートの保存に失敗しました'));
			transaction.onabort = () => reject(transaction.error || new Error('完全インポートの保存を中止しました'));
			const guardWrite = request => {
				request.onsuccess = () => {
					if (!isSessionValid()) { transaction.abort(); reject(new Error('保存中に認証または処理状態が変更されました')); }
				};
			};
			const masterStore = transaction.objectStore('master_config');
			const requests = [transaction.objectStore('transactions').getAll(), masterStore.get('current'), transaction.objectStore('summary_snapshot').get('current'), masterStore.get('pending_import'), masterStore.get('sync_base')];
			let remaining = requests.length;
			for (const request of requests) request.onsuccess = () => {
				if (--remaining) return;
				try {
					if (!isSessionValid()) throw new Error('認証または同期状態が変更されました');
					if (!matches(...requests.map(item => item.result))) return;
					if (prepared.transactions) {
						const store = transaction.objectStore('transactions');
						for (const id of removed) guardWrite(store.delete(id));
						for (const record of changed) guardWrite(store.put(record));
					}
					if (Object.hasOwn(prepared, 'master')) guardWrite(masterStore.put(prepared.master, 'current'));
					if (Object.hasOwn(prepared, 'snapshot')) guardWrite(transaction.objectStore('summary_snapshot').put(prepared.snapshot, 'current'));
					if (Object.hasOwn(prepared, 'base')) guardWrite(masterStore.put(prepared.base, 'sync_base'));
					if (Object.hasOwn(prepared, 'pending')) guardWrite(masterStore.put(prepared.pending, 'pending_import'));
					if (Object.hasOwn(prepared, 'archiveMonths')) guardWrite(transaction.objectStore('settings').put(prepared.archiveMonths, 'downloaded_archive_months'));
					applied = true;
				} catch (error) { transaction.abort(); reject(error); }
			};
		});
	}

	async deleteRaw(storeName, key, isSessionValid = () => true) {
		if (!isSessionValid()) throw new Error('認証状態が変更されました。');
		if (this.memoryDb) {
			return await this.memoryDb.delete(storeName, key);
		}
		return new Promise((resolve, reject) => {
			const tx = this.db.transaction([storeName], 'readwrite');
			tx.oncomplete = () => resolve(true);
			tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
			tx.onabort = () => reject(tx.error || new Error('IndexedDB delete aborted'));
			const req = tx.objectStore(storeName).delete(key);
			req.onsuccess = () => { if (!isSessionValid()) tx.abort(); };
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
			req.onsuccess = () => resolve(req.result);
			req.onerror = () => reject(req.error);
		});
	}

	async encryptRecord(payload, extraMeta = {}) {
		const key = this.encryptionKey, generation = this.keyGeneration;
		if (!key) {
			return structuredClone(payload);
		}
		const encrypted = await encryptObject(payload, key);
		if (key !== this.encryptionKey || generation !== this.keyGeneration) throw new Error('暗号化中に認証鍵が変更されました。');
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
			const key = this.encryptionKey, generation = this.keyGeneration;
			if (!key) {
				throw new Error('Database is locked: encryption key not set');
			}
			const check = () => { if (key !== this.encryptionKey || generation !== this.keyGeneration) throw new Error('復号中に認証鍵または世代が変更されました。'); };
			const id = JSON.stringify([raw.iv, raw.ciphertext]);
			check();
			if (this.decryptedRecords.has(id)) {
				const value = this.decryptedRecords.get(id);
				this.decryptedRecords.delete(id); this.decryptedRecords.set(id, value);
				check(); return structuredClone(value);
			}
			let pending = this.decryptingRecords.get(id);
			if (!pending) {
				pending = (async () => {
					try {
						const value = await decryptObject({ iv: raw.iv, ciphertext: raw.ciphertext }, key);
						check(); this.decryptedRecords.set(id, value);
						while (this.decryptedRecords.size > 20000) this.decryptedRecords.delete(this.decryptedRecords.keys().next().value);
						return value;
					} finally { if (this.decryptingRecords.get(id) === pending) this.decryptingRecords.delete(id); }
				})();
				this.decryptingRecords.set(id, pending);
			}
			const value = await pending; check(); return structuredClone(value);
		}
		return structuredClone(raw);
	}
}

