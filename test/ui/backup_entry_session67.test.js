import assert from 'node:assert/strict';
import { useBrowser, transaction } from '../helpers/ui_fixture.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';
import { gateMethod, waitGate, releaseGate, unlockWorkflow } from '../helpers/workflow_ui_fixture.js';
const fixture=useBrowser();
const importingFiles = new WeakMap();
function importFile67(d, ...args) {
	const promise = d.importFile(...args).then(() => ({ done: true }), error => ({ error: String(error) }));
	const pending = importingFiles.get(d) || []; pending.push(promise); importingFiles.set(d, pending);
	return promise;
}
function entryCase67(fixture, name, run) {
	uiCase67(fixture, name, async d => {
		try { await run(d); }
		finally {
			await d.evaluate('window.__workflowGates?.forEach(gate=>gate.release?.())');
			await d.evaluate('Promise.allSettled(window.__masterNativeJobs67 || [])');
			await Promise.allSettled(importingFiles.get(d) || []);
			importingFiles.delete(d);
		}
	});
}
const wholeRaw=d=>d.evaluate('(async()=>{const db=window.__yose_app.db;return {business:await db.captureImportState(),settings:await db.getAllRaw("settings"),keys:await db.getAllRaw("security_keys")};})()');
async function pending(d){await d.evaluate(`(async()=>{const db=window.__yose_app.db;await db.commitReplacementImport(await db.prepareReplacementImport([]),{confirmation:'完全インポート'});const original=await db.getPendingImport();await db.updatePendingImport(original,{...original,base_version:'old-base'});await window.__yose_app.settingsController.renderPendingImport();})()`);}
async function watch(d){await d.evaluate(`(()=>{const owner=window.__yose_app.settingsController.backupImportController;for(const name of ['preview','reapprove','confirm']){const original=owner[name];owner[name]=function(...args){const promise=original.apply(this,args);window.__workflowJobs.push({name,promise,settled:false});promise.then(()=>{},()=>{});return promise;};window.__restores67.push(()=>owner[name]=original);}})()`);}
const finish=(d,name)=>d.evaluate(`Promise.allSettled(window.__workflowJobs.filter(job=>job.name===${JSON.stringify(name)}).map(job=>job.promise))`);
entryCase67(fixture,'reapproval read belongs to the session before the first await',async d=>{
	await watch(d);await settings67(d);await pending(d);await gateMethod(d,'window.__yose_app.db','getPendingImport',{afterRead:true});await d.evaluate('window.__nextPromptText="完全インポート"');await d.click('#btn-reapprove-import');await waitGate(d);await unlockWorkflow(d);await d.click('.tab-btn[data-tab="tab-settings"]');await d.waitFor('!document.getElementById("pending-import-panel").hidden');const before=await wholeRaw(d),dialogs=await d.evaluate('window.__dialogs.length');await releaseGate(d);await finish(d,'reapprove');const actual=await wholeRaw(d);assert.deepEqual(actual,before,'obsolete read must not remove old-base');assert.equal(await d.evaluate('window.__dialogs.length'),dialogs,'obsolete read must not prompt/alert');
});
entryCase67(fixture,'reapproval committed response does not alert or refresh a new session',async d=>{
	await watch(d);await settings67(d);await pending(d);await gateMethod(d,'window.__yose_app.db','updatePendingImport',{afterRead:true});await d.evaluate('window.__nextPromptText="完全インポート"');await d.click('#btn-reapprove-import');await waitGate(d);await unlockWorkflow(d);await d.click('.tab-btn[data-tab="tab-settings"]');await d.waitFor('!document.getElementById("pending-import-panel").hidden');const before=await wholeRaw(d),dialogs=await d.evaluate('window.__dialogs.length');await releaseGate(d);await finish(d,'reapprove');assert.deepEqual(await wholeRaw(d),before);assert.equal(await d.evaluate('window.__dialogs.length'),dialogs,'obsolete committed response must not alert');
});
entryCase67(fixture,'preview prepare response cannot replace the new session preview',async d=>{
	await watch(d);await settings67(d);await gateMethod(d,'window.__yose_app.db','prepareReplacementImport',{afterRead:true});await d.evaluate('void(window.__oldPreview67=window.__yose_app.settingsController.backupImportController.preview([]))');await waitGate(d);await unlockWorkflow(d);await d.click('.tab-btn[data-tab="tab-settings"]');await d.evaluate(`window.__yose_app.settingsController.backupImportController.preview(${JSON.stringify([transaction('new-preview67',{amount:200})])})`);const before=await wholeRaw(d),plan=await d.evaluate('window.__yose_app.settingsController.backupImportController.plan.plan.id');await releaseGate(d);await d.evaluate('Promise.allSettled([window.__oldPreview67])');assert.deepEqual(await wholeRaw(d),before);assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.plan.plan.id'),plan,'new-session plan must remain selected');
});
for(const mode of ['merge','replace'])entryCase67(fixture,`native file.text ${mode} does not start import in the new session`,async d=>{
	await watch(d);await settings67(d);await d.select('#select-import-mode',mode);await observeNativeEvent67(d,'#file-import-input','change');await gateMethod(d,'Blob.prototype','text',{afterRead:true});const importing=importFile67(d,JSON.stringify([transaction('old-file67',{amount:123})]));await waitGate(d);await unlockWorkflow(d);await d.click('.tab-btn[data-tab="tab-settings"]');const before=await wholeRaw(d),dialogs=await d.evaluate('window.__dialogs.length');await releaseGate(d);await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');assert.deepEqual(await importing,{done:true});assert.deepEqual(await wholeRaw(d),before,'obsolete file must not write in the new session');assert.equal(await d.isVisible('#modal-replacement-import'),false,'obsolete file must not open preview');assert.equal(await d.evaluate('window.__dialogs.length'),dialogs,'obsolete file must not notify');
});

