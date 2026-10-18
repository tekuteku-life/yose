/**
 * Yoseatsume Kakeibo - Transaction Input Controller
 * Controls transaction entry form (5 modes), dynamic fields, master dropdowns, tax modal, and save workflow.
 */

import {
	formatDate,
	calculateTax,
	createPrepaidAmortizationTransactions,
	createAdvancePaymentTransactions,
	createAdvanceRepaymentTransaction,
	createPointPaymentTransactions,
	generateUUID,
	escapeHtml
} from '../logic.js';

export class TransactionInputController {
	constructor(coordinator) {
		this.coordinator = coordinator;
	}

	get db() {
		return this.coordinator.db;
	}

	get syncManager() {
		return this.coordinator.syncManager;
	}

	setupInputForm() {
		const inputDate = document.getElementById('input-date');
		if (inputDate) {
			inputDate.value = formatDate(new Date());
		}

		// Mode buttons
		const modeBtns = document.querySelectorAll('.mode-tab-btn');
		modeBtns.forEach(btn => {
			btn.addEventListener('click', () => {
				this.switchInputMode(btn.dataset.mode);
			});
		});

		// Type change
		const typeSelect = document.getElementById('input-type');
		if (typeSelect) {
			typeSelect.addEventListener('change', async () => {
				const val = typeSelect.value;
				this.coordinator.currentTaxMeta = null;
				if (['advance', 'repay', 'prepaid', 'point'].includes(val)) {
					this.switchInputMode(val);
				} else {
					this.switchInputMode('normal');
					this.updateFormFieldsForType(val);
				}
				await this.populateCategoryDropdowns(val);
			});
		}

		// Clear taxMeta on manual amount input
		const clearTaxMeta = () => { this.coordinator.currentTaxMeta = null; };
		document.getElementById('input-amount')?.addEventListener('input', clearTaxMeta);
		document.getElementById('input-self-amount')?.addEventListener('input', clearTaxMeta);
		document.getElementById('input-adv-amount')?.addEventListener('input', clearTaxMeta);
		document.getElementById('input-point-total')?.addEventListener('input', clearTaxMeta);

		// Point dynamic calculation
		const inputPointTotal = document.getElementById('input-point-total');
		const inputPointUsed = document.getElementById('input-point-used');
		const updatePointDisplay = () => {
			const total = Number(inputPointTotal?.value) || 0;
			const used = Number(inputPointUsed?.value) || 0;
			const self = Math.max(0, total - used);
			const disp = document.getElementById('display-point-self-amount');
			if (disp) disp.textContent = `¥${self.toLocaleString()}`;
		};
		inputPointTotal?.addEventListener('input', updatePointDisplay);
		inputPointUsed?.addEventListener('input', updatePointDisplay);

		// Mirror category checkbox
		const chkSync = document.getElementById('chk-sync-actual-category');
		const actContainer = document.getElementById('actual-category-container');
		if (chkSync && actContainer) {
			chkSync.addEventListener('change', () => {
				actContainer.style.display = chkSync.checked ? 'none' : 'block';
			});
		}

		// Category change updates subcategories
		const catSelect = document.getElementById('select-category');
		if (catSelect) {
			catSelect.addEventListener('change', () => {
				this.updateSubcategories(catSelect.value, 'select-subcategory');
			});
		}

		const actCatSelect = document.getElementById('select-actual-category');
		if (actCatSelect) {
			actCatSelect.addEventListener('change', () => {
				this.updateSubcategories(actCatSelect.value, 'select-actual-subcategory');
			});
		}

		// Form submit
		const form = document.getElementById('tx-form');
		if (form) {
			form.addEventListener('submit', async (e) => {
				e.preventDefault();
				await this.handleFormSubmit();
			});
		}
	}

	updatePointSelfAmount() {
		const total = Number(document.getElementById('input-point-total')?.value) || 0;
		const used = Number(document.getElementById('input-point-used')?.value) || 0;
		const self = Math.max(0, total - used);
		const disp = document.getElementById('display-point-self-amount');
		if (disp) disp.textContent = `¥${self.toLocaleString()}`;
	}

	switchInputMode(mode) {
		this.coordinator.currentMode = mode;
		this.coordinator.currentTaxMeta = null;

		// Harmonize mode tab buttons
		document.querySelectorAll('.mode-tab-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.mode === mode);
		});

		// Harmonize input-type selector
		const typeSelect = document.getElementById('input-type');
		if (typeSelect) {
			if (mode === 'normal') {
				if (['advance', 'repay', 'prepaid', 'point'].includes(typeSelect.value)) {
					typeSelect.value = 'expense';
				}
			} else {
				typeSelect.value = mode;
			}
		}

