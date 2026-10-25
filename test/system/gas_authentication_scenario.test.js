import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { generateEd25519KeyPair, exportPublicKeyBase64, createSignedRequest } from '../../js/crypto.js';
import { DEFAULT_MASTER_CONFIG, DEFAULT_SUMMARY_SNAPSHOT } from '../../js/db/defaults.js';
import { transaction } from '../helpers/ui_fixture.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');
it('keeps signed monthly close usable with cache unavailable while replay and tampering cannot change business data', async () => {
	const env = new MockGasEnvironment(); env.setupGlobals();
	try {
		delete globalThis.CacheService;
		const keys = await generateEd25519KeyPair(); gas.setScriptProp('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		gas.saveJsonFile('master_config.json', structuredClone(DEFAULT_MASTER_CONFIG));
		gas.saveJsonFile('summary_snapshot.json', structuredClone(DEFAULT_SUMMARY_SNAPSHOT));
		const tx = transaction('auth_scenario', { amount: 500 });
		const request = await createSignedRequest('push_diff', { transactions: [tx] }, keys.privateKey);
		const send = envelope => gas.doPost({ postData: { contents: JSON.stringify(envelope) } });
		assert.equal(send(request).success, true);
		assert.equal(send(request).success, false);
		const closed = send(await createSignedRequest('close_month', { target_month: tx.target_month, approved_planned: [] }, keys.privateKey));
		assert.equal(closed.success, true); assert.equal(closed.archived_count, 1);
		const before = gas.loadJsonFile('archives/2026-10.json');
		assert.equal(send({ ...request, payload: { transactions: [{ ...tx, amount: 999999 }] } }).success, false);
		assert.equal(send(request).success, false);
		assert.deepEqual(gas.loadJsonFile('archives/2026-10.json'), before);
		const state = send(await createSignedRequest('fetch_state', {}, keys.privateKey));
		assert.equal(state.success, true); assert.equal(Object.hasOwn(state, 'auth_replay'), false);
		const receiptKeys = [...env.properties.keys()].filter(key => key.startsWith('AUTH_REPLAY_'));
		const replacement = { import_id: 'auth-replacement', base_version: state.state_version, data: { schema_version: 2, export_type: 'transactions', transactions: [transaction('imported_auth', { amount: 200 })] } };
		const imported = send(await createSignedRequest('replace_import', replacement, keys.privateKey));
		assert.equal(imported.success, true);
		assert.ok(receiptKeys.every(key => env.properties.has(key)));
		assert.equal(send(request).success, false);
		const retry = send(await createSignedRequest('replace_import', replacement, keys.privateKey, Date.now() + 1));
		assert.equal(retry.success, true); assert.equal(retry.import_id, replacement.import_id);

	} finally { env.teardownGlobals(); }
});
