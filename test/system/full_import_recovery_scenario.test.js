import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { transaction } from '../helpers/ui_fixture.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');

it('recovers an offline full replacement and lost ACK without resurrecting removed records or losing later edits', async () => {
	const env = new MockGasEnvironment(); env.setupGlobals();
	try {
		const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		const keys = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		gas.saveJsonFile('master_config.json', sharedMasterConfig(await db.getMasterConfig()));
		gas.saveJsonFile('summary_snapshot.json', { ...await db.getSnapshot(), last_closed_month: '2026-09' });
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('removed-pending')] });
		gas.saveJsonFile('archives/2026-09.json', { transactions: [transaction('removed-archive', { target_month: '2026-09' })] });
		await db.putTransaction(transaction('removed-local'));
		const backup = await db.exportFullData();
		backup.master_config.accounts[0].name = '編集した JSON の口座';
		backup.transactions = [transaction('kept', { amount: 200, updated_at: '2020-01-01T00:00:00Z' })];
		const plan = await db.prepareReplacementImport(backup);
		await db.commitReplacementImport(plan, { confirmation: '完全インポート' });
		let offline = true, dropAck = true;
		const sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => {
			if (offline) throw new Error('offline');
			const action = JSON.parse(options.body).action;
			const response = gas.doPost({ postData: { contents: options.body } });
			if (action === 'replace_import' && dropAck) { dropAck = false; throw new Error('lost ACK after server commit'); }
			return { ok: true, text: async () => JSON.stringify(response) };
		} });
		await assert.rejects(sync.syncBidirectional(), /offline/);
		assert.ok(await db.getPendingImport());
		assert.equal(await db.getTransaction('removed-local'), null);
		offline = false;
		await assert.rejects(sync.syncBidirectional(), /lost ACK/);
		assert.ok(await db.getPendingImport());
		const serverMaster = gas.handleAction('fetch_state', {}).master_config;
		serverMaster.accounts[1].name = '別端末の後続編集';
		gas.saveJsonFile('master_config.json', serverMaster);
		await db.putTransaction(transaction('kept', { amount: 999, updated_at: '2026-10-22T00:00:00Z' }));
		await db.putTransaction(transaction('later-local'));
		const result = await sync.syncBidirectional();
		assert.equal(result.status, 'synced');
		assert.equal(await db.getPendingImport(), null);
		assert.equal(sync.isSyncing, false);
		const remote = gas.handleAction('fetch_state', {});
		assert.deepEqual(remote.pending_diffs.filter(tx => !tx.is_deleted).map(tx => tx.id).sort(), ['kept', 'later-local']);
		assert.equal(remote.archived_transactions.filter(tx => !tx.is_deleted).length, 0);
		assert.equal(remote.pending_diffs.find(tx => tx.id === 'kept').amount, 999);
		assert.equal((await db.getMasterConfig()).accounts[0].name, '編集した JSON の口座');
		assert.equal((await db.getMasterConfig()).accounts[1].name, '別端末の後続編集');
		assert.deepEqual(await db.getMasterSyncBase(), remote.master_config);
	} finally { env.teardownGlobals(); }
});
