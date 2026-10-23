/** Existing advance/repayment relationships. Only the repayment owns the reference. */
export const isAdvanceSource = tx => tx?.type === 'transfer' && tx.to_account_id === 'acc_receivable' && tx.account_id !== 'acc_receivable';
const known = tx => tx && !tx.is_deleted && tx.status === 'confirmed' && !tx.amount_pending && Number.isSafeInteger(tx.amount) && tx.amount > 0 && !tx.amortization_meta && !tx.auto_settlement_meta;
export const linkedRepayment = (id, records) => records.find(tx => !tx.is_deleted && tx.advance_source_id === id);

export function isRepaymentCandidate(tx, config) {
	if (!known(tx) || tx.advance_source_id != null) return false;
	if (tx.type === 'transfer') return tx.account_id === 'acc_receivable' && tx.to_account_id !== 'acc_receivable';
	return tx.type === 'income' && config.accounts.some(account => account.id === tx.account_id && !account.is_archived && account.id !== 'acc_receivable');
}

export function advanceLinkCandidates(record, records, config) {
	if (!known(record)) return [];
	if (isAdvanceSource(record)) {
		if (linkedRepayment(record.id, records)) return [];
		return records.filter(tx => tx.id !== record.id && tx.amount === record.amount && isRepaymentCandidate(tx, config));
	}
	if (!isRepaymentCandidate(record, config)) return [];
	return records.filter(tx => tx.id !== record.id && known(tx) && isAdvanceSource(tx) && tx.amount === record.amount && !linkedRepayment(tx.id, records));
}

export function buildAdvanceLink(source, repayment, records, config, approvedMonths = []) {
	if (!known(source) || !isAdvanceSource(source) || !advanceLinkCandidates(source, records, config).some(tx => tx.id === repayment.id)) throw new Error('ひも付けには、同額で確定済みの立替と未関連の回収明細が必要です。');
	const changed = { ...repayment, advance_source_id: source.id, reclose_approved_months: approvedMonths };
	if (changed.type === 'income') Object.assign(changed, { type: 'transfer', account_id: 'acc_receivable', to_account_id: repayment.account_id, category_id: null, subcategory_id: null, actual_category_id: null, actual_subcategory_id: null, tax_meta: null });
	return [...(source.settlement_status === 'settled' ? [{ ...source, settlement_status: 'unsettled', reclose_approved_months: approvedMonths }] : []), changed];
}
