import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { sharedMasterConfig } from '../../js/logic/master_sync.js';
import { generateEd25519KeyPair, generateDatabaseMasterKey } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';
const clone = value => structuredClone(value);
const rawState = db => Promise.all(['transactions', 'master_config', 'summary_snapshot'].map(store => db.getAllRaw(store)));
async function fixture() {
	const db = new YoseDB(); await db.init(); db.setEncryptionKey(await generateDatabaseMasterKey());
	const master = sharedMasterConfig(await db.getMasterConfig());
	await db.commitMasterSync(await db.getMasterConfig(), master);
	const remote = { master_config: clone(master), pending_diffs: [], archived_transactions: [], snapshot: await db.getSnapshot(), archive_months: [] };
	const actions = [];
	const { privateKey } = await generateEd25519KeyPair();
	const sync = new SyncManager({ db, privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => {
		const { action, payload } = JSON.parse(options.body); actions.push(action);
		if (action === 'update_master') remote.master_config = clone(payload.master_config);
		if (action === 'push_diff') remote.pending_diffs.push(...clone(payload.transactions));
		return { ok: true, text: async () => JSON.stringify({ success: true, ...remote, accepted_ids: payload.transactions?.map(tx => tx.id) }) };
	} });
	return { db, sync, remote, actions };
}

it('rejects explicitly malformed remote masters before shared-field projection', async () => {
	const { db, sync } = await fixture(), before = await rawState(db);
	for (const value of [false, 0, 'bad', []]) await assert.rejects(sync.syncSharedMaster(value));
	assert.deepEqual(await rawState(db), before);
});

