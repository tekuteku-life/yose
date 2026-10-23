import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { productionSource, coverageGlobals } from '../../scripts/coverage_tools.js';

const filename = path.resolve('js/theme_bootstrap.js');
const source = productionSource(filename);

function bootstrap(saved, dark, { unavailableMedia = false, storageError = false } = {}) {
	const attributes = new Map();
	const context = vm.createContext({
		...coverageGlobals(),
		localStorage: { getItem: key => { assert.equal(key, 'yose_theme_preference'); if (storageError) throw new Error('storage blocked'); return saved; } },
		window: { matchMedia: unavailableMedia ? undefined : query => { assert.equal(query, '(prefers-color-scheme: dark)'); return { matches: dark }; } },
		document: { documentElement: { setAttribute: (key, value) => attributes.set(key, value) } }
	});
	new vm.Script(source, { filename }).runInContext(context);
	return attributes.get('data-theme');
}

describe('Theme before first paint', () => {
	it('uses the OS preference with no saved override or an explicit system preference', () => {
		for (const saved of [null, 'system']) {
			assert.equal(bootstrap(saved, true), 'dark');
			assert.equal(bootstrap(saved, false), 'light');
		}
	});
	it('preserves a saved fixed theme independently of the OS preference', () => {
		assert.equal(bootstrap('light', true), 'light');
		assert.equal(bootstrap('dark', false), 'dark');
	});
	it('keeps the light fallback when media queries are unsupported', () => {
		assert.equal(bootstrap(null, false, { unavailableMedia: true }), 'light');
	});
	it('keeps the document default and continues startup when storage is blocked', () => {
		assert.equal(bootstrap(null, true, { storageError: true }), undefined);
	});
});
