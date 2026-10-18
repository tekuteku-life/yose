/**
 * @OnlyCurrentDoc
 * Yoseatsume Kakeibo - Google Apps Script (GAS Web App)
 * V8 Runtime, LockService, PropertiesService, Google Drive / Spreadsheet Storage
 */

// ==========================================
// 1. Ed25519 Cryptographic Verification (RFC 8032)
// ==========================================

const _0n = BigInt(0);
const _1n = BigInt(1);
const _2n = BigInt(2);
const _3n = BigInt(3);
const _4n = BigInt(4);
const _5n = BigInt(5);
const _8n = BigInt(8);

const ED25519_P = _2n ** BigInt(255) - BigInt(19);
const ED25519_L = _2n ** BigInt(252) + BigInt('27742317777372353535851937790883648493');

function modP(a, m = ED25519_P) {
	let r = a % m;
	return r < _0n ? r + m : r;
}

function invP(a, m = ED25519_P) {
	let m0 = m, y = _0n, x = _1n;
	if (m === _1n) return _0n;
	while (a > _1n) {
		let q = a / m;
		let t = m;
		m = a % m;
		a = t;
		t = y;
		y = x - q * y;
		x = t;
	}
	if (x < _0n) x += m0;
	return x;
}

function powP(b, exp, m = ED25519_P) {
	let res = _1n;
	b = modP(b, m);
	while (exp > _0n) {
		if (exp & _1n) res = modP(res * b, m);
		b = modP(b * b, m);
		exp >>= _1n;
	}
	return res;
}

const ED25519_D = modP(BigInt(-121665) * invP(BigInt(121666)));
const ED25519_I = powP(_2n, (ED25519_P - _1n) / _4n);
const ED25519_BY = modP(_4n * invP(_5n));
const ED25519_BX = recoverX(ED25519_BY, _0n);
const ED25519_BASE = [ED25519_BX, ED25519_BY, _1n, modP(ED25519_BX * ED25519_BY)];

function recoverX(y, sign) {
	if (y >= ED25519_P) return null;
	const y2 = modP(y * y);
	const u = modP(y2 - _1n);
	const v = modP(ED25519_D * y2 + _1n);
	let xx = modP(u * invP(v));
	let x = powP(xx, (ED25519_P + _3n) / _8n);
	if (modP(x * x - xx) !== _0n) {
		x = modP(x * ED25519_I);
	}
	if (modP(x * x - xx) !== _0n) return null;
	if ((x & _1n) !== sign) x = modP(ED25519_P - x);
	return x;
}

function pointAdd(P, Q) {
	const [X1, Y1, Z1, T1] = P;
	const [X2, Y2, Z2, T2] = Q;
	const A = modP((Y1 - X1) * (Y2 - X2));
	const B = modP((Y1 + X1) * (Y2 + X2));
	const C = modP(modP(_2n * T1) * modP(ED25519_D * T2));
	const D = modP(modP(_2n * Z1) * Z2);
	const E = modP(B - A);
	const F = modP(D - C);
	const G = modP(D + C);
	const H = modP(B + A);
	return [modP(E * F), modP(G * H), modP(F * G), modP(E * H)];
}

function pointMul(s, P) {
	let Q = [_0n, _1n, _1n, _0n]; // identity
	for (let i = BigInt(255); i >= _0n; i--) {
		const [X1, Y1, Z1, T1] = Q;
		const A = modP(X1 * X1);
		const B = modP(Y1 * Y1);
		const C = modP(_2n * modP(Z1 * Z1));
		const H = modP(A + B);
		const E = modP(H - modP(modP(X1 + Y1) * modP(X1 + Y1)));
		const G = modP(A - B);
		const F = modP(C + G);
		Q = [modP(E * F), modP(G * H), modP(F * G), modP(E * H)];
		if ((s >> i) & _1n) {
			Q = pointAdd(Q, P);
		}
	}
	return Q;
}

function bytesToBigIntLE(bytes) {
	let res = _0n;
	for (let i = 0; i < bytes.length; i++) {
		res |= BigInt(bytes[i]) << BigInt(i * 8);
	}
	return res;
}

