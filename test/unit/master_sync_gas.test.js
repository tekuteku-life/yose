import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { canonicalJsonStringify } from '../../js/crypto.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
const require = createRequire(import.meta.url);
const gas = require('../../gas/Code.gs');

describe('GAS master synchronization concurrency', () => {
	let env;
	beforeEach(() => { env = new MockGasEnvironment(); env.setupGlobals(); });
	afterEach(() => env.teardownGlobals());
	it('rejects a stale master version without changing the server configuration', () => {
		const remote = { schema_version: 2, accounts: [{ id: 'a', name: '他端末', type: 'cash' }] };
		gas.saveJsonFile('master_config.json', remote);
		const response = gas.handleAction('update_master', { master_config: { schema_version: 2, accounts: [] }, base_version: canonicalJsonStringify({ schema_version: 2, accounts: [] }) });
		assert.equal(response.master_conflict, true);
		assert.deepEqual(response.master_config, remote);
		assert.deepEqual(gas.loadJsonFile('master_config.json', {}), remote);
	});
	it('accepts a matching base and excludes device-local and security settings from stored and fetched master', () => {
		const remote = { schema_version: 2, accounts: [] };
		gas.saveJsonFile('master_config.json', { ...remote, theme: 'dark', synced_passkey_bundle: 'secret' });
		const next = { ...remote, accounts: [{ id: 'a', name: '新規', type: 'cash' }], theme: 'light', collapsed_panes: { private: true }, security: 'secret' };
		const response = gas.handleAction('update_master', { master_config: next, base_version: canonicalJsonStringify(remote) });
		assert.equal(response.success, true);
		assert.deepEqual(gas.loadJsonFile('master_config.json', {}), { ...remote, accounts: next.accounts });
		assert.deepEqual(gas.handleAction('fetch_master', {}).master_config, { ...remote, accounts: next.accounts });
	});
	it('requires a base version and rejects unsafe master keys', () => {
		assert.equal(gas.handleAction('update_master', { master_config: { schema_version: 2 } }).success, false);
		const response = gas.handleAction('update_master', { master_config: JSON.parse('{"schema_version":2,"accounts":[{"id":"a","__proto__":{"x":1}}]}'), base_version: canonicalJsonStringify({ schema_version: 2 }) });
		assert.equal(response.success, false);
		assert.match(response.error, /不正|unsafe/i);
	});
});
