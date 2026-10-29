import assert from 'node:assert/strict';
import { useBrowser, seed, seedLegacy, transaction, cashflow, value } from '../helpers/ui_fixture.js';
import { uiCase67, settings67 } from '../helpers/ui_workflows67.js';
import { gateMethod, waitGate, releaseGate, flushWorkflow, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';

const fixture = useBrowser();
const source = extra => transaction('advance67', { type: 'transfer', account_id: 'acc_wallet', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null, ...extra });
const repayment = extra => transaction('repayment67', { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_bank_main', category_id: null, actual_category_id: null, ...extra });
const wholeRaw = d => d.evaluate('(async()=>{const db=window.__yose_app.db;return {business:await db.captureImportState(),settings:await db.getAllRaw("settings"),keys:await db.getAllRaw("security_keys")};})()');
async function watch(d) {
	await d.evaluate(`(()=>{const app=window.__yose_app;for(const owner of [app.settingsController.backupImportController,app.advanceLinkController])for(const name of ['preview','confirm','reapprove','renderPending','open','save']){if(typeof owner[name]!=='function')continue;const original=owner[name];owner[name]=function(...args){const promise=original.apply(this,args);if(promise&&typeof promise.then==='function'){const job={name,promise,settled:false};window.__workflowJobs.push(job);promise.then(()=>job.settled=true,()=>job.settled=true);}return promise;};window.__restores67.push(()=>owner[name]=original);}})()`);
}
const finish = (d, name) => d.evaluate(`Promise.allSettled(window.__workflowJobs.filter(job=>job.name===${JSON.stringify(name)}).map(job=>job.promise))`);
async function preview(d, data) {
	await d.select('#select-import-mode', 'replace'); await d.importFile(JSON.stringify(data)); await d.waitFor('document.getElementById("modal-replacement-import").classList.contains("active")'); await finish(d, 'preview');
}
async function confirmImport(d) { await d.fill('#replacement-import-word', '完全インポート'); await d.click('#btn-confirm-replacement-import'); await finish(d, 'confirm'); }
async function pending(d) {
	await d.evaluate(`(async()=>{const db=window.__yose_app.db;await db.commitReplacementImport(await db.prepareReplacementImport([]),{confirmation:'完全インポート'});const original=await db.getPendingImport();await db.updatePendingImport(original,{...original,base_version:'old-base'});await window.__yose_app.settingsController.renderPendingImport();})()`);
}
async function openAdvance(d, id = 'advance67') {
	await d.click(`#month-tx-list [data-id="${id}"]`); await d.waitFor(`document.getElementById('modal-edit-tx').classList.contains('active')&&document.getElementById('edit-tx-id').value===${JSON.stringify(id)}`); await d.click('#btn-edit-link-advance'); await d.waitFor('document.getElementById("modal-advance-link").classList.contains("active")'); await finish(d, 'open');
}
async function watchRefresh(d) {
	await d.evaluate(`(()=>{const app=window.__yose_app,original=app.refreshAllViews;window.__refreshEntries67=[];app.refreshAllViews=function(...args){const valid=args[0]?.isSessionValid;window.__refreshEntries67.push({hasParent:typeof valid==='function',valid:typeof valid==='function'?valid():null});return original.apply(this,args);};window.__restores67.push(()=>app.refreshAllViews=original);})()`);
}

for (const kind of ['full_backup', 'master_config', 'annual_budgets', 'summary_snapshot']) uiCase67(fixture, `previews the real ${kind} file identity and counts, and cancels without writing any raw store`, async d => {
	await watch(d); await settings67(d); const full = await d.evaluate('window.__yose_app.db.exportFullData()');
	const input = kind === 'full_backup' ? full : { export_type: kind, [kind]: kind === 'annual_budgets' ? { '2027': { expense_budget: 0 }, '2028': { expense_budget: 1 } } : full[kind] };
	const before = await wholeRaw(d); await preview(d, input); const text = await d.textContent('#replacement-import-summary');
	assert.match(text, kind === 'full_backup' ? /全データ.*明細: 0件/ : kind === 'master_config' ? /マスタ設定.*口座: \d+件 \/ 費目: \d+件/ : kind === 'annual_budgets' ? /年間予算.*年間予算: 2年度/ : /残高スナップショット.*完全に置き換えます/);
	if (['master_config', 'full_backup'].includes(kind)) assert.ok(text.includes(`口座: ${full.master_config.accounts.length}件 / 費目: ${full.master_config.categories.length}件`));
	await d.click('#btn-cancel-replacement-import'); await d.waitFor('!document.getElementById("modal-replacement-import").classList.contains("active")'); assert.deepEqual(await wholeRaw(d), before);
});

uiCase67(fixture, 'keeps replacement mode selected when the explicit pending-replacement checkbox is unchecked again', async d => {
	await watch(d); await settings67(d); await pending(d); const before = await wholeRaw(d); await d.select('#select-import-mode', 'merge'); await d.click('#checkbox-replace-pending-import'); assert.equal(await value(d, '#select-import-mode'), 'replace'); await d.click('#checkbox-replace-pending-import'); assert.equal(await value(d, '#select-import-mode'), 'replace'); assert.deepEqual(await wholeRaw(d), before);
});

uiCase67(fixture, 'refuses repeated public confirmation/preview requests while a real encrypted import is pending', async d => {
	await watch(d); await settings67(d); await preview(d, []); const before = await wholeRaw(d); await gateMethod(d, 'window.__yose_app.db', 'encryptRecord');
	await d.fill('#replacement-import-word', '完全インポート'); await d.click('#btn-confirm-replacement-import'); await waitGate(d);
	assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.busy'), true);
	const response = await d.evaluate(`(async()=>{const c=window.__yose_app.settingsController.backupImportController;await c.confirm();try{await c.preview([]);return null;}catch(error){return error.message;}})()`); assert.match(response, /同期中/); assert.deepEqual(await wholeRaw(d), before);
	await d.fill('#replacement-import-word', 'wrong'); assert.equal(await d.evaluate('document.getElementById("btn-confirm-replacement-import").disabled'), true); await d.click('#btn-cancel-replacement-import'); await releaseGate(d); await finish(d, 'confirm'); assert.deepEqual(await wholeRaw(d), before);
});

uiCase67(fixture, 'refuses a confirmation API request with no preview or a wrong word without writing data', async d => {
	await watch(d); await settings67(d); const before = await wholeRaw(d); await d.evaluate('window.__yose_app.settingsController.backupImportController.confirm()'); await preview(d, []); await d.fill('#replacement-import-word', 'wrong'); await d.evaluate('window.__yose_app.settingsController.backupImportController.confirm()'); assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.evaluate('window.__yose_app.db.getPendingImport()'), null);
});

uiCase67(fixture, 'keeps raw data and the auth screen intact when an import preview finishes after a real lock', async d => {
	await watch(d); await settings67(d); const before = await wholeRaw(d); await gateMethod(d, 'window.__yose_app.db', 'prepareReplacementImport', { afterRead: true }); await d.select('#select-import-mode', 'replace'); const importing = d.importFile('[]').then(() => ({ done: true }), error => ({ error }));
	try { await waitGate(d); await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); await releaseGate(d); await finish(d, 'preview'); const outcome = await importing; assert.equal(outcome.done, true, outcome.error?.message); await flushWorkflow(d); assert.equal(await d.isVisible('#modal-replacement-import'), false); assert.equal(await d.isVisible('#auth-screen'), true); assert.deepEqual(await wholeRaw(d), before); }
	finally { await d.evaluate('window.__workflowGates.forEach(gate=>gate.release?.())'); await importing; }
});

for (const word of [null, 'wrong']) uiCase67(fixture, `keeps all pending-import bytes on reapproval ${word === null ? 'cancel' : 'word mismatch'}`, async d => {
	await watch(d); await settings67(d); await pending(d); const before = await wholeRaw(d); await d.evaluate(`window.__nextPromptText=${JSON.stringify(word)}`); await d.click('#btn-reapprove-import'); await finish(d, 'reapprove'); assert.deepEqual(await wholeRaw(d), before);
	if (word !== null) assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /確認の文字が一致しません/);
});

