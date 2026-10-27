import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, cashflow, seed, transaction } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
async function annual(d) {
	await cashflow(d); await d.click('#control-granularity [data-granularity="yearly"]');
	await d.waitFor('document.querySelector("#btn-close-month").textContent.includes("2026年")');
	await d.evaluate(`{const app=window.__yose_app,c=app.summaryController,close=c.handleCloseMonth.bind(c);c.handleCloseMonth=()=>window.__annualPromise=close();window.__annualCloseCalls=[];app.syncManager.closeMonth=async month=>window.__annualCloseCalls.push(month);}`);
}

for (const reason of ['cancel', 'unknown']) it(`keeps all encrypted business originals and skips real auto-settlement refresh on annual ${reason}`, async () => {
	const d = fixture.driver;
	if (reason === 'unknown') await seed(d, [transaction('unknown-december', { target_month: '2026-12', status: 'planned', amount: 0, amount_pending: true })]);
	await annual(d);
	await d.evaluate('window.__settlementCalls=0;window.__yose_app.db.processCreditCardAutoSettlements=async()=>{window.__settlementCalls++;throw new Error("Unexpected financial generation during cancelled close");};');
	const before = await d.evaluate('window.__yose_app.db.captureImportState()');
	if (reason === 'cancel') await d.setConfirm(false);
	await d.click('#btn-close-month'); await d.evaluate('window.__annualPromise');
	assert.deepEqual(await d.evaluate('window.__annualCloseCalls'), []);
	assert.equal(await d.evaluate('window.__settlementCalls'), 0);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'), before);
	assert.equal(await d.evaluate('document.querySelector("#btn-close-month").disabled'), false);
});

it('drops an annual preflight held across real lock/unlock without sending months or overwriting new-session inputs', async () => {
	const d = fixture.driver; await annual(d);
	await d.evaluate(`{const app=window.__yose_app,read=app.db.getTransactions.bind(app.db);let once=true;window.__oldAnnualKey=app.db.encryptionKey;app.db.getTransactions=async filter=>{const rows=await read(filter);if(once&&filter?.target_month==='2026-01'){once=false;await new Promise(resolve=>window.__releaseAnnualRead=resolve);}return rows;};}`);
	await d.click('#btn-close-month'); await d.waitFor('typeof window.__releaseAnnualRead==="function"');
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
	await d.waitFor('!window.__yose_app.isKeyLocked && document.querySelector("#auth-screen").classList.contains("hidden")');
	await cashflow(d); await d.click('#btn-period-next');
	await d.waitFor('document.querySelector("#period-display").textContent.includes("2027年")');
	await d.fill('#input-tx-search', 'new-session-draft');
	await d.evaluate('window.__yose_app.summaryController.renderSummary()');
	const current = await d.evaluate('({year:window.__yose_app.selectedYear,period:document.querySelector("#period-display").textContent,search:document.querySelector("#input-tx-search").value})');
	await d.evaluate('window.__postUnlockRefreshes=0;window.__yose_app.refreshAllViews=async()=>{window.__postUnlockRefreshes++;};window.__releaseAnnualRead();window.__annualPromise');
	assert.equal(await d.evaluate('window.__oldAnnualKey===window.__yose_app.db.encryptionKey'), false);
	assert.deepEqual(await d.evaluate('window.__annualCloseCalls'), []);
	assert.equal(await d.evaluate('window.__postUnlockRefreshes'), 0);
	assert.deepEqual(await d.evaluate('({year:window.__yose_app.selectedYear,period:document.querySelector("#period-display").textContent,search:document.querySelector("#input-tx-search").value})'), current);
});

async function unlockAfterHeldRefresh(d) {
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
	await d.waitFor('!window.__yose_app.isKeyLocked'); await d.evaluate('window.__newFinishInit');
}
async function holdFinalRefresh(d, reject = false) {
	await annual(d);
	await d.evaluate(`{const app=window.__yose_app,read=app.db.getMasterConfig.bind(app.db),finish=app.finishAppInit.bind(app);app.finishAppInit=(...args)=>window.__newFinishInit=finish(...args);let once=true;app.db.getMasterConfig=async(...args)=>{const config=await read(...args);if(once){once=false;await new Promise((resolve,reject)=>{window.__releaseFinalRefresh=${reject ? '()=>reject(new Error("old refresh failed"))' : 'resolve'};});}return config;};}`);
	await d.click('#btn-close-month'); await d.waitFor('typeof window.__releaseFinalRefresh==="function"');
	await d.evaluate('window.__oldAnnualPromise=window.__annualPromise;void 0;');
}

it('does not replace a newly unlocked account name or draft when the old final refresh resumes', async () => {
	const d = fixture.driver; await holdFinalRefresh(d); await unlockAfterHeldRefresh(d);
	await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.accounts.find(a=>a.id==='acc_wallet').name='NEW_SESSION_ACCOUNT';});await app.txInputController.populateMasterDropdowns();document.querySelector('#input-memo').value='new session memo';})()`);
	const before = await d.evaluate('({account:document.querySelector("#select-account option[value=acc_wallet]").textContent,memo:document.querySelector("#input-memo").value,dialogs:window.__dialogs.length})');
	await d.evaluate('window.__releaseFinalRefresh();window.__oldAnnualPromise');
	assert.deepEqual(await d.evaluate('({account:document.querySelector("#select-account option[value=acc_wallet]").textContent,memo:document.querySelector("#input-memo").value,dialogs:window.__dialogs.length})'), before);
});

it('cancels old closing busy on lock and does not let an expired refresh failure unlock or notify a new batch', async () => {
	const d = fixture.driver; await holdFinalRefresh(d, true); await unlockAfterHeldRefresh(d);
	assert.equal(await d.evaluate('Boolean(window.__yose_app.summaryController.closingMonths)'), false);
	assert.equal(await d.evaluate('document.querySelector("#btn-close-month").disabled'), false);
	await cashflow(d);
	await d.evaluate('window.__newCloseMonths=[];window.__yose_app.syncManager.closeMonth=async month=>{window.__newCloseMonths.push(month);if(month==="2026-01")await new Promise(resolve=>window.__releaseNewClose=resolve);};');
	await d.click('#btn-close-month'); await d.waitFor('typeof window.__releaseNewClose==="function"');
	const before = await d.evaluate('({closing:window.__yose_app.summaryController.closingMonths,disabled:document.querySelector("#btn-close-month").disabled,text:document.querySelector("#btn-close-month").textContent,dialogs:window.__dialogs.length})');
	await d.evaluate('window.__releaseFinalRefresh();window.__oldAnnualPromise');
	assert.deepEqual(await d.evaluate('({closing:window.__yose_app.summaryController.closingMonths,disabled:document.querySelector("#btn-close-month").disabled,text:document.querySelector("#btn-close-month").textContent,dialogs:window.__dialogs.length})'), before);
	await d.evaluate('window.__releaseNewClose();window.__annualPromise');
	assert.equal(await d.evaluate('window.__newCloseMonths.length'), 12);
	assert.equal(await d.evaluate('document.querySelector("#btn-close-month").disabled'), false);
});
