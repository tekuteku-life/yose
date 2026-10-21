import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, settings, submit, waitForDialog, value } from '../helpers/ui_fixture.js';

async function mockMasterServer(d, { defer = false } = {}) {
	await d.evaluate(`(async () => {
		const app = window.__yose_app;
		const { sharedMasterConfig } = await import('/js/logic/master_sync.js');
		window.__remoteMaster = sharedMasterConfig(await app.db.getMasterConfig());
		await app.db.commitMasterSync(await app.db.getMasterConfig(), window.__remoteMaster);
		window.__syncActions = [];
		window.__deferMaster = ${defer};
		app.syncManager.setGasUrl('https://yose.local/master-sync');
		app.syncManager.fetch = async (_url, options) => {
			const request = JSON.parse(options.body);
			window.__syncActions.push(request.action);
			if (window.__deferMaster) await new Promise(resolve => { window.__releaseMaster = resolve; });
			if (request.action === 'update_master') window.__remoteMaster = request.payload.master_config;
			return { ok: true, text: async () => JSON.stringify({ success: true, master_config: window.__remoteMaster, pending_diffs: [], archived_transactions: [] }) };
		};
	})()`);
}

describe('Master configuration synchronization UI', { timeout: 120000 }, () => {
	const fixture = useBrowser();

	it('reflects master changes before a delayed network completes and indicates background synchronization', async () => {
		const d = fixture.driver;
		await mockMasterServer(d, { defer: true });
		await settings(d, 'accounts');
		await d.click('.btn-edit-account[data-id="acc_wallet"]');
		await d.fill('#m-acc-name', '通信待ち即時口座');
		await submit(d, '#form-master-account');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		await d.waitFor('document.getElementById("sync-badge").textContent === "同期中…"');
		assert.ok((await d.textContent('#master-accounts-list')).includes('通信待ち即時口座'));
		assert.ok(await d.evaluate('document.getElementById("select-account").textContent.includes("通信待ち即時口座")'));
		assert.equal(await d.evaluate('document.getElementById("sync-badge").getAttribute("aria-busy")'), 'true');
		assert.equal(await d.evaluate('document.getElementById("btn-manual-sync").disabled'), true);
		await d.evaluate('window.__deferMaster = false; window.__releaseMaster()');
		await d.waitFor('document.getElementById("sync-badge").textContent === "同期済"');
		assert.equal(await d.evaluate('document.getElementById("btn-manual-sync").disabled'), false);
		assert.equal(await d.evaluate('window.__remoteMaster.accounts.find(a => a.id === "acc_wallet").name'), '通信待ち即時口座');
	});

	it('sends local master-only edits and downloads nonconflicting remote edits through the single manual action', async () => {
		const d = fixture.driver;
		await mockMasterServer(d);
		await d.evaluate(`(async () => {
			const db = window.__yose_app.db;
			const config = await db.getMasterConfig(); config.accounts.find(a => a.id === 'acc_wallet').name = '手元口座';
			await db.saveMasterConfig(config);
			window.__remoteMaster.categories.find(c => c.id === 'cat_food').name = '別端末費目';
			await window.__yose_app.refreshAllViews();
		})()`);
		await settings(d);
		assert.equal(await d.evaluate('document.getElementById("btn-sync-master")'), null);
		assert.equal(await d.evaluate('document.getElementById("btn-fetch-remote")'), null);
		assert.ok((await d.textContent('#sync-badge')).includes('設定が未同期'));
		await d.click('#btn-manual-sync');
		await waitForDialog(d, '差分同期完了');
		await d.waitFor('document.getElementById("sync-badge").textContent === "同期済"');
		assert.equal(await d.evaluate('window.__remoteMaster.accounts.find(a => a.id === "acc_wallet").name'), '手元口座');
		assert.ok(await d.evaluate('document.getElementById("select-category").textContent.includes("別端末費目")'));
		assert.ok((await d.evaluate('window.__syncActions')).includes('update_master'));
	});

	it('retains both master versions when conflict resolution is cancelled and resolves after explicit confirmation', async () => {
		const d = fixture.driver;
		await mockMasterServer(d);
		await d.evaluate(`(async () => {
			const db = window.__yose_app.db, config = await db.getMasterConfig();
			config.accounts.find(a => a.id === 'acc_wallet').name = '手元優先候補'; await db.saveMasterConfig(config);
			window.__remoteMaster.accounts.find(a => a.id === 'acc_wallet').name = '別端末維持';
		})()`);
		await settings(d); await d.click('#btn-manual-sync');
		await d.waitFor('document.getElementById("modal-master-conflict").classList.contains("active")');
		await d.click('#btn-cancel-master-conflict');
		await waitForDialog(d, '設定の競合確認を取り消しました');
		assert.equal(await d.evaluate('window.__remoteMaster.accounts.find(a => a.id === "acc_wallet").name'), '別端末維持');
		assert.equal(await d.evaluate('(async () => (await window.__yose_app.db.getMasterConfig()).accounts.find(a => a.id === "acc_wallet").name)()'), '手元優先候補');
		await d.click('#btn-manual-sync');
		await d.waitFor('document.getElementById("modal-master-conflict").classList.contains("active")');
		await d.click('#btn-master-conflict-all-local'); await d.click('#btn-apply-master-conflict');
		await waitForDialog(d, '差分同期完了');
		assert.equal(await d.evaluate('window.__remoteMaster.accounts.find(a => a.id === "acc_wallet").name'), '手元優先候補');
	});

	it('shows actionable fetch-failure diagnostics and keeps the local master pending', async () => {
		const d = fixture.driver;
		await mockMasterServer(d);
		await d.evaluate(`(async () => {
			const app = window.__yose_app, config = await app.db.getMasterConfig();
			config.accounts.find(a => a.id === 'acc_wallet').name = '失敗時も保持'; await app.db.saveMasterConfig(config);
			app.syncManager.fetch = async () => { throw new TypeError('Failed to fetch'); };
		})()`);
		await d.click('#btn-header-sync');
		await waitForDialog(d, '公開権限');
		await d.waitFor('document.getElementById("sync-badge").textContent.includes("同期失敗") && document.getElementById("sync-badge").textContent.includes("設定が未同期")');
		assert.equal(await d.evaluate('document.getElementById("sync-badge").getAttribute("aria-busy")'), 'false');
		assert.equal(await d.evaluate('document.getElementById("btn-header-sync").disabled'), false);
		assert.equal(await d.evaluate('(async () => (await window.__yose_app.db.getMasterConfig()).accounts.find(a => a.id === "acc_wallet").name)()'), '失敗時も保持');
	});
	it('binds synchronization progress again after PIN lock and unlock', async () => {
		const d = fixture.driver;
		await settings(d);
		if (!await d.isVisible('#btn-lock-now')) await d.click('#btn-toggle-key-details');
		await d.click('#btn-lock-now');
		await d.fill('#auth-pin-input', '1234'); await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		await mockMasterServer(d, { defer: true });
		await d.click('#btn-header-sync');
		await d.waitFor('document.getElementById("sync-badge").textContent === "同期中…"');
		assert.equal(await d.evaluate('document.getElementById("btn-header-sync").disabled'), true);
		await d.evaluate('window.__deferMaster = false; window.__releaseMaster()');
		await waitForDialog(d, '差分同期完了');
		await d.waitFor('document.getElementById("sync-badge").textContent === "同期済"');
	});

	it('preserves in-progress account and category selections when a delayed master download redraws views', async () => {
		const d = fixture.driver;
		await mockMasterServer(d, { defer: true });
		await settings(d, 'accounts'); await d.click('.btn-edit-account[data-id="acc_wallet"]');
		await d.fill('#m-acc-name', '背景保存'); await submit(d, '#form-master-account');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		await d.click('.tab-btn[data-tab="tab-input"]');
		await d.select('#select-account', 'acc_bank_main');
		await d.select('#select-category', 'cat_social'); await d.select('#select-subcategory', 'sub_leisure');
		await d.click('#chk-sync-actual-category');
		await d.select('#select-actual-category', 'cat_housing'); await d.select('#select-actual-subcategory', 'sub_utilities');
		await d.fill('#input-memo', '通信待ち中の入力'); await d.fill('#input-amount', '123');
		await d.evaluate('window.__remoteMaster.categories.find(c => c.id === "cat_food").name = "受信された別費目"; window.__deferMaster = false; window.__releaseMaster()');
		await d.waitFor('document.getElementById("sync-badge").textContent === "同期済" && document.getElementById("select-category").textContent.includes("受信された別費目")');
		for (const [selector, expected] of [['#select-account', 'acc_bank_main'], ['#select-category', 'cat_social'], ['#select-subcategory', 'sub_leisure'], ['#select-actual-category', 'cat_housing'], ['#select-actual-subcategory', 'sub_utilities'], ['#input-memo', '通信待ち中の入力'], ['#input-amount', '123']]) assert.equal(await value(d, selector), expected);
	});

});


