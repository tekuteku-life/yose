/** 保有商品の取得原価は直近記録、口座評価は日末観測と後続入出金の参考値である。 */
export function investmentAtDate(account, transactions, date, snapshot, options = {}) {
	const observationDate = Object.keys(account.investment_history || {}).filter(day => day <= date).sort().at(-1);
	const observation = account.investment_history?.[observationDate];
	// 観測当日は既知であり、それ以外の再構成は全archive取得の証拠を必要とする。
	const complete = observationDate === date || !snapshot.last_closed_month || options.historyComplete === true;
	const acquisitionCost = observation?.acquisition_cost ?? null;
	let valuation = complete && observation ? observation.market_value : null;
	for (const tx of transactions) {
		if (tx.is_deleted || tx.status !== 'confirmed' || tx.amount_pending || tx.date > date || (observationDate && tx.date <= observationDate)) continue;
		const out = tx.account_id === account.id, into = tx.to_account_id === account.id;
		const flow = tx.type === 'transfer' ? (Number(into) - Number(out)) * tx.amount : out ? (tx.type === 'income' ? tx.amount : -tx.amount) : 0;
		if (valuation !== null) valuation += flow;
	}
	return { acquisitionCost, valuation };
}

export function applyInvestmentValuations(balances, accounts, transactions, date, snapshot, options = {}) {
	const result = { ...balances };
	for (const account of accounts.filter(a => a.type === 'investment')) {
		const value = investmentAtDate(account, transactions, date, snapshot, options).valuation;
		if (value !== null) result[account.id] = value;
	}
	return result;
}
