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
import { MaintenanceController } from './maintenance_controller.js';
import { MasterConflictController } from './master_conflict_controller.js';

export class AppCoordinator {
	constructor() {
		this.db = new YoseDB();
		this.syncManager = null;
		this.currentMonth = formatDate(new Date()).slice(0, 7);
		this.selectedYear = String(new Date().getFullYear());
		this.selectedDate = formatDate(new Date());
		this.currentMode = 'normal';
		this.analyticsTarget = 'cashflow'; // 'cashflow' | 'budget' | 'assets'
		this.analyticsGranularity = 'monthly'; // 'daily' | 'monthly' | 'yearly'
		this.showPlanned = true;
		this.useActualCategoryAxis = false;
		this.currentTaxMeta = null;

		this.swRegistration = null;
		this.availableUpdateVersion = null;
		this._domInitialized = false;
		this.allowNavigation = false;

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
		this.maintenanceController = new MaintenanceController(this);
		this.masterConflictController = new MasterConflictController(this);
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
		this.syncManager?.detachEventListeners();
		const gasUrl = await this.db.getSetting('gas_url', '');
		this.syncManager = new SyncManager({
			db: this.db,
			privateKey: this.privateKey,
			gasUrl: gasUrl
		});
		this.syncManager.attachEventListeners();
		this.syncStatusController.bindSyncManager();

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
			this.setupCollapsiblePanes();
			this.syncStatusController.setupListeners();
			this.txInputController.setupInputForm();
			this.txInputController.setupTaxModal();
			this.txEditController.setupEditTransactionModal();
			this.summaryController.setupSummaryView();
			this.settingsController.setupSettingsView();
			this.maintenanceController.setup();
			this.masterConflictController.setup();
			this.masterController.setupMasterTabs();
			this.syncStatusController.updateNetworkBadge();

			this.setupDepartureGuard();
			this.setupModalInteractionGuard();
			this.setupSwipeNavigation();
		}

		// 6. Setup Theme & Collapsible Panes state
		await this.initTheme();
		await this.applyCollapsedPanesState();

		// 7. Initial Render
		await this.refreshAllViews();

