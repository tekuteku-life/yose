/**
 * In-memory Mock for window.indexedDB API to test IDB branches in YoseDB
 */

export function createMockIndexedDB() {
	const allStores = new Map();
	const allKeyPaths = new Map();

	class MockObjectStore {
		constructor(name, keyPath = null) {
			this.name = name;
			this.keyPath = keyPath || allKeyPaths.get(name) || null;
			if (!allStores.has(name)) {
				allStores.set(name, new Map());
			}
			this.data = allStores.get(name);
		}

		createIndex() {
			return {};
		}

		get(key) {
			const req = { onsuccess: null, onerror: null, result: undefined };
			queueMicrotask(() => {
				req.result = this.data.get(key) || null;
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
			const tx = {
				oncomplete: null,
				onerror: null,
				onabort: null,
				objectStore: (name) => new MockObjectStore(name)
			};
			queueMicrotask(() => {
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

