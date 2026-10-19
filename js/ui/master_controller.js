/**
 * Yoseatsume Kakeibo - Master Data Controller
 * Manages Master Data settings, CRUD modals (Accounts, Categories, Recurring Rules, Holidays, Assets), and GAS sync.
 */

import {
	formatDate,
	JAPANESE_HOLIDAYS_PRESET,
	parseHolidayTextOrCsv,
	groupHolidaysByYear,
	syncInsuranceRecurringRule,
	escapeHtml
} from '../logic.js';

export class MasterController {
	constructor(coordinator) {
		this.coordinator = coordinator;
	}

	get db() {
		return this.coordinator.db;
	}

	get syncManager() {
		return this.coordinator.syncManager;
	}

	setupMasterTabs() {
		const tabBtns = document.querySelectorAll('.master-tab-btn');
		const panels = document.querySelectorAll('.master-panel');

		tabBtns.forEach(btn => {
			btn.addEventListener('click', () => {
				const masterType = btn.dataset.master;
				tabBtns.forEach(b => b.classList.remove('active'));
				panels.forEach(p => p.classList.remove('active'));

				btn.classList.add('active');
				const panel = document.getElementById(`panel-master-${masterType}`);
				if (panel) panel.classList.add('active');
			});
		});

		document.getElementById('btn-close-master-modal')?.addEventListener('click', () => {
			document.getElementById('modal-master-item')?.classList.remove('active');
		});

		document.getElementById('btn-add-account')?.addEventListener('click', () => {
			this.openMasterModal('account', null);
		});

		document.getElementById('btn-add-category')?.addEventListener('click', () => {
			this.openMasterModal('category', null);
		});

		document.getElementById('btn-add-recurring')?.addEventListener('click', () => {
			this.openMasterModal('recurring', null);
		});

		document.getElementById('btn-add-holiday')?.addEventListener('click', async () => {
			const input = document.getElementById('input-new-holiday');
			const val = input?.value;
			if (!val) {
				alert('祝日の日付を選択してください');
				return;
			}
			const config = await this.db.getMasterConfig();
			config.holidays = config.holidays || [];
			if (!config.holidays.includes(val)) {
				config.holidays.push(val);
				config.holidays.sort();
				await this.saveMasterConfigAndSync(config);
				if (input) input.value = '';
			} else {
				alert('指定された日付は既に祝日に登録されています');
			}
		});

		// Preset Japanese Holidays Import
		document.getElementById('btn-import-holidays-preset')?.addEventListener('click', async () => {
			const config = await this.db.getMasterConfig();
			config.holidays = config.holidays || [];
			const beforeCount = config.holidays.length;
			const set = new Set([...config.holidays, ...JAPANESE_HOLIDAYS_PRESET]);
			config.holidays = Array.from(set).sort();
			const addedCount = config.holidays.length - beforeCount;
			await this.saveMasterConfigAndSync(config);
			alert(`公式祝日プリセットから ${addedCount} 件の祝日を登録しました（合計: ${config.holidays.length} 件）`);
		});

		// Open/Close Holiday Modal
		document.getElementById('btn-open-holiday-modal')?.addEventListener('click', () => {
			document.getElementById('modal-holiday-import')?.classList.add('active');
		});

		document.getElementById('btn-close-holiday-modal')?.addEventListener('click', () => {
			document.getElementById('modal-holiday-import')?.classList.remove('active');
		});

		// Fetch from Online Holiday API
		document.getElementById('btn-fetch-holiday-api')?.addEventListener('click', async () => {
			const btn = document.getElementById('btn-fetch-holiday-api');
			if (btn) btn.textContent = '取得中...';
			try {
				const res = await fetch('https://holidays-jp.github.io/api/v1/date.json');
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const data = await res.json();
				const txt = document.getElementById('txt-holiday-import-input');
				if (txt) {
					txt.value = JSON.stringify(data, null, 2);
				}
				alert('祝日APIから最新データを取得しました。「インポート実行」を押して反映してください。');
			} catch (err) {
				alert(`祝日取得エラー: ${err.message} (オフライン時はプリセットインポートをご利用ください)`);
			} finally {
				if (btn) btn.textContent = '🌐 オンラインAPIから最新祝日を取得';
			}
		});

		// Confirm Holiday Import from Textarea
		document.getElementById('btn-confirm-import-holidays')?.addEventListener('click', async () => {
			const txt = document.getElementById('txt-holiday-import-input');
			const raw = txt?.value || '';
			const parsed = parseHolidayTextOrCsv(raw);
			if (parsed.length === 0) {
				alert('有効な日付が見つかりませんでした (形式例: 2026-01-01 または 2026/01/01)');
				return;
			}
			const config = await this.db.getMasterConfig();
			config.holidays = config.holidays || [];
			const beforeCount = config.holidays.length;
			const set = new Set([...config.holidays, ...parsed]);
			config.holidays = Array.from(set).sort();
			const addedCount = config.holidays.length - beforeCount;
			await this.saveMasterConfigAndSync(config);
			document.getElementById('modal-holiday-import')?.classList.remove('active');
			if (txt) txt.value = '';
			alert(`${parsed.length} 件の日付から新規に ${addedCount} 件の祝日を登録しました（合計: ${config.holidays.length} 件）`);
		});
	}

