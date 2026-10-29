import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const f = useBrowser();
it('keeps reusable tag and memo inputs usable with optional elements and omitted suggestion queries', async () => {
	const d = f.driver;
	await d.evaluate(`(async()=>{
		const {TagMemoInput}=await import('/js/ui/tag_memo_input.js');
		const box=document.createElement('section');box.id='component67';box.innerHTML='<input id="text67"><div id="tags67" tabindex="0"></div><div id="chips67"></div><input type="hidden" id="hidden67"><input id="memo67"><div id="memos67" tabindex="0"></div><button id="outside67">外へ移動する</button>';document.querySelector('main').append(box);
		const host={confirmedTags:[]},source={availableTags:['Apple','Banana'],memoHistoryMap:{買物:{}}};
		window.__component67=new TagMemoInput({host,source,ids:{box:'component67',text:'text67',tags:'tags67',chips:'chips67',hidden:'hidden67',memo:'memo67',memos:'memos67'}});window.__component67.setup();window.__component67.renderTagSuggestions();window.__component67.renderMemoSuggestions();
	})()`);
	assert.equal(await d.evaluate('document.querySelectorAll("#tags67 button").length'), 2);
	await d.click('#text67'); await d.send('Input.insertText', {text:'a'}, d.sessionId);
	await d.key('#text67', 'Tab');
	assert.equal(await d.evaluate('document.activeElement.id'),'tags67');
	assert.deepEqual(await d.evaluate('window.__component67.host.confirmedTags'), []);
	await d.key('#tags67 button', 'Tab');
	assert.equal(await d.evaluate('document.activeElement.dataset.value'),'Banana');
	assert.deepEqual(await d.evaluate('window.__component67.host.confirmedTags'), []);
	await d.click('#text67');
	assert.equal(await d.evaluate('document.activeElement.id'),'text67');
	assert.deepEqual(await d.evaluate('window.__component67.host.confirmedTags'), []);
	await d.evaluate('document.querySelector("#text67").select()'); await d.send('Input.insertText', {text:'Banana'}, d.sessionId); await d.key('#text67', 'Tab'); await d.click('#outside67');
	assert.deepEqual(await d.evaluate('window.__component67.host.confirmedTags'), ['Banana']);
	await d.fill('#hidden67', ' Apple, Apple, Banana, '); await d.evaluate('document.querySelector("#hidden67").dispatchEvent(new Event("change",{bubbles:true}))');
	assert.deepEqual(await d.evaluate('window.__component67.host.confirmedTags'), ['Apple','Banana']);
	await d.click('#chips67 .tag-chip'); assert.equal(await d.evaluate('window.__component67.host.confirmedTags.length'), 2);
	await d.click('#memo67'); await d.key('#memo67', 'a'); await d.key('#memo67', 'Escape');
	assert.equal(await d.evaluate('document.querySelector("#memos67").style.display'), 'none');
	await d.fill('#memo67','買'); await d.click('#memos67 button'); assert.equal(await d.evaluate('document.querySelector("#memo67").value'), '買物');
	const partial = await d.evaluate(`(async()=>{const {TagMemoInput}=await import('/js/ui/tag_memo_input.js');const host={confirmedTags:[]},component=new TagMemoInput({host,source:{},ids:{}});component.setup();component.addTag();component.commitPending();component.hide('tags');component.renderTagSuggestions();component.renderMemoSuggestions();return host.confirmedTags;})()`);
	assert.deepEqual(partial, []);
});

it('renders conflict scalar values and defaults and treats resolution without pending work as a no-op', async () => {
	const d = f.driver;
	const result = await d.evaluate(`(async()=>{const c=window.__yose_app.masterConflictController;await c.apply();const empty=await c.resolve([]);return {empty,values:[undefined,false,true,0,123,'plain'].map(value=>c.valueElement(value,true).textContent),deleted:c.valueElement(null,false).textContent};})()`);
	assert.deepEqual(result, {empty:false,values:['未定義（undefined）','真偽値: false','真偽値: true','数値: 0','数値: 123','文字列: plain'],deleted:'削除（項目なし）'});
	assert.equal(await d.isVisible('#modal-master-conflict'), false);
});

