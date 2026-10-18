/**
 * Yoseatsume Kakeibo - Application Coordinator (Mediator)
 * Central orchestrator managing state, lifecycle, dependency injection, and inter-controller communication.
 */

import { YoseDB } from '../db.js';
import { SyncManager } from '../sync.js';
import { formatDate } from '../logic.js';
import { clearActiveSession } from '../crypto.js';
import { CURRENT_APP_VERSION, checkAppVersion } from '../version.js';

import { AuthController } from './auth_controller.js';
import { SyncStatusController } from './sync_status_controller.js';
import { ChartController } from './chart_controller.js';
import { TransactionListController } from './tx_list_controller.js';
import { TransactionEditController } from './tx_edit_controller.js';
import { TransactionInputController } from './tx_input_controller.js';
import { SummaryController } from './summary_controller.js';
import { MasterController } from './master_controller.js';
import { SettingsController } from './settings_controller.js';

export class AppCoordinator {
	constructor() {
		this.db = new YoseDB();
		this.syncManager = null;
		this.currentMonth = formatDate(new Date()).slice(0, 7);
		this.selectedYear = String(new Date().getFullYear());
		this.currentMode = 'normal';
		this.analyticsTarget = 'cashflow'; // 'cashflow' | 'budget' | 'assets'
		this.analyticsGranularity = 'monthly'; // 'daily' | 'monthly' | 'yearly'
		this.showPlanned = true;
		this.useActualCategoryAxis = false;
		this.currentTaxMeta = null;

		this.swRegistration = null;
		this.availableUpdateVersion = null;
		this._domInitialized = false;

		// Component Controllers (DI via Mediator)
		this.authController = new AuthController(this);
		this.syncStatusController = new SyncStatusController(this);
		this.chartController = new ChartController(this);
		this.txListController = new TransactionListController(this);
		this.txEditController = new TransactionEditController(this);
		this.txInputController = new TransactionInputController(this);
		this.summaryController = new SummaryController(this);
		this.masterController = new MasterController(this);
		this.settingsController = new SettingsController(this);
	}

	// Backward-compatible accessors for key states and components
	get privateKey() { return this.authController.privateKey; }
	set privateKey(val) { this.authController.privateKey = val; }
	get publicKey() { return this.authController.publicKey; }
	set publicKey(val) { this.authController.publicKey = val; }
	get publicKeyBase64() { return this.authController.publicKeyBase64; }
	set publicKeyBase64(val) { this.authController.publicKeyBase64 = val; }
	get isKeyProtectedWithPin() { return this.authController.isKeyProtectedWithPin; }
	set isKeyProtectedWithPin(val) { this.authController.isKeyProtectedWithPin = val; }
	get isKeyLocked() { return this.authController.isKeyLocked; }
	set isKeyLocked(val) { this.authController.isKeyLocked = val; }
	get chart() { return this.chartController.chart; }
	set chart(val) { this.chartController.chart = val; }

	async init() {
		// 1. Initialize Database
		await this.db.init();

		// 2. Setup Security Keys & Auth Gate
		await this.authController.initSecurityAndAuthGate();
	}

