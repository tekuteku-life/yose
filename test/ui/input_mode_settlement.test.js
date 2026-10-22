import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, value, waitForDialog } from '../helpers/ui_fixture.js';

describe('Input mode carryover and advance settlement', { timeout: 120000 }, () => {
	const fixture = useBrowser();
	const modeButton = mode => `.mode-tab-btn[data-mode="${mode}"]`;

	it('settles from the real recovery list with one tag and a short memo while preserving the source', async () => {
		const d = fixture.driver;
		const source = transaction('advance_short', { type: 'transfer', category_id: null, actual_category_id: null, to_account_id: 'acc_receivable', memo: '[立替分] 元の会食メモ', tags: ['会食', '立替', '立替回収'], settlement_status: 'unsettled', amount: 2400 });
		await seed(d, [source]);
		await d.click(modeButton('repay'));
		await d.waitFor('document.querySelector(".btn-settle-advance[data-tx-id=advance_short]") !== null');
		await d.select('#select-account', 'acc_bank_main');
		await d.click('.btn-settle-advance[data-tx-id="advance_short"]');
		await d.waitFor('document.getElementById("unsettled-advance-count").textContent === "0件"');
		const txs = await records(d);
		const original = txs.find(tx => tx.id === source.id);
		const repayment = txs.find(tx => tx.id !== source.id);
		assert.equal(repayment.memo, '立替回収');
		assert.deepEqual(repayment.tags, ['立替回収']);
		assert.equal(repayment.amount, 2400);
		assert.equal(repayment.account_id, 'acc_receivable');
		assert.equal(repayment.to_account_id, 'acc_bank_main');
		assert.equal(original.memo, source.memo);
		assert.deepEqual(original.tags, source.tags);
		assert.equal(original.settlement_status, 'settled');
		await d.evaluate('window.__yose_app.txInputController.handleSettleAdvanceDirectly("advance_short")');
		assert.equal((await records(d)).length, 2);
	});

	it('rejects a concurrent source edit atomically when directly settling', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('advance_race', { type: 'transfer', category_id: null, actual_category_id: null, to_account_id: 'acc_receivable', settlement_status: 'unsettled' })]);
		await d.click(modeButton('repay'));
		await d.evaluate(`window.__yose_app.approveClosedChanges = async () => {
			const db = window.__yose_app.db;
			const latest = await db.getTransaction('advance_race');
			latest.memo = '別の編集';
			latest.updated_at = '2026-10-21T00:00:00Z';
			await db.putTransactions([latest]);
			return [];
		}`);
		await d.click('.btn-settle-advance[data-tx-id="advance_race"]');
		await waitForDialog(d, '精算の保存に失敗');
		const txs = await records(d);
		assert.equal(txs.length, 1);
		assert.equal(txs[0].memo, '別の編集');
		assert.equal(txs[0].settlement_status, 'unsettled');
	});

	it('preserves manually entered repayment memo and tags without duplicating the system tag', async () => {
		const d = fixture.driver;
		await d.click(modeButton('repay'));
		await d.fill('#input-repay-amount', '2200');
		await d.fill('#input-memo', '利用者の精算メモ');
		await d.fill('#input-tag-text', '立替回収, 個人タグ');
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 1)()');
		const [tx] = await records(d);
		assert.equal(tx.memo, '利用者の精算メモ');
		assert.deepEqual(tx.tags, ['立替回収', '個人タグ']);
	});

	for (const trigger of ['button', 'type']) {
		it(`carries the normal amount and all shared fields through ${trigger} switching into saved installments`, async () => {
			const d = fixture.driver;
			await d.fill('#input-date', '2026-10-15');
			await d.fill('#input-amount', '1001');
			await d.select('#select-account', 'acc_bank_main');
			await d.select('#select-category', 'cat_social');
			await d.select('#select-subcategory', '');
			await d.click('#chk-sync-actual-category');
			await d.select('#select-actual-category', 'cat_food');
			await d.select('#select-actual-subcategory', 'sub_dining_out');
			await d.fill('#input-memo', '切替前のメモ');
			await d.fill('#input-tag-text', '継承タグ');
			await d.evaluate('window.__yose_app.currentTaxMeta = { base_amount: 910, tax_amount: 91 }');
			if (trigger === 'button') await d.click(modeButton('prepaid'));
			else await d.select('#input-type', 'prepaid');
			assert.equal(await value(d, '#input-prepaid-total'), '1001');
			assert.equal(await value(d, '#input-date'), '2026-10-15');
			assert.equal(await value(d, '#select-account'), 'acc_bank_main');
			assert.equal(await value(d, '#select-category'), 'cat_social');
			assert.equal(await value(d, '#select-subcategory'), '');
			assert.equal(await value(d, '#select-actual-category'), 'cat_food');
			assert.equal(await value(d, '#select-actual-subcategory'), 'sub_dining_out');
			assert.equal(await value(d, '#input-memo'), '切替前のメモ');
			assert.equal(await value(d, '#input-tags'), '継承タグ');
			assert.equal(await d.evaluate('window.__yose_app.currentTaxMeta'), null);
			await d.fill('#input-prepaid-months', '3');
			await d.click('#btn-save-tx');
			await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 4)()');
			const txs = await records(d);
			const payment = txs.find(tx => tx.amortization_meta.is_payment_record);
			const children = txs.filter(tx => !tx.amortization_meta.is_payment_record);
			assert.equal(payment.amount, 1001);
			assert.equal(payment.date, '2026-10-15');
			assert.equal(payment.account_id, 'acc_bank_main');
			assert.equal(children.reduce((sum, tx) => sum + tx.amount, 0), 1001);
			assert.ok(children.every(tx => tx.category_id === 'cat_social' && tx.subcategory_id === null && tx.actual_category_id === 'cat_food' && tx.actual_subcategory_id === 'sub_dining_out'));
			assert.ok(txs.every(tx => tx.memo.includes('切替前のメモ') && tx.tags.includes('継承タグ') && tx.tax_meta === null));
		});
	}

	it('distinguishes blank and zero amounts and preserves an existing prepaid total on repeated switching', async () => {
		const d = fixture.driver;
		await d.click(modeButton('prepaid'));
		assert.equal(await value(d, '#input-prepaid-total'), '');
		await d.click(modeButton('normal'));
		await d.fill('#input-amount', '0');
		await d.click(modeButton('prepaid'));
		assert.equal(await value(d, '#input-prepaid-total'), '0');
		await d.click(modeButton('normal'));
		await d.fill('#input-amount', '9000');
		await d.click(modeButton('prepaid'));
		assert.equal(await value(d, '#input-prepaid-total'), '0');
		await d.fill('#input-prepaid-total', '7500');
		await d.click(modeButton('normal'));
		await d.fill('#input-amount', '1234');
		await d.click(modeButton('prepaid'));
		assert.equal(await value(d, '#input-prepaid-total'), '7500');
		assert.equal(await value(d, '#input-amount'), '1234');
	});

	it('preserves mode-specific amounts and shared text through all other mode switches', async () => {
		const d = fixture.driver;
		await d.fill('#input-amount', '111');
		await d.fill('#input-memo', 'モード共通');
		await d.fill('#input-tag-text', '保持');
		for (const [mode, entries] of [
			['advance', [['#input-self-amount', '222'], ['#input-adv-amount', '333']]],
			['repay', [['#input-repay-amount', '444']]],
			['point', [['#input-point-total', '555'], ['#input-point-used', '55']]],
			['prepaid', [['#input-prepaid-total', '666']]]
		]) {
			await d.click(modeButton(mode));
			for (const [field, amount] of entries) await d.fill(field, amount);
		}
		for (const mode of ['normal', 'advance', 'repay', 'point', 'prepaid']) await d.click(modeButton(mode));
		for (const [field, amount] of [['#input-amount', '111'], ['#input-self-amount', '222'], ['#input-adv-amount', '333'], ['#input-repay-amount', '444'], ['#input-point-total', '555'], ['#input-point-used', '55'], ['#input-prepaid-total', '666']]) assert.equal(await value(d, field), amount);
		assert.equal(await value(d, '#input-memo'), 'モード共通');
		assert.equal(await value(d, '#input-tags'), '保持');
	});

	it('uses the common unspecified subcategory label even when no active category exists', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async () => {
			const db = window.__yose_app.db;
			const config = await db.getMasterConfig();
			for (const rule of config.recurring_rules) rule.is_active = false;
			for (const category of config.categories) category.is_archived = true;
			await db.saveMasterConfig(config);
			await window.__yose_app.txInputController.populateCategoryDropdowns('expense');
		})()`);
		for (const id of ['select-subcategory', 'select-actual-subcategory']) assert.equal(await d.evaluate(`document.getElementById('${id}').options[0].textContent`), '（指定なし / 費目のみ）');
	});
});
