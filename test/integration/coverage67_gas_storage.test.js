import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_MASTER_CONFIG, DEFAULT_SUMMARY_SNAPSHOT } from '../../js/db.js';
import { createSignedRequest, generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

const gas = createRequire(import.meta.url)('../../gas/Code.gs');
describe('review67 signed GAS storage recovery and malformed envelopes', () => {
	let env, keys;
	const raw = () => env.spreadsheet.getSheets().map(sheet => [sheet.name, [...sheet.rows]]);
	const business = () => raw().filter(([name]) => !name.startsWith('replacement_'));
	async function post(action, payload) { const signed = await createSignedRequest(action, payload, keys.privateKey); return gas.doPost({ postData: { contents: JSON.stringify(signed) } }); }
	beforeEach(async () => { env = new MockGasEnvironment(); env.setupGlobals(); keys = await generateEd25519KeyPair(); PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(keys.publicKey)); gas.saveJsonFile('master_config.json', structuredClone(DEFAULT_MASTER_CONFIG)); gas.saveJsonFile('summary_snapshot.json', { ...structuredClone(DEFAULT_SUMMARY_SNAPSHOT), last_closed_month: null }); gas.saveJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] }); });
	afterEach(() => env.teardownGlobals());
	for (const input of [null, [], 0, false, 'wrong']) it(`rejects a nonobject request envelope ${JSON.stringify(input)} before consuming authentication or changing business data`, () => {
		const before = raw(), auth = PropertiesService.getScriptProperties().getProperties(), response = gas.doPost({ postData: { contents: JSON.stringify(input) } }); assert.equal(response.success, false); assert.equal(response.error, 'Invalid request envelope'); assert.deepEqual(raw(), before); assert.deepEqual(PropertiesService.getScriptProperties().getProperties(), auth);
	});
	it('ignores a malformed entry in an administrator public-key list while verifying a valid registered key', async () => {
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', JSON.stringify([1, await exportPublicKeyBase64(keys.publicKey)])); const before = raw(), response = await post('fetch_state', {}); assert.equal(response.success, true); assert.deepEqual(raw(), before);
	});
	for (const contents of [[], ['   ']]) it(`refuses an existing empty protected master sheet ${JSON.stringify(contents)} instead of replacing it with defaults`, async () => {
		env.spreadsheet.getSheetByName('master_config').rows = contents; const before = raw(), response = await post('push_diff', { transactions: [transaction('new')] }); assert.equal(response.success, false); assert.match(response.error, /master_config\.json.*読み取れません/); assert.deepEqual(raw(), before);
	});
	for (const journal of [null, { id: 'different', writes: [] }, { id: 'expected', writes: {} }]) it(`stops a pending recovery marker when its journal is missing or inconsistent: ${JSON.stringify(journal)}`, async () => {
		gas.saveJsonFile('replacement_commit.json', { id: 'expected' }); if (journal !== null) gas.saveJsonFile('replacement_journal.json', journal); const before = raw(), response = await post('fetch_state', {}); assert.equal(response.success, false); assert.match(response.error, /復旧記録が不正/); assert.deepEqual(raw(), before);
	});
	it('refuses a corrupt serialized commit marker before reading or changing any business collection', async () => {
		gas.saveJsonFile('replacement_commit.json', { id: 'expected' }); env.spreadsheet.getSheetByName('replacement_commit').rows = ['{broken']; const before = raw(), response = await post('fetch_state', {}); assert.equal(response.success, false); assert.match(response.error, /復旧記録が不正/); assert.deepEqual(raw(), before);
	});
	it('does not commit business data if its saved mutation journal cannot be read back identically', async () => {
		gas.saveJsonFile('replacement_journal.json', { id: 'old', writes: [] }); const sheet = env.spreadsheet.getSheetByName('replacement_journal'), getRange = sheet.getRange.bind(sheet), before = business();
		sheet.getRange = (...args) => ({ ...getRange(...args), getValues: () => [['null']] });
		try { const response = await post('push_diff', { transactions: [transaction('blocked')] }); assert.equal(response.success, false); assert.match(response.error, /復旧記録を保存できません/); assert.deepEqual(business(), before); }
		finally { sheet.getRange = getRange; }
		const response = await post('push_diff', { transactions: [transaction('normal-control')] }); assert.equal(response.success, true, response.error); assert.deepEqual(gas.handleAction('fetch_state', {}).pending_diffs.map(row => row.id), ['normal-control']);
	});
	for (const payload of [null, {}, { import_id: '', base_version: '' }, { import_id: 'valid-id', base_version: 0 }]) it(`rejects a malformed complete-import binding ${JSON.stringify(payload)} without writing data or receipts`, async () => {
		const before = raw(), response = await post('replace_import', payload); assert.equal(response.success, false); assert.match(response.error, /完全インポートの ID または基点/); assert.deepEqual(raw(), before);
	});
	it('reads a schema-only legacy pending/archive collection as empty without rewriting the old files', async () => {
		gas.saveJsonFile('pending_diffs.json', { schema_version: 2 }); gas.saveJsonFile('archives/2026-09.json', { schema_version: 2 }); const before = raw(), response = await post('fetch_state', {}); assert.equal(response.success, true); assert.deepEqual(response.pending_diffs, []); assert.deepEqual(response.archived_transactions, []); assert.deepEqual(response.archive_months, ['2026-09']); assert.deepEqual(raw(), before);
	});
	it('closes an empty first month with a schema-only master and snapshot without inventing balances', async () => {
		gas.saveJsonFile('master_config.json', { schema_version: 2 }); gas.saveJsonFile('summary_snapshot.json', { schema_version: 2 });
		const response = await post('close_month', { target_month: '2026-09', approved_planned: [] }); assert.equal(response.success, true, response.error); assert.equal(response.archived_count, 0); assert.deepEqual(response.snapshot.account_balances, {}); assert.equal(response.snapshot.last_closed_month, '2026-09'); assert.equal(response.snapshot.monthly_summaries['2026-09'].income_total, 0);
		const updated = await post('update_master', { master_config: { schema_version: 2 }, base_version: gas.canonicalJsonStringify({ schema_version: 2 }) }); assert.equal(updated.success, true, updated.error); assert.deepEqual(updated.master_config, { schema_version: 2 });
	});
	it('canonicalizes optional programmatic array values like JSON without changing caller data', () => {
		const method = () => {}, marker = Symbol('optional'), data = [undefined, method, marker]; assert.equal(gas.canonicalJsonStringify(data), '[null,null,null]'); assert.equal(data[1], method); assert.equal(data[2], marker);
	});
});