		const groupNormalAmount = document.getElementById('group-normal-amount');
		const advanceFields = document.getElementById('advance-fields');
		const prepaidFields = document.getElementById('prepaid-fields');
		const repayFields = document.getElementById('repay-fields');
		const pointFields = document.getElementById('point-fields');
		const groupToAccount = document.getElementById('group-to-account');
		const catContainer = document.getElementById('category-selection-container');
		const labelAccount = document.getElementById('label-account');

		// Reset visibility
		if (groupNormalAmount) groupNormalAmount.style.display = (mode === 'normal') ? 'block' : 'none';
		if (advanceFields) advanceFields.style.display = (mode === 'advance') ? 'block' : 'none';
		if (prepaidFields) prepaidFields.style.display = (mode === 'prepaid') ? 'block' : 'none';
		if (repayFields) repayFields.style.display = (mode === 'repay') ? 'block' : 'none';
		if (pointFields) pointFields.style.display = (mode === 'point') ? 'block' : 'none';

		if (mode === 'repay') {
			if (catContainer) catContainer.style.display = 'none';
			if (groupToAccount) groupToAccount.style.display = 'none';
			if (labelAccount) labelAccount.textContent = '受取先口座（入金口座）';
		} else if (mode === 'advance') {
			if (catContainer) catContainer.style.display = 'block';
			if (groupToAccount) groupToAccount.style.display = 'none';
			if (labelAccount) labelAccount.textContent = '立替支払元口座';
		} else if (mode === 'prepaid') {
			if (catContainer) catContainer.style.display = 'block';
			if (groupToAccount) groupToAccount.style.display = 'none';
			if (labelAccount) labelAccount.textContent = '決済口座（カード・銀行等）';
		} else if (mode === 'point') {
			if (catContainer) catContainer.style.display = 'block';
			if (groupToAccount) groupToAccount.style.display = 'none';
			if (labelAccount) labelAccount.textContent = '実質決済口座 (自己負担支払元)';
			this.updatePointSelfAmount();
		} else {
			if (catContainer) catContainer.style.display = 'block';
			if (labelAccount) labelAccount.textContent = '決済口座';
			const type = document.getElementById('input-type')?.value;
			this.updateFormFieldsForType(type);
		}
	}

	updateFormFieldsForType(type) {
		if (this.coordinator.currentMode !== 'normal') return;
		const groupToAccount = document.getElementById('group-to-account');
		const catContainer = document.getElementById('category-selection-container');
		const labelAccount = document.getElementById('label-account');
		if (type === 'transfer') {
			if (groupToAccount) groupToAccount.style.display = 'block';
			if (catContainer) catContainer.style.display = 'none';
			if (labelAccount) labelAccount.textContent = '振替元口座';
		} else {
			if (groupToAccount) groupToAccount.style.display = 'none';
			if (catContainer) catContainer.style.display = 'block';
			if (labelAccount) labelAccount.textContent = '決済口座';
		}
	}

	async populateMasterDropdowns() {
		const config = await this.db.getMasterConfig();
		if (!config) return;

		// Accounts
		const accSelect = document.getElementById('select-account');
		const toAccSelect = document.getElementById('select-to-account');
		const pointAccSelect = document.getElementById('select-point-account');
		const activeAccounts = (config.accounts || []).filter(a => !a.is_archived);

		const buildAccountOptions = () => activeAccounts.map(a =>
			`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`
		).join('');

		if (accSelect) accSelect.innerHTML = buildAccountOptions();
		if (toAccSelect) toAccSelect.innerHTML = buildAccountOptions();

		if (pointAccSelect) {
			pointAccSelect.innerHTML = [
				'<option value="">ポイント相殺として計上（口座指定なし）</option>',
				...activeAccounts.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`)
			].join('');
		}

		// Categories filtered by current input-type
		const currentType = document.getElementById('input-type')?.value || 'expense';
		await this.populateCategoryDropdowns(currentType);
	}

	async populateCategoryDropdowns(type = 'expense') {
		const config = await this.db.getMasterConfig();
		if (!config) return;

		const catSelect = document.getElementById('select-category');
		const actCatSelect = document.getElementById('select-actual-category');
		const activeCategories = (config.categories || []).filter(c => {
			if (c.is_archived) return false;
			if (type === 'income') return c.type === 'income';
			return !c.type || c.type === 'expense';
		});

		const buildCategoryOptions = () => activeCategories.map(c =>
			`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`
		).join('');

		if (catSelect) catSelect.innerHTML = buildCategoryOptions();
		if (actCatSelect) actCatSelect.innerHTML = buildCategoryOptions();

		if (activeCategories.length > 0) {
			await this.updateSubcategories(activeCategories[0].id, 'select-subcategory');
			await this.updateSubcategories(activeCategories[0].id, 'select-actual-subcategory');
		} else {
			const subSelect = document.getElementById('select-subcategory');
			const actSubSelect = document.getElementById('select-actual-subcategory');
			if (subSelect) subSelect.innerHTML = '<option value="">なし</option>';
			if (actSubSelect) actSubSelect.innerHTML = '<option value="">なし</option>';
		}
	}

	async updateSubcategories(categoryId, targetSelectId) {
		const select = document.getElementById(targetSelectId);
		if (!select) return;
		const config = await this.db.getMasterConfig();
		const cat = (config?.categories || []).find(c => c.id === categoryId);
		if (!cat || !cat.subcategories) {
			select.innerHTML = '<option value="">なし</option>';
			return;
		}
		const activeSubs = cat.subcategories.filter(s => !s.is_archived);
		select.innerHTML = activeSubs.map(s =>
			`<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`
		).join('');
	}

	setupTaxModal() {
		const modal = document.getElementById('modal-tax');
		const btnOpen = document.getElementById('btn-open-tax-calc');
		const btnClose = document.getElementById('btn-close-tax-modal');
		const btnApply = document.getElementById('btn-apply-tax');

		const baseInput = document.getElementById('tax-base-amount');
		const rateSelect = document.getElementById('tax-rate-select');
		const roundSelect = document.getElementById('tax-rounding-select');
		const displayTax = document.getElementById('tax-calc-tax');
		const displayTotal = document.getElementById('tax-calc-total');

		if (!modal) return;

		const recalculateTaxModal = () => {
			const base = Number(baseInput?.value) || 0;
			const rate = Number(rateSelect?.value) || 0.10;
			const rounding = roundSelect?.value || 'floor';
			const result = calculateTax(base, rate, rounding);

			const taxAmount = result.amount - base;
			if (displayTax) displayTax.textContent = `¥${taxAmount.toLocaleString()}`;
			if (displayTotal) displayTotal.textContent = `¥${result.amount.toLocaleString()}`;
			return result;
		};

		btnOpen?.addEventListener('click', () => {
			const currentAmt = document.getElementById('input-amount')?.value;
			if (baseInput) baseInput.value = currentAmt || '';
			recalculateTaxModal();
			modal.classList.add('active');
		});

		btnClose?.addEventListener('click', () => {
			modal.classList.remove('active');
		});

		baseInput?.addEventListener('input', recalculateTaxModal);
		rateSelect?.addEventListener('change', recalculateTaxModal);
		roundSelect?.addEventListener('change', recalculateTaxModal);

		btnApply?.addEventListener('click', () => {
			const result = recalculateTaxModal();
			const amountInput = document.getElementById('input-amount');
			if (amountInput) amountInput.value = result.amount;
			this.coordinator.currentTaxMeta = result.tax_meta;
			modal.classList.remove('active');
		});
	}

	async handleFormSubmit() {
		const date = document.getElementById('input-date')?.value;
		const memo = document.getElementById('input-memo')?.value || '';
		const tagsRaw = document.getElementById('input-tags')?.value || '';
		const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

		const accountId = document.getElementById('select-account')?.value;
		const toAccountId = document.getElementById('select-to-account')?.value;
		const categoryId = document.getElementById('select-category')?.value;
		const subcategoryId = document.getElementById('select-subcategory')?.value;

		const chkSync = document.getElementById('chk-sync-actual-category')?.checked;
		const actualCategoryId = chkSync ? categoryId : document.getElementById('select-actual-category')?.value;
		const actualSubcategoryId = chkSync ? subcategoryId : document.getElementById('select-actual-subcategory')?.value;

		let txRecordsToSave = [];

		if (this.coordinator.currentMode === 'normal') {
			const type = document.getElementById('input-type')?.value;
			const amount = Number(document.getElementById('input-amount')?.value) || 0;

			if (amount <= 0) {
				alert('金額を入力してください');
				return;
			}

			const tx = {
				id: generateUUID('tx'),
				group_id: generateUUID('grp'),
				date: date,
				target_month: date.slice(0, 7),
				status: 'confirmed',
				type: type,
				amount: amount,
				tax_meta: this.coordinator.currentTaxMeta,
				account_id: accountId,
				to_account_id: type === 'transfer' ? toAccountId : null,
				category_id: type === 'transfer' ? null : categoryId,
				subcategory_id: type === 'transfer' ? null : subcategoryId,
				actual_category_id: type === 'transfer' ? null : actualCategoryId,
				actual_subcategory_id: type === 'transfer' ? null : actualSubcategoryId,
				recurring_rule_id: null,
				amortization_meta: null,
				memo: memo,
				tags: tags,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				is_deleted: false,
				sync_status: 'unsynced'
			};
			txRecordsToSave.push(tx);
		} else if (this.coordinator.currentMode === 'advance') {
			const selfAmount = Number(document.getElementById('input-self-amount')?.value) || 0;
			const advAmount = Number(document.getElementById('input-adv-amount')?.value) || 0;

			if (selfAmount <= 0 && advAmount <= 0) {
				alert('自己負担額または立替額を入力してください');
				return;
			}

			const advanceTxs = createAdvancePaymentTransactions({
				date,
				payingAccountId: accountId,
				selfAmount,
				advanceAmount: advAmount,
				categoryId,
				subcategoryId,
				actualCategoryId,
				actualSubcategoryId,
				taxMeta: this.coordinator.currentTaxMeta,
				memo,
				tags
			});
			txRecordsToSave.push(...advanceTxs);
		} else if (this.coordinator.currentMode === 'repay') {
			const repayAmount = Number(document.getElementById('input-repay-amount')?.value) || 0;
			if (repayAmount <= 0) {
				alert('回収額を入力してください');
				return;
			}

			const repayTx = createAdvanceRepaymentTransaction({
				date,
				receivingAccountId: accountId,
				amount: repayAmount,
				memo,
				tags
			});
			txRecordsToSave.push(repayTx);
		} else if (this.coordinator.currentMode === 'prepaid') {
			const totalAmount = Number(document.getElementById('input-prepaid-total')?.value) || 0;
			const amortizeMonths = Number(document.getElementById('input-prepaid-months')?.value) || 12;

			if (totalAmount <= 0) {
				alert('一括支払総額を入力してください');
				return;
			}

			const prepaidTxs = createPrepaidAmortizationTransactions({
				paymentDate: date,
				totalAmount,
				payingAccountId: accountId,
				categoryId,
				subcategoryId,
				actualCategoryId,
				actualSubcategoryId,
				amortizeMonths,
				memo,
				tags
			});
			txRecordsToSave.push(...prepaidTxs);
		} else if (this.coordinator.currentMode === 'point') {
			const totalAmount = Number(document.getElementById('input-point-total')?.value) || 0;
			const pointUsed = Number(document.getElementById('input-point-used')?.value) || 0;
			const pointAccountId = document.getElementById('select-point-account')?.value || null;

			if (totalAmount <= 0) {
				alert('購入総額を入力してください');
				return;
			}

			const pointTxs = createPointPaymentTransactions({
				date,
				totalAmount,
				pointUsed,
				payingAccountId: accountId,
				pointAccountId,
				categoryId,
				subcategoryId,
				actualCategoryId,
				actualSubcategoryId,
				taxMeta: this.coordinator.currentTaxMeta,
				memo,
				tags
			});
			txRecordsToSave.push(...pointTxs);
		}

		// Save to Database
		await this.db.putTransactions(txRecordsToSave);

		// Reset inputs
		const elAmt = document.getElementById('input-amount');
		if (elAmt) elAmt.value = '';
		const elSelf = document.getElementById('input-self-amount');
		if (elSelf) elSelf.value = '';
		const elAdv = document.getElementById('input-adv-amount');
		if (elAdv) elAdv.value = '';
		const elRepay = document.getElementById('input-repay-amount');
		if (elRepay) elRepay.value = '';
		const elPreTotal = document.getElementById('input-prepaid-total');
		if (elPreTotal) elPreTotal.value = '';
		const elPtTotal = document.getElementById('input-point-total');
		if (elPtTotal) elPtTotal.value = '';
		const elPtUsed = document.getElementById('input-point-used');
		if (elPtUsed) elPtUsed.value = '';
		const dispPoint = document.getElementById('display-point-self-amount');
		if (dispPoint) dispPoint.textContent = '¥0';
		const elMemo = document.getElementById('input-memo');
		if (elMemo) elMemo.value = '';
		const elTags = document.getElementById('input-tags');
		if (elTags) elTags.value = '';
		this.coordinator.currentTaxMeta = null;

		// Refresh views & try auto sync in background
		await this.coordinator.refreshAllViews();
		this.syncManager.syncPendingDiffs().catch(err => console.log('Auto sync deferred:', err.message));
	}
}