		// 8. Check for PWA updates if online
		this.checkStartupUpdate();
	}

	setupNavigation() {
		const tabBtns = document.querySelectorAll('.tab-btn');
		const panels = document.querySelectorAll('.tab-panel');

		tabBtns.forEach(btn => {
			btn.addEventListener('click', () => {
				const targetId = btn.dataset.tab;
				btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
				const analyticsTarget = btn.dataset.analyticsTarget;
				tabBtns.forEach(b => b.classList.remove('active'));
				panels.forEach(p => p.classList.remove('active'));

				btn.classList.add('active');

				if (analyticsTarget || targetId === 'tab-summary' || targetId === 'tab-cashflow' || targetId === 'tab-budget' || targetId === 'tab-assets') {
					const resolvedTarget = analyticsTarget || (targetId === 'tab-budget' ? 'budget' : targetId === 'tab-assets' ? 'assets' : this.analyticsTarget || 'cashflow');
					this.analyticsTarget = resolvedTarget;
					const summaryPanel = document.getElementById('tab-summary');
					if (summaryPanel) summaryPanel.classList.add('active');
					this.summaryController.renderSummary();
				} else {
					const targetPanel = document.getElementById(targetId);
					if (targetPanel) targetPanel.classList.add('active');
					if (targetId === 'tab-settings') {
						this.settingsController.renderSettings();
					}
				}
			});
		});
	}

	setupDepartureGuard() {
		if (!history.state?.yoseGuard) {
			history.replaceState({ yoseBase: true }, '', location.href);
			history.pushState({ yoseGuard: true }, '', location.href);
		}
		let restoring = false;
		window.addEventListener('beforeunload', event => {
			if (this.allowNavigation) return;
			event.preventDefault(); event.returnValue = '';
		});
		window.addEventListener('popstate', () => {
			if (this.allowNavigation) return;
			if (restoring) { restoring = false; return; }
			if (['modal-edit-tx', 'modal-master-conflict', 'modal-replacement-import'].some(id => document.getElementById(id)?.classList.contains('active'))) {
				this.closeTopModal();
				restoring = true; history.forward();
				return;
			}
			if (history.state?.yoseGuard) return;
			if (confirm('画面を閉じて前のページへ戻りますか？入力中の内容は失われます。')) {
				this.allowNavigation = true;
				if (history.length > 2) history.back(); else location.assign('about:blank');
			} else { restoring = true; history.forward(); }
		});
		window.addEventListener('pagehide', () => {
			clearActiveSession(); this.db.clearEncryptionKey();
			this.authController.privateKey = null; this.authController.isKeyLocked = true;
			this.syncManager?.setPrivateKey(null);
		});
		window.addEventListener('pageshow', event => {
			if (event.persisted) { this.allowNavigation = false; this.authController.showLockScreen(); }
		});
	}

	getTopModal() {
		return Array.from(document.querySelectorAll('.modal-overlay.active')).at(-1) || null;
	}

	closeTopModal() {
		const top = this.getTopModal();
		if (top?.id === 'modal-edit-tx') return this.txEditController.requestClose();
		if (top?.id === 'modal-master-conflict') { this.masterConflictController.cancel(); return true; }
		/** @type {HTMLElement} */ (top?.querySelector('.close-btn'))?.click();
		return true;
	}

	setupModalInteractionGuard() {
		const overlays = Array.from(document.querySelectorAll('.modal-overlay'));
		let locked = null;
		let current = null;
		const inertStates = new Map();
		const focusBefore = new Map();
		const update = () => {
			const authVisible = !document.getElementById('auth-screen').classList.contains('hidden');
			if (authVisible) for (const overlay of overlays) {
				if (overlay.classList.contains('active')) overlay.classList.remove('active');
			}
			const top = this.getTopModal();
			if (top === current) return;
			const previous = current;
			if (top && !locked) {
				locked = { x: scrollX, y: scrollY, style: document.body.getAttribute('style'), focus: document.activeElement };
				Object.assign(document.body.style, { position: 'fixed', top: `-${locked.y}px`, left: `-${locked.x}px`, width: '100%', overflow: 'hidden' });
			}
			if (top && !focusBefore.has(top)) focusBefore.set(top, document.activeElement);
			for (const child of Array.from(document.body.children)) {
				if (!(child instanceof HTMLElement)) continue;
				if (!inertStates.has(child)) inertStates.set(child, child.inert);
				child.inert = top ? child !== top : inertStates.get(child);
			}
			current = top;
			if (!top && locked) {
				if (locked.style === null) document.body.removeAttribute('style'); else document.body.setAttribute('style', locked.style);
				window.scrollTo(locked.x, locked.y);
				const target = authVisible ? document.getElementById('auth-pin-input') : locked.focus;
				if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
				locked = null; inertStates.clear(); focusBefore.clear();
			} else if (top) {
				const restore = previous && !previous.classList.contains('active') ? focusBefore.get(previous) : null;
				if (restore instanceof HTMLElement && top.contains(restore)) restore.focus({ preventScroll: true });
				else /** @type {HTMLElement} */ (top.querySelector('button, input, select, textarea'))?.focus({ preventScroll: true });
				if (previous && !previous.classList.contains('active')) focusBefore.delete(previous);
			}
		};
		const observer = new MutationObserver(update);
		for (const overlay of [...overlays, document.getElementById('auth-screen')]) observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
		document.addEventListener('keydown', event => {
			if (event.key !== 'Escape' || event.isComposing || !this.getTopModal()) return;
			event.preventDefault();
			this.closeTopModal();
		});
		update();
	}

	setupSwipeNavigation() {
		let start = null;
		const excluded = element => {
			if (document.querySelector('.modal-overlay.active') || !document.getElementById('auth-screen').classList.contains('hidden')) return true;
			if (element.closest('input, textarea, select, button, a, canvas, [contenteditable]')) return true;
			for (let el = element; el; el = el.parentElement) {
				if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
			}
			return false;
		};
		document.addEventListener('touchstart', event => {
			start = null;
			if (event.touches.length !== 1 || excluded(event.target)) return;
			const touch = event.touches[0];
			if (touch.clientX < 24 || touch.clientX > innerWidth - 24) return;
			start = { x: touch.clientX, y: touch.clientY };
		}, { passive: true });
		document.addEventListener('touchmove', event => {
			if (event.touches.length !== 1) { start = null; return; }
			if (!start) return;
			const touch = event.touches[0];
			if (Math.abs(touch.clientX - start.x) > Math.abs(touch.clientY - start.y) * 1.5 && event.cancelable) event.preventDefault();
		}, { passive: false });
		document.addEventListener('touchcancel', () => { start = null; });
		document.addEventListener('touchend', event => {
			const previous = start; start = null;
			if (!previous || event.changedTouches.length !== 1 || event.touches.length) return;
			const touch = event.changedTouches[0];
			const dx = touch.clientX - previous.x, dy = touch.clientY - previous.y;
			if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
			const buttons = Array.from(/** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.nav-tabs .tab-btn')));
			const index = buttons.findIndex(button => button.classList.contains('active'));
			const next = index + (dx < 0 ? 1 : -1);
			if (next >= 0 && next < buttons.length) buttons[next].click();
		});
	}

	async approveClosedChanges(changes, originals = []) {
		const snapshot = await this.db.getSnapshot();
		const closed = snapshot?.last_closed_month;
		if (!closed) return [];
		const months = [...new Set([...changes, ...originals].flatMap(tx => [tx.target_month, tx.previous_target_month]).filter(month => month && month <= closed))].sort();
		if (!months.length) return [];
		if (changes.some(tx => tx.target_month <= closed && !tx.is_deleted && (tx.status !== 'confirmed' || tx.amount_pending))) {
			alert('締め済み月には金額入力済みの確定明細のみ保存できます。金額・状態を確認してください。');
			return null;
		}
		return confirm(`${months.join('、')} は月締め済みです。変更を保存して再月締めしますか？\n取消時は変更を保存しません。`) ? months : null;
	}

	setupCollapsiblePanes() {
		if (typeof document === 'undefined') return;
		const interactive = 'button, a, input, select, textarea, label, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [tabindex]';
		const cards = document.querySelectorAll('#tab-summary .card[id], #tab-settings .card[id]');
		cards.forEach(card => {
			const paneId = card.id;
			const titleEl = card.querySelector('.card-title');
			if (!paneId || !titleEl || titleEl.querySelector('.card-collapse-btn')) return;

			const toggle = () => this.setPaneCollapsed(paneId, !card.classList.contains('collapsed'));
			const titleButton = document.createElement('button');
			titleButton.type = 'button';
			titleButton.className = 'card-collapse-title';
			titleButton.setAttribute('aria-expanded', 'true');
			for (const node of Array.from(titleEl.childNodes)) {
				if (node.nodeType === Node.TEXT_NODE || (node instanceof Element && !node.matches(interactive) && !node.querySelector(interactive))) titleButton.appendChild(node);
			}
			titleEl.prepend(titleButton);
			titleEl.classList.add('collapsible-card-title');
			titleButton.addEventListener('click', event => {
				event.stopPropagation();
				toggle();
			});

			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = 'card-collapse-btn';
			btn.dataset.paneId = paneId;
			btn.setAttribute('aria-expanded', 'true');
			btn.title = 'ペインの表示・非表示を切り替え';
			btn.textContent = '▼ 非表示';
			btn.addEventListener('click', event => {
				event.stopPropagation();
				toggle();
			});
			titleEl.appendChild(btn);
			titleEl.addEventListener('click', event => {
				if (event.target instanceof Element && event.target.closest(interactive)) return;
				toggle();
			});
		});
	}

	async applyCollapsedPanesState() {
		if (typeof document === 'undefined') return;
		let collapsedMap = {};
		try {
			const config = await this.db.getMasterConfig();
			if (config?.collapsed_panes && typeof config.collapsed_panes === 'object') {
				collapsedMap = { ...config.collapsed_panes };
			}
		} catch (e) {}

		for (const [paneId, isCollapsed] of Object.entries(collapsedMap)) {
			const card = document.getElementById(paneId);
			if (card) {
				card.classList.toggle('collapsed', Boolean(isCollapsed));
				for (const btn of card.querySelectorAll('.card-collapse-btn, .card-collapse-title')) {
					btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
					if (btn.classList.contains('card-collapse-btn')) btn.textContent = isCollapsed ? '▶ 表示' : '▼ 非表示';
				}
			}
		}
	}

	async setPaneCollapsed(paneId, isCollapsed) {
		if (!paneId) return;
		if (typeof document !== 'undefined') {
			const card = document.getElementById(paneId);
			if (card) {
				card.classList.toggle('collapsed', Boolean(isCollapsed));
				for (const btn of card.querySelectorAll('.card-collapse-btn, .card-collapse-title')) {
					btn.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
					if (btn.classList.contains('card-collapse-btn')) btn.textContent = isCollapsed ? '▶ 表示' : '▼ 非表示';
				}
			}
		}
		try {
			await this.persistDisplaySetting(config => ({ ...config, collapsed_panes: { ...(config.collapsed_panes || {}), [paneId]: Boolean(isCollapsed) } }));
		} catch (error) { this.showToast(`表示設定の保存に失敗しました: ${error.message}`); }
	}

	showToast(message = '✅ 登録が完了しました', durationMs = 2200) {
		if (typeof document === 'undefined') return;
		const toast = document.getElementById('toast-notification');
		if (!toast) return;
		toast.textContent = message;
		toast.style.display = 'block';
		toast.classList.add('active');
		if (this._toastTimer) {
			clearTimeout(this._toastTimer);
		}
		this._toastTimer = setTimeout(() => {
			toast.classList.remove('active');
			toast.style.display = 'none';
		}, durationMs);
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
		try {
			await this.db.processCreditCardAutoSettlements();
		} catch (e) {
			console.warn('Auto credit card settlement check skipped:', e.message);
		}
		await this.txInputController.populateMasterDropdowns();
		await this.txListController.renderRecentTransactions();
		await this.summaryController.renderSummary();
		await this.settingsController.renderSettings();
		await this.syncStatusController.updateSyncBadge();
		await this.maintenanceController.refresh();
	}

	async initTheme() {
		let theme = 'system';
		try {
			const config = await this.db.getMasterConfig();
			if (config?.theme) {
				theme = config.theme;
			} else if (typeof localStorage !== 'undefined') {
				theme = localStorage.getItem('yose_theme_preference') || 'system';
			}
		} catch (e) {}
		this.applyTheme(theme);

		if (typeof window !== 'undefined' && window.matchMedia) {
			const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			if (typeof mediaQuery.addEventListener === 'function') {
				mediaQuery.addEventListener('change', () => {
					if (this.currentThemePreference === 'system') {
						this.applyTheme('system');
					}
				});
			}
		}
	}

	applyTheme(theme) {
		this.currentThemePreference = theme;
		let resolved = theme;
		if (theme === 'system') {
			if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
				resolved = 'dark';
			} else {
				resolved = 'light';
			}
		}
		if (typeof document !== 'undefined') {
			document.documentElement.setAttribute('data-theme', resolved);
		}
		if (typeof localStorage !== 'undefined') {
			try { localStorage.setItem('yose_theme_preference', theme); } catch (e) {}
		}
		if (this.chartController) {
			this.chartController.updateThemeMode(resolved === 'dark');
		}
	}


	persistDisplaySetting(mutator) {
		const encryptionKey = this.db.encryptionKey;
		const previous = this.pendingDisplaySettings || Promise.resolve();
		const pending = previous.catch(() => {}).then(async () => {
			if (this.db.encryptionKey !== encryptionKey) throw new Error('待機中に認証が変更されました。解除後に操作し直してください。');
			await this.db.mutateMasterConfig(mutator);
		});
		this.pendingDisplaySettings = pending;
		return pending;
	}

	async setTheme(theme) {
		this.applyTheme(theme);
		try {
			await this.persistDisplaySetting(config => ({ ...config, theme }));
		} catch (error) { this.showToast(`テーマの保存に失敗しました: ${error.message}`); }
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

