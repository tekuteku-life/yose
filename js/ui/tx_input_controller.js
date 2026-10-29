/**
 * Yoseatsume Kakeibo - Transaction Input Controller
 * Controls transaction entry form (5 modes), dynamic fields, master dropdowns, tax modal, and save workflow.
 */

import {
	formatDate,
	evaluateCalculatorExpression,
	createPrepaidAmortizationTransactions,
	createAdvancePaymentTransactions,
	createAdvanceRepaymentTransaction,
	createPointPaymentTransactions,
	generateUUID,
	escapeHtml
} from '../logic.js';

import { TagMemoInput } from './tag_memo_input.js';
import { linkedRepayment } from '../logic/advance_links.js';
import { captureRenderSession, readInRenderSession } from './render_session.js';
import { beginFormBusy, captureFormValues } from './form_busy.js';

export class TransactionInputController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.confirmedTags = [];
		this.availableTags = [];
		this.memoHistoryMap = {};
		this.calcTargetInputId = 'input-amount';
		this.calcCurrentExpr = '0';
		this.calcEvaluatedResult = 0;
		this.calcTaxMeta = null;
		this.submitBusy = false;
		this.submitOperation = 0;
		this.modeGeneration = 0;
		this.releaseSubmitBusy = null;
		this.pointPaymentConfig = null;
		this.settleBusy = false;
		this.settleOperation = null;
	}

	get db() {
		return this.coordinator.db;
	}

	get syncManager() {
		return this.coordinator.syncManager;
	}

	setupInputForm() {
		document.getElementById('select-point-account').addEventListener('change', () => this.renderPointOffsetNotice());
		const inputDate = document.getElementById('input-date');
		inputDate.value = formatDate(new Date());

		// Mode buttons
		const modeBtns = document.querySelectorAll('.mode-tab-btn');
		modeBtns.forEach(btn => {
			btn.addEventListener('click', async () => {
				await this.switchInputMode(btn.dataset.mode);
			});
		});

		// Type change
		const typeSelect = document.getElementById('input-type');
		typeSelect.addEventListener('change', async () => {
			if (this.submitBusy) return;
			const val = typeSelect.value;
			const operation = this.submitOperation;
			const valid = captureRenderSession(this.coordinator, () => !this.submitBusy && operation === this.submitOperation && typeSelect.value === val);
			this.coordinator.currentTaxMeta = null;
			if (['advance', 'repay', 'prepaid', 'point'].includes(val)) {
				await this.switchInputMode(val, { isSessionValid: valid });
			} else {
				const applied = await this.switchInputMode('normal', { isSessionValid: valid });
				if (applied && valid()) this.updateFormFieldsForType(val);
			}
		});

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
			disp.textContent = `¥${self.toLocaleString()}`;
		};
		inputPointTotal?.addEventListener('input', updatePointDisplay);
		inputPointUsed?.addEventListener('input', updatePointDisplay);

		// Mirror category checkbox
		const chkSync = document.getElementById('chk-sync-actual-category');
		const actContainer = document.getElementById('actual-category-container');
		chkSync.addEventListener('change', () => {
			actContainer.style.display = chkSync.checked ? 'none' : 'block';
		});

		// Category change updates subcategories
		const catSelect = document.getElementById('select-category');
		catSelect.addEventListener('change', () => {
			this.updateSubcategories(catSelect.value, 'select-subcategory');
		});

		const actCatSelect = document.getElementById('select-actual-category');
		actCatSelect.addEventListener('change', () => {
			this.updateSubcategories(actCatSelect.value, 'select-actual-subcategory');
		});

		// Memo autocomplete & auto-categorization (Requirement 3.19 & 3.40.1)
		const handleMemoChange = async (val, valid) => {
			if (!valid()) return;
			const match = this.memoHistoryMap[val];
			if (match && match.category_id) {
				const config = await this.db.getMasterConfig();
				if (!valid()) return;
				const type = document.getElementById('input-type')?.value === 'income' ? 'income' : 'expense';
				const category = config.categories?.find(candidate => candidate.id === match.category_id && !candidate.is_archived && (candidate.type || 'expense') === type);
				if (!category || (match.subcategory_id && !category.subcategories?.some(child => child.id === match.subcategory_id && !child.is_archived))) return;
				const catSelect = document.getElementById('select-category');
				catSelect.value = match.category_id;
				await this.updateSubcategories(match.category_id, 'select-subcategory', null, false, { isSessionValid: valid });
				if (!valid() || catSelect.value !== match.category_id) return;
				const subSelect = document.getElementById('select-subcategory');
				subSelect.value = match.subcategory_id || '';
				const chkSync = document.getElementById('chk-sync-actual-category');
				if (chkSync.checked) {
					const actCatSelect = document.getElementById('select-actual-category');
					actCatSelect.value = match.category_id;
					await this.updateSubcategories(match.category_id, 'select-actual-subcategory', null, false, { isSessionValid: valid });
					if (!valid() || actCatSelect.value !== match.category_id) return;
					const actSubSelect = document.getElementById('select-actual-subcategory');
					actSubSelect.value = match.subcategory_id || '';
				}
			}
		};
		const safelyHandleMemoChange = async event => {
			const sessionValid = captureRenderSession(this.coordinator);
			const operation = this.submitOperation;
			const val = (event?.target?.value ?? (typeof event === 'string' ? event : '')).trim();
			const valid = () => sessionValid() && !this.submitBusy && operation === this.submitOperation && document.getElementById('input-memo')?.value.trim() === val;
			try { await handleMemoChange(val, valid); }
			catch (error) { if (valid()) alert(`分類候補を反映できませんでした: ${error.message}`); }
		};
		this.handleMemoChange = safelyHandleMemoChange;

		this.tagMemoInput = new TagMemoInput({
			host: this, source: this,
			ids: { text: 'input-tag-text', chips: 'tags-chips-list', hidden: 'input-tags', tags: 'tags-suggest-dropdown', box: 'tags-chip-container', memo: 'input-memo', memos: 'memo-suggest-dropdown' },
			onMemoChange: safelyHandleMemoChange
		});
		this.tagMemoInput.setup();

		// Unsettled Advance List settlement click (Requirement 3.20)
		document.getElementById('unsettled-advance-list')?.addEventListener('click', async (e) => {
			const btn = e.target.closest('.btn-settle-advance');
			if (btn && btn.dataset.txId) {
				await this.handleSettleAdvanceDirectly(btn.dataset.txId);
			}
		});

		// Form submit
		const form = document.getElementById('tx-form');
		form.addEventListener('submit', async (e) => {
			e.preventDefault();
			await this.handleFormSubmit();
		});
	}

	updatePointSelfAmount() {
		const total = Number(document.getElementById('input-point-total')?.value) || 0;
		const used = Number(document.getElementById('input-point-used')?.value) || 0;
		const self = Math.max(0, total - used);
		const disp = document.getElementById('display-point-self-amount');
		disp.textContent = `¥${self.toLocaleString()}`;
	}

	async switchInputMode(mode, { isSessionValid = null } = {}) {
		const sessionValid = captureRenderSession(this.coordinator, isSessionValid);
		if (this.submitBusy || !sessionValid()) return false;
		const generation = ++this.modeGeneration, operation = this.submitOperation;
		const valid = () => sessionValid() && !this.submitBusy && generation === this.modeGeneration && operation === this.submitOperation;
		if (this.coordinator.currentMode === 'normal' && mode === 'prepaid') {
			const total = document.getElementById('input-prepaid-total');
			const amount = document.getElementById('input-amount');
			if (total.value === '') total.value = amount.value;
		}
		this.coordinator.currentMode = mode;
		this.coordinator.currentTaxMeta = null;

		// Harmonize mode tab buttons
		document.querySelectorAll('.mode-tab-btn').forEach(btn => {
			btn.classList.toggle('active', btn.dataset.mode === mode);
		});

		// Harmonize input-type selector
		const typeSelect = document.getElementById('input-type');
		if (mode === 'normal') {
			if (['advance', 'repay', 'prepaid', 'point'].includes(typeSelect.value)) {
				typeSelect.value = 'expense';
			}
		} else {
			typeSelect.value = mode;
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
		groupNormalAmount.style.display = (mode === 'normal') ? 'block' : 'none';
		advanceFields.style.display = (mode === 'advance') ? 'block' : 'none';
		prepaidFields.style.display = (mode === 'prepaid') ? 'block' : 'none';
		repayFields.style.display = (mode === 'repay') ? 'block' : 'none';
		pointFields.style.display = (mode === 'point') ? 'block' : 'none';

		if (mode === 'repay') {
			catContainer.style.display = 'none';
			groupToAccount.style.display = 'none';
			labelAccount.textContent = '受取先口座（入金口座）';
			this.renderUnsettledAdvanceList();
		} else if (mode === 'advance') {
			catContainer.style.display = 'block';
			groupToAccount.style.display = 'none';
			labelAccount.textContent = '立替支払元口座';
		} else if (mode === 'prepaid') {
			catContainer.style.display = 'block';
			groupToAccount.style.display = 'none';
			labelAccount.textContent = '決済口座（カード・銀行等）';
		} else if (mode === 'point') {
			catContainer.style.display = 'block';
			groupToAccount.style.display = 'none';
			labelAccount.textContent = '実質決済口座 (自己負担支払元)';
			this.updatePointSelfAmount();
			this.renderPointOffsetNotice();
		} else {
			catContainer.style.display = 'block';
			labelAccount.textContent = '決済口座';
			const type = document.getElementById('input-type')?.value;
			this.updateFormFieldsForType(type);
		}
		await this.populateCategoryDropdowns(typeSelect.value, { isSessionValid: valid, keepUnavailable: false });
		return valid();
	}

	updateFormFieldsForType(type) {
		if (this.coordinator.currentMode !== 'normal') return;
		const groupToAccount = document.getElementById('group-to-account');
		const catContainer = document.getElementById('category-selection-container');
		const labelAccount = document.getElementById('label-account');
		if (type === 'transfer') {
			groupToAccount.style.display = 'block';
			catContainer.style.display = 'none';
			labelAccount.textContent = '振替元口座';
		} else {
			groupToAccount.style.display = 'none';
			catContainer.style.display = 'block';
			labelAccount.textContent = '決済口座';
		}
	}

	replaceOptionsKeepingSelection(select, html, keepUnavailable = true) {
		if (!select) return;
		const previous = select.value, previousOption = select.selectedOptions[0];
		select.innerHTML = html;
		if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
		else if (keepUnavailable && previous && previousOption) {
			const unavailable = /** @type {HTMLOptionElement} */ (previousOption.cloneNode(true));
			if (!unavailable.hasAttribute('data-unavailable')) {
				unavailable.textContent += '（利用不可）'; unavailable.dataset.unavailable = 'true';
			}
			unavailable.disabled = true;
			select.append(unavailable); select.value = previous;
		}
	}

	async populateMasterDropdowns({ isSessionValid = null } = {}) {
		const operation = this.submitOperation, modeGeneration = this.modeGeneration;
		const valid = captureRenderSession(this.coordinator, () => !this.submitBusy && operation === this.submitOperation && modeGeneration === this.modeGeneration && (!isSessionValid || isSessionValid())), options = { isSessionValid: valid };
		if (!valid()) return;
		const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
		if (!valid() || !config) return;
		this.pointPaymentConfig = config;
		this.renderPointOffsetNotice();

		// Accounts
		const accSelect = document.getElementById('select-account');
		const toAccSelect = document.getElementById('select-to-account');
		const pointAccSelect = document.getElementById('select-point-account');
		const activeAccounts = (config.accounts || []).filter(a => !a.is_archived);

		const buildAccountOptions = () => activeAccounts.map(a =>
			`<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`
		).join('');

		this.replaceOptionsKeepingSelection(accSelect, buildAccountOptions());
		this.replaceOptionsKeepingSelection(toAccSelect, buildAccountOptions());

		this.replaceOptionsKeepingSelection(pointAccSelect, [
			'<option value="">ポイント相殺として計上（口座指定なし）</option>',
			...activeAccounts.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`)
		].join(''));

		// Categories filtered by current input-type
		const currentType = document.getElementById('input-type').value;
		await this.populateCategoryDropdowns(currentType, options);
		if (!valid()) return;

		// Tag & Memo suggestions & unsettled advances (Requirements 3.18, 3.19, 3.20)
		await this.updateTagAndMemoSuggestions(options);
		if (!valid()) return;
		await this.renderUnsettledAdvanceList(options);
		if (!valid()) return;
		this.renderTagChips();
	}

	async populateCategoryDropdowns(type = 'expense', { isSessionValid = null, keepUnavailable = true } = {}) {
		const operation = this.submitOperation, modeGeneration = this.modeGeneration;
		const valid = captureRenderSession(this.coordinator, () => !this.submitBusy && operation === this.submitOperation && modeGeneration === this.modeGeneration && (!isSessionValid || isSessionValid())), options = { isSessionValid: valid, keepUnavailable };
		if (!valid()) return;
		const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
		if (!valid() || !config) return;
		this.pointPaymentConfig = config;
		this.renderPointOffsetNotice();

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

		const previousCategory = catSelect?.value;
		const previousActual = actCatSelect?.value;
		this.replaceOptionsKeepingSelection(catSelect, buildCategoryOptions(), keepUnavailable);
		this.replaceOptionsKeepingSelection(actCatSelect, buildCategoryOptions(), keepUnavailable);

		await this.updateSubcategories(catSelect.value, 'select-subcategory', null, catSelect?.value === previousCategory, options);
		if (!valid()) return;
		await this.updateSubcategories(actCatSelect.value, 'select-actual-subcategory', null, actCatSelect?.value === previousActual, options);
	}

	async updateSubcategories(categoryId, targetSelectId, preserveId = null, keepSelection = false, { isSessionValid = null, keepUnavailable = true } = {}) {
		const editing = targetSelectId.startsWith('edit-'), owner = editing ? this.coordinator.txEditController : this;
		const operation = editing ? owner.operation : this.submitOperation, generation = editing ? owner.generation : null;
		const valid = captureRenderSession(this.coordinator, () => !(editing ? owner.busy : this.submitBusy) && operation === (editing ? owner.operation : this.submitOperation) && (!editing || generation === owner.generation) && (!isSessionValid || isSessionValid()));
		if (!valid()) return;
		const select = /** @type {HTMLSelectElement} */ (document.getElementById(targetSelectId));
		if (!select) return;
		const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
		if (!valid() || !config) return;
		const parentIds = { 'select-subcategory': 'select-category', 'select-actual-subcategory': 'select-actual-category', 'edit-tx-subcategory': 'edit-tx-category', 'edit-tx-actual-subcategory': 'edit-tx-actual-category' };
		const parent = document.getElementById(parentIds[targetSelectId]);
		if (parent && parent.value !== categoryId) return;
		const cat = (config?.categories || []).find(c => c.id === categoryId);
		const emptyOption = '<option value="">（指定なし / 費目のみ）</option>';
		const activeSubs = (cat?.subcategories || []).filter(s => !s.is_archived || s.id === preserveId);
		if (preserveId && !activeSubs.some(s => s.id === preserveId)) activeSubs.push({ id: preserveId, name: `不明な項目 (${preserveId})`, is_archived: true });
		const html = [
			emptyOption,
			...activeSubs.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}${s.is_archived ? '（アーカイブ済み）' : ''}</option>`)
		].join('');
		if (keepSelection && select.options.length) this.replaceOptionsKeepingSelection(select, html, keepUnavailable);
		else {
			select.innerHTML = html;
			if (activeSubs.length > 0) select.value = activeSubs[0].id;
		}
	}

	renderTagChips() { this.tagMemoInput.renderTagChips(); }

	async updateTagAndMemoSuggestions({ isSessionValid = null } = {}) {
		const operation = this.submitOperation;
		const valid = captureRenderSession(this.coordinator, () => !this.submitBusy && operation === this.submitOperation && (!isSessionValid || isSessionValid()));
		if (!valid()) return;
		const values = await readInRenderSession(valid, () => Promise.all([this.db.getUniqueTags(), this.db.getMemoHistory()]));
		if (!valid() || !values) return;
		const [tags, memos] = values;
		this.availableTags = tags; this.memoHistoryMap = memos;
	}

	async renderUnsettledAdvanceList({ isSessionValid = null } = {}) {
		const operation = this.submitOperation;
		const valid = captureRenderSession(this.coordinator, () => !this.submitBusy && operation === this.submitOperation && (!isSessionValid || isSessionValid()));
		if (!valid()) return;
		const list = document.getElementById('unsettled-advance-list');
		const countBadge = document.getElementById('unsettled-advance-count');

		const unsettled = await readInRenderSession(valid, () => this.db.getUnsettledAdvancePayments());
		if (!valid() || !unsettled) return;
		countBadge.textContent = `${unsettled.length}件`;

		if (unsettled.length === 0) {
			list.innerHTML = '<div style="color: var(--text-muted); font-size: 0.85rem; padding: 10px; text-align: center;">未回収の立替金はありません</div>';
			return;
		}

		list.innerHTML = unsettled.map(tx => `
			<div class="unsettled-advance-item">
				<div class="unsettled-info">
					<span class="unsettled-date">${escapeHtml(tx.date)}</span>
					<span class="unsettled-memo">${escapeHtml(tx.memo || '立替金')}</span>
					<span class="unsettled-amount">¥${tx.amount.toLocaleString()}</span>
				</div>
				<button type="button" class="btn btn-primary btn-sm btn-settle-advance" data-tx-id="${escapeHtml(tx.id)}" data-tx-amount="${tx.amount}" data-tx-memo="${escapeHtml(tx.memo || '')}">
					回収・精算
				</button>
			</div>
		`).join('');
	}

	async handleSettleAdvanceDirectly(advanceId) {
		if (this.settleBusy || this.coordinator.isKeyLocked) return;
		const operation = {};
		this.settleOperation = operation;
		const valid = captureRenderSession(this.coordinator, () => this.settleOperation === operation);
		this.settleBusy = true;
		try { await this.settleAdvance(advanceId, { isSessionValid: valid }); }
		catch (error) { if (valid()) alert(`精算の保存に失敗しました: ${error.message}`); }
		finally { if (this.settleOperation === operation) { this.settleOperation = null; this.settleBusy = false; } }
	}

	async settleAdvance(advanceId, { isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid()) return;
		const selectedAccountId = document.getElementById('select-account').value;
		const advTx = await readInRenderSession(valid, () => this.db.getTransaction(advanceId));
		if (!valid()) return;
		if (!advTx || advTx.is_deleted || advTx.settlement_status === 'settled' || !((advTx.type === 'transfer' && advTx.to_account_id === 'acc_receivable') || advTx.type === 'advance_payment')) { alert('対象の立替明細は精算済み、削除済み、または変更されています。'); return; }
		const transactions = await readInRenderSession(valid, () => this.db.getTransactions());
		if (!valid()) return;
		if (linkedRepayment(advanceId, transactions)) { alert('対象の立替明細は精算済みです。'); return; }
		if (advTx.amount_pending) { alert('金額未入力の立替は精算できません。先に金額を入力してください。'); return; }

		const config = await readInRenderSession(valid, () => this.db.getMasterConfig());
		if (!valid()) return;
		const receivingAccountId = selectedAccountId || (config?.accounts?.[0]?.id || 'acc_default');
		const today = formatDate(new Date());
		const repayTx = createAdvanceRepaymentTransaction({
			date: today,
			receivingAccountId,
			amount: advTx.amount,
			memo: '立替回収'
		});

		const approvedMonths = await this.coordinator.approveClosedChanges([repayTx], [advTx], { isSessionValid: valid });
		if (approvedMonths === null || !valid()) return;
		await this.db.linkAdvanceRepayment(advTx, repayTx, { create: true, approvedMonths, isSessionValid: valid });
		if (!valid()) return;
		this.coordinator.showToast(`✅ 立替金(¥${advTx.amount.toLocaleString()})の回収を登録しました`);
		alert(`立替金「${advTx.memo || '未回収'}」(¥${advTx.amount.toLocaleString()}) の回収・精算を完了しました`);
		try { await this.coordinator.refreshAfterTransactionChange({ isSessionValid: valid }); }
		catch (error) { if (valid()) alert(`回収は保存済みです。表示の更新に失敗しました。一覧を開き直してください: ${error.message}`); }
	}

	openCalculatorFor(targetInputId = 'input-amount') {
		this.calcTargetInputId = targetInputId;
		const targetInput = document.getElementById(targetInputId);
		const currentVal = targetInput?.value ? String(targetInput.value).trim() : '0';
		this.calcCurrentExpr = currentVal || '0';
		this.calcTaxMeta = null;
		this.updateCalculatorDisplay();

		const modal = document.getElementById('modal-tax');
		modal.classList.add('active');
	}

	updateCalculatorDisplay() {
		const exprEl = document.getElementById('calc-expr-display');
		const resEl = document.getElementById('calc-result-display');
		const taxSummary = document.getElementById('calc-tax-summary');
		const baseEl = document.getElementById('calc-tax-base');
		const amtEl = document.getElementById('calc-tax-amount');

		exprEl.textContent = this.calcCurrentExpr;

		const evalRes = evaluateCalculatorExpression(this.calcCurrentExpr);
		this.calcEvaluatedResult = evalRes.result;

		resEl.textContent = `¥${evalRes.result.toLocaleString()}`;

		if (this.calcTaxMeta) {
			taxSummary.style.display = 'block';
			const base = Number(this.calcTaxMeta.base_amount) || 0;
			const taxAmt = Number(this.calcTaxMeta.tax_amount);
			baseEl.textContent = `¥${base.toLocaleString()}`;
			amtEl.textContent = `¥${taxAmt.toLocaleString()} (${Math.round((this.calcTaxMeta.tax_rate || 0) * 100)}%)`;
		} else {
			taxSummary.style.display = 'none';
		}
	}

	setupTaxModal() {
		const modal = document.getElementById('modal-tax');
		const btnOpen = document.getElementById('btn-open-tax-calc');
		const btnClose = document.getElementById('btn-close-tax-modal');
		const btnApply = document.getElementById('btn-apply-tax');

		btnOpen?.addEventListener('click', () => {
			this.openCalculatorFor('input-amount');
		});

		btnClose?.addEventListener('click', () => {
			modal.classList.remove('active');
		});

		// Keypad clicks (Insert, Actions, Tax)
		modal.addEventListener('click', (e) => {
			const btn = e.target.closest('.calc-btn');
			if (!btn) return;

			if (btn.dataset.calcInsert) {
				const char = btn.dataset.calcInsert;
				if (this.calcCurrentExpr === '0' && /[0-9(]/.test(char)) {
					this.calcCurrentExpr = char;
				} else {
					this.calcCurrentExpr += char;
				}
				this.calcTaxMeta = null;
				this.updateCalculatorDisplay();
			} else if (btn.dataset.calcAction === 'clear') {
				this.calcCurrentExpr = '0';
				this.calcTaxMeta = null;
				this.updateCalculatorDisplay();
			} else if (btn.dataset.calcAction === 'backspace') {
				if (this.calcCurrentExpr.length > 1) {
					this.calcCurrentExpr = this.calcCurrentExpr.slice(0, -1);
				} else {
					this.calcCurrentExpr = '0';
				}
				this.calcTaxMeta = null;
				this.updateCalculatorDisplay();
			} else if (btn.dataset.calcAction === 'equals') {
				const evalRes = evaluateCalculatorExpression(this.calcCurrentExpr);
				this.calcCurrentExpr = String(evalRes.result);
				this.updateCalculatorDisplay();
			} else {
				const evalRes = evaluateCalculatorExpression(this.calcCurrentExpr, btn.dataset.calcTax);
				this.calcCurrentExpr = String(evalRes.result);
				this.calcTaxMeta = evalRes.tax_meta;
				this.updateCalculatorDisplay();
			}
		});

		btnApply?.addEventListener('click', () => {
			const evalRes = evaluateCalculatorExpression(this.calcCurrentExpr);
			const targetInput = document.getElementById(this.calcTargetInputId);
			if (targetInput) {
				targetInput.value = evalRes.result;
			}
			if (this.calcTargetInputId === 'input-amount') {
				this.coordinator.currentTaxMeta = this.calcTaxMeta;
			} else if (this.calcTargetInputId === 'edit-tx-amount') {
				this.coordinator.txEditController.currentTaxMeta = this.calcTaxMeta;
			}
			modal.classList.remove('active');
		});
	}

	async handleFormSubmit() {
		if (this.submitBusy || this.coordinator.isKeyLocked) return;
		this.tagMemoInput.commitPending();
		const draft = { ...captureFormValues(document.getElementById('tx-form')), mode: this.coordinator.currentMode, taxMeta: structuredClone(this.coordinator.currentTaxMeta) };
		const operation = ++this.submitOperation, sessionValid = captureRenderSession(this.coordinator);
		const valid = () => operation === this.submitOperation && sessionValid();
		this.submitBusy = true;
		this.releaseSubmitBusy = beginFormBusy(document.getElementById('tx-form'), document.getElementById('btn-save-tx'), '登録中…', [...document.querySelectorAll('.mode-tab-btn')]);
		try { await this.saveInput(draft, valid); }
		catch (error) { if (valid()) alert(`明細の保存に失敗しました: ${error.message}`); }
		finally { if (operation === this.submitOperation) { this.releaseSubmitBusy(); this.releaseSubmitBusy = null; this.submitBusy = false; } }
	}

	cancelPendingOperations() {
		this.submitOperation++;
		this.settleOperation = null; this.settleBusy = false;
		this.releaseSubmitBusy?.(); this.releaseSubmitBusy = null; this.submitBusy = false;
		if (this.tagMemoInput) { this.resetDraftInputs(); this.tagMemoInput.hide('tags'); this.tagMemoInput.hide('memos'); }
	}

	renderPointOffsetNotice(config = this.pointPaymentConfig) {
		const notice = document.getElementById('point-offset-notice');

		if (document.getElementById('select-point-account').value) { notice.textContent = '選択したポイント口座から充当します。相殺収入の既定分類は使用しません。'; return; }
		const defaults = config?.point_payment_defaults;
		const category = config?.categories?.find(item => item.id === defaults?.category_id);
		const child = category?.subcategories?.find(item => item.id === defaults?.subcategory_id);
		const name = category ? `${category.name}${child ? ` ＞ ${child.name}` : ''}` : defaults?.category_id || '';
		const valid = category && category.type === 'income' && !category.is_archived && (!defaults.subcategory_id || (child && !child.is_archived));
		notice.textContent = valid ? `相殺収入の分類: ${name}。設定画面で変更できます。` : defaults ? `相殺収入の分類: ${name}（アーカイブ済みまたは無効）。設定画面で再設定してください。` : '相殺収入の分類は未設定です。口座指定なしで登録する前に設定画面で指定してください。';
	}

	async saveInput(draft, valid) {
		const values = draft.values;
		const fields = { normal: ['input-amount'], advance: ['input-self-amount', 'input-adv-amount'], repay: ['input-repay-amount'], prepaid: ['input-prepaid-total'], point: ['input-point-total'] };
		const amountPending = fields[draft.mode].every(id => !values[id].trim());
		if (amountPending && draft.mode === 'point' && Number(values['input-point-used']) > 0) {
			alert('ポイント利用額がある場合は購入総額を入力してください。'); return;
		}
		if (amountPending && !confirm('金額未入力です。金額が未確定の予定（0円）として登録しますか？')) return;
		const date = values['input-date'];
		const memo = values['input-memo'] || '';
		const tagsRaw = values['input-tags'] || '';
		const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

		const accountId = values['select-account'];
		const toAccountId = values['select-to-account'];
		const categoryId = values['select-category'];
		const subcategoryId = values['select-subcategory'] || null;

		const chkSync = draft.checked['chk-sync-actual-category'];
		const actualCategoryId = chkSync ? categoryId : values['select-actual-category'];
		const actualSubcategoryId = chkSync ? subcategoryId : values['select-actual-subcategory'] || null;

		let txRecordsToSave = [];

		if (draft.mode === 'normal') {
			const type = values['input-type'];
			const amount = Number(values['input-amount']) || 0;

			if (amount <= 0 && !amountPending) {
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
				tax_meta: draft.taxMeta,
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
		} else if (draft.mode === 'advance') {
			const selfAmount = Number(values['input-self-amount']) || 0;
			const advAmount = Number(values['input-adv-amount']) || 0;

			if (selfAmount <= 0 && advAmount <= 0 && !amountPending) {
				alert('自己負担額または立替額を入力してください');
				return;
			}

			const advanceTxs = createAdvancePaymentTransactions({
				includeEmpty: amountPending,
				date,
				payingAccountId: accountId,
				selfAmount,
				advanceAmount: advAmount,
				categoryId,
				subcategoryId,
				actualCategoryId,
				actualSubcategoryId,
				taxMeta: draft.taxMeta,
				memo,
				tags
			});
			txRecordsToSave.push(...advanceTxs);
		} else if (draft.mode === 'repay') {
			const repayAmount = Number(values['input-repay-amount']) || 0;
			if (repayAmount <= 0 && !amountPending) {
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

		} else if (draft.mode === 'prepaid') {
			const totalAmount = Number(values['input-prepaid-total']) || 0;
			const amortizeMonths = Number(values['input-prepaid-months']) || 12;

			if (totalAmount <= 0 && !amountPending) {
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
		} else if (draft.mode === 'point') {
			const totalAmount = Number(values['input-point-total']) || 0;
			const pointUsed = Number(values['input-point-used']) || 0;
			const pointAccountId = values['select-point-account'] || null;

			if (totalAmount <= 0 && !amountPending) {
				alert('購入総額を入力してください');
				return;
			}
			const config = pointAccountId ? null : await this.db.getMasterConfig();
			if (!valid()) return;
			const defaults = config?.point_payment_defaults;
			if (!pointAccountId) {
				const parent = config.categories?.find(item => item.id === defaults?.category_id && item.type === 'income' && !item.is_archived);
				if (!parent || (defaults.subcategory_id && !parent.subcategories?.some(item => item.id === defaults.subcategory_id && !item.is_archived))) throw new Error('相殺収入の分類が未設定またはアーカイブ済みです。設定画面で再設定してください。');
			}

			const pointTxs = createPointPaymentTransactions({
				date,
				totalAmount,
				pointUsed,
				payingAccountId: accountId,
				pointAccountId,
				offsetCategoryId: defaults?.category_id,
				offsetSubcategoryId: defaults?.subcategory_id ?? null,
				categoryId,
				subcategoryId,
				actualCategoryId,
				actualSubcategoryId,
				taxMeta: draft.taxMeta,
				memo,
				tags
			});
			txRecordsToSave.push(...pointTxs);
		}

		// Save to Database
		if (amountPending) for (const tx of txRecordsToSave) { tx.status = 'planned'; tx.amount_pending = true; tx.tax_meta = null; }
		const approved = await this.coordinator.approveClosedChanges(txRecordsToSave, [], { isSessionValid: valid });
		if (approved === null || !valid()) return;
		for (const tx of txRecordsToSave) tx.reclose_approved_months = approved;
		await this.db.putTransactions(txRecordsToSave, { createOnly: true, isSessionValid: valid });
		if (!valid()) return;
		this.coordinator.showToast('✅ 登録が完了しました');
		this.resetDraftInputs();
		try { await this.coordinator.refreshAfterTransactionChange({ isSessionValid: valid }); }
		catch (error) { if (valid()) alert(`変更は保存済みです。表示の更新に失敗しました: ${error.message}`); }
	}

	resetDraftInputs() {
		const elAmt = document.getElementById('input-amount');
		elAmt.value = '';
		const elSelf = document.getElementById('input-self-amount');
		elSelf.value = '';
		const elAdv = document.getElementById('input-adv-amount');
		elAdv.value = '';
		const elRepay = document.getElementById('input-repay-amount');
		elRepay.value = '';
		const elPreTotal = document.getElementById('input-prepaid-total');
		elPreTotal.value = '';
		const elPtTotal = document.getElementById('input-point-total');
		elPtTotal.value = '';
		const elPtUsed = document.getElementById('input-point-used');
		elPtUsed.value = '';
		const dispPoint = document.getElementById('display-point-self-amount');
		dispPoint.textContent = '¥0';
		const elMemo = document.getElementById('input-memo');
		elMemo.value = '';
		const elTags = document.getElementById('input-tags');
		elTags.value = '';
		const elTagText = document.getElementById('input-tag-text');
		elTagText.value = '';
		this.confirmedTags = [];
		this.renderTagChips();
		this.coordinator.currentTaxMeta = null;

	}
}

