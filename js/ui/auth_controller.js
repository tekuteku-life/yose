/** PINで暗号鍵を保護し、通常WebAuthnを認証に使用するコントローラである。 */
import {
	generateEd25519KeyPair, exportPublicKeyBase64, importPublicKeyBase64,
	exportPrivateKeyPkcs8, importPrivateKeyPkcs8, generateDatabaseMasterKey,
	exportKeyRaw, importAesKeyRaw, encryptMasterKeysWithPin, decryptMasterKeysWithPin,
	isWebAuthnSupported, authenticateWithWebAuthn, setActiveSession, clearActiveSession
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
	get db() { return this.coordinator.db; }
	get syncManager() { return this.coordinator.syncManager; }

	async unlockWithPin(pin) {
		const pkg = await this.db.getSecurityKey('master_keys_package');
		if (!pkg) throw new Error('暗号化された鍵が見つかりません');
		const unpacked = await decryptMasterKeysWithPin(pkg, pin);
		const dmk = await importAesKeyRaw(unpacked.dmkRaw);
		const priv = await importPrivateKeyPkcs8(unpacked.privateKeyPkcs8);
		this.db.setEncryptionKey(dmk);
		try {
			// Verify the existing encrypted data before removing obsolete recovery values.
			const config = await this.db.getMasterConfig();
			await this.db.getSnapshot();
			await this.db.getTransactions({ includeDeleted: true });
			if (config?.synced_passkey_bundle) {
				delete config.synced_passkey_bundle;
				await this.db.saveMasterConfig(config);
			}
			await this.db.deleteSecurityKey('webauthn_vault');
			await this.db.deleteSecurityKey('webauthn_credential_id');
			this.privateKey = priv;
			this.isKeyLocked = false;
			this.isKeyProtectedWithPin = true;
			setActiveSession(dmk, priv);
			this.syncManager?.setPrivateKey(priv);
		} catch (error) {
			this.db.clearEncryptionKey();
			throw error;
		}
	}

	async initSecurityAndAuthGate() {
		const screen = document.getElementById('auth-screen');
		const error = document.getElementById('auth-error-msg');
		const pkg = await this.db.getSecurityKey('master_keys_package');
		this.publicKeyBase64 = await this.db.getSecurityKey('public_key_base64') || '';
		if (this.publicKeyBase64) this.publicKey = await importPublicKeyBase64(this.publicKeyBase64);
		const showError = message => { error.textContent = message; error.style.display = 'block'; };
		const unlock = async () => {
			try {
				error.style.display = 'none';
				const input = document.getElementById('auth-pin-input');
				await this.unlockWithPin(input.value.trim());
				input.value = '';
				screen.classList.add('hidden');
				await this.coordinator.finishAppInit();
			} catch (err) { showError('PINコードが正しくありません。または暗号化データを復号できません。'); }
		};
		document.getElementById('btn-auth-pin')?.addEventListener('click', unlock);
		document.getElementById('auth-pin-input')?.addEventListener('keydown', event => { if (event.key === 'Enter') unlock(); });
		document.getElementById('btn-auth-webauthn')?.addEventListener('click', async () => {
			try {
				error.style.display = 'none';
				const credential = await this.db.getSecurityKey('webauthn_credential');
				await authenticateWithWebAuthn(credential);
				document.getElementById('auth-description').textContent = 'パスキー認証が完了しました。データを復号するPINを入力してください。';
				document.getElementById('auth-pin-input')?.focus();
			} catch (err) { showError('パスキー認証がキャンセルされたか失敗しました。PINで解除できます。'); }
		});
		if (pkg) {
			this.isKeyProtectedWithPin = true;
			await this.showLockScreen();
			return;
		}
		screen.classList.remove('hidden');
		document.getElementById('auth-title').textContent = 'よせあつめ家計簿 - 初期設定';
		document.getElementById('auth-description').textContent = 'データ保護用のPINコード（4桁以上）を設定してください。パスキーは設定画面から登録できます。';
		document.getElementById('auth-webauthn-container').style.display = 'none';
		document.getElementById('auth-pin-container').style.display = 'none';
		document.getElementById('auth-setup-container').style.display = 'block';
		document.getElementById('btn-auth-setup')?.addEventListener('click', async () => {
			const input = document.getElementById('auth-setup-pin');
			const pin = input.value.trim();
			if (pin.length < 4) { showError('PINコードは4桁以上を入力してください'); return; }
			try {
				const dmk = await generateDatabaseMasterKey();
				const kp = await generateEd25519KeyPair();
				this.publicKey = kp.publicKey;
				this.publicKeyBase64 = await exportPublicKeyBase64(kp.publicKey);
				const wrapped = await encryptMasterKeysWithPin({ dmkRaw: await exportKeyRaw(dmk), privateKeyPkcs8: await exportPrivateKeyPkcs8(kp.privateKey) }, pin);
				await this.db.saveSecurityKey('public_key_base64', this.publicKeyBase64);
				await this.db.saveSecurityKey('master_keys_package', wrapped);
				await this.unlockWithPin(pin);
				await this.db.saveMasterConfig(await this.db.getMasterConfig());
				await this.db.saveSnapshot(await this.db.getSnapshot());
				input.value = '';
				screen.classList.add('hidden');
				await this.coordinator.finishAppInit();
			} catch (err) { showError(`初期化エラー: ${err.message}`); }
		});
	}

	async showLockScreen() {
		this.isKeyLocked = true;
		document.getElementById('auth-error-msg').style.display = 'none';
		document.getElementById('auth-title').textContent = '🔐 よせあつめ家計簿';
		document.getElementById('auth-description').textContent = 'データはPINで暗号化されています。パスキーで認証する場合も、復号にはPINを入力してください。';
		document.getElementById('auth-setup-container').style.display = 'none';
		document.getElementById('auth-pin-container').style.display = 'block';
		const credential = await this.db.getSecurityKey('webauthn_credential');
		document.getElementById('auth-webauthn-container').style.display = credential && isWebAuthnSupported() ? 'block' : 'none';
		document.getElementById('auth-screen').classList.remove('hidden');
	}

	async generateNewKeyPair() {
		try {
			if (!this.db.encryptionKey) {
				alert('DBがロックされています。鍵ペアを再生成する前にPINでロック解除してください。');
				return;
			}
			const pin = prompt('新しい鍵ペアを保護するための現在のPINコードを入力してください:');
			if (!pin) {
				alert('PINコードが入力されなかったため、鍵ペアの再生成を中止しました。');
				return;
			}

			const masterPkg = await this.db.getSecurityKey('master_keys_package');
			if (masterPkg) {
				try {
					await decryptMasterKeysWithPin(masterPkg, pin);
				} catch (e) {
					alert('PINコードが正しくありません。鍵ペアの再生成を中止しました。');
					return;
				}
			}

			const kp = await generateEd25519KeyPair();
			this.privateKey = kp.privateKey;
			this.publicKey = kp.publicKey;
			this.publicKeyBase64 = await exportPublicKeyBase64(kp.publicKey);

			await this.db.saveSecurityKey('public_key_base64', this.publicKeyBase64);

			// Re-wrap master_keys_package with existing DMK and new private key
			const dmkRaw = await exportKeyRaw(this.db.encryptionKey);
			const privPkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);
			const newPkg = await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8: privPkcs8 }, pin);
			await this.db.saveSecurityKey('master_keys_package', newPkg);

			this.isKeyLocked = false;
			setActiveSession(this.db.encryptionKey, kp.privateKey);

			if (this.syncManager) {
				this.syncManager.setPrivateKey(this.privateKey);
			}
			this.updateKeyDisplay();

			const webauthnId = await this.db.getSecurityKey('webauthn_credential');
			if (webauthnId) {
				alert('新しいEd25519鍵ペアを生成し、PINで保護しました。\nWebAuthn（Passkey）をご利用の場合は、設定画面のボタンからWebAuthnを再登録してください。');
			} else {
				alert('新しいEd25519鍵ペアを生成し、PINで保護しました。');
			}
		} catch (err) {
			console.warn('Failed to generate Ed25519 key pair:', err);
			alert(`鍵ペアの再生成に失敗しました: ${err.message}`);
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
					banner.innerHTML = `<span>🔒 <strong>秘密鍵・DBはPINで保護されています（現在ロック中）</strong></span>`;
					if (btnUnlock) btnUnlock.style.display = 'inline-block';
					if (btnLock) btnLock.style.display = 'none';
					if (btnRemove) btnRemove.style.display = 'none';
					if (inputPin) inputPin.placeholder = '新しいPINを設定する場合に入力';
				} else {
					banner.className = 'security-banner unlocked';
					banner.innerHTML = `<span>🔓 <strong>秘密鍵・DBのロック解除中（暗号化セッション有効）</strong></span>`;
					if (btnUnlock) btnUnlock.style.display = 'none';
					if (btnLock) btnLock.style.display = 'inline-block';
					if (btnRemove) btnRemove.style.display = 'none';
					if (inputPin) inputPin.placeholder = '新しいPINに変更する場合に入力';
				}
			} else {
				banner.className = 'security-banner unprotected';
				banner.innerHTML = `<span>⚠️ 秘密鍵は現在PIN保護されていません</span>`;
				if (btnUnlock) btnUnlock.style.display = 'none';
				if (btnLock) btnLock.style.display = 'none';
				if (btnRemove) btnRemove.style.display = 'none';
				if (inputPin) inputPin.placeholder = 'PINコード (4桁以上)';
			}
		}
	}

	async promptPinUnlock() {
		const modal = document.getElementById('modal-pin-unlock');
		const input = document.getElementById('input-unlock-pin');
		const submit = document.getElementById('btn-submit-unlock-pin');
		const cancel = document.getElementById('btn-close-pin-modal');
		if (!modal || !input) return false;
		modal.classList.add('active'); input.value = ''; input.focus();
		return new Promise(resolve => {
			const finish = result => {
				modal.classList.remove('active'); input.value = '';
				submit.removeEventListener('click', onSubmit); cancel.removeEventListener('click', onCancel); input.removeEventListener('keydown', onKey);
				resolve(result);
			};
			const onSubmit = async () => {
				try { await this.unlockWithPin(input.value); this.updateKeyDisplay(); finish(true); }
				catch (error) { alert('PINコードが正しくありません。再試行してください。'); }
			};
			const onCancel = () => finish(false);
			const onKey = event => { if (event.key === 'Enter') { event.preventDefault(); onSubmit(); } };
			submit.addEventListener('click', onSubmit); cancel.addEventListener('click', onCancel); input.addEventListener('keydown', onKey);
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

		await this.showLockScreen();

		alert('秘密鍵およびDB暗号化セッションをロックしました');
	}

	async removePinProtection() {
		alert('データベース完全暗号化（Zero-Trust DMK）のため、PIN保護の解除（平文保存への移行）は無効化されています。端末セキュリティを維持するためPIN保護をご利用ください。');
	}
}

