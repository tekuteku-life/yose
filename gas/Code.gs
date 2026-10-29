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
	if (x === _0n && sign === _1n) return null;
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

function isIdentityPoint(point) {
	return modP(point[2]) !== _0n && modP(point[0]) === _0n && modP(point[1] - point[2]) === _0n;
}

function decodePrimeOrderPoint(bytes, rejectIdentity) {
	if (!(bytes instanceof Uint8Array) || bytes.length !== 32) return null;
	const copy = new Uint8Array(bytes), sign = BigInt(copy[31] >> 7);
	copy[31] &= 127;
	const y = bytesToBigIntLE(copy), x = recoverX(y, sign);
	if (x === null) return null;
	const point = [x, y, _1n, modP(x * y)];
	if ((rejectIdentity && isIdentityPoint(point)) || !isIdentityPoint(pointMul(ED25519_L, point))) return null;
	return point;
}

function isValidEd25519PublicKey(bytes) {
	return decodePrimeOrderPoint(bytes, true) !== null;
}

/** Verify canonical Ed25519 points and the signature equation. */
function verifyEd25519(pubKeyBytes, sigBytes, msgBytes) {
	if (!(sigBytes instanceof Uint8Array) || sigBytes.length !== 64) return false;
	const S = bytesToBigIntLE(sigBytes.subarray(32, 64));
	if (S >= ED25519_L) return false;
	const A = decodePrimeOrderPoint(pubKeyBytes, true);
	const R = decodePrimeOrderPoint(sigBytes.subarray(0, 32), false);
	if (!A || !R) return false;
	const kData = new Uint8Array(64 + msgBytes.length);
	kData.set(sigBytes.subarray(0, 32)); kData.set(pubKeyBytes, 32); kData.set(msgBytes, 64);
	const k = bytesToBigIntLE(computeSha512(kData)) % ED25519_L;
	const SB = pointMul(S, ED25519_BASE), R_kA = pointAdd(R, pointMul(k, A));
	return modP(SB[0] * R_kA[2] - R_kA[0] * SB[2]) === _0n && modP(SB[1] * R_kA[2] - R_kA[1] * SB[2]) === _0n;
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
	const name = ss.getName();
	const id = ss.getId();
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
			const active = SpreadsheetApp.getActiveSpreadsheet();
			if (active) return active;
		} catch (e) {}
	}
	return null;
}

