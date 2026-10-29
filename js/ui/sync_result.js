const labels = {
	accounts: '口座', categories: '費目・内訳', recurring_rules: '定期予定', holidays: '祝日',
	annual_budgets: '年度予算・税設定', investment_history: '投資評価記録',
	point_payment_defaults: 'ポイント相殺設定', summary_snapshot: '月締め情報'
};

/** Produce plain text shared by manual and background synchronization results. */
export function formatSyncResult(result, error = null) {
	if (!result) return error ? `同期に失敗しました: ${error}` : '';
	const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
	const totals = `送信 ${count(result.synced_count)} 件 / 受信 ${count(result.downloaded_count)} 件 / 未同期 ${count(result.pending_count)} 件`;
	const status = result.status;
	let title;
	if (error || status === 'failed') title = `同期に失敗しました: ${error || result.error || '結果を確認してください。'}\n完了済み: ${totals}`;
	else if (status === 'already_syncing' || status === 'syncing') return '同期処理中です。完了をお待ちください。';
	else if (status === 'master_conflict_cancelled') title = `設定の競合確認を取り消しました。今回の競合を上書きせず、手元とサーバーの設定を保持しています。\n完了済み: ${totals}`;
	else if (status === 'master_conflict') title = `${result.reason === 'local_changed' ? '確認中に手元の設定が変更されました。変更を保持しています。もう一度同期して最新の内容を比較してください。' : '設定の競合があるため、確認待ちです。手元とサーバーの設定を保持しています。'}\n完了済み: ${totals}`;
	else if (status === 'approval_required') title = `再月締めは未実行です。手元の変更は未同期として保持しています。\n完了済み: ${totals}`;
	else title = `差分同期完了: ${totals}`;
	const describe = direction => Object.entries(labels).flatMap(([field, label]) => count(result.changes?.[direction]?.[field]) ? [`${label} ${count(result.changes[direction][field])}件`] : []).join('、');
	const sent = describe('sent'), received = describe('received');
	const unknownImport = result.import_completed && result.import_changes_unknown;
	const lines = [title];
	if (sent || received || !unknownImport) {
		lines.push(`送信した業務項目: ${sent || (unknownImport ? '確認できた項目なし' : '変更なし')}`, `受信した業務項目: ${received || (unknownImport ? '確認できた項目なし' : '変更なし')}`);
	}
	if (unknownImport) lines.push('完全取込を送信済み（変更項目の内訳は確認できません）');
	if (result.pending_master) lines.push('設定が未同期です。確認待ち・送信待ちの内容を確認してください。');
	return lines.join('\n');
}
