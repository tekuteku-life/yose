import { aggregateMonthlySummaries, calculateAnnualBudgetDefaults, resolveAnnualTargets, escapeHtml } from '../logic.js';
import { captureRenderSession } from './render_session.js';

const FIELDS = { expense_budget: 'setting-expense-budget', savings_target_amount: 'setting-savings-target-amount', savings_target_rate: 'setting-savings-target-rate' };
const PRIMARY = { expense: 'expense_budget', savings: 'savings_target_amount', rate: 'savings_target_rate' };

/** Annual target drafts and CAS saves, independent of other settings. */
export class BudgetSettingsController {
	constructor(coordinator) {
		this.coordinator = coordinator; this.drafts = new Map(); this.generation = 0; this.readVersion = 0; this.saving = false; this.loading = false;
	}
	get db() { return this.coordinator.db; }
	get year() { return document.getElementById('setting-budget-year').value.trim() || this.coordinator.selectedYear; }
	get draft() { return this.drafts.get(this.year); }

	setup() {
		document.getElementById('setting-budget-year').addEventListener('change', () => { void this.render(); });
		document.getElementById('setting-goal-basis').addEventListener('change', event => {
			if (!this.draft || this.saving || this.loading) return;
			this.draft.values.goal_basis = event.target.value; this.draft.dirty = true; this.preview();
		});
		for (const [field, id] of Object.entries(FIELDS)) document.getElementById(id).addEventListener('input', event => {
			if (!this.draft || this.saving || this.loading || /** @type {HTMLInputElement} */ (event.target).readOnly) return;
			this.draft.values[field] = Number(event.target.value); this.draft.dirty = true; this.preview();
		});
		document.getElementById('budget-categories-list-container').addEventListener('input', event => {
			if (!this.draft || this.saving || this.loading || !/** @type {Element} */ (event.target).matches('.input-cat-budget')) return;
			this.draft.values.category_budgets[event.target.dataset.catId] = Number(event.target.value); this.draft.dirty = true; this.preview();
		});
		document.getElementById('input-budget-cat-search').addEventListener('input', () => this.filterCategories());
		document.getElementById('btn-budget-auto-calc').addEventListener('click', () => this.autoCalculate());
		document.getElementById('btn-save-annual-budget').addEventListener('click', () => this.save());
	}

	freeze(frozen, keepYear = false) {
		document.querySelectorAll('#card-annual-budget-setting input, #card-annual-budget-setting select, #card-annual-budget-setting button').forEach(element => { /** @type {HTMLInputElement} */ (element).disabled = frozen && !(keepYear && element.id === 'setting-budget-year'); });
	}

	cancel() {
		this.generation++; this.readVersion++; this.drafts.clear(); this.saving = false; this.loading = false; this.freeze(false);
	}

	async render({ isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid() || this.saving || this.coordinator.isKeyLocked) return;
		const input = document.getElementById('setting-budget-year');
		input.value ||= this.coordinator.selectedYear || String(new Date().getFullYear());
		const year = this.year, read = ++this.readVersion, generation = this.generation, key = this.db.encryptionKey;
		this.loading = true; this.freeze(true, true);
		let state;
		try { state = await this.db.getAnalyticsState(); } catch (error) {
			if (valid() && read === this.readVersion && generation === this.generation && !this.coordinator.isKeyLocked) { this.freeze(true, true); document.getElementById('budget-goal-notice').textContent = `${year}年の年間予算を読み取れませんでした。再表示してください。${error.message}`; }
			return;
		}
		if (!valid() || read !== this.readVersion || generation !== this.generation || key !== this.db.encryptionKey || this.coordinator.isKeyLocked || year !== this.year || this.saving) return;
		let draft = this.drafts.get(year);
		if (!draft?.dirty) {
			const values = structuredClone(state.master_config.annual_budgets?.[year] || {});
			values.goal_basis ??= 'independent'; values.category_budgets ||= {};
			values.expense_budget ??= 0; values.savings_target_amount ??= 0; values.savings_target_rate ??= values.target_savings_rate ?? 0;
			draft = { values, baseline: structuredClone(state.master_config), dirty: false, state, income: 0 }; this.drafts.set(year, draft);
		}
		draft.state = state;
		draft.income = aggregateMonthlySummaries(state.transactions.filter(tx => !tx.is_deleted), year, state.summary_snapshot?.monthly_summaries || {}).total_income;
		this.loading = false; this.freeze(false); this.renderCategories(draft, year); this.preview();
	}

	renderCategories(draft, year) {
		const previous = aggregateMonthlySummaries(draft.state.transactions.filter(tx => !tx.is_deleted), String(Number(year) - 1), draft.state.summary_snapshot?.monthly_summaries || {});
		const amounts = new Map();
		for (const month of Object.values(previous.months)) for (const [id, amount] of Object.entries(month.by_category || {})) amounts.set(id, (amounts.get(id) || 0) + Number(amount.total ?? amount));
		const categories = draft.state.master_config.categories.filter(cat => !cat.is_archived && cat.type === 'expense');
		document.getElementById('budget-categories-list-container').innerHTML = categories.map(cat => {
			const amount = draft.values.category_budgets[cat.id] ?? '';
			return `<div class="budget-cat-item" data-cat-id="${escapeHtml(cat.id)}" data-cat-name="${escapeHtml(cat.name)}"><div style="flex:2;min-width:140px"><strong>${escapeHtml(cat.icon || '🏷️')} ${escapeHtml(cat.name)}</strong><div style="font-size:0.75rem">前年実績(${Number(year) - 1}年): ¥${(amounts.get(cat.id) || 0).toLocaleString()}</div></div><div style="flex:2;display:flex;gap:6px;align-items:center"><input type="number" class="form-control form-control-sm input-cat-budget" data-cat-id="${escapeHtml(cat.id)}" value="${escapeHtml(String(amount))}" min="0" step="1"><span class="cat-monthly-hint"></span></div></div>`;
		}).join('') || '<div>費目が登録されていません</div>';
		this.filterCategories();
	}

