import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { generateDatabaseMasterKey, canonicalJsonStringify } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';
import { investmentAtDate } from '../../js/logic/investment.js';
import { dataIntegrity } from '../../js/logic/data_integrity.js';

describe('insights and bulk updates at the repository boundary', () => {
	let db;
	beforeEach(async () => { db = new YoseDB(); await db.init(); await db.putTransactions([transaction('a'), transaction('b')]); });
	it('atomically edits encrypted records, preserves originals, and advances future timestamps', async () => {
		db.setEncryptionKey(await generateDatabaseMasterKey());
		const future = { ...await db.getTransaction('a'), updated_at: '2099-01-01T00:00:00Z' }; await db.putTransaction(future);
		const before = await db.getTransactions();
		await db.bulkEditTransactions(before, { memo: '共通', tags: ['ふるさと納税'] }, []);
		const after = await db.getTransactions();
		assert.ok(after.every(t => t.memo === '共通' && t.sync_status === 'unsynced'));
		assert.ok(Date.parse(after.find(t => t.id === 'a').updated_at) > Date.parse(future.updated_at));
		assert.equal((await db.getRaw('transactions', 'a')).encrypted, true);
		assert.equal((await db.getDataMetadata()).count, 2);
	});
	it('rejects a stale original without writing any selected record', async () => {
		const originals = await db.getTransactions(); await db.putTransaction({ ...originals[1], memo: '他端末' });
		await assert.rejects(db.bulkEditTransactions(originals, { memo: '一括' }, []), /変更/);
		assert.equal((await db.getTransaction('a')).memo, 'a'); assert.equal((await db.getTransaction('b')).memo, '他端末');
	});
	it('keeps the initial moved month and accumulated reclose permissions across successive edits', async () => {
		let originals = await db.getTransactions();
		await db.bulkEditTransactions(originals, { target_month: '2026-11' }, []);
		originals = await db.getTransactions();
		await db.bulkEditTransactions(originals, { target_month: '2026-12' }, []);
		assert.ok((await db.getTransactions()).every(t => t.previous_target_month === '2026-10'));
		const snapshot = await db.getSnapshot(); await db.saveSnapshot({ ...snapshot, last_closed_month: '2026-12' });
		await assert.rejects(db.bulkEditTransactions(await db.getTransactions(), { memo: '拒否' }, []), /承認/);
		await db.bulkEditTransactions(await db.getTransactions(), { memo: '承認済み' }, ['2026-10', '2026-12']);
		assert.ok((await db.getTransactions()).every(t => t.reclose_approved_months.includes('2026-10')));
	});
	it('rechecks reference validity and related groups inside the batch mutation', async () => {
		const originals = await db.getTransactions();
		await assert.rejects(db.bulkEditTransactions(originals, { account_id: 'missing' }, []));
		assert.equal((await db.getTransaction('a')).account_id, 'acc_wallet');
		await db.putTransaction(transaction('sibling', { group_id: originals[0].group_id, is_point_split: true }));
		const raw = await db.captureImportState();
		await assert.rejects(db.bulkEditTransactions(originals, { amount: 300 }, []), /項目/);
		assert.deepEqual(await db.captureImportState(), raw);
	});
	it('stores and compares investment observations by account/date without overwriting another date', async () => {
		const id = 'acc_investment_main';
		await db.saveInvestmentObservation(id, '2026-10-20', { acquisition_cost: 100, market_value: 150 }, null);
		await db.saveInvestmentObservation(id, '2026-10-21', { acquisition_cost: 120, market_value: 175 }, null);
		await assert.rejects(db.saveInvestmentObservation(id, '2026-10-20', { acquisition_cost: 200, market_value: 300 }, null), /変更/);
		await db.saveInvestmentObservation(id, '2026-10-20', null, { acquisition_cost: 100, market_value: 150 });
		const account = (await db.getMasterConfig()).accounts.find(a => a.id === id);
		assert.deepEqual(account.investment_history, { '2026-10-21': { acquisition_cost: 120, market_value: 175 } });
	});
	it('preserves new data through backups and non-destructive imports', async () => {
		const config = await db.getMasterConfig();
		config.accounts.find(a => a.id === 'acc_investment_main').investment_history = { '2026-10-20': { acquisition_cost: 100, market_value: 150 } };
		config.annual_budgets = { 2026: { furusato_estimate: { resident_tax: 200000, income_tax_rate: 20 } } };
		await db.saveMasterConfig(config);
		const copy = new YoseDB(); await copy.init(); await copy.importFullData(await db.exportFullData());
		assert.deepEqual((await copy.getMasterConfig()).annual_budgets[2026].furusato_estimate, config.annual_budgets[2026].furusato_estimate);
		assert.deepEqual((await copy.getMasterConfig()).accounts.find(a => a.id === 'acc_investment_main').investment_history, config.accounts.find(a => a.id === 'acc_investment_main').investment_history);
	});
	it('validates observations and tax settings at the shared ingress boundary', async () => {
		const original = await db.getMasterConfig();
		for (const history of [{ '2026-02-30': { acquisition_cost: 0, market_value: 1 } }, { '2026-10-20': { acquisition_cost: 1.5, market_value: -1 } }, []]) {
			const config = structuredClone(original); config.accounts.find(a => a.id === 'acc_investment_main').investment_history = history;
			assert.throws(() => dataIntegrity.assertChange({}, { master_config: config }, { strict: true }));
		}
		for (const estimate of [{ resident_tax: -1, income_tax_rate: 20 }, { resident_tax: 2, income_tax_rate: 19 }, []]) {
			const config = { ...original, annual_budgets: { 2026: { furusato_estimate: estimate } } };
			await assert.rejects(db.saveMasterConfig(config));
		}
	});
});

