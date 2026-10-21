import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateEd25519KeyPair, generateDatabaseMasterKey, canonicalJsonStringify } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';

const config = name => ({ schema_version: 2, accounts: [{ id: 'wallet', name, type: 'cash' }], categories: [{ id: 'cat_food', name: '食費', type: 'expense', subcategories: [] }], recurring_rules: [], holidays: [], annual_budgets: {} });
async function fixture() {
	const db = new YoseDB(); await db.init();
	await db.saveSnapshot({ schema_version: 2, last_closed_month: null, account_balances: {}, monthly_summaries: {} });
	await db.saveMasterConfig(config('共有基点'));
	await db.commitMasterSync(await db.getMasterConfig(), config('共有基点'));
	const { privateKey } = await generateEd25519KeyPair();
	const state = { master: config('別端末'), records: [], fail: null, beforePush: null, beforeUpdate: null, actions: [] };
	await db.saveMasterConfig(config('手元'));
	const sync = new SyncManager({ db, privateKey, gasUrl: 'https://gas.test', customFetch: async (_url, options) => {
		const { action, payload } = JSON.parse(options.body); state.actions.push(action);
		if (state.fail) throw state.fail;
		if (action === 'update_master') {
			if (state.beforeUpdate) await state.beforeUpdate();
			if (payload.base_version !== canonicalJsonStringify(state.master)) return {ok:true,text:async()=>JSON.stringify({success:true,master_conflict:true})};
			state.master = structuredClone(payload.master_config);
		}
		if (action === 'push_diff') {
			state.records.push(...payload.transactions);
			if (state.beforePush) await state.beforePush();
		}
		return { ok: true, text: async () => JSON.stringify({ success: true, master_config: state.master, pending_diffs: state.records, archived_transactions: [], accepted_ids: payload.transactions?.map(row => row.id) }) };
	} });
	return { db, sync, state };
}

describe('master conflict outcomes and partial synchronization', () => {
	it('returns an automatic confirmation-pending outcome and keeps both masters and the base', async () => {
		const { db, sync, state } = await fixture();
		const original = await db.getMasterConfig(), base = await db.getMasterSyncBase();
		const result = await sync.syncBidirectional();
		assert.equal(result.status, 'master_conflict');
		assert.deepEqual(sync.masterConflictPaths, ['accounts.wallet.name']);
		assert.equal(sync.lastError, null);
		assert.deepEqual(await db.getMasterConfig(), original); assert.deepEqual(await db.getMasterSyncBase(), base);
		assert.equal(state.master.accounts[0].name, '別端末'); assert.ok(!state.actions.includes('update_master'));
	});
	it('returns cancellation without treating it as a communication failure or advancing the base', async () => {
		const { db, sync, state } = await fixture();
		const original = await db.getMasterConfig(), base = await db.getMasterSyncBase(); let confirmations = 0;
		const result = await sync.syncBidirectional({ approveMasterConflict: async () => { confirmations++; return false; } });
		assert.equal(result.status, 'master_conflict_cancelled'); assert.equal(confirmations, 1);
		assert.equal(sync.lastError, null); assert.deepEqual(result.conflict_paths, ['accounts.wallet.name']);
		assert.deepEqual(await db.getMasterConfig(), original); assert.deepEqual(await db.getMasterSyncBase(), base);
		assert.equal(state.master.accounts[0].name, '別端末'); assert.ok(!state.actions.includes('update_master'));
	});
	it('retains a master conflict during pending-only synchronization and clears it after master approval', async () => {
		const { db, sync, state } = await fixture();
		await sync.syncBidirectional({ approveMasterConflict: async () => false });
		await db.putTransaction(transaction('pending', { account_id: 'wallet' }));
		await sync.syncPendingDiffs();
		assert.deepEqual(sync.masterConflictPaths, ['accounts.wallet.name']);
		await sync.syncBidirectional({ approveMasterConflict: async () => true });
		assert.deepEqual(sync.masterConflictPaths, []); assert.equal(sync.lastError, null);
		assert.equal(state.master.accounts[0].name, '手元'); assert.equal(await db.hasUnsyncedMasterConfig(), false);
	});
	it('continues to throw genuine network failures and retains unresolved master information', async () => {
		const { sync, state } = await fixture();
		await sync.syncBidirectional(); state.fail = new TypeError('Failed to fetch');
		await assert.rejects(sync.syncBidirectional(), /接続/);
		assert.match(sync.lastError, /接続/); assert.deepEqual(sync.masterConflictPaths, ['accounts.wallet.name']);
	});
	it('retains completed upload and download counts when the second receive is cancelled', async () => {
		const { db, sync, state } = await fixture();
		state.master = config('共有基点');
		state.records = [transaction('remote', { account_id: 'wallet' })];
		await db.putTransaction(transaction('local', { account_id: 'wallet' }));
		state.beforePush = async () => { state.master = config('再受信の別端末'); await db.saveMasterConfig(config('再受信の手元')); };
		const result = await sync.syncBidirectional({ approveMasterConflict: async () => false });
		assert.equal(result.status, 'master_conflict_cancelled');
		assert.equal(result.synced_count, 1); assert.ok(result.downloaded_count >= 1); assert.equal(result.pending_count, 0);
		assert.equal((await db.getTransaction('local')).sync_status, 'synced'); assert.ok(await db.getTransaction('remote'));
		assert.equal((await db.getMasterConfig()).accounts[0].name, '再受信の手元');
		assert.equal(state.master.accounts[0].name, '再受信の別端末'); assert.equal(sync.lastError, null);
	});
	for (const method of ['syncMaster', 'fetchRemoteState']) {
		it(`reports a pending conflict from ${method} without a failure state`, async () => {
			const { sync } = await fixture();
			assert.equal((await sync[method]()).status, 'master_conflict');
			assert.equal(sync.lastError, null); assert.deepEqual(sync.masterConflictPaths, ['accounts.wallet.name']);
		});
	}
});