	async finishAppInit() {
		// 3. Setup Sync Manager
		const gasUrl = await this.db.getSetting('gas_url', '');
		this.syncManager = new SyncManager({
			db: this.db,
			privateKey: this.privateKey,
			gasUrl: gasUrl
		});
		this.syncManager.attachEventListeners();

		// 4. Register Service Worker if in browser
		if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
				this.swRegistration = reg;
			}).catch(err => {
				console.warn('SW registration failed:', err);
			});
		}

		// 5. Setup DOM & Event Handlers
		if (!this._domInitialized) {
			this._domInitialized = true;
			this.setupNavigation();
			this.syncStatusController.setupListeners();
			this.txInputController.setupInputForm();
			this.txInputController.setupTaxModal();
			this.txEditController.setupEditTransactionModal();
			this.summaryController.setupSummaryView();
			this.settingsController.setupSettingsView();
			this.masterController.setupMasterTabs();
			this.syncStatusController.updateNetworkBadge();

			if (typeof window !== 'undefined') {
				window.addEventListener('beforeunload', () => {
					clearActiveSession();
					this.db.clearEncryptionKey();
				});
			}
		}

		// 6. Initial Render
		await this.refreshAllViews();

		// 7. Check for PWA updates if online
		this.checkStartupUpdate();
	}

	setupNavigation() {
		const tabBtns = document.querySelectorAll('.tab-btn');
		const panels = document.querySelectorAll('.tab-panel');

		tabBtns.forEach(btn => {
			btn.addEventListener('click', () => {
				const targetId = btn.dataset.tab;
				tabBtns.forEach(b => b.classList.remove('active'));
				panels.forEach(p => p.classList.remove('active'));

				btn.classList.add('active');
				const targetPanel = document.getElementById(targetId);
				if (targetPanel) targetPanel.classList.add('active');

				if (targetId === 'tab-summary') {
					this.summaryController.renderSummary();
				} else if (targetId === 'tab-settings') {
					this.settingsController.renderSettings();
				}
			});
		});
	}

	async checkStartupUpdate() {
		if (typeof navigator === 'undefined' || !navigator.onLine) return;
		try {
			const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
			const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;
			const res = await checkAppVersion({
				currentVersion: CURRENT_APP_VERSION,
				isOnline: true,
				sessionStorage: typeof sessionStorage !== 'undefined' ? sessionStorage : null,
				suppressRepeatedPrompt: true,
				fetchFn: (url, opts) => fetch(url, { ...opts, signal: controller?.signal })
			});
			if (timeoutId) clearTimeout(timeoutId);

			if (res && res.updateAvailable) {
				this.availableUpdateVersion = res.serverVersion;
				this.showUpdateModal(res.serverVersion);
			}
		} catch (e) {
			// Silently catch to avoid disrupting startup in degraded networks
		}
	}

	showUpdateModal(serverVersion) {
		const modal = document.getElementById('modal-app-update');
		const textEl = document.getElementById('modal-new-version-text');
		if (textEl) {
			textEl.textContent = `v${serverVersion}`;
		}
		if (modal) {
			modal.classList.add('active');
		}
	}

	hideUpdateModal() {
		const modal = document.getElementById('modal-app-update');
		if (modal) {
			modal.classList.remove('active');
		}
	}

	async refreshAllViews() {
		await this.txInputController.populateMasterDropdowns();
		await this.txListController.renderRecentTransactions();
		await this.summaryController.renderSummary();
		await this.settingsController.renderSettings();
		await this.syncStatusController.updateSyncBadge();
	}

	// Facade delegation methods for 100% backward compatibility
	async generateNewKeyPair() { return this.authController.generateNewKeyPair(); }
	updateKeyDisplay() { return this.authController.updateKeyDisplay(); }
	async promptPinUnlock() { return this.authController.promptPinUnlock(); }
	async ensureKeyUnlocked() { return this.authController.ensureKeyUnlocked(); }
	async lockPrivateKey() { return this.authController.lockPrivateKey(); }
	async removePinProtection() { return this.authController.removePinProtection(); }
	updateNetworkBadge() { return this.syncStatusController.updateNetworkBadge(); }
	async updateSyncBadge() { return this.syncStatusController.updateSyncBadge(); }
	async handleManualSync() { return this.syncStatusController.handleManualSync(); }
	async renderMonthTransactions() { return this.txListController.renderMonthTransactions(); }
	async renderRecentTransactions() { return this.txListController.renderRecentTransactions(); }
	async openEditTransactionModal(id) { return this.txEditController.openEditTransactionModal(id); }
	async handleEditFormSubmit() { return this.txEditController.handleEditFormSubmit(); }
	async handleEditDelete(id) { return this.txEditController.handleEditDelete(id); }
	setupInputForm() { return this.txInputController.setupInputForm(); }
	switchInputMode(mode) { return this.txInputController.switchInputMode(mode); }
	async populateMasterDropdowns() { return this.txInputController.populateMasterDropdowns(); }
	async updateSubcategories(catId, target) { return this.txInputController.updateSubcategories(catId, target); }
	setupTaxModal() { return this.txInputController.setupTaxModal(); }
	async handleFormSubmit() { return this.txInputController.handleFormSubmit(); }
	setupSummaryView() { return this.summaryController.setupSummaryView(); }
	async renderSummary() { return this.summaryController.renderSummary(); }
	setupSettingsView() { return this.settingsController.setupSettingsView(); }
	async renderSettings() { return this.settingsController.renderSettings(); }
	setupMasterTabs() { return this.masterController.setupMasterTabs(); }
	async renderMasterManagement() { return this.masterController.renderMasterManagement(); }
	async openMasterModal(type, item, parent) { return this.masterController.openMasterModal(type, item, parent); }
}

