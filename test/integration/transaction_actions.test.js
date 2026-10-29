import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey } from '../../js/crypto.js';
import { generateRecurringTransactions, createPrepaidAmortizationTransactions } from '../../js/logic/transaction_factory.js';
import { createMockIndexedDB } from '../helpers/idb_mock.js';
import { transaction } from '../helpers/ui_fixture.js';

async function setup(records = []) {
	const db = new YoseDB(createMockIndexedDB()); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: null });
	if (records.length) await db.putTransactions(records);
	return db;
}
function requireAction(db, name) { assert.equal(typeof db[name], 'function', `${name} must provide the atomic repository operation`); }
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function progress(promise, message) {
	const expired = Symbol('expired'); let timer;
	try { const value = await Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(expired), 3000); })]); assert.notEqual(value, expired, message); return value; }
	finally { clearTimeout(timer); }
}
function unchangedContent(before, after, changes) {
	for (const [field, value] of Object.entries(before)) if (!['updated_at', 'sync_status', 'reclose_approved_months', ...Object.keys(changes)].includes(field)) assert.deepEqual(after[field], value, field);
	for (const [field, value] of Object.entries(changes)) assert.deepEqual(after[field], value, field);
	assert.equal(after.sync_status, 'unsynced'); assert.ok(Date.parse(after.updated_at) > Date.parse(before.updated_at));
}
const rule = (id = 'rule-a', overrides = {}) => ({ id, name: id, is_active: true, type: 'expense', amount: 100, account_id: 'acc_wallet', category_id: 'cat_food', subcategory_id: null, actual_category_id: 'cat_food', actual_subcategory_id: null, day_of_month: 20, holiday_adjustment: 'none', ...overrides });
async function recurring(records = [], rules = [rule()]) {
	const db = await setup(records); await db.mutateMasterConfig(config => { config.recurring_rules = rules; }); return db;
}

describe('session guard propagation through existing transaction APIs', () => {
	for (const api of ['putTransaction', 'putTransactions', 'updateInstallmentGroup', 'processCreditCardAutoSettlements']) it(`rejects an invalid caller session through ${api} before changing any raw store`, async () => {
		const prepaid = createPrepaidAmortizationTransactions({ paymentDate: '2026-10-01', totalAmount: 300, payingAccountId: 'acc_wallet', categoryId: 'cat_food', amortizeMonths: 3, todayMonth: '2026-10' });
		const db = await setup([...prepaid, transaction('card', { date: '2026-09-01', target_month: '2026-09', account_id: 'acc_card_a' })]), before = await db.captureImportState(), options = { isSessionValid: () => false };
		if (api === 'putTransaction') await assert.rejects(db.putTransaction(transaction('blocked'), options));
		if (api === 'putTransactions') await assert.rejects(db.putTransactions([transaction('blocked')], options));
		if (api === 'updateInstallmentGroup') await assert.rejects(db.updateInstallmentGroup(prepaid[0].group_id, { memo: 'blocked update' }, null, null, { expectedTransactions: await db.getTransactions({ group_id: prepaid[0].group_id }), ...options }));
		if (api === 'processCreditCardAutoSettlements') await assert.rejects(db.processCreditCardAutoSettlements('2026-10-20', options));
		assert.deepEqual(await db.captureImportState(), before);
	});
	it('rejects a held automatic card settlement after caller invalidation and retains all purchases', async () => {
		const db = await setup([transaction('card', { date: '2026-09-01', target_month: '2026-09', account_id: 'acc_card_a' })]);
		const before = await db.captureImportState(), encrypt = db.encryptRecord.bind(db); let valid = true, generated = false;
		db.encryptRecord = async (...args) => { if (args[0].auto_settlement_meta) { generated = true; valid = false; } return encrypt(...args); };
		await assert.rejects(db.processCreditCardAutoSettlements('2026-10-20', { isSessionValid: () => valid })); assert.equal(generated, true); assert.deepEqual(await db.captureImportState(), before);
	});
});

