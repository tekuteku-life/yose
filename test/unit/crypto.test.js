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

	describe('WebAuthn Credential Registration & Authentication', () => {
		it('registers and authenticates WebAuthn credential in mock environment', async () => {
			const {
				registerWebAuthnCredential,
				authenticateWithWebAuthn,
				isWebAuthnSupported,
				DEFAULT_WEBAUTHN_USER_ID
			} = await import('../../js/crypto.js');

			// Mock navigator.credentials
			const mockCredId = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
			let lastCreatedOpts = null;
			let lastGetOpts = null;
			const mockNav = {
				credentials: {
					create: async (opts) => {
						lastCreatedOpts = opts;
						return {
							rawId: mockCredId.buffer,
							id: 'mock_cred_id_base64',
							type: 'public-key'
						};
					},
					get: async (opts) => {
						lastGetOpts = opts;
						return {
							rawId: mockCredId.buffer,
							id: 'mock_cred_id_base64',
							type: 'public-key'
						};
					}
				}
			};

			assert.equal(isWebAuthnSupported(mockNav), true);
			assert.equal(isWebAuthnSupported({}), false);

			// First registration
			const regResult = await registerWebAuthnCredential('test-user', mockNav);
			assert.ok(regResult.credentialId);
			assert.deepEqual(lastCreatedOpts.publicKey.user.id, DEFAULT_WEBAUTHN_USER_ID);

			// Second registration (e.g. update / re-register) passes SAME deterministic user.id
			const regResult2 = await registerWebAuthnCredential('test-user', mockNav);
			assert.ok(regResult2.credentialId);
			assert.deepEqual(lastCreatedOpts.publicKey.user.id, DEFAULT_WEBAUTHN_USER_ID);

			// Authentication
			const authResult = await authenticateWithWebAuthn(regResult.credentialId, mockNav);
			assert.equal(authResult.success, true);
			assert.ok(lastGetOpts.publicKey.allowCredentials);

			// Authentication with omitted/null credential ID (discoverable credentials)
			const authDiscoverable = await authenticateWithWebAuthn(null, mockNav);
			assert.equal(authDiscoverable.success, true);
			assert.equal(lastGetOpts.publicKey.allowCredentials, undefined);
		});

		it('handles WebAuthn creation or authentication errors gracefully', async () => {
			const {
				registerWebAuthnCredential,
				authenticateWithWebAuthn
			} = await import('../../js/crypto.js');

			const failingNav = {
				credentials: {
					create: async () => { throw new Error('NotAllowedError: User cancelled'); },
					get: async () => { throw new Error('SecurityError: Not allowed'); }
				}
			};

			await assert.rejects(async () => {
				await registerWebAuthnCredential('user', failingNav);
			}, /User cancelled/);

			await assert.rejects(async () => {
				await authenticateWithWebAuthn('dummy_id', failingNav);
			}, /Not allowed/);
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

	describe('WebAuthn PRF Vault Encryption & Decryption', () => {
		it('encrypts and decrypts master keys using PRF key', async () => {
			const {
				encryptWebAuthnVault,
				decryptWebAuthnVault,
				generateDatabaseMasterKey,
				generateEd25519KeyPair,
				exportKeyRaw,
				exportPrivateKeyPkcs8,
				getRandomValues
			} = await import('../../js/crypto.js');

			const dmk = await generateDatabaseMasterKey();
			const kp = await generateEd25519KeyPair();
			const dmkRaw = await exportKeyRaw(dmk);
			const privPkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);

			const prfKey = getRandomValues(new Uint8Array(32));
			const vault = await encryptWebAuthnVault({ dmkRaw, privateKeyPkcs8: privPkcs8 }, prfKey);

			assert.ok(vault.ciphertext);
			assert.ok(vault.iv);
			assert.ok(vault.prfSalt);

			const decrypted = await decryptWebAuthnVault(vault, prfKey);
			assert.deepEqual(decrypted.dmkRaw, dmkRaw);
			assert.deepEqual(decrypted.privateKeyPkcs8, privPkcs8);
		});

		it('rejects invalid vault payload or wrong PRF key', async () => {
			const {
				decryptWebAuthnVault,
				encryptWebAuthnVault,
				getRandomValues
			} = await import('../../js/crypto.js');

			const prfKey = getRandomValues(new Uint8Array(32));
			const wrongKey = getRandomValues(new Uint8Array(32));

			await assert.rejects(async () => {
				await decryptWebAuthnVault(null, prfKey);
			}, /Invalid webauthn_vault payload/);

			await assert.rejects(async () => {
				await decryptWebAuthnVault({ ciphertext: 'abc' }, prfKey);
			}, /Invalid webauthn_vault payload/);

			const validVault = await encryptWebAuthnVault({
				dmkRaw: new Uint8Array(32).fill(1),
				privateKeyPkcs8: new Uint8Array(48).fill(2)
			}, prfKey);

			await assert.rejects(async () => {
				await decryptWebAuthnVault(validVault, wrongKey);
			}, /WebAuthn PRF vault decryption failed/);
		});
	});

	describe('WebAuthn Extensions & PRF Handling', () => {
		it('extracts PRF key when authenticator returns extension results', async () => {
			const {
				registerWebAuthnCredential,
				authenticateWithWebAuthn,
				bytesToBase64
			} = await import('../../js/crypto.js');

			const mockPrfRaw = new Uint8Array(32).fill(99);
			const mockCredId = new Uint8Array([11, 22, 33]);

			const mockNavWithPrf = {
				credentials: {
					create: async () => ({
						rawId: mockCredId.buffer,
						id: bytesToBase64(mockCredId),
						getClientExtensionResults: () => ({
							prf: {
								enabled: true,
								results: {
									first: mockPrfRaw.buffer
								}
							}
						})
					}),
					get: async () => ({
						rawId: mockCredId.buffer,
						id: bytesToBase64(mockCredId),
						getClientExtensionResults: () => ({
							prf: {
								results: {
									first: mockPrfRaw.buffer
								}
							}
						})
					})
				}
			};

			const regRes = await registerWebAuthnCredential('test-user', mockNavWithPrf);
			assert.equal(regRes.prfSupported, true);
			assert.deepEqual(regRes.prfKeyRaw, mockPrfRaw);

			const authRes = await authenticateWithWebAuthn(regRes.credentialId, mockNavWithPrf);
			assert.equal(authRes.success, true);
			assert.deepEqual(authRes.prfKeyRaw, mockPrfRaw);
		});

		it('handles missing credentials or get errors', async () => {
			const {
				registerWebAuthnCredential,
				authenticateWithWebAuthn,
				decryptObject
			} = await import('../../js/crypto.js');

			const emptyNav = {
				credentials: {
					create: async () => null,
					get: async () => null
				}
			};

			await assert.rejects(async () => {
				await registerWebAuthnCredential('test', emptyNav);
			}, /Failed to create WebAuthn credential/);

			await assert.rejects(async () => {
				await authenticateWithWebAuthn('test', emptyNav);
			}, /No assertion returned/);

			// Test non-base64 credentialId fallback
			const mockNavFallback = {
				credentials: {
					create: async () => ({}),
					get: async (opts) => ({
						rawId: new Uint8Array([1, 2, 3]).buffer,
						id: 'mock'
					})
				}
			};
			const authRes = await authenticateWithWebAuthn('not-valid-base64!@#$', mockNavFallback);
			assert.equal(authRes.success, true);

			// Test unsupported WebAuthn environment
			await assert.rejects(async () => {
				await registerWebAuthnCredential('test', {});
			}, /WebAuthn is not supported in this environment/);

			await assert.rejects(async () => {
				await authenticateWithWebAuthn('test', {});
			}, /WebAuthn is not supported in this environment/);

			// Test decryptObject error validation
			await assert.rejects(async () => {
				await decryptObject(null, {});
			}, /Invalid encrypted object payload/);

			await assert.rejects(async () => {
				await decryptObject({ ciphertext: 'abc' }, {});
			}, /Invalid encrypted object payload/);
		});

		it('creates and unwraps multi-device synced passkey bundle with Ed25519 Verify-Before-Decrypt (Requirement 4.8)', async () => {
			const {
				generateEd25519KeyPair,
				exportPrivateKeyPkcs8,
				exportPublicKeyBase64,
				createSignedPasskeyBundle,
				verifyAndUnwrapPasskeyBundle,
				getRandomValues
			} = await import('../../js/crypto.js');

			const dmkRaw = getRandomValues(new Uint8Array(32));
			const prfKeyRaw = getRandomValues(new Uint8Array(32));
			const keyPair = await generateEd25519KeyPair();
			const privateKeyPkcs8 = await exportPrivateKeyPkcs8(keyPair.privateKey);
			const publicKeyBase64 = await exportPublicKeyBase64(keyPair.publicKey);

			// 1. Fail-Safe: returns null if prfKeyRaw is null or too short
			const nullBundle = await createSignedPasskeyBundle({
				dmkRaw,
				privateKeyPkcs8,
				privateKey: keyPair.privateKey,
				publicKeyBase64,
				credentialId: 'cred_sync_1',
				prfKeyRaw: null
			});
			assert.equal(nullBundle, null);

			const shortBundle = await createSignedPasskeyBundle({
				dmkRaw,
				privateKeyPkcs8,
				privateKey: keyPair.privateKey,
				publicKeyBase64,
				credentialId: 'cred_sync_1',
				prfKeyRaw: new Uint8Array(8)
			});
			assert.equal(shortBundle, null);

			// 2. Missing required parameters throws error
			await assert.rejects(async () => {
				await createSignedPasskeyBundle({
					dmkRaw: null,
					privateKeyPkcs8,
					privateKey: keyPair.privateKey,
					publicKeyBase64,
					credentialId: 'cred_sync_1',
					prfKeyRaw
				});
			}, /Missing required parameters for createSignedPasskeyBundle/);

			// 3. Valid bundle creation and Verify-Before-Decrypt unwrapping
			const bundle = await createSignedPasskeyBundle({
				dmkRaw,
				privateKeyPkcs8,
				privateKey: keyPair.privateKey,
				publicKeyBase64,
				credentialId: 'cred_sync_1',
				prfKeyRaw
			});
			assert.ok(bundle);
			assert.equal(bundle.credentialId, 'cred_sync_1');
			assert.equal(bundle.publicKeyBase64, publicKeyBase64);
			assert.ok(bundle.signature);
			assert.ok(bundle.updated_at);
			assert.ok(bundle.vault.ciphertext);

			const unwrapped = await verifyAndUnwrapPasskeyBundle(bundle, prfKeyRaw);
			assert.deepEqual(unwrapped.dmkRaw, dmkRaw);
			assert.deepEqual(unwrapped.privateKeyPkcs8, privateKeyPkcs8);
			assert.equal(unwrapped.publicKeyBase64, publicKeyBase64);
			assert.equal(unwrapped.credentialId, 'cred_sync_1');

			// 4. Tampered vault or signature is rejected BEFORE decryption
			const tamperedBundle = {
				...bundle,
				updated_at: '2099-01-01T00:00:00.000Z'
			};
			await assert.rejects(async () => {
				await verifyAndUnwrapPasskeyBundle(tamperedBundle, prfKeyRaw);
			}, /Passkey bundle Ed25519 signature verification failed/);

			// 5. Invalid bundle format or missing PRF key errors
			await assert.rejects(async () => {
				await verifyAndUnwrapPasskeyBundle(null, prfKeyRaw);
			}, /Invalid passkey bundle format/);

			await assert.rejects(async () => {
				await verifyAndUnwrapPasskeyBundle(bundle, null);
			}, /PRF key is required to unwrap passkey bundle/);
		});
	});
});