uiCase67(fixture, 'does not overwrite a newer real pending import after an older reapproval read', async d => {
	await watch(d); await settings67(d); await pending(d); await gateMethod(d, 'window.__yose_app.db', 'updatePendingImport'); await d.evaluate('window.__nextPromptText="完全インポート"'); await d.click('#btn-reapprove-import'); await waitGate(d);
	await d.click('#checkbox-replace-pending-import'); await preview(d, [transaction('corrected67', { amount: 200 })]); await confirmImport(d); const arrived = await wholeRaw(d); await releaseGate(d); await finish(d, 'reapprove'); assert.deepEqual(await wholeRaw(d), arrived); assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /送信待ちデータが変更/); assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getPendingImport()).data.transactions[0].amount)()'), 200);
});

uiCase67(fixture, 'suppresses reapproval write/error UI when the real prompt triggers a lock', async d => {
	await watch(d); await settings67(d); await pending(d); const before = await wholeRaw(d);
	await d.evaluate(`(()=>{const prompt=window.prompt;window.prompt=(...args)=>{prompt(...args);window.__yose_app.authController.lockPrivateKey();return '完全インポート';};window.__restores67.push(()=>window.prompt=prompt);})()`); const dialogs = await d.evaluate('window.__dialogs.length'); await d.click('#btn-reapprove-import'); await finish(d, 'reapprove'); await flushWorkflow(d); assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.isVisible('#auth-screen'), true); assert.equal(await d.evaluate(`window.__dialogs.slice(${dialogs}).filter(dialog=>dialog.type==='alert'&&dialog.message.startsWith('再確認に失敗')).length`), 0);
});

