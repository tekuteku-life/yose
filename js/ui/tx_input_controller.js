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
		this.currentSettlingAdvanceId = null;
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
			btn.addEventListener('click', async () => {
				await this.switchInputMode(btn.dataset.mode);
			});
		});

		// Type change
		const typeSelect = document.getElementById('input-type');
		if (typeSelect) {
			typeSelect.addEventListener('change', async () => {
				const val = typeSelect.value;
				this.coordinator.currentTaxMeta = null;
				if (['advance', 'repay', 'prepaid', 'point'].includes(val)) {
					await this.switchInputMode(val);
				} else {
					await this.switchInputMode('normal');
					this.updateFormFieldsForType(val);
				}
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

		// Memo autocomplete & auto-categorization (Requirement 3.19 & 3.40.1)
		const memoInput = document.getElementById('input-memo');
		const handleMemoChange = async (e) => {
			const val = (e?.target?.value ?? (typeof e === 'string' ? e : '')).trim();
			const match = this.memoHistoryMap[val];
			if (match && match.category_id) {
				const catSelect = document.getElementById('select-category');
				if (catSelect) {
					catSelect.value = match.category_id;
					await this.updateSubcategories(match.category_id, 'select-subcategory');
					const subSelect = document.getElementById('select-subcategory');
					if (subSelect) {
						subSelect.value = match.subcategory_id || '';
					}
				}
				const chkSync = document.getElementById('chk-sync-actual-category');
				if (chkSync && chkSync.checked) {
					const actCatSelect = document.getElementById('select-actual-category');
					if (actCatSelect) {
						actCatSelect.value = match.category_id;
						await this.updateSubcategories(match.category_id, 'select-actual-subcategory');
						const actSubSelect = document.getElementById('select-actual-subcategory');
						if (actSubSelect) {
							actSubSelect.value = match.subcategory_id || '';
						}
					}
				}
			}
		};
		this.handleMemoChange = handleMemoChange;

		memoInput?.addEventListener('focus', () => {
			this.renderMemoSuggestions(memoInput.value);
		});
		memoInput?.addEventListener('input', (e) => {
			this.renderMemoSuggestions(e.target.value);
			handleMemoChange(e);
		});
		memoInput?.addEventListener('change', handleMemoChange);

		// Tag chips input handling (Requirement 3.18 & 3.40.1)
		const tagTextInput = document.getElementById('input-tag-text');
		const tagsChipsList = document.getElementById('tags-chips-list');
		const hiddenTagsInput = document.getElementById('input-tags');

		tagTextInput?.addEventListener('focus', () => {
			this.renderTagSuggestions(tagTextInput.value);
		});
		tagTextInput?.addEventListener('input', (e) => {
			this.renderTagSuggestions(e.target.value);
		});

		tagTextInput?.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ',') {
				e.preventDefault();
				const val = tagTextInput.value.trim();
				if (val) {
					this.addTag(val);
					tagTextInput.value = '';
					this.renderTagSuggestions('');
				}
			} else if (e.key === 'Backspace' && tagTextInput.value === '' && this.confirmedTags.length > 0) {
				this.confirmedTags.pop();
				this.renderTagChips();
			} else if (e.key === 'Escape') {
				const tagsDropdown = document.getElementById('tags-suggest-dropdown');
				if (tagsDropdown) tagsDropdown.style.display = 'none';
			}
		});

		memoInput?.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				const memoDropdown = document.getElementById('memo-suggest-dropdown');
				if (memoDropdown) memoDropdown.style.display = 'none';
			}
		});

		tagTextInput?.addEventListener('blur', () => {
			const val = tagTextInput.value.trim();
			if (val) {
				this.addTag(val);
				tagTextInput.value = '';
			}
		});

		// Global dismiss for custom suggestion dropdowns
		document.addEventListener('click', (e) => {
			if (!e.target.closest('#input-memo') && !e.target.closest('#memo-suggest-dropdown')) {
				const memoDropdown = document.getElementById('memo-suggest-dropdown');
				if (memoDropdown) memoDropdown.style.display = 'none';
			}
			if (!e.target.closest('#tags-chip-container') && !e.target.closest('#tags-suggest-dropdown')) {
				const tagsDropdown = document.getElementById('tags-suggest-dropdown');
				if (tagsDropdown) tagsDropdown.style.display = 'none';
			}
		});

		tagsChipsList?.addEventListener('click', (e) => {
			const btn = e.target.closest('.tag-chip-del');
			if (btn && btn.dataset.tagIndex !== undefined) {
				const idx = Number(btn.dataset.tagIndex);
				this.confirmedTags.splice(idx, 1);
				this.renderTagChips();
			}
		});

		hiddenTagsInput?.addEventListener('change', () => {
			if (hiddenTagsInput.value) {
				this.confirmedTags = hiddenTagsInput.value.split(',').map(s => s.trim()).filter(Boolean);
				this.renderTagChips();
			}
		});

		// Unsettled Advance List settlement click (Requirement 3.20)
		document.getElementById('unsettled-advance-list')?.addEventListener('click', async (e) => {
			const btn = e.target.closest('.btn-settle-advance');
			if (btn && btn.dataset.txId) {
				await this.handleSettleAdvanceDirectly(btn.dataset.txId);
			}
		});

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

	async switchInputMode(mode) {
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
			this.renderUnsettledAdvanceList();
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
		await this.populateCategoryDropdowns(typeSelect?.value || 'expense');
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

		// Tag & Memo suggestions & unsettled advances (Requirements 3.18, 3.19, 3.20)
		await this.updateTagAndMemoSuggestions();
		await this.renderUnsettledAdvanceList();
		this.renderTagChips();
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
		const emptyOption = '<option value="">（指定なし / 費目のみ）</option>';
		if (!cat || !cat.subcategories) {
			select.innerHTML = emptyOption;
			return;
		}
		const activeSubs = cat.subcategories.filter(s => !s.is_archived);
		select.innerHTML = [
			emptyOption,
			...activeSubs.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`)
		].join('');
		if (activeSubs.length > 0) {
			select.value = activeSubs[0].id;
		}
	}

	renderTagChips() {
		const container = document.getElementById('tags-chips-list');
		const hiddenInput = document.getElementById('input-tags');
		if (hiddenInput) hiddenInput.value = this.confirmedTags.join(', ');
		if (!container) return;

		container.innerHTML = this.confirmedTags.map((tag, idx) => `
			<span class="tag-chip">
				${escapeHtml(tag)}
				<button type="button" class="tag-chip-del" data-tag-index="${idx}" aria-label="タグ削除">&times;</button>
			</span>
		`).join('');
	}

	addTag(tagStr) {
		if (!tagStr) return;
		const parts = tagStr.split(',').map(s => s.trim()).filter(Boolean);
		for (const p of parts) {
			if (!this.confirmedTags.includes(p)) {
				this.confirmedTags.push(p);
			}
		}
		this.renderTagChips();
	}

	async updateTagAndMemoSuggestions() {
		this.availableTags = await this.db.getUniqueTags();
		this.memoHistoryMap = await this.db.getMemoHistory();
	}

	renderMemoSuggestions(query = '') {
		const dropdown = document.getElementById('memo-suggest-dropdown');
		if (!dropdown) return;
		const allMemos = Object.keys(this.memoHistoryMap || {});
		const q = String(query || '').trim().toLowerCase();
		const filtered = q ? allMemos.filter(m => m.toLowerCase().includes(q)) : allMemos;
		if (filtered.length === 0) {
			dropdown.style.display = 'none';
			dropdown.innerHTML = '';
			return;
		}
		dropdown.innerHTML = filtered.slice(0, 15).map(m => {
			const match = this.memoHistoryMap[m];
			const subText = match?.category_id ? ` <span style="font-size: 0.75rem; color: var(--text-muted);">(${escapeHtml(match.category_id)})</span>` : '';
			return `<div class="suggest-item" data-value="${escapeHtml(m)}"><span>📝 ${escapeHtml(m)}</span>${subText}</div>`;
		}).join('');
		dropdown.style.display = 'block';

		dropdown.querySelectorAll('.suggest-item').forEach(item => {
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				const val = item.dataset.value;
				const input = document.getElementById('input-memo');
				if (input) {
					input.value = val;
					this.handleMemoChange(val);
				}
				dropdown.style.display = 'none';
			});
		});
	}

	renderTagSuggestions(query = '') {
		const dropdown = document.getElementById('tags-suggest-dropdown');
		if (!dropdown) return;
		const allTags = this.availableTags || [];
		const q = String(query || '').trim().toLowerCase();
		const filtered = q
			? allTags.filter(t => t.toLowerCase().includes(q) && !this.confirmedTags.includes(t))
			: allTags.filter(t => !this.confirmedTags.includes(t));
		if (filtered.length === 0) {
			dropdown.style.display = 'none';
			dropdown.innerHTML = '';
			return;
		}
		dropdown.innerHTML = filtered.slice(0, 15).map(t => {
			return `<div class="suggest-item" data-value="${escapeHtml(t)}"><span>🏷️ #${escapeHtml(t)}</span></div>`;
		}).join('');
		dropdown.style.display = 'block';

		dropdown.querySelectorAll('.suggest-item').forEach(item => {
			item.addEventListener('click', (e) => {
				e.stopPropagation();
				const val = item.dataset.value;
				this.addTag(val);
				const input = document.getElementById('input-tag-text');
				if (input) input.value = '';
				dropdown.style.display = 'none';
			});
		});
	}

	async renderUnsettledAdvanceList() {
		const list = document.getElementById('unsettled-advance-list');
		const countBadge = document.getElementById('unsettled-advance-count');
		if (!list) return;

		const unsettled = await this.db.getUnsettledAdvancePayments();
		if (countBadge) countBadge.textContent = `${unsettled.length}件`;

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
		const advTx = await this.db.getTransaction(advanceId);
		if (!advTx) return;

		const config = await this.db.getMasterConfig();
		const receivingAccountId = document.getElementById('select-account')?.value || (config?.accounts?.[0]?.id || 'acc_default');
		const today = formatDate(new Date());
		const memo = `[立替精算] ${advTx.memo || ''}`.trim();
		const tags = Array.from(new Set([...(advTx.tags || []), '立替回収']));

		const repayTx = createAdvanceRepaymentTransaction({
			date: today,
			receivingAccountId,
			amount: advTx.amount,
			memo,
			tags
		});

		advTx.settlement_status = 'settled';
		advTx.updated_at = new Date().toISOString();
		advTx.sync_status = 'unsynced';

		await this.db.putTransactions([repayTx, advTx]);
		this.coordinator.showToast(`✅ 立替金(¥${advTx.amount.toLocaleString()})の回収を登録しました`);
		alert(`立替金「${advTx.memo || '未回収'}」(¥${advTx.amount.toLocaleString()}) の回収・精算を完了しました`);
		await this.coordinator.refreshAllViews();
		this.syncManager?.syncPendingDiffs().catch(e => console.log('Sync deferred:', e.message));
	}

	openCalculatorFor(targetInputId = 'input-amount') {
		this.calcTargetInputId = targetInputId;
		const targetInput = document.getElementById(targetInputId);
		const currentVal = targetInput?.value ? String(targetInput.value).trim() : '0';
		this.calcCurrentExpr = currentVal || '0';
		this.calcTaxMeta = null;
		this.updateCalculatorDisplay();

		const modal = document.getElementById('modal-tax');
		if (modal) modal.classList.add('active');
	}

	updateCalculatorDisplay() {
		const exprEl = document.getElementById('calc-expr-display');
		const resEl = document.getElementById('calc-result-display');
		const taxSummary = document.getElementById('calc-tax-summary');
		const baseEl = document.getElementById('calc-tax-base');
		const amtEl = document.getElementById('calc-tax-amount');

		if (exprEl) exprEl.textContent = this.calcCurrentExpr || '0';

		const evalRes = evaluateCalculatorExpression(this.calcCurrentExpr || '0');
		this.calcEvaluatedResult = evalRes.result;

		if (resEl) resEl.textContent = `¥${evalRes.result.toLocaleString()}`;

		if (this.calcTaxMeta) {
			if (taxSummary) taxSummary.style.display = 'block';
			const base = Number(this.calcTaxMeta.base_amount) || 0;
			const taxAmt = this.calcTaxMeta.tax_amount !== undefined
				? Number(this.calcTaxMeta.tax_amount)
				: (this.calcTaxMeta.base_amount ? Math.round(base * (this.calcTaxMeta.tax_rate || 0)) : 0);
			if (baseEl) baseEl.textContent = `¥${base.toLocaleString()}`;
			if (amtEl) amtEl.textContent = `¥${taxAmt.toLocaleString()} (${Math.round((this.calcTaxMeta.tax_rate || 0) * 100)}%)`;
		} else {
			if (taxSummary) taxSummary.style.display = 'none';
		}
	}

	setupTaxModal() {
		const modal = document.getElementById('modal-tax');
		const btnOpen = document.getElementById('btn-open-tax-calc');
		const btnClose = document.getElementById('btn-close-tax-modal');
		const btnApply = document.getElementById('btn-apply-tax');

		if (!modal) return;

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
				const evalRes = evaluateCalculatorExpression(this.calcCurrentExpr || '0');
				this.calcCurrentExpr = String(evalRes.result);
				this.updateCalculatorDisplay();
			} else if (btn.dataset.calcTax) {
				const evalRes = evaluateCalculatorExpression(this.calcCurrentExpr || '0', btn.dataset.calcTax);
				this.calcCurrentExpr = String(evalRes.result);
				this.calcTaxMeta = evalRes.tax_meta;
				this.updateCalculatorDisplay();
			}
		});

		btnApply?.addEventListener('click', () => {
			const evalRes = evaluateCalculatorExpression(this.calcCurrentExpr || '0');
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
		const date = document.getElementById('input-date')?.value;
		const memo = document.getElementById('input-memo')?.value || '';
		const tagsRaw = document.getElementById('input-tags')?.value || '';
		const tags = tagsRaw.split(',').map(s => s.trim()).filter(Boolean);

		const accountId = document.getElementById('select-account')?.value;
		const toAccountId = document.getElementById('select-to-account')?.value;
		const categoryId = document.getElementById('select-category')?.value;
		const subcategoryId = document.getElementById('select-subcategory')?.value || null;

		const chkSync = document.getElementById('chk-sync-actual-category')?.checked;
		const actualCategoryId = chkSync ? categoryId : document.getElementById('select-actual-category')?.value;
		const actualSubcategoryId = chkSync ? subcategoryId : document.getElementById('select-actual-subcategory')?.value || null;

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

			if (this.currentSettlingAdvanceId) {
				const advTx = await this.db.getTransaction(this.currentSettlingAdvanceId);
				if (advTx) {
					advTx.settlement_status = 'settled';
					advTx.updated_at = new Date().toISOString();
					advTx.sync_status = 'unsynced';
					txRecordsToSave.push(advTx);
				}
				this.currentSettlingAdvanceId = null;
			}
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
		this.coordinator.showToast('✅ 登録が完了しました');

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
		const elTagText = document.getElementById('input-tag-text');
		if (elTagText) elTagText.value = '';
		this.confirmedTags = [];
		this.renderTagChips();
		this.coordinator.currentTaxMeta = null;

		// Refresh views & try auto sync in background
		await this.coordinator.refreshAllViews();
		this.syncManager.syncPendingDiffs().catch(err => console.log('Auto sync deferred:', err.message));
	}
}

