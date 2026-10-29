import { bulkEditCapabilities, buildBulkEdit } from '../logic/bulk_edit.js';
import { escapeHtml } from '../logic.js';
import { captureRenderSession } from './render_session.js';
import { beginFormBusy } from './form_busy.js';

const FIELDS = { memo: 'メモ', tags: 'タグ（カンマ区切り・空欄で解除）', date: '取引日', target_month: '計上月', status: '状態', amount: '金額', account_id: '支払・受取口座', to_account_id: '振替先口座', category_id: '計上費目', subcategory_id: '計上中項目', actual_category_id: '実態費目', actual_subcategory_id: '実態中項目' };
export class BulkEditController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.selectedIds = new Set(); this.generation = 0; this.busy = false; this.dirty = false;
		this.originals = []; this.all = []; this.config = null; this.allowedFields = [];
		this.releaseBusy = null;
	}
	get db() { return this.coordinator.db; }
	setup() {
		document.getElementById('month-tx-list').addEventListener('change', event => {
			if (this.busy) return;
			const id = event.target.dataset.bulkId;
			if (!id) return;
			if (event.target.checked) this.selectedIds.add(id); else this.selectedIds.delete(id);
			this.updateCount();
		});
		document.getElementById('btn-bulk-select-page').addEventListener('click', () => {
			if (this.busy) return;
			document.querySelectorAll('#month-tx-list [data-bulk-id]').forEach(input => { input.checked = true; this.selectedIds.add(input.dataset.bulkId); }); this.updateCount();
		});
		document.getElementById('btn-bulk-clear').addEventListener('click', () => this.clearSelection());
		document.getElementById('btn-bulk-edit').addEventListener('click', () => this.open());
		document.getElementById('btn-bulk-delete').addEventListener('click', () => this.deleteSelected());
		document.getElementById('btn-close-bulk').addEventListener('click', () => this.requestClose());
		document.getElementById('btn-cancel-bulk').addEventListener('click', () => this.requestClose());
		document.getElementById('btn-save-bulk').addEventListener('click', () => this.save());
		const modal = document.getElementById('modal-bulk-edit');
		modal.addEventListener('click', event => { if (event.target === modal) this.requestClose(); });
		modal.addEventListener('input', () => { if (!this.busy) this.dirty = true; });
		modal.addEventListener('change', event => {
			if (this.busy) return;
			this.dirty = true;
			const field = event.target.dataset.applyField;
			if (field) document.getElementById(`bulk-value-${field}`).disabled = !event.target.checked;
			if ((/** @type {HTMLElement} */ (event.target)).id === 'bulk-value-category_id') this.populateSubcategories('');
			if ((/** @type {HTMLElement} */ (event.target)).id === 'bulk-value-actual_category_id') this.populateSubcategories('actual_');
		});
	}
	updateCount() {
		document.getElementById('bulk-selection-count').textContent = `${this.selectedIds.size}件選択`;
		for (const id of ['btn-bulk-edit', 'btn-bulk-delete']) document.getElementById(id).disabled = this.busy || !this.selectedIds.size;
		for (const id of ['btn-bulk-select-page', 'btn-bulk-clear']) document.getElementById(id).disabled = this.busy;
		for (const input of /** @type {NodeListOf<HTMLInputElement | HTMLButtonElement>} */ (document.querySelectorAll('#month-tx-list [data-bulk-id], #month-tx-list .btn-delete-tx'))) input.disabled = this.busy;
		for (const button of /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('#month-tx-list .btn-confirm-tx'))) button.disabled = this.busy || this.coordinator.txListController.confirmationOperations.has(button.dataset.id);
	}
	clearSelection(force = false) {
		if (this.busy && !force) return;
		this.selectedIds.clear();
		document.querySelectorAll('#month-tx-list [data-bulk-id]').forEach(input => { input.checked = false; }); this.updateCount();
	}
	reconcile(records) {
		if (this.busy) return;
		const available = new Set(records.map(tx => tx.id));
		for (const id of this.selectedIds) if (!available.has(id)) this.selectedIds.delete(id);
		this.updateCount();
	}
	cancel() {
		this.releaseBusy?.(); this.releaseBusy = null;
		this.generation++; this.busy = false; this.dirty = false; this.originals = []; this.all = []; this.config = null;
		document.getElementById('modal-bulk-edit').classList.remove('active');
		document.getElementById('bulk-edit-fields').replaceChildren();
		this.clearSelection();
	}
	requestClose() {
		if (this.busy || (this.dirty && !confirm('一括編集の変更を破棄して閉じますか？'))) return false;
		this.generation++; this.dirty = false; this.originals = []; this.all = []; this.config = null;
		document.getElementById('modal-bulk-edit').classList.remove('active'); return true;
	}
	setBusy(busy) {
		this.busy = busy;
		document.getElementById('btn-save-bulk').disabled = busy;
		document.getElementById('btn-close-bulk').disabled = busy;
		document.getElementById('btn-cancel-bulk').disabled = busy;
		for (const field of Object.keys(FIELDS)) {
			const apply = document.getElementById(`bulk-apply-${field}`), value = document.getElementById(`bulk-value-${field}`);
			apply.disabled = busy || !this.allowedFields.includes(field);
			value.disabled = busy || !apply.checked;
		}
	}
	async open() {
		if (this.busy || !this.selectedIds.size || this.coordinator.isKeyLocked) return;
		const generation = ++this.generation;
		const valid = captureRenderSession(this.coordinator, () => generation === this.generation);
		const ids = new Set(this.selectedIds);
		try {
			const [all, config] = await Promise.all([this.db.getTransactions(), this.db.getMasterConfig()]);
			if (!valid()) return;
			if (ids.size !== this.selectedIds.size || [...ids].some(id => !this.selectedIds.has(id))) return;
			const originals = all.filter(tx => ids.has(tx.id));
			if (originals.length !== ids.size) throw new Error('選択した明細が変更されています。一覧を更新してください。');
			this.originals = originals; this.all = all; this.config = config; this.dirty = false;
			const { fields: allowed, reasons } = bulkEditCapabilities(originals, all);
			this.allowedFields = allowed;
			const options = (list, valueKey = 'id') => list.map(row => `<option value="${escapeHtml(row[valueKey])}">${escapeHtml(row.name)}</option>`).join('');
			document.getElementById('bulk-edit-fields').innerHTML = Object.entries(FIELDS).map(([field, label]) => {
				const common = originals.every(tx => JSON.stringify(tx[field]) === JSON.stringify(originals[0][field])) ? originals[0][field] : '';
				const reasonId = `bulk-reason-${field}`;
				const description = `aria-describedby="bulk-edit-scope${allowed.includes(field) ? '' : ` ${reasonId}`}"`;
				const inputLabel = `aria-labelledby="bulk-label-${field}" ${description}`;
				let input;
				if (field.endsWith('account_id')) input = `<select class="form-control" id="bulk-value-${field}" ${inputLabel} disabled>${options(config.accounts.filter(a => !a.is_archived))}</select>`;
				else if (field === 'category_id' || field === 'actual_category_id') input = `<select class="form-control" id="bulk-value-${field}" ${inputLabel} disabled><option value="">未分類</option>${options(config.categories.filter(c => !c.is_archived && c.type === originals[0].type))}</select>`;
				else if (field.endsWith('subcategory_id')) input = `<select class="form-control" id="bulk-value-${field}" ${inputLabel} disabled></select>`;
				else if (field === 'status') input = `<select class="form-control" id="bulk-value-${field}" ${inputLabel} disabled><option value="confirmed">確定</option><option value="planned">予定</option></select>`;
				else input = `<input class="form-control" id="bulk-value-${field}" ${inputLabel} type="${({ date: 'date', target_month: 'month', amount: 'number' })[field] || 'text'}" ${field === 'amount' ? 'min="0" step="1"' : ''} value="${escapeHtml(field === 'tags' && Array.isArray(common) ? common.join(', ') : common ?? '')}" disabled>`;
				const explanation = allowed.includes(field) ? '' : `<p class="bulk-field-reason" id="${reasonId}">${reasons[field].map(escapeHtml).join(' / ')}</p>`;
				return `<div class="form-group"><label id="bulk-label-${field}"><input type="checkbox" id="bulk-apply-${field}" data-apply-field="${field}" ${description} ${allowed.includes(field) ? '' : 'disabled'}> ${label}を変更</label>${input}${explanation}</div>`;
			}).join('');
			for (const field of ['account_id', 'to_account_id', 'category_id', 'actual_category_id', 'status']) {
				const common = originals.every(tx => tx[field] === originals[0][field]) ? originals[0][field] : '';
				if (common != null) document.getElementById(`bulk-value-${field}`).value = common;
			}
			this.populateSubcategories('', true); this.populateSubcategories('actual_', true);
			document.getElementById('bulk-edit-error').textContent = '';
			document.getElementById('bulk-edit-scope').textContent = `${originals.length}件を編集します。変更する項目だけチェックしてください。種別・関連情報は保持します。関連明細を含む場合、金融条件は個別の専用編集から変更してください。`;
			this.setBusy(false);
			document.getElementById('modal-bulk-edit').classList.add('active');
		} catch (error) { if (valid()) alert(error.message); }
	}
	populateSubcategories(prefix, restoreOriginal = false) {
		const category = this.config.categories.find(c => c.id === document.getElementById(`bulk-value-${prefix}category_id`).value);
		const input = document.getElementById(`bulk-value-${prefix}subcategory_id`);
		const field = `${prefix}subcategory_id`;
		const common = restoreOriginal && this.originals.every(tx => tx[`${prefix}category_id`] === category?.id && tx[field] === this.originals[0][field]) ? this.originals[0][field] : null;
		const children = category?.subcategories || [];
		const original = children.find(sub => sub.id === common);
		input.innerHTML = '<option value="">未分類</option>' + children.filter(sub => !sub.is_archived).map(sub => `<option value="${escapeHtml(sub.id)}">${escapeHtml(sub.name)}</option>`).join('') + (original?.is_archived ? `<option value="${escapeHtml(original.id)}" disabled>${escapeHtml(original.name)}（アーカイブ済み・現在値）</option>` : '');
		if (original) input.value = original.id;
	}
	async save() {
		if (this.busy || !this.originals.length || this.coordinator.isKeyLocked) return;
		const generation = ++this.generation;
		const valid = captureRenderSession(this.coordinator, () => generation === this.generation);
		const originals = structuredClone(this.originals), all = structuredClone(this.all);
		this.busy = true;
		this.releaseBusy = beginFormBusy(document.getElementById('modal-bulk-edit'), document.getElementById('btn-save-bulk'), '保存中…');
		this.updateCount();
		let committed = false;
		try {
			const patch = {};
			for (const field of Object.keys(FIELDS)) if (document.getElementById(`bulk-apply-${field}`).checked) {
				const value = document.getElementById(`bulk-value-${field}`).value;
				if (field === 'amount' && value === '') throw new Error('変更金額を入力してください。');
				patch[field] = field === 'amount' ? Number(value) : field === 'tags' ? [...new Set(value.split(/[,、\n]/).map(tag => tag.trim()).filter(Boolean))] : field.endsWith('category_id') || field.endsWith('subcategory_id') ? value || null : value;
			}
			const records = buildBulkEdit(originals, patch, all);
			const approved = await this.coordinator.approveClosedChanges(records, originals, { isSessionValid: valid });
			if (approved === null || !valid()) return;
			await this.db.bulkEditTransactions(originals, patch, approved, { isSessionValid: valid });
			committed = true;
			if (!valid()) return;
			this.clearSelection(true);
			try { await this.coordinator.refreshAfterTransactionChange({ isSessionValid: valid }); } catch (error) { if (valid()) alert(`変更は保存済みです。表示の更新に失敗しました。一覧を開き直してください: ${error.message}`); }
			if (!valid()) return;
			this.releaseBusy(); this.releaseBusy = null; this.busy = false; this.dirty = false;
			this.requestClose(); this.updateCount();
			this.coordinator.showToast('明細を一括編集しました。');
		} catch (error) { if (valid() && !committed) document.getElementById('bulk-edit-error').textContent = error.message; }
		finally { if (generation === this.generation) { this.releaseBusy?.(); this.releaseBusy = null; this.busy = false; this.updateCount(); } }
	}

	async deleteSelected() {
		if (this.busy || !this.selectedIds.size || this.coordinator.isKeyLocked) return;
		const ids = new Set(this.selectedIds), generation = ++this.generation;
		const valid = captureRenderSession(this.coordinator, () => generation === this.generation);
		this.busy = true;
		this.releaseBusy = beginFormBusy(document.getElementById('card-month-tx-list'), document.getElementById('btn-bulk-delete'), '削除中…');
		this.updateCount();
		let committed = false;
		try {
			const all = await this.db.getTransactions();
			if (!valid()) return;
			const originals = all.filter(tx => ids.has(tx.id));
			if (originals.length !== ids.size) throw new Error('選択した明細が変更されています。一覧を更新してください。');
			if (!confirm(`選択した${originals.length}件を論理削除しますか？削除は同期先にも反映されます。`)) return;
			const approved = await this.coordinator.approveClosedChanges(originals.map(tx => ({ ...tx, is_deleted: true })), originals, { isSessionValid: valid });
			if (approved === null || !valid()) return;
			await this.db.bulkDeleteTransactions(originals, approved, { isSessionValid: valid });
			committed = true;
			if (!valid()) return;
			this.clearSelection(true);
			try { await this.coordinator.refreshAfterTransactionChange({ isSessionValid: valid }); }
			catch (error) { if (valid()) alert(`削除は保存済みです。表示の更新に失敗しました: ${error.message}`); }
			if (valid()) this.coordinator.showToast(`${originals.length}件の明細を削除しました。`);
		} catch (error) { if (valid() && !committed) alert(`明細の一括削除に失敗しました: ${error.message}`); }
		finally { if (generation === this.generation) { this.releaseBusy?.(); this.releaseBusy = null; this.busy = false; this.updateCount(); } }
	}
}