entryCase67(fixture,'preview completion cannot adopt a same-key newer epoch',async d=>{
	await watch(d);await settings67(d);await gateMethod(d,'window.__yose_app.db','prepareReplacementImport',{afterRead:true});await d.evaluate('void(window.__oldPreview67=window.__yose_app.settingsController.backupImportController.preview([]))');await waitGate(d);await d.evaluate('(()=>{const db=window.__yose_app.db;window.__previewKey67=db.encryptionKey;window.__previewGen67=db.keyGeneration;db.setEncryptionKey(db.encryptionKey);})()');assert.equal(await d.evaluate('window.__previewKey67===window.__yose_app.db.encryptionKey&&window.__yose_app.db.keyGeneration>window.__previewGen67'),true);const before=await wholeRaw(d);await releaseGate(d);await d.evaluate('Promise.allSettled([window.__oldPreview67])');assert.deepEqual(await wholeRaw(d),before);assert.equal(await d.isVisible('#modal-replacement-import'),false,'obsolete preview must not open on newer key generation');
});
entryCase67(fixture,'native additive import preserves the session captured before pending read',async d=>{
	await watch(d);await settings67(d);await d.select('#select-import-mode','merge');await observeNativeEvent67(d,'#file-import-input','change');await gateMethod(d,'window.__yose_app.db','getPendingImport',{afterRead:true});const importing=importFile67(d,JSON.stringify([transaction('old-merge-read67',{amount:157})]));await waitGate(d);await unlockWorkflow(d);await d.click('.tab-btn[data-tab="tab-settings"]');const before=await wholeRaw(d),dialogs=await d.evaluate('window.__dialogs.length');await releaseGate(d);await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');assert.deepEqual(await importing,{done:true});assert.deepEqual(await wholeRaw(d),before,'old import must not capture the new DB session after its initial pending read');assert.equal(await d.evaluate('window.__dialogs.length'),dialogs);
});
entryCase67(fixture,'native additive import does not notify after encryption rejects the expired session',async d=>{
	await watch(d);await settings67(d);await d.select('#select-import-mode','merge');await observeNativeEvent67(d,'#file-import-input','change');await gateMethod(d,'window.__yose_app.db','encryptRecord',{afterRead:true});const importing=importFile67(d,JSON.stringify([transaction('old-merge-aes67',{amount:165})]));await waitGate(d);await unlockWorkflow(d);await d.click('.tab-btn[data-tab="tab-settings"]');const before=await wholeRaw(d),dialogs=await d.evaluate('window.__dialogs.length');await releaseGate(d);await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');assert.deepEqual(await importing,{done:true});assert.deepEqual(await wholeRaw(d),before);assert.equal(await d.evaluate('window.__dialogs.length'),dialogs,'obsolete AES rejection must not paint new-session failure');
});
entryCase67(fixture,'native backup export cannot download or close a newly opened modal after reauthentication',async d=>{
	await settings67(d);await observeNativeEvent67(d,'#btn-export-backup');await gateMethod(d,'window.__yose_app.db','exportFullData',{afterRead:true});await d.evaluate(`(()=>{const click=HTMLAnchorElement.prototype.click;window.__downloadCalls67=[];HTMLAnchorElement.prototype.click=function(...args){if(this.download)window.__downloadCalls67.push(this.download);return click.apply(this,args);};window.__restores67.push(()=>HTMLAnchorElement.prototype.click=click);})()`);await d.click('#btn-export-backup');await waitGate(d);await unlockWorkflow(d);await d.click('.tab-btn[data-tab="tab-settings"]');await d.click('#btn-open-export-modal');const before=await wholeRaw(d);await releaseGate(d);await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');assert.deepEqual(await wholeRaw(d),before);assert.deepEqual(await d.evaluate('window.__downloadCalls67'),[],'expired export must not trigger the actual download anchor');assert.equal(await d.isVisible('#modal-export-json'),true,'new export modal must remain open');
});