describe('insights concurrency and failure boundaries', () => {
	const make = async () => { const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.putTransactions([transaction('a'), transaction('b')]); return db; };
	for (const operation of ['bulk', 'observation']) {
		for (const race of ['lock', 'encryptFailure']) {
			it(`does not partially write ${operation} during ${race}`, async () => {
				const db = await make(); const state = await db.captureImportState(); const encrypt = db.encryptRecord.bind(db); let calls = 0;
				db.encryptRecord = async (...args) => { if (++calls === (operation === 'bulk' && race === 'encryptFailure' ? 2 : 1)) { if (race === 'lock') db.clearEncryptionKey(); else throw new Error('encryption failure'); } return encrypt(...args); };
				const originals = await db.getTransactions();
				await assert.rejects(operation === 'bulk' ? db.bulkEditTransactions(originals, { memo: 'change' }, []) : db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { acquisition_cost: 100, market_value: 120 }, null));
				assert.deepEqual(await db.captureImportState(), state);
			});
		}
	}
	it('rejects an archived or changed investment account and stale same-day deletion', async () => {
		const db = await make(); const value = { acquisition_cost: 100, market_value: 120 };
		await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', value, null);
		await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { ...value, market_value: 130 }, value);
		await assert.rejects(db.saveInvestmentObservation('acc_investment_main', '2026-10-20', null, value), /変更/);
		await db.mutateMasterConfig(c => { c.accounts.find(a => a.id === 'acc_investment_main').is_archived = true; });
		await assert.rejects(db.saveInvestmentObservation('acc_investment_main', '2026-10-21', value, null));
	});
	it('keeps local same-day observations and estimates while importing missing dates and years', async () => {
		const db = await make(); const value = { acquisition_cost: 100, market_value: 120 };
		await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', value, null);
		await db.mutateMasterConfig(c => { c.annual_budgets[2026] = { furusato_estimate: { resident_tax: 200000, income_tax_rate: 20 } }; });
		const config = await db.getMasterConfig(); config.accounts.find(a => a.id === 'acc_investment_main').investment_history = { '2026-10-20': { acquisition_cost: 999, market_value: 999 }, '2026-10-21': value };
		config.annual_budgets[2026].furusato_estimate.resident_tax = 999; config.annual_budgets[2027] = { furusato_estimate: { resident_tax: 300000, income_tax_rate: 20 } };
		await db.importFullData({ master_config: config }); const after = await db.getMasterConfig();
		assert.deepEqual(after.accounts.find(a => a.id === 'acc_investment_main').investment_history, { '2026-10-20': value, '2026-10-21': value });
		assert.equal(after.annual_budgets[2026].furusato_estimate.resident_tax, 200000); assert.equal(after.annual_budgets[2027].furusato_estimate.resident_tax, 300000);
	});
});

