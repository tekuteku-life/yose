import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records } from '../helpers/ui_fixture.js';
import { observeWorkflow, flushWorkflow, cleanupWorkflow, rawWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser();
const selected = { account: 'draft-pay', to: 'draft-to', point: 'draft-point', category: 'draft-category', child: 'draft-child', actual: 'draft-actual', actualChild: 'draft-actual-child' };
const controls = { account: 'select-account', to: 'select-to-account', point: 'select-point-account', category: 'select-category', child: 'select-subcategory', actual: 'select-actual-category', actualChild: 'select-actual-subcategory' };
const formDraft = d => d.evaluate('({fields:[...document.querySelectorAll("#tx-form input,#tx-form select,#tx-form textarea")].map(el=>[el.id,el.value,el instanceof HTMLInputElement&&["checkbox","radio"].includes(el.type)?el.checked:null]),tags:[...window.__yose_app.txInputController.confirmedTags],tax:window.__yose_app.currentTaxMeta})');

async function prepare(d, mode) {
	// The untouched original has no pending upload; recovery must preserve its ciphertext too.
	await seed(d, [transaction('master-draft-original', { sync_status: 'synced' })]);
	await d.evaluate(`(async()=>{
		const app=window.__yose_app;await app.db.mutateMasterConfig(config=>{
			config.accounts.push(...[{id:'draft-pay',type:'cash'},{id:'draft-to',type:'bank'},{id:'draft-point',type:'point'}].map(account=>({...account,name:account.id+'<img src=x onerror=window.__choiceXss=1>',initial_balance:0,is_asset:true,is_archived:false})));
			config.categories.push(...[{id:'draft-category',child:'draft-child'},{id:'draft-actual',child:'draft-actual-child'}].map(item=>({id:item.id,name:item.id+'<img src=x onerror=window.__choiceXss=1>',type:'expense',is_archived:false,subcategories:[{id:item.child,name:item.child+'<img src=x onerror=window.__choiceXss=1>'},{id:item.child+'-other',name:'other child'}]})));
		});
		const config=await app.db.getMasterConfig(),{sharedMasterConfig}=await import('./js/logic/master_sync.js');await app.db.commitMasterSync(config,sharedMasterConfig(config));await app.txInputController.populateMasterDropdowns();
	})()`);
	if (mode === 'point') await d.click('.mode-tab-btn[data-mode="point"]');
	if (mode === 'transfer') await d.select('#input-type', 'transfer');
	await flushWorkflow(d);
	await d.select('#select-account', selected.account); await d.select('#select-to-account', selected.to); await d.select('#select-point-account', selected.point);
	if (mode !== 'transfer') {
		await d.select('#select-category', selected.category); await flushWorkflow(d); await d.select('#select-subcategory', selected.child);
		await d.click('#chk-sync-actual-category'); await d.select('#select-actual-category', selected.actual); await flushWorkflow(d); await d.select('#select-actual-subcategory', selected.actualChild);
	}
	if (mode === 'point') { await d.fill('#input-point-total', '1234'); await d.fill('#input-point-used', '234'); }
	else await d.fill('#input-amount', '1234');
	await d.fill('#input-memo', 'MASTER_RECEIVE_DRAFT');
	await d.evaluate('window.__yose_app.txInputController.confirmedTags=["DRAFT_TAG"];window.__yose_app.txInputController.renderTagChips()');
}

async function receiveMaster(d, defect, scope) {
	await d.evaluate(`(async()=>{
		const app=window.__yose_app,manager=app.syncManager,{sharedMasterConfig}=await import('./js/logic/master_sync.js'),{verifySignedRequest}=await import('./js/crypto.js');
		let remote=sharedMasterConfig(await app.db.getMasterConfig());
		for(const id of ['draft-category','draft-actual']){
			const category=remote.categories.find(item=>item.id===id);
			if(${JSON.stringify(scope)}==='children'){
				if(${JSON.stringify(defect)}==='archive')category.subcategories[0].is_archived=true;else category.subcategories.shift();
				category.subcategories.push({id:id+'-incoming-child',name:'incoming child'});
			}else if(${JSON.stringify(defect)}==='archive')category.is_archived=true;
		}
		if(${JSON.stringify(scope)}==='parents'){
			if(${JSON.stringify(defect)}==='delete'){remote.accounts=remote.accounts.filter(item=>!['draft-pay','draft-to','draft-point'].includes(item.id));remote.categories=remote.categories.filter(item=>!['draft-category','draft-actual'].includes(item.id));}
			else for(const account of remote.accounts.filter(item=>['draft-pay','draft-to','draft-point'].includes(item.id)))account.is_archived=true;
		}
		remote.accounts.push(...[{id:'incoming-pay',type:'cash'},{id:'incoming-to',type:'bank'},{id:'incoming-point',type:'point'}].map(account=>({...account,name:account.id,initial_balance:0,is_asset:true})));
		remote.categories.push({id:'incoming-category',type:'expense',name:'incoming category',subcategories:[{id:'incoming-child',name:'incoming child'}]});
		remote.categories.push({id:'incoming-income',type:'income',name:'incoming income',subcategories:[{id:'incoming-income-child',name:'incoming income child'}]});
		if(${JSON.stringify(scope)}==='no-expense'){
			const archived=new Set();for(const category of remote.categories)if((category.type||'expense')==='expense'){category.is_archived=true;archived.add(category.id);}
			for(const rule of remote.recurring_rules||[])if(archived.has(rule.category_id)||archived.has(rule.actual_category_id))rule.is_active=false;
		}
		const refresh=app.refreshAllViews;window.__masterDraftRefresh=[];window.__masterDraftRequests=[];
		app.refreshAllViews=function(...args){const promise=refresh.apply(this,args);window.__masterDraftRefresh.push(promise);return promise;};
		const fetch=manager.fetch,url=manager.gasUrl;manager.gasUrl='https://master-draft.fixture/exec';
		manager.fetch=async(_url,options)=>{const request=JSON.parse(options.body);if(!(await verifySignedRequest(request,app.publicKey)).valid)throw new Error('invalid real signature');window.__masterDraftRequests.push(request.action);if(request.action==='update_master')remote=structuredClone(request.payload.master_config);return {ok:true,text:async()=>JSON.stringify({success:true,master_config:remote,...(request.action==='push_diff'?{accepted_ids:request.payload.transactions.map(tx=>tx.id)}:{})})};};
		window.__restoreMasterDraft=()=>{app.refreshAllViews=refresh;manager.fetch=fetch;manager.gasUrl=url;};
		window.__masterDraftResult=await manager.syncMaster();
	})()`);
	assert.equal(await d.evaluate('window.__masterDraftResult.status'), 'synced');
	assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).accounts.some(account=>account.id==="incoming-pay"))()'), true, 'the actual incoming master must commit');
	if (scope === 'no-expense') assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).categories.filter(category=>(category.type||"expense")==="expense"&&!category.is_archived).length)()'), 0);
	await d.waitFor('window.__masterDraftRefresh.length>0');
	assert.ok(await d.evaluate('Promise.all(window.__masterDraftRefresh).then(results=>results.length)') > 0, 'the real listener refresh must finish');
	await flushWorkflow(d);
	assert.ok((await d.evaluate('window.__masterDraftRequests')).includes('fetch_master'));
	assert.equal(await d.evaluate('window.__choiceXss||0'), 0);
}

