# Review 58: 税・控除タブと家計簿を使う上限概算

## 対象

任意費目・内訳の割当と不足金額の手入力を上限計算へ使用する。給与、生命保険料控除、住宅ローン控除を導出し、詳細設定を税・控除タブへ集約する。予算には要約だけを表示する。

## 設計レビュー

- auth_review: 年額確認をSHA-256で対象明細集合へ結び付け、一貫読取・描画/認証世代・保存時CASを明記した。再レビュー結果はPASSである。
- settlement_review: 寄附年税制、公定人的控除差、所得割課税確認、40%/30%制約の2,000円控除順序、住宅控除併用の区分一次関数比較を明記した。再レビュー結果はPASSである。
- 設計根拠は[計算設計](../furusato_calculation.md)に記載した公的資料である。

## テスト先行

構文・型検査合格後、追加単体/結合/システムテストを実行した。未実装furusato_calculator.jsのモジュール読込エラーで3ファイルとも失敗し、REDを確認した。ログは/tmp/yose58-red.logである。

coverage_ui_reviewのテスト観点レビューでは、独立算定定数、SHA遅延、相互draft保持、通常予算保存と単独取込を追加した。再レビュー結果はPASSである。

## 受入状況

実装と機能差分の最終独立レビューは完了し、最終原本の全4層テストは合格した。既存全体の品質改善を別件とする本人回答は継続し、全対象ファイル各97%以上の品質ゲートと今回機能の確認結果を混同しない。

## 実装後指摘と再検証

- 正規の最小削除墓標はdateを持たず、SHA集合作成で例外になった。実DB保存で再現後、削除を先に除外した。対象行の消失による年額確認失効を保持する。
- SHA待機中の確認取消と取消後の再描画で確認が復活した。取消を編集世代/dirtyへ含め、旧確認処理全体を待つ実UI試験を追加した。
- 手入力寄附未入力/合計溢れを0へ変換していた。寄附合計/残額/参考自己負担をnullとし、算出できる上限と区別した。
- 給与262.4万円の70%計算で1円、住宅残高70万円×0.7%で100円の切捨誤差があった。整数比の給与表とBigIntの率計算へ変更した。
- 自動対応年外の住民税基礎控除は固定値を返さず、実額上書きを必要とした。
- 既存income条件を編集し通知書→計算設定と保存すると三者マージが旧方式を保持した。modeの比較元を明示保存操作へ合わせ、相手の未保存入力と他フィールドの原本比較を維持した。
- この方式修正で初回保存に空の年度を比較元へ生成し、未登録年度とのCAS差異が発生した。既存UIのREDで切り分け、比較元補完を最新計算条件がある場合に限定した。
- 旧UIの一括編集試験で初回タブが覆われる単発失敗があった。無変更の単独再実行は合格した。CDPの例外へ覆う要素のID等を追加し、操作条件やassertは緩めていない。最終全UI実行で再確認する。

指摘後は影響する設計/先行試験へ戻り、auth_reviewの設計再レビューとcoverage_ui_reviewの先行試験再レビューをPASSまで再実施した。

再起動境界ではsetup前のcancelが未生成の動的表示を参照して認証初期化を中断した。実reloadでREDを確認し、動的表示の存在を確認してから破棄する設計へ戻った。auth_reviewの設計再レビュー、coverage_ui_reviewの先行UI再レビューはPASSである。PIN/PRFの実reloadを含む全UIの再検証を必要とする。

低額給与の公式表を再確認し、2025年の651,000円未満/2026〜2027年の741,000円未満の所得0円を先行テストに追加した。単純最低控除減算で999円になるREDを確認後に修正し、基礎控除逓減と全特例率も検証した。settlement_reviewの設計再レビュー、coverage_ui_reviewのテスト再レビューはPASSである。

最終実装後レビューはauth_review（原本比較/暗号/認証/生命周期）とsettlement_review（計算/公的表/併用）の双方がPASSである。税計算・保存の最終対象Node29件、生成前cancel修正後のPIN/PRF/旧鍵移行/更新/再読込UI8件が合格した。これらの局所合格を全体合格の代用にはせず、最終原本で全4層を再収集する。

coverage_ui_reviewの最終UI/不足観点レビューもPASSである。総合の数値品質ゲートの合格を意味しない。

最終原本の全Nodeは974/974合格した。全UI中に既存の削除競合試験が1件失敗し、coverage_ui_reviewが行クリック後の編集画面完成待機不足を指摘した。無変更の単独合格を全体合格の代用にせず、modal/対象ID/削除ボタンの可視を待つよう先行試験を拡充した。本番と競合金額assertは変更していない。

失敗stackは削除ボタンが非表示のまま押されたことを示し、編集画面完成待機不足と一致した。同じ全UIでPRF再起動後の鍵詳細ボタンにも非表示クリックが1件あった。認証画面非表示だけでなく、既存初期化fixtureと同じ_domInitializedを待つよう解除待機を拡充した。本番ソースは変更せず、型・構文と局所操作を再検証する。個々の入力が安全整数でも給与とその他所得の中間合計が範囲を超える場合の未算出も追加単体試験で確認した。