it('metadata excludes local settings, retries changed business snapshots, and rejects a changed key', async () => {
	const db = new YoseDB(); await db.init(); await db.putTransaction(transaction('a'));
	const before = await db.getDataMetadata();
	await db.mutateMasterConfig(c => { c.theme = 'dark'; c.collapsed_panes = { private: true }; }); await db.saveSecurityKey('private_test', { sensitive: 'not business data' });
	assert.equal((await db.getDataMetadata()).bytes, before.bytes);
	const capture = db.captureImportState.bind(db); let once = true;
	db.captureImportState = async () => { const state = await capture(); if (once) { once = false; await db.putTransaction(transaction('b')); } return state; };
	assert.equal((await db.getDataMetadata()).count, 2);
	const decode = db.decodeBusinessState.bind(db); db.decodeBusinessState = async (...args) => { const state = await decode(...args); db.setEncryptionKey(await generateDatabaseMasterKey()); return state; };
	await assert.rejects(db.getDataMetadata(), /認証/);
});
it('rechecks latest business state after an encryption-time race and accumulates existing permissions', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.putTransactions([transaction('a'), transaction('b')]);
	const originals = await db.getTransactions(); const encrypt = db.encryptRecord.bind(db); let once = true, racedState;
	db.encryptRecord = async (...args) => { if (once) { once = false; await db.putTransaction(transaction('sibling', { group_id: originals[0].group_id, is_point_split: true })); racedState = await db.captureImportState(); } return encrypt(...args); };
	await assert.rejects(db.bulkEditTransactions(originals, { amount: 300 }, []), /項目/);
	assert.deepEqual(await db.captureImportState(), racedState, 'rejecting the raced financial role must preserve all originals and the newly arrived sibling');
	assert.equal((await db.getTransaction('a')).amount, 100); assert.equal((await db.getTransaction('b')).amount, 100);
	db.encryptRecord = encrypt;
	const a = await db.getTransaction('a'); await db.putTransaction({ ...a, reclose_approved_months: ['2026-08'] });
	await db.bulkEditTransactions([await db.getTransaction('a')], { memo: 'updated' }, ['2026-09']);
	assert.deepEqual((await db.getTransaction('a')).reclose_approved_months, ['2026-08', '2026-09']);
});
it('rejects a newly archived target and a newly closed month without partially writing', async () => {
	const db = new YoseDB(); await db.init(); await db.putTransactions([transaction('a'), transaction('b')]);
	const originals = await db.getTransactions(); await db.mutateMasterConfig(c => { c.accounts.find(a => a.id === 'acc_bank_main').is_archived = true; c.recurring_rules.forEach(r => { r.is_active = false; }); });
	await assert.rejects(db.bulkEditTransactions(originals, { account_id: 'acc_bank_main' }, []));
	await db.saveSnapshot({ ...await db.getSnapshot(), last_closed_month: '2026-10' });
	await assert.rejects(db.bulkEditTransactions(originals, { memo: 'closed' }, []), /承認/);
	assert.equal((await db.getTransaction('a')).memo, 'a'); assert.equal((await db.getTransaction('b')).memo, 'b');
});
it('validates observation invariants independently and rejects negative acquisition costs and accepts zero valuation', async () => {
	const db = new YoseDB(); await db.init(); const config = await db.getMasterConfig();
	for (const [id, value] of [['acc_investment_main', { acquisition_cost: -100, market_value: 0 }], ['acc_investment_main', { acquisition_cost: 1.5, market_value: 0 }], ['acc_investment_main', { acquisition_cost: 0, market_value: -1 }], ['acc_investment_main', { acquisition_cost: Number.MAX_SAFE_INTEGER + 1, market_value: 0 }], ['acc_wallet', { acquisition_cost: 0, market_value: 0 }]]) {
		const bad = structuredClone(config); bad.accounts.find(a => a.id === id).investment_history = { '2026-10-20': value };
		await assert.rejects(db.saveMasterConfig(bad));
	}
	await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { acquisition_cost: 0, market_value: 0 }, null);
	assert.equal((await db.getMasterConfig()).accounts.find(a => a.id === 'acc_investment_main').investment_history['2026-10-20'].acquisition_cost, 0);
});
for (const race of ['sameDate', 'otherDate', 'removedAccount', 'changedType']) {
	it(`compares investment observations after encryption races: ${race}`, async () => {
		const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
		await db.mutateMasterConfig(c => { c.accounts.push({ id: 'newStock', name: '証券2', type: 'investment', is_asset: true, initial_balance: 0 }); });
		const value = { acquisition_cost: 100, market_value: 120 }; const encrypt = db.encryptRecord.bind(db); let once = true;
		db.encryptRecord = async (...args) => { if (once) { once = false;
			if (race === 'sameDate' || race === 'otherDate') await db.saveInvestmentObservation('newStock', race === 'sameDate' ? '2026-10-20' : '2026-10-21', { acquisition_cost: 200, market_value: 250 }, null);
			else await db.mutateMasterConfig(c => { if (race === 'removedAccount') c.accounts = c.accounts.filter(a => a.id !== 'newStock'); else c.accounts.find(a => a.id === 'newStock').type = 'bank'; });
		} return encrypt(...args); };
		const save = db.saveInvestmentObservation('newStock', '2026-10-20', value, null);
		if (race === 'otherDate') { await save; assert.deepEqual((await db.getMasterConfig()).accounts.find(a => a.id === 'newStock').investment_history, { '2026-10-20': value, '2026-10-21': { acquisition_cost: 200, market_value: 250 } }); }
		else { await assert.rejects(save); const current = (await db.getMasterConfig()).accounts.find(a => a.id === 'newStock'); if (race === 'sameDate') assert.equal(current.investment_history['2026-10-20'].market_value, 250); if (race === 'removedAccount') assert.equal(current, undefined); if (race === 'changedType') assert.equal(current.type, 'bank'); }
	});
}
it('rejects malformed observations and tax inputs before a non-destructive merge can hide them', async () => {
	const db = new YoseDB(); await db.init();
	await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { acquisition_cost: 100, market_value: 150 }, null);
	await db.mutateMasterConfig(c => { c.annual_budgets[2026] = { furusato_estimate: { resident_tax: 200000, income_tax_rate: 20 } }; });
	const before = await db.captureImportState(); const config = await db.getMasterConfig();
	const bad = structuredClone(config); bad.accounts.find(a => a.id === 'acc_investment_main').investment_history['2026-10-20'].market_value = -1;
	await assert.rejects(db.importFullData({ master_config: bad })); assert.deepEqual(await db.captureImportState(), before);
	const tax = structuredClone(config); tax.annual_budgets[2026].furusato_estimate.income_tax_rate = 19;
	await assert.rejects(db.importFullData({ master_config: tax })); assert.deepEqual(await db.captureImportState(), before);
});
it('atomically tracks complete archive reception and invalidates that proof on snapshot or complete transaction replacement', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	const master = await db.getMasterConfig(), snapshot = await db.getSnapshot();
	assert.equal((await db.getAnalyticsState()).historyOptions.historyComplete, false);
	const remoteState = { master_config: master, snapshot, pending_diffs: [], archived_transactions: [], archive_months: [] }; remoteState.state_version = canonicalJsonStringify(remoteState);
	await db.commitMasterSync(master, master, { remoteState });
	assert.equal((await db.getAnalyticsState()).historyOptions.historyComplete, true);
	const backup = await db.exportFullData(); assert.equal(backup.summary_snapshot.archiveHistoryComplete, undefined);
	await db.commitReplacementImport(await db.prepareReplacementImport({ export_type: 'transactions', transactions: [] }), { confirmation: '完全インポート' });
	assert.equal((await db.getAnalyticsState()).historyOptions.historyComplete, false);
	await db.commitMasterSync(master, master, { remoteState });
	await db.saveSnapshot({ ...snapshot, calculated_at: '2026-10-24T01:00:00Z' });
	assert.equal((await db.getAnalyticsState()).historyOptions.historyComplete, false);
});
it('does not mark archives complete when a later master response replaced the fetched snapshot', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	const master = await db.getMasterConfig(), snapshot = await db.getSnapshot();
	const remote = { master_config: master, snapshot, pending_diffs: [], archived_transactions: [], archive_months: [] }; remote.state_version = canonicalJsonStringify(remote);
	remote.snapshot = { ...snapshot, calculated_at: '2026-10-24T12:00:00Z' };
	await db.commitMasterSync(master, master, { remoteState: remote });
	assert.equal((await db.getAnalyticsState()).historyOptions.historyComplete, false);
});
it('retries a coherent analytics read when complete transaction replacement changes a same-content snapshot', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey()); await db.putTransaction(transaction('a'));
	const master = await db.getMasterConfig(), snapshot = await db.getSnapshot();
	const remote = { master_config: master, snapshot, pending_diffs: await db.getTransactions(), archived_transactions: [], archive_months: [] }; remote.state_version = canonicalJsonStringify(remote);
	await db.commitMasterSync(master, master, { remoteState: remote });
	const plan = await db.prepareReplacementImport({ export_type: 'transactions', transactions: [] });
	const capture = db.captureImportState.bind(db); let once = true;
	db.captureImportState = async () => { const raw = await capture(); if (once) { once = false; await db.commitReplacementImport(plan, { confirmation: '完全インポート' }); } return raw; };
	const state = await db.getAnalyticsState();
	assert.deepEqual(state.transactions, []); assert.equal(state.historyOptions.historyComplete, false); assert.deepEqual(state.summary_snapshot, snapshot);
});
it('never trusts an archive-completeness flag supplied inside a backup snapshot', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { acquisition_cost: 100, market_value: 150 }, null);
	const backup = await db.exportFullData(); backup.summary_snapshot.archiveHistoryComplete = true;
	await db.importFullData({ summary_snapshot: backup.summary_snapshot });
	assert.equal((await db.getAnalyticsState()).historyOptions.historyComplete, false);
	await db.commitReplacementImport(await db.prepareReplacementImport(backup), { confirmation: '完全インポート' });
	const state = await db.getAnalyticsState(); assert.equal(state.historyOptions.historyComplete, false);
	assert.equal(investmentAtDate(state.master_config.accounts.find(a=>a.id==='acc_investment_main'), state.transactions, '2026-10-21', state.summary_snapshot, state.historyOptions).valuation, null);
});
it('validates both master-config and top-level annual budgets even when the latter is not selected for merging', async () => {
	const db = new YoseDB(); await db.init(); const before = await db.captureImportState();
	await assert.rejects(db.importFullData({ master_config: { accounts: [] }, annual_budgets: { 2026: { furusato_estimate: { resident_tax: 200000, income_tax_rate: 19 } } } }));
	assert.deepEqual(await db.captureImportState(), before);
});

