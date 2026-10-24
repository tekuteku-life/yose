# review57 取得原価・給与控除集計の是正

## 範囲と原因

投資額を差引拠出額とする仮定に対し、本人から保有商品の取得原価とする回答を得た。給与の記帳は税引前給与と税・社会保険料の別明細であると確認した。取得原価は入出金では導けないため、設計フェーズから再入する。既存全体の品質改善を別件とする判断は維持する。

## Phase 1 / 2

requirements/external_design/internal_design/design_test_auditを先行更新した。独立Security & Architecture Auditor（auth_review）の設計レビュー結果はPASSである。

## Phase 3

取得原価の未記録・直近記録据置・入出金独立・売買後訂正・旧形式非転用、および明示分類の給与/税/保険集計を先行テスト化した。既存実装に対するREDは/tmp/yose57-red.logである。新集計関数未実装による読込失敗と、差引拠出計算によるassert不一致を確認した。構文・型エラーは0である。独立テストレビュー（coverage_ui_review）は未入力保存、相互dirty保持、暗号保留ロック、単独予算取込、新旧欄併記拒否、締め済みfixtureの不足を指摘した。先行テストを補完し、再レビューはPASSである。この時点では4層最終実行前である。

## Phase 5からの再入

独立auth_reviewが不採用の単独予算集計元に不正分類参照/種別を持たせた取込成功を再現した。候補分類による全入力検証へPhase 1から再入する。初回UIは39/41であり、2件は保存完了待機不足とCDPの同名const再宣言に分類した。部分合格を全体成功とは扱わない。

再入後の設計・先行テストはsettlement_reviewでPASSである。取込再試行内の候補分類による全入力検証、未取得締め日でも直近原価を保持する系列、次の記録まで原価を補間しない階段描画を実装した。競合テストは不採用mappingを対象とし、最終候補検証だけでは見逃すケースを再現する。Chart.jsの階段方向は公式canvas helperの実装で確認した。

## Phase 4 / 5の最終差分レビュー

1.15.0へ更新し、package/lockfile、version.json、js/version.js、SWキャッシュ名、画面バッジを同期した。追加ファイルは単体テストfurusato_sourcesと本レビュー記録である。既存bulk/メタ情報の機能は継続して回帰対象とする。

- auth_review: 設計レビューPASS、最終コード/暗号・取込レビュー再実行PASSである。
- coverage_ui_review: 先行テストレビューPASS、最終UI/集計/階段描画レビュー再実行PASSである。
- settlement_review: 手戻りの候補参照/再試行/欠損期間/階段表示について設計・先行テストレビューPASSである。
- 関連単体・結合・システム66/66、関連実Chromium UI42/42が合格である。いずれも失敗・取消・skipは0である。

## 検証範囲

家計簿集計は取得済みの明細と本人指定の計上分類を根拠とする。給与・控除の合計は通知書確認用であり、通常の住民税支払額を所得割額へ代入せず、手取額や源泉税額から給与年収・税率を逆算しない。取得原価は保有商品の総取得原価を本人が記録する方式であり、銘柄別売買台帳・市場価格取得の機能ではない。口座評価額は預り金込みの口座全体であり、記録後の市場価格変動は自動反映しない。

ローカルGASモックへの実署名同期と実Chromium操作を検証した。UIのChart.jsはCDPスタブによるデータ/設定assertであり、配布先の実Chart.js描画・実GAS権限・実機・税額申告結果・大規模データの定量性能の証明ではない。階段方向はChart.js公式ソースも確認した。push・PR発行・GAS配布は実施していない。

最初の全4層実行は非UI944/944、UI425/425である。投資計算の未通過1分岐は口座管理料による評価減額の直接assert不足であり、Phase 3へ再入して単体テストを補完する。本番原本は変更せず、全非UIを再実行して同じ原本のUI証拠と統合計測する。

## 最終検証結果