async function recover(d, mode) {
	await d.select('#select-account', 'incoming-pay'); await d.select('#select-to-account', 'incoming-to'); await d.select('#select-point-account', 'incoming-point');
	if (mode !== 'transfer') {
		for (const [parent, child] of [['#select-category', '#select-subcategory'], ['#select-actual-category', '#select-actual-subcategory']]) {
			await d.select(parent, 'incoming-category'); await flushWorkflow(d);
			assert.equal(await d.evaluate(`document.querySelector(${JSON.stringify(child)}).value`), 'incoming-child');
			assert.deepEqual(await d.evaluate(`[...document.querySelector(${JSON.stringify(child)}).options].map(option=>option.value).filter(Boolean)`), ['incoming-child']);
			await d.select(child, 'incoming-child');
		}
	}
	await d.click('#btn-save-tx'); await flushWorkflow(d);
	await d.evaluate('window.__yose_app._transactionMaintenanceTask?.promise');
	const saved = (await records(d)).filter(tx => tx.id !== 'master-draft-original');
	assert.equal(saved.length, mode === 'point' ? 2 : 1);
	assert.ok(saved.every(tx => tx.memo.includes('MASTER_RECEIVE_DRAFT') && tx.tags.includes('DRAFT_TAG')));
	if (mode === 'transfer') assert.deepEqual(saved.map(tx => [tx.type, tx.amount, tx.account_id, tx.to_account_id]), [['transfer', 1234, 'incoming-pay', 'incoming-to']]);
	else {
		assert.ok(saved.every(tx => tx.category_id === 'incoming-category' && tx.subcategory_id === 'incoming-child' && tx.actual_category_id === 'incoming-category' && tx.actual_subcategory_id === 'incoming-child'));
		assert.deepEqual(saved.map(tx => [tx.account_id, tx.amount]).sort(), mode === 'point' ? [['incoming-pay', 1000], ['incoming-point', 234]] : [['incoming-pay', 1234]]);
	}
}

