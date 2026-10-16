import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';

describe('js/db.js & Master Management - Unit Tests', () => {
  let db;

  beforeEach(async () => {
    db = new YoseDB(null);
    await db.init();
  });

  describe('Account Master Operations', () => {
    it('adds a new account to master config and saves to db', async () => {
      const config = await db.getMasterConfig();
      const newAcc = {
        id: 'acc_paypay',
        name: 'PayPay残高',
        type: 'cash',
        initial_balance: 3000,
        is_asset: true,
        sort_order: 10,
        is_archived: false
      };
      config.accounts.push(newAcc);
      await db.saveMasterConfig(config);

      const updated = await db.getMasterConfig();
      assert.ok(updated.accounts.some(a => a.id === 'acc_paypay'));
      const found = updated.accounts.find(a => a.id === 'acc_paypay');
      assert.equal(found.name, 'PayPay残高');
      assert.equal(found.initial_balance, 3000);
    });

    it('edits an existing account in master config', async () => {
      const config = await db.getMasterConfig();
      const wallet = config.accounts.find(a => a.id === 'acc_wallet');
      assert.ok(wallet);
      wallet.name = '現金（メイン財布）';
      wallet.initial_balance = 20000;
      await db.saveMasterConfig(config);

      const updated = await db.getMasterConfig();
      const updatedWallet = updated.accounts.find(a => a.id === 'acc_wallet');
      assert.equal(updatedWallet.name, '現金（メイン財布）');
      assert.equal(updatedWallet.initial_balance, 20000);
    });

    it('archives and unarchives an account', async () => {
      const config = await db.getMasterConfig();
      const card = config.accounts.find(a => a.id === 'acc_card_a');
      card.is_archived = true;
      await db.saveMasterConfig(config);

      let updated = await db.getMasterConfig();
      assert.equal(updated.accounts.find(a => a.id === 'acc_card_a').is_archived, true);

      // Unarchive
      card.is_archived = false;
      await db.saveMasterConfig(config);
      updated = await db.getMasterConfig();
      assert.equal(updated.accounts.find(a => a.id === 'acc_card_a').is_archived, false);
    });
  });

  describe('Category & Subcategory Master Operations', () => {
    it('adds a new category with subcategories', async () => {
      const config = await db.getMasterConfig();
      const newCat = {
        id: 'cat_hobby',
        type: 'expense',
        name: '趣味・娯楽',
        sort_order: 5,
        is_archived: false,
        subcategories: [
          { id: 'sub_books', name: '書籍', sort_order: 1, is_archived: false },
          { id: 'sub_games', name: 'ゲーム', sort_order: 2, is_archived: false }
        ]
      };
      config.categories.push(newCat);
      await db.saveMasterConfig(config);

      const updated = await db.getMasterConfig();
      const found = updated.categories.find(c => c.id === 'cat_hobby');
      assert.ok(found);
      assert.equal(found.subcategories.length, 2);
    });

    it('adds and edits subcategories within an existing category', async () => {
      const config = await db.getMasterConfig();
      const food = config.categories.find(c => c.id === 'cat_food');
      assert.ok(food);

      // Add subcategory
      food.subcategories.push({
        id: 'sub_cafe',
        name: 'カフェ',
        sort_order: 3,
        is_archived: false
      });
      await db.saveMasterConfig(config);

      let updated = await db.getMasterConfig();
      let updatedFood = updated.categories.find(c => c.id === 'cat_food');
      assert.ok(updatedFood.subcategories.some(s => s.id === 'sub_cafe'));

      // Edit subcategory
      const cafe = updatedFood.subcategories.find(s => s.id === 'sub_cafe');
      cafe.name = 'カフェ・喫茶店';
      await db.saveMasterConfig(updated);

      updated = await db.getMasterConfig();
      updatedFood = updated.categories.find(c => c.id === 'cat_food');
      assert.equal(updatedFood.subcategories.find(s => s.id === 'sub_cafe').name, 'カフェ・喫茶店');
    });

    it('archives category and subcategory', async () => {
      const config = await db.getMasterConfig();
      const social = config.categories.find(c => c.id === 'cat_social');
      social.is_archived = true;
      social.subcategories[0].is_archived = true;
      await db.saveMasterConfig(config);

      const updated = await db.getMasterConfig();
      const updatedSocial = updated.categories.find(c => c.id === 'cat_social');
      assert.equal(updatedSocial.is_archived, true);
      assert.equal(updatedSocial.subcategories[0].is_archived, true);
    });
  });

  describe('Recurring Rules Master Operations', () => {
    it('adds, edits, and toggles recurring rules', async () => {
      const config = await db.getMasterConfig();
      const newRule = {
        id: 'rec_gym',
        name: 'フィットネス会費',
        is_active: true,
        start_date: '2026-10-01',
        end_date: null,
        frequency: 'interval_months',
        interval_months: 1,
        day_of_month: 20,
        holiday_adjustment: 'none',
        amortize_months: 1,
        type: 'expense',
        amount: 8800,
        account_id: 'acc_card_a',
        category_id: 'cat_social',
        subcategory_id: 'sub_leisure'
      };
      config.recurring_rules.push(newRule);
      await db.saveMasterConfig(config);

      let updated = await db.getMasterConfig();
      const found = updated.recurring_rules.find(r => r.id === 'rec_gym');
      assert.ok(found);
      assert.equal(found.amount, 8800);

      // Edit amount
      found.amount = 9900;
      found.is_active = false;
      await db.saveMasterConfig(updated);

      updated = await db.getMasterConfig();
      const updatedRule = updated.recurring_rules.find(r => r.id === 'rec_gym');
      assert.equal(updatedRule.amount, 9900);
      assert.equal(updatedRule.is_active, false);
    });
  });

  describe('Holiday List Master Operations', () => {
    it('adds and removes holidays from holidays array', async () => {
      const config = await db.getMasterConfig();
      assert.ok(Array.isArray(config.holidays));

      // Add a custom holiday
      const customHoliday = '2026-12-31';
      config.holidays.push(customHoliday);
      config.holidays.sort();
      await db.saveMasterConfig(config);

      let updated = await db.getMasterConfig();
      assert.ok(updated.holidays.includes(customHoliday));

      // Remove a holiday
      updated.holidays = updated.holidays.filter(h => h !== customHoliday);
      await db.saveMasterConfig(updated);

      updated = await db.getMasterConfig();
      assert.equal(updated.holidays.includes(customHoliday), false);
    });
  });

  describe('External Assets Master Operations', () => {
    it('adds, edits, and deletes external assets in snapshot', async () => {
      const snapshot = await db.getSnapshot();
      snapshot.external_assets = snapshot.external_assets || [];

      // Add
      const newAsset = {
        id: 'sec_test_btc',
        name: 'Bitcoin',
        market_value: 1000000,
        updated_at: '2026-10-17'
      };
      snapshot.external_assets.push(newAsset);
      await db.saveSnapshot(snapshot);

      let updated = await db.getSnapshot();
      assert.ok(updated.external_assets.some(a => a.id === 'sec_test_btc'));
      let found = updated.external_assets.find(a => a.id === 'sec_test_btc');
      assert.equal(found.market_value, 1000000);

      // Edit
      found.market_value = 1200000;
      await db.saveSnapshot(updated);
      updated = await db.getSnapshot();
      found = updated.external_assets.find(a => a.id === 'sec_test_btc');
      assert.equal(found.market_value, 1200000);

      // Delete
      updated.external_assets = updated.external_assets.filter(a => a.id !== 'sec_test_btc');
      await db.saveSnapshot(updated);
      updated = await db.getSnapshot();
      assert.equal(updated.external_assets.some(a => a.id === 'sec_test_btc'), false);
    });
  });
});
