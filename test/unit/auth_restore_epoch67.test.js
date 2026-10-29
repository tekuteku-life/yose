import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { AuthController } from '../../js/ui/auth_controller.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, exportKeyRaw, exportPrivateKeyPkcs8, exportPublicKeyBase64 } from '../../js/crypto.js';

it('rejects restoration after a real same-key DB epoch change and never clears the newer key claim', async () => {
	const db = new YoseDB(); await db.init();
	const dmk = await generateDatabaseMasterKey(), pair = await generateEd25519KeyPair();
	await db.saveSecurityKey('public_key_base64', await exportPublicKeyBase64(pair.publicKey));
	await db.mutateMasterConfig(config => { config.synced_passkey_bundle = { legacy: true }; return config; });
	for (const name of ['webauthn_vault', 'webauthn_credential_id', 'webauthn_user_id']) await db.saveSecurityKey(name, { legacy: name });
	await db.setSetting('legacy-restore-epoch', 'keep');
	const auth = new AuthController({ db, syncManager: null }); auth.isKeyLocked = true;
	const unpacked = { dmkRaw: await exportKeyRaw(dmk), privateKeyPkcs8: await exportPrivateKeyPkcs8(pair.privateKey) };
	let enter, release, timer;
	const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
	const read = db.getMasterConfig;
	db.getMasterConfig = async function(...args) { const result = await read.apply(this, args); enter(); await gate; return result; };
	const pending = auth.restoreMasterKeys(unpacked, auth.authGeneration); pending.catch(() => {});
	try {
		await Promise.race([entered, pending.then(() => { throw new Error('Restoration finished before the master read gate'); }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Master read gate was not reached')), 2000); })]);
		clearTimeout(timer);
		const installed = db.encryptionKey, generation = db.keyGeneration;
		db.setEncryptionKey(installed);
		assert.equal(db.keyGeneration, generation + 1); assert.equal(db.encryptionKey, installed);
		const before = { business: await db.captureImportState(), security: await db.getAllRaw('security_keys'), settings: await db.getAllRaw('settings') };
		const cleanup = [];
		const remove = db.deleteSecurityKey, mutate = db.mutateMasterConfig;
		db.deleteSecurityKey = function(...args) { cleanup.push('delete'); return remove.apply(this, args); };
		db.mutateMasterConfig = function(...args) { cleanup.push('master'); return mutate.apply(this, args); };
		release();
		await assert.rejects(pending, /認証|変更/);
		assert.deepEqual(cleanup, [], 'an expired restoration must not even start legacy deletion or master cleanup');
		assert.deepEqual({ business: await db.captureImportState(), security: await db.getAllRaw('security_keys'), settings: await db.getAllRaw('settings') }, before);
		assert.equal(db.encryptionKey, installed, 'obsolete cleanup must not clear an identically valued newer key epoch');
		assert.equal(db.keyGeneration, generation + 1); assert.equal(auth.privateKey, null); assert.equal(auth.isKeyLocked, true);
		assert.equal(unpacked.dmkRaw.every(value => value === 0), true); assert.equal(unpacked.privateKeyPkcs8.every(value => value === 0), true);
	} finally { clearTimeout(timer); release(); await pending.catch(() => {}); db.getMasterConfig = read; }
});
