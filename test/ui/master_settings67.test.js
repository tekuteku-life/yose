import assert from 'node:assert/strict';
import { useBrowser, seed, transaction, records, value } from '../helpers/ui_fixture.js';
import { flushWorkflow, rawWorkflow } from '../helpers/workflow_ui_fixture.js';
import { uiCase67, settings67, failNextWrite67, assertFailedWrite67, observeExpectedDialog67 } from '../helpers/ui_workflows67.js';
const fixture = useBrowser();
const master = d => d.evaluate('window.__yose_app.db.getMasterConfig()');
const types = ['bank', 'cash', 'credit_card', 'loan', 'point', 'receivable', 'prepaid', 'investment', 'insurance', 'asset', 'electronic_money'];

for (const type of types) uiCase67(fixture, `retains the legal ${type} account type and balance when only its name is edited`, async d => {
	await seed(d, [transaction('untouched67', { sync_status: 'synced' })]);
	await d.evaluate(`window.__yose_app.db.mutateMasterConfig(config=>{config.accounts.push({id:'typed67',name:'Original account',type:${JSON.stringify(type)},initial_balance:987,is_asset:${!['credit_card', 'loan'].includes(type)},is_archived:false});})`);
	const original = await d.evaluate('window.__yose_app.db.getRaw("transactions","untouched67")');
	await settings67(d, 'accounts'); await d.click('.btn-edit-account[data-id="typed67"]'); await flushWorkflow(d);
	await d.waitFor('document.querySelector("#modal-master-item").classList.contains("active")&&document.querySelector("#m-acc-id").value==="typed67"');
	const displayed = await value(d, '#m-acc-type'); await d.fill('#m-acc-name', 'Renamed account');
	await d.click('#form-master-account button[type="submit"]'); await flushWorkflow(d);
	await d.waitFor('!document.querySelector("#modal-master-item").classList.contains("active")');
	const saved = (await master(d)).accounts.find(account => account.id === 'typed67');
	assert.deepEqual({ displayed, id: saved.id, name: saved.name, type: saved.type, balance: saved.initial_balance }, { displayed: type, id: 'typed67', name: 'Renamed account', type, balance: 987 });
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getRaw("transactions","untouched67")'), original);
});

uiCase67(fixture, 'adds an entered holiday once, rejects its duplicate, and preserves the existing sorted dates', async d => {
	await settings67(d, 'holidays'); const previous = (await master(d)).holidays;
	await d.fill('#input-new-holiday', '2030-03-20'); await d.click('#btn-add-holiday'); await flushWorkflow(d);
	assert.equal(await value(d, '#input-new-holiday'), '');
	assert.deepEqual((await master(d)).holidays, [...new Set([...previous, '2030-03-20'])].sort());
	const raw = await rawWorkflow(d); await d.fill('#input-new-holiday', '2030-03-20');
	await observeExpectedDialog67(d, () => d.click('#btn-add-holiday'), /既に祝日に登録/); assert.deepEqual(await rawWorkflow(d), raw);
});
uiCase67(fixture, 'imports the complete official holiday preset idempotently through its real button', async d => {
	await settings67(d, 'holidays'); const previous = (await master(d)).holidays;
	const preset = await d.evaluate('(async()=>(await import("./js/logic.js")).JAPANESE_HOLIDAYS_PRESET)()');
	await observeExpectedDialog67(d, () => d.click('#btn-import-holidays-preset'), /祝日を登録しました/);
	assert.deepEqual((await master(d)).holidays, [...new Set([...previous, ...preset])].sort());
	await observeExpectedDialog67(d, () => d.click('#btn-import-holidays-preset'), /0 件の祝日/);
	assert.deepEqual((await master(d)).holidays, [...new Set([...previous, ...preset])].sort());
});
for (const result of ['success', 'http', 'network']) uiCase67(fixture, `handles the holiday API ${result} at the real fetch boundary without importing before confirmation`, async d => {
	await settings67(d, 'holidays'); await d.click('#btn-open-holiday-modal'); const raw = await rawWorkflow(d);
	d.responses.set('https://holidays-jp.github.io/api/v1/date.json', result === 'success' ? { json: { '2030-01-01': 'New year' } } : result === 'http' ? { status: 503 } : { error: 'Failed' });
	await observeExpectedDialog67(d, () => d.click('#btn-fetch-holiday-api'), result === 'success' ? /最新データを取得/ : /祝日取得エラー.*プリセット/);
	assert.deepEqual(await rawWorkflow(d), raw); assert.match(await d.textContent('#btn-fetch-holiday-api'), /オンラインAPIから最新祝日/);
	if (result === 'success') {
		assert.deepEqual(JSON.parse(await value(d, '#txt-holiday-import-input')), { '2030-01-01': 'New year' });
		await d.click('#btn-confirm-import-holidays'); await flushWorkflow(d); assert.ok((await master(d)).holidays.includes('2030-01-01'));
	}
});
uiCase67(fixture, 'shows an empty holiday list after removing all dates through a validated master mutation', async d => {
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(config=>{config.holidays=[]})'); await settings67(d, 'holidays');
	assert.match(await d.textContent('#master-holidays-list'), /祝日が登録されていません/);
});

