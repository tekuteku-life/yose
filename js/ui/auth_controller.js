/** PINまたはPRF対応パスキーで暗号鍵を解除するコントローラである。 */
import {
	generateEd25519KeyPair, exportPublicKeyBase64, importPublicKeyBase64,
	exportPrivateKeyPkcs8, importPrivateKeyPkcs8, generateDatabaseMasterKey,
	exportKeyRaw, importAesKeyRaw, encryptMasterKeysWithPin, decryptMasterKeysWithPin,
	isWebAuthnSupported, registerWebAuthnCredential, authenticateWithWebAuthn, setActiveSession, clearActiveSession,
	bytesToBase64, encryptMasterKeysWithPrf, decryptMasterKeysWithPrf,
	signPayload, verifySignature, canonicalJsonStringify
} from '../crypto.js';

export class AuthController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.privateKey = null;
		this.publicKey = null;
		this.publicKeyBase64 = '';
		this.isKeyLocked = false;
		this.authGeneration = 0;
	}
	get db() { return this.coordinator.db; }
	get syncManager() { return this.coordinator.syncManager; }

	async unlockWithPin(pin) {
		const generation = ++this.authGeneration;
		const pkg = await this.db.getSecurityKey('master_keys_package');
		if (!pkg) throw new Error('暗号化された鍵が見つかりません');
		const unpacked = await decryptMasterKeysWithPin(pkg, pin);
		await this.restoreMasterKeys(unpacked, generation);
	}

	async restoreMasterKeys(unpacked, generation, credential = null) {
		let dmk;
		try {
			dmk = await importAesKeyRaw(unpacked.dmkRaw);
			const priv = await importPrivateKeyPkcs8(unpacked.privateKeyPkcs8);
			const publicKeyBase64 = await this.db.getSecurityKey('public_key_base64');
			const publicKey = await importPublicKeyBase64(publicKeyBase64);
			const proof = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
			if (!await verifySignature(publicKey, await signPayload(priv, proof), proof)) throw new Error('保存公開鍵と署名鍵が一致しません。');
			if (generation !== this.authGeneration) throw new Error('認証状態が変更されました。');
			this.db.setEncryptionKey(dmk);
			// Verify the existing encrypted data before removing obsolete recovery values.
			const config = await this.db.getMasterConfig();
			await this.db.getSnapshot();
			await this.db.getTransactions({ includeDeleted: true });
			if (config?.synced_passkey_bundle) {
				await this.db.mutateMasterConfig(current => { delete current.synced_passkey_bundle; return current; });
			}
			await this.db.deleteSecurityKey('webauthn_vault');
			await this.db.deleteSecurityKey('webauthn_credential_id');
			await this.db.deleteSecurityKey('webauthn_user_id');
			if (publicKeyBase64 !== await this.db.getSecurityKey('public_key_base64') || (credential && canonicalJsonStringify(credential) !== canonicalJsonStringify(await this.db.getSecurityKey('webauthn_credential')))) throw new Error('保存済み認証鍵が変更されました。');
			if (generation !== this.authGeneration || this.db.encryptionKey !== dmk) throw new Error('認証状態が変更されました。');
			this.publicKey = publicKey; this.publicKeyBase64 = publicKeyBase64;
			this.privateKey = priv;
			this.isKeyLocked = false;
			setActiveSession(dmk, priv);
			this.syncManager?.setPrivateKey(priv);
		} catch (error) {
			if (this.db.encryptionKey === dmk) this.db.clearEncryptionKey();
			throw error;
		} finally { unpacked.dmkRaw.fill(0); unpacked.privateKeyPkcs8.fill(0); }
	}

	async registerPasskey() {
		await this.ensureKeyUnlocked();
		const generation = ++this.authGeneration, dmk = this.db.encryptionKey, privateKey = this.privateKey;
		const valid = () => generation === this.authGeneration && this.db.encryptionKey === dmk && this.privateKey === privateKey && !this.isKeyLocked;
		let output, dmkRaw, privateKeyPkcs8;
		try {
			// A distinct user handle prevents create() from replacing the still-active old credential.
			const credential = await registerWebAuthnCredential('よせあつめ家計簿 ユーザー', undefined, { userId: crypto.getRandomValues(new Uint8Array(32)) });
			const auth = await authenticateWithWebAuthn(credential); output = auth.prfOutput;
			let prfWrap;
			if (output) {
				dmkRaw = await exportKeyRaw(dmk); privateKeyPkcs8 = await exportPrivateKeyPkcs8(privateKey);
				prfWrap = await encryptMasterKeysWithPrf({ dmkRaw, privateKeyPkcs8 }, output, credential);
			}
			if (!valid()) throw new Error('認証状態が変更されました。再登録してください。');
			await this.db.saveSecurityKey('webauthn_credential', { ...credential, ...(prfWrap ? { prfWrap } : {}) }, { isSessionValid: valid });
			return Boolean(prfWrap);
		} finally { output?.fill(0); dmkRaw?.fill(0); privateKeyPkcs8?.fill(0); }
	}

	async unlockWithPasskey() {
		const generation = ++this.authGeneration;
		const credential = await this.db.getSecurityKey('webauthn_credential');
		const auth = await authenticateWithWebAuthn(credential);
		try {
			if (generation !== this.authGeneration || canonicalJsonStringify(credential) !== canonicalJsonStringify(await this.db.getSecurityKey('webauthn_credential'))) throw new Error('パスキーの登録状態が変更されました。');
			if (!credential.prfWrap) return false;
			const unpacked = await decryptMasterKeysWithPrf(credential.prfWrap, auth.prfOutput, credential);
			await this.restoreMasterKeys(unpacked, generation, credential);
			return true;
		} finally { auth.prfOutput?.fill(0); }
	}

	invalidateSession() {
		this.authGeneration++;
		this.coordinator.advanceLinkController?.cancel();
		this.coordinator.bulkEditController?.cancel();
		this.coordinator.insightsController?.cancel();
		this.coordinator.furusatoController?.cancel();
		if (this.coordinator.summaryController) {
			this.coordinator.summaryController.renderVersion++;
			this.coordinator.summaryController.assetHistoryGeneration = (this.coordinator.summaryController.assetHistoryGeneration || 0) + 1;
		}
		this.coordinator.txListController.cancelPendingRenders();
		this.privateKey = null; this.isKeyLocked = true;
		this.db.clearEncryptionKey(); clearActiveSession(); this.syncManager?.setPrivateKey(null);
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
				if (await this.unlockWithPasskey()) {
					document.getElementById('auth-pin-input').value = '';
					screen.classList.add('hidden'); await this.coordinator.finishAppInit();
				} else {
					document.getElementById('auth-description').textContent = 'パスキー認証が完了しました。この登録では復号するPINを入力してください。PIN省略には対応パスキーを再登録してください。';
					document.getElementById('auth-pin-input')?.focus();
				}
			} catch (err) { showError('パスキー認証がキャンセルされたか失敗しました。PINで解除できます。'); }
		});
		if (pkg) {
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
		this.invalidateSession();
		document.getElementById('auth-error-msg').style.display = 'none';
		document.getElementById('auth-title').textContent = '🔐 よせあつめ家計簿';
		document.getElementById('auth-setup-container').style.display = 'none';
		document.getElementById('auth-pin-container').style.display = 'block';
		const credential = await this.db.getSecurityKey('webauthn_credential');
		document.getElementById('auth-description').textContent = credential?.prfWrap ? 'パスキーまたはPINでロックを解除してください。' : 'PINでロックを解除してください。PIN入力を省略するには、設定で対応パスキーを登録してください。';
		document.querySelector('#btn-auth-webauthn span').textContent = credential?.prfWrap ? '👆 パスキーで解除' : '👆 パスキーで認証（復号はPIN）';
		document.getElementById('auth-webauthn-container').style.display = credential && isWebAuthnSupported() ? 'block' : 'none';
		document.getElementById('auth-screen').classList.remove('hidden');
	}

	async generateNewKeyPair() {
		let dmkRaw, privateKeyPkcs8;
		try {
			if (!this.db.encryptionKey || !this.privateKey) { alert('DBがロックされています。先にロックを解除してください。'); return; }
			const pin = prompt('新しい鍵ペアを保護するための現在のPINコードを入力してください:');
			if (!pin) { alert('PINコードが入力されなかったため、鍵ペアの再生成を中止しました。'); return; }
			const generation = ++this.authGeneration, dmk = this.db.encryptionKey, previousPrivateKey = this.privateKey;
			const valid = () => this.authGeneration === generation && this.db.encryptionKey === dmk && this.privateKey === previousPrivateKey && !this.isKeyLocked;
			const masterPkg = await this.db.getSecurityKey('master_keys_package');
			const checked = await decryptMasterKeysWithPin(masterPkg, pin);
			checked.dmkRaw.fill(0); checked.privateKeyPkcs8.fill(0);
			const kp = await generateEd25519KeyPair(), publicKeyBase64 = await exportPublicKeyBase64(kp.publicKey);
			dmkRaw = await exportKeyRaw(dmk); privateKeyPkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);
			const wrapped = await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8 }, pin);
			const credential = await this.db.getSecurityKey('webauthn_credential');
			if (credential) delete credential.prfWrap;
			// Commit the new public/PIN keys and PRF invalidation as one security transaction.
			await this.db.putSecurityKeys({ public_key_base64: publicKeyBase64, master_keys_package: wrapped, ...(credential ? { webauthn_credential: credential } : {}) }, valid);
			if (!valid()) throw new Error('認証状態が変更されました。PINで解除してください。');
			this.privateKey = kp.privateKey; this.publicKey = kp.publicKey; this.publicKeyBase64 = publicKeyBase64;
			setActiveSession(dmk, kp.privateKey); this.syncManager?.setPrivateKey(kp.privateKey); this.updateKeyDisplay();
			alert(credential ? '新しいEd25519鍵ペアを生成し、PINで保護しました。パスキーでのPIN省略を利用するには再登録してください。' : '新しいEd25519鍵ペアを生成し、PINで保護しました。');
		} catch (err) { alert(`鍵ペアの再生成に失敗しました: ${err.message}`); }
		finally { dmkRaw?.fill(0); privateKeyPkcs8?.fill(0); }
	}

	updateKeyDisplay() {
		const txtPub = document.getElementById('txt-public-key');
		if (txtPub) txtPub.value = this.publicKeyBase64 || '';
		const banner = document.getElementById('pin-status-banner');
		if (banner) {
			banner.className = `security-banner ${this.isKeyLocked ? 'locked' : 'unlocked'}`;
			banner.innerHTML = this.isKeyLocked ? '<span>🔒 <strong>秘密鍵・DBはPINで保護されています（現在ロック中）</strong></span>' : '<span>🔓 <strong>秘密鍵・DBのロック解除中（暗号化セッション有効）</strong></span>';
		}
		const lock = document.getElementById('btn-lock-now');
		if (lock) lock.style.display = this.isKeyLocked ? 'none' : 'inline-block';
		const input = document.getElementById('input-pin');
		if (input) input.placeholder = '新しいPINに変更する場合に入力';
	}

	async ensureKeyUnlocked() {
		if (this.isKeyLocked || !this.db.encryptionKey || !this.privateKey) throw new Error('認証画面でロックを解除してから再試行してください。');
		return true;
	}

	async lockPrivateKey() {
		await this.showLockScreen();
		this.updateKeyDisplay();
		alert('秘密鍵およびDB暗号化セッションをロックしました');
	}

}
