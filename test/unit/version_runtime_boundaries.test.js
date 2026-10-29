import { it } from 'node:test';
import assert from 'node:assert/strict';
import { checkAppVersion, purgeAppCacheAndReload, CURRENT_APP_VERSION } from '../../js/version.js';

it('uses the browser fetch and current version when version-check options are omitted', async t => {
	const requests = [];
	t.mock.method(globalThis, 'fetch', async (...args) => { requests.push(args); return { ok: true, json: async () => ({ version: CURRENT_APP_VERSION }) }; });
	const result = await checkAppVersion();
	assert.deepEqual(result, { updateAvailable: false, currentVersion: CURRENT_APP_VERSION, serverVersion: CURRENT_APP_VERSION });
	assert.equal(requests.length, 1); assert.match(requests[0][0], /^\.\/version\.json\?_t=\d+$/); assert.equal(requests[0][1].cache, 'no-store');
});

it('can purge with omitted dependencies and continues reload when optional cache or session storage fails', async () => {
	await assert.doesNotReject(purgeAppCacheAndReload());
	const events = [];
	await purgeAppCacheAndReload({
		caches: { keys: async () => { events.push('cache'); throw new Error('cache blocked'); } },
		sessionStorage: { setItem(key, value) { events.push([key, value]); throw new Error('session quota'); } },
		targetVersion: '9.8.7', location: { reload() { events.push('reload'); } }
	});
	assert.deepEqual(events, ['cache', ['yose_update_attempted_version', '9.8.7'], 'reload']);
});
