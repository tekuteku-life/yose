import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, settings, value, waitForDialog } from '../helpers/ui_fixture.js';

async function preview(d, data) {
	await settings(d);
	await d.select('#select-import-mode', 'replace');
	await d.importFile(JSON.stringify(data));
	await d.waitFor('document.getElementById("modal-replacement-import").classList.contains("active")');
}
async function approve(d) {
	await d.fill('#replacement-import-word', '完全インポート');
	await d.click('#btn-confirm-replacement-import');
}

describe('Complete JSON import confirmation and recovery', () => {
	const fixture = useBrowser();

	it('keeps merge as default and takes same-timestamp edited JSON only after exact magic input', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('keep'), transaction('remove')]);
		await settings(d);
		assert.equal(await value(d, '#select-import-mode'), 'merge');
		await preview(d, { export_type: 'transactions', transactions: [transaction('keep', { amount: 5432 })] });
		assert.match(await d.evaluate('document.getElementById("replacement-import-summary").textContent'), /サーバー|Google Drive/);
		assert.equal((await records(d)).length, 2);
		for (const text of ['OK', '完全インポート ']) {
			await d.fill('#replacement-import-word', text);
			assert.equal(await d.evaluate('document.getElementById("btn-confirm-replacement-import").disabled'), true);
		}
		await approve(d);
		await waitForDialog(d, '完全インポート完了');
		assert.equal(await d.isVisible('#modal-replacement-import'), false);
		assert.deepEqual((await records(d)).map(tx => [tx.id, tx.amount]), [['keep', 5432]]);
		assert.equal((await d.evaluate('window.__yose_app.db.getPendingImport()')).data.transactions[0].amount, 5432);
		await d.waitFor('document.getElementById("pending-import-status").textContent.includes("送信待ち")');
		assert.equal(await value(d, '#file-import-input'), '');
	});

	for (const close of ['cancel', 'escape', 'back', 'lock']) {
		it(`leaves all data unchanged when confirmation ends through ${close}`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('keep')]);
			await preview(d, []);
			if (close === 'cancel') await d.click('#btn-cancel-replacement-import');
			if (close === 'escape') await d.key('#replacement-import-word', 'Escape');
			if (close === 'back') await d.evaluate('history.back()');
			if (close === 'lock') await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
			await d.waitFor('!document.getElementById("modal-replacement-import").classList.contains("active")');
			if (close === 'lock') {
				await d.fill('#auth-pin-input', '1234');
				await d.click('#btn-auth-pin');
				await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
			}
			assert.deepEqual((await records(d)).map(tx => tx.id), ['keep']);
			assert.equal(await d.evaluate('window.__yose_app.db.getPendingImport()'), null);
		});
	}

	for (const action of ['back', 'escape']) {
		it(`cancels an in-flight encrypted import on ${action} before any store changes`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('keep')]);
			await preview(d, []);
			await d.evaluate(`window.__encryptPaused = false; window.__importFinished = false; const db = window.__yose_app.db; const encrypt = db.encryptRecord.bind(db); let first = true; db.encryptRecord = async (...args) => { if (first) { first=false; window.__encryptPaused=true; await new Promise(resolve=>{window.__releaseImport=resolve;}); } return encrypt(...args); }; const confirm=window.__yose_app.settingsController.backupImportController.confirm.bind(window.__yose_app.settingsController.backupImportController); window.__yose_app.settingsController.backupImportController.confirm=async()=> {try{return await confirm();}finally{window.__importFinished=true;}};`);
			await approve(d);
			await d.waitFor('window.__encryptPaused');
			if (action === 'back') await d.evaluate('history.back()');
			else await d.key('#replacement-import-word', 'Escape');
			await d.waitFor('!document.getElementById("modal-replacement-import").classList.contains("active")');
			await d.evaluate('window.__releaseImport()');
			await d.waitFor('window.__importFinished');
			assert.deepEqual((await records(d)).map(tx => tx.id), ['keep']);
			assert.equal(await d.evaluate('window.__yose_app.db.getPendingImport()'), null);
		});
	}

	it('refuses confirmation after a concurrent local edit without losing either record', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('keep')]);
		await preview(d, []);
		await seed(d, [transaction('later')]);
		await approve(d);
		await d.waitFor('document.getElementById("replacement-import-error").textContent.includes("変更")');
		assert.deepEqual((await records(d)).map(tx => tx.id).sort(), ['keep', 'later']);
		assert.equal(await d.evaluate('window.__yose_app.db.getPendingImport()'), null);
	});

	it('rolls back every IndexedDB store if a write throws halfway through the atomic replacement', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('keep')]);
		const backup = await d.evaluate('window.__yose_app.db.exportFullData()');
		backup.transactions = [transaction('replacement')];
		backup.master_config.accounts[0].name = '置換後';
		await preview(d, backup);
		await d.evaluate(`window.__originalIDBPut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { if (this.name === 'summary_snapshot') throw new Error('injected atomic write failure'); return window.__originalIDBPut.apply(this, args); };`);
		await approve(d);
		await d.waitFor('document.getElementById("replacement-import-error").textContent.includes("injected")');
		await d.evaluate('IDBObjectStore.prototype.put = window.__originalIDBPut');
		assert.deepEqual((await records(d)).map(tx => tx.id), ['keep']);
		assert.notEqual(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).accounts[0].name)()'), '置換後');
		assert.equal(await d.evaluate('window.__yose_app.db.getPendingImport()'), null);
	});

	it('clears the confirmation word on reopen and reapproves a pending base only with an exact word', async () => {
		const d = fixture.driver;
		await preview(d, []);
		await d.fill('#replacement-import-word', '完全インポート');
		await d.click('#btn-cancel-replacement-import');
		await preview(d, []);
		assert.equal(await value(d, '#replacement-import-word'), '');
		await approve(d);
		await waitForDialog(d, '完全インポート完了');
		await d.evaluate(`(async()=> {const db=window.__yose_app.db; const p=await db.getPendingImport(); await db.updatePendingImport(p, {...p, base_version:'old-server'}); await window.__yose_app.settingsController.renderPendingImport();})()`);
		for (const word of [null, 'OK']) {
			await d.evaluate(`window.__nextPromptText = ${JSON.stringify(word)}`);
			await d.click('#btn-reapprove-import');
			assert.equal((await d.evaluate('window.__yose_app.db.getPendingImport()')).base_version, 'old-server');
		}
		await d.evaluate('window.__nextPromptText = "完全インポート"');
		await d.click('#btn-reapprove-import');
		await d.waitFor('(async()=> !(await window.__yose_app.db.getPendingImport()).base_version)()');
		assert.equal((await d.evaluate('window.__yose_app.db.getPendingImport()')).data.transactions.length, 0);
	});

	it('can replace an unresolved pending operation with a corrected file only after explicit opt-in and magic', async () => {
		const d = fixture.driver;
		await preview(d, [transaction('old')]);
		await approve(d);
		await waitForDialog(d, '完全インポート完了');
		await d.waitFor('!window.__yose_app.settingsController.backupImportController.busy');
		const original = await d.evaluate('window.__yose_app.db.getPendingImport()');
		await d.click('#checkbox-replace-pending-import');
		await preview(d, [transaction('corrected')]);
		assert.match(await d.evaluate('document.getElementById("replacement-import-summary").textContent'), /送信待ち.*置き換え/);
		await d.click('#btn-cancel-replacement-import');
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getPendingImport()'), original);
		await preview(d, [transaction('corrected')]);
		await approve(d);
		await d.waitFor('(async()=> (await window.__yose_app.db.getPendingImport()).id !== ' + JSON.stringify(original.id) + ')()');
		assert.deepEqual((await records(d)).map(tx => tx.id), ['corrected']);
	});

	it('rejects invalid data before showing confirmation and prevents import while another is pending', async () => {
		const d = fixture.driver;
		await settings(d);
		await d.select('#select-import-mode', 'replace');
		await d.importFile(JSON.stringify([transaction('bad', { amount: 'markup' })]));
		await waitForDialog(d, 'インポート失敗');
		assert.equal(await d.isVisible('#modal-replacement-import'), false);
		await preview(d, []);
		await approve(d);
		await waitForDialog(d, '完全インポート完了');
		await d.waitFor('!window.__yose_app.settingsController.backupImportController.busy && document.getElementById("pending-import-status").textContent.includes("送信待ち")');
		await d.importFile(JSON.stringify([]));
		await d.waitFor('window.__dialogs.at(-1).message.includes("送信待ち")');
	});
});
