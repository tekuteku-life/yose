import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	bytesToBase64,
	base64ToBytes,
	generateEd25519KeyPair,
	exportPublicKeyBase64,
	importPublicKeyBase64,
	exportPrivateKeyPkcs8,
	importPrivateKeyPkcs8,
	signPayload,
	verifySignature,
	deriveKeyFromPin,
	encryptPrivateKeyWithPin,
	decryptPrivateKeyWithPin,
	createSignedRequest,
	isTimestampValid,
	verifySignedRequest
} from '../../js/crypto.js';

describe('js/crypto.js - Unit Tests', () => {
	describe('Base64 Conversion', () => {
		it('round-trips small byte array', () => {
			const original = new Uint8Array([0, 1, 2, 255, 128, 64]);
			const b64 = bytesToBase64(original);
			const restored = base64ToBytes(b64);
			assert.deepEqual(restored, original);
		});

		it('round-trips large byte array (> 8192 bytes chunk boundary)', () => {
			const size = 10000;
			const large = new Uint8Array(size);
			for (let i = 0; i < size; i++) {
				large[i] = i % 256;
			}
			const b64 = bytesToBase64(large);
			const restored = base64ToBytes(b64);
			assert.deepEqual(restored, large);
		});

		it('handles ArrayBuffer input in bytesToBase64', () => {
			const buf = new Uint8Array([10, 20, 30]).buffer;
			const b64 = bytesToBase64(buf);
			const restored = base64ToBytes(b64);
			assert.deepEqual(restored, new Uint8Array([10, 20, 30]));
		});
	});

	describe('Ed25519 Key Generation, Export & Import', () => {
		it('generates valid Ed25519 keypair and exports raw 32-byte public key', async () => {
			const kp = await generateEd25519KeyPair();
			assert.ok(kp.publicKey);
			assert.ok(kp.privateKey);

			const pubBase64 = await exportPublicKeyBase64(kp.publicKey);
			const pubBytes = base64ToBytes(pubBase64);
			assert.equal(pubBytes.length, 32);

			const importedPub = await importPublicKeyBase64(pubBase64);
			assert.equal(importedPub.algorithm.name, 'Ed25519');
		});

		it('exports and imports PKCS#8 private key', async () => {
			const kp = await generateEd25519KeyPair();
			const pkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);
			assert.ok(pkcs8.length > 0);

			const importedPriv = await importPrivateKeyPkcs8(pkcs8);
			assert.equal(importedPriv.algorithm.name, 'Ed25519');

			// Check imported key signs properly
			const sig = await signPayload(importedPriv, 'test');
			const valid = await verifySignature(kp.publicKey, sig, 'test');
			assert.equal(valid, true);
		});
	});

	describe('Ed25519 Signing and Verification', () => {
		it('verifies signature on original message', async () => {
			const kp = await generateEd25519KeyPair();
			const message = JSON.stringify({ action: 'push_diff', data: [1, 2, 3] });
			const signature = await signPayload(kp.privateKey, message);

			const isValid = await verifySignature(kp.publicKey, signature, message);
			assert.equal(isValid, true);
		});

		it('rejects verification on tampered message', async () => {
			const kp = await generateEd25519KeyPair();
			const originalMessage = 'original message';
			const signature = await signPayload(kp.privateKey, originalMessage);

			const isValid = await verifySignature(kp.publicKey, signature, 'tampered message');
			assert.equal(isValid, false);
		});

		it('rejects verification on corrupted signature', async () => {
			const kp = await generateEd25519KeyPair();
			const message = 'test';
			const fakeSig = bytesToBase64(new Uint8Array(64).fill(1));

			const isValid = await verifySignature(kp.publicKey, fakeSig, message);
			assert.equal(isValid, false);
		});
	});

	describe('PIN Encryption and Decryption of Private Key', () => {
		it('encrypts private key with PIN and decrypts with correct PIN', async () => {
			const kp = await generateEd25519KeyPair();
			const pin = '123456';

			const encrypted = await encryptPrivateKeyWithPin(kp.privateKey, pin);
			assert.ok(encrypted.ciphertext);
			assert.ok(encrypted.iv);
			assert.ok(encrypted.salt);

			const decryptedPriv = await decryptPrivateKeyWithPin(encrypted, pin);
			assert.ok(decryptedPriv);

			// Verify decrypted key can sign and match public key
			const sig = await signPayload(decryptedPriv, 'secret');
			const valid = await verifySignature(kp.publicKey, sig, 'secret');
			assert.equal(valid, true);
		});

		it('throws error when decrypting with wrong PIN', async () => {
			const kp = await generateEd25519KeyPair();
			const pin = 'correct_pin';
			const wrongPin = 'wrong_pin';

			const encrypted = await encryptPrivateKeyWithPin(kp.privateKey, pin);

			await assert.rejects(
				async () => {
					await decryptPrivateKeyWithPin(encrypted, wrongPin);
				},
				/PIN decryption failed/
			);
		});
	});

	describe('Signed Request Envelope & Replay Prevention', () => {
		it('isTimestampValid validates freshness within window', () => {
			const now = 1700000000000;
			assert.equal(isTimestampValid(now, now, 300000), true);
			assert.equal(isTimestampValid(now - 100000, now, 300000), true); // 100s ago
			assert.equal(isTimestampValid(now + 100000, now, 300000), true); // 100s future clock skew
			assert.equal(isTimestampValid(now - 300001, now, 300000), false); // >5m ago
			assert.equal(isTimestampValid(now + 300001, now, 300000), false); // >5m future
			assert.equal(isTimestampValid(null, now), false);
			assert.equal(isTimestampValid('invalid', now), false);
		});

		it('creates and verifies valid signed request envelope', async () => {
			const kp = await generateEd25519KeyPair();
			const now = Date.now();
			const envelope = await createSignedRequest('push_diff', { count: 5 }, kp.privateKey, now);

			assert.equal(envelope.action, 'push_diff');
			assert.equal(envelope.timestamp, now);
			assert.ok(envelope.signature);

			const verification = await verifySignedRequest(envelope, kp.publicKey, now);
			assert.equal(verification.valid, true);
		});

		it('rejects envelope with missing or tampered signature', async () => {
			const kp = await generateEd25519KeyPair();
			const now = Date.now();
			const envelope = await createSignedRequest('push_diff', { count: 5 }, kp.privateKey, now);

			// Missing signature
			const res1 = await verifySignedRequest({ ...envelope, signature: null }, kp.publicKey, now);
			assert.equal(res1.valid, false);

			// Tampered payload
			const tampered = { ...envelope, payload: { count: 999 } };
			const res2 = await verifySignedRequest(tampered, kp.publicKey, now);
			assert.equal(res2.valid, false);
			assert.match(res2.error, /signature/i);
		});

		it('rejects envelope with stale timestamp (replay attack prevention)', async () => {
			const kp = await generateEd25519KeyPair();
			const pastTime = Date.now() - 400000; // >5 minutes ago
			const envelope = await createSignedRequest('push_diff', {}, kp.privateKey, pastTime);

			const res = await verifySignedRequest(envelope, kp.publicKey, Date.now());
			assert.equal(res.valid, false);
			assert.match(res.error, /replay attack/i);
		});

		it('creates envelope with default timestamp and tests verify edge cases', async () => {
			const kp = await generateEd25519KeyPair();
			// Omit customTimestamp to trigger default Date.now()
			const envelope = await createSignedRequest('fetch_state', { test: 1 }, kp.privateKey);
			assert.ok(envelope.timestamp > 0);
			assert.equal(envelope.action, 'fetch_state');

			// Test verifySignedRequest with null or missing signature
			const nullEnv = await verifySignedRequest(null, kp.publicKey);
			assert.equal(nullEnv.valid, false);
			assert.equal(nullEnv.error, 'Missing signature');

			const noSig = await verifySignedRequest({ action: 'test' }, kp.publicKey);
			assert.equal(noSig.valid, false);
			assert.equal(noSig.error, 'Missing signature');

			// Test isTimestampValid with NaN
			assert.equal(isTimestampValid(NaN), false);
		});

		it('handles verifySignature catch block on invalid signature encoding', async () => {
			const kp = await generateEd25519KeyPair();
			// '!!!' is not valid base64, causes base64ToBytes to throw and triggers catch
			const res = await verifySignature(kp.publicKey, 'invalid base64!!!', 'data');
			assert.equal(res, false);
		});

		it('handles non-Uint8Array in bytesToBase64', () => {
			const regularArray = [72, 101, 108, 108, 111]; // "Hello"
			const b64 = bytesToBase64(regularArray);
			assert.equal(b64, 'SGVsbG8=');
		});

		it('throws when subtle or getRandomValues is unavailable', async () => {
			const { getSubtle, getRandomValues } = await import('../../js/crypto.js');
			assert.throws(() => getSubtle({}), /Web Crypto subtle is not available/);
			assert.throws(() => getRandomValues(new Uint8Array(4), {}), /Web Crypto getRandomValues is not available/);
		});
	});

	describe('Database Master Key (DMK) and At-Rest AES-GCM-256 Encryption', () => {
		it('generates 256-bit AES-GCM Database Master Key', async () => {
			const { generateDatabaseMasterKey, exportKeyRaw, importAesKeyRaw } = await import('../../js/crypto.js');
			const dmk = await generateDatabaseMasterKey();
			assert.ok(dmk);
			assert.equal(dmk.algorithm.name, 'AES-GCM');
			assert.equal(dmk.algorithm.length, 256);

			const raw = await exportKeyRaw(dmk);
			assert.equal(raw.length, 32);

			const imported = await importAesKeyRaw(raw);
			assert.equal(imported.algorithm.name, 'AES-GCM');
		});

		it('encrypts and decrypts arbitrary JS objects at-rest with AES-GCM-256', async () => {
			const { generateDatabaseMasterKey, encryptObject, decryptObject } = await import('../../js/crypto.js');
			const dmk = await generateDatabaseMasterKey();
			const sensitiveData = {
				transactions: [{ id: 'tx_1', amount: 50000, memo: 'Confidential bonus' }],
				balances: { acc_bank: 5000000 }
			};

			const encrypted = await encryptObject(sensitiveData, dmk);
			assert.ok(encrypted.ciphertext);
			assert.ok(encrypted.iv);
			assert.notEqual(encrypted.ciphertext, JSON.stringify(sensitiveData));

			const decrypted = await decryptObject(encrypted, dmk);
			assert.deepEqual(decrypted, sensitiveData);
		});

		it('fails decryption of at-rest object if ciphertext or iv is tampered or wrong key is used', async () => {
			const { generateDatabaseMasterKey, encryptObject, decryptObject } = await import('../../js/crypto.js');
			const dmk = await generateDatabaseMasterKey();
			const encrypted = await encryptObject({ test: 'integrity' }, dmk);

			// 1. Corrupted ciphertext (Auth tag mismatch)
			const tamperedCipher = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA' };
			await assert.rejects(async () => await decryptObject(tamperedCipher, dmk), /decryption failed/i);

			// 2. Tampered IV
			const tamperedIv = { ...encrypted, iv: 'AAAA' + encrypted.iv.slice(4) };
			await assert.rejects(async () => await decryptObject(tamperedIv, dmk), /decryption failed/i);

			// 3. Wrong key
			const otherDmk = await generateDatabaseMasterKey();
			await assert.rejects(async () => {
				await decryptObject(encrypted, otherDmk);
			}, /decryption failed/i);
		});
	});

	describe('Hybrid Master Keys Packaging (DMK + Ed25519) with PIN', () => {
		it('wraps and unwraps both DMK and Ed25519 private key using user PIN', async () => {
			const {
				generateDatabaseMasterKey,
				exportKeyRaw,
				importAesKeyRaw,
				encryptMasterKeysWithPin,
				decryptMasterKeysWithPin
			} = await import('../../js/crypto.js');

			const kp = await generateEd25519KeyPair();
			const dmk = await generateDatabaseMasterKey();
			const pin = '987654';

			const dmkRaw = await exportKeyRaw(dmk);
			const privPkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);

			const wrapped = await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8: privPkcs8 }, pin);
			assert.ok(wrapped.ciphertext);
			assert.ok(wrapped.iv);
			assert.ok(wrapped.salt);

			// Unpack with correct PIN
			const unpacked = await decryptMasterKeysWithPin(wrapped, pin);
			assert.deepEqual(unpacked.dmkRaw, dmkRaw);
			assert.deepEqual(unpacked.privateKeyPkcs8, privPkcs8);

			// Re-import keys and verify they work
			const restoredDmk = await importAesKeyRaw(unpacked.dmkRaw);
			const restoredPriv = await importPrivateKeyPkcs8(unpacked.privateKeyPkcs8);

			const testSig = await signPayload(restoredPriv, 'test-msg');
			const sigOk = await verifySignature(kp.publicKey, testSig, 'test-msg');
			assert.equal(sigOk, true);

			// Unpack with wrong PIN
			await assert.rejects(async () => {
				await decryptMasterKeysWithPin(wrapped, 'wrong_pin');
			}, /PIN decryption failed/i);
		});
	});

	describe('Zero-Trust Active Session Memory Management', () => {
		it('manages active session, provides DMK and private key, and clears on lock', async () => {
			const {
				setActiveSession,
				getActiveSession,
				hasActiveSession,
				clearActiveSession,
				generateDatabaseMasterKey
			} = await import('../../js/crypto.js');

			const kp = await generateEd25519KeyPair();
			const dmk = await generateDatabaseMasterKey();

			clearActiveSession();
			assert.equal(hasActiveSession(), false);
			assert.equal(getActiveSession(), null);

			setActiveSession(dmk, kp.privateKey);
			assert.equal(hasActiveSession(), true);
			const session = getActiveSession();
			assert.equal(session.dmk, dmk);
			assert.equal(session.privateKey, kp.privateKey);

			clearActiveSession();
			assert.equal(hasActiveSession(), false);
			assert.equal(getActiveSession(), null);
		});
	});

	describe('Canonical JSON Stringification', () => {
		it('sorts object keys recursively and produces deterministic strings', async () => {
			const { canonicalJsonStringify } = await import('../../js/crypto.js');

			const objA = { z: 1, a: 2, m: { y: 10, x: 20 } };
			const objB = { a: 2, m: { x: 20, y: 10 }, z: 1 };

			const strA = canonicalJsonStringify(objA);
			const strB = canonicalJsonStringify(objB);

			assert.equal(strA, '{"a":2,"m":{"x":20,"y":10},"z":1}');
			assert.equal(strA, strB);
		});

		it('handles arrays, null, primitives, and skips undefined or function values', async () => {
			const { canonicalJsonStringify } = await import('../../js/crypto.js');

			assert.equal(canonicalJsonStringify(null), 'null');
			assert.equal(canonicalJsonStringify(123), '123');
			assert.equal(canonicalJsonStringify('hello'), '"hello"');
			assert.equal(canonicalJsonStringify(true), 'true');
			assert.equal(canonicalJsonStringify([3, 2, 1]), '[3,2,1]');

			const withSpecial = {
				name: 'test',
				fn: () => {},
				undef: undefined,
				arr: [{ b: 2, a: 1 }, null, true]
			};
			assert.equal(canonicalJsonStringify(withSpecial), '{"arr":[{"a":1,"b":2},null,true],"name":"test"}');
		});
	});

	it('rejects malformed encrypted objects', async () => {
		const { decryptObject } = await import('../../js/crypto.js');
		await assert.rejects(decryptObject(null, {}), /Invalid encrypted object payload/);
		await assert.rejects(decryptObject({ ciphertext: 'abc' }, {}), /Invalid encrypted object payload/);
	});
});
