import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';

// Browser scenarios cover real IndexedDB; this layer makes encrypted compare/write paths
// visible to Node coverage and exercises edits made during asynchronous encryption.
describe('encrypted IndexedDB atomic updates', () => {
	let db;
	beforeEach(async () => {
		global.window = { indexedDB: createMockIndexedDB() };
		db = new YoseDB(); await db.init();
		db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.putTransactions([transaction('a'), transaction('b')]);
		const config = await db.getMasterConfig();
		config.categories.find(category => category.id === 'cat_food').is_archived = true;
		await db.saveMasterConfig(config);
	});
	afterEach(() => { delete global.window; });

	it('commits encrypted maintenance records to IndexedDB without leaking plaintext', async () => {
		await db.migrateArchivedMaster({ kind: 'category', id: 'cat_food' }, { id: 'cat_housing' }, await db.getTransactions(), await db.getMasterConfig(), []);
		assert.ok((await db.getTransactions()).every(row => row.category_id === 'cat_housing'));
		const raw = await db.getRaw('transactions', 'a');
		assert.equal(raw.encrypted, true); assert.equal(raw.memo, undefined);
	});
	for (const race of ['master', 'transaction']) {
		it(`refuses an entire maintenance batch if ${race} changes during encryption`, async () => {
			const records = await db.getTransactions(); const config = await db.getMasterConfig();
			const encrypt = db.encryptRecord.bind(db); let changed = false;
			db.encryptRecord = async (...args) => {
				if (!changed) {
					changed = true;
					if (race === 'master') await db.saveMasterConfig({ ...config, holidays: ['2027-01-01'] });
					else await db.putTransaction({ ...records[1], memo: '途中編集' });
				}
				return encrypt(...args);
			};
			await assert.rejects(db.migrateArchivedMaster({ kind: 'category', id: 'cat_food' }, { id: 'cat_housing' }, records, config, []), /変更/);
			const after = await db.getTransactions();
			assert.ok(after.every(row => row.category_id === 'cat_food'));
			if (race === 'transaction') assert.equal(after.find(row => row.id === 'b').memo, '途中編集');
		});
	}
	it('updates both master sync keys atomically and preserves an intervening local master edit', async () => {
		const config = await db.getMasterConfig();
		const accepted = { ...config, holidays: ['2027-01-01'] };
		const encrypt = db.encryptRecord.bind(db); let changed = false;
		db.encryptRecord = async (...args) => {
			if (!changed) { changed = true; await db.saveMasterConfig({ ...config, theme: 'dark', holidays: ['2027-02-11'] }); }
			return encrypt(...args);
		};
		await db.commitMasterSync(config, accepted);
		const current = await db.getMasterConfig();
		assert.equal(current.theme, 'dark');
		assert.deepEqual(current.holidays.sort(), ['2027-01-01', '2027-02-11']);
		assert.deepEqual((await db.getMasterSyncBase()).holidays, ['2027-01-01']);
		assert.equal(await db.hasUnsyncedMasterConfig(), true);
		assert.equal((await db.getRaw('master_config', 'sync_base')).encrypted, true);
	});
});