function computeSha512(dataBytes) {
	if (typeof Utilities !== 'undefined' && Utilities.computeDigest) {
		const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_512, Array.from(dataBytes));
		return new Uint8Array(raw.map(b => (b < 0 ? b + 256 : b)));
	}
	// Node.js fallback for testing
	const cryptoNode = require('crypto');
	return new Uint8Array(cryptoNode.createHash('sha512').update(dataBytes).digest());
}

function base64ToUint8Array(base64) {
	if (typeof Utilities !== 'undefined' && Utilities.base64Decode) {
		const decoded = Utilities.base64Decode(base64);
		return new Uint8Array(decoded.map(b => (b < 0 ? b + 256 : b)));
	}
	const binary = atob(base64.trim());
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Verify Ed25519 signature
 */
function verifyEd25519(pubKeyBytes, sigBytes, msgBytes) {
	if (pubKeyBytes.length !== 32 || sigBytes.length !== 64) return false;
	const ySign = BigInt((pubKeyBytes[31] >> 7) & 1);
	const pubCopy = new Uint8Array(pubKeyBytes);
	pubCopy[31] &= 0x7f;
	const y = bytesToBigIntLE(pubCopy);
	const x = recoverX(y, ySign);
	if (x === null) return false;
	const A = [x, y, _1n, modP(x * y)];

	const rSign = BigInt((sigBytes[31] >> 7) & 1);
	const rCopy = new Uint8Array(sigBytes.subarray(0, 32));
	rCopy[31] &= 0x7f;
	const ry = bytesToBigIntLE(rCopy);
	const rx = recoverX(ry, rSign);
	if (rx === null) return false;
	const R = [rx, ry, _1n, modP(rx * ry)];

	const S = bytesToBigIntLE(sigBytes.subarray(32, 64));
	if (S >= ED25519_L) return false;

	const kData = new Uint8Array(32 + 32 + msgBytes.length);
	kData.set(sigBytes.subarray(0, 32), 0);
	kData.set(pubKeyBytes, 32);
	kData.set(msgBytes, 64);
	const h = computeSha512(kData);
	const k = bytesToBigIntLE(h) % ED25519_L;

	const SB = pointMul(S, ED25519_BASE);
	const kA = pointMul(k, A);
	const R_kA = pointAdd(R, kA);

	const xEq = modP(SB[0] * R_kA[2] - R_kA[0] * SB[2]) === _0n;
	const yEq = modP(SB[1] * R_kA[2] - R_kA[1] * SB[2]) === _0n;
	return xEq && yEq;
}

// ==========================================
// 2. Storage & Properties Layer
// ==========================================

const FOLDER_NAME = '家計簿データ';

function getScriptProp(key) {
	if (typeof PropertiesService !== 'undefined') {
		return PropertiesService.getScriptProperties().getProperty(key);
	}
	return null;
}

function setScriptProp(key, value) {
	if (typeof PropertiesService !== 'undefined') {
		PropertiesService.getScriptProperties().setProperty(key, value);
	}
}

function getRegisteredPublicKeys() {
	const prop = getScriptProp('USER_PUBLIC_KEYS');
	if (!prop) return [];
	try {
		const parsed = JSON.parse(prop);
		return Array.isArray(parsed) ? parsed : [parsed];
	} catch (e) {
		return prop.split(',').map(s => s.trim()).filter(Boolean);
	}
}

/**
 * GASエディタ上で初回権限承認を行うためのセットアップ関数
 * Googleのアクセス権限承認ダイアログが開き、スプレッドシートが作成・紐付けされます。
 */
function initialSetup() {
	const ss = getStorageSpreadsheet();
	if (!ss) {
		const errMsg = 'よせあつめ家計簿: スプレッドシートが見つかりません。Googleスプレッドシート（sheets.google.com）の [拡張機能] -> [Apps Script] から作成されたコンテナバインドスクリプトとして実行してください。';
		if (typeof Logger !== 'undefined') {
			Logger.log(errMsg);
		}
		throw new Error(errMsg);
	}
	const name = (typeof ss.getName === 'function') ? ss.getName() : FOLDER_NAME;
	const id = (typeof ss.getId === 'function') ? ss.getId() : '';
	// Pre-initialize default sheets
	loadJsonFile('master_config.json', { schema_version: 2 });
	loadJsonFile('summary_snapshot.json', { schema_version: 2 });
	loadJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] });
	if (typeof Logger !== 'undefined') {
		Logger.log('よせあつめ家計簿: 初期化成功！ データスプレッドシート: ' + name + ' (ID: ' + id + ')');
	}
	return { status: 'ok', storage: 'spreadsheet', id: id, spreadsheetId: id, folderId: id };
}

