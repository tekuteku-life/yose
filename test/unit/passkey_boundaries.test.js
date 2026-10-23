import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { registerWebAuthnCredential, authenticateWithWebAuthn, isWebAuthnSupported } from '../../js/webauthn.js';
import { canonicalJsonStringify, getSubtle, getRandomValues } from '../../js/crypto.js';
import { createSigningAuthenticator } from '../helpers/webauthn_fixture.js';
import { createRequire } from 'node:module';

const gas = createRequire(import.meta.url)('../../gas/Code.gs');

async function registered(options) {
	const fixture = await createSigningAuthenticator(options);
	const credential = await registerWebAuthnCredential(undefined, fixture.nav, { origin: fixture.origin });
	return { fixture, credential };
}

describe('Public WebAuthn input boundaries', () => {
	for (const nav of [null, {}, { credentials: {} }, { credentials: { create() {} } }, { credentials: { get() {} } }]) {
		it(`rejects an unsupported credentials API ${JSON.stringify(nav)}`, async () => {
			assert.equal(isWebAuthnSupported(nav), false);
			await assert.rejects(registerWebAuthnCredential(undefined, nav), /not supported/);
			await assert.rejects(authenticateWithWebAuthn({}, nav), /not supported/);
		});
	}
	for (const mutation of ['null', 'rawId', 'type', 'key', 'keyMethod', 'algorithmMethod']) {
		it(`rejects incomplete create result: ${mutation}`, async () => {
			const f = await createSigningAuthenticator();
			if (mutation === 'null') f.nav.credentials.create = async () => null;
			else f.change = result => {
				if (mutation === 'rawId') delete result.rawId;
				if (mutation === 'type') result.type = 'password';
				if (mutation === 'key') result.response.getPublicKey = () => null;
				if (mutation === 'keyMethod') delete result.response.getPublicKey;
				if (mutation === 'algorithmMethod') delete result.response.getPublicKeyAlgorithm;
			};
			await assert.rejects(registerWebAuthnCredential(undefined, f.nav, { origin: f.origin }), /WebAuthn/);
		});
	}
	for (const stored of [null, {}, { publicKeySpki: 'a' }, { credentialId: 'a' }]) {
		it(`requires re-registration for incomplete descriptor ${JSON.stringify(stored)}`, async () => {
			const f = await createSigningAuthenticator();
			await assert.rejects(authenticateWithWebAuthn(stored, f.nav), /re-registration/);
			assert.equal(f.lastGet, null);
		});
	}
	it('rejects a different current origin before invoking the authenticator', async () => {
		const { fixture: f, credential } = await registered();
		const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
		try {
			Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://other.local' } });
			await assert.rejects(authenticateWithWebAuthn(credential, f.nav), /origin mismatch/);
			assert.equal(f.lastGet, null);
		} finally {
			if (original) Object.defineProperty(globalThis, 'location', original); else delete globalThis.location;
		}
	});
	it('verifies real RSA signatures and rejects modified signatures', async () => {
		const { fixture: f, credential } = await registered({ algorithm: -257 });
		assert.equal((await authenticateWithWebAuthn(credential, f.nav)).success, true);
		f.change = assertion => { new Uint8Array(assertion.response.signature)[0] ^= 1; };
		await assert.rejects(authenticateWithWebAuthn(credential, f.nav), /signature verification failed/);
	});
	it('authenticates a pre-PRF credential without requesting or inventing PRF output', async () => {
		const { fixture: f, credential } = await registered({ prf: true });
		delete credential.prfSalt;
		f.change = assertion => { delete assertion.response.userHandle; delete assertion.getClientExtensionResults; };
		assert.deepEqual(await authenticateWithWebAuthn(credential, f.nav), { success: true, credentialId: credential.credentialId, prfOutput: undefined });
		assert.equal(f.lastGet.publicKey.extensions, undefined);
	});
	it('accepts PRF results without enabled and never infers output from enabled alone', async () => {
		const { fixture: f, credential } = await registered({ prf: true });
		f.change = assertion => {
			const output = assertion.getClientExtensionResults().prf.results.first;
			assertion.getClientExtensionResults = () => ({ prf: { results: { first: output } } });
		};
		assert.equal((await authenticateWithWebAuthn(credential, f.nav)).prfOutput.byteLength, 32);
		for (const result of [undefined, {}, { prf: {} }, { prf: { enabled: true } }, { prf: { results: {} } }]) {
			f.change = assertion => { assertion.getClientExtensionResults = () => result; };
			assert.equal((await authenticateWithWebAuthn(credential, f.nav)).prfOutput, undefined);
		}
	});
	for (const length of [31, 33]) {
		it(`rejects authenticator PRF output length ${length}`, async () => {
			const { fixture: f, credential } = await registered();
			f.change = assertion => { assertion.getClientExtensionResults = () => ({ prf: { results: { first: new Uint8Array(length).buffer } } }); };
			await assert.rejects(authenticateWithWebAuthn(credential, f.nav), /Invalid WebAuthn PRF output/);
		});
	}
	for (const result of ['null', 'noId', 'type']) {
		it(`rejects missing or invalid assertion ${result}`, async () => {
			const { fixture: f, credential } = await registered();
			if (result === 'null') f.nav.credentials.get = async () => null;
			else f.change = assertion => { if (result === 'noId') delete assertion.rawId; else assertion.type = 'password'; };
			await assert.rejects(authenticateWithWebAuthn(credential, f.nav), /credential mismatch/);
		});
	}
	it('rejects an unsupported persisted signing algorithm', async () => {
		const { fixture: f, credential } = await registered();
		await assert.rejects(authenticateWithWebAuthn({ ...credential, algorithm: -99 }, f.nav), /not supported/);
	});
	const integer = (length, first = 1) => [2, length, first, ...new Array(Math.max(0, length - 1)).fill(1)];
	const pair = content => new Uint8Array([48, content.length, ...content]).buffer;
	const valid = [2, 1, 1, 2, 1, 1];
	const malformed = {
		outerTag: new Uint8Array([49, 6, ...valid]).buffer,
		outerLength: new Uint8Array([48, 7, ...valid]).buffer,
		integerTag: pair([3, 1, 1, 2, 1, 1]),
		emptyInteger: pair([2, 0, 2, 1, 1]),
		longInteger: pair([...integer(34), 2, 1, 1]),
		truncatedInteger: pair([2, 32, 1]),
		negativeInteger: pair([2, 1, 128, 2, 1, 1]),
		invalidPadding: pair([...integer(33), 2, 1, 1]),
		trailingBytes: pair([...valid, 0])
	};
	for (const [name, signature] of Object.entries(malformed)) {
		it(`rejects malformed DER ${name} through the public authentication API`, async () => {
			const { fixture: f, credential } = await registered();
			f.change = assertion => { assertion.response.signature = signature; };
			await assert.rejects(authenticateWithWebAuthn(credential, f.nav), /Invalid WebAuthn signature/);
		});
	}
	it('rejects truncated authenticator data', async () => {
		const { fixture: f, credential } = await registered();
		f.change = assertion => { assertion.response.authenticatorData = new Uint8Array(36).buffer; };
		await assert.rejects(authenticateWithWebAuthn(credential, f.nav), /RP ID or user verification/);
	});
});

describe('Crypto platform and canonical array boundaries', () => {
	it('rejects unavailable Web Crypto APIs but uses the real default APIs', () => {
		for (const unavailable of [null, {}]) {
			assert.throws(() => getSubtle(unavailable), /not available/);
			assert.throws(() => getRandomValues(new Uint8Array(1), unavailable), /not available/);
		}
		assert.equal(getSubtle(), crypto.subtle);
		assert.equal(getRandomValues(new Uint8Array(10)).length, 10);
	});
	it('retains null array positions for non-JSON values and sparse slots', () => {
		const values = [undefined, () => {}, Symbol('x'), , { z: 1, a: 2 }];
		assert.equal(canonicalJsonStringify(values), '[null,null,null,null,{"a":2,"z":1}]');
		assert.equal(canonicalJsonStringify([, ,]), '[null,null]');
		assert.equal(gas.canonicalJsonStringify(values), canonicalJsonStringify(values));
		assert.equal(gas.canonicalJsonStringify([, ,]), '[null,null]');
	});
});