- 全単体・結合・システム: 945/945合格である（/tmp/yose57-node-final.log）。
- 全実Chromium UI: 425/425合格である（/tmp/yose57-coverage.log）。両層とも失敗・取消・skipは0である。
- 静的検査: タブ139ファイル、構文JS131/GAS1/JSON5/Mermaid86、静的型、GAS生成validator一致はいずれもエラー0である。
- 計測原本44ファイルのSHA-256を照合し、全一致である。
- 全体Line 96.60%、Branch 84.17%である。全対象各97%ゲートは28ファイルで未達であり、総合Grade A+/マージ可とはしない。新UIの未達も含む。
- 計測証拠は/tmp/yose-coverage-gJtDwc、coverage/execution.json、coverage/source-manifest.jsonである。

npm run test:coverageの最初の全実行は944/944と425/425が合格したが、閾値判定は未達である。口座管理料の単体追加後、同じ本番原本で全非UIを945件再計測し、SHA/coverage map/raw counterを検証して同じ425件のUI証拠と統合した（/tmp/yose57-coverage-final.log）。本番変更のない単体追加でUI証拠を取り直したとは扱わない。最終投資計算はLine/Branchとも100%である。追加単体の独立テスト/差分レビュー（coverage_ui_review）はPASSである。

| 対象ファイル | Line % | Branch % | 97%判定 |
|---|---:|---:|---|
| `gas/Code.gs` | 98.17 | 83.04 | 未達 |
| `js/app.js` | 81.81 | 50.00 | 未達 |
| `js/crypto.js` | 100.00 | 100.00 | 達成 |
| `js/db.js` | 100.00 | 100.00 | 達成 |
| `js/db/backup_merger.js` | 99.44 | 92.09 | 未達 |
| `js/db/backup_replacement.js` | 100.00 | 74.07 | 未達 |
| `js/db/defaults.js` | 100.00 | 100.00 | 達成 |
| `js/db/storage_engine.js` | 97.64 | 78.40 | 未達 |
| `js/db/yose_db.js` | 100.00 | 91.63 | 未達 |
| `js/logic.js` | 100.00 | 100.00 | 達成 |
| `js/logic/advance_links.js` | 100.00 | 100.00 | 達成 |
| `js/logic/aggregator.js` | 100.00 | 91.70 | 未達 |
| `js/logic/budget_engine.js` | 100.00 | 98.12 | 達成 |
| `js/logic/bulk_edit.js` | 100.00 | 97.29 | 達成 |
| `js/logic/category_trend.js` | 100.00 | 100.00 | 達成 |
| `js/logic/data_insights.js` | 100.00 | 100.00 | 達成 |
| `js/logic/data_integrity.js` | 100.00 | 94.37 | 未達 |
| `js/logic/date_utils.js` | 100.00 | 100.00 | 達成 |
| `js/logic/investment.js` | 100.00 | 100.00 | 達成 |
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
| `js/ui/insights_controller.js` | 100.00 | 83.92 | 未達 |
| `js/ui/maintenance_controller.js` | 97.39 | 81.33 | 未達 |
| `js/ui/master_conflict_controller.js` | 100.00 | 85.24 | 未達 |
| `js/ui/master_controller.js` | 90.64 | 79.05 | 未達 |
| `js/ui/settings_controller.js` | 86.69 | 67.67 | 未達 |
| `js/ui/summary_controller.js` | 94.16 | 67.17 | 未達 |
| `js/ui/sync_status_controller.js` | 95.52 | 75.67 | 未達 |
| `js/ui/tag_memo_input.js` | 97.36 | 69.69 | 未達 |
| `js/ui/tx_edit_controller.js` | 99.20 | 82.06 | 未達 |
| `js/ui/tx_input_controller.js` | 96.94 | 72.23 | 未達 |
| `js/ui/tx_list_controller.js` | 99.46 | 76.00 | 未達 |
| `js/version.js` | 100.00 | 92.64 | 未達 |
| `js/webauthn.js` | 100.00 | 100.00 | 達成 |
| `sw.js` | 100.00 | 100.00 | 達成 |

既存全体の品質改善は別件とする本人判断に従い、今回の機能差分と関連整合性で区切る。数値ゲート未達の事実は維持し、新規UIの残余分岐も未達一覧で追跡する。push・PR発行・配布は実施せず、ローカルコミットと日本語PR草案までを対象とする。