function safeSheetName(fileName) {
	let name = String(fileName).replace(/\.json$/i, '').replace(/archives[\/\\]/i, 'arch_').replace(/[^a-zA-Z0-9_\-]/g, '_');
	return name.substring(0, 100);
}

function getStorageSpreadsheet() {
	if (typeof SpreadsheetApp !== 'undefined') {
		// Container-bound Google Sheet (100% block-free via @OnlyCurrentDoc)
		try {
			if (typeof SpreadsheetApp.getActiveSpreadsheet === 'function') {
				const active = SpreadsheetApp.getActiveSpreadsheet();
				if (active) return active;
			}
		} catch (e) {}
	}
	return null;
}

function loadJsonFromSheet(sheet, defaultContent = {}) {
	try {
		const lastRow = (typeof sheet.getLastRow === 'function') ? sheet.getLastRow() : 0;
		if (lastRow === 0) return defaultContent;
		const values = sheet.getRange(1, 1, lastRow, 1).getValues();
		const str = values.map(r => r[0]).join('');
		if (!str.trim()) return defaultContent;
		return JSON.parse(str);
	} catch (e) {
		return defaultContent;
	}
}

function saveJsonToSheet(sheet, data) {
	const jsonStr = (typeof data === 'string') ? data : JSON.stringify(data, null, 2);
	const CHUNK_SIZE = 40000;
	const chunks = [];
	for (let i = 0; i < jsonStr.length; i += CHUNK_SIZE) {
		chunks.push([jsonStr.substring(i, i + CHUNK_SIZE)]);
	}
	if (typeof sheet.clearContents === 'function') {
		sheet.clearContents();
	}
	if (typeof sheet.getRange === 'function') {
		sheet.getRange(1, 1, chunks.length, 1).setValues(chunks);
	}
}

function getDataFolder() {
	return getStorageSpreadsheet();
}

function getOrCreateFile(fileName, defaultContent = '{}') {
	const ss = getStorageSpreadsheet();
	const sheetName = safeSheetName(fileName);
	let sheet = ss ? ss.getSheetByName(sheetName) : null;
	if (!sheet && ss && typeof ss.insertSheet === 'function') {
		sheet = ss.insertSheet(sheetName);
		saveJsonToSheet(sheet, defaultContent);
	}
	return {
		getName: () => fileName,
		getId: () => sheetName,
		getBlob: () => ({
			getDataAsString: () => JSON.stringify(loadJsonFromSheet(sheet, defaultContent))
		}),
		setContent: (content) => {
			saveJsonToSheet(sheet, content);
		}
	};
}

function loadJsonFile(fileName, defaultContent = {}) {
	const ss = getStorageSpreadsheet();
	if (ss) {
		const sheetName = safeSheetName(fileName);
		let sheet = (typeof ss.getSheetByName === 'function') ? ss.getSheetByName(sheetName) : null;
		if (!sheet) {
			if (typeof ss.insertSheet === 'function') {
				sheet = ss.insertSheet(sheetName);
				saveJsonToSheet(sheet, defaultContent);
			}
			return defaultContent;
		}
		return loadJsonFromSheet(sheet, defaultContent);
	}
	return defaultContent;
}

function saveJsonFile(fileName, data) {
	const ss = getStorageSpreadsheet();
	if (ss) {
		const sheetName = safeSheetName(fileName);
		let sheet = (typeof ss.getSheetByName === 'function') ? ss.getSheetByName(sheetName) : null;
		if (!sheet && typeof ss.insertSheet === 'function') {
			sheet = ss.insertSheet(sheetName);
		}
		if (sheet) {
			saveJsonToSheet(sheet, data);
		}
	}
}

