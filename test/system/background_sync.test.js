import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { runBackgroundSync } from '../../js/background_sync_worker.js';
import { generateEd25519KeyPair, exportPublicKeyBase64, generateDatabaseMasterKey } from '../../js/crypto.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { transaction } from '../helpers/ui_fixture.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');

describe('Background synchronization against the original signed GAS protocol', () => {
	let environment, db, sync, fetch, delegated;
	beforeEach(async () => {
		environment = new MockGasEnvironment(); environment.setupGlobals();
		db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		const keys = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		gas.saveJsonFile('master_config.json', sharedMasterConfig(await db.getMasterConfig()));
		gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
		fetch = async (_url, options) => {
			const response = gas.doPost({ postData: { contents: options.body } });
			return { ok: true, text: async () => JSON.stringify(response) };
		};
		delegated = 0;
		sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://gas.test/exec', customFetch: fetch,
			backgroundSync: async (job, options) => { delegated++; return runBackgroundSync(structuredClone(job), { ...options, fetch }); } });
	});
	afterEach(() => environment.teardownGlobals());
	it('sends local differences and receives other-device differences using the unchanged GAS implementation', async () => {
		await db.putTransaction(transaction('worker-system-local'));
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('worker-system-remote', { amount: 432, sync_status: 'synced' })] });
		assert.equal((await sync.syncBidirectional()).status, 'synced'); assert.equal(delegated, 1);
		assert.equal((await db.getTransaction('worker-system-local')).sync_status, 'synced');
		assert.equal((await db.getTransaction('worker-system-remote')).amount, 432);
		assert.ok(gas.handleAction('fetch_state', {}).pending_diffs.some(tx => tx.id === 'worker-system-local'));
	});
	it('keeps complete-import base binding on the persistent foreground path, including after a lost server response', async () => {
		const plan = await db.prepareReplacementImport({ schema_version: 2, export_type: 'transactions', transactions: [transaction('worker-system-import')] });
		await db.commitReplacementImport(plan, { confirmation: '完全インポート' });
		sync.fetch = async (url, options) => {
			const response = await fetch(url, options);
			if (JSON.parse(options.body).action === 'replace_import') throw new Error('server reply lost');
			return response;
		};
		await assert.rejects(sync.syncBidirectional(), /server reply lost/);
		assert.equal(delegated, 0);
		const pending = await db.getPendingImport(); assert.equal(typeof pending.base_version, 'string');
		assert.ok(gas.handleAction('fetch_state', {}).pending_diffs.some(tx => tx.id === 'worker-system-import'));
		sync.fetch = fetch;
		assert.equal((await sync.syncBidirectional()).status, 'synced');
		assert.equal(delegated, 0); assert.equal(await db.getPendingImport(), null);
	});
});
