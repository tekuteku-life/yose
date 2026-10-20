/**
 * Yoseatsume Kakeibo - PWA Version & Forced Update Manager
 */

export const CURRENT_APP_VERSION = '1.7.5';

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * Validates whether a version string complies with Semantic Versioning.
 * Strictly rejects non-string types, empty strings, spaces, and HTML/XSS payloads.
 */
export function isValidSemVer(version) {
	if (typeof version !== 'string') return false;
	const trimmed = version.trim();
	if (trimmed !== version || trimmed.includes(' ')) return false;
	return SEMVER_REGEX.test(trimmed);
}

/**
 * Compares two SemVer strings (Major.Minor.Patch).
 * Returns 1 if v1 > v2, -1 if v1 < v2, and 0 if equal or invalid.
 */
export function compareVersions(v1, v2) {
	if (!isValidSemVer(v1) || !isValidSemVer(v2)) return 0;

	const core1 = v1.split('-')[0].split('.').map(Number);
	const core2 = v2.split('-')[0].split('.').map(Number);

	for (let i = 0; i < 3; i++) {
		if (core1[i] > core2[i]) return 1;
		if (core1[i] < core2[i]) return -1;
	}

	return 0;
}

/**
 * Checks server for latest version.json with cache-busting.
 */
export async function checkAppVersion(options = {}) {
	const currentVersion = options.currentVersion || CURRENT_APP_VERSION;
	const isOnline = typeof options.isOnline === 'boolean' ? options.isOnline : true;

	if (!isOnline) {
		return { updateAvailable: false, reason: 'offline', currentVersion };
	}

	const fetcher = options.fetchFn || fetch;
	const endpoint = options.endpoint || './version.json';
	const url = `${endpoint}?_t=${Date.now()}`;

	try {
		const res = await fetcher(url, {
			cache: 'no-store',
			headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
		});

		if (!res.ok) {
			return { updateAvailable: false, error: 'http_error', status: res.status, currentVersion };
		}

		const data = await res.json();
		if (!data || !isValidSemVer(data.version)) {
			return { updateAvailable: false, error: 'invalid_server_version', currentVersion };
		}

		const serverVersion = data.version;
		const comparison = compareVersions(serverVersion, currentVersion);

		const session = options.sessionStorage || null;
		if (comparison <= 0) {
			if (session) {
				session.removeItem('yose_update_attempted_version');
			}
			return { updateAvailable: false, currentVersion, serverVersion };
		}

		// Check infinite reload session guard
		if (options.suppressRepeatedPrompt && session) {
			const attempted = session.getItem('yose_update_attempted_version');
			if (attempted === serverVersion) {
				return { updateAvailable: false, suppressed: true, currentVersion, serverVersion };
			}
		}

		return { updateAvailable: true, currentVersion, serverVersion };
	} catch (err) {
		return { updateAvailable: false, error: 'network_error', message: err.message, currentVersion };
	}
}

/**
 * Purges CacheStorage, signals Service Worker, sets session reload guard, and reloads page.
 * Strictly isolates and NEVER touches IndexedDB (financial data).
 */
export async function purgeAppCacheAndReload(options = {}) {
	const cachesObj = options.caches || null;
	const swReg = options.swRegistration || null;
	const session = options.sessionStorage || null;
	const targetVersion = options.targetVersion || null;
	const loc = options.location || null;

	// 1. Post message to Service Worker to skip waiting & clear caches
	if (swReg) {
		if (swReg.active) {
			swReg.active.postMessage('SKIP_WAITING');
			swReg.active.postMessage('CLEAR_ALL_CACHES');
		}
		if (swReg.waiting) {
			swReg.waiting.postMessage('SKIP_WAITING');
			swReg.waiting.postMessage('CLEAR_ALL_CACHES');
		}
	}

	// 2. Clear all browser CacheStorage instances
	if (cachesObj) {
		try {
			const keys = await cachesObj.keys();
			await Promise.all(keys.map(k => cachesObj.delete(k)));
		} catch (e) {}
	}

	// 3. Set session guard to prevent infinite restart loop on failed server deploy
	if (session && targetVersion) {
		try {
			session.setItem('yose_update_attempted_version', targetVersion);
		} catch (e) {}
	}

	// 4. Force reload
	if (loc) {
		loc.reload();
	}
}
