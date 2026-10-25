import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { generateEd25519KeyPair, exportPublicKeyBase64, createSignedRequest } from '../../js/crypto.js';
const require = createRequire(import.meta.url), gas = require('../../gas/Code.gs');
const PREFIX = 'AUTH_REPLAY_';
const BASE = Date.parse('2026-10-25T00:00:00Z'), WINDOW = 300000;
const sha = request => createHash('sha512').update(gas.canonicalJsonStringify({ action: request.action, timestamp: request.timestamp, payload: request.payload })).digest('hex');
const send = request => gas.doPost({ postData: { contents: JSON.stringify(request) } });
const identity = () => { const bytes = new Uint8Array(32); bytes[0] = 1; return bytes; };
const weakSignature = () => { const bytes = new Uint8Array(64); bytes[0] = 1; return bytes; };
const littleEndian = value => Uint8Array.from({ length: 32 }, (_, i) => Number((value >> BigInt(i * 8)) & 255n));

describe('GAS authentication rejects unsafe keys, time values, and durable replays', () => {
	let env, keys, publicKey, originalNow;
	beforeEach(async () => {
		env = new MockGasEnvironment(); env.setupGlobals();
		originalNow = Date.now; Date.now = () => BASE;
		keys = await generateEd25519KeyPair(); publicKey = await exportPublicKeyBase64(keys.publicKey);
		gas.setScriptProp('USER_PUBLIC_KEYS', publicKey);
	});
	afterEach(() => { Date.now = originalNow; env.teardownGlobals(); });
	const signed = (action = 'fetch_state', payload = {}, time = Date.now()) => createSignedRequest(action, payload, keys.privateKey, time);
	const receipts = () => Object.fromEntries([...env.properties].filter(([key]) => key.startsWith(PREFIX)));
	const ledger = () => ({ entries: Object.entries(receipts()).map(([key, value]) => ({ digest: key.slice(PREFIX.length), expires_at: Number(value) })) });
	const store = entries => { for (const row of entries) env.properties.set(PREFIX + row.digest, String(row.expires_at)); };
	const entry = (i, expiry = BASE + WINDOW) => ({ digest: i.toString(16).padStart(128, '0'), expires_at: expiry });

	for (const configured of [false, true]) it(`rejects public key registration with configured=${configured} without changing properties`, async () => {
		if (!configured) env.properties.delete('USER_PUBLIC_KEYS');
		const before = [...env.properties];
		const result = send(await signed('register_initial_key', { publicKey }));
		assert.equal(result.success, false); assert.deepEqual([...env.properties], before);
		assert.deepEqual(receipts(), {});
	});

	for (const time of ['not-a-time', String(BASE), true, {}, [BASE], null, 0, -1, BASE + 0.5, Number.MAX_SAFE_INTEGER, BASE - WINDOW - 1, BASE + WINDOW + 1]) {
		it(`rejects invalid or stale time ${JSON.stringify(time)} before storage`, async () => {
			const request = await signed(); request.timestamp = time;
			// Sign the malformed value too: validation must not depend on signature failure.
			const { signPayload } = await import('../../js/crypto.js');
			request.signature = await signPayload(keys.privateKey, gas.canonicalJsonStringify({ action: request.action, timestamp: time, payload: request.payload }));
			assert.equal(send(request).success, false); assert.deepEqual(receipts(), {});
		});
	}

	for (const fault of ['missing', 'throw', 'evicted']) it(`rejects a replay with cache ${fault} and retains a durable receipt`, async () => {
		if (fault === 'missing') delete globalThis.CacheService;
		if (fault === 'throw') globalThis.CacheService = { getScriptCache: () => { throw new Error('cache outage'); } };
		const request = await signed(); assert.equal(send(request).success, true);
		if (fault === 'evicted') globalThis.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) };
		assert.equal(send(request).success, false);
		assert.ok(ledger().entries.some(row => row.digest === sha(request)));
	});

	it('rejects a replay in a fresh GAS module using only persisted script properties', async () => {
		const request = await signed(); assert.equal(send(request).success, true);
		delete globalThis.CacheService;
		delete require.cache[require.resolve('../../gas/Code.gs')];
		const nextExecution = require('../../gas/Code.gs');
		assert.equal(nextExecution.doPost({ postData: { contents: JSON.stringify(request) } }).success, false);
	});

	it('identifies the same signed content across different authorized signing keys', async () => {
		const other = await generateEd25519KeyPair();
		gas.setScriptProp('USER_PUBLIC_KEYS', JSON.stringify([publicKey, await exportPublicKeyBase64(other.publicKey)]));
		const first = await signed(), second = await createSignedRequest(first.action, first.payload, other.privateKey, first.timestamp);
		assert.notEqual(first.signature, second.signature);
		assert.equal(send(first).success, true); assert.equal(send(second).success, false);
		assert.equal(ledger().entries.length, 1);
	});

	it('records a request before dispatch and retains its receipt after an action error', async () => {
		const request = await signed('push_diff', { transactions: 'bad' });
		assert.equal(send(request).success, false);
		assert.ok(ledger().entries.some(row => row.digest === sha(request)));
		assert.match(send(request).error, /Replay/i);
	});

	it('does not consume a valid request when an attacker submits its signature with altered data', async () => {
		const request = await signed();
		assert.equal(send({ ...request, payload: { altered: true } }).success, false);
		assert.deepEqual(receipts(), {});
		assert.equal(send(request).success, true);
	});

	it('retains a future-dated request through its entire valid window including the exact end', async () => {
		const request = await signed('fetch_state', {}, BASE + WINDOW);
		assert.equal(send(request).success, true);
		Date.now = () => BASE + 2 * WINDOW;
		assert.match(send(request).error, /Replay/i);
		Date.now = () => BASE + 2 * WINDOW + 1;
		assert.equal(send(request).success, false);
		assert.equal(send(await signed()).success, true);
		assert.equal(ledger().entries.length, 1);
		assert.notEqual(ledger().entries[0].digest, sha(request));
	});

	it('accepts the exact past boundary and prunes it only after it has expired', async () => {
		const request = await signed('fetch_master', {}, BASE - WINDOW);
		assert.equal(send(request).success, true); assert.match(send(request).error, /Replay/i);
		Date.now = () => BASE + 1;
		assert.equal(send(await signed()).success, true);
		assert.equal(ledger().entries.length, 1);
	});

	it('rejects requests from a stopped legacy deployment after the complete migration window', async () => {
		const oldRequest = await signed('fetch_state', {}, BASE + WINDOW);
		Date.now = () => BASE + 2 * WINDOW + 1;
		assert.equal(send(oldRequest).success, false); assert.deepEqual(receipts(), {});
		assert.equal(send(await signed()).success, true);
	});

	it('fails closed at capacity and only reuses expired receipt space', async () => {
		store(Array.from({ length: 1024 }, (_, i) => entry(i)));
		assert.equal(send(await signed()).success, false); assert.equal(ledger().entries.length, 1024);
		const prior = ledger(); prior.entries[0].expires_at = BASE - 1; store(prior.entries);
		assert.equal(send(await signed()).success, true); assert.equal(ledger().entries.length, 1024);
	});

	for (const [key, value] of [[PREFIX + 'bad', String(BASE)], [PREFIX + '0'.repeat(128), 'tomorrow'], [PREFIX + '1'.repeat(128), 'NaN'], [PREFIX + '2'.repeat(128), '0'], [PREFIX + '3'.repeat(128), '-1'], [PREFIX + '4'.repeat(128), String(BASE + 0.5)], [PREFIX + '5'.repeat(128), '9'.repeat(25)]]) {
		it(`rejects a malformed persisted authentication record ${key.slice(-8)}=${value} without rewriting history`, async () => {
			env.properties.set(key, value); const before = [...env.properties];
			assert.equal(send(await signed()).success, false); assert.deepEqual([...env.properties], before);
		});
	}

	for (const fault of ['read', 'write', 'readback', 'mismatched-readback', 'silent-write', 'delete', 'no-properties', 'no-lock', 'lock-busy', 'lock-throw']) {
		it(`rejects before dispatch when authentication storage or locking fails: ${fault}`, async () => {
			gas.saveJsonFile('master_config.json', { marker: 'preserve' });
			const before = [...env.spreadsheet.getSheetByName('master_config').rows];
			const props = PropertiesService.getScriptProperties(); let saved = false;
			if (fault === 'delete') store([entry(1, BASE - 1)]);
			PropertiesService.getScriptProperties = () => ({ ...props,
				getProperties: () => { if (fault === 'read') throw new Error('read failure'); return props.getProperties(); },
				setProperty: (key, value) => { if (key.startsWith(PREFIX)) { if (fault === 'write') throw new Error('write failure'); if (fault === 'silent-write') return; saved = true; } return props.setProperty(key, value); },
				getProperty: key => { if (saved && key.startsWith(PREFIX)) { if (fault === 'readback') throw new Error('readback failure'); if (fault === 'mismatched-readback') return String(BASE + WINDOW + 1); } return props.getProperty(key); },
				deleteProperty: key => { if (fault === 'delete') throw new Error('delete failure'); return props.deleteProperty(key); }
			});
			if (fault === 'no-properties') delete globalThis.PropertiesService;
			if (fault === 'no-lock') delete globalThis.LockService;
			if (fault === 'lock-busy') globalThis.LockService.getScriptLock = () => ({ tryLock: () => false, releaseLock: () => {} });
			if (fault === 'lock-throw') globalThis.LockService.getScriptLock = () => { throw new Error('lock failure'); };
			const request = await signed('update_external_assets', { external_assets: [] });
			assert.equal(send(request).success, false);
			assert.deepEqual(env.spreadsheet.getSheetByName('master_config').rows, before);
			assert.equal(env.spreadsheet.getSheetByName('summary_snapshot'), null);
		});
	}

	for (const fault of ['individual-missing', 'individual-expired', 'individual-different', 'list-missing']) it(`rejects inconsistent receipt reads without changing prior history or business state: ${fault}`, async () => {
		const request = await signed(); assert.equal(send(request).success, true);
		gas.saveJsonFile('replacement_commit.json', { id: 'waiting' });
		gas.saveJsonFile('replacement_journal.json', { id: 'waiting', writes: [{ file: 'master_config.json', data: { changed: true } }] });
		const beforeProperties = [...env.properties];
		const beforeSheets = [...env.spreadsheet.sheets].map(([name, value]) => [name, [...value.rows]]);
		const props = PropertiesService.getScriptProperties(), key = PREFIX + sha(request);
		let injected = false, writes = 0, businessReads = 0;
		const getSheet = env.spreadsheet.getSheetByName.bind(env.spreadsheet);
		env.spreadsheet.getSheetByName = name => { businessReads++; return getSheet(name); };
		PropertiesService.getScriptProperties = () => ({ ...props,
			getProperties: () => { const result = props.getProperties(); if (fault === 'list-missing') delete result[key]; return result; },
			getProperty: name => {
				if (name === key && !injected) {
					injected = true;
					if (fault === 'individual-missing') return null;
					if (fault === 'individual-expired') return String(BASE - 1);
					if (fault === 'individual-different') return String(BASE + WINDOW + 1);
				}
				return props.getProperty(name);
			},
			setProperty: (name, value) => { writes++; return props.setProperty(name, value); }
		});
		assert.equal(send(request).success, false);
		assert.equal(writes, 0); assert.equal(businessReads, 0);
		assert.deepEqual([...env.properties], beforeProperties);
		assert.deepEqual([...env.spreadsheet.sheets].map(([name, value]) => [name, [...value.rows]]), beforeSheets);
	});

	it('preserves every unexpired receipt when saving a later request fails and rejects its replay after recovery', async () => {
		const accepted = await signed(); assert.equal(send(accepted).success, true);
		const before = receipts(), factory = PropertiesService.getScriptProperties, props = factory();
		PropertiesService.getScriptProperties = () => ({ ...props, setProperty: () => { throw new Error('later receipt failed'); } });
		const later = await signed('fetch_state', { different: true });
		assert.equal(send(later).success, false); assert.deepEqual(receipts(), before);
		PropertiesService.getScriptProperties = factory;
		assert.equal(send(accepted).success, false); assert.deepEqual(receipts(), before);
		assert.equal(send(later).success, true);
	});

	it('uses GAS Utilities for UTF-8 without requiring the browser TextEncoder API', async () => {
		const request = await signed('fetch_state', { memo: '日本語の署名対象' }), encoder = globalThis.TextEncoder;
		delete globalThis.TextEncoder;
		try { assert.equal(send(request).success, true); }
		finally { globalThis.TextEncoder = encoder; }
	});

	it('does not lock for invalid signatures and confirms persistence before reading business storage', async () => {
		const trace = [], props = PropertiesService.getScriptProperties();
		globalThis.LockService.getScriptLock = () => { trace.push('lock'); return { tryLock: () => true, releaseLock: () => trace.push('release') }; };
		PropertiesService.getScriptProperties = () => ({ ...props,
			setProperty: (key, value) => { if (key.startsWith(PREFIX)) trace.push('persist'); return props.setProperty(key, value); },
			getProperty: key => { if (key.startsWith(PREFIX) && trace.includes('persist')) trace.push('confirmed'); return props.getProperty(key); }
		});
		const readSheet = env.spreadsheet.getSheetByName.bind(env.spreadsheet);
		env.spreadsheet.getSheetByName = name => { trace.push('business'); return readSheet(name); };
		const request = await signed();
		assert.equal(send({ ...request, payload: { tampered: true } }).success, false); assert.deepEqual(trace, []);
		assert.equal(send(request).success, true);
		assert.ok(trace.indexOf('lock') < trace.indexOf('persist'));
		assert.ok(trace.indexOf('persist') < trace.indexOf('confirmed'));
		assert.ok(trace.indexOf('confirmed') < trace.indexOf('business'));
		assert.equal(trace.at(-1), 'release');
	});

	for (const reason of ['time', 'storage', 'action']) it(`releases the acquired lock after ${reason} rejection`, async () => {
		let released = 0;
		globalThis.LockService.getScriptLock = () => ({ tryLock: () => { if (reason === 'time') Date.now = () => BASE + WINDOW + 1; return true; }, releaseLock: () => released++ });
		if (reason === 'storage') {
			const props = PropertiesService.getScriptProperties(); PropertiesService.getScriptProperties = () => ({ ...props, getProperties: () => { throw new Error('read failure'); } });
		}
		assert.equal(send(await signed(reason === 'action' ? 'push_diff' : 'fetch_state', reason === 'action' ? { transactions: 'bad' } : {})).success, false);
		assert.equal(released, 1);
	});

	it('keeps a pending business recovery journal untouched when authentication recording fails', async () => {
		gas.saveJsonFile('replacement_commit.json', { id: 'waiting' });
		gas.saveJsonFile('replacement_journal.json', { id: 'waiting', writes: [{ file: 'master_config.json', data: { changed: true } }] });
		const before = [...env.spreadsheet.sheets].map(([name, value]) => [name, [...value.rows]]);
		const props = PropertiesService.getScriptProperties(); PropertiesService.getScriptProperties = () => ({ ...props, setProperty: () => { throw new Error('receipt save failure'); } });
		assert.equal(send(await signed()).success, false);
		assert.deepEqual([...env.spreadsheet.sheets].map(([name, value]) => [name, [...value.rows]]), before);
	});

	it('revalidates the time and owner key after obtaining the lock', async () => {
		globalThis.LockService.getScriptLock = () => ({ tryLock: () => { Date.now = () => BASE + WINDOW + 1; return true; }, releaseLock: () => {} });
		assert.equal(send(await signed()).success, false); assert.deepEqual(receipts(), {});
		Date.now = () => BASE;
		globalThis.LockService.getScriptLock = () => ({ tryLock: () => { gas.setScriptProp('USER_PUBLIC_KEYS', 'revoked'); return true; }, releaseLock: () => {} });
		assert.equal(send(await signed()).success, false); assert.deepEqual(receipts(), {});
	});

	it('rejects noncanonical Base64 signatures even when unused-bit changes decode to identical bytes', async () => {
		const request = await signed(), alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		const alias = request.signature.slice(0, -3) + alphabet[alphabet.indexOf(request.signature.at(-3)) + 1] + '==';
		assert.deepEqual(Buffer.from(alias, 'base64'), Buffer.from(request.signature, 'base64'));
		for (const value of [alias, request.signature + '\n', request.signature.slice(0, -2)]) {
			assert.equal(send({ ...request, signature: value }).success, false); assert.deepEqual(receipts(), {});
		}
		assert.equal(send(request).success, true);
	});

	it('skips malformed and weak configured keys while preserving authorization by a valid key', async () => {
		const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
		const alias = publicKey.slice(0, -2) + alphabet[alphabet.indexOf(publicKey.at(-2)) + 1] + '=';
		assert.deepEqual(Buffer.from(alias, 'base64'), Buffer.from(publicKey, 'base64'));
		gas.setScriptProp('USER_PUBLIC_KEYS', JSON.stringify([alias]));
		const request = await signed(); assert.equal(send(request).success, false); assert.deepEqual(receipts(), {});
		gas.setScriptProp('USER_PUBLIC_KEYS', JSON.stringify(['not-base64', Buffer.from(identity()).toString('base64'), alias, publicKey]));
		assert.equal(send(request).success, true);
		assert.equal(send({ action: 'fetch_state', timestamp: BASE + 1, payload: {}, signature: Buffer.from(weakSignature()).toString('base64') }).success, false);
	});

	it('rejects identity-key forgery through doPost without changing business state', () => {
		gas.setScriptProp('USER_PUBLIC_KEYS', Buffer.from(identity()).toString('base64'));
		const request = { action: 'fetch_state', timestamp: BASE, payload: {}, signature: Buffer.from(weakSignature()).toString('base64') };
		assert.equal(send(request).success, false); assert.deepEqual(receipts(), {});
	});

	it('rejects low-order and mixed-order keys and noncanonical x=0 encodings', () => {
		const p = (1n << 255n) - 19n;
		for (const y of [0n, 1n, p - 1n, p]) {
			const point = littleEndian(y);
			assert.equal(gas.isValidEd25519PublicKey(point), false);
			point[31] |= 128; assert.equal(gas.isValidEd25519PublicKey(point), false);
		}
		const valid = new Uint8Array(Buffer.from(publicKey, 'base64'));
		assert.equal(gas.isValidEd25519PublicKey(valid), true);
		const sign = valid[31] & 128; valid[31] &= 127;
		const mixed = littleEndian(p - gas.bytesToBigIntLE(valid)); mixed[31] |= sign ^ 128;
		assert.equal(gas.isValidEd25519PublicKey(mixed), false);
		assert.equal(gas.recoverX(1n, 1n), null);
	});

	it('accepts the RFC8032 empty-message vector and rejects changes to its scalar, point, and message', () => {
		const publicBytes = new Uint8Array(Buffer.from('d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', 'hex'));
		const signature = new Uint8Array(Buffer.from('e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b', 'hex'));
		assert.equal(gas.verifyEd25519(publicBytes, signature, new Uint8Array()), true);
		assert.equal(gas.verifyEd25519(publicBytes, signature, new Uint8Array([1])), false);
		const badScalar = signature.slice(); badScalar.set(littleEndian((1n << 252n) + 27742317777372353535851937790883648493n), 32);
		assert.equal(gas.verifyEd25519(publicBytes, badScalar, new Uint8Array()), false);
		const badPoint = signature.slice(); badPoint.set(identity()); badPoint[31] |= 128;
		assert.equal(gas.verifyEd25519(publicBytes, badPoint, new Uint8Array()), false);
	});
});
