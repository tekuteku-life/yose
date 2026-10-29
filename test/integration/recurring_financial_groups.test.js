import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

it('generates a rule when the matching expense belongs to a real financial group and retains both encrypted originals', async () => {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.mutateMasterConfig(config => { config.recurring_rules = [{ id: 'financial-rule', name: 'financial-rule', is_active: true, type: 'expense', frequency: 'monthly', start_date: '2026-01-01', day_of_month: 20, holiday_adjustment: 'none', amount: 100, account_id: 'acc_wallet', category_id: 'cat_food', subcategory_id: null, actual_category_id: 'cat_food', actual_subcategory_id: null }]; });
	await db.putTransactions([transaction('ordinary-child', { group_id: 'financial-group' }), transaction('point-role', { group_id: 'financial-group', is_point_split: true, amount: 1, date: '2026-09-20', target_month: '2026-09' })]);
	const before = await Promise.all(['ordinary-child', 'point-role'].map(id => db.getRaw('transactions', id)));
	const result = await db.generateRecurringForMonth('2026-10', await db.getMasterConfig());
	assert.equal(result.generated.length, 1); assert.equal(result.skipped_count, 0);
	assert.equal(result.generated[0].recurring_rule_id, 'financial-rule');
	assert.equal((await db.getTransactions()).length, 3);
	assert.deepEqual(await Promise.all(['ordinary-child', 'point-role'].map(id => db.getRaw('transactions', id))), before);
});
