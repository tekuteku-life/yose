import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB, DEFAULT_MASTER_CONFIG } from '../../js/db.js';
import { generateDatabaseMasterKey, generateEd25519KeyPair, exportPublicKeyBase64, createSignedRequest, canonicalJsonStringify } from '../../js/crypto.js';
import { sharedMasterConfig, mergeMasterConfigs, resolveMasterConflicts } from '../../js/logic/master_sync.js';
import { dataIntegrity } from '../../js/logic/data_integrity.js';
import { IMPORT_CONFIRMATION_WORD } from '../../js/db/backup_replacement.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';

const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const copy = value => structuredClone(value);
const chosen = { category_id: 'custom-income-a', subcategory_id: 'custom-child-a' };
function customMaster() {
	const config = copy(DEFAULT_MASTER_CONFIG); delete config.point_payment_defaults;
	config.categories.push(...['a', 'b'].map(id => ({ id: `custom-income-${id}`, type: 'income', name: `custom income ${id}`, subcategories: [{ id: `custom-child-${id}`, name: `custom child ${id}` }] })));
	return config;
}
async function setup() {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.saveMasterConfig(customMaster()); return db;
}
const invalid = [
	['string', 'wrong'], ['boolean', true], ['array', []], ['empty-object', {}], ['missing-child', { category_id: 'custom-income-a' }], ['orphan-child', { category_id: null, subcategory_id: 'custom-child-a' }],
	['expense-parent', { category_id: 'cat_food', subcategory_id: null }], ['unknown-parent', { category_id: 'missing', subcategory_id: null }],
	['wrong-child-parent', { category_id: 'custom-income-a', subcategory_id: 'custom-child-b' }], ['unknown-child', { category_id: 'custom-income-a', subcategory_id: 'missing' }],
	['numeric-child', { category_id: 'custom-income-a', subcategory_id: 3 }]
];