entryCase67(fixture, 'old file finally preserves the new session file and its active replacement read', async d => {
	await watch(d); await settings67(d); await d.select('#select-import-mode', 'merge');
	await observeNativeEvent67(d, '#file-import-input', 'change'); await gateMethod(d, 'Blob.prototype', 'text', { afterRead: true, repeat: true });
	const first = importFile67(d, JSON.stringify([transaction('old-file-finally67')]), 'old.json');
	await waitGate(d); await unlockWorkflow(d); await d.click('.tab-btn[data-tab="tab-settings"]'); await d.select('#select-import-mode', 'replace');
	const second = importFile67(d, JSON.stringify([transaction('new-file-finally67', { amount: 211 })]), 'new.json');
	await waitGate(d, 2); const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length');
	const selected = await d.evaluate('({name:document.getElementById("file-import-input").files[0]?.name,value:document.getElementById("file-import-input").value})');
	assert.equal(selected.name, 'new.json'); assert.ok(selected.value);
	await releaseGate(d, 0); await d.evaluate('Promise.allSettled([window.__masterNativeJobs67[0]])');
	const actual = { raw: await wholeRaw(d), dialogs: await d.evaluate('window.__dialogs.length'), file: await d.evaluate('({name:document.getElementById("file-import-input").files[0]?.name,value:document.getElementById("file-import-input").value})') };
	await releaseGate(d, 1); await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)'); assert.deepEqual(await Promise.all([first, second]), [{ done: true }, { done: true }]);
	assert.deepEqual(actual, { raw: before, dialogs, file: selected });
	assert.equal(await d.isVisible('#modal-replacement-import'), true);
	assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.plan.plan.data.transactions[0].id'), 'new-file-finally67');
});

for (const [kind, button, store, key] of [
	['full', 'btn-export-full', 'master_config', 'current'],
	['transactions', 'btn-export-transactions', 'transactions', 'corrupted-export67'],
	['master', 'btn-export-master', 'master_config', 'current'],
	['budgets', 'btn-export-budgets', 'master_config', 'current'],
	['snapshot', 'btn-export-snapshot', 'summary_snapshot', 'current'],
	['direct-backup', 'btn-export-backup', 'master_config', 'current']
]) entryCase67(fixture, `reports a current-session real AES failure during ${kind} export without downloading or changing raw data`, async d => {
	await settings67(d); await d.evaluate(`window.__yose_app.db.putTransaction(${JSON.stringify(transaction('corrupted-export67'))})`);
	if (kind !== 'direct-backup') await d.click('#btn-open-export-modal');
	await observeNativeEvent67(d, `#${button}`);
	await d.evaluate(`(async()=>{const db=window.__yose_app.db,row=await db.getRaw(${JSON.stringify(store)},${JSON.stringify(key)});if(!row.encrypted||!row.ciphertext)throw new Error('real encrypted fixture is required');row.ciphertext=(row.ciphertext[0]==='A'?'B':'A')+row.ciphertext.slice(1);await db.putRaw(${JSON.stringify(store)},row,${store === 'transactions' ? 'undefined' : JSON.stringify(key)});const click=HTMLAnchorElement.prototype.click;window.__failedExportDownloads67=[];HTMLAnchorElement.prototype.click=function(...args){if(this.download)window.__failedExportDownloads67.push(this.download);return click.apply(this,args);};window.__restores67.push(()=>HTMLAnchorElement.prototype.click=click);})()`);
	const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length');
	await d.click(`#${button}`); const outcomes = await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');
	assert.ok(outcomes.length > 0); assert.ok(outcomes.every(result => result.status === 'fulfilled'), 'handled export failure must fulfill its real native event Promise');
	assert.deepEqual(await wholeRaw(d), before); assert.deepEqual(await d.evaluate('window.__failedExportDownloads67'), []);
	const notices = await d.evaluate(`window.__dialogs.slice(${dialogs}).filter(dialog=>dialog.type==='alert').map(dialog=>dialog.message)`);
	assert.equal(notices.length, 1, 'an active decryption failure must be reported once'); assert.match(notices[0], /エクスポート|出力/); assert.match(notices[0], /decryption failed|復号/);
	if (kind !== 'direct-backup') assert.equal(await d.isVisible('#modal-export-json'), true, 'failed export leaves the current modal available for recovery');
});

