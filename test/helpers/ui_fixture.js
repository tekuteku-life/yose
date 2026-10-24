import { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessBrowserDriver } from './cdp_driver.js';

export const FIXED_NOW = '2026-10-20T03:00:00Z';

export function transaction(id, overrides = {}) {
	return {
		id,
		group_id: `grp_${id}`,
		date: '2026-10-20',
		target_month: '2026-10',
		status: 'confirmed',
		type: 'expense',
		amount: 100,
		account_id: 'acc_wallet',
		to_account_id: null,
		category_id: 'cat_food',
		subcategory_id: null,
		actual_category_id: 'cat_food',
		actual_subcategory_id: null,
		tax_meta: null,
		amortization_meta: null,
		memo: id,
		tags: [],
		created_at: FIXED_NOW,
		updated_at: FIXED_NOW,
		is_deleted: false,
		sync_status: 'unsynced',
		...overrides
	};
}

export async function openBrowser(options = {}) {
	const driver = new HeadlessBrowserDriver({ now: FIXED_NOW, ...options });
	try {
		await driver.launch();
		await driver.navigate();
		await driver.fill('#auth-setup-pin', '1234');
		await driver.click('#btn-auth-setup');
		await driver.waitFor('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden") && document.querySelector("#select-category option")');
		await driver.waitFor('document.getElementById("sync-badge").textContent === "同期済"');
		return driver;
	} catch (error) {
		await driver.close();
		throw error;
	}
}

// Every test owns an isolated browser context, IndexedDB, storage, keys, and application state.
export function useBrowser(options = {}) {
	const fixture = { driver: null };
	beforeEach(async () => {
		fixture.driver = await openBrowser(options);
	});
	afterEach(async () => {
		const driver = fixture.driver;
		if (!driver) return;
		try {
			assert.deepEqual(driver.pageErrors, [], 'Unexpected browser exception');
		} finally {
			await driver.close();
		}
	});
	return fixture;
}

export async function seed(driver, records) {
	await driver.evaluate(`window.__yose_app.db.putTransactions(${JSON.stringify(records)})`);
}

// Existing legacy/history fixtures bypass creation validation explicitly; product writes use seed().
export async function seedLegacy(driver, records) {
	await driver.evaluate(`(async () => {
		const db = window.__yose_app.db;
		const records = ${JSON.stringify(records)};
		await db.putAllRaw('transactions', await Promise.all(records.map(record => db.encryptRecord(record, { id: record.id, target_month: record.target_month, date: record.date, sync_status: record.sync_status, is_deleted: Boolean(record.is_deleted) }))));
	})()`);
}

export async function records(driver) {
	return driver.evaluate('window.__yose_app.db.getTransactions({ includeDeleted: true })');
}

export async function value(driver, selector) {
	return driver.evaluate(`document.querySelector(${JSON.stringify(selector)}).value`);
}

export async function rowIds(driver) {
	return driver.evaluate('Array.from(document.querySelectorAll("#month-tx-list .tx-item"), el => el.dataset.id)');
}

export async function cashflow(driver) {
	await driver.evaluate(`
		window.__txListRendered = false;
		window.__txListObserver?.disconnect();
		window.__txListObserver = new MutationObserver(() => {
			window.__txListRendered = true;
			window.__txListObserver.disconnect();
		});
		window.__txListObserver.observe(document.getElementById('month-tx-list'), { childList: true });
	`);
	await driver.click('.tab-btn[data-analytics-target="cashflow"]');
	await driver.waitFor('window.__txListRendered');
}

export async function settings(driver, master = null) {
	await driver.click('.tab-btn[data-tab="tab-settings"]');
	if (master) await driver.click(`.master-tab-btn[data-master="${master}"]`);
}

export async function submit(driver, formSelector) {
	await driver.click(`${formSelector} button[type="submit"]`);
}

export async function dialogs(driver) {
	return driver.evaluate('window.__dialogs');
}

export async function waitForDialog(driver, fragment) {
	await driver.waitFor(`window.__dialogs.some(d => d.message.includes(${JSON.stringify(fragment)}))`);
}
