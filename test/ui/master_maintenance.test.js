import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, settings, records, waitForDialog } from '../helpers/ui_fixture.js';

const fixture = useBrowser();
async function prepare(d, closed = false) {
	await d.evaluate(`(async () => {
		const app = window.__yose_app; const config = await app.db.getMasterConfig();
		config.categories.find(c => c.id === 'cat_food').is_archived = true;
		await app.db.saveMasterConfig(config);
	})()`);
	await seed(d, [transaction('archived', closed ? { date: '2026-09-10', target_month: '2026-09', sync_status: 'synced' } : {}), transaction('unrelated', { category_id: 'cat_housing', actual_category_id: 'cat_housing' })]);
	await settings(d);
	await d.click('#maintenance-panel summary');
	await d.click('#btn-refresh-maintenance');
	await d.waitFor('document.getElementById("maintenance-records").textContent.includes("archived")');
	await d.select('#maintenance-source', 'category:cat_food');
	await d.select('#maintenance-target', 'cat_housing');
}

describe('archived master maintenance UI', () => {
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