entryCase67(fixture, 'a preview started during native key generation cannot use the earlier private key after that generation completes', async d => {
	await watch(d); await settings67(d); await d.click('#btn-toggle-key-details');
	await gateMethod(d, 'SubtleCrypto.prototype', 'generateKey', { afterRead: true }); await d.evaluate('window.__nextPromptText="1234"'); await d.click('#btn-generate-key'); await waitGate(d);
	await d.evaluate('window.__previewOriginPrivate67=window.__yose_app.privateKey;window.__previewOriginAuth67=window.__yose_app.authController.authGeneration;window.__previewOriginDBGen67=window.__yose_app.db.keyGeneration');
	await gateMethod(d, 'window.__yose_app.db', 'prepareReplacementImport', { afterRead: true }); await d.evaluate('void(window.__oldPreview67=window.__yose_app.settingsController.backupImportController.preview([]))'); await waitGate(d, 2);
	await releaseGate(d, 0); await d.evaluate('Promise.allSettled(window.__workflowJobs.filter(job=>job.name==="generateNewKeyPair").map(job=>job.promise))');
	assert.equal(await d.evaluate('window.__yose_app.privateKey!==window.__previewOriginPrivate67&&window.__yose_app.authController.authGeneration===window.__previewOriginAuth67&&window.__yose_app.db.keyGeneration===window.__previewOriginDBGen67'), true, 'the actual signature key changes after entry without another auth/db generation change');
	const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length'); await releaseGate(d, 1); await finish(d, 'preview');
	assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.isVisible('#modal-replacement-import'), false); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.plan'), null); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs);
});

for (const stage of ['file-text', 'preview']) entryCase67(fixture, `clears the old selected file synchronously when locked during ${stage} without letting its completion clear a later selection`, async d => {
	await watch(d); await settings67(d); await d.select('#select-import-mode', 'replace'); await observeNativeEvent67(d, '#file-import-input', 'change');
	await gateMethod(d, stage === 'file-text' ? 'Blob.prototype' : 'window.__yose_app.db', stage === 'file-text' ? 'text' : 'prepareReplacementImport', { afterRead: true });
	const importing = importFile67(d, JSON.stringify([transaction('cancel-selected-file67')]), 'cancel-original.json'); await waitGate(d);
	assert.equal(await d.evaluate('document.getElementById("file-import-input").files[0]?.name'), 'cancel-original.json');
	await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
	const cancelled = await d.evaluate('({value:document.getElementById("file-import-input").value,count:document.getElementById("file-import-input").files.length})');
	const imported = await importing;
	await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin'); await d.waitFor('!window.__yose_app.isKeyLocked'); await finish(d, 'finishAppInit'); await d.click('.tab-btn[data-tab="tab-settings"]');
	await d.evaluate('(()=>{const transfer=new DataTransfer();transfer.items.add(new File(["[]"],"new-selection.json",{type:"application/json"}));document.getElementById("file-import-input").files=transfer.files;})()');
	const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length'); await releaseGate(d); const results = await d.evaluate('Promise.allSettled(window.__masterNativeJobs67)');
	assert.ok(results.every(result => result.status === 'fulfilled')); assert.deepEqual(cancelled, { value: '', count: 0 }, 'lock must synchronously discard the old file intent');
	assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.evaluate('document.getElementById("file-import-input").files[0]?.name'), 'new-selection.json'); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs);
	assert.deepEqual(imported, { done: true }, 'the original file operation must settle after cancellation');
});