	async saveMasterConfigAndSync(config) {
		await this.db.saveMasterConfig(config);
		if (this.syncManager?.gasUrl && this.syncManager?.privateKey) {
			try {
				await this.syncManager.sendAction('update_master', { master_config: config });
			} catch (err) {
				console.warn('Sync master config to GAS deferred:', err.message);
			}
		}
		await this.coordinator.refreshAllViews();
	}

	async renderMasterManagement() {
		const config = await this.db.getMasterConfig();
		if (!config) return;

		// 1. Accounts
		const accList = document.getElementById('master-accounts-list');
		if (accList) {
			const accounts = config.accounts || [];
			accList.innerHTML = accounts.map(a => `
				<div class="master-item-row ${a.is_archived ? 'archived' : ''}">
					<div>
						<div style="font-weight: 600;">
							${escapeHtml(a.name)}
							<span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 6px;">(${escapeHtml(a.id)})</span>
							${a.is_archived ? '<span class="badge badge-warning" style="margin-left: 6px;">アーカイブ</span>' : ''}
						</div>
						<div style="font-size: 0.8rem; color: var(--text-muted);">
							種別: ${escapeHtml(a.type)} | 初期残高: ¥${(a.initial_balance || 0).toLocaleString()}
						</div>
					</div>
					<div style="display: flex; gap: 6px;">
						<button class="btn btn-secondary btn-sm btn-edit-account" data-id="${a.id}">編集</button>
						<button class="btn btn-secondary btn-sm btn-archive-account" data-id="${a.id}">
							${a.is_archived ? '復元' : 'アーカイブ'}
						</button>
					</div>
				</div>
			`).join('') || '<div style="color: var(--text-muted); padding: 8px;">口座が登録されていません</div>';

			accList.querySelectorAll('.btn-edit-account').forEach(btn => {
				btn.addEventListener('click', () => {
					const acc = accounts.find(a => a.id === btn.dataset.id);
					if (acc) this.openMasterModal('account', acc);
				});
			});

			accList.querySelectorAll('.btn-archive-account').forEach(btn => {
				btn.addEventListener('click', async () => {
					const acc = accounts.find(a => a.id === btn.dataset.id);
					if (acc) {
						acc.is_archived = !acc.is_archived;
						if (acc.type === 'insurance') {
							syncInsuranceRecurringRule(config, acc);
						}
						await this.saveMasterConfigAndSync(config);
					}
				});
			});
		}

		// 2. Categories & Subcategories
		const catList = document.getElementById('master-categories-list');
		if (catList) {
			const categories = config.categories || [];
			catList.innerHTML = categories.map(c => `
				<div class="master-item-row ${c.is_archived ? 'archived' : ''}" style="flex-direction: column; align-items: stretch; gap: 8px;">
					<div style="display: flex; justify-content: space-between; align-items: center;">
						<div>
							<span style="font-weight: 600;">${escapeHtml(c.name)}</span>
							<span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 6px;">(${c.type === 'expense' ? '支出' : '収入'})</span>
							${c.is_archived ? '<span class="badge badge-warning" style="margin-left: 6px;">アーカイブ</span>' : ''}
						</div>
						<div style="display: flex; gap: 6px;">
							<button class="btn btn-secondary btn-sm btn-add-subcat" data-id="${c.id}">+ 内訳追加</button>
							<button class="btn btn-secondary btn-sm btn-edit-cat" data-id="${c.id}">編集</button>
							<button class="btn btn-secondary btn-sm btn-archive-cat" data-id="${c.id}">
								${c.is_archived ? '復元' : 'アーカイブ'}
							</button>
						</div>
					</div>
					<div class="subcat-list">
						${(c.subcategories || []).map(s => `
							<span class="subcat-pill ${s.is_archived ? 'archived' : ''}">
								${escapeHtml(s.name)}
								<button type="button" class="btn-edit-subcat" data-cat-id="${c.id}" data-sub-id="${s.id}" style="background:none;border:none;cursor:pointer;padding:0 2px;color:var(--primary);" title="編集">✏️</button>
								<button type="button" class="btn-archive-subcat" data-cat-id="${c.id}" data-sub-id="${s.id}" style="background:none;border:none;cursor:pointer;padding:0 2px;color:var(--text-muted);" title="${s.is_archived ? '復元' : 'アーカイブ'}">${s.is_archived ? '↩️' : '📦'}</button>
							</span>
						`).join('')}
					</div>
				</div>
			`).join('') || '<div style="color: var(--text-muted); padding: 8px;">費目が登録されていません</div>';

			catList.querySelectorAll('.btn-edit-cat').forEach(btn => {
				btn.addEventListener('click', () => {
					const cat = categories.find(c => c.id === btn.dataset.id);
					if (cat) this.openMasterModal('category', cat);
				});
			});

			catList.querySelectorAll('.btn-archive-cat').forEach(btn => {
				btn.addEventListener('click', async () => {
					const cat = categories.find(c => c.id === btn.dataset.id);
					if (cat) {
						cat.is_archived = !cat.is_archived;
						await this.saveMasterConfigAndSync(config);
					}
				});
			});

			catList.querySelectorAll('.btn-add-subcat').forEach(btn => {
				btn.addEventListener('click', () => {
					const cat = categories.find(c => c.id === btn.dataset.id);
					if (cat) this.openMasterModal('subcategory', null, cat);
				});
			});

			catList.querySelectorAll('.btn-edit-subcat').forEach(btn => {
				btn.addEventListener('click', () => {
					const cat = categories.find(c => c.id === btn.dataset.catId);
					const sub = cat?.subcategories?.find(s => s.id === btn.dataset.subId);
					if (cat && sub) this.openMasterModal('subcategory', sub, cat);
				});
			});

			catList.querySelectorAll('.btn-archive-subcat').forEach(btn => {
				btn.addEventListener('click', async () => {
					const cat = categories.find(c => c.id === btn.dataset.catId);
					const sub = cat?.subcategories?.find(s => s.id === btn.dataset.subId);
					if (sub) {
						sub.is_archived = !sub.is_archived;
						await this.saveMasterConfigAndSync(config);
					}
				});
			});
		}

		// 3. Recurring Rules
		const recList = document.getElementById('master-recurring-list');
		if (recList) {
			const rules = config.recurring_rules || [];
			recList.innerHTML = rules.map(r => `
				<div class="master-item-row ${!r.is_active ? 'archived' : ''}">
					<div>
						<div style="font-weight: 600;">
							${r.name}
							<span class="badge ${r.is_active ? 'badge-success' : 'badge-warning'}" style="margin-left: 6px;">
								${r.is_active ? '有効' : '停止中'}
							</span>
						</div>
						<div style="font-size: 0.8rem; color: var(--text-muted);">
							毎月${r.day_of_month}日 | ¥${(r.amount || 0).toLocaleString()} | ${r.type} | 口座: ${r.account_id}
						</div>
					</div>
					<div style="display: flex; gap: 6px;">
						<button class="btn btn-secondary btn-sm btn-edit-recurring" data-id="${r.id}">編集</button>
						<button class="btn btn-secondary btn-sm btn-toggle-recurring" data-id="${r.id}">
							${r.is_active ? '無効化' : '有効化'}
						</button>
						<button class="btn btn-danger btn-sm btn-delete-recurring" data-id="${r.id}">削除</button>
					</div>
				</div>
			`).join('') || '<div style="color: var(--text-muted); padding: 8px;">定期ルールが登録されていません</div>';

			recList.querySelectorAll('.btn-edit-recurring').forEach(btn => {
				btn.addEventListener('click', () => {
					const rule = rules.find(r => r.id === btn.dataset.id);
					if (rule) this.openMasterModal('recurring', rule);
				});
			});

			recList.querySelectorAll('.btn-toggle-recurring').forEach(btn => {
				btn.addEventListener('click', async () => {
					const rule = rules.find(r => r.id === btn.dataset.id);
					if (rule) {
						rule.is_active = !rule.is_active;
						await this.saveMasterConfigAndSync(config);
					}
				});
			});

			recList.querySelectorAll('.btn-delete-recurring').forEach(btn => {
				btn.addEventListener('click', async () => {
					if (confirm('この定期予定ルールを削除しますか？')) {
						config.recurring_rules = config.recurring_rules.filter(r => r.id !== btn.dataset.id);
						await this.saveMasterConfigAndSync(config);
					}
				});
			});
		}

		// 4. Holidays
		const holList = document.getElementById('master-holidays-list');
		if (holList) {
			const holidays = config.holidays || [];
			const grouped = groupHolidaysByYear(holidays);
			const years = Object.keys(grouped).sort();

			if (years.length === 0) {
				holList.innerHTML = '<div style="color: var(--text-muted); padding: 8px;">祝日が登録されていません</div>';
			} else {
				holList.innerHTML = years.map(year => {
					const list = grouped[year];
					return `
						<details class="holiday-year-group">
							<summary>
								<span>📅 <strong>${year}年</strong> (${list.length}日)</span>
								<span style="font-size: 0.8rem; color: var(--text-muted);">開閉 ▼</span>
							</summary>
							<div class="holiday-year-content subcat-list">
								${list.map(h => `
									<span class="subcat-pill">
										${h}
										<span class="btn-icon-del btn-del-holiday" data-date="${h}" title="削除">&times;</span>
									</span>
								`).join('')}
							</div>
						</details>
					`;
				}).join('');

				holList.querySelectorAll('.btn-del-holiday').forEach(btn => {
					btn.addEventListener('click', async () => {
						const dt = btn.dataset.date;
						config.holidays = config.holidays.filter(h => h !== dt);
						await this.saveMasterConfigAndSync(config);
					});
				});
			}
		}
	}

