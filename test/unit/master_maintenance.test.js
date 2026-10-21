import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findArchivedReferences, buildMasterMigration } from '../../js/logic/master_maintenance.js';
import { YoseDB } from '../../js/db.js';

const config = {
	accounts: [
		{ id: 'old', name: '旧口座', type: 'bank', is_asset: true, is_archived: true },
		{ id: 'new', name: '現口座', type: 'bank', is_asset: true },
		{ id: 'cash', name: '現金', type: 'cash', is_asset: true },
		{ id: 'other_asset', name: '区分違い', type: 'bank', is_asset: false }
	],
	categories: [
		{ id: 'old', name: '旧費目', type: 'expense', is_archived: true, subcategories: [{ id: 'oldsub', name: '旧内訳' }] },
		{ id: 'new', name: '現費目', type: 'expense', subcategories: [{ id: 'newsub', name: '現内訳' }, { id: 'archsub', name: '旧内訳', is_archived: true }] },
		{ id: 'income', name: '収入', type: 'income', subcategories: [] }
	]
};
const tx = (id, fields = {}) => ({ id, type: 'expense', date: '2026-10-01', target_month: '2026-10', category_id: 'old', subcategory_id: 'oldsub', actual_category_id: 'new', actual_subcategory_id: null, account_id: 'old', amount: 123, memo: '保持', tags: ['タグ'], group_id: 'group', status: 'confirmed', sync_status: 'synced', ...fields });
const source = { kind: 'category', id: 'old' };
const target = { id: 'new', subcategoryId: 'newsub' };

describe('archived master maintenance', () => {
	it('lists archived references including actual axes, transfer destinations and archived parents, excluding deleted rows', () => {
		const result = findArchivedReferences([
			tx('normal'), tx('actual', { category_id: 'new', subcategory_id: null, actual_category_id: 'old', actual_subcategory_id: 'oldsub', account_id: 'new' }),
			tx('to', { type: 'transfer', category_id: null, actual_category_id: null, account_id: 'new', to_account_id: 'old' }),
			tx('sub', { category_id: 'new', subcategory_id: 'archsub', account_id: 'new' }),
			tx('deleted', { is_deleted: true }), tx('active', { category_id: 'new', subcategory_id: null, account_id: 'new' })
		], config);
		assert.deepEqual(result.map(r => r.id), ['normal', 'actual', 'to', 'sub']);
		assert.ok(result.every(r => r.archived_labels.length));
	});
	it('moves both classification axes independently while preserving unrelated values', () => {
		const original = tx('one', { actual_category_id: 'old', actual_subcategory_id: 'oldsub', amount_pending: true });
		const [moved] = buildMasterMigration([original], config, source, target);
		assert.deepEqual(moved, { ...original, category_id: 'new', subcategory_id: 'newsub', actual_category_id: 'new', actual_subcategory_id: 'newsub' });
		assert.equal(original.category_id, 'old');
		assert.deepEqual(buildMasterMigration([tx('deleted', { is_deleted: true })], config, source, target), []);
	});
	it('preserves the other axis and moves only matched references', () => {
		const onlyActual = tx('actual', { category_id: 'new', subcategory_id: null, actual_category_id: 'old', actual_subcategory_id: 'oldsub' });
		const moved = buildMasterMigration([tx('accounting'), onlyActual], config, source, target);
		assert.equal(moved[0].actual_subcategory_id, null);
		assert.equal(moved[1].subcategory_id, null);
		assert.equal(moved[1].actual_subcategory_id, 'newsub');
		const [account] = buildMasterMigration([tx('account')], config, { kind: 'account', id: 'old' }, { id: 'new' });
		assert.equal(account.account_id, 'new');
		const actualChild = tx('child', { category_id: 'new', subcategory_id: null, actual_category_id: 'new', actual_subcategory_id: 'archsub', account_id: 'new' });
		assert.equal(findArchivedReferences([actualChild], config).length, 1);
		const [child] = buildMasterMigration([actualChild], config, { kind: 'subcategory', parentId: 'new', id: 'archsub' }, target);
		assert.equal(child.actual_subcategory_id, 'newsub');
	});
	it('moves an archived child to a selected category and allows no subcategory', () => {
		const [moved] = buildMasterMigration([tx('sub', { category_id: 'new', subcategory_id: 'archsub' })], config, { kind: 'subcategory', parentId: 'new', id: 'archsub' }, { id: 'new', subcategoryId: null });
		assert.equal(moved.subcategory_id, null);
		assert.equal(moved.account_id, 'old');
	});
	it('moves source and destination accounts and refuses a self transfer', () => {
		const [moved] = buildMasterMigration([tx('to', { type: 'transfer', account_id: 'cash', to_account_id: 'old' })], config, { kind: 'account', id: 'old' }, { id: 'new' });
		assert.equal(moved.to_account_id, 'new');
		assert.throws(() => buildMasterMigration([tx('self', { type: 'transfer', to_account_id: 'new' })], config, { kind: 'account', id: 'old' }, { id: 'new' }), /同一/);
	});
	for (const [label, from, to] of [
		['active source', { kind: 'category', id: 'new' }, target],
		['archived destination', source, { id: 'old' }],
		['wrong income type', source, { id: 'income' }],
		['wrong child', source, { id: 'new', subcategoryId: 'oldsub' }],
		['archived child', source, { id: 'new', subcategoryId: 'archsub' }],
		['wrong account asset flag', { kind: 'account', id: 'old' }, { id: 'other_asset' }],
		['wrong account type', { kind: 'account', id: 'old' }, { id: 'cash' }],
		['missing source', { kind: 'category', id: 'missing' }, target]
	]) {
		it(`rejects ${label} before writing`, () => {
			assert.throws(() => buildMasterMigration([tx('one')], config, from, to));
		});
	}
	it('commits all rows atomically, marks them unsynced, and retains approved closed months', async () => {
		const db = new YoseDB(null); await db.init(); await db.saveMasterConfig(config);
		await db.putTransactions([tx('a'), tx('b')]);
		const before = await db.getTransactions(); const master = await db.getMasterConfig();
		await db.migrateArchivedMaster(source, target, before, master, ['2026-10']);
		const after = await db.getTransactions();
		assert.ok(after.every(t => t.category_id === 'new' && t.sync_status === 'unsynced'));
		assert.ok(after.every(t => t.reclose_approved_months.includes('2026-10')));
	});
	it('rejects changed source references even when both migration outputs would be identical', async () => {
		const db = new YoseDB(null); await db.init(); await db.saveMasterConfig(config);
		await db.putTransactions([tx('a'), tx('b')]);
		const before = await db.getTransactions(); const master = await db.getMasterConfig();
		await db.putTransaction({ ...before[1], subcategory_id: null });
		const expected = await db.getTransactions();
		await assert.rejects(db.migrateArchivedMaster(source, target, before, master, []), /変更/);
		assert.deepEqual(await db.getTransactions(), expected);
	});
	for (const race of ['transaction', 'master']) {
		it(`rejects a changed ${race} without partially saving the batch`, async () => {
			const db = new YoseDB(null); await db.init(); await db.saveMasterConfig(config);
			await db.putTransactions([tx('a'), tx('b')]);
			const before = await db.getTransactions(); const master = await db.getMasterConfig();
			if (race === 'transaction') await db.putTransaction({ ...before[1], memo: '別編集' });
			else await db.saveMasterConfig({ ...master, holidays: ['2027-01-01'] });
			const expected = await db.getTransactions();
			await assert.rejects(db.migrateArchivedMaster(source, target, before, master, []), /変更/);
			assert.deepEqual(await db.getTransactions(), expected);
		});
	}
});