it('keeps an asynchronous conflict rejection on its own dialog and allows a corrected choice', async () => {
	const d = f.driver;
	await d.evaluate(`(()=>{const c=window.__yose_app.masterConflictController;window.__conflict67='pending';window.__validate67=0;window.__job67=c.resolve([{id:'one',path:'accounts.a.name',label:'口座名',localValue:'手元',remoteValue:'相手',hasLocal:true,hasRemote:true}],()=>{window.__validate67++;if(window.__validate67===1)return new Promise((_resolve,reject)=>window.__reject67=reject);}).then(value=>window.__conflict67=value);})()`);
	await d.click('#btn-master-conflict-all-local'); await d.click('#btn-apply-master-conflict');
	await d.evaluate('window.__yose_app.masterConflictController.apply()');
	assert.equal(await d.evaluate('window.__validate67'), 1);
	await d.evaluate('window.__reject67("通信を再試行する");new Promise(resolve=>requestAnimationFrame(resolve))');
	assert.equal(await d.textContent('#master-conflict-error'), '通信を再試行する');
	assert.equal(await d.evaluate('document.querySelector("#btn-apply-master-conflict").disabled'), false);
	await d.click('#btn-master-conflict-all-remote'); await d.click('#btn-apply-master-conflict'); await d.evaluate('window.__job67');
	assert.deepEqual(await d.evaluate('window.__conflict67'), {one:'remote'});
});

it('does not place a rejected old validation into a replacement conflict dialog', async () => {
	const d = f.driver;
	await d.evaluate(`(()=>{const c=window.__yose_app.masterConflictController;const detail={id:'one',path:'accounts.a.name',label:'旧名',localValue:'L',remoteValue:'R',hasLocal:true,hasRemote:true};window.__old67=c.resolve([detail],()=>new Promise((_resolve,reject)=>window.__reject67=reject));})()`);
	await d.click('#btn-master-conflict-all-local'); await d.click('#btn-apply-master-conflict');
	await d.click('#btn-cancel-master-conflict');
	assert.equal(await d.evaluate('window.__old67'), false);
	await d.evaluate(`(()=>{window.__new67='pending';window.__newJob67=window.__yose_app.masterConflictController.resolve([{id:'two',path:'accounts.b.name',label:'新名',localValue:'新L',remoteValue:'新R',hasLocal:true,hasRemote:true}]).then(value=>window.__new67=value);window.__reject67(new Error('旧検証失敗'));})()`);
	await d.evaluate('new Promise(resolve=>requestAnimationFrame(resolve))');
	assert.equal(await d.textContent('#master-conflict-error'), '');
	assert.equal(await d.evaluate('window.__new67'), 'pending');
	assert.match(await d.textContent('#master-conflict-list'), /新名/);
	await d.click('#btn-master-conflict-all-local'); await d.click('#btn-apply-master-conflict'); await d.evaluate('window.__newJob67');
	assert.deepEqual(await d.evaluate('window.__new67'), {two:'local'});
});

it('supports selecting tags without a text field and leaves dropdown background clicks unselected',async()=>{
	const d=f.driver;
	await d.evaluate(`(async()=>{const {TagMemoInput}=await import('/js/ui/tag_memo_input.js'),box=document.createElement('section');box.id='only-tags67';box.style.cssText='padding:40px;background:white';document.querySelector('main').append(box);window.__partial67=new TagMemoInput({host:{confirmedTags:[]},source:{availableTags:['文字入力なし']},ids:{tags:'only-tags67',box:'only-tags67'}});window.__partial67.setup();window.__partial67.renderTagSuggestions();box.scrollIntoView({block:'center'});})()`);
	const point=await d.evaluate('(()=>{const r=document.querySelector("#only-tags67").getBoundingClientRect();return{x:r.left+5,y:r.bottom-5};})()');
	await d.send('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',clickCount:1},d.sessionId);await d.send('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',clickCount:1},d.sessionId);
	assert.deepEqual(await d.evaluate('window.__partial67.host.confirmedTags'),[]);
	await d.click('#only-tags67 button');assert.deepEqual(await d.evaluate('window.__partial67.host.confirmedTags'),['文字入力なし']);
	assert.equal(await d.evaluate('document.querySelector("#only-tags67").style.display'),'none');
});
