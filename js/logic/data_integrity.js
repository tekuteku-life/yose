/** Shared, dependency-free schema and transition checks. Embedded into GAS by script. */
export function createDataIntegrityValidator() {
	const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
	const safeId = value => typeof value === 'string' && value.length > 0 && !['__proto__', 'constructor', 'prototype'].includes(value);
	const month = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
	const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
	const accountTypes = ['bank', 'cash', 'credit_card', 'loan', 'point', 'receivable', 'prepaid', 'investment', 'insurance', 'asset', 'electronic_money'];
	const issues = state => {
		const found = [];
		const issue = (code, path, message, value = null) => {
			const encoded = object(value) || Array.isArray(value) ? JSON.stringify(value) : `${typeof value}:${String(value)}`;
			found.push({ code, path, message: `${path}: ${message}`, fingerprint: JSON.stringify([code, path, encoded]) });
		};
		const scan = (value, path, seen = new Set()) => {
			if (!value || typeof value !== 'object') return;
			if (seen.has(value)) { issue('shape', path, '循環参照は保存できません'); return; }
			seen.add(value);
			for (const [key, child] of Object.entries(value)) {
				if (!safeId(key)) issue('unsafe_key', `${path}.${key}`, '不正なキーです', key);
				scan(child, `${path}.${key}`, seen);
			}
			seen.delete(value);
		};
		scan(state, 'data');
		const list = (value, path) => {
			if (value === undefined) return [];
			if (!Array.isArray(value)) { issue('shape', path, '配列である必要があります', typeof value); return []; }
			return value;
		};
		const number = (value, path, { required = false, integer = false, min = -Infinity, max = Infinity } = {}) => {
			if (value == null && !required) return;
			if (typeof value !== 'number' || !Number.isFinite(value) || (integer && !Number.isSafeInteger(value)) || value < min || value > max) issue('number', path, '数値の形式・範囲が不正です', value);
		};
		const bools = (item, path, fields) => { for (const field of fields) if (item[field] !== undefined && typeof item[field] !== 'boolean') issue('boolean', `${path}.${field}`, '真偽値が必要です', item[field]); };
		const text = (item, path, fields) => { for (const field of fields) if (item[field] != null && typeof item[field] !== 'string') issue('string', `${path}.${field}`, '文字列が必要です', item[field]); };
		const keyed = (value, path) => {
			const map = new Map();
			for (const item of list(value, path)) {
				if (!object(item)) { issue('shape', path, '要素はオブジェクトである必要があります', item); continue; }
				if (!safeId(item.id)) issue('id', `${path}.id`, 'IDが不正です', item.id);
				if (map.has(item.id)) issue('duplicate', `${path}.${item.id}`, 'IDが重複しています', item.id);
				else map.set(item.id, item);
			}
			return map;
		};
		const master = object(state?.master_config) ? state.master_config : {};
		if (state?.master_config != null && !object(state.master_config)) issue('shape', 'master_config', '設定形式が不正です');
		const accounts = keyed(master.accounts, 'accounts');
		const categories = keyed(master.categories, 'categories');
		const rules = keyed(master.recurring_rules, 'recurring_rules');
		const children = new Map();
		for (const [id, item] of categories) children.set(id, keyed(item.subcategories, `categories.${id}.subcategories`));
		const ref = (id, map, path, required = false) => {
			if ((id === undefined || id === null || id === '') && !required) return;
			if (!safeId(id) || !map.has(id)) issue('reference', path, `参照先「${String(id)}」が存在しません`, id);
		};
		const classification = (item, path, expectedType) => {
			for (const prefix of ['', 'actual_']) {
				const cat = item[`${prefix}category_id`], sub = item[`${prefix}subcategory_id`];
				ref(cat, categories, `${path}.${prefix}category_id`);
				ref(sub, children.get(cat) || new Map(), `${path}.${prefix}subcategory_id`);
				if (cat && categories.has(cat) && expectedType && categories.get(cat).type !== expectedType) issue('category_type', `${path}.${prefix}category_id`, '明細種別と費目の収支種別が一致しません', [cat, categories.get(cat).type, expectedType]);
			}
		};
		for (const [id, item] of accounts) {
			const path = `accounts.${id}`;
			if (!accountTypes.includes(item.type)) issue('enum', `${path}.type`, '口座種別が不正です', item.type);
			text(item, path, ['name', 'maturity_date']);
			bools(item, path, ['is_asset', 'is_archived']);
			number(item.initial_balance, `${path}.initial_balance`, { integer: true });
			if (item.investment_history !== undefined) {
				if (item.type !== 'investment' || !object(item.investment_history)) issue('shape', `${path}.investment_history`, '投資口座の日付別記録が必要です');
				else for (const [day, value] of Object.entries(item.investment_history)) {
					const location = `${path}.investment_history.${day}`;
					if (!date(day)) issue('date', location, '評価日が不正です', day);
					if (!object(value)) { issue('shape', location, '拠出額と評価額が必要です'); continue; }
					number(value.invested_amount, `${location}.invested_amount`, { required: true, integer: true });
					number(value.market_value, `${location}.market_value`, { required: true, integer: true, min: 0 });
				}
			}
			number(item.maturity_amount, `${path}.maturity_amount`, { integer: true, min: 0 });
			for (const field of ['debit_account_id', 'settlement_account_id', 'premium_pay_account_id']) ref(item[field], accounts, `${path}.${field}`);
			for (const field of ['debit_account_id', 'settlement_account_id']) if (item[field]) {
				const paying = accounts.get(item[field]);
				if (item[field] === id || (paying && !['bank', 'cash', 'asset'].includes(paying.type))) issue('account_role', `${path}.${field}`, '引落先には別の銀行・現金・資産口座が必要です', item[field]);
			}
			if (item.debit_account_id && item.settlement_account_id && item.debit_account_id !== item.settlement_account_id) issue('account_role', `${path}.debit_account_id`, '引落口座の参照が一致しません', [item.debit_account_id, item.settlement_account_id]);
			for (const field of ['closing_day', 'debit_day']) if (item[field] !== 99) number(item[field], `${path}.${field}`, { integer: true, min: 1, max: 31 });
			number(item.premium_day, `${path}.premium_day`, { integer: true, min: 1, max: 31 });
			number(item.debit_month_offset, `${path}.debit_month_offset`, { integer: true, min: 0, max: 2 });
			number(item.premium_amount, `${path}.premium_amount`, { integer: true, min: 0 });
			ref(item.premium_category_id, categories, `${path}.premium_category_id`);
			ref(item.premium_subcategory_id, children.get(item.premium_category_id) || new Map(), `${path}.premium_subcategory_id`);
			if (item.premium_category_id && categories.get(item.premium_category_id)?.type !== 'expense') issue('category_type', `${path}.premium_category_id`, '保険料には支出費目が必要です', item.premium_category_id);
			if (item.maturity_date != null && item.maturity_date !== '' && !date(item.maturity_date)) issue('date', `${path}.maturity_date`, '日付が不正です', item.maturity_date);
		}
		for (const [id, item] of categories) {
			const path = `categories.${id}`;
			if (!['expense', 'income'].includes(item.type)) issue('enum', `${path}.type`, '費目種別が不正です', item.type);
			text(item, path, ['name', 'icon']); bools(item, path, ['is_archived']);
			for (const [subId, sub] of children.get(id)) { text(sub, `${path}.${subId}`, ['name']); bools(sub, `${path}.${subId}`, ['is_archived']); }
		}
		const validateTransaction = (item, path, recurring = false) => {
			const deleted = !recurring && item.is_deleted === true;
			if ((!deleted || item.type !== undefined) && !['expense', 'income', 'transfer'].includes(item.type)) issue('enum', `${path}.type`, '取引種別が不正です', item.type);
			if (!recurring) {
				if ((!deleted || item.date !== undefined) && !date(item.date)) issue('date', `${path}.date`, '日付が不正です', item.date);
				if ((!deleted || item.target_month !== undefined) && !month(item.target_month)) issue('month', `${path}.target_month`, '計上月が不正です', item.target_month);
				if ((!deleted || item.status !== undefined) && !['confirmed', 'planned'].includes(item.status)) issue('enum', `${path}.status`, '明細状態が不正です', item.status);
				if (item.amount_pending === true && (item.status !== 'planned' || item.amount !== 0)) issue('pending', `${path}.amount_pending`, '金額未入力の明細は金額0の予定である必要があります', [item.status, item.amount]);
				if (item.previous_target_month != null && !month(item.previous_target_month)) issue('month', `${path}.previous_target_month`, '移動元月が不正です', item.previous_target_month);
			}
			number(item.amount, `${path}.amount`, { required: !deleted || item.amount !== undefined, integer: true, min: 0 });
			bools(item, path, ['is_deleted', 'amount_pending', 'is_active', 'is_payment_record', 'is_point_split']);
			text(item, path, ['memo', 'group_id', 'created_at', 'updated_at']);
			if (deleted && (typeof item.updated_at !== 'string' || !Number.isFinite(Date.parse(item.updated_at)))) issue('timestamp', `${path}.updated_at`, '削除記録には有効な更新日時が必要です', item.updated_at);
			for (const field of ['created_at', 'updated_at']) if (item[field] != null && (typeof item[field] !== 'string' || !Number.isFinite(Date.parse(item[field])))) issue('timestamp', `${path}.${field}`, '日時が不正です', item[field]);
			for (const field of ['tax_meta', 'amortization_meta', 'auto_settlement_meta']) if (item[field] != null && !object(item[field])) issue('shape', `${path}.${field}`, '補助情報はオブジェクトである必要があります', item[field]);
			if (item.tags !== undefined && (!Array.isArray(item.tags) || item.tags.some(tag => typeof tag !== 'string'))) issue('shape', `${path}.tags`, 'タグは文字列の配列である必要があります', item.tags);
			const amortization = item.amortization_meta;
			if (object(amortization)) {
				const role = amortization.is_payment_record;
				if (role !== undefined && typeof role !== 'boolean') issue('amortization', `${path}.amortization_meta.is_payment_record`, '前払補助情報の役割には真偽値が必要です', role);
				if (item.type !== (role === true ? 'transfer' : 'expense')) issue('amortization', `${path}.amortization_meta.is_payment_record`, '前払親支払は振替、配賦子明細は支出である必要があります', [role, item.type]);
				if (typeof item.group_id !== 'string' || !item.group_id.trim()) issue('amortization', `${path}.group_id`, '前払補助情報には空でないグループIDが必要です', item.group_id);
			}

			if (!item.is_deleted) {
				ref(item.account_id, accounts, `${path}.account_id`, true);
				ref(item.to_account_id, accounts, `${path}.to_account_id`, item.type === 'transfer');
				if (item.type === 'transfer' && item.account_id === item.to_account_id) issue('transfer', `${path}.to_account_id`, '振替元と振替先が同じです', item.to_account_id);
				classification(item, path, ['expense', 'income'].includes(item.type) ? item.type : null);
				const settlement = item.auto_settlement_meta;
				if (object(settlement)) {
					ref(settlement.card_id, accounts, `${path}.auto_settlement_meta.card_id`, true);
					if (accounts.has(settlement.card_id) && accounts.get(settlement.card_id).type !== 'credit_card') issue('account_role', `${path}.auto_settlement_meta.card_id`, '精算先はカード口座である必要があります', settlement.card_id);
					if (item.type !== 'transfer' || item.to_account_id !== settlement.card_id) issue('settlement', `${path}.auto_settlement_meta.card_id`, '精算情報と振替先が一致しません', [item.type, item.to_account_id, settlement.card_id]);
					if (!month(settlement.billing_cycle)) issue('month', `${path}.auto_settlement_meta.billing_cycle`, '請求周期が不正です', settlement.billing_cycle);
					if (settlement.debit_account_id != null) {
						ref(settlement.debit_account_id, accounts, `${path}.auto_settlement_meta.debit_account_id`);
						if (item.account_id !== settlement.debit_account_id) issue('settlement', `${path}.auto_settlement_meta.debit_account_id`, '精算情報と振替元が一致しません', [item.account_id, settlement.debit_account_id]);
					}
				}
			}
		};
		for (const [id, item] of rules) {
			const path = `recurring_rules.${id}`;
			validateTransaction(item, path, true);
			if (item.frequency !== undefined && !['monthly', 'interval_months'].includes(item.frequency)) issue('enum', `${path}.frequency`, '周期が不正です', item.frequency);
			number(item.day_of_month, `${path}.day_of_month`, { integer: true, min: 1, max: 31 });
			number(item.interval_months, `${path}.interval_months`, { integer: true, min: 1 });
			number(item.amortize_months, `${path}.amortize_months`, { integer: true, min: 1 });
			if (item.holiday_adjustment !== undefined && !['none', 'before', 'after'].includes(item.holiday_adjustment)) issue('enum', `${path}.holiday_adjustment`, '休日調整が不正です', item.holiday_adjustment);
			for (const field of ['start_date', 'end_date']) if (item[field] != null && item[field] !== '' && !date(item[field])) issue('date', `${path}.${field}`, '日付が不正です', item[field]);
			if (item.start_date && item.end_date && item.start_date > item.end_date) issue('date', `${path}.end_date`, '終了日が開始日より前です', [item.start_date, item.end_date]);
			if (item.is_active) {
				for (const field of ['account_id', 'to_account_id']) if (accounts.get(item[field])?.is_archived) issue('archived', `${path}.${field}`, '有効な定期設定にアーカイブ口座は使用できません', item[field]);
				for (const prefix of ['', 'actual_']) {
					if (categories.get(item[`${prefix}category_id`])?.is_archived || children.get(item[`${prefix}category_id`])?.get(item[`${prefix}subcategory_id`])?.is_archived) issue('archived', `${path}.${prefix}category_id`, '有効な定期設定にアーカイブ費目は使用できません', [item[`${prefix}category_id`], item[`${prefix}subcategory_id`]]);
				}
			}
		}
		const transactions = list(state?.transactions, 'transactions');
		const transactionMap = keyed(transactions, 'transactions');
		const natural = new Set(), settlements = new Set(), advanceRepayments = new Set();
		for (const item of transactions) {
			if (!object(item)) continue;
			validateTransaction(item, `transactions.${item.id}`);
			if (!item.is_deleted && item.advance_source_id !== undefined && item.advance_source_id !== null) {
				const id = item.advance_source_id, source = transactionMap.get(id);
				const path = `transactions.${item.id}.advance_source_id`;
				const fixed = tx => tx.status === 'confirmed' && !tx.amount_pending && Number.isSafeInteger(tx.amount) && tx.amount > 0 && !tx.amortization_meta && !tx.auto_settlement_meta;
				if (!safeId(id) || id === item.id || item.type !== 'transfer' || item.account_id !== 'acc_receivable' || item.to_account_id === 'acc_receivable' || !fixed(item)) issue('advance_link', path, 'ひも付けには確定済みで金額入力済みの回収振替が必要です。先にひも付けを解除してください', [id, item.type, item.account_id, item.amount, item.status, item.amount_pending]);
				if (source && (source.is_deleted || source.settlement_status === 'settled' || source.type !== 'transfer' || source.to_account_id !== 'acc_receivable' || source.account_id === 'acc_receivable' || source.amount !== item.amount || !fixed(source))) issue('advance_link', path, 'ひも付けた元立替が変更されています。先にひも付けを解除してください', [id, source.type, source.account_id, source.to_account_id, source.amount, source.status, source.is_deleted, source.amount_pending, source.settlement_status]);
				if (advanceRepayments.has(id)) issue('advance_link', path, '同じ立替へのひも付けが重複しています', id);
				advanceRepayments.add(id);
			}
			if (!item.is_deleted && item.recurring_rule_id) {
				const key = JSON.stringify([item.recurring_rule_id, item.target_month]);
				if (natural.has(key)) issue('duplicate_recurring', `transactions.recurring.${key}`, '同じ定期設定と計上月の明細が重複しています', key);
				natural.add(key);
			}
			if (!item.is_deleted && object(item.auto_settlement_meta) && item.auto_settlement_meta.card_id && item.auto_settlement_meta.billing_cycle) {
				const key = JSON.stringify([item.auto_settlement_meta.card_id, item.auto_settlement_meta.billing_cycle]);
				if (settlements.has(key)) issue('duplicate_settlement', `transactions.settlement.${key}`, '同じカードと請求周期の精算明細が重複しています', key);
				settlements.add(key);
			}
		}
		if (master.holidays !== undefined) for (const day of list(master.holidays, 'holidays')) if (!date(day)) issue('date', 'holidays', '祝日の日付が不正です', day);
		if (master.annual_budgets !== undefined && !object(master.annual_budgets)) issue('shape', 'annual_budgets', '予算は年度別のオブジェクトが必要です');
		for (const [year, entry] of Object.entries(object(master.annual_budgets) ? master.annual_budgets : {})) {
			const path = `annual_budgets.${year}`;
			if (!/^\d{4}$/.test(year) || !object(entry)) { issue('shape', path, '年度予算の形式が不正です', year); continue; }
			for (const field of ['expense_budget', 'savings_target_amount']) number(entry[field], `${path}.${field}`, { integer: true, min: 0 });
			if (entry.furusato_estimate !== undefined) {
				const estimate = entry.furusato_estimate;
				if (!object(estimate)) issue('shape', `${path}.furusato_estimate`, '税概算には所得割額と税率が必要です');
				else {
					number(estimate.resident_tax, `${path}.furusato_estimate.resident_tax`, { required: true, integer: true, min: 0 });
					if (![0, 5, 10, 20, 23, 33, 40, 45].includes(estimate.income_tax_rate)) issue('enum', `${path}.furusato_estimate.income_tax_rate`, '特例控除用税率が不正です', estimate.income_tax_rate);
				}
			}
			for (const field of ['savings_target_rate', 'target_savings_rate']) number(entry[field], `${path}.${field}`, { min: 0, max: 100 });
			if (entry.category_budgets !== undefined && !object(entry.category_budgets)) issue('shape', `${path}.category_budgets`, '費目予算の形式が不正です');
			for (const [id, value] of Object.entries(object(entry.category_budgets) ? entry.category_budgets : {})) { ref(id, categories, `${path}.${id}`); number(value, `${path}.${id}`, { integer: true, min: 0 }); }
		}
		const snapshot = state?.summary_snapshot === undefined ? {} : state.summary_snapshot;
		if (!object(snapshot)) issue('shape', 'summary_snapshot', '集計形式が不正です');
		else {
			if (snapshot.last_closed_month != null && !month(snapshot.last_closed_month)) issue('month', 'summary_snapshot.last_closed_month', '締め月が不正です', snapshot.last_closed_month);
			const numberMap = (value, path, refs = null) => {
				if (value === undefined) return;
				if (!object(value)) { issue('shape', path, '数値マップが必要です'); return; }
				for (const [id, amount] of Object.entries(value)) { if (refs) ref(id, refs, `${path}.${id}`); number(amount, `${path}.${id}`, { required: true }); }
			};
			const categoryMap = (value, path) => {
				if (value === undefined) return;
				if (!object(value)) { issue('shape', path, '費目集計マップが必要です'); return; }
				for (const [id, summary] of Object.entries(value)) {
					if (id !== 'cat_unclassified') ref(id, categories, `${path}.${id}`);
					if (typeof summary === 'number') { number(summary, `${path}.${id}`, { required: true }); continue; }
					if (!object(summary)) { issue('shape', `${path}.${id}`, '費目集計が不正です'); continue; }
					for (const field of ['total', 'confirmed', 'planned', 'total_confirmed', 'total_planned']) number(summary[field], `${path}.${id}.${field}`);
					const subs = new Map(children.get(id) || []); subs.set('sub_unclassified', {});
					numberMap(summary.by_subcategory, `${path}.${id}.by_subcategory`, subs);
				}
			};
			numberMap(snapshot.account_balances, 'summary_snapshot.account_balances', accounts);
			if (snapshot.monthly_summaries !== undefined && !object(snapshot.monthly_summaries)) issue('shape', 'summary_snapshot.monthly_summaries', '月別集計マップが必要です');
			for (const [key, summary] of Object.entries(object(snapshot.monthly_summaries) ? snapshot.monthly_summaries : {})) {
				const path = `summary_snapshot.monthly_summaries.${key}`;
				if (!month(key) || !object(summary)) { issue('shape', path, '月別集計の形式が不正です', key); continue; }
				for (const field of ['income_total', 'expense_total', 'net_income', 'income_confirmed', 'expense_confirmed', 'total_income', 'total_expense']) number(summary[field], `${path}.${field}`);
				numberMap(summary.closing_balances, `${path}.closing_balances`, accounts);
				categoryMap(summary.by_category, `${path}.by_category`); categoryMap(summary.by_actual_category, `${path}.by_actual_category`);
			}
			if (snapshot.external_assets !== undefined) for (const item of keyed(snapshot.external_assets, 'external_assets').values()) {
				if (!object(item)) { issue('shape', 'external_assets', '資産の形式が不正です'); continue; }
				text(item, 'external_assets', ['id', 'name', 'updated_at']);
				for (const field of ['amount', 'value', 'balance', 'quantity', 'unit_price', 'market_value', 'current_value']) number(item[field], `external_assets.${field}`);
			}
		}
		return found;
	};
	const assertChange = (before, after, { strict = false, allowArchivedReferences = false } = {}) => {
		const allowed = new Map();
		if (!strict) for (const item of issues(before)) allowed.set(item.fingerprint, (allowed.get(item.fingerprint) || 0) + 1);
		const violations = [];
		for (const item of issues(after)) {
			const count = allowed.get(item.fingerprint) || 0;
			if (count > 0) allowed.set(item.fingerprint, count - 1); else violations.push(item);
		}
		if (!allowArchivedReferences) {
			const rows = value => Array.isArray(value) ? value.filter(object) : [];
			const master = after?.master_config || {}, previous = new Map(rows(before?.transactions).map(tx => [tx.id, tx]));
			const accounts = new Map(rows(master.accounts).map(item => [item.id, item]));
			const categories = new Map(rows(master.categories).map(item => [item.id, item]));
			for (const tx of rows(after?.transactions)) {
				if (!object(tx) || tx.is_deleted) continue;
				const old = previous.get(tx.id);
				for (const field of ['account_id', 'to_account_id', 'category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id']) {
					if (old && !old.is_deleted && old[field] === tx[field]) continue;
					const parent = categories.get(tx[field.startsWith('actual_') ? 'actual_category_id' : 'category_id']);
					const archived = field.endsWith('account_id') ? accounts.get(tx[field])?.is_archived : field.endsWith('subcategory_id') ? parent?.is_archived || rows(parent?.subcategories).find(sub => sub.id === tx[field])?.is_archived : categories.get(tx[field])?.is_archived;
					if (tx[field] && archived) violations.push({ message: `transactions.${tx.id}.${field}: アーカイブされた設定を新たに使用できません` });
				}
			}
		}
		if (violations.length) throw new Error(`データ整合性の検証に失敗しました: ${violations.map(item => item.message).slice(0, 12).join(' / ')}`);
		return after;
	};
	return { issues, assertChange };
}

export const dataIntegrity = createDataIntegrityValidator();
