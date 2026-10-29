import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, cashflow, settings } from '../helpers/ui_fixture.js';
const fixture = useBrowser();

async function observeAnnualSettings(d) {
	await d.evaluate(`(()=>{
		const app=window.__yose_app,restores=[];window.__annualJobs=[];
		for(const [owner,names] of [[app.settingsController,['renderSettings']],[app.budgetSettingsController,['render','save']],[app.furusatoController,['render','saveFurusato']],[app.summaryController,['renderSummary']]])for(const name of names){
			const original=owner[name];owner[name]=function(...args){const promise=original.apply(this,args);window.__annualJobs.push(promise);return promise;};restores.push(()=>owner[name]=original);
		}
		window.__restoreAnnualSettings=()=>restores.reverse().forEach(restore=>restore());
	})()`);
}

async function settleAnnualSettings(d) {
	await d.evaluate('(async()=>{let count=-1;while(count!==window.__annualJobs.length){count=window.__annualJobs.length;await Promise.all(window.__annualJobs);}})()');
}

async function readyAnnualBudget(d) {
	await settings(d); await settleAnnualSettings(d);
	await d.waitFor('(()=>{const owner=window.__yose_app.budgetSettingsController,input=document.querySelector("#setting-expense-budget");return owner.year==="2026"&&owner.draft&&!owner.loading&&!owner.saving&&!input.disabled&&!input.readOnly&&!document.querySelector("#btn-save-annual-budget").disabled;})()');
}

async function readyDonation(d) {
	await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]'); await settleAnnualSettings(d);
	await d.waitFor('(()=>{const owner=window.__yose_app.furusatoController;return owner.taxDraft?.year==="2026"&&!owner.taxBusy&&!document.querySelector("#furusato-resident-tax").disabled&&!document.querySelector("#btn-save-furusato").disabled;})()');
}

async function delayAnnualRead(d, stage) {
	await d.evaluate(`(()=>{
		const app=window.__yose_app,owner=${stage === 'metadata' ? 'app.insightsController' : 'app.db'},name=${JSON.stringify(stage === 'metadata' ? 'renderMetadata' : 'getAnalyticsState')},original=owner[name];let once=true;
		let armed=${stage === 'metadata'},restoreBudget=()=>{};
		if(!armed){const budget=app.budgetSettingsController,render=budget.render;budget.render=function(...args){armed=true;return render.apply(this,args);};restoreBudget=()=>budget.render=render;}
		owner[name]=async function(...args){if(armed&&once){once=false;await new Promise(resolve=>window.__annualReadRelease=resolve);}return original.apply(this,args);};
		window.__restoreAnnualRead=()=>{owner[name]=original;restoreBudget();};
	})()`);
}
describe('metadata, bulk editing, donations, and investment UI', () => {
	it('shows acquired record counts, UTF-8 bytes and averages in Settings', async () => {
		const d = fixture.driver; await seed(d, [transaction('a'), transaction('b', { status: 'planned' })]);
		await settings(d); await d.waitFor('document.querySelector("#data-metadata")?.textContent.includes("明細 2件")');
		const text = await d.textContent('#data-metadata');
		for (const label of ['バイト', '月平均', '年平均', '確定 1件', '予定 1件']) assert.ok(text.includes(label));
	});
	it('selects without opening the single editor, applies an explicit batch patch, and clears selection', async () => {
		const d = fixture.driver; await seed(d, [transaction('a'), transaction('b')]); await cashflow(d);
		await d.click('#month-tx-list [data-bulk-id="a"]'); await d.click('#month-tx-list [data-bulk-id="b"]');
		assert.equal(await d.isVisible('#modal-edit-tx'), false);
		await d.click('#btn-bulk-edit'); await d.waitFor('document.querySelector("#modal-bulk-edit").classList.contains("active")');
		await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', '一括修正');
		await d.click('#bulk-apply-tags'); await d.fill('#bulk-value-tags', 'ふるさと納税');
		await d.click('#btn-save-bulk');
		await d.waitFor('(async()=> (await window.__yose_app.db.getTransactions()).every(t=>t.memo==="一括修正"))()');
		assert.ok((await d.textContent('#bulk-selection-count')).includes('0件'));
		assert.equal(await d.isVisible('#modal-bulk-edit'), false);
	});
	it('limits mixed linked records to descriptive fields and removes hidden selections on filtering', async () => {
		const d = fixture.driver; await seed(d, [transaction('a'), transaction('advance', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null })]); await cashflow(d);
		await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit');
		assert.equal(await d.evaluate('document.querySelector("#bulk-apply-amount").disabled'), true);
		assert.equal(await d.evaluate('document.querySelector("#bulk-apply-memo").disabled'), false);
		await d.click('#btn-close-bulk'); await d.fill('#input-tx-search', 'advance');
		await d.waitFor('document.querySelectorAll("#month-tx-list .tx-item").length===1');
		assert.ok((await d.textContent('#bulk-selection-count')).includes('1件'));
	});
	it('shows a donation-year allowance, saves tax inputs and displays the official estimate and remainder', async () => {
		const d = fixture.driver; await seed(d, [transaction('gift', { amount: 20000, tags: ['ふるさと納税'] })]);
		await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]'); await d.waitFor('document.querySelector("#furusato-card").style.display!=="none"');
		assert.ok((await d.textContent('#furusato-summary')).includes('20,000'));
		await d.fill('#furusato-resident-tax', '200000'); await d.select('#furusato-tax-rate', '20'); await d.click('#btn-save-furusato');
		await d.waitFor('document.querySelector("#furusato-summary").textContent.includes("59,487")');
		assert.ok((await d.textContent('#furusato-summary')).includes('39,487'));
		assert.ok((await d.textContent('#furusato-records')).includes('gift'));
	});
	it('records end-of-day investment values and reflects them in history and asset KPI without adding transactions', async () => {
		const d = fixture.driver; await d.click('[data-analytics-target="assets"]');
		await d.fill('#investment-date', '2026-10-20'); await d.fill('#investment-acquisition-cost', '1000000'); await d.fill('#investment-valuation', '1300000');
		await d.click('#btn-save-investment');
		await d.waitFor('document.querySelector("#investment-observations").textContent.includes("1,300,000")');
		const data = await d.evaluate('window.__yose_app.chartController.assetHistoryChart.data');
		assert.equal(data.datasets.find(x => x.label === '口座評価額（預り金込・参考）').data.at(-1), 1300000);
		assert.equal(data.datasets.find(x => x.label === '取得原価（直近記録）').data.at(-1), 1000000);
		assert.ok((await d.textContent('#stat-external-assets')).includes('1,300,000'));
		assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getTransactions()).length)()'), 0);
	});
});

