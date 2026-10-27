import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, settings } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
const cases = [
	{ name: 'account options', read: 'getMasterConfig', target: 'app.txInputController.populateMasterDropdowns(options)', stamp: `document.querySelector('#select-account').innerHTML='<option value="new">NEW_ACCOUNT</option>';`, observe: `document.querySelector('#select-account').innerHTML` },
	{ name: 'category options', read: 'getMasterConfig', target: `app.txInputController.populateCategoryDropdowns('expense',options)`, stamp: `document.querySelector('#select-category').innerHTML='<option value="new">NEW_CATEGORY</option>';`, observe: `document.querySelector('#select-category').innerHTML` },
	{ name: 'subcategory options', read: 'getMasterConfig', target: `app.txInputController.updateSubcategories('cat_food','select-subcategory',null,false,options)`, setup: `document.querySelector('#select-category').value='cat_food';`, stamp: `document.querySelector('#select-subcategory').innerHTML='<option value="new">NEW_SUBCATEGORY</option>';`, observe: `document.querySelector('#select-subcategory').innerHTML` },
	{ name: 'tag candidate state', read: 'getUniqueTags', target: 'app.txInputController.updateTagAndMemoSuggestions(options)', stamp: `app.txInputController.availableTags=['NEW_TAG'];app.txInputController.memoHistoryMap={NEW_MEMO:{date:'2026-10-20'}};`, observe: `({tags:app.txInputController.availableTags,memos:app.txInputController.memoHistoryMap})` },
	{ name: 'memo candidate state', read: 'getMemoHistory', target: 'app.txInputController.updateTagAndMemoSuggestions(options)', stamp: `app.txInputController.availableTags=['NEW_TAG'];app.txInputController.memoHistoryMap={NEW_MEMO:{date:'2026-10-20'}};`, observe: `({tags:app.txInputController.availableTags,memos:app.txInputController.memoHistoryMap})` },
	{ name: 'unsettled advance rows', read: 'getUnsettledAdvancePayments', target: 'app.txInputController.renderUnsettledAdvanceList(options)', stamp: `document.querySelector('#unsettled-advance-list').textContent='NEW_ADVANCE';document.querySelector('#unsettled-advance-count').textContent='new count';`, observe: `({rows:document.querySelector('#unsettled-advance-list').textContent,count:document.querySelector('#unsettled-advance-count').textContent})` },
	{ name: 'recent rows with their existing render generation', read: 'getTransactions', target: 'app.txListController.renderRecentTransactions(options)', stamp: `document.querySelector('#recent-tx-list').textContent='NEW_RECENT';`, observe: `document.querySelector('#recent-tx-list').textContent` },
	{ name: 'monthly rows with their existing render generation', read: 'getTransactions', target: 'app.txListController.renderMonthTransactions(options)', stamp: `document.querySelector('#month-tx-list').textContent='NEW_MONTH';`, observe: `document.querySelector('#month-tx-list').textContent` },
	{ name: 'summary KPIs with their existing render generation', read: 'getAnalyticsState', target: 'app.summaryController.renderSummary(options)', stamp: `document.querySelector('#stat-income').textContent='NEW_INCOME';`, observe: `document.querySelector('#stat-income').textContent` },
	{ name: 'asset history with its existing render generation', read: 'getAnalyticsState', target: 'app.summaryController.renderAssetHistory(null,options)', stamp: `document.querySelector('#asset-history-notice').textContent='NEW_ASSET_NOTICE';`, observe: `document.querySelector('#asset-history-notice').textContent` },
	{ name: 'budget inputs with their existing read generation', read: 'getAnalyticsState', target: 'app.budgetSettingsController.render(options)', stamp: `document.querySelector('#setting-expense-budget').value='777';`, observe: `document.querySelector('#setting-expense-budget').value`, settings: true },
	{ name: 'tax summary with its existing render generation', read: 'getAnalyticsState', target: 'app.furusatoController.render(null,options)', stamp: `document.querySelector('#furusato-tax-summary').textContent='NEW_TAX';`, observe: `document.querySelector('#furusato-tax-summary').textContent` },
	{ name: 'metadata through Settings', read: 'getDataMetadata', target: 'app.settingsController.renderSettings(options)', stamp: `document.querySelector('#data-metadata').textContent='NEW_METADATA';`, observe: `document.querySelector('#data-metadata').textContent`, settings: true },
	{ name: 'Settings URL', read: 'getSetting', predicate: `args[0]==='gas_url'`, target: 'app.settingsController.renderSettings(options)', stamp: `app.settingsController.gasUrlDirty=false;document.querySelector('#input-gas-url').value='NEW_SESSION_URL';`, observe: `document.querySelector('#input-gas-url').value`, settings: true },
	{ name: 'Settings master counts', read: 'getMasterConfig', target: 'app.settingsController.renderSettings(options)', stamp: `document.querySelector('#master-summary-info').textContent='NEW_MASTER_COUNTS';`, observe: `document.querySelector('#master-summary-info').textContent`, settings: true },
	{ name: 'Settings credential status', read: 'getSecurityKey', predicate: `args[0]==='webauthn_credential'`, target: 'app.settingsController.renderSettings(options)', stamp: `document.querySelector('#synced-passkey-status').textContent='NEW_CREDENTIAL';`, observe: `document.querySelector('#synced-passkey-status').textContent`, settings: true },
	{ name: 'pending import panel', read: 'getPendingImport', target: 'app.settingsController.backupImportController.renderPending(options)', stamp: `document.querySelector('#pending-import-panel').hidden=false;document.querySelector('#pending-import-status').textContent='NEW_PENDING';document.querySelector('#btn-reapprove-import').disabled=false;`, observe: `({hidden:document.querySelector('#pending-import-panel').hidden,status:document.querySelector('#pending-import-status').textContent,disabled:document.querySelector('#btn-reapprove-import').disabled})` },
	{ name: 'master management list', read: 'getMasterConfig', target: 'app.masterController.renderMasterManagement(options)', stamp: `document.querySelector('#master-accounts-list').textContent='NEW_MASTER_LIST';`, observe: `document.querySelector('#master-accounts-list').textContent` },
	{ name: 'sync badge', read: 'getUnsyncedTransactions', target: 'app.syncStatusController.updateSyncBadge(options)', stamp: `document.querySelector('#sync-badge').textContent='NEW_BADGE';document.querySelector('#sync-badge').title='NEW_TITLE';`, observe: `({text:document.querySelector('#sync-badge').textContent,title:document.querySelector('#sync-badge').title})` },
	{ name: 'maintenance success', read: 'getMasterConfig', target: 'app.maintenanceController.refresh(options)', maintenance: true, stamp: `app.maintenanceController.config={newSession:true};app.maintenanceController.records=[{id:'new'}];app.maintenanceController.loading=true;document.querySelector('#maintenance-refresh-status').textContent='NEW_MAINTENANCE';document.querySelector('#maintenance-source').innerHTML='<option value="new">NEW_SOURCE</option>';`, observe: `({config:app.maintenanceController.config,records:app.maintenanceController.records,loading:app.maintenanceController.loading,status:document.querySelector('#maintenance-refresh-status').textContent,source:document.querySelector('#maintenance-source').innerHTML})` },
	{ name: 'maintenance catch and finally', read: 'getMasterConfig', target: 'app.maintenanceController.refresh(options)', maintenance: true, reject: true, stamp: `app.maintenanceController.loading=true;document.querySelector('#maintenance-refresh-status').textContent='NEW_MAINTENANCE';document.querySelector('#maintenance-source').disabled=true;`, observe: `({loading:app.maintenanceController.loading,status:document.querySelector('#maintenance-refresh-status').textContent,disabled:document.querySelector('#maintenance-source').disabled})` }
];

