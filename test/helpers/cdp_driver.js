/**
 * Headless Chromium CDP (Chrome DevTools Protocol) Test Driver
 * Zero-dependency browser automation over --remote-debugging-pipe (fd 3 & fd 4).
 * Serves workspace files under https://yose.local/ via CDP Fetch interception
 * to provide a secure context (Web Crypto API, IndexedDB, Service Worker) inside sandboxed environments.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { randomUUID, createHash } from 'node:crypto';
import { instrumentOriginal, writeCoverageChunk } from '../../scripts/coverage_tools.js';

const MIME_TYPES = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'application/javascript; charset=utf-8',
	'.mjs': 'application/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon'
};

// Lightweight offline Chart.js stub for headless environment where CDN is unreachable
const CHART_JS_STUB = `
window.Chart = class Chart {
	constructor(ctx, config) {
		this.ctx = ctx;
		this.config = config;
		this.data = config?.data || {};
		this.options = config?.options || {};
		window.__lastChartConfig = config;
		window.__chartInstances = window.__chartInstances || [];
		window.__chartInstances.push(this);
	}
	update() {}
	destroy() {
		this.destroyed = true;
	}
};
window.Chart.defaults = {};
window.Chart.Interaction = { modes: {} };
`;

export class CdpProtocolError extends Error {}

export class HeadlessBrowserDriver {
	constructor(options = {}) {
		this.chromeBin = options.chromeBin || process.env.CHROME_BIN || '/usr/bin/chromium';
		this.rootDir = options.rootDir || process.cwd();
		this.origin = options.origin || 'https://yose.local';
		this.now = options.now || null;
		this.realCharts = Boolean(options.realCharts);
		this.commandTimeoutMs = options.commandTimeoutMs || 10000;
		this.responses = new Map();
		this.requests = [];
		this.stderr = '';
		this.decoder = new StringDecoder('utf8');
		this.proc = null;
		this.processClosed = null;
		this.stopping = false;
		this.transportError = null;
		this.sessionId = null;
		this.msgId = 1;
		this.pending = new Map();
		this.dialogs = [];
		this.nextConfirmAccept = true;
		this.nextPromptText = '';
		this.pageErrors = [];
		this.consoleErrors = [];
		this._readBuffer = '';
		this.coverageDir = options.coverageDir || process.env.YOSE_BROWSER_COVERAGE || null;
		this.coverageOriginals = new Map();
		this.coverageError = null;
		this.coverageAcknowledgements = new Set();
		this.coverageChunks = new Map();
		this.coverageStorageKey = '__yose_test_coverage_' + randomUUID();
	}

	async launch() {
		this.proc = spawn(
			this.chromeBin,
			[
				'--headless',
				'--no-first-run',
				'--no-default-browser-check',
				'--window-size=1280,1000',
				'--no-sandbox',
				'--disable-gpu',
				'--disable-dev-shm-usage',
				'--disable-background-networking',
				'--disable-extensions',
				'--remote-debugging-pipe',
				'about:blank'
			],
			{
				stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
			}
		);

		this.processClosed = new Promise(resolve => this.proc.once('close', resolve));
		this.proc.stderr.on('data', chunk => { this.stderr = (this.stderr + chunk).slice(-8000); });
		const failPending = error => {
			for (const { reject } of this.pending.values()) reject(error);
			this.pending.clear();
		};
		const failTransport = error => {
			if (this.stopping && ['ECONNRESET', 'EPIPE'].includes(error.code)) return;
			this.transportError ||= error;
			failPending(this.transportError);
		};
		for (const pipe of this.proc.stdio) pipe?.on('error', failTransport);
		this.proc.on('error', failTransport);
		this.proc.on('exit', (code, signal) => failPending(new Error(`Chromium exited (${code ?? signal}): ${this.stderr}`)));

		this.proc.stdio[4].on('data', (chunk) => {
			this._onPipeData(chunk);
		});

		const { browserContextId } = await this.send('Target.createBrowserContext', { disposeOnDetach: true });
		const { targetId } = await this.send('Target.createTarget', { url: 'about:blank', browserContextId });

		const { sessionId } = await this.send('Target.attachToTarget', {
			targetId,
			flatten: true
		});
		this.sessionId = sessionId;

		await this.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' }, this.sessionId);
		await this.send('Page.enable', {}, this.sessionId);
		await this.send('Runtime.enable', {}, this.sessionId);
		await this.send('DOM.enable', {}, this.sessionId);
		if (this.coverageDir) {
			fs.mkdirSync(this.coverageDir, { recursive: true });
			await this.send('Runtime.addBinding', { name: '__yoseWriteCoverage' }, this.sessionId);
			await this.send('Page.addScriptToEvaluateOnNewDocument', { source: `
				const coverageKey = ${JSON.stringify(this.coverageStorageKey)};
				const coverageOrigin = ${JSON.stringify(this.origin)};
				const resetCoverage = () => {
					for (const file of Object.values(globalThis.__coverage__ || {})) {
						for (const key of Object.keys(file.s)) file.s[key] = 0;
						for (const key of Object.keys(file.f)) file.f[key] = 0;
						for (const key of Object.keys(file.b)) file.b[key].fill(0);
					}
				};
				const restoreChunk = (chunk, maps) => {
					if (!chunk || typeof chunk.id !== 'string' || !chunk.id || !chunk.files || typeof chunk.files !== 'object' || Array.isArray(chunk.files)) throw new Error('Invalid stored coverage chunk');
					const entries = Object.entries(chunk.files).map(([file, counters]) => {
						if (!Number.isSafeInteger(counters?.map) || counters.map < 0 || counters.map >= maps.length) throw new Error('Invalid stored coverage map reference');
						const schema = maps[counters.map];
						if (!schema || typeof schema !== 'object' || Array.isArray(schema) || ['s', 'f', 'b'].some(key => Object.hasOwn(schema, key))) throw new Error('Invalid stored coverage map');
						return [file, { ...schema, s: counters.s, f: counters.f, b: counters.b }];
					});
					return { id: chunk.id, coverage: JSON.stringify(Object.fromEntries(entries)) };
				};
				const persistCoverage = (acknowledgements = []) => {
					if (location.origin !== coverageOrigin) return;
					const saved = JSON.parse(sessionStorage.getItem(coverageKey) || '{"version":1,"maps":[],"chunks":[]}');
					if (saved?.version !== 1 || !Array.isArray(saved.maps) || !Array.isArray(saved.chunks)) throw new Error('Invalid stored coverage queue');
					for (const chunk of saved.chunks) restoreChunk(chunk, saved.maps);
					const chunks = saved.chunks.filter(chunk => !acknowledgements.includes(chunk.id)), maps = saved.maps;
					// Compare complete metadata, including changed maps even when counters are zero.
					const indices = new Map(maps.map((schema, index) => [JSON.stringify(schema), index]));
					const files = Object.fromEntries(Object.entries(globalThis.__coverage__ || {}).map(([file, coverage]) => {
						const schema = Object.fromEntries(Object.entries(coverage).filter(([key]) => !['s', 'f', 'b'].includes(key)));
						const identity = JSON.stringify(schema);
						if (!indices.has(identity)) { indices.set(identity, maps.length); maps.push(schema); }
						return [file, { map: indices.get(identity), s: coverage.s, f: coverage.f, b: coverage.b }];
					}));
					chunks.push({ id: crypto.randomUUID(), files });
					const wire = chunks.map(chunk => restoreChunk(chunk, maps));
					// Do not reset live counters unless the complete pending queue was persisted.
					sessionStorage.setItem(coverageKey, JSON.stringify({ version: 1, maps, chunks }));
					resetCoverage();
					return wire;
				};
				window.__yoseCoverageFlush = acknowledgements => {
					for (const chunk of persistCoverage(acknowledgements) || []) window.__yoseWriteCoverage(JSON.stringify(chunk));
				};
				window.__yoseCoveragePageHide = () => { persistCoverage(); };
				window.__yoseCoverageFlush();
			` }, this.sessionId);
		}
		await this.send('Page.addScriptToEvaluateOnNewDocument', {
			source: `
				if (${JSON.stringify(this.now)}) {
					const NativeDate = Date;
					const fixedNow = NativeDate.parse(${JSON.stringify(this.now)});
					window.Date = class extends NativeDate {
						constructor(...args) { super(...(args.length ? args : [fixedNow])); }
						static now() { return fixedNow; }
					};
				}
				if (navigator.credentials) {
					navigator.credentials.create = async () => { throw new Error('WebAuthn disabled in headless test'); };
					navigator.credentials.get = async () => { throw new Error('WebAuthn disabled in headless test'); };
				}
				window.__dialogs = [];
				window.__nextConfirmAccept = true;
				window.__nextPromptText = '';
				window.alert = (msg) => {
					window.__dialogs.push({ type: 'alert', message: String(msg) });
				};
				window.confirm = (msg) => {
					window.__dialogs.push({ type: 'confirm', message: String(msg) });
					return Boolean(window.__nextConfirmAccept);
				};
				window.prompt = (msg, def) => {
					window.__dialogs.push({ type: 'prompt', message: String(msg), defaultPrompt: def });
					return window.__nextPromptText;
				};
			`
		}, this.sessionId);
		await this.send('Fetch.enable', {
			patterns: [{ urlPattern: '*' }]
		}, this.sessionId);
	}

	_onPipeData(chunk) {
		this._readBuffer += this.decoder.write(chunk);
		const parts = this._readBuffer.split('\0');
		this._readBuffer = parts.pop();

		for (const raw of parts) {
			if (!raw.trim()) continue;
			let msg;
			try {
				msg = JSON.parse(raw);
			} catch {
				continue;
			}

			if (msg.id && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				if (msg.error) {
					reject(new CdpProtocolError(msg.error.message || JSON.stringify(msg.error)));
				} else {
					resolve(msg.result);
				}
			} else if (msg.method) {
				this._handleEvent(msg).catch(error => this.pageErrors.push(`CDP event error: ${error.message}`));
			}
		}
	}

	async _handleEvent(msg) {
		const { method, params, sessionId } = msg;

		if (method === 'Runtime.bindingCalled' && params.name === '__yoseWriteCoverage' && this.coverageDir) {
			try {
				const chunk = JSON.parse(params.payload);
				if (typeof chunk.id !== 'string' || typeof chunk.coverage !== 'string') throw new Error('Invalid coverage chunk');
				const digest = createHash('sha256').update(params.payload).digest('hex');
				if (this.coverageChunks.has(chunk.id)) {
					if (this.coverageChunks.get(chunk.id) !== digest) throw new Error('Duplicate coverage chunk has different payload');
				} else {
					writeCoverageChunk(this.coverageDir, JSON.parse(chunk.coverage), this.coverageOriginals);
					this.coverageChunks.set(chunk.id, digest);
				}
				this.coverageAcknowledgements.add(chunk.id);
			}
			catch (error) { this.coverageError = error; throw error; }
		} else if (method === 'Fetch.requestPaused') {
			const reqUrl = new URL(params.request.url);
			this.requests.push({ url: params.request.url, method: params.request.method, body: params.request.postData });
			const configured = this.responses.get(reqUrl.href) || this.responses.get(reqUrl.pathname);
			const response = typeof configured === 'function' ? await configured(params.request) : configured;
			if (response) {
				if (response.wait) await response.wait;
				if (response.error) {
					await this.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }, sessionId);
				} else {
					await this.send('Fetch.fulfillRequest', {
						requestId: params.requestId, responseCode: response.status || 200,
						responseHeaders: [{ name: 'Content-Type', value: response.contentType || 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
						body: Buffer.from(response.body ?? JSON.stringify(response.json ?? {})).toString('base64')
					}, sessionId);
				}
				return;
			}
			if (reqUrl.origin === this.origin) {
				if (this.coverageDir && reqUrl.pathname === '/__yose_coverage_drain__') {
					await this._send('Fetch.fulfillRequest', { requestId: params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }], body: Buffer.from('<!doctype html><title>Coverage drain</title>').toString('base64') }, sessionId);
					return;
				}
				let relPath = decodeURIComponent(reqUrl.pathname);
				if (relPath === '/' || relPath === '') {
					relPath = '/index.html';
				}
				const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
				const fullPath = path.join(this.rootDir, safeRel);

				if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
					const ext = path.extname(fullPath).toLowerCase();
					const mime = MIME_TYPES[ext] || 'application/octet-stream';
					let content = fs.readFileSync(fullPath);
					if (this.coverageDir && ((relPath.startsWith('/js/') && ext === '.js') || relPath === '/sw.js')) {
						const original = instrumentOriginal(fullPath);
						this.coverageOriginals.set(path.resolve(fullPath), original.hash);
						content = Buffer.from(original.code);
					}
					const body = content.toString('base64');
					await this.send('Fetch.fulfillRequest', {
						requestId: params.requestId,
						responseCode: 200,
						responseHeaders: [
							{ name: 'Content-Type', value: mime },
							{ name: 'Cache-Control', value: 'no-store' }
						],
						body
					}, sessionId);
				} else {
					await this.send('Fetch.fulfillRequest', {
						requestId: params.requestId,
						responseCode: 404,
						responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }],
						body: Buffer.from('Not Found').toString('base64')
					}, sessionId);
				}
			} else if (reqUrl.href.includes('chart.js')) {
				await this.send('Fetch.fulfillRequest', {
					requestId: params.requestId,
					responseCode: 200,
					responseHeaders: [{ name: 'Content-Type', value: 'application/javascript; charset=utf-8' }],
					body: Buffer.from(this.realCharts ? fs.readFileSync(path.join(this.rootDir, 'node_modules/chart.js/dist/chart.umd.js'), 'utf8') : CHART_JS_STUB, 'utf8').toString('base64')
				}, sessionId);
			} else {
				await this.send('Fetch.fulfillRequest', {
					requestId: params.requestId,
					responseCode: 200,
					responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
					body: Buffer.from('{}', 'utf8').toString('base64')
				}, sessionId);
			}
		} else if (method === 'Page.javascriptDialogOpening') {
			this.dialogs.push({
				type: params.type,
				message: params.message,
				defaultPrompt: params.defaultPrompt
			});
			await this.send('Page.handleJavaScriptDialog', {
				accept: this.nextConfirmAccept,
				promptText: this.nextPromptText
			}, this.sessionId);
		} else if (method === 'Runtime.exceptionThrown') {
			const details = params.exceptionDetails;
			const text = details?.exception?.description || details?.text || 'Uncaught exception';
			this.pageErrors.push(text);
		} else if (method === 'Runtime.consoleAPICalled') {
			if (params.type === 'error') {
				const text = (params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
				this.consoleErrors.push(text);
			}
		}
	}

	async send(method, params = {}, sessionId = undefined) {
		if (this.coverageDir && sessionId === this.sessionId && ['Page.navigate', 'Page.reload', 'Runtime.evaluate', 'Input.dispatchMouseEvent', 'Input.dispatchKeyEvent'].includes(method)) {
			if (method === 'Page.navigate' || method === 'Page.reload') await this.flushCoverage();
			await this._evaluateCoverage(`if (window.__yoseCoveragePageHide) { window.removeEventListener('pagehide', window.__yoseCoveragePageHide); window.addEventListener('pagehide', window.__yoseCoveragePageHide); }`);
		}
		return this._send(method, params, sessionId);
	}

	async flushCoverage() {
		if (!this.coverageDir || !this.proc || this.proc.killed) return;
		for (const [file, sourceHash] of this.coverageOriginals) {
			if (instrumentOriginal(file).hash !== sourceHash) throw new Error(`Coverage source differs from original: ${file}`);
		}
		const acknowledgements = [...this.coverageAcknowledgements];
		await this._evaluateCoverage(`window.__yoseCoverageFlush?.(${JSON.stringify(acknowledgements)})`);
		for (const id of acknowledgements) this.coverageAcknowledgements.delete(id);
		if (this.coverageError) {
			const error = this.coverageError; this.coverageError = null; throw error;
		}
	}

	async _evaluateCoverage(expression) {
		const deadline = Date.now() + this.commandTimeoutMs;
		while (true) {
			try {
				const result = await this._send('Runtime.evaluate', { expression, returnByValue: true }, this.sessionId);
				if (result.exceptionDetails) throw new Error(`Browser coverage evaluation failed: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`);
				return result;
			} catch (error) {
				if (Date.now() >= deadline || !this._isNavigationContextError(error)) throw error;
				await new Promise(resolve => setTimeout(resolve, 10));
			}
		}
	}

	_isNavigationContextError(error) {
		return error instanceof CdpProtocolError && /Inspected target navigated or closed|Execution context was destroyed|Cannot find default execution context/.test(error.message);
	}

	_send(method, params = {}, sessionId = undefined) {
		if (this.transportError) return Promise.reject(this.transportError);
		if (!this.proc || this.proc.killed || this.proc.exitCode !== null) {
			return Promise.reject(new Error(`Chromium process is not running: ${this.stderr}`));
		}
		const id = this.msgId++;
		const payload = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`CDP command timed out: ${method}. ${this.stderr}`));
			}, this.commandTimeoutMs);
			this.pending.set(id, {
				resolve: value => { clearTimeout(timer); resolve(value); },
				reject: error => { clearTimeout(timer); reject(error); }
			});
			this.proc.stdio[3].write(JSON.stringify(payload) + '\0', error => {
				if (error && this.pending.has(id)) {
					this.pending.get(id).reject(error);
					this.pending.delete(id);
				}
			});
		});
	}

	async navigate(pathname = '/index.html') {
		const targetUrl = pathname.startsWith('http') ? pathname : `${this.origin}${pathname}`;
		await this.send('Page.navigate', { url: targetUrl }, this.sessionId);
		await this.waitForReady();
		// Disable OS WebAuthn modal in headless environment so navigator.credentials.create/get rejects immediately instead of hanging
		await this.evaluate(`
			if (navigator.credentials) {
				navigator.credentials.create = async () => { throw new Error('WebAuthn disabled in headless test'); };
				navigator.credentials.get = async () => { throw new Error('WebAuthn disabled in headless test'); };
			}
		`);
	}

	async waitForReady(timeoutMs = 5000) {
		const start = Date.now();
		while (Date.now() - start < timeoutMs) {
			const state = await this.evaluate('document.readyState');
			const appReady = await this.evaluate('Boolean(window.__yose_app && window.__yose_app.db && window.__yose_app.db.db)');
			if (state === 'complete' && appReady) {
				await new Promise(r => setTimeout(r, 80));
				return;
			}
			await new Promise(r => setTimeout(r, 50));
		}
		throw new Error(`Application did not become ready within ${timeoutMs}ms: ${this.pageErrors.join('\n')}`);
	}

	async waitFor(expression, timeoutMs = 5000) {
		const started = Date.now();
		while (Date.now() - started < timeoutMs) {
			try { if (typeof expression === 'function' ? await expression() : await this.evaluate(expression)) return; }
			catch (error) { if (!this._isNavigationContextError(error)) throw error; }
			await new Promise(resolve => setTimeout(resolve, 25));
		}
		throw new Error(`Timed out waiting for: ${expression}`);
	}

	async evaluate(expression, awaitPromise = true) {
		const res = await this.send('Runtime.evaluate', {
			expression,
			awaitPromise,
			returnByValue: true
		}, this.sessionId);

		if (res.exceptionDetails) {
			const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Evaluation failed';
			throw new Error(`Browser eval error: ${desc}`);
		}
		return res.result?.value;
	}

	async click(selector) {
		const point = await this.evaluate(`
			(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el || !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) || el.disabled) {
					throw new Error('Element is absent, hidden, or disabled: ' + ${JSON.stringify(selector)});
				}
				el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
				const rect = el.getBoundingClientRect();
				const x = rect.x + rect.width / 2;
				const y = rect.y + rect.height / 2;
				const target = document.elementFromPoint(x, y);
				if (!target || !(el === target || el.contains(target))) throw new Error('Element is covered: ' + ${JSON.stringify(selector)} + ' by ' + (target?.tagName || '') + '#' + (target?.id || '') + '.' + (target?.className || ''));
				return { x, y };
			})()
		`);
		await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 }, this.sessionId);
		await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 }, this.sessionId);
		await new Promise(resolve => setTimeout(resolve, 30));
	}

	async fill(selector, value) {
		const found = await this.evaluate(`
			(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return false;
				el.focus();
				el.value = ${JSON.stringify(String(value))};
				el.dispatchEvent(new Event('input', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
				el.blur();
				return true;
			})()
		`);
		if (!found) {
			throw new Error(`Element not found for fill: ${selector}`);
		}
		await new Promise(r => setTimeout(r, 50));
	}

	async select(selector, value) {
		const found = await this.evaluate(`
			(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return false;
				if (!Array.from(el.options).some(o => o.value === ${JSON.stringify(String(value))})) throw new Error('Select option does not exist');
				el.value = ${JSON.stringify(String(value))};
				el.dispatchEvent(new Event('change', { bubbles: true }));
				return true;
			})()
		`);
		if (!found) {
			throw new Error(`Element not found for select: ${selector}`);
		}
		await new Promise(r => setTimeout(r, 50));
	}

	async textContent(selector) {
		return this.evaluate(`
			(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				return el ? el.textContent.trim() : null;
			})()
		`);
	}

	async isVisible(selector) {
		return this.evaluate(`
			(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				return Boolean(el?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }));
			})()
		`);
	}

	async key(selector, key) {
		await this.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
		await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key }, this.sessionId);
		await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key }, this.sessionId);
	}

	async setConfirm(accept) {
		await this.evaluate(`window.__nextConfirmAccept = ${Boolean(accept)}`);
	}

	async importFile(text, filename = 'import.json') {
		await this.evaluate(`
			(() => {
				const input = document.getElementById('file-import-input');
				const transfer = new DataTransfer();
				transfer.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(filename)}, { type: 'application/json' }));
				input.files = transfer.files;
				input.dispatchEvent(new Event('change', { bubbles: true }));
			})()
		`);
		await this.waitFor('document.getElementById("file-import-input").value === ""');
	}

	async close() {
		let coverageError;
		try {
			if (this.coverageDir && this.coverageOriginals.size && this.proc && !this.proc.killed) {
				const state = await this._evaluateCoverage('location.origin');
				if (state.result.value !== this.origin) {
					await this._send('Page.navigate', { url: this.origin + '/__yose_coverage_drain__' }, this.sessionId);
					await this.waitFor(`location.origin === ${JSON.stringify(this.origin)} && document.readyState === 'complete'`);
				}
			}
			await this.flushCoverage();
		} catch (error) { coverageError = error; }
		for (const [, p] of this.pending) {
			p.reject(new Error('Browser closed'));
		}
		this.pending.clear();
		this.stopping = true;
		if (this.proc && !this.proc.killed && this.proc.exitCode === null) this.proc.kill('SIGKILL');
		if (this.processClosed) await this.processClosed;
		const transportError = this.transportError;
		this.transportError = null;
		if (coverageError) throw coverageError;
		if (transportError) throw transportError;
	}
}
