import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, settings } from '../helpers/ui_fixture.js';
import { allRaw67 } from '../helpers/settings_ui67.js';
import { uiCase67, settings67, observeNativeEvent67 } from '../helpers/ui_workflows67.js';

const fixture=useBrowser();

uiCase67(fixture,'checks a version through the native settings button with explicitly unavailable optional abort and session-storage APIs',async d=>{
	await settings67(d);const before=await allRaw67(d);d.responses.set('/version.json',{json:{version:'99.0.0'}});await observeNativeEvent67(d,'#btn-check-app-update');
	await d.evaluate(`(()=>{
		const abort=window.AbortController,descriptor=Object.getOwnPropertyDescriptor(window,'sessionStorage'),fetch=window.fetch;
		window.AbortController=undefined;delete window.sessionStorage;window.__versionRequest67=[];
		window.fetch=function(url,options){if(String(url).includes('version.json'))window.__versionRequest67.push({hasSignal:Boolean(options.signal),cache:options.cache});return fetch.apply(this,arguments);};
		window.__restoreVersionCapabilities67=()=>{window.AbortController=abort;Object.defineProperty(window,'sessionStorage',descriptor);window.fetch=fetch;};window.__restores67.push(window.__restoreVersionCapabilities67);
	})()`);
	try{
		assert.equal(await d.evaluate('typeof AbortController'),'undefined');assert.equal(await d.evaluate('typeof sessionStorage'),'undefined');
		await d.click('#btn-check-app-update');await d.evaluate('Promise.all(window.__masterNativeJobs67)');assert.equal(await d.evaluate('window.__masterNativeJobs67.length'),1);
		assert.deepEqual(await d.evaluate('window.__versionRequest67'),[{hasSignal:false,cache:'no-store'}]);assert.match(await d.textContent('#update-status-msg'),/99\.0\.0.*利用可能/);assert.equal(await d.isVisible('#modal-app-update'),true);assert.equal(await d.textContent('#modal-new-version-text'),'v99.0.0');assert.deepEqual(await allRaw67(d),before);
	}finally{await d.evaluate('window.__restoreVersionCapabilities67()');}
});

for(const action of ['forced','component-modal'])it(`reloads through ${action} update with explicitly unavailable cache/session APIs and preserves every native store key and value`,async()=>{
	const d=fixture.driver;await settings(d);await d.evaluate('window.__yose_app.settingsController.renderSettings()');const before=await allRaw67(d);
	if(action==='component-modal'){
		assert.equal(await d.evaluate('Boolean(window.__yose_app.availableUpdateVersion)'),false);
		await d.evaluate('window.__yose_app.showUpdateModal("99.0.0")');assert.equal(await d.isVisible('#modal-app-update'),true);
	}
	await d.evaluate(`(()=>{
		window.__oldCapabilityDocument67=true;const descriptors=Object.fromEntries(['caches','sessionStorage'].map(name=>[name,Object.getOwnPropertyDescriptor(window,name)]));
		for(const name of Object.keys(descriptors))delete window[name];
		window.__restoreReloadCapabilities67=()=>{for(const [name,descriptor]of Object.entries(descriptors))Object.defineProperty(window,name,descriptor);};
		window.addEventListener('beforeunload',window.__restoreReloadCapabilities67,{once:true});
	})()`);
	assert.equal(await d.evaluate('typeof caches'),'undefined');assert.equal(await d.evaluate('typeof sessionStorage'),'undefined');
	try{
		await d.click(action==='forced'?'#btn-force-cache-clear':'#btn-confirm-app-update');
		await d.waitFor('!window.__oldCapabilityDocument67&&window.__yose_app?.db?.db&&document.querySelector("#auth-pin-container").style.display==="block"');
		assert.deepEqual(await allRaw67(d),before);assert.equal(await d.evaluate('sessionStorage.getItem("yose_update_attempted_version")'),null);
		assert.equal(await d.evaluate('typeof caches'),'object');assert.equal(await d.evaluate('typeof sessionStorage'),'object');
	}finally{await d.evaluate('window.__restoreReloadCapabilities67?.()');}
});
