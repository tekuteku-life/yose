/**
 * Lightweight in-memory mock for Google Apps Script services (PropertiesService, DriveApp, LockService, Utilities, ContentService)
 */

import crypto from 'node:crypto';

export class MockDriveFile {
	constructor(name, content = '{}') {
		this.name = name;
		this.id = 'file_' + Math.random().toString(36).substring(2, 9);
		this.content = content;
	}

	getId() {
		return this.id;
	}

	getName() {
		return this.name;
	}

	setContent(text) {
		this.content = text;
	}

	getBlob() {
		return {
			getDataAsString: () => this.content
		};
	}
}

export class MockDriveFolder {
	constructor(name = '家計簿データ') {
		this.name = name;
		this.id = 'folder_root_1';
		this.files = new Map();
	}

	getId() {
		return this.id;
	}

	getName() {
		return this.name;
	}

	createFile(name, content = '{}') {
		const file = new MockDriveFile(name, content);
		this.files.set(name, file);
		return file;
	}

	getFilesByName(name) {
		const file = this.files.get(name);
		let done = false;
		return {
			hasNext: () => !done && !!file,
			next: () => {
				done = true;
				return file;
			}
		};
	}
}

export class MockSheet {
	constructor(name) {
		this.name = name;
		this.rows = [];
	}

	getName() {
		return this.name;
	}

	getLastRow() {
		return this.rows.length;
	}

	clearContents() {
		this.rows = [];
	}

	getRange(startRow, startCol, numRows, numCols) {
		const self = this;
		return {
			getValues: () => {
				const result = [];
				for (let i = 0; i < numRows; i++) {
					const r = startRow - 1 + i;
					result.push([self.rows[r] !== undefined ? self.rows[r] : '']);
				}
				return result;
			},
			setValues: (values) => {
				for (let i = 0; i < values.length; i++) {
					const r = startRow - 1 + i;
					self.rows[r] = values[i][0];
				}
			}
		};
	}
}

export class MockSpreadsheet {
	constructor(name = 'よせあつめ家計簿_Data') {
		this.name = name;
		this.id = 'ss_' + Math.random().toString(36).substring(2, 9);
		this.sheets = new Map();
	}

	getId() {
		return this.id;
	}

	getName() {
		return this.name;
	}

	getSheets() {
		return Array.from(this.sheets.values());
	}

	getSheetByName(name) {
		return this.sheets.get(name) || null;
	}

	insertSheet(name) {
		const s = new MockSheet(name);
		this.sheets.set(name, s);
		return s;
	}
}

export class MockGasEnvironment {
	constructor() {
		this.properties = new Map();
		this.rootFolder = new MockDriveFolder();
		this.spreadsheet = new MockSpreadsheet();
		this.filesById = new Map();
		this.lockAcquired = false;
	}

	setupGlobals() {
		const self = this;

		globalThis.PropertiesService = {
			getScriptProperties: () => ({
				getProperty: (key) => self.properties.get(key) || null,
				setProperty: (key, val) => self.properties.set(key, String(val)),
				deleteProperty: (key) => self.properties.delete(key),
				deleteAllProperties: () => self.properties.clear()
			})
		};

		globalThis.DriveApp = {
			createFolder: (name) => {
				self.rootFolder = new MockDriveFolder(name);
				return self.rootFolder;
			},
			getFoldersByName: (name) => {
				let done = false;
				return {
					hasNext: () => !done,
					next: () => {
						done = true;
						return self.rootFolder;
					}
				};
			},
			getFolderById: (id) => self.rootFolder,
			getFileById: (id) => {
				for (const file of self.rootFolder.files.values()) {
					if (file.getId() === id) return file;
				}
				throw new Error('File not found: ' + id);
			}
		};

		globalThis.LockService = {
			getScriptLock: () => ({
				tryLock: () => {
					self.lockAcquired = true;
					return true;
				},
				releaseLock: () => {
					self.lockAcquired = false;
				}
			})
		};

		globalThis.Utilities = {
			DigestAlgorithm: { SHA_512: 'SHA_512' },
			computeDigest: (algorithm, dataArray) => {
				const buf = Buffer.from(dataArray);
				const hash = crypto.createHash('sha512').update(buf).digest();
				return Array.from(hash).map(b => (b > 127 ? b - 256 : b));
			},
			base64Decode: (base64) => {
				const buf = Buffer.from(base64, 'base64');
				return Array.from(buf).map(b => (b > 127 ? b - 256 : b));
			},
			newBlob: (str) => ({
				getBytes: () => Array.from(Buffer.from(str, 'utf-8')).map(b => (b > 127 ? b - 256 : b))
			})
		};

		globalThis.ContentService = {
			MimeType: { JSON: 'application/json' },
			createTextOutput: (content) => ({
				setMimeType: () => JSON.parse(content)
			})
		};

		globalThis.SpreadsheetApp = {
			getActiveSpreadsheet: () => self.spreadsheet,
			openById: (id) => self.spreadsheet,
			create: (name) => {
				self.spreadsheet = new MockSpreadsheet(name);
				return self.spreadsheet;
			}
		};

		const scriptCache = new Map();
		globalThis.CacheService = {
			getScriptCache: () => ({
				get: (key) => scriptCache.get(key) || null,
				put: (key, val, ttl) => scriptCache.set(key, String(val))
			})
		};
	}

	teardownGlobals() {
		delete globalThis.PropertiesService;
		delete globalThis.DriveApp;
		delete globalThis.SpreadsheetApp;
		delete globalThis.LockService;
		delete globalThis.Utilities;
		delete globalThis.ContentService;
		delete globalThis.CacheService;
	}
}

