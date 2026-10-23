import { escapeHtml } from '../logic.js';
import { canonicalJsonStringify } from '../crypto.js';
import { advanceLinkCandidates, buildAdvanceLink, isAdvanceSource, linkedRepayment } from '../logic/advance_links.js';

/** One shared dialog for linking from either side; financial edits stay in the editor. */
export class AdvanceLinkController {
	constructor(coordinator) { this.coordinator = coordinator; this.busy = false; this.generation = 0; this.operation = 0; }
	get db() { return this.coordinator.db; }
	setup() {
		document.getElementById('btn-close-advance-link').addEventListener('click', () => this.close());
		document.getElementById('btn-save-advance-link').addEventListener('click', () => this.save(false));
		document.getElementById('btn-unlink-advance').addEventListener('click', () => this.save(true));
	}
	close() { this.generation++; document.getElementById('modal-advance-link').classList.remove('active'); }
	cancel() {
		this.operation++; this.busy = false; this.close();
		for (const control of /** @type {NodeListOf<HTMLButtonElement | HTMLSelectElement>} */ (document.querySelectorAll('#modal-advance-link button, #modal-advance-link select'))) control.disabled = false;
	}
	describe(tx) {
		const accountId = tx.type === 'income' ? tx.account_id : isAdvanceSource(tx) ? tx.account_id : tx.to_account_id;
		const account = this.config.accounts.find(item => item.id === accountId)?.name || accountId;
		return `${tx.date} / ${tx.memo || tx.id} / ¥${tx.amount.toLocaleString()} / ${account}${tx.type === 'income' ? '（収入から回収振替へ変更する）' : ''}`;
	}
	async open(record) {
		if (this.busy) return;
		const generation = ++this.generation;
		const [records, config] = await Promise.all([this.db.getTransactions({ includeDeleted: true }), this.db.getMasterConfig()]);
		if (generation !== this.generation || this.coordinator.isKeyLocked) return;
		if (canonicalJsonStringify(record) !== canonicalJsonStringify(records.find(tx => tx.id === record.id))) throw new Error('明細が変更されました。開き直して確認してください。');
		this.record = record; this.records = records; this.config = config;
		this.repayment = isAdvanceSource(record) ? linkedRepayment(record.id, records) : record.advance_source_id ? record : null;
		const other = this.repayment ? isAdvanceSource(record) ? this.repayment : records.find(tx => tx.id === this.repayment.advance_source_id) : null;
		document.getElementById('advance-link-current').textContent = this.repayment ? `ひも付け済み: ${other ? this.describe(other) : `元立替 ${this.repayment.advance_source_id} は未取得です。差分同期で取得してください。`}` : 'ひも付け先を選択してください。同額・確定済みの取得済み明細が対象です。';
		this.candidates = advanceLinkCandidates(record, records, config);
		const select = document.getElementById('advance-link-candidate');
		select.innerHTML = this.candidates.map(tx => `<option value="${escapeHtml(tx.id)}">${escapeHtml(this.describe(tx))}</option>`).join('');
		document.getElementById('advance-link-candidate-group').hidden = Boolean(this.repayment);
		document.getElementById('btn-save-advance-link').hidden = Boolean(this.repayment);
		document.getElementById('btn-save-advance-link').disabled = !this.candidates.length;
		document.getElementById('btn-unlink-advance').hidden = !this.repayment;
		document.getElementById('modal-advance-link').classList.add('active');
	}
	async save(unlink) {
		if (this.busy) return;
		this.busy = true;
		const operation = ++this.operation, generation = this.generation, key = this.db.encryptionKey;
		const valid = () => this.operation === operation && this.generation === generation && this.db.encryptionKey === key;
		let saved = false;
		const controls = /** @type {NodeListOf<HTMLButtonElement | HTMLSelectElement>} */ (document.querySelectorAll('#modal-advance-link button, #modal-advance-link select'));
		controls.forEach(control => control.disabled = true);
		try {
			if (unlink) {
				const repayment = this.repayment;
				if (!confirm('ひも付けを解除しますか？収入から変更した回収振替は、収入には戻しません。')) return;
				const next = { ...repayment }; delete next.advance_source_id;
				const approvedMonths = await this.coordinator.approveClosedChanges([next], [repayment]);
				if (approvedMonths === null) return;
				if (!valid()) throw new Error('認証または表示状態が変更されました。');
				await this.db.unlinkAdvanceRepayment(repayment, { approvedMonths });
			} else {
				const selected = this.candidates.find(tx => tx.id === document.getElementById('advance-link-candidate').value);
				if (!selected) return;
				const source = isAdvanceSource(this.record) ? this.record : selected;
				const repayment = source === this.record ? selected : this.record;
				const message = repayment.type === 'income' ? 'この収入を立替金口座からの回収振替へ変更してひも付けますか？\n収入集計から除外し、立替金残高を減らします。収入の分類と税情報は解除します。' : '既存の立替と回収明細をひも付けますか？新しい回収明細は作成しません。';
				if (!confirm(message)) return;
				const planned = buildAdvanceLink(source, repayment, this.records, this.config);
				const approvedMonths = await this.coordinator.approveClosedChanges(planned, [source, repayment]);
				if (approvedMonths === null) return;
				if (!valid()) throw new Error('認証または表示状態が変更されました。');
				await this.db.linkAdvanceRepayment(source, repayment, { approvedMonths });
			}
			saved = true;
			await this.coordinator.refreshAllViews();
			if (!valid()) return;
			this.close(); this.coordinator.txEditController.close();
			this.coordinator.showToast(unlink ? '立替・回収のひも付けを解除しました' : '立替・回収をひも付けました');
			this.coordinator.syncManager?.syncPendingDiffs().catch(() => this.coordinator.showToast('同期できませんでした。変更は端末内に保持しています。'));
		} catch (error) {
			if (saved && valid()) { this.close(); this.coordinator.txEditController.close(); alert(`ひも付けの変更は保存済みです。一覧更新に失敗しました: ${error.message}`); }
			else if (saved) return;
			else alert(`ひも付けの保存に失敗しました: ${error.message}`);
		}
		finally { if (this.operation === operation) { this.busy = false; controls.forEach(control => control.disabled = false); document.getElementById('btn-save-advance-link').disabled = !this.candidates?.length; } }
	}
}
