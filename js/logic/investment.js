/** 日末観測と、観測後に発生した確定入出金だけを組み合わせる。 */
export function investmentAtDate(account, transactions, date, snapshot, options = {}) {
	const observationDate = Object.keys(account.investment_history || {}).filter(day => day <= date).sort().at(-1);
	const observation = account.investment_history?.[observationDate];
	// 観測当日は既知であり、それ以外の再構成は全archive取得の証拠を必要とする。
	const complete = observationDate === date || !snapshot.last_closed_month || options.historyComplete === true;
	let invested = complete && (observation || !Number(account.initial_balance)) ? observation?.invested_amount ?? 0 : null;
	let valuation = complete && observation ? observation.market_value : null;
	for (const tx of transactions) {
		if (tx.is_deleted || tx.status !== 'confirmed' || tx.amount_pending || tx.date > date || (observationDate && tx.date <= observationDate)) continue;
		const out = tx.account_id === account.id, into = tx.to_account_id === account.id;
		const flow = tx.type === 'transfer' ? (Number(into) - Number(out)) * tx.amount : out ? (tx.type === 'income' ? tx.amount : -tx.amount) : 0;
		if (valuation !== null) valuation += flow;
		if (invested !== null && tx.type === 'transfer') invested += flow;
	}
	return { invested, valuation };
}

export function applyInvestmentValuations(balances, accounts, transactions, date, snapshot, options = {}) {
	const result = { ...balances };
	for (const account of accounts.filter(a => a.type === 'investment')) {
		const value = investmentAtDate(account, transactions, date, snapshot, options).valuation;
		if (value !== null) result[account.id] = value;
	}
	return result;
}
