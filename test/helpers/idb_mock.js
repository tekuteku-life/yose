/**
 * In-memory Mock for window.indexedDB API to test IDB branches in YoseDB
 */

export function createMockIndexedDB() {
	const allStores = new Map();
	const allKeyPaths = new Map();

	class MockObjectStore {
		constructor(name, keyPath = null, transactionData = null) {
			this.name = name;
			this.keyPath = keyPath || allKeyPaths.get(name) || null;
			if (!allStores.has(name)) {
				allStores.set(name, new Map());
			}
			this.data = transactionData || allStores.get(name);
		}

		createIndex() {
			return {};
		}

		get(key) {
			const req = { onsuccess: null, onerror: null, result: undefined };
			queueMicrotask(() => {
				req.result = this.data.has(key) ? structuredClone(this.data.get(key)) : undefined;
				if (req.onsuccess) req.onsuccess({ target: req });
			});
			return req;
		}

		getKey(key) {
			const req = { onsuccess: null, onerror: null, result: undefined };
			queueMicrotask(() => {
				req.result = this.data.has(key) ? key : undefined;
				if (req.onsuccess) req.onsuccess({ target: req });
			});
			return req;
		}

		put(value, key) {
			const actualKey = key !== undefined ? key : (this.keyPath ? value[this.keyPath] : value.id);
			this.data.set(actualKey, JSON.parse(JSON.stringify(value)));
			const req = { onsuccess: null, onerror: null, result: actualKey };
			queueMicrotask(() => {
				if (req.onsuccess) req.onsuccess({ target: req });
			});
			return req;
		}

		delete(key) {
			this.data.delete(key);
			const req = { onsuccess: null, onerror: null, result: true };
			queueMicrotask(() => {
				if (req.onsuccess) req.onsuccess({ target: req });
			});
			return req;
		}

		clear() {
			this.data.clear();
			return { onsuccess: null, onerror: null };
		}

		getAll() {
			const req = { onsuccess: null, onerror: null, result: [] };
			queueMicrotask(() => {
				req.result = Array.from(this.data.values()).map(v => JSON.parse(JSON.stringify(v)));
				if (req.onsuccess) req.onsuccess({ target: req });
			});
			return req;
		}
	}

	class MockDatabase {
		constructor() {
			this.objectStoreNames = {
				_set: new Set(),
				contains(name) {
					return this._set.has(name);
				},
				add(name) {
					this._set.add(name);
				}
			};
		}

		createObjectStore(name, options = {}) {
			this.objectStoreNames.add(name);
			if (options.keyPath) {
				allKeyPaths.set(name, options.keyPath);
			}
			return new MockObjectStore(name, options.keyPath);
		}

		transaction(storeNames, mode) {
			let aborted = false;
			const snapshots = new Map(storeNames.map(name => [name, new Map([...(allStores.get(name) || [])].map(([key, value]) => [key, structuredClone(value)]))]));
			const tx = {
				oncomplete: null, onerror: null, onabort: null, error: null,
				objectStore: name => new MockObjectStore(name, null, snapshots.get(name)),
				abort: () => { aborted = true; queueMicrotask(() => tx.onabort?.()); }
			};
			setImmediate(() => {
				if (aborted) return;
				if (mode === 'readwrite') for (const [name, values] of snapshots) allStores.set(name, values);
				if (tx.oncomplete) tx.oncomplete();
			});
			return tx;
		}
	}

	return {
		open(name, version) {
			const req = {
				onupgradeneeded: null,
				onsuccess: null,
				onerror: null,
				result: new MockDatabase(),
				error: null
			};

			queueMicrotask(() => {
				if (req.onupgradeneeded) {
					req.onupgradeneeded({ target: req });
				}
				if (req.onsuccess) {
					req.onsuccess({ target: req });
				}
			});

			return req;
		}
	};
}