for (const method of ['preview', 'reapprove']) entryCase67(fixture, `locked public ${method} returns before the first backup database read`, async d => {
	await settings67(d); if (method === 'reapprove') await pending(d); await d.evaluate('window.__yose_app.authController.lockPrivateKey()'); const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length');
	const r = await d.evaluate(`(async()=>{const app=window.__yose_app,db=app.db,name=${JSON.stringify(method === 'preview' ? 'prepareReplacementImport' : 'getPendingImport')},original=db[name];let reads=0;db[name]=function(...args){reads++;return original.apply(this,args);};try{await app.settingsController.backupImportController.${method}(${method === 'preview' ? '[]' : ''});return{reads,plan:app.settingsController.backupImportController.plan};}finally{db[name]=original;}})()`);
	assert.deepEqual(r, { reads: 0, plan: null }); assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs);
});
entryCase67(fixture, 'common external modal closure cancels the existing replacement selection and word synchronously', async d => {
	await settings67(d); await d.evaluate('window.__yose_app.settingsController.backupImportController.preview([])'); await d.fill('#replacement-import-word', '完全インポート'); const before = await wholeRaw(d);
	assert.equal(await d.evaluate('Boolean(window.__yose_app.settingsController.backupImportController.plan)'), true); await d.evaluate('window.__yose_app.closeTopModal()'); await d.waitFor('window.__yose_app.settingsController.backupImportController.plan===null');
	assert.equal(await d.isVisible('#modal-replacement-import'), false); assert.equal(await d.evaluate('document.getElementById("replacement-import-word").value'), ''); assert.equal(await d.evaluate('document.getElementById("btn-confirm-replacement-import").disabled'), true); assert.deepEqual(await wholeRaw(d), before);
});
async function installActualBackupSync67(d) {
	await d.evaluate(`(async()=>{const app=window.__yose_app,{SyncManager}=await import('/js/sync.js'),{verifySignedRequest}=await import('/js/crypto.js'),{captureRenderSession}=await import('/js/ui/render_session.js');app.syncManager.detachEventListeners();let manager;manager=new SyncManager({db:app.db,privateKey:app.privateKey,gasUrl:'https://backup-busy67.fixture/exec',captureSession:()=>captureRenderSession(app,()=>app.syncManager===manager),customFetch:async(_url,options)=>{const request=JSON.parse(options.body);if(!(await verifySignedRequest(request,app.authController.publicKey)).valid)throw new Error('invalid signed request');const gate={release:null,action:request.action};window.__workflowGates.push(gate);await new Promise(resolve=>gate.release=resolve);return{ok:true,text:async()=>JSON.stringify({success:false,error:'BACKUP_BUSY_SERVER_FAILURE'})};}});app.syncManager=manager;})()`);
}
async function startActualBackupSync67(d) {
	await d.evaluate(`(()=>{const manager=window.__yose_app.syncManager,promise=manager.syncMaster().then(value=>({value}),error=>({error:error.message}));window.__busyBackupSync67=promise;const job={name:'backupBusySync67',promise,settled:false};window.__workflowJobs.push(job);promise.then(()=>job.settled=true,()=>job.settled=true);})()`);
	await waitGate(d, 2); assert.equal(await d.evaluate('window.__yose_app.syncManager.isSyncing'), true); assert.ok(await d.evaluate('window.__workflowGates[1].action'));
}
for (const method of ['preview', 'reapprove']) entryCase67(fixture, `real signed sync beginning during the backup ${method} read refuses stale approval without changing raw data`, async d => {
	await watch(d); await settings67(d); if (method === 'reapprove') await pending(d); await installActualBackupSync67(d); await gateMethod(d, 'window.__yose_app.db', method === 'preview' ? 'prepareReplacementImport' : 'getPendingImport', { afterRead: true }); await d.evaluate('window.__nextPromptText="完全インポート"');
	await d.evaluate(`void(window.__busyOld67=window.__yose_app.settingsController.backupImportController.${method}(${method === 'preview' ? '[]' : ''}).then(value=>({value}),error=>({error:error.message})))`); await waitGate(d); await startActualBackupSync67(d); const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length');
	await releaseGate(d, 0); const result = await d.evaluate('window.__busyOld67'); if (method === 'preview') { assert.match(result.error || '', /同期状態が変更/); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.plan'), null); } else { const notices = await d.evaluate(`window.__dialogs.slice(${dialogs})`); assert.equal(notices.filter(x => /再確認に失敗.*同期状態が変更/.test(x.message)).length, 1); assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getPendingImport()).base_version)()'), 'old-base'); }
	assert.deepEqual(await wholeRaw(d), before); await releaseGate(d, 1); const sync = await d.evaluate('window.__busyBackupSync67'); assert.match(sync.error || '', /BACKUP_BUSY_SERVER_FAILURE/); assert.deepEqual(await wholeRaw(d), before);
});
entryCase67(fixture, 'obsolete reapproval atomic refusal does not notify or change the new session pending data', async d => {
	await watch(d); await settings67(d); await pending(d); await gateMethod(d, 'window.__yose_app.db', 'updatePendingImport'); await d.evaluate('window.__nextPromptText="完全インポート"'); await d.click('#btn-reapprove-import'); await waitGate(d);
	await unlockWorkflow(d); await d.click('.tab-btn[data-tab="tab-settings"]'); const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length'); await releaseGate(d); const jobs = await finish(d, 'reapprove'); assert.ok(jobs.every(job => job.status === 'fulfilled')); assert.deepEqual(await wholeRaw(d), before); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs); assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getPendingImport()).base_version)()'), 'old-base');
});

