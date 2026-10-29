import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB, DEFAULT_MASTER_CONFIG } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const remoteMaster = () => ({ schema_version: 2, accounts: [{ id: 'remote-wallet', name: 'existing remote wallet', type: 'cash', initial_balance: 0 }], categories: [], recurring_rules: [], holidays: [], annual_budgets: {} });
async function fixture(config, local = structuredClone(DEFAULT_MASTER_CONFIG)) {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	local.theme = 'dark'; local.collapsed_panes = { private_pane: true }; await db.saveMasterConfig(local);
	gas.saveJsonFile('master_config.json', config);
	gas.saveJsonFile('summary_snapshot.json', { schema_version: 2, last_closed_month: null, account_balances: config.accounts ? { 'remote-wallet': 0 } : {}, monthly_summaries: {} });
	const keys = await generateEd25519KeyPair(); PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
	const requests = [], sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://first-sync.fixture', customFetch: async (_url, options) => {
		requests.push(JSON.parse(options.body)); return { ok: true, text: async () => JSON.stringify(gas.doPost({ postData: { contents: options.body } })) };
	} });
	return { db, sync, requests };
}

describe('fresh defaults meet existing remote master data on first signed sync', () => {
	let env;
	beforeEach(() => { env = new MockGasEnvironment(); env.setupGlobals(); });
	afterEach(() => env.teardownGlobals());
	for (const configuredPoint of [false, true]) it(`receives the existing remote master without treating untouched fresh defaults as user edits, remote point=${configuredPoint}`, async () => {
		const remote = remoteMaster();
		if (configuredPoint) { remote.categories.push({ id: 'remote-income', name: 'remote point income', type: 'income', subcategories: [{ id: 'remote-child', name: 'remote child' }] }); remote.point_payment_defaults = { category_id: 'remote-income', subcategory_id: 'remote-child' }; }
		const { db, sync, requests } = await fixture(remote), serverBefore = gas.handleAction('fetch_state', {});
		assert.equal(await db.getMasterSyncBase(), null);
		const result = await sync.syncBidirectional(); assert.equal(result.status, 'synced'); assert.equal(result.pending_master, false);
		const current = await db.getMasterConfig(); assert.deepEqual(sharedMasterConfig(current), sharedMasterConfig(remote));
		assert.deepEqual(current.point_payment_defaults ?? null, remote.point_payment_defaults ?? null); assert.equal(current.theme, 'dark'); assert.deepEqual(current.collapsed_panes, { private_pane: true });
		assert.deepEqual(await db.getMasterSyncBase(), sharedMasterConfig(remote)); assert.equal((await db.getRaw('master_config', 'sync_base')).encrypted, true);
		assert.deepEqual(gas.handleAction('fetch_state', {}), serverBefore); assert.equal(requests.filter(request => request.action === 'update_master').length, 0);
	});
	it('initializes an empty server with all fresh defaults including the explicit point setting', async () => {
		const { db, sync, requests } = await fixture({ schema_version: 2 });
		assert.equal((await sync.syncBidirectional()).status, 'synced');
		const remote = gas.handleAction('fetch_master', {}).master_config;
		assert.deepEqual(remote, sharedMasterConfig(DEFAULT_MASTER_CONFIG)); assert.deepEqual((await db.getMasterConfig()).point_payment_defaults, DEFAULT_MASTER_CONFIG.point_payment_defaults);
		assert.equal(requests.filter(request => request.action === 'update_master').length, 1);
	});
	it('protects an explicit local master change instead of applying the fresh-default shortcut', async () => {
		const local = structuredClone(DEFAULT_MASTER_CONFIG); local.accounts[0].name = 'explicit local wallet name';
		const { db, sync, requests } = await fixture(remoteMaster(), local), before = await db.captureImportState(), serverBefore = gas.handleAction('fetch_state', {});
		const result = await sync.syncBidirectional(); assert.equal(result.status, 'master_conflict'); assert.equal(result.pending_master, true);
		assert.deepEqual(await db.captureImportState(), before); assert.deepEqual(gas.handleAction('fetch_state', {}), serverBefore); assert.equal(requests.filter(request => request.action === 'update_master').length, 0);
	});
	it('still receives remote data for a legacy default master with no point-default field', async () => {
		const local = structuredClone(DEFAULT_MASTER_CONFIG); delete local.point_payment_defaults; const remote = remoteMaster();
		const { db, sync, requests } = await fixture(remote, local); assert.equal((await sync.syncBidirectional()).status, 'synced');
		const current = await db.getMasterConfig(); assert.deepEqual(sharedMasterConfig(current), sharedMasterConfig(remote)); assert.equal(current.point_payment_defaults ?? null, null); assert.equal(current.theme, 'dark');
		assert.equal(requests.filter(request => request.action === 'update_master').length, 0);
	});
	it('keeps existing transaction references even when the shared local master is exactly DEFAULT and no base exists', async () => {
		const { db, sync, requests } = await fixture(remoteMaster()); await db.putTransaction(transaction('persisted-local'));
		assert.deepEqual(sharedMasterConfig(await db.getMasterConfig()), sharedMasterConfig(DEFAULT_MASTER_CONFIG)); assert.equal(await db.getMasterSyncBase(), null);
		const before = await db.captureImportState(), serverBefore = gas.handleAction('fetch_state', {});
		await assert.rejects(sync.syncBidirectional(), /transactions\.persisted-local\.account_id/);
		assert.deepEqual(await db.captureImportState(), before); assert.equal(await db.getMasterSyncBase(), null); assert.deepEqual(gas.handleAction('fetch_state', {}), serverBefore);
		assert.equal(requests.filter(request => request.action === 'update_master').length, 0);
	});
	it('keeps nonempty local snapshot account references when fetching only the existing remote master', async () => {
		const { db, sync, requests } = await fixture(remoteMaster());
		await db.saveSnapshot({ schema_version: 2, last_closed_month: '2026-09', account_balances: { acc_wallet: 123456 }, monthly_summaries: {} });
		assert.deepEqual(sharedMasterConfig(await db.getMasterConfig()), sharedMasterConfig(DEFAULT_MASTER_CONFIG)); assert.equal(await db.getMasterSyncBase(), null);
		const before = await db.captureImportState(), serverBefore = gas.handleAction('fetch_state', {});
		await assert.rejects(sync.syncMaster(), /summary_snapshot\.account_balances\.acc_wallet/);
		assert.deepEqual(await db.captureImportState(), before); assert.equal((await db.getSnapshot()).account_balances.acc_wallet, 123456); assert.equal(await db.getMasterSyncBase(), null);
		assert.deepEqual(gas.handleAction('fetch_state', {}), serverBefore); assert.equal(requests.filter(request => request.action === 'update_master').length, 0);
	});
});
