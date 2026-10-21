/**
 * Yoseatsume Kakeibo - Transaction Edit Controller
 * Manages transaction editing modal, past closed month retroactive updates, and deletion.
 */

import { escapeHtml } from '../logic.js';

export class TransactionEditController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.currentTaxMeta = null;
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

		btnClose?.addEventListener('click', () => modal.classList.remove('active'));

		typeSelect?.addEventListener('change', () => {
			const isTransfer = typeSelect.value === 'transfer';
			const toGroup = document.getElementById('edit-tx-to-account-group');
			const catGroup = document.getElementById('edit-tx-cat-container');
			if (toGroup) toGroup.style.display = isTransfer ? 'block' : 'none';
			if (catGroup) catGroup.style.display = isTransfer ? 'none' : 'block';
		});

		catSelect?.addEventListener('change', () => {
			this.coordinator.txInputController.updateSubcategories(catSelect.value, 'edit-tx-subcategory');
		});

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
				await this.handleEditDelete(id);
			}
		});
	}

	async openEditTransactionModal(id) {
		const modal = document.getElementById('modal-edit-tx');
		if (!modal) return;
		const tx = await this.db.getTransaction(id);
		if (!tx) return;
		this.currentTaxMeta = tx.tax_meta || null;

		const config = await this.db.getMasterConfig();
		const activeAccounts = (config?.accounts || []).filter(a => !a.is_archived);
		const activeCats = (config?.categories || []).filter(c => !c.is_archived);

		// Populate accounts
		const accSelect = document.getElementById('edit-tx-account');
		const toAccSelect = document.getElementById('edit-tx-to-account');
		const accOptions = activeAccounts.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
		if (accSelect) accSelect.innerHTML = accOptions;
		if (toAccSelect) toAccSelect.innerHTML = accOptions;

		// Populate categories
		const catSelect = document.getElementById('edit-tx-category');
		const actCatSelect = document.getElementById('edit-tx-actual-category');
		const catOptions = activeCats.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
		if (catSelect) catSelect.innerHTML = catOptions;
		if (actCatSelect) actCatSelect.innerHTML = catOptions;

		// Set values
		const idInput = document.getElementById('edit-tx-id');
		const dateInput = document.getElementById('edit-tx-date');
		const typeSelect = document.getElementById('edit-tx-type');
		const amountInput = document.getElementById('edit-tx-amount');
		const memoInput = document.getElementById('edit-tx-memo');
		const tagsInput = document.getElementById('edit-tx-tags');
		const statusSelect = document.getElementById('edit-tx-status');

		if (idInput) idInput.value = tx.id;
		if (dateInput) dateInput.value = tx.date;
		if (typeSelect) {
			typeSelect.value = tx.type;
			typeSelect.disabled = Boolean(tx.amortization_meta);
		}
		if (amountInput) amountInput.value = tx.amount;
		if (accSelect) accSelect.value = tx.account_id || '';
		if (toAccSelect) {
			toAccSelect.value = tx.to_account_id || '';
			toAccSelect.disabled = Boolean(tx.amortization_meta?.is_payment_record);
		}

		const catId = tx.category_id || (activeCats[0]?.id || '');
		if (catSelect) catSelect.value = catId;
		await this.coordinator.txInputController.updateSubcategories(catId, 'edit-tx-subcategory');
		const subSelect = document.getElementById('edit-tx-subcategory');
		if (subSelect) subSelect.value = tx.subcategory_id || '';

		const actCatId = tx.actual_category_id || catId;
		if (actCatSelect) actCatSelect.value = actCatId;
		await this.coordinator.txInputController.updateSubcategories(actCatId, 'edit-tx-actual-subcategory');
		const actSubSelect = document.getElementById('edit-tx-actual-subcategory');
		if (actSubSelect) actSubSelect.value = tx.actual_subcategory_id !== undefined && tx.actual_subcategory_id !== null ? tx.actual_subcategory_id : (tx.subcategory_id || '');

		if (memoInput) memoInput.value = tx.memo || '';
		if (tagsInput) tagsInput.value = (tx.tags || []).join(', ');
		if (statusSelect) statusSelect.value = tx.status || 'confirmed';

		// Show/hide transfer
		const isTransfer = tx.type === 'transfer';
		const toGroup = document.getElementById('edit-tx-to-account-group');
		const catGroup = document.getElementById('edit-tx-cat-container');
		if (toGroup) toGroup.style.display = isTransfer ? 'block' : 'none';
		if (catGroup) catGroup.style.display = isTransfer ? 'none' : 'block';

		modal.classList.add('active');
	}

	async handleEditFormSubmit() {
		const id = document.getElementById('edit-tx-id')?.value;
		const tx = await this.db.getTransaction(id);
		if (!tx) return;

		const editDate = document.getElementById('edit-tx-date')?.value;
		const editType = document.getElementById('edit-tx-type')?.value;
		const editAmount = Number(document.getElementById('edit-tx-amount')?.value) || 0;
		const editAccount = document.getElementById('edit-tx-account')?.value;
		const editToAccount = document.getElementById('edit-tx-to-account')?.value;
		const editCat = document.getElementById('edit-tx-category')?.value;
		const editSub = document.getElementById('edit-tx-subcategory')?.value || null;
		const editActCat = document.getElementById('edit-tx-actual-category')?.value;
		const editActSub = document.getElementById('edit-tx-actual-subcategory')?.value || null;
		const editMemo = document.getElementById('edit-tx-memo')?.value || '';
		const editTags = (document.getElementById('edit-tx-tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
		const editStatus = document.getElementById('edit-tx-status')?.value || 'confirmed';

		const previousMonth = tx.previous_target_month || (tx.target_month !== editDate.slice(0, 7) ? tx.target_month : null);
		const movement = previousMonth ? { previous_target_month: previousMonth } : {};
		const groupTxs = tx.group_id && (tx.amortization_meta || tx.group_id.startsWith('grp_prepaid'))
			? await this.db.getTransactionsByGroupId(tx.group_id)
			: [];
		const paymentTx = groupTxs.find(t => t.amortization_meta?.is_payment_record);
		const amortTxs = groupTxs.filter(t => t.type === 'expense' && t.amortization_meta && !t.amortization_meta.is_payment_record);
		const cascade = paymentTx && amortTxs.length > 0 && groupTxs.length > 1 && confirm('この取引は前払分割計上の一部です。\n関連する明細の費目・メモ・タグと、変更された金額を連動更新しますか？\n（キャンセル: この明細のみ修正）');
		const amountChanged = editAmount !== tx.amount;
		const amountPending = Boolean(tx.amount_pending && !(amountChanged && editAmount > 0));
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
			if (editAmount !== tx.amount) {
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
			});
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
			await this.db.putTransaction(tx);
			changedTxs = [tx];
		}

		document.getElementById('modal-edit-tx')?.classList.remove('active');
		this.coordinator.showToast(cascade ? '✅ 関連明細を一括修正しました' : '✅ 明細を修正しました');
		const snapshot = await this.db.getSnapshot();
		const closedTxs = changedTxs.filter(t => t.previous_target_month || (snapshot?.last_closed_month && t.target_month <= snapshot.last_closed_month));
		if (closedTxs.length > 0 && this.syncManager?.gasUrl && this.syncManager?.privateKey) {
			try {
				await this.syncManager.syncPendingDiffs();
				alert('過去締め月の明細を修正し、スナップショットを再計算しました');
			} catch (err) {
				alert(`遡及更新エラー: ${err.message}`);
			}
		} else {
			this.syncManager?.syncPendingDiffs().catch(e => console.log('Sync deferred:', e.message));
		}
		await this.coordinator.refreshAllViews();
	}

	async handleEditDelete(id) {
		const tx = await this.db.getTransaction(id);
		if (!tx) return;
		const approved = await this.coordinator.approveClosedChanges([{ ...tx, is_deleted: true }], [tx]);
		if (approved === null) return;
		tx.is_deleted = true;
		tx.reclose_approved_months = approved;
		tx.updated_at = new Date().toISOString();
		tx.sync_status = 'unsynced';
		await this.db.putTransaction(tx);
		this.coordinator.showToast('🗑️ 明細を削除しました');

		const snapshot = await this.db.getSnapshot();
		const isPastClosed = snapshot?.last_closed_month && tx.target_month <= snapshot.last_closed_month;

		document.getElementById('modal-edit-tx')?.classList.remove('active');

		if (isPastClosed && this.syncManager?.gasUrl && this.syncManager?.privateKey) {
			try {
				const response = await this.syncManager.sendRetroactiveUpdate(tx);
				alert(response.conflict ? '別端末の新しい変更を反映したため、削除は行いませんでした。' : '過去締め月の明細を削除し、スナップショットを再計算しました');
			} catch (err) {
				alert(`遡及削除エラー: ${err.message}`);
			}
		} else {
			this.syncManager?.syncPendingDiffs().catch(e => console.log('Sync deferred:', e.message));
		}

		await this.coordinator.refreshAllViews();
	}
}

