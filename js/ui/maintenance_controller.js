import { escapeHtml } from '../logic.js';
import { referencedArchivedMasterSources, buildMasterMigration, findArchivedReferences } from '../logic/master_maintenance.js';

/** Infrequent, explicit maintenance of already downloaded archived references. */
export class MaintenanceController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.records = [];
		this.config = null;
		this.busy = false;
		this.loading = false;
		this.refreshGeneration = 0;
		this.sources = [];
	}

	setup() {
		if (document.getElementById('maintenance-panel')) return;
		const panel = document.createElement('details');
		panel.id = 'maintenance-panel';
		panel.className = 'card';
		panel.innerHTML = `<summary>アーカイブ設定の明細メンテナンス</summary>
			<p id="maintenance-scope">取得済み明細が対象です。過去分を含める場合は先に差分同期を実行してください。</p>
			<p>明細の設定参照を移行します。口座初期残高と定期ルールは対象外です。</p>
			<button type="button" id="btn-refresh-maintenance" class="btn btn-secondary">一覧を更新</button>
			<p id="maintenance-refresh-status" role="status"></p>
			<div class="form-group"><label class="form-label" for="maintenance-source">移行元（アーカイブ済みです）</label><select class="form-control" id="maintenance-source"></select></div>
			<div class="form-group"><label class="form-label" for="maintenance-target">移行先（有効な設定です）</label><select class="form-control" id="maintenance-target"></select></div>
			<div class="form-group" id="maintenance-subcategory-group"><label class="form-label" for="maintenance-subcategory">移行先中項目（選択費目の配下です）</label><select class="form-control" id="maintenance-subcategory"></select></div>
			<p id="maintenance-count" role="status"></p>
			<button type="button" id="btn-migrate-maintenance" class="btn btn-primary">対象明細を一括移行</button>
			<div id="maintenance-records" class="table-container"></div>`;
		document.getElementById('tab-settings')?.append(panel);
		panel.addEventListener('toggle', () => { if (panel.open) this.refresh().catch(error => this.report(error, '一覧更新')); });
		document.getElementById('btn-refresh-maintenance').addEventListener('click', () => this.refresh().catch(error => this.report(error, '一覧更新')));
		document.getElementById('maintenance-source').addEventListener('change', () => this.populateTargets());
		document.getElementById('maintenance-target').addEventListener('change', () => this.populateChildren());
		document.getElementById('maintenance-subcategory').addEventListener('change', () => this.updateCount());
		document.getElementById('btn-migrate-maintenance').addEventListener('click', () => this.migrate());
	}

	report(error, action = '移行処理') { alert(`${action}を完了できませんでした: ${error.message}`); }

	sourceKey(source) { return [source.kind, source.parentId, source.id].filter(Boolean).map(encodeURIComponent).join(':'); }

	selectedSource() {
		const value = document.getElementById('maintenance-source').value;
		return this.sources.find(source => this.sourceKey(source) === value);
	}

	selectedTarget() {
		return { id: document.getElementById('maintenance-target').value, subcategoryId: document.getElementById('maintenance-subcategory').value || null };
	}

	updateControls() {
		const disabled = this.busy || this.loading;
		for (const id of ['maintenance-source', 'maintenance-target', 'maintenance-subcategory']) document.getElementById(id).disabled = disabled;
		const refresh = document.getElementById('btn-refresh-maintenance');
		refresh.disabled = this.busy;
		refresh.textContent = this.loading ? '一覧を更新中…' : '一覧を更新';
		document.getElementById('maintenance-records').setAttribute('aria-busy', String(this.loading));
		this.updateCount();
	}

	async refresh() {
		this.setup();
		if (!document.querySelector('details#maintenance-panel')?.hasAttribute('open') || this.busy) return;
		const generation = ++this.refreshGeneration;
		this.loading = true;
		document.getElementById('maintenance-refresh-status').textContent = '一覧を更新しています。';
		this.updateControls();
		try {
			const db = this.coordinator.db;
			const [config, records, months] = await Promise.all([db.getMasterConfig(), db.getTransactions(), db.getSetting('downloaded_archive_months', [])]);
			if (generation !== this.refreshGeneration) return;
			this.config = config;
			this.records = records;
			this.sources = referencedArchivedMasterSources(config, records);
			const source = /** @type {HTMLSelectElement} */ (document.getElementById('maintenance-source'));
			const previous = source.value;
			source.innerHTML = this.sources.map(item => `<option value="${escapeHtml(this.sourceKey(item))}">${escapeHtml(item.label)}（${item.count}件）</option>`).join('');
			if ([...source.options].some(option => option.value === previous)) source.value = previous;
			document.getElementById('maintenance-scope').textContent = `取得済み明細 ${records.length}件が対象です。取得済みアーカイブ月: ${months.length ? months.join('、') : 'なし'}。未取得の過去分を含める場合は先に差分同期を実行してください。`;
			this.populateTargets();
			document.getElementById('maintenance-refresh-status').textContent = '一覧を更新しました。';
		} catch (error) {
			if (generation === this.refreshGeneration) {
				document.getElementById('maintenance-refresh-status').textContent = '一覧を更新できませんでした。再実行してください。';
				throw error;
			}
		} finally {
			if (generation === this.refreshGeneration) {
				this.loading = false;
				this.updateControls();
			}
		}
	}

	renderRecords() {
		const source = this.selectedSource();
		const affected = source ? findArchivedReferences(this.records, this.config, source) : [];
		document.getElementById('maintenance-records').innerHTML = affected.length ? `<table><thead><tr><th>日付</th><th>メモ</th><th>金額</th><th>アーカイブ設定</th></tr></thead><tbody>${affected.map(record => `<tr><td>${escapeHtml(record.date)}</td><td>${escapeHtml(record.memo || record.id)}</td><td>${escapeHtml(record.amount_pending ? '金額未入力' : String(record.amount))}</td><td>${escapeHtml(record.archived_labels.join('、'))}</td></tr>`).join('')}</tbody></table>` : '<p>アーカイブ設定を参照する取得済み明細はありません。</p>';
	}

	populateTargets() {
		const source = this.selectedSource();
		const target = document.getElementById('maintenance-target');
		const previous = target.value;
		let options = [];
		if (source?.kind === 'account') {
			const origin = this.config.accounts.find(item => item.id === source.id);
			options = this.config.accounts.filter(item => !item.is_archived && item.type === origin.type && Boolean(item.is_asset) === Boolean(origin.is_asset));
		} else if (source) {
			const origin = this.config.categories.find(item => item.id === (source.parentId || source.id));
			options = this.config.categories.filter(item => !item.is_archived && (item.type || 'expense') === (origin.type || 'expense'));
		}
		target.innerHTML = options.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
		if (options.some(item => item.id === previous)) target.value = previous;
		this.populateChildren();
	}

	populateChildren() {
		const source = this.selectedSource();
		const select = document.getElementById('maintenance-subcategory');
		const previous = select.value;
		const category = this.config.categories?.find(item => item.id === document.getElementById('maintenance-target').value);
		const children = source?.kind !== 'account' ? (category?.subcategories || []).filter(item => !item.is_archived) : [];
		select.innerHTML = '<option value="">（指定なし / 費目のみ）</option>' + children.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
		if (children.some(item => item.id === previous)) select.value = previous;
		document.getElementById('maintenance-subcategory-group').hidden = source?.kind === 'account';
		this.updateCount();
	}

	updateCount() {
		let count = 0;
		let message = '移行可能な対象明細はありません。';
		try {
			const source = this.selectedSource();
			if (source) count = buildMasterMigration(this.records, this.config, source, this.selectedTarget()).length;
		} catch (error) { message = error.message; }
		document.getElementById('maintenance-count').textContent = count ? `移行対象は${count}件です。` : message;
		document.getElementById('btn-migrate-maintenance').disabled = !count || this.busy || this.loading;
		this.renderRecords();
	}

	async migrate() {
		if (this.busy || this.loading) return;
		this.busy = true;
		this.updateControls();
		try {
			const source = this.selectedSource();
			const target = this.selectedTarget();
			const config = this.config;
			const records = this.records;
			const planned = buildMasterMigration(records, config, source, target);
			if (!planned.length) return;
			const destination = (/** @type {HTMLSelectElement} */ (document.getElementById('maintenance-target'))).selectedOptions[0].textContent;
			const child = (/** @type {HTMLSelectElement} */ (document.getElementById('maintenance-subcategory'))).selectedOptions[0]?.textContent;
			if (!confirm(`${source.label}を参照する${planned.length}件を「${destination}${target.subcategoryId ? ` > ${child}` : ''}」へ移行しますか？\n明細の金額・メモと関連グループは保持します。`)) return;
			const originals = records.filter(record => planned.some(item => item.id === record.id));
			const approved = await this.coordinator.approveClosedChanges(planned, originals);
			if (approved === null) return;
			const changed = await this.coordinator.db.migrateArchivedMaster(source, target, records, config, approved);
			alert(`${changed.length}件の明細を移行しました。通信未完了の変更は端末内に保持され、差分同期で反映されます。`);
			await this.coordinator.refreshAllViews();
			this.coordinator.syncManager?.syncPendingDiffs().catch(() => this.coordinator.showToast('同期できませんでした。移行内容は端末内に保持しています。'));
		} catch (error) { this.report(error); }
		finally {
			this.busy = false;
			this.updateControls();
			await this.refresh().catch(error => this.report(error, '一覧更新'));
		}
	}
}
