import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seedLegacy, transaction, settings, records, waitForDialog } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
async function prepare(d, closed = false) {
	await d.evaluate(`(async () => {
		const app = window.__yose_app; const config = await app.db.getMasterConfig();
		config.categories.find(c => c.id === 'cat_food').is_archived = true;
		await app.db.saveMasterConfig(config);
	})()`);
	await seedLegacy(d, [transaction('archived', closed ? { date: '2026-09-10', target_month: '2026-09', sync_status: 'synced' } : {}), transaction('unrelated', { category_id: 'cat_housing', actual_category_id: 'cat_housing' })]);
	await settings(d);
	await d.click('#maintenance-panel summary');
	await d.click('#btn-refresh-maintenance');
	await d.waitFor('document.getElementById("maintenance-records").textContent.includes("archived")');
	await d.select('#maintenance-source', 'category:cat_food');
	await d.select('#maintenance-target', 'cat_housing');
}

describe('archived master maintenance UI', () => {
	it('limits sources to loaded undeleted references and shows only rows for the selected source', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`(async () => {
			const app=window.__yose_app, config=await app.db.getMasterConfig();
			config.categories.find(c=>c.id==='cat_social').is_archived=true;
			config.accounts.push({id:'unused_archived',name:'未使用',type:'cash',is_asset:true,is_archived:true});
			await app.db.saveMasterConfig(config);
		})()`);
		await seedLegacy(d, [transaction('zero-planned', { category_id: 'cat_social', actual_category_id: 'cat_social', amount: 0, status: 'planned' }), transaction('second-social', { category_id: 'cat_social', actual_category_id: 'cat_social' }), transaction('deleted-child', { category_id: 'cat_food', subcategory_id: 'sub_groceries', is_deleted: true })]);
		await d.click('#btn-refresh-maintenance');
		await d.waitFor('document.querySelector("#maintenance-source option[value=" + JSON.stringify("category:cat_social") + "]")');
		assert.deepEqual(await d.evaluate('Array.from(document.getElementById("maintenance-source").options,o=>o.value)'), ['category:cat_food', 'category:cat_social']);
		assert.ok((await d.textContent('#maintenance-source')).includes('2件'));
		assert.ok(!(await d.textContent('#maintenance-records')).includes('zero-planned'));
		await d.select('#maintenance-source', 'category:cat_social');
		assert.ok((await d.textContent('#maintenance-records')).includes('zero-planned'));
		assert.ok(!(await d.textContent('#maintenance-records')).includes('archived'));
		assert.ok((await d.textContent('#maintenance-count')).includes('2件'));
	});
	it('refreshes latest master and records, preserves valid selections, and clears vanished sources', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`(async () => {
			const app=window.__yose_app, config=await app.db.getMasterConfig();
			config.categories.find(c=>c.id==='cat_housing').subcategories.push({id:'refresh_child',name:'更新中項目'});
			await app.db.saveMasterConfig(config);
		})()`);
		await d.click('#btn-refresh-maintenance');
		await d.select('#maintenance-target', 'cat_housing'); await d.select('#maintenance-subcategory', 'refresh_child');
		await d.evaluate(`(async () => {
			const app=window.__yose_app, config=await app.db.getMasterConfig();
			config.categories.find(c=>c.id==='cat_food').name='更新された費目'; await app.db.saveMasterConfig(config);
			const record=await app.db.getTransaction('archived'); await app.db.putTransaction({...record,memo:'更新された明細'});
		})()`);
		await d.click('#btn-refresh-maintenance');
		await d.waitFor('document.getElementById("maintenance-records").textContent.includes("更新された明細")');
		assert.ok((await d.textContent('#maintenance-source')).includes('更新された費目'));
		assert.equal(await d.textContent('#maintenance-refresh-status'), '一覧を更新しました。');
		assert.equal(await d.evaluate('document.getElementById("maintenance-source").value'), 'category:cat_food');
		assert.equal(await d.evaluate('document.getElementById("maintenance-target").value'), 'cat_housing');
		assert.equal(await d.evaluate('document.getElementById("maintenance-subcategory").value'), 'refresh_child');
		await d.evaluate('window.__yose_app.db.deleteTransaction("archived")');
		await d.click('#btn-refresh-maintenance');
		await d.waitFor('document.getElementById("maintenance-source").options.length===0');
		assert.ok((await d.textContent('#maintenance-records')).includes('ありません'));
		assert.equal(await d.evaluate('document.getElementById("btn-migrate-maintenance").disabled'), true);
	});
	it('keeps the newest refresh response and blocks migration while records are loading', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`(async () => {
			const app=window.__yose_app, db=app.db, config=await db.getMasterConfig(), records=await db.getTransactions();
			const originalConfig=db.getMasterConfig.bind(db), originalRecords=db.getTransactions.bind(db);
			let configCalls=0, recordCalls=0;
			db.getMasterConfig=()=>++configCalls===1?new Promise(resolve=>window.__resolveOldMaintenance=()=>resolve(config)):originalConfig();
			db.getTransactions=()=>Promise.resolve(++recordCalls===1?records:records.map(t=>t.id==='archived'?{...t,memo:'最新応答'}:t));
			window.__firstMaintenanceRefresh=app.maintenanceController.refresh();
			window.__restoreMaintenanceReads=()=>{db.getMasterConfig=originalConfig;db.getTransactions=originalRecords;};
		})()`);
		assert.equal(await d.evaluate('document.getElementById("btn-migrate-maintenance").disabled'), true);
		assert.equal(await d.evaluate('document.getElementById("maintenance-source").disabled'), true);
		assert.ok((await d.textContent('#btn-refresh-maintenance')).includes('更新中'));
		assert.equal(await d.textContent('#maintenance-refresh-status'), '一覧を更新しています。');
		await d.click('#btn-refresh-maintenance');
		await d.waitFor('document.getElementById("maintenance-records").textContent.includes("最新応答")');
		await d.evaluate('(async()=>{window.__resolveOldMaintenance();await window.__firstMaintenanceRefresh;window.__restoreMaintenanceReads();})()');
		assert.ok((await d.textContent('#maintenance-records')).includes('最新応答'));
		assert.equal(await d.evaluate('document.getElementById("maintenance-source").disabled'), false);
	});
	it('restores controls after a refresh failure and succeeds on retry', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`const db=window.__yose_app.db, read=db.getTransactions.bind(db);let fail=true;
			db.getTransactions=(...args)=>{if(fail){fail=false;throw new Error('一覧再取得のテスト失敗');}return read(...args);};`);
		await d.click('#btn-refresh-maintenance'); await waitForDialog(d, '一覧更新を完了できませんでした: 一覧再取得のテスト失敗');
		assert.ok((await d.textContent('#maintenance-refresh-status')).includes('更新できませんでした'));
		assert.equal(await d.evaluate('document.getElementById("maintenance-source").disabled'), false);
		assert.ok(!(await d.textContent('#btn-refresh-maintenance')).includes('更新中'));
		await d.click('#btn-refresh-maintenance');
		assert.ok((await d.textContent('#maintenance-records')).includes('archived'));
	});
	it('freezes source selections during migration and refreshes the final source list', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`window.__yose_app.approveClosedChanges=()=>new Promise(resolve=>window.__finishMaintenanceApproval=()=>resolve([]));`);
		await d.click('#btn-migrate-maintenance');
		assert.equal(await d.evaluate('document.getElementById("maintenance-source").disabled'), true);
		assert.equal(await d.evaluate('document.getElementById("btn-refresh-maintenance").disabled'), true);
		await d.evaluate('window.__yose_app.maintenanceController.refresh()');
		await d.evaluate('window.__finishMaintenanceApproval()');
		await waitForDialog(d, '1件の明細を移行');
		await d.waitFor('document.getElementById("maintenance-source").options.length===0');
		assert.equal(await d.evaluate('document.getElementById("btn-refresh-maintenance").disabled'), false);
	});

	it('reports a failed post-migration refresh without losing the committed change or controls', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`const app=window.__yose_app, migrate=app.db.migrateArchivedMaster.bind(app.db);
			app.refreshAllViews=async()=>{};
			app.db.migrateArchivedMaster=async(...args)=>{
				const changed=await migrate(...args), read=app.db.getTransactions.bind(app.db);let fail=true;
				app.db.getTransactions=(...readArgs)=>{if(fail){fail=false;throw new Error('移行後再取得のテスト失敗');}return read(...readArgs);};
				return changed;
			};`);
		await d.click('#btn-migrate-maintenance');
		await waitForDialog(d, '1件の明細を移行');
		await waitForDialog(d, '一覧更新を完了できませんでした: 移行後再取得のテスト失敗');
		assert.equal((await records(d)).find(t=>t.id==='archived').category_id, 'cat_housing');
		assert.equal(await d.evaluate('document.getElementById("btn-refresh-maintenance").disabled'), false);
		await d.click('#btn-refresh-maintenance');
		await d.waitFor('document.getElementById("maintenance-source").options.length===0');
	});

	it('lists affected rows and loaded scope, cancels without changes, then migrates both axes', async () => {
		const d = fixture.driver; await prepare(d);
		assert.ok((await d.textContent('#maintenance-scope')).includes('取得済み'));
		assert.ok(!(await d.textContent('#maintenance-records')).includes('unrelated'));
		await d.setConfirm(false); await d.click('#btn-migrate-maintenance');
		assert.equal((await records(d)).find(t => t.id === 'archived').category_id, 'cat_food');
		await d.setConfirm(true); await d.click('#btn-migrate-maintenance');
		await waitForDialog(d, '1件の明細を移行');
		const moved = (await records(d)).find(t => t.id === 'archived');
		assert.equal(moved.category_id, 'cat_housing'); assert.equal(moved.actual_category_id, 'cat_housing');
		assert.equal(moved.memo, 'archived'); assert.equal(moved.amount, 100); assert.equal(moved.sync_status, 'unsynced');
		assert.equal((await records(d)).find(t => t.id === 'unrelated').category_id, 'cat_housing');
	});
	it('asks for reclose approval and retains local changes when remote synchronization is unavailable', async () => {
		const d = fixture.driver; await prepare(d, true);
		await d.click('#btn-migrate-maintenance');
		await waitForDialog(d, '再月締め');
		await waitForDialog(d, '1件の明細を移行');
		const moved = (await records(d)).find(t => t.id === 'archived');
		assert.equal(moved.category_id, 'cat_housing'); assert.ok(moved.reclose_approved_months.includes('2026-09'));
		assert.equal(moved.sync_status, 'unsynced');
	});
	it('rejects a stale preview atomically when a record is edited during confirmation', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`window.confirm = () => {
			window.__race = window.__yose_app.db.getTransaction('archived').then(t => window.__yose_app.db.putTransaction({...t, memo: '新版'}));
			return true;
		};
		const original = window.__yose_app.approveClosedChanges.bind(window.__yose_app);
		window.__yose_app.approveClosedChanges = async (...args) => { await window.__race; return original(...args); };`);
		await d.click('#btn-migrate-maintenance');
		await waitForDialog(d, '変更');
		const current = (await records(d)).find(t => t.id === 'archived');
		assert.equal(current.memo, '新版'); assert.equal(current.category_id, 'cat_food');
	});
	it('cancels only the reclose confirmation without saving any changes', async () => {
		const d = fixture.driver; await prepare(d, true);
		const before = await records(d);
		await d.evaluate('window.confirm = message => !message.includes("再月締め")');
		await d.click('#btn-migrate-maintenance');
		assert.deepEqual(await records(d), before);
	});
	it('moves to the selected active subcategory and rejects a master race in IndexedDB', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`(async () => {
			const config = await window.__yose_app.db.getMasterConfig();
			config.categories.find(c => c.id === 'cat_housing').subcategories.push({id:'maintenance_child', name:'移行内訳'});
			await window.__yose_app.db.saveMasterConfig(config);
		})()`);
		await d.click('#btn-refresh-maintenance');
		await d.select('#maintenance-source', 'category:cat_food'); await d.select('#maintenance-target', 'cat_housing');
		await d.select('#maintenance-subcategory', 'maintenance_child');
		await d.evaluate(`const original=window.__yose_app.approveClosedChanges.bind(window.__yose_app);
			window.__yose_app.approveClosedChanges=async(...args)=>{
				const config=await window.__yose_app.db.getMasterConfig();config.categories.find(c=>c.id==='cat_housing').name='競合';await window.__yose_app.db.saveMasterConfig(config);
				return original(...args);
			};`);
		await d.click('#btn-migrate-maintenance'); await waitForDialog(d, '変更');
		assert.equal((await records(d)).find(t=>t.id==='archived').category_id,'cat_food');
		await d.evaluate('window.__yose_app.approveClosedChanges=async()=>[]');
		await d.click('#btn-refresh-maintenance'); await d.select('#maintenance-source', 'category:cat_food'); await d.select('#maintenance-target', 'cat_housing'); await d.select('#maintenance-subcategory', 'maintenance_child');
		await d.click('#btn-migrate-maintenance'); await waitForDialog(d, '1件の明細を移行');
		assert.equal((await records(d)).find(t=>t.id==='archived').subcategory_id,'maintenance_child');
	});
	it('escapes archived names and record memos in maintenance output', async () => {
		const d = fixture.driver; await prepare(d);
		await d.evaluate(`(async () => {
			const app=window.__yose_app; const config=await app.db.getMasterConfig();
			config.categories.find(c=>c.id==='cat_food').name='<img src=x onerror="window.__maintenanceXss=1">';
			await app.db.saveMasterConfig(config);
			const tx=await app.db.getTransaction('archived'); tx.memo='<img src=x onerror="window.__maintenanceXss=1">'; await app.db.putTransaction(tx);
		})()`);
		await d.click('#btn-refresh-maintenance');
		await d.waitFor('document.getElementById("maintenance-records").textContent.includes("<img")');
		assert.equal(await d.evaluate('Boolean(window.__maintenanceXss) || !!document.querySelector("#maintenance-panel img")'), false);
	});
});