describe('optional shared point offset classification', () => {
	it('provides an explicitly valid fresh-install default without supplying IDs to legacy configs', () => {
		const config = copy(DEFAULT_MASTER_CONFIG), value = config.point_payment_defaults;
		assert.ok(value && typeof value.category_id === 'string', 'new-install default must explicitly select the built-in income classification');
		const parent = config.categories.find(category => category.id === value.category_id); assert.equal(parent.type, 'income'); assert.ok(!parent.is_archived);
		if (value.subcategory_id != null) assert.ok(parent.subcategories.some(sub => sub.id === value.subcategory_id && !sub.is_archived));
		assert.equal(sharedMasterConfig(customMaster()).point_payment_defaults ?? null, null);
	});
	for (const value of [undefined, null, chosen, { category_id: 'custom-income-a', subcategory_id: null }]) it(`accepts legacy/unset or a valid optional child: ${JSON.stringify(value)}`, async () => {
		const db = await setup(), config = await db.getMasterConfig(); if (value === undefined) delete config.point_payment_defaults; else config.point_payment_defaults = value;
		await db.saveMasterConfig(config); assert.deepEqual((await db.getMasterConfig()).point_payment_defaults ?? null, value ?? null);
		assert.deepEqual(sharedMasterConfig(await db.getMasterConfig()).point_payment_defaults ?? null, value ?? null);
	});
	for (const [label, value] of invalid) it(`rejects ${label} before changing local encrypted stores`, async () => {
		const db = await setup(), config = await db.getMasterConfig(), before = await db.captureImportState(); config.point_payment_defaults = value;
		await assert.rejects(db.saveMasterConfig(config), /point|設定|参照|親|費目|内訳|整合/i); assert.deepEqual(await db.captureImportState(), before);
	});
	it('does not make an archived old default prevent unrelated saves but rejects choosing a new archived default', async () => {
		const db = await setup(); await db.mutateMasterConfig(config => { config.point_payment_defaults = copy(chosen); });
		await db.mutateMasterConfig(config => { config.categories.find(cat => cat.id === chosen.category_id).subcategories[0].is_archived = true; });
		await db.mutateMasterConfig(config => { config.theme = 'dark'; }); assert.deepEqual((await db.getMasterConfig()).point_payment_defaults, chosen);
		await db.mutateMasterConfig(config => { config.point_payment_defaults = null; }); const before = await db.captureImportState();
		await assert.rejects(db.mutateMasterConfig(config => { config.point_payment_defaults = copy(chosen); }), /archive|アーカイブ|無効|設定|整合/i); assert.deepEqual(await db.captureImportState(), before);
	});
	for (const archived of ['parent', 'child']) it(`allows unrelated settings changes when the same archived ${archived} default is serialized in a different key order`, async () => {
		const db = await setup(); await db.mutateMasterConfig(config => { config.point_payment_defaults = copy(chosen); });
		await db.mutateMasterConfig(config => { const parent = config.categories.find(cat => cat.id === chosen.category_id); if (archived === 'parent') parent.is_archived = true; else parent.subcategories[0].is_archived = true; });
		await db.mutateMasterConfig(config => { config.point_payment_defaults = { subcategory_id: chosen.subcategory_id, category_id: chosen.category_id }; config.theme = 'dark'; });
		const current = await db.getMasterConfig(); assert.equal(current.theme, 'dark'); assert.deepEqual(current.point_payment_defaults, chosen);
		const parent = current.categories.find(cat => cat.id === chosen.category_id); assert.equal(archived === 'parent' ? parent.is_archived : parent.subcategories[0].is_archived, true);
	});
	it('treats parent and child as one conflict and resolves either whole valid pair', () => {
		const base = { ...sharedMasterConfig(customMaster()), point_payment_defaults: copy(chosen) }, local = copy(base), remote = copy(base);
		local.point_payment_defaults = { category_id: 'custom-income-b', subcategory_id: 'custom-child-b' };
		remote.point_payment_defaults = { category_id: 'custom-income-a', subcategory_id: null };
		const merge = mergeMasterConfigs(base, local, remote);
		assert.equal(merge.conflicts.length, 1); assert.deepEqual(merge.conflictDetails[0].segments, ['point_payment_defaults']);
		for (const side of ['local', 'remote']) {
			const resolved = resolveMasterConflicts(merge, new Map([[merge.conflictDetails[0].id, side]]));
			assert.deepEqual(resolved.point_payment_defaults, side === 'local' ? local.point_payment_defaults : remote.point_payment_defaults);
			assert.doesNotThrow(() => dataIntegrity.assertChange({}, { master_config: resolved, transactions: [], summary_snapshot: {} }, { strict: true, allowArchivedReferences: true }));
		}
	});
	it('normalizes missing and null unset states without manufacturing a three-way conflict', () => {
		const base = sharedMasterConfig(customMaster()), local = { ...copy(base), point_payment_defaults: null }, remote = { ...copy(base), point_payment_defaults: copy(chosen) };
		const result = mergeMasterConfigs(base, local, remote); assert.deepEqual(result.conflicts, []); assert.deepEqual(result.config.point_payment_defaults, chosen);
	});
	it('preserves arbitrary configured IDs through encrypted export, import and explicit sharing', async () => {
		const db = await setup(); await db.mutateMasterConfig(config => { config.point_payment_defaults = copy(chosen); });
		const exported = await db.exportFullData(); assert.deepEqual(exported.master_config.point_payment_defaults, chosen);
		const other = await setup(); await other.importFullData(exported); assert.deepEqual((await other.getMasterConfig()).point_payment_defaults, chosen);
		assert.deepEqual(sharedMasterConfig(await other.getMasterConfig()).point_payment_defaults, chosen);
		assert.equal((await other.getRaw('master_config', 'current')).encrypted, true);
	});
	for (const incoming of [undefined, null, { category_id: 'custom-income-b', subcategory_id: 'custom-child-b' }]) it(`keeps an explicit local default during additive import, incoming=${JSON.stringify(incoming)}`, async () => {
		const db = await setup(); await db.mutateMasterConfig(config => { config.point_payment_defaults = copy(chosen); });
		const imported = customMaster(); if (incoming !== undefined) imported.point_payment_defaults = incoming;
		await db.importFullData({ schema_version: 2, export_type: 'master_config', master_config: imported });
		assert.deepEqual((await db.getMasterConfig()).point_payment_defaults, chosen);
	});
	it('clears an explicit local default only through a confirmed legacy complete replacement', async () => {
		const db = await setup(); await db.mutateMasterConfig(config => { config.point_payment_defaults = copy(chosen); });
		const plan = await db.prepareReplacementImport({ schema_version: 2, export_type: 'master_config', master_config: customMaster() });
		await db.commitReplacementImport(plan, { confirmation: IMPORT_CONFIRMATION_WORD, isSessionValid: () => true });
		assert.equal((await db.getMasterConfig()).point_payment_defaults ?? null, null); assert.equal((await db.getPendingImport()).data.master_config.point_payment_defaults ?? null, null);
	});
	for (const value of ['bad type', { category_id: 'custom-income-a', subcategory_id: 'custom-child-b' }, { category_id: 'cat_food', subcategory_id: null }]) it(`rejects malformed incoming default even when additive merge would retain the valid local setting: ${JSON.stringify(value)}`, async () => {
		const db = await setup(); await db.mutateMasterConfig(config => { config.point_payment_defaults = copy(chosen); }); const before = await db.captureImportState();
		await assert.rejects(db.importFullData({ schema_version: 2, export_type: 'master_config', master_config: { ...customMaster(), point_payment_defaults: value } }));
		assert.deepEqual(await db.captureImportState(), before);
	});
	for (const value of [{ category_id: 'custom-income-a', subcategory_id: 'custom-child-b' }, { category_id: 'cat_food', subcategory_id: null }]) it(`rejects an invalid complete replacement point setting ${JSON.stringify(value)} before changing originals`, async () => {
		const db = await setup(), before = await db.captureImportState();
		await assert.rejects(db.prepareReplacementImport({ schema_version: 2, export_type: 'master_config', master_config: { ...customMaster(), point_payment_defaults: value } }));
		assert.deepEqual(await db.captureImportState(), before);
	});
});

