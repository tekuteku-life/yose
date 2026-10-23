import { it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { createAdvancePaymentTransactions, calculateBalancesAndSummaries } from '../../js/logic.js';
import { transaction } from '../helpers/ui_fixture.js';

it('reconciles a manual income with an advance without duplicating money, and allows correction', async () => {
	const db=new YoseDB(); await db.init();
	await db.saveSnapshot({schema_version:2,last_closed_month:null,account_balances:{acc_wallet:1000,acc_receivable:0},monthly_summaries:{}});
	const [advance]=createAdvancePaymentTransactions({date:'2026-10-20',payingAccountId:'acc_wallet',advanceAmount:100,selfAmount:0,memo:'友人の分'});
	const income=transaction('manual', {type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',memo:'友人から返金'});
	await db.putTransactions([advance,income]);
	const before=calculateBalancesAndSummaries(await db.getSnapshot(),await db.getTransactions(),'2026-10');
	await db.linkAdvanceRepayment(await db.getTransaction(advance.id),await db.getTransaction(income.id));
	const after=calculateBalancesAndSummaries(await db.getSnapshot(),await db.getTransactions(),'2026-10');
	assert.equal((await db.getTransactions()).length,2);
	assert.equal((await db.getUnsettledAdvancePayments()).length,0);
	assert.notDeepEqual(after,before);
	assert.equal(after.confirmed_balances.acc_receivable,0);
	assert.equal(after.confirmed_balances.acc_wallet,1000);
	assert.equal(after.income_total,0);
	await db.unlinkAdvanceRepayment(await db.getTransaction(income.id));
	assert.equal((await db.getUnsettledAdvancePayments()).length,1);
	assert.equal((await db.getTransaction(income.id)).type,'transfer');
});
