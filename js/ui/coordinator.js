/**
 * Yoseatsume Kakeibo - Application Coordinator (Mediator)
 * Central orchestrator managing state, lifecycle, dependency injection, and inter-controller communication.
 */

import { YoseDB } from '../db.js';
import { SyncManager } from '../sync.js';
import { formatDate } from '../logic.js';
import { CURRENT_APP_VERSION, checkAppVersion } from '../version.js';
import { captureRenderSession, readInRenderSession } from './render_session.js';

import { AuthController } from './auth_controller.js';
import { SyncStatusController } from './sync_status_controller.js';
import { BudgetSettingsController } from './budget_settings_controller.js';
import { ChartController } from './chart_controller.js';
import { TransactionListController } from './tx_list_controller.js';
import { TransactionEditController } from './tx_edit_controller.js';
import { TransactionInputController } from './tx_input_controller.js';
import { SummaryController } from './summary_controller.js';
import { MasterController } from './master_controller.js';
import { SettingsController } from './settings_controller.js';
import { MaintenanceController } from './maintenance_controller.js';
import { MasterConflictController } from './master_conflict_controller.js';
import { BulkEditController } from './bulk_edit_controller.js';
import { FurusatoController } from './furusato_controller.js';
import { InsightsController } from './insights_controller.js';
import { AdvanceLinkController } from './advance_link_controller.js';

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
		this.budgetSettingsController = new BudgetSettingsController(this);
		this.maintenanceController = new MaintenanceController(this);
		this.masterConflictController = new MasterConflictController(this);
		this.advanceLinkController = new AdvanceLinkController(this);
		this.bulkEditController = new BulkEditController(this);
		this.insightsController = new InsightsController(this);
		this.furusatoController = new FurusatoController(this);
	}

	// Backward-compatible accessors for key states and components
	get privateKey() { return this.authController.privateKey; }
	set privateKey(val) { this.authController.privateKey = val; }
	get publicKey() { return this.authController.publicKey; }
	set publicKey(val) { this.authController.publicKey = val; }
	get publicKeyBase64() { return this.authController.publicKeyBase64; }
	set publicKeyBase64(val) { this.authController.publicKeyBase64 = val; }
	get isKeyLocked() { return this.authController.isKeyLocked; }
	set isKeyLocked(val) { this.authController.isKeyLocked = val; }
	get chart() { return this.chartController.chart; }
	set chart(val) { this.chartController.chart = val; }

	async init() {
		this.setupModalInteractionGuard();
		// 1. Initialize Database
		await this.db.init();

		// 2. Setup Security Keys & Auth Gate
		await this.authController.initSecurityAndAuthGate();
	}

	async finishAppInit({ isSessionValid = null } = {}) {
		const session = captureRenderSession(this, isSessionValid);
		if (!session()) return;
		const owner = {}, privateKey = this.privateKey;
		this.initializationOwner = owner;
		const valid = () => session() && this.initializationOwner === owner;
		// 3. Setup Sync Manager
		const gasUrl = await readInRenderSession(valid, () => this.db.getSetting('gas_url', ''));
		if (!valid()) return;
		this.syncManager?.detachEventListeners();
		const manager = new SyncManager({
			db: this.db,
			privateKey,
			gasUrl,
			captureSession: () => captureRenderSession(this, () => this.syncManager === manager)
		});
		this.syncManager = manager;
		this.syncManager.attachEventListeners();
		this.syncStatusController.bindSyncManager();

		// 4. Register Service Worker if in browser
		if ('serviceWorker' in navigator) {
			navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
				if (valid()) this.swRegistration = reg;
			}).catch(err => {
				if (valid()) console.warn('SW registration failed:', err);
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
			this.txListController.setupInteractionGuard();
			this.advanceLinkController.setup();
			this.bulkEditController.setup();
			this.insightsController.setup();
			this.furusatoController.setup();
			this.summaryController.setupSummaryView();
			this.setupSettingsView();
			this.maintenanceController.setup();
			this.masterConflictController.setup();
			this.masterController.setupMasterTabs();
			this.syncStatusController.updateNetworkBadge();

			this.setupDepartureGuard();
			this.setupSwipeNavigation();
		}

		// 6. Setup Theme & Collapsible Panes state
		await this.initTheme({ isSessionValid: valid });
		if (!valid()) return;
		await this.applyCollapsedPanesState({ isSessionValid: valid });
		if (!valid()) return;

		// 7. Initial Render
		await this.refreshAllViews({ isSessionValid: valid });
		if (!valid()) return;

		// 8. Check for PWA updates if online
		this.checkStartupUpdate({ isSessionValid: valid });
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

				if (analyticsTarget) {
					this.analyticsTarget = analyticsTarget;
					const summaryPanel = document.getElementById('tab-summary');
					summaryPanel.classList.add('active');
					this.summaryController.renderSummary();
				} else {
					const targetPanel = document.getElementById(targetId);
					targetPanel.classList.add('active');
					if (targetId === 'tab-tax') void this.furusatoController.render();
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
			if (this.getTopModal()) {
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
			this.authController.invalidateSession();
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
		if (top?.id === 'modal-bulk-edit') return this.bulkEditController.requestClose();
		if (top?.id === 'modal-edit-tx') return this.txEditController.requestClose();
		if (top?.id === 'modal-master-item') return this.masterController.requestClose();
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
			const top = authVisible ? document.getElementById('auth-screen') : this.getTopModal();
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
				const target = locked.focus;
				if (target instanceof HTMLElement && target.isConnected) target.focus({ preventScroll: true });
				locked = null; inertStates.clear(); focusBefore.clear();
			} else {
				const restore = previous && !previous.classList.contains('active') ? focusBefore.get(previous) : null;
				if (restore instanceof HTMLElement && top.contains(restore)) restore.focus({ preventScroll: true });
				else /** @type {HTMLElement} */ (top.querySelector('button, input, select, textarea'))?.focus({ preventScroll: true });
				if (previous && !previous.classList.contains('active')) focusBefore.delete(previous);
			}
		};
		const observer = new MutationObserver(update);
		for (const overlay of [...overlays, document.getElementById('auth-screen')]) observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
		document.addEventListener('keydown', event => {
			const auth = document.getElementById('auth-screen');
			if (event.key === 'Tab' && !auth.classList.contains('hidden') && !event.defaultPrevented) {
				const controls = Array.from(/** @type {NodeListOf<HTMLElement>} */ (auth.querySelectorAll('button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))).filter(element => !('disabled' in element && element.disabled) && element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
				const first = controls[0], last = controls.at(-1);
				if (!auth.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
					event.preventDefault();
					(event.shiftKey ? last : first)?.focus();
				}
				return;
			}
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

	async approveClosedChanges(changes, originals = [], { isSessionValid = null } = {}) {
		const valid = captureRenderSession(this, isSessionValid);
		const snapshot = await readInRenderSession(valid, () => this.db.getSnapshot());
		if (!valid()) return null;
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

	async applyCollapsedPanesState({ isSessionValid = null } = {}) {
		const valid = captureRenderSession(this, isSessionValid);
		if (!valid()) return;
		let collapsedMap = {};
		try {
			const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
			if (config?.collapsed_panes && typeof config.collapsed_panes === 'object') {
				collapsedMap = { ...config.collapsed_panes };
			}
		} catch (e) {}

		if (!valid()) return;
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

	async setPaneCollapsed(paneId, isCollapsed, { isSessionValid = null } = {}) {
		const valid = captureRenderSession(this, isSessionValid);
		if (!paneId || !valid()) return;
		{
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
			await this.persistDisplaySetting(config => ({ ...config, collapsed_panes: { ...(config.collapsed_panes || {}), [paneId]: Boolean(isCollapsed) } }), { isSessionValid: valid });
		} catch (error) { if (valid()) this.showToast(`表示設定の保存に失敗しました: ${error.message}`); }
	}

	showToast(message = '✅ 登録が完了しました', durationMs = 2200) {
		const toast = document.getElementById('toast-notification');
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

	async checkStartupUpdate({ isSessionValid = null } = {}) {
		const valid = captureRenderSession(this, isSessionValid);
		if (!valid() || !navigator.onLine) return;
		const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
		const timeoutId = controller ? setTimeout(() => controller.abort(), 3000) : null;
		try {
			const res = await checkAppVersion({
				currentVersion: CURRENT_APP_VERSION,
				isOnline: true,
				sessionStorage: typeof sessionStorage !== 'undefined' ? sessionStorage : null,
				suppressRepeatedPrompt: true,
				fetchFn: (url, opts) => fetch(url, { ...opts, signal: controller?.signal })
			});
			if (!valid()) return;
			if (res && res.updateAvailable) {
				this.availableUpdateVersion = res.serverVersion;
				this.showUpdateModal(res.serverVersion);
			}
		} catch (e) {
			// Silently catch to avoid disrupting startup in degraded networks
		} finally { if (timeoutId) clearTimeout(timeoutId); }
	}

	showUpdateModal(serverVersion) {
		const modal = document.getElementById('modal-app-update');
		const textEl = document.getElementById('modal-new-version-text');
		textEl.textContent = `v${serverVersion}`;
		modal.classList.add('active');
	}

	hideUpdateModal() {
		const modal = document.getElementById('modal-app-update');
		modal.classList.remove('active');
	}

	async refreshAllViews({ generateSettlements = true, isSessionValid = null } = {}) {
		const valid = captureRenderSession(this, isSessionValid), options = { isSessionValid: valid };
		if (!valid()) return;
		if (generateSettlements) {
			try {
				await this.db.processCreditCardAutoSettlements(undefined, { isSessionValid: valid });
			} catch (e) {
				if (valid()) console.warn('Auto credit card settlement check skipped:', e.message);
			}
		}
		if (!valid()) return;
		await this.txInputController.populateMasterDropdowns(options);
		if (!valid()) return;
		await this.txListController.renderRecentTransactions(options);
		if (!valid()) return;
		await this.summaryController.renderSummary(options);
		if (!valid()) return;
		await this.settingsController.renderSettings(options);
		if (!valid()) return;
		if (document.getElementById('tab-tax').classList.contains('active')) await this.furusatoController.render(null, options);
		if (!valid()) return;
		await this.syncStatusController.updateSyncBadge(options);
		if (!valid()) return;
		await this.maintenanceController.refresh(options);
	}

	async refreshAfterTransactionChange({ isSessionValid = null, scheduleMaintenance = true } = {}) {
		const valid = captureRenderSession(this, isSessionValid);
		if (!valid()) return;
		const options = { isSessionValid: valid };
		try {
			const jobs = [this.txListController.renderRecentTransactions(options), this.syncStatusController.updateSyncBadge(options)];
			for (const { id, render } of [
				{ id: 'tab-summary', render: value => this.summaryController.renderSummary(value) },
				{ id: 'tab-tax', render: value => this.furusatoController.render(null, value) },
				{ id: 'tab-settings', render: value => this.settingsController.renderSettings(value) }
			]) {
				const panel = document.getElementById(id);
				if (panel.classList.contains('active')) jobs.push(render({ isSessionValid: () => valid() && panel.classList.contains('active') }));
			}
			await Promise.all(jobs);
		} finally {
			if (scheduleMaintenance && valid()) void this.scheduleTransactionMaintenance();
		}
	}

	cancelTransactionMaintenance() {
		const task = this._transactionMaintenanceTask;
		this._transactionMaintenanceTask = null;
		if (task) { task.requested = false; task.cancelWait?.(); }
	}

	scheduleTransactionMaintenance() {
		const valid = captureRenderSession(this);
		if (!valid()) return Promise.resolve();
		const current = this._transactionMaintenanceTask;
		if (current && !current.finished && current.valid()) { current.requested = true; return current.promise; }
		const task = { valid, manager: this.syncManager, requested: true, finished: false, cancelWait: null, promise: null };
		this._transactionMaintenanceTask = task;
		task.promise = Promise.resolve().then(() => this.runTransactionMaintenance(task)).catch(async error => {
			if (!valid()) return;
			console.warn('Background transaction maintenance deferred:', error.message);
			try { await this.syncStatusController.updateSyncBadge({ isSessionValid: valid }); }
			catch (badgeError) { if (valid()) console.warn('Sync status refresh deferred:', badgeError.message); }
		}).finally(() => {
			if (this._transactionMaintenanceTask !== task) return;
			this._transactionMaintenanceTask = null;
			if (task.requested && valid()) return this.scheduleTransactionMaintenance();
		});
		return task.promise;
	}

	async runTransactionMaintenance(task) {
		const valid = task.valid;
		try {
			while (task.requested && valid()) {
				task.requested = false;
				const generated = await this.db.processCreditCardAutoSettlements(undefined, { isSessionValid: valid });
				if (!valid()) return;
				const candidateValid = () => valid() && !this.txInputController.submitBusy;
				if (candidateValid()) {
					await this.txInputController.updateTagAndMemoSuggestions({ isSessionValid: candidateValid });
					if (candidateValid()) await this.txInputController.renderUnsettledAdvanceList({ isSessionValid: candidateValid });
				}
				if (!valid()) return;
				if (generated?.length) await this.refreshAfterTransactionChange({ isSessionValid: valid, scheduleMaintenance: false });
				if (!valid()) return;
				const manager = task.manager;
				if (!manager?.gasUrl || !manager.privateKey || manager !== this.syncManager) continue;
				if (manager.isSyncing) await new Promise(resolve => {
					let unsubscribe = () => {};
					const finish = () => { if (!manager.isSyncing || !valid() || manager !== this.syncManager) { unsubscribe(); resolve(undefined); } };
					unsubscribe = manager.onStateChange(finish);
					task.cancelWait = () => { unsubscribe(); resolve(undefined); };
					finish();
				});
				task.cancelWait = null;
				if (!valid() || manager !== this.syncManager) return;
				const previousResult = manager.lastResult;
				let result;
				try { result = await manager.syncPendingDiffs({ isSessionValid: valid }); }
				finally {
					const committed = result || (manager.lastResult !== previousResult ? manager.lastResult : null);
					const hasChanges = committed && (committed.synced_count > 0 || committed.downloaded_count > 0 || committed.import_completed ||
						Object.values(committed.changes || {}).some(direction => Object.values(direction).some(count => count > 0)));
					if (hasChanges && valid() && manager === this.syncManager) await this.refreshAfterTransactionChange({ isSessionValid: valid, scheduleMaintenance: false });
				}
			}
		} finally { task.finished = true; task.cancelWait?.(); }
	}

	async initTheme({ isSessionValid = null } = {}) {
		const valid = captureRenderSession(this, isSessionValid);
		if (!valid()) return;
		let theme = 'system';
		try {
			const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
			if (config?.theme) {
				theme = config.theme;
			} else if (typeof localStorage !== 'undefined') {
				theme = localStorage.getItem('yose_theme_preference') || 'system';
			}
		} catch (e) {}
		if (!valid()) return;
		this.applyTheme(theme);

		if (!this.themeMediaListener && window.matchMedia) {
			const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			if (typeof mediaQuery.addEventListener === 'function') {
				this.themeMediaListener = () => {
					if (this.currentThemePreference === 'system') {
						this.applyTheme('system');
					}
				};
				mediaQuery.addEventListener('change', this.themeMediaListener);
			}
		}
	}

	applyTheme(theme) {
		this.currentThemePreference = theme;
		let resolved = theme;
		if (theme === 'system') {
			if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
				resolved = 'dark';
			} else {
				resolved = 'light';
			}
		}
		document.documentElement.setAttribute('data-theme', resolved);
		if (typeof localStorage !== 'undefined') {
			try { localStorage.setItem('yose_theme_preference', theme); } catch (e) {}
		}
		this.chartController.updateThemeMode(resolved === 'dark');
	}


	persistDisplaySetting(mutator, { isSessionValid = null } = {}) {
		const valid = captureRenderSession(this, isSessionValid);
		const previous = this.pendingDisplaySettings || Promise.resolve();
		const pending = previous.catch(() => {}).then(async () => {
			if (!valid()) return;
			await this.db.mutateMasterConfig(mutator, { isSessionValid: valid });
		});
		this.pendingDisplaySettings = pending;
		return pending;
	}

	async setTheme(theme) {
		const valid = captureRenderSession(this);
		if (!valid()) return;
		this.applyTheme(theme);
		try {
			await this.persistDisplaySetting(config => ({ ...config, theme }), { isSessionValid: valid });
		} catch (error) { if (valid()) this.showToast(`テーマの保存に失敗しました: ${error.message}`); }
	}

	// Facade delegation methods for 100% backward compatibility
	async generateNewKeyPair() { return this.authController.generateNewKeyPair(); }
	updateKeyDisplay() { return this.authController.updateKeyDisplay(); }
	async ensureKeyUnlocked() { return this.authController.ensureKeyUnlocked(); }
	async lockPrivateKey() { return this.authController.lockPrivateKey(); }
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
	setupSettingsView() {
		this.settingsController.setupSettingsView();
		this.budgetSettingsController.setup();
	}
	async renderSettings() { return this.settingsController.renderSettings(); }
	setupMasterTabs() { return this.masterController.setupMasterTabs(); }
	async renderMasterManagement() { return this.masterController.renderMasterManagement(); }
	async openMasterModal(type, item, parent) { return this.masterController.openMasterModal(type, item, parent); }
}

