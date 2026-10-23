import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, cashflow, submit, waitForDialog, value } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
const a = extra => transaction('advance', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null, memo: '元の立替', ...extra });
const r = extra => transaction('repayment', { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_bank_main', category_id: null, actual_category_id: null, memo: '手入力した回収', tags: ['記録'], ...extra });
async function edit(d, id) {
	await d.click(`#month-tx-list [data-id="${id}"]`);
	await d.waitFor(`document.getElementById('modal-edit-tx').classList.contains('active') && document.getElementById('edit-tx-id').value === ${JSON.stringify(id)}`);
}
async function open(d, id) {
	await edit(d, id); await d.click('#btn-edit-link-advance');
	await d.waitFor('document.getElementById("modal-advance-link").classList.contains("active")');
}

describe('existing advance repayment UI', () => {
	for (const method of ['escape', 'cancel']) it(`does not revive a delayed link dialog after closing its source editor with ${method}, then permits a fresh link`, async () => {
		const d = fixture.driver; await seed(d, [a(), r()]); await cashflow(d); await edit(d, 'advance');
		await d.evaluate(`{
			const app=window.__yose_app, db=app.db, read=db.getTransactions.bind(db), open=app.advanceLinkController.open.bind(app.advanceLinkController);
			window.__delayedLinkDone=false;
			db.getTransactions=async(...args)=>{const result=await read(...args);db.getTransactions=read;await new Promise(resolve=>window.__releaseDelayedLink=resolve);return result;};
			app.advanceLinkController.open=async(...args)=>{try{return await open(...args);}finally{app.advanceLinkController.open=open;window.__delayedLinkDone=true;}};
			void 0;
		}`);
		await d.click('#btn-edit-link-advance'); await d.waitFor('typeof window.__releaseDelayedLink === "function"');
		if (method === 'escape') await d.key('#edit-tx-memo', 'Escape');
		else await d.click('#btn-cancel-edit-tx');
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		await d.evaluate('window.__releaseDelayedLink()'); await d.waitFor('window.__delayedLinkDone');
		assert.equal(await d.isVisible('#modal-advance-link'), false);
		assert.equal((await records(d)).find(tx => tx.id === 'repayment').advance_source_id, undefined);
		await open(d, 'advance'); await d.select('#advance-link-candidate', 'repayment'); await d.click('#btn-save-advance-link');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransaction("repayment")).advance_source_id === "advance")()');
		assert.equal((await records(d)).length, 2);
	});
	it('keeps the saving dialog active until refreshed views are ready, then permits immediate reopening', async () => {
		const d=fixture.driver; await seed(d,[a(),r()]); await cashflow(d); await open(d,'advance');
		await d.evaluate(`const app=window.__yose_app,refresh=app.refreshAllViews.bind(app);app.refreshAllViews=async()=>{await new Promise(resolve=>window.__finishLinkRefresh=resolve);app.refreshAllViews=refresh;await refresh();};`);
		await d.select('#advance-link-candidate','repayment'); await d.click('#btn-save-advance-link');
		await d.waitFor('typeof window.__finishLinkRefresh === "function"');
		assert.equal(await d.isVisible('#modal-advance-link'),true);
		assert.equal(await d.evaluate('document.getElementById("btn-save-advance-link").disabled'),true);
		await d.evaluate('window.__finishLinkRefresh()'); await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		await open(d,'advance'); assert.match(await d.textContent('#advance-link-current'),/手入力した回収/);
	});
	it('reports a committed link separately from a failed view refresh and allows viewing it after retry', async () => {
		const d=fixture.driver; await seed(d,[a(),r()]); await cashflow(d); await open(d,'advance');
		await d.evaluate(`const app=window.__yose_app;window.__realLinkRefresh=app.refreshAllViews.bind(app);app.refreshAllViews=async()=>{throw new Error('一覧更新失敗');};`);
		await d.select('#advance-link-candidate','repayment'); await d.click('#btn-save-advance-link');
		await waitForDialog(d,'保存済み');
		assert.equal((await records(d)).find(tx=>tx.id==='repayment').advance_source_id,'advance');
		assert.equal(await d.isVisible('#modal-advance-link'),false);
		await d.evaluate('window.__yose_app.refreshAllViews=window.__realLinkRefresh;window.__yose_app.refreshAllViews()');
		await open(d,'advance'); assert.match(await d.textContent('#advance-link-current'),/手入力した回収/);
	});
	it('keeps a new editor open when an earlier saved link finishes refreshing after lock and unlock', async () => {
		const d=fixture.driver; await seed(d,[a(),r()]); await cashflow(d); await open(d,'advance');
		await d.evaluate(`const app=window.__yose_app,refresh=app.refreshAllViews.bind(app);app.refreshAllViews=async()=>{app.refreshAllViews=refresh;await new Promise(resolve=>window.__releaseOldLinkRefresh=resolve);await refresh();window.__oldLinkRefreshDone=true;};`);
		await d.select('#advance-link-candidate','repayment'); await d.click('#btn-save-advance-link'); await d.waitFor('typeof window.__releaseOldLinkRefresh === "function"');
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await d.fill('#auth-pin-input','1234'); await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		await cashflow(d); await edit(d,'repayment'); await d.fill('#edit-tx-memo','次の編集中');
		await d.evaluate('window.__releaseOldLinkRefresh()'); await d.waitFor('window.__oldLinkRefreshDone');
		assert.equal(await d.isVisible('#modal-edit-tx'),true); assert.equal(await value(d,'#edit-tx-id'),'repayment'); assert.equal(await value(d,'#edit-tx-memo'),'次の編集中');
	});
	for (const side of ['advance', 'repayment']) it(`links and unlinks existing records from the ${side} side without creating another repayment`, async () => {
		const d = fixture.driver;
		await seed(d, [a(), r()]); await cashflow(d); await open(d, side);
		await d.select('#advance-link-candidate', side === 'advance' ? 'repayment' : 'advance');
		await d.click('#btn-save-advance-link');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransaction("repayment")).advance_source_id === "advance")()');
		assert.equal((await records(d)).length, 2);
		assert.equal(await d.evaluate('window.__yose_app.db.getUnsettledAdvancePayments()').then(x => x.length), 0);
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		await open(d, side);
		assert.match(await d.textContent('#advance-link-current'), /元の立替|手入力した回収/);
		await d.click('#btn-unlink-advance');
		await d.waitFor('(async () => !(await window.__yose_app.db.getTransaction("repayment")).advance_source_id)()');
		assert.equal((await records(d)).length, 2);
		assert.equal(await d.evaluate('(async () => (await window.__yose_app.db.getUnsettledAdvancePayments()).length)()'), 1);
	});
	for (const side of ['advance', 'income']) it(`confirms conversion of a manual income when linking from ${side} and keeps its user content`, async () => {
		const d = fixture.driver;
		const income = transaction('income', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', memo: '本人が入力した返金', tags: ['個人タグ'] });
		await seed(d, [a(), income]); await cashflow(d); await open(d, side);
		await d.select('#advance-link-candidate', side === 'advance' ? 'income' : 'advance');
		await d.setConfirm(false); await d.click('#btn-save-advance-link'); await waitForDialog(d, '収入集計');
		assert.equal((await records(d)).find(tx => tx.id === 'income').type, 'income');
		await d.setConfirm(true); await d.click('#btn-save-advance-link');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransaction("income")).type === "transfer")()');
		const changed = (await records(d)).find(tx => tx.id === 'income');
		assert.equal(changed.advance_source_id, 'advance'); assert.equal(changed.to_account_id, income.account_id);
		assert.equal(changed.account_id, 'acc_receivable'); assert.equal(changed.memo, income.memo); assert.deepEqual(changed.tags, income.tags);
		assert.equal(changed.category_id, null); assert.equal(changed.actual_category_id, null);
		await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
		await d.waitFor('!document.querySelector("#month-tx-list [data-id=income]").textContent.includes("収入")');
		assert.equal((await records(d)).length, 2);
	});
	it('keeps unsaved editing intact and prevents linking stale source or repayment previews', async () => {
		const d = fixture.driver; await seed(d, [a(), r()]); await cashflow(d); await edit(d, 'advance');
		await d.fill('#edit-tx-memo', 'まだ保存していない'); await d.click('#btn-edit-link-advance');
		await waitForDialog(d, '保存'); assert.equal(await value(d, '#edit-tx-memo'), 'まだ保存していない');
		assert.equal(await d.isVisible('#modal-advance-link'), false);
		await d.fill('#edit-tx-memo', '元の立替'); await d.click('#btn-edit-link-advance');
		await d.select('#advance-link-candidate', 'repayment');
		await d.evaluate(`(async () => { const db=window.__yose_app.db; const tx=await db.getTransaction('advance'); await db.putTransaction({...tx,memo:'別の変更'}); })()`);
		await d.click('#btn-save-advance-link'); await waitForDialog(d, '変更');
		assert.equal((await records(d)).find(tx => tx.id === 'repayment').advance_source_id, undefined);
	});
	it('filters wrong amount, planned, unknown and already linked records and escapes candidate text', async () => {
		const d = fixture.driver;
		await seed(d, [a(), a({ id: 'other-source' }), r({ id: 'linked-loaded', advance_source_id: 'other-source' }), r({ id: 'linked-unloaded', advance_source_id: 'not-downloaded' }), r({ memo: '<img src=x onerror="window.__linkXss=1">' }), r({ id: 'different', amount: 200 }), r({ id: 'planned', status: 'planned' }), r({ id: 'unknown', amount: 0, amount_pending: true, status: 'planned' })]);
		await cashflow(d); await open(d, 'advance');
		assert.deepEqual(await d.evaluate('Array.from(document.getElementById("advance-link-candidate").options, o=>o.value)'), ['repayment']);
		assert.match(await d.textContent('#advance-link-candidate'), /<img/);
		assert.equal(await d.evaluate('document.querySelector("#modal-advance-link img")'), null);
		assert.equal(await d.evaluate('window.__linkXss'), undefined);
	});
	for (const failure of ['storage', 'lock', 'reclose-cancel']) it(`preserves both records and candidates during income conversion on ${failure} and supports retry`, async () => {
		const d=fixture.driver;
		const period=failure==='reclose-cancel' ? { date:'2026-09-20',target_month:'2026-09' } : {};
		const income=transaction('income',{type:'income',category_id:'cat_income_main',actual_category_id:'cat_income_main',...period});
		await seed(d,[a({settlement_status:'settled',...period}),income]); await cashflow(d);
		if (failure==='reclose-cancel') { await d.fill('#input-period-picker','2026-09'); await d.waitFor('document.querySelector("#month-tx-list [data-id=advance]")'); }
		await open(d,'advance'); await d.select('#advance-link-candidate','income');
		const before=await d.evaluate('window.__yose_app.db.getAllRaw("transactions")');
		if (failure==='reclose-cancel') await d.evaluate(`window.confirm=message=>{window.__dialogs.push({type:'confirm',message});return !message.includes('再月締め');};`);
		else await d.evaluate(`const app=window.__yose_app,db=app.db; window.__encryptRecord=db.encryptRecord.bind(db); let once=true;
			db.encryptRecord=async(...args)=>{ const value=await window.__encryptRecord(...args); if(once){once=false; ${failure==='storage' ? "throw new Error('保存失敗');" : 'await app.authController.lockPrivateKey();'} } return value; };`);
		await d.click('#btn-save-advance-link');
		await waitForDialog(d,failure==='reclose-cancel' ? '再月締め' : failure==='storage' ? '保存失敗' : '変更');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getAllRaw("transactions")'),before);
		if (failure==='lock') { await d.fill('#auth-pin-input','1234'); await d.click('#btn-auth-pin'); await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")'); await open(d,'advance'); }
		else if (failure==='storage') await d.evaluate('window.__yose_app.db.encryptRecord=window.__encryptRecord');
		else await d.evaluate(`window.confirm=message=>{window.__dialogs.push({type:'confirm',message});return true;};`);
		assert.equal(await value(d,'#advance-link-candidate'),'income');
		await d.click('#btn-save-advance-link'); await d.waitFor('(async()=>(await window.__yose_app.db.getTransaction("income")).advance_source_id==="advance")()');
		assert.equal((await records(d)).length,2);
	});
	it('reappears in unrecovered candidates after deleting a linked repayment and prevents changing its source amount', async () => {
		const d = fixture.driver; await seed(d, [a(), r({ advance_source_id: 'advance' })]); await cashflow(d);
		await edit(d, 'advance'); await d.fill('#edit-tx-amount', '200'); await submit(d, '#edit-tx-form'); await waitForDialog(d, 'ひも付け');
		assert.equal((await records(d)).find(tx => tx.id === 'advance').amount, 100);
		await d.click('#btn-cancel-edit-tx'); await edit(d, 'repayment'); await d.click('#btn-edit-delete-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransaction("repayment")).is_deleted)()');
		assert.equal(await d.evaluate('(async () => (await window.__yose_app.db.getUnsettledAdvancePayments()).length)()'), 1);
	});
	it('shows Japanese transaction types in both period and recent lists without changing stored codes', async () => {
		const d = fixture.driver;
		await seed(d, [a(), transaction('income', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main' }), transaction('expense')]);
		await d.evaluate('window.__yose_app.txListController.renderRecentTransactions()'); await cashflow(d);
		for (const [id, label] of [['advance', '振替'], ['income', '収入'], ['expense', '支出']]) {
			for (const list of ['month-tx-list', 'recent-tx-list']) {
				const text = await d.textContent(`#${list} [data-id="${id}"] .tx-info > .tx-meta:last-child > span:last-child`); assert.equal(text, label);
			}
		}
		assert.deepEqual((await records(d)).map(tx => tx.type).sort(), ['expense', 'income', 'transfer']);
	});
});
