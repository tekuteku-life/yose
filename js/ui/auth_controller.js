/**
 * Yoseatsume Kakeibo - Auth & Security Controller
 * Manages Auth Gate, PIN Protection, WebAuthn Passkeys, and DMK in-memory lifecycle.
 */

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
	encryptMasterKeysWithPin,
	decryptMasterKeysWithPin,
	isWebAuthnSupported,
	registerWebAuthnCredential,
	authenticateWithWebAuthn,
	setActiveSession,
	clearActiveSession,
	bytesToBase64,
	base64ToBytes
} from '../crypto.js';

export class AuthController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.privateKey = null;
		this.publicKey = null;
		this.publicKeyBase64 = '';
		this.isKeyProtectedWithPin = false;
		this.isKeyLocked = false;
	}

	get db() {
		return this.coordinator.db;
	}

	get syncManager() {
		return this.coordinator.syncManager;
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
					await this.coordinator.finishAppInit();
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
						await this.coordinator.finishAppInit();
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
				await this.coordinator.finishAppInit();
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
}

