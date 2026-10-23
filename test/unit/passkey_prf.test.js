import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as cryptoApi from '../../js/crypto.js';
import { createSigningAuthenticator } from '../helpers/webauthn_fixture.js';

async function setup() {
	const f = await createSigningAuthenticator({ prf: true });
	const credential = await cryptoApi.registerWebAuthnCredential('test', f.nav, { origin: f.origin });
	const auth = await cryptoApi.authenticateWithWebAuthn(credential, f.nav);
	const keys = { dmkRaw: crypto.getRandomValues(new Uint8Array(32)), privateKeyPkcs8: new Uint8Array([1, 2, 3]) };
	assert.equal(auth.prfOutput?.byteLength, 32);
	return { f, credential, auth, keys };
}

describe('PRF protected master keys', () => {
	it('wraps keys with verified PRF output and can decrypt them after a fresh authentication', async () => {
		const { f, credential, auth, keys } = await setup();
		const wrapped = await cryptoApi.encryptMasterKeysWithPrf(keys, auth.prfOutput, credential);
		const next = await cryptoApi.authenticateWithWebAuthn(credential, f.nav);
		assert.deepEqual(await cryptoApi.decryptMasterKeysWithPrf(wrapped, next.prfOutput, credential), keys);
		assert.deepEqual(Object.keys(wrapped).sort(), ['ciphertext', 'iv', 'salt', 'version']);
		assert.ok(!JSON.stringify(wrapped).includes(cryptoApi.bytesToBase64(keys.dmkRaw)));
		assert.ok(!JSON.stringify(wrapped).includes(cryptoApi.bytesToBase64(auth.prfOutput)));
		const another = await cryptoApi.encryptMasterKeysWithPrf(keys, auth.prfOutput, credential);
		assert.notEqual(another.iv, wrapped.iv); assert.notEqual(another.salt, wrapped.salt);
	});
	for (const field of ['ciphertext', 'iv', 'salt', 'version', 'credentialId', 'origin', 'rpId', 'prfSalt']) it(`rejects altered ${field}`, async () => {
		const { credential, auth, keys } = await setup();
		const wrapped = await cryptoApi.encryptMasterKeysWithPrf(keys, auth.prfOutput, credential);
		if (Object.hasOwn(wrapped, field)) wrapped[field] = field === 'version' ? 9 : cryptoApi.bytesToBase64(new Uint8Array(32));
		else credential[field] = 'altered';
		await assert.rejects(cryptoApi.decryptMasterKeysWithPrf(wrapped, auth.prfOutput, credential));
	});
	it('rejects a different or missing PRF and an invalid PRF size', async () => {
		const { credential, auth, keys } = await setup();
		const wrapped = await cryptoApi.encryptMasterKeysWithPrf(keys, auth.prfOutput, credential);
		for (const output of [undefined, new Uint8Array(31), new Uint8Array(33), crypto.getRandomValues(new Uint8Array(32))]) await assert.rejects(cryptoApi.decryptMasterKeysWithPrf(wrapped, output, credential));
	});
	it('does not expose PRF material until the assertion signature has been verified', async () => {
		const { f, credential } = await setup();
		f.change = assertion => { new Uint8Array(assertion.response.signature)[10] ^= 1; };
		await assert.rejects(cryptoApi.authenticateWithWebAuthn(credential, f.nav));
	});
	it('preserves non-PRF authentication and does not infer support from enabled alone', async () => {
		const f = await createSigningAuthenticator();
		const credential = await cryptoApi.registerWebAuthnCredential('test', f.nav, { origin: f.origin });
		const result = await cryptoApi.authenticateWithWebAuthn(credential, f.nav);
		assert.equal(result.success, true); assert.equal(result.prfOutput, undefined);
	});
});
