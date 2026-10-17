import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
	CURRENT_APP_VERSION,
	isValidSemVer,
	compareVersions,
	checkAppVersion,
	purgeAppCacheAndReload
} from '../../js/version.js';

describe('js/version.js - PWA Version & Forced Update Unit Tests', () => {
	describe('CURRENT_APP_VERSION and isValidSemVer', () => {
		it('defines a valid CURRENT_APP_VERSION matching SemVer', () => {
			assert.ok(typeof CURRENT_APP_VERSION === 'string');
			assert.equal(isValidSemVer(CURRENT_APP_VERSION), true);
		});

		it('validates standard SemVer strings accurately', () => {
			assert.equal(isValidSemVer('1.0.0'), true);
			assert.equal(isValidSemVer('1.2.3'), true);
			assert.equal(isValidSemVer('0.1.0-alpha.1'), true);
			assert.equal(isValidSemVer('2.0.0-beta'), true);

			// Invalid patterns
			assert.equal(isValidSemVer(''), false);
			assert.equal(isValidSemVer('v1.0.0'), false);
			assert.equal(isValidSemVer('1.0'), false);
			assert.equal(isValidSemVer('1.0.0.0'), false);
			assert.equal(isValidSemVer('<script>alert(1)</script>'), false);
			assert.equal(isValidSemVer(null), false);
			assert.equal(isValidSemVer(undefined), false);
			assert.equal(isValidSemVer(123), false);
			assert.equal(isValidSemVer({}), false);
			assert.equal(isValidSemVer([]), false);
			assert.equal(isValidSemVer(' 1.0.0 '), false);
		});
	});

	describe('compareVersions', () => {
		it('accurately compares two SemVer strings', () => {
			assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
			assert.equal(compareVersions('1.0.1', '1.0.0') > 0, true);
			assert.equal(compareVersions('1.0.0', '1.0.1') < 0, true);
			assert.equal(compareVersions('1.1.0', '1.0.9') > 0, true);
			assert.equal(compareVersions('1.0.9', '1.1.0') < 0, true);
			assert.equal(compareVersions('2.0.0', '1.9.99') > 0, true);
			assert.equal(compareVersions('1.0.0', '2.0.0') < 0, true);
			assert.equal(compareVersions('1.2.10', '1.2.2') > 0, true);
		});

		it('returns 0 if either version is invalid', () => {
			assert.equal(compareVersions('invalid', '1.0.0'), 0);
			assert.equal(compareVersions('1.0.0', 'invalid'), 0);
			assert.equal(compareVersions(null, '1.0.0'), 0);
			assert.equal(compareVersions(undefined, '1.0.0'), 0);
			assert.equal(compareVersions('1.0.0', undefined), 0);
		});
	});

	describe('checkAppVersion', () => {
		it('returns updateAvailable: true when server version is newer', async () => {
			const mockFetch = async (url, opts) => {
				assert.ok(url.includes('version.json'));
				assert.ok(url.includes('_t='));
				assert.equal(opts.cache, 'no-store');
				return {
					ok: true,
					status: 200,
					json: async () => ({ version: '1.2.0', build_time: '2026-10-17T16:00:00Z' })
				};
			};

			const result = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetch,
				isOnline: true
			});

			assert.equal(result.updateAvailable, true);
			assert.equal(result.currentVersion, '1.1.0');
			assert.equal(result.serverVersion, '1.2.0');
		});

		it('returns updateAvailable: false when server version is identical or older', async () => {
			const mockFetch = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ version: '1.1.0' })
			});

			const resSame = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetch,
				isOnline: true
			});
			assert.equal(resSame.updateAvailable, false);
			assert.equal(resSame.serverVersion, '1.1.0');

			const mockFetchOlder = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ version: '1.0.5' })
			});
			const resOlder = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetchOlder,
				isOnline: true
			});
			assert.equal(resOlder.updateAvailable, false);
			assert.equal(resOlder.serverVersion, '1.0.5');
		});

		it('returns offline status when isOnline is false without fetching', async () => {
			let fetchCalled = false;
			const mockFetch = async () => {
				fetchCalled = true;
			};

			const result = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetch,
				isOnline: false
			});

			assert.equal(fetchCalled, false);
			assert.equal(result.updateAvailable, false);
			assert.equal(result.reason, 'offline');
		});

		it('handles non-200 HTTP responses gracefully', async () => {
			const mockFetch = async () => ({
				ok: false,
				status: 404
			});

			const result = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetch,
				isOnline: true
			});

			assert.equal(result.updateAvailable, false);
			assert.equal(result.error, 'http_error');
		});

		it('handles invalid server version payload (XSS attempt or malformed)', async () => {
			const mockFetch = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ version: '<script>alert(1)</script>' })
			});

			const result = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetch,
				isOnline: true
			});

			assert.equal(result.updateAvailable, false);
			assert.equal(result.error, 'invalid_server_version');
		});

		it('handles network throw or timeout gracefully', async () => {
			const mockFetch = async () => {
				throw new Error('Network failed');
			};

			const result = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetch,
				isOnline: true
			});

			assert.equal(result.updateAvailable, false);
			assert.equal(result.error, 'network_error');
		});

		it('handles checkAppVersion default options and json parsing errors', async () => {
			const mockFetchBadJson = async () => ({
				ok: true,
				status: 200,
				json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }
			});
			const resBadJson = await checkAppVersion({
				fetchFn: mockFetchBadJson,
				isOnline: true
			});
			assert.equal(resBadJson.updateAvailable, false);
			assert.equal(resBadJson.error, 'network_error');

			// Different version in session guard allows update
			const sessionStore = new Map([['yose_update_attempted_version', '1.1.9']]);
			const mockSessionStorage = {
				getItem: (k) => sessionStore.get(k) || null,
				setItem: (k, v) => sessionStore.set(k, v),
				removeItem: (k) => sessionStore.delete(k)
			};
			const mockFetchNew = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ version: '1.2.0' })
			});
			const resNew = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetchNew,
				isOnline: true,
				sessionStorage: mockSessionStorage,
				suppressRepeatedPrompt: true
			});
			assert.equal(resNew.updateAvailable, true);
			assert.equal(resNew.serverVersion, '1.2.0');
		});

		it('resets session guard when current version matches server version', async () => {
			const sessionStore = new Map([['yose_update_attempted_version', '1.1.0']]);
			const mockSessionStorage = {
				getItem: (k) => sessionStore.get(k) || null,
				setItem: (k, v) => sessionStore.set(k, v),
				removeItem: (k) => sessionStore.delete(k)
			};
			const mockFetchSame = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ version: '1.1.0' })
			});

			const res = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetchSame,
				isOnline: true,
				sessionStorage: mockSessionStorage
			});
			assert.equal(res.updateAvailable, false);
			assert.equal(sessionStore.has('yose_update_attempted_version'), false);
		});

		it('suppresses updateAvailable when session guard indicates update was already attempted', async () => {
			const sessionStore = new Map([['yose_update_attempted_version', '1.2.0']]);
			const mockSessionStorage = {
				getItem: (k) => sessionStore.get(k) || null,
				setItem: (k, v) => sessionStore.set(k, v)
			};

			const mockFetch = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ version: '1.2.0' })
			});

			const result = await checkAppVersion({
				currentVersion: '1.1.0',
				fetchFn: mockFetch,
				isOnline: true,
				sessionStorage: mockSessionStorage,
				suppressRepeatedPrompt: true
			});

			assert.equal(result.updateAvailable, false);
			assert.equal(result.suppressed, true);
			assert.equal(result.serverVersion, '1.2.0');
		});

		it('defaults options safely when called with minimal arguments', async () => {
			const mockFetch = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ version: CURRENT_APP_VERSION })
			});
			const result = await checkAppVersion({
				fetchFn: mockFetch
			});
			assert.equal(result.updateAvailable, false);
			assert.equal(result.currentVersion, CURRENT_APP_VERSION);
		});
	});

	describe('purgeAppCacheAndReload', () => {
		it('sends SW messages, deletes CacheStorage keys, sets session guard, and triggers reload', async () => {
			const deletedCaches = [];
			const mockCaches = {
				keys: async () => ['yose-cache-v1', 'yose-cache-v2'],
				delete: async (name) => {
					deletedCaches.push(name);
					return true;
				}
			};

			const postedMessages = [];
			const mockSwReg = {
				active: {
					postMessage: (msg) => postedMessages.push({ target: 'active', msg })
				},
				waiting: {
					postMessage: (msg) => postedMessages.push({ target: 'waiting', msg })
				}
			};

			const sessionStore = new Map();
			const mockSessionStorage = {
				setItem: (k, v) => sessionStore.set(k, v),
				getItem: (k) => sessionStore.get(k)
			};

			let reloaded = false;
			const mockLocation = {
				reload: () => { reloaded = true; }
			};

			await purgeAppCacheAndReload({
				caches: mockCaches,
				swRegistration: mockSwReg,
				sessionStorage: mockSessionStorage,
				targetVersion: '1.2.0',
				location: mockLocation
			});

			// Verify messages posted to SW
			assert.ok(postedMessages.some(m => m.msg === 'SKIP_WAITING'));
			assert.ok(postedMessages.some(m => m.msg === 'CLEAR_ALL_CACHES'));

			// Verify all caches deleted
			assert.deepEqual(deletedCaches, ['yose-cache-v1', 'yose-cache-v2']);

			// Verify session guard set
			assert.equal(sessionStore.get('yose_update_attempted_version'), '1.2.0');

			// Verify reload called
			assert.equal(reloaded, true);
		});

		it('guarantees that IndexedDB is NEVER touched or deleted during cache purge', async () => {
			let idbDeleteCalled = false;
			const mockIndexedDB = {
				deleteDatabase: () => {
					idbDeleteCalled = true;
				}
			};

			let reloaded = false;
			const mockLocation = { reload: () => { reloaded = true; } };

			await purgeAppCacheAndReload({
				caches: { keys: async () => [], delete: async () => true },
				indexedDB: mockIndexedDB,
				location: mockLocation
			});

			assert.equal(idbDeleteCalled, false, 'IndexedDB must never be touched during cache purge');
			assert.equal(reloaded, true);
		});

		it('handles cache deletion errors and partial SW registration gracefully', async () => {
			const mockFailingCaches = {
				keys: async () => { throw new Error('Storage quota error'); }
			};
			const mockPartialSwReg = {
				active: { postMessage: () => {} }
				// waiting is undefined
			};
			let reloaded = false;
			const mockLocation = { reload: () => { reloaded = true; } };

			await purgeAppCacheAndReload({
				caches: mockFailingCaches,
				swRegistration: mockPartialSwReg,
				location: mockLocation
			});

			assert.equal(reloaded, true);
		});

		it('handles null/undefined optional parameters safely without throwing', async () => {
			let reloaded = false;
			const mockLocation = {
				reload: () => { reloaded = true; }
			};

			await purgeAppCacheAndReload({
				caches: null,
				swRegistration: null,
				sessionStorage: null,
				targetVersion: '1.2.0',
				location: mockLocation
			});

			assert.equal(reloaded, true);
		});

		it('covers all branch combinations in purgeAppCacheAndReload and checkAppVersion', async () => {
			// 1. SW with waiting only (no active), and no targetVersion
			let reloaded = false;
			const waitingMessages = [];
			const mockSwRegWaiting = {
				waiting: { postMessage: (msg) => waitingMessages.push(msg) }
			};
			await purgeAppCacheAndReload({
				swRegistration: mockSwRegWaiting,
				location: { reload: () => { reloaded = true; } }
			});
			assert.equal(reloaded, true);
			assert.ok(waitingMessages.includes('SKIP_WAITING'));

			// 2. checkAppVersion with null data
			const mockFetchNull = async () => ({
				ok: true,
				status: 200,
				json: async () => null
			});
			const resNull = await checkAppVersion({
				fetchFn: mockFetchNull,
				isOnline: true
			});
			assert.equal(resNull.updateAvailable, false);
			assert.equal(resNull.error, 'invalid_server_version');

			// 3. checkAppVersion with custom endpoint
			let requestedUrl = '';
			const mockFetchCustom = async (url) => {
				requestedUrl = url;
				return {
					ok: true,
					status: 200,
					json: async () => ({ version: '1.1.0' })
				};
			};
			const resCustom = await checkAppVersion({
				endpoint: '/custom/version.json',
				fetchFn: mockFetchCustom,
				isOnline: true
				// no sessionStorage passed
			});
			assert.ok(requestedUrl.startsWith('/custom/version.json?_t='));
			assert.equal(resCustom.updateAvailable, false);

			// 4. checkAppVersion without suppressRepeatedPrompt
			const mockFetchNew = async () => ({
				ok: true,
				status: 200,
				json: async () => ({ version: '2.0.0' })
			});
			const resNewNoSuppress = await checkAppVersion({
				currentVersion: '1.0.0',
				fetchFn: mockFetchNew,
				isOnline: true,
				suppressRepeatedPrompt: false
			});
			assert.equal(resNewNoSuppress.updateAvailable, true);
			assert.equal(resNewNoSuppress.serverVersion, '2.0.0');

			// 6. session truthy but targetVersion falsy
			const mockSession = { setItem: () => {} };
			await purgeAppCacheAndReload({
				sessionStorage: mockSession,
				targetVersion: null,
				location: { reload: () => {} }
			});

			// 7. suppressRepeatedPrompt true but session falsy
			const resSuppressNoSession = await checkAppVersion({
				currentVersion: '1.0.0',
				fetchFn: mockFetchNew,
				isOnline: true,
				suppressRepeatedPrompt: true,
				sessionStorage: null
			});
			assert.equal(resSuppressNoSession.updateAvailable, true);
		});
	});
});