it('persists explicit payroll sources without notification inputs and rejects wrong, overlapping and malformed references', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	const config = await db.getMasterConfig();
	config.categories.push({ id: 'salary', name: '給与', type: 'income', subcategories: [] }, { id: 'tax', name: '税', type: 'expense', subcategories: [{ id: 'resident', name: '住民税' }, { id: 'income', name: '所得税' }] });
	const sources = { salary: [{ category_id: 'salary', subcategory_id: null }], income_tax: [{ category_id: 'tax', subcategory_id: 'income' }], resident_tax: [{ category_id: 'tax', subcategory_id: 'resident' }], social_insurance: [] };
	config.annual_budgets[2026] = { furusato_sources: sources }; await db.saveMasterConfig(config);
	const before = await db.captureImportState();
	for (const bad of [[], { salary: 'salary' }, { salary: [null] }, { salary: [{ category_id: 'missing', subcategory_id: null }] }, { salary: [{ category_id: 'tax', subcategory_id: null }] }, { resident_tax: [{ category_id: 'tax', subcategory_id: 'missing' }] }, { income_tax: [{ category_id: 'tax', subcategory_id: null }], resident_tax: [{ category_id: 'tax', subcategory_id: 'resident' }] }]) {
		const value = await db.getMasterConfig(); value.annual_budgets[2026].furusato_sources = bad;
		await assert.rejects(db.saveMasterConfig(value)); assert.deepEqual(await db.captureImportState(), before);
	}
	const copy = new YoseDB(); await copy.init(); await copy.importFullData(await db.exportFullData());
	assert.deepEqual((await copy.getMasterConfig()).annual_budgets[2026].furusato_sources, sources);
	const badBackup = await db.exportFullData(); badBackup.master_config.annual_budgets[2026].furusato_sources.salary = 'wrong';
	await assert.rejects(db.importFullData(badBackup)); assert.deepEqual(await db.captureImportState(), before);
});
it('retains legacy contribution records without treating them as acquisition costs, then explicitly replaces them', async () => {
	const db = new YoseDB(); await db.init(); const legacy = { invested_amount: -100, market_value: 150 };
	await db.mutateMasterConfig(c => { c.accounts.find(a => a.id === 'acc_investment_main').investment_history = { '2026-10-20': legacy }; });
	assert.equal(investmentAtDate((await db.getMasterConfig()).accounts.find(a => a.id === 'acc_investment_main'), [], '2026-10-20', {}).acquisitionCost, null);
	await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { acquisition_cost: 120, market_value: 150 }, legacy);
	assert.deepEqual((await db.getMasterConfig()).accounts.find(a => a.id === 'acc_investment_main').investment_history['2026-10-20'], { acquisition_cost: 120, market_value: 150 });
});
it('imports standalone payroll sources once, preserves existing mappings, and rejects malformed unadopted input', async () => {
	const db = new YoseDB(); await db.init(); const source = { salary: [{ category_id: 'cat_income_main', subcategory_id: 'sub_salary' }] };
	await db.importFullData({ annual_budgets: { 2026: { furusato_sources: source } } });
	assert.deepEqual((await db.getMasterConfig()).annual_budgets[2026].furusato_sources, source);
	await db.importFullData({ annual_budgets: { 2026: { furusato_sources: {} }, 2027: { furusato_sources: source } } });
	assert.deepEqual((await db.getMasterConfig()).annual_budgets[2026].furusato_sources, source);
	assert.deepEqual((await db.getMasterConfig()).annual_budgets[2027].furusato_sources, source);
	const before = await db.captureImportState();
	await assert.rejects(db.importFullData({ master_config: await db.getMasterConfig(), annual_budgets: { 2026: { furusato_sources: { salary: 'wrong' } } } }));
	assert.deepEqual(await db.captureImportState(), before);
});
it('rejects simultaneous acquisition cost and legacy contributions at normal save and non-destructive import', async () => {
	const db = new YoseDB(); await db.init(); const value = { acquisition_cost: 100, market_value: 150 };
	await db.saveInvestmentObservation('acc_investment_main', '2026-10-20', value, null); const before = await db.captureImportState();
	await assert.rejects(db.saveInvestmentObservation('acc_investment_main', '2026-10-20', { ...value, invested_amount: 80 }, value));
	const bad = await db.getMasterConfig(); bad.accounts.find(a => a.id === 'acc_investment_main').investment_history['2026-10-20'].invested_amount = 80;
	await assert.rejects(db.importFullData({ master_config: bad })); assert.deepEqual(await db.captureImportState(), before);
});