describe('bulk editing browser boundaries', () => {
	async function open(d) { await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit'); }
	it('keeps page selections, selects only visible page, then edits exactly the filtered selection', async () => {
		const d = fixture.driver; await seed(d, Array.from({ length: 32 }, (_, i) => transaction(`p${String(i).padStart(2, '0')}`)));
		await cashflow(d); await d.click('#btn-bulk-select-page');
		assert.ok((await d.textContent('#bulk-selection-count')).includes('30件'));
		await d.click('#btn-tx-next-page'); await d.waitFor('document.querySelectorAll("#month-tx-list .tx-item").length===2');
		await d.click('#btn-bulk-select-page'); assert.ok((await d.textContent('#bulk-selection-count')).includes('32件'));
		await d.fill('#input-tx-search', 'p31'); await d.waitFor('document.querySelectorAll("#month-tx-list .tx-item").length===1');
		await d.click('#btn-bulk-edit'); await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'target'); await d.click('#btn-save-bulk');
		await d.waitFor('(async()=> (await window.__yose_app.db.getTransaction("p31")).memo==="target")()');
		assert.deepEqual(await d.evaluate('(async()=> (await window.__yose_app.db.getTransactions()).filter(t=>t.memo==="target").map(t=>t.id))()'), ['p31']);
	});
	it('preserves edits and selection on a stale original, and cancellation saves nothing', async () => {
		const d = fixture.driver; await seed(d, [transaction('a'), transaction('b')]); await open(d);
		await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'pending');
		await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.putTransaction({...await db.getTransaction("b"),memo:"external"});})()');
		await d.click('#btn-save-bulk'); await d.waitFor('document.querySelector("#bulk-edit-error").textContent.includes("変更")');
		assert.equal(await d.evaluate('document.querySelector("#bulk-value-memo").value'), 'pending'); assert.ok((await d.textContent('#bulk-selection-count')).includes('2件'));
		assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getTransaction("a")).memo)()'), 'a');
		await d.click('#btn-close-bulk'); assert.equal(await d.isVisible('#modal-bulk-edit'), false);
	});
	it('reports committed data when a subsequent refresh fails', async () => {
		const d = fixture.driver; await seed(d, [transaction('a')]); await open(d); await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'saved');
		await d.evaluate('(()=>{const app=window.__yose_app,bulk=app.bulkEditController,save=bulk.save.bind(bulk);app.refreshAfterTransactionChange=async()=>{throw new Error("refresh failed")};bulk.save=(...args)=>window.__bulkCommittedRefresh=save(...args);})()'); await d.click('#btn-save-bulk');
		await d.waitFor('Boolean(window.__bulkCommittedRefresh)'); await d.evaluate('window.__bulkCommittedRefresh');
		assert.ok(await d.evaluate('window.__dialogs.some(x=>x.message.includes("保存済み"))'));
		assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getTransaction("a")).memo)()'), 'saved');
		assert.equal(await d.isVisible('#modal-bulk-edit'), false); assert.ok((await d.textContent('#bulk-selection-count')).includes('0件'));
	});
	it('does not resurrect a delayed bulk dialog after lock', async () => {
		const d = fixture.driver; await seed(d, [transaction('a')]); await cashflow(d); await d.click('#btn-bulk-select-page');
		await d.evaluate('const db=window.__yose_app.db, get=db.getMasterConfig.bind(db);db.getMasterConfig=async()=>{const c=await get();await new Promise(r=>window.__bulkRelease=r);return c;};');
		await d.evaluate('const bulk=window.__yose_app.bulkEditController, open=bulk.open.bind(bulk);bulk.open=async()=>{try{return await open();}finally{window.__bulkOpenFinished=true;}}');
		await d.click('#btn-bulk-edit'); await d.waitFor('typeof window.__bulkRelease==="function"');
		await d.evaluate('window.__yose_app.authController.invalidateSession();window.__bulkRelease();');
		await d.waitFor('window.__bulkOpenFinished===true');
		assert.equal(await d.isVisible('#modal-bulk-edit'), false);
	});
});

describe('investment and donation correction UI', () => {
	it('updates and deletes an observation, keeps account/asset totals coherent, and provides a fallback table', async () => {
		const d = fixture.driver; await d.click('[data-analytics-target="assets"]');
		await d.fill('#investment-acquisition-cost', '1000000'); await d.fill('#investment-valuation', '1300000'); await d.click('#btn-save-investment');
		await d.waitFor('document.querySelector("#investment-observations").textContent.includes("1,300,000")');
		await d.fill('#investment-valuation', '1400000'); await d.click('#btn-save-investment');
		await d.waitFor('document.querySelector("#stat-external-assets").textContent.includes("1,400,000")');
		assert.ok((await d.textContent('#account-balances-list')).includes('1,400,000'));
		await d.evaluate('window.Chart=undefined;window.__yose_app.summaryController.renderAssetHistory();');
		await d.waitFor('document.querySelector("#asset-history-fallback").textContent.includes("1,400,000")');
		assert.ok((await d.textContent('#asset-history-fallback')).includes('1,000,000'));
		await d.waitFor('document.querySelector("#investment-observations [data-delete-observation]") && !document.querySelector("#investment-observations [data-delete-observation]").disabled');
		await d.click('#investment-observations [data-delete-observation]');
		await d.waitFor('!document.querySelector("#investment-observations [data-delete-observation]")');
		assert.ok(!(await d.textContent('#stat-external-assets')).includes('1,400,000'));
	});
	it('shows pending-only donation years and distinguishes zero from absent tax inputs', async () => {
		const d = fixture.driver; await seed(d, [transaction('pendingGift', { tags: ['ふるさと納税'], status: 'planned', amount_pending: true, amount: 0 })]);
		await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]'); await d.waitFor('document.querySelector("#furusato-summary").textContent.includes("金額未入力 1件")');
		assert.ok((await d.textContent('#furusato-summary')).includes('未算出'));
		await d.fill('#furusato-resident-tax', '0'); await d.select('#furusato-tax-rate', '0'); await d.click('#btn-save-furusato');
		await d.waitFor('document.querySelector("#furusato-summary").textContent.includes("概算上限 ¥0")');
	});
});

