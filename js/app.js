/**
 * Yoseatsume Kakeibo - Main Application Controller
 */

import { YoseDB } from './db.js';
import {
  formatDate,
  addMonthsToMonthStr,
  calculateTax,
  generateRecurringTransactions,
  createPrepaidAmortizationTransactions,
  createAdvancePaymentTransactions,
  createAdvanceRepaymentTransaction,
  createPointPaymentTransactions,
  calculateBalancesAndSummaries,
  calculateTotalAssetSummary,
  aggregateDailySummaries,
  aggregateMonthlySummaries,
  aggregateYearlySummaries,
  JAPANESE_HOLIDAYS_PRESET,
  parseHolidayTextOrCsv,
  groupHolidaysByYear,
  escapeHtml
} from './logic.js';
import {
  generateEd25519KeyPair,
  exportPublicKeyBase64,
  importPublicKeyBase64,
  exportPrivateKeyPkcs8,
  importPrivateKeyPkcs8,
  encryptPrivateKeyWithPin,
  decryptPrivateKeyWithPin,
  generateDatabaseMasterKey,
  exportKeyRaw,
  importAesKeyRaw,
  encryptObject,
  decryptObject,
  encryptMasterKeysWithPin,
  decryptMasterKeysWithPin,
  isWebAuthnSupported,
  registerWebAuthnCredential,
  authenticateWithWebAuthn,
  setActiveSession,
  getActiveSession,
  hasActiveSession,
  clearActiveSession,
  bytesToBase64,
  base64ToBytes
} from './crypto.js';
import { SyncManager } from './sync.js';

class AppController {
  constructor() {
    this.db = new YoseDB();
    this.syncManager = null;
    this.currentMonth = formatDate(new Date()).slice(0, 7);
    this.selectedYear = String(new Date().getFullYear());
    this.currentMode = 'normal';
    this.analyticsTarget = 'cashflow'; // 'cashflow' | 'assets'
    this.analyticsGranularity = 'monthly'; // 'daily' | 'monthly' | 'yearly'
    this.showPlanned = true;
    this.useActualCategoryAxis = false;
    this.currentTaxMeta = null;
    this.chart = null;

    this.privateKey = null;
    this.publicKey = null;
    this.publicKeyBase64 = '';
    this.isKeyProtectedWithPin = false;
    this.isKeyLocked = false;
  }

  async init() {
    // 1. Initialize Database
    await this.db.init();

    // 2. Setup Security Keys & Auth Gate
    await this.initSecurityAndAuthGate();
  }

