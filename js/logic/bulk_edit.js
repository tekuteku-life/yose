const DESCRIPTION = ['memo', 'tags'];
const FINANCIAL = ['date', 'target_month', 'status', 'amount', 'account_id'];
const CLASSIFICATION = ['category_id', 'subcategory_id', 'actual_category_id', 'actual_subcategory_id'];

export function bulkEditableFields(selected, transactions) {
	if (!selected.length || selected.some(tx => tx.is_deleted)) return [];
	const related = selected.some(tx => tx.amortization_meta || tx.auto_settlement_meta || tx.is_advance_split || tx.is_point_split || tx.advance_source_id ||
		['acc_receivable', 'acc_prepaid'].includes(tx.account_id) || ['acc_receivable', 'acc_prepaid'].includes(tx.to_account_id) ||
		transactions.some(other => !other.is_deleted && ((tx.group_id && tx.group_id === other.group_id && tx.id !== other.id) || other.advance_source_id === tx.id)));
	if (related) return [...DESCRIPTION];
	const fields = [...DESCRIPTION, ...FINANCIAL];
	if (selected.every(tx => tx.type === selected[0].type)) fields.push(...(selected[0].type === 'transfer' ? ['to_account_id'] : CLASSIFICATION));
	return fields;
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