uiCase67(fixture, 'keeps the missing linked source visible as text and never invents another repayment', async d => {
	await watch(d); await seed(d, [repayment({ advance_source_id: 'not-downloaded67' })]); await cashflow(d); const before = await wholeRaw(d); await openAdvance(d, 'repayment67'); assert.match(await d.textContent('#advance-link-current'), /元立替 not-downloaded67 は未取得/); assert.equal(await d.evaluate('document.getElementById("advance-link-candidate-group").hidden'), true); assert.deepEqual(await wholeRaw(d), before);
});

uiCase67(fixture, 'renders legacy unnamed candidate accounts using their original IDs and escapes candidate text', async d => {
	await watch(d); await seed(d, [source()]); await seedLegacy(d, [repayment({ to_account_id: '<unknown-account>', memo: '' })]); await cashflow(d); await openAdvance(d); const text = await d.textContent('#advance-link-candidate'); assert.match(text, /repayment67.*<unknown-account>/); assert.equal(await d.evaluate('document.querySelector("#advance-link-candidate unknown-account")'), null);
});

uiCase67(fixture, 'refuses a public save request when no real candidate exists and restores the disabled empty state', async d => {
	await watch(d); await seed(d, [source()]); await cashflow(d); await openAdvance(d); const before = await wholeRaw(d); await d.evaluate('window.__yose_app.advanceLinkController.save(false)'); assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.evaluate('document.getElementById("btn-save-advance-link").disabled'), true); assert.equal(await d.evaluate('window.__yose_app.advanceLinkController.busy'), false);
});

