import { escapeHtml } from '../logic.js';
import { archivedMasterSources, buildMasterMigration, findArchivedReferences } from '../logic/master_maintenance.js';

/** Infrequent, explicit maintenance of already downloaded archived references. */
export class MaintenanceController {
	constructor(coordinator) {
		this.coordinator = coordinator;
		this.records = [];
		this.config = null;
		this.busy = false;
	}

	setup() {
		if (document.getElementById('maintenance-panel')) return;
		const panel = document.createElement('details');
		panel.id = 'maintenance-panel';
		panel.className = 'card';
		panel.innerHTML = `<summary>アーカイブ設定の明細メンテナンス</summary>
			<p id="maintenance-scope">取得済み明細が対象である。過去分を含める場合は先に差分同期を実行する。</p>
			<p>明細の設定参照を移行する。口座初期残高と定期ルールは対象外である。</p>
			<button type="button" id="btn-refresh-maintenance" class="btn btn-secondary">一覧を更新</button>
			<div class="form-group"><label class="form-label" for="maintenance-source">移行元（アーカイブ済みである）</label><select class="form-control" id="maintenance-source"></select></div>
			<div class="form-group"><label class="form-label" for="maintenance-target">移行先（有効な設定である）</label><select class="form-control" id="maintenance-target"></select></div>
			<div class="form-group" id="maintenance-subcategory-group"><label class="form-label" for="maintenance-subcategory">移行先中項目（選択費目の配下である）</label><select class="form-control" id="maintenance-subcategory"></select></div>
			<p id="maintenance-count" role="status"></p>
			<button type="button" id="btn-migrate-maintenance" class="btn btn-primary">対象明細を一括移行</button>
			<div id="maintenance-records" class="table-container"></div>`;
		document.getElementById('tab-settings')?.append(panel);
		panel.addEventListener('toggle', () => { if (panel.open) this.refresh().catch(error => this.report(error)); });
		document.getElementById('btn-refresh-maintenance').addEventListener('click', () => this.refresh().catch(error => this.report(error)));
		document.getElementById('maintenance-source').addEventListener('change', () => this.populateTargets());
		document.getElementById('maintenance-target').addEventListener('change', () => this.populateChildren());
		document.getElementById('maintenance-subcategory').addEventListener('change', () => this.updateCount());
		document.getElementById('btn-migrate-maintenance').addEventListener('click', () => this.migrate());
	}

	report(error) { alert(`移行処理を完了できませんでした: ${error.message}`); }

	sourceKey(source) { return [source.kind, source.parentId, source.id].filter(Boolean).map(encodeURIComponent).join(':'); }

	selectedSource() {
		const value = document.getElementById('maintenance-source').value;
		return archivedMasterSources(this.config).find(source => this.sourceKey(source) === value);
	}

	selectedTarget() {
		return { id: document.getElementById('maintenance-target').value, subcategoryId: document.getElementById('maintenance-subcategory').value || null };
	}

	async refresh() {
		this.setup();
		if (!document.querySelector('details#maintenance-panel')?.hasAttribute('open') || this.busy) return;
		const db = this.coordinator.db;
		const [config, records, months] = await Promise.all([db.getMasterConfig(), db.getTransactions(), db.getSetting('downloaded_archive_months', [])]);
		this.config = config;
		this.records = records;
		const source = /** @type {HTMLSelectElement} */ (document.getElementById('maintenance-source'));
		const previous = source.value;
		source.innerHTML = archivedMasterSources(config).map(item => `<option value="${escapeHtml(this.sourceKey(item))}">${escapeHtml(item.label)}</option>`).join('');
		if ([...source.options].some(option => option.value === previous)) source.value = previous;
		document.getElementById('maintenance-scope').textContent = `取得済み明細 ${records.length}件が対象である。取得済みアーカイブ月: ${months.length ? months.join('、') : 'なし'}。未取得過去を含める場合は先に差分同期を実行する。`;
		const affected = findArchivedReferences(records, config);
		document.getElementById('maintenance-records').innerHTML = affected.length ? `<table><thead><tr><th>日付</th><th>メモ</th><th>金額</th><th>アーカイブ設定</th></tr></thead><tbody>${affected.map(record => `<tr><td>${escapeHtml(record.date)}</td><td>${escapeHtml(record.memo || record.id)}</td><td>${escapeHtml(record.amount_pending ? '金額未入力' : String(record.amount))}</td><td>${escapeHtml(record.archived_labels.join('、'))}</td></tr>`).join('')}</tbody></table>` : '<p>アーカイブ設定を参照する取得済み明細はない。</p>';
		this.populateTargets();
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
		const category = this.config.categories?.find(item => item.id === document.getElementById('maintenance-target').value);
		const children = source?.kind !== 'account' ? (category?.subcategories || []).filter(item => !item.is_archived) : [];
		select.innerHTML = '<option value="">中項目の指定はなしである</option>' + children.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
		document.getElementById('maintenance-subcategory-group').hidden = source?.kind === 'account';
		this.updateCount();
	}

	updateCount() {
		let count = 0;
		let message = '移行可能な対象明細はない。';
		try {
			const source = this.selectedSource();
			if (source) count = buildMasterMigration(this.records, this.config, source, this.selectedTarget()).length;
		} catch (error) { message = error.message; }
		document.getElementById('maintenance-count').textContent = count ? `移行対象は${count}件である。` : message;
		document.getElementById('btn-migrate-maintenance').disabled = !count || this.busy;
	}

	async migrate() {
		if (this.busy) return;
		this.busy = true;
		document.getElementById('btn-migrate-maintenance').disabled = true;
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
			await this.refresh();
		}
	}
}
