/**
 * Yoseatsume Kakeibo - Transaction Edit Controller
 * Manages transaction editing modal, past closed month retroactive updates, and deletion.
 */

import { escapeHtml } from '../logic.js';
import { TagMemoInput } from './tag_memo_input.js';
import { canonicalJsonStringify } from '../crypto.js';

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
	}

	get db() {
		return this.coordinator.db;
	}

	get syncManager() {
		return this.coordinator.syncManager;
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

		document.getElementById('edit-tx-amount')?.addEventListener('input', () => { this.currentTaxMeta = null; });

		btnClose?.addEventListener('click', () => this.requestClose());
		document.getElementById('btn-cancel-edit-tx')?.addEventListener('click', () => this.requestClose());
		this.tagMemoInput = new TagMemoInput({
			host: this, source: this.coordinator.txInputController,
			ids: { text: 'edit-tag-text', chips: 'edit-tags-chips-list', hidden: 'edit-tx-tags', tags: 'edit-tags-suggest-dropdown', box: 'edit-tags-chip-container', memo: 'edit-tx-memo', memos: 'edit-memo-suggest-dropdown' }
		});
		this.tagMemoInput.setup();

		typeSelect?.addEventListener('change', () => {
			const isTransfer = typeSelect.value === 'transfer';
			const toGroup = document.getElementById('edit-tx-to-account-group');
			const catGroup = document.getElementById('edit-tx-cat-container');
			if (toGroup) toGroup.style.display = isTransfer ? 'block' : 'none';
			if (catGroup) catGroup.style.display = isTransfer ? 'none' : 'block';
			if (!isTransfer) this.populateTypeCategories(typeSelect.value).catch(error => alert(`分類の更新に失敗しました: ${error.message}`));
		});

		catSelect?.addEventListener('change', async () => {
			await this.coordinator.txInputController.updateSubcategories(catSelect.value, 'edit-tx-subcategory');
			this.syncActualClassification();
		});
		document.getElementById('edit-tx-subcategory')?.addEventListener('change', () => this.syncActualClassification());
		document.getElementById('edit-chk-sync-actual-category')?.addEventListener('change', () => this.syncActualClassification());

		actCatSelect?.addEventListener('change', () => {
			this.coordinator.txInputController.updateSubcategories(actCatSelect.value, 'edit-tx-actual-subcategory');
		});

		btnTaxCalc?.addEventListener('click', () => {
			this.coordinator.txInputController.openCalculatorFor('edit-tx-amount');
		});

		form?.addEventListener('submit', async (e) => {
			e.preventDefault();
			try {
				await this.handleEditFormSubmit();
			} catch (error) {
				alert(`明細の保存に失敗しました: ${error.message}`);
			}
		});

		btnDelete?.addEventListener('click', async () => {
			const id = document.getElementById('edit-tx-id')?.value;
			if (!id) return;
			if (confirm('この明細を削除しますか？')) {
				try { await this.handleEditDelete(id); } catch (error) { alert(`明細の削除に失敗しました: ${error.message}`); }
			}
		});
	}

	async openEditTransactionModal(id) {
		const modal = document.getElementById('modal-edit-tx');
		if (!modal) return;
		const tx = await this.db.getTransaction(id);
		if (!tx) return;
		this.originalTransaction = structuredClone(tx);
		this.originalGroup = tx.group_id ? await this.db.getTransactions({ group_id: tx.group_id, includeDeleted: true }) : [tx];
		this.currentTaxMeta = tx.tax_meta || null;

		const config = await this.db.getMasterConfig();
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
		if (accSelect) accSelect.innerHTML = options(accounts, tx.account_id);
		if (toAccSelect) toAccSelect.innerHTML = options(accounts, tx.to_account_id);

		// Populate categories
		const catSelect = document.getElementById('edit-tx-category');
		const actCatSelect = document.getElementById('edit-tx-actual-category');
		if (catSelect) catSelect.innerHTML = options(categories.filter(category => (category.type || 'expense') === tx.type || category.id === tx.category_id), tx.category_id);
		if (actCatSelect) actCatSelect.innerHTML = options(categories.filter(category => (category.type || 'expense') === tx.type || category.id === (tx.actual_category_id || tx.category_id)), tx.actual_category_id || tx.category_id);

		// Set values
		const idInput = document.getElementById('edit-tx-id');
		const dateInput = document.getElementById('edit-tx-date');
		const typeSelect = document.getElementById('edit-tx-type');
		const amountInput = /** @type {HTMLInputElement} */ (document.getElementById('edit-tx-amount'));
		const memoInput = document.getElementById('edit-tx-memo');
		const tagsInput = document.getElementById('edit-tx-tags');
		const statusSelect = document.getElementById('edit-tx-status');

		if (idInput) idInput.value = tx.id;
		if (dateInput) dateInput.value = tx.date;
		if (typeSelect) {
			typeSelect.value = tx.type;
			typeSelect.disabled = Boolean(tx.amortization_meta);
		}
		if (amountInput) {
			amountInput.value = tx.amount_pending ? '' : tx.amount;
			amountInput.required = !tx.amount_pending;
		}
		if (accSelect) accSelect.value = tx.account_id || '';
		if (toAccSelect) {
			toAccSelect.value = tx.to_account_id || '';
			toAccSelect.disabled = Boolean(tx.amortization_meta?.is_payment_record);
		}

		const catId = tx.category_id || (categories.find(c => !c.is_archived)?.id || '');
		if (catSelect) catSelect.value = catId;
		await this.coordinator.txInputController.updateSubcategories(catId, 'edit-tx-subcategory', tx.subcategory_id);
		const subSelect = document.getElementById('edit-tx-subcategory');
		if (subSelect) subSelect.value = tx.subcategory_id || '';

		const actCatId = tx.actual_category_id || catId;
		if (actCatSelect) actCatSelect.value = actCatId;
		await this.coordinator.txInputController.updateSubcategories(actCatId, 'edit-tx-actual-subcategory', tx.actual_subcategory_id);
		const actSubSelect = document.getElementById('edit-tx-actual-subcategory');
		if (actSubSelect) actSubSelect.value = tx.actual_subcategory_id || '';
		const sameClassification = document.getElementById('edit-chk-sync-actual-category');
		if (sameClassification) sameClassification.checked = catId === actCatId && (tx.subcategory_id || '') === (tx.actual_subcategory_id || '');
		this.syncActualClassification();

		if (memoInput) memoInput.value = tx.memo || '';
		if (tagsInput) tagsInput.value = (tx.tags || []).join(', ');
		this.confirmedTags = [...(tx.tags || [])];
		this.tagMemoInput.get('text').value = '';
		this.tagMemoInput.renderTagChips();
		this.tagMemoInput.hide('tags');
		this.tagMemoInput.hide('memos');
		await this.coordinator.txInputController.updateTagAndMemoSuggestions();
		if (statusSelect) statusSelect.value = tx.status || 'confirmed';

		// Show/hide transfer
		const isTransfer = tx.type === 'transfer';
		const toGroup = document.getElementById('edit-tx-to-account-group');
		const catGroup = document.getElementById('edit-tx-cat-container');
		if (toGroup) toGroup.style.display = isTransfer ? 'block' : 'none';
		if (catGroup) catGroup.style.display = isTransfer ? 'none' : 'block';

		this.initialValues = this.captureValues();
		modal.classList.add('active');
	}

	syncActualClassification() {
		const same = document.getElementById('edit-chk-sync-actual-category')?.checked;
		const container = document.getElementById('edit-actual-category-container');
		if (container) container.style.display = same ? 'none' : 'block';
		if (!same) return;
		for (const [sourceId, targetId] of [['edit-tx-category', 'edit-tx-actual-category'], ['edit-tx-subcategory', 'edit-tx-actual-subcategory']]) {
			const source = document.getElementById(sourceId);
			const target = document.getElementById(targetId);
			if (source && target) {
				target.innerHTML = source.innerHTML;
				target.value = source.value;
			}
		}
	}

	captureValues() {
		return JSON.stringify({
			fields: Array.from(document.querySelectorAll('#edit-tx-form input, #edit-tx-form select'), element => [element.id, element.value, element instanceof HTMLInputElement && element.type === 'checkbox' ? element.checked : null]),
			tax: this.currentTaxMeta
		});
	}

	requestClose() {
		if (this.initialValues !== this.captureValues() && !confirm('編集中の変更を破棄して閉じますか？')) return false;
		this.close();
		return true;
	}

	close() {
		document.getElementById('modal-edit-tx')?.classList.remove('active');
		this.tagMemoInput.hide('tags');
		this.tagMemoInput.hide('memos');
	}

	async populateTypeCategories(type) {
		const config = await this.db.getMasterConfig();
		if (document.getElementById('edit-tx-type')?.value !== type) return;
		const categories = (config?.categories || []).filter(category => !category.is_archived && (category.type || 'expense') === type);
		for (const [parentId, childId] of [['edit-tx-category', 'edit-tx-subcategory'], ['edit-tx-actual-category', 'edit-tx-actual-subcategory']]) {
			const parent = document.getElementById(parentId);
			const old = parent.value;
			parent.innerHTML = categories.map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(category.name)}</option>`).join('');
			if (categories.some(category => category.id === old)) parent.value = old;
			await this.coordinator.txInputController.updateSubcategories(parent.value, childId);
			if (document.getElementById('edit-tx-type')?.value !== type) return;
		}
		this.syncActualClassification();
	}

	async handleEditFormSubmit() {
		if (this.busy) return;
		this.busy = true;
		const operation = ++this.operation;
		try { return await this.saveEdit(); }
		finally { if (operation === this.operation) this.busy = false; }
	}

	async saveEdit() {
		this.tagMemoInput.commitPending();
		const id = document.getElementById('edit-tx-id')?.value;
		const tx = await this.db.getTransaction(id);
		if (!tx) throw new Error('明細が削除または変更されました。開き直して確認してください。');
		if (!this.originalTransaction || this.originalTransaction.id !== id || canonicalJsonStringify(tx) !== canonicalJsonStringify(this.originalTransaction)) throw new Error('明細が別の操作で変更されました。開き直して確認してください。');

		const editDate = document.getElementById('edit-tx-date')?.value;
		const editType = document.getElementById('edit-tx-type')?.value;
		const amountInput = document.getElementById('edit-tx-amount')?.value.trim() || '';
		const editAmount = Number(amountInput) || 0;
		const editAccount = document.getElementById('edit-tx-account')?.value;
		const editToAccount = document.getElementById('edit-tx-to-account')?.value;
		const editCat = document.getElementById('edit-tx-category')?.value;
		const editSub = document.getElementById('edit-tx-subcategory')?.value || null;
		const sameClassification = document.getElementById('edit-chk-sync-actual-category')?.checked;
		const editActCat = sameClassification ? editCat : document.getElementById('edit-tx-actual-category')?.value;
		const editActSub = sameClassification ? editSub : document.getElementById('edit-tx-actual-subcategory')?.value || null;
		const editMemo = document.getElementById('edit-tx-memo')?.value || '';
		const editTags = (document.getElementById('edit-tx-tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
		const editStatus = document.getElementById('edit-tx-status')?.value || 'confirmed';

		const previousMonth = tx.previous_target_month || (tx.target_month !== editDate.slice(0, 7) ? tx.target_month : null);
		const movement = previousMonth ? { previous_target_month: previousMonth } : {};
		const groupTxs = tx.group_id && (tx.amortization_meta || tx.group_id.startsWith('grp_prepaid'))
			? await this.db.getTransactionsByGroupId(tx.group_id)
			: [];
		for (const current of groupTxs) {
			const original = this.originalGroup.find(record => record.id === current.id);
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
		const approved = await this.coordinator.approveClosedChanges(prospective, cascade ? groupTxs : [tx]);
		if (approved === null) return;
		let changedTxs;

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
				tax_meta: this.currentTaxMeta,
				...movement,
				updated_at: new Date().toISOString(),
				sync_status: 'unsynced'
			}, { expectedTransactions: this.originalGroup });
			changedTxs = await this.db.getTransactionsByGroupId(tx.group_id);
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
				tax_meta: this.currentTaxMeta,
				updated_at: new Date().toISOString(),
				sync_status: 'unsynced'
			});
			const saved = await this.db.putTransaction(tx, { expectedTransactions: [this.originalTransaction] });
			changedTxs = [saved];
		}

		this.busy = false;
		this.close();
		this.coordinator.showToast(cascade ? '✅ 関連明細を一括修正しました' : '✅ 明細を修正しました');
		const snapshot = await this.db.getSnapshot();
		const closedTxs = changedTxs.filter(t => t.previous_target_month || (snapshot?.last_closed_month && t.target_month <= snapshot.last_closed_month));
		if (closedTxs.length > 0 && this.syncManager?.gasUrl && this.syncManager?.privateKey) {
			try {
				await this.syncManager.syncPendingDiffs();
				const latest = await Promise.all(changedTxs.map(record => this.db.getTransaction(record.id)));
				alert(latest.every(record => record?.sync_status === 'synced') ? '過去締め月の明細を修正し、スナップショットを再計算しました' : '変更を端末内に保存しました。同期は未完了です。');
			} catch (err) {
				alert(`遡及更新エラー: ${err.message}`);
			}
		} else {
			this.syncManager?.syncPendingDiffs().catch(e => console.log('Sync deferred:', e.message));
		}
		await this.coordinator.refreshAllViews();
	}

	async handleEditDelete(id) {
		if (this.busy) return;
		this.busy = true;
		const operation = ++this.operation;
		try { return await this.deleteEdit(id); }
		finally { if (operation === this.operation) this.busy = false; }
	}

	async deleteEdit(id) {
		const tx = await this.db.getTransaction(id);
		if (!tx) return;
		const editingCurrent = document.getElementById('modal-edit-tx')?.classList.contains('active') && this.originalTransaction?.id === id;
		const original = editingCurrent ? this.originalTransaction : structuredClone(tx);
		if (canonicalJsonStringify(tx) !== canonicalJsonStringify(original)) throw new Error('明細が別の操作で変更されました。開き直して確認してください。');
		const approved = await this.coordinator.approveClosedChanges([{ ...tx, is_deleted: true }], [tx]);
		if (approved === null) return;
		tx.is_deleted = true;
		tx.reclose_approved_months = approved;
		tx.updated_at = new Date().toISOString();
		tx.sync_status = 'unsynced';
		const saved = await this.db.putTransaction(tx, { expectedTransactions: [original] });
		this.coordinator.showToast('🗑️ 明細を削除しました');

		const snapshot = await this.db.getSnapshot();
		const isPastClosed = snapshot?.last_closed_month && saved.target_month <= snapshot.last_closed_month;

		this.busy = false;
		this.close();

		if (isPastClosed && this.syncManager?.gasUrl && this.syncManager?.privateKey) {
			try {
				await this.syncManager.syncPendingDiffs();
				const latest = await this.db.getTransaction(id);
				alert(!latest?.is_deleted ? '別端末の新しい変更を反映したため、削除は行いませんでした。' : latest.sync_status === 'synced' ? '過去締め月の明細を削除し、スナップショットを再計算しました' : '削除を端末内に保存しました。同期は未完了です。');
			} catch (err) {
				alert(`遡及削除エラー: ${err.message}`);
			}
		} else {
			this.syncManager?.syncPendingDiffs().catch(e => console.log('Sync deferred:', e.message));
		}

		await this.coordinator.refreshAllViews();
	}
}

