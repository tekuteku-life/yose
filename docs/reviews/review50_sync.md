# Review 50: 完全インポートの次回同期反映

## Phase 1 設計

完全インポートは選択した JSON の種別（full_backup、transactions、master_config、annual_budgets、summary_snapshot）だけを丸ごと置換する。DB に暗号化して保存された immutable な pending_import を先に送信し、その成功確認まで通常の受信・送信・月締めを実行しない。取引の完全置換は未締め明細と全 archive を対象とし、対象月が締め済みの明細は同月 archive に配置する。対象外データは維持する。

初回送信前に fetch_state の state_version を取得し、updatePendingImport の CAS で base_version を永続化する。replace_import の CAS が失敗しても基点を自動更新しない。利用者が再確認した場合のみ基点を解除できる。確認後初回取得までのサーバー変更も対象になる旨は確認画面へ明記する。

replace_import は既存 Ed25519 署名検証・ScriptLock 内で動作する。server はデータ種別、必須フィールド、危険キー、有限数値、コレクション・一意 ID、取引の必須値（有効な独立した日付と計上月、非負金額、決済口座、振替時の異なる有効振替先、現行 factory の 3 種 expense/income/transfer に限定する型）、マスタの構造および置換後全体の参照整合性（維持される既存明細を含む口座・費目・親費目配下の中項目、定期ルール、予算の費目ID）を独立検証し、全検証と置換結果の組立てを最初の変更より先に完了する。同じ import_id の同じ種別・データは receipt により再送しても再置換しない。同じ ID の異なるデータは拒否する。

強制終了時の半端な状態を通常読み取りへ公開しないため、永続 redo journal を用いる。journal 本体を専用 sheet に完全保存し読み戻し一致を確認してから、別 sheet の単一セル commit marker を clearContents せず setValues 一回で切り替える。marker がない途中 stage は未承認であり適用しない。marker がある場合は全 action の冒頭で journal を再実行し、全対象 sheet と receipt 保存後に marker を単一セルで解除する。失敗時は marker を残し次回 action で recovery を完遂するまで通常処理を拒否する。receipt の保存中に停止しても journal に receipt 内容を含むため recovery で復元できる。recovery 後は同じ ID を二重適用しない。

クライアントは送信前後の署名鍵・DMK を検証する。ACK は outbox を CAS で削除し、submitted と現在が一致する取込明細のみ synced に変更する。現在の明細内容・設定・集計を上書きしない。送信後の追加編集は unsynced を保持し、続く通常差分同期へ残す。これにより締め済み明細の不要な再送・再月締めで手編集した集計値を失わない。master の同期基点は送信対象の共有 master を基準とし、送信後の local 変更と混同しない。対応 GAS 未更新・通信失敗・CAS 競合・認証ロックでは outbox を保持する。

## Phase 3 テスト観点

- 各 5 種別の完全置換、空配列/空辞書による削除、archive 全体の置換、対象外保持。
- 新しい値でも古い値でも JSON の指定値を正とし、同じ ID を上書きする。
- 同じ receipt の再送と同 ID 異 payload の拒否、CAS 競合時の原本保持。
- 署名不正・危険キー・不正型・重複 ID・不正月の無変更拒否。
- journal stage、commit marker、適用途中、receipt、marker 解除の停止を注入し、次回 fetch と変更 action で recovery または無変更を確認する。
- 各同期入口の flush 先行、初回 base 永続化、再試行基点固定、ACK 喪失、認証ロック、送信後 local 編集保持。
- 通常同期・月締め・遡及変更の回帰検証。

## Phase 2/3 レビュー経過

独立設計レビューは初稿 PASS であった。先行 33 テストは 9 PASS / 24 RED であった。テストレビューにより、変更 action での recovery 先行・実 DB での ACK と後続編集・参照整合性の観点が指摘されたため、Phase 1 に戻り上記の全体参照検証を追加し、テストを拡充する。

拡充後の設計・テスト観点は独立レビューで PASS であった。GAS は JSON の date と target_month を独立検証し、正規の休日調整による月跨ぎを受け入れる。初回 green 検証で ACK 喪失テスト fixture が遅延応答読み取り時に server を実行していたことを検知し、実際に server 実行完了後に通信エラーを発生させる fixture へ是正した。

## Phase 4 検証

新規統合テスト 51 件と既存の bidirectional_sync、GAS、master_sync_gas、sync 単体テストを合わせた 128 件は全件 PASS である。構文、静的型検査、インデント、差分空白検査は PASS である。`/tmp/review50-sync-green-combined.log` に実行結果を保存した。本番 GAS の操作は行っていない。利用には GAS の `replace_import` / `state_version` 対応版への更新が必要である。

## 実装レビューによる Phase 1 再入

独立レビューで、サーバーのドメイン検証不足と締め済み取込明細の通常再送が指摘された。上記の必須値・現行型の整合と条件付き ACK を設計へ追記し、先行テストを拡充する。


## 型・参照・ACK セッションの再入

現行 factory が生成しない旧 advance_payment 型は、クライアントとサーバーの両方で拒否する。Boolean 型の厳密検証は tx/account/category/sub/rule の既知 field に限定し、予算の費目 ID など任意の辞書キーへ誤適用しない。保険料支払口座および snapshot の残高口座も存在を確認する。ACK の暗号化 await 中も署名鍵と DMK の両方が不変であることを CAS callback で確認し、違う場合は outbox と未同期明細を保持する。


## 削除伝播の Phase 1 再入

完全取引置換で JSON から省略されたサーバー既存 ID は、通常表示から除外する tombstone として保持する。tombstone の updated_at は現在時刻・全サーバー既存値・取込値より少なくとも 1 ms 新しくし、is_deleted=true / sync_status=synced とする。これにより別端末が次回通常受信したときにも、以前 synced であった省略 ID を通常画面から除外できる。論理削除行は raw データ・export に残る。取込 JSON 内の明示削除も保持し、削除行の旧マスタ参照は整合性検証から除外する。後続に作成した別 ID の未同期明細は通常同期で維持する。


## 既存 ID の置換値伝播と時計差の Phase 1 再入

サーバーが元データより古い updated_at の取込値を採用しても、通常 LWW では他端末が旧値を保持する問題がある。完全取引置換だけは max(全 server 明細時刻、全取込明細時刻、現在時刻)+1 ms を imported_at として、採用全行と省略 ID tombstone の updated_at に付与する。response と永続 receipt に同じ imported_at を保存する。通常差分 LWW は変更しない。

ローカル ACK は submitted と同じ現行明細を synced として imported_at へ合わせ、同じ ID の後続編集は内容を保持して unsynced とし、その updated_at を max(現行時刻、imported_at+1 ms) とする。ACK の最終 CAS と署名鍵・DMK 検査は維持する。これにより他端末上の既知の未来時刻を上回って取込値が伝播し、送信中に行った手元編集も後続差分で失わない。新規の別 ID の後続編集は通常どおり維持する。

## 最終検証・実装レビュー

型・参照・セッション補強、省略 ID の tombstone 伝播、および imported_at の時計差補正について、設計・テスト観点の独立レビューを再実行し、いずれも PASS を得た。先行テストはそれぞれの不足を RED で捕捉した後に実装した。

最終の担当検証は、新規統合 75 件・新規システム 1 件と既存 GAS/同期群を合わせた 153 件が全件 PASS である（`/tmp/review50-sync-rebase-green.log`）。構文・静的型検査・インデント・差分空白検査は PASS である。独立サブエージェント review50_audit の最終実装レビューは PASS であった。全体の UI・カバレッジゲートとコミットは親の総合記録に従う。本番操作は行っていない。
