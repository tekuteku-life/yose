import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { useBrowser, openBrowser, transaction, seed, records, settings, value, submit, waitForDialog, dialogs, cashflow } from '../helpers/ui_fixture.js';

describe('Settings, files, security rendering, and persistence', { timeout: 120000 }, () => {
	const fixture = useBrowser();

	for (const [button, type, prefix, keys] of [
		['full', 'full_backup', 'backup', ['master_config', 'summary_snapshot', 'transactions']],
		['transactions', 'transactions', 'transactions', ['transactions']],
		['master', 'master_config', 'master_config', ['master_config']],
		['budgets', 'annual_budgets', 'annual_budgets', ['annual_budgets']],
		['snapshot', 'summary_snapshot', 'snapshot', ['summary_snapshot']]
	]) {
		it(`downloads ${type} with correct filename / contents and reimports it twice safely`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('active'), transaction('deleted', { is_deleted: true })]);
			await d.evaluate(`(async () => {
				const config = await window.__yose_app.db.getMasterConfig();
				config.accounts.push({ id: 'acc_export', name: '出力固有口座', type: 'bank', initial_balance: 0, is_asset: true });
				config.annual_budgets['2027'] = { expense_budget: 123000, savings_target_amount: 24000, savings_target_rate: 20, category_budgets: { cat_food: 12000 } };
				await window.__yose_app.db.saveMasterConfig(config);
				const snapshot = await window.__yose_app.db.getSnapshot();
				snapshot.monthly_summaries['2026-08'] = { income_total: 1000, expense_total: 200, net_income: 800 };
				await window.__yose_app.db.saveSnapshot(snapshot);
			})()`);
			await settings(d);
			// Intercept only the browser download boundary; the real handler builds the Blob and JSON.
			await d.evaluate(`
				window.__downloads = [];
				window.__blobs = new Map();
				URL.createObjectURL = blob => { const url = 'blob:test-' + window.__blobs.size; window.__blobs.set(url, blob); return url; };
				URL.revokeObjectURL = () => {};
				HTMLAnchorElement.prototype.click = function() { window.__downloads.push({ filename: this.download, url: this.href }); };
			`);
			await d.click('#btn-open-export-modal');
			await d.click(`#btn-export-${button}`);
			await d.waitFor('window.__downloads.length === 1');
			const file = await d.evaluate(`(async () => {
				const download = window.__downloads[0];
				const blob = window.__blobs.get(download.url);
				return { filename: download.filename, mime: blob.type, text: await blob.text() };
			})()`);
			assert.equal(file.filename, `yose_${prefix}_2026-10-20.json`);
			assert.equal(file.mime, 'application/json');
			const data = JSON.parse(file.text);
			assert.equal(data.schema_version, 2);
			assert.equal(data.export_type, type);
			assert.equal(data.exported_at, '2026-10-20T03:00:00.000Z');
			assert.deepEqual(Object.keys(data).sort(), ['schema_version', 'export_type', 'exported_at', ...keys].sort());
			if (data.transactions) assert.deepEqual(data.transactions.map(t => t.id).sort(), ['active', 'deleted']);
			assert.equal(await d.isVisible('#modal-export-json'), false);
			const receiver = await openBrowser();
			try {
				await settings(receiver);
				for (let attempt = 0; attempt < 2; attempt++) {
					const count = (await dialogs(receiver)).length;
					await receiver.importFile(file.text, file.filename);
					await receiver.waitFor(`window.__dialogs.length > ${count}`);
					assert.ok((await dialogs(receiver)).at(-1).message.includes('差分ORマージ完了'));
				}
				if (data.transactions) {
					assert.equal((await records(receiver)).length, 2);
					assert.equal((await records(receiver)).find(t => t.id === 'deleted').is_deleted, true);
					await receiver.click('.tab-btn[data-tab="tab-input"]');
					assert.ok((await receiver.textContent('#recent-tx-list')).includes('active'));
				}
				const config = await receiver.evaluate('window.__yose_app.db.getMasterConfig()');
				if (data.master_config) {
					assert.ok(config.accounts.some(a => a.id === 'acc_export'));
					await settings(receiver, 'accounts');
					assert.ok((await receiver.textContent('#master-accounts-list')).includes('出力固有口座'));
				}
				if (data.master_config || data.annual_budgets) {
					assert.equal(config.annual_budgets['2027'].expense_budget, 123000);
					await settings(receiver);
					await receiver.fill('#setting-budget-year', '2027');
					assert.equal(await value(receiver, '#setting-expense-budget'), '123000');
				}
				if (data.summary_snapshot) {
					const snapshot = await receiver.evaluate('window.__yose_app.db.getSnapshot()');
					assert.equal(snapshot.monthly_summaries['2026-08'].expense_total, 200);
					assert.equal(snapshot.monthly_summaries['2026-08'].income_total, 1000);
					await cashflow(receiver);
					assert.equal(await receiver.evaluate('Array.from(document.querySelectorAll("#breakdown-table-container tbody tr")).find(r => r.cells[0].textContent.includes("2026-08")).cells[2].textContent.trim()'), '¥200');
					await receiver.click('#control-granularity [data-granularity="yearly"]');
					assert.equal(await receiver.textContent('#stat-expense'), data.transactions ? '¥300' : '¥200');
				}
				assert.deepEqual(receiver.pageErrors, []);
			} finally {
				await receiver.close();
			}
		});
	}

	it('merges file transactions by timestamp while preserving local-only records and reporting counts', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('newer_local'), transaction('older_local'), transaction('local_only')]);
		await settings(d);
		await d.importFile(JSON.stringify({ export_type: 'transactions', schema_version: 2, transactions: [
			transaction('newer_local', { amount: 1, updated_at: '2026-10-19T00:00:00Z' }),
			transaction('older_local', { amount: 999, updated_at: '2026-10-21T00:00:00Z' }),
			transaction('imported')
		] }));
		await waitForDialog(d, '取引明細差分ORマージ完了');
		const txs = await records(d);
		assert.equal(txs.length, 4);
		assert.equal(txs.find(t => t.id === 'newer_local').amount, 100);
		assert.equal(txs.find(t => t.id === 'older_local').amount, 999);
		assert.ok(txs.some(t => t.id === 'local_only'));
		assert.ok((await dialogs(d)).at(-1).message.includes('追加 1件 / 更新 1件 / スキップ 1件'));
	});

	it('imports a raw transaction array and reflects it immediately in recent transactions', async () => {
		const d = fixture.driver;
		await settings(d);
		await d.importFile(JSON.stringify([transaction('raw_array', { memo: '配列形式メモ' })]));
		await waitForDialog(d, '取引明細差分ORマージ完了');
		await d.click('.tab-btn[data-tab="tab-input"]');
		assert.ok((await d.textContent('#recent-tx-list')).includes('配列形式メモ'));
	});

	for (const [name, text] of [
		['broken JSON', '{broken'],
		['unsupported schema', JSON.stringify({ schema_version: 99, transactions: [] })],
		['null payload', 'null'],
		['unknown payload', '{}'],
		['wrong transaction shape', '{"export_type":"transactions","transactions":{}}']
	]) {
		it(`rejects ${name} with an error, keeps existing data, and resets the file input`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('preserved')]);
			await settings(d);
			await d.importFile(text);
			assert.ok((await dialogs(d)).at(-1).message.includes('インポート失敗'));
			assert.deepEqual((await records(d)).map(t => t.id), ['preserved']);
			assert.equal(await value(d, '#file-import-input'), '');
		});
	}

	it('escapes imported category icons, names, IDs, and recurring / holiday fields in every visible list', async () => {
		const d = fixture.driver;
		const payload = '<img src=x onerror="window.__importXss=1">';
		const maliciousId = `id_\">${payload}`;
		await settings(d, 'categories');
		await d.importFile(JSON.stringify({ schema_version: 2, export_type: 'master_config', master_config: {
			accounts: [{ id: maliciousId, name: payload, type: 'bank', is_asset: true, initial_balance: 0 }],
			categories: [{ id: maliciousId, name: payload, type: 'expense', icon: payload, subcategories: [{ id: maliciousId, name: payload }] }],
			recurring_rules: [{ id: maliciousId, name: payload, is_active: false, day_of_month: 27, amount: 100, type: 'expense', account_id: 'acc_wallet' }],
			holidays: ['2027-01-01'],
			annual_budgets: { '2026': { expense_budget: 1000, category_budgets: { [maliciousId]: 1000 } } }
		} }));
		await waitForDialog(d, 'マスタ設定差分ORマージ完了');
		await d.waitFor('document.querySelectorAll(".input-cat-budget").length === 4');
		assert.equal(await d.evaluate('Boolean(window.__importXss)'), false);
		assert.equal(await d.evaluate('document.querySelectorAll("#tab-settings img").length'), 0);
		assert.ok((await d.textContent('#master-categories-list')).includes(payload));
		await d.click('.tab-btn[data-analytics-target="budget"]');
		assert.equal(await d.evaluate('Boolean(window.__importXss) || !!document.querySelector("#budget-category-progress-container img")'), false);
	});

	it('creates, edits, archives, and restores subcategories through actual modal buttons', async () => {
		const d = fixture.driver;
		await settings(d, 'categories');
		await d.click('.btn-add-subcat[data-id="cat_food"]');
		await d.fill('#m-sub-id', 'sub_ui');
		await d.fill('#m-sub-name', '追加内訳');
		await submit(d, '#form-master-subcategory');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active") && document.querySelector(".btn-edit-subcat[data-sub-id=sub_ui]") !== null');
		await d.click('.btn-edit-subcat[data-sub-id="sub_ui"]');
		assert.equal(await d.evaluate('document.getElementById("m-sub-id").readOnly'), true);
		await d.fill('#m-sub-name', '変更内訳');
		await submit(d, '#form-master-subcategory');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active") && document.getElementById("master-categories-list").textContent.includes("変更内訳")');
		await d.click('.btn-archive-subcat[data-sub-id="sub_ui"]');
		await d.click('.tab-btn[data-tab="tab-input"]');
		assert.equal(await d.evaluate('Array.from(document.getElementById("select-subcategory").options).some(o => o.value === "sub_ui")'), false);
		await settings(d, 'categories');
		await d.click('.btn-archive-subcat[data-sub-id="sub_ui"]');
		await d.click('.tab-btn[data-tab="tab-input"]');
		assert.equal(await d.evaluate('Array.from(document.getElementById("select-subcategory").options).some(o => o.value === "sub_ui" && o.textContent === "変更内訳")'), true);
	});

	it('creates an insurance account with a recurring premium and deactivates it on archive', async () => {
		const d = fixture.driver;
		await settings(d, 'accounts');
		await d.click('#btn-add-account');
		await d.fill('#m-acc-id', 'acc_insurance_ui');
		await d.fill('#m-acc-name', '積立保険');
		await d.select('#m-acc-type', 'insurance');
		assert.equal(await d.isVisible('#m-acc-insurance-fields'), true);
		assert.equal(await d.isVisible('#m-acc-cc-fields'), false);
		await d.fill('#m-acc-maturity-date', '2030-03-31');
		await d.fill('#m-acc-premium-amount', '12000');
		await d.select('#m-acc-premium-pay-account', 'acc_bank_main');
		await d.select('#m-acc-premium-cat', 'cat_housing');
		await submit(d, '#form-master-account');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active") && document.querySelector(".btn-edit-account[data-id=acc_insurance_ui]") !== null');
		let config = await d.evaluate('window.__yose_app.db.getMasterConfig()');
		let rule = config.recurring_rules.find(r => r.id === 'rec_ins_acc_insurance_ui');
		assert.equal(rule.amount, 12000);
		assert.equal(rule.end_date, '2030-03-31');
		assert.equal(rule.is_active, true);
		await d.click('.btn-archive-account[data-id="acc_insurance_ui"]');
		config = await d.evaluate('window.__yose_app.db.getMasterConfig()');
		rule = config.recurring_rules.find(r => r.id === 'rec_ins_acc_insurance_ui');
		assert.equal(rule.is_active, false);
		await d.click('.btn-archive-account[data-id="acc_insurance_ui"]');
		config = await d.evaluate('window.__yose_app.db.getMasterConfig()');
		assert.equal(config.recurring_rules.find(r => r.id === 'rec_ins_acc_insurance_ui').is_active, true);
	});

	it('edits, pauses, resumes, cancels deletion, and deletes recurring rules', async () => {
		const d = fixture.driver;
		await settings(d, 'recurring');
		await d.click('.btn-edit-recurring[data-id="rec_rent"]');
		await d.fill('#m-rec-name', '変更家賃');
		await d.fill('#m-rec-amount', '80000');
		await submit(d, '#form-master-recurring');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active") && document.getElementById("master-recurring-list").textContent.includes("変更家賃")');
		await d.click('.btn-toggle-recurring[data-id="rec_rent"]');
		assert.equal((await d.evaluate('window.__yose_app.db.getMasterConfig()')).recurring_rules[0].is_active, false);
		await d.click('.btn-toggle-recurring[data-id="rec_rent"]');
		await d.setConfirm(false);
		await d.click('.btn-delete-recurring[data-id="rec_rent"]');
		assert.equal((await d.evaluate('window.__yose_app.db.getMasterConfig()')).recurring_rules.length, 1);
		await d.setConfirm(true);
		await d.click('.btn-delete-recurring[data-id="rec_rent"]');
		await d.waitFor('!document.querySelector(".btn-edit-recurring")');
	});

	it('imports holidays, deduplicates, rejects invalid text, and removes an expanded holiday', async () => {
		const d = fixture.driver;
		await settings(d, 'holidays');
		await d.click('#btn-add-holiday');
		await waitForDialog(d, '日付を選択');
		await d.click('#btn-open-holiday-modal');
		await d.fill('#txt-holiday-import-input', 'invalid');
		await d.click('#btn-confirm-import-holidays');
		await waitForDialog(d, '有効な日付が見つかりません');
		assert.equal(await d.isVisible('#modal-holiday-import'), true);
		await d.fill('#txt-holiday-import-input', '2027/01/01,元日\n2027-01-01\n2027-02-11');
		await d.click('#btn-confirm-import-holidays');
		await waitForDialog(d, '新規に 2 件');
		const config = await d.evaluate('window.__yose_app.db.getMasterConfig()');
		assert.equal(config.holidays.filter(h => h === '2027-01-01').length, 1);
		await d.click('#master-holidays-list details:last-child summary');
		await d.click('.btn-del-holiday[data-date="2027-02-11"]');
		assert.equal((await d.evaluate('window.__yose_app.db.getMasterConfig()')).holidays.includes('2027-02-11'), false);
	});

	it('tracks OS theme changes, keeps a fixed preference, and persists it after reload', async () => {
		const d = fixture.driver;
		await settings(d);
		await d.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, d.sessionId);
		await d.waitFor('document.documentElement.dataset.theme === "dark"');
		await d.click('#theme-radio-light');
		assert.equal(await d.evaluate('document.documentElement.dataset.theme'), 'light');
		await d.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] }, d.sessionId);
		await d.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }, d.sessionId);
		assert.equal(await d.evaluate('document.documentElement.dataset.theme'), 'light');
		await d.navigate();
		assert.equal(await d.evaluate('document.documentElement.dataset.theme'), 'light');
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('window.__yose_app._domInitialized && document.getElementById("auth-screen").classList.contains("hidden")');
		assert.equal((await d.evaluate('window.__yose_app.db.getMasterConfig()')).theme, 'light');
	});

	it('checks current, newer, invalid, HTTP-error, and offline version states with usable dismissal', async () => {
		const d = fixture.driver;
		await settings(d);
		await d.click('#btn-check-app-update');
		await d.waitFor('document.getElementById("update-status-msg").textContent.includes("最新バージョン")');
		d.responses.set('/version.json', { json: { version: '99.0.0' } });
		await d.click('#btn-check-app-update');
		await d.waitFor('document.getElementById("modal-app-update").classList.contains("active")');
		assert.equal(await d.textContent('#modal-new-version-text'), 'v99.0.0');
		await d.click('#btn-dismiss-app-update');
		assert.equal(await d.isVisible('#modal-app-update'), false);
		d.responses.set('/version.json', { json: { version: '<img src=x>' } });
		await d.click('#btn-check-app-update');
		await d.waitFor('document.getElementById("update-status-msg").textContent.includes("invalid_server_version")');
		d.responses.set('/version.json', { status: 503 });
		await d.click('#btn-check-app-update');
		await d.waitFor('document.getElementById("update-status-msg").textContent.includes("http_error")');
		await d.send('Network.enable', {}, d.sessionId);
		await d.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, d.sessionId);
		await d.waitFor('document.getElementById("network-badge").textContent === "Offline"');
		await d.click('#btn-check-app-update');
		await d.waitFor('document.getElementById("update-status-msg").textContent.includes("オフライン")');
	});

	it('reports unconfigured unified sync and month-close errors without disabling controls', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('unsynced')]);
		await d.click('#btn-header-sync');
		await waitForDialog(d, '同期に失敗');
		await settings(d);
		assert.equal(await d.evaluate('document.getElementById("btn-sync-master")'), null);
		assert.equal(await d.evaluate('document.getElementById("btn-fetch-remote")'), null);
		await d.click('#btn-manual-sync');
		assert.equal(await d.evaluate('document.getElementById("btn-manual-sync").disabled'), false);
		await cashflow(d);
		await d.click('#btn-close-month');
		await waitForDialog(d, '月締めに失敗');
		assert.equal(await d.evaluate('document.getElementById("btn-close-month").disabled'), false);
	});
	it('calculates annual defaults, filters categories, previews discrepancies, and keeps each year independent', async () => {
		const d = fixture.driver;
		await seed(d, [
			transaction('prev_expense', { date: '2025-10-01', target_month: '2025-10', amount: 12345 }),
			transaction('prev_income', { date: '2025-10-01', target_month: '2025-10', amount: 100000, type: 'income', category_id: 'cat_income_main', actual_category_id: 'cat_income_main' })
		]);
		await settings(d);
		await d.click('#btn-budget-auto-calc');
		await waitForDialog(d, '推奨予算値');
		assert.equal(await value(d, '#setting-expense-budget'), '12000');
		assert.equal(await value(d, '.input-cat-budget[data-cat-id="cat_food"]'), '12000');
		await d.fill('#setting-expense-budget', '24000');
		await d.fill('.input-cat-budget[data-cat-id="cat_food"]', '12000');
		assert.ok((await d.textContent('#budget-monthly-preview')).includes('¥2,000'));
		await d.fill('#input-budget-cat-search', '食費');
		assert.equal(await d.evaluate('Array.from(document.querySelectorAll(".budget-cat-item")).filter(el => el.checkVisibility()).length'), 1);
		await d.click('#btn-save-annual-budget');
		await waitForDialog(d, '2026年の年間予算');
		await d.fill('#setting-budget-year', '2027');
		assert.equal(await value(d, '#setting-expense-budget'), '');
		await d.fill('#setting-budget-year', '2026');
		assert.equal(await value(d, '#setting-expense-budget'), '24000');
		await d.click('.tab-btn[data-analytics-target="budget"]');
		assert.ok((await d.textContent('#stat-budget-expense')).includes('¥24,000'));
	});

	it('persists same-month credit-card debit offsets when editing the account', async () => {
		const d = fixture.driver;
		await settings(d, 'accounts');
		await d.click('.btn-edit-account[data-id="acc_card_a"]');
		await d.select('#m-acc-debit-offset', '0');
		await submit(d, '#form-master-account');
		await d.waitFor('!document.getElementById("modal-master-item").classList.contains("active")');
		const config = await d.evaluate('window.__yose_app.db.getMasterConfig()');
		assert.equal(config.accounts.find(a => a.id === 'acc_card_a').debit_month_offset, 0);
		await d.click('.btn-edit-account[data-id="acc_card_a"]');
		assert.equal(await value(d, '#m-acc-debit-offset'), '0');
	});

	it('changes the PIN without changing keys or data and rejects the old PIN', async () => {
		const d = fixture.driver;
		await seed(d, [transaction('pin_persist')]);
		await settings(d);
		await d.click('#btn-toggle-key-details');
		const publicKey = await value(d, '#txt-public-key');
		await d.fill('#input-pin', '12');
		await d.click('#btn-save-pin');
		await waitForDialog(d, '4桁以上');
		await d.fill('#input-pin', '5678');
		await d.click('#btn-save-pin');
		await waitForDialog(d, '正常に更新');
		await d.click('#btn-lock-now');
		await d.fill('#auth-pin-input', '1234');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-error-msg").textContent.includes("正しくありません")');
		await d.fill('#auth-pin-input', '5678');
		await d.click('#btn-auth-pin');
		await d.waitFor('document.getElementById("auth-screen").classList.contains("hidden")');
		assert.equal((await records(d))[0].id, 'pin_persist');
		assert.equal(await value(d, '#txt-public-key'), publicKey);
	});

	for (const [label, invalid] of [
		['transaction tags', { transactions: [transaction('valid_first'), transaction('invalid_second', { tags: {} })] }],
		['subcategory array', { master_config: { accounts: [{ id: 'must_not_be_saved', name: '未保存', type: 'bank' }], categories: [{ id: 'invalid', name: '不正', type: 'expense', subcategories: {} }] } }],
		['master account array', { master_config: { accounts: {} } }],
		['snapshot map', { transactions: [transaction('must_not_be_saved')], summary_snapshot: { monthly_summaries: [] } }]
	]) {
		it(`rejects invalid nested ${label} before any partial writes`, async () => {
			const d = fixture.driver;
			await seed(d, [transaction('preserved')]);
			await settings(d);
			const before = await d.evaluate('window.__yose_app.db.exportFullData()');
			await d.importFile(JSON.stringify({ schema_version: 2, ...invalid }));
			assert.ok((await dialogs(d)).at(-1).message.includes('インポート失敗'));
			const after = await d.evaluate('window.__yose_app.db.exportFullData()');
			assert.deepEqual(after, before);
		});
	}

	for (const field of ['initial_balance', 'amount', 'expense_total']) {
		it(`rejects markup in numeric ${field} before writes and never executes it`, async () => {
			const d = fixture.driver;
			const payload = '<img src=x onerror="window.__numericXss=1">';
			const data = field === 'initial_balance'
				? { master_config: { accounts: [{ id: 'numeric_bad', name: '不正口座', type: 'bank', initial_balance: payload }] } }
				: field === 'amount'
					? { master_config: { recurring_rules: [{ id: 'numeric_bad', name: '不正ルール', type: 'expense', amount: payload, day_of_month: 27, is_active: false }] } }
					: { summary_snapshot: { monthly_summaries: { '2026-08': { income_total: 1000, expense_total: payload } } } };
			await settings(d);
			const before = await d.evaluate('window.__yose_app.db.exportFullData()');
			await d.importFile(JSON.stringify({ schema_version: 2, transactions: [transaction('must_not_be_saved')], ...data }));
			assert.ok((await dialogs(d)).at(-1).message.includes('インポート失敗'));
			assert.equal(await d.evaluate('Boolean(window.__numericXss)'), false);
			assert.deepEqual(await d.evaluate('window.__yose_app.db.exportFullData()'), before);
		});
	}

	it('opens current master values even if the rendered row still holds an older record', async () => {
		const d = fixture.driver;
		await settings(d, 'accounts');
		await d.evaluate(`(async () => {
			const config = await window.__yose_app.db.getMasterConfig();
			config.accounts.find(a => a.id === 'acc_card_a').debit_month_offset = 0;
			await window.__yose_app.db.saveMasterConfig(config);
		})()`);
		await d.click('.btn-edit-account[data-id="acc_card_a"]');
		assert.equal(await value(d, '#m-acc-debit-offset'), '0');
	});

	for (const badValue of [null, { total: '<img src=x>' }]) {
		it(`rejects an invalid nested category summary ${JSON.stringify(badValue)} before writes`, async () => {
			const d = fixture.driver;
			await settings(d);
			const before = await d.evaluate('window.__yose_app.db.exportFullData()');
			await d.importFile(JSON.stringify({ schema_version: 2, transactions: [transaction('not_saved')], summary_snapshot: { monthly_summaries: { '2026-08': { income_total: 0, expense_total: 200, by_category: { cat_food: 100, cat_housing: badValue }, by_actual_category: { cat_food: badValue } } } } }));
			assert.ok((await dialogs(d)).at(-1).message.includes('インポート失敗'));
			assert.deepEqual(await d.evaluate('window.__yose_app.db.exportFullData()'), before);
		});
	}

});