describe('explicit per-field master conflict resolution', () => {
	it('uses selected local and remote values while preserving nonconflicting edits', async () => {
		const {db,sync,state}=await fixture();
		const local=await db.getMasterConfig();local.accounts[0].type='credit_card';await db.saveMasterConfig(local);
		state.master.accounts[0].type='bank';state.master.holidays=['2027-01-01'];
		await sync.syncBidirectional({approveMasterConflict:async(_paths,details,validate)=>{
			const choices=Object.fromEntries(details.map(d=>[d.id,d.path.endsWith('.name')?'remote':'local']));
			await assert.doesNotReject(()=>validate(choices));return choices;
		}});
		const current=await db.getMasterConfig();assert.equal(current.accounts[0].name,'別端末');assert.equal(current.accounts[0].type,'credit_card');
		assert.deepEqual(current.holidays,['2027-01-01']);assert.equal(state.master.accounts[0].type,'credit_card');
		assert.deepEqual(sync.masterConflictPaths,[]);
	});
	it('adopts all remote values without sending an unnecessary master overwrite', async () => {
		const {db,sync,state}=await fixture();
		await sync.syncBidirectional({approveMasterConflict:async(_paths,details)=>Object.fromEntries(details.map(d=>[d.id,'remote']))});
		assert.equal((await db.getMasterConfig()).accounts[0].name,'別端末');assert.ok(!state.actions.includes('update_master'));
		assert.equal(await db.hasUnsyncedMasterConfig(),false);
	});
	it('refuses incomplete choices without changing either master or its base', async () => {
		const {db,sync,state}=await fixture();const local=await db.getMasterConfig(),base=await db.getMasterSyncBase();
		await assert.rejects(sync.syncBidirectional({approveMasterConflict:async()=>({})}),/選択/);
		assert.deepEqual(await db.getMasterConfig(),local);assert.deepEqual(await db.getMasterSyncBase(),base);
		assert.equal(state.master.accounts[0].name,'別端末');assert.ok(!state.actions.includes('update_master'));
	});
	it('does not reuse choices if the local master changes while the dialog is open', async () => {
		const {db,sync,state}=await fixture();
		const result=await sync.syncBidirectional({approveMasterConflict:async(_paths,details)=>{
			await db.saveMasterConfig(config('確認中の新版'));return Object.fromEntries(details.map(d=>[d.id,'remote']));
		}});
		assert.equal(result.status,'master_conflict');assert.equal(result.reason,'local_changed');
		assert.equal((await db.getMasterConfig()).accounts[0].name,'確認中の新版');assert.equal(state.master.accounts[0].name,'別端末');
		assert.ok(!state.actions.includes('update_master'));
	});
	it('refuses stale approval after authentication is locked', async () => {
		const {db,sync,state}=await fixture();const original=await db.getMasterConfig();
		await assert.rejects(sync.syncBidirectional({approveMasterConflict:async(_paths,details)=>{
			sync.setPrivateKey(null);return Object.fromEntries(details.map(d=>[d.id,'remote']));
		}}),/ロック|認証/);
		assert.deepEqual(await db.getMasterConfig(),original);assert.ok(!state.actions.includes('update_master'));
	});
	it('rejects a remote master changed during resolution using the server base comparison', async () => {
		const {db,sync,state}=await fixture();state.beforeUpdate=async()=>{state.master=config('サーバーの新版')};
		await assert.rejects(sync.syncBidirectional({approveMasterConflict:async(_paths,details)=>Object.fromEntries(details.map(d=>[d.id,'local']))}),/別端末|再取得/);
		assert.equal((await db.getMasterConfig()).accounts[0].name,'手元');assert.equal(state.master.accounts[0].name,'サーバーの新版');
	});
	it('validates references before applying and lets the user correct an inconsistent choice', async () => {
		const {db,sync,state}=await fixture();
		const base={...config('共有基点'),categories:[{id:'cat',name:'元費目',type:'expense',subcategories:[]}],recurring_rules:[{id:'rule',name:'定期料金',type:'expense',amount:100,category_id:'cat',account_id:'wallet'}]};
		await db.saveMasterConfig(base);await db.commitMasterSync(await db.getMasterConfig(),base);
		await db.saveMasterConfig({...base,categories:[],recurring_rules:[]});
		state.master=structuredClone(base);state.master.categories[0].name='別費目名';state.master.recurring_rules[0].name='別端末の定期料金';
		await sync.syncBidirectional({approveMasterConflict:async(_paths,details,validate)=>{
			const invalid=Object.fromEntries(details.map(d=>[d.id,d.path.startsWith('categories')?'local':'remote']));
			await assert.rejects(()=>validate(invalid),/recurring_rules.*category_id.*参照/);
			assert.deepEqual((await db.getMasterConfig()).categories,[]);assert.ok(!state.actions.includes('update_master'));
			const corrected=Object.fromEntries(details.map(d=>[d.id,'remote']));await assert.doesNotReject(()=>validate(corrected));return corrected;
		}});
		assert.equal((await db.getMasterConfig()).recurring_rules[0].name,'別端末の定期料金');
	});
});