describe('Master conflict cancellation UI', { timeout: 120000 }, () => {
	const fixture = useBrowser();
	for (const button of ['#btn-header-sync', '#btn-manual-sync']) {
		it(`shows cancellation and a pending setting instead of failure through ${button}`, async () => {
			const d = fixture.driver; await mockMasterServer(d); await settings(d);
			await d.evaluate(`(async () => {
				const db=window.__yose_app.db, config=await db.getMasterConfig();
				config.accounts.find(a=>a.id==='acc_wallet').name='取消の手元'; await db.saveMasterConfig(config);
				window.__remoteMaster.accounts.find(a=>a.id==='acc_wallet').name='取消の別端末';
			})()`);
			await d.click(button);
			await d.waitFor('document.getElementById("modal-master-conflict").classList.contains("active")');
			await d.click('#btn-cancel-master-conflict');
			await waitForDialog(d, '設定の競合確認を取り消しました');
			await d.waitFor('document.getElementById("sync-badge").textContent.includes("設定の確認待ち")');
			assert.equal(await d.evaluate('window.__yose_app.syncManager.lastError'), null);
			assert.ok(!(await d.textContent('#sync-badge')).includes('同期失敗'));
			assert.equal(await d.evaluate('window.__remoteMaster.accounts.find(a=>a.id==="acc_wallet").name'), '取消の別端末');
			assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).accounts.find(a=>a.id==="acc_wallet").name)()'), '取消の手元');
			await d.click(button);
			await d.waitFor('document.getElementById("modal-master-conflict").classList.contains("active")');
			await d.click('#btn-master-conflict-all-local'); await d.click('#btn-apply-master-conflict');
			await waitForDialog(d, '差分同期完了');
			await d.waitFor('document.getElementById("sync-badge").textContent === "同期済"');
		});
	}
	it('keeps the pending conflict visible after transaction-only success and distinguishes a real network failure', async () => {
		const d=fixture.driver; await mockMasterServer(d);
		await d.evaluate(`(async()=>{
			const app=window.__yose_app, config=await app.db.getMasterConfig();
			config.accounts.find(a=>a.id==='acc_wallet').name='確認待ちの手元';await app.db.saveMasterConfig(config);
			window.__remoteMaster.accounts.find(a=>a.id==='acc_wallet').name='確認待ちの別端末';
			window.__pendingResult=await app.syncManager.syncBidirectional();
		})()`);
		assert.equal(await d.evaluate('window.__pendingResult.status'), 'master_conflict');
		await d.evaluate('window.__yose_app.syncManager.syncPendingDiffs()');
		await d.waitFor('document.getElementById("sync-badge").textContent.includes("設定の確認待ち")');
		await d.evaluate('window.__yose_app.syncManager.fetch=async()=>{throw new TypeError("Failed to fetch")}');
		await d.click('#btn-header-sync'); await waitForDialog(d, '同期に失敗');
		await d.waitFor('document.getElementById("sync-badge").textContent.includes("同期失敗") && document.getElementById("sync-badge").textContent.includes("設定の確認待ち")');
	});
});