describe('signed GAS validation and round trip of point defaults', () => {
	let env, keys;
	beforeEach(async () => {
		env = new MockGasEnvironment(); env.setupGlobals(); keys = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey));
		gas.saveJsonFile('master_config.json', customMaster()); gas.saveJsonFile('summary_snapshot.json', { schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} });
	});
	afterEach(() => env.teardownGlobals());
	async function post(action, payload) { const envelope = await createSignedRequest(action, payload, keys.privateKey); return gas.doPost({ postData: { contents: JSON.stringify(envelope) } }); }
	it('accepts and echoes valid arbitrary parent and child IDs without sharing device preferences', async () => {
		const current = (await post('fetch_master', {})).master_config, next = { ...current, point_payment_defaults: copy(chosen), theme: 'private' };
		const result = await post('update_master', { master_config: next, base_version: canonicalJsonStringify(current) }); assert.equal(result.success, true);
		assert.deepEqual(result.master_config.point_payment_defaults, chosen); assert.equal(result.master_config.theme, undefined);
		assert.deepEqual((await post('fetch_state', {})).master_config.point_payment_defaults, chosen);
	});
	for (const [label, value] of invalid) it(`rejects signed ${label} on GAS without changing the master or snapshot`, async () => {
		const current = (await post('fetch_master', {})).master_config, before = gas.handleAction('fetch_state', {});
		const result = await post('update_master', { master_config: { ...current, point_payment_defaults: value }, base_version: canonicalJsonStringify(current) });
		assert.equal(result.success, false); assert.deepEqual(gas.handleAction('fetch_state', {}), before);
	});
	it('preserves point defaults through signed complete replacement and leaves legacy backups optional', async () => {
		const current = await post('fetch_state', {}), master = { ...customMaster(), point_payment_defaults: chosen };
		const result = await post('replace_import', { import_id: 'point-default-import', base_version: current.state_version, data: { schema_version: 2, export_type: 'master_config', master_config: master } });
		assert.equal(result.success, true); assert.deepEqual(result.master_config.point_payment_defaults, chosen);
		const latest = await post('fetch_state', {}); assert.deepEqual(latest.master_config.point_payment_defaults, chosen);
		const legacy = await post('replace_import', { import_id: 'legacy-point-unset', base_version: latest.state_version, data: { schema_version: 2, export_type: 'master_config', master_config: customMaster() } });
		assert.equal(legacy.success, true); assert.equal(legacy.master_config.point_payment_defaults ?? null, null);
	});
	it('rejects a signed replacement with an invalid parent-child pair without applying any server store', async () => {
		const before = await post('fetch_state', {});
		const result = await post('replace_import', { import_id: 'invalid-point-import', base_version: before.state_version, data: { schema_version: 2, export_type: 'master_config', master_config: { ...customMaster(), point_payment_defaults: { category_id: 'custom-income-a', subcategory_id: 'custom-child-b' } } } });
		assert.equal(result.success, false); assert.deepEqual(await post('fetch_state', {}), before);
	});
});