for (const kind of ['account', 'category', 'subcategory', 'recurring', 'holiday']) uiCase67(fixture, `keeps every raw original when ${kind} management encounters a real IndexedDB write abort`, async d => {
	await settings67(d, kind === 'account' ? 'accounts' : kind === 'recurring' ? 'recurring' : kind === 'holiday' ? 'holidays' : 'categories');
	if (kind === 'holiday') await d.click('#master-holidays-list details summary');
	const raw = await rawWorkflow(d); await failNextWrite67(d, 'master_config');
	const selectors = { account: '.btn-archive-account[data-id="acc_wallet"]', category: '.btn-archive-cat[data-id="cat_food"]', subcategory: '.btn-archive-subcat[data-cat-id="cat_food"][data-sub-id="sub_groceries"]', recurring: '.btn-toggle-rec[data-id="rec_rent"]', holiday: '.btn-del-holiday' };
	const selector = kind === 'recurring' ? '.btn-toggle-recurring[data-id="rec_rent"]' : selectors[kind];
	await observeExpectedDialog67(d, () => d.click(selector), /設定の保存に失敗/); await assertFailedWrite67(d, raw);
});

uiCase67(fixture, 'opens and closes the actual advanced JSON editor, saves a rename and rejects malformed JSON without a write', async d => {
	await settings67(d); await d.click('#btn-view-master-json'); await flushWorkflow(d);
	assert.equal(await d.isVisible('#master-json-editor'), true);
	const config = JSON.parse(await value(d, '#txt-master-json')); config.accounts[0].name = 'JSON renamed67';
	await d.fill('#txt-master-json', JSON.stringify(config)); await observeExpectedDialog67(d, () => d.click('#btn-save-master-json'), /マスタ設定を保存しました/);
	assert.equal((await master(d)).accounts[0].name, 'JSON renamed67');
	const raw = await rawWorkflow(d); await d.fill('#txt-master-json', '{invalid');
	await observeExpectedDialog67(d, () => d.click('#btn-save-master-json'), /マスタ設定の保存に失敗/); assert.deepEqual(await rawWorkflow(d), raw);
	await d.click('#btn-view-master-json'); assert.equal(await d.isVisible('#master-json-editor'), false);
	await d.click('#btn-view-master-json'); await flushWorkflow(d); assert.equal(JSON.parse(await value(d, '#txt-master-json')).accounts[0].name, 'JSON renamed67');
});
uiCase67(fixture, 'rejects an advanced JSON save whose same account was changed after the editor opened', async d => {
	await settings67(d); await d.click('#btn-view-master-json'); await flushWorkflow(d);
	const config = JSON.parse(await value(d, '#txt-master-json')); config.accounts[0].name = 'stale67';
	await d.evaluate('window.__yose_app.db.mutateMasterConfig(config=>{config.accounts[0].name="newest67"})'); const raw = await rawWorkflow(d);
	await d.fill('#txt-master-json', JSON.stringify(config)); await observeExpectedDialog67(d, () => d.click('#btn-save-master-json'), /競合|変更/);
	assert.deepEqual(await rawWorkflow(d), raw); assert.equal(JSON.parse(await value(d, '#txt-master-json')).accounts[0].name, 'stale67');
});
for (const kind of ['pin', 'url']) uiCase67(fixture, `retains the ${kind} draft after a real settings-store write abort`, async d => {
	await settings67(d); if (kind === 'pin' && !await d.isVisible('#input-pin')) await d.click('#btn-toggle-key-details');
	const selector = kind === 'pin' ? '#input-pin' : '#input-gas-url', text = kind === 'pin' ? '5678' : 'https://retained.example/exec';
	await d.fill(selector, text); const raw = await rawWorkflow(d), oldPackage = await d.evaluate('window.__yose_app.db.getSecurityKey("master_keys_package")');
	await failNextWrite67(d, kind === 'pin' ? 'security_keys' : 'settings');
	await observeExpectedDialog67(d, () => d.click(kind === 'pin' ? '#btn-save-pin' : '#btn-save-gas-url'), /保存できません|PIN更新に失敗/);
	await assertFailedWrite67(d, raw); assert.equal(await value(d, selector), text);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("master_keys_package")'), oldPackage);
	if (kind === 'url') { assert.equal(await d.evaluate('window.__yose_app.syncManager.gasUrl'), ''); assert.equal(await d.evaluate('document.querySelector("#btn-save-gas-url").disabled'), false); }
});
uiCase67(fixture, 'cancels signing-key regeneration at its first confirmation without prompting for PIN or changing keys', async d => {
	await settings67(d); if (!await d.isVisible('#btn-generate-key')) await d.click('#btn-toggle-key-details');
	const raw = await d.evaluate('window.__yose_app.db.getSecurityKey("master_keys_package")'), dialogs = await d.evaluate('window.__dialogs.length');
	await d.setConfirm(false); await d.click('#btn-generate-key'); await flushWorkflow(d);
	assert.deepEqual(await d.evaluate('window.__yose_app.db.getSecurityKey("master_keys_package")'), raw);
	assert.deepEqual((await d.evaluate(`window.__dialogs.slice(${dialogs})`)).map(item=>item.type), ['confirm']);
});