it('validates even unadopted standalone payroll references against candidate categories', async () => {
	const db = new YoseDB(); await db.init();
	await db.importFullData({ annual_budgets: { 2026: { furusato_sources: { salary: [{ category_id: 'cat_income_main', subcategory_id: null }] } } } });
	const before = await db.captureImportState();
	for (const source of [{ category_id: 'missing', subcategory_id: null }, { category_id: 'cat_food', subcategory_id: null }, { category_id: 'cat_income_main', subcategory_id: 'missing' }]) {
		await assert.rejects(db.importFullData({ annual_budgets: { 2026: { furusato_sources: { salary: [source] } } } }));
		assert.deepEqual(await db.captureImportState(), before);
		await assert.rejects(db.importFullData({ master_config: await db.getMasterConfig(), annual_budgets: { 2026: { furusato_sources: { salary: [source] } } } }));
		assert.deepEqual(await db.captureImportState(), before);
	}
});
it('rechecks payroll source references when category type changes during import encryption', async () => {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	await db.mutateMasterConfig(config => { config.point_payment_defaults = null; });
	await db.importFullData({ annual_budgets: { 2026: { furusato_sources: { salary: [{ category_id: 'cat_income_main', subcategory_id: null }] } } } });
	const encrypt = db.encryptRecord.bind(db); let once = true, afterCategoryChange;
	db.encryptRecord = async (...args) => {
		if (once) { once = false; await db.mutateMasterConfig(c => { c.categories.find(category => category.id === 'cat_point_income').type = 'expense'; }); afterCategoryChange = await db.captureImportState(); }
		return encrypt(...args);
	};
	await assert.rejects(db.importFullData({ annual_budgets: { 2026: { furusato_sources: { salary: [{ category_id: 'cat_point_income', subcategory_id: null }] } }, 2027: { expense_budget: 100 } } }));
	assert.ok(afterCategoryChange, 'the concurrent category type change must commit before validating the imported sources');
	assert.deepEqual(await db.captureImportState(), afterCategoryChange);
});