	async openMasterModal(type, item, parentItem = null) {
		const modal = document.getElementById('modal-master-item');
		const title = document.getElementById('master-modal-title');
		const body = document.getElementById('master-modal-body');
		if (!modal || !title || !body) return;

		const config = await this.db.getMasterConfig();

		if (type === 'account') {
			const isNew = !item;
			title.textContent = isNew ? '🏦 新規口座の追加' : `🏦 口座の編集: ${item.name}`;
			const activeExpenseCats = (config.categories || []).filter(c => !c.is_archived && (!c.type || c.type === 'expense'));
			const activePayAccounts = (config.accounts || []).filter(a => !a.is_archived && a.id !== item?.id && !['loan', 'receivable', 'prepaid'].includes(a.type));

			body.innerHTML = `
				<form id="form-master-account">
					<div class="form-group">
						<label class="form-label" for="m-acc-id">口座ID (英数記号)</label>
						<input type="text" id="m-acc-id" class="form-control" value="${escapeHtml(item?.id || 'acc_' + Date.now().toString(36))}" ${!isNew ? 'readonly' : ''} required>
					</div>
					<div class="form-group">
						<label class="form-label" for="m-acc-name">口座名・表記</label>
						<input type="text" id="m-acc-name" class="form-control" value="${escapeHtml(item?.name || '')}" placeholder="例: メイン銀行口座" required>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="m-acc-type">口座種別</label>
							<select id="m-acc-type" class="form-control">
								<option value="bank" ${item?.type === 'bank' ? 'selected' : ''}>銀行預金 (bank)</option>
								<option value="cash" ${item?.type === 'cash' ? 'selected' : ''}>現金 (cash)</option>
								<option value="investment" ${item?.type === 'investment' ? 'selected' : ''}>証券・投資信託・積立NISA (investment)</option>
								<option value="insurance" ${item?.type === 'insurance' ? 'selected' : ''}>保険・積立保険 (insurance)</option>
								<option value="credit_card" ${item?.type === 'credit_card' ? 'selected' : ''}>クレジットカード (credit_card)</option>
								<option value="loan" ${item?.type === 'loan' ? 'selected' : ''}>ローン・借入金 (loan / 負債)</option>
								<option value="point" ${item?.type === 'point' ? 'selected' : ''}>ポイント・電子マネー (point)</option>
								<option value="receivable" ${item?.type === 'receivable' ? 'selected' : ''}>立替債権 (receivable)</option>
								<option value="prepaid" ${item?.type === 'prepaid' ? 'selected' : ''}>前払費用 (prepaid)</option>
								<option value="asset" ${item?.type === 'asset' ? 'selected' : ''}>その他資産 (asset)</option>
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="m-acc-init-bal">初期残高 (円)</label>
							<input type="number" id="m-acc-init-bal" class="form-control" value="${item?.initial_balance ?? 0}" step="1">
						</div>
					</div>
					<div id="m-acc-cc-fields" style="display: ${item?.type === 'credit_card' ? 'block' : 'none'}; border-top: 1px dashed var(--border); margin-top: 12px; padding-top: 12px;">
						<div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px;">💳 クレジットカード引き落とし連携設定</div>
						<div class="form-row">
							<div class="form-group">
								<label class="form-label" for="m-acc-closing-day">締め日 (1〜28、99=末日)</label>
								<input type="number" id="m-acc-closing-day" class="form-control" value="${item?.closing_day ?? ''}" placeholder="例: 15 (末日: 99)" min="1" max="99">
							</div>
							<div class="form-group">
								<label class="form-label" for="m-acc-debit-day">引き落とし日 (1〜28、99=末日)</label>
								<input type="number" id="m-acc-debit-day" class="form-control" value="${item?.debit_day ?? ''}" placeholder="例: 10 (末日: 99)" min="1" max="99">
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="form-label" for="m-acc-debit-offset">引き落とし月</label>
								<select id="m-acc-debit-offset" class="form-control">
									<option value="1" ${item?.debit_month_offset === 1 ? 'selected' : ''}>翌月 (標準)</option>
									<option value="2" ${item?.debit_month_offset === 2 ? 'selected' : ''}>翌々月</option>
									<option value="0" ${item?.debit_month_offset === 0 ? 'selected' : ''}>当月</option>
								</select>
							</div>
							<div class="form-group">
								<label class="form-label" for="m-acc-debit-account">引き落とし口座 (銀行)</label>
								<select id="m-acc-debit-account" class="form-control">
									<option value="">設定なし (自動振替オフ)</option>
									${(config.accounts || []).filter(a => a.type === 'bank' && a.id !== item?.id).map(a => `<option value="${escapeHtml(a.id)}" ${item?.debit_account_id === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
								</select>
							</div>
						</div>
					</div>
					<div id="m-acc-insurance-fields" style="display: ${item?.type === 'insurance' ? 'block' : 'none'}; border-top: 1px dashed var(--border); margin-top: 12px; padding-top: 12px;">
						<div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px;">🛡️ 保険・満期および定期保険料の同時設定</div>
						<div class="form-row">
							<div class="form-group">
								<label class="form-label" for="m-acc-maturity-date">満期日 (任意)</label>
								<input type="date" id="m-acc-maturity-date" class="form-control" value="${escapeHtml(item?.maturity_date || '')}">
							</div>
							<div class="form-group">
								<label class="form-label" for="m-acc-maturity-amount">満期保険金額・目標額 (円)</label>
								<input type="number" id="m-acc-maturity-amount" class="form-control" value="${item?.maturity_amount ?? ''}" placeholder="例: 3000000" min="0" step="1">
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="form-label" for="m-acc-premium-amount">毎月の保険料 (円・定期出費連動)</label>
								<input type="number" id="m-acc-premium-amount" class="form-control" value="${item?.premium_amount ?? ''}" placeholder="例: 15000 (0で定期連携なし)" min="0" step="1">
							</div>
							<div class="form-group">
								<label class="form-label" for="m-acc-premium-day">引落・支払日 (毎月何日: 1〜31)</label>
								<input type="number" id="m-acc-premium-day" class="form-control" value="${item?.premium_day ?? 27}" min="1" max="31" step="1">
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="form-label" for="m-acc-premium-pay-account">保険料の引落元口座</label>
								<select id="m-acc-premium-pay-account" class="form-control">
									<option value="">設定なし (定期ルール未生成)</option>
									${activePayAccounts.map(a => `<option value="${escapeHtml(a.id)}" ${item?.premium_pay_account_id === a.id ? 'selected' : ''}>${escapeHtml(a.name)} (${escapeHtml(a.type)})</option>`).join('')}
								</select>
							</div>
							<div class="form-group">
								<label class="form-label" for="m-acc-premium-cat">保険料の計上費目</label>
								<select id="m-acc-premium-cat" class="form-control">
									${activeExpenseCats.map(c => `<option value="${escapeHtml(c.id)}" ${item?.premium_category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
								</select>
							</div>
						</div>
					</div>
					<div style="display: flex; gap: 8px; margin-top: 16px;">
						<button type="submit" class="btn btn-primary btn-block">保存する</button>
					</div>
				</form>
			`;

			document.getElementById('m-acc-type')?.addEventListener('change', (e) => {
				const ccFields = document.getElementById('m-acc-cc-fields');
				const insFields = document.getElementById('m-acc-insurance-fields');
				if (ccFields) ccFields.style.display = e.target.value === 'credit_card' ? 'block' : 'none';
				if (insFields) insFields.style.display = e.target.value === 'insurance' ? 'block' : 'none';
			});

			document.getElementById('form-master-account')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const id = document.getElementById('m-acc-id').value.trim();
				const name = document.getElementById('m-acc-name').value.trim();
				const accType = document.getElementById('m-acc-type').value;
				const initBal = Number(document.getElementById('m-acc-init-bal').value) || 0;

				const closingDayVal = document.getElementById('m-acc-closing-day')?.value;
				const debitDayVal = document.getElementById('m-acc-debit-day')?.value;
				const closingDay = closingDayVal ? Number(closingDayVal) : null;
				const debitDay = debitDayVal ? Number(debitDayVal) : null;
				const debitOffset = Number(document.getElementById('m-acc-debit-offset')?.value) || 1;
				const debitAccId = document.getElementById('m-acc-debit-account')?.value || null;

				const maturityDate = document.getElementById('m-acc-maturity-date')?.value || null;
				const maturityAmtVal = document.getElementById('m-acc-maturity-amount')?.value;
				const maturityAmount = maturityAmtVal ? Number(maturityAmtVal) : null;
				const premiumAmtVal = document.getElementById('m-acc-premium-amount')?.value;
				const premiumAmount = premiumAmtVal ? Number(premiumAmtVal) : null;
				const premiumDay = Number(document.getElementById('m-acc-premium-day')?.value) || 27;
				const premiumPayAccId = document.getElementById('m-acc-premium-pay-account')?.value || null;
				const premiumCatId = document.getElementById('m-acc-premium-cat')?.value || null;

				const isAsset = !['credit_card', 'loan'].includes(accType);

				config.accounts = config.accounts || [];
				let targetAccount;
				if (isNew) {
					targetAccount = {
						id,
						name,
						type: accType,
						currency: 'JPY',
						initial_balance: initBal,
						is_asset: isAsset,
						closing_day: accType === 'credit_card' ? closingDay : null,
						debit_day: accType === 'credit_card' ? debitDay : null,
						debit_month_offset: accType === 'credit_card' ? debitOffset : 1,
						debit_account_id: accType === 'credit_card' ? debitAccId : null,
						maturity_date: accType === 'insurance' ? maturityDate : null,
						maturity_amount: accType === 'insurance' ? maturityAmount : null,
						premium_amount: accType === 'insurance' ? premiumAmount : null,
						premium_day: accType === 'insurance' ? premiumDay : null,
						premium_pay_account_id: accType === 'insurance' ? premiumPayAccId : null,
						premium_category_id: accType === 'insurance' ? premiumCatId : null,
						sort_order: config.accounts.length + 1,
						is_archived: false
					};
					config.accounts.push(targetAccount);
				} else {
					item.name = name;
					item.type = accType;
					item.initial_balance = initBal;
					item.is_asset = isAsset;
					item.closing_day = accType === 'credit_card' ? closingDay : null;
					item.debit_day = accType === 'credit_card' ? debitDay : null;
					item.debit_month_offset = accType === 'credit_card' ? debitOffset : 1;
					item.debit_account_id = accType === 'credit_card' ? debitAccId : null;
					item.maturity_date = accType === 'insurance' ? maturityDate : null;
					item.maturity_amount = accType === 'insurance' ? maturityAmount : null;
					item.premium_amount = accType === 'insurance' ? premiumAmount : null;
					item.premium_day = accType === 'insurance' ? premiumDay : null;
					item.premium_pay_account_id = accType === 'insurance' ? premiumPayAccId : null;
					item.premium_category_id = accType === 'insurance' ? premiumCatId : null;
					targetAccount = item;
				}

				syncInsuranceRecurringRule(config, targetAccount);

				modal.classList.remove('active');
				await this.saveMasterConfigAndSync(config);
			});

		} else if (type === 'category') {
			const isNew = !item;
			title.textContent = isNew ? '📁 新規費目の追加' : `📁 費目の編集: ${item.name}`;
			body.innerHTML = `
				<form id="form-master-category">
					<div class="form-group">
						<label class="form-label" for="m-cat-id">費目ID (英数記号)</label>
						<input type="text" id="m-cat-id" class="form-control" value="${escapeHtml(item?.id || 'cat_' + Date.now().toString(36))}" ${!isNew ? 'readonly' : ''} required>
					</div>
					<div class="form-group">
						<label class="form-label" for="m-cat-name">費目名</label>
						<input type="text" id="m-cat-name" class="form-control" value="${escapeHtml(item?.name || '')}" placeholder="例: 食費" required>
					</div>
					<div class="form-group">
						<label class="form-label" for="m-cat-type">収支種別</label>
						<select id="m-cat-type" class="form-control">
							<option value="expense" ${item?.type === 'expense' ? 'selected' : ''}>支出 (expense)</option>
							<option value="income" ${item?.type === 'income' ? 'selected' : ''}>収入 (income)</option>
						</select>
					</div>
					<div style="display: flex; gap: 8px; margin-top: 16px;">
						<button type="submit" class="btn btn-primary btn-block">保存する</button>
					</div>
				</form>
			`;

			document.getElementById('form-master-category')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const id = document.getElementById('m-cat-id').value.trim();
				const name = document.getElementById('m-cat-name').value.trim();
				const catType = document.getElementById('m-cat-type').value;

				config.categories = config.categories || [];
				if (isNew) {
					config.categories.push({
						id,
						name,
						type: catType,
						sort_order: config.categories.length + 1,
						is_archived: false,
						subcategories: []
					});
				} else {
					item.name = name;
					item.type = catType;
				}

				modal.classList.remove('active');
				await this.saveMasterConfigAndSync(config);
			});

		} else if (type === 'subcategory') {
			const isNew = !item;
			title.textContent = isNew ? `🏷️ 内訳項目の追加 (${parentItem?.name})` : `🏷️ 内訳の編集: ${item.name}`;
			body.innerHTML = `
				<form id="form-master-subcategory">
					<div class="form-group">
						<label class="form-label" for="m-sub-id">内訳ID (英数記号)</label>
						<input type="text" id="m-sub-id" class="form-control" value="${escapeHtml(item?.id || 'sub_' + Date.now().toString(36))}" ${!isNew ? 'readonly' : ''} required>
					</div>
					<div class="form-group">
						<label class="form-label" for="m-sub-name">内訳名</label>
						<input type="text" id="m-sub-name" class="form-control" value="${escapeHtml(item?.name || '')}" placeholder="例: 自炊食材" required>
					</div>
					<div style="display: flex; gap: 8px; margin-top: 16px;">
						<button type="submit" class="btn btn-primary btn-block">保存する</button>
					</div>
				</form>
			`;

			document.getElementById('form-master-subcategory')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const id = document.getElementById('m-sub-id').value.trim();
				const name = document.getElementById('m-sub-name').value.trim();

				if (parentItem) {
					parentItem.subcategories = parentItem.subcategories || [];
					if (isNew) {
						parentItem.subcategories.push({
							id,
							name,
							sort_order: parentItem.subcategories.length + 1,
							is_archived: false
						});
					} else {
						item.name = name;
					}
				}

				modal.classList.remove('active');
				await this.saveMasterConfigAndSync(config);
			});

		} else if (type === 'recurring') {
			const isNew = !item;
			title.textContent = isNew ? '📅 新規定期ルールの追加' : `📅 定期ルールの編集: ${item.name}`;

			const activeAccounts = (config.accounts || []).filter(a => !a.is_archived);
			const activeCats = (config.categories || []).filter(c => !c.is_archived);

			body.innerHTML = `
				<form id="form-master-recurring">
					<div class="form-group">
						<label class="form-label" for="m-rec-id">ルールID</label>
						<input type="text" id="m-rec-id" class="form-control" value="${escapeHtml(item?.id || 'rec_' + Date.now().toString(36))}" ${!isNew ? 'readonly' : ''} required>
					</div>
					<div class="form-group">
						<label class="form-label" for="m-rec-name">ルール名</label>
						<input type="text" id="m-rec-name" class="form-control" value="${escapeHtml(item?.name || '')}" placeholder="例: 家賃" required>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="m-rec-type">取引種別</label>
							<select id="m-rec-type" class="form-control">
								<option value="expense" ${item?.type === 'expense' ? 'selected' : ''}>支出</option>
								<option value="income" ${item?.type === 'income' ? 'selected' : ''}>収入</option>
								<option value="transfer" ${item?.type === 'transfer' ? 'selected' : ''}>振替</option>
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="m-rec-amount">想定金額 (円)</label>
							<input type="number" id="m-rec-amount" class="form-control" value="${item?.amount || ''}" required min="0" step="1">
						</div>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="m-rec-account">決済口座</label>
							<select id="m-rec-account" class="form-control" required>
								${activeAccounts.map(a => `<option value="${escapeHtml(a.id)}" ${item?.account_id === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
							</select>
						</div>
						<div class="form-group">
							<label class="form-label" for="m-rec-cat">大項目</label>
							<select id="m-rec-cat" class="form-control">
								${activeCats.map(c => `<option value="${escapeHtml(c.id)}" ${item?.category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
							</select>
						</div>
					</div>
					<div class="form-row">
						<div class="form-group">
							<label class="form-label" for="m-rec-day">発生日 (毎月何日: 1-31)</label>
							<input type="number" id="m-rec-day" class="form-control" min="1" max="31" value="${item?.day_of_month || 25}" required>
						</div>
						<div class="form-group">
							<label class="form-label" for="m-rec-holiday">休日補正ルール</label>
							<select id="m-rec-holiday" class="form-control">
								<option value="none" ${item?.holiday_adjustment === 'none' ? 'selected' : ''}>補正なし (none)</option>
								<option value="before" ${item?.holiday_adjustment === 'before' ? 'selected' : ''}>前営業日へ前倒し (before)</option>
								<option value="after" ${item?.holiday_adjustment === 'after' ? 'selected' : ''}>翌営業日へ後ろ倒し (after)</option>
							</select>
						</div>
					</div>
					<div style="display: flex; gap: 8px; margin-top: 16px;">
						<button type="submit" class="btn btn-primary btn-block">保存する</button>
					</div>
				</form>
			`;

			document.getElementById('form-master-recurring')?.addEventListener('submit', async (e) => {
				e.preventDefault();
				const id = document.getElementById('m-rec-id').value.trim();
				const name = document.getElementById('m-rec-name').value.trim();
				const recType = document.getElementById('m-rec-type').value;
				const amount = Number(document.getElementById('m-rec-amount').value) || 0;
				const accId = document.getElementById('m-rec-account').value;
				const catId = document.getElementById('m-rec-cat').value;
				const day = Number(document.getElementById('m-rec-day').value) || 25;
				const holidayAdj = document.getElementById('m-rec-holiday').value;

				config.recurring_rules = config.recurring_rules || [];
				if (isNew) {
					config.recurring_rules.push({
						id,
						name,
						is_active: true,
						start_date: formatDate(new Date()).slice(0, 7) + '-01',
						end_date: null,
						frequency: 'interval_months',
						interval_months: 1,
						day_of_month: day,
						holiday_adjustment: holidayAdj,
						amortize_months: 1,
						type: recType,
						amount,
						account_id: accId,
						to_account_id: null,
						category_id: catId,
						subcategory_id: null
					});
				} else {
					item.name = name;
					item.type = recType;
					item.amount = amount;
					item.account_id = accId;
					item.category_id = catId;
					item.day_of_month = day;
					item.holiday_adjustment = holidayAdj;
				}

				modal.classList.remove('active');
				await this.saveMasterConfigAndSync(config);
			});
		}

		modal.classList.add('active');
	}
}

