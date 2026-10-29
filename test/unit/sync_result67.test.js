import { it } from 'node:test';
import assert from 'node:assert/strict';
import { formatSyncResult } from '../../js/ui/sync_result.js';

it('reports an entry failure before any attempt result exists', () => {
	assert.equal(formatSyncResult(null, '署名鍵を解除してください'), '同期に失敗しました: 署名鍵を解除してください');
	assert.equal(formatSyncResult(null), '');
});
it('distinguishes a local edit made during conflict approval and retains completed counts', () => {
	const message = formatSyncResult({ status: 'master_conflict', reason: 'local_changed', synced_count: 2, downloaded_count: 3, pending_count: 4 });
	assert.match(message, /確認中に手元の設定が変更/); assert.match(message, /送信 2 件 \/ 受信 3 件 \/ 未同期 4 件/);
	assert.doesNotMatch(message, /差分同期完了/);
});
for (const direction of ['sent', 'received']) it(`keeps confirmed ${direction} fields separate from an acknowledged replacement with unknown details`, () => {
	const message = formatSyncResult({ status: 'synced', import_completed: true, import_changes_unknown: true, changes: { [direction]: { accounts: 2 } } });
	const lines = message.split('\n');
	assert.equal(lines.find(line => line.startsWith(direction === 'sent' ? '送信した' : '受信した')), `${direction === 'sent' ? '送信した' : '受信した'}業務項目: 口座 2件`);
	assert.equal(lines.find(line => line.startsWith(direction === 'sent' ? '受信した' : '送信した')), `${direction === 'sent' ? '受信した' : '送信した'}業務項目: 確認できた項目なし`);
	assert.match(message, /完全取込を送信済み（変更項目の内訳は確認できません）/); assert.doesNotMatch(message, /変更なし/);
});
