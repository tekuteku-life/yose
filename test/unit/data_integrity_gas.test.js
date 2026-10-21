import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_MASTER_CONFIG, DEFAULT_SUMMARY_SNAPSHOT } from '../../js/db/defaults.js';
import { transaction } from '../helpers/ui_fixture.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const clone = value => JSON.parse(JSON.stringify(value));
const state = () => gas.handleAction('fetch_state', {});
const send = (action, tx) => gas.handleAction(action, action === 'push_diff' ? { transactions: [tx] } : { transaction: tx });

describe('GAS integrity at every write boundary', () => {
	let env;
	beforeEach(() => {
		env = new MockGasEnvironment(); env.setupGlobals();
		gas.saveJsonFile('master_config.json', clone(DEFAULT_MASTER_CONFIG));
		gas.saveJsonFile('summary_snapshot.json', { ...clone(DEFAULT_SUMMARY_SNAPSHOT), last_closed_month: null });
		gas.saveJsonFile('pending_diffs.json', { schema_version: 2, transactions: [] });
	});
	afterEach(() => env.teardownGlobals());
	for (const action of ['push_diff', 'retroactive_update']) {
		for (const [label, patch] of [
			['missing ID', { id: '' }], ['unsafe ID', { id: '__proto__' }], ['invalid type', { type: 'other' }],
			['invalid status', { status: 'other' }], ['invalid date', { date: '2026-02-30' }], ['invalid month', { target_month: '2026-13' }],
			['string amount', { amount: '100' }], ['fraction amount', { amount: 0.5 }], ['negative amount', { amount: -1 }],
			['missing account', { account_id: '' }], ['unknown account', { account_id: 'missing' }], ['unknown category', { category_id: 'missing' }],
			['wrong category type', { category_id: 'cat_income_main' }], ['unknown child', { subcategory_id: 'missing' }],
			['wrong child parent', { subcategory_id: 'sub_rent' }], ['unknown actual category', { actual_category_id: 'missing' }],
			['unknown actual child', { actual_subcategory_id: 'missing' }], ['string boolean', { is_deleted: 'false' }],
			['same transfer accounts', { type: 'transfer', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null }]
		]) {
			it(`${action} rejects ${label} and preserves all business state`, () => {
				const before = state();
				const response = send(action, transaction('invalid', patch));
				assert.equal(response.success, false);
				assert.deepEqual(state(), before);
			});
		}
	}
	it('rejects a duplicate transaction ID within a submitted batch', () => {
		const before = state();
		assert.equal(gas.handleAction('push_diff', { transactions: [transaction('duplicate'), transaction('duplicate', { amount: 2 })] }).success, false);
		assert.deepEqual(state(), before);
	});
	it('rejects the entire mixed valid and invalid batch before writing', () => {
		const before = state();
		assert.equal(gas.handleAction('push_diff', { transactions: [transaction('valid'), transaction('invalid', { account_id: 'missing' })] }).success, false);
		assert.deepEqual(state(), before);
	});
	for (const field of ['accounts', 'categories']) {
		it(`refuses a master removal that orphans transaction ${field}`, () => {
			gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('retained')] });
			const before = state(), next = clone(before.master_config); next[field] = [];
			assert.equal(gas.handleAction('update_master', { master_config: next, base_version: gas.canonicalJsonStringify(before.master_config) }).success, false);
			assert.deepEqual(state(), before);
		});
	}
	it('permits a repair that removes an existing dangling transaction reference', () => {
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('repair', { account_id: 'missing' })] });
		assert.equal(send('push_diff', transaction('repair', { updated_at: '2026-10-21T00:00:00Z' })).success, true);
		assert.equal(state().pending_diffs[0].account_id, 'acc_wallet');
	});
	it('does not block an unrelated valid change because an old invalid record is unchanged', () => {
		gas.saveJsonFile('pending_diffs.json', { transactions: [transaction('legacy', { account_id: 'missing' })] });
		assert.equal(send('push_diff', transaction('valid')).success, true);
		assert.equal(state().pending_diffs.find(tx => tx.id === 'legacy').account_id, 'missing');
	});
	for (const target_month of ['2026-99', '2026-00', '../2026-10', 202610]) {
		it(`rejects invalid close month ${target_month}`, () => {
			const before = state();
			assert.equal(gas.handleAction('close_month', { target_month }).success, false);
			assert.deepEqual(state(), before);
		});
	}
	for (const external_assets of [null, {}, [{ id: 'asset', name: 'invalid', market_value: 'bad' }], [{ id: '__proto__', name: 'invalid', market_value: 1 }]]) {
		it(`rejects malformed external assets ${JSON.stringify(external_assets)}`, () => {
			const before = state();
			assert.equal(gas.handleAction('update_external_assets', { external_assets }).success, false);
			assert.deepEqual(state(), before);
		});
	}
	for (const action of ['push_diff', 'retroactive_update']) {
		it(`${action} accepts a historical reference archived before its first synchronization`, () => {
			const config = clone(DEFAULT_MASTER_CONFIG); config.categories.find(category => category.id === 'cat_food').is_archived = true;
			gas.saveJsonFile('master_config.json', config);
			assert.equal(send(action, transaction('historical')).success, true);
			assert.equal(state().pending_diffs.find(tx => tx.id === 'historical').category_id, 'cat_food');
		});
	}
	for (const file of ['master_config.json', 'summary_snapshot.json', 'pending_diffs.json', 'archives/2026-09.json']) {
		for (const fault of ['corrupt JSON', 'read error']) {
			it(`rejects ${fault} in ${file} before mutation and preserves raw sheet contents`, () => {
				if (file.startsWith('archives/')) gas.saveJsonFile(file, { transactions: [] });
				const sheet = env.spreadsheet.getSheetByName(gas.safeSheetName(file));
				if (fault === 'corrupt JSON') sheet.rows = ['{ corrupt json'];
				else {
					const range = sheet.getRange.bind(sheet);
					sheet.getRange = (...args) => ({ ...range(...args), getValues: () => { throw new Error('injected read error'); } });
				}
				const raw = () => env.spreadsheet.getSheets().map(item => [item.name, [...item.rows]]);
				const before = raw();
				const response = send('push_diff', transaction('new'));
				assert.equal(response.success, false); assert.deepEqual(raw(), before);
				assert.throws(() => state(), /読|不正|JSON|read/i);
			});
		}
	}
	for (const [label, actualCategory, actualSub, expectedSub] of [
		['same parent explicit null', 'cat_food', null, 'sub_unclassified'],
		['same parent omitted', 'cat_food', undefined, 'sub_groceries'],
		['different parent explicit null', 'cat_housing', null, 'sub_unclassified'],
		['different parent omitted', 'cat_housing', undefined, 'sub_unclassified']
	]) {
		it(`closes valid actual classification with ${label} without copying the accounting child`, () => {
			const row = transaction('classification', { date: '2026-09-01', target_month: '2026-09', subcategory_id: 'sub_groceries', actual_category_id: actualCategory, actual_subcategory_id: actualSub });
			if (actualSub === undefined) delete row.actual_subcategory_id;
			assert.equal(send('push_diff', row).success, true);
			const response = gas.handleAction('close_month', { target_month: '2026-09' });
			assert.equal(response.success, true, response.error);
			assert.deepEqual(response.snapshot.monthly_summaries['2026-09'].by_actual_category[actualCategory].by_subcategory, { [expectedSub]: 100 });
		});
	}
	it('updates account balances from master initial values even when no month has been summarized', () => {
		const before = state(), next = clone(before.master_config); next.accounts.find(acc => acc.id === 'acc_wallet').initial_balance += 500;
		const response = gas.handleAction('update_master', { master_config: next, base_version: gas.canonicalJsonStringify(before.master_config) });
		assert.equal(response.success, true);
		assert.equal(state().snapshot.account_balances.acc_wallet, 15500);
		assert.deepEqual(state().snapshot.monthly_summaries, {});
	});
	it('recalculates closed summaries after a master initial balance change', () => {
		assert.equal(send('push_diff', transaction('closed', { date: '2026-09-01', target_month: '2026-09' })).success, true);
		assert.equal(gas.handleAction('close_month', { target_month: '2026-09' }).success, true);
		const before = state(), next = clone(before.master_config); next.accounts.find(acc => acc.id === 'acc_wallet').initial_balance += 500;
		assert.equal(gas.handleAction('update_master', { master_config: next, base_version: gas.canonicalJsonStringify(before.master_config) }).success, true);
		assert.equal(state().snapshot.account_balances.acc_wallet, before.snapshot.account_balances.acc_wallet + 500);
	});
	it('recalculates closed summaries when a transaction-only replacement changes amount', () => {
		const original = transaction('closed', { date: '2026-09-01', target_month: '2026-09', amount: 5 });
		assert.equal(send('push_diff', original).success, true); assert.equal(gas.handleAction('close_month', { target_month: '2026-09' }).success, true);
		const before = state();
		assert.equal(gas.handleAction('replace_import', { import_id: 'recalculate', base_version: before.state_version, data: { schema_version: 2, export_type: 'transactions', transactions: [{ ...original, amount: 50 }] } }).success, true);
		assert.equal(state().snapshot.monthly_summaries['2026-09'].expense_total, 50);
		assert.equal(state().snapshot.account_balances.acc_wallet, 14950);
	});
	for (const failAt of ['replacement_journal', 'replacement_commit', 'arch_2026-09', 'pending_diffs', 'summary_snapshot']) {
		it(`recovers an interrupted retroactive move at ${failAt} without losing the transaction`, () => {
			assert.equal(send('push_diff', transaction('move', { date: '2026-09-01', target_month: '2026-09' })).success, true);
			assert.equal(gas.handleAction('close_month', { target_month: '2026-09' }).success, true);
			const before = state();
			let failed = false;
			const patchSheet = sheet => {
				if (sheet.name !== failAt) return;
				const getRange = sheet.getRange.bind(sheet);
				sheet.getRange = (...args) => {
					const range = getRange(...args), write = range.setValues;
					range.setValues = values => { if (!failed) { failed = true; throw new Error('injected write failure'); } return write(values); };
					return range;
				};
			};
			for (const sheet of env.spreadsheet.getSheets()) patchSheet(sheet);
			const insert = env.spreadsheet.insertSheet.bind(env.spreadsheet);
			env.spreadsheet.insertSheet = name => { const sheet = insert(name); patchSheet(sheet); return sheet; };
			const response = send('retroactive_update', transaction('move', { updated_at: '2026-10-21T00:00:00Z', reclose_approved_months: ['2026-09'] }));
			assert.equal(response.success, false); assert.equal(failed, true);
			const after = state(), records = [...after.pending_diffs, ...after.archived_transactions].filter(tx => tx.id === 'move');
			assert.equal(records.length, 1);
			if (failAt === 'replacement_journal' || failAt === 'replacement_commit') assert.deepEqual(after, before);
			else { assert.equal(records[0].target_month, '2026-10'); assert.equal(after.snapshot.monthly_summaries['2026-09'].expense_total, 0); }
		});
	}
});
