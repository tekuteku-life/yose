import { escapeHtml, formatDate } from '../logic.js';
import { captureRenderSession } from './render_session.js';

const yen = value => value === null ? '未算出' : `¥${value.toLocaleString()}`;
export class InsightsController {
	constructor(coordinator) {
		this.coordinator = coordinator; this.generation = 0; this.metadataGeneration = 0;
		this.investmentDraft = null; this.investmentConfig = null;
		this.investmentDirty = false; this.investmentBusy = false;
	}
	get db() { return this.coordinator.db; }
	setup() {
		for (const id of ['investment-acquisition-cost', 'investment-valuation']) document.getElementById(id).addEventListener('input', () => { this.investmentDirty = true; });
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
		this.investmentDraft = null; this.investmentConfig = null;
		this.investmentDirty = false; this.setFormBusy(false);
		for (const id of ['data-metadata', 'investment-observations']) document.getElementById(id).replaceChildren();
		for (const id of ['investment-acquisition-cost', 'investment-valuation']) document.getElementById(id).value = '';
	}
	setFormBusy(busy) {
		this.investmentBusy = busy;
		const selector = '#investment-account,#investment-date,#investment-acquisition-cost,#investment-valuation,#btn-save-investment,#investment-observations button';
		(/** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll(selector))).forEach(control => { control.disabled = busy; });
	}
	async renderMetadata({ isSessionValid = null } = {}) {
		const valid = captureRenderSession(this.coordinator, isSessionValid);
		if (!valid()) return;
		const generation = ++this.metadataGeneration, session = this.generation, key = this.db.encryptionKey;
		const target = document.getElementById('data-metadata');
		if (this.coordinator.isKeyLocked) return;
		try {
			const data = await this.db.getDataMetadata();
			if (!valid() || generation !== this.metadataGeneration || session !== this.generation || key !== this.db.encryptionKey || this.coordinator.isKeyLocked) return;
			const items = [
				`明細 ${data.count.toLocaleString()}件（確定 ${data.confirmed.toLocaleString()}件 / 予定 ${data.planned.toLocaleString()}件）・削除済み ${data.deleted.toLocaleString()}件`,
				`全体サイズ ${data.bytes.toLocaleString()}バイト`,
				`取引日 ${data.firstDate || 'なし'} 〜 ${data.lastDate || 'なし'}`,
				`月平均 ${data.monthlyAverage.toFixed(2)}件（${data.months}か月）`,
				`年平均 ${data.yearlyAverage.toFixed(2)}件（${data.years}年）`
			];
			target.innerHTML = `<ul class="metadata-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
		} catch (error) { if (valid() && generation === this.metadataGeneration && session === this.generation && !this.coordinator.isKeyLocked) target.textContent = `データ情報を取得できませんでした: ${error.message}`; }
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
		document.getElementById('investment-observations').innerHTML = `<table class="summary-table"><caption>投資口座の日末評価記録</caption><thead><tr><th>日付</th><th>口座</th><th>取得原価（保有商品）</th><th>口座評価額（預り金込）</th><th>操作</th></tr></thead><tbody>${all.flatMap(a => Object.entries(a.investment_history || {}).sort(([a], [b]) => b.localeCompare(a)).map(([day, value]) => `<tr><td>${escapeHtml(day)}</td><td>${escapeHtml(a.name)}</td><td>${value.acquisition_cost === undefined ? '未記録（旧形式）' : yen(value.acquisition_cost)}</td><td>${yen(value.market_value)}</td><td>${a.is_archived ? 'アーカイブ済み' : `<button type="button" class="btn btn-secondary btn-sm" data-account="${escapeHtml(a.id)}" data-delete-observation="${escapeHtml(day)}">削除</button>`}</td></tr>`)).join('')}</tbody></table>`;
		this.setFormBusy(this.investmentBusy);
		document.getElementById('btn-save-investment').disabled = this.investmentBusy || !active.length;
	}
	loadInvestmentDraft() {
		if (!this.investmentConfig) return;
		const accountId = document.getElementById('investment-account').value, date = document.getElementById('investment-date').value;
		const original = this.investmentConfig.accounts.find(a => a.id === accountId)?.investment_history?.[date] || null;
		this.investmentDraft = { accountId, date, original: structuredClone(original) }; this.investmentDirty = false;
		document.getElementById('investment-acquisition-cost').value = original?.acquisition_cost ?? '';
		document.getElementById('investment-valuation').value = original?.market_value ?? '';
	}
	async saveInvestment() {
		if (!this.investmentDraft) return;
		const draft = structuredClone(this.investmentDraft);
		const acquisitionCost = document.getElementById('investment-acquisition-cost').value, valuation = document.getElementById('investment-valuation').value;
		if (acquisitionCost === '' || valuation === '') { document.getElementById('investment-error').textContent = '保有商品の取得原価と口座評価額を入力してください。'; return; }
		await this.commitInvestment(draft.accountId, draft.date, { acquisition_cost: Number(acquisitionCost), market_value: Number(valuation) }, draft.original);
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
		this.setFormBusy(true);
		let committed = false;
		try {
			await this.db.saveInvestmentObservation(accountId, date, value, original, { isSessionValid: valid }); committed = true;
			if (!valid()) return;
			this.investmentDirty = false;
			document.getElementById('investment-error').textContent = '';
			await this.afterSave(value === null ? '投資評価記録を削除しました。' : '投資評価記録を保存しました。', valid);
		} catch (error) { if (valid()) document.getElementById('investment-error').textContent = `${committed ? '保存済みです。表示を更新してください。' : ''}${error.message}`; }
		finally { if (valid()) { this.setFormBusy(false); } }
	}
	async afterSave(message, valid) {
		this.coordinator.showToast(message);
		void this.coordinator.syncManager?.queueMasterSync();
		if (valid()) await this.coordinator.refreshAllViews();
	}
}
