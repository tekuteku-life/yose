/**
 * Yoseatsume Kakeibo - Main Application Controller (Facade)
 * Entrypoint that instantiates AppCoordinator and provides backward-compatible public interface.
 */

import { AppCoordinator } from './ui/coordinator.js';

class AppController extends AppCoordinator {
	constructor() {
		super();
	}
}

// Auto-instantiate when running in browser
if (typeof window !== 'undefined') {
	const startApp = () => {
		if (window.__yose_app) return;
		const app = new AppController();
		window.__yose_app = app;
		app.init().catch(err => {
			console.error('Failed to initialize AppController:', err);
		});
	};

	if (document.readyState === 'loading') {
		window.addEventListener('DOMContentLoaded', startApp);
	} else {
		startApp();
	}
}

export { AppController, AppCoordinator };