describe('draft and validation UI boundaries', () => {
	it('retains dirty bulk fields when Escape dismissal is cancelled and prevents duplicate pending saves', async () => {
		const d = fixture.driver; await seed(d, [transaction('a')]); await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit');
		await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'draft');
		await d.evaluate('window.confirm=()=>false;document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));');
		assert.equal(await d.isVisible('#modal-bulk-edit'), true);
		await d.evaluate('const db=window.__yose_app.db, save=db.bulkEditTransactions.bind(db);window.__batchCalls=0;db.bulkEditTransactions=async(...args)=>{window.__batchCalls++;await new Promise(r=>window.__saveRelease=r);return save(...args);};');
		await d.click('#btn-save-bulk'); await d.waitFor('typeof window.__saveRelease==="function"');
		assert.equal(await d.evaluate('document.querySelector("#btn-save-bulk").disabled'), true);
		await d.evaluate('document.querySelector("#btn-save-bulk").click();window.__saveRelease();');
		await d.waitFor('!document.querySelector("#modal-bulk-edit").classList.contains("active")'); assert.equal(await d.evaluate('window.__batchCalls'), 1);
	});
	it('keeps edits when closed-month approval is cancelled', async () => {
		const d = fixture.driver; await seed(d, [transaction('a')]);
		await d.evaluate('(async()=>{const db=window.__yose_app.db;await db.saveSnapshot({...await db.getSnapshot(),last_closed_month:"2026-10"});})()');
		await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit'); await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'draft');
		await d.evaluate('window.confirm=()=>false'); await d.click('#btn-save-bulk');
		assert.equal(await d.isVisible('#modal-bulk-edit'), true); assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getTransaction("a")).memo)()'), 'a');
	});
	it('keeps accounting and actual classifications independent in a batch', async () => {
		const d = fixture.driver; await seed(d, [transaction('a'), transaction('b')]); await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit');
		await d.click('#bulk-apply-actual_category_id'); await d.select('#bulk-value-actual_category_id', 'cat_housing'); await d.click('#btn-save-bulk');
		await d.waitFor('(async()=> (await window.__yose_app.db.getTransactions()).every(t=>t.actual_category_id==="cat_housing"))()');
		assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getTransaction("a")).category_id)()'), 'cat_food');
	});
	for (const stage of [null, 'metadata', 'budget']) it(`keeps donation inputs when normal annual budgets are saved and vice versa${stage ? ` with delayed ${stage} reading` : ''}`, async () => {
		const d = fixture.driver; await observeAnnualSettings(d); let opening;
		try {
			await seed(d, [transaction('gift', { tags: ['ふるさと納税'] })]); await readyDonation(d);
			await d.fill('#furusato-resident-tax', '200000'); await d.select('#furusato-tax-rate', '20');
			assert.equal(await d.evaluate('window.__yose_app.furusatoController.taxDirty'), true);
			await d.click('#btn-save-furusato'); await settleAnnualSettings(d);
			assert.ok((await d.textContent('#furusato-summary')).includes('59,487'));
			if (stage) {
				await delayAnnualRead(d, stage); opening = readyAnnualBudget(d);
				await d.waitFor('typeof window.__annualReadRelease==="function"');
				if (stage === 'budget') assert.deepEqual(await d.evaluate('({loading:window.__yose_app.budgetSettingsController.loading,disabled:document.querySelector("#setting-expense-budget").disabled})'), { loading: true, disabled: true });
				await d.evaluate('window.__annualReadRelease()'); await opening;
			} else await readyAnnualBudget(d);
			await d.fill('#setting-expense-budget', '500000');
			await d.waitFor('window.__yose_app.budgetSettingsController.draft?.dirty&&window.__yose_app.budgetSettingsController.draft.values.expense_budget===500000');
			await d.click('#btn-save-annual-budget'); await settleAnnualSettings(d);
			assert.deepEqual(await d.evaluate('(async()=>{const annual=(await window.__yose_app.db.getMasterConfig()).annual_budgets[2026];return {budget:annual.expense_budget,tax:annual.furusato_estimate.resident_tax};})()'), { budget: 500000, tax: 200000 });
			await readyDonation(d); await d.fill('#furusato-resident-tax', '300000');
			assert.equal(await d.evaluate('window.__yose_app.furusatoController.taxDirty'), true);
			await d.click('#btn-save-furusato'); await settleAnnualSettings(d);
			assert.deepEqual(await d.evaluate('(async()=>{const annual=(await window.__yose_app.db.getMasterConfig()).annual_budgets[2026];return {budget:annual.expense_budget,tax:annual.furusato_estimate.resident_tax};})()'), { budget: 500000, tax: 300000 });
		} finally {
			await d.evaluate('window.__annualReadRelease?.()'); if (opening) await opening;
			try { await settleAnnualSettings(d); } finally { await d.evaluate('window.__restoreAnnualRead?.();window.__restoreAnnualSettings()'); }
		}
	});
});