// ==========================================
// 3. Web App Request Handlers
// ==========================================

function canonicalJsonStringify(obj) {
	if (obj === null || typeof obj !== 'object') {
		return JSON.stringify(obj);
	}
	if (Array.isArray(obj)) {
		return '[' + obj.map(item => {
			if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
				return 'null';
			}
			return canonicalJsonStringify(item);
		}).join(',') + ']';
	}
	const sortedKeys = Object.keys(obj).sort();
	const keyValues = [];
	for (const key of sortedKeys) {
		const val = obj[key];
		if (val === undefined || typeof val === 'function' || typeof val === 'symbol') {
			continue;
		}
		keyValues.push(JSON.stringify(key) + ':' + canonicalJsonStringify(val));
	}
	return '{' + keyValues.join(',') + '}';
}

function doGet(e) {
	return createResponse({
		status: 'ok',
		app: 'よせあつめ家計簿 Backend (GAS)'
	});
}

function doPost(e) {
	let lock = null;
	if (typeof LockService !== 'undefined') {
		lock = LockService.getScriptLock();
		try {
			const hasLock = lock.tryLock(30000);
			if (!hasLock) {
				return createResponse({ success: false, error: 'Could not obtain lock: Server is busy' });
			}
		} catch (err) {
			return createResponse({ success: false, error: 'LockService error: ' + err.message });
		}
	}

	try {
		if (!e || !e.postData || !e.postData.contents) {
			return createResponse({ success: false, error: 'Empty request body' });
		}

		let request;
		try {
			request = JSON.parse(e.postData.contents);
		} catch (err) {
			return createResponse({ success: false, error: 'Invalid JSON body' });
		}

		const { action, timestamp, payload, signature } = request;

		// 1. Replay attack prevention check
		const now = Date.now();
		if (!timestamp || Math.abs(now - timestamp) > 300000) {
			return createResponse({
				success: false,
				error: 'Timestamp skew exceeds allowed window (potential replay attack)'
			});
		}

		// Fast path: Write-once protection for register_initial_key
		if (action === 'register_initial_key') {
			const existingKeys = getRegisteredPublicKeys();
			if (existingKeys.length > 0) {
				return createResponse({
					success: false,
					error: 'Public keys already configured on server'
				});
			}
		}

		if (typeof CacheService !== 'undefined' && signature) {
			try {
				const cache = CacheService.getScriptCache();
				if (cache) {
					if (cache.get(signature)) {
						return createResponse({
							success: false,
							error: 'Replay detected: Request already processed'
						});
					}
					cache.put(signature, '1', 300);
				}
			} catch (cacheErr) {}
		}

		// 2. Ed25519 Signature Verification
		const publicKeys = getRegisteredPublicKeys();

		if (action === 'register_initial_key') {
			if (publicKeys.length > 0) {
				return createResponse({
					success: false,
					error: 'Public keys already configured on server'
				});
			}
			if (!payload || !payload.publicKey) {
				return createResponse({
					success: false,
					error: 'Missing publicKey in payload'
				});
			}

			const signString = canonicalJsonStringify({ action, timestamp, payload });
			const msgBytes = (typeof Utilities !== 'undefined' && Utilities.newBlob)
				? new Uint8Array(Utilities.newBlob(signString).getBytes().map(b => (b < 0 ? b + 256 : b)))
				: new TextEncoder().encode(signString);

			const sigBytes = base64ToUint8Array(signature);
			const candidateKeyBytes = base64ToUint8Array(payload.publicKey);

			if (!verifyEd25519(candidateKeyBytes, sigBytes, msgBytes)) {
				return createResponse({
					success: false,
					error: 'Signature verification failed: Self-signature does not match candidate key'
				});
			}

			setScriptProp('USER_PUBLIC_KEYS', JSON.stringify([payload.publicKey]));
			return createResponse({
				success: true,
				message: 'Public key successfully registered on GAS'
			});
		}

		if (publicKeys.length === 0) {
			return createResponse({
				success: false,
				error: 'No public keys registered on server. Please configure USER_PUBLIC_KEYS in Script Properties.'
			});
		}

		const signString = canonicalJsonStringify({ action, timestamp, payload });
		const msgBytes = (typeof Utilities !== 'undefined' && Utilities.newBlob)
			? new Uint8Array(Utilities.newBlob(signString).getBytes().map(b => (b < 0 ? b + 256 : b)))
			: new TextEncoder().encode(signString);

		const sigBytes = base64ToUint8Array(signature);

		let isVerified = false;
		for (const pubKeyBase64 of publicKeys) {
			const pubKeyBytes = base64ToUint8Array(pubKeyBase64);
			if (verifyEd25519(pubKeyBytes, sigBytes, msgBytes)) {
				isVerified = true;
				break;
			}
		}

		if (!isVerified) {
			return createResponse({ success: false, error: 'Signature verification failed' });
		}

		// 3. Dispatch action
		const result = handleAction(action, payload);
		return createResponse(result);
	} catch (err) {
		return createResponse({ success: false, error: err.message || 'Internal server error' });
	} finally {
		if (lock) {
			try {
				lock.releaseLock();
			} catch (e) {
				// ignore lock release error
			}
		}
	}
}

