import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';

const ids = ['old-a', 'old-b'];
async function setup(shared = true) {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	const rows = [...ids, 'outside'].map((id, index) => transaction(id, { date: `2022-10-${20 + index}`, target_month: '2022-10', amount: [100, 350, 999][index], group_id: shared ? 'legacy-import-group' : `ordinary-${id}`, subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries' }));
	await db.putTransactions(rows);
	await db.mutateMasterConfig(c => { c.categories.find(cat => cat.id === 'cat_food').subcategories.find(sub => sub.id === 'sub_groceries').is_archived = true; });
	return db;
}
const selected = db => Promise.all(ids.map(id => db.getTransaction(id)));
function expectPreserved(before, after, patch) {
	assert.equal(after.length, 2);
	for (const original of before) {
		const current = after.find(tx => tx.id === original.id);
		for (const [key, value] of Object.entries(original)) if (!['updated_at', 'sync_status', 'reclose_approved_months', ...Object.keys(patch)].includes(key)) assert.deepEqual(current[key], value, `${original.id}.${key}`);
		for (const [key, value] of Object.entries(patch)) assert.deepEqual(current[key], value);
		assert.ok(Date.parse(current.updated_at) > Date.parse(original.updated_at));
		assert.deepEqual(current.reclose_approved_months, ['2022-10']);
	}
}

describe('historical ordinary bulk edits at the encrypted repository boundary', () => {
	for (const shared of [false, true]) it(`changes cash to card and then active classifications while preserving archived originals, shared group=${shared}`, async () => {
		const db = await setup(shared), outside = await db.getRaw('transactions', 'outside');
		let before = await selected(db);
		await db.bulkEditTransactions(before, { account_id: 'acc_card_a' }, ['2022-10']);
		expectPreserved(before, await selected(db), { account_id: 'acc_card_a' });
		assert.deepEqual(await db.getRaw('transactions', 'outside'), outside);
		before = await selected(db);
		await db.bulkEditTransactions(before, { subcategory_id: 'sub_dining_out' }, ['2022-10']);
		expectPreserved(before, await selected(db), { subcategory_id: 'sub_dining_out' });
		before = await selected(db);
		await db.bulkEditTransactions(before, { category_id: 'cat_housing', subcategory_id: 'sub_rent' }, ['2022-10']);
		expectPreserved(before, await selected(db), { category_id: 'cat_housing', subcategory_id: 'sub_rent' });
		assert.deepEqual(await db.getRaw('transactions', 'outside'), outside);
		assert.ok((await db.getRaw('transactions', ids[0])).encrypted);
	});
	it('rechecks a newly introduced real financial sibling and preserves every raw store on rejection', async () => {
		const db = await setup(true), originals = await selected(db);
		await db.putTransaction(transaction('late-point', { group_id: 'legacy-import-group', is_point_split: true }));
		const raw = await db.captureImportState();
		await assert.rejects(db.bulkEditTransactions(originals, { account_id: 'acc_card_a' }, ['2022-10']), /項目/);
		assert.deepEqual(await db.captureImportState(), raw);
	});
	for (const failure of ['second-encryption', 'key-change']) it(`preserves all raw stores during ${failure} without partially updating the first record`, async () => {
		const db = await setup(false), originals = await selected(db), raw = await db.captureImportState(), encrypt = db.encryptRecord.bind(db);
		let calls = 0;
		db.encryptRecord = async (...args) => {
			if (++calls === 2) { if (failure === 'second-encryption') throw new Error('second record encryption failed'); db.clearEncryptionKey(); }
			return encrypt(...args);
		};
		await assert.rejects(db.bulkEditTransactions(originals, { account_id: 'acc_card_a' }, ['2022-10']), failure === 'second-encryption' ? /second record encryption/ : /認証|鍵|locked/);
		assert.equal(calls, 2);
		assert.deepEqual(await db.captureImportState(), raw);
	});
	it('rejects missing closed-month approval and any new assignment to an archived child without changing raw stores', async () => {
		const db = await setup(false), originals = await selected(db), raw = await db.captureImportState();
		await assert.rejects(db.bulkEditTransactions(originals, { account_id: 'acc_card_a' }, []), /承認/);
		assert.deepEqual(await db.captureImportState(), raw);
		await db.bulkEditTransactions(originals, { subcategory_id: 'sub_dining_out' }, ['2022-10']);
		const active = await selected(db), beforeArchivedAssignment = await db.captureImportState();
		await assert.rejects(db.bulkEditTransactions(active, { subcategory_id: 'sub_groceries' }, ['2022-10']), /アーカイブ/);
		assert.deepEqual(await db.captureImportState(), beforeArchivedAssignment);
	});
});
