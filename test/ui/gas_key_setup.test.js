import { it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, settings, waitForDialog } from '../helpers/ui_fixture.js';
const fixture = useBrowser();
it('shows owner-managed GAS key setup and copies the public key without registration requests', async () => {
	const d = fixture.driver; await settings(d); await d.click('#btn-toggle-key-details');
	await d.evaluate(`{
		window.__setupRequests=0;const sync=window.__yose_app.syncManager,send=sync.sendRequest.bind(sync);
		sync.sendRequest=(...args)=>{window.__setupRequests++;return send(...args);};
		navigator.clipboard.writeText=async value=>{window.__copiedPublicKey=value;};
	}`);
	const publicKey = await d.evaluate('document.querySelector("#txt-public-key").value');
	assert.ok(publicKey.length > 0);
	assert.equal(await d.evaluate('document.getElementById("btn-register-key-gas-direct")'), null);
	await d.click('#btn-show-gas-key-setup'); await waitForDialog(d, 'USER_PUBLIC_KEYS');
	assert.ok((await d.evaluate('window.__dialogs.at(-1).message')).includes('公開前'));
	await d.click('#btn-copy-public-key'); await waitForDialog(d, 'コピーしました');
	assert.equal(await d.evaluate('window.__copiedPublicKey'), publicKey);
	assert.equal(await d.evaluate('window.__setupRequests'), 0);
	assert.equal(await d.evaluate('window.__yose_app.db.getSecurityKey("public_key_base64")'), publicKey);
});

it('waits for clipboard completion before reporting successful public-key copy', async () => {
	const d = fixture.driver; await settings(d); await d.click('#btn-toggle-key-details');
	await d.evaluate(`{window.__dialogs=[];navigator.clipboard.writeText=()=>new Promise(resolve=>{window.__finishCopy=resolve;});}`);
	await d.click('#btn-copy-public-key');
	assert.equal(await d.evaluate('window.__dialogs.length'), 0);
	await d.evaluate('window.__finishCopy()'); await waitForDialog(d, 'コピーしました');
});
for (const reason of ['denied', 'unavailable']) it(`reports public-key clipboard ${reason} without success and keeps the key selected`, async () => {
	const d = fixture.driver; await settings(d); await d.click('#btn-toggle-key-details');
	await d.evaluate(`{
		window.__dialogs=[];
		${reason === 'denied' ? "navigator.clipboard.writeText=async()=>{throw new Error('permission denied');};" : "Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});"}
	}`);
	await d.click('#btn-copy-public-key'); await waitForDialog(d, 'コピーできませんでした');
	assert.equal(await d.evaluate('window.__dialogs.some(d=>d.message.includes("コピーしました"))'), false);
	assert.equal(await d.evaluate(`{const key=document.querySelector('#txt-public-key');key.selectionStart===0&&key.selectionEnd===key.value.length;}`), true);
});