describe('atomic selected transaction deletion', () => {
	it('deletes only selected IDs as tombstones and retains every unselected encrypted original', async () => {
		const db = await setup([transaction('a'), transaction('b'), transaction('outside')]); requireAction(db, 'bulkDeleteTransactions');
		const selected = await Promise.all(['a', 'b'].map(id => db.getTransaction(id))), outside = await db.getRaw('transactions', 'outside');
		await db.bulkDeleteTransactions(selected, [], { isSessionValid: () => true });
		for (const original of selected) unchangedContent(original, await db.getTransaction(original.id), { is_deleted: true });
		assert.deepEqual(await db.getRaw('transactions', 'outside'), outside); assert.equal((await db.getTransactions({ includeDeleted: true })).length, 3);
	});
	for (const failure of ['changed', 'missing', 'duplicate', 'already-deleted', 'session']) it(`rejects ${failure} selection without changing any raw store`, async () => {
		const db = await setup([transaction('a'), transaction('b')]); requireAction(db, 'bulkDeleteTransactions');
		let selected = await db.getTransactions();
		if (failure === 'changed') await db.putTransaction({ ...selected[1], amount: 999 });
		if (failure === 'missing') selected.push(transaction('not-stored'));
		if (failure === 'duplicate') selected.push(selected[0]);
		if (failure === 'already-deleted') { await db.deleteTransaction('b'); selected = [selected[0], await db.getTransaction('b')]; }
		const before = await db.captureImportState();
		await assert.rejects(db.bulkDeleteTransactions(selected, [], { isSessionValid: () => failure !== 'session' }));
		assert.deepEqual(await db.captureImportState(), before);
	});
	it('protects a referenced source, permits repayment deletion, and permits an explicitly selected pair', async () => {
		const source = transaction('source', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null });
		const repayment = transaction('repayment', { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null, advance_source_id: 'source' });
		for (const selection of [['source'], ['repayment'], ['source', 'repayment']]) {
			const db = await setup([source, repayment]); requireAction(db, 'bulkDeleteTransactions');
			const selected = await Promise.all(selection.map(id => db.getTransaction(id))), before = await db.captureImportState();
			if (selection.length === 1 && selection[0] === 'source') { await assert.rejects(db.bulkDeleteTransactions(selected, []), /立替|関連|ひも付|整合/); assert.deepEqual(await db.captureImportState(), before); }
			else { await db.bulkDeleteTransactions(selected, []); assert.ok((await Promise.all(selection.map(id => db.getTransaction(id)))).every(tx => tx.is_deleted)); if (selection.length === 1) assert.equal((await db.getUnsettledAdvancePayments()).some(tx => tx.id === 'source'), true); }
		}
	});
	it('rechecks a newly arrived repayment before deleting its original source', async () => {
		const db = await setup([transaction('source', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null })]); requireAction(db, 'bulkDeleteTransactions');
		const original = await db.getTransaction('source');
		await db.putTransaction(transaction('late-repayment', { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null, advance_source_id: 'source' }));
		const before = await db.captureImportState(); await assert.rejects(db.bulkDeleteTransactions([original], [])); assert.deepEqual(await db.captureImportState(), before);
	});
	for (const failure of ['second-encryption', 'invalidate', 'concurrent-edit']) it(`keeps all selected originals atomic during ${failure}`, async () => {
		const db = await setup([transaction('a'), transaction('b')]); requireAction(db, 'bulkDeleteTransactions');
		const selected = await db.getTransactions(), originalRaw = await db.captureImportState(), encrypt = db.encryptRecord.bind(db); let calls = 0, valid = true, afterRace;
		db.encryptRecord = async (...args) => {
			if (++calls === 2) {
				if (failure === 'second-encryption') throw new Error('second encryption fault');
				if (failure === 'invalidate') valid = false;
				if (failure === 'concurrent-edit') { await db.putTransaction({ ...selected[1], memo: 'other writer' }); afterRace = await db.captureImportState(); }
			}
			return encrypt(...args);
		};
		await assert.rejects(db.bulkDeleteTransactions(selected, [], { isSessionValid: () => valid }));
		assert.deepEqual(await db.captureImportState(), afterRace || originalRaw);
	});
	it('requires approval again when the close boundary advances after the selection was read', async () => {
		const db = await setup([transaction('a')]); requireAction(db, 'bulkDeleteTransactions'); const original = await db.getTransaction('a');
		await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: '2026-10' }); const before = await db.captureImportState();
		await assert.rejects(db.bulkDeleteTransactions([original], []), /承認|締め/); assert.deepEqual(await db.captureImportState(), before);
		await db.bulkDeleteTransactions([original], ['2026-10']); assert.equal((await db.getTransaction('a')).is_deleted, true);
	});
});

