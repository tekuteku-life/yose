import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, exportPublicKeyBase64, exportKeyRaw, exportPrivateKeyPkcs8, encryptMasterKeysWithPin, decryptMasterKeysWithPin, importPublicKeyBase64, importPrivateKeyPkcs8, signPayload, verifySignature } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';
const raw = async db => ({ business: await db.captureImportState(), settings: await db.getAllRaw('settings'), keys: await db.getAllRaw('security_keys') });
const observation = entries => Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, { exists: true, value: structuredClone(value) }]));
const seed = { json_slot: { version: 1, nested: { a: 1, b: 2 }, flags: [false, null, 0, ''] }, old_slot: { obsolete: true }, untouched_slot: 'keep' };
async function setup(model = 'memory') { const db = await new YoseDB(model === 'memory' ? null : createMockIndexedDB()).init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.putTransaction(transaction('material-unchanged67')); await db.putSecurityKeys(seed, () => true); await db.setSetting('material-device-only67', 'keep'); return db; }
async function rejected(promise) { return promise.then(value => ({ value }), error => ({ error })); }
async function pair(db, pin) {
	const keys = await generateEd25519KeyPair(), dmkRaw = await exportKeyRaw(db.encryptionKey), privateKeyPkcs8 = await exportPrivateKeyPkcs8(keys.privateKey);
	try { return { public_key_base64: await exportPublicKeyBase64(keys.publicKey), master_keys_package: await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8 }, pin), keys }; }
	finally { dmkRaw.fill(0); privateKeyPkcs8.fill(0); }
}
async function packageFor(db, privateKey, pin) { const dmkRaw = await exportKeyRaw(db.encryptionKey), privateKeyPkcs8 = await exportPrivateKeyPkcs8(privateKey); try { return await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8 }, pin); } finally { dmkRaw.fill(0); privateKeyPkcs8.fill(0); } }
async function provesPair(db, pin) {
	const unpacked = await decryptMasterKeysWithPin(await db.getSecurityKey('master_keys_package'), pin), expectedDmk = await exportKeyRaw(db.encryptionKey);
	try { assert.deepEqual(unpacked.dmkRaw, expectedDmk); const pub = await importPublicKeyBase64(await db.getSecurityKey('public_key_base64')), priv = await importPrivateKeyPkcs8(unpacked.privateKeyPkcs8), proof = 'security material CAS proof'; assert.equal(await verifySignature(pub, await signPayload(priv, proof), proof), true); }
	finally { unpacked.dmkRaw.fill(0); unpacked.privateKeyPkcs8.fill(0); expectedDmk.fill(0); }
}

