import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { dataIntegrity } from '../../js/logic/data_integrity.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { transaction } from '../helpers/ui_fixture.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const tombstone = id => ({ id, is_deleted: true, updated_at: '2026-10-22T00:00:00Z', sync_status: 'synced' });

describe('Complete replacement removes invalid historical rows without recreating their defects', () => {
	let env, db, sync;
	beforeEach(async () => {
		env = new MockGasEnvironment(); env.setupGlobals();
		db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		const keys = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		gas.saveJsonFile('master_config.json', await db.getMasterConfig());
		gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
		sync = new SyncManager({ db, privateKey: keys.privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => ({ ok: true, text: async () => JSON.stringify(gas.doPost({ postData: { contents: options.body } })) }) });
	});
	afterEach(() => env.teardownGlobals());
	for (const [label, defect] of [
		['amount', { amount: -1 }], ['date', { date: 'invalid' }], ['month', { target_month: '2026-99' }], ['type', { type: 'legacy' }],
		['status', { status: 'invalid' }], ['metadata', { tax_meta: [] }], ['timestamp', { updated_at: 'invalid' }], ['timestamp object', { updated_at: { toString: 0 } }],
		['unsafe metadata', { tax_meta: JSON.parse('{"__proto__":{"polluted":true}}') }]
	]) {
		it(`omits an old invalid ${label}, propagates a minimal deletion, and round-trips the export`, async () => {
			const invalid = transaction('old-invalid', defect);
			gas.saveJsonFile('pending_diffs.json', { transactions: [invalid] });
			await db.putRaw('transactions', await db.encryptRecord(invalid, { id: invalid.id, target_month: invalid.target_month, sync_status: invalid.sync_status }));
			await db.commitReplacementImport(await db.prepareReplacementImport([]), { confirmation: '完全インポート' });
			assert.equal((await sync.syncBidirectional()).status, 'synced');
			assert.equal(await db.getPendingImport(), null);
			const state = gas.handleAction('fetch_state', {}), deleted = state.pending_diffs.find(row => row.id === invalid.id);
			assert.deepEqual(Object.keys(deleted).sort(), ['id', 'is_deleted', 'sync_status', 'updated_at']);
			assert.equal(deleted.is_deleted, true);
			assert.deepEqual(dataIntegrity.issues({ master_config: state.master_config, transactions: [...state.pending_diffs, ...state.archived_transactions], summary_snapshot: state.snapshot }), []);
			assert.equal((await db.getTransaction(invalid.id)).is_deleted, true);
			const exported = await db.exportFullData();
			await db.commitReplacementImport(await db.prepareReplacementImport(exported), { confirmation: '完全インポート' });
			assert.equal((await sync.syncBidirectional()).status, 'synced');
			assert.equal((await db.getTransaction(invalid.id)).is_deleted, true);
		});
	}
	it('propagates a minimal imported deletion of an archived ID through the approved retroactive path', async () => {
		const original = transaction('closed', { date: '2026-09-01', target_month: '2026-09', sync_status: 'synced' });
		const snapshot = await db.getSnapshot();
		snapshot.monthly_summaries['2026-09'] = gas.computeMonthlySummary([original], snapshot.account_balances);
		snapshot.account_balances = snapshot.monthly_summaries['2026-09'].closing_balances;
		gas.saveJsonFile('archives/2026-09.json', { transactions: [original] });
		gas.saveJsonFile('summary_snapshot.json', snapshot);
		await db.saveSnapshot(snapshot); await db.putTransaction(original);
		await db.importFullData({ export_type: 'transactions', transactions: [tombstone(original.id)] });
		let approvals = 0;
		const result = await sync.syncBidirectional({ approveReclose: async (_rows, months) => { approvals++; assert.deepEqual(months, ['2026-09']); return true; } });
		assert.equal(result.status, 'synced'); assert.equal(approvals, 1);
		const state = gas.handleAction('fetch_state', {});
		assert.equal(state.archived_transactions.filter(row => row.id === original.id).length, 0);
		assert.equal(state.pending_diffs.find(row => row.id === original.id).is_deleted, true);
		assert.equal(state.snapshot.monthly_summaries['2026-09'].expense_total, 0);
		assert.equal((await db.getTransaction(original.id)).sync_status, 'synced');
		const other = new YoseDB(); await other.init(); other.setEncryptionKey(await generateDatabaseMasterKey());
		await other.putTransaction(original); await other.saveSnapshot(snapshot);
		const otherSync = new SyncManager({ db: other, privateKey: sync.privateKey, gasUrl: sync.gasUrl, customFetch: sync.fetch });
		assert.equal((await otherSync.syncBidirectional()).status, 'synced');
		assert.equal((await other.getTransaction(original.id)).is_deleted, true);
		assert.equal((await other.getSnapshot()).monthly_summaries['2026-09'].expense_total, 0);
	});
	it('refuses to generate an unsafe deletion identity and preserves every server sheet', () => {
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('__proto__')] });
		const before = gas.handleAction('fetch_state', {});
		const response = gas.handleAction('replace_import', { import_id: 'unsafe-removal', base_version: before.state_version, data: { schema_version: 2, export_type: 'transactions', transactions: [] } });
		assert.equal(response.success, false);
		assert.deepEqual(gas.handleAction('fetch_state', {}), before);
	});
});

describe('Minimal deletion contract', () => {
	const master_config = { schema_version: 2, accounts: [], categories: [], recurring_rules: [], holidays: [] };
	const check = row => dataIntegrity.assertChange(null, { master_config, transactions: [row], summary_snapshot: {} }, { strict: true, allowArchivedReferences: true });
	it('accepts an identity and timestamp without invented business values', () => { assert.doesNotThrow(() => check(tombstone('deleted'))); });
	for (const [label, patch] of [
		['missing timestamp', { updated_at: undefined }], ['null timestamp', { updated_at: null }], ['invalid timestamp', { updated_at: 'invalid' }],
		['unsafe ID', { id: 'constructor' }], ['invalid amount', { amount: -1 }], ['null amount', { amount: null }], ['invalid date', { date: 'invalid' }],
		['null date', { date: null }], ['invalid type', { type: 'legacy' }], ['invalid month', { target_month: '2026-99' }], ['invalid status', { status: 'legacy' }]
	]) it(`rejects ${label} in a supplied deletion`, () => { assert.throws(() => check({ ...tombstone('deleted'), ...patch })); });
});
