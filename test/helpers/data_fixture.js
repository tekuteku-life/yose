/** Complete Schema v2 transaction data for older tests that focus on unrelated behavior. */
export function transactionFixture(record) {
	const targetMonth = record.target_month || record.date?.slice(0, 7) || '2026-10';
	const type = record.type || 'expense';
	const category = type === 'transfer' ? null : type === 'income' ? 'cat_income_main' : 'cat_food';
	return {
		date: record.date || `${targetMonth}-15`, target_month: targetMonth,
		type, status: 'confirmed', amount: 0, account_id: 'acc_wallet',
		...(type === 'transfer' ? { to_account_id: 'acc_bank_main' } : {}),
		category_id: category, subcategory_id: null,
		actual_category_id: record.category_id === undefined ? category : record.category_id,
		actual_subcategory_id: null, ...record
	};
}