describe('review67 conditional security material batches', () => {
	for (const model of ['memory', 'indexedDB']) {
		it(`rejects an initially expired ${model} observation or CAS before any storage access`, async () => {
			const db = await setup(model), before = await raw(db); let reads = 0; const target = db.memoryDb ? db.memoryDb.stores.security_keys : db.db, method = db.memoryDb ? 'get' : 'transaction', original = target[method];
			target[method] = function (...args) { reads++; return original.apply(this, args); };
			let write, read; try { write = await rejected(db.putSecurityKeys({ added_slot: 'bad' }, () => false, { expectedSecurityKeys: observation(seed) })); assert.equal(typeof db.getSecurityKeyStates, 'function', 'readonly presence API must exist'); read = await rejected(db.getSecurityKeyStates(['json_slot'], { isSessionValid: () => false })); } finally { target[method] = original; }
			assert.ok(write.error); assert.ok(read.error, 'expired readonly entry rejects'); assert.equal(reads, 0); assert.deepEqual(await raw(db), before);
		});
		it(`keeps the existing ${model} unconditioned API and wrapper return values`, async () => {
			const db = await setup(model), value = { legacy: 'kept' }, before = await raw(db); assert.equal(await db.putSecurityKeys({ legacy_batch: value }, () => true), undefined); assert.equal(await db.saveSecurityKey('legacy_single', value), value); assert.deepEqual(await db.getSecurityKey('legacy_single'), value); await db.deleteSecurityKey('legacy_single'); assert.equal(await db.getSecurityKey('legacy_single'), null); const after = await raw(db); assert.deepEqual(after.business, before.business); assert.deepEqual(after.settings, before.settings); assert.deepEqual(await db.getSecurityKey('untouched_slot'), 'keep');
		});
		it(`rejects a stale ${model} value without committing any put or delete`, async () => {
			const db = await setup(model), expected = observation(seed); await db.putSecurityKeys({ json_slot: { foreign: true } }, () => true); const before = await raw(db);
			const outcome = await rejected(db.putSecurityKeys({ added_slot: 'must not arrive' }, () => true, { expectedSecurityKeys: expected, deleteKeys: ['old_slot'] }));
			assert.equal(outcome.error?.name, 'SecurityKeyConflictError'); assert.equal(outcome.error?.code, 'SECURITY_KEYS_CHANGED'); assert.deepEqual(await raw(db), before);
		});
		it(`does not treat a ${model} null record as a missing record`, async () => {
			const db = await setup(model); await db.saveSecurityKey('nullable_slot', null); const before = await raw(db), outcome = await rejected(db.putSecurityKeys({ nullable_slot: { new: true } }, () => true, { expectedSecurityKeys: { nullable_slot: { exists: false } } }));
			assert.equal(outcome.error?.code, 'SECURITY_KEYS_CHANGED'); assert.deepEqual(await raw(db), before);
		});
		it(`accepts reordered plain ${model} expected fields and atomically applies put and delete`, async () => {
			const db = await setup(model), before = await raw(db), expected = observation(seed); expected.json_slot.value = { flags: [false, null, 0, ''], nested: { b: 2, a: 1 }, version: 1 };
			await db.putSecurityKeys({ json_slot: { version: 2 }, fresh_slot: { value: 'fresh' } }, () => true, { expectedSecurityKeys: expected, deleteKeys: ['old_slot'] });
			assert.equal(await db.getSecurityKey('old_slot'), null); assert.deepEqual(await db.getSecurityKey('json_slot'), { version: 2 }); assert.deepEqual(await db.getSecurityKey('fresh_slot'), { value: 'fresh' }); assert.equal(await db.getSecurityKey('untouched_slot'), 'keep'); const after = await raw(db); assert.deepEqual(after.business, before.business); assert.deepEqual(after.settings, before.settings);
		});
		it(`captures ${model} presence and values as a readonly detached observation`, async () => {
			const db = await setup(model); await db.putSecurityKeys({ zero_slot: 0, false_slot: false, empty_slot: '', null_slot: null }, () => true); const before = await raw(db); assert.equal(typeof db.getSecurityKeyStates, 'function', 'readonly presence API must exist');
			const actual = await db.getSecurityKeyStates(['json_slot', 'zero_slot', 'false_slot', 'empty_slot', 'null_slot', 'missing_slot', 'json_slot']);
			assert.deepEqual(actual, { ...observation({ json_slot: seed.json_slot, zero_slot: 0, false_slot: false, empty_slot: '', null_slot: null }), missing_slot: { exists: false } }); actual.json_slot.value.nested.a = 999; assert.deepEqual(await db.getSecurityKey('json_slot'), seed.json_slot); assert.deepEqual(await db.getSecurityKeyStates([]), {}); assert.deepEqual(await raw(db), before);
		});
		for (const method of ['saveSecurityKey', 'deleteSecurityKey']) it(`propagates the ${model} ${method} expected state to the same atomic batch`, async () => {
			const db = await setup(model), expected = observation({ json_slot: seed.json_slot }); await db.saveSecurityKey('json_slot', { version: 'foreign' }); const before = await raw(db);
			const outcome = await rejected(method === 'saveSecurityKey' ? db.saveSecurityKey('json_slot', { overwrite: true }, { expectedSecurityKeys: expected }) : db.deleteSecurityKey('json_slot', { expectedSecurityKeys: expected })); assert.equal(outcome.error?.code, 'SECURITY_KEYS_CHANGED'); assert.deepEqual(await raw(db), before);
		});
	}
	it('keeps each own field distinct from a missing field even when that field value is undefined', async () => {
		const db = await setup(); await db.saveSecurityKey('own_slot', { version: 1 }); const before = await raw(db), outcome = await rejected(db.putSecurityKeys({ own_slot: { overwritten: true } }, () => true, { expectedSecurityKeys: { own_slot: { exists: true, value: { version: 1, optional: undefined } } } })); assert.equal(outcome.error?.code, 'SECURITY_KEYS_CHANGED'); assert.deepEqual(await raw(db), before);
	});
	it('clones the expected observation before the native-style read requests begin', async () => {
		const db = await setup('indexedDB'), expected = observation({ json_slot: seed.json_slot }); await db.saveSecurityKey('json_slot', { version: 'foreign' }); const before = await raw(db);
		const running = rejected(db.putSecurityKeys({ added_slot: 'bad' }, () => true, { expectedSecurityKeys: expected })); expected.json_slot.value = { version: 'foreign' }; const outcome = await running; assert.equal(outcome.error?.code, 'SECURITY_KEYS_CHANGED'); assert.deepEqual(await raw(db), before);
	});
	it('keeps the original write candidate when the caller changes its input after invocation', async () => {
		const db = await setup('indexedDB'), input = { json_slot: { version: 2, nested: { keep: true } } }; const running = db.putSecurityKeys(input, () => true, { expectedSecurityKeys: observation(seed) }); input.json_slot.nested.keep = false; await running; assert.deepEqual(await db.getSecurityKey('json_slot'), { version: 2, nested: { keep: true } });
	});
	for (const expected of [[], {}, { json_slot: { exists: 'yes', value: 1 } }, { json_slot: { exists: false, value: null } }, { json_slot: { exists: true } }]) it(`rejects malformed expected security descriptors ${JSON.stringify(expected)} before any readwrite transaction`, async () => {
		const db = await setup('indexedDB'), before = await raw(db), transaction = db.db.transaction.bind(db.db); let writes = 0;
		db.db.transaction = (...args) => { if (args[1] === 'readwrite') writes++; return transaction(...args); };
		let outcome; try { outcome = await rejected(db.putSecurityKeys({ added_slot: 'bad' }, () => true, { expectedSecurityKeys: expected })); } finally { db.db.transaction = transaction; }
		assert.ok(outcome.error, 'invalid expectations must reject'); assert.equal(writes, 0); assert.deepEqual(await raw(db), before);
	});
	for (const model of ['memory', 'indexedDB']) it(`rejects an array posing as a ${model} existence descriptor before any write`, async () => {
		const db = await setup(model), before = await raw(db), descriptor = Object.assign([], { exists: false });
		const result = await rejected(db.putSecurityKeys({ missing_slot: 'bad' }, () => true, { expectedSecurityKeys: { missing_slot: descriptor } }));
		assert.ok(result.error, 'existence descriptors must be plain records'); assert.deepEqual(await raw(db), before);
	});

	it('does not compare an opaque legacy CryptoKey as an empty plain record', async () => {
		const db = await setup(), original = await generateDatabaseMasterKey(); await db.putSecurityKeys({ opaque_slot: original }, () => true); const before = await raw(db), outcome = await rejected(db.putSecurityKeys({ added_slot: 'bad' }, () => true, { expectedSecurityKeys: { opaque_slot: { exists: true, value: original } } })); assert.ok(outcome.error, 'uncomparable opaque expectations must reject'); assert.deepEqual(await raw(db), before);
	});
	for (const order of ['pin-first', 'regeneration-first']) it(`retains a verifiable real key pair and the correct successful PIN for ${order}`, async () => {
		const db = await setup('indexedDB'), first = await pair(db, '1234'), regenerated = await pair(db, '1234'); await db.putSecurityKeys({ public_key_base64: first.public_key_base64, master_keys_package: first.master_keys_package }, () => true);
		const expected = observation({ public_key_base64: first.public_key_base64, master_keys_package: first.master_keys_package }), pinPackage = await packageFor(db, first.keys.privateKey, '5678'), before = await raw(db);
		let stale;
		if (order === 'pin-first') { await db.saveSecurityKey('master_keys_package', pinPackage, { expectedSecurityKeys: expected }); stale = await rejected(db.putSecurityKeys({ public_key_base64: regenerated.public_key_base64, master_keys_package: regenerated.master_keys_package }, () => true, { expectedSecurityKeys: expected })); }
		else { await db.putSecurityKeys({ public_key_base64: regenerated.public_key_base64, master_keys_package: regenerated.master_keys_package }, () => true, { expectedSecurityKeys: expected }); stale = await rejected(db.saveSecurityKey('master_keys_package', pinPackage, { expectedSecurityKeys: expected })); }
		assert.equal(stale.error?.code, 'SECURITY_KEYS_CHANGED'); await provesPair(db, order === 'pin-first' ? '5678' : '1234'); await assert.rejects(provesPair(db, order === 'pin-first' ? '1234' : '5678')); const after = await raw(db); assert.deepEqual(after.business, before.business); assert.deepEqual(after.settings, before.settings); assert.equal(await db.getSecurityKey('untouched_slot'), 'keep');
	});
});

