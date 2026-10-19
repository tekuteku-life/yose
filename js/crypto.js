/**
 * Yoseatsume Kakeibo - Web Crypto API (Ed25519 & PIN Encryption)
 */

export function getSubtle(cryptoObj = (typeof globalThis !== 'undefined' ? globalThis.crypto : null)) {
	const s = cryptoObj?.subtle || null;
	if (!s) throw new Error('Web Crypto subtle is not available in this environment');
	return s;
}

export function getRandomValues(array, cryptoObj = (typeof globalThis !== 'undefined' ? globalThis.crypto : null)) {
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
 * @param {object} requestEnvelope - { action, timestamp, payload, signature }
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

/**
 * Check if WebAuthn is supported in environment
 */
export function isWebAuthnSupported(nav = (typeof globalThis !== 'undefined' ? globalThis.navigator : null)) {
	return typeof nav?.credentials?.create === 'function' && typeof nav?.credentials?.get === 'function';
}

/**
 * Register WebAuthn Credential
 * @param {string} [username]
 * @param {object} [nav]
 * @returns {Promise<{ credentialId: string }>}
 */
export const DEFAULT_WEBAUTHN_USER_ID = new Uint8Array([
	0x79, 0x6f, 0x73, 0x65, 0x5f, 0x70, 0x61, 0x73, 0x73, 0x6b, 0x65, 0x79, 0x5f, 0x75, 0x73, 0x65, 0x72, 0x5f, 0x76, 0x31
]); // "yose_passkey_user_v1"

export const DEFAULT_WEBAUTHN_PRF_SALT = new Uint8Array([
	0x79, 0x6f, 0x73, 0x65, 0x5f, 0x70, 0x72, 0x66, 0x5f, 0x73, 0x61, 0x6c, 0x74, 0x5f, 0x76, 0x31,
	0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10
]); // 32 bytes

export async function registerWebAuthnCredential(username = 'よせあつめ家計簿', nav = (typeof globalThis !== 'undefined' ? globalThis.navigator : null), options = {}) {
	if (!isWebAuthnSupported(nav)) {
		throw new Error('WebAuthn is not supported in this environment');
	}

	const challenge = getRandomValues(new Uint8Array(32));
	const userId = options.userId || DEFAULT_WEBAUTHN_USER_ID;
	const prfSalt = options.prfSalt || DEFAULT_WEBAUTHN_PRF_SALT;

	const cred = await nav.credentials.create({
		publicKey: {
			challenge,
			rp: { name: 'よせあつめ家計簿' },
			user: {
				id: userId,
				name: username,
				displayName: username
			},
			pubKeyCredParams: [
				{ type: 'public-key', alg: -7 },   // ES256
				{ type: 'public-key', alg: -257 }  // RS256
			],
			authenticatorSelection: {
				userVerification: 'preferred',
				residentKey: 'preferred'
			},
			extensions: {
				prf: {
					eval: {
						first: prfSalt
					}
				}
			},
			timeout: 60000
		}
	});

	if (!cred || !cred.rawId) {
		throw new Error('Failed to create WebAuthn credential');
	}

	let prfKeyRaw = null;
	const extResults = typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : null;
	if (extResults?.prf?.results?.first) {
		prfKeyRaw = new Uint8Array(extResults.prf.results.first);
	}

	return {
		credentialId: bytesToBase64(new Uint8Array(cred.rawId)),
		prfSupported: Boolean(extResults?.prf?.enabled || prfKeyRaw),
		prfKeyRaw
	};
}

/**
 * Authenticate with existing WebAuthn Credential
 * @param {string} credentialIdBase64
 * @param {object} [nav]
 * @param {object} [options]
 * @returns {Promise<{ success: boolean, credentialId: string, prfKeyRaw: Uint8Array|null }>}
 */
export async function authenticateWithWebAuthn(credentialIdBase64, nav = (typeof globalThis !== 'undefined' ? globalThis.navigator : null), options = {}) {
	if (!isWebAuthnSupported(nav)) {
		throw new Error('WebAuthn is not supported in this environment');
	}

	const challenge = getRandomValues(new Uint8Array(32));
	const prfSalt = options.prfSalt || DEFAULT_WEBAUTHN_PRF_SALT;

	const getOptions = {
		publicKey: {
			challenge,
			userVerification: 'preferred',
			extensions: {
				prf: {
					eval: {
						first: prfSalt
					}
				}
			},
			timeout: 60000
		}
	};

	if (credentialIdBase64) {
		let credIdBytes;
		try {
			credIdBytes = base64ToBytes(credentialIdBase64);
		} catch {
			credIdBytes = new TextEncoder().encode(credentialIdBase64 || '');
		}
		getOptions.publicKey.allowCredentials = [
			{
				id: credIdBytes,
				type: 'public-key'
			}
		];
	}

	const assertion = await nav.credentials.get(getOptions);

	if (!assertion) {
		throw new Error('WebAuthn authentication failed: No assertion returned');
	}

	const returnedId = assertion.rawId
		? bytesToBase64(new Uint8Array(assertion.rawId))
		: (assertion.id || credentialIdBase64 || '');

	let prfKeyRaw = null;
	const extResults = typeof assertion.getClientExtensionResults === 'function' ? assertion.getClientExtensionResults() : null;
	if (extResults?.prf?.results?.first) {
		prfKeyRaw = new Uint8Array(extResults.prf.results.first);
	}

	return {
		success: true,
		credentialId: returnedId,
		prfKeyRaw
	};
}

/**
 * Encrypt master keys into webauthn_vault using PRF key
 * @param {{ dmkRaw: Uint8Array, privateKeyPkcs8: Uint8Array }} keys
 * @param {Uint8Array} prfKeyRaw
 * @param {Uint8Array} [prfSalt]
 * @returns {Promise<{ ciphertext: string, iv: string, prfSalt: string }>}
 */
export async function encryptWebAuthnVault({ dmkRaw, privateKeyPkcs8 }, prfKeyRaw, prfSalt = DEFAULT_WEBAUTHN_PRF_SALT) {
	const subtle = getSubtle();
	const iv = getRandomValues(new Uint8Array(12));
	const prfAesKey = await subtle.importKey(
		'raw',
		prfKeyRaw,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt']
	);

	const payload = JSON.stringify({
		dmk: bytesToBase64(dmkRaw),
		priv: bytesToBase64(privateKeyPkcs8)
	});

	const encryptedBuffer = await subtle.encrypt(
		{ name: 'AES-GCM', iv },
		prfAesKey,
		new TextEncoder().encode(payload)
	);

	return {
		ciphertext: bytesToBase64(encryptedBuffer),
		iv: bytesToBase64(iv),
		prfSalt: bytesToBase64(prfSalt)
	};
}

/**
 * Decrypt master keys from webauthn_vault using PRF key
 * @param {{ ciphertext: string, iv: string, prfSalt?: string }} vault
 * @param {Uint8Array} prfKeyRaw
 * @returns {Promise<{ dmkRaw: Uint8Array, privateKeyPkcs8: Uint8Array }>}
 */
export async function decryptWebAuthnVault(vault, prfKeyRaw) {
	if (!vault || !vault.ciphertext || !vault.iv) {
		throw new Error('Invalid webauthn_vault payload');
	}
	const { ciphertext, iv } = vault;
	const ivBytes = base64ToBytes(iv);
	const cipherBytes = base64ToBytes(ciphertext);
	const subtle = getSubtle();

	const prfAesKey = await subtle.importKey(
		'raw',
		prfKeyRaw,
		{ name: 'AES-GCM' },
		false,
		['encrypt', 'decrypt']
	);

	try {
		const decryptedBuffer = await subtle.decrypt(
			{ name: 'AES-GCM', iv: ivBytes },
			prfAesKey,
			cipherBytes
		);
		const jsonStr = new TextDecoder().decode(decryptedBuffer);
		const parsed = JSON.parse(jsonStr);
		return {
			dmkRaw: base64ToBytes(parsed.dmk),
			privateKeyPkcs8: base64ToBytes(parsed.priv)
		};
	} catch (err) {
		throw new Error('WebAuthn PRF vault decryption failed: invalid key or corrupted vault');
	}
}

/**
 * In-Memory Zero-Trust Active Session
 */
let activeSession = null;

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

/**
 * Create a self-encrypted (WebAuthn PRF AES-GCM-256) and self-signed (Ed25519) Passkey bundle
 * for multi-device sharing via master_config (Requirement 4.8).
 * Returns null if prfKeyRaw is not available (Fail-Safe: never exports unencrypted keys).
 * @param {{
 *   dmkRaw: Uint8Array,
 *   privateKeyPkcs8: Uint8Array,
 *   privateKey: CryptoKey,
 *   publicKeyBase64: string,
 *   credentialId: string,
 *   prfKeyRaw: Uint8Array|null,
 *   updatedAt?: string
 * }} params
 * @returns {Promise<{ credentialId: string, vault: { ciphertext: string, iv: string, prfSalt: string }, publicKeyBase64: string, updated_at: string, signature: string }|null>}
 */
export async function createSignedPasskeyBundle({
	dmkRaw,
	privateKeyPkcs8,
	privateKey,
	publicKeyBase64,
	credentialId,
	prfKeyRaw,
	updatedAt = new Date().toISOString()
}) {
	if (!prfKeyRaw || !(prfKeyRaw instanceof Uint8Array) || prfKeyRaw.byteLength < 16) {
		return null;
	}
	if (!dmkRaw || !privateKeyPkcs8 || !privateKey || !publicKeyBase64 || !credentialId) {
		throw new Error('Missing required parameters for createSignedPasskeyBundle');
	}

	const vault = await encryptWebAuthnVault({ dmkRaw, privateKeyPkcs8 }, prfKeyRaw);
	const signTarget = canonicalJsonStringify({
		credentialId,
		publicKeyBase64,
		updated_at: updatedAt,
		vault
	});
	const signature = await signPayload(privateKey, signTarget);

	return {
		credentialId,
		vault,
		publicKeyBase64,
		updated_at: updatedAt,
		signature
	};
}

/**
 * Verify Ed25519 self-signature first (Verify-Before-Decrypt) and unwrap DMK + Ed25519 Private Key
 * from a multi-device synced passkey bundle using the WebAuthn PRF output (Requirement 4.8).
 * @param {object} bundle
 * @param {Uint8Array} prfKeyRaw
 * @returns {Promise<{ dmkRaw: Uint8Array, privateKeyPkcs8: Uint8Array, publicKeyBase64: string, credentialId: string }>}
 */
export async function verifyAndUnwrapPasskeyBundle(bundle, prfKeyRaw) {
	if (!bundle || typeof bundle !== 'object' || !bundle.credentialId || !bundle.vault || !bundle.publicKeyBase64 || !bundle.signature || !bundle.updated_at) {
		throw new Error('Invalid passkey bundle format');
	}
	if (!prfKeyRaw || !(prfKeyRaw instanceof Uint8Array) || prfKeyRaw.byteLength < 16) {
		throw new Error('PRF key is required to unwrap passkey bundle');
	}

	const publicKey = await importPublicKeyBase64(bundle.publicKeyBase64);
	const signTarget = canonicalJsonStringify({
		credentialId: bundle.credentialId,
		publicKeyBase64: bundle.publicKeyBase64,
		updated_at: bundle.updated_at,
		vault: bundle.vault
	});
	const isValidSig = await verifySignature(publicKey, bundle.signature, signTarget);
	if (!isValidSig) {
		throw new Error('Passkey bundle Ed25519 signature verification failed');
	}

	const { dmkRaw, privateKeyPkcs8 } = await decryptWebAuthnVault(bundle.vault, prfKeyRaw);
	return {
		dmkRaw,
		privateKeyPkcs8,
		publicKeyBase64: bundle.publicKeyBase64,
		credentialId: bundle.credentialId
	};
}