function createResponse(obj) {
	if (typeof ContentService !== 'undefined') {
		return ContentService.createTextOutput(JSON.stringify(obj))
			.setMimeType(ContentService.MimeType.JSON);
	}
	return obj;
}

// ==========================================
// 4. Action Handlers & Recalculation Engine
// ==========================================

function handleAction(action, payload) {
	switch (action) {
		case 'push_diff':
			return handlePushDiff(payload);
		case 'close_month':
			return handleCloseMonth(payload);
		case 'retroactive_update':
			return handleRetroactiveUpdate(payload);
		case 'fetch_state':
			return handleFetchState();
		case 'update_master':
			return handleUpdateMaster(payload);
		case 'update_external_assets':
			return handleUpdateExternalAssets(payload);
		default:
			return { success: false, error: `Unknown action: ${action}` };
	}
}

function handleFetchState() {
	const master = loadJsonFile('master_config.json', { schema_version: 2 });
	const snapshot = loadJsonFile('summary_snapshot.json', {
		schema_version: 2,
		last_closed_month: null,
		account_balances: {},
		external_assets: [],
		monthly_summaries: {}
	});
	const pending = loadJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] });

	return {
		success: true,
		master_config: master,
		snapshot: snapshot,
		pending_diffs: pending.transactions || []
	};
}

function handleUpdateMaster(payload) {
	if (!payload || !payload.master_config) {
		return { success: false, error: 'Missing master_config in payload' };
	}
	saveJsonFile('master_config.json', payload.master_config);
	return { success: true };
}

function handlePushDiff(payload) {
	if (!payload || !Array.isArray(payload.transactions)) {
		return { success: false, error: 'Missing or invalid transactions in payload' };
	}
	const incoming = payload.transactions;
	const pending = loadJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] });
	const currentTxs = pending.transactions || [];

	const txMap = new Map();
	for (const tx of currentTxs) {
		txMap.set(tx.id, tx);
	}

	for (const tx of incoming) {
		txMap.set(tx.id, tx);
	}

	pending.transactions = Array.from(txMap.values());
	pending.exported_at = new Date().toISOString();
	saveJsonFile('pending_diffs.json', pending);

	const snapshot = loadJsonFile('summary_snapshot.json');
	return {
		success: true,
		updated_count: incoming.length,
		snapshot: snapshot
	};
}