PRF設定の表示待機を含む先行再レビューもcoverage_ui_reviewがPASSとした。局所PRFの1回でCDPのInvalid InterceptionId環境イベントエラーを観測したが、例外を握り潰す変更はしていない。鍵詳細ボタンの表示を待つ修正後の同操作は合格した。975件のNodeと438件の全実UIを最終実行で確認する。

## 最終検証結果

- 全単体・結合・システム: 975/975合格である。
- 全実Chromium UI: 438/438合格である。失敗・取消・skipは0である。
- タブ/構文/静的型/GAS生成一致: エラー0である。
- 全体Line 96.70%、Branch 84.43%であり、全対象各97%ゲートは29ファイルで未達である。新規税UIの未達も含み、総合Grade A+・マージ可とはしない。
- 計測対象のJS/GAS/SW46ファイルのSHA-256が計測開始時・終了時・記録作成時で一致した。全実行ログは/tmp/yose58-acceptance.log、計測証拠は/tmp/yose-coverage-FpdYSy、実行メタデータはcoverage/execution.jsonである。

| 今回の新規ファイル | Line % | Branch % |
|---|---:|---:|
| js/logic/furusato_calculator.js | 100.00 | 97.05 |
| js/ui/furusato_controller.js | 98.60 | 89.23 |

数値ゲートの未達を受入済みとは扱わない。本人指定に従って既存全体の品質改善は別件であり、今回の税UI分岐未達も明示してローカルコミットを作成する。push、PR作成、merge、配布は行わない。

### 全対象ファイル

| ファイル | Line % | Branch % | 判定 |
|---|---:|---:|---|
| gas/Code.gs | 98.11 | 80.82 | 未達 |
| js/app.js | 81.81 | 50.00 | 未達 |
| js/crypto.js | 100.00 | 100.00 | 達成 |
| js/db.js | 100.00 | 100.00 | 達成 |
| js/db/backup_merger.js | 99.45 | 91.89 | 未達 |
| js/db/backup_replacement.js | 100.00 | 74.07 | 未達 |
| js/db/defaults.js | 100.00 | 100.00 | 達成 |
| js/db/storage_engine.js | 97.64 | 78.40 | 未達 |
| js/db/yose_db.js | 100.00 | 91.63 | 未達 |
| js/logic.js | 100.00 | 100.00 | 達成 |
| js/logic/advance_links.js | 100.00 | 100.00 | 達成 |
| js/logic/aggregator.js | 100.00 | 91.70 | 未達 |
| js/logic/budget_engine.js | 100.00 | 98.12 | 達成 |
| js/logic/bulk_edit.js | 100.00 | 97.29 | 達成 |
| js/logic/category_trend.js | 100.00 | 100.00 | 達成 |
| js/logic/data_insights.js | 100.00 | 100.00 | 達成 |
| js/logic/data_integrity.js | 100.00 | 92.98 | 未達 |
| js/logic/date_utils.js | 100.00 | 100.00 | 達成 |
| js/logic/furusato_calculator.js | 100.00 | 97.05 | 達成 |
| js/logic/investment.js | 100.00 | 100.00 | 達成 |
| js/logic/master_maintenance.js | 100.00 | 97.43 | 達成 |
| js/logic/master_sync.js | 100.00 | 100.00 | 達成 |
| js/logic/transaction_factory.js | 100.00 | 94.49 | 未達 |
| js/sync.js | 98.55 | 88.58 | 未達 |
| js/theme_bootstrap.js | 100.00 | 100.00 | 達成 |
| js/ui/advance_link_controller.js | 100.00 | 81.15 | 未達 |
| js/ui/auth_controller.js | 99.42 | 85.85 | 未達 |
| js/ui/backup_import_controller.js | 100.00 | 80.32 | 未達 |
| js/ui/bulk_edit_controller.js | 100.00 | 92.98 | 未達 |
| js/ui/chart_controller.js | 84.69 | 60.41 | 未達 |
| js/ui/coordinator.js | 88.73 | 83.90 | 未達 |
| js/ui/furusato_controller.js | 98.60 | 89.23 | 未達 |
| js/ui/insights_controller.js | 100.00 | 80.00 | 未達 |
| js/ui/maintenance_controller.js | 97.39 | 81.33 | 未達 |
| js/ui/master_conflict_controller.js | 100.00 | 85.24 | 未達 |
| js/ui/master_controller.js | 90.64 | 78.85 | 未達 |
| js/ui/settings_controller.js | 86.69 | 67.67 | 未達 |
| js/ui/summary_controller.js | 94.18 | 67.79 | 未達 |
| js/ui/sync_status_controller.js | 95.52 | 75.67 | 未達 |
| js/ui/tag_memo_input.js | 100.00 | 74.24 | 未達 |
| js/ui/tx_edit_controller.js | 99.20 | 82.06 | 未達 |
| js/ui/tx_input_controller.js | 96.94 | 72.23 | 未達 |
| js/ui/tx_list_controller.js | 99.46 | 76.00 | 未達 |
| js/version.js | 100.00 | 92.64 | 未達 |
| js/webauthn.js | 100.00 | 100.00 | 達成 |
| sw.js | 100.00 | 100.00 | 達成 |
