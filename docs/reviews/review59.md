# Review 59: グラフ操作・収入内訳・年間目標

## 対象

R/E/I-3.59、chart_budget_improvements.mdが対象である。既存全体の品質改善は本人判断により別件である。基準収入は確定と金額入力済み予定の合計である。

## Phase 1/2

設計先行で更新し、auth_reviewとsettlement_reviewの独立レビューを行った。初回は新収入マップの形・合計整合・不採用入力の検証、未知系列と実在IDの区別、予算基準と元入力の一組保持を指摘された。上流設計へ戻って修正し、再レビューは両者PASSであった。

## Phase 3

4層の先行試験を追加し、未実装の丸密度・金額軸・連動目標・収入履歴のREDを確認した。coverage_ui_reviewの独立レビューで、実入力のsessionId、三者マージの正しい競合条件、実ライブラリの3グラフ操作と中央以外の基準点、全4基準、暗号化保留・ロック・別年読取・同名未知系列を補完した。再審はPASSであった。

## Phase 4/5と再入

ChartViewport/純計算、ChartControllerの推移描画共通化、BudgetSettingsControllerへの予算操作分離、収入の月次保存を実装した。旧SettingsControllerの予算操作を削除し、委譲へ統一した。Chart.jsは4.6.1を開発依存・本番CDNで一致させた。

初回の実装後レビューでは次を検出し、Phase 1/2またはPhase 3へ戻して先行再現・修正・再審を行った。

| 指摘 | 対応と証拠 |
| --- | --- |
| overflow時にnull目標を0円・順調と表示 | resolve/progressの未算出を保持し、目標線のみnull、実績線を保持する単体・UI試験を追加した。 |
| basisと入力の三者マージが意図しない組を合成 | 基準・元入力を一組で競合検出し、設定CASと実署名同期で拒否する試験を追加した。省略independentと旧rate別名も確認した。 |
| 目標組の競合解決が組外の選択を上書き | annual_goalとして対象5フィールドだけを差し替え、費目予算の選択を正逆順とも保持する試験を追加した。 |
| 年度読取中の旧フォーム入力が失われる | 対象年以外の入力を凍結し、遅い別年読取・取消・新draftを保護した。 |
| 未分類収入の絞込が全費目へ戻る | cat_unclassifiedの選択肢と収入種別・分類軸を保持した。混在する実UIで確認した。 |
| 有効な0%・負の派生率を未設定と表示 | 0%・赤字率・未算出を区別した。 |
| toString/valueOf等の正規IDで月締め失敗 | GASの収入・支出・内訳・残高をown値だけで計算し、同名IDの回帰試験を追加した。 |
| ズーム後のtick配置で操作点の値がずれる | 再配置後も同じ値を指すよう補正し、中央以外の実操作で確認した。 |
| 代替表が操作欄に重なる | 高さとスクロールを制限し、表示項目の操作を維持した。 |
| cached scalesをChart.jsが書き換える | 構築ごとにscalesを複製し、系列変更時の範囲解除を直接検証した。 |
| 設定setup委譲に到達不能文 | 初期化を委譲へ統一し、両setupを順に呼ぶ構造へ整理した。 |

全Nodeの途中確認は997/997であった。その後に防御境界試験を追加しており、最終件数は後段の実測を正本とする。

## UI失敗の切分け

初回全UIでは、代替表示の月別収支タイトルを失った実装の退行と、新年度の試験でfillが発火したchangeを重ねて送る試験側の競合を検出した。タイトルを復元し、changeを1回にした。解除後の試験では、鍵解除だけを待ってまだ凍結中の入力へfillするケースを検出し、新draftが存在して入力が有効な状態で編集するよう修正した。個別合格のみで全UIの合格とはせず、最終同一原本の4層測定を必須とする。

追加の最終レビューでは、読取失敗時に他年度の表示のまま保存が有効となる問題をcoverage_ui_reviewが実UIで再現した。先行試験を追加し、成功した再読取まで凍結を維持した。未設定の空欄と新旧形式の明示0を区別する試験も追加した。saveAnnualBudgetによる正規化を避け、mutateMasterConfigで旧保存形の存在を直接確認した。ロック後の入力は、DOMのdisabledを無視するfillヘルパーによる誤入力を避け、有効な入力と同一evaluate内で値変更・dirty成立を確認し、旧保存処理の完了後もその値を保持する。

auth_review（セキュリティ・状態管理）、settlement_review（財務・集計）、coverage_ui_review（実装・テスト/UI）の最終コードレビューは全員PASSであった。これは実装差分の判定であり、定量97%ゲートの判定と区別する。

