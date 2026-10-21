import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, value } from '../helpers/ui_fixture.js';

const details = [
	{ id: 'conflict-0', path: 'accounts.account_a.name', label: '口座「現金」の名前', localValue: '手元の現金', remoteValue: 'サーバーの現金', hasLocal: true, hasRemote: true },
	{ id: 'conflict-1', path: 'categories.category_a.name', label: '費目「食費」の名前', localValue: '手元の食費', remoteValue: 'サーバーの食費', hasLocal: true, hasRemote: true }
];

describe('Master conflict comparison and resolution', { timeout: 120000 }, () => {
	const fixture = useBrowser();
	async function open(d, conflicts = details, resultName = '__conflictResult') {
		await d.evaluate(`window[${JSON.stringify(resultName)}] = 'pending'; void window.__yose_app.masterConflictController.resolve(${JSON.stringify(conflicts)}).then(result => { window[${JSON.stringify(resultName)}] = result; });`);
		await d.waitFor('document.getElementById("modal-master-conflict").classList.contains("active")');
	}

	for (const side of ['local', 'remote']) {
		it(`selects all ${side} values and applies only after explicit resolution`, async () => {
			const d = fixture.driver;
			await open(d);
			assert.equal(await d.evaluate('document.getElementById("btn-apply-master-conflict").disabled'), true);
			await d.click(`#btn-master-conflict-all-${side}`);
			assert.equal(await d.evaluate('window.__conflictResult'), 'pending');
			assert.equal(await d.evaluate('document.getElementById("btn-apply-master-conflict").disabled'), false);
			await d.click('#btn-apply-master-conflict');
			await d.waitFor('window.__conflictResult !== "pending"');
			assert.deepEqual(await d.evaluate('window.__conflictResult'), { 'conflict-0': side, 'conflict-1': side });
		});
	}

	it('supports mixed choices and disables resolution again after clearing one choice', async () => {
		const d = fixture.driver;
		await open(d);
		await d.select('[data-conflict-id="conflict-0"] select', 'local');
		assert.equal(await d.evaluate('document.getElementById("btn-apply-master-conflict").disabled'), true);
		await d.select('[data-conflict-id="conflict-1"] select', 'remote');
		assert.equal(await d.evaluate('document.getElementById("btn-apply-master-conflict").disabled'), false);
		await d.select('[data-conflict-id="conflict-0"] select', '');
		assert.equal(await d.evaluate('document.getElementById("btn-apply-master-conflict").disabled'), true);
		await d.evaluate('document.getElementById("btn-apply-master-conflict").dispatchEvent(new MouseEvent("click", { bubbles: true }))');
		assert.equal(await d.evaluate('window.__conflictResult'), 'pending');
		await d.select('[data-conflict-id="conflict-0"] select', 'local');
		await d.click('#btn-apply-master-conflict');
		assert.deepEqual(await d.evaluate('window.__conflictResult'), { 'conflict-0': 'local', 'conflict-1': 'remote' });
	});

	it('displays human labels and distinguishes deletion, null, empty values and structured detail', async () => {
		const d = fixture.driver;
		await open(d, [
			{ ...details[0], localValue: '', remoteValue: null },
			{ ...details[1], hasLocal: false, localValue: null, remoteValue: { nested: ['value', 2], enabled: false } },
			{ ...details[0], id: 'conflict-2', label: '対象の一覧', localValue: [], remoteValue: [1, 2] }
		]);
		const text = await d.evaluate('document.getElementById("master-conflict-list").textContent');
		for (const term of ['口座「現金」の名前', '費目「食費」の名前', '空文字', 'null', '削除', 'オブジェクト', '配列']) assert.ok(text.includes(term), term);
		await d.click('[data-conflict-id="conflict-1"] details summary');
		assert.ok((await d.evaluate('document.querySelector("[data-conflict-id=conflict-1] pre").textContent')).includes('"nested"'));
		assert.ok((await d.evaluate('document.getElementById("master-conflict-note").textContent')).includes('明細'));
	});

	for (const action of ['cancel', 'close', 'escape', 'back']) {
		it(`cancels using ${action} while retaining settings, records and history`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('already_synced', { sync_status: 'synced' })]);
			const before = await d.evaluate('(async () => ({ config: await window.__yose_app.db.getMasterConfig(), length: history.length }))()');
			await open(d);
			await d.click('#btn-master-conflict-all-local');
			if (action === 'cancel') await d.click('#btn-cancel-master-conflict');
			if (action === 'close') await d.click('#btn-close-master-conflict');
			if (action === 'escape') await d.key('#btn-close-master-conflict', 'Escape');
			if (action === 'back') await d.evaluate('history.back()');
			await d.waitFor('window.__conflictResult === false');
			if (action === 'back') await d.waitFor('history.state?.yoseGuard');
			assert.equal(await d.isVisible('#modal-master-conflict'), false);
			assert.deepEqual(await d.evaluate('window.__yose_app.db.getMasterConfig()'), before.config);
			assert.equal((await records(d))[0].sync_status, 'synced');
			assert.equal(await d.evaluate('history.length'), before.length);
			assert.equal(await d.evaluate('document.querySelector("main").inert'), false);
		});
	}

	it('settles cancelled on authentication lock and can resolve again after unlocking', async () => {
		const d = fixture.driver;
		await open(d);
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		await d.waitFor('window.__conflictResult === false');
		assert.equal(await d.evaluate('document.getElementById("auth-screen").inert'), false);
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		await open(d);
		await d.click('#btn-master-conflict-all-remote');
		await d.click('#btn-apply-master-conflict');
		await d.waitFor('window.__conflictResult !== "pending"');
		assert.deepEqual(await d.evaluate('window.__conflictResult'), { 'conflict-0': 'remote', 'conflict-1': 'remote' });
	});

	it('renders labels and scalar and structured values as text without creating HTML', async () => {
		const d = fixture.driver;
		await open(d, [{ ...details[0], label: '<img src=x onerror=alert(1)>', localValue: '<svg onload=alert(1)>', remoteValue: { value: '</pre><img src=x onerror=alert(1)>' } }]);
		assert.equal(await d.evaluate('document.querySelector("#master-conflict-list img, #master-conflict-list svg")'), null);
		assert.ok((await d.evaluate('document.getElementById("master-conflict-list").textContent')).includes('<svg onload=alert(1)>'));
	});

	it('keeps comparison values and choices operable at mobile width with an inert background', async () => {
		const d = fixture.driver;
		await d.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true }, d.sessionId);
		await open(d, [{ ...details[0], localValue: '長い値'.repeat(80), remoteValue: '長いサーバー値'.repeat(80) }]);
		assert.equal(await d.evaluate('document.querySelector("main").inert'), true);
		assert.equal(await d.evaluate('document.querySelector("#modal-master-conflict .modal").scrollWidth <= document.querySelector("#modal-master-conflict .modal").clientWidth'), true);
		await d.select('[data-conflict-id="conflict-0"] select', 'remote');
		await d.click('#btn-apply-master-conflict');
		assert.deepEqual(await d.evaluate('window.__conflictResult'), { 'conflict-0': 'remote' });
	});

	it('cancels a replaced pending dialog and resets choices for subsequent conflicts', async () => {
		const d = fixture.driver;
		await open(d);
		await d.click('#btn-master-conflict-all-local');
		await open(d, [{ ...details[0], remoteValue: '再競合値' }], '__secondResult');
		assert.equal(await d.evaluate('window.__conflictResult'), false);
		assert.equal(await value(d, '[data-conflict-id="conflict-0"] select'), '');
		assert.equal(await d.evaluate('document.getElementById("btn-apply-master-conflict").disabled'), true);
		assert.ok((await d.evaluate('document.getElementById("master-conflict-list").textContent')).includes('再競合値'));
		await d.click('#btn-cancel-master-conflict');
		await d.waitFor('window.__secondResult === false');
	});

	it('settles cancelled when another lifecycle action removes the active class', async () => {
		const d = fixture.driver;
		await open(d);
		await d.evaluate('document.getElementById("modal-master-conflict").classList.remove("active")');
		await d.waitFor('window.__conflictResult === false');
	});
	it('keeps the comparison open with actionable validation errors and accepts corrected choices', async () => {
		const d = fixture.driver;
		await d.evaluate(`window.__conflictResult='pending'; void window.__yose_app.masterConflictController.resolve(${JSON.stringify(details)}, choices => { if(choices['conflict-0']==='local') throw new Error('費目「食費」の中項目はサーバー側で削除されている。選択を修正する。'); }).then(result => window.__conflictResult=result);`);
		await d.click('#btn-master-conflict-all-local');
		await d.click('#btn-apply-master-conflict');
		await d.waitFor('document.getElementById("master-conflict-error").textContent.includes("食費")');
		assert.equal(await d.evaluate('window.__conflictResult'), 'pending');
		assert.equal(await d.isVisible('#modal-master-conflict'), true);
		await d.select('[data-conflict-id="conflict-0"] select', 'remote');
		await d.click('#btn-apply-master-conflict');
		await d.waitFor('window.__conflictResult !== "pending"');
		assert.deepEqual(await d.evaluate('window.__conflictResult'), {'conflict-0':'remote','conflict-1':'local'});
	});

	it('ignores stale asynchronous validation after cancellation and a new conflict', async () => {
		const d = fixture.driver;
		await d.evaluate(`window.__conflictResult='pending'; void window.__yose_app.masterConflictController.resolve(${JSON.stringify(details)}, () => new Promise(resolve => window.__releaseValidation=resolve)).then(result => window.__conflictResult=result);`);
		await d.click('#btn-master-conflict-all-local');
		await d.click('#btn-apply-master-conflict');
		await d.waitFor('Boolean(window.__releaseValidation)');
		assert.equal(await d.evaluate('document.getElementById("btn-apply-master-conflict").disabled'), true);
		await d.click('#btn-cancel-master-conflict');
		assert.equal(await d.evaluate('window.__conflictResult'), false);
		await open(d, [{ ...details[0], remoteValue:'検証待ち後の新しい競合' }], '__newConflictResult');
		await d.evaluate('window.__releaseValidation()');
		await d.send('Runtime.evaluate', {expression:'new Promise(resolve => requestAnimationFrame(resolve))',awaitPromise:true}, d.sessionId);
		assert.equal(await d.evaluate('window.__newConflictResult'), 'pending');
		assert.equal(await d.isVisible('#modal-master-conflict'), true);
		assert.equal(await value(d, '[data-conflict-id="conflict-0"] select'), '');
	});

	it('cancels only the top conflict on back while retaining an underlying dirty editor', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('editing_behind_conflict')]);
		await d.evaluate('window.__yose_app.txEditController.openEditTransactionModal("editing_behind_conflict")');
		await d.fill('#edit-tx-memo', '編集中の内容を保持');
		const count = await d.evaluate('window.__dialogs.length');
		await open(d);
		await d.evaluate('history.back()');
		await d.waitFor('window.__conflictResult === false && history.state?.yoseGuard');
		assert.equal(await d.isVisible('#modal-edit-tx'), true);
		assert.equal(await value(d, '#edit-tx-memo'), '編集中の内容を保持');
		assert.equal(await d.evaluate('document.getElementById("modal-edit-tx").inert'), false);
		assert.equal(await d.evaluate('document.querySelector("main").inert'), true);
		assert.equal(await d.evaluate('window.__dialogs.length'), count);
	});

	it('cancels real manual synchronization safely when locked with encrypted pending records and recovers after PIN unlock', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('encrypted_pending', { memo: '暗号化した未同期明細', amount: 4321 })]);
		await d.evaluate(`(async () => {
			const app=window.__yose_app, db=app.db;
			const {sharedMasterConfig}=await import('/js/logic/master_sync.js');
			const base=await db.getMasterConfig(); window.__lockRemoteMaster=sharedMasterConfig(base);
			await db.commitMasterSync(base,window.__lockRemoteMaster);
			const local=await db.getMasterConfig(); local.accounts.find(a=>a.id==='acc_wallet').name='ロック前の手元'; await db.saveMasterConfig(local);
			window.__lockRemoteMaster.accounts.find(a=>a.id==='acc_wallet').name='ロック中のサーバー';
			await db.setSetting('gas_url','https://yose.local/lock-conflict'); app.syncManager.setGasUrl('https://yose.local/lock-conflict');
			window.__lockConflictFetch=async (_url, options) => {
				const request=JSON.parse(options.body);
				if(request.action==='update_master')window.__lockRemoteMaster=request.payload.master_config;
				return {ok:true,text:async()=>JSON.stringify({success:true,master_config:window.__lockRemoteMaster,pending_diffs:[],archived_transactions:[]})};
			};
			app.syncManager.fetch=window.__lockConflictFetch;
			const resolve=app.masterConflictController.resolve.bind(app.masterConflictController);
			app.masterConflictController.resolve=(...args)=>resolve(...args).then(result=>{window.__realConflictResult=result;return result;});
			const handle=app.syncStatusController.handleManualSync.bind(app.syncStatusController);
			app.syncStatusController.handleManualSync=async()=>{try{return await handle();}finally{window.__realManualFinished=true;}};
			window.__lockSyncErrors=[];
			window.addEventListener('unhandledrejection',event=>window.__lockSyncErrors.push(event.reason?.message||String(event.reason)));
			await app.refreshAllViews();
		})()`);
		await d.click('#btn-header-sync');
		await d.waitFor('document.getElementById("modal-master-conflict").classList.contains("active")');
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		await d.waitFor('window.__realConflictResult === false && window.__realManualFinished && !window.__yose_app.syncManager.isSyncing');
		await d.send('Runtime.evaluate',{expression:'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))',awaitPromise:true},d.sessionId);
		assert.deepEqual(await d.evaluate('window.__lockSyncErrors'), []);
		assert.equal(await d.evaluate('document.getElementById("auth-screen").inert'), false);
		await d.fill('#auth-pin-input','1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden") && !document.getElementById("btn-header-sync").disabled');
		const tx=(await records(d)).find(record=>record.id==='encrypted_pending');
		assert.equal(tx.amount,4321);
		assert.equal(tx.memo,'暗号化した未同期明細');
		assert.equal(tx.sync_status,'unsynced');
		assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).accounts.find(a=>a.id==="acc_wallet").name)()'),'ロック前の手元');
		assert.equal(await d.evaluate('window.__lockRemoteMaster.accounts.find(a=>a.id==="acc_wallet").name'),'ロック中のサーバー');
		await d.evaluate('window.__yose_app.syncManager.fetch=window.__lockConflictFetch');
		await d.click('#btn-header-sync');
		await d.waitFor('document.getElementById("modal-master-conflict").classList.contains("active")');
		await d.click('#btn-master-conflict-all-remote');
		await d.click('#btn-apply-master-conflict');
		await d.waitFor('(async()=>!window.__yose_app.syncManager.isSyncing && (await window.__yose_app.db.getTransaction("encrypted_pending")).sync_status === "synced")()');
		assert.equal(await d.evaluate('document.getElementById("btn-header-sync").disabled'),false);
		assert.deepEqual(await d.evaluate('window.__lockSyncErrors'),[]);
	});

	it('shows referenced setting names together with original IDs without interpreting display-name HTML', async () => {
		const d = fixture.driver;
		await open(d, [
			{...details[0],label:'定期ルール「日用品」の中項目',localValue:'sub_daily',remoteValue:'sub_rent',localDisplayName:'日用品',remoteDisplayName:'家賃'},
			{...details[1],localValue:'sub_unsafe',remoteValue:null,localDisplayName:'<img src=x onerror=alert(1)>',remoteDisplayName:'nullには使わない'}
		]);
		const names=await d.evaluate('Array.from(document.querySelectorAll("[data-conflict-id=conflict-0] .master-conflict-value"),cell=>cell.textContent)');
		assert.deepEqual(names,['日用品（ID: sub_daily）','家賃（ID: sub_rent）']);
		assert.equal(await d.evaluate('document.querySelector("#master-conflict-list img")'),null);
		const values=await d.evaluate('Array.from(document.querySelectorAll("[data-conflict-id=conflict-1] .master-conflict-value"),cell=>cell.textContent)');
		assert.equal(values[0],'<img src=x onerror=alert(1)>（ID: sub_unsafe）');
		assert.equal(values[1],'null');
	});

});
