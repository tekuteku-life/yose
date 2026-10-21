// A signing authenticator fixture. Production verification must validate every returned field.
export async function createSigningAuthenticator() {
	const subtle = globalThis.crypto.subtle;
	const keys = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
	const publicKey = await subtle.exportKey('spki', keys.publicKey);
	const id = new Uint8Array([1, 2, 3, 4]);
	const encode = value => new TextEncoder().encode(value);
	const b64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
	const fixture = { origin: 'https://yose.local', user: null, lastCreate: null, lastGet: null, change: null };
	async function response(options, type) {
		const data = { type, challenge: b64url(options.publicKey.challenge), origin: fixture.origin, crossOrigin: false };
		const authData = new Uint8Array(37);
		authData.set(new Uint8Array(await subtle.digest('SHA-256', encode('yose.local'))));
		authData[32] = 5;
		if (fixture.beforeSign) fixture.beforeSign(data, authData);
		const clientDataJSON = encode(JSON.stringify(data));
		const signed = new Uint8Array(authData.length + 32);
		signed.set(authData);
		signed.set(new Uint8Array(await subtle.digest('SHA-256', clientDataJSON)), authData.length);
		const raw = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, signed));
		const integer = bytes => {
			let index = 0;
			while (index < bytes.length - 1 && bytes[index] === 0) index++;
			const body = Array.from(bytes.slice(index));
			if (body[0] & 128) body.unshift(0);
			return [2, body.length, ...body];
		};
		const content = [...integer(raw.slice(0, 32)), ...integer(raw.slice(32))];
		const credential = {
			type: 'public-key', rawId: id.buffer,
			response: {
				clientDataJSON: clientDataJSON.buffer,
				authenticatorData: authData.buffer,
				userHandle: fixture.user?.buffer,
				signature: new Uint8Array([48, content.length, ...content]).buffer,
				getPublicKey: () => publicKey,
				getPublicKeyAlgorithm: () => -7,
				getAuthenticatorData: () => authData.buffer
			}
		};
		if (fixture.change) fixture.change(credential, data);
		return credential;
	}
	fixture.nav = { credentials: {
		create: async options => {
			fixture.lastCreate = options;
			fixture.user = options.publicKey.user.id;
			return response(options, 'webauthn.create');
		},
		get: async options => { fixture.lastGet = options; return response(options, 'webauthn.get'); }
	} };
	return fixture;
}