describe('confirming one known-amount planned record', () => {
	for (const amount of [0, 100]) it(`confirms explicit amount ${amount} and preserves all financial fields and archived classifications`, async () => {
		const db = await setup([transaction('planned', { status: 'planned', amount, subcategory_id: 'sub_groceries', actual_subcategory_id: 'sub_groceries' }), transaction('outside')]); requireAction(db, 'confirmPlannedTransaction');
		await db.mutateMasterConfig(config => { config.categories.find(cat => cat.id === 'cat_food').subcategories.find(sub => sub.id === 'sub_groceries').is_archived = true; });
		const original = await db.getTransaction('planned'), outside = await db.getRaw('transactions', 'outside');
		await db.confirmPlannedTransaction(original, [], { isSessionValid: () => true });
		unchangedContent(original, await db.getTransaction('planned'), { status: 'confirmed' }); assert.deepEqual(await db.getRaw('transactions', 'outside'), outside);
	});
	for (const defect of ['pending-zero', 'confirmed', 'deleted', 'unsafe-number', 'negative', 'stale', 'session']) it(`rejects ${defect} without saving a partial confirmation`, async () => {
		const db = await setup([transaction('planned', { status: 'planned' })]); requireAction(db, 'confirmPlannedTransaction');
		const original = await db.getTransaction('planned');
		if (defect === 'pending-zero') { original.amount = 0; original.amount_pending = true; }
		if (defect === 'confirmed') original.status = 'confirmed';
		if (defect === 'deleted') original.is_deleted = true;
		if (defect === 'unsafe-number') original.amount = Number.MAX_SAFE_INTEGER + 1;
		if (defect === 'negative') original.amount = -1;
		if (defect !== 'stale') await db.putRaw('transactions', await db.encryptRecord(original, { id: original.id }));
		else await db.putTransaction({ ...original, memo: 'newer edit' });
		const before = await db.captureImportState(); await assert.rejects(db.confirmPlannedTransaction(original, [], { isSessionValid: () => defect !== 'session' })); assert.deepEqual(await db.captureImportState(), before);
	});
	it('rechecks the closed month and refuses stale confirmation after a concurrent commit', async () => {
		const db = await setup([transaction('planned', { status: 'planned' })]); requireAction(db, 'confirmPlannedTransaction'); const original = await db.getTransaction('planned');
		await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: '2026-10' }); const before = await db.captureImportState();
		await assert.rejects(db.confirmPlannedTransaction(original, []), /承認|締め/); assert.deepEqual(await db.captureImportState(), before);
		await db.confirmPlannedTransaction(original, ['2026-10']); const committed = await db.captureImportState();
		await assert.rejects(db.confirmPlannedTransaction(original, ['2026-10'])); assert.deepEqual(await db.captureImportState(), committed);
	});
	it('does not blanket-reject a known-amount point component or alter its companion', async () => {
		const db = await setup([transaction('point-a', { status: 'planned', is_point_split: true, related_tx_id: 'point-b' }), transaction('point-b', { status: 'planned', is_point_split: true, related_tx_id: 'point-a' })]); requireAction(db, 'confirmPlannedTransaction');
		const original = await db.getTransaction('point-a'), companion = await db.getRaw('transactions', 'point-b');
		await db.confirmPlannedTransaction(original, []); unchangedContent(original, await db.getTransaction('point-a'), { status: 'confirmed' }); assert.deepEqual(await db.getRaw('transactions', 'point-b'), companion);
	});
	it('rejects session invalidation during confirmation encryption without changing any original', async () => {
		const db = await setup([transaction('planned', { status: 'planned' })]); requireAction(db, 'confirmPlannedTransaction');
		const original = await db.getTransaction('planned'), before = await db.captureImportState(), encrypt = db.encryptRecord.bind(db); let valid = true;
		db.encryptRecord = async (...args) => { const encrypted = await encrypt(...args); valid = false; return encrypted; };
		await assert.rejects(db.confirmPlannedTransaction(original, [], { isSessionValid: () => valid })); assert.deepEqual(await db.captureImportState(), before);
	});
	it('rechecks the selected original after a real same-record edit while confirmation encryption is held', { timeout: 15000 }, async () => {
		const db = await setup([transaction('planned', { status: 'planned' }), transaction('outside')]); requireAction(db, 'confirmPlannedTransaction');
		const original = await db.getTransaction('planned'), encrypt = db.encryptRecord.bind(db), entered = deferred(), release = deferred();
		let held = false, afterRace, outcome;
		db.encryptRecord = async (...args) => {
			const encrypted = await encrypt(...args);
			if (!held && args[0].id === original.id && args[0].status === 'confirmed') { held = true; entered.resolve(); await release.promise; }
			return encrypted;
		};
		const confirming = db.confirmPlannedTransaction(original, [], { isSessionValid: () => true }).then(value => ({ value }), error => ({ error }));
		try {
			await progress(entered.promise, 'confirmation must reach encryption before the concurrent database edit');
			await db.putTransaction({ ...original, amount: 777, memo: 'new original while confirming' }, { expectedTransactions: [original] });
			afterRace = await db.captureImportState();
		} finally { release.resolve(); outcome = await progress(confirming, 'released confirmation must settle before cleanup finishes'); }
		assert.equal(held, true); assert.ok(outcome.error, 'CAS retry must reject the now-stale selected original');
		assert.match(outcome.error.message, /変更|原本|競合/); assert.deepEqual(await db.captureImportState(), afterRace);
		const current = await db.getTransaction(original.id); assert.equal(current.status, 'planned'); assert.equal(current.amount, 777); assert.equal(current.memo, 'new original while confirming');
	});
});

