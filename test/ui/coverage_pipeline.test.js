import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { HeadlessBrowserDriver, CdpProtocolError } from '../helpers/cdp_driver.js';
import { generateCoverageReport, assertCoverageReport, productionFiles, validateRawCoverage } from '../../scripts/coverage_tools.js';

const probe = `function probe(flag) {
	if (flag) {
		return 'yes';
	} else {
		return 'no';
	}
}
globalThis.probe = probe;
globalThis.__probeLoaded = true;
`;
const browsers = new Map();

function workspace(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yose-coverage-browser-'));
	browsers.set(root, []);
	t.after(async () => {
		try { for (const driver of browsers.get(root)) await driver.close(); }
		finally { browsers.delete(root); fs.rmSync(root, { recursive: true, force: true }); }
	});
	fs.mkdirSync(path.join(root, 'js'));
	fs.mkdirSync(path.join(root, 'raw'));
	fs.writeFileSync(path.join(root, 'js/probe.js'), probe);
	fs.writeFileSync(path.join(root, 'probe.html'), '<!doctype html><script>window.__documentToken = crypto.randomUUID(); window.addEventListener("pageshow", event => { window.__restoredFromCache = event.persisted; if (event.persisted) probe(false); }); window.addEventListener("pagehide", () => { if (window.__probeOnHide) probe(false); });</script><script src="/js/probe.js"></script>');
	fs.writeFileSync(path.join(root, 'away.html'), '<!doctype html><title>Away</title>');
	return root;
}

async function open(t, root) {
	const driver = new HeadlessBrowserDriver({ rootDir: root, coverageDir: path.join(root, 'raw') });
	browsers.get(root).push(driver);
	await driver.launch();
	await driver.send('Page.navigate', { url: driver.origin + '/probe.html' }, driver.sessionId);
	await driver.waitFor('globalThis.__probeLoaded === true');
	return driver;
}

