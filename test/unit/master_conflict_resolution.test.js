import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMasterConfigs, resolveMasterConflicts, assertMasterReferences } from '../../js/logic/master_sync.js';

const clone = value => structuredClone(value);
const choices = (result, side) => new Map(result.conflictDetails.map(detail => [detail.id, side]));
const account = (name, initial_balance = 1) => ({ schema_version: 2, accounts: [{ id: 'wallet', name, initial_balance }] });

describe('Shared master conflict details and explicit resolution', () => {
	it('keeps legacy paths and local config while exposing named Japanese details and independent value copies', () => {
		const base = account('財布', 1), local = account('財布', 2), remote = account('財布', 3);
		const result = mergeMasterConfigs(base, local, remote);
		assert.deepEqual(result.config, local); assert.deepEqual(result.conflicts, ['accounts.wallet.initial_balance']);
		const detail = result.conflictDetails[0];
		assert.equal(detail.id, 'conflict-0'); assert.equal(detail.path, result.conflicts[0]);
		assert.ok(detail.label.includes('口座')); assert.ok(detail.label.includes('財布')); assert.ok(detail.label.includes('初期残高'));
		assert.deepEqual(detail.segments, ['accounts', { id: 'wallet' }, 'initial_balance']);
		assert.equal(detail.localValue, 2); assert.equal(detail.remoteValue, 3);
		assert.equal(detail.hasLocal, true); assert.equal(detail.hasRemote, true);
		assert.deepEqual(resolveMasterConflicts(result, choices(result, 'remote')), remote);
		assert.deepEqual(result.config, local); assert.deepEqual(base, account('財布', 1));
	});

	it('resolves mixed choices without discarding independent local or remote changes', () => {
		const base = account('元', 1), local = account('手元', 2), remote = account('別端末', 3);
		local.accounts[0].type = 'cash'; remote.accounts[0].is_asset = true;
		const result = mergeMasterConfigs(base, local, remote);
		const selection = new Map(result.conflictDetails.map(detail => [detail.id, detail.segments.at(-1) === 'name' ? 'remote' : 'local']));
		const resolved = resolveMasterConflicts(result, selection);
		assert.deepEqual(resolved.accounts[0], { id: 'wallet', name: '別端末', initial_balance: 2, type: 'cash', is_asset: true });
		assert.equal(result.config.accounts[0].name, '手元'); assert.equal(selection.size, 2);
	});

	it('resolves root scalars, object whole values, and numeric array whole values', () => {
		for (const [base, local, remote] of [[1, 2, 3], [{ old: true }, null, { received: true }], [[1], [2], [3]], [[], null, []]]) {
			const result = mergeMasterConfigs(base, local, remote);
			if (!result.conflictDetails.length) continue;
			assert.deepEqual(result.conflictDetails[0].segments, []);
			assert.ok(result.conflictDetails[0].label.includes('設定マスタ'));
			assert.deepEqual(resolveMasterConflicts(result, choices(result, 'local')), local);
			assert.deepEqual(resolveMasterConflicts(result, choices(result, 'remote')), remote);
		}
	});

	it('distinguishes a deleted field, explicit null, and an empty array', () => {
		const base = { value: [1], another: 1 }, local = { another: null }, remote = { value: [], another: [] };
		const result = mergeMasterConfigs(base, local, remote);
		const deleted = result.conflictDetails.find(detail => detail.path === 'value');
		assert.equal(deleted.hasLocal, false); assert.equal(deleted.hasRemote, true); assert.equal(deleted.localValue, undefined);
		const ours = resolveMasterConflicts(result, choices(result, 'local'));
		assert.equal(Object.hasOwn(ours, 'value'), false); assert.equal(ours.another, null);
		assert.deepEqual(resolveMasterConflicts(result, choices(result, 'remote')), remote);
	});

	for (const direction of ['local_deletes', 'remote_deletes']) {
		it(`handles a parent deletion versus nested edit in both resolution directions: ${direction}`, () => {
			const base = { categories: [{ id: 'cat.a', name: '食費', subcategories: [{ id: 'sub.b', name: '食料品' }] }] };
			const deletion = { categories: [] }, edited = clone(base); edited.categories[0].subcategories[0].name = '食品';
			const local = direction === 'local_deletes' ? deletion : edited;
			const remote = direction === 'remote_deletes' ? deletion : edited;
			const result = mergeMasterConfigs(base, local, remote);
			assert.deepEqual(result.conflictDetails[0].segments, ['categories', { id: 'cat.a' }]);
			assert.deepEqual(resolveMasterConflicts(result, choices(result, 'local')), local);
			assert.deepEqual(resolveMasterConflicts(result, choices(result, 'remote')), remote);
		});
	}

	it('uses structural paths for dot-containing category, subcategory, and annual budget keys', () => {
		const base = { categories: [{ id: 'cat.a', name: '食費', subcategories: [{ id: 'sub.b', name: '食品' }] }], annual_budgets: { '2026': { category_budgets: { 'cat.a': 1 } } } };
		const local = clone(base), remote = clone(base);
		local.categories[0].subcategories[0].name = '手元食品'; remote.categories[0].subcategories[0].name = '受信食品';
		local.annual_budgets['2026'].category_budgets['cat.a'] = 2; remote.annual_budgets['2026'].category_budgets['cat.a'] = 3;
		const result = mergeMasterConfigs(base, local, remote);
		assert.deepEqual(result.conflictDetails[0].segments, ['categories', { id: 'cat.a' }, 'subcategories', { id: 'sub.b' }, 'name']);
		assert.deepEqual(result.conflictDetails[1].segments, ['annual_budgets', '2026', 'category_budgets', 'cat.a']);
		assert.ok(result.conflictDetails[0].label.includes('食費')); assert.ok(result.conflictDetails[0].label.includes('中項目'));
		assert.ok(result.conflictDetails[1].label.includes('年度予算')); assert.ok(result.conflictDetails[1].label.includes('食費'));
		assert.deepEqual(resolveMasterConflicts(result, choices(result, 'remote')), remote);
	});

	it('does not confuse a dot-containing record ID with nested object fields sharing the legacy path', () => {
		const base = { accounts: [{ id: 'a.b', name: 'ドットID' }, { id: 'a', b: { name: '階層' } }] };
		const local = clone(base), remote = clone(base);
		local.accounts[0].name = '手元1'; remote.accounts[0].name = '受信1';
		local.accounts[1].b.name = '手元2'; remote.accounts[1].b.name = '受信2';
		const result = mergeMasterConfigs(base, local, remote);
		assert.equal(result.conflicts[0], result.conflicts[1]);
		const selected = new Map([[result.conflictDetails[0].id, 'remote'], [result.conflictDetails[1].id, 'local']]);
		const resolved = resolveMasterConflicts(result, selected);
		assert.equal(resolved.accounts[0].name, '受信1'); assert.equal(resolved.accounts[1].b.name, '手元2');
	});

	it('requires a real Map and one valid choice for every known conflict', () => {
		const result = mergeMasterConfigs(account('元'), account('手元'), account('受信'));
		for (const invalid of [null, {}, { 'conflict-0': 'local' }, [], new Map(), new Map([['unknown', 'local']]), new Map([['conflict-0', 'invalid']]), new Map([['conflict-0', 'local'], ['unknown', 'remote']])]) assert.throws(() => resolveMasterConflicts(result, invalid), /選択|競合|Map/);
		const duplicate = clone(result); duplicate.conflictDetails.push(clone(duplicate.conflictDetails[0]));
		assert.throws(() => resolveMasterConflicts(duplicate, choices(result, 'local')), /不正|重複|競合/);
	});

	it('rejects unsafe property keys and forged path tokens while allowing a literal prototype-like record ID', () => {
		assert.throws(() => mergeMasterConfigs({}, JSON.parse('{"__proto__":{"polluted":true}}'), {}), /不正/);
		const result = mergeMasterConfigs(account('元'), account('手元'), account('受信'));
		for (const segments of [['__proto__', 'polluted'], ['constructor', 'prototype'], [null], [{ id: 'wallet', extra: true }], ['accounts', { id: 1 }], ['accounts', 0], ['absent', 'name']]) {
			const forged = clone(result); forged.conflictDetails[0].segments = segments;
			assert.throws(() => resolveMasterConflicts(forged, choices(result, 'remote')), /不正|参照|競合/);
		}
		const unsafe = clone(result); unsafe.conflictDetails[0].remoteValue = JSON.parse('{"constructor":{"x":1}}');
		assert.throws(() => resolveMasterConflicts(unsafe, choices(result, 'remote')), /不正/);
		const protoId = mergeMasterConfigs({ accounts: [{ id: '__proto__', name: '元' }] }, { accounts: [{ id: '__proto__', name: '手元' }] }, { accounts: [{ id: '__proto__', name: '受信' }] });
		assert.equal(resolveMasterConflicts(protoId, choices(protoId, 'remote')).accounts[0].name, '受信');
		assert.equal({}.polluted, undefined);
	});

	it('returns detached copies and leaves base, both inputs, details, and choices unchanged', () => {
		const base = { value: [1] }, local = { value: null }, remote = { value: [{ x: 2 }] };
		const result = mergeMasterConfigs(base, local, remote), snapshot = clone(result), selection = choices(result, 'remote');
		const resolved = resolveMasterConflicts(result, selection); resolved.value[0].x = 99;
		assert.deepEqual(result, snapshot); assert.deepEqual(remote, { value: [{ x: 2 }] });
		result.conflictDetails[0].remoteValue[0].x = 100;
		assert.deepEqual(remote, { value: [{ x: 2 }] }); assert.deepEqual(base, { value: [1] }); assert.deepEqual(local, { value: null });
		assert.equal(selection.get('conflict-0'), 'remote');
	});

	it('keeps equal changes and conflict-free merged results intact', () => {
		const result = mergeMasterConfigs({ one: 1, two: 1 }, { one: 2, two: 1 }, { one: 2, two: 3 });
		assert.deepEqual(result.conflictDetails, []); assert.deepEqual(result.conflicts, []);
		assert.deepEqual(resolveMasterConflicts(result, new Map()), { one: 2, two: 3 });
	});

	it('identifies the source record, invalid field, and missing target in reference errors', () => {
		const config = { accounts: [{ id: 'wallet', name: '財布' }], categories: [{ id: 'cat', name: '食費', subcategories: [] }], recurring_rules: [{ id: 'rent', name: '毎月家賃', account_id: 'missing_account' }] };
		assert.throws(() => assertMasterReferences(config), error => error.message.includes('毎月家賃') && error.message.includes('口座') && error.message.includes('missing_account'));
		config.recurring_rules[0] = { id: 'rent', name: '毎月家賃', category_id: 'missing_category' };
		assert.throws(() => assertMasterReferences(config), error => error.message.includes('毎月家賃') && error.message.includes('計上費目') && error.message.includes('missing_category'));
		config.recurring_rules[0] = { id: 'rent', name: '毎月家賃', actual_category_id: 'cat', actual_subcategory_id: 'missing_sub' };
		assert.throws(() => assertMasterReferences(config), error => error.message.includes('毎月家賃') && error.message.includes('実態中項目') && error.message.includes('missing_sub'));
		config.recurring_rules = []; config.accounts[0].debit_account_id = 'missing_debit';
		assert.throws(() => assertMasterReferences(config), error => error.message.includes('財布') && error.message.includes('引落口座') && error.message.includes('missing_debit'));
	});
	it('labels unknown fields without reading inherited object properties', () => {
		const result = mergeMasterConfigs({ toString: 1 }, { toString: 2 }, { toString: 3 });
		assert.equal(result.conflictDetails[0].label, '項目「toString」');
	});

	it('looks up account and category reference names in their own side masters', () => {
		const base = {
			accounts: [{ id: 'a', name: '元A', debit_account_id: 'base', settlement_account_id: 'base' }, { id: 'b', name: '元B' }],
			categories: [{ id: 'c', name: '元C' }, { id: 'd', name: '元D' }],
			recurring_rules: [{ id: 'rule', name: '定期', account_id: 'base', to_account_id: 'base', category_id: 'base', actual_category_id: 'base' }]
		};
		const local = clone(base), remote = clone(base);
		for (const [side, prefix, reference, category] of [[local, '手元', 'a', 'c'], [remote, 'サーバー', 'b', 'd']]) {
			side.accounts[0].name = prefix + 'A'; side.accounts[1].name = prefix + 'B';
			side.categories[0].name = prefix + 'C'; side.categories[1].name = prefix + 'D';
			side.accounts[0].debit_account_id = reference; side.accounts[0].settlement_account_id = reference;
			Object.assign(side.recurring_rules[0], { account_id: reference, to_account_id: reference, category_id: category, actual_category_id: category });
		}
		const result = mergeMasterConfigs(base, local, remote);
		for (const field of ['debit_account_id', 'settlement_account_id', 'account_id', 'to_account_id']) {
			const detail = result.conflictDetails.find(item => item.segments.at(-1) === field);
			assert.equal(detail.localDisplayName, '手元A'); assert.equal(detail.remoteDisplayName, 'サーバーB');
			assert.equal(detail.localValue, 'a'); assert.equal(detail.remoteValue, 'b');
		}
		for (const field of ['category_id', 'actual_category_id']) {
			const detail = result.conflictDetails.find(item => item.segments.at(-1) === field);
			assert.equal(detail.localDisplayName, '手元C'); assert.equal(detail.remoteDisplayName, 'サーバーD');
		}
		const resolved = resolveMasterConflicts(result, choices(result, 'remote'));
		assert.equal(JSON.stringify(resolved).includes('DisplayName'), false);
	});

	it('resolves counted and actual subcategory names only under their corresponding side-specific parent', () => {
		const base = {
			categories: ['counted_local', 'counted_remote', 'actual_local', 'actual_remote'].map(id => ({ id, name: id, subcategories: [{ id: 'l', name: '元L' }, { id: 'r', name: '元R' }] })),
			recurring_rules: [{ id: 'rule', name: '計上と実態', category_id: 'base', subcategory_id: 'base', actual_category_id: 'base', actual_subcategory_id: 'base' }]
		};
		const local = clone(base), remote = clone(base);
		for (const [side, prefix, counted, actual, sub] of [[local, '手元', 'counted_local', 'actual_local', 'l'], [remote, 'サーバー', 'counted_remote', 'actual_remote', 'r']]) {
			for (const category of side.categories) {
				category.name = prefix + category.id;
				for (const middle of category.subcategories) middle.name = prefix + category.id + middle.id;
			}
			Object.assign(side.recurring_rules[0], { category_id: counted, subcategory_id: sub, actual_category_id: actual, actual_subcategory_id: sub });
		}
		const result = mergeMasterConfigs(base, local, remote);
		const counted = result.conflictDetails.find(item => item.segments.at(-1) === 'subcategory_id');
		const actual = result.conflictDetails.find(item => item.segments.at(-1) === 'actual_subcategory_id');
		assert.equal(counted.localDisplayName, '手元counted_local > 手元counted_locall');
		assert.equal(counted.remoteDisplayName, 'サーバーcounted_remote > サーバーcounted_remoter');
		assert.equal(actual.localDisplayName, '手元actual_local > 手元actual_locall');
		assert.equal(actual.remoteDisplayName, 'サーバーactual_remote > サーバーactual_remoter');
	});

	it('omits unresolved reference metadata and preserves literal markup-bearing names and raw special values', () => {
		const markup = '<img src=x onerror="window.__masterNameExecuted=1">';
		const base = { accounts: [{ id: 'a', name: '元A' }], categories: [{ id: 'cat', name: '食費', subcategories: [{ id: 'sub', name: '食品' }] }], recurring_rules: [{ id: 'r', account_id: 'base', to_account_id: 'base', category_id: 'base', subcategory_id: 'base', actual_category_id: 'base', actual_subcategory_id: 'base' }] };
		const local = clone(base), remote = clone(base);
		local.accounts[0].name = markup;
		Object.assign(local.recurring_rules[0], { account_id: 'a', to_account_id: null, category_id: 'missing', subcategory_id: 'sub', actual_category_id: 'cat', actual_subcategory_id: null });
		Object.assign(remote.recurring_rules[0], { account_id: 'missing', to_account_id: '', category_id: 'cat', subcategory_id: 'missing', actual_category_id: null, actual_subcategory_id: [] });
		const result = mergeMasterConfigs(base, local, remote);
		const accountDetail = result.conflictDetails.find(item => item.segments.at(-1) === 'account_id');
		assert.equal(accountDetail.localDisplayName, markup); assert.equal(Object.hasOwn(accountDetail, 'remoteDisplayName'), false);
		for (const detail of result.conflictDetails.filter(item => ['to_account_id', 'subcategory_id', 'actual_subcategory_id'].includes(item.segments.at(-1)))) {
			assert.equal(Object.hasOwn(detail, 'localDisplayName'), false); assert.equal(Object.hasOwn(detail, 'remoteDisplayName'), false);
		}
		const removed = mergeMasterConfigs(base, { ...local, recurring_rules: [] }, remote).conflictDetails.find(item => item.segments.length === 2);
		assert.equal(Object.hasOwn(removed, 'localDisplayName'), false); assert.equal(Object.hasOwn(removed, 'remoteDisplayName'), false);
		assert.equal(local.accounts[0].name, markup); assert.deepEqual(remote.recurring_rules[0].actual_subcategory_id, []);
	});

});