for (const scenario of cases) it(`discards an expired parent's delayed ${scenario.name} before state or DOM changes`, async () => {
	const d = fixture.driver;
	if (scenario.settings || scenario.maintenance) {
		await settings(d); await d.evaluate('window.__yose_app.settingsController.renderSettings()');
	}
	if (scenario.maintenance) {
		await d.click('#maintenance-panel summary');
		await d.waitFor('!window.__yose_app.maintenanceController.loading && document.querySelector("#maintenance-refresh-status").textContent.includes("一覧を更新しました")');
	}
	await d.evaluate(`{const app=window.__yose_app;${scenario.setup || ''}window.__renderActive=true;window.__renderValid=()=>window.__renderActive;window.__renderError=null;const read=app.db[${JSON.stringify(scenario.read)}].bind(app.db);let once=true;app.db[${JSON.stringify(scenario.read)}]=async(...args)=>{const result=await read(...args);if(once&&(${scenario.predicate || 'true'})){once=false;await new Promise(resolve=>window.__releaseRender=resolve);${scenario.reject ? 'throw new Error("expired maintenance read failed");' : ''}}return result;};const options={isSessionValid:window.__renderValid};window.__renderPromise=(async()=>{try{await ${scenario.target};}catch(error){window.__renderError=error.message;}})();void 0;}`);
	await d.waitFor('typeof window.__releaseRender==="function"');
	await d.evaluate(`{const app=window.__yose_app;window.__renderActive=false;${scenario.stamp}}`);
	const expected = await d.evaluate(`(()=>{const app=window.__yose_app;return ${scenario.observe};})()`);
	await d.evaluate('window.__releaseRender();window.__renderPromise');
	assert.deepEqual(await d.evaluate(`(()=>{const app=window.__yose_app;return ${scenario.observe};})()`), expected);
	assert.equal(await d.evaluate('window.__renderError'), null, 'expired rendering must not surface a stale failure');
});

