import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, cashflow, settings, submit, waitForDialog, value } from '../helpers/ui_fixture.js';

const gasUrl = 'https://yose.local/recovery-gas';

// Master preflight succeeds separately from a delayed or failed transaction response.
function setGasResponse(d, response) {
	d.responses.set('/recovery-gas', request => JSON.parse(request.postData || '{}').action === 'fetch_master' ? { json: { success: true } } : response);
}

describe('Atomic saves and archived transaction recovery', { timeout: 120000 }, () => {
	const fixture = useBrowser();

	async function configureGas(d, response) {
		setGasResponse(d, { json: response });
		await settings(d);
		await d.fill('#input-gas-url', gasUrl);
		await d.click('#btn-save-gas-url');
		await waitForDialog(d, 'URLを保存');
	}

	async function prepaid(d) {
		await d.select('#input-type', 'prepaid');
		await d.fill('#input-prepaid-total', '1001');
		await d.fill('#input-prepaid-months', '3');
		await d.fill('#input-memo', 'アトミック保存');
		await d.click('#btn-save-tx');
		await d.waitFor('(async () => (await window.__yose_app.db.getTransactions()).length === 4)()');
		await cashflow(d);
		return records(d);
	}

	for (const failure of ['encryption', 'indexeddb']) {
		it(`keeps the entire prepaid group unchanged on ${failure} failure`, async () => {
			const d = fixture.driver;
			const before = await prepaid(d);
			const parent = before.find(t => t.amortization_meta.is_payment_record);
			await d.click(`#month-tx-list .tx-item[data-id="${parent.id}"]`);
			await d.fill('#edit-tx-amount', '3000');
			await d.fill('#edit-tx-memo', '保存されない');
			if (failure === 'encryption') {
				await d.evaluate(`
					window.__originalEncrypt = window.__yose_app.db.encryptRecord;
					let count = 0;
					window.__yose_app.db.encryptRecord = async function(...args) {
						if (++count === 2) throw new Error('Injected encryption failure');
						return window.__originalEncrypt.apply(this, args);
					};
				`);
			} else {
				await d.evaluate(`
					window.__originalPut = IDBObjectStore.prototype.put;
					let count = 0;
					IDBObjectStore.prototype.put = function(...args) {
						if (this.name === 'transactions' && ++count === 2) throw new DOMException('Injected quota failure', 'QuotaExceededError');
						return window.__originalPut.apply(this, args);
					};
				`);
			}
			await submit(d, '#edit-tx-form');
			await waitForDialog(d, '保存に失敗');
			if (failure === 'encryption') await d.evaluate('window.__yose_app.db.encryptRecord = window.__originalEncrypt');
			else await d.evaluate('IDBObjectStore.prototype.put = window.__originalPut');
			assert.deepEqual(await records(d), before);
			assert.equal(await d.isVisible('#modal-edit-tx'), true);
		});
	}

	for (const destination of ['2026-10-20', '2026-08-20']) {
		it(`moves a closed transaction to ${destination} using its original month in an approved batch`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('move', { date: '2026-09-20', target_month: '2026-09', sync_status: 'synced' })]);
			await configureGas(d, { success: true });
			await cashflow(d);
			await d.fill('#input-period-picker', '2026-09');
			await d.waitFor('document.querySelector("#month-tx-list [data-id=move]") !== null');
			await d.click('#month-tx-list .tx-item[data-id="move"]');
			await d.fill('#edit-tx-date', destination);
			await submit(d, '#edit-tx-form');
			await d.waitFor(async () => d.requests.some(r => r.url === gasUrl && JSON.parse(r.body).action === 'push_diff'));
			const request = JSON.parse(d.requests.find(r => r.url === gasUrl && JSON.parse(r.body).action === 'push_diff').body);
			assert.equal(request.payload.transactions[0].previous_target_month, '2026-09');
			assert.equal(request.payload.transactions[0].target_month, destination.slice(0, 7));
			await d.waitFor('(async () => (await window.__yose_app.db.getTransaction("move")).sync_status === "synced")()');
			assert.equal((await records(d))[0].previous_target_month, undefined);
		});
	}

	it('retries a failed archived edit through an approved manual batch', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('retry', { date: '2026-09-20', target_month: '2026-09', sync_status: 'synced' })]);
		await configureGas(d, { success: false, error: 'temporary failure' });
		await cashflow(d);
		await d.fill('#input-period-picker', '2026-09');
		await d.waitFor('document.querySelector("#month-tx-list [data-id=retry]") !== null');
		await d.click('#month-tx-list .tx-item[data-id="retry"]');
		await d.fill('#edit-tx-amount', '222');
		await submit(d, '#edit-tx-form');
		await waitForDialog(d, '遡及更新エラー');
		assert.equal((await records(d))[0].sync_status, 'unsynced');
		setGasResponse(d, { json: { success: true, snapshot: { schema_version: 2, last_closed_month: '2026-09', account_balances: {}, monthly_summaries: { '2026-09': { income_total: 0, expense_total: 222, net_income: -222 } } } } });
		const start = d.requests.length;
		await d.click('#btn-header-sync');
		await waitForDialog(d, '差分同期完了');
		const retried = d.requests.slice(start).filter(r => r.url === gasUrl).map(r => JSON.parse(r.body));
		assert.deepEqual(retried.map(r => r.action), ['fetch_state', 'fetch_master', 'push_diff', 'fetch_state']);
		assert.equal((await records(d))[0].sync_status, 'synced');
		assert.equal((await d.evaluate('window.__yose_app.db.getSnapshot()')).monthly_summaries['2026-09'].expense_total, 222);
	});

	it('keeps the prepaid parent destination fixed while ordinary transfer destinations remain editable', async () => {
		const d = fixture.driver;
		const txs = await prepaid(d);
		const parent = txs.find(t => t.amortization_meta.is_payment_record);
		await d.click(`#month-tx-list .tx-item[data-id="${parent.id}"]`);
		assert.equal(await d.evaluate('document.getElementById("edit-tx-to-account").disabled'), true);
		assert.equal(await value(d, '#edit-tx-to-account'), 'acc_prepaid');
		await d.click('#btn-close-edit-tx');
		await seed(d, [transaction('ordinary_transfer', { type: 'transfer', category_id: null, to_account_id: 'acc_bank_main' })]);
		await cashflow(d);
		await d.click('#month-tx-list .tx-item[data-id="ordinary_transfer"]');
		assert.equal(await d.evaluate('document.getElementById("edit-tx-to-account").disabled'), false);
	});
	it('retains the first source month across two failed moves and removes it only after acknowledgement', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('double_move', { date: '2026-09-20', target_month: '2026-09', sync_status: 'synced' })]);
		await configureGas(d, { success: false, error: 'temporary failure' });
		await cashflow(d);
		for (const [source, destination] of [['2026-09', '2026-10-20'], ['2026-10', '2026-11-20']]) {
			await d.fill('#input-period-picker', source);
			await d.waitFor('document.querySelector("#month-tx-list [data-id=double_move]") !== null');
			await d.click('#month-tx-list .tx-item[data-id="double_move"]');
			await d.waitFor('document.getElementById("modal-edit-tx").classList.contains("active") && document.getElementById("edit-tx-id").value === "double_move"');
			await d.fill('#edit-tx-date', destination);
			const before = d.requests.length;
			await submit(d, '#edit-tx-form');
			await d.waitFor(async () => {
				const submitted = d.requests.slice(before).some(request => {
					if (request.url !== gasUrl || !request.body) return false;
					const envelope = JSON.parse(request.body);
					return envelope.action === 'push_diff' && envelope.payload.transactions.some(tx=>tx.id === 'double_move' && tx.date === destination);
				});
				return submitted && !await d.evaluate('window.__yose_app.syncManager.isSyncing');
			});
			assert.equal((await records(d))[0].previous_target_month, '2026-09');
		}
		setGasResponse(d, { json: { success: true } });
		await d.click('#btn-header-sync');
		await waitForDialog(d, '差分同期完了');
		const request = d.requests.filter(r => r.url === gasUrl).map(r => JSON.parse(r.body)).filter(r => r.action === 'push_diff').at(-1);
		assert.equal(request.action, 'push_diff');
		assert.equal(request.payload.transactions[0].previous_target_month, '2026-09');
		assert.equal(request.payload.transactions[0].target_month, '2026-11');
		assert.equal((await records(d))[0].previous_target_month, undefined);
	});

	it('moves a prepaid parent out of a closed month without changing the amortization schedule', async () => {
		const d = fixture.driver;
		await d.fill('#input-date', '2026-09-20');
		const initial = await prepaid(d);
		const parent = initial.find(t => t.amortization_meta.is_payment_record);
		await configureGas(d, { success: true });
		await cashflow(d);
		await d.fill('#input-period-picker', '2026-09');
		await d.waitFor(`document.querySelector('#month-tx-list [data-id="${parent.id}"]') !== null`);
		await d.click(`#month-tx-list .tx-item[data-id="${parent.id}"]`);
		await d.fill('#edit-tx-date', '2026-10-21');
		await submit(d, '#edit-tx-form');
		await d.waitFor(async () => d.requests.some(r => r.url === gasUrl && JSON.parse(r.body).payload?.transactions?.some(tx=>tx.id === parent.id)));
		const moved = d.requests.filter(r => r.url === gasUrl).map(r => JSON.parse(r.body)).find(r => r.payload?.transactions?.some(tx=>tx.id === parent.id));
		assert.equal(moved.action, 'push_diff');
		assert.equal(moved.payload.transactions.find(tx=>tx.id === parent.id).previous_target_month, '2026-09');
		const after = await records(d);
		assert.deepEqual(after.filter(t => t.type === 'expense').map(t => [t.id, t.date, t.amount]), initial.filter(t => t.type === 'expense').map(t => [t.id, t.date, t.amount]));
	});

	it('preserves a newer UI edit while encrypting the acknowledgement before the native IDB write', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('ack_window', { previous_target_month: '2026-09' })]);
		await configureGas(d, { success: true });
		await d.evaluate(`
			const db = window.__yose_app.db;
			window.__originalEncrypt = db.encryptRecord;
			window.__ackStarted = false;
			window.__ackBarrier = new Promise(resolve => { window.__releaseAck = resolve; });
			db.encryptRecord = async function(payload, ...rest) {
				if (payload.id === 'ack_window' && payload.sync_status === 'synced' && !window.__ackStarted) {
					window.__ackStarted = true;
					await window.__ackBarrier;
				}
				return window.__originalEncrypt.call(this, payload, ...rest);
			};
		`);
		try {
			await cashflow(d);
			await d.click('#month-tx-list .tx-item[data-id="ack_window"]');
			await d.fill('#edit-tx-amount', '111');
			await submit(d, '#edit-tx-form');
			await d.waitFor('window.__ackStarted');
			await d.click('#month-tx-list .tx-item[data-id="ack_window"]');
			await d.fill('#edit-tx-amount', '222');
			await d.fill('#edit-tx-date', '2026-11-20');
			await submit(d, '#edit-tx-form');
			await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
			await d.evaluate('window.__releaseAck()');
			await d.waitFor('!window.__yose_app.syncManager.isSyncing');
			const [latest] = await records(d);
			assert.equal(latest.amount, 222);
			assert.equal(latest.target_month, '2026-11');
			assert.equal(latest.sync_status, 'unsynced');
			assert.equal(latest.previous_target_month, '2026-09');
		} finally {
			await d.evaluate('window.__releaseAck(); window.__yose_app.db.encryptRecord = window.__originalEncrypt');
		}
	});

	for (const route of ['open', 'closed']) {
		it(`keeps an edit made through the UI while ${route} is waiting unsynced`, async () => {
			const d = fixture.driver;
			const source = route === 'closed' ? '2026-09' : '2026-10';
			await seed(d, [transaction('inflight', { date: source + '-20', target_month: source, sync_status: 'synced' })]);
			let release;
			const barrier = new Promise(resolve => { release = resolve; });
			await configureGas(d, { success: true });
			setGasResponse(d, { json: { success: true }, wait: barrier });
			try {
				await cashflow(d);
				await d.fill('#input-period-picker', source);
				await d.waitFor('document.querySelector("#month-tx-list [data-id=inflight]") !== null');
				await d.click('#month-tx-list .tx-item[data-id="inflight"]');
				await d.fill('#edit-tx-date', '2026-10-20');
				await d.fill('#edit-tx-amount', '111');
				await submit(d, '#edit-tx-form');
				await d.waitFor(async () => d.requests.some(r => r.url === gasUrl));
				await d.click('#month-tx-list .tx-item[data-id="inflight"]');
				await d.fill('#edit-tx-amount', '222');
				if (route === 'closed') await d.fill('#edit-tx-date', '2026-11-20');
				await submit(d, '#edit-tx-form');
				await d.waitFor('!document.getElementById("modal-edit-tx").classList.contains("active")');
				release();
				await d.waitFor('!window.__yose_app.syncManager.isSyncing');
				const [latest] = await records(d);
				assert.equal(latest.amount, 222);
				assert.equal(latest.sync_status, 'unsynced');
				if (route === 'closed') assert.equal(latest.previous_target_month, '2026-09');
			} finally {
				release();
			}
		});
	}

});
