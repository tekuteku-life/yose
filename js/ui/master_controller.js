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
		this.openGeneration = 0;
		this.submittingVersion = null;
		this.initialValues = null;
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
			this.requestClose();
		});

		document.getElementById('btn-add-account')?.addEventListener('click', () => {
			this.openMasterModal('account', null).catch(error => alert(`設定を開けませんでした: ${error.message}`));
		});

		document.getElementById('btn-add-category')?.addEventListener('click', () => {
			this.openMasterModal('category', null).catch(error => alert(`設定を開けませんでした: ${error.message}`));
		});

		document.getElementById('btn-add-recurring')?.addEventListener('click', () => {
			this.openMasterModal('recurring', null).catch(error => alert(`設定を開けませんでした: ${error.message}`));
		});

		this.bindMasterAction('btn-add-holiday', async () => {
			const input = document.getElementById('input-new-holiday');
			const val = input?.value;
			if (!val) {
				alert('祝日の日付を選択してください');
				return;
			}
			const config = await this.db.getMasterConfig();
			const expectedConfig = structuredClone(config);
			config.holidays = config.holidays || [];
			if (!config.holidays.includes(val)) {
				config.holidays.push(val);
				config.holidays.sort();
				await this.saveMasterConfigAndSync(config, expectedConfig);
				if (input) input.value = '';
			} else {
				alert('指定された日付は既に祝日に登録されています');
			}
		});

		// Preset Japanese Holidays Import
		this.bindMasterAction('btn-import-holidays-preset', async () => {
			const config = await this.db.getMasterConfig();
			const expectedConfig = structuredClone(config);
			config.holidays = config.holidays || [];
			const beforeCount = config.holidays.length;
			const set = new Set([...config.holidays, ...JAPANESE_HOLIDAYS_PRESET]);
			config.holidays = Array.from(set).sort();
			const addedCount = config.holidays.length - beforeCount;
			await this.saveMasterConfigAndSync(config, expectedConfig);
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
		this.bindMasterAction('btn-confirm-import-holidays', async () => {
			const txt = document.getElementById('txt-holiday-import-input');
			const raw = txt?.value || '';
			const parsed = parseHolidayTextOrCsv(raw);
			if (parsed.length === 0) {
				alert('有効な日付が見つかりませんでした (形式例: 2026-01-01 または 2026/01/01)');
				return;
			}
			const config = await this.db.getMasterConfig();
			const expectedConfig = structuredClone(config);
			config.holidays = config.holidays || [];
			const beforeCount = config.holidays.length;
			const set = new Set([...config.holidays, ...parsed]);
			config.holidays = Array.from(set).sort();
			const addedCount = config.holidays.length - beforeCount;
			await this.saveMasterConfigAndSync(config, expectedConfig);
			document.getElementById('modal-holiday-import')?.classList.remove('active');
			if (txt) txt.value = '';
			alert(`${parsed.length} 件の日付から新規に ${addedCount} 件の祝日を登録しました（合計: ${config.holidays.length} 件）`);
		});
	}

	async saveMasterConfigAndSync(config, expectedConfig = null) {
		const saved = await this.db.saveMasterConfig(config, { expectedConfig });
		await this.coordinator.refreshAllViews();
		void this.syncManager.queueMasterSync();
		return saved;
	}

	async mutateMasterConfigAndSync(mutator) {
		await this.db.mutateMasterConfig(mutator);
		await this.coordinator.refreshAllViews();
		void this.syncManager.queueMasterSync();
	}

	bindMasterAction(buttonId, handler) {
		const button = document.getElementById(buttonId);
		let busy = false;
		button?.addEventListener('click', async () => {
			if (busy) return;
			busy = true;
			button.disabled = true;
			try { await handler(); }
			catch (error) { alert(`設定の保存に失敗しました: ${error.message}`); }
			finally { busy = false; button.disabled = false; }
		});
	}

	bindMasterSubmit(formId, handler) {
		const form = document.getElementById(formId);
		const version = this.openGeneration;
		let busy = false;
		form?.addEventListener('submit', async event => {
			event.preventDefault();
			if (busy) return;
			busy = true;
			this.submittingVersion = version;
			const button = /** @type {HTMLButtonElement} */ (form.querySelector('button[type="submit"]'));
			if (button) button.disabled = true;
			try { await handler(event); }
			catch (error) { alert(`設定の保存に失敗しました: ${error.message}`); }
			finally {
				busy = false;
				if (this.submittingVersion === version) this.submittingVersion = null;
				if (button) button.disabled = false;
			}
		});
	}

	captureValues() {
		return JSON.stringify(Array.from(document.querySelectorAll('#master-modal-body input, #master-modal-body select, #master-modal-body textarea'), element => [element.id, element.value, element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type) ? element.checked : null]));
	}

	requestClose() {
		if (this.submittingVersion === this.openGeneration) {
			this.coordinator.showToast('保存中です。完了してから閉じてください。');
			return false;
		}
		if (this.initialValues !== this.captureValues() && !confirm('編集中の変更を破棄して閉じますか？')) return false;
		this.closeMasterModal(this.openGeneration);
		return true;
	}

	closeMasterModal(version) {
		if (version !== this.openGeneration) return;
		document.getElementById('modal-master-item')?.classList.remove('active');
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
							種別: ${escapeHtml(a.type)} | 初期残高: ¥${Number(a.initial_balance || 0).toLocaleString()}
						</div>
						${(() => {
							if (a.type !== 'credit_card') return '';
							const debitId = a.debit_account_id || a.settlement_account_id;
							const debitAcc = (config.accounts || []).find(acc => acc.id === debitId);
							const debitInfo = debitAcc
								? `締: ${escapeHtml(a.closing_day || '-')}日 / 引落: ${escapeHtml(a.debit_day || '-')}日 (${escapeHtml(debitAcc.name)})`
								: '引落口座: 未設定';
							return `<div style="font-size: 0.8rem; color: var(--primary); margin-top: 2px;">💳 ${debitInfo}</div>`;
						})()}
					</div>
					<div style="display: flex; gap: 6px;">
						<button class="btn btn-secondary btn-sm btn-edit-account" data-id="${escapeHtml(a.id)}">編集</button>
						<button class="btn btn-secondary btn-sm btn-archive-account" data-id="${escapeHtml(a.id)}">
							${a.is_archived ? '復元' : 'アーカイブ'}
						</button>
					</div>
				</div>
			`).join('') || '<div style="color: var(--text-muted); padding: 8px;">口座が登録されていません</div>';

			accList.querySelectorAll('.btn-edit-account').forEach(btn => {
				btn.addEventListener('click', () => {
					const acc = accounts.find(a => a.id === btn.dataset.id);
					if (acc) this.openMasterModal('account', acc).catch(error => alert(`設定を開けませんでした: ${error.message}`));
				});
			});

			accList.querySelectorAll('.btn-archive-account').forEach(btn => {
				btn.addEventListener('click', async () => {
					try { await this.mutateMasterConfigAndSync(current => {
						const acc = current.accounts.find(a => a.id === btn.dataset.id);
						if (!acc) throw new Error('口座が変更されました。一覧を更新してください。');
						acc.is_archived = !acc.is_archived;
						if (acc.type === 'insurance') syncInsuranceRecurringRule(current, acc);
						return current;
					}); } catch (error) { alert(`設定の保存に失敗しました: ${error.message}`); }
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
							<button class="btn btn-secondary btn-sm btn-add-subcat" data-id="${escapeHtml(c.id)}">+ 内訳追加</button>
							<button class="btn btn-secondary btn-sm btn-edit-cat" data-id="${escapeHtml(c.id)}">編集</button>
							<button class="btn btn-secondary btn-sm btn-archive-cat" data-id="${escapeHtml(c.id)}">
								${c.is_archived ? '復元' : 'アーカイブ'}
							</button>
						</div>
					</div>
					<div class="subcat-list">
						${(c.subcategories || []).map(s => `
							<span class="subcat-pill ${s.is_archived ? 'archived' : ''}">
								${escapeHtml(s.name)}
								<button type="button" class="btn-edit-subcat" data-cat-id="${escapeHtml(c.id)}" data-sub-id="${escapeHtml(s.id)}" style="background:none;border:none;cursor:pointer;padding:0 2px;color:var(--primary);" title="編集">✏️</button>
								<button type="button" class="btn-archive-subcat" data-cat-id="${escapeHtml(c.id)}" data-sub-id="${escapeHtml(s.id)}" style="background:none;border:none;cursor:pointer;padding:0 2px;color:var(--text-muted);" title="${s.is_archived ? '復元' : 'アーカイブ'}">${s.is_archived ? '↩️' : '📦'}</button>
							</span>
						`).join('')}
					</div>
				</div>
			`).join('') || '<div style="color: var(--text-muted); padding: 8px;">費目が登録されていません</div>';

			catList.querySelectorAll('.btn-edit-cat').forEach(btn => {
				btn.addEventListener('click', () => {
					const cat = categories.find(c => c.id === btn.dataset.id);
					if (cat) this.openMasterModal('category', cat).catch(error => alert(`設定を開けませんでした: ${error.message}`));
				});
			});

			catList.querySelectorAll('.btn-archive-cat').forEach(btn => {
				btn.addEventListener('click', async () => {
					try { await this.mutateMasterConfigAndSync(current => {
						const cat = current.categories.find(c => c.id === btn.dataset.id);
						if (!cat) throw new Error('費目が変更されました。一覧を更新してください。');
						cat.is_archived = !cat.is_archived;
						return current;
					}); } catch (error) { alert(`設定の保存に失敗しました: ${error.message}`); }
				});
			});

			catList.querySelectorAll('.btn-add-subcat').forEach(btn => {
				btn.addEventListener('click', () => {
					const cat = categories.find(c => c.id === btn.dataset.id);
					if (cat) this.openMasterModal('subcategory', null, cat).catch(error => alert(`設定を開けませんでした: ${error.message}`));
				});
			});

			catList.querySelectorAll('.btn-edit-subcat').forEach(btn => {
				btn.addEventListener('click', () => {
					const cat = categories.find(c => c.id === btn.dataset.catId);
					const sub = cat?.subcategories?.find(s => s.id === btn.dataset.subId);
					if (cat && sub) this.openMasterModal('subcategory', sub, cat).catch(error => alert(`設定を開けませんでした: ${error.message}`));
				});
			});

			catList.querySelectorAll('.btn-archive-subcat').forEach(btn => {
				btn.addEventListener('click', async () => {
					try { await this.mutateMasterConfigAndSync(current => {
						const sub = current.categories.find(c => c.id === btn.dataset.catId)?.subcategories?.find(s => s.id === btn.dataset.subId);
						if (!sub) throw new Error('中項目が変更されました。一覧を更新してください。');
						sub.is_archived = !sub.is_archived;
						return current;
					}); } catch (error) { alert(`設定の保存に失敗しました: ${error.message}`); }
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
							${escapeHtml(r.name)}
							<span class="badge ${r.is_active ? 'badge-success' : 'badge-warning'}" style="margin-left: 6px;">
								${r.is_active ? '有効' : '停止中'}
							</span>
						</div>
						<div style="font-size: 0.8rem; color: var(--text-muted);">
							毎月${escapeHtml(r.day_of_month)}日 | ¥${Number(r.amount || 0).toLocaleString()} | ${escapeHtml(r.type)} | 口座: ${escapeHtml(r.account_id)}
						</div>
					</div>
					<div style="display: flex; gap: 6px;">
						<button class="btn btn-secondary btn-sm btn-edit-recurring" data-id="${escapeHtml(r.id)}">編集</button>
						<button class="btn btn-secondary btn-sm btn-toggle-recurring" data-id="${escapeHtml(r.id)}">
							${r.is_active ? '無効化' : '有効化'}
						</button>
						<button class="btn btn-danger btn-sm btn-delete-recurring" data-id="${escapeHtml(r.id)}">削除</button>
					</div>
				</div>
			`).join('') || '<div style="color: var(--text-muted); padding: 8px;">定期ルールが登録されていません</div>';

			recList.querySelectorAll('.btn-edit-recurring').forEach(btn => {
				btn.addEventListener('click', () => {
					const rule = rules.find(r => r.id === btn.dataset.id);
					if (rule) this.openMasterModal('recurring', rule).catch(error => alert(`設定を開けませんでした: ${error.message}`));
				});
			});

			recList.querySelectorAll('.btn-toggle-recurring').forEach(btn => {
				btn.addEventListener('click', async () => {
					try { await this.mutateMasterConfigAndSync(current => {
						const rule = current.recurring_rules.find(r => r.id === btn.dataset.id);
						if (!rule) throw new Error('ルールが変更されました。一覧を更新してください。');
						rule.is_active = !rule.is_active;
						return current;
					}); } catch (error) { alert(`設定の保存に失敗しました: ${error.message}`); }
				});
			});

			recList.querySelectorAll('.btn-delete-recurring').forEach(btn => {
				btn.addEventListener('click', async () => {
					if (confirm('この定期予定ルールを削除しますか？')) {
						try { await this.mutateMasterConfigAndSync(current => {
							current.recurring_rules = current.recurring_rules.filter(r => r.id !== btn.dataset.id);
							return current;
						}); } catch (error) { alert(`設定の保存に失敗しました: ${error.message}`); }
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
								<span>📅 <strong>${escapeHtml(year)}年</strong> (${list.length}日)</span>
								<span style="font-size: 0.8rem; color: var(--text-muted);">開閉 ▼</span>
							</summary>
							<div class="holiday-year-content subcat-list">
								${list.map(h => `
									<span class="subcat-pill">
										${escapeHtml(h)}
										<span class="btn-icon-del btn-del-holiday" data-date="${escapeHtml(h)}" title="削除">&times;</span>
									</span>
								`).join('')}
							</div>
						</details>
					`;
				}).join('');

				holList.querySelectorAll('.btn-del-holiday').forEach(btn => {
					btn.addEventListener('click', async () => {
						const dt = btn.dataset.date;
						try { await this.mutateMasterConfigAndSync(current => {
							current.holidays = current.holidays.filter(h => h !== dt);
							return current;
						}); } catch (error) { alert(`設定の保存に失敗しました: ${error.message}`); }
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
		if (modal.classList.contains('active') && this.submittingVersion === this.openGeneration) return;
		const openVersion = ++this.openGeneration;
		const key = this.coordinator.privateKey;

		const config = await this.db.getMasterConfig();
		if (openVersion !== this.openGeneration || !key || this.coordinator.privateKey !== key) return;
		const expectedConfig = structuredClone(config);
		if (parentItem) parentItem = config.categories.find(category => category.id === parentItem.id) || parentItem;
		if (item) {
			const collection = type === 'account' ? config.accounts : type === 'category' ? config.categories : type === 'recurring' ? config.recurring_rules : parentItem?.subcategories;
			item = collection?.find(candidate => candidate.id === item.id) || item;
		}

		if (type === 'account') {
			const isNew = !item;
			title.textContent = isNew ? '🏦 新規口座の追加' : `🏦 口座の編集: ${item.name}`;
			const activeExpenseCats = (config.categories || []).filter(c => c.id === item?.premium_category_id || (!c.is_archived && (!c.type || c.type === 'expense')));
			const activePayAccounts = (config.accounts || []).filter(a => a.id === item?.premium_pay_account_id || (!a.is_archived && a.id !== item?.id && !['loan', 'receivable', 'prepaid'].includes(a.type)));

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
							<input type="number" id="m-acc-init-bal" class="form-control" value="${escapeHtml(item?.initial_balance ?? 0)}" step="1">
						</div>
					</div>
					<div id="m-acc-cc-fields" style="display: ${item?.type === 'credit_card' ? 'block' : 'none'}; border-top: 1px dashed var(--border); margin-top: 12px; padding-top: 12px;">
						<div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px;">💳 クレジットカード引き落とし連携設定</div>
						<div class="form-row">
							<div class="form-group">
								<label class="form-label" for="m-acc-closing-day">締め日 (1〜28、99=末日)</label>
								<input type="number" id="m-acc-closing-day" class="form-control" value="${escapeHtml(item?.closing_day ?? '')}" placeholder="例: 15 (末日: 99)" min="1" max="99">
							</div>
							<div class="form-group">
								<label class="form-label" for="m-acc-debit-day">引き落とし日 (1〜28、99=末日)</label>
								<input type="number" id="m-acc-debit-day" class="form-control" value="${escapeHtml(item?.debit_day ?? '')}" placeholder="例: 10 (末日: 99)" min="1" max="99">
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
									${(() => {
										const currentDebitId = item?.debit_account_id || item?.settlement_account_id || '';
										const eligible = (config.accounts || []).filter(a => a.id === currentDebitId || (!a.is_archived && a.id !== item?.id && ['bank', 'cash', 'asset'].includes(a.type)));
										return eligible.map(a => `<option value="${escapeHtml(a.id)}" ${currentDebitId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}${a.is_archived ? '（アーカイブ済み）' : ''} (${escapeHtml(a.type)})</option>`).join('');
									})()}
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
								<input type="number" id="m-acc-maturity-amount" class="form-control" value="${escapeHtml(item?.maturity_amount ?? '')}" placeholder="例: 3000000" min="0" step="1">
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="form-label" for="m-acc-premium-amount">毎月の保険料 (円・定期出費連動)</label>
								<input type="number" id="m-acc-premium-amount" class="form-control" value="${escapeHtml(item?.premium_amount ?? '')}" placeholder="例: 15000 (0で定期連携なし)" min="0" step="1">
							</div>
							<div class="form-group">
								<label class="form-label" for="m-acc-premium-day">引落・支払日 (毎月何日: 1〜31)</label>
								<input type="number" id="m-acc-premium-day" class="form-control" value="${escapeHtml(item?.premium_day ?? 27)}" min="1" max="31" step="1">
							</div>
						</div>
						<div class="form-row">
							<div class="form-group">
								<label class="form-label" for="m-acc-premium-pay-account">保険料の引落元口座</label>
								<select id="m-acc-premium-pay-account" class="form-control">
									<option value="">設定なし (定期ルール未生成)</option>
									${activePayAccounts.map(a => `<option value="${escapeHtml(a.id)}" ${item?.premium_pay_account_id === a.id ? 'selected' : ''}>${escapeHtml(a.name)}${a.is_archived ? '（アーカイブ済み）' : ''} (${escapeHtml(a.type)})</option>`).join('')}
								</select>
							</div>
							<div class="form-group">
								<label class="form-label" for="m-acc-premium-cat">保険料の計上費目</label>
								<select id="m-acc-premium-cat" class="form-control">
									${activeExpenseCats.map(c => `<option value="${escapeHtml(c.id)}" ${item?.premium_category_id === c.id ? 'selected' : ''}>${escapeHtml(c.name)}${c.is_archived ? '（アーカイブ済み）' : ''}</option>`).join('')}
								</select>
							</div>
						</div>
						<div class="form-group"><label class="form-label" for="m-acc-premium-sub">保険料の計上中項目</label><select id="m-acc-premium-sub" class="form-control"></select></div>
					</div>
					<div style="display: flex; gap: 8px; margin-top: 16px;">
						<button type="submit" class="btn btn-primary btn-block">保存する</button>
					</div>
				</form>
			`;


			const updatePremiumChildren = (preserve = null) => {
				const category = config.categories?.find(candidate => candidate.id === document.getElementById('m-acc-premium-cat').value);
				const children = (category?.subcategories || []).filter(child => !child.is_archived || child.id === preserve);
				const select = document.getElementById('m-acc-premium-sub');
				select.innerHTML = '<option value="">（指定なし / 費目のみ）</option>' + children.map(child => `<option value="${escapeHtml(child.id)}">${escapeHtml(child.name)}${child.is_archived ? '（アーカイブ済み）' : ''}</option>`).join('');
				select.value = preserve || '';
			};
			updatePremiumChildren(item?.premium_subcategory_id);
			document.getElementById('m-acc-premium-cat').addEventListener('change', () => updatePremiumChildren());

			document.getElementById('m-acc-type')?.addEventListener('change', (e) => {
				const ccFields = document.getElementById('m-acc-cc-fields');
				const insFields = document.getElementById('m-acc-insurance-fields');
				if (ccFields) ccFields.style.display = e.target.value === 'credit_card' ? 'block' : 'none';
				if (insFields) insFields.style.display = e.target.value === 'insurance' ? 'block' : 'none';
			});

			this.bindMasterSubmit('form-master-account', async (e) => {
				const config = structuredClone(expectedConfig);
				e.preventDefault();
				const id = document.getElementById('m-acc-id')?.value.trim() || item?.id || ('acc_' + Date.now().toString(36));
				const name = document.getElementById('m-acc-name').value.trim();
				const accType = document.getElementById('m-acc-type').value;
				const initBal = Number(document.getElementById('m-acc-init-bal').value) || 0;

				const closingDayVal = document.getElementById('m-acc-closing-day')?.value;
				const debitDayVal = document.getElementById('m-acc-debit-day')?.value;
				const closingDay = closingDayVal ? Number(closingDayVal) : null;
				const debitDay = debitDayVal ? Number(debitDayVal) : null;
				const debitOffset = Number(document.getElementById('m-acc-debit-offset')?.value ?? 1);
				const debitAccId = document.getElementById('m-acc-debit-account')?.value || null;

				const maturityDate = document.getElementById('m-acc-maturity-date')?.value || null;
				const maturityAmtVal = document.getElementById('m-acc-maturity-amount')?.value;
				const maturityAmount = maturityAmtVal ? Number(maturityAmtVal) : null;
				const premiumAmtVal = document.getElementById('m-acc-premium-amount')?.value;
				const premiumAmount = premiumAmtVal ? Number(premiumAmtVal) : null;
				const premiumDay = Number(document.getElementById('m-acc-premium-day')?.value) || 27;
				const premiumPayAccId = document.getElementById('m-acc-premium-pay-account')?.value || null;
				const premiumCatId = document.getElementById('m-acc-premium-cat')?.value || null;
				const premiumSubId = document.getElementById('m-acc-premium-sub')?.value || null;

				const isAsset = !['credit_card', 'loan'].includes(accType);

				config.accounts = config.accounts || [];
				let targetAccount;
				const existingAcc = item ? config.accounts.find(a => a.id === item.id) : null;
				if (!existingAcc) {
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
						settlement_account_id: accType === 'credit_card' ? debitAccId : null,
						maturity_date: accType === 'insurance' ? maturityDate : null,
						maturity_amount: accType === 'insurance' ? maturityAmount : null,
						premium_amount: accType === 'insurance' ? premiumAmount : null,
						premium_day: accType === 'insurance' ? premiumDay : null,
						premium_pay_account_id: accType === 'insurance' ? premiumPayAccId : null,
						premium_category_id: accType === 'insurance' ? premiumCatId : null,
						premium_subcategory_id: accType === 'insurance' ? premiumSubId : null,
						sort_order: config.accounts.length + 1,
						is_archived: false
					};
					config.accounts.push(targetAccount);
				} else {
					existingAcc.id = existingAcc.id || id;
					existingAcc.name = name;
					existingAcc.type = accType;
					existingAcc.initial_balance = initBal;
					existingAcc.is_asset = isAsset;
					existingAcc.closing_day = accType === 'credit_card' ? closingDay : null;
					existingAcc.debit_day = accType === 'credit_card' ? debitDay : null;
					existingAcc.debit_month_offset = accType === 'credit_card' ? debitOffset : 1;
					existingAcc.debit_account_id = accType === 'credit_card' ? debitAccId : null;
					existingAcc.settlement_account_id = accType === 'credit_card' ? debitAccId : null;
					existingAcc.maturity_date = accType === 'insurance' ? maturityDate : null;
					existingAcc.maturity_amount = accType === 'insurance' ? maturityAmount : null;
					existingAcc.premium_amount = accType === 'insurance' ? premiumAmount : null;
					existingAcc.premium_day = accType === 'insurance' ? premiumDay : null;
					existingAcc.premium_pay_account_id = accType === 'insurance' ? premiumPayAccId : null;
					existingAcc.premium_category_id = accType === 'insurance' ? premiumCatId : null;
					existingAcc.premium_subcategory_id = accType === 'insurance' ? premiumSubId : null;
					targetAccount = existingAcc;
				}

				syncInsuranceRecurringRule(config, targetAccount);

				await this.saveMasterConfigAndSync(config, expectedConfig);
				this.closeMasterModal(openVersion);
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

			this.bindMasterSubmit('form-master-category', async (e) => {
				const config = structuredClone(expectedConfig);
				e.preventDefault();
				const id = document.getElementById('m-cat-id')?.value.trim() || item?.id || ('cat_' + Date.now().toString(36));
				const name = document.getElementById('m-cat-name').value.trim();
				const catType = document.getElementById('m-cat-type').value;

				config.categories = config.categories || [];
				const existingCat = item ? config.categories.find(c => c.id === item.id) : null;
				if (!existingCat) {
					config.categories.push({
						id,
						name,
						type: catType,
						sort_order: config.categories.length + 1,
						is_archived: false,
						subcategories: []
					});
				} else {
					existingCat.id = existingCat.id || id;
					existingCat.name = name;
					existingCat.type = catType;
				}

				await this.saveMasterConfigAndSync(config, expectedConfig);
				this.closeMasterModal(openVersion);
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

			this.bindMasterSubmit('form-master-subcategory', async (e) => {
				const config = structuredClone(expectedConfig);
				e.preventDefault();
				const id = document.getElementById('m-sub-id')?.value.trim() || item?.id || ('sub_' + Date.now().toString(36));
				const name = document.getElementById('m-sub-name').value.trim();

				if (parentItem) {
					config.categories = config.categories || [];
					const targetParent = config.categories.find(c => c.id === parentItem.id) || parentItem;
					targetParent.subcategories = targetParent.subcategories || [];
					if (targetParent !== parentItem) {
						parentItem.subcategories = targetParent.subcategories;
					}

					if (isNew) {
						targetParent.subcategories.push({
							id,
							name,
							sort_order: targetParent.subcategories.length + 1,
							is_archived: false
						});
					} else {
						const sub = targetParent.subcategories.find(s => s.id === item.id) || item;
						sub.id = sub.id || id;
						sub.name = name;
					}
				}

				await this.saveMasterConfigAndSync(config, expectedConfig);
				this.closeMasterModal(openVersion);
			});

		} else if (type === 'recurring') {
			const isNew = !item;
			const actualCategory = item?.actual_category_id || item?.category_id;
			const actualChild = item?.actual_subcategory_id !== undefined ? item.actual_subcategory_id : actualCategory === item?.category_id ? item?.subcategory_id : null;
			const sameClassification = isNew || (item.category_id === actualCategory && (item.subcategory_id || '') === (actualChild || ''));
			title.textContent = isNew ? '📅 新規定期ルールの追加' : `📅 定期ルールの編集: ${item.name}`;
			const options = (items, current, preserve = true) => items.filter(candidate => !candidate.is_archived || (preserve && candidate.id === current)).map(candidate => `<option value="${escapeHtml(candidate.id)}" ${candidate.id === current ? 'selected' : ''}>${escapeHtml(candidate.name)}${candidate.is_archived ? '（アーカイブ済み）' : ''}</option>`).join('');
			body.innerHTML = `
				<form id="form-master-recurring">
					<div class="form-group"><label class="form-label" for="m-rec-id">ルールID</label><input id="m-rec-id" class="form-control" value="${escapeHtml(item?.id || 'rec_' + Date.now().toString(36))}" ${isNew ? '' : 'readonly'} required></div>
					<div class="form-group"><label class="form-label" for="m-rec-name">ルール名</label><input id="m-rec-name" class="form-control" value="${escapeHtml(item?.name || '')}" required></div>
					<div class="form-row">
						<div class="form-group"><label class="form-label" for="m-rec-type">取引種別</label><select id="m-rec-type" class="form-control"><option value="expense">支出</option><option value="income">収入</option><option value="transfer">振替</option></select></div>
						<div class="form-group"><label class="form-label" for="m-rec-amount">想定金額 (円)</label><input type="number" id="m-rec-amount" class="form-control" value="${escapeHtml(item?.amount ?? '')}" required min="0" step="1"></div>
					</div>
					<div class="form-row">
						<div class="form-group"><label class="form-label" for="m-rec-account">決済口座</label><select id="m-rec-account" class="form-control" required>${options(config.accounts || [], item?.account_id)}</select></div>
						<div class="form-group" id="m-rec-to-group"><label class="form-label" for="m-rec-to-account">振替先口座</label><select id="m-rec-to-account" class="form-control"><option value="">振替先の指定が必要である</option>${options(config.accounts || [], item?.to_account_id)}</select></div>
					</div>
					<div id="m-rec-classification">
						<div class="form-row"><div class="form-group"><label class="form-label" for="m-rec-cat">計上費目</label><select id="m-rec-cat" class="form-control"></select></div><div class="form-group"><label class="form-label" for="m-rec-sub">計上中項目</label><select id="m-rec-sub" class="form-control"></select></div></div>
						<label class="form-label"><input type="checkbox" id="m-rec-sync-actual" ${sameClassification ? 'checked' : ''}> 実態分類を計上分類と同じにする</label>
						<div id="m-rec-actual-classification"><div class="form-row"><div class="form-group"><label class="form-label" for="m-rec-actual-cat">実態費目</label><select id="m-rec-actual-cat" class="form-control"></select></div><div class="form-group"><label class="form-label" for="m-rec-actual-sub">実態中項目</label><select id="m-rec-actual-sub" class="form-control"></select></div></div></div>
					</div>
					<div class="form-row">
						<div class="form-group"><label class="form-label" for="m-rec-day">発生日 (毎月何日: 1-31)</label><input type="number" id="m-rec-day" class="form-control" min="1" max="31" value="${escapeHtml(item?.day_of_month || 25)}" required></div>
						<div class="form-group"><label class="form-label" for="m-rec-holiday">休日補正ルール</label><select id="m-rec-holiday" class="form-control"><option value="none">補正なし</option><option value="before">前営業日へ前倒し</option><option value="after">翌営業日へ後ろ倒し</option></select></div>
					</div>
					<button type="submit" class="btn btn-primary btn-block">保存する</button>
				</form>`;
			const get = id => /** @type {HTMLInputElement & HTMLSelectElement} */ (document.getElementById(id));
			get('m-rec-type').value = item?.type || 'expense';
			get('m-rec-holiday').value = item?.holiday_adjustment || 'none';
			const updateChildren = (prefix, current = null, preserve = false) => {
				const category = config.categories.find(candidate => candidate.id === get(`${prefix}-cat`).value);
				get(`${prefix}-sub`).innerHTML = '<option value="">（指定なし / 費目のみ）</option>' + options(category?.subcategories || [], current, preserve);
				get(`${prefix}-sub`).value = current || '';
			};
			const syncActualClassification = () => {
				const same = get('m-rec-sync-actual').checked;
				get('m-rec-actual-classification').hidden = same;
				get('m-rec-actual-cat').required = !same && get('m-rec-type').value !== 'transfer';
				if (same) {
					get('m-rec-actual-cat').innerHTML = get('m-rec-cat').innerHTML;
					get('m-rec-actual-cat').value = get('m-rec-cat').value;
					updateChildren('m-rec-actual', get('m-rec-sub').value, true);
				}
			};
			const updateClassifications = (preserve = false) => {
				const recType = get('m-rec-type').value;
				const transfer = recType === 'transfer';
				get('m-rec-to-group').hidden = !transfer;
				get('m-rec-to-account').required = transfer;
				get('m-rec-classification').hidden = transfer;
				for (const [prefix, categoryId, childId] of [
					['m-rec', item?.category_id, item?.subcategory_id],
					['m-rec-actual', actualCategory, actualChild]
				]) {
					const categories = (config.categories || []).filter(candidate => (candidate.type || 'expense') === recType);
					get(`${prefix}-cat`).innerHTML = options(categories, preserve ? categoryId : null, preserve);
					get(`${prefix}-cat`).required = !transfer;
					updateChildren(prefix, preserve ? childId : null, preserve);
				}
				syncActualClassification();
			};
			get('m-rec-type').addEventListener('change', () => updateClassifications());
			get('m-rec-cat').addEventListener('change', () => { updateChildren('m-rec'); syncActualClassification(); });
			get('m-rec-sub').addEventListener('change', syncActualClassification);
			get('m-rec-sync-actual').addEventListener('change', syncActualClassification);
			get('m-rec-actual-cat').addEventListener('change', () => updateChildren('m-rec-actual'));
			updateClassifications(true);
			this.bindMasterSubmit('form-master-recurring', async () => {
				const config = structuredClone(expectedConfig);
				const recType = get('m-rec-type').value;
				const same = get('m-rec-sync-actual').checked;
				const id = get('m-rec-id').value.trim();
				const next = {
					id, name: get('m-rec-name').value.trim(), type: recType,
					amount: Number(get('m-rec-amount').value), account_id: get('m-rec-account').value,
					to_account_id: recType === 'transfer' ? get('m-rec-to-account').value : null,
					category_id: recType === 'transfer' ? null : get('m-rec-cat').value,
					subcategory_id: recType === 'transfer' ? null : get('m-rec-sub').value || null,
					actual_category_id: recType === 'transfer' ? null : get(same ? 'm-rec-cat' : 'm-rec-actual-cat').value,
					actual_subcategory_id: recType === 'transfer' ? null : get(same ? 'm-rec-sub' : 'm-rec-actual-sub').value || null,
					day_of_month: Number(get('m-rec-day').value), holiday_adjustment: get('m-rec-holiday').value
				};
				if (recType === 'transfer' && (!next.to_account_id || next.to_account_id === next.account_id)) throw new Error('振替元とは異なる振替先口座を選択してください。');
				config.recurring_rules ||= [];
				if (item) Object.assign(config.recurring_rules.find(rule => rule.id === item.id), next);
				else config.recurring_rules.push({ is_active: true, start_date: formatDate(new Date()).slice(0, 7) + '-01', end_date: null, frequency: 'interval_months', interval_months: 1, amortize_months: 1, ...next });
				await this.saveMasterConfigAndSync(config, expectedConfig);
				this.closeMasterModal(openVersion);
			});
		}

		this.initialValues = this.captureValues();
		modal.classList.add('active');
	}
}