function loadJsonFromSheet(sheet, defaultContent = {}) {
	try {
		const lastRow = sheet.getLastRow();
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
	if (!sheet && ss) {
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

let stagedMutationWrites = null;

function loadJsonFile(fileName, defaultContent = {}) {
	if (stagedMutationWrites?.has(fileName)) return JSON.parse(JSON.stringify(stagedMutationWrites.get(fileName)));
	const ss = getStorageSpreadsheet();
	if (ss) {
		const sheetName = safeSheetName(fileName);
		const sheet = ss.getSheetByName(sheetName);
		if (!sheet) {
			return defaultContent;
		}
		if (/^(master_config|summary_snapshot|pending_diffs|replacement_journal|replacement_receipts)\.json$/.test(fileName) || /^archives\//.test(fileName)) {
			try {
				const rows = sheet.getLastRow();
				if (!rows) throw new Error('empty');
				const content = sheet.getRange(1, 1, rows, 1).getValues().map(row => row[0]).join('');
				if (!content.trim()) throw new Error('empty');
				return JSON.parse(content);
			} catch (error) { throw new Error(`保存データ「${fileName}」を読み取れません。原本を保持して処理を中断しました。`); }
		}
		return loadJsonFromSheet(sheet, defaultContent);
	}
	return defaultContent;
}

function saveJsonFile(fileName, data) {
	if (stagedMutationWrites) { stagedMutationWrites.set(fileName, JSON.parse(JSON.stringify(data))); return; }
	const ss = getStorageSpreadsheet();
	if (ss) {
		const sheetName = safeSheetName(fileName);
		let sheet = ss.getSheetByName(sheetName);
		if (!sheet) {
			sheet = ss.insertSheet(sheetName);
		}
		saveJsonToSheet(sheet, data);
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
		return '[' + Array.from(obj, item => {
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

function authUtf8Bytes(text) {
	return typeof Utilities !== 'undefined' && Utilities.newBlob
		? new Uint8Array(Utilities.newBlob(text).getBytes().map(byte => byte < 0 ? byte + 256 : byte))
		: new TextEncoder().encode(text);
}

const AUTH_WINDOW_MS = 300000;
const AUTH_REPLAY_PREFIX = 'AUTH_REPLAY_';
const AUTH_REPLAY_LIMIT = 1024;
const AUTH_ACTIONS = new Set(['push_diff', 'close_month', 'retroactive_update', 'replace_import', 'fetch_state', 'fetch_master', 'update_master', 'update_external_assets']);

function validAuthTime(timestamp, now) {
	return Number.isSafeInteger(timestamp) && timestamp > 0 && Math.abs(now - timestamp) <= AUTH_WINDOW_MS;
}

function decodeAuthBase64(value, size) {
	const pattern = size === 32 ? /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/ : /^[A-Za-z0-9+/]{85}[AQgw]==$/;
	if (typeof value !== 'string' || !pattern.test(value)) return null;
	try {
		const bytes = base64ToUint8Array(value);
		return bytes.length === size ? bytes : null;
	} catch (error) { return null; }
}

function readReplayExpiry(value) {
	if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Authentication replay record is invalid');
	return Number(value);
}

function recordAuthenticatedRequest(signString, timestamp, now) {
	const properties = PropertiesService.getScriptProperties();
	const stored = properties.getProperties();
	if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('Authentication replay storage is unavailable');
	const digest = Array.from(computeSha512(authUtf8Bytes(signString)), byte => byte.toString(16).padStart(2, '0')).join('');
	const key = AUTH_REPLAY_PREFIX + digest;
	const records = Object.entries(stored).filter(([name]) => name.startsWith(AUTH_REPLAY_PREFIX)).map(([name, value]) => {
		if (!/^AUTH_REPLAY_[0-9a-f]{128}$/.test(name)) throw new Error('Authentication replay record is invalid');
		return { key: name, expires: readReplayExpiry(value) };
	});
	const previous = properties.getProperty(key);
	const listed = Object.prototype.hasOwnProperty.call(stored, key) ? stored[key] : null;
	if (previous !== listed) throw new Error('Authentication replay storage reads are inconsistent');
	if (records.some(record => record.key === key && record.expires >= now)) throw new Error('Replay detected: Request already processed');
	const active = records.filter(record => record.expires >= now);
	if (active.length >= AUTH_REPLAY_LIMIT) throw new Error('Authentication replay storage is full; retry after records expire');
	for (const record of records) if (record.expires < now) properties.deleteProperty(record.key);
	const expiry = String(timestamp + AUTH_WINDOW_MS);
	properties.setProperty(key, expiry);
	if (properties.getProperty(key) !== expiry) throw new Error('Authentication replay record could not be confirmed');
}

function doPost(e) {
	let lock = null, acquired = false;
	try {
		if (!e?.postData?.contents) return createResponse({ success: false, error: 'Empty request body' });
		let request;
		try { request = JSON.parse(e.postData.contents); }
		catch (error) { return createResponse({ success: false, error: 'Invalid JSON body' }); }
		if (!request || typeof request !== 'object' || Array.isArray(request)) return createResponse({ success: false, error: 'Invalid request envelope' });
		const { action, timestamp, payload, signature } = request;
		if (action === 'register_initial_key') return createResponse({ success: false, error: 'Public key registration via API is disabled. Configure USER_PUBLIC_KEYS in the GAS project settings before publishing.' });
		if (!AUTH_ACTIONS.has(action)) return createResponse({ success: false, error: 'Unknown action' });
		if (!validAuthTime(timestamp, Date.now())) return createResponse({ success: false, error: 'Timestamp must be a positive safe integer within the allowed window (potential replay attack)' });
		const signatureBytes = decodeAuthBase64(signature, 64);
		if (!signatureBytes) return createResponse({ success: false, error: 'Signature verification failed: Noncanonical Base64 encoding' });
		const publicKeys = getRegisteredPublicKeys();
		if (!publicKeys.length) return createResponse({ success: false, error: 'No public keys registered on server. Configure USER_PUBLIC_KEYS in Script Properties.' });
		const signString = canonicalJsonStringify({ action, timestamp, payload });
		const message = authUtf8Bytes(signString);
		const verifiedKey = publicKeys.find(key => {
			if (typeof key !== 'string') return false;
			const bytes = decodeAuthBase64(key.trim(), 32);
			return bytes && verifyEd25519(bytes, signatureBytes, message);
		});
		if (!verifiedKey) return createResponse({ success: false, error: 'Signature verification failed' });
		// Unauthenticated callers never acquire the business lock or consume receipts.
		try {
			if (typeof LockService === 'undefined') throw new Error('Lock service unavailable');
			lock = LockService.getScriptLock();
			acquired = lock.tryLock(30000);
			if (!acquired) return createResponse({ success: false, error: 'Could not obtain lock: Server is busy' });
		} catch (error) { return createResponse({ success: false, error: 'LockService error: Authentication lock unavailable' }); }
		const now = Date.now();
		if (!validAuthTime(timestamp, now)) return createResponse({ success: false, error: 'Timestamp expired while waiting for lock' });
		if (!getRegisteredPublicKeys().includes(verifiedKey)) return createResponse({ success: false, error: 'Registered public key changed; sign a new request' });
		recordAuthenticatedRequest(signString, timestamp, now);
		return createResponse(handleAction(action, payload));
	} catch (error) {
		return createResponse({ success: false, error: error.message || 'Internal server error' });
	} finally {
		if (acquired) { try { lock.releaseLock(); } catch (error) { /* The committed operation must not be reported as rolled back. */ } }
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
	recoverReplacementImport();
	switch (action) {
		case 'push_diff':
			return handlePushDiff(payload);
		case 'close_month':
			return handleCloseMonth(payload);
		case 'retroactive_update':
			return handleRetroactiveUpdate(payload);
		case 'replace_import':
			return handleReplaceImport(payload);
		case 'fetch_state':
			return handleFetchState();
		case 'fetch_master':
			return { success: true, master_config: sharedMasterConfig(loadJsonFile('master_config.json', { schema_version: 2 })) };
		case 'update_master':
			return handleUpdateMaster(payload);
		case 'update_external_assets':
			return handleUpdateExternalAssets(payload);
		default:
			return { success: false, error: `Unknown action: ${action}` };
	}
}

function readArchives() {
	const ss = getStorageSpreadsheet();
	const months = new Set((ss?.getSheets() || []).map(sheet => sheet.getName()).filter(name => /^arch_\d{4}-\d{2}$/.test(name)).map(name => name.slice(5)));
	for (const file of stagedMutationWrites?.keys() || []) if (/^archives\/\d{4}-\d{2}\.json$/.test(file)) months.add(file.slice(9, 16));
	return [...months].sort().map(month => ({ month, ...loadJsonFile(`archives/${month}.json`, { transactions: [] }) }));
}

function integrityState() {
	return {
		master_config: sharedMasterConfig(loadJsonFile('master_config.json', { schema_version: 2 })),
		transactions: [...loadJsonFile('pending_diffs.json', { transactions: [] }).transactions, ...readArchives().flatMap(archive => archive.transactions || [])],
		summary_snapshot: loadJsonFile('summary_snapshot.json', {})
	};
}

function commitMutationWrites(id, writes) {
	const journal = { id, writes };
	saveJsonFile('replacement_journal.json', journal);
	if (canonicalJsonStringify(loadJsonFile('replacement_journal.json', null)) !== canonicalJsonStringify(journal)) throw new Error('変更の復旧記録を保存できませんでした');
	writeReplacementCommit({ id });
	recoverReplacementImport();
}

function runIntegrityMutation(action, callback) {
	if (stagedMutationWrites) return callback();
	try {
		recoverReplacementImport();
		const before = integrityState();
		stagedMutationWrites = new Map();
		let result, writes;
		try {
			result = callback();
			if (!result?.success) return result;
			const after = integrityState();
			createDataIntegrityValidator().assertChange(before, after, { allowArchivedReferences: ['push_diff', 'retroactive_update', 'close_month'].includes(action) });
			writes = [...stagedMutationWrites].map(([file, data]) => ({ file, data }));
		} finally { stagedMutationWrites = null; }
		if (writes.length) commitMutationWrites(`mutation-${action}-${Date.now()}`, writes);
		return result;
	} catch (error) { return { success: false, error: error.message }; }
}

function transactionContentVersion(transaction) {
	const content = { ...transaction };
	delete content.sync_status; delete content.previous_target_month; delete content.reclose_approved_months;
	return canonicalJsonStringify(content);
}

function storedTransaction(transaction) {
	const stored = { ...transaction };
	delete stored.previous_target_month; delete stored.reclose_approved_months;
	return stored;
}

function transactionTimestamp(transaction) {
	const parsed = typeof transaction?.updated_at === 'string' ? Date.parse(transaction.updated_at) : NaN;
	return Number.isFinite(parsed) ? parsed : 0;
}

function newerTransaction(a, b) {
	return transactionTimestamp(a) > transactionTimestamp(b);
}

function handleFetchState() {
	recoverReplacementImport();
	const archives = readArchives();
	const state = {
		success: true,
		master_config: sharedMasterConfig(loadJsonFile('master_config.json', { schema_version: 2 })),
		snapshot: loadJsonFile('summary_snapshot.json', { schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} }),
		pending_diffs: loadJsonFile('pending_diffs.json', { transactions: [] }).transactions || [],
		archived_transactions: archives.flatMap(archive => archive.transactions || []),
		archive_months: archives.map(archive => archive.month)
	};
	return { ...state, state_version: replacementStateVersion(state) };
}

function replacementStateVersion(state) {
	return canonicalJsonStringify({ master_config: state.master_config, snapshot: state.snapshot, pending_diffs: state.pending_diffs, archived_transactions: state.archived_transactions, archive_months: state.archive_months });
}

function writeReplacementCommit(value) {
	const ss = getStorageSpreadsheet();
	if (!ss) throw new Error('Storage spreadsheet is unavailable');
	const sheet = ss.getSheetByName('replacement_commit') || ss.insertSheet('replacement_commit');
	// A single-cell write is the commit point. Never clear the previous marker first.
	sheet.getRange(1, 1, 1, 1).setValues([[JSON.stringify(value)]]);
}

function recoverReplacementImport() {
	const markerSheet = getStorageSpreadsheet()?.getSheetByName('replacement_commit');
	if (!markerSheet || !markerSheet.getLastRow()) return;
	const marker = loadJsonFromSheet(markerSheet, undefined);
	if (marker === undefined) throw new Error('完全インポートの確定記録を読み取れません。同期を中断しました。');
	if (marker === null) return;
	const journal = loadJsonFile('replacement_journal.json', null);
	if (!journal || journal.id !== marker.id || !Array.isArray(journal.writes)) throw new Error('完全インポートの復旧記録が不正です。同期を中断しました。');
	for (const write of journal.writes) saveJsonFile(write.file, write.data);
	writeReplacementCommit(null);
}

function validateReplacementData(data, current) {
	const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
	const requireValid = (valid, field) => { if (!valid) throw new Error(`完全インポートの形式が不正です: ${field}`); };
	requireValid(object(data) && data.schema_version === 2, 'schema_version');
	const fields = { full_backup: ['transactions', 'master_config', 'summary_snapshot'], transactions: ['transactions'], master_config: ['master_config'], annual_budgets: ['annual_budgets'], summary_snapshot: ['summary_snapshot'] };
	requireValid(Object.hasOwn(fields, data.export_type), 'export_type');
	for (const field of fields[data.export_type]) requireValid(Object.hasOwn(data, field), field);
	for (const field of ['transactions', 'master_config', 'annual_budgets', 'summary_snapshot']) if (Object.hasOwn(data, field)) requireValid(fields[data.export_type].includes(field), `種別外のデータ: ${field}`);
	const has = field => fields[data.export_type].includes(field);
	let config = current.master_config;
	if (has('master_config')) {
		requireValid(object(data.master_config), 'master_config');
		config = sharedMasterConfig(data.master_config);
		for (const field of ['accounts', 'categories', 'recurring_rules', 'holidays']) requireValid(Array.isArray(config[field]), `master_config.${field}`);
	}
	if (has('annual_budgets')) config = { ...config, annual_budgets: data.annual_budgets };
	const snapshot = has('summary_snapshot') ? data.summary_snapshot : current.snapshot;
	const transactions = has('transactions') ? data.transactions : [...current.pending_diffs, ...current.archived_transactions];
	createDataIntegrityValidator().assertChange({}, { master_config: config, transactions, summary_snapshot: snapshot }, { strict: true, allowArchivedReferences: true });
	return { config, snapshot, transactions, replaceTransactions: has('transactions'), replaceMaster: has('master_config') || has('annual_budgets'), replaceSnapshot: has('summary_snapshot') };
}

function handleReplaceImport(payload) {
	try {
		if (!payload || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.import_id || '') || typeof payload.base_version !== 'string') throw new Error('完全インポートの ID または基点が不正です');
		const fingerprint = canonicalJsonStringify(payload.data);
		const receipts = loadJsonFile('replacement_receipts.json', {});
		const previous = Object.hasOwn(receipts, payload.import_id) ? receipts[payload.import_id] : null;
		if (previous) {
			if (previous.fingerprint !== fingerprint) throw new Error('同じ完全インポート ID に異なるデータが指定されています');
			return previous.response;
		}
		const current = handleFetchState();
		if (payload.base_version !== current.state_version) throw new Error('完全インポートの取得後にサーバーデータが変更され競合しました。設定画面で完全インポートを再確認してください。');
		const next = validateReplacementData(payload.data, current);
		const writes = [];
		let importedAt = null;
		if (next.replaceTransactions) {
			const archives = new Map(current.archive_months.map(month => [month, []]));
			const pending = [];
			const currentTransactions = [...current.pending_diffs, ...current.archived_transactions];
			const newestTimestamp = [...currentTransactions, ...next.transactions].reduce((latest, tx) => Math.max(latest, transactionTimestamp(tx)), Date.now());
			importedAt = new Date(newestTimestamp + 1).toISOString();
			const importedIds = new Set(next.transactions.map(tx => tx.id));
			const omitted = new Map();
			for (const tx of currentTransactions) if (!importedIds.has(tx.id) && (!omitted.has(tx.id) || newerTransaction(tx, omitted.get(tx.id)))) omitted.set(tx.id, tx);
			const tombstones = [...omitted.keys()].map(id => ({ id, is_deleted: true }));
			for (const transaction of [...next.transactions, ...tombstones]) {
				const tx = { ...storedTransaction(transaction), updated_at: importedAt, sync_status: 'synced' };
				if (next.snapshot.last_closed_month && tx.target_month <= next.snapshot.last_closed_month) {
					if (!archives.has(tx.target_month)) archives.set(tx.target_month, []);
					archives.get(tx.target_month).push(tx);
				} else pending.push(tx);
			}
			writes.push({ file: 'pending_diffs.json', data: { schema_version: 2, transactions: pending } });
			for (const [month, transactions] of archives) writes.push({ file: `archives/${month}.json`, data: { schema_version: 2, transactions } });
		}
		if (next.replaceMaster) writes.push({ file: 'master_config.json', data: next.config });
		if (next.replaceSnapshot) writes.push({ file: 'summary_snapshot.json', data: next.snapshot });
		else if (next.replaceTransactions || (next.replaceMaster && canonicalJsonStringify((current.master_config.accounts || []).map(account => [account.id, account.initial_balance])) !== canonicalJsonStringify((next.config.accounts || []).map(account => [account.id, account.initial_balance])))) {
			stagedMutationWrites = new Map(writes.map(write => [write.file, write.data]));
			try { recalculateArchiveCascade(JSON.parse(JSON.stringify(next.snapshot)));
				const recalculated = stagedMutationWrites.get('summary_snapshot.json');
				if (recalculated) writes.push({ file: 'summary_snapshot.json', data: recalculated });
			} finally { stagedMutationWrites = null; }
		}
		const acceptedSnapshot = writes.find(write => write.file === 'summary_snapshot.json')?.data || next.snapshot;
		stagedMutationWrites = new Map(writes.map(write => [write.file, write.data]));
		try { createDataIntegrityValidator().assertChange(null, integrityState(), { strict: true, allowArchivedReferences: true }); }
		finally { stagedMutationWrites = null; }
		const response = { success: true, import_id: payload.import_id, master_config: next.config, snapshot: acceptedSnapshot, imported_at: importedAt };
		writes.push({ file: 'replacement_receipts.json', data: { ...receipts, [payload.import_id]: { fingerprint, response } } });
		commitMutationWrites(payload.import_id, writes);
		return response;
	} catch (error) { return { success: false, error: error.message }; }
}

function sharedMasterConfig(config) {
	function assertSafe(value) {
		if (!value || typeof value !== 'object') return;
		for (const key of Object.keys(value)) {
			if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('設定マスタに不正なキーが含まれています');
			assertSafe(value[key]);
		}
	}
	assertSafe(config);
	const shared = {};
	for (const key of ['schema_version', 'accounts', 'categories', 'recurring_rules', 'holidays', 'annual_budgets', 'point_payment_defaults']) if (config[key] !== undefined && !(key === 'point_payment_defaults' && config[key] === null)) shared[key] = config[key];
	return shared;
}

function handleUpdateMaster(payload) {
	return runIntegrityMutation('update_master', () => applyUpdateMaster(payload));
}

function applyUpdateMaster(payload) {
	if (!payload || !payload.master_config) return { success: false, error: 'Missing master_config in payload' };
	if (typeof payload.base_version !== 'string') return { success: false, error: 'Missing base_version; update the app and retry synchronization' };
	try {
		const current = sharedMasterConfig(loadJsonFile('master_config.json', { schema_version: 2 }));
		const next = sharedMasterConfig(payload.master_config);
		if (payload.base_version !== canonicalJsonStringify(current)) return { success: true, master_conflict: true, master_config: current };
		saveJsonFile('master_config.json', next);
		const previousBalances = Object.fromEntries((current.accounts || []).map(account => [account.id, account.initial_balance]));
		const nextBalances = Object.fromEntries((next.accounts || []).map(account => [account.id, account.initial_balance]));
		if (canonicalJsonStringify(previousBalances) !== canonicalJsonStringify(nextBalances)) recalculateArchiveCascade(loadJsonFile('summary_snapshot.json', {}));
		return { success: true, master_config: next, ...(stagedMutationWrites?.has('summary_snapshot.json') ? { snapshot: loadJsonFile('summary_snapshot.json', {}) } : {}) };
	} catch (error) { return { success: false, error: error.message }; }
}

function handlePushDiff(payload) {
	return runIntegrityMutation('push_diff', () => applyPushDiff(payload));
}

function applyPushDiff(payload) {
	if (!payload || !Array.isArray(payload.transactions)) return { success: false, error: 'Missing or invalid transactions in payload' };
	return applyTransactionBatch(payload.transactions);
}

function applyTransactionBatch(transactions) {
	const submittedIds = new Set();
	for (const tx of transactions) {
		if (!tx || typeof tx !== 'object' || !tx.id || submittedIds.has(tx.id)) return { success: false, error: 'Invalid or duplicate transaction ID' };
		submittedIds.add(tx.id);
	}
	const metadataPaths = new Set(transactions.flatMap(tx => [`transactions.${tx.id}.previous_target_month`, `transactions.${tx.id}.reclose_approved_months`]));
	const metadataIssues = dataIntegrity.issues({ transactions }).filter(issue => metadataPaths.has(issue.path));
	if (metadataIssues.length) return { success: false, error: `データ整合性の検証に失敗しました: ${metadataIssues.map(issue => issue.message).join(' / ')}` };
	const pending = loadJsonFile('pending_diffs.json', { transactions: [] });
	const snapshot = loadJsonFile('summary_snapshot.json', { monthly_summaries: {}, account_balances: {} });
	const archives = new Map(readArchives().map(archive => [archive.month, archive]));
	const pendingMap = new Map((pending.transactions || []).map(tx => [tx.id, tx]));
	const archiveMaps = new Map(), current = new Map(), locations = new Map();
	for (const tx of pendingMap.values()) current.set(tx.id, tx);
	for (const [month, archive] of archives) {
		archiveMaps.set(month, new Map(archive.transactions.map(tx => [tx.id, tx])));
		for (const tx of archive.transactions) {
			if (!current.has(tx.id) || newerTransaction(tx, current.get(tx.id))) current.set(tx.id, tx);
			if (!locations.has(tx.id)) locations.set(tx.id, []);
			locations.get(tx.id).push(month);
		}
	}
	const changedArchives = new Set(), accepted = [], conflicts = [];
	for (const tx of transactions) {
		const old = current.get(tx.id);
		if (old && newerTransaction(old, tx)) { conflicts.push(old); continue; }
		const isClosed = snapshot.last_closed_month && tx.target_month <= snapshot.last_closed_month;
		const required = new Set(locations.get(tx.id) || []);
		for (const month of [tx.target_month, tx.previous_target_month]) if (month && snapshot.last_closed_month && month <= snapshot.last_closed_month) required.add(month);
		if ([...required].some(month => !tx.reclose_approved_months?.includes(month))) return { success: false, error: '再月締めの確認が必要です。手動同期で対象月を確認してください。' };
		if (isClosed && !tx.is_deleted && (tx.amount_pending || tx.status !== 'confirmed')) return { success: false, error: '締め済み月には金額入力済みの確定明細が必要です。' };
		for (const month of locations.get(tx.id) || []) { archiveMaps.get(month).delete(tx.id); changedArchives.add(month); }
		pendingMap.delete(tx.id);
		if (isClosed) {
			if (!archiveMaps.has(tx.target_month)) { archives.set(tx.target_month, { transactions: [] }); archiveMaps.set(tx.target_month, new Map()); }
			archiveMaps.get(tx.target_month).set(tx.id, storedTransaction(tx)); changedArchives.add(tx.target_month);
		} else pendingMap.set(tx.id, storedTransaction(tx));
		accepted.push(tx.id);
	}
	for (const month of changedArchives) saveJsonFile(`archives/${month}.json`, { ...archives.get(month), transactions: [...archiveMaps.get(month).values()] });
	if (accepted.length) saveJsonFile('pending_diffs.json', { ...pending, transactions: [...pendingMap.values()], exported_at: new Date().toISOString() });
	if (changedArchives.size) { snapshot.monthly_summaries = snapshot.monthly_summaries || {}; recalculateArchiveCascade(snapshot); }
	return { success: true, updated_count: accepted.length, accepted_ids: accepted, conflicts, snapshot: loadJsonFile('summary_snapshot.json', snapshot) };
}

function handleCloseMonth(payload) {
	return runIntegrityMutation('close_month', () => applyCloseMonth(payload));
}

function applyCloseMonth(payload) {
	const targetMonth = payload?.target_month;
	if (typeof targetMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(targetMonth)) return { success: false, error: 'Invalid target_month' };
	const pending = loadJsonFile('pending_diffs.json', { transactions: [] });
	const snapshot = loadJsonFile('summary_snapshot.json', { account_balances: {}, monthly_summaries: {} });
	const existing = loadJsonFile(`archives/${targetMonth}.json`, { transactions: [] });
	const targets = (pending.transactions || []).filter(tx => tx.target_month === targetMonth);
	const map = new Map((existing.transactions || []).map(tx => [tx.id, tx]));
	for (const tx of targets) map.set(tx.id, tx);
	const records = Array.from(map.values());
	if (records.some(tx => !tx.is_deleted && tx.amount_pending)) return { success: false, error: '金額未入力の予定があります。金額を入力してから月締めしてください。' };
	const planned = records.filter(tx => !tx.is_deleted && tx.status === 'planned');
	const approvals = payload.approved_planned || [];
	if (planned.length !== approvals.length || planned.some(tx => !approvals.some(approval => approval.id === tx.id && approval.version === transactionContentVersion(tx)))) {
		return { success: false, error: '未確定の予定が変更されています。再取得して内容を確認してください。' };
	}
	const closedRecords = records.map(tx => ({ ...tx, status: 'confirmed' }));
	saveJsonFile(`archives/${targetMonth}.json`, { schema_version: 2, exported_at: new Date().toISOString(), transactions: closedRecords });
	pending.transactions = (pending.transactions || []).filter(tx => tx.target_month !== targetMonth);
	saveJsonFile('pending_diffs.json', pending);
	const earlier = Object.keys(snapshot.monthly_summaries || {}).filter(month => month < targetMonth).sort().at(-1);
	let starting = earlier ? snapshot.monthly_summaries[earlier].closing_balances : snapshot.account_balances;
	if (!starting || Object.keys(starting).length === 0) {
		starting = {};
		for (const account of loadJsonFile('master_config.json', { accounts: [] }).accounts || []) starting[account.id] = account.initial_balance || 0;
	}
	if (!snapshot.monthly_summaries) snapshot.monthly_summaries = {};
	snapshot.monthly_summaries[targetMonth] = computeMonthlySummary(closedRecords, starting);
	if (snapshot.last_closed_month && targetMonth <= snapshot.last_closed_month) {
		recalculateArchiveCascade(snapshot);
	} else {
		snapshot.last_closed_month = targetMonth;
		snapshot.account_balances = snapshot.monthly_summaries[targetMonth].closing_balances;
		snapshot.calculated_at = new Date().toISOString(); saveJsonFile('summary_snapshot.json', snapshot);
	}
	return { success: true, snapshot: loadJsonFile('summary_snapshot.json'), archived_count: closedRecords.length, archived_transactions: closedRecords };
}

function handleRetroactiveUpdate(payload) {
	return runIntegrityMutation('retroactive_update', () => applyRetroactiveUpdate(payload));
}

function applyRetroactiveUpdate(payload) {
	const tx = payload?.transaction;
	if (!tx?.id || (!(tx.is_deleted === true && tx.target_month === undefined) && !/^\d{4}-\d{2}$/.test(tx.target_month || ''))) return { success: false, error: 'Missing transaction or target_month' };
	const result = applyTransactionBatch([{ ...tx, ...(Object.hasOwn(payload, 'previous_target_month') ? { previous_target_month: payload.previous_target_month } : {}) }]);
	if (!result.success) return result;
	return { success: true, snapshot: result.snapshot, ...(result.conflicts.length ? { conflict: true, transaction: result.conflicts[0] } : {}) };
}

function recalculateArchiveCascade(snapshot) {
	if (!snapshot || !snapshot.monthly_summaries) return;
	const previousContent = canonicalJsonStringify(snapshot);

	const closedMonths = [...new Set([...Object.keys(snapshot.monthly_summaries), ...readArchives().map(archive => archive.month).filter(month => snapshot.last_closed_month && month <= snapshot.last_closed_month)])].sort();

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
	if (canonicalJsonStringify(snapshot) === previousContent) return;
	snapshot.calculated_at = new Date().toISOString();
	saveJsonFile('summary_snapshot.json', snapshot);
}

function handleUpdateExternalAssets(payload) {
	return runIntegrityMutation('update_external_assets', () => applyUpdateExternalAssets(payload));
}

function applyUpdateExternalAssets(payload) {
	if (!payload || !Array.isArray(payload.external_assets)) return { success: false, error: 'Invalid external_assets' };
	const snapshot = loadJsonFile('summary_snapshot.json', { external_assets: [] });
	if (Array.isArray(payload.external_assets)) {
		snapshot.external_assets = payload.external_assets;
		snapshot.calculated_at = new Date().toISOString();
		saveJsonFile('summary_snapshot.json', snapshot);
	}
	return { success: true, snapshot: snapshot };
}

function computeMonthlySummary(transactions, initialBalances = {}) {
	const own = (map, key) => Object.prototype.hasOwnProperty.call(map, key) ? map[key] : 0;
	const closingBalances = { ...initialBalances };
	let incomeTotal = 0;
	let expenseTotal = 0;
	const byCategory = {};
	const byActualCategory = {};
	const byIncomeCategory = {}, byActualIncomeCategory = {};

	for (const tx of transactions) {
		if (tx.is_deleted) continue;

		const amt = Number(tx.amount) || 0;

		if (tx.type === 'expense') {
			expenseTotal += amt;
			if (tx.account_id) {
				closingBalances[tx.account_id] = own(closingBalances, tx.account_id) - amt;
			}

			// Accounting category
			const cat = tx.category_id || 'cat_unclassified';
			const sub = tx.subcategory_id || 'sub_unclassified';
			if (!own(byCategory, cat)) byCategory[cat] = { total: 0, by_subcategory: {} };
			byCategory[cat].total += amt;
			byCategory[cat].by_subcategory[sub] = own(byCategory[cat].by_subcategory, sub) + amt;

			// Actual category
			const actCat = tx.actual_category_id || cat;
			const actSub = (tx.actual_subcategory_id !== undefined ? tx.actual_subcategory_id : actCat === cat ? tx.subcategory_id : null) || 'sub_unclassified';
			if (!own(byActualCategory, actCat)) byActualCategory[actCat] = { total: 0, by_subcategory: {} };
			byActualCategory[actCat].total += amt;
			byActualCategory[actCat].by_subcategory[actSub] = own(byActualCategory[actCat].by_subcategory, actSub) + amt;
		} else if (tx.type === 'income') {
			incomeTotal += amt;
			const cat = tx.category_id || 'cat_unclassified', sub = tx.subcategory_id || 'sub_unclassified';
			const actualCat = tx.actual_category_id || cat;
			const actualSub = (tx.actual_subcategory_id !== undefined ? tx.actual_subcategory_id : actualCat === cat ? tx.subcategory_id : null) || 'sub_unclassified';
			for (const [map, id, child] of [[byIncomeCategory, cat, sub], [byActualIncomeCategory, actualCat, actualSub]]) {
				if (!own(map, id)) map[id] = { total: 0, by_subcategory: {} };
				map[id].total += amt; map[id].by_subcategory[child] = own(map[id].by_subcategory, child) + amt;
			}

			if (tx.account_id) {
				closingBalances[tx.account_id] = own(closingBalances, tx.account_id) + amt;
			}
		} else if (tx.type === 'transfer') {
			if (tx.account_id) {
				closingBalances[tx.account_id] = own(closingBalances, tx.account_id) - amt;
			}
			if (tx.to_account_id) {
				closingBalances[tx.to_account_id] = own(closingBalances, tx.to_account_id) + amt;
			}
		}
	}

	return {
		income_total: incomeTotal,
		expense_total: expenseTotal,
		net_income: incomeTotal - expenseTotal,
		by_income_category: byIncomeCategory,
		by_actual_income_category: byActualIncomeCategory,
		by_category: byCategory,
		by_actual_category: byActualCategory,
		closing_balances: closingBalances
	};
}

// BEGIN GENERATED DATA INTEGRITY
/** Shared, dependency-free schema and transition checks. Embedded into GAS by script. */
function createDataIntegrityValidator() {
	const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
	const safeId = value => typeof value === 'string' && value.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(value);
	const month = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
	const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
	const accountTypes = ['bank', 'cash', 'credit_card', 'loan', 'point', 'receivable', 'prepaid', 'investment', 'insurance', 'asset', 'electronic_money'];
	const issues = state => {
		const found = [];
		const issue = (code, path, message, value = null) => {
			const encoded = object(value) || Array.isArray(value) ? JSON.stringify(value) : `${typeof value}:${String(value)}`;
			found.push({ code, path, message: `${path}: ${message}`, fingerprint: JSON.stringify([code, path, encoded]) });
		};
		const scan = (value, path, seen = new Set()) => {
			if (!value || typeof value !== 'object') return;
			if (seen.has(value)) { issue('shape', path, '循環参照は保存できません'); return; }
			seen.add(value);
			for (const [key, child] of Object.entries(value)) {
				if (!safeId(key)) issue('unsafe_key', `${path}.${key}`, '不正なキーです', key);
				scan(child, `${path}.${key}`, seen);
			}
			seen.delete(value);
		};
		scan(state, 'data');
		const list = (value, path) => {
			if (value === undefined) return [];
			if (!Array.isArray(value)) { issue('shape', path, '配列である必要があります', typeof value); return []; }
			return value;
		};
		const number = (value, path, { required = false, integer = false, min = -Infinity, max = Infinity } = {}) => {
			if (value == null && !required) return;
			if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) issue('number', path, '数値の形式・範囲が不正です', value);
		};
		const bools = (item, path, fields) => { for (const field of fields) if (item[field] !== undefined && typeof item[field] !== 'boolean') issue('boolean', `${path}.${field}`, '真偽値が必要です', item[field]); };
		const text = (item, path, fields) => { for (const field of fields) if (item[field] != null && typeof item[field] !== 'string') issue('string', `${path}.${field}`, '文字列が必要です', item[field]); };
		const keyed = (value, path) => {
			const map = new Map();
			for (const item of list(value, path)) {
				if (!object(item)) { issue('shape', path, '要素はオブジェクトである必要があります', item); continue; }
				if (!safeId(item.id)) issue('id', `${path}.id`, 'IDが不正です', item.id);
				if (map.has(item.id)) issue('duplicate', `${path}.${item.id}`, 'IDが重複しています', item.id);
				else map.set(item.id, item);
			}
			return map;
		};
		const master = object(state?.master_config) ? state.master_config : {};
		if (state?.master_config != null && !object(state.master_config)) issue('shape', 'master_config', '設定形式が不正です');
		const accounts = keyed(master.accounts, 'accounts');
		const categories = keyed(master.categories, 'categories');
		const rules = keyed(master.recurring_rules, 'recurring_rules');
		const children = new Map();
		for (const [id, item] of categories) children.set(id, keyed(item.subcategories, `categories.${id}.subcategories`));
		const ref = (id, map, path, required = false) => {
			if ((id === undefined || id === null || id === '') && !required) return;
			if (!safeId(id) || !map.has(id)) issue('reference', path, `参照先「${String(id)}」が存在しません`, id);
		};
		const classification = (item, path, expectedType) => {
			for (const prefix of ['', 'actual_']) {
				const cat = item[`${prefix}category_id`], sub = item[`${prefix}subcategory_id`];
				ref(cat, categories, `${path}.${prefix}category_id`);
				ref(sub, children.get(cat) || new Map(), `${path}.${prefix}subcategory_id`);
				if (cat && categories.has(cat) && expectedType && categories.get(cat).type !== expectedType) issue('category_type', `${path}.${prefix}category_id`, '明細種別と費目の収支種別が一致しません', [cat, categories.get(cat).type, expectedType]);
			}
		};
		const point = master.point_payment_defaults;
		if (point != null) {
			if (!object(point) || Object.keys(point).length !== 2 || !Object.hasOwn(point, 'category_id') || !Object.hasOwn(point, 'subcategory_id') || !safeId(point.category_id) || !(point.subcategory_id === null || safeId(point.subcategory_id))) issue('shape', 'point_payment_defaults', 'ポイント相殺の費目と任意の内訳が不正です', point);
			else {
				ref(point.category_id, categories, 'point_payment_defaults.category_id', true);
				ref(point.subcategory_id, children.get(point.category_id) || new Map(), 'point_payment_defaults.subcategory_id');
				if (categories.has(point.category_id) && categories.get(point.category_id).type !== 'income') issue('category_type', 'point_payment_defaults.category_id', 'ポイント相殺には収入費目が必要です', point.category_id);
			}
		}
		for (const [id, item] of accounts) {
			const path = `accounts.${id}`;
			if (!accountTypes.includes(item.type)) issue('enum', `${path}.type`, '口座種別が不正です', item.type);
			text(item, path, ['name', 'maturity_date']);
			bools(item, path, ['is_asset', 'is_archived']);
			number(item.initial_balance, `${path}.initial_balance`, { integer: true });
			if (item.investment_history !== undefined) {
				if (item.type !== 'investment' || !object(item.investment_history)) issue('shape', `${path}.investment_history`, '投資口座の日付別記録が必要です');
				else for (const [day, value] of Object.entries(item.investment_history)) {
					const location = `${path}.investment_history.${day}`;
					if (!date(day)) issue('date', location, '評価日が不正です', day);
					if (!object(value)) { issue('shape', location, '取得原価と評価額が必要です'); continue; }
					if (value.acquisition_cost !== undefined) {
						number(value.acquisition_cost, `${location}.acquisition_cost`, { required: true, integer: true, min: 0 });
						if (value.invested_amount !== undefined) issue('shape', location, '取得原価と旧拠出額は同時に指定できません');
					} else number(value.invested_amount, `${location}.invested_amount`, { required: true, integer: true });
					number(value.market_value, `${location}.market_value`, { required: true, integer: true, min: 0 });
				}
			}
			number(item.maturity_amount, `${path}.maturity_amount`, { integer: true, min: 0 });
			for (const field of ['debit_account_id', 'settlement_account_id', 'premium_pay_account_id']) ref(item[field], accounts, `${path}.${field}`);
			for (const field of ['debit_account_id', 'settlement_account_id']) if (item[field]) {
				const paying = accounts.get(item[field]);
				if (item[field] === id || (paying && !['bank', 'cash', 'asset'].includes(paying.type))) issue('account_role', `${path}.${field}`, '引落先には別の銀行・現金・資産口座が必要です', item[field]);
			}
			if (item.debit_account_id && item.settlement_account_id && item.debit_account_id !== item.settlement_account_id) issue('account_role', `${path}.debit_account_id`, '引落口座の参照が一致しません', [item.debit_account_id, item.settlement_account_id]);
			for (const field of ['closing_day', 'debit_day']) if (item[field] !== 99) number(item[field], `${path}.${field}`, { integer: true, min: 1, max: 31 });
			number(item.premium_day, `${path}.premium_day`, { integer: true, min: 1, max: 31 });
			number(item.debit_month_offset, `${path}.debit_month_offset`, { integer: true, min: 0, max: 2 });
			number(item.premium_amount, `${path}.premium_amount`, { integer: true, min: 0 });
			ref(item.premium_category_id, categories, `${path}.premium_category_id`);
			ref(item.premium_subcategory_id, children.get(item.premium_category_id) || new Map(), `${path}.premium_subcategory_id`);
			if (item.premium_category_id && categories.get(item.premium_category_id)?.type !== 'expense') issue('category_type', `${path}.premium_category_id`, '保険料には支出費目が必要です', item.premium_category_id);
			if (item.maturity_date != null && item.maturity_date !== '' && !date(item.maturity_date)) issue('date', `${path}.maturity_date`, '日付が不正です', item.maturity_date);
		}
		for (const [id, item] of categories) {
			const path = `categories.${id}`;
			if (!['expense', 'income'].includes(item.type)) issue('enum', `${path}.type`, '費目種別が不正です', item.type);
			text(item, path, ['name', 'icon']); bools(item, path, ['is_archived']);
			for (const [subId, sub] of children.get(id)) { text(sub, `${path}.${subId}`, ['name']); bools(sub, `${path}.${subId}`, ['is_archived']); }
		}
		const validateTransaction = (item, path, recurring = false) => {
			const deleted = !recurring && item.is_deleted === true;
			if ((!deleted || item.type !== undefined) && !['expense', 'income', 'transfer'].includes(item.type)) issue('enum', `${path}.type`, '取引種別が不正です', item.type);
			if (!recurring) {
				if ((!deleted || item.date !== undefined) && !date(item.date)) issue('date', `${path}.date`, '日付が不正です', item.date);
				if ((!deleted || item.target_month !== undefined) && !month(item.target_month)) issue('month', `${path}.target_month`, '計上月が不正です', item.target_month);
				if ((!deleted || item.status !== undefined) && !['confirmed', 'planned'].includes(item.status)) issue('enum', `${path}.status`, '明細状態が不正です', item.status);
				if (item.amount_pending === true && (item.status !== 'planned' || item.amount !== 0)) issue('pending', `${path}.amount_pending`, '金額未入力の明細は金額0の予定である必要があります', [item.status, item.amount]);
				if (item.previous_target_month != null && !month(item.previous_target_month)) issue('month', `${path}.previous_target_month`, '移動元月が不正です', item.previous_target_month);
				if (item.reclose_approved_months !== undefined) {
					for (const approved of list(item.reclose_approved_months, `${path}.reclose_approved_months`)) if (!month(approved)) issue('month', `${path}.reclose_approved_months`, '再月締めの承認月が不正です', approved);
				}
			}
			number(item.amount, `${path}.amount`, { required: !deleted || item.amount !== undefined, integer: true, min: 0 });
			bools(item, path, ['is_deleted', 'amount_pending', 'is_active', 'is_payment_record', 'is_point_split']);
			text(item, path, ['memo', 'group_id', 'created_at', 'updated_at']);
			if (deleted && (typeof item.updated_at !== 'string' || !Number.isFinite(Date.parse(item.updated_at)))) issue('timestamp', `${path}.updated_at`, '削除記録には有効な更新日時が必要です', item.updated_at);
			for (const field of ['created_at', 'updated_at']) if (item[field] != null && (typeof item[field] !== 'string' || !Number.isFinite(Date.parse(item[field])))) issue('timestamp', `${path}.${field}`, '日時が不正です', item[field]);
			for (const field of ['tax_meta', 'amortization_meta', 'auto_settlement_meta']) if (item[field] != null && !object(item[field])) issue('shape', `${path}.${field}`, '補助情報はオブジェクトである必要があります', item[field]);
			if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string'))) issue('shape', `${path}.tags`, 'タグは文字列の配列である必要があります', item.tags);
			const amortization = item.amortization_meta;
			if (object(amortization)) {
				const role = amortization.is_payment_record;
				if (role !== undefined && typeof role !== 'boolean') issue('amortization', `${path}.amortization_meta.is_payment_record`, '前払補助情報の役割には真偽値が必要です', role);
				if (item.type !== (role === true ? 'transfer' : 'expense')) issue('amortization', `${path}.amortization_meta.is_payment_record`, '前払親支払は振替、配賦子明細は支出である必要があります', [role, item.type]);
				if (typeof item.group_id !== 'string' || !item.group_id.trim()) issue('amortization', `${path}.group_id`, '前払補助情報には空でないグループIDが必要です', item.group_id);
			}

			if (!item.is_deleted) {
				ref(item.account_id, accounts, `${path}.account_id`, true);
				ref(item.to_account_id, accounts, `${path}.to_account_id`, item.type === 'transfer');
				if (item.type === 'transfer' && item.account_id === item.to_account_id) issue('transfer', `${path}.to_account_id`, '振替元と振替先が同じです', item.to_account_id);
				classification(item, path, ['expense', 'income'].includes(item.type) ? item.type : null);
				const settlement = item.auto_settlement_meta;
				if (object(settlement)) {
					ref(settlement.card_id, accounts, `${path}.auto_settlement_meta.card_id`, true);
					if (accounts.has(settlement.card_id) && accounts.get(settlement.card_id).type !== 'credit_card') issue('account_role', `${path}.auto_settlement_meta.card_id`, '精算先はカード口座である必要があります', settlement.card_id);
					if (item.type !== 'transfer' || item.to_account_id !== settlement.card_id) issue('settlement', `${path}.auto_settlement_meta.card_id`, '精算情報と振替先が一致しません', [item.type, item.to_account_id, settlement.card_id]);
					if (!month(settlement.billing_cycle)) issue('month', `${path}.auto_settlement_meta.billing_cycle`, '請求周期が不正です', settlement.billing_cycle);
					if (settlement.debit_account_id != null) {
						ref(settlement.debit_account_id, accounts, `${path}.auto_settlement_meta.debit_account_id`);
						if (item.account_id !== settlement.debit_account_id) issue('settlement', `${path}.auto_settlement_meta.debit_account_id`, '精算情報と振替元が一致しません', [item.account_id, settlement.debit_account_id]);
					}
				}
			}
		};
		for (const [id, item] of rules) {
			const path = `recurring_rules.${id}`;
			validateTransaction(item, path, true);
			if (item.frequency !== undefined && !['monthly', 'interval_months'].includes(item.frequency)) issue('enum', `${path}.frequency`, '周期が不正です', item.frequency);
			number(item.day_of_month, `${path}.day_of_month`, { integer: true, min: 1, max: 31 });
			number(item.interval_months, `${path}.interval_months`, { integer: true, min: 1 });
			number(item.amortize_months, `${path}.amortize_months`, { integer: true, min: 1 });
			if (item.holiday_adjustment !== undefined && !['none', 'before', 'after'].includes(item.holiday_adjustment)) issue('enum', `${path}.holiday_adjustment`, '休日調整が不正です', item.holiday_adjustment);
			for (const field of ['start_date', 'end_date']) if (item[field] != null && item[field] !== '' && !date(item[field])) issue('date', `${path}.${field}`, '日付が不正です', item[field]);
			if (item.start_date && item.end_date && item.start_date > item.end_date) issue('date', `${path}.end_date`, '終了日が開始日より前です', [item.start_date, item.end_date]);
			if (item.is_active) {
				for (const field of ['account_id', 'to_account_id']) if (accounts.get(item[field])?.is_archived) issue('archived', `${path}.${field}`, '有効な定期設定にアーカイブ口座は使用できません', item[field]);
				for (const prefix of ['', 'actual_']) {
					if (categories.get(item[`${prefix}category_id`])?.is_archived || children.get(item[`${prefix}category_id`])?.get(item[`${prefix}subcategory_id`])?.is_archived) issue('archived', `${path}.${prefix}category_id`, '有効な定期設定にアーカイブ費目は使用できません', [item[`${prefix}category_id`], item[`${prefix}subcategory_id`]]);
				}
			}
		}
		const transactions = list(state?.transactions, 'transactions');
		const transactionMap = keyed(transactions, 'transactions');
		const natural = new Set(), settlements = new Set(), advanceRepayments = new Set();
		for (const item of transactions) {
			if (!object(item)) continue;
			validateTransaction(item, `transactions.${item.id}`);
			if (!item.is_deleted && item.advance_source_id !== undefined && item.advance_source_id !== null) {
				const id = item.advance_source_id, source = transactionMap.get(id);
				const path = `transactions.${item.id}.advance_source_id`;
				const fixed = tx => tx.status === 'confirmed' && !tx.amount_pending && Number.isSafeInteger(tx.amount) && tx.amount > 0 && !tx.amortization_meta && !tx.auto_settlement_meta;
				if (!safeId(id) || id === item.id || item.type !== 'transfer' || item.account_id !== 'acc_receivable' || item.to_account_id === 'acc_receivable' || !fixed(item)) issue('advance_link', path, 'ひも付けには確定済みで金額入力済みの回収振替が必要です。先にひも付けを解除してください', [id, item.type, item.account_id, item.amount, item.status, item.amount_pending]);
				if (source && (source.is_deleted || source.settlement_status === 'settled' || source.type !== 'transfer' || source.to_account_id !== 'acc_receivable' || source.account_id === 'acc_receivable' || source.amount !== item.amount || !fixed(source))) issue('advance_link', path, 'ひも付けた元立替が変更されています。先にひも付けを解除してください', [id, source.type, source.account_id, source.to_account_id, source.amount, source.status, source.is_deleted, source.amount_pending, source.settlement_status]);
				if (advanceRepayments.has(id)) issue('advance_link', path, '同じ立替へのひも付けが重複しています', id);
				advanceRepayments.add(id);
			}
			if (!item.is_deleted && item.recurring_rule_id) {
				const key = JSON.stringify([item.recurring_rule_id, item.target_month]);
				if (natural.has(key)) issue('duplicate_recurring', `transactions.recurring.${key}`, '同じ定期設定と計上月の明細が重複しています', key);
				natural.add(key);
			}
			if (!item.is_deleted && object(item.auto_settlement_meta) && item.auto_settlement_meta.card_id && item.auto_settlement_meta.billing_cycle) {
				const key = JSON.stringify([item.auto_settlement_meta.card_id, item.auto_settlement_meta.billing_cycle]);
				if (settlements.has(key)) issue('duplicate_settlement', `transactions.settlement.${key}`, '同じカードと請求周期の精算明細が重複しています', key);
				settlements.add(key);
			}
		}
		if (master.holidays !== undefined) for (const day of list(master.holidays, 'holidays')) if (!date(day)) issue('date', 'holidays', '祝日の日付が不正です', day);
		if (master.annual_budgets !== undefined && !object(master.annual_budgets)) issue('shape', 'annual_budgets', '予算は年度別のオブジェクトが必要です');
		for (const [year, entry] of Object.entries(object(master.annual_budgets) ? master.annual_budgets : {})) {
			const path = `annual_budgets.${year}`;
			if (!/^\d{4}$/.test(year) || !object(entry)) { issue('shape', path, '年度予算の形式が不正です', year); continue; }
			if (entry.goal_basis !== undefined && !['independent', 'rate', 'savings', 'expense'].includes(entry.goal_basis)) issue('enum', `${path}.goal_basis`, '目標の基準が不正です', entry.goal_basis);
			for (const field of ['expense_budget', 'savings_target_amount']) number(entry[field], `${path}.${field}`, { integer: true, min: 0 });
			if (entry.furusato_estimate !== undefined) {
				const estimate = entry.furusato_estimate;
				if (!object(estimate)) issue('shape', `${path}.furusato_estimate`, '税概算には所得割額と税率が必要です');
				else {
					number(estimate.resident_tax, `${path}.furusato_estimate.resident_tax`, { required: true, integer: true, min: 0 });
					if (![0, 5, 10, 20, 23, 33, 40, 45].includes(estimate.income_tax_rate)) issue('enum', `${path}.furusato_estimate.income_tax_rate`, '特例控除用税率が不正です', estimate.income_tax_rate);
				}
			}
			if (entry.furusato_sources !== undefined) {
				const sourcePath = `${path}.furusato_sources`, sources = entry.furusato_sources;
				if (!object(sources)) issue('shape', sourcePath, '給与・税・保険の集計元が必要です');
				else {
					const selected = [];
					for (const [field, values] of Object.entries(sources)) {
						const location = `${sourcePath}.${field}`;
						if (!['salary', 'other_income', 'social_insurance', 'other_deductions', 'personal_gap', 'other_gap', 'salary_deduction', 'resident_basic', 'income_basic', 'adjustment_credit', 'life_general_new', 'life_general_old', 'life_care', 'life_pension_new', 'life_pension_old', 'donation', 'income_tax', 'resident_tax'].includes(field)) { issue('shape', location, '集計項目が不正です'); continue; }
						for (const value of list(values, location)) {
							if (!object(value)) { issue('shape', location, '計上費目と中項目の参照が必要です'); continue; }
							ref(value.category_id, categories, `${location}.category_id`, true);
							if (value.subcategory_id !== null) ref(value.subcategory_id, children.get(value.category_id) || new Map(), `${location}.subcategory_id`, true);
							const category = categories.get(value.category_id);
							if (category && category.type !== (['salary', 'other_income'].includes(field) ? 'income' : 'expense')) issue('category_type', location, '集計項目と費目の収支種別が一致しません', value.category_id);
							if (selected.some(other => other.field !== field && other.category_id === value.category_id && (other.subcategory_id === null || value.subcategory_id === null || other.subcategory_id === value.subcategory_id))) issue('shape', sourcePath, '異なる集計項目に同じ費目・中項目を重複指定できません');
							selected.push({ ...value, field });
						}
					}
				}
			}
			if (entry.furusato_calculation !== undefined) {
				const p = `${path}.furusato_calculation`, calc = entry.furusato_calculation;
				if (!object(calc)) issue('shape', p, '税計算の設定が必要です');
				else {
					const fields = ['salary', 'other_income', 'social_insurance', 'other_deductions', 'personal_gap', 'other_gap', 'salary_deduction', 'resident_basic', 'income_basic', 'adjustment_credit', 'life_general_new', 'life_general_old', 'life_care', 'life_pension_new', 'life_pension_old', 'donation', 'income_tax', 'resident_tax'];
					const autos = ['salary_deduction', 'resident_basic', 'income_basic', 'adjustment_credit'];
					for (const key of Object.keys(calc)) if (!['mode', 'base_year', 'tax_status', 'input_modes', 'manual', 'life_enabled', 'young_dependent', 'housing', 'ledger_confirmation'].includes(key)) issue('shape', `${p}.${key}`, '税計算の設定項目が不正です');
					if (!['income', 'notice'].includes(calc.mode)) issue('enum', `${p}.mode`, '計算方式が不正です');
					number(calc.base_year, `${p}.base_year`, { required: true, integer: true, min: 1900, max: 9999 });
					if (!['unknown', 'taxable', 'exempt'].includes(calc.tax_status)) issue('enum', `${p}.tax_status`, '課税区分が不正です');
					if (calc.ledger_confirmation !== undefined && (typeof calc.ledger_confirmation !== 'string' || !/^[a-f0-9]{64}$/.test(calc.ledger_confirmation))) issue('shape', `${p}.ledger_confirmation`, '年額確認の形式が不正です');
					for (const flag of ['life_enabled', 'young_dependent']) if (typeof calc[flag] !== 'boolean') issue('boolean', `${p}.${flag}`, '真偽値が必要です');
					for (const kind of ['manual', 'input_modes']) {
						if (!object(calc[kind])) { issue('shape', `${p}.${kind}`, '項目別の設定が必要です'); continue; }
						for (const [field, value] of Object.entries(calc[kind])) {
							if (!fields.includes(field)) { issue('shape', `${p}.${kind}.${field}`, '計算項目が不正です'); continue; }
							if (kind === 'manual') number(value, `${p}.manual.${field}`, { required: true, integer: true, min: field === 'other_gap' ? -Number.MAX_SAFE_INTEGER : 0 });
							else if (!['ledger', 'manual', ...(autos.includes(field) ? ['auto'] : []), ...(field === 'donation' ? ['legacy'] : [])].includes(value)) issue('enum', `${p}.input_modes.${field}`, '採用方法が不正です');
						}
					}
					const h = calc.housing, hp = `${p}.housing`;
					if (!object(h)) issue('shape', hp, '住宅控除の設定が必要です');
					else {
						for (const key of Object.keys(h)) if (!['enabled', 'applicable', 'first_year', 'balance', 'price', 'limit', 'rate', 'method', 'carry_rate', 'carry_limit'].includes(key)) issue('shape', `${hp}.${key}`, '住宅控除の設定項目が不正です');
						if (typeof h.enabled !== 'boolean') issue('boolean', `${hp}.enabled`, '真偽値が必要です');
						bools(h, hp, ['applicable', 'first_year']);
						const required = h.enabled && h.applicable !== false;
						if (required && typeof h.applicable !== 'boolean') issue('boolean', `${hp}.applicable`, '適用確認が必要です');
						for (const field of ['balance', 'price', 'limit']) number(h[field], `${hp}.${field}`, { required, integer: true, min: 0 });
						number(h.rate, `${hp}.rate`, { required, min: 0, max: 2 });
						if ((required || h.method !== undefined) && !['one_stop', 'return'].includes(h.method)) issue('enum', `${hp}.method`, '申告方式が不正です');
						if ((required || h.carry_rate !== undefined || h.carry_limit !== undefined) && !((h.carry_rate === 5 && h.carry_limit === 97500) || (h.carry_rate === 7 && h.carry_limit === 136500))) issue('enum', `${hp}.carry_rate`, '住宅控除の移行区分が不正です');
					}
				}
			}
			for (const field of ['savings_target_rate', 'target_savings_rate']) number(entry[field], `${path}.${field}`, { min: 0, max: 100 });
			if (entry.category_budgets !== undefined && !object(entry.category_budgets)) issue('shape', `${path}.category_budgets`, '費目予算の形式が不正です');
			for (const [id, value] of Object.entries(object(entry.category_budgets) ? entry.category_budgets : {})) { ref(id, categories, `${path}.${id}`); number(value, `${path}.${id}`, { integer: true, min: 0 }); }
		}
		const snapshot = state?.summary_snapshot === undefined ? {} : state.summary_snapshot;
		if (!object(snapshot)) issue('shape', 'summary_snapshot', '集計形式が不正です');
		else {
			if (snapshot.last_closed_month != null && !month(snapshot.last_closed_month)) issue('month', 'summary_snapshot.last_closed_month', '締め月が不正です', snapshot.last_closed_month);
			const numberMap = (value, path, refs = null) => {
				if (value === undefined) return;
				if (!object(value)) { issue('shape', path, '数値マップが必要です'); return; }
				for (const [id, amount] of Object.entries(value)) { if (refs) ref(id, refs, `${path}.${id}`); number(amount, `${path}.${id}`, { required: true }); }
			};
			const categoryMap = (value, path) => {
				if (value === undefined) return;
				if (!object(value)) { issue('shape', path, '費目集計マップが必要です'); return; }
				for (const [id, summary] of Object.entries(value)) {
					if (id !== 'cat_unclassified') ref(id, categories, `${path}.${id}`);
					if (typeof summary === 'number') { number(summary, `${path}.${id}`, { required: true }); continue; }
					if (!object(summary)) { issue('shape', `${path}.${id}`, '費目集計が不正です'); continue; }
					for (const field of ['total', 'confirmed', 'planned', 'total_confirmed', 'total_planned']) number(summary[field], `${path}.${id}.${field}`);
					const subs = new Map(children.get(id) || []); subs.set('sub_unclassified', {});
					numberMap(summary.by_subcategory, `${path}.${id}.by_subcategory`, subs);
				}
			};
			numberMap(snapshot.account_balances, 'summary_snapshot.account_balances', accounts);
			if (snapshot.monthly_summaries !== undefined && !object(snapshot.monthly_summaries)) issue('shape', 'summary_snapshot.monthly_summaries', '月別集計マップが必要です');
			for (const [key, summary] of Object.entries(object(snapshot.monthly_summaries) ? snapshot.monthly_summaries : {})) {
				const path = `summary_snapshot.monthly_summaries.${key}`;
				if (!month(key) || !object(summary)) { issue('shape', path, '月別集計の形式が不正です', key); continue; }
				for (const field of ['income_total', 'expense_total', 'net_income', 'income_confirmed', 'expense_confirmed', 'total_income', 'total_expense']) number(summary[field], `${path}.${field}`);
				numberMap(summary.closing_balances, `${path}.closing_balances`, accounts);
				categoryMap(summary.by_category, `${path}.by_category`); categoryMap(summary.by_actual_category, `${path}.by_actual_category`);
				if (summary.by_income_category !== undefined || summary.by_actual_income_category !== undefined) {
					number(summary.income_total, `${path}.income_total`, { required: true, integer: true, min: 0 });
					for (const field of ['by_income_category', 'by_actual_income_category']) {
						const map = summary[field], location = `${path}.${field}`;
						if (!object(map)) { issue('shape', location, '収入費目・内訳の集計マップが必要です'); continue; }
						let total = 0;
						for (const [id, item] of Object.entries(map)) {
							const p = `${location}.${id}`;
							if (id !== 'cat_unclassified') {
								ref(id, categories, p, true);
								if (categories.has(id) && categories.get(id).type !== 'income') issue('category_type', p, '収入費目が必要です', id);
							}
							if (!object(item) || !object(item.by_subcategory)) { issue('shape', p, '収入合計と内訳が必要です'); continue; }
							number(item.total, `${p}.total`, { required: true, integer: true, min: 0 });
							let subtotal = 0;
							for (const [sub, amount] of Object.entries(item.by_subcategory)) {
								if (sub !== 'sub_unclassified') ref(sub, children.get(id) || new Map(), `${p}.by_subcategory.${sub}`, true);
								number(amount, `${p}.by_subcategory.${sub}`, { required: true, integer: true, min: 0 }); subtotal += amount;
								if (!Number.isSafeInteger(subtotal)) issue('number', p, '収入内訳の加算範囲を超えています');
							}
							if (subtotal !== item.total) issue('sum', p, '収入内訳と費目合計が一致しません');
							total += item.total;
							if (!Number.isSafeInteger(total)) issue('number', location, '収入合計の加算範囲を超えています');
						}
						if (total !== summary.income_total) issue('sum', location, '収入費目の合計と収入総額が一致しません');
					}
				}

			}
			if (snapshot.external_assets !== undefined) for (const item of keyed(snapshot.external_assets, 'external_assets').values()) {
				if (!object(item)) { issue('shape', 'external_assets', '資産の形式が不正です'); continue; }
				text(item, 'external_assets', ['id', 'name', 'updated_at']);
				for (const field of ['amount', 'value', 'balance', 'quantity', 'unit_price', 'market_value', 'current_value']) number(item[field], `external_assets.${field}`);
			}
		}
		return found;
	};
	const assertChange = (before, after, { strict = false, allowArchivedReferences = false } = {}) => {
		const allowed = new Map();
		if (!strict) for (const item of issues(before)) allowed.set(item.fingerprint, (allowed.get(item.fingerprint) || 0) + 1);
		const violations = [];
		for (const item of issues(after)) {
			const count = allowed.get(item.fingerprint) || 0;
			if (count > 0) allowed.set(item.fingerprint, count - 1); else violations.push(item);
		}
		if (!allowArchivedReferences) {
			const rows = value => Array.isArray(value) ? value.filter(object) : [];
			const master = after?.master_config || {}, previous = new Map(rows(before?.transactions).map(tx => [tx.id, tx]));
			const accounts = new Map(rows(master.accounts).map(item => [item.id, item]));
			const categories = new Map(rows(master.categories).map(item => [item.id, item]));
			const defaults = master.point_payment_defaults;
			const oldDefaults = before?.master_config?.point_payment_defaults;
			if (defaults && (defaults.category_id !== oldDefaults?.category_id || (defaults.subcategory_id ?? null) !== (oldDefaults?.subcategory_id ?? null))) {
				const parent = categories.get(defaults.category_id);
				if (parent?.is_archived || rows(parent?.subcategories).find(sub => sub.id === defaults.subcategory_id)?.is_archived) violations.push({ message: 'point_payment_defaults: アーカイブされた既定分類は選択できません' });
			}
			for (const tx of rows(after?.transactions)) {
				if (!object(tx) || tx.is_deleted) continue;
				const old = previous.get(tx.id);
				for (const field of ['account_id', 'to_account_id', 'category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id']) {
					if (old && !old.is_deleted && old[field] === tx[field]) continue;
					const parent = categories.get(tx[field.startsWith('actual_') ? 'actual_category_id' : 'category_id']);
					const archived = field.endsWith('account_id') ? accounts.get(tx[field])?.is_archived : field.endsWith('subcategory_id') ? parent?.is_archived || rows(parent?.subcategories).find(sub => sub.id === tx[field])?.is_archived : categories.get(tx[field])?.is_archived;
					if (tx[field] && archived) violations.push({ message: `transactions.${tx.id}.${field}: アーカイブされた設定を新たに使用できません` });
				}
			}
		}
		if (violations.length) throw new Error(`データ整合性の検証に失敗しました: ${violations.map(item => item.message).slice(0, 12).join(' / ')}`);
		return after;
	};
	return { issues, assertChange };
}

const dataIntegrity = createDataIntegrityValidator();
// END GENERATED DATA INTEGRITY

// Export for Node testing environment
if (typeof module !== 'undefined' && module.exports) {
	module.exports = {
		doGet,
		doPost,
		verifyEd25519,
		isValidEd25519PublicKey,
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