describe('recurring generation from current atomic state', () => {
	it('consumes late manual input once, preserves it, and generates the remaining equal rule', async () => {
		const db = await recurring([], [rule('a'), rule('b')]); requireAction(db, 'generateRecurringForMonth'); const expected = await db.getMasterConfig();
		await db.putTransaction(transaction('late-manual', { date: '2026-10-03', memo: 'different memo' })); const manual = await db.getRaw('transactions', 'late-manual');
		const result = await db.generateRecurringForMonth('2026-10', expected, { isSessionValid: () => true });
		assert.equal(result.generated.length, 1); assert.equal(result.skipped_count, 1); assert.deepEqual(await db.getRaw('transactions', 'late-manual'), manual);
		assert.equal((await db.getTransactions()).length, 2); assert.equal(result.generated[0].recurring_rule_id, 'b');
	});
	for (const change of ['edited', 'deleted']) it(`uses a manual record ${change} after the caller read the rules`, async () => {
		const db = await recurring([transaction('manual')]); requireAction(db, 'generateRecurringForMonth'); const expected = await db.getMasterConfig(), manual = await db.getTransaction('manual');
		await db.putTransaction({ ...manual, ...(change === 'edited' ? { amount: 777 } : { is_deleted: true }) });
		const result = await db.generateRecurringForMonth('2026-10', expected); assert.equal(result.generated.length, 1); assert.equal(result.skipped_count, 0);
	});
	for (const field of ['recurring_rules', 'holidays']) it(`rejects a changed ${field} version and leaves all stores untouched`, async () => {
		const db = await recurring(); requireAction(db, 'generateRecurringForMonth'); const expected = await db.getMasterConfig();
		await db.mutateMasterConfig(config => { if (field === 'holidays') config.holidays = ['2026-10-20']; else config.recurring_rules[0].amount = 777; });
		const before = await db.captureImportState(); await assert.rejects(db.generateRecurringForMonth('2026-10', expected), /変更|設定|確認/); assert.deepEqual(await db.captureImportState(), before);
	});
	it('allows unrelated settings changes rather than comparing the complete master version', async () => {
		const db = await recurring(); requireAction(db, 'generateRecurringForMonth'); const expected = await db.getMasterConfig(); await db.mutateMasterConfig(config => { config.theme = 'dark'; });
		assert.equal((await db.generateRecurringForMonth('2026-10', expected)).generated.length, 1); assert.equal((await db.getMasterConfig()).theme, 'dark');
	});
	it('restores a stable deleted candidate ID while preserving unrelated tombstones', async () => {
		const db = await recurring(); requireAction(db, 'generateRecurringForMonth'); const expected = await db.getMasterConfig();
		const [candidate] = generateRecurringTransactions(expected.recurring_rules, '2026-10', expected.holidays);
		await db.putTransaction({ ...candidate, is_deleted: true }); await db.putTransaction(transaction('unrelated-deleted', { is_deleted: true }));
		const outside = await db.getRaw('transactions', 'unrelated-deleted'), result = await db.generateRecurringForMonth('2026-10', expected);
		assert.equal(result.generated.length, 1); assert.equal(result.generated[0].id, candidate.id); assert.equal((await db.getTransaction(candidate.id)).is_deleted, false); assert.deepEqual(await db.getRaw('transactions', 'unrelated-deleted'), outside);
	});
	for (const change of ['manual-arrival', 'rules-change', 'close-month']) it(`replans or rejects after ${change} during encryption instead of committing stale candidates`, async () => {
		const db = await recurring([], [rule('a'), rule('b')]); requireAction(db, 'generateRecurringForMonth'); const expected = await db.getMasterConfig(), encrypt = db.encryptRecord.bind(db); let injected = false, afterRace;
		db.encryptRecord = async (...args) => {
			if (!injected && args[0].recurring_rule_id) {
				injected = true;
				if (change === 'manual-arrival') await db.putTransaction(transaction('late-manual'));
				if (change === 'rules-change') await db.mutateMasterConfig(config => { config.recurring_rules[0].amount = 999; });
				if (change === 'close-month') await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: '2026-10' });
				afterRace = await db.captureImportState();
			}
			return encrypt(...args);
		};
		if (change === 'manual-arrival') {
			const result = await db.generateRecurringForMonth('2026-10', expected); assert.equal(result.generated.length, 1); assert.equal(result.skipped_count, 1);
			assert.equal(result.generated[0].recurring_rule_id, 'b'); assert.equal((await db.getTransactions()).length, 2);
			assert.deepEqual(await db.getRaw('transactions', 'late-manual'), afterRace.transactions.find(tx => tx.id === 'late-manual'));
		} else { await assert.rejects(db.generateRecurringForMonth('2026-10', expected)); assert.deepEqual(await db.captureImportState(), afterRace); }
		assert.equal(injected, true);
	});
	for (const failure of ['closed', 'second-encryption', 'session']) it(`does not partially generate during ${failure}`, async () => {
		const db = await recurring([], [rule('a'), rule('b', { amount: 200 })]); requireAction(db, 'generateRecurringForMonth'); const expected = await db.getMasterConfig();
		if (failure === 'closed') await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: '2026-10' });
		const before = await db.captureImportState(), encrypt = db.encryptRecord.bind(db); let calls = 0;
		if (failure === 'second-encryption') db.encryptRecord = async (...args) => { if (++calls === 2) throw new Error('generation encryption fault'); return encrypt(...args); };
		await assert.rejects(db.generateRecurringForMonth('2026-10', expected, { isSessionValid: () => failure !== 'session' })); assert.deepEqual(await db.captureImportState(), before);
	});
});
