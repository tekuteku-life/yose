# review64 最終カバレッジと受入判定

本記録は1.20.0時点のものである。追加是正後の検証は[review65](review65.md)へ引き継ぐ。coverage/配下のJSONは新測定で更新するため、本記録の原本は下記の生記録ディレクトリを参照する。

2026-10-27の原本に対するローカル4層統合計測である。npm run test:coverageは各ファイル97%基準の未達で終了値1である。テスト失敗による終了ではない。

| 検証 | 結果 |
| --- | --- |
| TAB・構文・型・GAS生成一致 | 成功である |
| 単体・結合・システム | 1101/1101成功、失敗/取消/skip 0である |
| 実Chromium UI | 535/535成功、失敗/取消/skip 0である |
| 全体Line/Branch | 97.49% / 85.47%である |
| 各ファイル97% | 33ファイルで未達である |
| 本番原本 | 51ファイルのSHA-256が計測前後と現原本で一致する |

実行ログは/tmp/yose64-coverage-release.log、生記録/manifestは/tmp/yose-coverage-zHIbI6、報告JSONはcoverage/である。raw記録と本番原本の一致を検証した。

## 今回の共通判定モジュール

| ファイル全体 | Line | Branch |
| --- | ---: | ---: |
| [js/logic/bulk_edit.js](../../js/logic/bulk_edit.js) | 100.00% | 100.00% |
| [js/ui/chart_interaction.js](../../js/ui/chart_interaction.js) | 100.00% | 97.43% |
| [js/ui/render_session.js](../../js/ui/render_session.js) | 100.00% | 100.00% |

## 未達ファイル

以下はファイル全体の値であり、今回差分だけの網羅率ではない。改修対象ファイルの未達も含む。未達条件を削除したり、到達不能な防御例外の人工モックで数値を繕ったりしない。

| ファイル | Line | Branch |
| --- | ---: | ---: |
| [gas/Code.gs](../../gas/Code.gs) | 98.06% | 81.32% |
| [js/app.js](../../js/app.js) | 81.81% | 50.00% |
| [js/db/backup_merger.js](../../js/db/backup_merger.js) | 99.46% | 92.50% |
| [js/db/backup_replacement.js](../../js/db/backup_replacement.js) | 100.00% | 74.07% |
| [js/db/storage_engine.js](../../js/db/storage_engine.js) | 97.64% | 78.40% |
| [js/db/yose_db.js](../../js/db/yose_db.js) | 100.00% | 91.63% |
| [js/logic/aggregator.js](../../js/logic/aggregator.js) | 100.00% | 91.90% |
| [js/logic/budget_engine.js](../../js/logic/budget_engine.js) | 100.00% | 96.41% |
| [js/logic/category_trend.js](../../js/logic/category_trend.js) | 100.00% | 90.00% |
| [js/logic/data_integrity.js](../../js/logic/data_integrity.js) | 100.00% | 93.03% |
| [js/logic/transaction_factory.js](../../js/logic/transaction_factory.js) | 100.00% | 94.49% |
| [js/sync.js](../../js/sync.js) | 98.88% | 88.94% |
| [js/ui/advance_link_controller.js](../../js/ui/advance_link_controller.js) | 100.00% | 82.60% |
| [js/ui/auth_controller.js](../../js/ui/auth_controller.js) | 99.43% | 85.85% |
| [js/ui/backup_import_controller.js](../../js/ui/backup_import_controller.js) | 100.00% | 80.59% |
| [js/ui/budget_settings_controller.js](../../js/ui/budget_settings_controller.js) | 100.00% | 86.18% |
| [js/ui/bulk_edit_controller.js](../../js/ui/bulk_edit_controller.js) | 100.00% | 93.79% |
| [js/ui/chart_controller.js](../../js/ui/chart_controller.js) | 96.89% | 69.35% |
| [js/ui/chart_viewport.js](../../js/ui/chart_viewport.js) | 100.00% | 76.05% |
| [js/ui/coordinator.js](../../js/ui/coordinator.js) | 89.35% | 83.06% |
| [js/ui/furusato_controller.js](../../js/ui/furusato_controller.js) | 98.65% | 89.52% |
| [js/ui/insights_controller.js](../../js/ui/insights_controller.js) | 100.00% | 80.23% |
| [js/ui/maintenance_controller.js](../../js/ui/maintenance_controller.js) | 97.43% | 83.52% |
| [js/ui/master_conflict_controller.js](../../js/ui/master_conflict_controller.js) | 100.00% | 85.24% |
| [js/ui/master_controller.js](../../js/ui/master_controller.js) | 90.68% | 78.71% |
| [js/ui/settings_controller.js](../../js/ui/settings_controller.js) | 88.57% | 66.83% |
| [js/ui/summary_controller.js](../../js/ui/summary_controller.js) | 95.55% | 71.54% |
| [js/ui/sync_status_controller.js](../../js/ui/sync_status_controller.js) | 95.83% | 76.74% |
| [js/ui/tag_memo_input.js](../../js/ui/tag_memo_input.js) | 100.00% | 74.24% |
| [js/ui/tx_edit_controller.js](../../js/ui/tx_edit_controller.js) | 99.20% | 81.72% |
| [js/ui/tx_input_controller.js](../../js/ui/tx_input_controller.js) | 97.31% | 74.33% |
| [js/ui/tx_list_controller.js](../../js/ui/tx_list_controller.js) | 97.96% | 78.02% |
| [js/version.js](../../js/version.js) | 100.00% | 92.64% |

## 判定

コード/機能の独立レビューPASSと、全体受入を分離する。全対象各97%に未達のためPhase 5総合受入は不合格である。Grade A+・マージ承認とはせず、Phase 6のコミット・push・リモートPR作成へ進めない。PR草案はreview64_pr.mdである。

公開GAS/実Spreadsheet、実機の指操作、配布先PWA更新はこのローカル試験で検証していない。