## 最終検証結果

- `npm run lint`: TAB/構文/型/GAS共有validator一致がすべて合格である。
- `npm run test:coverage` 内の単体・結合・システム: **999/999合格**である。
- 同コマンド内の実ブラウザUI: **456/456合格**である。新規操作の18件はChart.js 4.6.1を実読込する。
- 実行記録は `coverage/execution.json` であり、`nodePassed=true`、`uiPassed=true` である。
- 49対象ファイルのSHA-256が計測前後で一致した。原本一覧は `coverage/source-manifest.json`、測定データは `coverage/coverage-final.json` と `coverage/coverage-summary.json` である。
- 証拠ディレクトリは `/tmp/yose-coverage-nLY3j1`、全ログは `/tmp/yose59-coverage.log` である。manifest自体のSHA-256は `5ac3e61d03f144d14f5f33f3d78da23fbc2cd03fb859d3e8d4657a9a420732b2` である。
- 全体は **Line 97.13% / Branch 85.00%** である。各ファイルLine/Branch各97%は**33/49ファイルで未達**であり、coverageコマンドの終了値1はこの定量ゲートによる。試験失敗・原本不一致によるものではない。

| 新規ファイル | Line | Branch | 各97% |
| --- | ---: | ---: | --- |
| js/logic/chart_geometry.js | 100% | 100% | 合格 |
| js/ui/chart_viewport.js | 100% | 76.05% | 未達 |
| js/ui/budget_settings_controller.js | 100% | 85.71% | 未達 |

機能差分の独立コードレビューは全員PASSであるが、**定量ゲート未達のため総合Grade A+・マージ可能とは判定しない**。新規controllerの分岐未達も既存問題へ隠さず開示する。本人の「今回の機能差分で区切り、既存全体の品質改善は別件にする」を維持し、本件では機能実装・検証結果・未達の記録とローカルコミットまでとする。

### 各97%の未達一覧

| ファイル | Line | Branch |
| --- | ---: | ---: |
| gas/Code.gs | 98.18% | 80.52% |
| js/app.js | 81.81% | 50% |
| js/sync.js | 98.55% | 88.58% |
| js/version.js | 100% | 92.64% |
| js/db/backup_merger.js | 99.46% | 92.5% |
| js/db/backup_replacement.js | 100% | 74.07% |
| js/db/storage_engine.js | 97.64% | 78.4% |
| js/db/yose_db.js | 100% | 91.63% |
| js/logic/aggregator.js | 100% | 91.9% |
| js/logic/budget_engine.js | 100% | 96.41% |
| js/logic/category_trend.js | 100% | 90% |
| js/logic/data_integrity.js | 100% | 93.03% |
| js/logic/transaction_factory.js | 100% | 94.49% |
| js/ui/advance_link_controller.js | 100% | 82.6% |
| js/ui/auth_controller.js | 99.43% | 85.85% |
| js/ui/backup_import_controller.js | 100% | 80.32% |
| js/ui/budget_settings_controller.js | 100% | 85.71% |
| js/ui/bulk_edit_controller.js | 100% | 92.98% |
| js/ui/chart_controller.js | 96.87% | 68.54% |
| js/ui/chart_viewport.js | 100% | 76.05% |
| js/ui/coordinator.js | 89.06% | 84.24% |
| js/ui/furusato_controller.js | 98.6% | 89.23% |
| js/ui/insights_controller.js | 100% | 80% |
| js/ui/maintenance_controller.js | 97.39% | 81.33% |
| js/ui/master_conflict_controller.js | 100% | 85.24% |
| js/ui/master_controller.js | 90.64% | 78.85% |
| js/ui/settings_controller.js | 81.85% | 61.45% |
| js/ui/summary_controller.js | 95.03% | 69.81% |
| js/ui/sync_status_controller.js | 95.52% | 74.32% |
| js/ui/tag_memo_input.js | 97.36% | 69.69% |
| js/ui/tx_edit_controller.js | 99.2% | 82.06% |
| js/ui/tx_input_controller.js | 96.94% | 72.23% |
| js/ui/tx_list_controller.js | 97.9% | 75.35% |

### 検証境界

ブラウザは実Chromium/CDPであり、新規グラフ試験は実Chart.jsで行った。他の既存UI試験は従来のChart.js stubを用いる。GASは実署名処理とモックのDrive/Spreadsheet環境であり、本番GASへのデプロイ・物理端末での動作確認は実施していない。
