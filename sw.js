/**
 * Yoseatsume Kakeibo - Service Worker (Offline Cache Control & Forced Update)
 */

const CACHE_NAME = 'yose-cache-v1.20.1';
const ASSETS_TO_CACHE = [
	'./',
	'./index.html',
	'./css/style.css',
	'./js/app.js',
	'./js/theme_bootstrap.js',
	'./js/db.js',
	'./js/db/defaults.js',
	'./js/db/storage_engine.js',
	'./js/db/backup_merger.js',
	'./js/db/backup_replacement.js',
	'./js/db/yose_db.js',
	'./js/logic.js',
	'./js/logic/date_utils.js',
	'./js/logic/transaction_factory.js',
	'./js/logic/advance_links.js',
	'./js/logic/data_insights.js',
	'./js/logic/furusato_calculator.js',
	'./js/logic/investment.js',
	'./js/logic/bulk_edit.js',
	'./js/logic/aggregator.js',
	'./js/logic/budget_engine.js',
	'./js/logic/master_sync.js',
	'./js/logic/master_maintenance.js',
	'./js/logic/data_integrity.js',
	'./js/logic/category_trend.js',
	'./js/logic/chart_geometry.js',
	'./js/ui/chart_viewport.js',
	'./js/ui/chart_interaction.js',
	'./js/ui/render_session.js',
	'./js/ui/budget_settings_controller.js',
	'./js/crypto.js',
	'./js/webauthn.js',
	'./js/sync.js',
	'./js/version.js',
	'./js/ui/coordinator.js',
	'./js/ui/auth_controller.js',
	'./js/ui/sync_status_controller.js',
	'./js/ui/chart_controller.js',
	'./js/ui/tx_list_controller.js',
	'./js/ui/tx_edit_controller.js',
	'./js/ui/advance_link_controller.js',
	'./js/ui/bulk_edit_controller.js',
	'./js/ui/insights_controller.js',
	'./js/ui/furusato_controller.js',
	'./js/ui/tx_input_controller.js',
	'./js/ui/tag_memo_input.js',
	'./js/ui/summary_controller.js',
	'./js/ui/master_controller.js',
	'./js/ui/settings_controller.js',
	'./js/ui/backup_import_controller.js',
	'./js/ui/maintenance_controller.js',
	'./js/ui/master_conflict_controller.js',
	'./manifest.json'
];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => {
			return cache.addAll(ASSETS_TO_CACHE);
		}).then(() => self.skipWaiting())
	);
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) => {
			return Promise.all(
				keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
			);
		}).then(() => self.clients.claim())
	);
});

self.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') {
		self.skipWaiting();
	} else if (event.data === 'CLEAR_ALL_CACHES') {
		event.waitUntil(
			caches.keys().then((keys) => {
				return Promise.all(keys.map((key) => caches.delete(key)));
			})
		);
	}
});

self.addEventListener('fetch', (event) => {
	// Only handle GET requests for offline caching
	if (event.request.method !== 'GET') {
		return;
	}

	// Ignore non-http/https schemes (e.g. chrome-extension://, moz-extension://, blob:, data:)
	if (!event.request.url.startsWith('http://') && !event.request.url.startsWith('https://')) {
		return;
	}

	const url = new URL(event.request.url);

	// Network-Only: version.json (must always be live) and GAS API endpoints
	if (url.pathname.endsWith('version.json') || url.hostname === 'script.google.com') {
		return;
	}

	event.respondWith(
		caches.match(event.request).then((cachedResponse) => {
			if (cachedResponse) {
				return cachedResponse;
			}
			return fetch(event.request).then((networkResponse) => {
				if (networkResponse.status !== 200 || networkResponse.type !== 'basic') {
					return networkResponse;
				}
				const responseToCache = networkResponse.clone();
				caches.open(CACHE_NAME).then((cache) => {
					cache.put(event.request, responseToCache).catch(() => {});
				}).catch(() => {});
				return networkResponse;
			}).catch(() => {
				// Fallback for HTML documents
				if (event.request.headers.get('accept')?.includes('text/html')) {
					return caches.match('./index.html');
				}
			});
		})
	);
});
