import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, settings, cashflow, submit, waitForDialog, value } from '../helpers/ui_fixture.js';

describe('Mutation integrity in real UI workflows', { timeout: 180000 }, () => {
	const fixture = useBrowser();
	it('rejects an outdated master modal, retains its text, and preserves newer unrelated settings', async () => {
		const d = fixture.driver;
		await settings(d, 'categories');
		await d.click('.btn-edit-cat[data-id="cat_food"]');
		await d.waitFor('document.querySelector("#m-cat-name")');
		await d.fill('#m-cat-name', '編集中の費目');
		await d.evaluate(`(async () => { const db=window.__yose_app.db; const c=await db.getMasterConfig(); c.categories.find(x=>x.id==='cat_food').name='別端末の同じ費目'; c.categories.find(x=>x.id==='cat_housing').name='別端末の費目'; await db.saveMasterConfig(c); })()`);
		await submit(d, '#form-master-category');
		await waitForDialog(d, '変更');
		assert.equal(await d.isVisible('#modal-master-item'), true);
		assert.equal(await value(d, '#m-cat-name'), '編集中の費目');
		assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).categories.find(x=>x.id==="cat_housing").name)()'), '別端末の費目');
	});
	it('rejects concurrent edits and deletion against the original displayed transaction', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('concurrent')]);
		await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("concurrent")');
		await d.fill('#edit-tx-memo', '手元の変更');
		await d.evaluate(`(async()=> { const db=window.__yose_app.db; const tx=await db.getTransaction('concurrent'); await db.putTransaction({...tx,memo:'別端末の変更',amount:999}); })()`);
		await submit(d, '#edit-tx-form');
		await waitForDialog(d, '変更');
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		assert.equal(await value(d, '#edit-tx-memo'), '手元の変更');
		assert.equal((await records(d))[0].memo, '別端末の変更');
		await d.click('#btn-edit-delete-tx');
		await waitForDialog(d, '削除に失敗');
		assert.equal((await records(d))[0].is_deleted, false);
	});
	it('retains a valid classification when selecting a memo whose archived category is no longer selectable', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async()=> { const app=window.__yose_app; const c=await app.db.getMasterConfig(); c.categories.push({id:'cat_old',name:'旧分類',type:'expense',is_archived:true,subcategories:[]}); await app.db.saveMasterConfig(c); app.txInputController.memoHistoryMap['過去のメモ']={category_id:'cat_old',subcategory_id:null}; })()`);
		const previous = await value(d, '#select-category');
		await d.evaluate('window.__yose_app.txInputController.handleMemoChange("過去のメモ")');
		assert.equal(await value(d, '#select-category'), previous);
	});
	it('keeps input contents and reports rejected writes without unhandled rejection', async () => {
		const d = fixture.driver;
		await d.fill('#input-amount', '100');
		await d.fill('#input-memo', '保存できない入力');
		await d.evaluate('window.__yose_app.db.putTransactions=async()=>{throw new Error("参照先が変更されたため保存できません");}');
		await d.click('#btn-save-tx');
		await waitForDialog(d, '保存に失敗');
		assert.equal(await value(d, '#input-amount'), '100');
		assert.equal(await value(d, '#input-memo'), '保存できない入力');
	});
	it('exposes a destination when creating a recurring transfer', async () => {
		const d = fixture.driver;
		await settings(d, 'recurring');
		await d.click('#btn-add-recurring');
		await d.fill('#m-rec-name', '定期振替');
		await d.fill('#m-rec-amount', '1000');
		await d.select('#m-rec-type', 'transfer');
		assert.equal(await d.isVisible('#m-rec-to-account'), true);
		await d.select('#m-rec-account', 'acc_bank_main');
		await d.select('#m-rec-to-account', 'acc_wallet');
		await submit(d, '#form-master-recurring');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		const rule = await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).recurring_rules.find(x=>x.name==="定期振替"))()');
		assert.equal(rule.to_account_id, 'acc_wallet');
		assert.equal(rule.category_id, null);
		assert.equal(rule.subcategory_id, null);
	});
	it('resets recurring children for changed parents, filters income classifications, and preserves untouched archived selections', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async()=> { const app=window.__yose_app; const c=await app.db.getMasterConfig(); c.categories.push({id:'cat_old',name:'旧分類',type:'expense',is_archived:true,subcategories:[{id:'sub_old',name:'旧中項目',is_archived:true}]}); c.recurring_rules.push({id:'rec_integrity',name:'対象ルール',is_active:true,type:'expense',amount:100,account_id:'acc_wallet',category_id:'cat_old',subcategory_id:'sub_old',actual_category_id:'cat_old',actual_subcategory_id:'sub_old',day_of_month:10}); await app.db.putRaw('master_config',await app.db.encryptRecord(c),'current'); await app.refreshAllViews(); })()`);
		await settings(d, 'recurring');
		await d.click('.btn-edit-recurring[data-id="rec_integrity"]');
		assert.equal(await value(d, '#m-rec-cat'), 'cat_old');
		assert.equal(await value(d, '#m-rec-sub'), 'sub_old');
		await submit(d, '#form-master-recurring');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		await d.click('.btn-edit-recurring[data-id="rec_integrity"]');
		await d.select('#m-rec-cat', 'cat_food');
		await d.select('#m-rec-actual-cat', 'cat_housing');
		assert.equal(await value(d, '#m-rec-sub'), '');
		assert.equal(await value(d, '#m-rec-actual-sub'), '');
		await d.select('#m-rec-type', 'income');
		assert.equal(await d.evaluate('Array.from(document.querySelector("#m-rec-cat").options).every(o=>["cat_income_main","cat_point_income"].includes(o.value))'), true);
		await submit(d, '#form-master-recurring');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		const rule = await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).recurring_rules.find(x=>x.id==="rec_integrity"))()');
		assert.equal(rule.type, 'income');
		assert.equal(rule.subcategory_id, null);
		assert.equal(rule.actual_subcategory_id, null);
	});
	it('preserves unrelated newer settings during archive and overlapping local display mutations', async () => {
		const d = fixture.driver;
		await settings(d, 'categories');
		await d.evaluate(`(async()=> { const db=window.__yose_app.db; const c=await db.getMasterConfig(); c.categories.find(x=>x.id==='cat_housing').name='別端末の最新'; await db.saveMasterConfig(c); })()`);
		await d.click('.btn-archive-cat[data-id="cat_food"]');
		await d.waitFor('(async()=> (await window.__yose_app.db.getMasterConfig()).categories.find(x=>x.id==="cat_food").is_archived)()');
		await d.evaluate('Promise.all([window.__yose_app.setTheme("dark"),window.__yose_app.setPaneCollapsed("card-theme-setting",true)])');
		const c = await d.evaluate('window.__yose_app.db.getMasterConfig()');
		assert.equal(c.categories.find(x=>x.id==='cat_housing').name, '別端末の最新');
		assert.equal(c.theme, 'dark');
		assert.equal(c.collapsed_panes['card-theme-setting'], true);
	});
	it('settles an advance only once under simultaneous clicks and rejects an already settled source', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('advance', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null, settlement_status: 'unsettled' })]);
		await d.evaluate('Promise.all([window.__yose_app.txInputController.handleSettleAdvanceDirectly("advance"),window.__yose_app.txInputController.handleSettleAdvanceDirectly("advance")])');
		assert.equal((await records(d)).filter(tx=>tx.id !== 'advance').length, 1);
		await d.evaluate('window.__yose_app.txInputController.handleSettleAdvanceDirectly("advance")');
		assert.equal((await records(d)).filter(tx=>tx.id !== 'advance').length, 1);
	});
	it('keeps archived debit and insurance references when only an account name changes', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async()=> { const db=window.__yose_app.db; const c=await db.getMasterConfig(); c.accounts.push({id:'acc_old_bank',name:'旧口座',type:'bank',is_asset:true,is_archived:true,initial_balance:0}); c.categories.push({id:'cat_old_ins',name:'旧保険費',type:'expense',is_archived:true,subcategories:[{id:'sub_old_ins',name:'旧保険内訳',is_archived:true}]}); c.accounts.find(x=>x.id==='acc_card_a').debit_account_id='acc_old_bank'; c.accounts.find(x=>x.id==='acc_card_a').settlement_account_id='acc_old_bank'; c.accounts.push({id:'acc_old_ins',name:'旧保険',type:'insurance',is_asset:true,initial_balance:0,is_archived:true,premium_amount:100,premium_day:27,premium_pay_account_id:'acc_old_bank',premium_category_id:'cat_old_ins',premium_subcategory_id:'sub_old_ins'}); await db.putRaw('master_config',await db.encryptRecord(c),'current'); await window.__yose_app.refreshAllViews(); })()`);
		await settings(d, 'accounts');
		await d.click('.btn-edit-account[data-id="acc_card_a"]');
		assert.equal(await value(d, '#m-acc-debit-account'), 'acc_old_bank');
		await d.fill('#m-acc-name', '名称変更カード');
		await submit(d, '#form-master-account');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		await d.click('.btn-edit-account[data-id="acc_old_ins"]');
		assert.equal(await value(d, '#m-acc-premium-pay-account'), 'acc_old_bank');
		assert.equal(await value(d, '#m-acc-premium-cat'), 'cat_old_ins');
		assert.equal(await value(d, '#m-acc-premium-sub'), 'sub_old_ins');
		await d.fill('#m-acc-name', '名称変更保険');
		await submit(d, '#form-master-account');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		const c = await d.evaluate('window.__yose_app.db.getMasterConfig()');
		assert.equal(c.accounts.find(x=>x.id==='acc_card_a').debit_account_id, 'acc_old_bank');
		assert.equal(c.accounts.find(x=>x.id==='acc_old_ins').premium_subcategory_id, 'sub_old_ins');
	});
	it('clears the insurance premium child when its parent category changes', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async()=> { const db=window.__yose_app.db; const c=await db.getMasterConfig(); c.accounts.push({id:'acc_ins_parent',name:'保険',type:'insurance',is_asset:true,initial_balance:0,premium_amount:100,premium_day:27,premium_pay_account_id:'acc_wallet',premium_category_id:'cat_food',premium_subcategory_id:'sub_groceries'}); await db.putRaw('master_config',await db.encryptRecord(c),'current'); await window.__yose_app.refreshAllViews(); })()`);
		await settings(d, 'accounts');
		await d.click('.btn-edit-account[data-id="acc_ins_parent"]');
		await d.select('#m-acc-premium-cat', 'cat_housing');
		assert.equal(await value(d, '#m-acc-premium-sub'), '');
		await submit(d, '#form-master-account');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		const rule = await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).recurring_rules.find(x=>x.id==="rec_ins_acc_ins_parent"))()');
		assert.equal(rule.category_id, 'cat_housing');
		assert.ok(!rule.subcategory_id);
	});
	it('keeps nonvisible archived category budgets while saving displayed annual budget fields', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async()=> { const app=window.__yose_app; const c=await app.db.getMasterConfig(); c.categories.find(x=>x.id==='cat_food').is_archived=true; c.annual_budgets['2026']={expense_budget:1000,savings_target_amount:0,savings_target_rate:0,category_budgets:{cat_food:500,cat_housing:500}}; await app.db.putRaw('master_config',await app.db.encryptRecord(c),'current'); await app.refreshAllViews(); })()`);
		await settings(d);
		assert.equal(await d.evaluate('document.querySelector(".input-cat-budget[data-cat-id=cat_food]") === null'), true);
		await d.fill('#setting-expense-budget', '1200');
		await d.fill('.input-cat-budget[data-cat-id="cat_housing"]', '600');
		await d.click('#btn-save-annual-budget');
		await waitForDialog(d, '年間予算・費目別目標を保存');
		const budget = await d.evaluate('window.__yose_app.db.getAnnualBudget("2026")');
		assert.deepEqual(budget.category_budgets, { cat_food: 500, cat_housing: 600 });
	});
	for (const concurrent of [false, true]) {
		it(`${concurrent ? 'rejects a concurrent deletion in' : 'allows active records of'} a partially deleted prepaid group`, async () => {
			const d = fixture.driver;
			await d.evaluate(`(async()=> { const app=window.__yose_app; const {createPrepaidAmortizationTransactions}=await import('./js/logic.js'); const txs=createPrepaidAmortizationTransactions({paymentDate:'2026-10-20',totalAmount:1200,amortizeMonths:3,payingAccountId:'acc_wallet',categoryId:'cat_food'}); txs[1].is_deleted=true; await app.db.putTransactions(txs); window.__group=txs; await app.txEditController.openEditTransactionModal(txs[2].id); })()`);
			await d.fill('#edit-tx-memo', '一括修正');
			if (concurrent) await d.evaluate(`(async()=>{const db=window.__yose_app.db;const tx=await db.getTransaction(window.__group[3].id);await db.putTransaction({...tx,is_deleted:true});})()`);
			await submit(d, '#edit-tx-form');
			if (concurrent) {
				await waitForDialog(d, '変更');
				assert.equal(await d.isVisible('#modal-edit-tx'), true);
				assert.ok((await records(d)).every(tx=>!tx.memo.includes('一括修正')));
				assert.equal((await records(d)).filter(tx=>tx.is_deleted).length, 2);
			} else {
				await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
				const txs = await records(d);
				assert.equal(txs.filter(tx=>tx.is_deleted).length, 1);
				assert.ok(txs.filter(tx=>!tx.is_deleted).every(tx=>tx.memo.includes('一括修正')));
			}
		});
	}
	for (const preference of ['pane', 'theme']) {
		it(`persists the latest ${preference} intent when the first write is delayed`, async () => {
			const d = fixture.driver;
			const state = await d.evaluate(`(async()=> {
				const app=window.__yose_app, mutate=app.db.mutateMasterConfig.bind(app.db);
				let calls=0;
				app.db.mutateMasterConfig=async callback=>{ if(++calls===1) await new Promise(resolve=>setTimeout(resolve,100)); return mutate(callback); };
				await Promise.all(${preference === 'pane' ? '[app.setPaneCollapsed("card-theme-setting",true),app.setPaneCollapsed("card-theme-setting",false)]' : '[app.setTheme("dark"),app.setTheme("light")]'});
				return app.db.getMasterConfig();
			})()`);
			if (preference === 'pane') assert.equal(state.collapsed_panes['card-theme-setting'], false);
			else assert.equal(state.theme, 'light');
		});
	}
	it('continues later preference writes after the earlier queued write rejects', async () => {
		const d = fixture.driver;
		const state = await d.evaluate(`(async()=> {
			const app=window.__yose_app, mutate=app.db.mutateMasterConfig.bind(app.db);
			let calls=0;
			app.db.mutateMasterConfig=async callback=>{ if(++calls===1) throw new Error('保存を拒否'); return mutate(callback); };
			await Promise.all([app.setTheme('dark'),app.setTheme('light'),app.setPaneCollapsed('card-theme-setting',true)]);
			return app.db.getMasterConfig();
		})()`);
		assert.equal(state.theme, 'light');
		assert.equal(state.collapsed_panes['card-theme-setting'], true);
	});
	for (const legacy of [false, true]) it(`keeps the ${legacy ? 'legacy' : 'encrypted'} original when authentication locks while a preference write is queued`, async () => {
		const d = fixture.driver;
		if (legacy) await d.evaluate(`(async()=>{const db=window.__yose_app.db;const master=await db.getMasterConfig(),snapshot=await db.getSnapshot();await db.putRaw('master_config',master,'current');await db.putRaw('summary_snapshot',snapshot,'current');})()`);
		const before = await d.evaluate('window.__yose_app.db.getRaw("master_config","current")');
		await d.evaluate(`(() => {
			const app=window.__yose_app, mutate=app.db.mutateMasterConfig.bind(app.db);
			const gate=new Promise(resolve=>window.__releasePreference=resolve);
			let calls=0;
			app.db.mutateMasterConfig=async callback=>{ if(++calls===1) {window.__preferenceStarted=true;await gate;throw new Error('先行処理を取消');} return mutate(callback); };
			window.__preferenceWrites=Promise.all([app.setTheme('dark'),app.setTheme('light')]);
		})()`);
		await d.waitFor('window.__preferenceStarted');
		await d.evaluate('window.__yose_app.lockPrivateKey()');
		await d.evaluate('window.__releasePreference(); window.__preferenceWrites');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("master_config","current")'), before);
	});
	for (const amount of ['0', '100']) it(`requires an explicit amount before confirming a pending record and accepts known ${amount}`, async () => {
		const d = fixture.driver;
		await seed(d, [transaction('pending_edit', { amount: 0, amount_pending: true, status: 'planned' })]);
		await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("pending_edit")');
		assert.equal(await value(d, '#edit-tx-amount'), '');
		await d.select('#edit-tx-status', 'confirmed');
		await submit(d, '#edit-tx-form');
		await waitForDialog(d, '金額未入力');
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		assert.equal((await records(d))[0].status, 'planned');
		await d.fill('#edit-tx-amount', amount);
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		const [saved] = await records(d);
		assert.equal(saved.amount, Number(amount));
		assert.equal(saved.amount_pending, false);
		assert.equal(saved.status, 'confirmed');
	});
	it('allows a new edit after local persistence while the earlier synchronization is still waiting', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('background_edit', { date: '2026-09-20', target_month: '2026-09', sync_status: 'synced' })]);
		await d.evaluate(`(() => { const app=window.__yose_app; app.syncManager.setGasUrl('https://yose.local/background'); let calls=0; app.syncManager.syncPendingDiffs=async()=>{ if(++calls===1){window.__syncWaiting=true;await new Promise(resolve=>window.__releaseBackground=resolve);} return {uploaded:0,downloaded:0};}; })()`);
		try {
			await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("background_edit")');
			await d.fill('#edit-tx-memo', '一回目');
			await submit(d, '#edit-tx-form');
			await d.waitFor('window.__syncWaiting && !document.getElementById("modal-edit-tx").classList.contains("active")');
			await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("background_edit")');
			await d.fill('#edit-tx-memo', '二回目');
			await submit(d, '#edit-tx-form');
			await d.waitFor('(async()=> (await window.__yose_app.db.getTransaction("background_edit")).memo === "二回目")()');
		} finally { await d.evaluate('window.__releaseBackground?.()'); }
	});
	it('regenerates one recurring record after receiving a deletion marker without a target month', async () => {
		const d = fixture.driver;
		await d.evaluate('window.__yose_app.summaryController.handleGenerateRecurring()');
		const [generated] = await records(d);
		await d.evaluate(`(async()=> { const db=window.__yose_app.db; const marker={id:${JSON.stringify(generated.id)},is_deleted:true,updated_at:'2100-01-01T00:00:00Z',sync_status:'synced'}; await db.putRaw('transactions',await db.encryptRecord(marker,{id:marker.id,is_deleted:true,sync_status:'synced'})); })()`);
		await d.evaluate('window.__yose_app.summaryController.handleGenerateRecurring()');
		const current = await records(d);
		assert.equal(current.length, 1);
		assert.equal(current[0].id, generated.id);
		assert.equal(current[0].is_deleted, false);
		assert.equal(current[0].status, 'planned');
		assert.ok(Date.parse(current[0].updated_at) > Date.parse('2100-01-01T00:00:00Z'));
	});
	it('keeps a recurring record that arrived after the monthly generation read instead of replacing it', async () => {
		const d = fixture.driver;
		await d.evaluate('window.__yose_app.summaryController.handleGenerateRecurring()');
		await d.evaluate(`(async()=>{const app=window.__yose_app,db=app.db;const [tx]=await db.getTransactions();await db.putTransaction({...tx,amount:999,memo:'別操作で確定した内容'});const read=db.getTransactions.bind(db);let hide=true;db.getTransactions=async filter=>{const rows=await read(filter);if(hide&&filter?.target_month===app.currentMonth){hide=false;return [];}return rows;};})()`);
		const count = await d.evaluate('window.__dialogs.length');
		await d.evaluate('window.__yose_app.summaryController.handleGenerateRecurring()');
		assert.equal((await records(d))[0].amount, 999);
		assert.equal((await records(d))[0].memo, '別操作で確定した内容');
		assert.equal(await d.evaluate(`window.__dialogs.slice(${count}).some(dialog=>dialog.message.includes('すでに生成'))`), true);
	});
	it('sends the saved version when deleting a closed transaction with a future timestamp', async () => {
		const d = fixture.driver;
		const timestamp = '2100-01-01T00:00:00Z';
		await seed(d, [transaction('future_delete', { date: '2026-09-20', target_month: '2026-09', updated_at: timestamp, sync_status: 'synced' })]);
		await d.evaluate(`(() => { const app=window.__yose_app; app.syncManager.setGasUrl('https://yose.local/future-delete'); app.syncManager.fetch=async(_url,options)=>{const request=JSON.parse(options.body);if(request.action==='retroactive_update')window.__futureDeleteSent=request.payload.transaction;return {ok:true,text:async()=>JSON.stringify({success:true})};}; })()`);
		await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("future_delete")');
		await d.click('#btn-edit-delete-tx');
		await d.waitFor('window.__futureDeleteSent');
		const sent = await d.evaluate('window.__futureDeleteSent');
		assert.equal(sent.is_deleted, true);
		assert.ok(Date.parse(sent.updated_at) > Date.parse(timestamp));
		assert.equal(sent.updated_at, (await records(d))[0].updated_at);
	});
	it('deletes a saved edit from the list without reusing the closed editor original', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('list_delete')]);
		await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("list_delete")');
		await d.fill('#edit-tx-memo', '保存後の削除');
		await submit(d, '#edit-tx-form');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		await cashflow(d);
		await d.click('#month-tx-list [data-id="list_delete"] .btn-delete-tx');
		await d.waitFor('(async()=> (await window.__yose_app.db.getTransaction("list_delete")).is_deleted)()');
		assert.equal((await records(d))[0].is_deleted, true);
	});
	it('reports a rejected list deletion and retains the original without browser exceptions', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('list_failure')]);
		await cashflow(d);
		await d.evaluate('window.__yose_app.db.putTransaction=async()=>{throw new Error("削除原本が変更されました");}');
		await d.click('#month-tx-list [data-id="list_failure"] .btn-delete-tx');
		await waitForDialog(d, '削除に失敗');
		assert.equal((await records(d))[0].is_deleted, false);
	});
	for (const status of ['master_conflict', 'already_syncing']) it(`reports a locally saved closed edit as pending when synchronization returns ${status}`, async () => {
		const d = fixture.driver;
		await seed(d, [transaction('pending_notice', { date: '2026-09-20', target_month: '2026-09', sync_status: 'synced' })]);
		await d.evaluate(`window.__yose_app.syncManager.setGasUrl('https://yose.local/pending-notice'); window.__yose_app.syncManager.syncPendingDiffs=async()=>({status:${JSON.stringify(status)}});`);
		await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("pending_notice")');
		await d.fill('#edit-tx-amount', '333');
		const count = await d.evaluate('window.__dialogs.length');
		await submit(d, '#edit-tx-form');
		await waitForDialog(d, '同期は未完了');
		const [saved] = await records(d);
		assert.equal(saved.amount, 333);
		assert.equal(saved.sync_status, 'unsynced');
		assert.equal(await d.evaluate(`window.__dialogs.slice(${count}).some(dialog=>dialog.message.includes('再計算しました'))`), false);
	});
});
