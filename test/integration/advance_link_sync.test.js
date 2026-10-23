import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { YoseDB } from '../../js/db.js';
import { SyncManager } from '../../js/sync.js';
import { generateEd25519KeyPair, exportPublicKeyBase64 } from '../../js/crypto.js';
import { transaction } from '../helpers/ui_fixture.js';
import { MockGasEnvironment } from '../helpers/gas_mock.js';
const gas = createRequire(import.meta.url)('../../gas/Code.gs');
const source = () => transaction('advance', { type: 'transfer', to_account_id: 'acc_receivable', category_id: null, actual_category_id: null, date: '2026-09-20', target_month: '2026-09', reclose_approved_months: ['2026-09'] });
const repayment = extra => transaction('repayment', { type: 'transfer', account_id: 'acc_receivable', to_account_id: 'acc_wallet', category_id: null, actual_category_id: null, ...extra });

describe('advance links across signed sync and archive boundaries', () => {
	let env, db, sync, actions;
	beforeEach(async () => {
		env = new MockGasEnvironment(); env.setupGlobals(); db = new YoseDB(); await db.init();
		const kp = await generateEd25519KeyPair();
		PropertiesService.getScriptProperties().setProperty('USER_PUBLIC_KEYS', await exportPublicKeyBase64(kp.publicKey));
		gas.saveJsonFile('master_config.json', await db.getMasterConfig());
		gas.saveJsonFile('summary_snapshot.json', await db.getSnapshot());
		actions=[];
		sync=new SyncManager({db,privateKey:kp.privateKey,gasUrl:'https://gas.test',customFetch:async(_url,options)=>{
			const request=JSON.parse(options.body); actions.push(request.action);
			return {ok:true,text:async()=>JSON.stringify(gas.doPost({postData:{contents:options.body}}))};
		}});
	});
	afterEach(()=>env.teardownGlobals());
	it('uploads a link once, then atomically unlinks and edits the closed source in one batch', async () => {
		await db.putTransactions([source(),repayment()]);
		await sync.syncBidirectional();
		await db.linkAdvanceRepayment(await db.getTransaction('advance'),await db.getTransaction('repayment'));
		await sync.syncBidirectional();
		assert.equal(gas.handleAction('fetch_state',{}).pending_diffs.find(tx=>tx.id==='repayment').advance_source_id,'advance');
		await db.unlinkAdvanceRepayment(await db.getTransaction('repayment'));
		const a=await db.getTransaction('advance'); await db.putTransaction({...a,amount:200,reclose_approved_months:['2026-09'],sync_status:'unsynced'});
		actions.length=0; await sync.syncBidirectional();
		assert.equal(actions.filter(action=>action==='push_diff').length,1); assert.ok(!actions.includes('retroactive_update'));
		const state=gas.handleAction('fetch_state',{});
		assert.equal(state.archived_transactions.find(tx=>tx.id==='advance').amount,200);
		assert.equal(state.pending_diffs.find(tx=>tx.id==='repayment').advance_source_id,undefined);
		assert.equal(state.snapshot.account_balances.acc_receivable,200);
		assert.equal((await db.getUnsettledAdvancePayments()).length,1);
	});
	it('rejects an unapproved closed record and all other writes in the same batch', () => {
		const before=gas.handleAction('fetch_state',{}); const a=source(); delete a.reclose_approved_months;
		const result=gas.handleAction('push_diff',{transactions:[repayment(),a]});
		assert.equal(result.success,false); assert.deepEqual(gas.handleAction('fetch_state',{}),before);
	});
	it('rejects a conflicting origin that would invalidate the accepted repayment and preserves every file', () => {
		gas.saveJsonFile('archives/2026-09.json',{transactions:[{...source(),amount:200,updated_at:'2026-11-01T00:00:00Z'}]});
		const before=gas.handleAction('fetch_state',{});
		const result=gas.handleAction('push_diff',{transactions:[source(),repayment({advance_source_id:'advance'})]});
		assert.equal(result.success,false); assert.deepEqual(gas.handleAction('fetch_state',{}),before);
	});
	it('rejects partial legacy settlement migration even when the conflicting source has the same amount', () => {
		const legacy={...source(),settlement_status:'settled',updated_at:'2026-11-01T00:00:00Z'};
		gas.saveJsonFile('archives/2026-09.json',{transactions:[legacy]});
		const before=gas.handleAction('fetch_state',{});
		const result=gas.handleAction('push_diff',{transactions:[{...source(),settlement_status:'unsettled'},repayment({advance_source_id:'advance'})]});
		assert.equal(result.success,false); assert.deepEqual(gas.handleAction('fetch_state',{}),before);
	});
	it('preserves links in backup import and rejects a malformed duplicate import atomically', async () => {
		const a={...source(),date:'2026-10-20',target_month:'2026-10'},r=repayment({advance_source_id:'advance'});
		await db.putTransactions([a,r]);
		const json=JSON.parse(JSON.stringify({transactions:await db.getTransactions()}));
		const copy=new YoseDB(); await copy.init(); await copy.importFullData(json);
		assert.deepEqual(await copy.getUnsettledAdvancePayments(),[]);
		const before=await copy.getTransactions();
		await assert.rejects(copy.importFullData({transactions:[repayment({id:'duplicate',advance_source_id:'advance'})]}));
		assert.deepEqual(await copy.getTransactions(),before);
	});
});