describe('master resolution validation and session boundaries', () => {
	for (const value of [[], new Map(), {unknown:'local'}, {'conflict-0':'both'}]) {
		it(`rejects an invalid resolution record ${JSON.stringify(value)} at the synchronization boundary`, async () => {
			const {db,sync,state}=await fixture();const original=await db.getMasterConfig();
			await assert.rejects(sync.syncBidirectional({approveMasterConflict:async()=>value}),/選択|未知/);
			assert.deepEqual(await db.getMasterConfig(),original);assert.ok(!state.actions.includes('update_master'));
		});
	}
	it('does not send an approved master under a key replaced during the final local reread', async () => {
		const {db,sync,state}=await fixture();const replacement=await generateEd25519KeyPair();
		const read=db.getMasterConfig.bind(db);let changed=false;
		let error;
		try { await sync.syncBidirectional({approveMasterConflict:async(_paths,details)=>{
			db.getMasterConfig=async()=>{const current=await read();if(!changed){changed=true;sync.setPrivateKey(replacement.privateKey);}return current;};
			return Object.fromEntries(details.map(d=>[d.id,'local']));
		}}); } catch(caught){error=caught;}
		assert.equal(state.master.accounts[0].name,'別端末');assert.ok(!state.actions.includes('update_master'));
		assert.ok(error);assert.match(error.message,/ロック|認証/);
	});
	it('never persists plaintext if the session locks during master acknowledgement encryption', async () => {
		const {db,sync}=await fixture();const key=await generateDatabaseMasterKey();db.setEncryptionKey(key);
		await db.saveMasterConfig(await db.getMasterConfig());
		const before=await db.getRaw('master_config','current'),base=await db.getRaw('master_config','sync_base');
		const encrypt=db.encryptRecord.bind(db);let locked=false;
		db.encryptRecord=async(...args)=>{
			if(!locked){locked=true;db.clearEncryptionKey();sync.setPrivateKey(null);}
			return encrypt(...args);
		};
		let error;
		try { await sync.syncBidirectional({approveMasterConflict:async(_paths,details)=>Object.fromEntries(details.map(d=>[d.id,'remote']))}); }
		catch(caught) { error=caught; }
		assert.equal(locked,true);assert.deepEqual(await db.getRaw('master_config','current'),before);
		assert.deepEqual(await db.getRaw('master_config','sync_base'),base);assert.equal(before.encrypted,true);
		assert.ok(error);assert.match(error.message,/ロック|認証/);
	});
});
