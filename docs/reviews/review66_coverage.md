# review66 最終カバレッジと受入判定

2026-10-29、1.21.0の固定原本に対する第3回の全4層統合計測である。`npm run test:coverage`の終了値1は各ファイル97%基準の未達によるもので、テスト失敗や収集例外による終了ではない。

| 検証 | 結果 |
| --- | --- |
| TAB・構文・型・GAS生成一致 | 成功である |
| 単体・結合・システム | 1364/1364成功、失敗/取消/skip 0である |
| 実Chromium UI | 631/631成功、失敗/取消/skip 0である |
| 実装後の独立コードレビュー | PASSである |
| 全体Line/Branch | 97.56% / 85.32%である |
| 各ファイルLine/Branch 97% | 36ファイルで未達である |
| 本番原本 | 54ファイルのSHA-256が計測前後と現原本で一致する |
| 性能計測原本 | 最終11ファイルのSHA-256が現原本と一致する |

実行ログは/tmp/yose66-coverage-verified.log、生記録/manifestは/tmp/yose-coverage-0AS0LB、報告JSONはcoverage/である。execution.jsonのnodePassed/uiPassedはともにtrueである。初回と第2回の失敗ログ・raw・報告JSONはそれぞれ退避し、この最終結果へ混ぜていない。性能条件と最終値は[性能記録](review66_performance.md)を正本とする。

## 未達ファイル

以下は各ファイル全体の値であり、今回差分だけの網羅率ではない。既存改修対象および新規3helperも未達に含む。Lineの全体値が97%以上でも、Branchとファイル別の基準を満たすことにはならない。

| ファイル | Line | Branch |
| --- | ---: | ---: |
| [gas/Code.gs](../../gas/Code.gs) | 98.08% | 81.82% |
| [js/app.js](../../js/app.js) | 81.81% | 50.00% |
| [js/sync.js](../../js/sync.js) | 99.40% | 89.51% |
| [js/version.js](../../js/version.js) | 100.00% | 92.64% |
| [js/db/backup_merger.js](../../js/db/backup_merger.js) | 99.47% | 92.77% |
| [js/db/backup_replacement.js](../../js/db/backup_replacement.js) | 100.00% | 74.07% |
| [js/db/storage_engine.js](../../js/db/storage_engine.js) | 98.07% | 82.58% |
| [js/db/yose_db.js](../../js/db/yose_db.js) | 100.00% | 90.80% |
| [js/logic/aggregator.js](../../js/logic/aggregator.js) | 100.00% | 91.90% |
| [js/logic/budget_engine.js](../../js/logic/budget_engine.js) | 100.00% | 96.41% |
| [js/logic/category_trend.js](../../js/logic/category_trend.js) | 100.00% | 90.00% |
| [js/logic/data_integrity.js](../../js/logic/data_integrity.js) | 100.00% | 94.16% |
| [js/logic/sync_changes.js](../../js/logic/sync_changes.js) | 100.00% | 96.55% |
| [js/logic/transaction_factory.js](../../js/logic/transaction_factory.js) | 100.00% | 93.68% |
| [js/ui/advance_link_controller.js](../../js/ui/advance_link_controller.js) | 100.00% | 82.60% |
| [js/ui/auth_controller.js](../../js/ui/auth_controller.js) | 99.45% | 85.85% |
| [js/ui/backup_import_controller.js](../../js/ui/backup_import_controller.js) | 100.00% | 80.59% |
| [js/ui/budget_settings_controller.js](../../js/ui/budget_settings_controller.js) | 100.00% | 86.84% |
| [js/ui/bulk_edit_controller.js](../../js/ui/bulk_edit_controller.js) | 99.35% | 88.16% |
| [js/ui/chart_controller.js](../../js/ui/chart_controller.js) | 96.89% | 69.35% |
| [js/ui/chart_viewport.js](../../js/ui/chart_viewport.js) | 100.00% | 76.05% |
| [js/ui/coordinator.js](../../js/ui/coordinator.js) | 91.03% | 83.29% |
| [js/ui/form_busy.js](../../js/ui/form_busy.js) | 100.00% | 72.72% |
| [js/ui/furusato_controller.js](../../js/ui/furusato_controller.js) | 98.65% | 89.52% |
| [js/ui/insights_controller.js](../../js/ui/insights_controller.js) | 100.00% | 80.23% |
| [js/ui/maintenance_controller.js](../../js/ui/maintenance_controller.js) | 97.43% | 83.52% |
| [js/ui/master_conflict_controller.js](../../js/ui/master_conflict_controller.js) | 100.00% | 85.24% |
| [js/ui/master_controller.js](../../js/ui/master_controller.js) | 90.88% | 76.18% |
| [js/ui/settings_controller.js](../../js/ui/settings_controller.js) | 90.93% | 70.42% |
| [js/ui/summary_controller.js](../../js/ui/summary_controller.js) | 96.02% | 71.32% |
| [js/ui/sync_result.js](../../js/ui/sync_result.js) | 100.00% | 91.83% |
| [js/ui/sync_status_controller.js](../../js/ui/sync_status_controller.js) | 93.10% | 74.52% |
| [js/ui/tag_memo_input.js](../../js/ui/tag_memo_input.js) | 97.36% | 69.69% |
| [js/ui/tx_edit_controller.js](../../js/ui/tx_edit_controller.js) | 98.14% | 78.47% |
| [js/ui/tx_input_controller.js](../../js/ui/tx_input_controller.js) | 97.37% | 78.14% |
| [js/ui/tx_list_controller.js](../../js/ui/tx_list_controller.js) | 97.03% | 76.87% |

## 工程到達点

設計・先行試験・実装後コードレビューと全テストは成功したが、[開発プロセス定義書](../development_process.md)が定める各対象Line/Branch 97%は未達である。Phase 5総合受入は不合格、Phase 6は未到達とする。総合Grade A+・マージ承認を付与しない。

本人の「開発プロセスが終わっていたらコミットまで進めて」という条件は成立していないため、コミット・push・リモートPR作成は行わず、作業ブランチの差分と[PR草案](review66_pr.md)を保持する。

本番GAS/Spreadsheet、実ネットワーク、実機の認証/タッチと配布先PWA更新はローカル保証に含まない。今回のGAS変更は変更後コードの再デプロイを必要とする。
