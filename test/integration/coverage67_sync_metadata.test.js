import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dataIntegrity } from '../../js/logic/data_integrity.js';
import { createSignedRequest, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';

const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const master = () => ({ schema_version: 2, accounts: [{ id: 'wallet', type: 'cash', initial_balance: 0 }, { id: 'bank', type: 'bank', initial_balance: 0 }], categories: [], recurring_rules: [], holidays: [] });
const record = () => ({ id: 'metadata', type: 'transfer', status: 'confirmed', date: '2026-10-01', target_month: '2026-10', amount: 100, account_id: 'wallet', to_account_id: 'bank', updated_at: '2026-10-01T00:00:00Z' });
const invalid = [
	['previous_target_month', '2026-13', 'month'], ['previous_target_month', 202609, 'month'], ['previous_target_month', '', 'month'], ['previous_target_month', 0, 'month'], ['previous_target_month', false, 'month'],
	['reclose_approved_months', null, 'shape'], ['reclose_approved_months', '2026-09', 'shape'], ['reclose_approved_months', {}, 'shape'],
	['reclose_approved_months', ['2026-13'], 'month'], ['reclose_approved_months', [202609], 'month']
];
describe('review67 auxiliary synchronization metadata is checked before removing transport fields', () => {
	let env, keys;
	beforeEach(async () => { env = new MockGasEnvironment(); env.setupGlobals(); keys = await generateEd25519KeyPair(); PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey)); gas.saveJsonFile('master_config.json', master()); gas.saveJsonFile('summary_snapshot.json', { schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} }); gas.saveJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] }); });
	afterEach(() => env.teardownGlobals());
	const raw = () => env.spreadsheet.getSheets().map(sheet => [sheet.name, [...sheet.rows]]);
	async function post(action, payload) { const signed = await createSignedRequest(action, payload, keys.privateKey); return gas.doPost({ postData: { contents: JSON.stringify(signed) } }); }
	for (const [field, value, code] of invalid) {
		it(`JS rejects ${field}=${JSON.stringify(value)} at its exact path`, () => {
			const control = { master_config: master(), transactions: [record()] }; assert.deepEqual(dataIntegrity.issues(control), []);
			const input = { master_config: master(), transactions: [{ ...record(), [field]: value }] }, before = structuredClone(input);
			assert.ok(dataIntegrity.issues(input).some(issue => issue.path === `transactions.metadata.${field}` && issue.code === code), JSON.stringify(dataIntegrity.issues(input))); assert.deepEqual(input, before);
		});
		for (const action of ['push_diff', 'retroactive_update']) it(`signed ${action} rejects ${field}=${JSON.stringify(value)} and preserves all sheet bytes`, async () => {
			const tx = { ...record(), [field]: value }, before = raw(), response = await post(action, action === 'push_diff' ? { transactions: [tx] } : { transaction: tx });
			assert.equal(response.success, false); assert.ok(String(response.error).includes(`transactions.metadata.${field}`), response.error); assert.deepEqual(raw(), before);
			assert.equal(Object.keys(PropertiesService.getScriptProperties().getProperties()).filter(key => key.startsWith('AUTH_REPLAY_')).length, 1, 'signed invalid business input still consumes its authentication replay record');
		});
	}
	for (const action of ['push_diff', 'retroactive_update']) {
		for (const approvals of [undefined, [], ['2026-09']]) it(`signed ${action} accepts valid auxiliary months, approvals=${JSON.stringify(approvals)}, without persisting them`, async () => {
			const tx = { ...record(), previous_target_month: approvals === undefined ? null : '2026-09', ...(approvals === undefined ? {} : { reclose_approved_months: approvals }) };
			assert.deepEqual(dataIntegrity.issues({ master_config: master(), transactions: [tx] }), []);
			const response = await post(action, action === 'push_diff' ? { transactions: [tx] } : { transaction: tx }); assert.equal(response.success, true, response.error);
			const stored = gas.handleAction('fetch_state', {}).pending_diffs[0]; assert.equal(stored.id, 'metadata'); assert.equal(stored.amount, 100); assert.equal(Object.hasOwn(stored, 'previous_target_month'), false); assert.equal(Object.hasOwn(stored, 'reclose_approved_months'), false);
		});
	}
	for (const previous of ['2026-13', '', 0, false]) it(`validates retroactive top-level previous month ${JSON.stringify(previous)} before discarding it`, async () => {
		const before = raw(), response = await post('retroactive_update', { transaction: record(), previous_target_month: previous }); assert.equal(response.success, false); assert.ok(String(response.error).includes('transactions.metadata.previous_target_month'), response.error); assert.deepEqual(raw(), before);
	});
	it('validates malformed approval metadata on a deletion tombstone', async () => {
		const before = raw(), response = await post('push_diff', { transactions: [{ id: 'deleted', is_deleted: true, updated_at: '2026-10-01T00:00:00Z', reclose_approved_months: '2026-09' }] }); assert.equal(response.success, false); assert.ok(String(response.error).includes('transactions.deleted.reclose_approved_months'), response.error); assert.deepEqual(raw(), before);
	});
});
