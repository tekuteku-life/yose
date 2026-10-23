import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HeadlessBrowserDriver } from '../helpers/cdp_driver.js';
import { useBrowser, settings } from '../helpers/ui_fixture.js';

async function assertGate(driver, inputId) {
	assert.equal(await driver.evaluate(`Array.from(document.body.children).filter(el => el instanceof HTMLElement && el.id !== 'auth-screen').every(el => el.inert) && !document.getElementById('auth-screen').inert`), true, 'all background regions must be inert');
	await driver.evaluate(`document.getElementById(${JSON.stringify(inputId)}).focus()`);
	for (const shift of [false, true]) for (let step = 0; step < 8; step++) {
		await driver.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', modifiers: shift ? 8 : 0 }, driver.sessionId);
		await driver.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', modifiers: shift ? 8 : 0 }, driver.sessionId);
		assert.equal(await driver.evaluate(`document.getElementById('auth-screen').contains(document.activeElement)`), true, `Tab must remain within auth (${shift ? 'reverse' : 'forward'} ${step})`);
	}
	await driver.evaluate(`document.getElementById('btn-header-sync').focus()`);
	assert.equal(await driver.evaluate(`document.getElementById('auth-screen').contains(document.activeElement)`), true, 'programmatic background focus must also be blocked');
	await driver.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' }, driver.sessionId);
	await driver.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' }, driver.sessionId);
	assert.equal(await driver.evaluate(`document.getElementById('auth-screen').classList.contains('hidden')`), false);
}

async function unlock(driver) {
	await driver.fill('#auth-pin-input', '1234');
	await driver.click('#btn-auth-pin');
	await driver.waitFor(`document.getElementById('auth-screen').classList.contains('hidden') && window.__yose_app._domInitialized && !document.querySelector('main').inert`);
	await driver.evaluate(`document.getElementById('btn-header-sync').focus()`);
	assert.equal(await driver.evaluate('document.activeElement.id'), 'btn-header-sync');
	assert.notEqual(await driver.evaluate('document.body.style.position'), 'fixed');
}

async function lockViaSettings(driver) {
	await settings(driver);
	if (!await driver.isVisible('#btn-lock-now')) await driver.click('#btn-toggle-key-details');
	await driver.click('#btn-lock-now');
	await driver.waitFor(`!document.getElementById('auth-screen').classList.contains('hidden') && window.__yose_app.isKeyLocked`);
}

describe('Authentication gate before the first unlock', () => {
	it('confines initial setup keyboard focus before application handlers are initialized', async t => {
		const driver = new HeadlessBrowserDriver();
		t.after(() => driver.close());
		await driver.launch(); await driver.navigate();
		await driver.waitFor(`document.getElementById('auth-setup-container').style.display === 'block'`);
		assert.equal(await driver.evaluate('Boolean(window.__yose_app._domInitialized)'), false);
		await assertGate(driver, 'auth-setup-pin');
		await driver.fill('#auth-setup-pin', '1234'); await driver.click('#btn-auth-setup');
		await driver.waitFor(`window.__yose_app._domInitialized && !document.querySelector('main').inert`);
		await driver.click('.tab-btn[data-tab="tab-settings"]');
		assert.equal(await driver.isVisible('#tab-settings'), true);
	});
});

describe('Keyboard boundaries after authentication is invalidated', () => {
	const fixture = useBrowser();
	it('blocks the settings background after a real lock and restores normal operation after PIN unlock', async () => {
		const driver = fixture.driver;
		await lockViaSettings(driver);
		await assertGate(driver, 'auth-pin-input');
		await unlock(driver);
		await driver.click('.tab-btn[data-tab="tab-input"]');
		assert.equal(await driver.isVisible('#tab-input'), true);
	});
	it('confines focus after reloading the saved encrypted database', async () => {
		const driver = fixture.driver;
		await driver.evaluate('window.__gateOldDocument = true');
		await driver.send('Page.reload', {}, driver.sessionId);
		await driver.waitFor(`!window.__gateOldDocument && document.getElementById('auth-pin-container')?.style.display === 'block'`);
		await assertGate(driver, 'auth-pin-input');
		await unlock(driver);
	});
	it('confines focus on a BFCache-style lifecycle lock and rejects signing operations through the same gate', async () => {
		const driver = fixture.driver;
		await driver.evaluate(`dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));`);
		await driver.waitFor(`!document.getElementById('auth-screen').classList.contains('hidden')`);
		await driver.evaluate(`window.__guardResult = 'pending'; window.__yose_app.authController.ensureKeyUnlocked().then(() => window.__guardResult = 'accepted', () => window.__guardResult = 'rejected'); void 0;`);
		await driver.waitFor(`window.__guardResult === 'rejected'`, 1000);
		await assertGate(driver, 'auth-pin-input');
		assert.equal(await driver.evaluate('window.__yose_app.db.isEncrypted()'), false);
		assert.equal(await driver.evaluate('window.__yose_app.privateKey'), null);
		await unlock(driver);
	});
});
