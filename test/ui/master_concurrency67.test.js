import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
import { rawWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67, observeExpectedDialog67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();

const openers = {
	'new account': ['accounts', '#btn-add-account'],
	'new category': ['categories', '#btn-add-category'],
	'new recurring rule': ['recurring', '#btn-add-recurring'],
	'account edit': ['accounts', '.btn-edit-account[data-id="acc_wallet"]'],
	'category edit': ['categories', '.btn-edit-cat[data-id="cat_food"]'],
	'subcategory add': ['categories', '.btn-add-subcat[data-id="cat_food"]'],
	'subcategory edit': ['categories', '.btn-edit-subcat[data-cat-id="cat_food"][data-sub-id="sub_groceries"]'],
	'recurring edit': ['recurring', '.btn-edit-recurring[data-id="rec_rent"]']
};
for (const [label, [tab, selector]] of Object.entries(openers)) uiCase67(fixture, `reports an actual authenticated master decryption failure from ${label} without opening or writing a modal`, async d => {
	await settings67(d, tab);
	// Damage a persisted ciphertext byte rather than returning an invented DB error.
	await d.evaluate(`(async()=>{const db=window.__yose_app.db,raw=await db.getRaw('master_config','current');window.__originalMaster67=raw;const changed=structuredClone(raw);changed.ciphertext=(changed.ciphertext[0]==='A'?'B':'A')+changed.ciphertext.slice(1);await db.putRaw('master_config',changed,'current');})()`);
	const raw = await rawWorkflow(d), generation = await d.evaluate('window.__yose_app.authController.authGeneration');
	try {
		await observeExpectedDialog67(d, () => d.click(selector), /設定を開けませんでした/);
		assert.equal(await d.isVisible('#modal-master-item'), false);
		assert.deepEqual(await rawWorkflow(d), raw);
		assert.equal(await d.evaluate('window.__yose_app.authController.authGeneration'), generation);
		assert.equal(await d.evaluate('window.__yose_app.isKeyLocked'), false);
		const jobs = await d.evaluate('window.__workflowJobs.filter(job=>job.name==="openMasterModal").map(job=>job.settled)');
		assert.deepEqual(jobs, [true], 'the actual failed open promise must settle before the assertion');
	} finally { await d.evaluate('window.__yose_app.db.putRaw("master_config",window.__originalMaster67,"current")'); }
});

const stale = {
	account: ['accounts', '.btn-archive-account[data-id="stale_acc67"]', "config.accounts=config.accounts.filter(item=>item.id!=='stale_acc67')", /口座が変更されました/],
	category: ['categories', '.btn-archive-cat[data-id="stale_cat67"]', "config.categories=config.categories.filter(item=>item.id!=='stale_cat67')", /費目が変更されました/],
	subcategory: ['categories', '.btn-archive-subcat[data-cat-id="stale_cat67"][data-sub-id="stale_sub67"]', "config.categories.find(item=>item.id==='stale_cat67').subcategories=[]", /中項目が変更されました/],
	recurring: ['recurring', '.btn-toggle-recurring[data-id="stale_rec67"]', "config.recurring_rules=config.recurring_rules.filter(item=>item.id!=='stale_rec67')", /ルールが変更されました/]
};
for (const [kind, [tab, selector, remove, message]] of Object.entries(stale)) uiCase67(fixture, `rejects a stale ${kind} management action when another committed operation removed its target`, async d => {
	await d.evaluate(`window.__yose_app.db.mutateMasterConfig(config=>{
		config.accounts.push({id:'stale_acc67',name:'STALE_ACCOUNT67',type:'cash',initial_balance:0,is_asset:true,is_archived:false});
		config.categories.push({id:'stale_cat67',name:'STALE_CATEGORY67',type:'expense',is_archived:false,subcategories:[{id:'stale_sub67',name:'STALE_CHILD67',is_archived:false}]});
		config.recurring_rules.push({id:'stale_rec67',name:'STALE_RECURRING67',type:'expense',amount:100,account_id:'acc_wallet',category_id:'cat_food',subcategory_id:null,day_of_month:1,is_active:false});
	})`);
	await settings67(d, tab);
	assert.equal(await d.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`), true);
	await d.evaluate(`window.__yose_app.db.mutateMasterConfig(config=>{${remove}})`);
	const raw = await rawWorkflow(d);
	await observeExpectedDialog67(d, () => d.click(selector), message);
	assert.deepEqual(await rawWorkflow(d), raw, 'a stale action must preserve the newer committed master and every other raw original');
	assert.equal(await d.isVisible('#modal-master-item'), false);
});
