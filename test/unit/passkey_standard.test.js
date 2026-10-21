import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerWebAuthnCredential, authenticateWithWebAuthn } from '../../js/crypto.js';
import { createSigningAuthenticator } from '../helpers/webauthn_fixture.js';

describe('Standard passkeys without PRF', () => {
	it('registers and verifies a signature without PRF, attachment, or transport restrictions', async () => {
		const f = await createSigningAuthenticator();
		const userId = crypto.getRandomValues(new Uint8Array(32));
		const credential = await registerWebAuthnCredential('test', f.nav, { userId, origin: f.origin });
		assert.ok(credential.publicKeySpki);
		assert.equal(credential.algorithm, -7);
		assert.equal(f.lastCreate.publicKey.extensions, undefined);
		assert.equal(f.lastCreate.publicKey.authenticatorSelection.authenticatorAttachment, undefined);
		assert.equal(f.lastCreate.publicKey.authenticatorSelection.userVerification, 'required');
		const result = await authenticateWithWebAuthn(credential, f.nav);
		assert.equal(result.success, true);
		assert.equal(f.lastGet.publicKey.extensions, undefined);
		assert.equal(f.lastGet.publicKey.allowCredentials[0].transports, undefined);
		await registerWebAuthnCredential('test', f.nav, { userId, origin: f.origin });
		assert.deepEqual(f.lastCreate.publicKey.user.id, userId);
	});

	for (const corruption of ['id', 'challenge', 'origin', 'type', 'crossOrigin', 'rpHash', 'UP', 'UV', 'signature', 'userHandle']) {
		it(`rejects a corrupted ${corruption} before allowing passkey authentication`, async () => {
			const f = await createSigningAuthenticator();
			const credential = await registerWebAuthnCredential('test', f.nav, { origin: f.origin });
			f.beforeSign = (data, authData) => {
				if (['challenge', 'origin', 'type', 'crossOrigin'].includes(corruption)) {
					data[corruption] = corruption === 'crossOrigin' ? true : 'invalid';
				} else if (corruption === 'rpHash') authData[0] ^= 1;
				else if (corruption === 'UP') authData[32] = 4;
				else if (corruption === 'UV') authData[32] = 1;
			};
			f.change = assertion => {
				if (corruption === 'id') assertion.rawId = new Uint8Array([9]).buffer;
				else if (corruption === 'userHandle') assertion.response.userHandle = new Uint8Array([9]).buffer;
				else if (corruption === 'signature') new Uint8Array(assertion.response.signature)[10] ^= 1;
			};
			await assert.rejects(authenticateWithWebAuthn(credential, f.nav));
		});
	}
	for (const field of ['challenge', 'origin', 'type', 'algorithm']) {
		it(`rejects an invalid registration ${field}`, async () => {
			const f = await createSigningAuthenticator();
			f.beforeSign = data => { if (field !== 'algorithm') data[field] = 'invalid'; };
			if (field === 'algorithm') f.change = credential => { credential.response.getPublicKeyAlgorithm = () => -99; };
			await assert.rejects(registerWebAuthnCredential('test', f.nav, { origin: f.origin }));
		});
	}
});