for (const unlink of [false, true]) uiCase67(fixture, `keeps both records unchanged when ${unlink ? 'unlink' : 'link'} confirmation is cancelled`, async d => {
	await watch(d); await seed(d, [source(), repayment(unlink ? { advance_source_id: 'advance67' } : {})]); await cashflow(d); await openAdvance(d); const before = await wholeRaw(d); await d.evaluate('window.__nextConfirmAccept=false'); await d.click(unlink ? '#btn-unlink-advance' : '#btn-save-advance-link'); await finish(d, 'save'); assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.isVisible('#modal-advance-link'), true); assert.equal(await d.evaluate('window.__yose_app.advanceLinkController.busy'), false);
});

uiCase67(fixture, 'keeps a saved link and reports a background transport failure without undoing its financial contents', async d => {
	await watch(d); await seed(d, [source(), repayment()]); await cashflow(d); await openAdvance(d);
	await d.evaluate(`(()=>{const manager=window.__yose_app.syncManager,original=manager.syncPendingDiffs;manager.syncPendingDiffs=()=>{const promise=Promise.reject(new Error('offline link transport'));promise.catch(()=>{});window.__linkTransport67=promise;return promise;};window.__restores67.push(()=>manager.syncPendingDiffs=original);})()`); await d.click('#btn-save-advance-link'); await finish(d, 'save'); await d.evaluate('Promise.allSettled([window.__linkTransport67])');
	assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getTransaction("repayment67")).advance_source_id)()'), 'advance67'); assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getTransaction("repayment67")).amount)()'), 100); assert.match(await d.evaluate('window.__workflowNotices.join(" / ")'), /同期できませんでした.*端末内に保持/); assert.equal(await d.isVisible('#modal-advance-link'), false);
});

for (const unlink of [false, true]) uiCase67(fixture, `keeps the new session draft and notifications intact after an old ${unlink ? 'unlink' : 'link'} approval completes`, async d => {
	await watch(d); await seed(d, [source(), repayment(unlink ? { advance_source_id: 'advance67' } : {})]); await cashflow(d); await openAdvance(d); const before = await wholeRaw(d); await gateMethod(d, 'window.__yose_app', 'approveClosedChanges', { afterRead: true });
	await d.click(unlink ? '#btn-unlink-advance' : '#btn-save-advance-link'); await waitGate(d); await unlockWorkflow(d); await cashflow(d); await d.click('#month-tx-list [data-id="repayment67"]'); await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active")&&document.getElementById("edit-tx-id").value==="repayment67"'); await d.fill('#edit-tx-memo', 'new-session draft'); const dialogs = await d.evaluate('window.__dialogs.length'), notices = await d.evaluate('window.__workflowNotices.length');
	await releaseGate(d); await finish(d, 'save'); assert.deepEqual(await wholeRaw(d), before); assert.equal(await value(d, '#edit-tx-memo'), 'new-session draft'); assert.equal(await value(d, '#edit-tx-id'), 'repayment67'); assert.equal(await d.isVisible('#modal-edit-tx'), true); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs); assert.equal(await d.evaluate('window.__workflowNotices.length'), notices);
});

uiCase67(fixture, 'discards a confirmation interrupted by a real lock without painting its hidden import error', async d => {
	await watch(d); await settings67(d); await preview(d, []); const before = await wholeRaw(d); await gateMethod(d, 'window.__yose_app.db', 'encryptRecord'); await d.fill('#replacement-import-word', '完全インポート'); await d.click('#btn-confirm-replacement-import'); await waitGate(d); await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); const error = await d.textContent('#replacement-import-error'); await releaseGate(d); await finish(d, 'confirm'); assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.textContent('#replacement-import-error'), error); assert.equal(await d.isVisible('#auth-screen'), true);
});

