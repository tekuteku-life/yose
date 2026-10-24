import { escapeHtml, formatDate } from '../logic.js';
import { buildFurusatoSummary, estimateFurusatoLimit } from '../logic/data_insights.js';

const yen = value => value === null ? '未算出' : `¥${value.toLocaleString()}`;
export class InsightsController {
	constructor(coordinator) {
		this.coordinator = coordinator; this.generation = 0; this.metadataGeneration = 0;
		this.taxDraft = null; this.investmentDraft = null; this.investmentConfig = null;
		this.taxDirty = false; this.investmentDirty = false; this.taxBusy = false; this.investmentBusy = false;
	}
	get db() { return this.coordinator.db; }
	setup() {
		for (const id of ['furusato-resident-tax', 'furusato-tax-rate']) document.getElementById(id).addEventListener('input', () => { this.taxDirty = true; });
		document.getElementById('furusato-tax-rate').addEventListener('change', () => { this.taxDirty = true; });
		document.getElementById('btn-save-furusato').addEventListener('click', () => this.saveFurusato());
		for (const id of ['investment-invested', 'investment-valuation']) document.getElementById(id).addEventListener('input', () => { this.investmentDirty = true; });
		for (const id of ['investment-account', 'investment-date']) document.getElementById(id).addEventListener('change', () => this.loadInvestmentDraft());
		document.getElementById('asset-investment-account').addEventListener('change', () => this.coordinator.summaryController.renderAssetHistory());
		document.getElementById('btn-save-investment').addEventListener('click', () => this.saveInvestment());
		document.getElementById('investment-observations').addEventListener('click', event => {
			const button = event.target.closest('[data-delete-observation]');
			if (button) this.deleteInvestment(button.dataset.account, button.dataset.deleteObservation);
		});
	}
	cancel() {
		this.generation++; this.metadataGeneration++;
		this.taxDraft = null; this.investmentDraft = null; this.investmentConfig = null;
		this.taxDirty = false; this.investmentDirty = false; this.setFormBusy('tax', false); this.setFormBusy('investment', false);
		for (const id of ['data-metadata', 'furusato-records', 'furusato-summary', 'investment-observations']) document.getElementById(id).replaceChildren();
		for (const id of ['furusato-resident-tax', 'furusato-tax-rate', 'investment-invested', 'investment-valuation']) document.getElementById(id).value = '';
	}
	setFormBusy(kind, busy) {
		if (kind === 'tax') this.taxBusy = busy; else this.investmentBusy = busy;
		const selector = kind === 'tax' ? '#furusato-resident-tax,#furusato-tax-rate,#btn-save-furusato' : '#investment-account,#investment-date,#investment-invested,#investment-valuation,#btn-save-investment,#investment-observations button';
		(/** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll(selector))).forEach(control => { control.disabled = busy; });
	}
	async renderMetadata() {
		const generation = ++this.metadataGeneration, session = this.generation, key = this.db.encryptionKey;
		const target = document.getElementById('data-metadata');
		if (this.coordinator.isKeyLocked) return;
		try {
			const data = await this.db.getDataMetadata();
			if (generation !== this.metadataGeneration || session !== this.generation || key !== this.db.encryptionKey || this.coordinator.isKeyLocked) return;
			target.textContent = `明細 ${data.count.toLocaleString()}件（確定 ${data.confirmed.toLocaleString()}件 / 予定 ${data.planned.toLocaleString()}件）・削除済み ${data.deleted.toLocaleString()}件 / 全体サイズ ${data.bytes.toLocaleString()}バイト / 取引日 ${data.firstDate || 'なし'} 〜 ${data.lastDate || 'なし'} / 月平均 ${data.monthlyAverage.toFixed(2)}件（${data.months}か月） / 年平均 ${data.yearlyAverage.toFixed(2)}件（${data.years}年）`;
		} catch (error) { if (generation === this.metadataGeneration && session === this.generation && !this.coordinator.isKeyLocked) target.textContent = `データ情報を取得できませんでした: ${error.message}`; }
	}
	renderFurusato(transactions, config) {
		const year = String(this.coordinator.selectedYear);
		const summary = buildFurusatoSummary(transactions, config, year);
		const card = document.getElementById('furusato-card');
		card.style.display = this.coordinator.analyticsTarget === 'budget' && summary.records.length ? 'block' : 'none';
		if (!summary.records.length) return;
		document.getElementById('furusato-summary').textContent = `${year}年 確定寄附 ${yen(summary.confirmed)} / 予定 ${yen(summary.planned)} / 金額未入力 ${summary.pending}件 / 概算上限 ${yen(summary.limit)} / ${summary.remaining !== null && summary.remaining < 0 ? '超過額 ' + yen(-summary.remaining) : '残り ' + yen(summary.remaining)} / ${Number(year) - 1}年の取得済み確定収入 ${summary.previousCount}件・合計 ${yen(summary.previousIncome)}`;
		document.getElementById('furusato-records').innerHTML = `<table class="summary-table"><caption>${year}年の取得済み寄附一覧</caption><thead><tr><th>取引日</th><th>メモ</th><th>状態</th><th>金額</th></tr></thead><tbody>${summary.records.map(tx => `<tr><td>${escapeHtml(tx.date)}</td><td>${escapeHtml(tx.memo || '')}</td><td>${tx.status === 'confirmed' ? '確定' : '予定'}</td><td>${tx.amount_pending ? '金額未入力' : yen(tx.amount)}</td></tr>`).join('')}</tbody></table>`;
		if (!this.taxDirty || this.taxDraft?.year !== year) {
			this.taxDraft = { year, config: structuredClone(config) }; this.taxDirty = false;
			const input = config.annual_budgets?.[year]?.furusato_estimate;
			document.getElementById('furusato-resident-tax').value = input?.resident_tax ?? '';
			document.getElementById('furusato-tax-rate').value = input?.income_tax_rate ?? '';
		}
		this.setFormBusy('tax', this.taxBusy);
	}
	async saveFurusato() {
		if (this.taxBusy || !this.taxDraft || this.coordinator.isKeyLocked) return;
		const session = this.generation, key = this.db.encryptionKey;
		const valid = () => session === this.generation && key === this.db.encryptionKey && !this.coordinator.isKeyLocked;
		this.setFormBusy('tax', true);
		let committed = false;
		try {
			const amount = document.getElementById('furusato-resident-tax').value, rate = document.getElementById('furusato-tax-rate').value;
			if (amount === '' || rate === '') throw new Error('所得割額と特例控除用税率を入力してください。');
			const input = { resident_tax: Number(amount), income_tax_rate: Number(rate) };
			if (estimateFurusatoLimit(input, this.taxDraft.year) === null) throw new Error('概算は2015〜2037年の税制に対応しています。');
			const baseline = this.taxDraft.config, config = structuredClone(baseline), year = this.taxDraft.year;
			config.annual_budgets ||= {}; config.annual_budgets[year] = { ...config.annual_budgets[year], furusato_estimate: input };
			await this.db.saveMasterConfig(config, { expectedConfig: baseline }); committed = true;
			if (!valid()) return;
			this.taxDirty = false; document.getElementById('furusato-error').textContent = '';
			await this.afterSave('ふるさと納税の概算条件を保存しました。', valid);
		} catch (error) { if (valid()) document.getElementById('furusato-error').textContent = `${committed ? '保存済みです。表示を更新してください。' : ''}${error.message}`; }
		finally { if (valid()) { this.setFormBusy('tax', false); } }
	}
	renderInvestment(config) {
		this.investmentConfig = structuredClone(config);
		const all = config.accounts.filter(a => a.type === 'investment');
		const active = all.filter(a => !a.is_archived);
		const selector = document.getElementById('investment-account');
		const previous = selector.value;
		selector.innerHTML = active.map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
		if (active.some(a => a.id === previous)) selector.value = previous;
		const scope = document.getElementById('asset-investment-account'), selection = scope.value;
		scope.innerHTML = '<option value="all">全投資口座</option>' + all.filter(a => a.is_asset !== false).map(a => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
		if (selection === 'all' || all.some(a => a.id === selection && a.is_asset !== false)) scope.value = selection;
		const date = document.getElementById('investment-date');
		if (!date.value) date.value = formatDate(new Date());
		if (!this.investmentDirty) this.loadInvestmentDraft();
		document.getElementById('btn-save-investment').disabled = this.investmentBusy || !active.length;
		document.getElementById('investment-observations').innerHTML = `<table class="summary-table"><caption>投資口座の日末評価記録</caption><thead><tr><th>日付</th><th>口座</th><th>差引拠出額</th><th>評価額</th><th>操作</th></tr></thead><tbody>${all.flatMap(a => Object.entries(a.investment_history || {}).sort(([a], [b]) => b.localeCompare(a)).map(([day, value]) => `<tr><td>${escapeHtml(day)}</td><td>${escapeHtml(a.name)}</td><td>${yen(value.invested_amount)}</td><td>${yen(value.market_value)}</td><td>${a.is_archived ? 'アーカイブ済み' : `<button type="button" class="btn btn-secondary btn-sm" data-account="${escapeHtml(a.id)}" data-delete-observation="${escapeHtml(day)}">削除</button>`}</td></tr>`)).join('')}</tbody></table>`;
		this.setFormBusy('investment', this.investmentBusy);
		document.getElementById('btn-save-investment').disabled = this.investmentBusy || !active.length;
	}
	loadInvestmentDraft() {
		if (!this.investmentConfig) return;
		const accountId = document.getElementById('investment-account').value, date = document.getElementById('investment-date').value;
		const original = this.investmentConfig.accounts.find(a => a.id === accountId)?.investment_history?.[date] || null;
		this.investmentDraft = { accountId, date, original: structuredClone(original) }; this.investmentDirty = false;
		document.getElementById('investment-invested').value = original?.invested_amount ?? '';
		document.getElementById('investment-valuation').value = original?.market_value ?? '';
	}
	async saveInvestment() {
		if (!this.investmentDraft) return;
		const draft = structuredClone(this.investmentDraft);
		const invested = document.getElementById('investment-invested').value, valuation = document.getElementById('investment-valuation').value;
		if (invested === '' || valuation === '') { document.getElementById('investment-error').textContent = '投資額と評価額を入力してください。'; return; }
		await this.commitInvestment(draft.accountId, draft.date, { invested_amount: Number(invested), market_value: Number(valuation) }, draft.original);
	}
	async deleteInvestment(accountId, date) {
		const original = this.investmentConfig?.accounts.find(a => a.id === accountId)?.investment_history?.[date];
		if (!original || !confirm('この日の投資評価記録を削除しますか？')) return;
		await this.commitInvestment(accountId, date, null, original);
	}
	async commitInvestment(accountId, date, value, original) {
		if (this.investmentBusy || this.coordinator.isKeyLocked) return;
		const session = this.generation, key = this.db.encryptionKey;
		const valid = () => session === this.generation && key === this.db.encryptionKey && !this.coordinator.isKeyLocked;
		this.setFormBusy('investment', true);
		let committed = false;
		try {
			await this.db.saveInvestmentObservation(accountId, date, value, original, { isSessionValid: valid }); committed = true;
			if (!valid()) return;
			this.investmentDirty = false;
			document.getElementById('investment-error').textContent = '';
			await this.afterSave(value === null ? '投資評価記録を削除しました。' : '投資評価記録を保存しました。', valid);
		} catch (error) { if (valid()) document.getElementById('investment-error').textContent = `${committed ? '保存済みです。表示を更新してください。' : ''}${error.message}`; }
		finally { if (valid()) { this.setFormBusy('investment', false); } }
	}
	async afterSave(message, valid) {
		this.coordinator.showToast(message);
		void this.coordinator.syncManager?.queueMasterSync();
		if (valid()) await this.coordinator.refreshAllViews();
	}
}
