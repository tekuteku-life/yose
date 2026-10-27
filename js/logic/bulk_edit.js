const DESCRIPTION = ['memo', 'tags'];
const FINANCIAL = ['date', 'target_month', 'status', 'amount', 'account_id'];
const CLASSIFICATION = ['category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id'];
const ALL_FIELDS = [...DESCRIPTION, ...FINANCIAL, 'to_account_id', ...CLASSIFICATION];
const typeNames = { expense: '支出', income: '収入', transfer: '振替' };

const recordLabel = tx => `明細「${tx.id}」${tx.date ? `（${tx.date}）` : ''}`;
const hasReference = value => value !== undefined && value !== null && value !== '';
function financialRoles(tx) {
	const roles = [];
	if (tx.amortization_meta) roles.push('前払の親支払・配賦');
	if (tx.auto_settlement_meta) roles.push('カード自動精算');
	if (tx.is_advance_split) roles.push('立替分割');
	if (tx.is_point_split) roles.push('ポイント分割');
	if (tx.account_id === 'acc_receivable' || tx.to_account_id === 'acc_receivable') roles.push('立替・回収');
	if (tx.account_id === 'acc_prepaid' || tx.to_account_id === 'acc_prepaid') roles.push('前払口座');
	if (hasReference(tx.advance_source_id)) roles.push('立替回収のひも付け');
	if (hasReference(tx.related_tx_id)) roles.push('明示的な関連ID');
	return roles;
}

export function bulkEditCapabilities(selected, transactions) {
	const reasons = {};
	if (!selected.length || selected.some(tx => tx.is_deleted)) {
		const causes = selected.filter(tx => tx.is_deleted).map(tx => `${recordLabel(tx)}は削除済みである`);
		for (const field of ALL_FIELDS) reasons[field] = causes.length ? causes.slice() : ['編集する明細が選択されていない'];
		return { fields: [], reasons };
	}
	const records = new Map(transactions.filter(tx => !tx.is_deleted).map(tx => [tx.id, tx]));
	for (const tx of selected) if (!records.has(tx.id)) records.set(tx.id, tx);
	const referencedBy = new Map(), roles = new Map(), groups = new Map();
	for (const tx of records.values()) for (const field of ['advance_source_id', 'related_tx_id']) if (hasReference(tx[field])) {
		if (!referencedBy.has(tx[field])) referencedBy.set(tx[field], []);
		referencedBy.get(tx[field]).push(`${recordLabel(tx)}から参照される${field === 'advance_source_id' ? '立替回収連携' : '明示的な関連'}`);
	}
	for (const tx of records.values()) {
		const ownRoles = [...financialRoles(tx), ...(referencedBy.get(tx.id) || [])];
		roles.set(tx.id, ownRoles);
		if (ownRoles.length && tx.group_id) {
			if (!groups.has(tx.group_id)) groups.set(tx.group_id, []);
			groups.get(tx.group_id).push({ tx, roles: ownRoles });
		}
	}
	const relatedReasons = [];
	for (const tx of selected) {
		for (const role of roles.get(tx.id)) relatedReasons.push(`${recordLabel(tx)}は${role}のため関連明細として保護する`);
		for (const other of groups.get(tx.group_id) || []) if (other.tx.id !== tx.id) relatedReasons.push(`${recordLabel(tx)}と同じグループに${recordLabel(other.tx)}（${other.roles.join('・')}）があるため関連明細として保護する`);
	}
	const financialReasons = [...new Set(relatedReasons)];
	const fields = [...DESCRIPTION];
	if (!financialReasons.length) {
		fields.push(...FINANCIAL);
		if (selected.every(tx => tx.type === selected[0].type)) fields.push(...(selected[0].type === 'transfer' ? ['to_account_id'] : CLASSIFICATION));
	}
	for (const field of ALL_FIELDS) if (!fields.includes(field)) {
		if (financialReasons.length) reasons[field] = financialReasons.slice();
		else reasons[field] = selected.map(tx => `${recordLabel(tx)}は${typeNames[tx.type]}である。${field === 'to_account_id' ? '振替先口座は振替だけを選択した場合に変更できる' : '費目・内訳は同じ収支種別の通常収支だけを選択した場合に変更できる'}`);
	}
	return { fields, reasons };
}

export function bulkEditableFields(selected, transactions) {
	return bulkEditCapabilities(selected, transactions).fields;
}

export function buildBulkEdit(selected, patch, transactions) {
	const fields = bulkEditableFields(selected, transactions);
	if (!selected.length || !Object.keys(patch).length) throw new Error('明細と変更する項目を選択してください。');
	if (selected.some(tx => tx.is_deleted) || Object.keys(patch).some(field => !fields.includes(field))) throw new Error('選択明細すべてに適用できない項目が含まれています。');
	const own = field => Object.hasOwn(patch, field);
	if (own('amount') && (!Number.isSafeInteger(patch.amount) || patch.amount < 0)) throw new Error('金額は0以上の整数で入力してください。');
	if (own('memo') && typeof patch.memo !== 'string') throw new Error('メモは文字列で入力してください。');
	if (own('tags') && (!Array.isArray(patch.tags) || patch.tags.some(tag => typeof tag !== 'string'))) throw new Error('タグを確認してください。');
	if (own('status') && !['planned', 'confirmed'].includes(patch.status)) throw new Error('状態を確認してください。');
	if (own('date') && (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date) || !Number.isFinite(Date.parse(patch.date)) || new Date(patch.date).toISOString().slice(0, 10) !== patch.date)) throw new Error('日付を確認してください。');
	if (own('target_month') && !/^\d{4}-(0[1-9]|1[0-2])$/.test(patch.target_month)) throw new Error('計上月を確認してください。');
	return selected.map(original => {
		const updated = { ...structuredClone(original), ...structuredClone(patch) };
		for (const prefix of ['', 'actual_']) if (own(`${prefix}category_id`) && !own(`${prefix}subcategory_id`) && patch[`${prefix}category_id`] !== original[`${prefix}category_id`]) updated[`${prefix}subcategory_id`] = null;
		if (own('amount')) { updated.amount_pending = false; if (updated.amount !== original.amount || original.amount_pending) updated.tax_meta = null; }
		if (updated.amount_pending && updated.status === 'confirmed') throw new Error('金額未入力の明細は金額も指定してから確定してください。');
		return updated;
	});
}
