/**
 * Yoseatsume Kakeibo - Web Crypto API (Ed25519 & PIN Encryption)
 */

export function getSubtle(cryptoObj = globalThis.crypto) {
	const s = cryptoObj?.subtle || null;
	if (!s) throw new Error('Web Crypto subtle is not available in this environment');
	return s;
}

export function getRandomValues(array, cryptoObj = globalThis.crypto) {
	if (!cryptoObj?.getRandomValues) throw new Error('Web Crypto getRandomValues is not available');
	return cryptoObj.getRandomValues(array);
}

/**
 * Convert Uint8Array to Base64 string safely
 */
export function bytesToBase64(bytes) {
	if (!(bytes instanceof Uint8Array)) {
		bytes = new Uint8Array(bytes);
	}
	let binary = '';
	const len = bytes.byteLength;
	const chunkSize = 8192;
	for (let i = 0; i < len; i += chunkSize) {
		const chunk = bytes.subarray(i, Math.min(i + chunkSize, len));
		binary += String.fromCharCode.apply(null, chunk);
	}
	return btoa(binary);
}

/**
 * Convert Base64 string to Uint8Array
 */
export function base64ToBytes(base64) {
	const binary = atob(base64.trim());
	const len = binary.length;
	const bytes = new Uint8Array(len);
	for (let i = 0; i < len; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

/**
 * Generate Ed25519 Key Pair
 */
export async function generateEd25519KeyPair() {
	const subtle = getSubtle();
	return await subtle.generateKey(
		{ name: 'Ed25519' },
		true,
		['sign', 'verify']
	);
}

/**
 * Export Ed25519 Public Key to Base64 string (raw 32 bytes)
 */
export async function exportPublicKeyBase64(publicKey) {
	const subtle = getSubtle();
	const raw = await subtle.exportKey('raw', publicKey);
	return bytesToBase64(raw);
}

/**
 * Import Ed25519 Public Key from Base64 string (raw 32 bytes)
 */
export async function importPublicKeyBase64(base64) {
	const subtle = getSubtle();
	const bytes = base64ToBytes(base64);
	return await subtle.importKey(
		'raw',
		bytes,
		{ name: 'Ed25519' },
		true,
		['verify']
	);
}

/**
 * Export Private Key to PKCS#8 bytes
 */
export async function exportPrivateKeyPkcs8(privateKey) {
	const subtle = getSubtle();
	const pkcs8 = await subtle.exportKey('pkcs8', privateKey);
	return new Uint8Array(pkcs8);
}

/**
 * Import Private Key from PKCS#8 bytes
 */
export async function importPrivateKeyPkcs8(pkcs8Bytes) {
	const subtle = getSubtle();
	return await subtle.importKey(
		'pkcs8',
		pkcs8Bytes,
		{ name: 'Ed25519' },
		true,
		['sign']
	);
}

/**
 * Sign data string with Ed25519 private key
 * @returns {Promise<string>} Base64 signature
 */
export async function signPayload(privateKey, dataString) {
	const subtle = getSubtle();
	const encoder = new TextEncoder();
	const dataBytes = encoder.encode(dataString);
	const sigBuffer = await subtle.sign(
		{ name: 'Ed25519' },
		privateKey,
		dataBytes
	);
	return bytesToBase64(sigBuffer);
}

/**
 * Verify Ed25519 signature
 * @returns {Promise<boolean>}
 */
export async function verifySignature(publicKey, signatureBase64, dataString) {
	try {
		const subtle = getSubtle();
		const encoder = new TextEncoder();
		const dataBytes = encoder.encode(dataString);
		const sigBytes = base64ToBytes(signatureBase64);
		return await subtle.verify(
			{ name: 'Ed25519' },
			publicKey,
			sigBytes,
			dataBytes
		);
	} catch (err) {
		return false;
	}
}

/**
 * Derive AES-GCM Key from PIN using PBKDF2 (SHA-256, 100,000 iterations)
 */
export async function deriveKeyFromPin(pin, saltBytes) {
	const subtle = getSubtle();
	const encoder = new TextEncoder();
	const keyMaterial = await subtle.importKey(
		'raw',
		encoder.encode(String(pin)),
		{ name: 'PBKDF2' },
		false,
		['deriveKey']
	);

	return await subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: saltBytes,
			iterations: 100000,
			hash: 'SHA-256'
		},
		keyMaterial,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/**
 * Encrypt Ed25519 Private Key with PIN
 * @returns {Promise<{ ciphertext: string, iv: string, salt: string }>}
 */
export async function encryptPrivateKeyWithPin(privateKey, pin) {
	const salt = getRandomValues(new Uint8Array(16));
	const iv = getRandomValues(new Uint8Array(12));
	const aesKey = await deriveKeyFromPin(pin, salt);

	const pkcs8Bytes = await exportPrivateKeyPkcs8(privateKey);
	const subtle = getSubtle();
	const cipherBuffer = await subtle.encrypt(
		{ name: 'AES-GCM', iv },
		aesKey,
		pkcs8Bytes
	);

	return {
		ciphertext: bytesToBase64(cipherBuffer),
		iv: bytesToBase64(iv),
		salt: bytesToBase64(salt)
	};
}

/**
 * Decrypt Ed25519 Private Key with PIN
 * @returns {Promise<CryptoKey>}
 */
export async function decryptPrivateKeyWithPin(encryptedData, pin) {
	const { ciphertext, iv, salt } = encryptedData;
	const saltBytes = base64ToBytes(salt);
	const ivBytes = base64ToBytes(iv);
	const cipherBytes = base64ToBytes(ciphertext);

	const aesKey = await deriveKeyFromPin(pin, saltBytes);
	try {
		const subtle = getSubtle();
		const decryptedBuffer = await subtle.decrypt(
			{ name: 'AES-GCM', iv: ivBytes },
			aesKey,
			cipherBytes
		);
		return await importPrivateKeyPkcs8(new Uint8Array(decryptedBuffer));
	} catch (err) {
		throw new Error('PIN decryption failed: Invalid PIN or corrupted data');
	}
}

/**
 * Canonical JSON serialization with deterministically sorted object keys
 * @param {any} obj
 * @returns {string}
 */
export function canonicalJsonStringify(obj) {
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

/**
 * Build canonical string representation for signing
 */
export function buildSignString(action, timestamp, payload) {
	return canonicalJsonStringify({
		action,
		timestamp,
		payload
	});
}

/**
 * Create a signed request envelope
 * @param {string} action
 * @param {any} payload
 * @param {CryptoKey} privateKey
 * @param {number} [customTimestamp]
 * @returns {Promise<{ action: string, timestamp: number, payload: any, signature: string }>}
 */
export async function createSignedRequest(action, payload, privateKey, customTimestamp = null) {
	const timestamp = customTimestamp !== null ? customTimestamp : Date.now();
	const signString = buildSignString(action, timestamp, payload);
	const signature = await signPayload(privateKey, signString);

	return {
		action,
		timestamp,
		payload,
		signature
	};
}

/**
 * Check if request timestamp is within acceptable skew (default 5 min = 300,000 ms)
 */
export function isTimestampValid(timestamp, currentTime = Date.now(), maxSkewMs = 300000) {
	if (typeof timestamp !== 'number' || isNaN(timestamp)) {
		return false;
	}
	return Math.abs(currentTime - timestamp) <= maxSkewMs;
}

/**
 * Verify a signed request envelope
 * @param {Record<string, any>} requestEnvelope - { action, timestamp, payload, signature }
 * @param {CryptoKey} publicKey
 * @param {number} [currentTime]
 * @param {number} [maxSkewMs]
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
export async function verifySignedRequest(
	requestEnvelope,
	publicKey,
	currentTime = Date.now(),
	maxSkewMs = 300000
) {
	if (!requestEnvelope || !requestEnvelope.signature) {
		return { valid: false, error: 'Missing signature' };
	}

	if (!isTimestampValid(requestEnvelope.timestamp, currentTime, maxSkewMs)) {
		return { valid: false, error: 'Timestamp skew exceeds allowed window (potential replay attack)' };
	}

	const signString = buildSignString(
		requestEnvelope.action,
		requestEnvelope.timestamp,
		requestEnvelope.payload
	);

	const isValid = await verifySignature(publicKey, requestEnvelope.signature, signString);
	if (!isValid) {
		return { valid: false, error: 'Invalid digital signature' };
	}

	return { valid: true };
}

/**
 * Generate 256-bit AES-GCM Database Master Key (DMK)
 * @returns {Promise<CryptoKey>}
 */
export async function generateDatabaseMasterKey() {
	const subtle = getSubtle();
	return await subtle.generateKey(
		{ name: 'AES-GCM', length: 256 },
		true,
		['encrypt', 'decrypt']
	);
}

/**
 * Export raw symmetric key bytes
 */
export async function exportKeyRaw(key) {
	const subtle = getSubtle();
	const raw = await subtle.exportKey('raw', key);
	return new Uint8Array(raw);
}

/**
 * Import raw symmetric key bytes as AES-GCM CryptoKey
 */
export async function importAesKeyRaw(rawBytes) {
	const subtle = getSubtle();
	return await subtle.importKey(
		'raw',
		rawBytes,
		{ name: 'AES-GCM' },
		true,
		['encrypt', 'decrypt']
	);
}

/**
 * Encrypt arbitrary JS object at-rest with AES-GCM-256
 * @param {object} obj
 * @param {CryptoKey} aesKey
 * @returns {Promise<{ ciphertext: string, iv: string }>}
 */
export async function encryptObject(obj, aesKey) {
	const subtle = getSubtle();
	const iv = getRandomValues(new Uint8Array(12));
	const plaintextBytes = new TextEncoder().encode(JSON.stringify(obj));
	const encryptedBuffer = await subtle.encrypt(
		{ name: 'AES-GCM', iv },
		aesKey,
		plaintextBytes
	);

	return {
		ciphertext: bytesToBase64(encryptedBuffer),
		iv: bytesToBase64(iv)
	};
}

/**
 * Decrypt at-rest AES-GCM-256 object
 * @param {{ ciphertext: string, iv: string }} encryptedData
 * @param {CryptoKey} aesKey
 * @returns {Promise<any>}
 */
export async function decryptObject(encryptedData, aesKey) {
	if (!encryptedData || !encryptedData.ciphertext || !encryptedData.iv) {
		throw new Error('Invalid encrypted object payload');
	}
	const subtle = getSubtle();
	const ivBytes = base64ToBytes(encryptedData.iv);
	const cipherBytes = base64ToBytes(encryptedData.ciphertext);

	try {
		const decryptedBuffer = await subtle.decrypt(
			{ name: 'AES-GCM', iv: ivBytes },
			aesKey,
			cipherBytes
		);
		const jsonStr = new TextDecoder().decode(decryptedBuffer);
		return JSON.parse(jsonStr);
	} catch (err) {
		throw new Error('At-rest decryption failed: Authentication tag mismatch or corrupted data');
	}
}

/**
 * Wrap both DMK and Ed25519 Private Key using user PIN
 * @param {{ dmkRaw: Uint8Array, privateKeyPkcs8: Uint8Array }} keys
 * @param {string} pin
 * @returns {Promise<{ ciphertext: string, iv: string, salt: string }>}
 */
export async function encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8 }, pin) {
	const salt = getRandomValues(new Uint8Array(16));
	const iv = getRandomValues(new Uint8Array(12));
	const pinKey = await deriveKeyFromPin(pin, salt);

	const payload = JSON.stringify({
		dmk: bytesToBase64(dmkRaw),
		privateKey: bytesToBase64(privateKeyPkcs8)
	});

	const subtle = getSubtle();
	const encryptedBuffer = await subtle.encrypt(
		{ name: 'AES-GCM', iv },
		pinKey,
		new TextEncoder().encode(payload)
	);

	return {
		ciphertext: bytesToBase64(encryptedBuffer),
		iv: bytesToBase64(iv),
		salt: bytesToBase64(salt)
	};
}

/**
 * Unwrap DMK and Ed25519 Private Key using user PIN
 * @param {{ ciphertext: string, iv: string, salt: string }} wrappedKeys
 * @param {string} pin
 * @returns {Promise<{ dmkRaw: Uint8Array, privateKeyPkcs8: Uint8Array }>}
 */
export async function decryptMasterKeysWithPin(wrappedKeys, pin) {
	const { ciphertext, iv, salt } = wrappedKeys;
	const saltBytes = base64ToBytes(salt);
	const ivBytes = base64ToBytes(iv);
	const cipherBytes = base64ToBytes(ciphertext);

	const pinKey = await deriveKeyFromPin(pin, saltBytes);
	const subtle = getSubtle();

	try {
		const decryptedBuffer = await subtle.decrypt(
			{ name: 'AES-GCM', iv: ivBytes },
			pinKey,
			cipherBytes
		);
		const jsonStr = new TextDecoder().decode(decryptedBuffer);
		const parsed = JSON.parse(jsonStr);
		return {
			dmkRaw: base64ToBytes(parsed.dmk),
			privateKeyPkcs8: base64ToBytes(parsed.privateKey)
		};
	} catch (err) {
		throw new Error('PIN decryption failed: Invalid PIN or corrupted key data');
	}
}

// The PRF is never persisted. A separate HKDF key and authenticated context protect this device's key bundle.
async function prfWrappingKey(output, salt) {
	if (!(output instanceof Uint8Array) || output.byteLength !== 32 || salt.byteLength !== 32) throw new Error('PRF鍵の形式が正しくありません。');
	const subtle = getSubtle();
	const material = await subtle.importKey('raw', Uint8Array.from(output).buffer, 'HKDF', false, ['deriveKey']);
	return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('yose/passkey/master-keys/v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function prfContext(credential) {
	return new TextEncoder().encode(canonicalJsonStringify({ version: 1, credentialId: credential.credentialId, rpId: credential.rpId, origin: credential.origin, prfSalt: credential.prfSalt }));
}

export async function encryptMasterKeysWithPrf({ dmkRaw, privateKeyPkcs8 }, output, credential) {
	const salt = getRandomValues(new Uint8Array(32)), iv = getRandomValues(new Uint8Array(12));
	const key = await prfWrappingKey(output, salt);
	const plaintext = new TextEncoder().encode(JSON.stringify({ dmk: bytesToBase64(dmkRaw), privateKey: bytesToBase64(privateKeyPkcs8) }));
	try {
		const ciphertext = await getSubtle().encrypt({ name: 'AES-GCM', iv, additionalData: prfContext(credential) }, key, plaintext);
		return { version: 1, salt: bytesToBase64(salt), iv: bytesToBase64(iv), ciphertext: bytesToBase64(ciphertext) };
	} finally { plaintext.fill(0); }
}

export async function decryptMasterKeysWithPrf(wrapped, output, credential) {
	if (wrapped?.version !== 1) throw new Error('パスキーの再登録が必要です。');
	const salt = base64ToBytes(wrapped.salt), iv = base64ToBytes(wrapped.iv);
	if (iv.byteLength !== 12) throw new Error('パスキー暗号化情報が正しくありません。');
	const key = await prfWrappingKey(output, salt);
	const plaintext = new Uint8Array(await getSubtle().decrypt({ name: 'AES-GCM', iv, additionalData: prfContext(credential) }, key, base64ToBytes(wrapped.ciphertext)));
	try {
		const parsed = JSON.parse(new TextDecoder().decode(plaintext));
		return { dmkRaw: base64ToBytes(parsed.dmk), privateKeyPkcs8: base64ToBytes(parsed.privateKey) };
	} finally { plaintext.fill(0); }
}

export { isWebAuthnSupported, registerWebAuthnCredential, authenticateWithWebAuthn } from './webauthn.js';

/**
 * In-Memory Zero-Trust Active Session
 */
let activeSession = null;

/**
 * @param {CryptoKey} dmk
 * @param {CryptoKey} privateKey
 */
export function setActiveSession(dmk, privateKey) {
	activeSession = {
		dmk,
		privateKey,
		unlockedAt: Date.now()
	};
}

export function getActiveSession() {
	return activeSession;
}

export function hasActiveSession() {
	return activeSession !== null && !!activeSession.dmk;
}

export function clearActiveSession() {
	activeSession = null;
}

