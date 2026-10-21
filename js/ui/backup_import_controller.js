/** Explicit complete-import confirmation and pending-operation management. */
import { IMPORT_CONFIRMATION_WORD } from '../db/backup_replacement.js';

const TYPE_NAMES = { full_backup: '全データ', transactions: '取引明細', master_config: 'マスタ設定', annual_budgets: '年間予算', summary_snapshot: '残高スナップショット' };

export class BackupImportController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.plan = null;
		this.busy = false;
	}

	setup() {
		const modal = document.getElementById('modal-replacement-import');
		const word = document.getElementById('replacement-import-word');
		const button = document.getElementById('btn-confirm-replacement-import');
		const close = () => {
			this.plan = null;
			word.value = '';
			modal.classList.remove('active');
		};
		document.getElementById('btn-close-replacement-import').addEventListener('click', close);
		document.getElementById('btn-cancel-replacement-import').addEventListener('click', close);
		word.addEventListener('input', () => { button.disabled = this.busy || word.value !== IMPORT_CONFIRMATION_WORD; });
		button.addEventListener('click', () => this.confirm());
		document.getElementById('btn-reapprove-import').addEventListener('click', () => this.reapprove());
		document.getElementById('checkbox-replace-pending-import').addEventListener('change', event => {
			if (event.target.checked) document.getElementById('select-import-mode').value = 'replace';
		});
		new MutationObserver(() => {
			if (!modal.classList.contains('active')) {
				this.plan = null;
				word.value = '';
				button.disabled = true;
			}
		}).observe(modal, { attributes: true, attributeFilter: ['class'] });
	}

	async preview(data) {
		if (this.busy || this.coordinator.syncManager.isSyncing) throw new Error('同期中です。完了後にインポートしてください。');
		const key = this.coordinator.privateKey;
		const plan = await this.coordinator.db.prepareReplacementImport(data, { replacePending: document.getElementById('checkbox-replace-pending-import').checked });
		if (this.coordinator.isKeyLocked || this.coordinator.privateKey !== key || this.coordinator.syncManager.isSyncing) throw new Error('認証または同期状態が変更されました');
		this.plan = { plan, key };
		const counts = [];
		if (plan.data.transactions) counts.push(`明細: ${plan.data.transactions.length}件（現在の${plan.expected.transactions.length}件を置換）`);
		if (plan.data.master_config) counts.push(`口座: ${plan.data.master_config.accounts.length}件 / 費目: ${plan.data.master_config.categories.length}件`);
		if (plan.data.annual_budgets) counts.push(`年間予算: ${Object.keys(plan.data.annual_budgets).length}年度`);
		document.getElementById('replacement-import-summary').textContent = `${plan.expected.pending ? '現在の送信待ちを新しい取込内容に置き換えます。旧取込がサーバーに反映済みの場合も、取り消して戻す操作ではなく、新しい完全置換として反映します。' : ''}${TYPE_NAMES[plan.detectedType]}を完全に置き換えます。${counts.join('。')}。ファイルにない対象データは削除されます。次回同期では、初回に取得するサーバー（Google Drive）の同じ種類の全データも置き換えます。サーバーだけにある明細と過去アーカイブも対象です。認証鍵と接続先は保持します。`;
		document.getElementById('replacement-import-word').value = '';
		document.getElementById('replacement-import-error').textContent = '';
		document.getElementById('btn-confirm-replacement-import').disabled = true;
		document.getElementById('modal-replacement-import').classList.add('active');
	}

	async confirm() {
		const selection = this.plan;
		if (this.busy || !selection || document.getElementById('replacement-import-word').value !== IMPORT_CONFIRMATION_WORD) return;
		this.busy = true;
		document.getElementById('btn-confirm-replacement-import').disabled = true;
		try {
			await this.coordinator.db.commitReplacementImport(selection.plan, {
				confirmation: IMPORT_CONFIRMATION_WORD,
				isSessionValid: () => this.plan === selection && document.getElementById('modal-replacement-import').classList.contains('active') && !this.coordinator.isKeyLocked && this.coordinator.privateKey === selection.key && !this.coordinator.syncManager.isSyncing
			});
			this.plan = null;
			document.getElementById('checkbox-replace-pending-import').checked = false;
			document.getElementById('modal-replacement-import').classList.remove('active');
			alert(`【${TYPE_NAMES[selection.plan.detectedType]} 完全インポート完了】\n手元の対象データを置き換えました。サーバーへの反映は送信待ちです。次回同期で反映します。`);
			await this.coordinator.refreshAllViews();
		} catch (error) {
			if (!this.coordinator.isKeyLocked) document.getElementById('replacement-import-error').textContent = error.message;
		} finally {
			this.busy = false;
			document.getElementById('btn-confirm-replacement-import').disabled = !this.plan || document.getElementById('replacement-import-word').value !== IMPORT_CONFIRMATION_WORD;
		}
	}

	async renderPending() {
		const pending = await this.coordinator.db.getPendingImport();
		const panel = document.getElementById('pending-import-panel');
		panel.hidden = !pending;
		document.getElementById('pending-import-status').textContent = pending ? `${TYPE_NAMES[pending.detectedType]}の完全インポートが送信待ちです。手動同期でサーバーに反映します。版競合で停止した場合は、再確認して最新のサーバーデータの置換を承認してください。` : '';
		document.getElementById('btn-reapprove-import').disabled = !pending || this.coordinator.syncManager.isSyncing;
	}

	async reapprove() {
		try {
			if (this.coordinator.syncManager.isSyncing) throw new Error('同期中です。完了をお待ちください。');
			const pending = await this.coordinator.db.getPendingImport();
			if (!pending) return;
			const key = this.coordinator.privateKey;
			const word = prompt(`${TYPE_NAMES[pending.detectedType]}の完全インポートを再承認します。次回取得する最新のサーバーデータも置き換え、ファイルにない対象データは削除します。\n実行する場合は「${IMPORT_CONFIRMATION_WORD}」と正確に入力してください。`);
			if (word === null) return;
			if (word !== IMPORT_CONFIRMATION_WORD) throw new Error('確認の文字が一致しません');
			if (this.coordinator.isKeyLocked || key !== this.coordinator.privateKey || this.coordinator.syncManager.isSyncing) throw new Error('認証または同期状態が変更されました');
			const replacement = { ...pending };
			delete replacement.base_version;
			if (!await this.coordinator.db.updatePendingImport(pending, replacement, { isSessionValid: () => !this.coordinator.isKeyLocked && key === this.coordinator.privateKey && !this.coordinator.syncManager.isSyncing })) throw new Error('送信待ちデータが変更されました。確認し直してください。');
			alert('完全インポートを再承認しました。手動同期で反映してください。');
			await this.renderPending();
		} catch (error) {
			if (!this.coordinator.isKeyLocked) alert(`再確認に失敗しました: ${error.message}`);
		}
	}
}