uiCase67(fixture, 'keeps the current pending panel when an obsolete null read finishes after import and reauthentication', async d => {
	await watch(d); await settings67(d); await gateMethod(d, 'window.__yose_app.db', 'getPendingImport', { afterRead: true }); await d.evaluate('void(window.__oldPendingRender67=window.__yose_app.settingsController.backupImportController.renderPending())'); await waitGate(d);
	await preview(d, []); await confirmImport(d); await unlockWorkflow(d); await d.click('.tab-btn[data-tab="tab-settings"]'); await d.waitFor('!document.getElementById("pending-import-panel").hidden');
	const panel = () => d.evaluate('({hidden:document.getElementById("pending-import-panel").hidden,status:document.getElementById("pending-import-status").textContent,disabled:document.getElementById("btn-reapprove-import").disabled})'); const latest = await panel(), before = await wholeRaw(d); assert.match(latest.status, /取引明細.*送信待ち/); await releaseGate(d); await d.evaluate('window.__oldPendingRender67'); assert.deepEqual(await panel(), latest); assert.deepEqual(await wholeRaw(d), before);
});

uiCase67(fixture, 'ignores a stale reapprove control after actual acknowledgement cleared its outbox', async d => {
	await watch(d); await settings67(d); await pending(d); await d.evaluate('(async()=>{const db=window.__yose_app.db,original=await db.getPendingImport();await db.acknowledgePendingImport(original,undefined,{importedAt:"2026-10-29T00:00:00Z"});})()'); const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length'); assert.equal(await d.evaluate('document.getElementById("btn-reapprove-import").disabled'), false); await d.click('#btn-reapprove-import'); await finish(d, 'reapprove'); assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs);
});

uiCase67(fixture, 'refuses a reapproval delivered while a real online synchronization has started', async d => {
	await watch(d); await settings67(d); await pending(d); const before = await wholeRaw(d);
	await d.evaluate(`(()=>{const manager=window.__yose_app.syncManager,fetch=manager.fetch,url=manager.gasUrl,sync=manager.syncBidirectional;manager.setGasUrl('https://offline67.fixture/exec');manager.fetch=async()=>{throw new TypeError('NetworkError offline67');};manager.syncBidirectional=function(...args){window.__onlineSync67=sync.apply(this,args);return window.__onlineSync67;};window.__restores67.push(()=>{manager.fetch=fetch;manager.setGasUrl(url);manager.syncBidirectional=sync;});window.dispatchEvent(new Event('online'));document.getElementById('btn-reapprove-import').click();})()`); await finish(d, 'reapprove'); await d.evaluate('Promise.allSettled([window.__onlineSync67])'); assert.deepEqual(await wholeRaw(d), before); assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /同期中.*完了/);
});

uiCase67(fixture, 'rejects a stale native link-open request when another writer changes the displayed original', async d => {
	await watch(d); await seed(d, [source(), repayment()]); await cashflow(d); await d.click('#month-tx-list [data-id="advance67"]'); await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active")'); await flushWorkflow(d); await gateMethod(d, 'window.__yose_app.db', 'getTransactions'); await d.click('#btn-edit-link-advance'); await waitGate(d); await d.evaluate('(async()=>{const db=window.__yose_app.db,record=await db.getTransaction("advance67");await db.putTransaction({...record,amount:200});})()'); const arrived = await wholeRaw(d); await releaseGate(d); await finish(d, 'open'); assert.deepEqual(await wholeRaw(d), arrived); assert.equal(await d.isVisible('#modal-advance-link'), false); assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /ひも付けを開始.*明細が変更/);
});

uiCase67(fixture, 'keeps a real saving link owner stable when its public open/save API is requested again', async d => {
	await watch(d); await seed(d, [source(), repayment()]); await cashflow(d); await openAdvance(d); const before = await wholeRaw(d); await gateMethod(d, 'window.__yose_app.db', 'linkAdvanceRepayment'); await d.click('#btn-save-advance-link'); await waitGate(d); const owner = await d.evaluate('({generation:window.__yose_app.advanceLinkController.generation,operation:window.__yose_app.advanceLinkController.operation})');
	await d.evaluate('(async()=>{const app=window.__yose_app;await app.advanceLinkController.open(await app.db.getTransaction("advance67"));await app.advanceLinkController.save(false);})()'); assert.deepEqual(await d.evaluate('({generation:window.__yose_app.advanceLinkController.generation,operation:window.__yose_app.advanceLinkController.operation})'), owner); assert.deepEqual(await wholeRaw(d), before); await releaseGate(d); await finish(d, 'save'); assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getTransaction("repayment67")).advance_source_id)()'), 'advance67');
});

