import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction } from '../helpers/ui_fixture.js';
const fixture = useBrowser();
const fillAnnual = async d => {
	await d.click('[data-tab="tab-tax"]'); await d.waitFor('document.querySelector("#furusato-manual-salary")');
	await d.select('#furusato-tax-status', 'taxable');
	for (const [field, value] of Object.entries({ salary: 6000000, social_insurance: 800000, other_income: 0, other_deductions: 0, personal_gap: 0, other_gap: 0 })) await d.fill(`#furusato-manual-${field}`, String(value));
};
it('opens the tax tab without donations and calculates manual amounts with automatically derived life and mortgage credits', async () => {
	const d = fixture.driver; await fillAnnual(d);
	await d.click('#furusato-life-enabled'); await d.fill('#furusato-manual-life_general_new', '120000'); await d.click('#furusato-young-dependent');
	await d.waitFor('document.querySelector("#furusato-calculation-preview").textContent.includes("60,000")');
	await d.click('#furusato-housing-enabled');
	for (const field of ['balance', 'price', 'limit']) await d.fill(`#furusato-housing-${field}`, '30000000');
	await d.waitFor('document.querySelector("#furusato-calculation-preview").textContent.includes("210,000")');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026]?.furusato_calculation?.life_enabled)()');
	assert.equal(await d.isVisible('#tab-tax'), true);
	await d.click('[data-analytics-target="budget"]'); assert.equal(await d.isVisible('#furusato-manual-salary'), false);
});
it('assigns arbitrary donation and wage classifications and only uses confirmed annual ledger totals after explicit confirmation', async () => {
	const d = fixture.driver; await seed(d, [transaction('wage', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', date: '2025-12-31', amount: 6000000 }), transaction('gift', { amount: 20000 })]);
	await fillAnnual(d);
	for (const [field, id] of [['salary', 'cat_income_main'], ['donation', 'cat_food']]) await d.evaluate(`{const s=document.querySelector('#furusato-source-${field}');for(const o of s.options){const v=JSON.parse(o.value);o.selected=v.category_id==='${id}'&&v.subcategory_id===null;}s.dispatchEvent(new Event('change',{bubbles:true}));}`);
	await d.waitFor('document.querySelector("#furusato-calculation-preview").textContent.includes("年額")');
	await d.click('#furusato-confirm-ledger'); await d.waitFor('window.__yose_app.furusatoController.confirmationToken');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('(async()=> Boolean((await window.__yose_app.db.getMasterConfig()).annual_budgets[2026]?.furusato_calculation?.ledger_confirmation))()');
	await d.click('[data-analytics-target="budget"]'); await d.waitFor('document.querySelector("#furusato-summary").textContent.includes("20,000")');
	assert.equal(await d.isVisible('#furusato-manual-salary'), false);
	await d.click('#btn-open-tax'); assert.equal(await d.isVisible('#tab-tax'), true);
});
it('preserves incomplete drafts and clears them on lock without reviving an old asynchronous tax render', async () => {
	const d = fixture.driver; await fillAnnual(d); await d.fill('#furusato-manual-salary', '7000000');
	await d.evaluate('window.__yose_app.furusatoController.render()');
	assert.equal(await d.evaluate('document.querySelector("#furusato-manual-salary").value'), '7000000');
	await d.evaluate('const c=window.__yose_app.furusatoController,db=window.__yose_app.db,read=db.getAnalyticsState.bind(db);db.getAnalyticsState=async()=>{const value=await read();await new Promise(r=>window.__taxRelease=r);return value;};window.__taxOld=c.render();void 0;');
	await d.waitFor('typeof window.__taxRelease==="function"'); await d.evaluate('window.__yose_app.authController.showLockScreen();window.__taxRelease();void 0;');
	await d.evaluate('window.__taxOld'); assert.equal(await d.evaluate('document.querySelector("#furusato-manual-salary")?.value || ""'), '');
});
it('freezes calculator controls during save, retains failed drafts and invalidates confirmation after a ledger edit', async () => {
	const d = fixture.driver; await fillAnnual(d);
	await d.evaluate('const db=window.__yose_app.db,save=db.saveMasterConfig.bind(db);window.__taxRestore=()=>db.saveMasterConfig=save;db.saveMasterConfig=async()=>{await new Promise(r=>window.__taxSaveRelease=r);throw new Error("tax save failure");};');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('typeof window.__taxSaveRelease==="function"');
	assert.equal(await d.evaluate('[...document.querySelectorAll("#tab-tax input,#tab-tax select,#tab-tax button")].every(e=>e.disabled)'), true);
	await d.evaluate('window.__taxSaveRelease()'); await d.waitFor('document.querySelector("#furusato-error").textContent.includes("tax save failure")');
	assert.equal(await d.evaluate('document.querySelector("#furusato-manual-salary").value'), '6000000');
	await d.evaluate('window.__taxRestore()');
	await seed(d, [transaction('annual', { type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main', date: '2025-01-25', amount: 6000000 })]);
	await d.evaluate('{const s=document.querySelector("#furusato-source-salary");for(const o of s.options)o.selected=JSON.parse(o.value).category_id==="cat_income_main";s.dispatchEvent(new Event("change",{bubbles:true}));}');
	await d.click('#furusato-confirm-ledger'); await d.waitFor('Boolean(window.__yose_app.furusatoController.confirmationToken)');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	await d.evaluate('(async()=>{const app=window.__yose_app;const tx=(await app.db.getTransactions())[0];await app.db.putTransaction({...tx,amount:5000000});await app.furusatoController.render();})()');
	assert.equal(await d.evaluate('document.querySelector("#furusato-confirm-ledger").checked'), false);
	assert.ok((await d.textContent('#furusato-calculation-preview')).includes('未算出'));
});
it('keeps the six navigation panels exclusive and separates donation year from money source year', async () => {
	const d = fixture.driver;
	for (const selector of ['[data-tab="tab-tax"]', '[data-tab="tab-settings"]', '[data-analytics-target="assets"]', '[data-analytics-target="budget"]', '[data-analytics-target="cashflow"]', '[data-tab="tab-input"]']) {
		await d.click(selector); assert.equal(await d.evaluate('document.querySelectorAll(".tab-panel.active").length'), 1);
	}
	await d.click('[data-tab="tab-tax"]'); await d.fill('#furusato-donation-year', '2027'); await d.evaluate('document.querySelector("#furusato-donation-year").dispatchEvent(new Event("change",{bubbles:true}))');
	await d.waitFor('window.__yose_app.furusatoController.sourceDraft?.year==="2027"');
	assert.equal(await d.evaluate('document.querySelector("#furusato-base-year").value'), '2026');
	await d.fill('#furusato-base-year', '2025');
	assert.equal(await d.evaluate('window.__yose_app.selectedYear'), '2027');
});
it('discards a slow confirmation when the source year changes and never silently reconfirms on save', async () => {
	const d = fixture.driver; await fillAnnual(d);
	await d.evaluate('{const s=document.querySelector("#furusato-source-salary");s.options[0].selected=true;s.dispatchEvent(new Event("change",{bubbles:true}));const c=window.__yose_app.furusatoController,fp=c.fingerprint.bind(c),confirm=c.confirmLedger.bind(c);let once=true;c.fingerprint=async(...args)=>{const token=await fp(...args);if(once){once=false;await new Promise(r=>window.__confirmationRelease=r);}return token;};c.confirmLedger=()=>window.__confirmationTask=confirm();}');
	await d.click('#furusato-confirm-ledger'); await d.waitFor('typeof window.__confirmationRelease==="function"');
	await d.fill('#furusato-base-year', '2024'); await d.evaluate('window.__confirmationRelease();window.__confirmationTask');
	await d.waitFor('!document.querySelector("#furusato-confirm-ledger").checked');
	assert.equal(await d.evaluate('window.__yose_app.furusatoController.confirmationToken'), null);
	await d.click('#btn-save-furusato-sources'); await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026]?.furusato_calculation?.ledger_confirmation ?? null)()'), null);
});
it('keeps uncommitted payroll, insurance and mortgage amounts separate from a saved notice', async () => {
	const d = fixture.driver; await fillAnnual(d); await d.click('#furusato-life-enabled'); await d.fill('#furusato-manual-life_general_new', '120000');
	await d.click('#furusato-housing-enabled'); for (const field of ['balance', 'price', 'limit']) await d.fill(`#furusato-housing-${field}`, '30000000');
	await d.fill('#furusato-resident-tax', '200000'); await d.select('#furusato-tax-rate', '20'); await d.click('#btn-save-furusato');
	await d.waitFor('!document.querySelector("#btn-save-furusato").disabled');
	assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026]?.furusato_calculation?.manual?.salary ?? null)()'), null);
	for (const [id, expected] of [['furusato-manual-salary', '6000000'], ['furusato-manual-life_general_new', '120000'], ['furusato-housing-balance', '30000000']]) assert.equal(await d.evaluate(`document.getElementById('${id}').value`), expected);
	await d.fill('#furusato-resident-tax', '300000'); await d.click('#btn-save-furusato-sources'); await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	assert.equal(await d.evaluate('document.querySelector("#furusato-resident-tax").value'), '300000');
	assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_estimate.resident_tax)()'), 200000);
});
it('renders the tax tab and budget when storage contains a minimal deletion tombstone', async () => {
	const d = fixture.driver; await d.evaluate('window.__yose_app.db.putTransaction({id:"deleted",is_deleted:true,updated_at:"2026-10-20T00:00:00Z"})');
	await fillAnnual(d); await d.waitFor('document.querySelector("#furusato-calculation-preview").textContent.includes("79,829")');
	await d.click('[data-analytics-target="budget"]'); await d.waitFor('document.querySelector("#budget-stat-grid").style.display==="grid"');
	assert.equal(await d.textContent('#furusato-error'), '');
});
it('shows an unentered manual donation as unknown and an explicit zero as zero', async () => {
	const d = fixture.driver; await fillAnnual(d); await d.select('#furusato-mode-donation', 'manual');
	await d.waitFor('document.querySelector("#furusato-calculation-preview").textContent.includes("参考自己負担 未算出")');
	await d.fill('#furusato-manual-donation', '0'); await d.waitFor('document.querySelector("#furusato-calculation-preview").textContent.includes("参考自己負担 ¥0")');
});
it('does not restore an annual confirmation cancelled while its digest is pending', async () => {
	const d = fixture.driver; await fillAnnual(d);
	await d.evaluate('{const c=window.__yose_app.furusatoController,fp=c.fingerprint.bind(c),confirm=c.confirmLedger.bind(c);let once=true;c.fingerprint=async(...args)=>{const value=await fp(...args);if(once){once=false;await new Promise(r=>window.__cancelDigestRelease=r);}return value;};c.confirmLedger=()=>window.__cancelDigestTask=confirm();}');
	await d.click('#furusato-confirm-ledger'); await d.waitFor('typeof window.__cancelDigestRelease==="function"');
	await d.evaluate('window.__pendingDigest=window.__cancelDigestTask;void 0;'); await d.click('#furusato-confirm-ledger');
	await d.evaluate('window.__cancelDigestRelease();window.__pendingDigest');
	assert.equal(await d.evaluate('window.__yose_app.furusatoController.confirmationToken'), null);
	assert.equal(await d.evaluate('document.querySelector("#furusato-confirm-ledger").checked'), false);
	await d.click('#btn-save-furusato-sources'); await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026]?.furusato_calculation?.ledger_confirmation ?? null)()'), null);
});
it('keeps a saved annual confirmation unchecked through redraw after cancellation', async () => {
	const d = fixture.driver; await fillAnnual(d); await d.click('#furusato-confirm-ledger'); await d.waitFor('Boolean(window.__yose_app.furusatoController.confirmationToken)');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	await d.click('#furusato-confirm-ledger'); await d.evaluate('window.__yose_app.furusatoController.render()');
	assert.equal(await d.evaluate('document.querySelector("#furusato-confirm-ledger").checked'), false);
	assert.equal(await d.evaluate('window.__yose_app.furusatoController.confirmationToken'), null);
});
it('applies the chosen calculation mode after alternating already-saved income and notice settings', async () => {
	const d = fixture.driver; await fillAnnual(d); await d.click('#btn-save-furusato-sources'); await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	await d.fill('#furusato-manual-salary', '7000000'); await d.fill('#furusato-resident-tax', '200000'); await d.select('#furusato-tax-rate', '20');
	await d.click('#btn-save-furusato'); await d.waitFor('!document.querySelector("#btn-save-furusato").disabled');
	await d.click('#btn-save-furusato-sources'); await d.waitFor('!document.querySelector("#btn-save-furusato-sources").disabled');
	assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_calculation.mode)()'), 'income');
	await d.click('#btn-save-furusato'); await d.waitFor('!document.querySelector("#btn-save-furusato").disabled');
	assert.equal(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026].furusato_calculation.mode)()'), 'notice');
});
it('reloads an encrypted database before tax controls are created and restores the saved calculator after PIN unlock', async () => {
	const d = fixture.driver; await fillAnnual(d); await d.click('#btn-save-furusato-sources'); await d.waitFor('(async()=> (await window.__yose_app.db.getMasterConfig()).annual_budgets[2026]?.furusato_calculation?.manual?.salary===6000000)()');
	await d.evaluate('window.__taxReloadOld=true'); await d.send('Page.reload', {}, d.sessionId);
	await d.waitFor('!window.__taxReloadOld && document.querySelector("#auth-pin-container")?.style.display==="block" && window.__yose_app.isKeyLocked');
	assert.equal(await d.evaluate('document.querySelector("#furusato-manual-salary")'), null);
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.waitFor('window.__yose_app._domInitialized && document.querySelector("#auth-screen").classList.contains("hidden")');
	await d.click('[data-tab="tab-tax"]'); await d.waitFor('document.querySelector("#furusato-manual-salary")?.value==="6000000"');
	assert.ok((await d.textContent('#furusato-calculation-preview')).includes('79,829'));
});
