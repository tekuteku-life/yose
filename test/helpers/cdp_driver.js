/**
 * Headless Chromium CDP (Chrome DevTools Protocol) Test Driver
 * Zero-dependency browser automation over --remote-debugging-pipe (fd 3 & fd 4).
 * Serves workspace files under https://yose.local/ via CDP Fetch interception
 * to provide a secure context (Web Crypto API, IndexedDB, Service Worker) inside sandboxed environments.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

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
`;

export class HeadlessBrowserDriver {
	constructor(options = {}) {
		this.chromeBin = options.chromeBin || process.env.CHROME_BIN || '/usr/bin/chromium';
		this.rootDir = options.rootDir || process.cwd();
		this.origin = options.origin || 'https://yose.local';
		this.proc = null;
		this.sessionId = null;
		this.msgId = 1;
		this.pending = new Map();
		this.dialogs = [];
		this.nextConfirmAccept = true;
		this.nextPromptText = '';
		this.pageErrors = [];
		this.consoleErrors = [];
		this._readBuffer = '';
	}

	async launch() {
		this.proc = spawn(
			this.chromeBin,
			[
				'--headless',
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

		this.proc.stdio[4].on('data', (chunk) => {
			this._onPipeData(chunk);
		});

		const { targetInfos } = await this.send('Target.getTargets');
		const pageTarget = targetInfos.find(t => t.type === 'page');
		if (!pageTarget) {
			throw new Error('No page target found in Headless Chromium');
		}

		const { sessionId } = await this.send('Target.attachToTarget', {
			targetId: pageTarget.targetId,
			flatten: true
		});
		this.sessionId = sessionId;

		await this.send('Page.enable', {}, this.sessionId);
		await this.send('Runtime.enable', {}, this.sessionId);
		await this.send('DOM.enable', {}, this.sessionId);
		await this.send('Page.addScriptToEvaluateOnNewDocument', {
			source: `
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
					return window.__nextPromptText || def || '';
				};
			`
		}, this.sessionId);
		await this.send('Fetch.enable', {
			patterns: [{ urlPattern: '*' }]
		}, this.sessionId);
	}

	_onPipeData(chunk) {
		this._readBuffer += chunk.toString('utf8');
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
					reject(new Error(msg.error.message || JSON.stringify(msg.error)));
				} else {
					resolve(msg.result);
				}
			} else if (msg.method) {
				this._handleEvent(msg).catch(() => {});
			}
		}
	}

	async _handleEvent(msg) {
		const { method, params, sessionId } = msg;

		if (method === 'Fetch.requestPaused') {
			const reqUrl = new URL(params.request.url);
			if (reqUrl.origin === this.origin) {
				let relPath = decodeURIComponent(reqUrl.pathname);
				if (relPath === '/' || relPath === '') {
					relPath = '/index.html';
				}
				const safeRel = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
				const fullPath = path.join(this.rootDir, safeRel);

				if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
					const ext = path.extname(fullPath).toLowerCase();
					const mime = MIME_TYPES[ext] || 'application/octet-stream';
					const body = fs.readFileSync(fullPath).toString('base64');
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
					body: Buffer.from(CHART_JS_STUB, 'utf8').toString('base64')
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

	send(method, params = {}, sessionId = undefined) {
		if (!this.proc || this.proc.killed) {
			return Promise.reject(new Error('Chromium process is not running'));
		}
		const id = this.msgId++;
		const payload = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		this.proc.stdio[3].write(JSON.stringify(payload) + '\0');
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
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
		const found = await this.evaluate(`
			(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return false;
				el.click();
				return true;
			})()
		`);
		if (!found) {
			throw new Error(`Element not found for click: ${selector}`);
		}
		await new Promise(r => setTimeout(r, 80));
	}

	async fill(selector, value) {
		const found = await this.evaluate(`
			(() => {
				const el = document.querySelector(${JSON.stringify(selector)});
				if (!el) return false;
				el.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
				el.value = ${JSON.stringify(String(value))};
				el.dispatchEvent(new Event('input', { bubbles: true }));
				el.dispatchEvent(new Event('change', { bubbles: true }));
				el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
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
				if (!el) return false;
				if (el.classList.contains('hidden')) return false;
				const style = window.getComputedStyle(el);
				if (style.display === 'none' || style.visibility === 'hidden') return false;
				if (style.opacity === '0' && !el.classList.contains('active')) return false;
				return true;
			})()
		`);
	}

	async close() {
		for (const [, p] of this.pending) {
			p.reject(new Error('Browser closed'));
		}
		this.pending.clear();
		if (this.proc && !this.proc.killed) {
			this.proc.kill('SIGKILL');
		}
	}
}
