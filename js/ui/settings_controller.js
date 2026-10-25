/**
 * Yoseatsume Kakeibo - Settings & Environment Controller
 * Manages Settings tab, Key Management (3 Subcards), Annual Budgets, Backup Import/Export, and PWA Update.
 */

import { BackupImportController } from './backup_import_controller.js';

import {
	formatDate,
	escapeHtml
} from '../logic.js';
import {
	encryptMasterKeysWithPin,
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
		// Generate new key
		document.getElementById('btn-generate-key')?.addEventListener('click', async () => {
			if (confirm('新しいEd25519鍵ペアを生成しますか？\n（GAS側の USER_PUBLIC_KEYS の更新が必要になります）')) {
				await this.authController.generateNewKeyPair();
			}
		});

		// Copy public key; notify only after the clipboard operation completes.
		document.getElementById('btn-copy-public-key')?.addEventListener('click', async () => {
			const txt = document.getElementById('txt-public-key');
			if (!txt) return;
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
			const pin = pinInput?.value;
			if (!pin || pin.length < 4) {
				alert('PINコードは4桁以上を入力してください');
				return;
			}
			if (!this.db.encryptionKey || !this.authController.privateKey) {
				alert('秘密鍵またはDB暗号化鍵がロードされていません。ロック中の場合は先に解除してください。');
				return;
			}

			const dmk = this.db.encryptionKey, privateKey = this.authController.privateKey;
			const generation = this.authController.authGeneration;
			const valid = () => this.db.encryptionKey === dmk && this.authController.privateKey === privateKey && this.authController.authGeneration === generation;
			let dmkRaw, privPkcs8;
			try {
				dmkRaw = await exportKeyRaw(dmk); privPkcs8 = await exportPrivateKeyPkcs8(privateKey);
				const pkg = await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8: privPkcs8 }, pin);
				await this.db.saveSecurityKey('master_keys_package', pkg, { isSessionValid: valid });
			} catch (error) { alert(`PIN更新に失敗しました: ${error.message}`); return; }
			finally { dmkRaw?.fill(0); privPkcs8?.fill(0); }
			if (pinInput) pinInput.value = '';
			this.authController.updateKeyDisplay();
			alert('PINコードを正常に更新しました！\n秘密鍵およびDB暗号化鍵が新しいPINで保護されました。');
		});

		document.getElementById('btn-lock-now')?.addEventListener('click', async () => {
			await this.authController.lockPrivateKey();
		});

		// Save GAS URL
		document.getElementById('input-gas-url')?.addEventListener('input', () => { this.gasUrlDirty = true; this.gasUrlGeneration++; });
		document.getElementById('btn-save-gas-url')?.addEventListener('click', async () => {
			if (this.savingGasUrl) return;
			const urlInput = document.getElementById('input-gas-url');
			const url = urlInput?.value.trim();
			const generation = this.gasUrlGeneration;
			const button = document.getElementById('btn-save-gas-url');
			this.savingGasUrl = true; button.disabled = true;
			try {
				await this.db.setSetting('gas_url', url);
				this.syncManager.setGasUrl(url);
				if (this.gasUrlGeneration === generation) { this.gasUrlDirty = false; urlInput.value = url; }
				this.gasUrlGeneration++;
				alert('GAS URLを保存しました');
			} catch (error) { alert(`GAS URLを保存できませんでした: ${error.message}`); }
			finally { this.savingGasUrl = false; button.disabled = false; }
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

		// Export Full Backup
		const handleExportFull = async () => {
			const backup = await this.db.exportFullData();
			downloadJsonFile(backup, `yose_backup_${formatDate(new Date())}.json`);
			modalExport?.classList.remove('active');
		};
		document.getElementById('btn-export-backup')?.addEventListener('click', handleExportFull);
		document.getElementById('btn-export-full')?.addEventListener('click', handleExportFull);

		// Export Transactions Only
		document.getElementById('btn-export-transactions')?.addEventListener('click', async () => {
			const data = await this.db.exportTransactionsData();
			downloadJsonFile(data, `yose_transactions_${formatDate(new Date())}.json`);
			modalExport?.classList.remove('active');
		});

		// Export Master Config Only
		document.getElementById('btn-export-master')?.addEventListener('click', async () => {
			const data = await this.db.exportMasterConfigData();
			downloadJsonFile(data, `yose_master_config_${formatDate(new Date())}.json`);
			modalExport?.classList.remove('active');
		});

		// Export Annual Budgets Only
		document.getElementById('btn-export-budgets')?.addEventListener('click', async () => {
			const data = await this.db.exportAnnualBudgetsData();
			downloadJsonFile(data, `yose_annual_budgets_${formatDate(new Date())}.json`);
			modalExport?.classList.remove('active');
		});

		// Export Summary Snapshot Only
		document.getElementById('btn-export-snapshot')?.addEventListener('click', async () => {
			const data = await this.db.exportSummarySnapshotData();
			downloadJsonFile(data, `yose_snapshot_${formatDate(new Date())}.json`);
			modalExport?.classList.remove('active');
		});

		// Import backup trigger
		const fileInput = document.getElementById('file-import-input');
		document.getElementById('btn-import-trigger')?.addEventListener('click', () => {
			fileInput?.click();
		});

		fileInput?.addEventListener('change', async (e) => {
			const file = e.target?.files?.[0];
			if (!file) return;
			try {
				const text = await file.text();
				let data;
				try {
					data = JSON.parse(text);
				} catch (parseErr) {
					throw new Error('不正なJSONファイル形式です: ' + parseErr.message);
				}
				if (document.getElementById('select-import-mode').value === 'replace') {
					await this.backupImportController.preview(data);
					return;
				}
				const res = await this.db.importFullData(data);
				const s = res?.stats || {};
				const typeNames = {
					full_backup: '全データ',
					transactions: '取引明細',
					master_config: 'マスタ設定',
					annual_budgets: '年間予算',
					summary_snapshot: '残高スナップショット'
				};
				const typeLabel = typeNames[res?.detectedType] || 'データ';
				const msg = [
					`【${typeLabel}差分ORマージ完了】`,
					`・明細: 追加 ${s.addedTransactions || 0}件 / 更新 ${s.updatedTransactions || 0}件 / スキップ ${s.skippedTransactions || 0}件`,
					`・口座マスタ: 追加 ${s.addedAccounts || 0}件`,
					`・大項目マスタ: 追加 ${s.addedCategories || 0}件 (内訳中項目: 追加 ${s.addedSubcategories || 0}件)`,
					`・定期ルール: 追加 ${s.addedRecurringRules || 0}件`,
					`・祝日: 新規追加 ${s.addedHolidays || 0}件`,
					`・年間予算: 追加/更新 ${s.addedBudgets || 0}件`
				].join('\n');
				alert(msg);
				await this.coordinator.refreshAllViews();
			} catch (err) {
				alert(`インポート失敗: ${err.message}`);
			} finally {
				if (fileInput) fileInput.value = '';
			}
		});

		// Owner-controlled setup never sends registration requests to the public endpoint.
		document.getElementById('btn-show-gas-key-setup')?.addEventListener('click', () => {
			alert('GASを公開前に、公開鍵をコピーし、GASエディタの「プロジェクトの設定」→「スクリプト プロパティ」で USER_PUBLIC_KEYS に登録してください。鍵の更新もGAS管理画面で行います。');
		});

		// Toggle key details
		document.getElementById('btn-toggle-key-details')?.addEventListener('click', () => {
			const details = document.getElementById('key-mgmt-details');
			if (details) {
				details.dataset.userOpened = 'true';
				details.style.display = details.style.display === 'none' ? 'block' : 'none';
			}
		});

		// Register a verified credential and its optional device-local PRF key wrap together.
		document.getElementById('btn-register-webauthn')?.addEventListener('click', async () => {
			try {
				const supportsUnlock = await this.authController.registerPasskey();
				alert(supportsUnlock ? 'パスキーを登録しました。次回からPINを入力せずに解除できます。' : 'パスキーを登録しました。この環境ではPRFに対応していないため、データの復号にはPINを使用します。');
				await this.renderSettings();
			} catch (error) { alert(`WebAuthn登録エラー: ${error.message}`); }
		});

		// WebAuthn Passkey clear / unregister
		document.getElementById('btn-clear-webauthn')?.addEventListener('click', async () => {
			if (!confirm('登録済みのWebAuthn (Passkey) 連携を解除しますか？\n（解除後もPINコードによるロック解除は継続して利用可能です）')) {
				return;
			}
			try {
				this.authController.authGeneration++;
				await this.db.deleteSecurityKey('webauthn_credential');
				await this.db.deleteSecurityKey('webauthn_vault');
				const config = await this.db.getMasterConfig();
				if (config && config.synced_passkey_bundle) {
					await this.db.mutateMasterConfig(current => { delete current.synced_passkey_bundle; return current; });
				}
				alert('WebAuthn連携を解除しました');
				await this.renderSettings();
			} catch (err) {
				alert(`WebAuthn解除エラー: ${err.message}`);
			}
		});


		// View / Edit Master JSON
		const btnViewMaster = document.getElementById('btn-view-master-json');
		const editor = document.getElementById('master-json-editor');
		const txtMaster = document.getElementById('txt-master-json');
		const btnSaveMaster = document.getElementById('btn-save-master-json');

		btnViewMaster?.addEventListener('click', async () => {
			if (editor.style.display === 'none') {
				const config = await this.db.getMasterConfig();
				this.jsonExpectedConfig = structuredClone(config);
				txtMaster.value = JSON.stringify(config, null, 2);
				editor.style.display = 'block';
			} else {
				editor.style.display = 'none';
			}
		});

		btnSaveMaster?.addEventListener('click', async () => {
			try {
				const config = JSON.parse(txtMaster.value);
				const saved = await this.coordinator.masterController.saveMasterConfigAndSync(config, this.jsonExpectedConfig);
				this.jsonExpectedConfig = structuredClone(saved);
				txtMaster.value = JSON.stringify(saved, null, 2);
				alert('マスタ設定を保存しました');
			} catch (err) {
				alert(`マスタ設定の保存に失敗しました: ${err.message}`);
			}
		});

		// App Version & Forced Update Management
		const badgeVer = document.getElementById('badge-current-version');
		if (badgeVer) badgeVer.textContent = `v${CURRENT_APP_VERSION}`;

		const updateStatus = document.getElementById('update-status-msg');

		document.getElementById('btn-check-app-update')?.addEventListener('click', async () => {
			if (updateStatus) {
				updateStatus.style.display = 'block';
				updateStatus.style.backgroundColor = 'var(--bg-card)';
				updateStatus.style.border = '1px solid var(--border)';
				updateStatus.style.color = 'var(--text-main)';
				updateStatus.textContent = '🔄 サーバー上のバージョンを確認中...';
			}

			if (typeof navigator !== 'undefined' && !navigator.onLine) {
				if (updateStatus) {
					updateStatus.style.backgroundColor = '#fff3cd';
					updateStatus.style.color = '#856404';
					updateStatus.style.border = '1px solid #ffeeba';
					updateStatus.textContent = '⚠️ オフラインのため確認できません。ネットワーク接続を確認してください。';
				}
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
					if (updateStatus) {
						updateStatus.style.backgroundColor = '#d4edda';
						updateStatus.style.color = '#155724';
						updateStatus.style.border = '1px solid #c3e6cb';
						updateStatus.textContent = `🚀 新しいバージョン (v${res.serverVersion}) が利用可能です！`;
					}
					this.coordinator.showUpdateModal(res.serverVersion);
				} else if (res.error) {
					if (updateStatus) {
						updateStatus.style.backgroundColor = '#f8d7da';
						updateStatus.style.color = '#721c24';
						updateStatus.style.border = '1px solid #f5c6cb';
						updateStatus.textContent = `⚠️ バージョン確認エラー: ${res.error}`;
					}
				} else {
					if (updateStatus) {
						updateStatus.style.backgroundColor = '#d4edda';
						updateStatus.style.color = '#155724';
						updateStatus.style.border = '1px solid #c3e6cb';
						updateStatus.textContent = `✅ お使いのアプリは最新バージョン (v${CURRENT_APP_VERSION}) です。`;
					}
				}
			} catch (err) {
				if (updateStatus) {
					updateStatus.style.backgroundColor = '#f8d7da';
					updateStatus.style.color = '#721c24';
					updateStatus.style.border = '1px solid #f5c6cb';
					updateStatus.textContent = `⚠️ 通信エラー: ${err.message}`;
				}
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
					location: typeof window !== 'undefined' ? window.location : null
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
				location: typeof window !== 'undefined' ? window.location : null
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

	async renderPendingImport() {
		await this.backupImportController.renderPending();
	}

	async renderSettings() {
		const gasUrlGeneration = this.gasUrlGeneration;
		await this.coordinator.insightsController?.renderMetadata();
		await this.renderPendingImport();
		this.authController.updateKeyDisplay();
		const badgeVer = document.getElementById('badge-current-version');
		if (badgeVer) badgeVer.textContent = `v${CURRENT_APP_VERSION}`;

		// Sync theme radio selection (Requirement 3.24)
		const savedTheme = this.coordinator.currentThemePreference || 'system';
		const themeRadio = document.querySelector(`input[name="theme-preference"][value="${savedTheme}"]`);
		if (themeRadio) themeRadio.checked = true;

		const gasUrl = await this.db.getSetting('gas_url', '');
		const urlInput = document.getElementById('input-gas-url');
		if (urlInput && !this.gasUrlDirty && gasUrlGeneration === this.gasUrlGeneration) urlInput.value = gasUrl;

		const detailsGasUrl = document.getElementById('details-gas-url');
		const badgeGasUrl = document.getElementById('gas-url-status-badge');
		if (gasUrlGeneration === this.gasUrlGeneration) {
			if (badgeGasUrl) badgeGasUrl.textContent = gasUrl ? '設定済' : '未設定';
			if (detailsGasUrl && (!gasUrl || !detailsGasUrl.dataset.userOpened)) detailsGasUrl.toggleAttribute('open', !gasUrl);
		}

		const keyConfiguredBadge = document.getElementById('key-configured-badge');
		const keyConfiguredSummary = document.getElementById('key-configured-summary');
		const keyMgmtDetails = document.getElementById('key-mgmt-details');

		if (this.authController.publicKeyBase64) {
			if (keyConfiguredBadge) keyConfiguredBadge.style.display = 'inline-block';
			if (keyConfiguredSummary) keyConfiguredSummary.style.display = 'block';
			if (keyMgmtDetails && !keyMgmtDetails.dataset.userOpened) keyMgmtDetails.style.display = 'none';
		} else {
			if (keyConfiguredBadge) keyConfiguredBadge.style.display = 'none';
			if (keyConfiguredSummary) keyConfiguredSummary.style.display = 'none';
			if (keyMgmtDetails) keyMgmtDetails.style.display = 'block';
		}

		const config = await this.db.getMasterConfig();
		const info = document.getElementById('master-summary-info');
		if (info && config) {
			const accCount = (config.accounts || []).length;
			const catCount = (config.categories || []).length;
			const ruleCount = (config.recurring_rules || []).length;
			const holidayCount = (config.holidays || []).length;
			info.textContent = `登録数: 口座 ${accCount}件 / 費目 ${catCount}件 / 定期ルール ${ruleCount}件 / 祝日 ${holidayCount}件`;
		}

		const credential = await this.db.getSecurityKey('webauthn_credential');
		const btnClearWebauthn = document.getElementById('btn-clear-webauthn');
		if (btnClearWebauthn) btnClearWebauthn.style.display = credential ? 'inline-block' : 'none';
		const status = document.getElementById('synced-passkey-status');
		if (status) status.textContent = credential?.prfWrap ? 'パスキー登録済み・PIN入力なしで解除可能です' : credential ? '認証用パスキー登録済み・復号にはPINが必要です。PIN省略には対応パスキーを再登録してください。' : 'パスキー未登録・PINで利用可能です';

		await this.coordinator.budgetSettingsController.render();
		await this.coordinator.masterController.renderMasterManagement();
	}

}