uiCase67(fixture, 'keeps both linked originals when closed-month unlink approval is cancelled', async d => {
	await watch(d); const period = { date: '2026-09-20', target_month: '2026-09' }; await seed(d, [source(period), repayment({ ...period, advance_source_id: 'advance67' })]); await cashflow(d); await d.fill('#input-period-picker', '2026-09'); await d.waitFor('document.querySelector("#month-tx-list [data-id=advance67]")'); await openAdvance(d); const before = await wholeRaw(d);
	await d.evaluate(`(()=>{const original=window.confirm;window.confirm=message=>{window.__dialogs.push({type:'confirm',message});return !message.includes('再月締め');};window.__restores67.push(()=>window.confirm=original);})()`); await d.click('#btn-unlink-advance'); await finish(d, 'save'); assert.deepEqual(await wholeRaw(d), before); assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /再月締め/); assert.equal(await d.isVisible('#modal-advance-link'), true);
});

uiCase67(fixture, 'keeps a new session editor untouched when an old post-close transport fails', async d => {
	await watch(d); await seed(d, [source(), repayment()]); await cashflow(d); await openAdvance(d);
	await d.evaluate(`(()=>{const manager=window.__yose_app.syncManager,original=manager.syncPendingDiffs;manager.syncPendingDiffs=()=>{const promise=new Promise((_,reject)=>window.__rejectTransport67=()=>reject(new Error('late offline transport')));window.__oldTransport67=promise;window.__workflowGates.push({release:()=>window.__rejectTransport67()});return promise;};window.__restores67.push(()=>manager.syncPendingDiffs=original);})()`); await d.click('#btn-save-advance-link'); await finish(d, 'save'); const committed = await wholeRaw(d); await unlockWorkflow(d); await cashflow(d); await d.click('#month-tx-list [data-id="repayment67"]'); await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active")&&document.getElementById("edit-tx-id").value==="repayment67"'); await d.fill('#edit-tx-memo', 'latest editor draft'); const notices = await d.evaluate('window.__workflowNotices.length');
	await d.evaluate('window.__rejectTransport67()'); await d.evaluate('Promise.allSettled([window.__oldTransport67])'); assert.deepEqual(await wholeRaw(d), committed); assert.equal(await value(d, '#edit-tx-memo'), 'latest editor draft'); assert.equal(await d.evaluate('window.__workflowNotices.length'), notices);
});

for (const unlink of [false, true]) uiCase67(fixture, `does not start a new-session refresh when an old committed ${unlink ? 'unlink' : 'link'} response completes`, async d => {
	await watch(d); await seed(d, [source(), repayment(unlink ? { advance_source_id: 'advance67' } : {})]); await cashflow(d); await openAdvance(d); await gateMethod(d, 'window.__yose_app.db', unlink ? 'unlinkAdvanceRepayment' : 'linkAdvanceRepayment', { afterRead: true }); await d.click(unlink ? '#btn-unlink-advance' : '#btn-save-advance-link'); await waitGate(d);
	const committed = await wholeRaw(d); await unlockWorkflow(d); await cashflow(d); await d.click('#month-tx-list [data-id="repayment67"]'); await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active")&&document.getElementById("edit-tx-id").value==="repayment67"'); await finish(d, 'openEditTransactionModal'); await d.fill('#edit-tx-memo', 'postcommit new draft'); await watchRefresh(d); const dialogs = await d.evaluate('window.__dialogs.length'), notices = await d.evaluate('window.__workflowNotices.length');
	await releaseGate(d); await finish(d, 'save'); assert.deepEqual(await wholeRaw(d), committed); assert.equal(await value(d, '#edit-tx-memo'), 'postcommit new draft'); assert.equal(await value(d, '#edit-tx-id'), 'repayment67'); assert.equal(await d.isVisible('#modal-edit-tx'), true); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs); assert.equal(await d.evaluate('window.__workflowNotices.length'), notices); assert.deepEqual(await d.evaluate('window.__refreshEntries67'), []);
});

