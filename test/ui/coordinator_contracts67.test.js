import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';

const f=useBrowser();
it('keeps removed pane identifiers in preferences and ignores absent panes while restoring present ones',async()=>{
	const d=f.driver;
	await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{c.collapsed_panes={'removed-pane67':true,'card-theme-setting':true};});await app.applyCollapsedPanesState();})()`);
	assert.equal(await d.evaluate('document.querySelector("#card-theme-setting").classList.contains("collapsed")'),true);
	const before=await d.evaluate('window.__yose_app.db.captureImportState()');await d.evaluate('window.__yose_app.setPaneCollapsed()');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
	await d.evaluate('window.__yose_app.setPaneCollapsed("removed-pane67",false)');assert.equal(await d.evaluate('(async()=>(await window.__yose_app.db.getMasterConfig()).collapsed_panes["removed-pane67"])()'),false);
	await d.evaluate('window.__yose_app.setPaneCollapsed("card-theme-setting",false)');assert.equal(await d.evaluate('document.querySelector("#card-theme-setting").classList.contains("collapsed")'),false);
});
it('uses the stored browser theme when an older master omits theme and still works without matchMedia listeners',async()=>{
	const d=f.driver;
	await d.evaluate(`(async()=>{const app=window.__yose_app;await app.db.mutateMasterConfig(c=>{delete c.theme;});localStorage.setItem('yose_theme_preference','dark');window.__media67=window.matchMedia;window.matchMedia=()=>({matches:false});await app.initTheme();})()`);
	try{assert.equal(await d.evaluate('document.documentElement.dataset.theme'),'dark');assert.equal(await d.evaluate('window.__yose_app.currentThemePreference'),'dark');await d.evaluate('window.__yose_app.applyTheme("system")');assert.equal(await d.evaluate('document.documentElement.dataset.theme'),'light');}
	finally{await d.evaluate('window.matchMedia=window.__media67');}
});
it('keeps theme rendering available when optional media queries and browser preference storage fail',async()=>{
	const d=f.driver;await d.evaluate('window.__yose_app.db.mutateMasterConfig(c=>{delete c.theme;})');const before=await d.evaluate('window.__yose_app.db.captureImportState()');
	try{
	await d.evaluate(`(()=>{window.__storageReads67=0;const read=Storage.prototype.getItem,write=Storage.prototype.setItem;window.__media67=window.matchMedia;window.matchMedia=undefined;Storage.prototype.getItem=function(key){if(key==='yose_theme_preference'){window.__storageReads67++;throw new Error('STORAGE_READ67');}return read.call(this,key);};Storage.prototype.setItem=function(key,value){if(key==='yose_theme_preference')throw new Error('STORAGE_WRITE67');return write.call(this,key,value);};window.__restoreStorage67=()=>{Storage.prototype.getItem=read;Storage.prototype.setItem=write;};})()`);
	await d.evaluate('window.__yose_app.initTheme()');assert.equal(await d.evaluate('window.__storageReads67'),1);assert.equal(await d.evaluate('window.__yose_app.currentThemePreference'),'system');assert.equal(await d.evaluate('document.documentElement.dataset.theme'),'light');await d.evaluate('window.__yose_app.applyTheme("dark")');assert.equal(await d.evaluate('document.documentElement.dataset.theme'),'dark');assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
	}finally{await d.evaluate('window.matchMedia=window.__media67;window.__restoreStorage67?.()');}
});
it('checks startup versions without optional abort and session storage APIs and retains financial data',async()=>{
	const d=f.driver;const before=await d.evaluate('window.__yose_app.db.captureImportState()');
	try{
	await d.evaluate(`(()=>{window.__abort67=window.AbortController;window.AbortController=undefined;window.__sessionDescriptor67=Object.getOwnPropertyDescriptor(window,'sessionStorage');delete window.sessionStorage;const fetch=window.fetch;window.fetch=async function(url,options){if(String(url).includes('version.json')){window.__versionRequest67={url,hasSignal:options.signal!==undefined,cache:options.cache};return{ok:true,json:async()=>({version:'99.9.9'})};}return fetch.apply(this,arguments);};window.__restoreFetch67=()=>window.fetch=fetch;})()`);
	await d.evaluate('window.__yose_app.checkStartupUpdate()');assert.equal(await d.isVisible('#modal-app-update'),true);assert.equal(await d.textContent('#modal-new-version-text'),'v99.9.9');assert.deepEqual(await d.evaluate('({hasSignal:window.__versionRequest67.hasSignal,cache:window.__versionRequest67.cache})'),{hasSignal:false,cache:'no-store'});assert.deepEqual(await d.evaluate('window.__yose_app.db.captureImportState()'),before);
	}finally{await d.evaluate('window.AbortController=window.__abort67;if(window.__sessionDescriptor67)Object.defineProperty(window,"sessionStorage",window.__sessionDescriptor67);window.__restoreFetch67?.();window.__yose_app.hideUpdateModal()');}
});
it('skips startup version traffic when the browser goes offline',async()=>{
	const d=f.driver;
	try{
	await d.send('Network.enable',{},d.sessionId);await d.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0},d.sessionId);
	assert.equal(await d.evaluate('navigator.onLine'),false);
	await d.evaluate(`(()=>{const fetch=window.fetch;window.__versionCalls67=0;window.fetch=function(...args){if(String(args[0]).includes('version.json'))window.__versionCalls67++;return fetch.apply(this,args);};window.__restoreFetch67=()=>window.fetch=fetch;})()`);
	await d.evaluate('window.__yose_app.checkStartupUpdate()');assert.equal(await d.evaluate('window.__versionCalls67'),0);assert.equal(await d.isVisible('#modal-app-update'),false);
	}finally{await d.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1},d.sessionId);await d.evaluate('window.__restoreFetch67?.()');}
});