describe('insight rendering and observation concurrency', () => {
	it('does not apply an older metadata read after a newer render or lock', async () => {
		const d = fixture.driver; await settings(d);
		await d.evaluate('const app=window.__yose_app, read=app.db.getDataMetadata.bind(app.db);let once=true;app.db.getDataMetadata=async()=>{const data=await read();if(once){once=false;await new Promise(r=>window.__metadataRelease=r);}return data;};window.__oldMetadata=app.insightsController.renderMetadata();void 0;');
		await d.waitFor('typeof window.__metadataRelease==="function"'); await seed(d, [transaction('new')]);
		await d.evaluate('(async()=>{await window.__yose_app.insightsController.renderMetadata();window.__metadataRelease();await window.__oldMetadata;})()');
		assert.ok((await d.textContent('#data-metadata')).includes('明細 1件'));
	});
	it('selects a single investment account without changing total asset series', async () => {
		const d = fixture.driver;
		await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.accounts.push({id:"stock2",name:"証券2",type:"investment",is_asset:true,initial_balance:0,investment_history:{"2026-10-20":{acquisition_cost:50,market_value:70}}});})');
		await d.click('[data-analytics-target="assets"]');
		await d.waitFor('Boolean(document.querySelector("#asset-investment-account option[value=stock2]"))');
		const total = await d.evaluate('window.__yose_app.chartController.assetHistoryChart.data.datasets[0].data');
		await d.select('#asset-investment-account', 'stock2');
		await d.waitFor('window.__yose_app.chartController.assetHistoryChart.data.datasets.find(x=>x.label==="取得原価（直近記録）").data.at(-1)===50');
		assert.deepEqual(await d.evaluate('window.__yose_app.chartController.assetHistoryChart.data.datasets[0].data'), total);
	});
	it('rejects a stale same-day observation instead of overwriting it', async () => {
		const d = fixture.driver; await d.click('[data-analytics-target="assets"]'); await d.fill('#investment-acquisition-cost', '100'); await d.fill('#investment-valuation', '150');
		await d.evaluate('window.__yose_app.db.saveInvestmentObservation("acc_investment_main","2026-10-20",{acquisition_cost:200,market_value:250},null)');
		await d.click('#btn-save-investment'); await d.waitFor('document.querySelector("#investment-error").textContent.includes("変更")');
		assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).accounts.find(a=>a.id==="acc_investment_main").investment_history["2026-10-20"].market_value)()'), 250);
	});
});
it('clears metadata and discards a read completed after lock', async () => {
	const d = fixture.driver; await settings(d);
	await d.evaluate('const app=window.__yose_app, read=app.db.getDataMetadata.bind(app.db);app.db.getDataMetadata=async()=>{const data=await read();await new Promise(r=>window.__metadataRelease=r);return data;};window.__metadataRead=app.insightsController.renderMetadata();void 0;');
	await d.waitFor('typeof window.__metadataRelease==="function"');
	await d.evaluate('(async()=>{window.__yose_app.authController.invalidateSession();window.__metadataRelease();await window.__metadataRead;})()');
	assert.equal(await d.textContent('#data-metadata'), '');
});
it('does not commit a bulk operation delayed until after lock', async () => {
	const d = fixture.driver; await seed(d, [transaction('a')]); await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit'); await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'stale');
	await d.evaluate('const app=window.__yose_app, save=app.db.bulkEditTransactions.bind(app.db);window.__oldKey=app.db.encryptionKey;app.db.bulkEditTransactions=async(...args)=>{await new Promise(r=>window.__saveRelease=r);return save(...args);};const bulk=app.bulkEditController, submit=bulk.save.bind(bulk);bulk.save=async()=>{try{return await submit();}finally{window.__saveDone=true;}};');
	await d.click('#btn-save-bulk'); await d.waitFor('typeof window.__saveRelease==="function"');
	await d.evaluate('window.__yose_app.authController.invalidateSession();window.__saveRelease();'); await d.waitFor('window.__saveDone===true');
	assert.equal(await d.isVisible('#modal-bulk-edit'), false);
	assert.equal(await d.evaluate('(async()=>{const db=window.__yose_app.db;db.setEncryptionKey(window.__oldKey);const t=await db.getTransaction("a");db.clearEncryptionKey();return t.memo;})()'), 'a');
});
it('keeps a new bulk dialog intact when an old committed save completes after PIN unlock', async () => {
	const d = fixture.driver; await seed(d, [transaction('a')]); await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit'); await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'committed');
	await d.evaluate('const db=window.__yose_app.db, save=db.bulkEditTransactions.bind(db);let once=true;db.bulkEditTransactions=async(...args)=>{const result=await save(...args);if(once){once=false;await new Promise(r=>window.__oldSaveRelease=r);}return result;};const bulk=window.__yose_app.bulkEditController, submit=bulk.save.bind(bulk);bulk.save=async()=>{try{return await submit();}finally{window.__oldControllerSaveDone=true;}};');
	await d.click('#btn-save-bulk'); await d.waitFor('typeof window.__oldSaveRelease==="function"');
	await d.evaluate('window.__yose_app.authController.showLockScreen()'); await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
	await d.waitFor('document.querySelector("#auth-screen").classList.contains("hidden") && !document.querySelector("main").inert');
	await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit'); await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'new draft');
	await d.evaluate('window.__oldSaveRelease();');
	await d.waitFor('window.__oldControllerSaveDone===true');
	assert.equal(await d.evaluate('document.querySelector("#btn-save-bulk").disabled'), false);
	assert.ok((await d.textContent('#bulk-selection-count')).includes('1件'));
	await d.waitFor('(async()=> (await window.__yose_app.db.getTransaction("a")).memo==="committed")()');
	assert.equal(await d.isVisible('#modal-bulk-edit'), true); assert.equal(await d.evaluate('document.querySelector("#bulk-value-memo").value'), 'new draft');
});
it('escapes hostile investment account names in the numeric fallback table', async () => {
	const d = fixture.driver;
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{const a=c.accounts.find(x=>x.id==="acc_investment_main");a.name="<img src=x onerror=window.__investmentXss=1>";a.investment_history={"2026-10-20":{acquisition_cost:100,market_value:150}};})');
	await d.click('[data-analytics-target="assets"]'); await d.evaluate('window.Chart=undefined;window.__yose_app.summaryController.renderAssetHistory()');
	await d.waitFor('document.querySelector("#asset-history-fallback").textContent.includes("150")');
	assert.equal(await d.evaluate('Boolean(window.__investmentXss)||Boolean(document.querySelector("#asset-history-fallback img,#investment-observations img"))'), false);
	assert.ok((await d.textContent('#investment-observations')).includes('<img src=x onerror=window.__investmentXss=1>'));
});
it('applies valuation gains once to net assets and preserves the projected cashflow difference', async () => {
	const d = fixture.driver; await seed(d, [transaction('plannedInvest', { type: 'transfer', account_id: 'acc_bank_main', to_account_id: 'acc_investment_main', category_id: null, actual_category_id: null, amount: 50000, status: 'planned' })]);
	await d.click('[data-analytics-target="assets"]'); await d.waitFor('Boolean(window.__yose_app.chartController.assetHistoryChart)');
	const before = await d.evaluate('Number(document.querySelector("#stat-total-assets").textContent.replace(/[^0-9-]/g,""))');
	await d.fill('#investment-acquisition-cost', '1000000'); await d.fill('#investment-valuation', '1300000'); await d.click('#btn-save-investment');
	await d.waitFor('document.querySelector("#stat-external-assets").textContent.includes("1,300,000")');
	const after = await d.evaluate('Number(document.querySelector("#stat-total-assets").textContent.replace(/[^0-9-]/g,""))');
	assert.equal(after - before, 75000);
	const account = await d.textContent('#account-balances-list [data-filter-account="acc_investment_main"]');
	assert.ok(account.includes('1,300,000')); assert.ok(account.includes('月末予測: ¥1,350,000'));
});
it('invalidates a pending bulk open when the selection is cleared before it completes', async () => {
	const d = fixture.driver; await seed(d, [transaction('a')]); await cashflow(d); await d.click('#btn-bulk-select-page');
	await d.evaluate('const app=window.__yose_app, read=app.db.getMasterConfig.bind(app.db);app.db.getMasterConfig=async()=>{const config=await read();await new Promise(r=>window.__openRelease=r);return config;};const bulk=app.bulkEditController, open=bulk.open.bind(bulk);window.__pendingBulk=open().finally(()=>{window.__openFinished=true});void 0;');
	await d.waitFor('typeof window.__openRelease==="function"'); await d.click('#btn-bulk-clear'); await d.evaluate('window.__openRelease()'); await d.waitFor('window.__openFinished');
	assert.equal(await d.isVisible('#modal-bulk-edit'), false); assert.ok((await d.textContent('#bulk-selection-count')).includes('0件'));
});
it('freezes bulk controls while saving and restores applicable controls after failure', async () => {
	const d = fixture.driver; await seed(d, [transaction('a')]); await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit'); await d.click('#bulk-apply-memo'); await d.fill('#bulk-value-memo', 'submitted');
	await d.evaluate('window.__yose_app.db.bulkEditTransactions=async()=>{await new Promise(r=>window.__batchRelease=r);throw new Error("save failure");}');
	await d.click('#btn-save-bulk'); await d.waitFor('typeof window.__batchRelease==="function"');
	assert.equal(await d.evaluate('[...document.querySelectorAll("#bulk-edit-fields input,#bulk-edit-fields select,#btn-close-bulk")].every(el=>el.disabled)'), true);
	await d.evaluate('window.__batchRelease()'); await d.waitFor('document.querySelector("#bulk-edit-error").textContent.includes("save failure")');
	assert.equal(await d.evaluate('document.querySelector("#bulk-value-memo").disabled'), false); assert.equal(await d.evaluate('document.querySelector("#bulk-value-amount").disabled'), true);
});
for (const kind of ['tax', 'investment']) it(`freezes ${kind} form fields during a save and restores them after failure`, async () => {
	const d = fixture.driver;
	if (kind === 'tax') { await seed(d, [transaction('gift', { tags: ['ふるさと納税'] })]); await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]'); await d.fill('#furusato-resident-tax', '200000'); await d.select('#furusato-tax-rate', '20'); }
	else { await d.click('[data-analytics-target="assets"]'); await d.fill('#investment-acquisition-cost', '100'); await d.fill('#investment-valuation', '150'); }
	const method = kind === 'tax' ? 'saveMasterConfig' : 'saveInvestmentObservation';
	await d.evaluate(`window.__yose_app.db.${method}=async()=>{await new Promise(r=>window.__insightRelease=r);throw new Error('save failure');}`);
	await d.click(kind === 'tax' ? '#btn-save-furusato' : '#btn-save-investment'); await d.waitFor('typeof window.__insightRelease==="function"');
	const selector = kind === 'tax' ? '#furusato-resident-tax,#furusato-tax-rate' : '#investment-account,#investment-date,#investment-acquisition-cost,#investment-valuation';
	assert.equal(await d.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].every(el=>el.disabled)`), true);
	await d.evaluate('window.__insightRelease()'); await d.waitFor(`document.querySelector('${kind === 'tax' ? '#furusato-error' : '#investment-error'}').textContent.includes('save failure')`);
	assert.equal(await d.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].every(el=>!el.disabled)`), true);
});

describe('bulk financial fields and failed reads', () => {
	it('toggles individual selection, handles an empty patch, and edits amount/month/children without overwriting unrelated fields', async () => {
		const d = fixture.driver; await seed(d, [transaction('a'), transaction('b')]); await cashflow(d);
		await d.click('#month-tx-list [data-bulk-id="a"]'); await d.click('#month-tx-list [data-bulk-id="a"]'); assert.ok((await d.textContent('#bulk-selection-count')).includes('0件'));
		await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit'); await d.click('#btn-save-bulk');
		await d.waitFor('document.querySelector("#bulk-edit-error").textContent.includes("項目")');
		await d.click('#bulk-apply-amount'); await d.fill('#bulk-value-amount', ''); await d.click('#btn-save-bulk');
		await d.waitFor('document.querySelector("#bulk-edit-error").textContent.includes("金額")');
		await d.fill('#bulk-value-amount', '123'); await d.click('#bulk-apply-target_month'); await d.fill('#bulk-value-target_month', '2026-11');
		await d.click('#bulk-apply-category_id'); await d.select('#bulk-value-category_id', 'cat_housing');
		await d.click('#bulk-apply-subcategory_id'); await d.select('#bulk-value-subcategory_id', 'sub_rent');
		await d.click('#bulk-apply-actual_subcategory_id'); await d.select('#bulk-value-actual_subcategory_id', 'sub_groceries');
		await d.click('#btn-save-bulk'); await d.waitFor('(async()=> (await window.__yose_app.db.getTransactions()).every(t=>t.amount===123 && t.target_month==="2026-11"))()');
		const rows = await d.evaluate('window.__yose_app.db.getTransactions()');
		assert.ok(rows.every(t => t.category_id === 'cat_housing' && t.subcategory_id === 'sub_rent' && t.actual_category_id === 'cat_food' && t.actual_subcategory_id === 'sub_groceries' && t.previous_target_month === '2026-10'));
	});
	it('reports a deleted selection after its read completes and allows opening a fresh selection', async () => {
		const d = fixture.driver; await seed(d, [transaction('a')]); await cashflow(d); await d.click('#btn-bulk-select-page');
		await d.evaluate('(async()=>{await window.__yose_app.db.deleteTransaction("a");})()');
		await d.click('#btn-bulk-edit'); await d.waitFor('window.__dialogs.some(x=>x.message.includes("選択した明細"))');
		assert.equal(await d.isVisible('#modal-bulk-edit'), false);
		await seed(d, [transaction('fresh')]); await cashflow(d); await d.click('#btn-bulk-select-page'); await d.click('#btn-bulk-edit');
		assert.equal(await d.isVisible('#modal-bulk-edit'), true); assert.ok((await d.textContent('#bulk-edit-scope')).includes('1件'));
	});
});

describe('donation and investment error and draft operations', () => {
	it('validates missing tax inputs, retains dirty values through redraw, and displays an excess rather than negative remaining', async () => {
		const d = fixture.driver; await seed(d, [transaction('gift', { tags: ['ふるさと納税'], amount: 100000 })]); await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]');
		await d.click('#btn-save-furusato'); await d.waitFor('document.querySelector("#furusato-error").textContent.includes("入力")');
		await d.fill('#furusato-resident-tax', '200000'); await d.select('#furusato-tax-rate', '20');
		await d.evaluate('window.__yose_app.summaryController.renderSummary()');
		assert.equal(await d.evaluate('document.querySelector("#furusato-resident-tax").value'), '200000');
		await d.click('#btn-save-furusato'); await d.waitFor('document.querySelector("#furusato-summary").textContent.includes("超過額 ¥40,513")');
	});
	it('reports an unsupported donation tax year and preserves its input', async () => {
		const d = fixture.driver; await seed(d, [transaction('oldGift', { date: '2014-01-01', target_month: '2014-01', tags: ['ふるさと納税'] })]);
		await d.evaluate('window.__yose_app.selectedYear="2014"'); await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]');
		await d.waitFor('window.__yose_app.furusatoController.taxDraft?.year==="2014"');
		await d.fill('#furusato-resident-tax', '200000'); await d.select('#furusato-tax-rate', '20'); await d.click('#btn-save-furusato');
		await d.waitFor('document.querySelector("#furusato-error").textContent.includes("2015")');
		assert.equal(await d.evaluate('document.querySelector("#furusato-resident-tax").value'), '200000');
	});
	it('shows a metadata read failure without a page error and can recover', async () => {
		const d = fixture.driver; await settings(d);
		await d.evaluate('const app=window.__yose_app, read=app.db.getDataMetadata.bind(app.db);app.db.getDataMetadata=async()=>{throw new Error("read failure")};window.__restoreMetadata=()=>{app.db.getDataMetadata=read;};');
		await d.evaluate('window.__yose_app.insightsController.renderMetadata()'); assert.ok((await d.textContent('#data-metadata')).includes('read failure'));
		await d.evaluate('window.__restoreMetadata();window.__yose_app.insightsController.renderMetadata()'); await d.waitFor('document.querySelector("#data-metadata").textContent.includes("明細 0件")');
	});
	it('validates blank investment fields, preserves a dirty draft through refresh and cancels deletion', async () => {
		const d = fixture.driver; await d.click('[data-analytics-target="assets"]'); await d.click('#btn-save-investment');
		await d.waitFor('document.querySelector("#investment-error").textContent.includes("入力")');
		await d.fill('#investment-acquisition-cost', '100'); await d.fill('#investment-valuation', '150'); await d.evaluate('window.__yose_app.summaryController.renderSummary()');
		assert.equal(await d.evaluate('document.querySelector("#investment-valuation").value'), '150');
		await d.click('#btn-save-investment'); await d.waitFor('document.querySelector("#investment-observations [data-delete-observation]") && !document.querySelector("#investment-observations [data-delete-observation]").disabled');
		await d.evaluate('window.confirm=()=>false'); await d.click('#investment-observations [data-delete-observation]');
		assert.ok((await d.textContent('#investment-observations')).includes('150'));
	});
	it('retains acquired observation history while all investment accounts are archived', async () => {
		const d = fixture.driver; await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{for(const a of c.accounts.filter(a=>a.type==="investment")){a.is_archived=true;a.investment_history={"2026-10-20":{acquisition_cost:100,market_value:150}};}})');
		await d.click('[data-analytics-target="assets"]'); await d.waitFor('document.querySelector("#investment-observations").textContent.includes("アーカイブ済み")');
		assert.equal(await d.evaluate('document.querySelector("#btn-save-investment").disabled'), true);
		assert.equal(await d.evaluate('Boolean(document.querySelector("#investment-observations [data-delete-observation]"))'), false);
	});
});
it('edits a past observation by date without changing a later observation or the current valuation', async () => {
	const d = fixture.driver; await d.click('[data-analytics-target="assets"]');
	await d.fill('#investment-date', '2026-10-19'); await d.fill('#investment-acquisition-cost', '100'); await d.fill('#investment-valuation', '150'); await d.click('#btn-save-investment');
	await d.waitFor('document.querySelector("#investment-observations").textContent.includes("2026-10-19") && !document.querySelector("#btn-save-investment").disabled');
	await d.fill('#investment-date', '2026-10-20'); assert.equal(await d.evaluate('document.querySelector("#investment-valuation").value'), '');
	await d.fill('#investment-acquisition-cost', '120'); await d.fill('#investment-valuation', '180'); await d.click('#btn-save-investment');
	await d.waitFor('document.querySelector("#stat-external-assets").textContent.includes("180") && !document.querySelector("#btn-save-investment").disabled');
	await d.fill('#investment-date', '2026-10-19'); assert.equal(await d.evaluate('document.querySelector("#investment-valuation").value'), '150');
	await d.fill('#investment-valuation', '160'); await d.click('#btn-save-investment'); await d.waitFor('!document.querySelector("#btn-save-investment").disabled');
	assert.equal(await d.textContent('#stat-external-assets'), '¥180');
	const chart = await d.evaluate('window.__yose_app.chartController.assetHistoryChart.data');
	assert.equal(chart.datasets.find(x=>x.label==='口座評価額（預り金込・参考）').data[chart.labels.indexOf('2026-10-19')], 160);
	assert.equal(chart.datasets.find(x=>x.label==='口座評価額（預り金込・参考）').data.at(-1), 180);
});

it('collects explicitly selected gross salary and tax expenses while preserving notice inputs', async () => {
	const d = fixture.driver;
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.categories.push({id:"salary",name:"税引前給与",type:"income",subcategories:[]},{id:"tax",name:"税・保険",type:"expense",subcategories:[{id:"resident",name:"住民税"},{id:"social",name:"社会保険料"}]});})');
	await seed(d, [transaction('donation', { tags: ['ふるさと納税'] }), transaction('gross', { type: 'income', category_id: 'salary', actual_category_id: 'salary', date: '2025-12-31', amount: 6000000 }), transaction('resident', { category_id: 'tax', subcategory_id: 'resident', actual_category_id: 'tax', date: '2025-12-31', amount: 200000 }), transaction('insurance', { category_id: 'tax', subcategory_id: 'social', actual_category_id: 'tax', date: '2025-12-31', amount: 800000 })]);
	await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]'); await d.waitFor('document.querySelector("#furusato-source-salary option")');
	await d.evaluate('for(const [field,category,sub] of [["salary","salary",null],["resident_tax","tax","resident"],["social_insurance","tax","social"]]){const s=document.getElementById("furusato-source-"+field);for(const o of s.options){const v=JSON.parse(o.value);o.selected=v.category_id===category&&v.subcategory_id===sub;}s.dispatchEvent(new Event("change",{bubbles:true}));}');
	await d.fill('#furusato-resident-tax', '190000'); await d.select('#furusato-tax-rate', '20');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('(async()=> Boolean((await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_sources))()');
	await d.waitFor('!document.querySelector("#btn-save-furusato").disabled');
	assert.equal(await d.evaluate('document.querySelector("#furusato-resident-tax").value'), '190000');
	const text = await d.textContent('#furusato-ledger-summary'); for (const amount of ['6,000,000', '200,000', '800,000']) assert.ok(text.includes(amount));
	assert.ok((await d.textContent('#furusato-summary')).includes('概算上限 未算出'));
	await d.click('#btn-save-furusato'); await d.waitFor('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_estimate?.resident_tax===190000)()');
	assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_sources.salary[0].category_id)()'), 'salary');
});
it('shows legacy contributions as an unknown holding cost until explicitly corrected', async () => {
	const d = fixture.driver;
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.accounts.find(a=>a.id==="acc_investment_main").investment_history={"2026-10-20":{invested_amount:500,market_value:1000}};})');
	await d.click('[data-analytics-target="assets"]'); await d.waitFor('document.querySelector("#investment-observations").textContent.includes("旧形式")');
	assert.equal(await d.evaluate('document.querySelector("#investment-acquisition-cost").value'), '');
	assert.equal(await d.evaluate('window.__yose_app.chartController.assetHistoryChart.data.datasets.find(x=>x.label==="取得原価（直近記録）").data.at(-1)'), null);
	await d.fill('#investment-acquisition-cost', '600'); await d.click('#btn-save-investment');
	await d.waitFor('window.__yose_app.chartController.assetHistoryChart.data.datasets.find(x=>x.label==="取得原価（直近記録）").data.at(-1)===600');
});

it('keeps payroll source drafts during refresh, freezes them while saving and restores selections on failure', async () => {
	const d = fixture.driver; await seed(d, [transaction('gift', { tags: ['ふるさと納税'] })]); await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]');
	await d.evaluate('{const s=document.querySelector("#furusato-source-salary");s.options[0].selected=true;s.dispatchEvent(new Event("change",{bubbles:true}));}');
	const selected = await d.evaluate('[...document.querySelector("#furusato-source-salary").selectedOptions].map(o=>o.value)');
	await d.evaluate('window.__yose_app.summaryController.renderSummary()');
	assert.deepEqual(await d.evaluate('[...document.querySelector("#furusato-source-salary").selectedOptions].map(o=>o.value)'), selected);
	await d.evaluate('window.__yose_app.db.saveMasterConfig=async()=>{await new Promise(r=>window.__sourceRelease=r);throw new Error("source failure")};');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('typeof window.__sourceRelease==="function"');
	assert.equal(await d.evaluate('[...document.querySelectorAll("#tab-tax input,#tab-tax select,#tab-tax button")].every(e=>e.disabled)'), true);
	await d.evaluate('window.__sourceRelease()'); await d.waitFor('document.querySelector("#furusato-error").textContent.includes("source failure")');
	assert.equal(await d.evaluate('[...document.querySelectorAll("#tab-tax input,#tab-tax select,#tab-tax button")].every(e=>!e.disabled)'), true);
	assert.deepEqual(await d.evaluate('[...document.querySelector("#furusato-source-salary").selectedOptions].map(o=>o.value)'), selected);
});
it('does not clear another year payroll draft when an earlier year save finishes', async () => {
	const d = fixture.driver; await seed(d, [transaction('gift', { tags: ['ふるさと納税'] }), transaction('nextGift', { date: '2027-01-01', target_month: '2027-01', tags: ['ふるさと納税'] })]); await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]');
	await d.evaluate('const app=window.__yose_app,save=app.db.saveMasterConfig.bind(app.db);app.db.saveMasterConfig=async(...args)=>{await new Promise(r=>window.__yearRelease=r);return save(...args);};');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('typeof window.__yearRelease==="function"');
	await d.evaluate('window.__yose_app.selectedYear="2027";window.__yose_app.summaryController.renderSummary()'); await d.waitFor('window.__yose_app.furusatoController.sourceDraft?.year==="2027"');
	await d.evaluate('window.__yearRelease()'); await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	assert.equal(await d.evaluate('window.__yose_app.furusatoController.sourceDraft.year'), '2027');
	assert.equal(await d.evaluate('document.querySelector("#furusato-resident-tax").value'), '');
	assert.equal(await d.evaluate('(async()=> Boolean((await window.__yose_app.db.getMasterConfig()).annual_budgets[2027]?.furusato_sources))()'), false);
});
it('saves payroll sources with blank notice inputs and preserves an unsaved source when saving notice only', async () => {
	const d = fixture.driver; await seed(d, [transaction('gift', { tags: ['ふるさと納税'] })]); await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]');
	await d.evaluate('{const s=document.querySelector("#furusato-source-salary");s.options[0].selected=true;s.dispatchEvent(new Event("change",{bubbles:true}));}');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('(async()=> Boolean((await window.__yose_app.db.getMasterConfig()).annual_budgets[2026]?.furusato_sources))()');
	await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	const saved = await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_sources)()');
	assert.equal(await d.evaluate('document.querySelector("#furusato-resident-tax").value'), ''); assert.ok((await d.textContent('#furusato-summary')).includes('概算上限 未算出'));
	await d.evaluate('{const s=document.querySelector("#furusato-source-salary");for(const o of s.options)o.selected=false;s.options[1].selected=true;s.dispatchEvent(new Event("change",{bubbles:true}));}');
	const draft = await d.evaluate('[...document.querySelector("#furusato-source-salary").selectedOptions].map(o=>o.value)');
	await d.fill('#furusato-resident-tax', '200000'); await d.select('#furusato-tax-rate', '20'); await d.click('#btn-save-furusato'); await d.waitFor('document.querySelector("#furusato-summary").textContent.includes("59,487")');
	assert.deepEqual(await d.evaluate('[...document.querySelector("#furusato-source-salary").selectedOptions].map(o=>o.value)'), draft);
	assert.deepEqual(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_sources)()'), saved);
});
it('discards a payroll save held in encryption after lock and leaves a newly unlocked draft intact', async () => {
	const d = fixture.driver; await seed(d, [transaction('gift', { tags: ['ふるさと納税'] })]); await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]');
	await d.evaluate('const app=window.__yose_app,db=app.db,encrypt=db.encryptRecord.bind(db);window.__sourceRawBefore=db.captureImportState();let once=true;db.encryptRecord=async(...args)=>{if(once){once=false;await new Promise(r=>window.__encryptRelease=r);}return encrypt(...args);};const c=app.furusatoController,save=c.saveFurusatoSources.bind(c);c.saveFurusatoSources=async()=>{try{return await save();}finally{window.__sourceOldDone=true;}};');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('typeof window.__encryptRelease==="function"');
	await d.evaluate('window.__yose_app.authController.showLockScreen()');
	assert.equal(await d.evaluate('document.querySelector("#furusato-source-salary").selectedOptions.length'), 0);
	assert.equal(await d.evaluate('(async()=> JSON.stringify(await window.__yose_app.db.captureImportState())===JSON.stringify(await window.__sourceRawBefore))()'), true);
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.waitFor('document.querySelector("#auth-screen").classList.contains("hidden") && !document.querySelector("main").inert');
	await d.click('[data-analytics-target="budget"]'); await d.click('[data-tab="tab-tax"]'); await d.waitFor('window.__yose_app.furusatoController.sourceDraft?.year==="2026"');
	await d.evaluate('{const s=document.querySelector("#furusato-source-salary");s.options[0].selected=true;s.dispatchEvent(new Event("change",{bubbles:true}));}');
	const draft = await d.evaluate('[...document.querySelector("#furusato-source-salary").selectedOptions].map(o=>o.value)');
	await d.evaluate('window.__encryptRelease()'); await d.waitFor('window.__sourceOldDone===true');
	assert.deepEqual(await d.evaluate('[...document.querySelector("#furusato-source-salary").selectedOptions].map(o=>o.value)'), draft);
	assert.equal(await d.evaluate('document.querySelector("#btn-save-furusato-sources").disabled'), false);
	assert.equal(await d.evaluate('(async()=> Boolean((await window.__yose_app.db.getMasterConfig()).annual_budgets[2026]?.furusato_sources))()'), false);
});

it('holds acquisition costs until the next observation using a stepped yearly chart', async () => {
	const d = fixture.driver;
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{c.accounts.find(a=>a.id==="acc_investment_main").investment_history={"2026-01-10":{acquisition_cost:100,market_value:150},"2026-06-15":{acquisition_cost:120,market_value:180}};})');
	await d.click('[data-analytics-target="assets"]'); await d.select('#select-asset-period', 'year');
	await d.waitFor('window.__yose_app.chartController.assetHistoryChart.data.labels.includes("2026-06-15")');
	const data = await d.evaluate('window.__yose_app.chartController.assetHistoryChart.data');
	const cost = data.datasets.find(series => series.label === '取得原価（直近記録）');
	assert.equal(cost.stepped, 'before');
	assert.equal(cost.data[data.labels.indexOf('2026-01-10')], 100);
	assert.equal(cost.data[data.labels.indexOf('2026-05-31')], 100);
	assert.equal(cost.data[data.labels.indexOf('2026-06-15')], 120);
});
