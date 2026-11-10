import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser, seed, transaction } from '../helpers/ui_fixture.js';
import { importPublicKeyBase64, verifySignedRequest } from '../../js/crypto.js';

async function until(predicate) {
	const deadline = Date.now() + 15000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error('Background server observation timed out');
		await new Promise(resolve => setTimeout(resolve, 20));
	}
}

async function serverFixture() {
	let remote, publicKey, release, cancelled = false;
	const gate = new Promise(resolve => { release = resolve; });
	const actions = [], errors = [];
	const server = createServer(async (request, response) => {
		try {
			const url = new URL(request.url, 'http://localhost');
			if (url.pathname === '/gas' && request.method === 'POST') {
				response.once('close', () => { if (!response.writableEnded) cancelled = true; });
				let body = ''; for await (const chunk of request) body += chunk;
				const envelope = JSON.parse(body);
				assert.equal((await verifySignedRequest(envelope, publicKey)).valid, true);
				actions.push(envelope.action);
				if (actions.length === 1) await gate;
				if (envelope.action === 'push_diff') remote.pending_diffs = envelope.payload.transactions.map(tx => ({ ...tx, sync_status: 'synced' }));
				response.writeHead(200, { 'Content-Type': 'application/json' });
				response.end(JSON.stringify({ success: true, ...remote, accepted_ids: envelope.payload.transactions?.map(tx => tx.id) || [] }));
				return;
			}
			const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
			if (!/^(js\/[-a-z0-9_./]+\.js|css\/[-a-z0-9_./]+\.css|index\.html|version\.json|manifest\.json|icon[-a-z0-9.]*|fonts\/[-a-z0-9_.]+)$/.test(relative) || relative.includes('..')) { response.writeHead(404); response.end(); return; }
			const file = path.resolve(relative);
			if (!fs.existsSync(file)) { response.writeHead(404); response.end(); return; }
			const mime = relative.endsWith('.js') ? 'application/javascript' : relative.endsWith('.json') ? 'application/json' : relative.endsWith('.css') ? 'text/css' : 'text/html';
			response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); response.end(fs.readFileSync(file));
		} catch (error) { errors.push(error); response.writeHead(500); response.end(); }
	});
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
	const origin = `http://127.0.0.1:${server.address().port}`;
	return { origin, actions, errors, release, get cancelled() { return cancelled; },
		async configure(values) { remote = values.remote; publicKey = await importPublicKeyBase64(values.publicKey); },
		async close() { release(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

async function browserScenario(test) {
		const server = await serverFixture(); let driver;
		try {
			driver = await openBrowser({ origin: server.origin, now: null });
			// CDP does not emulate installed-app display mode; only this capability flag is a fixture.
			await driver.evaluate(`{const native=window.matchMedia.bind(window);window.matchMedia=query=>{const media=native(query);if(query==='(display-mode: standalone)')Object.defineProperty(media,'matches',{value:true});return media;};}`);
			assert.equal(await driver.evaluate("matchMedia('(display-mode: standalone)').matches"), true);
			await seed(driver, [transaction('real-background-upload')]);
			await server.configure(await driver.evaluate(`(async()=>{const app=window.__yose_app,{sharedMasterConfig}=await import('/js/logic/master_sync.js');await app.db.setSetting('gas_url',${JSON.stringify(server.origin + '/gas')});await app.finishAppInit();return {publicKey:app.publicKeyBase64,remote:{master_config:sharedMasterConfig(await app.db.getMasterConfig()),snapshot:await app.db.getSnapshot(),pending_diffs:[],archived_transactions:[],archive_months:[]}};})()`));
			await test(driver, server);
			assert.deepEqual(server.errors, []); assert.deepEqual(driver.pageErrors, []);
		} finally {
			if (driver) { await driver.send('Page.setWebLifecycleState', { state: 'active' }, driver.sessionId).catch(() => {}); await driver.close(); }
			await server.close();
		}
}

describe('Installed PWA synchronization with a real HTTP server and Service Worker', { timeout: 120000 }, () => {
	it('completes signed upload and final download while the page is frozen, then commits after resume', () => browserScenario(async (driver, server) => {
			await driver.click('#btn-header-sync');
			await until(() => server.actions.length === 1);
			await driver.send('Page.setWebLifecycleState', { state: 'frozen' }, driver.sessionId);
			server.release();
			await until(() => server.actions.filter(action => action === 'fetch_state').length === 2);
			assert.deepEqual(server.actions, ['fetch_state', 'fetch_master', 'push_diff', 'fetch_state']);
			assert.equal(driver.requests.some(request => request.url === server.origin + '/gas'), false, 'The page must not perform the worker requests');
			await driver.send('Page.setWebLifecycleState', { state: 'active' }, driver.sessionId);
			await driver.waitFor("window.__yose_app.syncManager.lastResult?.status==='synced'&&!window.__yose_app.syncManager.isSyncing");
			assert.equal(await driver.evaluate("window.__yose_app.db.getTransaction('real-background-upload').then(tx=>tx.sync_status)"), 'synced');
			assert.equal(await driver.evaluate("window.__yose_app.db.getAllRaw('transactions').then(rows=>rows.every(row=>row.encrypted&&!Object.hasOwn(row,'amount')))"), true);
	}));
	it('keeps a newer local edit intact when the real worker completes an older upload', () => browserScenario(async (driver, server) => {
		await driver.click('#btn-header-sync'); await until(() => server.actions.length === 1);
		await driver.evaluate("(async()=>{const db=window.__yose_app.db;await db.putTransaction({...await db.getTransaction('real-background-upload'),amount:999});})()");
		const expected = await driver.evaluate('window.__yose_app.db.captureImportState()');
		server.release(); await driver.waitFor("!window.__yose_app.syncManager.isSyncing&&window.__yose_app.syncManager.lastError?.includes('変更')");
		assert.ok(server.actions.includes('push_diff'));
		assert.deepEqual(await driver.evaluate('window.__yose_app.db.captureImportState()'), expected);
		assert.deepEqual(await driver.evaluate("window.__yose_app.db.getTransaction('real-background-upload').then(tx=>({amount:tx.amount,sync_status:tx.sync_status}))"), { amount: 999, sync_status: 'unsynced' });
	}));
	it('cancels a real worker on the lock button without changing raw storage or sending subsequent requests', () => browserScenario(async (driver, server) => {
		const expected = await driver.evaluate('window.__yose_app.db.captureImportState()');
		await driver.click('#btn-header-sync'); await until(() => server.actions.length === 1);
		await driver.click('[data-tab="tab-settings"]');
		if (!await driver.isVisible('#btn-lock-now')) await driver.click('#btn-toggle-key-details');
		await driver.click('#btn-lock-now');
		await driver.waitFor("window.__yose_app.isKeyLocked&&!window.__yose_app.syncManager.isSyncing");
		await until(() => server.cancelled);
		server.release();
		assert.deepEqual(await driver.evaluate('window.__yose_app.db.captureImportState()'), expected);
		assert.equal(await driver.evaluate('window.__yose_app.db.encryptionKey'), null);
		assert.deepEqual(server.actions, ['fetch_state']);
	}));
});
