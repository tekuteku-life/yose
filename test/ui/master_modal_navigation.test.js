import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, settings, value } from '../helpers/ui_fixture.js';

async function open(d, type = 'recurring') {
	await settings(d, type === 'account' ? 'accounts' : ['category', 'subcategory'].includes(type) ? 'categories' : 'recurring');
	await d.click(type === 'subcategory' ? '.btn-add-subcat[data-id="cat_food"]' : `#btn-add-${type}`);
	await d.waitFor('document.getElementById("modal-master-item").classList.contains("active")');
}
async function back(d) {
	const before = await d.evaluate('window.__backEvents || 0');
	await d.evaluate('history.back()');
	await d.waitFor(`window.__backEvents > ${before} && history.state?.yoseGuard`);
}

describe('Master modal back navigation and unsaved edits', { timeout: 120000 }, () => {
	const fixture = useBrowser();
	async function track(d) {
		await d.evaluate('window.__backEvents = 0; window.addEventListener("popstate", () => { window.__backEvents++; });');
	}

	for (const type of ['recurring', 'account', 'category', 'subcategory']) {
		it(`closes an unchanged ${type} form on back with no departure confirmation`, async () => {
			const d = fixture.driver;
			await open(d, type);
			await track(d);
			const before = await d.evaluate('({ dialogs: window.__dialogs.length, length: history.length })');
			await back(d);
			assert.equal(await d.isVisible('#modal-master-item'), false);
			assert.equal(await d.evaluate('window.__dialogs.length'), before.dialogs);
			assert.equal(await d.evaluate('history.length'), before.length);
			assert.equal(await d.evaluate('window.__yose_app.db.isEncrypted()'), true);
		});
	}

	for (const action of ['back', 'escape', 'close']) {
		it(`keeps dirty recurring values when ${action} is cancelled and closes only on approval`, async () => {
			const d = fixture.driver;
			await open(d);
			await track(d);
			const original = await d.evaluate('window.__yose_app.db.getMasterConfig()');
			await d.fill('#m-rec-name', '未保存のルール');
			await d.setConfirm(false);
			const close = async () => {
				if (action === 'back') await back(d);
				else if (action === 'escape') await d.key('#m-rec-name', 'Escape');
				else await d.click('#btn-close-master-modal');
			};
			for (let i = 0; i < 2; i++) {
				const count = await d.evaluate('window.__dialogs.length');
				await close();
				assert.equal(await d.isVisible('#modal-master-item'), true);
				assert.equal(await value(d, '#m-rec-name'), '未保存のルール');
				const added = await d.evaluate(`window.__dialogs.slice(${count})`);
				assert.equal(added.length, 1);
				assert.match(added[0].message, /変更を破棄/);
				assert.doesNotMatch(added[0].message, /前のページ/);
			}
			await d.setConfirm(true);
			await close();
			assert.equal(await d.isVisible('#modal-master-item'), false);
			assert.deepEqual(await d.evaluate('window.__yose_app.db.getMasterConfig()'), original);
		});
	}

	it('treats reverted text as unchanged and captures a fresh baseline after reopening', async () => {
		const d = fixture.driver;
		await open(d);
		await d.fill('#m-rec-name', '一時入力');
		await d.fill('#m-rec-name', '');
		const count = await d.evaluate('window.__dialogs.length');
		await d.key('#m-rec-name', 'Escape');
		assert.equal(await d.isVisible('#modal-master-item'), false);
		await d.click('#btn-add-recurring');
		await d.waitFor('document.getElementById("modal-master-item").classList.contains("active")');
		assert.equal(await value(d, '#m-rec-name'), '');
		await d.click('#btn-close-master-modal');
		assert.equal(await d.evaluate('window.__dialogs.length'), count);
	});

	it('closes a nested calculator on back before asking to discard its dirty master', async () => {
		const d = fixture.driver;
		await open(d);
		await track(d);
		await d.fill('#m-rec-name', '未保存');
		await d.evaluate('window.__yose_app.txInputController.openCalculatorFor("m-rec-amount")');
		await d.waitFor('document.querySelector("main").inert && document.getElementById("modal-master-item").inert');
		const count = await d.evaluate('window.__dialogs.length');
		await back(d);
		assert.equal(await d.isVisible('#modal-tax'), false);
		assert.equal(await d.isVisible('#modal-master-item'), true);
		assert.equal(await d.evaluate('window.__dialogs.length'), count);
		await d.setConfirm(false);
		await back(d);
		assert.equal(await value(d, '#m-rec-name'), '未保存');
		assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /変更を破棄/);
	});

	it('closes export and holiday overlays on back before offering departure', async () => {
		const d = fixture.driver;
		await settings(d, 'holidays');
		await track(d);
		for (const [button, modal] of [['btn-open-holiday-modal', 'modal-holiday-import'], ['btn-open-export-modal', 'modal-export-json']]) {
			await d.click(`#${button}`);
			assert.equal(await d.isVisible(`#${modal}`), true);
			const count = await d.evaluate('window.__dialogs.length');
			await back(d);
			assert.equal(await d.isVisible(`#${modal}`), false);
			assert.equal(await d.evaluate('window.__dialogs.length'), count);
		}
		await d.setConfirm(false);
		await back(d);
		assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /前のページ/);
	});

	it('discards the unsaved master on lock and does not resurrect it after PIN unlock', async () => {
		const d = fixture.driver;
		await open(d);
		await d.fill('#m-rec-name', 'ロック前の未保存');
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		assert.equal(await d.isVisible('#modal-master-item'), false);
		await open(d);
		assert.equal(await value(d, '#m-rec-name'), '');
	});
	it('preserves a saving form on close attempts and restores dirty handling after a failed save', async () => {
		const d = fixture.driver;
		await open(d);
		await track(d);
		await d.fill('#m-rec-name', '保存失敗後も保持');
		await d.fill('#m-rec-amount', '120');
		await d.evaluate(`(() => { const db=window.__yose_app.db; window.__saveMaster=db.saveMasterConfig.bind(db); db.saveMasterConfig=async()=>{window.__saving=true;await new Promise(resolve=>window.__releaseSave=resolve);throw new Error('保存失敗の試験');}; })()`);
		await d.click('#form-master-recurring button[type=submit]');
		await d.waitFor('window.__saving');
		const count = await d.evaluate('window.__dialogs.length');
		await d.setConfirm(true);
		await back(d);
		await d.key('#m-rec-name', 'Escape');
		await d.click('#btn-close-master-modal');
		assert.equal(await d.isVisible('#modal-master-item'), true);
		assert.equal(await d.evaluate('window.__dialogs.length'), count);
		await d.evaluate('window.__releaseSave()');
		await d.waitFor('!document.querySelector("#form-master-recurring button[type=submit]").disabled');
		assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /保存失敗の試験/);
		assert.equal(await value(d, '#m-rec-name'), '保存失敗後も保持');
		await d.setConfirm(false);
		await back(d);
		assert.equal(await d.isVisible('#modal-master-item'), true);
		assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /変更を破棄/);
		await d.evaluate('window.__yose_app.db.saveMasterConfig=window.__saveMaster');
		await d.click('#form-master-recurring button[type=submit]');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		assert.ok(await d.evaluate('(async()=> (await window.__yose_app.db.getMasterConfig()).recurring_rules.some(r=>r.name==="保存失敗後も保持"))()'));
	});

	it('keeps a newer master open when an old saved form finishes refreshing after lock and unlock', async () => {
		const d = fixture.driver;
		await open(d);
		await d.fill('#m-rec-name', '旧保存');
		await d.fill('#m-rec-amount', '100');
		await d.evaluate(`(() => { const app=window.__yose_app, refresh=app.refreshAllViews.bind(app); let first=true; app.refreshAllViews=async()=>{if(first){first=false;window.__refreshPaused=true;await new Promise(resolve=>window.__releaseRefresh=resolve);}return refresh();}; })()`);
		await d.click('#form-master-recurring button[type=submit]');
		await d.waitFor('window.__refreshPaused');
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		await open(d);
		await d.fill('#m-rec-name', '新しい未保存');
		await d.evaluate('window.__releaseRefresh()');
		await d.waitFor('window.__yose_app.masterController.submittingVersion === null');
		assert.equal(await d.isVisible('#modal-master-item'), true);
		assert.equal(await value(d, '#m-rec-name'), '新しい未保存');
	});

	it('ignores a modal read that completes after lock and after a later authenticated session', async () => {
		const d = fixture.driver;
		await settings(d, 'recurring');
		await d.evaluate(`(() => { const app=window.__yose_app, read=app.db.getMasterConfig.bind(app.db); let first=true; app.db.getMasterConfig=async()=>{const config=await read();if(first){first=false;window.__readPaused=true;await new Promise(resolve=>window.__releaseRead=resolve);}return config;}; window.__opening=app.masterController.openMasterModal('recurring', null); })()`);
		await d.waitFor('window.__readPaused');
		await d.evaluate('window.__yose_app.authController.lockPrivateKey()');
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		await d.evaluate('(async()=>{window.__releaseRead();await window.__opening;})()');
		assert.equal(await d.isVisible('#modal-master-item'), false);
	});

	it('ignores an older open request that completes after a newer master request', async () => {
		const d = fixture.driver;
		await settings(d, 'recurring');
		await d.evaluate(`(() => { const app=window.__yose_app, read=app.db.getMasterConfig.bind(app.db); let first=true; app.db.getMasterConfig=async()=>{const config=await read();if(first){first=false;window.__readPaused=true;await new Promise(resolve=>window.__releaseRead=resolve);}return config;}; window.__opening=app.masterController.openMasterModal('recurring', null); })()`);
		await d.waitFor('window.__readPaused');
		await d.evaluate("window.__yose_app.masterController.openMasterModal('category', null)");
		await d.fill('#m-cat-name', '新しい費目');
		await d.evaluate('(async()=>{window.__releaseRead();await window.__opening;})()');
		assert.equal(await value(d, '#m-cat-name'), '新しい費目');
		assert.equal(await d.isVisible('#form-master-recurring'), false);
	});

	for (const [type, prefix, field] of [['account', 'acc', 'accounts'], ['category', 'cat', 'categories'], ['subcategory', 'sub', null]]) {
		it(`retries a failed new ${type} save without duplicating its ID`, async () => {
			const d = fixture.driver;
			if (type === 'subcategory') {
				await settings(d, 'categories');
				await d.click('.btn-add-subcat[data-id="cat_food"]');
				await d.waitFor('document.getElementById("m-sub-name")');
			} else await open(d, type);
			await d.fill(`#m-${prefix}-name`, '再送確認');
			const id = await value(d, `#m-${prefix}-id`);
			const original = await d.evaluate('window.__yose_app.db.getMasterConfig()');
			await d.evaluate(`(() => {const db=window.__yose_app.db, save=db.saveMasterConfig.bind(db);let first=true;db.saveMasterConfig=async(...args)=>{if(first){first=false;throw new Error('一時的な保存失敗');}return save(...args);};})()`);
			await d.click(`#form-master-${type} button[type=submit]`);
			await d.waitFor('window.__dialogs.some(x=>x.message.includes("一時的な保存失敗"))');
			assert.deepEqual(await d.evaluate('window.__yose_app.db.getMasterConfig()'), original);
			assert.equal(await value(d, `#m-${prefix}-name`), '再送確認');
			await d.click(`#form-master-${type} button[type=submit]`);
			await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
			const config = await d.evaluate('window.__yose_app.db.getMasterConfig()');
			const collection = field ? config[field] : config.categories.find(c=>c.id==='cat_food').subcategories;
			assert.equal(collection.filter(item=>item.id===id).length, 1);
			assert.equal(collection.find(item=>item.id===id).name, '再送確認');
		});
	}

	it('detects a checkbox-only change in an existing recurring editor and accepts an exact revert', async () => {
		const d = fixture.driver;
		await d.evaluate(`(async()=>{const db=window.__yose_app.db, config=await db.getMasterConfig();config.recurring_rules=[{id:'rec_nav',name:'戻る確認',is_active:false,type:'expense',amount:100,account_id:'acc_wallet',category_id:'cat_food',subcategory_id:null,actual_category_id:'cat_food',actual_subcategory_id:null,day_of_month:10}];await db.saveMasterConfig(config);await window.__yose_app.refreshAllViews();})()`);
		await settings(d, 'recurring');
		await d.click('.btn-edit-recurring[data-id="rec_nav"]');
		await d.waitFor('document.getElementById("modal-master-item").classList.contains("active")');
		await track(d);
		const config = await d.evaluate('window.__yose_app.db.getMasterConfig()');
		await d.click('#m-rec-sync-actual');
		await d.setConfirm(false);
		await back(d);
		assert.equal(await d.isVisible('#modal-master-item'), true);
		assert.match(await d.evaluate('window.__dialogs.at(-1).message'), /変更を破棄/);
		await d.click('#m-rec-sync-actual');
		const count = await d.evaluate('window.__dialogs.length');
		await back(d);
		assert.equal(await d.isVisible('#modal-master-item'), false);
		assert.equal(await d.evaluate('window.__dialogs.length'), count);
		assert.deepEqual(await d.evaluate('window.__yose_app.db.getMasterConfig()'), config);
	});

});
