/** PINまたはPRF対応パスキーで暗号鍵を解除するコントローラである。 */
import {
	generateEd25519KeyPair, exportPublicKeyBase64, importPublicKeyBase64,
	exportPrivateKeyPkcs8, importPrivateKeyPkcs8, generateDatabaseMasterKey,
	exportKeyRaw, importAesKeyRaw, encryptMasterKeysWithPin, decryptMasterKeysWithPin,
	isWebAuthnSupported, registerWebAuthnCredential, authenticateWithWebAuthn, setActiveSession, clearActiveSession,
	bytesToBase64, encryptMasterKeysWithPrf, decryptMasterKeysWithPrf,
	signPayload, verifySignature, canonicalJsonStringify
} from '../crypto.js';
import { beginFormBusy } from './form_busy.js';

class AuthenticationExpiredError extends Error {
	constructor() { super('認証状態が変更されました。'); this.name = 'AuthenticationExpiredError'; }
}

export class AuthController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.privateKey = null;
		this.publicKey = null;
		this.publicKeyBase64 = '';
		this.isKeyLocked = false;
		this.authGeneration = 0;
		this.completedAuthentication = null;
	}
	get db() { return this.coordinator.db; }
	get syncManager() { return this.coordinator.syncManager; }

	beginAuthentication() {
		const claim = this.restoringKeyClaim;
		if (claim && this.db.encryptionKey === claim.key && this.db.keyGeneration === claim.generation) this.db.clearEncryptionKey();
		this.restoringKeyClaim = null;
		this.completedAuthentication = null;
		return ++this.authGeneration;
	}

	captureAuthentication(generation) {
		const key = this.db.encryptionKey, keyGeneration = this.db.keyGeneration, privateKey = this.privateKey;
		return () => generation === this.authGeneration && this.db.encryptionKey === key && this.db.keyGeneration === keyGeneration && this.privateKey === privateKey;
	}

	async unlockWithPin(pin) {
		const generation = this.beginAuthentication(), valid = this.captureAuthentication(generation);
		let unpacked, restoring = false;
		try {
			const pkg = await this.db.getSecurityKey('master_keys_package');
			if (!valid()) throw new AuthenticationExpiredError();
			if (!pkg) throw new Error('暗号化された鍵が見つかりません');
			unpacked = await decryptMasterKeysWithPin(pkg, pin);
			if (!valid()) throw new AuthenticationExpiredError();
			restoring = true;
			await this.restoreMasterKeys(unpacked, generation);
		} catch (error) { if (!restoring && !valid()) throw new AuthenticationExpiredError(); throw error; }
		finally { unpacked?.dmkRaw.fill(0); unpacked?.privateKeyPkcs8.fill(0); }
	}

	async restoreMasterKeys(unpacked, generation, credential = null) {
		let key = this.db.encryptionKey, keyGeneration = this.db.keyGeneration, claim;
		const privateKey = this.privateKey;
		const valid = () => generation === this.authGeneration && this.db.encryptionKey === key && this.db.keyGeneration === keyGeneration && this.privateKey === privateKey && (!claim || this.restoringKeyClaim === claim);
		const check = () => { if (!valid()) throw new AuthenticationExpiredError(); };
		try {
			check();
			const dmk = await importAesKeyRaw(unpacked.dmkRaw); check();
			const priv = await importPrivateKeyPkcs8(unpacked.privateKeyPkcs8); check();
			const publicKeyBase64 = await this.db.getSecurityKey('public_key_base64'); check();
			const publicKey = await importPublicKeyBase64(publicKeyBase64); check();
			const proof = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
			const signature = await signPayload(priv, proof); check();
			const verified = await verifySignature(publicKey, signature, proof); check();
			if (!verified) throw new Error('保存公開鍵と署名鍵が一致しません。');
			this.db.setEncryptionKey(dmk);
			key = dmk; keyGeneration = this.db.keyGeneration;
			claim = { key, generation: keyGeneration }; this.restoringKeyClaim = claim;
			// Verify encrypted data before removing obsolete recovery values.
			const config = await this.db.getMasterConfig(); check();
			await this.db.getSnapshot(); check();
			await this.db.getTransactions({ includeDeleted: true }); check();
			if (config?.synced_passkey_bundle) {
				await this.db.mutateMasterConfig(current => { delete current.synced_passkey_bundle; return current; }, { isSessionValid: valid }); check();
			}
			for (const obsolete of ['webauthn_vault', 'webauthn_credential_id', 'webauthn_user_id']) {
				await this.db.deleteSecurityKey(obsolete, { isSessionValid: valid }); check();
			}
			const storedPublicKey = await this.db.getSecurityKey('public_key_base64'); check();
			if (publicKeyBase64 !== storedPublicKey) throw new Error('保存済み認証鍵が変更されました。');
			if (credential) {
				const storedCredential = await this.db.getSecurityKey('webauthn_credential'); check();
				if (canonicalJsonStringify(credential) !== canonicalJsonStringify(storedCredential)) throw new Error('保存済み認証鍵が変更されました。');
			}
			this.restoringKeyClaim = null;
			this.publicKey = publicKey; this.publicKeyBase64 = publicKeyBase64;
			this.privateKey = priv; this.isKeyLocked = false;
			const completed = this.captureAuthentication(generation);
			this.completedAuthentication = { generation, valid: () => !this.isKeyLocked && completed() };
			setActiveSession(dmk, priv); this.syncManager?.setPrivateKey(priv);
		} catch (error) {
			const expired = !valid();
			if (claim && this.restoringKeyClaim === claim && this.db.encryptionKey === claim.key && this.db.keyGeneration === claim.generation) this.db.clearEncryptionKey();
			if (expired) throw new AuthenticationExpiredError();
			throw error;
		} finally {
			if (claim && this.restoringKeyClaim === claim) this.restoringKeyClaim = null;
			unpacked.dmkRaw.fill(0); unpacked.privateKeyPkcs8.fill(0);
		}
	}

	async registerPasskey() {
		if (this.isKeyLocked || !this.db.encryptionKey || !this.privateKey) return this.ensureKeyUnlocked();
		const generation = this.beginAuthentication(), session = this.captureAuthentication(generation);
		const valid = () => session() && !this.isKeyLocked;
		const dmk = this.db.encryptionKey, privateKey = this.privateKey, publicKeyAtStart = this.publicKeyBase64;
		let output, dmkRaw, privateKeyPkcs8;
		try {
			await this.ensureKeyUnlocked();
			if (!valid()) throw new Error('認証状態が変更されました。再登録してください。');
			const expectedSecurityKeys = await this.db.getSecurityKeyStates(['master_keys_package', 'webauthn_credential'], { isSessionValid: valid });
			if (!valid()) throw new AuthenticationExpiredError();
			expectedSecurityKeys.public_key_base64 = { exists: true, value: publicKeyAtStart };
			const credential = await registerWebAuthnCredential('よせあつめ家計簿 ユーザー', undefined, { userId: crypto.getRandomValues(new Uint8Array(32)) });
			if (!valid()) throw new Error('認証状態が変更されました。再登録してください。');
			const auth = await authenticateWithWebAuthn(credential); output = auth.prfOutput;
			if (!valid()) throw new Error('認証状態が変更されました。再登録してください。');
			let prfWrap;
			if (output) {
				dmkRaw = await exportKeyRaw(dmk); privateKeyPkcs8 = await exportPrivateKeyPkcs8(privateKey);
				prfWrap = await encryptMasterKeysWithPrf({ dmkRaw, privateKeyPkcs8 }, output, credential);
			}
			if (!valid()) throw new Error('認証状態が変更されました。再登録してください。');
			await this.db.saveSecurityKey('webauthn_credential', { ...credential, ...(prfWrap ? { prfWrap } : {}) }, { isSessionValid: valid, expectedSecurityKeys });
			if (!valid()) throw new Error('認証状態が変更されました。再登録してください。');
			return Boolean(prfWrap);
		} finally { output?.fill(0); dmkRaw?.fill(0); privateKeyPkcs8?.fill(0); }
	}

	async unlockWithPasskey() {
		const generation = this.beginAuthentication(), valid = this.captureAuthentication(generation);
		let auth, unpacked, restoring = false;
		try {
			const credential = await this.db.getSecurityKey('webauthn_credential');
			if (!valid()) throw new AuthenticationExpiredError();
			auth = await authenticateWithWebAuthn(credential);
			if (!valid()) throw new AuthenticationExpiredError();
			const current = await this.db.getSecurityKey('webauthn_credential');
			if (!valid()) throw new AuthenticationExpiredError();
			if (canonicalJsonStringify(credential) !== canonicalJsonStringify(current)) throw new Error('パスキーの登録状態が変更されました。');
			if (!credential.prfWrap) return false;
			unpacked = await decryptMasterKeysWithPrf(credential.prfWrap, auth.prfOutput, credential);
			if (!valid()) throw new AuthenticationExpiredError();
			restoring = true;
			await this.restoreMasterKeys(unpacked, generation, credential);
			return true;
		} catch (error) { if (!restoring && !valid()) throw new AuthenticationExpiredError(); throw error; }
		finally { auth?.prfOutput?.fill(0); unpacked?.dmkRaw.fill(0); unpacked?.privateKeyPkcs8.fill(0); }
	}

	invalidateSession() {
		this.authGeneration++;
		this.completedAuthentication = null;
		this.restoringKeyClaim = null;
		this.setupOperation?.release(); this.setupOperation = null;
		this.coordinator.cancelTransactionMaintenance();
		this.coordinator.txInputController?.cancelPendingOperations();
		this.coordinator.txEditController?.cancelPendingOperations();
		this.coordinator.txListController?.cancelPendingOperations();
		this.coordinator.settingsController?.cancelPendingOperations();
		this.coordinator.masterController?.cancelPendingOperations();
		this.coordinator.maintenanceController?.cancel();
		this.coordinator.summaryController?.cancelClosing();
		this.coordinator.summaryController?.cancelRecurring();
		this.coordinator.advanceLinkController?.cancel();
		this.coordinator.bulkEditController?.cancel();
		this.coordinator.insightsController?.cancel();
		this.coordinator.furusatoController?.cancel();
		this.coordinator.budgetSettingsController?.cancel();
		this.coordinator.chartController?.destroy();
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
		const generation = this.authGeneration, valid = this.captureAuthentication(generation);
		const pkg = await this.db.getSecurityKey('master_keys_package');
		if (!valid()) return;
		const publicKeyBase64 = await this.db.getSecurityKey('public_key_base64') || '';
		if (!valid()) return;
		const publicKey = publicKeyBase64 ? await importPublicKeyBase64(publicKeyBase64) : null;
		if (!valid()) return;
		this.publicKeyBase64 = publicKeyBase64; this.publicKey = publicKey;
		const showError = message => { error.textContent = message; error.style.display = 'block'; };
		const unlock = async () => {
			error.style.display = 'none';
			const input = document.getElementById('auth-pin-input');
			const pending = this.unlockWithPin(input.value.trim()), generation = this.authGeneration;
			let session;
			try {
				await pending;
				const completed = this.completedAuthentication;
				if (completed?.generation !== generation || !completed.valid()) return;
				session = completed.valid;
				input.value = ''; screen.classList.add('hidden');
				await this.coordinator.finishAppInit({ isSessionValid: session });
			} catch (err) { if (generation === this.authGeneration && !(err instanceof AuthenticationExpiredError) && (!session || session())) showError('PINコードが正しくありません。または暗号化データを復号できません。'); }
		};
		document.getElementById('btn-auth-pin')?.addEventListener('click', unlock);
		document.getElementById('auth-pin-input')?.addEventListener('keydown', event => { if (event.key === 'Enter') unlock(); });
		document.getElementById('btn-auth-webauthn')?.addEventListener('click', async () => {
			error.style.display = 'none';
			const pending = this.unlockWithPasskey(), generation = this.authGeneration, origin = this.captureAuthentication(generation);
			let session;
			try {
				const unlocked = await pending;
				if (generation !== this.authGeneration) return;
				if (unlocked) {
					const completed = this.completedAuthentication;
					if (completed?.generation !== generation || !completed.valid()) return;
					session = completed.valid;
					document.getElementById('auth-pin-input').value = ''; screen.classList.add('hidden');
					await this.coordinator.finishAppInit({ isSessionValid: session });
				} else {
					if (!origin()) return;
					document.getElementById('auth-description').textContent = 'パスキー認証が完了しました。この登録では復号するPINを入力してください。PIN省略には対応パスキーを再登録してください。';
					document.getElementById('auth-pin-input')?.focus();
				}
			} catch (err) { if (generation === this.authGeneration && !(err instanceof AuthenticationExpiredError) && (!session || session())) showError('パスキー認証がキャンセルされたか失敗しました。PINで解除できます。'); }
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
			if (this.setupOperation) return;
			const input = document.getElementById('auth-setup-pin'), pin = input.value.trim();
			if (pin.length < 4) { showError('PINコードは4桁以上を入力してください'); return; }
			error.style.display = 'none';
			const owner = { release: beginFormBusy(document.getElementById('auth-setup-container'), document.getElementById('btn-auth-setup'), '初期設定中…') };
			this.setupOperation = owner;
			const generation = this.beginAuthentication(), origin = this.captureAuthentication(generation), publicKeyAtStart = this.publicKeyBase64;
			const valid = () => origin() && this.setupOperation === owner;
			const recover = async message => {
				const pending = this.showLockScreen(), lockGeneration = this.authGeneration;
				try { await pending; }
				catch (error) { if (lockGeneration === this.authGeneration) showError(`${message} ${error.message}`); return; }
				if (lockGeneration === this.authGeneration) showError(message);
			};
			let dmkRaw, privateKeyPkcs8, session, restoring = false;
			try {
				const expectedSecurityKeys = await this.db.getSecurityKeyStates(['master_keys_package'], { isSessionValid: valid });
				if (!valid()) return;
				expectedSecurityKeys.public_key_base64 = publicKeyAtStart ? { exists: true, value: publicKeyAtStart } : { exists: false };
				if (expectedSecurityKeys.master_keys_package.exists) { await recover('保存済みの認証鍵があります。設定済みのPINで解除してください。'); return; }
				const dmk = await generateDatabaseMasterKey();
				if (!valid()) return;
				const kp = await generateEd25519KeyPair();
				if (!valid()) return;
				const publicKeyBase64 = await exportPublicKeyBase64(kp.publicKey);
				dmkRaw = await exportKeyRaw(dmk); privateKeyPkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);
				const wrapped = await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8 }, pin);
				if (!valid()) return;
				await this.db.putSecurityKeys({ public_key_base64: publicKeyBase64, master_keys_package: wrapped }, valid, { expectedSecurityKeys });
				if (!valid()) return;
				const unpacked = await decryptMasterKeysWithPin(wrapped, pin);
				if (!valid()) { unpacked.dmkRaw.fill(0); unpacked.privateKeyPkcs8.fill(0); return; }
				restoring = true;
				await this.restoreMasterKeys(unpacked, generation);
				const completed = this.completedAuthentication;
				if (completed?.generation !== generation || !completed.valid()) return;
				session = completed.valid;
				const config = await this.db.getMasterConfig();
				if (!session()) return;
				await this.db.saveMasterConfig(config, { isSessionValid: session });
				if (!session()) return;
				const snapshot = await this.db.getSnapshot();
				if (!session()) return;
				await this.db.saveSnapshot(snapshot, { isSessionValid: session });
				if (!session()) return;
				input.value = ''; screen.classList.add('hidden');
				await this.coordinator.finishAppInit({ isSessionValid: session });
			} catch (error) {
				if (generation !== this.authGeneration || error instanceof AuthenticationExpiredError || (session ? !session() : !restoring && !valid())) return;
				const recoveryValid = this.captureAuthentication(generation);
				let existing;
				try { existing = (await this.db.getSecurityKeyStates(['master_keys_package'], { isSessionValid: recoveryValid })).master_keys_package.exists; }
				catch (readError) { if (recoveryValid()) showError(`初期化エラー: ${error.message} 認証鍵を確認できません: ${readError.message}`); return; }
				if (!recoveryValid()) return;
				if (existing) await recover(`初期化エラー: ${error.message} 保存済みの鍵を保持しています。設定済みのPINで解除してください。`);
				else showError(`初期化エラー: ${error.message}`);
			} finally {
				dmkRaw?.fill(0); privateKeyPkcs8?.fill(0);
				if (this.setupOperation === owner) { owner.release(); this.setupOperation = null; }
			}
		});
	}

	async showLockScreen() {
		this.invalidateSession();
		const generation = this.authGeneration;
		document.getElementById('auth-screen').classList.remove('hidden');
		document.getElementById('auth-error-msg').style.display = 'none';
		document.getElementById('auth-title').textContent = '🔐 よせあつめ家計簿';
		document.getElementById('auth-setup-container').style.display = 'none';
		document.getElementById('auth-pin-container').style.display = 'block';
		let credential;
		try { credential = await this.db.getSecurityKey('webauthn_credential'); }
		catch (error) { if (generation === this.authGeneration) throw error; else return; }
		if (generation !== this.authGeneration) return;
		document.getElementById('auth-description').textContent = credential?.prfWrap ? 'パスキーまたはPINでロックを解除してください。' : 'PINでロックを解除してください。PIN入力を省略するには、設定で対応パスキーを登録してください。';
		document.querySelector('#btn-auth-webauthn span').textContent = credential?.prfWrap ? '👆 パスキーで解除' : '👆 パスキーで認証（復号はPIN）';
		document.getElementById('auth-webauthn-container').style.display = credential && isWebAuthnSupported() ? 'block' : 'none';
		document.getElementById('auth-screen').classList.remove('hidden');
	}

	async generateNewKeyPair() {
		let dmkRaw, privateKeyPkcs8, valid = () => true;
		try {
			if (!this.db.encryptionKey || !this.privateKey) { alert('DBがロックされています。先にロックを解除してください。'); return; }
			const pin = prompt('新しい鍵ペアを保護するための現在のPINコードを入力してください:');
			if (!pin) { alert('PINコードが入力されなかったため、鍵ペアの再生成を中止しました。'); return; }
			const generation = this.beginAuthentication(), dmk = this.db.encryptionKey, keyGeneration = this.db.keyGeneration, publicKeyAtStart = this.publicKeyBase64;
			let expectedPrivateKey = this.privateKey;
			valid = () => this.authGeneration === generation && this.db.encryptionKey === dmk && this.db.keyGeneration === keyGeneration && this.privateKey === expectedPrivateKey && !this.isKeyLocked;
			const expectedSecurityKeys = await this.db.getSecurityKeyStates(['master_keys_package', 'webauthn_credential'], { isSessionValid: valid });
			if (!valid()) return;
			expectedSecurityKeys.public_key_base64 = { exists: true, value: publicKeyAtStart };
			const masterPkg = expectedSecurityKeys.master_keys_package.exists ? expectedSecurityKeys.master_keys_package.value : null;
			const credential = expectedSecurityKeys.webauthn_credential.exists ? structuredClone(expectedSecurityKeys.webauthn_credential.value) : null;
			const checked = await decryptMasterKeysWithPin(masterPkg, pin);
			checked.dmkRaw.fill(0); checked.privateKeyPkcs8.fill(0);
			const kp = await generateEd25519KeyPair(), publicKeyBase64 = await exportPublicKeyBase64(kp.publicKey);
			dmkRaw = await exportKeyRaw(dmk); privateKeyPkcs8 = await exportPrivateKeyPkcs8(kp.privateKey);
			const wrapped = await encryptMasterKeysWithPin({ dmkRaw, privateKeyPkcs8 }, pin);
			if (credential) delete credential.prfWrap;
			// Commit the new public/PIN keys and PRF invalidation as one security transaction.
			await this.db.putSecurityKeys({ public_key_base64: publicKeyBase64, master_keys_package: wrapped, ...(credential ? { webauthn_credential: credential } : {}) }, valid, { expectedSecurityKeys });
			if (!valid()) throw new Error('認証状態が変更されました。PINで解除してください。');
			expectedPrivateKey = kp.privateKey;
			this.privateKey = kp.privateKey; this.publicKey = kp.publicKey; this.publicKeyBase64 = publicKeyBase64;
			this.completedAuthentication = { generation, valid };
			setActiveSession(dmk, kp.privateKey); this.syncManager?.setPrivateKey(kp.privateKey); this.updateKeyDisplay();
			alert(credential ? '新しいEd25519鍵ペアを生成し、PINで保護しました。パスキーでのPIN省略を利用するには再登録してください。' : '新しいEd25519鍵ペアを生成し、PINで保護しました。');
		} catch (err) { if (valid()) alert(`鍵ペアの再生成に失敗しました: ${err.message}`); }
		finally { dmkRaw?.fill(0); privateKeyPkcs8?.fill(0); }
	}

	updateKeyDisplay() {
		const txtPub = document.getElementById('txt-public-key');
		txtPub.value = this.publicKeyBase64 || '';
		const banner = document.getElementById('pin-status-banner');
		banner.className = `security-banner ${this.isKeyLocked ? 'locked' : 'unlocked'}`;
		banner.innerHTML = this.isKeyLocked ? '<span>🔒 <strong>秘密鍵・DBはPINで保護されています（現在ロック中）</strong></span>' : '<span>🔓 <strong>秘密鍵・DBのロック解除中（暗号化セッション有効）</strong></span>';
		const lock = document.getElementById('btn-lock-now');
		lock.style.display = this.isKeyLocked ? 'none' : 'inline-block';
		const input = document.getElementById('input-pin');
		input.placeholder = '新しいPINに変更する場合に入力';
	}

	async ensureKeyUnlocked() {
		if (this.isKeyLocked || !this.db.encryptionKey || !this.privateKey) throw new Error('認証画面でロックを解除してから再試行してください。');
		return true;
	}

	async lockPrivateKey() {
		const pending = this.showLockScreen(), generation = this.authGeneration;
		await pending;
		if (generation !== this.authGeneration || !this.isKeyLocked) return;
		this.updateKeyDisplay();
		alert('秘密鍵およびDB暗号化セッションをロックしました');
	}

}