	filterCategories() {
		const query = document.getElementById('input-budget-cat-search').value.trim().toLowerCase();
		document.querySelectorAll('.budget-cat-item').forEach(item => { item.style.display = !query || item.dataset.catName.toLowerCase().includes(query) ? 'flex' : 'none'; });
	}

	preview() {
		const draft = this.draft;
		if (!draft) return;
		const basis = draft.values.goal_basis, resolved = resolveAnnualTargets(draft.values, draft.income);
		document.getElementById('setting-goal-basis').value = basis;
		for (const [field, id] of Object.entries(FIELDS)) {
			const input = document.getElementById(id), editable = basis === 'independent' || PRIMARY[basis] === field;
			/** @type {HTMLInputElement} */ (input).readOnly = !editable;
			const value = (editable ? draft.values[field] : resolved[field]) ?? '';
			const saved = draft.baseline.annual_budgets?.[this.year] || {};
			const present = Object.hasOwn(saved, field) || (field === 'savings_target_rate' && Object.hasOwn(saved, 'target_savings_rate'));
			const unset = basis === 'independent' && !draft.dirty && value === 0 && !present;
			input.value = unset ? '' : value;
		}
		document.getElementById('budget-basis-income').textContent = `${this.year}年の基準収入: ¥${draft.income.toLocaleString()}（確定＋金額入力済み予定・取得済み合計）`;
		document.getElementById('budget-goal-notice').textContent = !resolved.valid ? '目標の数値・範囲を確認してください。' : resolved.expense_budget < 0 ? '目標貯蓄額が収入を超えています。支出予算は不足額です。' : resolved.savings_target_amount < 0 ? '支出予算が収入を超えています。目標貯蓄額は赤字額です。' : resolved.savings_target_rate === null ? '収入が0円のため貯蓄率は未算出です。' : '';
		document.getElementById('budget-monthly-preview').textContent = resolved.valid ? `月平均目安: 支出予算 ¥${Math.round(resolved.expense_budget / 12).toLocaleString()} / 目標貯蓄 ¥${Math.round(resolved.savings_target_amount / 12).toLocaleString()}` : '月平均目安: 未算出';
		let total = 0;
		document.querySelectorAll('.input-cat-budget').forEach(input => {
			const amount = Number(input.value) || 0; total += amount;
			input.parentElement.querySelector('.cat-monthly-hint').textContent = amount > 0 ? `¥${Math.round(amount / 12).toLocaleString()}/月` : '-';
		});
		const diff = resolved.expense_budget - total;
		document.getElementById('budget-category-discrepancy').textContent = `内訳合計: ¥${total.toLocaleString()}${resolved.valid && resolved.expense_budget > 0 ? diff === 0 ? ' (全体予算と完全一致 ✅)' : diff > 0 ? ` (全体予算まで残り ¥${diff.toLocaleString()})` : ` (全体予算を超過 +¥${Math.abs(diff).toLocaleString()})` : ''}`;
	}

	autoCalculate() {
		const draft = this.draft;
		if (!draft || this.saving || this.loading || this.coordinator.isKeyLocked) return;
		const prevYear = String(Number(this.year) - 1), state = draft.state;
		const summary = aggregateMonthlySummaries(state.transactions.filter(tx => !tx.is_deleted), prevYear, state.summary_snapshot?.monthly_summaries || {});
		const defaults = calculateAnnualBudgetDefaults({ previousYearSummary: { income: summary.total_income, expense: summary.total_expense, net: summary.total_net }, pastTransactions: state.transactions, categories: state.master_config.categories, targetYear: this.year });
		Object.assign(draft.values, defaults, { goal_basis: 'independent' }); draft.dirty = true;
		this.renderCategories(draft, this.year); this.preview();
		alert(`${prevYear}年の実績を元に、軽く丸めた推奨予算値を試算・反映しました！内容を確認して保存してください。`);
	}

	async save() {
		const draft = this.draft, year = this.year, generation = this.generation, key = this.db.encryptionKey;
		if (!draft || this.saving || this.loading || this.coordinator.isKeyLocked) return;
		this.saving = true; this.freeze(true);
		const valid = () => generation === this.generation && key === this.db.encryptionKey && !this.coordinator.isKeyLocked && year === this.year && this.draft === draft;
		try {
			if (!/^\d{4}$/.test(year) || !resolveAnnualTargets(draft.values, draft.income).valid) throw new Error('対象年と目標の数値・範囲を確認してください。');
			const candidate = structuredClone(draft.baseline); candidate.annual_budgets ||= {};
			candidate.annual_budgets[year] = { ...draft.values, target_savings_rate: draft.values.savings_target_rate };
			await this.db.saveMasterConfig(candidate, { expectedConfig: draft.baseline, isSessionValid: valid });
			if (!valid()) return;
			draft.dirty = false;
			alert(`${year}年の年間予算・費目別目標を保存しました！`);
			void this.coordinator.syncManager.queueMasterSync();
		} catch (error) { if (valid()) alert(`年間予算の保存に失敗しました: ${error.message}`); }
		finally { if (generation === this.generation) { this.saving = false; this.loading = false; this.freeze(false); } }
		if (generation === this.generation && !this.coordinator.isKeyLocked) await this.coordinator.refreshAllViews();
	}
}