function handleCloseMonth(payload) {
	const targetMonth = payload.target_month;
	if (!targetMonth) {
		return { success: false, error: 'Missing target_month' };
	}

	const pending = loadJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] });
	const snapshot = loadJsonFile('summary_snapshot.json', {
		schema_version: 2,
		last_closed_month: null,
		account_balances: {},
		monthly_summaries: {}
	});

	const allTxs = pending.transactions || [];
	const targetMonthTxs = [];
	const remainingTxs = [];

	for (const tx of allTxs) {
		if (tx.target_month === targetMonth) {
			// Ensure transaction is confirmed when closing
			tx.status = 'confirmed';
			targetMonthTxs.push(tx);
		} else {
			remainingTxs.push(tx);
		}
	}

	// Load existing archive if present to guard against overwrite
	const archiveFileName = `archives/${targetMonth}.json`;
	const existingArchive = loadJsonFile(archiveFileName, null);
	let finalArchiveTxs = targetMonthTxs;

	if (existingArchive && Array.isArray(existingArchive.transactions) && existingArchive.transactions.length > 0) {
		if (targetMonthTxs.length === 0) {
			// Month already closed and pending has no new items: return existing state safely
			return {
				success: true,
				snapshot: snapshot,
				archived_count: existingArchive.transactions.length
			};
		}
		const txMap = new Map();
		for (const t of existingArchive.transactions) {
			txMap.set(t.id, t);
		}
		for (const t of targetMonthTxs) {
			txMap.set(t.id, t);
		}
		finalArchiveTxs = Array.from(txMap.values());
	}

	// Save to /archives/YYYY-MM.json
	const archiveData = {
		schema_version: 2,
		exported_at: new Date().toISOString(),
		transactions: finalArchiveTxs
	};
	saveJsonFile(archiveFileName, archiveData);

	// Update pending_diffs.json (remove archived transactions)
	pending.transactions = remainingTxs;
	pending.exported_at = new Date().toISOString();
	saveJsonFile('pending_diffs.json', pending);

	// Recalculate monthly summary and update snapshot closing balances
	let startingBalances = { ...(snapshot.account_balances || {}) };
	if (Object.keys(startingBalances).length === 0) {
		const master = loadJsonFile('master_config.json', { accounts: [] });
		for (const acc of (master.accounts || [])) {
			startingBalances[acc.id] = acc.initial_balance || 0;
		}
	}
	const monthSummary = computeMonthlySummary(finalArchiveTxs, startingBalances);

	if (!snapshot.monthly_summaries) snapshot.monthly_summaries = {};
	snapshot.monthly_summaries[targetMonth] = monthSummary;
	snapshot.account_balances = { ...monthSummary.closing_balances };
	snapshot.last_closed_month = targetMonth;
	snapshot.calculated_at = new Date().toISOString();

	saveJsonFile('summary_snapshot.json', snapshot);

	return {
		success: true,
		snapshot: snapshot,
		archived_count: targetMonthTxs.length
	};
}

function handleRetroactiveUpdate(payload) {
	const tx = payload.transaction;
	if (!tx || !tx.target_month) {
		return { success: false, error: 'Missing transaction or target_month' };
	}

	const snapshot = loadJsonFile('summary_snapshot.json');
	const targetMonth = tx.target_month;

	if (snapshot.last_closed_month && targetMonth <= snapshot.last_closed_month) {
		// 1. Update in archive file
		const archiveFileName = `archives/${targetMonth}.json`;
		const archive = loadJsonFile(archiveFileName, { schema_version: 2, transactions: [] });
		const txMap = new Map();
		for (const t of (archive.transactions || [])) {
			txMap.set(t.id, t);
		}
		txMap.set(tx.id, tx);
		archive.transactions = Array.from(txMap.values());
		archive.exported_at = new Date().toISOString();
		saveJsonFile(archiveFileName, archive);

		// 2. Cascade recalculation of snapshots from targetMonth to last_closed_month
		recalculateArchiveCascade(snapshot);
	} else {
		// Future/unclosed month: update in pending_diffs
		const pending = loadJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] });
		const txMap = new Map();
		for (const t of (pending.transactions || [])) {
			txMap.set(t.id, t);
		}
		txMap.set(tx.id, tx);
		pending.transactions = Array.from(txMap.values());
		saveJsonFile('pending_diffs.json', pending);
	}

	const updatedSnapshot = loadJsonFile('summary_snapshot.json');
	return {
		success: true,
		snapshot: updatedSnapshot
	};
}

