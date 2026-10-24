# review56 メタ情報・一括編集・寄附枠・投資推移

## Phase 1 設計

2026-10-24、main 5fabb9dからfeature/data-insights-and-bulk-editを作成した。R/E/I-3.55〜58を追加した。投資額は差引拠出額、寄附概算は税額通知書の値による方式として確認を提示している。独立設計レビュー待ちである。

## 範囲

4機能と関連する保存・同期・取込・表示の整合性を対象とする。既存全体の97%改善はreview55におけるユーザー判断により別件である。全体ゲートの未達は最終記録に残す。

## Phase 2 / Phase 3

auth_review・coverage_ui_review・settlement_reviewが独立設計レビューを実施し、更新日時/移動元月/承認累積/論理サイズの射影/日末観測/欠損・CAS/税率0の区別を精緻化した。全担当がPhase 2承認した。先行4層テストについて暗号化中の失敗・後発関連・締め進行・古い保存完了・GAS版基点・投資履歴欠損・訂正削除/完全取込を拡充し、全担当がPhase 3 PASSを回答した。

未実装モジュールによるREDを/tmp/yose56-red.logで確認した。実装初回のcore検証は49件中47件合格であり、2件は先行テストの原因であった。税額定数は20%時の式結果59487.78円を切り捨て59,487円であり、レビュー時に示された59,488円は誤りであった。アーカイブ口座競合の準備は有効な定期ルールを停止せず口座をアーカイブしたため、準備時に正しく拒否されていた。両テストを修正し、実装の式や参照制約を緩和していない。

## Phase 4 / Phase 5 再入記録

4機能のcore57件と実UI23件合格後に独立コードレビューを実施した。選択解除後の保留open復活、保存中の追加入力消失/投資日付ずれ、採用されない取込値の事前検証欠落、観測当日とarchive未取得の境界、過去観測点の脱落を指摘された。

影響上流へ戻り、フォーム凍結/失敗時復元、選択集合の再確認、同日観測の独立表示、全状態version照合による履歴完全性証拠と同一raw集合の読取を設計した。snapshot差替え時の証拠失効、同内容snapshotのtransactions完全置換、偽造バックアップ印拒否も先行テストへ追加し、auth_review・coverage_ui_review・settlement_reviewが再承認した。

修正後のcore64/64、実UI27/27を/tmp/yose56-core3.log・/tmp/yose56-ui3.logで確認した。UI2の26/27は、保存後の表示更新途中で意図どおり無効化された削除ボタンをテストが押した問題であった。実操作可能なenabled状態を待つようテストを直し、検証を緩和していない。型・構文・タブ・GAS生成一致はエラー0である。

全体coverage初回はNode931件中930件合格、旧キャッシュ名を固定したservice_worker.test.jsの1件が失敗した。現行version.jsonのcache_nameを使って実SWの現行キャッシュ維持を検証する形へ更新した。投資担当の再レビューではmaster_configとトップレベルannual_budgetsの併記時に後者の新欄検証が抜けることを再現し、/tmp/yose56-import-red.logに失敗を記録した。両入力を個別検証する修正へ進める。


併記入力の修正ではmaster_configとトップレベルannual_budgetsを個別走査し、採用しない新欄も事前拒否する。追加REDを解消し、関連Node81/81（機能core65＋SW16）を/tmp/yose56-core-final.logで確認した。計上/実態の両子分類・金額/計上月・欠損入力・超過額・非対応税制年・削除済み選択の再open・読取失敗復旧・投資下書き保持/削除取消・全口座archive・過去日の訂正を実UIへ追加し、35/35を/tmp/yose56-ui-final.logで確認した。

最終差分についてauth_review・coverage_ui_review・settlement_reviewが担当範囲のPhase5 PASS/承認を回答した。これは機能差分の承認であり、全対象各97%ゲートの合格や総合Grade A+を意味しない。最終の全体再実行結果は下記へ追記する。

## 最終検証結果

- `npm run test:coverage`の最終再実行（/tmp/yose56-coverage-final.log）で単体・結合・システム932/932、実Chromium UI418/418が合格した。失敗・取消・skipは0である。
- `npm run lint`のタブ138ファイル、JS130/GAS1/JSON5/Mermaid85の構文、静的型、GAS生成一致にエラーはない。
- evidenceは`/tmp/yose-coverage-FMkPSU`、標準成果物は`coverage/execution.json`・`coverage/source-manifest.json`・`coverage/coverage-summary.json`である。nodePassed/uiPassedはともにtrueである。計測対象44原本のSHA-256は最終作業ツリーと全件一致する。
- 全体Line 96.57%、Branch 84.16%である。全対象各97%ゲートは28ファイルで未達であり、test:coverageの数値ゲートは不合格である。新規計算3モジュールは達成したが、新規UI2ファイルの分岐も未達である。既存部分だけを理由にした未達とは扱わない。
- 独立レビューは今回機能差分の承認であり、総合Grade A+・マージ承認・全対象97%達成を意味しない。ユーザーの「今回の機能差分で区切り、既存全体の品質改善は別件」と先行するローカルコミット指示に従う作業記録として保存する。未達分岐は後続の品質作業で扱い、到達不能なDOMや不正な金融データを正常系として作り数値を埋めない。

