/** WebAuthnの登録・署名検証と任意のPRF出力取得である。 */
import { bytesToBase64, base64ToBytes } from './crypto.js';

const bytes = value => new Uint8Array(value);
const encode = value => new TextEncoder().encode(value);
const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index]);
const base64url = value => bytesToBase64(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function verifyResponse(response, challenge, origin, rpId, type, authenticatorData) {
	const client = JSON.parse(new TextDecoder().decode(response.clientDataJSON));
	if (client.type !== type || client.challenge !== base64url(challenge) || client.origin !== origin || client.crossOrigin === true) {
		throw new Error('WebAuthn client data verification failed');
	}
	const auth = bytes(authenticatorData);
	const expected = bytes(await crypto.subtle.digest('SHA-256', encode(rpId)));
	if (auth.length < 37 || !equal(auth.slice(0, 32), expected) || (auth[32] & 5) !== 5) {
		throw new Error('WebAuthn RP ID or user verification failed');
	}
	return auth;
}

export function isWebAuthnSupported(nav = globalThis.navigator) {
	return typeof nav?.credentials?.create === 'function' && typeof nav?.credentials?.get === 'function';
}

/** @param {string} username @param {any} nav @param {Record<string, any>} options */
export async function registerWebAuthnCredential(username = 'よせあつめ家計簿', nav = globalThis.navigator, options = {}) {
	if (!isWebAuthnSupported(nav)) throw new Error('WebAuthn is not supported in this environment');
	const origin = options.origin || globalThis.location?.origin;
	const rpId = new URL(origin).hostname;
	const userId = options.userId || crypto.getRandomValues(new Uint8Array(32));
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const prfSalt = crypto.getRandomValues(new Uint8Array(32));
	const credential = await nav.credentials.create({ publicKey: {
		challenge, rp: { id: rpId, name: 'よせあつめ家計簿' },
		user: { id: userId, name: username, displayName: username },
		pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
		authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
		attestation: 'none', timeout: 60000,
		extensions: { prf: { eval: { first: prfSalt } } }
	} });
	if (!credential?.rawId || credential.type !== 'public-key') throw new Error('Failed to create WebAuthn credential');
	const response = credential.response;
	const algorithm = response.getPublicKeyAlgorithm?.();
	const publicKey = response.getPublicKey?.();
	if (![-7, -257].includes(algorithm) || !publicKey) throw new Error('WebAuthn public key is not supported');
	await verifyResponse(response, challenge, origin, rpId, 'webauthn.create', response.getAuthenticatorData());
	return { credentialId: bytesToBase64(bytes(credential.rawId)), publicKeySpki: bytesToBase64(bytes(publicKey)), algorithm, userHandle: bytesToBase64(userId), rpId, origin, prfSalt: bytesToBase64(prfSalt) };
}

// WebAuthn ES256 signatures use DER; Web Crypto expects a 64-byte P1363 signature.
function decodeDer(signature) {
	const der = bytes(signature);
	if (der[0] !== 48 || der[1] !== der.length - 2) throw new Error('Invalid WebAuthn signature');
	let offset = 2;
	const result = new Uint8Array(64);
	for (let part = 0; part < 2; part++) {
		if (der[offset++] !== 2) throw new Error('Invalid WebAuthn signature');
		const length = der[offset++];
		let value = der.slice(offset, offset + length); offset += length;
		if (value.length !== length || length < 1 || length > 33 || (value[0] & 128)) throw new Error('Invalid WebAuthn signature');
		if (value.length === 33) {
			if (value[0] !== 0) throw new Error('Invalid WebAuthn signature');
			value = value.slice(1);
		}
		result.set(value, (part + 1) * 32 - value.length);
	}
	if (offset !== der.length) throw new Error('Invalid WebAuthn signature');
	return result;
}

/** @param {Record<string, any>} stored @param {any} nav */
export async function authenticateWithWebAuthn(stored, nav = globalThis.navigator) {
	if (!isWebAuthnSupported(nav)) throw new Error('WebAuthn is not supported in this environment');
	if (!stored?.publicKeySpki || !stored.credentialId) throw new Error('WebAuthn re-registration is required');
	if (globalThis.location && globalThis.location.origin !== stored.origin) throw new Error('WebAuthn origin mismatch');
	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const assertion = await nav.credentials.get({ publicKey: {
		challenge, rpId: stored.rpId, userVerification: 'required', timeout: 60000,
		allowCredentials: [{ id: base64ToBytes(stored.credentialId), type: 'public-key' }],
		...(stored.prfSalt ? { extensions: { prf: { eval: { first: base64ToBytes(stored.prfSalt) } } } } : {})
	} });
	if (!assertion?.rawId || assertion.type !== 'public-key' || bytesToBase64(bytes(assertion.rawId)) !== stored.credentialId) throw new Error('WebAuthn credential mismatch');
	const response = assertion.response;
	const auth = await verifyResponse(response, challenge, stored.origin, stored.rpId, 'webauthn.get', response.authenticatorData);
	if (response.userHandle && bytesToBase64(bytes(response.userHandle)) !== stored.userHandle) throw new Error('WebAuthn user handle mismatch');
	const clientHash = bytes(await crypto.subtle.digest('SHA-256', response.clientDataJSON));
	const signed = new Uint8Array(auth.length + clientHash.length); signed.set(auth); signed.set(clientHash, auth.length);
	const algorithm = stored.algorithm === -7 ? { name: 'ECDSA', namedCurve: 'P-256' } : stored.algorithm === -257 ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } : null;
	if (!algorithm) throw new Error('WebAuthn public key is not supported');
	const key = await crypto.subtle.importKey('spki', Uint8Array.from(base64ToBytes(stored.publicKeySpki)).buffer, algorithm, false, ['verify']);
	const signature = stored.algorithm === -7 ? decodeDer(response.signature).buffer : response.signature;
	const valid = await crypto.subtle.verify(stored.algorithm === -7 ? { name: 'ECDSA', hash: 'SHA-256' } : algorithm, key, signature, signed);
	if (!valid) throw new Error('WebAuthn signature verification failed');
	const output = assertion.getClientExtensionResults?.()?.prf?.results?.first;
	const prfOutput = output ? bytes(output) : undefined;
	if (prfOutput && prfOutput.byteLength !== 32) throw new Error('Invalid WebAuthn PRF output');
	return { success: true, credentialId: stored.credentialId, prfOutput };
}
