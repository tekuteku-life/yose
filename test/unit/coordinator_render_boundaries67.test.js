import { it } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { AppCoordinator } from '../../js/ui/coordinator.js';

const key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
async function fixture(run){
	const document=globalThis.document,warn=console.warn,calls=[],warnings=[],options=[];
	const c=Object.assign(Object.create(AppCoordinator.prototype),{db:{encryptionKey:key,keyGeneration:1},authController:{authGeneration:1,isKeyLocked:false}});
	const step=name=>async value=>{calls.push(name);options.push(value);await Promise.resolve();};
	c.db.processCreditCardAutoSettlements=async(_date,value)=>{await step('card')(value);return[];};
	c.txInputController={submitBusy:false,populateMasterDropdowns:step('dropdown'),updateTagAndMemoSuggestions:step('suggestions'),renderUnsettledAdvanceList:step('advances')};c.txListController={renderRecentTransactions:step('recent')};c.summaryController={renderSummary:step('summary')};c.settingsController={renderSettings:step('settings')};c.furusatoController={render:async(_state,value)=>step('tax')(value)};c.syncStatusController={updateSyncBadge:step('badge')};c.maintenanceController={refresh:step('maintenance')};c.syncManager={privateKey:{},gasUrl:'https://yose.local/component',isSyncing:false,syncPendingDiffs:step('sync')};
	globalThis.document={getElementById:()=>({classList:{contains:()=>true}})};console.warn=(...args)=>warnings.push(args.join(' '));
	try{await run({c,calls,warnings,options,step});}finally{if(document===undefined)delete globalThis.document;else globalThis.document=document;console.warn=warn;}
}
const order=['card','dropdown','recent','summary','settings','tax','badge','maintenance'];
for(const stage of order.slice(0,-1))it(`stops a full refresh after ${stage} finishes in an obsolete authentication generation`,()=>fixture(async f=>{
	const targets={card:[f.c.db,'processCreditCardAutoSettlements'],dropdown:[f.c.txInputController,'populateMasterDropdowns'],recent:[f.c.txListController,'renderRecentTransactions'],summary:[f.c.summaryController,'renderSummary'],settings:[f.c.settingsController,'renderSettings'],tax:[f.c.furusatoController,'render'],badge:[f.c.syncStatusController,'updateSyncBadge']},[owner,name]=targets[stage],method=owner[name];
	owner[name]=async function(...args){const value=await method.apply(this,args);f.c.authController.authGeneration++;return value;};
	await f.c.refreshAllViews();assert.deepEqual(f.calls,order.slice(0,order.indexOf(stage)+1));assert.ok(f.options.every(o=>typeof o.isSessionValid==='function'&&!o.isSessionValid()));
}));
it('propagates one active parent predicate through the full refresh and skips all work for an expired parent',()=>fixture(async f=>{
	await f.c.refreshAllViews({isSessionValid:()=>false});assert.deepEqual(f.calls,[]);
	await f.c.refreshAllViews();assert.deepEqual(f.calls,order);assert.ok(f.options.every(o=>o.isSessionValid===f.options[0].isSessionValid&&o.isSessionValid()));
}));
it('keeps full rendering available after a card-generation dependency failure',()=>fixture(async f=>{
	f.c.db.processCreditCardAutoSettlements=async()=>{f.calls.push('card');throw new Error('CARD_FAILURE67');};await f.c.refreshAllViews();assert.deepEqual(f.calls,order);assert.equal(f.warnings.length,1);assert.match(f.warnings[0],/CARD_FAILURE67/);
}));
for(const change of ['busy','auth'])it(`leaves input candidates alone when ${change} changes while suggestions are loading`,()=>fixture(async f=>{
	f.c.txInputController.updateTagAndMemoSuggestions=async value=>{await f.step('suggestions')(value);if(change==='busy')f.c.txInputController.submitBusy=true;else f.c.authController.authGeneration++;};
	await f.c.scheduleTransactionMaintenance();assert.equal(f.calls.includes('advances'),false);assert.equal(f.calls.includes('sync'),change==='busy');assert.equal(f.c._transactionMaintenanceTask,null);
}));
for(const obsolete of [false,true])it(`handles a badge failure after background work without ${obsolete?'announcing it in a new session':'restarting a failed task'}`,()=>fixture(async f=>{
	f.c.db.processCreditCardAutoSettlements=async()=>{throw new Error('BACKGROUND_FAILURE67');};f.c.syncStatusController.updateSyncBadge=async value=>{await f.step('badge')(value);if(obsolete)f.c.authController.authGeneration++;throw new Error('BADGE_FAILURE67');};
	await f.c.scheduleTransactionMaintenance();assert.deepEqual(f.calls,['badge']);assert.equal(f.warnings.length,obsolete?1:2);if(!obsolete)assert.match(f.warnings[1],/BADGE_FAILURE67/);assert.equal(f.c._transactionMaintenanceTask,null);
}));
it('silences a failed background dependency after its originating authentication generation expires',()=>fixture(async f=>{
	f.c.db.processCreditCardAutoSettlements=async()=>{f.c.authController.authGeneration++;throw new Error('OLD_FAILURE67');};await f.c.scheduleTransactionMaintenance();assert.deepEqual(f.calls,[]);assert.deepEqual(f.warnings,[]);assert.equal(f.c._transactionMaintenanceTask,null);
}));
