/**
 * Yoseatsume Kakeibo - Settings & Environment Controller
 * Manages Settings tab, Key Management (3 Subcards), Annual Budgets, Backup Import/Export, and PWA Update.
 */

import { BackupImportController } from './backup_import_controller.js';
import { captureRenderSession, readInRenderSession } from './render_session.js';
import { beginFormBusy } from './form_busy.js';

import {
	formatDate,
	escapeHtml
} from '../logic.js';
import {
	encryptMasterKeysWithPin,
	canonicalJsonStringify,
	exportKeyRaw,
	exportPrivateKeyPkcs8
} from '../crypto.js';
import {
	CURRENT_APP_VERSION,
	checkAppVersion,
	purgeAppCacheAndReload
} from '../version.js';

export class SettingsController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.backupImportController = new BackupImportController(coordinator);
		this.gasUrlDirty = false;
		this.gasUrlGeneration = 0;
		this.savingGasUrl = false;
		this.pointDefaultsGeneration = 0;
		this.pointDefaultsDirty = false;
		this.savingPointDefaults = false;
		this.pointDefaultsConfig = null;
		this.pointDefaultsOriginal = null;
		this.releasePointDefaults = null;
		this.settingsOperations = new Map();
		this.jsonGeneration = 0;
		this.jsonExpectedConfig = null;
	}

	get db() {
		return this.coordinator.db;
	}

	get syncManager() {
		return this.coordinator.syncManager;
	}

	get authController() {
		return this.coordinator.authController;
	}

	setupSettingsView() {
		this.backupImportController.setup();
		document.getElementById('select-point-offset-category').addEventListener('change', () => {
			if (this.savingPointDefaults) return;
			this.pointDefaultsDirty = true; this.pointDefaultsGeneration++;
			this.populatePointDefaultChildren(null);
		});
		document.getElementById('select-point-offset-subcategory').addEventListener('change', () => { if (!this.savingPointDefaults) { this.pointDefaultsDirty = true; this.pointDefaultsGeneration++; } });
		document.getElementById('btn-save-point-defaults').addEventListener('click', () => this.savePointDefaults());
		document.getElementById('btn-reload-point-defaults').addEventListener('click', () => this.reloadPointDefaults());
		// Generate new key
		document.getElementById('btn-generate-key')?.addEventListener('click', async () => {
			if (confirm('新しいEd25519鍵ペアを生成しますか？\n（GAS側の USER_PUBLIC_KEYS の更新が必要になります）')) {
				await this.authController.generateNewKeyPair();
			}
		});

		// Copy public key; notify only after the clipboard operation completes.
		document.getElementById('btn-copy-public-key')?.addEventListener('click', async () => {
			const txt = document.getElementById('txt-public-key');

			txt.select();
			try {
				if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
				await navigator.clipboard.writeText(txt.value);
				alert('公開鍵をクリップボードにコピーしました！');
			} catch (error) {
				alert('公開鍵をコピーできませんでした。選択されている公開鍵を手動でコピーしてください。');
			}
		});

		// PIN protection
		document.getElementById('btn-save-pin')?.addEventListener('click', async () => {
			const pinInput = document.getElementById('input-pin');
			const pin = pinInput.value;
			const root = document.getElementById('form-save-pin');
			const operation = this.beginSettingsOperation(root, document.getElementById('btn-save-pin'));
			if (!operation) return;
			const valid = operation.valid;
			const dmk = this.db.encryptionKey, privateKey = this.authController.privateKey, publicKeyAtStart = this.authController.publicKeyBase64;
			let dmkRaw, privPkcs8;
			try {
				if (!pin || pin.length < 4) { alert('PINコードは4桁以上を入力してください'); return; }
				if (!dmk || !privateKey) { alert('秘密鍵またはDB暗号化鍵がロードされていません。ロック中の場合は先に解除してください。'); return; }
				const expectedSecurityKeys = await this.db.getSecurityKeyStates(['master_keys_package'], { isSessionValid: valid });
				if (!valid()) return;
				expectedSecurityKeys.public_key_base64 = { exists: true, value: publicKeyAtStart };
				dmkRaw = await exportKeyRaw(dmk);
				if (!valid()) return;
				privPkcs8 = await exportPrivateKeyPkcs8(privateKey);
				if (!valid()) return;
				const pkg = await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8: privPkcs8 }, pin);
				if (!valid()) return;
				await this.db.saveSecurityKey('master_keys_package', pkg, { isSessionValid: valid, expectedSecurityKeys });
				if (!valid()) return;
				pinInput.value = '';
				this.authController.updateKeyDisplay();
				alert('PINコードを正常に更新しました！\n秘密鍵およびDB暗号化鍵が新しいPINで保護されました。');
			} catch (error) { if (valid()) alert(`PIN更新に失敗しました: ${error.message}`); }
			finally { dmkRaw?.fill(0); privPkcs8?.fill(0); this.endSettingsOperation(root, operation); }
		});

		document.getElementById('btn-lock-now')?.addEventListener('click', async () => {
			await this.authController.lockPrivateKey();
		});

		// Save GAS URL
		document.getElementById('input-gas-url')?.addEventListener('input', () => { this.gasUrlDirty = true; this.gasUrlGeneration++; });
		document.getElementById('btn-save-gas-url')?.addEventListener('click', async () => {
			const urlInput = document.getElementById('input-gas-url');
			const url = urlInput.value.trim();
			const generation = this.gasUrlGeneration;
			const button = document.getElementById('btn-save-gas-url');
			const root = document.getElementById('details-gas-url');
			const operation = this.beginSettingsOperation(root, button);
			if (!operation) return;
			const manager = this.syncManager, valid = () => operation.valid() && this.syncManager === manager;
			this.savingGasUrl = true;
			try {
				await this.db.setSetting('gas_url', url, { isSessionValid: valid });
				if (!valid()) return;
				manager.setGasUrl(url);
				if (this.gasUrlGeneration === generation) { this.gasUrlDirty = false; urlInput.value = url; }
				this.gasUrlGeneration++;
				alert('GAS URLを保存しました');
			} catch (error) { if (valid()) alert(`GAS URLを保存できませんでした: ${error.message}`); }
			finally { if (this.endSettingsOperation(root, operation)) this.savingGasUrl = false; }
		});

		// Manual sync button
		document.getElementById('btn-manual-sync')?.addEventListener('click', async () => {
			await this.coordinator.syncStatusController.handleManualSync();
		});

		// Helper function to trigger download of JSON
		const downloadJsonFile = (data, filename) => {
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
		};

		// Export modal open / close (Requirement 3.26)
		const modalExport = document.getElementById('modal-export-json');
		document.getElementById('btn-open-export-modal')?.addEventListener('click', () => {
			modalExport?.classList.add('active');
		});
		document.getElementById('btn-close-export-modal')?.addEventListener('click', () => {
			modalExport?.classList.remove('active');
		});

		// One export boundary retains the origin for every format and reports active failures.
		const exportJson = async (read, filename) => {
			const valid = captureRenderSession(this.coordinator);
			try {
				const data = await readInRenderSession(valid, read);
				if (!valid()) return;
				downloadJsonFile(data, `${filename}_${formatDate(new Date())}.json`);
				modalExport?.classList.remove('active');
			} catch (error) {
				if (valid()) alert(`エクスポートに失敗しました: ${error.message}`);
			}
		};
		const handleExportFull = () => exportJson(() => this.db.exportFullData(), 'yose_backup');
		document.getElementById('btn-export-backup')?.addEventListener('click', handleExportFull);
		document.getElementById('btn-export-full')?.addEventListener('click', handleExportFull);
		document.getElementById('btn-export-transactions')?.addEventListener('click', () => exportJson(() => this.db.exportTransactionsData(), 'yose_transactions'));
		document.getElementById('btn-export-master')?.addEventListener('click', () => exportJson(() => this.db.exportMasterConfigData(), 'yose_master_config'));
		document.getElementById('btn-export-budgets')?.addEventListener('click', () => exportJson(() => this.db.exportAnnualBudgetsData(), 'yose_annual_budgets'));
		document.getElementById('btn-export-snapshot')?.addEventListener('click', () => exportJson(() => this.db.exportSummarySnapshotData(), 'yose_snapshot'));

		// Import backup trigger
		const fileInput = document.getElementById('file-import-input');
		document.getElementById('btn-import-trigger')?.addEventListener('click', () => {
			fileInput?.click();
		});

		fileInput?.addEventListener('change', async (e) => {
			const file = e.target?.files?.[0];
			if (!file) return;
			const mode = document.getElementById('select-import-mode').value;
			const operation = this.beginSettingsOperation(fileInput, document.getElementById('btn-import-trigger'));
			if (!operation) return;
			const valid = operation.valid;
			try {
				const text = await readInRenderSession(valid, () => file.text());
				if (!valid()) return;
				let data;
				try {
					data = JSON.parse(text);
				} catch (parseErr) {
					throw new Error('不正なJSONファイル形式です: ' + parseErr.message);
				}
				if (mode === 'replace') {
					await this.backupImportController.preview(data, { isSessionValid: valid });
					return;
				}
				const res = await this.db.importFullData(data, { isSessionValid: valid });
				if (!valid()) return;
				const s = res.stats;
				const typeNames = {
					full_backup: '全データ',
					transactions: '取引明細',
					master_config: 'マスタ設定',
					annual_budgets: '年間予算',
					summary_snapshot: '残高スナップショット'
				};
				const typeLabel = typeNames[res.detectedType];
				const msg = [
					`【${typeLabel}差分ORマージ完了】`,
					`・明細: 追加 ${s.addedTransactions}件 / 更新 ${s.updatedTransactions}件 / スキップ ${s.skippedTransactions}件`,
					`・口座マスタ: 追加 ${s.addedAccounts}件`,
					`・大項目マスタ: 追加 ${s.addedCategories}件 (内訳中項目: 追加 ${s.addedSubcategories}件)`,
					`・定期ルール: 追加 ${s.addedRecurringRules}件`,
					`・祝日: 新規追加 ${s.addedHolidays}件`,
					`・年間予算: 追加/更新 ${s.addedBudgets}件`
				].join('\n');
				alert(msg);
				await this.coordinator.refreshAllViews({ isSessionValid: valid });
			} catch (err) {
				if (valid()) alert(`インポート失敗: ${err.message}`);
			} finally {
				if (this.endSettingsOperation(fileInput, operation)) fileInput.value = '';
			}
		});

		// Owner-controlled setup never sends registration requests to the public endpoint.
		document.getElementById('btn-show-gas-key-setup')?.addEventListener('click', () => {
			alert('GASを公開前に、公開鍵をコピーし、GASエディタの「プロジェクトの設定」→「スクリプト プロパティ」で USER_PUBLIC_KEYS に登録してください。鍵の更新もGAS管理画面で行います。');
		});

		// Toggle key details
		document.getElementById('btn-toggle-key-details')?.addEventListener('click', () => {
			const details = document.getElementById('key-mgmt-details');
			details.dataset.userOpened = 'true';
			details.style.display = details.style.display === 'none' ? 'block' : 'none';
		});

		// Register a verified credential and its optional device-local PRF key wrap together.
		document.getElementById('btn-register-webauthn')?.addEventListener('click', async () => {
			const pending = this.authController.registerPasskey();
			const valid = captureRenderSession(this.coordinator);
			try {
				const supportsUnlock = await pending;
				if (!valid()) return;
				alert(supportsUnlock ? 'パスキーを登録しました。次回からPINを入力せずに解除できます。' : 'パスキーを登録しました。この環境ではPRFに対応していないため、データの復号にはPINを使用します。');
				await this.renderSettings({ isSessionValid: valid });
			} catch (error) { if (valid()) alert(`WebAuthn登録エラー: ${error.message}`); }
		});

		// WebAuthn Passkey clear / unregister
		document.getElementById('btn-clear-webauthn')?.addEventListener('click', async () => {
			const origin = captureRenderSession(this.coordinator);
			if (!origin()) return;
			if (!confirm('登録済みのWebAuthn (Passkey) 連携を解除しますか？\n（解除後もPINコードによるロック解除は継続して利用可能です）')) {
				return;
			}
			if (!origin()) return;
			const publicKeyAtStart = this.authController.publicKeyBase64;
			this.authController.beginAuthentication();
			const valid = captureRenderSession(this.coordinator);
			if (!valid()) return;
			try {
				const expectedSecurityKeys = await this.db.getSecurityKeyStates(['master_keys_package', 'webauthn_credential', 'webauthn_vault'], { isSessionValid: valid });
				if (!valid()) return;
				expectedSecurityKeys.public_key_base64 = { exists: true, value: publicKeyAtStart };
				await this.db.putSecurityKeys({}, valid, { expectedSecurityKeys, deleteKeys: ['webauthn_credential', 'webauthn_vault'] });
				if (!valid()) return;
				const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
				if (!valid()) return;
				if (config && config.synced_passkey_bundle) {
					await this.db.mutateMasterConfig(current => { delete current.synced_passkey_bundle; return current; }, { isSessionValid: valid });
					if (!valid()) return;
				}
				alert('WebAuthn連携を解除しました');
				await this.renderSettings({ isSessionValid: valid });
			} catch (err) {
				if (valid()) alert(`WebAuthn解除エラー: ${err.message}`);
			}
		});

		// View / Edit Master JSON
		const btnViewMaster = document.getElementById('btn-view-master-json');
		const editor = document.getElementById('master-json-editor');
		const txtMaster = document.getElementById('txt-master-json');
		const btnSaveMaster = document.getElementById('btn-save-master-json');

		btnViewMaster?.addEventListener('click', async () => {
			const session = captureRenderSession(this.coordinator);
			if (!session() || this.settingsOperations.has(editor)) return;
			const generation = ++this.jsonGeneration;
			const valid = () => session() && generation === this.jsonGeneration;
			if (editor.style.display !== 'none') { editor.style.display = 'none'; return; }
			try {
				const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
				if (!valid()) return;
				this.jsonExpectedConfig = structuredClone(config);
				txtMaster.value = JSON.stringify(config, null, 2);
				editor.style.display = 'block';
			} catch (error) { if (valid()) alert(`マスタJSONを開けませんでした: ${error.message}`); }
		});

		btnSaveMaster?.addEventListener('click', async () => {
			const operation = this.beginSettingsOperation(editor, btnSaveMaster);
			if (!operation) return;
			const generation = ++this.jsonGeneration, valid = () => operation.valid() && generation === this.jsonGeneration;
			const expectedConfig = structuredClone(this.jsonExpectedConfig);
			try {
				const config = JSON.parse(txtMaster.value);
				const saved = await this.coordinator.masterController.saveMasterConfigAndSync(config, expectedConfig, valid);
				if (!valid()) return;
				this.jsonExpectedConfig = structuredClone(saved);
				txtMaster.value = JSON.stringify(saved, null, 2);
				alert('マスタ設定を保存しました');
			} catch (err) {
				if (valid()) alert(`マスタ設定の保存に失敗しました: ${err.message}`);
			}
			finally { this.endSettingsOperation(editor, operation); }
		});

		// App Version & Forced Update Management
		const badgeVer = document.getElementById('badge-current-version');
		badgeVer.textContent = `v${CURRENT_APP_VERSION}`;

		const updateStatus = document.getElementById('update-status-msg');

		document.getElementById('btn-check-app-update')?.addEventListener('click', async () => {
			updateStatus.style.display = 'block';
			updateStatus.style.backgroundColor = 'var(--bg-card)';
			updateStatus.style.border = '1px solid var(--border)';
			updateStatus.style.color = 'var(--text-main)';
			updateStatus.textContent = '🔄 サーバー上のバージョンを確認中...';

			if (typeof navigator !== 'undefined' && !navigator.onLine) {
				updateStatus.style.backgroundColor = '#fff3cd';
				updateStatus.style.color = '#856404';
				updateStatus.style.border = '1px solid #ffeeba';
				updateStatus.textContent = '⚠️ オフラインのため確認できません。ネットワーク接続を確認してください。';
				return;
			}

			try {
				const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
				const timeoutId = controller ? setTimeout(() => controller.abort(), 5000) : null;
				const res = await checkAppVersion({
					currentVersion: CURRENT_APP_VERSION,
					isOnline: true,
					suppressRepeatedPrompt: false,
					sessionStorage: typeof sessionStorage !== 'undefined' ? sessionStorage : null,
					fetchFn: (url, opts) => fetch(url, { ...opts, signal: controller?.signal })
				});
				if (timeoutId) clearTimeout(timeoutId);

				if (res.updateAvailable) {
					this.coordinator.availableUpdateVersion = res.serverVersion;
					updateStatus.style.backgroundColor = '#d4edda';
					updateStatus.style.color = '#155724';
					updateStatus.style.border = '1px solid #c3e6cb';
					updateStatus.textContent = `🚀 新しいバージョン (v${res.serverVersion}) が利用可能です！`;
					this.coordinator.showUpdateModal(res.serverVersion);
				} else if (res.error) {
					updateStatus.style.backgroundColor = '#f8d7da';
					updateStatus.style.color = '#721c24';
					updateStatus.style.border = '1px solid #f5c6cb';
					updateStatus.textContent = `⚠️ バージョン確認エラー: ${res.error}`;
				} else {
					updateStatus.style.backgroundColor = '#d4edda';
					updateStatus.style.color = '#155724';
					updateStatus.style.border = '1px solid #c3e6cb';
					updateStatus.textContent = `✅ お使いのアプリは最新バージョン (v${CURRENT_APP_VERSION}) です。`;
				}
			} catch (err) {
				updateStatus.style.backgroundColor = '#f8d7da';
				updateStatus.style.color = '#721c24';
				updateStatus.style.border = '1px solid #f5c6cb';
				updateStatus.textContent = `⚠️ 通信エラー: ${err.message}`;
			}
		});

		document.getElementById('btn-force-cache-clear')?.addEventListener('click', async () => {
			if (confirm('キャッシュストレージを全削除し、サーバーから最新版を強制再読み込みしますか？\n（IndexedDB内の家計データや認証鍵は保持されます）')) {
				this.coordinator.allowNavigation = true;
				await purgeAppCacheAndReload({
					caches: typeof caches !== 'undefined' ? caches : null,
					swRegistration: this.coordinator.swRegistration,
					sessionStorage: typeof sessionStorage !== 'undefined' ? sessionStorage : null,
					targetVersion: CURRENT_APP_VERSION,
					location: window.location
				});
			}
		});

		// Update modal action buttons
		document.getElementById('btn-confirm-app-update')?.addEventListener('click', async () => {
			this.coordinator.allowNavigation = true;
			await purgeAppCacheAndReload({
				caches: typeof caches !== 'undefined' ? caches : null,
				swRegistration: this.coordinator.swRegistration,
				sessionStorage: typeof sessionStorage !== 'undefined' ? sessionStorage : null,
				targetVersion: this.coordinator.availableUpdateVersion || CURRENT_APP_VERSION,
				location: window.location
			});
		});

		document.getElementById('btn-dismiss-app-update')?.addEventListener('click', () => {
			this.coordinator.hideUpdateModal();
		});

		document.getElementById('btn-close-app-update-modal')?.addEventListener('click', () => {
			this.coordinator.hideUpdateModal();
		});

		// Theme Preference Change (Requirement 3.24)
		document.querySelectorAll('input[name="theme-preference"]').forEach(radio => {
			radio.addEventListener('change', async (e) => {
				if (e.target.checked) {
					await this.coordinator.setTheme(e.target.value);
				}
			});
		});
	}

	async renderPendingImport({ isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid()) return;
		await this.backupImportController.renderPending({ isSessionValid: valid });
	}

	beginSettingsOperation(root, button) {
		const session = captureRenderSession(this.coordinator);
		if (!session() || this.settingsOperations.has(root)) return null;
		const operation = { release: beginFormBusy(root, button, '保存中…'), valid: () => session() && this.settingsOperations.get(root) === operation };
		this.settingsOperations.set(root, operation);
		return operation;
	}

	endSettingsOperation(root, operation) {
		if (this.settingsOperations.get(root) !== operation) return false;
		operation.release(); this.settingsOperations.delete(root); return true;
	}

	cancelPendingOperations() {
		this.backupImportController.cancel();
		for (const operation of this.settingsOperations.values()) operation.release();
		this.settingsOperations.clear();
		document.getElementById('file-import-input').value = '';
		this.savingGasUrl = false; this.gasUrlGeneration++;
		this.jsonGeneration++; this.jsonExpectedConfig = null;
		document.getElementById('master-json-editor').style.display = 'none';
		document.getElementById('txt-master-json').value = '';
		this.pointDefaultsGeneration++;
		this.releasePointDefaults?.(); this.releasePointDefaults = null;
		this.savingPointDefaults = false; this.pointDefaultsDirty = false;
	}

	populatePointDefaultChildren(current) {
		const parent = this.pointDefaultsConfig?.categories?.find(item => item.id === document.getElementById('select-point-offset-category').value);
		const select = document.getElementById('select-point-offset-subcategory');
		select.innerHTML = '<option value="">内訳なし</option>' + (parent?.subcategories || []).filter(item => !item.is_archived || item.id === current).map(item => `<option value="${escapeHtml(item.id)}" ${item.is_archived ? 'disabled' : ''}>${escapeHtml(item.name)}${item.is_archived ? '（アーカイブ済み・現在値）' : ''}</option>`).join('');
		select.value = current || '';
		select.disabled = !parent;
	}

	renderPointDefaults(config) {
		this.pointDefaultsConfig = config;
		if (this.pointDefaultsDirty || this.savingPointDefaults) return;
		const defaults = config?.point_payment_defaults ?? null;
		this.pointDefaultsOriginal = structuredClone(defaults);
		const parent = document.getElementById('select-point-offset-category');
		parent.innerHTML = '<option value="">未設定</option>' + (config?.categories || []).filter(item => item.type === 'income' && (!item.is_archived || item.id === defaults?.category_id)).map(item => `<option value="${escapeHtml(item.id)}" ${item.is_archived ? 'disabled' : ''}>${escapeHtml(item.name)}${item.is_archived ? '（アーカイブ済み・現在値）' : ''}</option>`).join('');
		parent.value = defaults?.category_id || '';
		this.populatePointDefaultChildren(defaults?.subcategory_id);
	}

	async savePointDefaults() {
		if (this.savingPointDefaults || this.coordinator.isKeyLocked) return;
		const category = document.getElementById('select-point-offset-category').value;
		const requested = category ? { category_id: category, subcategory_id: document.getElementById('select-point-offset-subcategory').value || null } : null;
		const original = structuredClone(this.pointDefaultsOriginal), generation = ++this.pointDefaultsGeneration;
		const valid = captureRenderSession(this.coordinator, () => generation === this.pointDefaultsGeneration);
		this.savingPointDefaults = true;
		this.releasePointDefaults = beginFormBusy(document.getElementById('card-point-payment-defaults'), document.getElementById('btn-save-point-defaults'), '保存中…');
		const errorNode = document.getElementById('point-defaults-error');
		errorNode.textContent = '';
		let committed = false;
		try {
			const config = await this.db.getMasterConfig();
			if (!valid()) return;
			if (canonicalJsonStringify(config.point_payment_defaults ?? null) !== canonicalJsonStringify(original)) throw new Error('ポイント相殺設定が変更されています。画面を開き直して確認してください。');
			if (requested) {
				const parent = config.categories.find(item => item.id === requested.category_id && item.type === 'income' && !item.is_archived);
				if (!parent || (requested.subcategory_id && !parent.subcategories?.some(item => item.id === requested.subcategory_id && !item.is_archived))) throw new Error('有効な収入費目と内訳を選択してください。');
			}
			const saved = await this.db.saveMasterConfig({ ...config, point_payment_defaults: requested }, { expectedConfig: config, isSessionValid: valid });
			committed = true;
			if (!valid()) return;
			this.pointDefaultsOriginal = structuredClone(requested); this.pointDefaultsConfig = saved; this.pointDefaultsDirty = false;
			this.coordinator.txInputController.pointPaymentConfig = saved;
			this.coordinator.txInputController.renderPointOffsetNotice();
			try { await this.coordinator.refreshAfterTransactionChange({ isSessionValid: valid }); }
			catch (error) { if (valid()) errorNode.textContent = `設定は保存済みです。表示を更新できませんでした: ${error.message}`; }
			if (!valid()) return;
			this.coordinator.showToast('ポイント相殺の分類を保存しました。');
			void this.syncManager.queueMasterSync();
		} catch (error) { if (valid()) errorNode.textContent = `${committed ? '設定は保存済みです。' : '設定を保存できませんでした。'}${error.message}`; }
		finally {
			if (generation === this.pointDefaultsGeneration) {
				this.releasePointDefaults(); this.releasePointDefaults = null; this.savingPointDefaults = false;
				if (committed) this.renderPointDefaults(this.pointDefaultsConfig);
			}
		}
	}

	async reloadPointDefaults() {
		if (this.savingPointDefaults || this.coordinator.isKeyLocked) return;
		if (this.pointDefaultsDirty && !confirm('入力中のポイント相殺設定を破棄し、保存済み設定を読み直しますか？')) return;
		const generation = ++this.pointDefaultsGeneration;
		const valid = captureRenderSession(this.coordinator, () => generation === this.pointDefaultsGeneration);
		this.savingPointDefaults = true;
		this.releasePointDefaults = beginFormBusy(document.getElementById('card-point-payment-defaults'), document.getElementById('btn-reload-point-defaults'), '読込中…');
		const errorNode = document.getElementById('point-defaults-error');
		errorNode.textContent = '';
		let loaded = null;
		try {
			const config = await this.db.getMasterConfig();
			if (!valid()) return;
			loaded = config;
			this.pointDefaultsDirty = false;
			this.coordinator.txInputController.pointPaymentConfig = config;
			this.coordinator.txInputController.renderPointOffsetNotice();
		} catch (error) { if (valid()) errorNode.textContent = `設定を読み直せませんでした: ${error.message}`; }
		finally {
			if (generation === this.pointDefaultsGeneration) {
				this.releasePointDefaults(); this.releasePointDefaults = null; this.savingPointDefaults = false;
				if (loaded) this.renderPointDefaults(loaded);
			}
		}
	}

	async renderSettings({ isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid), options = { isSessionValid: valid };
		if (!valid()) return;
		const gasUrlGeneration = this.gasUrlGeneration;
		await this.coordinator.insightsController?.renderMetadata(options);
		if (!valid()) return;
		await this.renderPendingImport(options);
		if (!valid()) return;
		this.authController.updateKeyDisplay();
		const badgeVer = document.getElementById('badge-current-version');
		badgeVer.textContent = `v${CURRENT_APP_VERSION}`;

		// Sync theme radio selection (Requirement 3.24)
		const savedTheme = this.coordinator.currentThemePreference || 'system';
		const themeRadio = document.querySelector(`input[name="theme-preference"][value="${savedTheme}"]`);
		if (themeRadio) themeRadio.checked = true;

		const gasUrl = await readInRenderSession(valid, () => this.db.getSetting('gas_url', ''));
		if (!valid()) return;
		const urlInput = document.getElementById('input-gas-url');
		if ((!this.gasUrlDirty) && (gasUrlGeneration === this.gasUrlGeneration)) urlInput.value = gasUrl;

		const detailsGasUrl = document.getElementById('details-gas-url');
		const badgeGasUrl = document.getElementById('gas-url-status-badge');
		if (gasUrlGeneration === this.gasUrlGeneration) {
			badgeGasUrl.textContent = gasUrl ? '設定済' : '未設定';
			if ((!gasUrl) || (!detailsGasUrl.dataset.userOpened)) detailsGasUrl.toggleAttribute('open', !gasUrl);
		}

		const keyConfiguredBadge = document.getElementById('key-configured-badge');
		const keyConfiguredSummary = document.getElementById('key-configured-summary');
		const keyMgmtDetails = document.getElementById('key-mgmt-details');

		if (this.authController.publicKeyBase64) {
			keyConfiguredBadge.style.display = 'inline-block';
			keyConfiguredSummary.style.display = 'block';
			if (!keyMgmtDetails.dataset.userOpened) keyMgmtDetails.style.display = 'none';
		} else {
			keyConfiguredBadge.style.display = 'none';
			keyConfiguredSummary.style.display = 'none';
			keyMgmtDetails.style.display = 'block';
		}

		const pointDefaultsGeneration = this.pointDefaultsGeneration;
		const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
		if (!valid() || !config) return;
		if (pointDefaultsGeneration === this.pointDefaultsGeneration) this.renderPointDefaults(config);
		this.coordinator.syncStatusController.renderLastResult();
		const info = document.getElementById('master-summary-info');
		const accCount = (config.accounts || []).length;
		const catCount = (config.categories || []).length;
		const ruleCount = (config.recurring_rules || []).length;
		const holidayCount = (config.holidays || []).length;
		info.textContent = `登録数: 口座 ${accCount}件 / 費目 ${catCount}件 / 定期ルール ${ruleCount}件 / 祝日 ${holidayCount}件`;

		const credential = await readInRenderSession(valid, () => this.db.getSecurityKey('webauthn_credential'));
		if (!valid()) return;
		const btnClearWebauthn = document.getElementById('btn-clear-webauthn');
		btnClearWebauthn.style.display = credential ? 'inline-block' : 'none';
		const status = document.getElementById('synced-passkey-status');
		status.textContent = credential?.prfWrap ? 'パスキー登録済み・PIN入力なしで解除可能です' : credential ? '認証用パスキー登録済み・復号にはPINが必要です。PIN省略には対応パスキーを再登録してください。' : 'パスキー未登録・PINで利用可能です';

		await this.coordinator.budgetSettingsController.render(options);
		if (!valid()) return;
		await this.coordinator.masterController.renderMasterManagement(options);
	}

}