it('captures the original authentication session for a direct dropdown refresh without a parent callback', async () => {
	const d = fixture.driver;
	await d.evaluate(`{const app=window.__yose_app,read=app.db.getMasterConfig.bind(app.db),finish=app.finishAppInit.bind(app);app.finishAppInit=(...args)=>window.__newInit=finish(...args);let once=true;app.db.getMasterConfig=async(...args)=>{const config=await read(...args);if(once){once=false;await new Promise(resolve=>window.__releaseDirectRead=resolve);}return config;};window.__directRead=app.txInputController.populateMasterDropdowns();void 0;}`);
	await d.waitFor('typeof window.__releaseDirectRead==="function"');
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
	await d.waitFor('!window.__yose_app.isKeyLocked'); await d.evaluate('window.__newInit');
	await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.accounts.find(a=>a.id==='acc_wallet').name='NEW_DIRECT_SESSION';});await app.txInputController.populateMasterDropdowns();})()`);
	const before = await d.evaluate('document.querySelector("#select-account").innerHTML');
	await d.evaluate('window.__releaseDirectRead();window.__directRead');
	assert.deepEqual(await d.evaluate('document.querySelector("#select-account").innerHTML'), before);
});

it('retains direct locked-badge rendering but ignores an already expired parent callback', async () => {
	const d = fixture.driver;
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.evaluate('document.querySelector("#sync-badge").textContent="OLD_STATUS";window.__yose_app.syncStatusController.updateSyncBadge()');
	assert.equal(await d.textContent('#sync-badge'), 'ロック中');
	await d.evaluate('document.querySelector("#sync-badge").textContent="NEW_LOCKED_STATUS";window.__yose_app.syncStatusController.updateSyncBadge({isSessionValid:()=>false})');
	assert.equal(await d.textContent('#sync-badge'), 'NEW_LOCKED_STATUS');
});
