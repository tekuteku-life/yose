/**
 * Yoseatsume Kakeibo - Settings & Environment Controller
 * Manages Settings tab, Key Management (3 Subcards), Annual Budgets, Backup Import/Export, and PWA Update.
 */

import { BackupImportController } from './backup_import_controller.js';

import {
	formatDate,
	aggregateMonthlySummaries,
	calculateAnnualBudgetDefaults,
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

		// Copy public key
		document.getElementById('btn-copy-public-key')?.addEventListener('click', () => {
			const txt = document.getElementById('txt-public-key');
			if (txt) {
				txt.select();
				if (navigator.clipboard) {
					navigator.clipboard.writeText(txt.value);
					alert('公開鍵をクリップボードにコピーしました！');
				}
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

		// One-click register key to GAS
		const registerInitialKeyHandler = async () => {
			try {
				await this.authController.ensureKeyUnlocked();
				const gasUrl = await this.db.getSetting('gas_url', '');
				if (!gasUrl) {
					alert('先にGAS Web App URLを設定・保存してください');
					return;
				}
				if (!this.authController.publicKeyBase64) {
					alert('公開鍵が生成されていません');
					return;
				}
				const res = await this.syncManager.registerInitialKey(this.authController.publicKeyBase64);
				alert(`GASへ公開鍵を登録しました！\n${res.message || '登録成功'}`);
				await this.renderSettings();
			} catch (err) {
				alert(`公開鍵登録エラー: ${err.message}`);
			}
		};
		document.getElementById('btn-register-key-gas-direct')?.addEventListener('click', registerInitialKeyHandler);

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

		// Annual Budget settings (Requirement 3.14)
		const inputBudgetYear = document.getElementById('setting-budget-year');
		const inputExpBudget = document.getElementById('setting-expense-budget');
		const inputSavTarget = document.getElementById('setting-savings-target-amount');
		const inputSavRate = document.getElementById('setting-savings-target-rate');
		const previewDiv = document.getElementById('budget-monthly-preview');

		const updateMonthlyPreview = () => {
			if (!previewDiv) return;
			const exp = Number(inputExpBudget?.value) || 0;
			const sav = Number(inputSavTarget?.value) || 0;
			const mExp = Math.round(exp / 12);
			const mSav = Math.round(sav / 12);
			previewDiv.textContent = `月平均目安: 支出予算 ¥${mExp.toLocaleString()} / 目標貯蓄 ¥${mSav.toLocaleString()}`;
		};

		inputExpBudget?.addEventListener('input', () => {
			updateMonthlyPreview();
			this.updateCategoryBudgetDiscrepancy();
		});
		inputSavTarget?.addEventListener('input', updateMonthlyPreview);

		inputBudgetYear?.addEventListener('change', async () => {
			await this.renderAnnualBudgetSettings();
		});

		// Realtime Category Search Filter in Settings (Requirement 3.14 Scalable UI)
		document.getElementById('input-budget-cat-search')?.addEventListener('input', (e) => {
			const query = (e.target.value || '').trim().toLowerCase();
			document.querySelectorAll('.budget-cat-item').forEach(item => {
				const name = (item.dataset.catName || '').toLowerCase();
				item.style.display = (!query || name.includes(query)) ? 'flex' : 'none';
			});
		});

		// Dynamic Category Budget input change
		document.getElementById('budget-categories-list-container')?.addEventListener('input', (e) => {
			if (e.target.classList.contains('input-cat-budget')) {
				const val = Number(e.target.value) || 0;
				const hint = e.target.closest('.budget-cat-item')?.querySelector('.cat-monthly-hint');
				if (hint) {
					const mVal = val > 0 ? Math.round(val / 12) : 0;
					hint.textContent = mVal > 0 ? `¥${mVal.toLocaleString()}/月` : '-';
				}
				this.updateCategoryBudgetDiscrepancy();
			}
		});

		// Auto-calculate budget defaults from previous year actuals (Requirement 3.14)
		document.getElementById('btn-budget-auto-calc')?.addEventListener('click', async () => {
			const year = inputBudgetYear?.value.trim() || this.coordinator.selectedYear || String(new Date().getFullYear());
			const config = await this.db.getMasterConfig();
			const snapshot = await this.db.getSnapshot();
			const allTransactions = await this.db.getTransactions({ includeDeleted: false });
			const prevYearStr = String(Number(year) - 1);
			const prevYearMonthly = aggregateMonthlySummaries(allTransactions, prevYearStr, snapshot?.monthly_summaries || {});

			const prevYearSummary = {
				income: prevYearMonthly.total_income,
				expense: prevYearMonthly.total_expense,
				net: prevYearMonthly.total_net,
				savings_rate: prevYearMonthly.total_income > 0 ? Math.round((prevYearMonthly.total_net / prevYearMonthly.total_income) * 100) : 0
			};

			const defaults = calculateAnnualBudgetDefaults({
				previousYearSummary: prevYearSummary,
				pastTransactions: allTransactions,
				categories: config?.categories || [],
				targetYear: year
			});

			if (inputExpBudget) inputExpBudget.value = defaults.expense_budget || '';
			if (inputSavTarget) inputSavTarget.value = defaults.savings_target_amount || '';
			if (inputSavRate) inputSavRate.value = defaults.savings_target_rate || '';

			document.querySelectorAll('.input-cat-budget').forEach(input => {
				const catId = input.dataset.catId;
				const defAmt = defaults.category_budgets[catId] || 0;
				input.value = defAmt > 0 ? defAmt : '';
				const hint = input.parentElement?.querySelector('.cat-monthly-hint');
				if (hint) {
					const mVal = defAmt > 0 ? Math.round(defAmt / 12) : 0;
					hint.textContent = mVal > 0 ? `¥${mVal.toLocaleString()}/月` : '-';
				}
			});

			updateMonthlyPreview();
			this.updateCategoryBudgetDiscrepancy();
			alert(`${prevYearStr}年の実績を元に、軽く丸めた推奨予算値を試算・反映しました！\n内容を確認・調整の上、「年間予算・費目別目標を保存」ボタンを押してください。`);
		});

		document.getElementById('btn-save-annual-budget')?.addEventListener('click', async () => {
			if (this.savingBudget) return;
			this.savingBudget = true;
			try {
				const year = inputBudgetYear?.value.trim() || this.coordinator.selectedYear;
				if (!year || year.length !== 4) {
					alert('有効な対象年（4桁）を入力してください');
					return;
				}
				const exp = Number(inputExpBudget?.value) || 0;
				const sav = Number(inputSavTarget?.value) || 0;
				const rate = Number(inputSavRate?.value) || 0;

				const baseline = this.budgetExpectedConfig || await this.db.getMasterConfig();
				const category_budgets = { ...(baseline.annual_budgets?.[year]?.category_budgets || {}) };
				document.querySelectorAll('.input-cat-budget').forEach(input => {
					const catId = input.dataset.catId;
					const val = Number(input.value) || 0;
					if (val > 0) {
						category_budgets[catId] = val;
					} else delete category_budgets[catId];
				});

				const candidate = structuredClone(baseline);
				candidate.annual_budgets ||= {};
				candidate.annual_budgets[year] = {
					...(baseline.annual_budgets?.[year] || {}),
					expense_budget: exp,
					savings_target_amount: sav,
					savings_target_rate: rate,
					target_savings_rate: rate,
					category_budgets
				};
				await this.db.saveMasterConfig(candidate, { expectedConfig: baseline });
				alert(`${year}年の年間予算・費目別目標を保存しました！`);
				await this.coordinator.refreshAllViews();
				void this.syncManager.queueMasterSync();
			} catch (error) { alert(`年間予算の保存に失敗しました: ${error.message}`); }
			finally { this.savingBudget = false; }
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

		await this.renderAnnualBudgetSettings();
		await this.coordinator.masterController.renderMasterManagement();
	}

	async renderAnnualBudgetSettings() {
		const inputBudgetYear = document.getElementById('setting-budget-year');
		const inputExpBudget = document.getElementById('setting-expense-budget');
		const inputSavTarget = document.getElementById('setting-savings-target-amount');
		const inputSavRate = document.getElementById('setting-savings-target-rate');
		const previewDiv = document.getElementById('budget-monthly-preview');
		const catContainer = document.getElementById('budget-categories-list-container');

		if (!inputBudgetYear) return;

		const currentYear = inputBudgetYear.value.trim() || this.coordinator.selectedYear || String(new Date().getFullYear());
		inputBudgetYear.value = currentYear;

		const config = await this.db.getMasterConfig();
		this.budgetExpectedConfig = structuredClone(config);
		const budget = config?.annual_budgets?.[currentYear] || {};
		if (inputExpBudget) inputExpBudget.value = budget?.expense_budget || '';
		if (inputSavTarget) inputSavTarget.value = budget?.savings_target_amount || '';
		if (inputSavRate) inputSavRate.value = budget?.savings_target_rate ?? budget?.target_savings_rate ?? '';

		if (previewDiv) {
			const exp = Number(budget?.expense_budget) || 0;
			const sav = Number(budget?.savings_target_amount) || 0;
			const mExp = Math.round(exp / 12);
			const mSav = Math.round(sav / 12);
			previewDiv.textContent = `月平均目安: 支出予算 ¥${mExp.toLocaleString()} / 目標貯蓄 ¥${mSav.toLocaleString()}`;
		}

		// Calculate previous year actuals per category
		const categories = (config?.categories || []).filter(c => !c.is_archived && (!c.type || c.type === 'expense'));
		const prevYearStr = String(Number(currentYear) - 1);
		const snapshot = await this.db.getSnapshot();
		const allTransactions = await this.db.getTransactions({ includeDeleted: false });
		const prevYearMonthly = aggregateMonthlySummaries(allTransactions, prevYearStr, snapshot?.monthly_summaries || {});
		const prevYearCatActuals = {};
		for (const m of Object.values(prevYearMonthly.months)) {
			if (m.by_category) {
				for (const [cId, val] of Object.entries(m.by_category)) {
					const amt = typeof val === 'object' ? Number(val.total || 0) : Number(val || 0);
					prevYearCatActuals[cId] = (prevYearCatActuals[cId] || 0) + amt;
				}
			}
		}

		// Render category budget rows
		if (catContainer) {
			if (categories.length === 0) {
				catContainer.innerHTML = '<div style="padding: 8px; color: var(--text-muted); font-size: 0.85rem;">費目が登録されていません</div>';
			} else {
				const savedCatBudgets = budget?.category_budgets || {};
				catContainer.innerHTML = categories.map(cat => {
					const prevAmt = prevYearCatActuals[cat.id] || 0;
					const savedVal = savedCatBudgets[cat.id] !== undefined ? savedCatBudgets[cat.id] : '';
					const monthlyVal = savedVal !== '' ? Math.round(Number(savedVal) / 12) : 0;
					return `
						<div class="budget-cat-item" data-cat-id="${escapeHtml(cat.id)}" data-cat-name="${escapeHtml(cat.name)}">
							<div style="flex: 2; min-width: 140px;">
								<div style="font-weight: 600; font-size: 0.9rem;">
									${escapeHtml(cat.icon || '🏷️')} ${escapeHtml(cat.name)}
								</div>
								<div style="font-size: 0.75rem; color: var(--text-muted);">
									前年実績(${prevYearStr}年): ¥${prevAmt.toLocaleString()}
								</div>
							</div>
							<div style="flex: 2; min-width: 160px; display: flex; align-items: center; gap: 6px;">
								<input type="number"
									class="form-control form-control-sm input-cat-budget"
									data-cat-id="${escapeHtml(cat.id)}"
									value="${savedVal !== '' ? savedVal : ''}"
									min="0" step="1000" placeholder="0">
								<span style="font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; min-width: 65px;" class="cat-monthly-hint">
									${monthlyVal > 0 ? `¥${monthlyVal.toLocaleString()}/月` : '-'}
								</span>
							</div>
						</div>
					`;
				}).join('');
			}
		}

		this.updateCategoryBudgetDiscrepancy();
	}

	updateCategoryBudgetDiscrepancy() {
		const inputExpBudget = document.getElementById('setting-expense-budget');
		const discrepancyEl = document.getElementById('budget-category-discrepancy');
		if (!discrepancyEl) return;

		let totalCat = 0;
		document.querySelectorAll('.input-cat-budget').forEach(input => {
			totalCat += Number(input.value) || 0;
		});

		const overallExp = Number(inputExpBudget?.value) || 0;
		const diff = overallExp - totalCat;

		let diffText = '';
		if (overallExp > 0) {
			if (diff === 0) {
				diffText = ` <span style="color: #10b981;">(全体予算と完全一致 ✅)</span>`;
			} else if (diff > 0) {
				diffText = ` <span style="color: #3b82f6;">(全体予算まで残り ¥${diff.toLocaleString()})</span>`;
			} else {
				diffText = ` <span style="color: var(--danger);">(全体予算を超過 +¥${Math.abs(diff).toLocaleString()})</span>`;
			}
		}

		discrepancyEl.innerHTML = `内訳合計: ¥${totalCat.toLocaleString()}${diffText}`;
	}
}