it('preserves an eligible draft through the real master listener and permits explicit selection of newly received choices', async () => {
	const d = fixture.driver; await observeWorkflow(d);
	try {
		await prepare(d, 'normal'); const expected = await formDraft(d);
		await receiveMaster(d, 'add', 'new-only'); assert.deepEqual(await formDraft(d), expected);
		await recover(d, 'normal');
	} finally {
		await d.evaluate('window.__yose_app._transactionMaintenanceTask?.promise');
		await d.evaluate('window.__restoreMasterDraft?.()'); await cleanupWorkflow(d);
	}
});

it('retains both classification drafts when no expense choices remain and resets them when the user explicitly changes the transaction type', async () => {
	const d = fixture.driver; await observeWorkflow(d);
	try {
		await prepare(d, 'normal'); const expected = await formDraft(d);
		await receiveMaster(d, 'archive', 'no-expense'); assert.deepEqual(await formDraft(d), expected);
		assert.equal(await d.evaluate('[...document.querySelector("#select-category").options].find(option=>option.selected)?.disabled'), true);
		await d.select('#input-type', 'income'); await flushWorkflow(d);
		assert.equal(await d.evaluate('document.querySelector("#select-category").value'), 'cat_income_main');
		assert.equal(await d.evaluate('document.querySelector("#select-actual-category").value'), 'cat_income_main');
		for (const [parent, child] of [['#select-category', '#select-subcategory'], ['#select-actual-category', '#select-actual-subcategory']]) {
			await d.select(parent, 'incoming-income'); await flushWorkflow(d); await d.select(child, 'incoming-income-child');
		}
		await d.click('#btn-save-tx'); await flushWorkflow(d); await d.evaluate('window.__yose_app._transactionMaintenanceTask?.promise');
		const saved = (await records(d)).filter(tx => tx.id !== 'master-draft-original');
		assert.deepEqual(saved.map(tx=>[tx.type,tx.amount,tx.category_id,tx.subcategory_id,tx.actual_category_id,tx.actual_subcategory_id]), [['income',1234,'incoming-income','incoming-income-child','incoming-income','incoming-income-child']]);
	} finally {
		await d.evaluate('window.__yose_app._transactionMaintenanceTask?.promise');
		await d.evaluate('window.__restoreMasterDraft?.()'); await cleanupWorkflow(d);
	}
});

for (const [mode, scope] of [['normal', 'parents'], ['transfer', 'parents'], ['point', 'parents'], ['normal', 'children']]) for (const defect of ['archive', 'delete']) it(`retains the complete ${mode} draft when signed background master receive ${defect}s selected ${scope}, rejects save and recovers after explicit reselection`, async () => {
	const d = fixture.driver; await observeWorkflow(d);
	try {
		await prepare(d, mode); const expected = await formDraft(d), original = await d.evaluate('window.__yose_app.db.getRaw("transactions","master-draft-original")');
		await receiveMaster(d, defect, scope);
		assert.deepEqual(await formDraft(d), expected);
		const protectedFields = scope === 'children' ? ['child', 'actualChild'] : ['account', 'to', 'point', ...(mode === 'transfer' ? [] : ['category', 'actual'])];
		for (const field of protectedFields) {
			const option = await d.evaluate(`(()=>{const select=document.getElementById(${JSON.stringify(controls[field])}),option=[...select.options].find(item=>item.value===${JSON.stringify(selected[field])});return option&&{selected:option.selected,disabled:option.disabled,text:option.textContent};})()`);
			assert.equal(option?.selected, true, field); assert.equal(option.disabled, true, field); assert.match(option.text, /利用不可|無効|アーカイブ|削除/);
		}
		assert.equal(await d.evaluate('[...document.querySelector("#select-account").options].some(option=>option.value==="incoming-pay"&&!option.disabled)'), true);
		assert.equal(await d.evaluate('[...document.querySelector("#select-category").options].some(option=>option.value==="incoming-category"&&!option.disabled)'), true);
		if (scope === 'children') assert.equal(await d.evaluate('[...document.querySelector("#select-subcategory").options].some(option=>option.value==="draft-category-incoming-child"&&!option.disabled)'), true);
		const raw = await rawWorkflow(d), dialogs = await d.evaluate('window.__dialogs.length');
		await d.click('#btn-save-tx'); await flushWorkflow(d);
		assert.deepEqual(await rawWorkflow(d), raw); assert.deepEqual(await formDraft(d), expected);
		assert.ok((await d.evaluate(`window.__dialogs.slice(${dialogs})`)).some(dialog=>/参照|アーカイブ|存在|選択|保存|登録|無効/.test(dialog.message)));
		assert.equal(await d.evaluate('window.__yose_app.txInputController.submitBusy'), false);
		await recover(d, mode); assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","master-draft-original")'), original);
	} finally {
		await d.evaluate('window.__yose_app._transactionMaintenanceTask?.promise');
		await d.evaluate('window.__restoreMasterDraft?.()'); await cleanupWorkflow(d);
	}
});
