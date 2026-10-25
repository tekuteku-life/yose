import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateEd25519KeyPair, exportPublicKeyBase64, createSignedRequest } from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { transaction } from '../helpers/ui_fixture.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const manifest = JSON.parse(readFileSync(new URL('../../gas/appsscript.json', import.meta.url), 'utf8'));

// This fixture models the publication gate; it does not emulate Google's live CORS/login service.
describe('GAS anonymous transport with registered-key authorization', () => {
	let env, db, keys, publicKey;
	beforeEach(async () => {
		env = new MockGasEnvironment(); env.setupGlobals();
		db = new YoseDB(); await db.init();
		keys = await generateEd25519KeyPair(); publicKey = await exportPublicKeyBase64(keys.publicKey);
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', publicKey);
		gas.saveJsonFile('master_config.json', await db.getMasterConfig());
		gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
	});
	afterEach(() => env.teardownGlobals());

	it('allows cookie-free entry while retaining owner execution and minimal OAuth scope', () => {
		assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
		assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
		assert.deepEqual(manifest.oauthScopes, ['https://www.googleapis.com/auth/spreadsheets.currentonly']);
	});
	it('keeps README manifest examples and setup guidance consistent with anonymous publication', () => {
		const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
		const examples = [...readme.matchAll(/```json\s*\n([\s\S]*?)```/g)].map(match => JSON.parse(match[1]));
		assert.equal(examples.find(example => example.webapp)?.webapp.access, 'ANYONE_ANONYMOUS');
		assert.ok(readme.includes('Googleログイン不要'));
		const setup = readFileSync(new URL('../../scripts/setup_gas.js', import.meta.url), 'utf8');
		assert.ok(setup.includes('Googleログイン不要'));
		assert.ok(setup.indexOf('USER_PUBLIC_KEYS') < setup.indexOf('アクセスできるユーザー'));
	});
	it('explains the stopped migration before any setup deployment command or publication checklist', () => {
		const setup = readFileSync(new URL('../../scripts/setup_gas.js', import.meta.url), 'utf8');
		const stop = setup.indexOf('旧版の全公開URLを停止');
		const finished = setup.indexOf('旧版の全実行終了を確認');
		const wait = setup.indexOf('600,000msを超えて待機');
		assert.ok(stop >= 0 && stop < finished && finished < wait);
		assert.ok(wait < setup.indexOf('npx @google/clasp deploy'));
		assert.ok(wait < setup.indexOf('[デプロイ] -> [新しいデプロイ]'));
		assert.ok(setup.includes('AUTH_REPLAY_'));
	});

	it('completes signed bidirectional synchronization without Google login cookies', async () => {
		await db.putTransaction(transaction('local_public_access'));
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('remote_public_access')] });
		const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://script.google.com/macros/s/public-test/exec', customFetch: async (_url, options) => {
			assert.equal(options.credentials, 'omit');
			assert.equal(options.redirect, 'follow');
			assert.equal(options.headers['Content-Type'], 'text/plain;charset=utf-8');
			if (manifest.webapp.access !== 'ANYONE_ANONYMOUS') throw new TypeError('Failed to fetch: publication requires Google login');
			return { ok: true, text: async () => JSON.stringify(gas.doPost({ postData: { contents: options.body } })) };
		} });
		await sync.syncBidirectional();
		assert.equal((await db.getTransaction('remote_public_access')).sync_status, 'synced');
		assert.equal((await db.getTransaction('local_public_access')).sync_status, 'synced');
		assert.ok(gas.loadJsonFile('pending_diffs.json').transactions.some(row => row.id === 'local_public_access'));
	});
	for (const action of ['fetch_state', 'fetch_master']) {
		it(`rejects unsigned ${action} without disclosing or modifying stored data`, () => {
			const before = gas.loadJsonFile('master_config.json');
			const result = gas.doPost({ postData: { contents: JSON.stringify({ action, timestamp: Date.now(), payload: {} }) } });
			assert.equal(result.success, false);
			assert.equal(result.master_config, undefined); assert.equal(result.pending_diffs, undefined);
			assert.deepEqual(gas.loadJsonFile('master_config.json'), before);
		});
	}
	it('rejects an unregistered signing key even when the endpoint is anonymously reachable', async () => {
		const foreign = await generateEd25519KeyPair();
		const request = await createSignedRequest('fetch_state', {}, foreign.privateKey);
		const result = gas.doPost({ postData: { contents: JSON.stringify(request) } });
		assert.equal(result.success, false); assert.equal(result.master_config, undefined);
	});
	it('requires owner-managed setup and keeps the replay ledger private across signed transport', async () => {
		PropertiesService.getScriptProperties().deleteProperty('USER_PUBLIC_KEYS');
		const registration = await createSignedRequest('register_initial_key', { publicKey }, keys.privateKey);
		assert.equal(gas.doPost({ postData: { contents: JSON.stringify(registration) } }).success, false);
		assert.equal(PropertiesService.getScriptProperties().getProperty('USER_PUBLIC_KEYS'), null);
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', publicKey);
		delete globalThis.CacheService;
		const request = await createSignedRequest('fetch_state', {}, keys.privateKey);
		const response = gas.doPost({ postData: { contents: JSON.stringify(request) } });
		assert.equal(response.success, true);
		assert.ok([...env.properties.keys()].some(key => key.startsWith('AUTH_REPLAY_')));
		assert.equal(Object.hasOwn(response, 'auth_replay'), false);
		assert.equal(JSON.stringify(response).includes('expires_at'), false);
		assert.equal(gas.doPost({ postData: { contents: JSON.stringify(request) } }).success, false);
	});
	it('returns only fixed connection status for an anonymous GET', () => {
		assert.deepEqual(gas.doGet({}), { status: 'ok', app: 'よせあつめ家計簿 Backend (GAS)' });
	});
	it('does not replace a preconfigured owner key through initial registration', async () => {
		const foreign = await generateEd25519KeyPair();
		const request = await createSignedRequest('register_initial_key', { publicKey: await exportPublicKeyBase64(foreign.publicKey) }, foreign.privateKey);
		const result = gas.doPost({ postData: { contents: JSON.stringify(request) } });
		assert.equal(result.success, false);
		assert.equal(PropertiesService.getScriptProperties().getProperty('USER_PUBLIC_KEYS'), publicKey);
	});
});
