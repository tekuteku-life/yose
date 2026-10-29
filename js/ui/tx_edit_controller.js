/**
 * Yoseatsume Kakeibo - Transaction Edit Controller
 * Manages transaction editing modal, past closed month retroactive updates, and deletion.
 */

import { escapeHtml } from '../logic.js';
import { TagMemoInput } from './tag_memo_input.js';
import { canonicalJsonStringify } from '../crypto.js';
import { captureRenderSession, readInRenderSession } from './render_session.js';
import { beginFormBusy, captureFormValues } from './form_busy.js';

export class TransactionEditController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.currentTaxMeta = null;
		this.confirmedTags = [];
		this.initialValues = null;
		this.originalTransaction = null;
		this.originalGroup = [];
		this.busy = false;
		this.operation = 0;
		this.generation = 0;
		this.releaseBusy = null;
	}

	get db() {
		return this.coordinator.db;
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

		document.getElementById('btn-edit-link-advance')?.addEventListener('click', async () => {
			if (this.busy) return;
			if (this.initialValues !== this.captureValues()) { alert('編集中の変更を先に保存するか、取消してからひも付けてください。'); return; }
			try { await this.coordinator.advanceLinkController.open(this.originalTransaction); }
			catch (error) { alert(`ひも付けを開始できませんでした: ${error.message}`); }
		});

		document.getElementById('edit-tx-amount')?.addEventListener('input', () => { this.currentTaxMeta = null; });

		btnClose?.addEventListener('click', () => this.requestClose());
		document.getElementById('btn-cancel-edit-tx')?.addEventListener('click', () => this.requestClose());
		this.tagMemoInput = new TagMemoInput({
			host: this, source: this.coordinator.txInputController,
			ids: { text: 'edit-tag-text', chips: 'edit-tags-chips-list', hidden: 'edit-tx-tags', tags: 'edit-tags-suggest-dropdown', box: 'edit-tags-chip-container', memo: 'edit-tx-memo', memos: 'edit-memo-suggest-dropdown' }
		});
		this.tagMemoInput.setup();

		typeSelect?.addEventListener('change', () => {
			const operation = this.operation, generation = this.generation, type = typeSelect.value;
			const valid = captureRenderSession(this.coordinator, () => !this.busy && operation === this.operation && generation === this.generation && typeSelect.value === type);
			const isTransfer = type === 'transfer';
			const toGroup = document.getElementById('edit-tx-to-account-group');
			const catGroup = document.getElementById('edit-tx-cat-container');
			toGroup.style.display = isTransfer ? 'block' : 'none';
			catGroup.style.display = isTransfer ? 'none' : 'block';
			if (!isTransfer) this.populateTypeCategories(type).catch(error => { if (valid()) alert(`分類の更新に失敗しました: ${error.message}`); });
		});

		catSelect?.addEventListener('change', async () => {
			const operation = this.operation, generation = this.generation;
			const valid = captureRenderSession(this.coordinator, () => !this.busy && operation === this.operation && generation === this.generation);
			await this.coordinator.txInputController.updateSubcategories(catSelect.value, 'edit-tx-subcategory', null, false, { isSessionValid: valid });
			if (valid()) this.syncActualClassification();
		});
		document.getElementById('edit-tx-subcategory')?.addEventListener('change', () => this.syncActualClassification());
		document.getElementById('edit-chk-sync-actual-category')?.addEventListener('change', () => this.syncActualClassification());

		actCatSelect?.addEventListener('change', () => {
			const operation = this.operation, generation = this.generation;
			const valid = captureRenderSession(this.coordinator, () => !this.busy && operation === this.operation && generation === this.generation);
			this.coordinator.txInputController.updateSubcategories(actCatSelect.value, 'edit-tx-actual-subcategory', null, false, { isSessionValid: valid });
		});

		btnTaxCalc?.addEventListener('click', () => {
			this.coordinator.txInputController.openCalculatorFor('edit-tx-amount');
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
		if (this.busy) return;
		const generation = ++this.generation;
		const valid = captureRenderSession(this.coordinator, () => generation === this.generation && !this.busy);
		try {
			const tx = await this.db.getTransaction(id);
			if (!valid() || !tx || tx.is_deleted) return;
			const [group, config] = await Promise.all([tx.group_id ? this.db.getTransactions({ group_id: tx.group_id, includeDeleted: true }) : Promise.resolve([tx]), this.db.getMasterConfig()]);
			if (!valid()) return;
			this.originalTransaction = structuredClone(tx);
			document.getElementById('btn-edit-link-advance').hidden = !(tx.advance_source_id || tx.type === 'income' || (tx.type === 'transfer' && (tx.account_id === 'acc_receivable' || tx.to_account_id === 'acc_receivable')));
			this.originalGroup = group;
			this.currentTaxMeta = tx.tax_meta || null;

			const accounts = config?.accounts || [];
			const categories = config?.categories || [];
			const options = (items, current) => {
				const visible = items.filter(item => !item.is_archived || item.id === current);
				if (current && !items.some(item => item.id === current)) visible.push({ id: current, name: `不明な項目 (${current})`, is_archived: true });
				return visible.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}${item.is_archived ? '（アーカイブ済み）' : ''}</option>`).join('');
			};

			// Populate accounts
			const accSelect = document.getElementById('edit-tx-account');
			const toAccSelect = document.getElementById('edit-tx-to-account');
			accSelect.innerHTML = options(accounts, tx.account_id);
			toAccSelect.innerHTML = options(accounts, tx.to_account_id);

			// Populate categories
			const catSelect = document.getElementById('edit-tx-category');
			const actCatSelect = document.getElementById('edit-tx-actual-category');
			catSelect.innerHTML = options(categories.filter(category => (category.type || 'expense') === tx.type || category.id === tx.category_id), tx.category_id);
			actCatSelect.innerHTML = options(categories.filter(category => (category.type || 'expense') === tx.type || category.id === (tx.actual_category_id || tx.category_id)), tx.actual_category_id || tx.category_id);

			// Set values
			const idInput = document.getElementById('edit-tx-id');
			const dateInput = document.getElementById('edit-tx-date');
			const typeSelect = document.getElementById('edit-tx-type');
			const amountInput = /** @type {HTMLInputElement} */ (document.getElementById('edit-tx-amount'));
			const memoInput = document.getElementById('edit-tx-memo');
			const tagsInput = document.getElementById('edit-tx-tags');
			const statusSelect = document.getElementById('edit-tx-status');

			idInput.value = tx.id;
			dateInput.value = tx.date;
			typeSelect.value = tx.type;
			typeSelect.disabled = Boolean(tx.amortization_meta);
			amountInput.value = tx.amount_pending ? '' : tx.amount;
			amountInput.required = !tx.amount_pending;
			accSelect.value = tx.account_id || '';
			toAccSelect.value = tx.to_account_id || '';
			toAccSelect.disabled = Boolean(tx.amortization_meta?.is_payment_record);

			const catId = tx.category_id || (categories.find(c => !c.is_archived)?.id || '');
			catSelect.value = catId;
			await this.coordinator.txInputController.updateSubcategories(catId, 'edit-tx-subcategory', tx.subcategory_id, false, { isSessionValid: valid });
			if (!valid()) return;
			const subSelect = document.getElementById('edit-tx-subcategory');
			subSelect.value = tx.subcategory_id || '';

			const actCatId = tx.actual_category_id || catId;
			actCatSelect.value = actCatId;
			await this.coordinator.txInputController.updateSubcategories(actCatId, 'edit-tx-actual-subcategory', tx.actual_subcategory_id, false, { isSessionValid: valid });
			if (!valid()) return;
			const actSubSelect = document.getElementById('edit-tx-actual-subcategory');
			actSubSelect.value = tx.actual_subcategory_id || '';
			const sameClassification = document.getElementById('edit-chk-sync-actual-category');
			sameClassification.checked = catId === actCatId && (tx.subcategory_id || '') === (tx.actual_subcategory_id || '');
			this.syncActualClassification();

			memoInput.value = tx.memo || '';
			tagsInput.value = (tx.tags || []).join(', ');
			this.confirmedTags = [...(tx.tags || [])];
			this.tagMemoInput.get('text').value = '';
			this.tagMemoInput.renderTagChips();
			this.tagMemoInput.hide('tags');
			this.tagMemoInput.hide('memos');
			await this.coordinator.txInputController.updateTagAndMemoSuggestions({ isSessionValid: valid });
			if (!valid()) return;
			statusSelect.value = tx.status || 'confirmed';

			// Show/hide transfer
			const isTransfer = tx.type === 'transfer';
			const toGroup = document.getElementById('edit-tx-to-account-group');
			const catGroup = document.getElementById('edit-tx-cat-container');
			toGroup.style.display = isTransfer ? 'block' : 'none';
			catGroup.style.display = isTransfer ? 'none' : 'block';

			this.initialValues = this.captureValues();
			modal.classList.add('active');
		} catch (error) { if (valid()) alert(`明細を開けませんでした: ${error.message}`); }
	}

	syncActualClassification() {
		const same = document.getElementById('edit-chk-sync-actual-category')?.checked;
		const container = document.getElementById('edit-actual-category-container');
		container.style.display = same ? 'none' : 'block';
		if (!same) return;
		for (const [sourceId, targetId] of [['edit-tx-category', 'edit-tx-actual-category'], ['edit-tx-subcategory', 'edit-tx-actual-subcategory']]) {
			const source = document.getElementById(sourceId);
			const target = document.getElementById(targetId);
			target.innerHTML = source.innerHTML;
			target.value = source.value;
		}
	}

	captureValues() {
		return JSON.stringify({
			fields: Array.from(document.querySelectorAll('#edit-tx-form input, #edit-tx-form select'), element => [element.id, element.value, element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : null]),
			tax: this.currentTaxMeta
		});
	}

	requestClose() {
		if (this.busy) return false;
		if (this.initialValues !== this.captureValues() && !confirm('編集中の変更を破棄して閉じますか？')) return false;
		this.close();
		return true;
	}

	close() {
		this.generation++;
		this.coordinator.advanceLinkController.cancel();
		document.getElementById('modal-edit-tx')?.classList.remove('active');
		this.tagMemoInput.hide('tags');
		this.tagMemoInput.hide('memos');
	}

	async populateTypeCategories(type) {
		const operation = this.operation, generation = this.generation;
		const valid = captureRenderSession(this.coordinator, () => !this.busy && operation === this.operation && generation === this.generation && document.getElementById('edit-tx-type')?.value === type);
		if (!valid()) return;
		const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
		if (!valid()) return;
		const categories = (config?.categories || []).filter(category => !category.is_archived && (category.type || 'expense') === type);
		for (const [parentId, childId] of [['edit-tx-category', 'edit-tx-subcategory'], ['edit-tx-actual-category', 'edit-tx-actual-subcategory']]) {
			const parent = document.getElementById(parentId);
			const old = parent.value;
			parent.innerHTML = categories.map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
			if (categories.some(category => category.id === old)) parent.value = old;
			await this.coordinator.txInputController.updateSubcategories(parent.value, childId, null, false, { isSessionValid: valid });
			if (!valid()) return;
		}
		this.syncActualClassification();
	}

	async handleEditFormSubmit() {
		if (this.busy || this.coordinator.isKeyLocked) return;
		this.tagMemoInput.commitPending();
		const draft = { ...captureFormValues(document.getElementById('edit-tx-form')), taxMeta: structuredClone(this.currentTaxMeta), original: structuredClone(this.originalTransaction), group: structuredClone(this.originalGroup) };
		this.busy = true;
		const operation = ++this.operation, sessionValid = captureRenderSession(this.coordinator);
		const valid = () => operation === this.operation && sessionValid();
		this.releaseBusy = beginFormBusy(document.getElementById('modal-edit-tx'), document.querySelector('#edit-tx-form button[type=submit]'), '保存中…');
		try { return await this.saveEdit(draft, valid); }
		catch (error) { if (valid()) alert(`明細の保存に失敗しました: ${error.message}`); }
		finally { if (operation === this.operation) { this.releaseBusy(); this.releaseBusy = null; this.busy = false; } }
	}

	cancelPendingOperations() {
		this.operation++; this.generation++;
		this.releaseBusy?.(); this.releaseBusy = null; this.busy = false;
		this.originalTransaction = null; this.originalGroup = [];
		if (this.tagMemoInput) this.close();
	}

	async saveEdit(draft, valid) {
		const values = draft.values;
		const id = values['edit-tx-id'];
		const tx = await this.db.getTransaction(id);
		if (!valid()) return;
		if (!tx) throw new Error('明細が削除または変更されました。開き直して確認してください。');
		if (!draft.original || draft.original.id !== id || canonicalJsonStringify(tx) !== canonicalJsonStringify(draft.original)) throw new Error('明細が別の操作で変更されました。開き直して確認してください。');

		const editDate = values['edit-tx-date'];
		const editType = values['edit-tx-type'];
		const amountInput = values['edit-tx-amount'].trim() || '';
		const editAmount = Number(amountInput) || 0;
		const editAccount = values['edit-tx-account'];
		const editToAccount = values['edit-tx-to-account'];
		const editCat = values['edit-tx-category'];
		const editSub = values['edit-tx-subcategory'] || null;
		const sameClassification = draft.checked['edit-chk-sync-actual-category'];
		const editActCat = sameClassification ? editCat : values['edit-tx-actual-category'];
		const editActSub = sameClassification ? editSub : values['edit-tx-actual-subcategory'] || null;
		const editMemo = values['edit-tx-memo'] || '';
		const editTags = (values['edit-tx-tags'] || '').split(',').map(s => s.trim()).filter(Boolean);
		const editStatus = values['edit-tx-status'] || 'confirmed';

		const previousMonth = tx.previous_target_month || (tx.target_month !== editDate.slice(0, 7) ? tx.target_month : null);
		const movement = previousMonth ? { previous_target_month: previousMonth } : {};
		const groupTxs = tx.group_id && (tx.amortization_meta || tx.group_id.startsWith('grp_prepaid'))
			? await this.db.getTransactionsByGroupId(tx.group_id)
			: [];
		if (!valid()) return;
		for (const current of groupTxs) {
			const original = draft.group.find(record => record.id === current.id);
			if (!original || canonicalJsonStringify(original) !== canonicalJsonStringify(current)) throw new Error('関連明細が変更されました。開き直して確認してください。');
		}
		const paymentTx = groupTxs.find(t => t.amortization_meta?.is_payment_record);
		const amortTxs = groupTxs.filter(t => t.type === 'expense' && t.amortization_meta && !t.amortization_meta.is_payment_record);
		const cascade = paymentTx && amortTxs.length > 0 && groupTxs.length > 1 && confirm('この取引は前払分割計上の一部です。\n関連する明細の費目・メモ・タグと、変更された金額を連動更新しますか？\n（キャンセル: この明細のみ修正）');
		const amountChanged = editAmount !== tx.amount || Boolean(tx.amount_pending && amountInput);
		const amountPending = Boolean(tx.amount_pending && !amountInput);
		if (amountPending && editStatus === 'confirmed') throw new Error('金額未入力の予定は確定できません。金額を入力してください。');
		const ownChanges = { id, date: editDate, target_month: editDate.slice(0, 7), status: editStatus, amount_pending: amountPending, ...movement };
		const prospective = (cascade ? groupTxs : [tx]).map(record => ({
			...record,
			...(cascade && amountChanged ? { amount_pending: false } : {}),
			...(record.id === id ? ownChanges : {})
		}));
		const approved = await this.coordinator.approveClosedChanges(prospective, cascade ? groupTxs : [tx], { isSessionValid: valid });
		if (approved === null || !valid()) return;

		if (cascade) {
			/** @type {Record<string, any>} */
			const updates = { memo: editMemo, tags: editTags, reclose_approved_months: approved };
			if (amountChanged) {
				updates.total_amount = tx.amortization_meta?.is_payment_record ? editAmount : editAmount * amortTxs.length;
			}
			if (tx.type === 'expense') {
				Object.assign(updates, {
					category_id: editCat,
					subcategory_id: editSub,
					actual_category_id: editActCat,
					actual_subcategory_id: editActSub
				});
			}
			await this.db.updateInstallmentGroup(tx.group_id, updates, null, {
				amount_pending: amountPending,
				id,
				date: editDate,
				target_month: editDate.slice(0, 7),
				account_id: editAccount,
				status: editStatus,
				tax_meta: draft.taxMeta,
				...movement,
				updated_at: new Date().toISOString(),
				sync_status: 'unsynced'
			}, { expectedTransactions: draft.group, isSessionValid: valid });
		} else {
			Object.assign(tx, {
				amount_pending: amountPending,
				reclose_approved_months: approved,
				...movement,
				date: editDate,
				target_month: editDate.slice(0, 7),
				type: editType,
				amount: editAmount,
				account_id: editAccount,
				to_account_id: editType === 'transfer' ? editToAccount : null,
				category_id: editType === 'transfer' ? null : editCat,
				subcategory_id: editType === 'transfer' ? null : editSub,
				actual_category_id: editType === 'transfer' ? null : editActCat,
				actual_subcategory_id: editType === 'transfer' ? null : editActSub,
				memo: editMemo,
				tags: editTags,
				status: editStatus,
				tax_meta: draft.taxMeta,
				updated_at: new Date().toISOString(),
				sync_status: 'unsynced'
			});
			await this.db.putTransaction(tx, { expectedTransactions: [draft.original], isSessionValid: valid });
		}
		if (!valid()) return;
		try { await this.coordinator.refreshAfterTransactionChange({ isSessionValid: valid }); }
		catch (error) { if (valid()) alert(`変更は保存済みです。表示の更新に失敗しました: ${error.message}`); }
		if (!valid()) return;
		this.close();
		this.coordinator.showToast(cascade ? '✅ 関連明細を一括修正しました' : '✅ 明細を修正しました');
	}

	async handleEditDelete(id) {
		if (this.busy || this.coordinator.isKeyLocked) return;
		this.busy = true;
		const operation = ++this.operation, sessionValid = captureRenderSession(this.coordinator);
		const valid = () => operation === this.operation && sessionValid();
		const modal = document.getElementById('modal-edit-tx');
		const editing = modal.classList.contains('active') && this.originalTransaction?.id === id;
		const original = editing ? structuredClone(this.originalTransaction) : null;
		const button = editing ? document.getElementById('btn-edit-delete-tx') : [...document.querySelectorAll('.btn-delete-tx')].find(item => item.dataset.id === id);
		this.releaseBusy = button ? beginFormBusy(editing ? modal : button.closest('.tx-item'), button, '削除中…') : null;
		try { return await this.deleteEdit(id, original, valid, editing); }
		catch (error) { if (valid()) alert(`明細の削除に失敗しました: ${error.message}`); }
		finally { if (operation === this.operation) { this.releaseBusy?.(); this.releaseBusy = null; this.busy = false; } }
	}

	async deleteEdit(id, expected, valid, editing) {
		const tx = await this.db.getTransaction(id);
		if (!valid() || !tx || tx.is_deleted) return;
		const original = expected || structuredClone(tx);
		if (canonicalJsonStringify(tx) !== canonicalJsonStringify(original)) throw new Error('明細が別の操作で変更されました。開き直して確認してください。');
		const approved = await this.coordinator.approveClosedChanges([{ ...tx, is_deleted: true }], [tx], { isSessionValid: valid });
		if (approved === null || !valid()) return;
		tx.is_deleted = true;
		tx.reclose_approved_months = approved;
		tx.updated_at = new Date().toISOString();
		tx.sync_status = 'unsynced';
		await this.db.putTransaction(tx, { expectedTransactions: [original], isSessionValid: valid });
		if (!valid()) return;
		try { await this.coordinator.refreshAfterTransactionChange({ isSessionValid: valid }); }
		catch (error) { if (valid()) alert(`削除は保存済みです。表示の更新に失敗しました: ${error.message}`); }
		if (!valid()) return;
		if (editing) this.close();
		this.coordinator.showToast('🗑️ 明細を削除しました');
	}
}