uiCase67(fixture, 'keeps a new import preview and encrypted save busy while an obsolete committed confirmation finishes', async d => {
	await watch(d); await settings67(d); await preview(d, []); await gateMethod(d, 'window.__yose_app.db', 'commitReplacementImport', { afterRead: true }); await d.fill('#replacement-import-word', '完全インポート'); await d.click('#btn-confirm-replacement-import'); await waitGate(d); await d.evaluate('void(window.__oldImportJob67=window.__workflowJobs.find(job=>job.name==="confirm").promise)'); const committed = await wholeRaw(d);
	await unlockWorkflow(d); await d.click('.tab-btn[data-tab="tab-settings"]'); await d.waitFor('!document.getElementById("pending-import-panel").hidden'); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.busy'), false, 'new authentication must synchronously release the old busy owner');
	await d.click('#checkbox-replace-pending-import'); await preview(d, [transaction('new-session-import67', { amount: 200 })]); const newPlan = await d.evaluate('window.__yose_app.settingsController.backupImportController.plan.plan.id'); await gateMethod(d, 'window.__yose_app.db', 'encryptRecord'); await d.fill('#replacement-import-word', '完全インポート'); await d.click('#btn-confirm-replacement-import'); await waitGate(d, 2); await d.evaluate('void(window.__newImportJob67=window.__workflowJobs.filter(job=>job.name==="confirm").at(-1).promise)'); await watchRefresh(d); const dialogs = await d.evaluate('window.__dialogs.length');
	await releaseGate(d, 0); await d.evaluate('window.__oldImportJob67'); assert.deepEqual(await wholeRaw(d), committed); assert.deepEqual(await d.evaluate('window.__refreshEntries67'), []); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.busy'), true); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.plan.plan.id'), newPlan); assert.equal(await d.isVisible('#modal-replacement-import'), true); assert.equal(await value(d, '#replacement-import-word'), '完全インポート'); assert.equal(await d.evaluate('document.getElementById("checkbox-replace-pending-import").checked'), true); assert.equal(await d.evaluate('document.getElementById("btn-confirm-replacement-import").disabled'), true);
	await releaseGate(d, 1); await d.evaluate('window.__newImportJob67'); assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getTransaction("new-session-import67")).amount)()'), 200); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.busy'), false); assert.equal(await d.isVisible('#modal-replacement-import'), false);
});

uiCase67(fixture, 'passes a current owner predicate through a successful link refresh', async d => {
	await watch(d); await seed(d, [source(), repayment()]); await cashflow(d); await openAdvance(d); await watchRefresh(d); await d.click('#btn-save-advance-link'); await finish(d, 'save'); assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getTransaction("repayment67")).advance_source_id)()'), 'advance67'); const entries = await d.evaluate('window.__refreshEntries67'); assert.equal(entries.length, 1); assert.deepEqual(entries[0], { hasParent: true, valid: true });
});

uiCase67(fixture, 'retains its successful import owner after removing the preview plan and renders the pending panel', async d => {
	await watch(d); await settings67(d); await preview(d, []); await watchRefresh(d); await confirmImport(d); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.plan'), null); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.busy'), false); assert.match(await d.textContent('#pending-import-status'), /取引明細.*送信待ち/); const entries = await d.evaluate('window.__refreshEntries67'); assert.equal(entries.length, 1); assert.deepEqual(entries[0], { hasParent: true, valid: true });
});
