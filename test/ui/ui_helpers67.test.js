import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser } from '../helpers/ui_fixture.js';
const fixture = useBrowser();
it('restores existing accessibility labels and disabled states only from the current busy owner', async () => {
	const d = fixture.driver;
	await d.evaluate(`(async()=>{
		const {beginFormBusy}=await import('./js/ui/form_busy.js'),root=document.createElement('section');root.id='busy-contract67';root.setAttribute('aria-busy','false');
		root.innerHTML='<input id="busy-enabled67"><input id="busy-disabled67" disabled><button id="busy-save67" aria-label="既存の保存説明"><strong>保存</strong></button>';document.body.append(root);
		const button=root.querySelector('button');window.__oldBusy67=beginFormBusy(root,button,'最初の保存');window.__oldBusy67();window.__newBusy67=beginFormBusy(root,button,'次の保存');window.__oldBusy67();
	})()`);
	assert.deepEqual(await d.evaluate('({busy:document.querySelector("#busy-contract67").getAttribute("aria-busy"),label:document.querySelector("#busy-save67").getAttribute("aria-label"),enabled:document.querySelector("#busy-enabled67").disabled})'), { busy: 'true', label: '次の保存', enabled: true });
	await d.evaluate('window.__newBusy67();window.__oldBusy67()');
	assert.deepEqual(await d.evaluate('({busy:document.querySelector("#busy-contract67").getAttribute("aria-busy"),label:document.querySelector("#busy-save67").getAttribute("aria-label")})'), { busy: 'false', label: '既存の保存説明' });
	await d.evaluate('document.querySelector("#busy-contract67").remove()');
});
it('restores an existing aria label, original children and disabled controls after completion and ignores a repeated release', async () => {
	const d = fixture.driver;
	await d.evaluate(`(async()=>{const {beginFormBusy}=await import('./js/ui/form_busy.js'),root=document.createElement('section');root.id='restore-contract67';root.setAttribute('aria-busy','false');root.innerHTML='<input id="restore-enabled67"><input disabled id="restore-disabled67"><button aria-label="既存の説明"><strong>元の保存</strong></button>';document.body.append(root);const release=beginFormBusy(root,root.querySelector('button'),'保存中');root.querySelector('#restore-disabled67').remove();release();release();})()`);
	assert.deepEqual(await d.evaluate('({busy:document.querySelector("#restore-contract67").getAttribute("aria-busy"),label:document.querySelector("#restore-contract67 button").getAttribute("aria-label"),text:document.querySelector("#restore-contract67 strong").textContent,disabled:document.querySelector("#restore-enabled67").disabled,spinner:document.querySelector("#restore-contract67 .spinner")!==null})'), { busy: 'false', label: '既存の説明', text: '元の保存', disabled: false, spinner: false });
	await d.evaluate('document.querySelector("#restore-contract67").remove()');
});