for (const [name, value] of [['function', () => {}], ['symbol', Symbol('material')]]) it(`rejects a public CAS expectation containing ${name} at structured clone without reading or changing storage`, async () => {
	const db = await setup('indexedDB'), before = await raw(db), original = db.db.transaction; let transactions = 0; db.db.transaction = function (...args) { transactions++; return original.apply(this, args); };
	let outcome; try { outcome = await rejected(db.putSecurityKeys({ added_slot: 'bad' }, () => true, { expectedSecurityKeys: { json_slot: { exists: true, value } } })); } finally { db.db.transaction = original; }
	assert.equal(outcome.error?.name, 'DataCloneError'); assert.equal(transactions, 0); assert.deepEqual(await raw(db), before);
});
it('rejects a cyclic expectation retained by structured clone and preserves every raw record', async () => {
	const db = await setup(), before = await raw(db), value = { version: 1 }; value.self = value;
	const result = await rejected(db.putSecurityKeys({ added_slot: 'bad' }, () => true, { expectedSecurityKeys: { json_slot: { exists: true, value } } })); assert.equal(result.error?.name, 'TypeError'); assert.deepEqual(await raw(db), before);
});
for (const [name, expected] of [['false', false], ['zero', 0], ['empty text', ''], ['nonempty text', 'bad'], ['null descriptor', { json_slot: null }]]) it(`rejects malformed public security expectations ${name} without committing`, async () => {
	const db = await setup(), before = await raw(db), result = await rejected(db.putSecurityKeys({ added_slot: 'bad' }, () => true, { expectedSecurityKeys: expected })); assert.equal(result.error?.name, 'TypeError'); assert.deepEqual(await raw(db), before);
});
for (const [name, keys] of [['non-array', 'public_key_base64'], ['non-string', [123]]]) it(`rejects ${name} public readonly security keys without accessing IndexedDB`, async () => {
	const db = await setup('indexedDB'), before = await raw(db), original = db.db.transaction; let transactions = 0; db.db.transaction = function (...args) { transactions++; return original.apply(this, args); };
	let result; try { result = await rejected(db.getSecurityKeyStates(keys)); } finally { db.db.transaction = original; } assert.equal(result.error?.name, 'TypeError'); assert.equal(transactions, 0); assert.deepEqual(await raw(db), before);
});
for (const [name, deleteKeys] of [['non-array', 'old_slot'], ['non-string', [123]]]) it(`rejects ${name} deletion keys without committing any part of the security batch`, async () => {
	const db = await setup('indexedDB'), before = await raw(db), result = await rejected(db.putSecurityKeys({ added_slot: 'bad' }, () => true, { expectedSecurityKeys: observation(seed), deleteKeys })); assert.equal(result.error?.name, 'TypeError'); assert.deepEqual(await raw(db), before);
});
for (const model of ['memory', 'indexedDB']) it(`refuses an expired CAS delete wrapper before its ${model} presence or transaction read`, async () => {
	const db = await setup(model), before = await raw(db), target = db.memoryDb ? db.memoryDb.stores.security_keys : db.db, methods = db.memoryDb ? ['has', 'get', 'set', 'delete'] : ['transaction'], originals = new Map(methods.map(name => [name, target[name]])); let accesses = 0;
	for (const name of methods) target[name] = function (...args) { accesses++; return originals.get(name).apply(this, args); };
	let result; try { result = await rejected(db.deleteSecurityKey('json_slot', { isSessionValid: () => false, expectedSecurityKeys: observation(seed) })); } finally { for (const [name, original] of originals) target[name] = original; }
	assert.match(result.error?.message || '', /認証状態/); assert.equal(accesses, 0); assert.deepEqual(await raw(db), before);
});
