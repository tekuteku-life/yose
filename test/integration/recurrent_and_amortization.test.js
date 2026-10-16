import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import {
  generateRecurringTransactions,
  createPrepaidAmortizationTransactions,
  createAdvancePaymentTransactions,
  createAdvanceRepaymentTransaction,
  createPointPaymentTransactions,
  calculateBalancesAndSummaries
} from '../../js/logic.js';

describe('Integration - Recurring, Prepaid Amortization & Advances Workflows', () => {
  let db;

  beforeEach(async () => {
    db = new YoseDB(null);
    await db.init();
  });

  it('manages recurring generation and holiday adjustment across months', async () => {
    const config = await db.getMasterConfig();

    // Generate for October 2026
    const octExisting = await db.getTransactions({ target_month: '2026-10' });
    const octGenerated = generateRecurringTransactions(
      config.recurring_rules,
      '2026-10',
      config.holidays,
      octExisting
    );
    assert.equal(octGenerated.length, 1);
    await db.putTransactions(octGenerated);

    // Re-running generation does not duplicate
    const octExisting2 = await db.getTransactions({ target_month: '2026-10' });
    const octGenerated2 = generateRecurringTransactions(
      config.recurring_rules,
      '2026-10',
      config.holidays,
      octExisting2
    );
    assert.equal(octGenerated2.length, 0);

    // Generate for November 2026
    const novGenerated = generateRecurringTransactions(
      config.recurring_rules,
      '2026-11',
      config.holidays,
      []
    );
    assert.equal(novGenerated.length, 1);
    await db.putTransactions(novGenerated);

    const allPlanned = await db.getTransactions({ status: 'planned' });
    assert.equal(allPlanned.length, 2);
  });

  it('tracks prepaid 12-month amortization and acc_prepaid balance progression', async () => {
    // 12,000 yen annual subscription paid on 2026-10-01 via credit card (acc_card_a)
    const records = createPrepaidAmortizationTransactions({
      paymentDate: '2026-10-01',
      totalAmount: 12000,
      payingAccountId: 'acc_card_a',
      categoryId: 'cat_social',
      subcategoryId: 'sub_leisure',
      amortizeMonths: 12,
      todayMonth: '2026-10'
    });

    await db.putTransactions(records);

    const snapshot = await db.getSnapshot();
    const allTxs = await db.getTransactions();

    // Check October summary
    const octSummary = calculateBalancesAndSummaries(snapshot, allTxs, '2026-10');

    // Credit card balance should be -12,000 (liability for full payment)
    assert.equal(octSummary.confirmed_balances.acc_card_a, -12000);

    // acc_prepaid balance: +12,000 (payment transfer in) - 1,000 (Oct amortized expense) = 11,000
    assert.equal(octSummary.confirmed_balances.acc_prepaid, 11000);

    // October expense should reflect only 1,000 (not 12,000!)
    assert.equal(octSummary.expense_confirmed, 1000);

    // Check projected balance at end of 12-month cycle (2027-09)
    const sep2027Summary = calculateBalancesAndSummaries(snapshot, allTxs, '2027-09');
    // All 12 months planned expenses will have amortized acc_prepaid down to 0
    assert.equal(sep2027Summary.projected_balances.acc_prepaid, 0);
  });

  it('tracks advance payment and repayment cycle through acc_receivable', async () => {
    const snapshot = await db.getSnapshot();

    // Step 1: Pay 10,000 yen dinner (4,000 self, 6,000 advance to friend) from acc_wallet
    const advanceRecords = createAdvancePaymentTransactions({
      date: '2026-10-15',
      payingAccountId: 'acc_wallet',
      selfAmount: 4000,
      advanceAmount: 6000,
      categoryId: 'cat_food',
      subcategoryId: 'sub_dining_out'
    });
    await db.putTransactions(advanceRecords);

    let allTxs = await db.getTransactions();
    let summary1 = calculateBalancesAndSummaries(snapshot, allTxs, '2026-10');

    // Wallet: initial (15,000) - 4,000 (self) - 6,000 (adv transfer) = 5,000
    assert.equal(summary1.confirmed_balances.acc_wallet, 5000);
    // acc_receivable: +6,000
    assert.equal(summary1.confirmed_balances.acc_receivable, 6000);
    // Expense: only 4,000 (not 10,000)
    assert.equal(summary1.expense_confirmed, 4000);

    // Step 2: Friend repays 6,000 yen into bank account (acc_bank_main)
    const repayRecord = createAdvanceRepaymentTransaction({
      date: '2026-10-17',
      receivingAccountId: 'acc_bank_main',
      amount: 6000,
      memo: '友人より返金'
    });
    await db.putTransaction(repayRecord);

    allTxs = await db.getTransactions();
    let summary2 = calculateBalancesAndSummaries(snapshot, allTxs, '2026-10');

    // acc_receivable: 6,000 - 6,000 = 0 (fully recovered)
    assert.equal(summary2.confirmed_balances.acc_receivable, 0);
    // Bank: initial (1,000,000) + 6,000 = 1,006,000
    assert.equal(summary2.confirmed_balances.acc_bank_main, 1006000);
    // Expenses still remain 4,000
    assert.equal(summary2.expense_confirmed, 4000);
  });

  it('tracks point payment transaction workflows and balances', async () => {
    const snapshot = await db.getSnapshot();

    // Case A: With dedicated point account
    const pointAccTxs = createPointPaymentTransactions({
      date: '2026-10-18',
      totalAmount: 6000,
      pointAmount: 2000,
      paymentAccountId: 'acc_wallet',
      pointAccountId: 'acc_point',
      categoryId: 'cat_food'
    });
    assert.equal(pointAccTxs.length, 2);
    await db.putTransactions(pointAccTxs);

    let allTxs = await db.getTransactions();
    let summaryA = calculateBalancesAndSummaries(snapshot, allTxs, '2026-10');

    // Wallet: 15,000 - 4,000 self = 11,000
    assert.equal(summaryA.confirmed_balances.acc_wallet, 11000);
    // Point account: -2,000
    assert.equal(summaryA.confirmed_balances.acc_point, -2000);
    // Total expense: 6,000
    assert.equal(summaryA.expense_confirmed, 6000);

    // Case B: Point offset on the payment account (Purchase full 5,000 + Point income 1,000)
    const offsetTxs = createPointPaymentTransactions({
      date: '2026-10-19',
      totalAmount: 5000,
      pointUsed: 1000,
      payingAccountId: 'acc_bank_main',
      categoryId: 'cat_daily'
    });
    assert.equal(offsetTxs.length, 2);
    await db.putTransactions(offsetTxs);

    allTxs = await db.getTransactions();
    let summaryB = calculateBalancesAndSummaries(snapshot, allTxs, '2026-10');

    // Bank: 1,000,000 - 5,000 + 1,000 = 996,000 (net cash out is 4,000!)
    assert.equal(summaryB.confirmed_balances.acc_bank_main, 996000);
    // Income reflects the 1,000 point offset
    assert.equal(summaryB.income_confirmed, 1000);
  });
});

