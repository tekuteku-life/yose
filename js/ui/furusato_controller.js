import { escapeHtml } from '../logic.js';
import { captureRenderSession } from './render_session.js';
import { buildFurusatoSummary, buildFurusatoLedgerSummary } from '../logic/data_insights.js';
import { FURUSATO_FIELDS, getFurusatoSetting, getFurusatoInputMode, getFurusatoLedgerFingerprint, calculateFurusatoFromLedger, estimateFurusatoLimit } from '../logic/furusato_calculator.js';
const el = id => /** @type {HTMLInputElement & HTMLSelectElement} */ (document.getElementById(id));
const yen = value => value == null ? '未算出' : `¥${value.toLocaleString()}`;
const resultList = rows => `<dl class="tax-result-grid">${rows.map(([label, value], index) => `<div class="tax-result${index === 0 ? ' tax-result-primary' : ''}"><dt>${escapeHtml(label)} </dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>`;
export class FurusatoController {
	constructor(coordinator) {
		this.coordinator = coordinator; this.generation = 0; this.renderVersion = 0; this.editVersion = 0;
		this.taxDraft = null; this.sourceDraft = null; this.taxDirty = false; this.sourceDirty = false; this.taxBusy = false;
		this.confirmationToken = null; this.currentFingerprint = null; this.state = null;
	}
	get db() { return this.coordinator.db; }
	setup() {
		for (const [field, def] of Object.entries(FURUSATO_FIELDS)) {
			const target = def.life ? 'furusato-life-fields' : def.reference ? 'furusato-reference-fields' : def.auto ? 'furusato-auto-fields' : 'furusato-input-fields';
			const modes = [...(def.auto ? [['auto', '自動計算']] : []), ...(field === 'donation' ? [['legacy', '従来の名称・タグ判定']] : []), ['ledger', '費目・内訳から集計'], ['manual', '年額を手入力']];
			el(target).insertAdjacentHTML('beforeend', `<div class="tax-field" role="group" aria-labelledby="tax-field-${field}"><h4 id="tax-field-${field}">${escapeHtml(def.label)}</h4><label for="furusato-mode-${field}">採用方法</label><select id="furusato-mode-${field}" class="form-control">${modes.map(([v, label]) => `<option value="${v}">${escapeHtml(label)}</option>`).join('')}</select><label>費目・内訳（複数選択可）<select id="furusato-source-${field}" class="form-control" multiple size="3"></select></label><label>手入力年額（円）<input id="furusato-manual-${field}" class="form-control" type="number" step="1" ${field === 'other_gap' ? '' : 'min="0"'}></label><div id="furusato-value-${field}" class="tax-adopted-value"></div></div>`);
		}
		el('tab-tax').addEventListener('input', event => this.edited(event));
		el('tab-tax').addEventListener('change', event => this.edited(event));
		el('furusato-confirm-ledger').addEventListener('change', () => this.confirmLedger());
		el('furusato-donation-year').addEventListener('change', () => {
			const year = Number(el('furusato-donation-year').value);
			if (Number.isInteger(year) && year >= 1900 && year <= 9999) { this.coordinator.selectedYear = String(year); void this.render(); }
		});
		el('btn-save-furusato').addEventListener('click', () => this.saveFurusato());
		el('btn-save-furusato-sources').addEventListener('click', () => this.saveFurusatoSources());
		el('btn-open-tax').addEventListener('click', () => document.querySelector('[data-tab="tab-tax"]').dispatchEvent(new Event('click')));
	}
	edited(event) {
		const id = event.target.id;
		if (this.taxBusy || !id || id === 'furusato-donation-year' || id === 'furusato-confirm-ledger' || event.target.tagName === 'BUTTON') return;
		if (['furusato-resident-tax', 'furusato-tax-rate'].includes(id)) { this.taxDirty = true; return; }
		this.sourceDirty = true; this.editVersion++;
		if (id.startsWith('furusato-manual-')) el(id.replace('manual', 'mode')).value = 'manual';
		if (id.startsWith('furusato-source-')) el(id.replace('source', 'mode')).value = 'ledger';
		if (id === 'furusato-base-year' || id.startsWith('furusato-source-') || id.startsWith('furusato-mode-') || id === 'furusato-life-enabled') this.clearConfirmation();
		this.preview();
	}
	clearConfirmation() { this.editVersion++; this.confirmationToken = null; el('furusato-confirm-ledger').checked = false; }
	fingerprint(transactions, config, year) { return getFurusatoLedgerFingerprint(transactions, config, year); }
	async confirmLedger() {
		if (this.taxBusy || !this.state) return;
		this.sourceDirty = true;
		if (!el('furusato-confirm-ledger').checked) { this.clearConfirmation(); this.preview(); return; }
		const generation = this.generation, edit = ++this.editVersion, key = this.db.encryptionKey, year = this.sourceDraft?.year;
		try {
			const config = this.draftConfig(), token = await this.fingerprint(this.state.transactions, config, year);
			if (generation !== this.generation || edit !== this.editVersion || key !== this.db.encryptionKey || this.coordinator.isKeyLocked) return;
			this.confirmationToken = token; this.currentFingerprint = token; this.sourceDirty = true; this.preview();
		} catch (error) { if (generation === this.generation && edit === this.editVersion) { this.clearConfirmation(); el('furusato-error').textContent = error.message; } }
	}
	readSources() {
		return Object.fromEntries(Object.keys(FURUSATO_FIELDS).map(field => [field, [...el(`furusato-source-${field}`).selectedOptions].map(o => JSON.parse(o.value))]));
	}
	readSetting() {
		const setting = { mode: el('furusato-calculation-mode').value, base_year: Number(el('furusato-base-year').value), tax_status: el('furusato-tax-status').value,
			input_modes: {}, manual: {}, life_enabled: el('furusato-life-enabled').checked, young_dependent: el('furusato-young-dependent').checked,
			housing: { enabled: el('furusato-housing-enabled').checked, applicable: el('furusato-housing-applicable').checked, first_year: el('furusato-housing-first_year').checked, method: el('furusato-housing-method').value, rate: Number(el('furusato-housing-rate').value), carry_rate: Number(el('furusato-housing-carry').value), carry_limit: el('furusato-housing-carry').value === '7' ? 136500 : 97500 } };
		for (const field of Object.keys(FURUSATO_FIELDS)) {
			setting.input_modes[field] = el(`furusato-mode-${field}`).value;
			const value = el(`furusato-manual-${field}`).value; if (value !== '') setting.manual[field] = Number(value);
		}
		for (const field of ['balance', 'price', 'limit']) if (el(`furusato-housing-${field}`).value !== '') setting.housing[field] = Number(el(`furusato-housing-${field}`).value);
		if (this.confirmationToken && el('furusato-confirm-ledger').checked) setting['ledger_confirmation'] = this.confirmationToken;
		return setting;
	}
	draftConfig() {
		const config = structuredClone(this.sourceDraft.config), year = this.sourceDraft.year;
		config.annual_budgets ||= {}; config.annual_budgets[year] = { ...config.annual_budgets[year], furusato_sources: this.readSources(), furusato_calculation: this.readSetting() };
		return config;
	}
	populateSources(config, sources) {
		for (const [field, def] of Object.entries(FURUSATO_FIELDS)) {
			const choices = (config.categories || []).filter(c => c.type === def.type).flatMap(c => [{ category_id: c.id, subcategory_id: null, name: `${c.name}（全体）` }, ...(c.subcategories || []).map(s => ({ category_id: c.id, subcategory_id: s.id, name: `${c.name} / ${s.name}` }))]);
			el(`furusato-source-${field}`).innerHTML = choices.map(choice => `<option value="${escapeHtml(JSON.stringify({ category_id: choice.category_id, subcategory_id: choice.subcategory_id }))}" ${sources[field]?.some(s => s.category_id === choice.category_id && s.subcategory_id === choice.subcategory_id) ? 'selected' : ''}>${escapeHtml(choice.name)}</option>`).join('');
		}
	}
	loadSetting(config, year) {
		const setting = getFurusatoSetting(config, year), sources = config.annual_budgets?.[year]?.furusato_sources || {};
		this.populateSources(config, sources); this.confirmationToken = setting.ledger_confirmation === this.currentFingerprint ? setting.ledger_confirmation : null;
		el('furusato-calculation-mode').value = setting.mode; el('furusato-base-year').value = String(setting.base_year); el('furusato-tax-status').value = setting.tax_status;
		el('furusato-life-enabled').checked = setting.life_enabled; el('furusato-young-dependent').checked = setting.young_dependent;
		for (const field of Object.keys(FURUSATO_FIELDS)) { el(`furusato-mode-${field}`).value = getFurusatoInputMode(field, setting, sources); el(`furusato-manual-${field}`).value = setting.manual[field] ?? ''; }
		const housing = { applicable: true, first_year: false, method: 'one_stop', rate: .7, carry_rate: 5, ...setting.housing };
		for (const field of ['enabled', 'applicable', 'first_year']) el(`furusato-housing-${field}`).checked = housing[field];
		for (const field of ['balance', 'price', 'limit', 'rate', 'method']) el(`furusato-housing-${field}`).value = housing[field] ?? '';
		el('furusato-housing-carry').value = housing.carry_rate;
		el('furusato-confirm-ledger').checked = Boolean(this.confirmationToken);
	}
	async render(state = null, { isSessionValid = null } = {}) {
		const sessionValid = captureRenderSession(this.coordinator, isSessionValid);
		if (!sessionValid()) return;
		const render = ++this.renderVersion, generation = this.generation, key = this.db.encryptionKey, year = String(this.coordinator.selectedYear);
		const valid = () => sessionValid() && render === this.renderVersion && generation === this.generation && key === this.db.encryptionKey && !this.coordinator.isKeyLocked && year === String(this.coordinator.selectedYear);
		if (this.coordinator.isKeyLocked) return;
		try {
			state ||= await this.db.getAnalyticsState();
			if (!valid()) return;
			const fingerprint = await this.fingerprint(state.transactions, state.master_config, year);
			if (!valid()) return;
			const edit = this.editVersion;
			const draftFingerprint = this.sourceDirty && this.sourceDraft?.year === year ? await this.fingerprint(state.transactions, this.draftConfig(), year) : fingerprint;
			if (!valid() || edit !== this.editVersion) return;
			this.state = state; this.currentFingerprint = draftFingerprint;
			const calculation = calculateFurusatoFromLedger(state.transactions, state.master_config, year, { ledgerFingerprint: fingerprint });
			this.renderSummary(state.transactions, state.master_config, year, calculation);
			const changedYear = this.sourceDraft?.year !== year;
			if (changedYear) { if (this.sourceDraft) { this.generation++; this.setFormBusy(false); } this.editVersion++; this.sourceDirty = false; this.taxDirty = false; }
			if (!this.taxDirty) {
				this.taxDraft = { year, config: structuredClone(state.master_config) };
				const notice = state.master_config.annual_budgets?.[year]?.furusato_estimate;
				el('furusato-resident-tax').value = notice?.resident_tax ?? ''; el('furusato-tax-rate').value = notice?.income_tax_rate ?? '';
			}
			if (!this.sourceDirty) { this.sourceDraft = { year, config: structuredClone(state.master_config) }; this.loadSetting(state.master_config, year); }
			else if (this.confirmationToken !== draftFingerprint) this.clearConfirmation();
			el('furusato-donation-year').value = year;
			this.preview(); this.setFormBusy(this.taxBusy);
		} catch (error) { if (valid()) el('furusato-error').textContent = `税・控除を取得できませんでした: ${error.message}`; }
	}
	renderSummary(transactions, config, year, calculation) {
		const summary = buildFurusatoSummary(transactions, config, year, { calculation });
		el('furusato-card').style.display = this.coordinator.analyticsTarget === 'budget' && (summary.records.length || summary.confirmed) ? 'block' : 'none';
		const text = `${year}年 確定寄附 ${yen(summary.confirmed)} / 予定 ${yen(summary.planned)} / 金額未入力 ${summary.pending}件 / 概算上限 ${yen(summary.limit)} / ${summary.remaining !== null && summary.remaining < 0 ? '超過額 ' + yen(-summary.remaining) : '残り ' + yen(summary.remaining)} / ${Number(year) - 1}年の取得済み確定収入 ${summary.previousCount}件・合計 ${yen(summary.previousIncome)}`;
		el('furusato-summary').textContent = text;
		el('furusato-tax-summary').innerHTML = resultList([
			['概算上限', yen(summary.limit)], ['確定寄附', yen(summary.confirmed)],
			[summary.remaining !== null && summary.remaining < 0 ? '超過額' : '残り', yen(summary.remaining !== null && summary.remaining < 0 ? -summary.remaining : summary.remaining)]
		]) + `<p class="tax-help">${escapeHtml(`${year}年 / 予定 ${yen(summary.planned)} / 金額未入力 ${summary.pending}件 / ${Number(year) - 1}年の取得済み確定収入 ${summary.previousCount}件・合計 ${yen(summary.previousIncome)}`)}</p>`;
		el('furusato-records').innerHTML = `<table class="summary-table"><caption>${year}年の取得済み寄附一覧</caption><thead><tr><th>取引日</th><th>メモ</th><th>状態</th><th>金額</th></tr></thead><tbody>${summary.records.map(tx => `<tr><td>${escapeHtml(tx.date)}</td><td>${escapeHtml(tx.memo || '')}</td><td>${tx.status === 'confirmed' ? '確定' : '予定'}</td><td>${tx.amount_pending ? '金額未入力' : yen(tx.amount)}</td></tr>`).join('')}</tbody></table>`;
	}
	preview() {
		if (!this.sourceDraft || !this.state || this.coordinator.isKeyLocked) return;
		const year = this.sourceDraft.year, config = this.draftConfig(), result = calculateFurusatoFromLedger(this.state.transactions, config, year, { ledgerFingerprint: this.currentFingerprint });
		el('furusato-life-fields').hidden = !el('furusato-life-enabled').checked;
		el('furusato-housing-fields').hidden = !el('furusato-housing-enabled').checked;
		for (const field of Object.keys(FURUSATO_FIELDS)) el(`furusato-value-${field}`).textContent = '';
		for (const [field, value] of Object.entries(result.values)) el(`furusato-value-${field}`).textContent = `採用額 ${yen(value.amount)}${value.source === 'ledger' ? ` / ${value.count}件` : ''}`;
		const missing = [...result.missing, ...(result.progressMissing || [])];
		el('furusato-calculation-preview').innerHTML = resultList([
			['概算上限', yen(result.limit)], ['住民税課税所得', yen(result.residentTaxable)], ['所得税課税所得', yen(result.incomeTaxable)],
			['調整控除後所得割', yen(result.residentTax)], ['特例税率', result.rate == null ? '未算出' : `${result.rate}%`],
			['生命保険料控除（住民税）', yen(result.life?.resident)], ['生命保険料控除（所得税）', yen(result.life?.income)],
			['住宅ローン控除見込', yen(result.housing?.potential)], ['住宅の住民税移行見込', yen(result.housing?.carry)],
			['寄附後の参考自己負担', yen(result.housing?.selfCost)], ['併用前上限', yen(result.baseLimit)]
		]) + (missing.length ? `<p class="tax-missing">不足項目: ${escapeHtml(missing.join('、'))}</p>` : '');
		const data = buildFurusatoLedgerSummary(this.state.transactions, config, year);
		el('furusato-ledger-summary').innerHTML = `<div class="tax-table-scroll"><table class="summary-table"><caption>取得済み明細の参考集計</caption><thead><tr><th>項目</th><th>前年（件数）</th><th>当年（件数）</th></tr></thead><tbody>${Object.entries(FURUSATO_FIELDS).map(([field, def]) => `<tr><th scope="row">${escapeHtml(def.label)}</th><td>${escapeHtml(yen(data[field].previous.amount))} / ${data[field].previous.count}件</td><td>${escapeHtml(yen(data[field].current.amount))} / ${data[field].current.count}件</td></tr>`).join('')}</tbody></table></div>`;
	}
	setFormBusy(busy) {
		this.taxBusy = busy;
		for (const control of document.querySelectorAll('#tab-tax input,#tab-tax select,#tab-tax button')) /** @type {HTMLInputElement} */ (control).disabled = busy;
	}
	saveFurusatoSources() { return this.save(false); }
	saveFurusato() { return this.save(true); }
	async save(notice) {
		const draft = notice ? this.taxDraft : this.sourceDraft;
		if (this.taxBusy || !draft || this.coordinator.isKeyLocked) return;
		const generation = this.generation, key = this.db.encryptionKey;
		const valid = () => generation === this.generation && key === this.db.encryptionKey && !this.coordinator.isKeyLocked;
		this.setFormBusy(true); let committed = false;
		try {
			const config = notice ? structuredClone(draft.config) : this.draftConfig(), baseline = structuredClone(draft.config);
			const current = await this.db.getMasterConfig();
			if (!valid()) return;
			const currentCalc = current.annual_budgets?.[draft.year]?.furusato_calculation;
			if (notice && currentCalc) {
				baseline.annual_budgets ||= {}; baseline.annual_budgets[draft.year] ||= {};
				baseline.annual_budgets[draft.year].furusato_calculation = structuredClone(currentCalc);
				config.annual_budgets ||= {}; config.annual_budgets[draft.year] ||= {};
				config.annual_budgets[draft.year].furusato_calculation = structuredClone(currentCalc);
			} else if (!notice && currentCalc && baseline.annual_budgets[draft.year].furusato_calculation) baseline.annual_budgets[draft.year].furusato_calculation.mode = currentCalc.mode;
			if (notice) {
				const amount = el('furusato-resident-tax').value, rate = el('furusato-tax-rate').value;
				if (amount === '' || rate === '') throw new Error('所得割額と特例控除用税率を入力してください。');
				const input = { resident_tax: Number(amount), income_tax_rate: Number(rate) };
				if (estimateFurusatoLimit(input, draft.year) === null) throw new Error('通知書の概算は2015〜2037年の税制に対応しています。');
				config.annual_budgets ||= {}; const annual = config.annual_budgets[draft.year] ||= {};
				annual.furusato_estimate = input;
				if (annual.furusato_calculation) annual.furusato_calculation.mode = 'notice';
			}
			await this.db.saveMasterConfig(config, { expectedConfig: baseline, isSessionValid: valid }); committed = true;
			if (!valid()) return;
			if (notice && this.taxDraft === draft) this.taxDirty = false;
			if (!notice && this.sourceDraft === draft) this.sourceDirty = false;
			el('furusato-error').textContent = ''; this.coordinator.showToast('税・控除の設定を保存しました。');
			void this.coordinator.syncManager?.queueMasterSync();
			await this.coordinator.refreshAllViews();
		} catch (error) { if (valid()) el('furusato-error').textContent = `${committed ? '保存済みです。表示を更新してください。' : ''}${error.message}`; }
		finally { if (valid()) this.setFormBusy(false); }
	}
	cancel() {
		this.generation++; this.renderVersion++; this.editVersion++; this.taxDraft = null; this.sourceDraft = null; this.state = null;
		this.taxDirty = false; this.sourceDirty = false; this.currentFingerprint = null; this.clearConfirmation(); this.setFormBusy(false);
		for (const control of document.querySelectorAll('#tab-tax input,#tab-tax select')) {
			const input = /** @type {HTMLInputElement & HTMLSelectElement} */ (control); input.value = ''; input.checked = false;
			if (input.multiple) input.replaceChildren();
		}
		for (const id of ['furusato-summary', 'furusato-tax-summary', 'furusato-records', 'furusato-ledger-summary', 'furusato-calculation-preview', 'furusato-error', ...Object.keys(FURUSATO_FIELDS).map(field => `furusato-value-${field}`)]) el(id)?.replaceChildren();
	}
}