function recalculateArchiveCascade(snapshot) {
	if (!snapshot || !snapshot.monthly_summaries) return;

	const closedMonths = Object.keys(snapshot.monthly_summaries).sort();
	if (closedMonths.length === 0) return;

	// Find initial starting balance from master or prior month
	let runningBalances = {};
	const master = loadJsonFile('master_config.json', { accounts: [] });
	for (const acc of (master.accounts || [])) {
		runningBalances[acc.id] = acc.initial_balance || 0;
	}

	for (const m of closedMonths) {
		const archive = loadJsonFile(`archives/${m}.json`, { transactions: [] });
		const summary = computeMonthlySummary(archive.transactions || [], runningBalances);
		snapshot.monthly_summaries[m] = summary;
		runningBalances = { ...summary.closing_balances };
	}

	snapshot.account_balances = runningBalances;
	snapshot.calculated_at = new Date().toISOString();
	saveJsonFile('summary_snapshot.json', snapshot);
}

function handleUpdateExternalAssets(payload) {
	const snapshot = loadJsonFile('summary_snapshot.json', { external_assets: [] });
	if (Array.isArray(payload.external_assets)) {
		snapshot.external_assets = payload.external_assets;
		snapshot.calculated_at = new Date().toISOString();
		saveJsonFile('summary_snapshot.json', snapshot);
	}
	return { success: true, snapshot: snapshot };
}

function computeMonthlySummary(transactions, initialBalances = {}) {
	const closingBalances = { ...initialBalances };
	let incomeTotal = 0;
	let expenseTotal = 0;
	const byCategory = {};
	const byActualCategory = {};

	for (const tx of transactions) {
		if (tx.is_deleted) continue;

		const amt = Number(tx.amount) || 0;

		if (tx.type === 'expense') {
			expenseTotal += amt;
			if (tx.account_id) {
				closingBalances[tx.account_id] = (closingBalances[tx.account_id] || 0) - amt;
			}

			// Accounting category
			const cat = tx.category_id || 'cat_unclassified';
			const sub = tx.subcategory_id || 'sub_unclassified';
			if (!byCategory[cat]) byCategory[cat] = { total: 0, by_subcategory: {} };
			byCategory[cat].total += amt;
			byCategory[cat].by_subcategory[sub] = (byCategory[cat].by_subcategory[sub] || 0) + amt;

			// Actual category
			const actCat = tx.actual_category_id || cat;
			const actSub = tx.actual_subcategory_id || sub;
			if (!byActualCategory[actCat]) byActualCategory[actCat] = { total: 0, by_subcategory: {} };
			byActualCategory[actCat].total += amt;
			byActualCategory[actCat].by_subcategory[actSub] = (byActualCategory[actCat].by_subcategory[actSub] || 0) + amt;
		} else if (tx.type === 'income') {
			incomeTotal += amt;
			if (tx.account_id) {
				closingBalances[tx.account_id] = (closingBalances[tx.account_id] || 0) + amt;
			}
		} else if (tx.type === 'transfer') {
			if (tx.account_id) {
				closingBalances[tx.account_id] = (closingBalances[tx.account_id] || 0) - amt;
			}
			if (tx.to_account_id) {
				closingBalances[tx.to_account_id] = (closingBalances[tx.to_account_id] || 0) + amt;
			}
		}
	}

	return {
		income_total: incomeTotal,
		expense_total: expenseTotal,
		net_income: incomeTotal - expenseTotal,
		by_category: byCategory,
		by_actual_category: byActualCategory,
		closing_balances: closingBalances
	};
}

// Export for Node testing environment
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		doGet,
		doPost,
		verifyEd25519,
		pointAdd,
		pointMul,
		recoverX,
		bytesToBigIntLE,
		computeSha512,
		base64ToUint8Array,
		handleAction,
		handlePushDiff,
		handleCloseMonth,
		handleRetroactiveUpdate,
		recalculateArchiveCascade,
		computeMonthlySummary,
		getOrCreateFile,
		getDataFolder,
		getStorageSpreadsheet,
		safeSheetName,
		loadJsonFromSheet,
		saveJsonToSheet,
		initialSetup,
		loadJsonFile,
		saveJsonFile,
		getScriptProp,
		setScriptProp,
		createResponse,
		getRegisteredPublicKeys,
		handleUpdateExternalAssets,
		handleUpdateMaster,
		handleFetchState,
		canonicalJsonStringify
	};
}