describe('Atomic integrity validation across synchronization boundaries', () => {
	for (const defect of ['transaction reference', 'transaction shape', 'snapshot value', 'snapshot category']) {
		it(`rejects an invalid remote ${defect} without applying any received store`, async () => {
			const { db, sync, remote } = await fixture();
			remote.master_config.accounts[0].name = 'valid remote master';
			remote.pending_diffs.push(transaction('valid-remote'));
			if (defect === 'transaction reference') remote.pending_diffs.push(transaction('invalid', { account_id: 'missing' }));
			if (defect === 'transaction shape') remote.pending_diffs.push(transaction('invalid', { amount: 'bad' }));
			if (defect === 'snapshot value') remote.snapshot.account_balances.acc_wallet = 'bad';
			if (defect === 'snapshot category') remote.snapshot.monthly_summaries = { '2026-09': { income_total: 0, expense_total: 1, net_income: -1, by_category: { missing: { total: 1, by_subcategory: {} } }, by_actual_category: {}, closing_balances: {} } };
			const before = await rawState(db);
			await assert.rejects(sync.syncBidirectional());
			assert.deepEqual(await rawState(db), before);
		});
	}
	for (const entry of ['downloadTransactions', 'fetchRemoteState']) {
		it(`keeps all stores unchanged on invalid state through ${entry}`, async () => {
			const { db, sync, remote } = await fixture();
			remote.master_config.accounts[0].name = 'valid remote master';
			remote.pending_diffs.push(transaction('valid'), transaction('invalid', { amount: 'bad' }));
			remote.snapshot.account_balances.acc_wallet += 200;
			const before = await rawState(db);
			await assert.rejects(sync[entry]());
			assert.deepEqual(await rawState(db), before);
		});
		it(`keeps all stores unchanged on unresolved master conflict through ${entry}`, async () => {
			const { db, sync, remote } = await fixture();
			const local = await db.getMasterConfig(); local.accounts[0].name = 'local'; await db.saveMasterConfig(local);
			remote.master_config.accounts[0].name = 'remote'; remote.pending_diffs.push(transaction('remote-only'));
			remote.snapshot.account_balances.acc_wallet += 200;
			const before = await rawState(db);
			try { await sync[entry](); } catch (error) { assert.match(error.message, /確認|競合/); }
			assert.deepEqual(await rawState(db), before);
		});
	}
	for (const change of ['lock', 'private key']) {
		it(`keeps every received store unchanged after ${change} during encryption`, async () => {
			const { db, sync, remote } = await fixture();
			remote.pending_diffs.push(transaction('remote-only'));
			remote.snapshot.account_balances.acc_wallet += 200;
			const before = await rawState(db), encrypt = db.encryptRecord.bind(db);
			let injected = false;
			db.encryptRecord = async (...args) => {
				const payload = args[0];
				if (payload.id === 'remote-only' && !injected) {
					injected = true;
					if (change === 'lock') db.setEncryptionKey(null);
					else sync.setPrivateKey((await generateEd25519KeyPair()).privateKey);
				}
				return encrypt(...args);
			};
			await assert.rejects(sync.syncBidirectional(), /認証|ロック|鍵|session|encryption/i);
			assert.equal(injected, true); assert.deepEqual(await rawState(db), before);
		});
	}
	it('keeps remote records and snapshot unapplied when master conflict resolution is cancelled', async () => {
		const { db, sync, remote } = await fixture();
		const local = await db.getMasterConfig(); local.accounts[0].name = 'local'; await db.saveMasterConfig(local);
		remote.master_config.accounts[0].name = 'remote'; remote.pending_diffs.push(transaction('remote-only'));
		remote.snapshot.account_balances.acc_wallet += 200;
		const before = await rawState(db);
		assert.equal((await sync.syncBidirectional({ approveMasterConflict: async () => false })).status, 'master_conflict_cancelled');
		assert.deepEqual(await rawState(db), before);
	});
	for (const entry of ['syncPendingDiffs', 'closeMonth', 'sendRetroactiveUpdate']) {
	it(`uploads a new master before transactions through ${entry}`, async () => {
		const { db, sync, remote, actions } = await fixture();
		const config = await db.getMasterConfig();
		config.categories.push({ id: 'new-category', name: 'new', type: 'expense', subcategories: [] });
		await db.saveMasterConfig(config);
		const row = transaction('new-reference', { category_id: 'new-category', actual_category_id: 'new-category' });
		if (entry !== 'sendRetroactiveUpdate') await db.putTransaction(row);
		if (entry === 'closeMonth') await sync.closeMonth('2026-10');
		else if (entry === 'sendRetroactiveUpdate') await sync.sendRetroactiveUpdate(row);
		else await sync.syncPendingDiffs();
		assert.ok(actions.indexOf('update_master') >= 0);
		const writeAction = entry === 'sendRetroactiveUpdate' ? 'retroactive_update' : 'push_diff';
		assert.ok(actions.indexOf('update_master') < actions.indexOf(writeAction));
		assert.ok(remote.master_config.categories.some(category => category.id === 'new-category'));
		if (entry !== 'sendRetroactiveUpdate') assert.equal(remote.pending_diffs[0].id, 'new-reference');
	});
	}
	for (const entry of ['syncPendingDiffs', 'closeMonth', 'sendRetroactiveUpdate']) {
		for (const defect of ['invalid snapshot', 'private key change']) {
			it(`preserves the entire response candidate for ${entry} on ${defect}`, async () => {
				const { db, sync, remote } = await fixture();
				const row = transaction('response-boundary');
				if (entry !== 'sendRetroactiveUpdate') await db.putTransaction(row);
				const fetch = sync.fetch;
				const responseAction = entry === 'closeMonth' ? 'close_month' : entry === 'sendRetroactiveUpdate' ? 'retroactive_update' : 'push_diff';
				let beforeResponse = null, armed = false, injected = false;
				sync.fetch = async (...args) => {
					const result = await fetch(...args), request = JSON.parse(args[1].body);
					if (request.action !== responseAction) return result;
					beforeResponse = await rawState(db); armed = true;
					const body = JSON.parse(await result.text());
					if (entry === 'closeMonth') {
						body.archived_transactions = [{ ...row, status: 'confirmed' }];
						body.pending_diffs = body.pending_diffs.filter(item => item.id !== row.id);
					}
					if (defect === 'invalid snapshot') body.snapshot.account_balances.acc_wallet = 'invalid';
					else body.snapshot.account_balances.acc_wallet += 10;
					return { ok: true, text: async () => JSON.stringify(body) };
				};
				const encrypt = db.encryptRecord.bind(db);
				db.encryptRecord = async (...args) => {
					if (armed && defect === 'private key change' && !injected) { injected = true; sync.setPrivateKey((await generateEd25519KeyPair()).privateKey); }
					return encrypt(...args);
				};
				const operation = () => entry === 'closeMonth' ? sync.closeMonth('2026-10') : entry === 'sendRetroactiveUpdate' ? sync.sendRetroactiveUpdate(row) : sync.syncPendingDiffs();
				await assert.rejects(operation, defect === 'private key change' ? /認証|ロック|鍵|session/i : /整合|残高|数値|number/i);
				assert.ok(beforeResponse); assert.deepEqual(await rawState(db), beforeResponse);
				if (defect === 'private key change') assert.equal(injected, true);
			});
		}
	}
	it('accepts first-received history that references an archived remote category', async () => {
		const { db, sync, remote } = await fixture();
		remote.master_config.categories.find(category => category.id === 'cat_food').is_archived = true;
		remote.pending_diffs.push(transaction('historical'));
		await sync.downloadTransactions();
		assert.equal((await db.getTransaction('historical')).category_id, 'cat_food');
	});
	it('does not acknowledge a dirty local master when a legacy receive omits the remote master', async () => {
		const { db, sync, remote } = await fixture();
		const local = await db.getMasterConfig(); local.accounts[0].name = 'unsent'; await db.saveMasterConfig(local);
		const base = await db.getMasterSyncBase();
		delete remote.master_config; remote.pending_diffs.push(transaction('legacy-remote'));
		await sync.downloadTransactions();
		assert.equal((await db.getMasterConfig()).accounts[0].name, 'unsent');
		assert.deepEqual(await db.getMasterSyncBase(), base);
		assert.equal(await db.hasUnsyncedMasterConfig(), true);
		assert.ok(await db.getTransaction('legacy-remote'));
	});
	it('checks all received state before uploading a merged master', async () => {
		const { db, sync, remote, actions } = await fixture();
		const local = await db.getMasterConfig(); local.accounts[0].name = 'local'; await db.saveMasterConfig(local);
		remote.pending_diffs.push(transaction('invalid', { account_id: 'missing' }));
		const originalRemote = clone(remote.master_config);
		await assert.rejects(sync.syncBidirectional());
		assert.deepEqual(remote.master_config, originalRemote);
		assert.equal(actions.includes('update_master'), false);
	});
});