| ファイル | Line % | Branch % | 各97% |
|---|---:|---:|---|
| `gas/Code.gs` | 98.26 | 84.15 | 未達 |
| `js/app.js` | 81.81 | 50.00 | 未達 |
| `js/crypto.js` | 100.00 | 100.00 | 達成 |
| `js/db.js` | 100.00 | 100.00 | 達成 |
| `js/db/backup_merger.js` | 99.44 | 92.11 | 未達 |
| `js/db/backup_replacement.js` | 100.00 | 74.07 | 未達 |
| `js/db/defaults.js` | 100.00 | 100.00 | 達成 |
| `js/db/storage_engine.js` | 97.64 | 78.40 | 未達 |
| `js/db/yose_db.js` | 99.81 | 91.56 | 未達 |
| `js/logic.js` | 100.00 | 100.00 | 達成 |
| `js/logic/advance_links.js` | 100.00 | 100.00 | 達成 |
| `js/logic/aggregator.js` | 100.00 | 91.33 | 未達 |
| `js/logic/budget_engine.js` | 100.00 | 98.12 | 達成 |
| `js/logic/bulk_edit.js` | 100.00 | 97.29 | 達成 |
| `js/logic/category_trend.js` | 100.00 | 100.00 | 達成 |
| `js/logic/data_insights.js` | 100.00 | 100.00 | 達成 |
| `js/logic/data_integrity.js` | 100.00 | 94.22 | 未達 |
| `js/logic/date_utils.js` | 100.00 | 100.00 | 達成 |
| `js/logic/investment.js` | 100.00 | 97.50 | 達成 |
| `js/logic/master_maintenance.js` | 100.00 | 97.43 | 達成 |
| `js/logic/master_sync.js` | 100.00 | 100.00 | 達成 |
| `js/logic/transaction_factory.js` | 100.00 | 94.49 | 未達 |
| `js/sync.js` | 98.55 | 88.58 | 未達 |
| `js/theme_bootstrap.js` | 100.00 | 100.00 | 達成 |
| `js/ui/advance_link_controller.js` | 100.00 | 82.60 | 未達 |
| `js/ui/auth_controller.js` | 99.42 | 85.85 | 未達 |
| `js/ui/backup_import_controller.js` | 100.00 | 80.32 | 未達 |
| `js/ui/bulk_edit_controller.js` | 100.00 | 92.98 | 未達 |
| `js/ui/chart_controller.js` | 84.69 | 60.41 | 未達 |
| `js/ui/coordinator.js` | 88.61 | 83.68 | 未達 |
| `js/ui/insights_controller.js` | 100.00 | 83.59 | 未達 |
| `js/ui/maintenance_controller.js` | 97.39 | 81.33 | 未達 |
| `js/ui/master_conflict_controller.js` | 100.00 | 85.24 | 未達 |
| `js/ui/master_controller.js` | 90.64 | 78.85 | 未達 |
| `js/ui/settings_controller.js` | 86.69 | 67.67 | 未達 |
| `js/ui/summary_controller.js` | 94.00 | 66.89 | 未達 |
| `js/ui/sync_status_controller.js` | 95.52 | 74.32 | 未達 |
| `js/ui/tag_memo_input.js` | 100.00 | 74.24 | 未達 |
| `js/ui/tx_edit_controller.js` | 99.20 | 82.06 | 未達 |
| `js/ui/tx_input_controller.js` | 96.94 | 72.23 | 未達 |
| `js/ui/tx_list_controller.js` | 99.46 | 76.00 | 未達 |
| `js/version.js` | 100.00 | 92.64 | 未達 |
| `js/webauthn.js` | 100.00 | 100.00 | 達成 |
| `sw.js` | 100.00 | 100.00 | 達成 |

## 残余の検証範囲

新UIの未通過分岐には保存/読取の旧世代拒否・ロック後完了・保存後描画失敗・対象なし等の防御経路が含まれる。原子保存/鍵変更拒否のDB検証と独立コードレビューは行ったが、全UI分岐の実操作捕捉とは同一視しない。既存全体の品質改善に加え、この新UI分岐の補完も未達一覧から追跡する。

税条件は通知書の所得割額・特例控除用税率による概算、投資額は差引拠出額とした。実GAS配布先/権限・CDN実Chart.js・実機・実申告結果・大規模データの定量性能は、このローカルの模擬GAS/実Chromium検証では証明していない。push・PR発行・GASデプロイは実施していない。