entryCase67(fixture, 'keeps the latest originals and restores the selected confirmation after an actual current-session replacement CAS conflict', async d => {
	await watch(d); await settings67(d); await d.evaluate('window.__yose_app.settingsController.backupImportController.preview([])'); const plan = await d.evaluate('window.__yose_app.settingsController.backupImportController.plan.plan.id');
	await d.evaluate(`window.__yose_app.db.putTransaction(${JSON.stringify(transaction('arrived-after-preview67', { amount: 321 }))})`); const before = await wholeRaw(d), dialogs = await d.evaluate('window.__dialogs.length'); await d.fill('#replacement-import-word', '完全インポート'); await d.click('#btn-confirm-replacement-import'); const jobs = await finish(d, 'confirm'); assert.equal(jobs.length, 1); assert.ok(jobs.every(job => job.status === 'fulfilled'));
	assert.deepEqual(await wholeRaw(d), before); assert.match(await d.textContent('#replacement-import-error'), /確認中にデータが変更/); assert.equal(await d.isVisible('#modal-replacement-import'), true); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.plan.plan.id'), plan); assert.equal(await d.evaluate('window.__yose_app.settingsController.backupImportController.busy'), false); assert.equal(await d.evaluate('document.getElementById("btn-confirm-replacement-import").disabled'), false); assert.equal(await d.evaluate('document.getElementById("replacement-import-word").value'), '完全インポート'); assert.equal(await d.evaluate('window.__dialogs.length'), dialogs);
});
entryCase67(fixture, 'normally reapproves the actual pending identity and content while clearing only its obsolete base version', async d => {
	await watch(d); await settings67(d); await pending(d); const before = await wholeRaw(d), original = await d.evaluate('window.__yose_app.db.getPendingImport()'), dialogs = await d.evaluate('window.__dialogs.length'); await d.evaluate('window.__nextPromptText="完全インポート"'); await d.click('#btn-reapprove-import'); const jobs = await finish(d, 'reapprove'); assert.equal(jobs.length, 1); assert.ok(jobs.every(job => job.status === 'fulfilled'));
	const expected = structuredClone(original); delete expected.base_version; assert.deepEqual(await d.evaluate('window.__yose_app.db.getPendingImport()'), expected); const after = await wholeRaw(d), { pending: oldPending, ...oldBusiness } = before.business, { pending: newPending, ...newBusiness } = after.business; assert.deepEqual(newBusiness, oldBusiness); assert.deepEqual(after.settings, before.settings); assert.deepEqual(after.keys, before.keys); const notices = await d.evaluate(`window.__dialogs.slice(${dialogs})`); assert.equal(notices.filter(x => x.type === 'prompt').length, 1); assert.equal(notices.filter(x => x.type === 'alert' && x.message.includes('再承認しました')).length, 1); assert.equal(await d.evaluate('document.getElementById("pending-import-panel").hidden'), false); assert.equal(await d.evaluate('window.__yose_app.syncManager.isSyncing'), false);
});
