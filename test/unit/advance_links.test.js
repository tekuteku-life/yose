import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { dataIntegrity } from '../../js/logic/data_integrity.js';
import { advanceLinkCandidates } from '../../js/logic/advance_links.js';
import { transaction } from '../helpers/ui_fixture.js';

export const advance = (extra = {}) => transaction('advance', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null, ...extra });
export const repayment = (extra = {}) => transaction('repayment', { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_bank_main', category_id: null, actual_category_id: null, memo: '手入力回収', tags: ['元のタグ'], ...extra });
async function prepared(a = advance(), r = repayment()) {
	const db = new YoseDB(); await db.init(); await db.putTransactions([a, r]);
	return { db, a: await db.getTransaction(a.id), r: await db.getTransaction(r.id) };
}

describe('existing advance repayment links', () => {
	it('finds sources from the repayment side and hides candidates for linked, missing or ineligible records', async () => {
		const {db,a,r}=await prepared(); const config=await db.getMasterConfig();
		assert.deepEqual(advanceLinkCandidates(r,[a,r],config).map(tx=>tx.id),[a.id]);
		assert.deepEqual(advanceLinkCandidates({...r,advance_source_id:'not-loaded'},[a,r],config),[]);
		assert.deepEqual(advanceLinkCandidates(a,[a,{...r,advance_source_id:a.id}],config),[]);
		for (const record of [undefined,{...a,status:'planned'},transaction('expense'),{...r,amount:0}]) assert.deepEqual(advanceLinkCandidates(record,[a,r],config),[]);
	});
	it('links without creating records or changing financial content and restores the candidate after unlinking', async () => {
		const { db, a, r } = await prepared();
		await db.linkAdvanceRepayment(a, r);
		assert.equal((await db.getTransactions()).length, 2);
		assert.deepEqual(await db.getTransaction(a.id), a);
		const linked = await db.getTransaction(r.id);
		assert.equal(linked.advance_source_id, a.id);
		for (const key of ['id', 'group_id', 'date', 'target_month', 'memo', 'tags', 'amount', 'account_id', 'to_account_id', 'created_at']) assert.deepEqual(linked[key], r[key]);
		assert.deepEqual(await db.getUnsettledAdvancePayments(), []);
		await db.unlinkAdvanceRepayment(linked);
		assert.equal((await db.getTransaction(r.id)).advance_source_id, undefined);
		assert.equal((await db.getUnsettledAdvancePayments())[0].id, a.id);
	});
	it('explicitly converts an income into repayment while preserving its identity and user content', async () => {
		const income = transaction('income', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', memo: '手入力入金', tags: ['本人メモ'], tax_meta: { base: 100 } });
		const { db, a, r } = await prepared(advance(), income);
		await db.linkAdvanceRepayment(a, r);
		const linked = await db.getTransaction(r.id);
		assert.equal(linked.type, 'transfer'); assert.equal(linked.account_id, 'acc_receivable'); assert.equal(linked.to_account_id, income.account_id);
		for (const key of ['category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id', 'tax_meta']) assert.equal(linked[key], null);
		for (const key of ['id', 'date', 'target_month', 'group_id', 'memo', 'tags', 'created_at', 'amount']) assert.deepEqual(linked[key], r[key]);
		await db.unlinkAdvanceRepayment(linked);
		assert.equal((await db.getTransaction(r.id)).type, 'transfer');
	});
	it('migrates a legacy settled source to derived settlement and revives it after repayment deletion', async () => {
		const { db, a, r } = await prepared(advance({ settlement_status: 'settled' }));
		assert.deepEqual(await db.getUnsettledAdvancePayments(), []);
		await db.linkAdvanceRepayment(a, r);
		assert.equal((await db.getTransaction(a.id)).settlement_status, 'unsettled');
		await db.deleteTransaction(r.id);
		assert.equal((await db.getUnsettledAdvancePayments())[0].id, a.id);
	});
	for (const [name, aExtra, rExtra] of [
		['amount mismatch', {}, { amount: 200 }], ['planned source', { status: 'planned' }, {}], ['planned repayment', {}, { status: 'planned' }],
		['unknown source', { status: 'planned', amount_pending: true, amount: 0 }, {}], ['zero amount', { amount: 0 }, { amount: 0 }],
		['deleted source', { is_deleted: true }, {}], ['deleted repayment', {}, { is_deleted: true }],
		['wrong source role', { type: 'expense', to_account_id: null }, {}], ['wrong repayment role', {}, { type: 'expense', account_id: 'acc_wallet', to_account_id: null }],
		['income to receivable', {}, { type: 'income', account_id: 'acc_receivable', to_account_id: null }]
	]) it(`rejects ${name} without modifying either record`, async () => {
		const { db, a, r } = await prepared(advance(aExtra), repayment(rExtra));
		const before = await db.getTransactions({ includeDeleted: true });
		await assert.rejects(db.linkAdvanceRepayment(a, r));
		assert.deepEqual(await db.getTransactions({ includeDeleted: true }), before);
	});
	it('rejects converting income to an archived receiving account', async () => {
		const { db, a } = await prepared();
		const r = transaction('income', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main' });
		await db.putTransaction(r);
		await db.mutateMasterConfig(config => { config.accounts.find(acc => acc.id === 'acc_wallet').is_archived = true; return config; });
		await assert.rejects(db.linkAdvanceRepayment(a, await db.getTransaction(r.id)));
	});
	for (const side of ['a', 'r']) it(`compares the ${side} original even though only the repayment needs writing`, async () => {
		const { db, a, r } = await prepared();
		await db.putTransaction({ ...(side === 'a' ? a : r), memo: '別端末の編集' });
		const before = await db.getTransactions();
		await assert.rejects(db.linkAdvanceRepayment(a, r), /変更/);
		assert.deepEqual(await db.getTransactions(), before);
	});
	it('rejects two repayments for one source and invalidates edits until the link is removed', async () => {
		const { db, a, r } = await prepared();
		await db.linkAdvanceRepayment(a, r);
		const second = await db.putTransaction(repayment({ id: 'second' }));
		await assert.rejects(db.linkAdvanceRepayment(a, second));
		const other = await db.putTransaction(advance({ id: 'other-source' }));
		await assert.rejects(db.linkAdvanceRepayment(other, await db.getTransaction(r.id)));
		assert.equal((await db.getTransaction(r.id)).advance_source_id, a.id);
		for (const extra of [{ amount: 200 }, { is_deleted: true }, { status: 'planned' }, { to_account_id: 'acc_prepaid' }]) await assert.rejects(db.putTransaction({ ...a, ...extra }), /ひも付け/);
		const linked = await db.getTransaction(r.id);
		await assert.rejects(db.putTransaction({ ...linked, amount: 200 }), /ひも付け/);
		await db.unlinkAdvanceRepayment(linked);
		await db.putTransaction({ ...a, amount: 200 });
	});
	it('permits a downloaded reference to an unloaded source, validates shape and duplicates, and permits unlinking', async () => {
		const db = new YoseDB(); await db.init();
		await db.putTransaction(repayment({ advance_source_id: 'not_loaded' }));
		await assert.rejects(db.putTransaction(repayment({ id: 'other', advance_source_id: 'not_loaded' })));
		await db.unlinkAdvanceRepayment(await db.getTransaction('repayment'));
		assert.equal((await db.getTransaction('repayment')).advance_source_id, undefined);
	});
	it('validates link fields even when source data has not been downloaded', async () => {
		const db = new YoseDB(); await db.init();
		const base = { master_config: await db.getMasterConfig(), summary_snapshot: await db.getSnapshot(), transactions: [] };
		for (const extra of [{ advance_source_id: 4 }, { advance_source_id: '__proto__' }, { advance_source_id: '' }, { advance_source_id: 'repayment' }, { advance_source_id: 'missing', status: 'planned' }, { advance_source_id: 'missing', amount: 0 }, { advance_source_id: 'missing', account_id: 'acc_wallet' }]) {
			assert.throws(() => dataIntegrity.assertChange(base, { ...base, transactions: [repayment(extra)] }));
		}
	});
	it('allows editing external payment and receiving accounts while preserving the receivable direction', async () => {
		const {db,a,r}=await prepared(); await db.linkAdvanceRepayment(a,r);
		await db.putTransaction({...a,account_id:'acc_bank_main'});
		const linked=await db.getTransaction(r.id); await db.putTransaction({...linked,to_account_id:'acc_wallet'});
		assert.equal((await db.getUnsettledAdvancePayments()).length,0);
		await assert.rejects(db.putTransaction({...await db.getTransaction(a.id),to_account_id:'acc_prepaid'}));
		await assert.rejects(db.putTransaction({...await db.getTransaction(r.id),account_id:'acc_bank_main'}));
	});
});