describe('Real Node and Chromium coverage collection', () => {
	it('accumulates ordinary operations without writing a full snapshot for every read, then collects every call at close', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		await d.flushCoverage();
		const saved = fs.readdirSync(path.join(root, 'raw')).length;
		for (let index = 0; index < 40; index++) assert.equal(await d.evaluate(`probe(${index % 2 === 0})`), index % 2 === 0 ? 'yes' : 'no');
		assert.equal(fs.readdirSync(path.join(root, 'raw')).length, saved, 'ordinary operations must accumulate in the document rather than save full snapshots');
		await d.close();
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/coverage-final.json'), 'utf8'));
		assert.equal(report[path.join(root, 'js/probe.js')].f[0], 40);
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
	});
	it('accumulates real mouse and keyboard operations and collects both input branches exactly once at close', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		await d.evaluate(`document.body.innerHTML = '<button id="probe-mouse">Run</button><input id="probe-key">'; document.getElementById('probe-mouse').addEventListener('click', () => probe(true)); document.getElementById('probe-key').addEventListener('keydown', () => probe(false));`);
		await d.flushCoverage();
		const saved = fs.readdirSync(path.join(root, 'raw')).length;
		for (let index = 0; index < 20; index++) { await d.click('#probe-mouse'); await d.key('#probe-key', 'a'); }
		assert.equal(fs.readdirSync(path.join(root, 'raw')).length, saved, 'input events must also accumulate without writing full snapshots');
		await d.close();
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/coverage-final.json'), 'utf8'));
		assert.equal(report[path.join(root, 'js/probe.js')].f[0], 40);
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
	});
	it('fails for one branch, then combines actual Node and browser opposite branches', async t => {
		const root = workspace(t);
		const node = spawnSync(process.execPath, ['--import', path.resolve('scripts/coverage_loader.js'), '--input-type=commonjs', '-e', 'const vm = require("node:vm"); const fs = require("node:fs"); const file = require("node:path").resolve("js/probe.js"); require(file); if(probe(true)!=="yes") throw Error("bad result");'], { cwd: root, env: { ...process.env, YOSE_COVERAGE_ROOT: root, YOSE_NODE_COVERAGE: path.join(root, 'raw'), YOSE_BROWSER_COVERAGE: '' }, encoding: 'utf8' });
		assert.equal(node.status, 0, node.stderr);
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		assert.throws(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)), /97/);
		const d = await open(t, root);
		assert.equal(await d.evaluate('probe(false)'), 'no');
		await d.close();
		validateRawCoverage(path.join(root, 'raw'), productionFiles(root));
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
	});
	it('preserves branch counters from both sides of a reload', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		assert.equal(await d.evaluate('probe(true)'), 'yes');
		const previousToken = await d.evaluate('window.__documentToken');
		await d.send('Page.reload', {}, d.sessionId);
		await d.waitFor(`globalThis.__probeLoaded === true && window.__documentToken !== ${JSON.stringify(previousToken)}`);
		assert.equal(await d.evaluate('probe(false)'), 'no');
		await d.close();
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
	});
	it('reports an unexecuted service worker and GAS source as zero instead of omitting them', async t => {
		const root = workspace(t);
		fs.writeFileSync(path.join(root, 'sw.js'), 'self.addEventListener("fetch", () => {});\n');
		fs.mkdirSync(path.join(root, 'gas'));
		fs.writeFileSync(path.join(root, 'gas/Code.gs'), 'function doPost(e) { return e; }\n');
		const d = await open(t, root);
		await d.evaluate('probe(true); probe(false)');
		await d.close();
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/coverage-summary.json'), 'utf8'));
		for (const file of ['sw.js', 'gas/Code.gs']) assert.equal(report[path.join(root, file)].lines.pct, 0, file);
		assert.throws(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)), /97/);
	});
	it('retains application pageshow counters on a real BFCache return', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		const token = await d.evaluate('window.__documentToken');
		await d.evaluate('probe(true)');
		await d.send('Page.navigate', { url: d.origin + '/away.html' }, d.sessionId);
		await d.waitFor('location.pathname === "/away.html" && document.readyState === "complete"');
		await d.evaluate('history.back()');
		await d.waitFor(`window.__documentToken === ${JSON.stringify(token)} && window.__restoredFromCache === true`);
		await d.close();
		validateRawCoverage(path.join(root, 'raw'), productionFiles(root));
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
	});
	it('collects the old application pagehide branch before reload destroys its document', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		const token = await d.evaluate('window.__documentToken');
		await d.evaluate('probe(true); window.__probeOnHide = true;');
		await d.send('Page.reload', {}, d.sessionId);
		await d.waitFor(`window.__documentToken !== ${JSON.stringify(token)} && globalThis.__probeLoaded === true`);
		await d.close();
		validateRawCoverage(path.join(root, 'raw'), productionFiles(root));
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
	});
	it('drains old-origin pagehide counters after leaving for about:blank', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		await d.evaluate('probe(true); window.__probeOnHide = true;');
		await d.send('Page.navigate', { url: 'about:blank' }, d.sessionId);
		await d.waitFor('location.href === "about:blank"');
		await d.close();
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
	});
	it('rejects browser source that differs from the current original', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		fs.writeFileSync(path.join(root, 'js/probe.js'), probe + '// changed original\n');
		try {
			await assert.rejects(d.flushCoverage(), /source|原本/i);
		} finally {
			fs.writeFileSync(path.join(root, 'js/probe.js'), probe);
		}
	});
	for (const [name, setup] of Object.entries({
		collect: `window.__yoseCoverageFlush = () => { throw new Error('collect failed'); };`,
		storage: `Object.defineProperty(window, 'sessionStorage', { configurable: true, value: { getItem() { throw new Error('storage failed'); } } });`,
		send: `window.__yoseWriteCoverage = () => { throw new Error('send failed'); };`,
		reset: `const file = Object.values(globalThis.__coverage__)[0]; Object.defineProperty(file.s, '0', { configurable: true, enumerable: true, get() { return 1; }, set() { throw new Error('reset failed'); } });`
	})) {
		it(`propagates browser ${name} failures from flush and close`, async t => {
			const root = workspace(t);
			const d = await open(t, root);
			await d.evaluate(setup + '; void 0;');
			await assert.rejects(d.flushCoverage(), new RegExp(name + ' failed'));
			await assert.rejects(d.close(), new RegExp(name + ' failed'));
		});
	}
	it('propagates a failed pagehide listener reconfiguration before executing an operation', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		await d.evaluate(`Object.defineProperty(window, '__yoseCoveragePageHide', { configurable: true, get() { throw new Error('arm failed'); } }); void 0;`);
		await assert.rejects(d.evaluate('window.__shouldNotRun = true'), /arm failed/);
		const result = await d._send('Runtime.evaluate', { expression: 'window.__shouldNotRun', returnByValue: true }, d.sessionId);
		assert.equal(result.result.value, undefined);
	});
	for (const kind of ['counter', 'map']) for (const boundary of ['flush', 'pagehide']) {
		it(`rejects invalid ${kind} data before pruning zero records at ${boundary}`, async t => {
			const root = workspace(t);
			const d = await open(t, root);
			await d.flushCoverage();
			await d.evaluate(`const file = Object.values(globalThis.__coverage__)[0]; ${kind === 'counter' ? 'file.s[0] = -1;' : 'file.branchMap[0].loc.start.line++;'} void 0;`);
			if (boundary === 'pagehide') {
				const handle = d._handleEvent.bind(d);
				const loaded = new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error('reload did not load')), 5000);
					d._handleEvent = async msg => {
						if (msg.method === 'Page.loadEventFired') { clearTimeout(timer); resolve(); }
						return handle(msg);
					};
				});
				await d._send('Page.reload', {}, d.sessionId);
				await loaded;
			}
			await assert.rejects(d.flushCoverage(), new RegExp(kind));
			await d._send('Runtime.evaluate', { expression: `sessionStorage.removeItem(${JSON.stringify(d.coverageStorageKey)}); ${boundary === 'flush' ? 'delete globalThis.__coverage__;' : ''}` }, d.sessionId);
		});
	}
	it('replays an undelivered binding chunk without losing or double-counting branches', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		await d.flushCoverage();
		let dropped = false;
		const handle = d._handleEvent.bind(d);
		d._handleEvent = async msg => {
			if (msg.method === 'Runtime.bindingCalled' && !dropped) {
				const payload = JSON.parse(msg.params.payload);
				const data = typeof payload.coverage === 'string' ? JSON.parse(payload.coverage) : payload.coverage || payload;
				if (Object.values(data).some(file => file.f?.[0] === 1)) { dropped = true; return; }
			}
			return handle(msg);
		};
		await d.evaluate('probe(true)');
		await d.flushCoverage();
		await d.flushCoverage();
		assert.equal(dropped, true);
		await d.evaluate('probe(false)');
		await d.close();
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
		const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/coverage-final.json'), 'utf8'));
		assert.equal(report[path.join(root, 'js/probe.js')].f[0], 2);
	});
	it('retries only a lost navigation response and keeps exactly-once branch counts', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		await d.evaluate('probe(true)');
		const send = d._send.bind(d);
		let failed = false;
		d._send = async (method, params = {}, sessionId) => {
			const result = await send(method, params, sessionId);
			if (!failed && method === 'Runtime.evaluate' && params.expression.includes('__yoseCoverageFlush')) { failed = true; throw new CdpProtocolError('Inspected target navigated or closed'); }
			return result;
		};
		await d.flushCoverage();
		assert.equal(failed, true);
		await d.evaluate('probe(false)');
		await d.close();
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		assert.doesNotThrow(() => assertCoverageReport(path.join(root, 'reports'), productionFiles(root)));
		const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/coverage-final.json'), 'utf8'));
		assert.equal(report[path.join(root, 'js/probe.js')].f[0], 2);
	});
	it('does not save or count an acknowledged chunk again when its ACK is lost', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		const send = d._send.bind(d);
		let acknowledgementsDropped = 0, branchChunk;
		const received = new Map();
		const handle = d._handleEvent.bind(d);
		d._handleEvent = async msg => {
			if (msg.method === 'Runtime.bindingCalled') {
				const payload = JSON.parse(msg.params.payload);
				if (payload.id) {
					received.set(payload.id, (received.get(payload.id) || 0) + 1);
					if (Object.values(JSON.parse(payload.coverage)).some(file => file.f?.[0] === 1)) branchChunk = payload.id;
				}
			}
			return handle(msg);
		};
		d._send = (method, params = {}, sessionId) => {
			if (method === 'Runtime.evaluate' && params.expression.startsWith('window.__yoseCoverageFlush')) {
				acknowledgementsDropped++;
				return send(method, { ...params, expression: 'window.__yoseCoverageFlush?.([])' }, sessionId);
			}
			return send(method, params, sessionId);
		};
		await d.evaluate('probe(true)');
		await d.flushCoverage();
		const saved = fs.readdirSync(path.join(root, 'raw')).length;
		await d.flushCoverage(); await d.flushCoverage();
		assert.ok(acknowledgementsDropped > 0);
		assert.equal(typeof branchChunk, 'string');
		assert.ok(received.get(branchChunk) >= 2, 'the executed chunk must actually be replayed');
		assert.equal(fs.readdirSync(path.join(root, 'raw')).length, saved);
		await d.evaluate('probe(false)'); await d.close();
		generateCoverageReport(root, path.join(root, 'raw'), path.join(root, 'reports'));
		const report = JSON.parse(fs.readFileSync(path.join(root, 'reports/coverage-final.json'), 'utf8'));
		assert.equal(report[path.join(root, 'js/probe.js')].f[0], 2);
	});
	it('rejects the same chunk ID with a different payload instead of acknowledging it', async t => {
		const root = workspace(t);
		const d = await open(t, root);
		let captured;
		const handle = d._handleEvent.bind(d);
		d._handleEvent = async msg => {
			await handle(msg);
			if (msg.method === 'Runtime.bindingCalled') {
				const payload = JSON.parse(msg.params.payload);
				if (payload.id && Object.keys(JSON.parse(payload.coverage)).length) captured = payload;
			}
		};
		await d.evaluate('probe(true)'); await d.flushCoverage();
		assert.equal(typeof captured?.id, 'string');
		const data = JSON.parse(captured.coverage);
		Object.values(data)[0].s[0]++;
		captured.coverage = JSON.stringify(data);
		await d._send('Runtime.evaluate', { expression: `window.__yoseWriteCoverage(${JSON.stringify(JSON.stringify(captured))}); void 0;` }, d.sessionId);
		await assert.rejects(d.flushCoverage(), /payload|duplicate/i);
	});
	for (const message of ['Inspected target navigated or closed', 'Execution context was destroyed', 'Cannot find default execution context']) {
		it(`never retries a JavaScript collection exception containing ${message}`, async t => {
			const root = workspace(t);
			const d = await open(t, root);
			await d.evaluate(`window.__collectAttempts = 0; const original = window.__yoseCoverageFlush; window.__yoseCoverageFlush = (...args) => { if (++window.__collectAttempts === 1) throw new Error(${JSON.stringify(message)}); return original(...args); };`);
			await assert.rejects(d.flushCoverage(), /Browser coverage evaluation failed/);
			const count = await d._send('Runtime.evaluate', { expression: 'window.__collectAttempts', returnByValue: true }, d.sessionId);
			assert.equal(count.result.value, 1);
		});
		it(`never repolls a JavaScript wait predicate exception containing ${message}`, async t => {
			const root = workspace(t);
			const d = await open(t, root);
			await d.evaluate('window.__pollAttempts = 0');
			await assert.rejects(d.waitFor(`if (++window.__pollAttempts === 1) throw new Error(${JSON.stringify(message)}); true;`), /Browser eval error/);
			const count = await d._send('Runtime.evaluate', { expression: 'window.__pollAttempts', returnByValue: true }, d.sessionId);
			assert.equal(count.result.value, 1);
		});
	}
});