  async initSecurityAndAuthGate() {
    const authScreen = document.getElementById('auth-screen');
    const authTitle = document.getElementById('auth-title');
    const authDesc = document.getElementById('auth-description');
    const webauthnContainer = document.getElementById('auth-webauthn-container');
    const pinContainer = document.getElementById('auth-pin-container');
    const setupContainer = document.getElementById('auth-setup-container');
    const errorMsg = document.getElementById('auth-error-msg');

    const masterPkg = await this.db.getSecurityKey('master_keys_package');
    const webauthnId = await this.db.getSecurityKey('webauthn_credential_id');
    const storedPub = await this.db.getSecurityKey('public_key_base64');
    if (storedPub) {
      this.publicKeyBase64 = storedPub;
      try {
        this.publicKey = await importPublicKeyBase64(storedPub);
      } catch (e) {}
    }

    if (!masterPkg) {
      // First Time Setup Mode
      if (authScreen) authScreen.classList.remove('hidden');
      if (authTitle) authTitle.textContent = 'よせあつめ家計簿 - 初期設定';
      if (authDesc) authDesc.innerHTML = '安全のため、すべてのデータは端末内でAES-GCM-256暗号化されます。<br>保護用のPINコード（4桁以上）を設定してください。';
      if (webauthnContainer) webauthnContainer.style.display = 'none';
      if (pinContainer) pinContainer.style.display = 'none';
      if (setupContainer) setupContainer.style.display = 'block';

      document.getElementById('btn-auth-setup')?.addEventListener('click', async () => {
        const pinInput = document.getElementById('auth-setup-pin');
        const pin = pinInput?.value?.trim();
        if (!pin || pin.length < 4) {
          if (errorMsg) {
            errorMsg.textContent = 'PINコードは4桁以上を入力してください';
            errorMsg.style.display = 'block';
          }
          return;
        }

        try {
          if (errorMsg) errorMsg.style.display = 'none';
          // 1. Generate DMK
          const dmk = await generateDatabaseMasterKey();
          // 2. Generate Ed25519
          const kp = await generateEd25519KeyPair();
          this.publicKey = kp.publicKey;
          this.publicKeyBase64 = await exportPublicKeyBase64(kp.publicKey);
          await this.db.saveSecurityKey('public_key_base64', this.publicKeyBase64);

          // 3. Register WebAuthn if supported
          let credentialId = null;
          if (isWebAuthnSupported()) {
            try {
              const cred = await registerWebAuthnCredential('よせあつめ家計簿 ユーザー');
              credentialId = cred.credentialId;
              await this.db.saveSecurityKey('webauthn_credential_id', credentialId);
            } catch (wErr) {
              console.warn('WebAuthn setup skipped or failed:', wErr);
            }
          }

          // 4. Wrap with PIN
          const dmkRaw = await exportKeyRaw(dmk);
          const privPkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);
          const pkg = await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8: privPkcs8 }, pin);
          await this.db.saveSecurityKey('master_keys_package', pkg);

          if (credentialId) {
            await this.db.saveSecurityKey('webauthn_vault', {
              dmk: bytesToBase64(dmkRaw),
              priv: bytesToBase64(privPkcs8)
            });
          }

          // 5. Activate keys in memory & DB
          this.db.setEncryptionKey(dmk);
          this.privateKey = kp.privateKey;
          this.isKeyProtectedWithPin = true;
          this.isKeyLocked = false;
          setActiveSession({ dmk, privateKey: kp.privateKey, publicKey: kp.publicKey, credentialId });

          // Re-save initial master config and snapshot under encryption key
          const currentConfig = await this.db.getMasterConfig();
          await this.db.saveMasterConfig(currentConfig);
          const currentSnapshot = await this.db.getSnapshot();
          await this.db.saveSnapshot(currentSnapshot);

          // 6. Complete initial setup
          if (authScreen) authScreen.classList.add('hidden');
          await this.finishAppInit();
        } catch (setupErr) {
          if (errorMsg) {
            errorMsg.textContent = `初期化エラー: ${setupErr.message}`;
            errorMsg.style.display = 'block';
          }
        }
      });
      return;
    }

    // Existing Key - Lock Screen Mode
    this.isKeyProtectedWithPin = true;
    this.isKeyLocked = true;
    if (authScreen) authScreen.classList.remove('hidden');
    if (authTitle) authTitle.textContent = '🔐 よせあつめ家計簿';
    if (authDesc) authDesc.innerHTML = '安全のためデータは暗号化されています。<br>生体認証（Passkey）またはPINで解除してください。';
    if (setupContainer) setupContainer.style.display = 'none';
    if (pinContainer) pinContainer.style.display = 'block';

    const hasWebAuthn = Boolean(webauthnId && isWebAuthnSupported());
    if (webauthnContainer) {
      webauthnContainer.style.display = hasWebAuthn ? 'block' : 'none';
    }

    const attemptWebAuthnUnlock = async () => {
      if (!hasWebAuthn) return;
      try {
        if (errorMsg) errorMsg.style.display = 'none';
        const res = await authenticateWithWebAuthn(webauthnId);
        if (res.success) {
          const vault = await this.db.getSecurityKey('webauthn_vault');
          if (vault) {
            const dmk = await importAesKeyRaw(base64ToBytes(vault.dmk));
            const priv = await importPrivateKeyPkcs8(base64ToBytes(vault.priv));
            this.db.setEncryptionKey(dmk);
            this.privateKey = priv;
            this.isKeyLocked = false;
            setActiveSession({ dmk, privateKey: priv, publicKey: this.publicKey, credentialId: webauthnId });
            if (authScreen) authScreen.classList.add('hidden');
            await this.finishAppInit();
            return;
          }
        }
      } catch (authErr) {
        console.warn('WebAuthn authentication failed or was cancelled:', authErr);
        if (errorMsg) {
          errorMsg.textContent = '生体認証がキャンセルされたか失敗しました。PINで解除してください。';
          errorMsg.style.display = 'block';
        }
      }
    };

    document.getElementById('btn-auth-webauthn')?.addEventListener('click', attemptWebAuthnUnlock);

    const attemptPinUnlock = async () => {
      const pinInput = document.getElementById('auth-pin-input');
      const pin = pinInput?.value?.trim();
      if (!pin) {
        if (errorMsg) {
          errorMsg.textContent = 'PINコードを入力してください';
          errorMsg.style.display = 'block';
        }
        return;
      }

      try {
        if (errorMsg) errorMsg.style.display = 'none';
        const { dmkRaw, privateKeyPkcs8 } = await decryptMasterKeysWithPin(masterPkg, pin);
        const dmk = await importAesKeyRaw(dmkRaw);
        const priv = await importPrivateKeyPkcs8(privateKeyPkcs8);
        this.db.setEncryptionKey(dmk);
        this.privateKey = priv;
        this.isKeyLocked = false;
        setActiveSession({ dmk, privateKey: priv, publicKey: this.publicKey });
        if (pinInput) pinInput.value = '';
        if (authScreen) authScreen.classList.add('hidden');
        await this.finishAppInit();
      } catch (err) {
        if (errorMsg) {
          errorMsg.textContent = 'PINコードが正しくありません';
          errorMsg.style.display = 'block';
        }
      }
    };

    document.getElementById('btn-auth-pin')?.addEventListener('click', attemptPinUnlock);
    document.getElementById('auth-pin-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') attemptPinUnlock();
    });

    if (hasWebAuthn) {
      setTimeout(() => { attemptWebAuthnUnlock(); }, 300);
    }
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
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('SW registration failed:', err);
      });
    }

    // 5. Setup DOM & Event Handlers
    this.setupNavigation();
    this.setupInputForm();
    this.setupTaxModal();
    this.setupEditTransactionModal();
    this.setupSummaryView();
    this.setupSettingsView();
    this.setupMasterTabs();
    this.updateNetworkBadge();

    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        clearActiveSession();
        this.db.clearEncryptionKey();
      });
    }

    // 6. Initial Render
    await this.refreshAllViews();
  }

  async generateNewKeyPair() {
    try {
      const kp = await generateEd25519KeyPair();
      this.privateKey = kp.privateKey;
      this.publicKey = kp.publicKey;
      this.publicKeyBase64 = await exportPublicKeyBase64(kp.publicKey);

      await this.db.saveSecurityKey('public_key_base64', this.publicKeyBase64);
      this.isKeyLocked = false;

      if (this.syncManager) {
        this.syncManager.setPrivateKey(this.privateKey);
      }
      this.updateKeyDisplay();
    } catch (err) {
      console.warn('Failed to generate Ed25519 key pair:', err);
    }
  }

  updateKeyDisplay() {
    const txtPub = document.getElementById('txt-public-key');
    if (txtPub) {
      txtPub.value = this.publicKeyBase64 || '';
    }

    const banner = document.getElementById('pin-status-banner');
    const btnUnlock = document.getElementById('btn-unlock-pin');
    const btnLock = document.getElementById('btn-lock-now');
    const btnRemove = document.getElementById('btn-remove-pin');
    const inputPin = document.getElementById('input-pin');

    if (banner) {
      if (this.isKeyProtectedWithPin) {
        if (this.isKeyLocked) {
          banner.className = 'security-banner locked';
          banner.innerHTML = `<span>🔒 <strong>秘密鍵はPINで保護されています（現在ロック中）</strong></span>`;
          if (btnUnlock) btnUnlock.style.display = 'inline-block';
          if (btnLock) btnLock.style.display = 'none';
          if (btnRemove) btnRemove.style.display = 'inline-block';
          if (inputPin) inputPin.placeholder = '新しいPINを設定する場合に入力';
        } else {
          banner.className = 'security-banner unlocked';
          banner.innerHTML = `<span>🔓 <strong>秘密鍵のロック解除中（署名・同期可能）</strong></span>`;
          if (btnUnlock) btnUnlock.style.display = 'none';
          if (btnLock) btnLock.style.display = 'inline-block';
          if (btnRemove) btnRemove.style.display = 'inline-block';
          if (inputPin) inputPin.placeholder = '新しいPINに変更する場合に入力';
        }
      } else {
        banner.className = 'security-banner unprotected';
        banner.innerHTML = `<span>⚠️ 秘密鍵は現在PIN保護されていません（端末内に平文保存）</span>`;
        if (btnUnlock) btnUnlock.style.display = 'none';
        if (btnLock) btnLock.style.display = 'none';
        if (btnRemove) btnRemove.style.display = 'none';
        if (inputPin) inputPin.placeholder = 'PINコード (4桁以上)';
      }
    }
  }

  async promptPinUnlock() {
    return new Promise((resolve) => {
      const modal = document.getElementById('modal-pin-unlock');
      const input = document.getElementById('input-unlock-pin');
      const btnSubmit = document.getElementById('btn-submit-unlock-pin');
      const btnClose = document.getElementById('btn-close-pin-modal');
      if (!modal || !input) {
        resolve(false);
        return;
      }

      modal.classList.add('active');
      input.value = '';
      setTimeout(() => input.focus(), 50);

      const cleanup = () => {
        modal.classList.remove('active');
        btnSubmit?.removeEventListener('click', onSubmit);
        btnClose?.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKey);
      };

      const onSubmit = async () => {
        const pin = input.value;
        if (!pin) {
          alert('PINコードを入力してください');
          return;
        }
        try {
          const masterPkg = await this.db.getSecurityKey('master_keys_package');
          if (masterPkg) {
            const { dmkRaw, privateKeyPkcs8 } = await decryptMasterKeysWithPin(masterPkg, pin);
            const dmk = await importAesKeyRaw(dmkRaw);
            const privKey = await importPrivateKeyPkcs8(privateKeyPkcs8);
            this.db.setEncryptionKey(dmk);
            this.privateKey = privKey;
            this.isKeyLocked = false;
            setActiveSession({ dmk, privateKey: privKey, publicKey: this.publicKey });
          } else {
            const enc = await this.db.getSecurityKey('encrypted_private_key');
            if (!enc) throw new Error('暗号化された秘密鍵が見つかりません');
            const privKey = await decryptPrivateKeyWithPin(enc, pin);
            this.privateKey = privKey;
            this.isKeyLocked = false;
          }

          if (this.syncManager) {
            this.syncManager.setPrivateKey(this.privateKey);
          }
          this.updateKeyDisplay();
          cleanup();
          resolve(true);
        } catch (err) {
          alert('PINコードが正しくありません。再試行してください。');
        }
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      const onKey = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onSubmit();
        }
      };

      btnSubmit?.addEventListener('click', onSubmit);
      btnClose?.addEventListener('click', onCancel);
      input.addEventListener('keydown', onKey);
    });
  }

  async ensureKeyUnlocked() {
    if (!this.isKeyProtectedWithPin || !this.isKeyLocked) {
      return true;
    }
    const unlocked = await this.promptPinUnlock();
    if (!unlocked) {
      throw new Error('秘密鍵がロックされています。処理を続行するにはPINでロック解除してください。');
    }
    return true;
  }

  async lockPrivateKey() {
    this.privateKey = null;
    this.isKeyLocked = true;
    this.db.clearEncryptionKey();
    clearActiveSession();
    if (this.syncManager) {
      this.syncManager.setPrivateKey(null);
    }
    this.updateKeyDisplay();
    document.getElementById('auth-screen')?.classList.remove('hidden');
    alert('秘密鍵およびDB暗号化セッションをロックしました');
  }

  async removePinProtection() {
    if (!this.isKeyProtectedWithPin) return;
    const pin = prompt('現在のPINコードを入力してください（PIN保護を解除します）:');
    if (!pin) return;
    try {
      const enc = await this.db.getSecurityKey('encrypted_private_key');
      const privKey = await decryptPrivateKeyWithPin(enc, pin);
      this.privateKey = privKey;
      const pkcs8 = await exportPrivateKeyPkcs8(privKey);
      await this.db.saveSecurityKey('private_key_pkcs8', Array.from(pkcs8));
      await this.db.deleteSecurityKey('encrypted_private_key');
      this.isKeyProtectedWithPin = false;
      this.isKeyLocked = false;
      if (this.syncManager) {
        this.syncManager.setPrivateKey(this.privateKey);
      }
      this.updateKeyDisplay();
      alert('PIN保護を解除しました。秘密鍵はローカル端末内に直接保存されます。');
    } catch (err) {
      alert('PINコードが正しくありません');
    }
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
          this.renderSummary();
        } else if (targetId === 'tab-settings') {
          this.renderSettings();
        }
      });
    });

    // Header sync button
    const btnHeaderSync = document.getElementById('btn-header-sync');
    if (btnHeaderSync) {
      btnHeaderSync.addEventListener('click', async () => {
        await this.handleManualSync();
      });
    }

    // Network status listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.updateNetworkBadge());
      window.addEventListener('offline', () => this.updateNetworkBadge());
    }
  }

  updateNetworkBadge() {
    const badge = document.getElementById('network-badge');
    if (!badge) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      badge.textContent = 'Offline';
      badge.className = 'badge badge-danger';
    } else {
      badge.textContent = 'Online';
      badge.className = 'badge badge-success';
    }
  }

  async updateSyncBadge() {
    const badge = document.getElementById('sync-badge');
    if (!badge) return;
    const unsynced = await this.db.getUnsyncedTransactions();
    const count = unsynced ? unsynced.length : 0;
    if (count === 0) {
      badge.textContent = '同期済';
      badge.className = 'badge badge-success';
    } else {
      badge.textContent = `未同期: ${count}件`;
      badge.className = 'badge badge-info';
    }
  }

  setupInputForm() {
    const inputDate = document.getElementById('input-date');
    if (inputDate) {
      inputDate.value = formatDate(new Date());
    }

    // Mode buttons
    const modeBtns = document.querySelectorAll('.mode-tab-btn');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchInputMode(btn.dataset.mode);
      });
    });

    // Type change
    const typeSelect = document.getElementById('input-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        const val = typeSelect.value;
        if (['advance', 'repay', 'prepaid', 'point'].includes(val)) {
          this.switchInputMode(val);
        } else {
          this.switchInputMode('normal');
          this.updateFormFieldsForType(val);
        }
      });
    }

    // Point dynamic calculation
    const inputPointTotal = document.getElementById('input-point-total');
    const inputPointUsed = document.getElementById('input-point-used');
    const updatePointDisplay = () => {
      const total = Number(inputPointTotal?.value) || 0;
      const used = Number(inputPointUsed?.value) || 0;
      const self = Math.max(0, total - used);
      const disp = document.getElementById('display-point-self-amount');
      if (disp) disp.textContent = `¥${self.toLocaleString()}`;
    };
    inputPointTotal?.addEventListener('input', updatePointDisplay);
    inputPointUsed?.addEventListener('input', updatePointDisplay);

    // Mirror category checkbox
    const chkSync = document.getElementById('chk-sync-actual-category');
    const actContainer = document.getElementById('actual-category-container');
    if (chkSync && actContainer) {
      chkSync.addEventListener('change', () => {
        actContainer.style.display = chkSync.checked ? 'none' : 'block';
      });
    }

    // Category change updates subcategories
    const catSelect = document.getElementById('select-category');
    if (catSelect) {
      catSelect.addEventListener('change', () => {
        this.updateSubcategories(catSelect.value, 'select-subcategory');
      });
    }

    const actCatSelect = document.getElementById('select-actual-category');
    if (actCatSelect) {
      actCatSelect.addEventListener('change', () => {
        this.updateSubcategories(actCatSelect.value, 'select-actual-subcategory');
      });
    }

    // Form submit
    const form = document.getElementById('tx-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleFormSubmit();
      });
    }
  }

  updatePointSelfAmount() {
    const total = Number(document.getElementById('input-point-total')?.value) || 0;
    const used = Number(document.getElementById('input-point-used')?.value) || 0;
    const self = Math.max(0, total - used);
    const disp = document.getElementById('display-point-self-amount');
    if (disp) disp.textContent = `¥${self.toLocaleString()}`;
  }

  switchInputMode(mode) {
    this.currentMode = mode;

    // Harmonize mode tab buttons
    document.querySelectorAll('.mode-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });

    // Harmonize input-type selector
    const typeSelect = document.getElementById('input-type');
    if (typeSelect) {
      if (mode === 'normal') {
        if (['advance', 'repay', 'prepaid', 'point'].includes(typeSelect.value)) {
          typeSelect.value = 'expense';
        }
      } else {
        typeSelect.value = mode;
      }
    }

    const groupNormalAmount = document.getElementById('group-normal-amount');
    const advanceFields = document.getElementById('advance-fields');
    const prepaidFields = document.getElementById('prepaid-fields');
    const repayFields = document.getElementById('repay-fields');
    const pointFields = document.getElementById('point-fields');
    const groupToAccount = document.getElementById('group-to-account');
    const catContainer = document.getElementById('category-selection-container');
    const labelAccount = document.getElementById('label-account');

    // Reset visibility
    if (groupNormalAmount) groupNormalAmount.style.display = (mode === 'normal') ? 'block' : 'none';
    if (advanceFields) advanceFields.style.display = (mode === 'advance') ? 'block' : 'none';
    if (prepaidFields) prepaidFields.style.display = (mode === 'prepaid') ? 'block' : 'none';
    if (repayFields) repayFields.style.display = (mode === 'repay') ? 'block' : 'none';
    if (pointFields) pointFields.style.display = (mode === 'point') ? 'block' : 'none';

    if (mode === 'repay') {
      if (catContainer) catContainer.style.display = 'none';
      if (groupToAccount) groupToAccount.style.display = 'none';
      if (labelAccount) labelAccount.textContent = '受取先口座（入金口座）';
    } else if (mode === 'advance') {
      if (catContainer) catContainer.style.display = 'block';
      if (groupToAccount) groupToAccount.style.display = 'none';
      if (labelAccount) labelAccount.textContent = '立替支払元口座';
    } else if (mode === 'prepaid') {
      if (catContainer) catContainer.style.display = 'block';
      if (groupToAccount) groupToAccount.style.display = 'none';
      if (labelAccount) labelAccount.textContent = '決済口座（カード・銀行等）';
    } else if (mode === 'point') {
      if (catContainer) catContainer.style.display = 'block';
      if (groupToAccount) groupToAccount.style.display = 'none';
      if (labelAccount) labelAccount.textContent = '実質決済口座 (自己負担支払元)';
      this.updatePointSelfAmount();
    } else {
      if (catContainer) catContainer.style.display = 'block';
      if (labelAccount) labelAccount.textContent = '決済口座';
      const type = document.getElementById('input-type')?.value;
      this.updateFormFieldsForType(type);
    }
  }

  updateFormFieldsForType(type) {
    if (this.currentMode !== 'normal') return;
    const groupToAccount = document.getElementById('group-to-account');
    const catContainer = document.getElementById('category-selection-container');
    const labelAccount = document.getElementById('label-account');
    if (type === 'transfer') {
      if (groupToAccount) groupToAccount.style.display = 'block';
      if (catContainer) catContainer.style.display = 'none';
      if (labelAccount) labelAccount.textContent = '振替元口座';
    } else {
      if (groupToAccount) groupToAccount.style.display = 'none';
      if (catContainer) catContainer.style.display = 'block';
      if (labelAccount) labelAccount.textContent = '決済口座';
    }
  }

  async populateMasterDropdowns() {
    const config = await this.db.getMasterConfig();
    if (!config) return;

    // Accounts
    const accSelect = document.getElementById('select-account');
    const toAccSelect = document.getElementById('select-to-account');
    const pointAccSelect = document.getElementById('select-point-account');
    const activeAccounts = (config.accounts || []).filter(a => !a.is_archived);

    const buildAccountOptions = () => activeAccounts.map(a =>
      `<option value="${a.id}">${a.name} (${a.type})</option>`
    ).join('');

    if (accSelect) accSelect.innerHTML = buildAccountOptions();
    if (toAccSelect) toAccSelect.innerHTML = buildAccountOptions();

    if (pointAccSelect) {
      pointAccSelect.innerHTML = [
        '<option value="">ポイント相殺として計上（口座指定なし）</option>',
        ...activeAccounts.map(a => `<option value="${a.id}">${a.name} (${a.type})</option>`)
      ].join('');
    }

    // Categories
    const catSelect = document.getElementById('select-category');
    const actCatSelect = document.getElementById('select-actual-category');
    const activeCategories = (config.categories || []).filter(c => !c.is_archived);

    const buildCategoryOptions = () => activeCategories.map(c =>
      `<option value="${c.id}">${c.name}</option>`
    ).join('');

    if (catSelect) catSelect.innerHTML = buildCategoryOptions();
    if (actCatSelect) actCatSelect.innerHTML = buildCategoryOptions();

    if (activeCategories.length > 0) {
      this.updateSubcategories(activeCategories[0].id, 'select-subcategory');
      this.updateSubcategories(activeCategories[0].id, 'select-actual-subcategory');
    }
  }

  async updateSubcategories(categoryId, targetSelectId) {
    const select = document.getElementById(targetSelectId);
    if (!select) return;
    const config = await this.db.getMasterConfig();
    const cat = (config?.categories || []).find(c => c.id === categoryId);
    if (!cat || !cat.subcategories) {
      select.innerHTML = '<option value="">なし</option>';
      return;
    }
    const activeSubs = cat.subcategories.filter(s => !s.is_archived);
    select.innerHTML = activeSubs.map(s =>
      `<option value="${s.id}">${s.name}</option>`
    ).join('');
  }

  setupTaxModal() {
    const modal = document.getElementById('modal-tax');
    const btnOpen = document.getElementById('btn-open-tax-calc');
    const btnClose = document.getElementById('btn-close-tax-modal');
    const btnApply = document.getElementById('btn-apply-tax');

    const baseInput = document.getElementById('tax-base-amount');
    const rateSelect = document.getElementById('tax-rate-select');
    const roundSelect = document.getElementById('tax-rounding-select');
    const displayTax = document.getElementById('tax-calc-tax');
    const displayTotal = document.getElementById('tax-calc-total');

    if (!modal) return;

    const recalculateTaxModal = () => {
      const base = Number(baseInput?.value) || 0;
      const rate = Number(rateSelect?.value) || 0.10;
      const rounding = roundSelect?.value || 'floor';
      const result = calculateTax(base, rate, rounding);

      const taxAmount = result.amount - base;
      if (displayTax) displayTax.textContent = `¥${taxAmount.toLocaleString()}`;
      if (displayTotal) displayTotal.textContent = `¥${result.amount.toLocaleString()}`;
      return result;
    };

    btnOpen?.addEventListener('click', () => {
      const currentAmt = document.getElementById('input-amount')?.value;
      if (baseInput) baseInput.value = currentAmt || '';
      recalculateTaxModal();
      modal.classList.add('active');
    });

    btnClose?.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    baseInput?.addEventListener('input', recalculateTaxModal);
    rateSelect?.addEventListener('change', recalculateTaxModal);
    roundSelect?.addEventListener('change', recalculateTaxModal);

    btnApply?.addEventListener('click', () => {
      const result = recalculateTaxModal();
      const amountInput = document.getElementById('input-amount');
      if (amountInput) amountInput.value = result.amount;
      this.currentTaxMeta = result.tax_meta;
      modal.classList.remove('active');
    });
  }

  setupEditTransactionModal() {
    const modal = document.getElementById('modal-edit-tx');
    const btnClose = document.getElementById('btn-close-edit-tx');
    const form = document.getElementById('edit-tx-form');
    const btnDelete = document.getElementById('btn-edit-delete-tx');
    const typeSelect = document.getElementById('edit-tx-type');
    const btnTaxCalc = document.getElementById('btn-edit-open-tax-calc');
    const catSelect = document.getElementById('edit-tx-category');
    const actCatSelect = document.getElementById('edit-tx-actual-category');

    if (!modal) return;

    btnClose?.addEventListener('click', () => modal.classList.remove('active'));

    typeSelect?.addEventListener('change', () => {
      const isTransfer = typeSelect.value === 'transfer';
      const toGroup = document.getElementById('edit-tx-to-account-group');
      const catGroup = document.getElementById('edit-tx-cat-container');
      if (toGroup) toGroup.style.display = isTransfer ? 'block' : 'none';
      if (catGroup) catGroup.style.display = isTransfer ? 'none' : 'block';
    });

    catSelect?.addEventListener('change', () => {
      this.updateSubcategories(catSelect.value, 'edit-tx-subcategory');
    });

    actCatSelect?.addEventListener('change', () => {
      this.updateSubcategories(actCatSelect.value, 'edit-tx-actual-subcategory');
    });

    btnTaxCalc?.addEventListener('click', () => {
      const currentAmt = document.getElementById('edit-tx-amount')?.value;
      const baseInput = document.getElementById('tax-base-amount');
      if (baseInput) baseInput.value = currentAmt || '';
      const taxModal = document.getElementById('modal-tax');
      if (taxModal) taxModal.classList.add('active');

      const btnApply = document.getElementById('btn-apply-tax');
      if (btnApply) {
        const origOnClick = btnApply.onclick;
        btnApply.onclick = () => {
          const base = Number(baseInput?.value) || 0;
          const rate = Number(document.getElementById('tax-rate-select')?.value) || 0.10;
          const rounding = document.getElementById('tax-rounding-select')?.value || 'floor';
          const res = calculateTax(base, rate, rounding);
          const editAmtInput = document.getElementById('edit-tx-amount');
          if (editAmtInput) editAmtInput.value = res.amount;
          taxModal.classList.remove('active');
          btnApply.onclick = origOnClick;
        };
      }
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      await this.handleEditFormSubmit();
    });

    btnDelete?.addEventListener('click', async () => {
      const id = document.getElementById('edit-tx-id')?.value;
      if (!id) return;
      if (confirm('この明細を削除しますか？')) {
        await this.handleEditDelete(id);
      }
    });
  }

  async openEditTransactionModal(id) {
    const modal = document.getElementById('modal-edit-tx');
    if (!modal) return;
    const tx = await this.db.getTransaction(id);
    if (!tx) return;

    const config = await this.db.getMasterConfig();
    const activeAccounts = (config?.accounts || []).filter(a => !a.is_archived);
    const activeCats = (config?.categories || []).filter(c => !c.is_archived);

    // Populate accounts
    const accSelect = document.getElementById('edit-tx-account');
    const toAccSelect = document.getElementById('edit-tx-to-account');
    const accOptions = activeAccounts.map(a => `<option value="${a.id}">${a.name}</option>`).join('');
    if (accSelect) accSelect.innerHTML = accOptions;
    if (toAccSelect) toAccSelect.innerHTML = accOptions;

    // Populate categories
    const catSelect = document.getElementById('edit-tx-category');
    const actCatSelect = document.getElementById('edit-tx-actual-category');
    const catOptions = activeCats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if (catSelect) catSelect.innerHTML = catOptions;
    if (actCatSelect) actCatSelect.innerHTML = catOptions;

    // Set values
    const idInput = document.getElementById('edit-tx-id');
    const dateInput = document.getElementById('edit-tx-date');
    const typeSelect = document.getElementById('edit-tx-type');
    const amountInput = document.getElementById('edit-tx-amount');
    const memoInput = document.getElementById('edit-tx-memo');
    const tagsInput = document.getElementById('edit-tx-tags');
    const statusSelect = document.getElementById('edit-tx-status');

    if (idInput) idInput.value = tx.id;
    if (dateInput) dateInput.value = tx.date;
    if (typeSelect) typeSelect.value = tx.type;
    if (amountInput) amountInput.value = tx.amount;
    if (accSelect) accSelect.value = tx.account_id || '';
    if (toAccSelect) toAccSelect.value = tx.to_account_id || '';

    const catId = tx.category_id || (activeCats[0]?.id || '');
    if (catSelect) catSelect.value = catId;
    await this.updateSubcategories(catId, 'edit-tx-subcategory');
    const subSelect = document.getElementById('edit-tx-subcategory');
    if (subSelect && tx.subcategory_id) subSelect.value = tx.subcategory_id;

    const actCatId = tx.actual_category_id || catId;
    if (actCatSelect) actCatSelect.value = actCatId;
    await this.updateSubcategories(actCatId, 'edit-tx-actual-subcategory');
    const actSubSelect = document.getElementById('edit-tx-actual-subcategory');
    if (actSubSelect && tx.actual_subcategory_id) actSubSelect.value = tx.actual_subcategory_id;

    if (memoInput) memoInput.value = tx.memo || '';
    if (tagsInput) tagsInput.value = (tx.tags || []).join(', ');
    if (statusSelect) statusSelect.value = tx.status || 'confirmed';

    // Show/hide transfer
    const isTransfer = tx.type === 'transfer';
    const toGroup = document.getElementById('edit-tx-to-account-group');
    const catGroup = document.getElementById('edit-tx-cat-container');
    if (toGroup) toGroup.style.display = isTransfer ? 'block' : 'none';
    if (catGroup) catGroup.style.display = isTransfer ? 'none' : 'block';

    modal.classList.add('active');
  }

  async handleEditFormSubmit() {
    const id = document.getElementById('edit-tx-id')?.value;
    const tx = await this.db.getTransaction(id);
    if (!tx) return;

    const editDate = document.getElementById('edit-tx-date')?.value;
    const editType = document.getElementById('edit-tx-type')?.value;
    const editAmount = Number(document.getElementById('edit-tx-amount')?.value) || 0;
    const editAccount = document.getElementById('edit-tx-account')?.value;
    const editToAccount = document.getElementById('edit-tx-to-account')?.value;
    const editCat = document.getElementById('edit-tx-category')?.value;
    const editSub = document.getElementById('edit-tx-subcategory')?.value;
    const editActCat = document.getElementById('edit-tx-actual-category')?.value;
    const editActSub = document.getElementById('edit-tx-actual-subcategory')?.value;
    const editMemo = document.getElementById('edit-tx-memo')?.value || '';
    const editTags = (document.getElementById('edit-tx-tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const editStatus = document.getElementById('edit-tx-status')?.value || 'confirmed';

    tx.date = editDate;
    tx.target_month = editDate.slice(0, 7);
    tx.type = editType;
    tx.amount = editAmount;
    tx.account_id = editAccount;
    tx.to_account_id = editType === 'transfer' ? editToAccount : null;
    tx.category_id = editType === 'transfer' ? null : editCat;
    tx.subcategory_id = editType === 'transfer' ? null : editSub;
    tx.actual_category_id = editType === 'transfer' ? null : editActCat;
    tx.actual_subcategory_id = editType === 'transfer' ? null : editActSub;
    tx.memo = editMemo;
    tx.tags = editTags;
    tx.status = editStatus;
    tx.updated_at = new Date().toISOString();
    tx.sync_status = 'unsynced';

    await this.db.putTransaction(tx);

    const snapshot = await this.db.getSnapshot();
    const isPastClosed = snapshot?.last_closed_month && tx.target_month <= snapshot.last_closed_month;

    document.getElementById('modal-edit-tx')?.classList.remove('active');

    if (isPastClosed && this.syncManager?.gasUrl && this.syncManager?.privateKey) {
      try {
        await this.syncManager.sendRetroactiveUpdate(tx);
        alert('過去締め月の明細を修正し、スナップショットを再計算しました');
      } catch (err) {
        alert(`遡及更新エラー: ${err.message}`);
      }
    } else {
      this.syncManager?.syncPendingDiffs().catch(e => console.log('Sync deferred:', e.message));
    }

    await this.refreshAllViews();
  }

  async handleEditDelete(id) {
    const tx = await this.db.getTransaction(id);
    if (!tx) return;
    tx.is_deleted = true;
    tx.updated_at = new Date().toISOString();
    tx.sync_status = 'unsynced';
    await this.db.putTransaction(tx);

    const snapshot = await this.db.getSnapshot();
    const isPastClosed = snapshot?.last_closed_month && tx.target_month <= snapshot.last_closed_month;

    document.getElementById('modal-edit-tx')?.classList.remove('active');

    if (isPastClosed && this.syncManager?.gasUrl && this.syncManager?.privateKey) {
      try {
        await this.syncManager.sendRetroactiveUpdate(tx);
        alert('過去締め月の明細を削除し、スナップショットを再計算しました');
      } catch (err) {
        alert(`遡及削除エラー: ${err.message}`);
      }
    } else {
      this.syncManager?.syncPendingDiffs().catch(e => console.log('Sync deferred:', e.message));
    }

    await this.refreshAllViews();
  }

  async handleFormSubmit() {
    const date = document.getElementById('input-date')?.value;
    const memo = document.getElementById('input-memo')?.value || '';
    const tagsRaw = document.getElementById('input-tags')?.value || '';
    const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

    const accountId = document.getElementById('select-account')?.value;
    const toAccountId = document.getElementById('select-to-account')?.value;
    const categoryId = document.getElementById('select-category')?.value;
    const subcategoryId = document.getElementById('select-subcategory')?.value;

    const chkSync = document.getElementById('chk-sync-actual-category')?.checked;
    const actualCategoryId = chkSync ? categoryId : document.getElementById('select-actual-category')?.value;
    const actualSubcategoryId = chkSync ? subcategoryId : document.getElementById('select-actual-subcategory')?.value;

    let txRecordsToSave = [];

    if (this.currentMode === 'normal') {
      const type = document.getElementById('input-type')?.value;
      const amount = Number(document.getElementById('input-amount')?.value) || 0;

      if (amount <= 0) {
        alert('金額を入力してください');
        return;
      }

      const tx = {
        id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        group_id: `grp_${Date.now()}`,
        date: date,
        target_month: date.slice(0, 7),
        status: 'confirmed',
        type: type,
        amount: amount,
        tax_meta: this.currentTaxMeta,
        account_id: accountId,
        to_account_id: type === 'transfer' ? toAccountId : null,
        category_id: type === 'transfer' ? null : categoryId,
        subcategory_id: type === 'transfer' ? null : subcategoryId,
        actual_category_id: type === 'transfer' ? null : actualCategoryId,
        actual_subcategory_id: type === 'transfer' ? null : actualSubcategoryId,
        recurring_rule_id: null,
        amortization_meta: null,
        memo: memo,
        tags: tags,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_deleted: false,
        sync_status: 'unsynced'
      };
      txRecordsToSave.push(tx);
    } else if (this.currentMode === 'advance') {
      const selfAmount = Number(document.getElementById('input-self-amount')?.value) || 0;
      const advAmount = Number(document.getElementById('input-adv-amount')?.value) || 0;

      if (selfAmount <= 0 && advAmount <= 0) {
        alert('自己負担額または立替額を入力してください');
        return;
      }

      const advanceTxs = createAdvancePaymentTransactions({
        date,
        payingAccountId: accountId,
        selfAmount,
        advanceAmount: advAmount,
        categoryId,
        subcategoryId,
        actualCategoryId,
        actualSubcategoryId,
        taxMeta: this.currentTaxMeta,
        memo,
        tags
      });
      txRecordsToSave.push(...advanceTxs);
    } else if (this.currentMode === 'repay') {
      const repayAmount = Number(document.getElementById('input-repay-amount')?.value) || 0;
      if (repayAmount <= 0) {
        alert('回収額を入力してください');
        return;
      }

      const repayTx = createAdvanceRepaymentTransaction({
        date,
        receivingAccountId: accountId,
        amount: repayAmount,
        memo,
        tags
      });
      txRecordsToSave.push(repayTx);
    } else if (this.currentMode === 'prepaid') {
      const totalAmount = Number(document.getElementById('input-prepaid-total')?.value) || 0;
      const amortizeMonths = Number(document.getElementById('input-prepaid-months')?.value) || 12;

      if (totalAmount <= 0) {
        alert('一括支払総額を入力してください');
        return;
      }

      const prepaidTxs = createPrepaidAmortizationTransactions({
        paymentDate: date,
        totalAmount,
        payingAccountId: accountId,
        categoryId,
        subcategoryId,
        actualCategoryId,
        actualSubcategoryId,
        amortizeMonths,
        memo,
        tags
      });
      txRecordsToSave.push(...prepaidTxs);
    } else if (this.currentMode === 'point') {
      const totalAmount = Number(document.getElementById('input-point-total')?.value) || 0;
      const pointUsed = Number(document.getElementById('input-point-used')?.value) || 0;
      const pointAccountId = document.getElementById('select-point-account')?.value || null;

      if (totalAmount <= 0) {
        alert('購入総額を入力してください');
        return;
      }

      const pointTxs = createPointPaymentTransactions({
        date,
        totalAmount,
        pointUsed,
        payingAccountId: accountId,
        pointAccountId,
        categoryId,
        subcategoryId,
        actualCategoryId,
        actualSubcategoryId,
        taxMeta: this.currentTaxMeta,
        memo,
        tags
      });
      txRecordsToSave.push(...pointTxs);
    }

    // Save to Database
    await this.db.putTransactions(txRecordsToSave);

    // Reset inputs
    const elAmt = document.getElementById('input-amount');
    if (elAmt) elAmt.value = '';
    const elSelf = document.getElementById('input-self-amount');
    if (elSelf) elSelf.value = '';
    const elAdv = document.getElementById('input-adv-amount');
    if (elAdv) elAdv.value = '';
    const elRepay = document.getElementById('input-repay-amount');
    if (elRepay) elRepay.value = '';
    const elPreTotal = document.getElementById('input-prepaid-total');
    if (elPreTotal) elPreTotal.value = '';
    const elPtTotal = document.getElementById('input-point-total');
    if (elPtTotal) elPtTotal.value = '';
    const elPtUsed = document.getElementById('input-point-used');
    if (elPtUsed) elPtUsed.value = '';
    const dispPoint = document.getElementById('display-point-self-amount');
    if (dispPoint) dispPoint.textContent = '¥0';
    const elMemo = document.getElementById('input-memo');
    if (elMemo) elMemo.value = '';
    const elTags = document.getElementById('input-tags');
    if (elTags) elTags.value = '';
    this.currentTaxMeta = null;

    // Refresh views & try auto sync in background
    await this.refreshAllViews();
    this.syncManager.syncPendingDiffs().catch(err => console.log('Auto sync deferred:', err.message));
  }

  setupSummaryView() {
    // Target toggle: Cashflow vs Assets
    document.querySelectorAll('#control-view-target .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#control-view-target .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.analyticsTarget = btn.dataset.target;
        this.renderSummary();
      });
    });

    // Granularity toggle: Daily vs Monthly vs Yearly
    document.querySelectorAll('#control-granularity .segment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#control-granularity .segment-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.analyticsGranularity = btn.dataset.granularity;
        this.renderSummary();
      });
    });

    // Period Navigator
    document.getElementById('btn-period-prev')?.addEventListener('click', () => {
      if (this.analyticsGranularity === 'daily') {
        this.currentMonth = addMonthsToMonthStr(this.currentMonth, -1);
        this.selectedYear = this.currentMonth.slice(0, 4);
      } else if (this.analyticsGranularity === 'monthly') {
        this.selectedYear = String(Number(this.selectedYear) - 1);
        this.currentMonth = `${this.selectedYear}-${this.currentMonth.slice(5, 7)}`;
      } else {
        this.selectedYear = String(Number(this.selectedYear) - 1);
      }
      this.renderSummary();
    });

    document.getElementById('btn-period-next')?.addEventListener('click', () => {
      if (this.analyticsGranularity === 'daily') {
        this.currentMonth = addMonthsToMonthStr(this.currentMonth, 1);
        this.selectedYear = this.currentMonth.slice(0, 4);
      } else if (this.analyticsGranularity === 'monthly') {
        this.selectedYear = String(Number(this.selectedYear) + 1);
        this.currentMonth = `${this.selectedYear}-${this.currentMonth.slice(5, 7)}`;
      } else {
        this.selectedYear = String(Number(this.selectedYear) + 1);
      }
      this.renderSummary();
    });

    const btnPlanned = document.getElementById('btn-toggle-planned');
    btnPlanned?.addEventListener('click', () => {
      this.showPlanned = !this.showPlanned;
      btnPlanned.textContent = `予定: ${this.showPlanned ? 'ON' : 'OFF'}`;
      this.renderSummary();
    });

    const btnAxis = document.getElementById('btn-toggle-axis');
    btnAxis?.addEventListener('click', () => {
      this.useActualCategoryAxis = !this.useActualCategoryAxis;
      btnAxis.textContent = this.useActualCategoryAxis ? '実態分類ベース' : '計上分類ベース';
      this.renderSummary();
    });

    document.getElementById('select-status-filter')?.addEventListener('change', () => {
      this.renderMonthTransactions();
    });

    // Recurring generation button
    document.getElementById('btn-generate-recurring')?.addEventListener('click', async () => {
      await this.handleGenerateRecurring();
    });

    // Month close button
    document.getElementById('btn-close-month')?.addEventListener('click', async () => {
      await this.handleCloseMonth();
    });
  }

  async handleGenerateRecurring() {
    const config = await this.db.getMasterConfig();
    const existing = await this.db.getTransactions({ target_month: this.currentMonth, includeDeleted: true });
    const generated = generateRecurringTransactions(
      config.recurring_rules || [],
      this.currentMonth,
      config.holidays || [],
      existing
    );

    if (generated.length === 0) {
      alert(`${this.currentMonth} の定期予定はすでに生成されているか、対象ルールがありません`);
      return;
    }

    await this.db.putTransactions(generated);
    alert(`${generated.length} 件の定期予定（planned）を生成しました`);
    await this.refreshAllViews();
  }

  async handleCloseMonth() {
    // Check if any planned items exist in this month
    const monthTxs = await this.db.getTransactions({ target_month: this.currentMonth });
    const plannedTxs = monthTxs.filter(t => t.status === 'planned');

    if (plannedTxs.length > 0) {
      const confirmMsg = `${this.currentMonth} には未確定の予定（planned）が ${plannedTxs.length} 件あります。\nすべて確定（confirmed）にして月締めを実行しますか？`;
      if (!confirm(confirmMsg)) {
        return;
      }
      for (const t of plannedTxs) {
        t.status = 'confirmed';
        t.sync_status = 'unsynced';
        await this.db.putTransaction(t);
      }
    }

    try {
      const btn = document.getElementById('btn-close-month');
      if (btn) btn.disabled = true;
      await this.syncManager.closeMonth(this.currentMonth);
      alert(`${this.currentMonth} の月締めが正常に完了しました！アーカイブが保存されました。`);
    } catch (err) {
      alert(`月締めに失敗しました: ${err.message}`);
    } finally {
      const btn = document.getElementById('btn-close-month');
      if (btn) btn.disabled = false;
      await this.refreshAllViews();
    }
  }

  async renderSummary() {
    const periodDisplay = document.getElementById('period-display');
    if (periodDisplay) {
      if (this.analyticsGranularity === 'daily') {
        periodDisplay.textContent = `${this.currentMonth} (日別)`;
      } else if (this.analyticsGranularity === 'monthly') {
        periodDisplay.textContent = `${this.selectedYear}年 (月別)`;
      } else {
        periodDisplay.textContent = `全期間 (年別推移)`;
      }
    }

    const snapshot = await this.db.getSnapshot();
    const config = await this.db.getMasterConfig();
    const transactions = await this.db.getTransactions({ includeDeleted: false });

    const summary = calculateBalancesAndSummaries(snapshot, transactions, this.currentMonth);
    const totalAssetSummary = calculateTotalAssetSummary(
      summary.confirmed_balances,
      config?.accounts || [],
      snapshot?.external_assets || []
    );

    // Update top asset KPI cards
    const statTotal = document.getElementById('stat-total-assets');
    const statLiquid = document.getElementById('stat-liquid-assets');
    const statExt = document.getElementById('stat-external-assets');
    const statLiab = document.getElementById('stat-liabilities');

    if (statTotal) statTotal.textContent = `¥${totalAssetSummary.total_net_assets.toLocaleString()}`;
    if (statLiquid) statLiquid.textContent = `¥${totalAssetSummary.total_liquid_assets.toLocaleString()}`;
    if (statExt) statExt.textContent = `¥${totalAssetSummary.total_external_assets.toLocaleString()}`;
    if (statLiab) statLiab.textContent = `¥${totalAssetSummary.total_liabilities.toLocaleString()}`;

    // Render External Assets breakdown list
    this.renderExternalAssetsBreakdown(snapshot?.external_assets || []);

    // Render Internal Account balances list
    this.renderAccountBalances(summary);

    // Branch on view target: Cashflow vs Assets
    const cashflowGrid = document.getElementById('cashflow-stat-grid');
    const catCard = document.getElementById('card-category-breakdown');
    const chartTitle = document.getElementById('chart-title');
    const tableTitle = document.getElementById('table-title');

    if (this.analyticsTarget === 'cashflow') {
      if (cashflowGrid) cashflowGrid.style.display = 'grid';
      if (catCard) catCard.style.display = 'block';

      if (this.analyticsGranularity === 'daily') {
        if (chartTitle) chartTitle.textContent = `${this.currentMonth} 日別収支推移・内訳`;
        if (tableTitle) tableTitle.textContent = `${this.currentMonth} 日別集計表`;
        this.renderDailyAnalytics(transactions, summary);
      } else if (this.analyticsGranularity === 'monthly') {
        if (chartTitle) chartTitle.textContent = `${this.selectedYear}年 月別収支推移・内訳`;
        if (tableTitle) tableTitle.textContent = `${this.selectedYear}年 月別集計表`;
        this.renderMonthlyAnalytics(transactions, snapshot);
      } else {
        if (chartTitle) chartTitle.textContent = '年別収支推移・貯蓄率推移';
        if (tableTitle) tableTitle.textContent = '年次推移集計表';
        this.renderYearlyAnalytics(transactions, snapshot);
      }
    } else {
      // Assets Target
      if (cashflowGrid) cashflowGrid.style.display = 'none';
      if (catCard) catCard.style.display = 'none';
      if (chartTitle) chartTitle.textContent = '資産構成比・内部口座/外部資産内訳';
      if (tableTitle) tableTitle.textContent = '資産種別・口座別残高一覧';
      this.renderAssetsAnalytics(totalAssetSummary, config, snapshot?.external_assets || []);
    }

    // Render Transactions List for current month
    await this.renderMonthTransactions();
  }

  renderExternalAssetsBreakdown(assets) {
    const list = document.getElementById('summary-external-assets-list');
    if (!list) return;

    if (!assets || assets.length === 0) {
      list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">保有外部資産は登録されていません（設定マスタより追加できます）</div>';
      return;
    }

    list.innerHTML = assets.map(a => {
      const val = Number(a.market_value ?? a.current_value ?? a.amount ?? 0);
      return `
        <div class="tx-item">
          <div class="tx-info">
            <span class="tx-title">${a.name}</span>
            <span class="tx-meta">更新日: ${(a.updated_at || '-').slice(0, 10)}</span>
          </div>
          <div style="font-weight: 700; color: #10b981; font-size: 1.05rem;">
            ¥${val.toLocaleString()}
          </div>
        </div>
      `;
    }).join('');
  }

  renderDailyAnalytics(transactions, summary) {
    const dailyData = aggregateDailySummaries(transactions, this.currentMonth);

    // Update cashflow stat cards
    const statInc = document.getElementById('stat-income');
    const statExp = document.getElementById('stat-expense');
    const statNet = document.getElementById('stat-net-income');
    const statBal = document.getElementById('stat-confirmed-balance');
    const lblInc = document.getElementById('label-stat-income');
    const lblExp = document.getElementById('label-stat-expense');
    const lblNet = document.getElementById('label-stat-net');
    const lblBal = document.getElementById('label-stat-savings-rate');

    if (lblInc) lblInc.textContent = '当月収入 (確定/予定込)';
    if (statInc) statInc.textContent = `¥${summary.income_confirmed.toLocaleString()} / ¥${summary.income_total.toLocaleString()}`;
    if (lblExp) lblExp.textContent = '当月支出 (確定/予定込)';
    if (statExp) statExp.textContent = `¥${summary.expense_confirmed.toLocaleString()} / ¥${summary.expense_total.toLocaleString()}`;
    if (lblNet) lblNet.textContent = '当月収支差額 (貯蓄)';
    if (statNet) statNet.textContent = `¥${(summary.income_total - summary.expense_total).toLocaleString()}`;
    if (lblBal) lblBal.textContent = '現在確定残高 / 予測';
    const totalConf = Object.values(summary.confirmed_balances).reduce((a, b) => a + b, 0);
    const totalProj = Object.values(summary.projected_balances).reduce((a, b) => a + b, 0);
    if (statBal) statBal.textContent = `¥${totalConf.toLocaleString()} / ¥${totalProj.toLocaleString()}`;

    // Table
    const tableContainer = document.getElementById('breakdown-table-container');
    if (tableContainer) {
      const days = Object.values(dailyData.days).filter(d => d.income_total > 0 || d.expense_total > 0);
      if (days.length === 0) {
        tableContainer.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">当月の日別取引データはありません</div>';
      } else {
        tableContainer.innerHTML = `
          <table class="summary-table">
            <thead>
              <tr>
                <th>日付</th>
                <th>確定収入</th>
                <th>確定支出</th>
                <th>予定支出</th>
                <th>収支差額</th>
              </tr>
            </thead>
            <tbody>
              ${days.map(d => `
                <tr>
                  <td><strong>${d.date.slice(5)}</strong></td>
                  <td style="color: #10b981;">¥${d.income_confirmed.toLocaleString()}</td>
                  <td style="color: var(--danger);">¥${d.expense_confirmed.toLocaleString()}</td>
                  <td style="color: var(--text-muted);">¥${d.expense_planned.toLocaleString()}</td>
                  <td style="font-weight: 600; color: ${d.net >= 0 ? '#10b981' : 'var(--danger)'};">
                    ${d.net >= 0 ? '+' : ''}¥${d.net.toLocaleString()}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }

    // Category breakdown list
    this.renderCategoryBreakdownList(this.useActualCategoryAxis ? summary.by_actual_category : summary.by_category);

    // Chart
    this.renderChartForDaily(dailyData);
  }

  renderMonthlyAnalytics(transactions, snapshot) {
    const monthlyData = aggregateMonthlySummaries(transactions, this.selectedYear, snapshot?.monthly_summaries || {});

    // Update cashflow stat cards
    const statInc = document.getElementById('stat-income');
    const statExp = document.getElementById('stat-expense');
    const statNet = document.getElementById('stat-net-income');
    const statBal = document.getElementById('stat-confirmed-balance');
    const lblInc = document.getElementById('label-stat-income');
    const lblExp = document.getElementById('label-stat-expense');
    const lblNet = document.getElementById('label-stat-net');
    const lblBal = document.getElementById('label-stat-savings-rate');

    if (lblInc) lblInc.textContent = `${this.selectedYear}年 年間収入`;
    if (statInc) statInc.textContent = `¥${monthlyData.total_income.toLocaleString()}`;
    if (lblExp) lblExp.textContent = `${this.selectedYear}年 年間支出`;
    if (statExp) statExp.textContent = `¥${monthlyData.total_expense.toLocaleString()}`;
    if (lblNet) lblNet.textContent = `${this.selectedYear}年 年間収支差額`;
    if (statNet) statNet.textContent = `¥${monthlyData.total_net.toLocaleString()}`;
    const rate = monthlyData.total_income > 0 ? Math.round((monthlyData.total_net / monthlyData.total_income) * 1000) / 10 : 0;
    if (lblBal) lblBal.textContent = '年間貯蓄率';
    if (statBal) statBal.textContent = `${rate}%`;

    // Table
    const tableContainer = document.getElementById('breakdown-table-container');
    if (tableContainer) {
      let cumulative = 0;
      const rows = Object.values(monthlyData.months);
      tableContainer.innerHTML = `
        <table class="summary-table">
          <thead>
            <tr>
              <th>月</th>
              <th>収入</th>
              <th>支出</th>
              <th>収支差額</th>
              <th>累積差額</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(m => {
              cumulative += m.net;
              return `
                <tr>
                  <td><strong>${m.month}</strong></td>
                  <td style="color: #10b981;">¥${m.income_total.toLocaleString()}</td>
                  <td style="color: var(--danger);">¥${m.expense_total.toLocaleString()}</td>
                  <td style="font-weight: 600; color: ${m.net >= 0 ? '#10b981' : 'var(--danger)'};">
                    ${m.net >= 0 ? '+' : ''}¥${m.net.toLocaleString()}
                  </td>
                  <td style="font-weight: 600;">¥${cumulative.toLocaleString()}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    // Category breakdown list
    const combinedCats = {};
    for (const m of Object.values(monthlyData.months)) {
      const src = this.useActualCategoryAxis ? m.by_actual_category : m.by_category;
      if (src) {
        for (const [k, v] of Object.entries(src)) {
          const val = typeof v === 'number' ? v : (v.total || 0);
          combinedCats[k] = (combinedCats[k] || 0) + val;
        }
      }
    }
    const catObj = {};
    for (const [k, v] of Object.entries(combinedCats)) {
      catObj[k] = { total: v, total_confirmed: v, total_planned: 0 };
    }
    this.renderCategoryBreakdownList(catObj);

    // Chart
    this.renderChartForMonthly(monthlyData);
  }

  renderYearlyAnalytics(transactions, snapshot) {
    const yearlyData = aggregateYearlySummaries(transactions, snapshot?.monthly_summaries || {});

    let totalInc = 0;
    let totalExp = 0;
    for (const y of Object.values(yearlyData)) {
      totalInc += y.income;
      totalExp += y.expense;
    }
    const totalNet = totalInc - totalExp;
    const avgRate = totalInc > 0 ? Math.round((totalNet / totalInc) * 1000) / 10 : 0;

    const statInc = document.getElementById('stat-income');
    const statExp = document.getElementById('stat-expense');
    const statNet = document.getElementById('stat-net-income');
    const statBal = document.getElementById('stat-confirmed-balance');
    const lblInc = document.getElementById('label-stat-income');
    const lblExp = document.getElementById('label-stat-expense');
    const lblNet = document.getElementById('label-stat-net');
    const lblBal = document.getElementById('label-stat-savings-rate');

    if (lblInc) lblInc.textContent = '全期間 累計収入';
    if (statInc) statInc.textContent = `¥${totalInc.toLocaleString()}`;
    if (lblExp) lblExp.textContent = '全期間 累計支出';
    if (statExp) statExp.textContent = `¥${totalExp.toLocaleString()}`;
    if (lblNet) lblNet.textContent = '全期間 累計純貯蓄';
    if (statNet) statNet.textContent = `¥${totalNet.toLocaleString()}`;
    if (lblBal) lblBal.textContent = '平均貯蓄率';
    if (statBal) statBal.textContent = `${avgRate}%`;

    // Table
    const tableContainer = document.getElementById('breakdown-table-container');
    if (tableContainer) {
      const years = Object.values(yearlyData).sort((a, b) => a.year.localeCompare(b.year));
      tableContainer.innerHTML = `
        <table class="summary-table">
          <thead>
            <tr>
              <th>年</th>
              <th>収入</th>
              <th>支出</th>
              <th>年間収支差額</th>
              <th>貯蓄率</th>
            </tr>
          </thead>
          <tbody>
            ${years.map(y => `
              <tr>
                <td><strong>${y.year}年</strong></td>
                <td style="color: #10b981;">¥${y.income.toLocaleString()}</td>
                <td style="color: var(--danger);">¥${y.expense.toLocaleString()}</td>
                <td style="font-weight: 600; color: ${y.net >= 0 ? '#10b981' : 'var(--danger)'};">
                  ${y.net >= 0 ? '+' : ''}¥${y.net.toLocaleString()}
                </td>
                <td style="font-weight: 600;">${y.savings_rate}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    // Category breakdown list
    const combinedCats = {};
    for (const y of Object.values(yearlyData)) {
      const src = this.useActualCategoryAxis ? y.by_actual_category : y.by_category;
      if (src) {
        for (const [k, v] of Object.entries(src)) {
          const val = typeof v === 'number' ? v : (v.total || 0);
          combinedCats[k] = (combinedCats[k] || 0) + val;
        }
      }
    }
    const catObj = {};
    for (const [k, v] of Object.entries(combinedCats)) {
      catObj[k] = { total: v, total_confirmed: v, total_planned: 0 };
    }
    this.renderCategoryBreakdownList(catObj);

    // Chart
    this.renderChartForYearly(yearlyData);
  }

  renderAssetsAnalytics(totalAssetSummary, config, externalAssets) {
    const tableContainer = document.getElementById('breakdown-table-container');
    if (!tableContainer) return;

    const totalNet = totalAssetSummary.total_net_assets || 1;
    const accounts = config?.accounts || [];

    tableContainer.innerHTML = `
      <table class="summary-table">
        <thead>
          <tr>
            <th>資産 / 口座名</th>
            <th>分類・種別</th>
            <th>評価額 / 残高</th>
            <th>構成比</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background: #f8fafc; font-weight: 700;">
            <td colspan="4">内部流動資産 (預貯金・現金等)</td>
          </tr>
          ${accounts.filter(a => !a.is_archived && a.type !== 'credit_card').map(a => {
            const bal = totalAssetSummary.by_type[a.type] !== undefined ? (totalAssetSummary.confirmed_balances?.[a.id] || 0) : 0;
            const pct = Math.round((Math.max(0, bal) / Math.max(1, totalNet)) * 1000) / 10;
            return `
              <tr>
                <td>${a.name}</td>
                <td>${a.type}</td>
                <td style="font-weight: 600; color: var(--primary);">¥${bal.toLocaleString()}</td>
                <td>${pct}%</td>
              </tr>
            `;
          }).join('')}
          <tr style="background: #f8fafc; font-weight: 700;">
            <td colspan="4">保有外部資産 (株式・投資信託等)</td>
          </tr>
          ${externalAssets.map(ast => {
            const val = Number(ast.market_value ?? ast.current_value ?? ast.amount ?? 0);
            const pct = Math.round((val / Math.max(1, totalNet)) * 1000) / 10;
            return `
              <tr>
                <td>${ast.name}</td>
                <td>外部資産</td>
                <td style="font-weight: 600; color: #10b981;">¥${val.toLocaleString()}</td>
                <td>${pct}%</td>
              </tr>
            `;
          }).join('')}
          <tr style="background: #f8fafc; font-weight: 700;">
            <td colspan="4">負債・立替金等</td>
          </tr>
          <tr>
            <td>クレジットカード・未払枠</td>
            <td>負債 (credit_card)</td>
            <td style="font-weight: 600; color: var(--danger);">-¥${totalAssetSummary.liabilities.toLocaleString()}</td>
            <td>-</td>
          </tr>
        </tbody>
      </table>
    `;

    // Render Asset Allocation Chart
    this.renderChartForAssets(totalAssetSummary);
  }

  renderCategoryBreakdownList(categoriesData) {
    const list = document.getElementById('category-breakdown-list');
    if (!list) return;

    const entries = Object.entries(categoriesData || {});
    if (entries.length === 0) {
      list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">内訳データはありません</div>';
      return;
    }

    const totalExpense = entries.reduce((sum, [, data]) => sum + (data.total || 0), 0);

    list.innerHTML = entries
      .sort((a, b) => (b[1].total || 0) - (a[1].total || 0))
      .map(([catId, data]) => {
        const amt = data.total || 0;
        const pct = totalExpense > 0 ? Math.round((amt / totalExpense) * 1000) / 10 : 0;
        return `
          <div class="tx-item">
            <div class="tx-info">
              <span class="tx-title">${catId}</span>
              <span class="tx-meta">構成比: ${pct}%</span>
            </div>
            <div style="text-align: right; font-weight: 700; color: var(--primary);">
              ¥${amt.toLocaleString()}
            </div>
          </div>
        `;
      }).join('');
  }

  async renderAccountBalances(summary) {
    const list = document.getElementById('account-balances-list');
    if (!list) return;
    const config = await this.db.getMasterConfig();
    const accounts = config?.accounts || [];

    list.innerHTML = accounts.map(acc => {
      const conf = summary.confirmed_balances[acc.id] || 0;
      const proj = summary.projected_balances[acc.id] || 0;
      return `
        <div class="tx-item">
          <div class="tx-info">
            <span class="tx-title">${acc.name}</span>
            <span class="tx-meta">${acc.type}</span>
          </div>
          <div style="text-align: right;">
            <div style="font-weight: 700; color: var(--primary);">¥${conf.toLocaleString()}</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">予測: ¥${proj.toLocaleString()}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  renderChart(summary) {
    if (this.analyticsTarget === 'cashflow') {
      if (this.analyticsGranularity === 'daily') {
        const transactions = this._cachedTransactions || [];
        this.renderDailyAnalytics(transactions, summary);
      } else {
        // default monthly
        const snapshot = this._cachedSnapshot || {};
        const transactions = this._cachedTransactions || [];
        this.renderMonthlyAnalytics(transactions, snapshot);
      }
    }
  }

  renderChartForDaily(dailyData) {
    const canvas = document.getElementById('summary-chart');
    const fallback = document.getElementById('chart-fallback');
    if (!canvas) return;

    const days = Object.values(dailyData.days);
    const labels = days.map(d => String(d.day) + '日');
    const confirmedExp = days.map(d => d.expense_confirmed);
    const plannedExp = days.map(d => this.showPlanned ? d.expense_planned : 0);
    const incomes = days.map(d => d.income_total);

    if (typeof window !== 'undefined' && window.Chart) {
      if (fallback) fallback.style.display = 'none';
      canvas.style.display = 'block';

      if (this.chart) this.chart.destroy();
      this.chart = new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '確定支出', data: confirmedExp, backgroundColor: '#ef4444', stack: 'exp' },
            { label: '予定支出', data: plannedExp, backgroundColor: '#fca5a5', stack: 'exp' },
            { label: '収入', data: incomes, backgroundColor: '#10b981' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { x: { stacked: true }, y: { beginAtZero: true } }
        }
      });
    } else if (fallback) {
      canvas.style.display = 'none';
      fallback.style.display = 'block';
      fallback.innerHTML = `<div>当月の日別集計データ表示中 (合計: 収入 ¥${dailyData.total_income.toLocaleString()} / 支出 ¥${dailyData.total_expense.toLocaleString()})</div>`;
    }
  }

  renderChartForMonthly(monthlyData) {
    const canvas = document.getElementById('summary-chart');
    const fallback = document.getElementById('chart-fallback');
    if (!canvas) return;

    const months = Object.values(monthlyData.months);
    const labels = months.map(m => m.month.slice(5) + '月');
    const incomes = months.map(m => m.income_total);
    const expenses = months.map(m => m.expense_total);

    if (typeof window !== 'undefined' && window.Chart) {
      if (fallback) fallback.style.display = 'none';
      canvas.style.display = 'block';

      if (this.chart) this.chart.destroy();
      this.chart = new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '収入', data: incomes, backgroundColor: '#10b981' },
            { label: '支出', data: expenses, backgroundColor: '#ef4444' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } }
        }
      });
    } else if (fallback) {
      canvas.style.display = 'none';
      fallback.style.display = 'block';
      fallback.innerHTML = `<div>${monthlyData.year}年 月別収支 (年間収入: ¥${monthlyData.total_income.toLocaleString()} / 支出: ¥${monthlyData.total_expense.toLocaleString()})</div>`;
    }
  }

  renderChartForYearly(yearlyData) {
    const canvas = document.getElementById('summary-chart');
    const fallback = document.getElementById('chart-fallback');
    if (!canvas) return;

    const years = Object.values(yearlyData).sort((a, b) => a.year.localeCompare(b.year));
    const labels = years.map(y => y.year + '年');
    const incomes = years.map(y => y.income);
    const expenses = years.map(y => y.expense);

    if (typeof window !== 'undefined' && window.Chart) {
      if (fallback) fallback.style.display = 'none';
      canvas.style.display = 'block';

      if (this.chart) this.chart.destroy();
      this.chart = new window.Chart(canvas, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: '年間収入', data: incomes, backgroundColor: '#10b981' },
            { label: '年間支出', data: expenses, backgroundColor: '#ef4444' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } }
        }
      });
    } else if (fallback) {
      canvas.style.display = 'none';
      fallback.style.display = 'block';
      fallback.innerHTML = '<div>年次推移データ表示中</div>';
    }
  }

  renderChartForAssets(totalAssetSummary) {
    const canvas = document.getElementById('summary-chart');
    const fallback = document.getElementById('chart-fallback');
    if (!canvas) return;

    const labels = ['流動資産 (預貯金等)', '保有外部資産', '負債 (カード等)'];
    const values = [
      totalAssetSummary.total_liquid_assets,
      totalAssetSummary.total_external_assets,
      totalAssetSummary.total_liabilities
    ];
    const colors = ['#2563eb', '#10b981', '#ef4444'];

    if (typeof window !== 'undefined' && window.Chart) {
      if (fallback) fallback.style.display = 'none';
      canvas.style.display = 'block';

      if (this.chart) this.chart.destroy();
      this.chart = new window.Chart(canvas, {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{ data: values, backgroundColor: colors }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false
        }
      });
    } else if (fallback) {
      canvas.style.display = 'none';
      fallback.style.display = 'block';
      fallback.innerHTML = `<div>総資産: ¥${totalAssetSummary.total_assets.toLocaleString()} (純資産: ¥${totalAssetSummary.total_net_assets.toLocaleString()})</div>`;
    }
  }

  async renderMonthTransactions() {
    const list = document.getElementById('month-tx-list');
    if (!list) return;
    const filterStatus = document.getElementById('select-status-filter')?.value || 'all';

    const txs = await this.db.getTransactions({ target_month: this.currentMonth });
    const filtered = txs.filter(t => {
      if (filterStatus === 'confirmed') return t.status === 'confirmed';
      if (filterStatus === 'planned') return t.status === 'planned';
      return true;
    });

    if (filtered.length === 0) {
      list.innerHTML = '<div style="color: var(--text-muted); padding: 12px; text-align: center;">取引はありません</div>';
      return;
    }

    list.innerHTML = filtered.map(t => {
      const isPlanned = t.status === 'planned';
      const statusBadge = isPlanned
        ? '<span class="badge badge-warning">予定</span>'
        : '<span class="badge badge-success">確定</span>';

      const badges = [statusBadge];
      if (t.is_advance_split || t.account_id === 'acc_receivable') {
        badges.push('<span class="badge badge-advance">立替</span>');
      }
      if (t.is_point_split || (t.tags && (t.tags.includes('ポイント併用') || t.tags.includes('point_offset')))) {
        badges.push('<span class="badge badge-point">ポイント</span>');
      }

      return `
        <div class="tx-item ${isPlanned ? 'planned' : ''} clickable" data-id="${t.id}">
          <div class="tx-info">
            <span class="tx-title">${escapeHtml(t.memo || '(メモなし)')} <span class="tx-edit-hint" title="タッチして編集">✏️</span></span>
            <div class="tx-meta">
              <span>${t.date}</span>
              ${badges.join(' ')}
              <span>${t.type}</span>
            </div>
          </div>
          <div style="text-align: right;">
            <div class="tx-amount ${t.type}">
              ${t.type === 'expense' ? '-' : t.type === 'income' ? '+' : ''}¥${t.amount.toLocaleString()}
            </div>
            <button class="btn btn-secondary btn-sm btn-delete-tx" data-id="${t.id}" style="margin-top: 4px;">削除</button>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners to .tx-item.clickable (ignoring clicks on delete button)
    list.querySelectorAll('.tx-item.clickable').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-tx')) return;
        const id = item.dataset.id;
        if (id) this.openEditTransactionModal(id);
      });
    });

    // Attach delete listeners
    list.querySelectorAll('.btn-delete-tx').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        if (confirm('この明細を削除しますか？')) {
          await this.handleEditDelete(id);
        }
      });
    });
  }

  async renderRecentTransactions() {
    const list = document.getElementById('recent-tx-list');
    if (!list) return;
    const all = await this.db.getTransactions();
    const sorted = all.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

    if (sorted.length === 0) {
      list.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">まだ入力はありません</div>';
      return;
    }

    list.innerHTML = sorted.map(t => {
      const badges = [];
      if (t.is_advance_split || t.account_id === 'acc_receivable') {
        badges.push('<span class="badge badge-advance">立替</span>');
      }
      if (t.is_point_split || (t.tags && (t.tags.includes('ポイント併用') || t.tags.includes('point_offset')))) {
        badges.push('<span class="badge badge-point">ポイント</span>');
      }

      return `
        <div class="tx-item clickable" data-id="${t.id}">
          <div class="tx-info">
            <span class="tx-title">${escapeHtml(t.memo || '(メモなし)')} <span class="tx-edit-hint" title="タッチして編集">✏️</span></span>
            <div class="tx-meta">
              <span>${t.date}</span>
              ${badges.join(' ')}
              <span>${t.type}</span>
              <span>${t.status}</span>
            </div>
          </div>
          <div class="tx-amount ${t.type}">
            ¥${t.amount.toLocaleString()}
          </div>
        </div>
      `;
    }).join('');

    list.querySelectorAll('.tx-item.clickable').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        if (id) this.openEditTransactionModal(id);
      });
    });
  }

  setupSettingsView() {
    // Generate new key
    document.getElementById('btn-generate-key')?.addEventListener('click', async () => {
      if (confirm('新しいEd25519鍵ペアを生成しますか？\n（GAS側の USER_PUBLIC_KEYS の更新が必要になります）')) {
        await this.generateNewKeyPair();
        alert('新しい鍵ペアを生成しました。公開鍵をコピーしてGASに登録してください。');
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
      if (!this.privateKey) {
        alert('秘密鍵がロードされていません。ロック中の場合は解除してください。');
        return;
      }

      const enc = await encryptPrivateKeyWithPin(this.privateKey, pin);
      await this.db.saveSecurityKey('encrypted_private_key', enc);
      await this.db.deleteSecurityKey('private_key_pkcs8');
      this.isKeyProtectedWithPin = true;
      this.isKeyLocked = false;
      if (pinInput) pinInput.value = '';
      this.updateKeyDisplay();
      alert('秘密鍵をPINコードで暗号化保護しました！\n平文の秘密鍵は端末内ストレージから削除されました。');
    });

    document.getElementById('btn-unlock-pin')?.addEventListener('click', async () => {
      await this.promptPinUnlock();
    });

    document.getElementById('btn-lock-now')?.addEventListener('click', async () => {
      await this.lockPrivateKey();
    });

    document.getElementById('btn-remove-pin')?.addEventListener('click', async () => {
      await this.removePinProtection();
    });

    // Save GAS URL
    document.getElementById('btn-save-gas-url')?.addEventListener('click', async () => {
      const urlInput = document.getElementById('input-gas-url');
      const url = urlInput?.value.trim();
      await this.db.setSetting('gas_url', url);
      this.syncManager.setGasUrl(url);
      alert('GAS URLを保存しました');
    });

    // Manual sync button
    document.getElementById('btn-manual-sync')?.addEventListener('click', async () => {
      await this.handleManualSync();
    });

    // Sync Master button
    document.getElementById('btn-sync-master')?.addEventListener('click', async () => {
      try {
        await this.ensureKeyUnlocked();
        if (!this.syncManager?.gasUrl) {
          alert('GAS Web App URL が設定されていません');
          return;
        }
        const config = await this.db.getMasterConfig();
        const snapshot = await this.db.getSnapshot();
        await this.syncManager.sendAction('update_master', { master_config: config });
        if (snapshot?.external_assets) {
          await this.syncManager.sendAction('update_external_assets', { external_assets: snapshot.external_assets });
        }
        alert('設定マスタおよび外部資産をGASへ送信しました！');
      } catch (err) {
        alert(`マスタ同期エラー: ${err.message}`);
      }
    });

    // Fetch remote state
    document.getElementById('btn-fetch-remote')?.addEventListener('click', async () => {
      try {
        await this.syncManager.fetchRemoteState();
        alert('リモート最新状態の取得が完了しました');
        await this.refreshAllViews();
      } catch (err) {
        alert(`リモート状態取得エラー: ${err.message}`);
      }
    });

    // Export backup
    document.getElementById('btn-export-backup')?.addEventListener('click', async () => {
      const backup = await this.db.exportFullData();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `yose_backup_${formatDate(new Date())}.json`;
      a.click();
      URL.revokeObjectURL(url);
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
        const data = JSON.parse(text);
        await this.db.importFullData(data);
        alert('バックアップの復元が完了しました！');
        await this.refreshAllViews();
      } catch (err) {
        alert(`インポート失敗: ${err.message}`);
      }
    });

    // One-click register key to GAS
    const registerInitialKeyHandler = async () => {
      try {
        await this.ensureKeyUnlocked();
        const gasUrl = await this.db.getSetting('gas_url', '');
        if (!gasUrl) {
          alert('先にGAS Web App URLを設定・保存してください');
          return;
        }
        if (!this.publicKeyBase64) {
          alert('公開鍵が生成されていません');
          return;
        }
        const res = await this.syncManager.registerInitialKey(this.publicKeyBase64);
        alert(`GASへ公開鍵を登録しました！\n${res.message || '登録成功'}`);
        await this.renderSettings();
      } catch (err) {
        alert(`公開鍵登録エラー: ${err.message}`);
      }
    };
    document.getElementById('btn-register-initial-key-gas')?.addEventListener('click', registerInitialKeyHandler);
    document.getElementById('btn-register-key-gas-direct')?.addEventListener('click', registerInitialKeyHandler);

    // Toggle key details
    document.getElementById('btn-toggle-key-details')?.addEventListener('click', () => {
      const details = document.getElementById('key-mgmt-details');
      if (details) {
        details.style.display = details.style.display === 'none' ? 'block' : 'none';
      }
    });

    // WebAuthn Passkey re-register
    document.getElementById('btn-register-webauthn')?.addEventListener('click', async () => {
      if (!isWebAuthnSupported()) {
        alert('お使いの環境はWebAuthn (Passkey) に対応していません');
        return;
      }
      try {
        const cred = await registerWebAuthnCredential('よせあつめ家計簿 ユーザー');
        await this.db.saveSecurityKey('webauthn_credential_id', cred.credentialId);
        if (this.privateKey) {
          const dmk = this.db.encryptionKey;
          if (dmk) {
            const dmkRaw = await exportKeyRaw(dmk);
            const privPkcs8 = await exportPrivateKeyPkcs8(this.privateKey);
            await this.db.saveSecurityKey('webauthn_vault', {
              dmk: bytesToBase64(dmkRaw),
              priv: bytesToBase64(privPkcs8)
            });
          }
        }
        alert('WebAuthn (Passkey) の登録に成功しました！');
      } catch (err) {
        alert(`WebAuthn登録エラー: ${err.message}`);
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
        txtMaster.value = JSON.stringify(config, null, 2);
        editor.style.display = 'block';
      } else {
        editor.style.display = 'none';
      }
    });

    btnSaveMaster?.addEventListener('click', async () => {
      try {
        const config = JSON.parse(txtMaster.value);
        await this.db.saveMasterConfig(config);
        alert('マスタ設定を保存しました');
        await this.refreshAllViews();
      } catch (err) {
        alert(`JSONフォーマットエラー: ${err.message}`);
      }
    });
  }

  async renderSettings() {
    this.updateKeyDisplay();
    const gasUrl = await this.db.getSetting('gas_url', '');
    const urlInput = document.getElementById('input-gas-url');
    if (urlInput) urlInput.value = gasUrl;

    const detailsGasUrl = document.getElementById('details-gas-url');
    const badgeGasUrl = document.getElementById('gas-url-status-badge');
    if (gasUrl) {
      if (badgeGasUrl) badgeGasUrl.textContent = '設定済';
      if (detailsGasUrl && !detailsGasUrl.dataset.userOpened) detailsGasUrl.removeAttribute('open');
    } else {
      if (badgeGasUrl) badgeGasUrl.textContent = '未設定';
      if (detailsGasUrl) detailsGasUrl.setAttribute('open', '');
    }

    const keyConfiguredBadge = document.getElementById('key-configured-badge');
    const keyConfiguredSummary = document.getElementById('key-configured-summary');
    const keyMgmtDetails = document.getElementById('key-mgmt-details');

    if (this.publicKeyBase64) {
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
    await this.renderMasterManagement();
  }

  setupMasterTabs() {
    const tabBtns = document.querySelectorAll('.master-tab-btn');
    const panels = document.querySelectorAll('.master-panel');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const masterType = btn.dataset.master;
        tabBtns.forEach(b => b.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));

        btn.classList.add('active');
        const panel = document.getElementById(`panel-master-${masterType}`);
        if (panel) panel.classList.add('active');
      });
    });

    document.getElementById('btn-close-master-modal')?.addEventListener('click', () => {
      document.getElementById('modal-master-item')?.classList.remove('active');
    });

    document.getElementById('btn-add-account')?.addEventListener('click', () => {
      this.openMasterModal('account', null);
    });

    document.getElementById('btn-add-category')?.addEventListener('click', () => {
      this.openMasterModal('category', null);
    });

    document.getElementById('btn-add-recurring')?.addEventListener('click', () => {
      this.openMasterModal('recurring', null);
    });

    document.getElementById('btn-add-asset')?.addEventListener('click', () => {
      this.openMasterModal('asset', null);
    });

    document.getElementById('btn-add-holiday')?.addEventListener('click', async () => {
      const input = document.getElementById('input-new-holiday');
      const val = input?.value;
      if (!val) {
        alert('祝日の日付を選択してください');
        return;
      }
      const config = await this.db.getMasterConfig();
      config.holidays = config.holidays || [];
      if (!config.holidays.includes(val)) {
        config.holidays.push(val);
        config.holidays.sort();
        await this.saveMasterConfigAndSync(config);
        if (input) input.value = '';
      } else {
        alert('指定された日付は既に祝日に登録されています');
      }
    });

    // Preset Japanese Holidays Import
    document.getElementById('btn-import-holidays-preset')?.addEventListener('click', async () => {
      const config = await this.db.getMasterConfig();
      config.holidays = config.holidays || [];
      const beforeCount = config.holidays.length;
      const set = new Set([...config.holidays, ...JAPANESE_HOLIDAYS_PRESET]);
      config.holidays = Array.from(set).sort();
      const addedCount = config.holidays.length - beforeCount;
      await this.saveMasterConfigAndSync(config);
      alert(`公式祝日プリセットから ${addedCount} 件の祝日を登録しました（合計: ${config.holidays.length} 件）`);
    });

    // Open/Close Holiday Modal
    document.getElementById('btn-open-holiday-modal')?.addEventListener('click', () => {
      document.getElementById('modal-holiday-import')?.classList.add('active');
    });

    document.getElementById('btn-close-holiday-modal')?.addEventListener('click', () => {
      document.getElementById('modal-holiday-import')?.classList.remove('active');
    });

    // Fetch from Online Holiday API
    document.getElementById('btn-fetch-holiday-api')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-fetch-holiday-api');
      if (btn) btn.textContent = '取得中...';
      try {
        const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const txt = document.getElementById('txt-holiday-import-input');
        if (txt) {
          txt.value = JSON.stringify(data, null, 2);
        }
        alert('祝日APIから最新データを取得しました。「インポート実行」を押して反映してください。');
      } catch (err) {
        alert(`祝日取得エラー: ${err.message} (オフライン時はプリセットインポートをご利用ください)`);
      } finally {
        if (btn) btn.textContent = '🌐 オンラインAPIから最新祝日を取得';
      }
    });

    // Confirm Holiday Import from Textarea
    document.getElementById('btn-confirm-import-holidays')?.addEventListener('click', async () => {
      const txt = document.getElementById('txt-holiday-import-input');
      const raw = txt?.value || '';
      const parsed = parseHolidayTextOrCsv(raw);
      if (parsed.length === 0) {
        alert('有効な日付が見つかりませんでした (形式例: 2026-01-01 または 2026/01/01)');
        return;
      }
      const config = await this.db.getMasterConfig();
      config.holidays = config.holidays || [];
      const beforeCount = config.holidays.length;
      const set = new Set([...config.holidays, ...parsed]);
      config.holidays = Array.from(set).sort();
      const addedCount = config.holidays.length - beforeCount;
      await this.saveMasterConfigAndSync(config);
      document.getElementById('modal-holiday-import')?.classList.remove('active');
      if (txt) txt.value = '';
      alert(`${parsed.length} 件の日付から新規に ${addedCount} 件の祝日を登録しました（合計: ${config.holidays.length} 件）`);
    });
  }

  async saveMasterConfigAndSync(config) {
    await this.db.saveMasterConfig(config);
    if (this.syncManager?.gasUrl && this.syncManager?.privateKey) {
      try {
        await this.syncManager.sendAction('update_master', { master_config: config });
      } catch (err) {
        console.warn('Sync master config to GAS deferred:', err.message);
      }
    }
    await this.refreshAllViews();
  }

  async saveExternalAssetsAndSync(assets) {
    const snapshot = await this.db.getSnapshot() || {};
    snapshot.external_assets = assets;
    snapshot.calculated_at = new Date().toISOString();
    await this.db.saveSnapshot(snapshot);

    if (this.syncManager?.gasUrl && this.syncManager?.privateKey) {
      try {
        await this.syncManager.sendAction('update_external_assets', { external_assets: assets });
      } catch (err) {
        console.warn('Sync external assets to GAS deferred:', err.message);
      }
    }
    await this.refreshAllViews();
  }

  async renderMasterManagement() {
    const config = await this.db.getMasterConfig();
    if (!config) return;

    // 1. Accounts
    const accList = document.getElementById('master-accounts-list');
    if (accList) {
      const accounts = config.accounts || [];
      accList.innerHTML = accounts.map(a => `
        <div class="master-item-row ${a.is_archived ? 'archived' : ''}">
          <div>
            <div style="font-weight: 600;">
              ${escapeHtml(a.name)}
              <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 6px;">(${escapeHtml(a.id)})</span>
              ${a.is_archived ? '<span class="badge badge-warning" style="margin-left: 6px;">アーカイブ</span>' : ''}
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">
              種別: ${escapeHtml(a.type)} | 初期残高: ¥${(a.initial_balance || 0).toLocaleString()}
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm btn-edit-account" data-id="${a.id}">編集</button>
            <button class="btn btn-secondary btn-sm btn-archive-account" data-id="${a.id}">
              ${a.is_archived ? '復元' : 'アーカイブ'}
            </button>
          </div>
        </div>
      `).join('') || '<div style="color: var(--text-muted); padding: 8px;">口座が登録されていません</div>';

      accList.querySelectorAll('.btn-edit-account').forEach(btn => {
        btn.addEventListener('click', () => {
          const acc = accounts.find(a => a.id === btn.dataset.id);
          if (acc) this.openMasterModal('account', acc);
        });
      });

      accList.querySelectorAll('.btn-archive-account').forEach(btn => {
        btn.addEventListener('click', async () => {
          const acc = accounts.find(a => a.id === btn.dataset.id);
          if (acc) {
            acc.is_archived = !acc.is_archived;
            await this.saveMasterConfigAndSync(config);
          }
        });
      });
    }

    // 2. Categories & Subcategories
    const catList = document.getElementById('master-categories-list');
    if (catList) {
      const categories = config.categories || [];
      catList.innerHTML = categories.map(c => `
        <div class="master-item-row ${c.is_archived ? 'archived' : ''}" style="flex-direction: column; align-items: stretch; gap: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div>
              <span style="font-weight: 600;">${escapeHtml(c.name)}</span>
              <span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 6px;">(${c.type === 'expense' ? '支出' : '収入'})</span>
              ${c.is_archived ? '<span class="badge badge-warning" style="margin-left: 6px;">アーカイブ</span>' : ''}
            </div>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-secondary btn-sm btn-add-subcat" data-id="${c.id}">+ 内訳追加</button>
              <button class="btn btn-secondary btn-sm btn-edit-cat" data-id="${c.id}">編集</button>
              <button class="btn btn-secondary btn-sm btn-archive-cat" data-id="${c.id}">
                ${c.is_archived ? '復元' : 'アーカイブ'}
              </button>
            </div>
          </div>
          <div class="subcat-list">
            ${(c.subcategories || []).map(s => `
              <span class="subcat-pill ${s.is_archived ? 'archived' : ''}">
                ${escapeHtml(s.name)}
                <button type="button" class="btn-edit-subcat" data-cat-id="${c.id}" data-sub-id="${s.id}" style="background:none;border:none;cursor:pointer;padding:0 2px;color:var(--primary);" title="編集">✏️</button>
                <button type="button" class="btn-archive-subcat" data-cat-id="${c.id}" data-sub-id="${s.id}" style="background:none;border:none;cursor:pointer;padding:0 2px;color:var(--text-muted);" title="${s.is_archived ? '復元' : 'アーカイブ'}">${s.is_archived ? '↩️' : '📦'}</button>
              </span>
            `).join('')}
          </div>
        </div>
      `).join('') || '<div style="color: var(--text-muted); padding: 8px;">費目が登録されていません</div>';

      catList.querySelectorAll('.btn-edit-cat').forEach(btn => {
        btn.addEventListener('click', () => {
          const cat = categories.find(c => c.id === btn.dataset.id);
          if (cat) this.openMasterModal('category', cat);
        });
      });

      catList.querySelectorAll('.btn-archive-cat').forEach(btn => {
        btn.addEventListener('click', async () => {
          const cat = categories.find(c => c.id === btn.dataset.id);
          if (cat) {
            cat.is_archived = !cat.is_archived;
            await this.saveMasterConfigAndSync(config);
          }
        });
      });

      catList.querySelectorAll('.btn-add-subcat').forEach(btn => {
        btn.addEventListener('click', () => {
          const cat = categories.find(c => c.id === btn.dataset.id);
          if (cat) this.openMasterModal('subcategory', null, cat);
        });
      });

      catList.querySelectorAll('.btn-edit-subcat').forEach(btn => {
        btn.addEventListener('click', () => {
          const cat = categories.find(c => c.id === btn.dataset.catId);
          const sub = cat?.subcategories?.find(s => s.id === btn.dataset.subId);
          if (cat && sub) this.openMasterModal('subcategory', sub, cat);
        });
      });

      catList.querySelectorAll('.btn-archive-subcat').forEach(btn => {
        btn.addEventListener('click', async () => {
          const cat = categories.find(c => c.id === btn.dataset.catId);
          const sub = cat?.subcategories?.find(s => s.id === btn.dataset.subId);
          if (sub) {
            sub.is_archived = !sub.is_archived;
            await this.saveMasterConfigAndSync(config);
          }
        });
      });
    }

    // 3. Recurring Rules
    const recList = document.getElementById('master-recurring-list');
    if (recList) {
      const rules = config.recurring_rules || [];
      recList.innerHTML = rules.map(r => `
        <div class="master-item-row ${!r.is_active ? 'archived' : ''}">
          <div>
            <div style="font-weight: 600;">
              ${r.name}
              <span class="badge ${r.is_active ? 'badge-success' : 'badge-warning'}" style="margin-left: 6px;">
                ${r.is_active ? '有効' : '停止中'}
              </span>
            </div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">
              毎月${r.day_of_month}日 | ¥${(r.amount || 0).toLocaleString()} | ${r.type} | 口座: ${r.account_id}
            </div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-secondary btn-sm btn-edit-recurring" data-id="${r.id}">編集</button>
            <button class="btn btn-secondary btn-sm btn-toggle-recurring" data-id="${r.id}">
              ${r.is_active ? '無効化' : '有効化'}
            </button>
            <button class="btn btn-danger btn-sm btn-delete-recurring" data-id="${r.id}">削除</button>
          </div>
        </div>
      `).join('') || '<div style="color: var(--text-muted); padding: 8px;">定期ルールが登録されていません</div>';

      recList.querySelectorAll('.btn-edit-recurring').forEach(btn => {
        btn.addEventListener('click', () => {
          const rule = rules.find(r => r.id === btn.dataset.id);
          if (rule) this.openMasterModal('recurring', rule);
        });
      });

      recList.querySelectorAll('.btn-toggle-recurring').forEach(btn => {
        btn.addEventListener('click', async () => {
          const rule = rules.find(r => r.id === btn.dataset.id);
          if (rule) {
            rule.is_active = !rule.is_active;
            await this.saveMasterConfigAndSync(config);
          }
        });
      });

      recList.querySelectorAll('.btn-delete-recurring').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (confirm('この定期予定ルールを削除しますか？')) {
            config.recurring_rules = config.recurring_rules.filter(r => r.id !== btn.dataset.id);
            await this.saveMasterConfigAndSync(config);
          }
        });
      });
    }

    // 4. Holidays
    const holList = document.getElementById('master-holidays-list');
    if (holList) {
      const holidays = config.holidays || [];
      const grouped = groupHolidaysByYear(holidays);
      const years = Object.keys(grouped).sort();

      if (years.length === 0) {
        holList.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">祝日が登録されていません</div>';
      } else {
        holList.innerHTML = years.map(year => {
          const list = grouped[year];
          return `
            <details class="holiday-year-group">
              <summary>
                <span>📅 <strong>${year}年</strong> (${list.length}日)</span>
                <span style="font-size: 0.8rem; color: var(--text-muted);">開閉 ▼</span>
              </summary>
              <div class="holiday-year-content subcat-list">
                ${list.map(h => `
                  <span class="subcat-pill">
                    ${h}
                    <span class="btn-icon-del btn-del-holiday" data-date="${h}" title="削除">&times;</span>
                  </span>
                `).join('')}
              </div>
            </details>
          `;
        }).join('');

        holList.querySelectorAll('.btn-del-holiday').forEach(btn => {
          btn.addEventListener('click', async () => {
            const dt = btn.dataset.date;
            config.holidays = config.holidays.filter(h => h !== dt);
            await this.saveMasterConfigAndSync(config);
          });
        });
      }
    }
  }

  async openMasterModal(type, item, parentItem = null) {
    const modal = document.getElementById('modal-master-item');
    const title = document.getElementById('master-modal-title');
    const body = document.getElementById('master-modal-body');
    if (!modal || !title || !body) return;

    const config = await this.db.getMasterConfig();

    if (type === 'account') {
      const isNew = !item;
      title.textContent = isNew ? '🏦 新規口座の追加' : `🏦 口座の編集: ${item.name}`;
      body.innerHTML = `
        <form id="form-master-account">
          <div class="form-group">
            <label class="form-label" for="m-acc-id">口座ID (英数記号)</label>
            <input type="text" id="m-acc-id" class="form-control" value="${item?.id || 'acc_' + Date.now().toString(36)}" ${!isNew ? 'readonly' : ''} required>
          </div>
          <div class="form-group">
            <label class="form-label" for="m-acc-name">口座名・表記</label>
            <input type="text" id="m-acc-name" class="form-control" value="${item?.name || ''}" placeholder="例: メイン銀行口座" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="m-acc-type">口座種別</label>
              <select id="m-acc-type" class="form-control">
                <option value="bank" ${item?.type === 'bank' ? 'selected' : ''}>銀行預金 (bank)</option>
                <option value="cash" ${item?.type === 'cash' ? 'selected' : ''}>現金 (cash)</option>
                <option value="investment" ${item?.type === 'investment' ? 'selected' : ''}>証券・投資信託・積立NISA (investment)</option>
                <option value="credit_card" ${item?.type === 'credit_card' ? 'selected' : ''}>クレジットカード (credit_card)</option>
                <option value="point" ${item?.type === 'point' ? 'selected' : ''}>ポイント・電子マネー (point)</option>
                <option value="receivable" ${item?.type === 'receivable' ? 'selected' : ''}>立替債権 (receivable)</option>
                <option value="prepaid" ${item?.type === 'prepaid' ? 'selected' : ''}>前払費用 (prepaid)</option>
                <option value="asset" ${item?.type === 'asset' ? 'selected' : ''}>その他資産 (asset)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="m-acc-init-bal">初期残高 (円)</label>
              <input type="number" id="m-acc-init-bal" class="form-control" value="${item?.initial_balance ?? 0}" step="1">
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button type="submit" class="btn btn-primary btn-block">保存する</button>
          </div>
        </form>
      `;

      document.getElementById('form-master-account')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('m-acc-id').value.trim();
        const name = document.getElementById('m-acc-name').value.trim();
        const accType = document.getElementById('m-acc-type').value;
        const initBal = Number(document.getElementById('m-acc-init-bal').value) || 0;

        config.accounts = config.accounts || [];
        if (isNew) {
          config.accounts.push({
            id,
            name,
            type: accType,
            currency: 'JPY',
            initial_balance: initBal,
            is_asset: accType !== 'credit_card',
            sort_order: config.accounts.length + 1,
            is_archived: false
          });
        } else {
          item.name = name;
          item.type = accType;
          item.initial_balance = initBal;
          item.is_asset = accType !== 'credit_card';
        }

        modal.classList.remove('active');
        await this.saveMasterConfigAndSync(config);
      });

    } else if (type === 'category') {
      const isNew = !item;
      title.textContent = isNew ? '📁 新規費目の追加' : `📁 費目の編集: ${item.name}`;
      body.innerHTML = `
        <form id="form-master-category">
          <div class="form-group">
            <label class="form-label" for="m-cat-id">費目ID (英数記号)</label>
            <input type="text" id="m-cat-id" class="form-control" value="${item?.id || 'cat_' + Date.now().toString(36)}" ${!isNew ? 'readonly' : ''} required>
          </div>
          <div class="form-group">
            <label class="form-label" for="m-cat-name">費目名</label>
            <input type="text" id="m-cat-name" class="form-control" value="${item?.name || ''}" placeholder="例: 食費" required>
          </div>
          <div class="form-group">
            <label class="form-label" for="m-cat-type">収支種別</label>
            <select id="m-cat-type" class="form-control">
              <option value="expense" ${item?.type === 'expense' ? 'selected' : ''}>支出 (expense)</option>
              <option value="income" ${item?.type === 'income' ? 'selected' : ''}>収入 (income)</option>
            </select>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button type="submit" class="btn btn-primary btn-block">保存する</button>
          </div>
        </form>
      `;

      document.getElementById('form-master-category')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('m-cat-id').value.trim();
        const name = document.getElementById('m-cat-name').value.trim();
        const catType = document.getElementById('m-cat-type').value;

        config.categories = config.categories || [];
        if (isNew) {
          config.categories.push({
            id,
            name,
            type: catType,
            sort_order: config.categories.length + 1,
            is_archived: false,
            subcategories: []
          });
        } else {
          item.name = name;
          item.type = catType;
        }

        modal.classList.remove('active');
        await this.saveMasterConfigAndSync(config);
      });

    } else if (type === 'subcategory') {
      const isNew = !item;
      title.textContent = isNew ? `🏷️ 内訳項目の追加 (${parentItem?.name})` : `🏷️ 内訳の編集: ${item.name}`;
      body.innerHTML = `
        <form id="form-master-subcategory">
          <div class="form-group">
            <label class="form-label" for="m-sub-id">内訳ID (英数記号)</label>
            <input type="text" id="m-sub-id" class="form-control" value="${item?.id || 'sub_' + Date.now().toString(36)}" ${!isNew ? 'readonly' : ''} required>
          </div>
          <div class="form-group">
            <label class="form-label" for="m-sub-name">内訳名</label>
            <input type="text" id="m-sub-name" class="form-control" value="${item?.name || ''}" placeholder="例: 自炊食材" required>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button type="submit" class="btn btn-primary btn-block">保存する</button>
          </div>
        </form>
      `;

      document.getElementById('form-master-subcategory')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('m-sub-id').value.trim();
        const name = document.getElementById('m-sub-name').value.trim();

        if (parentItem) {
          parentItem.subcategories = parentItem.subcategories || [];
          if (isNew) {
            parentItem.subcategories.push({
              id,
              name,
              sort_order: parentItem.subcategories.length + 1,
              is_archived: false
            });
          } else {
            item.name = name;
          }
        }

        modal.classList.remove('active');
        await this.saveMasterConfigAndSync(config);
      });

    } else if (type === 'recurring') {
      const isNew = !item;
      title.textContent = isNew ? '📅 新規定期ルールの追加' : `📅 定期ルールの編集: ${item.name}`;

      const activeAccounts = (config.accounts || []).filter(a => !a.is_archived);
      const activeCats = (config.categories || []).filter(c => !c.is_archived);

      body.innerHTML = `
        <form id="form-master-recurring">
          <div class="form-group">
            <label class="form-label" for="m-rec-id">ルールID</label>
            <input type="text" id="m-rec-id" class="form-control" value="${item?.id || 'rec_' + Date.now().toString(36)}" ${!isNew ? 'readonly' : ''} required>
          </div>
          <div class="form-group">
            <label class="form-label" for="m-rec-name">ルール名</label>
            <input type="text" id="m-rec-name" class="form-control" value="${item?.name || ''}" placeholder="例: 家賃" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="m-rec-type">取引種別</label>
              <select id="m-rec-type" class="form-control">
                <option value="expense" ${item?.type === 'expense' ? 'selected' : ''}>支出</option>
                <option value="income" ${item?.type === 'income' ? 'selected' : ''}>収入</option>
                <option value="transfer" ${item?.type === 'transfer' ? 'selected' : ''}>振替</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="m-rec-amount">想定金額 (円)</label>
              <input type="number" id="m-rec-amount" class="form-control" value="${item?.amount || ''}" required min="0" step="1">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="m-rec-account">決済口座</label>
              <select id="m-rec-account" class="form-control" required>
                ${activeAccounts.map(a => `<option value="${a.id}" ${item?.account_id === a.id ? 'selected' : ''}>${a.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="m-rec-cat">大項目</label>
              <select id="m-rec-cat" class="form-control">
                ${activeCats.map(c => `<option value="${c.id}" ${item?.category_id === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="m-rec-day">発生日 (毎月何日: 1-31)</label>
              <input type="number" id="m-rec-day" class="form-control" min="1" max="31" value="${item?.day_of_month || 25}" required>
            </div>
            <div class="form-group">
              <label class="form-label" for="m-rec-holiday">休日補正ルール</label>
              <select id="m-rec-holiday" class="form-control">
                <option value="none" ${item?.holiday_adjustment === 'none' ? 'selected' : ''}>補正なし (none)</option>
                <option value="before" ${item?.holiday_adjustment === 'before' ? 'selected' : ''}>前営業日へ前倒し (before)</option>
                <option value="after" ${item?.holiday_adjustment === 'after' ? 'selected' : ''}>翌営業日へ後ろ倒し (after)</option>
              </select>
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button type="submit" class="btn btn-primary btn-block">保存する</button>
          </div>
        </form>
      `;

      document.getElementById('form-master-recurring')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('m-rec-id').value.trim();
        const name = document.getElementById('m-rec-name').value.trim();
        const recType = document.getElementById('m-rec-type').value;
        const amount = Number(document.getElementById('m-rec-amount').value) || 0;
        const accId = document.getElementById('m-rec-account').value;
        const catId = document.getElementById('m-rec-cat').value;
        const day = Number(document.getElementById('m-rec-day').value) || 25;
        const holidayAdj = document.getElementById('m-rec-holiday').value;

        config.recurring_rules = config.recurring_rules || [];
        if (isNew) {
          config.recurring_rules.push({
            id,
            name,
            is_active: true,
            start_date: formatDate(new Date()).slice(0, 7) + '-01',
            end_date: null,
            frequency: 'interval_months',
            interval_months: 1,
            day_of_month: day,
            holiday_adjustment: holidayAdj,
            amortize_months: 1,
            type: recType,
            amount,
            account_id: accId,
            to_account_id: null,
            category_id: catId,
            subcategory_id: null
          });
        } else {
          item.name = name;
          item.type = recType;
          item.amount = amount;
          item.account_id = accId;
          item.category_id = catId;
          item.day_of_month = day;
          item.holiday_adjustment = holidayAdj;
        }

        modal.classList.remove('active');
        await this.saveMasterConfigAndSync(config);
      });

    } else if (type === 'asset') {
      const isNew = !item;
      title.textContent = isNew ? '📈 新規外部資産の追加' : `📈 外部資産の編集: ${item.name}`;
      const val = item?.market_value ?? item?.current_value ?? 0;
      body.innerHTML = `
        <form id="form-master-asset">
          <div class="form-group">
            <label class="form-label" for="m-ast-id">資産ID</label>
            <input type="text" id="m-ast-id" class="form-control" value="${item?.id || 'sec_' + Date.now().toString(36)}" ${!isNew ? 'readonly' : ''} required>
          </div>
          <div class="form-group">
            <label class="form-label" for="m-ast-name">銘柄名・資産名</label>
            <input type="text" id="m-ast-name" class="form-control" value="${item?.name || ''}" placeholder="例: 全世界株投信" required>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="m-ast-val">最新評価額 (円)</label>
              <input type="number" id="m-ast-val" class="form-control" value="${val}" step="1" required>
            </div>
          </div>
          <div style="display: flex; gap: 8px; margin-top: 16px;">
            <button type="submit" class="btn btn-primary btn-block">保存する</button>
          </div>
        </form>
      `;

      document.getElementById('form-master-asset')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('m-ast-id').value.trim();
        const name = document.getElementById('m-ast-name').value.trim();
        const marketVal = Number(document.getElementById('m-ast-val').value) || 0;

        const snapshot = await this.db.getSnapshot() || {};
        const assets = snapshot.external_assets || [];

        if (isNew) {
          assets.push({
            id,
            name,
            market_value: marketVal,
            updated_at: new Date().toISOString()
          });
        } else {
          item.name = name;
          item.market_value = marketVal;
          item.updated_at = new Date().toISOString();
        }

        modal.classList.remove('active');
        await this.saveExternalAssetsAndSync(assets);
      });
    }

    modal.classList.add('active');
  }

  async handleManualSync() {
    try {
      await this.ensureKeyUnlocked();
      const res = await this.syncManager.syncPendingDiffs();
      if (res.status === 'up_to_date') {
        alert('同期対象の未同期データはありません（すべて最新です）');
      } else {
        alert(`差分同期完了: ${res.synced_count} 件のデータを同期しました`);
      }
    } catch (err) {
      alert(`同期に失敗しました: ${err.message}`);
    } finally {
      await this.refreshAllViews();
    }
  }

  async refreshAllViews() {
    await this.populateMasterDropdowns();
    await this.renderRecentTransactions();
    await this.renderSummary();
    await this.renderSettings();
    await this.updateSyncBadge();
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

export { AppController };

