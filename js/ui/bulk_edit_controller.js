import { bulkEditCapabilities, buildBulkEdit } from '../logic/bulk_edit.js';
import { escapeHtml } from '../logic.js';

const FIELDS = { memo: 'メモ', tags: 'タグ（カンマ区切り・空欄で解除）', date: '取引日', target_month: '計上月', status: '状態', amount: '金額', account_id: '支払・受取口座', to_account_id: '振替先口座', category_id: '計上費目', subcategory_id: '計上中項目', actual_category_id: '実態費目', actual_subcategory_id: '実態中項目' };
export class BulkEditController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.selectedIds = new Set(); this.generation = 0; this.busy = false; this.dirty = false;
		this.originals = []; this.all = []; this.config = null; this.allowedFields = [];
	}
	get db() { return this.coordinator.db; }
	setup() {
		document.getElementById('month-tx-list').addEventListener('change', event => {
			const id = event.target.dataset.bulkId;
			if (!id) return;
			if (event.target.checked) this.selectedIds.add(id); else this.selectedIds.delete(id);
			this.updateCount();
		});
		document.getElementById('btn-bulk-select-page').addEventListener('click', () => {
			document.querySelectorAll('#month-tx-list [data-bulk-id]').forEach(input => { input.checked = true; this.selectedIds.add(input.dataset.bulkId); }); this.updateCount();
		});
		document.getElementById('btn-bulk-clear').addEventListener('click', () => this.clearSelection());
		document.getElementById('btn-bulk-edit').addEventListener('click', () => this.open());
		document.getElementById('btn-close-bulk').addEventListener('click', () => this.requestClose());
		document.getElementById('btn-cancel-bulk').addEventListener('click', () => this.requestClose());
		document.getElementById('btn-save-bulk').addEventListener('click', () => this.save());
		const modal = document.getElementById('modal-bulk-edit');
		modal.addEventListener('click', event => { if (event.target === modal) this.requestClose(); });
		modal.addEventListener('input', () => { this.dirty = true; });
		modal.addEventListener('change', event => {
			this.dirty = true;
			const field = event.target.dataset.applyField;
			if (field) document.getElementById(`bulk-value-${field}`).disabled = !event.target.checked;
			if ((/** @type {HTMLElement} */ (event.target)).id === 'bulk-value-category_id') this.populateSubcategories('');
			if ((/** @type {HTMLElement} */ (event.target)).id === 'bulk-value-actual_category_id') this.populateSubcategories('actual_');
		});
	}
	updateCount() {
		document.getElementById('bulk-selection-count').textContent = `${this.selectedIds.size}件選択`;
		document.getElementById('btn-bulk-edit').disabled = !this.selectedIds.size;
	}
	clearSelection() {
		this.selectedIds.clear();
		document.querySelectorAll('#month-tx-list [data-bulk-id]').forEach(input => { input.checked = false; }); this.updateCount();
	}
	reconcile(records) {
		const available = new Set(records.map(tx => tx.id));
		for (const id of this.selectedIds) if (!available.has(id)) this.selectedIds.delete(id);
		this.updateCount();
	}
	cancel() {
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
		const generation = ++this.generation, key = this.db.encryptionKey;
		const ids = new Set(this.selectedIds);
		try {
			const [all, config] = await Promise.all([this.db.getTransactions(), this.db.getMasterConfig()]);
			if (generation !== this.generation || key !== this.db.encryptionKey || this.coordinator.isKeyLocked) return;
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
		} catch (error) { if (generation === this.generation && !this.coordinator.isKeyLocked) alert(error.message); }
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
		const generation = this.generation, key = this.db.encryptionKey;
		const valid = () => generation === this.generation && key === this.db.encryptionKey && !this.coordinator.isKeyLocked;
		this.setBusy(true);
		let committed = false;
		try {
			const patch = {};
			for (const field of Object.keys(FIELDS)) if (document.getElementById(`bulk-apply-${field}`).checked) {
				const value = document.getElementById(`bulk-value-${field}`).value;
				if (field === 'amount' && value === '') throw new Error('変更金額を入力してください。');
				patch[field] = field === 'amount' ? Number(value) : field === 'tags' ? [...new Set(value.split(/[,、\n]/).map(tag => tag.trim()).filter(Boolean))] : field.endsWith('category_id') || field.endsWith('subcategory_id') ? value || null : value;
			}
			const records = buildBulkEdit(this.originals, patch, this.all);
			const approved = await this.coordinator.approveClosedChanges(records, this.originals);
			if (approved === null || !valid()) return;
			await this.db.bulkEditTransactions(this.originals, patch, approved, { isSessionValid: valid });
			committed = true;
			if (!valid()) return;
			this.setBusy(false); this.dirty = false; this.requestClose(); this.clearSelection();
			this.coordinator.showToast('明細を一括編集しました。');
			this.coordinator.syncManager?.syncBidirectional().catch(() => {});
			try { await this.coordinator.refreshAllViews(); } catch (error) { if (!this.coordinator.isKeyLocked) alert(`変更は保存済みです。表示の更新に失敗しました。一覧を開き直してください: ${error.message}`); }
		} catch (error) { if (valid() && !committed) document.getElementById('bulk-edit-error').textContent = error.message; }
		finally { if (valid()) this.setBusy(false); }
	}
}
