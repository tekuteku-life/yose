# 全対象カバレッジ受入の是正

## 起点と変更範囲

review66の機能差分はNode1364件・実UI631件が成功したが、Line 97.56%/Branch 85.32%、54対象中36ファイルでファイル別97%が未達である。本人の「続けて」により、この未達を解消する工程へ再入する。未コミットのfeature/transaction-workflow-performance上で既存機能の受入を完了させる作業であり、認証・金融・互換データの検証を緩めない。

計測対象、Istanbulの計算、各ファイルLine/Branch 97%、4層の実行、元原本hash検証を変更しない。ignoreコメント、counterの書換え、対象除外、架空状態を作るだけのmockで到達不能分岐を埋めることは行わない。

## 監査と是正方法

全36ファイルを仕様・実装・既存assertへ照合し、分岐を次の契約へ分類する。子locationが空のimplicit else/default argumentはbranchMap本体のlocationへ戻してから判定する。

| 分類 | 必要な根拠と対応 |
| --- | --- |
| 未操作の利用者操作 | 実DOMのclick/input/change、対象ID・表示状態・draftと保存結果を直接検査する |
| 正規の空/省略/旧データ | 仕様上許容される入力をDB/取込/公開APIから与え、数値・分類・保存形式を検査する |
| 通信/保存/認証/競合の故障 | 実処理の境界をgate/faultで制御し、全原本・後発版・新draftを保持することを検査する |
| 必須DOM/構成の冗長fallback | index.htmlの静的ID・常設controllerの構築・全callerを照合する。部分DOMへの無処理を公開契約としない箇所だけ簡素化し、正常UI結合を維持する |
| 旧出力形式への暫定fallback | 現在の純粋関数と全callerの返値が一意なら正規形式へ統一する。永続データの旧形式とは区別する |
| 未使用処理 | HTML/全caller/文書/試験を検索し、要求に属する金融機能を残したまま、真に利用されないUIだけを除去する |
| 防御分岐 | 到達可能性を記録する。必要な防御は維持し、指標を満たすためだけの不正なmockや構文置換を行わない |

## 対象と観点

| 対象 | 設計契約・具体的確認 |
| --- | --- |
| GAS・同期・DB・取込 | I-3.8〜3.10/I-4.1〜4.3/I-7.2・7.6、R/E/I-3.65〜71。許容省略/旧形状、署名/時刻/nonce、原子的拒否、送受信結果と世代所有権を検査する |
| 集計・予定・予算・費目推移 | I-3.1〜3.5。0/負値/未入力、保存済み月次との重複、任意ID、予定/確定、実態/計上、未知分類を数値で照合する |
| 登録・編集・一覧・一括操作 | I-3.7、R/E/I-3.64〜71。選択/解除・連打・取消・再締め・異常・世代切替と実保存/draftを検査する |
| 認証・設定・マスタ | I-3.6/I-4.3・4.4、R/E/I-3.49・3.71。祝日追加/重複/外部API/JSON編集、入力検証、正常な反映、保存後刷新失敗、鍵/認証の旧応答を検査する |
| 収支/予算/資産集計UI | I-3.4・3.5、R/E/I-3.55〜63。期間/軸/予定/空表示、タグ検索・クロス表、保険満期、旧外部資産、目標の良好/注意/超過とgraph/fallbackの表示を検査する |
| グラフと操作部品 | R/E/I-3.59・3.63・3.68。空/全hidden/Chart不在、凡例/tooltip、範囲外wheel/touch/0距離/破棄後、busy旧owner/元aria状態復元を検査する |
| 起動・公開facade・版更新 | I-2.2/I-4.6/I-7.7。DOMContentLoaded前後・多重起動防止・初期化失敗、互換facadeの引数/返値/例外の委譲、offline/cache/session失敗のデータ非破壊を検査する |

## ファイル別の起点と先行assert

行番号はreview66の固定原本に対する起点位置であり、変更後の対応は実assertと差分で追跡する。分岐を個別にmockする計画ではなく、同じ契約を通る許容データ・実操作・実故障を束ねる。

| ファイル | 代表位置・既存不足 | 合法scenarioと具体assert・cleanup根拠 |
| --- | --- | --- |
| gas/Code.gs | 218〜307のSheet API代替、1078〜1298の固有整合性 | 投資旧shape・カード精算/請求月/二重精算・税/住宅/繰越/overflowを正当対照と対にし、狙う診断pathと全sheet原本保持をassertする。Sheet APIは公式契約とmockを確認した必須methodだけ代替経路を除去候補とする |
| js/sync.js | 88/92/158/165/484/497 | finish中pending読取保留後の実鍵変更、取込ACK不一致/不正日時、送信待機中の削除/元計上月を実署名で検査し、旧owner非帰属・確定partial・新原本保持をassertする。ACK必須確認後のmaster_config||configは冗長候補である |
| js/db/backup_merger.js | 271〜273、旧外部資産/予算 | 税設定local不在だけ採用、既存優先、旧外部資産と0予算を公開importから通し、採否と金額をassertする |
| js/db/backup_replacement.js | 30/52と種別判定 | export_type省略、種別外collection、collapsed_panes、子分類省略/不正振替をprepare→commitで検査する。同じ同期validate内で既に拒否される重複ID判定だけを削除候補とする |
| js/db/storage_engine.js | 175〜186、鍵保存/失効 | memory/native IDBの複数security key保存と実write中の認証失効、正常保存値と全key原本保持をassertする。未知storeや不可能なrequest形状で数値を埋めない |
| js/db/yose_db.js | 111/254〜258/505〜553/655〜665 | metadataのない旧plaintext検索、競合master、close/confirm/generateの正規0/未入力と安定ID衝突、outbox整合/ACK失効を公開APIで検査し全raw/baseを比較する。awaitを挟む入力検証は単純な重複として削らない |
| js/logic/aggregator.js | 旧snapshot/先頭観測/タグ | closing_balancesのない旧月次、観測日とanchor前後、旧数値/object集計、外部資産alias、空白タグを数値assertへ追加する。保存済み旧形式対応を維持する |
| js/logic/budget_engine.js | 27/131/198/225 | 前年収入なし・incomeActual省略・予算0超過の算出値をassertする。既にsafeIntegerを保証済みの同値再検査だけ削除候補とする |
| js/logic/category_trend.js | 42〜56 | 収入旧alias3種、archive取得完全/不足/0、実態未指定と未分類の実額・hidden対象をassertする |
| js/logic/data_integrity.js | 投資/精算meta/税設定の未実行診断 | JS validatorとGAS push/retro/update/replaceへ同じ合法/不正matrixを通し、特定path拒否と全原本保持、合法対照の保存額をassertする |
| js/logic/sync_changes.js | 26の初期master不在 | 移行前/後の業務差分を計数し、未存在のIDを作らず方向別結果をassertする |
| js/logic/transaction_factory.js | 706〜716等 | 保険day/start/分類の既定と更新、旧interval/amount_pending/手入力同値、端数をpublic factoryと生成DBで検査する |
| js/app.js | 17/25と初期化catch | DOMContentLoaded前/後のsingleton、多重startと実init失敗を入口経由で検査し、生成回数・公開instance・診断をassertする |
| js/version.js | 41/49/97/102 | 省略options、offline/default endpoint、active/waiting SW、session/CacheStorage拒否を公開APIへ与え、更新判定・メッセージ・IndexedDB非破壊をassertする |
| js/ui/advance_link_controller.js | 21〜33/44〜81 | 旧参照の未取得、取消/候補なし、解除の再締め取消、commit後表示失敗、背景同期失敗を実dialogで検査し、原本/分類/通知をassertする |
| js/ui/backup_import_controller.js | 41〜49/59/82/93〜103 | preview前後の実同期・認証変更、種別別preview数、再承認の取消/確認語不一致/更新競合を検査し、pending/baseと新draftを保持する |
| js/ui/budget_settings_controller.js | 13/19/23/27/45/64/87〜108/128 | 未準備・保存/読取中の実native入力、未設定年度、0収入/未算出/超過/内訳不足、auto前年なし、postcommit表示失敗を検査し、draftと年度別原本をassertする |
| js/ui/chart_controller.js | 36〜66/136〜152/188〜291 | Chart未読込・空/全hidden・null値・dark/light・旧外部資産を実chart/数値表へ通し、系列/値/破棄/tooltip率をassertする。tag出力の既知別名fallbackと必須canvas guardは下記根拠によるcleanup候補である |
| js/ui/chart_viewport.js | 11〜12/21/31/37〜56/71 | 範囲外wheel、0 delta、片/重なりtouch、inactive/破棄後、hidden canvas、anchor補正をcomponent/実Chart UIで検査し範囲・default阻止・listener解除をassertする |
| js/ui/coordinator.js | 160/195〜251/375〜490/537〜611/646以降 | tab/モーダル重ね/scroll/テーマ・localStorage失敗、旧認証の描画中断、背景末尾要求/失敗、公開facadeの引数・返値・例外をassertする。互換facadeは削除しない |
| js/ui/furusato_controller.js | 45〜61/95〜121/160〜191 | 年度/税率省略、未算出/過不足、notice指定なし、実保存後表示失敗と再ロック、source選択0件を検査し、税draftと保存値をassertする |
| js/ui/insights_controller.js | 36〜39/63/73/81/93〜104 | 空/旧投資記録・明示null・archiveのみ・未読取draft、削除取消、DB失敗とcommit後刷新失敗を検査し、原本と数値表/新draftをassertする |
| js/ui/maintenance_controller.js | 67〜85/104〜129/149〜158 | 0候補/未選択、分類/口座移行、取消と失効、後発原本、commit後結果表示を検査し、対象参照だけの更新/全件原子的拒否をassertする |
| js/ui/master_conflict_controller.js | 20/35/65〜77/99〜108 | 競合detailの省略値/削除候補、未選択、取消と検証失敗、閉鎖後の旧検証を検査し、選択辞書・新dialog・通知をassertする |
| js/ui/summary_controller.js | 113〜117/185〜186/303〜451/539〜548/635/905〜1124/1204〜1217 | picker/タグ検索・クロス表・0/空/旧資産・保険満期・予算良好/注意/超過・実態年次・API省略を数値/系列/対象IDでassertする。未使用外部資産専用listとタグ暫定fallback、下記必須root guardだけ除去候補である |
| js/ui/tag_memo_input.js | 35〜58/79/94/106〜118 | focus移動/relatedTargetなし・チップ以外click・hidden field復元・重複タグ・callbackなしmemoを実入力部品で検査し、チップ/候補/hidden値/通知回数をassertする |
| js/ui/auth_controller.js | 26・40・52〜53の鍵復旧、181の初期設定失敗、201〜219の未登録鍵再生成。既存不足は下記監査に示す | E-3.43/46: 初期設定の実IDB保存失敗、パッケージ欠落時PIN拒否、鍵復旧の署名確認/保存公開鍵再読取間に実再ロックまたは実鍵版変更、未登録状態で有効PINを用いた鍵再生成。raw原本・復旧後の署名・旧材料wipeと新session非干渉を確認する。 |
| js/ui/master_controller.js | 74〜97の祝日、110〜125のAPI、274/326/354/401/411/453の保存、499〜508の口座型。既存不足は下記監査に示す | E-3.6/8/44/48: 祝日通常追加/同日重複/空一覧/プリセット冪等、実fetch境界の成功JSON/HTTP拒否/通信失敗、各archive/復元/定期削除の取消と保存拒否、保存保留中の再提出拒否。既存正規口座種別を実編集で開き型別欄と保存値を確認する。 |
| js/ui/settings_controller.js | 93〜105/131の保存、270〜315の解除/JSON、381〜420の更新、481〜498のポイント保存。既存不足は下記監査に示す | E-3.13/15/43/44/71: JSON表示→閉鎖→再表示、正規変更/不正JSON/後発CAS拒否、PIN保存/URL保存失敗、WebAuthn解除取消/旧共有bundle掃除/解除失敗、更新通信失敗/更新取消/確認承認。ポイント保存commit後の表示失敗と失効時通知抑止も追加する。 |
| js/ui/bulk_edit_controller.js | 178〜190の対象消失・認証失効・保存済み表示失敗。既存不足は下記監査に示す | E-3.64/66/68/69: 選択後に対象1件を実削除して一括削除の原本件数不一致を拒否、削除commit後のrefresh失敗を保存済みと1回通知、旧失敗完了が新dialogへ通知しない。未適用軸/全raw/選択・busyを確認する。 |
| js/ui/tx_edit_controller.js | 49の関連表示、108〜203の編集読取、286〜312の競合、379〜417の保存/削除後刷新。既存不足は下記監査に示す | E-3.7/22/42/68/69: 編集を開く読取失敗と対象削除、既存前払の別関連明細が後発更新されたCAS拒否、保存/削除commit後だけrefresh失敗、ひも付けopen失敗/取消、各await後の実auth失効で新編集を維持する。 |
| js/ui/tx_input_controller.js | 128〜153のメモ分類、447〜485の未回収、566〜578の電卓、691〜755の明示0、791〜795の保存済み刷新。既存不足は下記監査に示す | E-3.1/9/12/19/43/48/68/69: 立替/回収/前払/ポイントの明示0を実UIで拒否し空欄予定と区別、電卓の一文字削除→0、実メモ収入分類/古い子/子未指定、未回収一覧の空メモ・後発精算/削除・締め承認取消、commit後refresh失敗を追加する。 |
| js/ui/tx_list_controller.js | 98〜110の確定、183〜202のタグ復帰、278〜282の日別収入、302の並び順、366の削除失敗。既存不足は下記監査に示す | E-3.40/42/47/67/69: 日別収入内訳からの実ドリルダウンで取引日月フィルター・タイトル・該当ID、存在しなくなったtagのall復帰、同日同時刻の安定並び、行内確定の再締め取消/DB失敗/commit後refresh失敗、確定保留中の実再描画とボタンbusy保持を確認する。 |
| js/ui/form_busy.js | 21の旧owner、24〜25の既存aria属性復元。既存不足は下記監査に示す | E-3.68: 実DOMを用いるhelper契約試験で同一rootの旧releaseを新owner後/二度release後に実行し新ownerを保護する。既存aria-busy/aria-labelの完全復元と切断済みcontrolを確認する。金融フローを偽装しない。 |
| js/ui/sync_result.js | 9の結果なし失敗、17のlocal_changed、25の片方向確認済み。既存不足は下記監査に示す | E-3.65: 正規のnull result+error、master_conflict/local_changed、完全取込内訳不明かつ片方向だけ確認済みの結果をpure text試験で確認する。送受信の行を個別比較する。 |
| js/ui/sync_status_controller.js | 44〜45の旧manager、92〜99のbadge、119〜140の再締め承認/最終刷新。既存不足は下記監査に示す | E-3.43/44/65: 実署名fetch_stateで別端末締めを受信し、確定明細の承認/取消・金額未入力の拒否、承認UI保留中の実lock/unlock、古いmanagerの予約callback、最終refresh失敗でも結果/badgeと新draft保持、未同期0件の通信失敗badgeを検査する。 |

### UI 10ファイルの代表位置と既存assert差分

#### 既存assertとの差分

- test/ui/settings_workflows.test.js:232は追加日付未指定、テキスト重複/追加、削除を検査するが、通常の日付指定追加・同日再追加・プリセット・オンラインAPIを検査していない。master_controller.js:74-125の未hitと一致する。
- test/ui/native_render_session.test.js:122は各表示readの実AES/auth失効と正常分類、:153は編集AからBへの同認証競合を検査する。保存済みrefresh失敗/各UI保存初期read失敗/同期manager予約callbackは別契約である。
- test/ui/transaction_actions.test.jsは確定/一括削除の通常・取消・原本競合・旧authを検査するが、bulk_edit_controller.js:189、tx_list_controller.js:103のcommit後表示失敗は未hitである。
- test/ui/point_payment_defaults.test.jsは通常設定/archived/後発拒否/reload/read競合を検査するが、settings_controller.js:490の保存済み表示失敗は未hitである。
- test/ui/passkey_prf.test.js:45/56/91/105/123/134/146/180は取消、PRF成功/拒否、置換失敗、commit直後ロック、別鍵wrap、登録後再生成を検査する。未登録状態での正規再生成/復旧処理の各await間の後発公開鍵変更は別途必要である。
- 新規master JSONはindex.html:895-898に実UIがあり、settings_controller.js:297-315が未hitである。DOMを追加する試験ではなく実ボタンを使用する。
- 全試験は実render/save Promise、対象ID/年度、enabled/readOnly、入力後draft、最終rawを確認し、固定sleepやDOM値だけを成功条件としない。

#### 削除候補（本段階では未承認）

1. tx_list_controller.js:290のformatDate存在判定は同ファイル先頭でESM import済みの関数に対するものである。module linkが成功した実行中に関数不在へならない。日別正規入力の先行回帰を維持して不要fallbackを削除できる候補である。
2. tx_input_controller.js:410/422/424のaddTag/renderMemoSuggestions/renderTagSuggestionsは全JS/HTML/test検索で呼出がない。実イベントはtag_memo_input.jsが自分自身の処理へ接続し、coordinatorの互換facadeにもこれらの委譲がない。未使用APIの候補であり、互換公開契約の最終確認後だけ削除する。
3. tx_edit_controller.js:30のsyncManager getterは同controller内でも全caller検索でも参照がない。保存は専用coordinator refresh経路であり、旧同期待ちの残存API候補である。
4. tx_input_controller.js:519-521のcalcTaxMeta.tax_amount不在補完は、calcTaxMeta代入がnullまたはevaluateCalculatorExpression返値のみであり、非null返値はtransaction_factory.js:41/649-655でtax_amountを必ず持つ。保存済み税情報をこの変数へ読み戻す経路はない。電卓8/10%と0円の正規契約を先行確認して削除する候補である。
5. settings_controller.jsのimport結果stats/typeのfallbackはDB importFullDataが検証済み種別とstatsを常に返す契約と照合し、例外を正規返値として補完していないことを確認してから判断する。未確認のまま削除しない。

cleanup5のproducer照合は次のとおりである。Settingsの差分取込は唯一のUI callerであり、YoseDB.importFullData（起点414〜471行）は検出した種別をBackupMerger.validateImportDataへ渡す。同validatorのrequiredFieldsはfull_backup/transactions/master_config/annual_budgets/summary_snapshotの5種だけを受理し、未知種別を保存前に拒否する。成功時statsは追加/更新/スキップ明細、口座、親費目、内訳、定期、祝日、年予算の9数値keyを全て0で初期化し、mutateBusinessのresultとして{success:true,stats,detectedType}を必ず返す。例外はUIのcatchへ伝播する。よってres?.stats、typeNames[res?.detectedType]、各stats値の0補完は永続データの旧形状互換ではなく、一意なproducerの返値に対する冗長補完である。独立Phase2/3承認後、通常の実ファイル差分取込で5種の表示名、0件を含む各件数、失敗時の全原本保持の既存assertを維持して正規返値へ統一する。

#### 防御分岐・実現困難な分岐

- 常在index DOMを取得した直後のif(element)、authの常在summaryController欠落、UIcontroller内のtypeof window/AbortController不存在等が多数未hitである。DOMを消す、必須controllerをundefinedにする、合法でないDB返値を返すだけの試験は提案しない。
- 必須DOM guardの削除には、indexの一意ID/全controller初期化順/DOM生成と破棄を文書化した共通契約と、正規surfaceの静的検査が先に必要である。動的modalの所有権やauthで切断され得るnodeと一括扱いしない。
- config.accounts/categories/holidays、旧明細tags/status/type等のfallbackは旧データ/共有masterの任意field契約に関係する。正規に不在が許されるかvalidator/取込契約を確認せず削除しない。
- 各await後valid再検査、旧ownerのfinally抑止、暗号/認証異常は維持対象である。異常の再現は実DB/crypto/fetch境界をgateし、実lock/unlock/後発保存で行う。到達不能だという理由だけでセキュリティguardを消さない。
- 運用TLS・OSパスキー本体・本番GAS公開はCDP/mockで証明できない境界である。ここを架空counter/ignoreで達成扱いしない。


### cleanupの静的根拠

- Summaryの必須KPI/見出し/root: summary_controller:350〜445/673〜682/755〜764/826〜837/951〜1082は、index.htmlのasset-stat-grid/cashflow-stat-grid/budget-stat-grid/stat-income/stat-expense/stat-net-income/stat-confirmed-balance/chart-title/table-title/account-balances-title/card-monthly-operations/card-tag-analytics/card-cross-matrix/card-month-tx-list/card-category-breakdown/card-budget-category-progress/breakdown-table-containerに対応する。これらのrootはindex静的定義、タブ操作はstyle/classを変えるだけで削除しない。AppCoordinator constructorがsummary/chart/txListを全て生成してからfinishAppInit→setupSummaryView/renderSummaryへ渡す。各renderは内部から同じrootへ描画し、部分DOMを注入する公開契約はない。各実UIのタブ/期間/空表示で正しい出力を先行assertする。
- Chartの必須root: summary-chart/chart-fallback、asset-history-chart/asset-history-fallback、category-trend-chart/category-trend-fallback、各prefix-series/reset、category-breakdown-chart/container、tag-chartはindex静的定義である。source.drawTimeのcanvasId/prefixはrenderAssetHistory/renderCategoryTrend/renderChartForDaily/Monthly/Yearly/BudgetProgressの固定callerから来る。Chart本体の不在と一時layout/scaleの不在は有効状態であり、そのguardは維持する。
- Summary/Chartのタグfallback: calculateTagSummary:623〜630がtagListを必ず返し、要素は同関数:584〜613でtag/expense/income/netを必ず作る。Summary.renderTagSummaryからChart.renderChartForTagsへ同じ返値を渡す。旧レビュー22の暫定別名対応を外すが、public calculateTagSummaryのtags辞書や別名field返値自体は互換のため削除しない。
- 口座型の実不具合: data_integrity:7が受理するelectronic_moneyをmaster_controller:499〜508の選択肢が持たず、名称変更だけでbankへ置換する。実UI probeで再現した。E/I-3.6の正規全口座型の表示・名称変更時の型保持を先行assertし、validatorで旧型を拒否する回避は行わない。

## cleanupの制限

SummaryのrenderExternalAssetsBreakdownとsummary-external-assets-listは現HTML/呼出に存在しないため削除候補である。同じsnapshot.external_assetsの金融集計・GAS・取込互換は必要であり削除対象にしない。

calculateTagSummaryはtagListと正規行（tag/expense/income/net）を常に返す。この関数出力に対するtags辞書/配列や旧別名への暫定fallbackは、全callerと既存assertの照合後に除去する。保存済み明細・snapshot・マスタの旧形状への対応をまとめて削除しない。

AppCoordinatorのfacadeは互換APIとして維持する。未実行であっても削除せず、正しい対象controllerへ引数を渡し、同期/非同期の返値・例外を保持する契約を検査する。

index.htmlと版の一致した常設UIが本アプリの描画契約である。必須panel/KPI/selectorと常設controllerをoptional componentとして扱う冗長guardは、静的HTMLと構築順に根拠のある箇所だけ除去候補とする。Chart.js未読込・ブラウザAPI差異・動的な選択肢/行・認証失効によるguardは維持する。

## 工程と完了条件

先行UIで、共通validatorとDB保存が受理する`{schema_version:2}`の旧master（任意collection省略）が、資産タブの投資計算へaccounts未定義を渡して例外となることを確認した。Summaryの表示adapterで任意accountsを空配列として受け、資産/投資の表示へ同じ正規化済みconfigを渡す。保存masterを書き換えたり、旧形式をvalidatorで拒否する回避はしない。空資産の0円/登録なしと全raw不変を実UIで先行検査する。

E-3.6の空の新規ID自動採番について、masterのID inputにあるrequiredが正規submitを妨げる場合は、account/category/subcategoryで失敗再試行と保存1件/編集参照を先行検査し、該当ID欄を任意入力とする。業務上必須の名称・種別・金額等のnative validationは維持する。

先行matrixで、GASがprevious_target_month不正月を永続化前の除去で黙示受理するJS/GAS不整合を確認した。I-4.2の補助情報形式として、共有validatorへ任意approved配列/要素月の検証を追加し、GASでは除去前の送信batchから対象IDの補助情報に対応する完全なpathの診断だけを採用する。元の保存候補全体検査は維持する。retroトップレベルpreviousも存在で統合し、false/0/空文字の黙殺を避ける。push/retroの合法対照・不正previous/approved・全業務sheet原本保持を先行検査し、認証台帳の正常な消費と区別する。署名/JSON解析の契約は変更しない。

設計の独立レビュー後、契約ごとの先行テストを作成し独立観点レビューを行う。実装の不要処理除去が必要な場合は承認済み範囲へ限定し、構文/型/GAS生成一致後に実行する。不具合が見つかった場合は最上流へ戻り、初回NGを残して再検証する。

局所計測は診断用であり、原本が異なる旧counterと新counterを混ぜた値を受入に使わない。最終原本/試験を固定し、全4層100%成功と全54対象のLine/Branch 97%以上を1回の統合計測で確認する。必要な新本番moduleが生じた場合は対象へ自動追加されるままとする。独立の最終コード/記録レビューが成立してから英語Conventional Commitsへ進み、PR草案を更新する。外部push/公開PR/merge/本番デプロイは行わない。

## Backendの既存assertとcleanup証明


起点はa74bac0、現行coverage/coverage-final.jsonと/tmp/yose67-gaps.jsonである。以下は実行予定であり、合格実績ではない。Line/Branch各97%の閾値・対象・集計方法は変更しない。狙う不正フィールド以外を正当値にした入力を作り、具体的error path/codeと正当対照を併記する。単なるsuccess=falseでは早期の無関係拒否を見逃すため不十分である。

|対象・仕様ID|既存assertと不足の位置|合法的な追加scenarioと具体assert|
|---|---|---|
|gas/Code.gs、R/E/I-3.46/3.65/3.71|test/unit/data_integrity_gas.test.js:24–36は基本明細型/参照拒否と業務state保持である。source:1078–1084精算meta、1127–1129二重精算、1184税input_modes、1296–1298アーカイブ参照が未実行である。|実doPost署名経路のpush_diff/retro/update_master/replaceへ、実在カードと振替元先を持つ正常精算からcard role/月/元先を一つずつ変えた入力を送る。狙うpath/code、全sheet raw不変、nonce等認証metadataと業務rawの区別、正常対照の元先口座・額・締め残高をassertする。完全取込journalの破損/欠落は実sheetに保存された旧journalから再実行し、早期停止と業務原本保持を確認する。|
|js/sync.js、R/E/I-3.65/3.69|sync_committed_results/sync_epoch_metadata/sync_received_attributionはcommit後故障・same-key世代・並行local帰属を既にassertする。source:88/92 finish中auth失効、158/165–166 ACK競合、484 outbox待機中対象消失、497元計上月付き遡及が不足である。|実暗号DB・署名GASでpending読取を保留しsetEncryptionKey/lock後解放する。旧owner結果非帰属を確認する。完全取込は実outboxを作りimport_id/日時だけを不正にした応答でoutbox/base全raw保持をassertする。元計上月から移動する遡及は旧archiveからの除去と新月への一度だけ計上をassertする。|
|js/db/storage_engine.js、R/E/I-3.49/3.69|transaction_storage_performance.test.js:41–100は実AES/cache/inflight/clone/LRU、111–146は差分write/全CASをassertする。source:175–186複数security-key保存、192空batch、native request/transaction故障が不足である。|公開複数key保存をmemory/nativeIDBで通し、取得keyの各値と他key保持をassertする。実request success待機中に認証失効し全key/rawがrollbackすることを確認する。空batchが一切writeしない対照を置く。quota等は実IDB故障注入と明示し、架空のtx.errorを手動発火させない。|
|js/db/yose_db.js、R/E/I-3.65–3.70/3.45/3.46|transaction_actionsはbulk/confirm/generateの原子的競合・authを検査済みである。source:254–258旧plaintext metadataなし検索、111競合merge、505/532/543/553入力/安定ID衝突、655/658/665 outbox版/世代/ACKが不足である。|既存保存形式の旧rawを読み、deleted/月/syncの各結果IDと金額をassertする。公開APIへ不正ID/月、閉月planned/unknown、既存の別役割と同じ安定IDを与え、具体拒否と新到着を含む全raw保持を確認する。pending更新中に実keygenを進め旧outbox復活なしを確認する。|
|js/db/backup_merger.js、R/E/I-3.15/3.57/3.58/3.71|db.test.js:649–706は疎なlocal masterとcollapseを検査する。source:138–139 external_assets、271–273税設定の空local採用、0予算・旧local形状修復が不足である。|importFullDataで旧local税設定不在へ正当incomingのcalculation/sources/estimateを追加し、既存local年/額/費目は保持して欠落欄だけ採用することをassertする。既存local値があればincomingを採用しない対照と、invalid incomingはlocal優先でも全拒否する対照を置く。外部資産ID/額/金額0の保持を確認する。|
|js/db/backup_replacement.js、R/E/I-3.26/3.45/3.46|replacement_import/replacement_integrity_boundariesは確認/原子置換・参照拒否をassertする。source:30 export_type省略、32種別外collection、42子省略、47collapsed_panes、56/58日付/振替境界が不足である。|全backup/単一kindの旧export_typeなしをprepare→commitで通し、判別種別と完全置換対象・非対象全rawをassertする。明示kindと別collectionを混在、閏日不正、同口座振替、子省略を独立入力にし、具体エラーと正常対照を検査する。|
|js/logic/data_integrity.js、R/E/I-3.46/3.57/3.58/3.71|data_integrity.test.js/integrity_boundaries.test.jsは全更新入口を検査するが、税設定未知key/採用mode、保険満期、精算role、snapshot subtotal overflow等の個別枝が不足である。|公開issues/assertChangeへ有効master/txを基本とする単一違反matrixを適用する。path/codeと変更原本保持をassertし、同じ正常/異常データをGAS生成validatorにも通す。循環はJSON外のプログラムAPI入力としてのみ検査し、外部JSON受信と称しない。|
|js/logic/sync_changes.js、R/E/I-3.65|sync_change_summary/point_payment_defaultsは旧collection形状と有効ID集計を検査する。source:26 master不在の初期状態が不足である。|businessChangesへmaster不在→正当口座あり、および逆方向を渡し、実在業務IDのみ一度計数し、架空ID/鍵/端末設定を含めず入力も変更しないことをassertする。|
|js/logic/aggregator.js、R/E/I-3.18/3.23/3.58/3.59|asset_history.test.js:17–65は予定/未来除外、closed残高、観測不足、原価carryを検査する。旧closing_balances不在snapshot、anchor前後、旧summary数値/object、外部資産alias、空白tagsの枝が不足である。|実際の旧schemaのaccount_balancesだけの閉月から月/年/range/allへ集計し、基準日の既知残高と取引増減/負債/投資観測を具体額でassertする。旧summary優先で取得済明細が二重加算されないこと、空tag除外と正当tag額、axis別cross額を確認する。|
|js/logic/budget_engine.js、R/E/I-3.14/3.59|logic.test.js:1464–1763は予算進捗・旧別名・前年丸め/defaultを検査する。source:131前年収入なし、198incomeActual未指定、225予算0超過が不足である。|前年に支出だけある正当summaryで新年既定を計算し、収入0と丸め予算をassertする。incomeActual省略時summaryからの収入額、予算0/支出正のover_budgetと0支出対照をassertする。|
|js/logic/category_trend.js、R/E/I-3.47/3.59|category_trend.test.js:15–80は支出軸・snapshot優先・年跨ぎを検査する。source:42–56は収入の旧aliasとarchive取得証明が不足である。|income_total/income_confirmed/total_income別の旧月次を使い、archiveMonthsあり+明細合計完全一致時だけ実分類額へ帰属、未取得/額不足時はunknown、総額0時は架空unknownを作らないことをassertする。実態未指定→計上/未分類の額、他年除外/年次採用、dateのみ旧明細も検査する。|
|js/logic/transaction_factory.js、R/E/I-3.25/3.35/3.70|recurring_manual_dedup.test.jsは手入力同値除外、logic.test.js:2378以降は指定保険分類で生成/更新/無効化を検査する。source:706–716保険既定、旧interval/amount_pending、calculator丸め枝が不足である。|保険の分類指定省略・保険料日省略/範囲端・既存start保持を正規account保存→連動ruleのID/額/分類/日でassertする。旧frequency/interval省略、金額未確定、holiday省略のルールから生成/skip件数とID/額/未変更原本を確認する。電卓は実公開入力式・round設定から円額をassertする。|

### 不要候補と残す境界

削除は独立設計承認後に限る。以下は単なる未到達を根拠にしない。

- sync.js:242のresponse.master_config || configは:241のassertPointAcknowledgementが全update_masterでmaster objectを必須とするため右辺に到達しない（R/E/I-3.65/3.71）。:230は:228 assertSession後にawaitがなく純粋所有predicateを再検査するだけである。:235のawait後検査は残す。
- backup_replacement.js:52のunsafe/duplicate IDは:31→BackupMerger.validateImportData:50–56が同じ同期呼出内で既に全拒否する（R/E/I-3.26/3.45/3.46）。yose_db.js:453も同じ直後重複である。ただし:459はmutateBusinessのawait後にcaller入力が変化し得るため、この証明では削除しない。
- yose_db.js:624はprepare時:608のWeakMap canonical版がdataとdetectedTypeを含み、commit時:617–618で改変全体を拒否し、同じデータを:623で再prepareするため型だけ変わる分岐に到達しない。入力cloneと版検査は維持する。
- budget_engine.js:27はincomeが:12で非負safeInteger、独立値が:26、primaryが:23で同条件となる。rateは0–100のBigInt比でincome以下、差は±MAX_SAFE内に収まるため、最後だけsafeInteger不正になる経路はない（R/E/I-3.14/3.59）。
- merger:209/264等のincoming無効値skipは上流validatorとの重複候補だが、直接public helper callerと旧local修復契約を確認するまで削除しない。旧local不正配列の正当修復は維持する。
- storage未知store/tx.error null代替、正規base64のdecode throw、暗号内部特殊数学、実サービスメソッド欠落は正規操作を装った架空stateで埋めない。quota/disk/service故障注入はモデル検証であり実サービス発生の証拠とはしない。

### GAS必須APIの一次資料確認

公式SpreadsheetにはgetId/getName/getSheetByName/insertSheet/getSheetsがあり、SheetにはgetLastRow/getRangeがある。SpreadsheetApp.getActiveSpreadsheetはメソッド自体が存在する一方、戻り値nullは正当である。従ってmethod欠落のtypeof代替は整理候補であるが、active=nullと例外時の安全停止は残す。実mockもtest/helpers/gas_mock.js:73/77/85/113/117/121/125/129/217–218で同APIを実装する。

- https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet#getId()
- https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet#getName()
- https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet#getSheetByName(String)
- https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet#insertSheet(String)
- https://developers.google.com/apps-script/reference/spreadsheet/sheet#getLastRow()
- https://developers.google.com/apps-script/reference/spreadsheet/spreadsheet-app#getActiveSpreadsheet()

生成GAS validatorはscripts/sync_gas_integrity.mjsを通し、check:gas-integrity一致を検査する。source/試験原本は本Phase1で未変更である。


## 静的root IDの定義照合

次は上記Summary/Chart cleanup候補の定義照合である。存在することだけで全guardを削らず、rootの生成/破棄・動的参照・公開callerの条件を併せて確認する。indexにないsummary-external-assets-listはこの表へ含めず、未使用UI候補として分離する。

| 取得元 | ID | 静的定義 |
| --- | --- | --- |
| js/ui/summary_controller.js:1291 | account-balances-list | index.html:520（1定義） |
| js/ui/summary_controller.js:389 | account-balances-title | index.html:518（1定義） |
| js/ui/summary_controller.js:68 | asset-custom-period | index.html:339（1定義） |
| js/ui/summary_controller.js:368,480 | asset-history-card | index.html:323（1定義） |
| js/ui/summary_controller.js:479 | asset-history-notice | index.html:350（1定義） |
| js/ui/summary_controller.js:476 | asset-investment-account | index.html:337（1定義） |
| js/ui/summary_controller.js:468 | asset-period-end | index.html:341（1定義） |
| js/ui/summary_controller.js:468 | asset-period-start | index.html:340（1定義） |
| js/ui/summary_controller.js:346 | asset-stat-grid | index.html:282（1定義） |
| js/ui/summary_controller.js:941 | bar-budget-expense | index.html:406（1定義） |
| js/ui/summary_controller.js:944 | bar-budget-savings | index.html:414（1定義） |
| js/ui/summary_controller.js:685,768,836,1034,1160 | breakdown-table-container | index.html:458（1定義） |
| js/ui/summary_controller.js:71 | btn-apply-asset-period | index.html:342（1定義） |
| js/ui/summary_controller.js:179,232,288,297 | btn-close-month | index.html:533（1定義） |
| js/ui/summary_controller.js:174,197,207 | btn-generate-recurring | index.html:530（1定義） |
| js/ui/summary_controller.js:98 | btn-period-next | index.html:319（1定義） |
| js/ui/summary_controller.js:87 | btn-period-prev | index.html:314（1定義） |
| js/ui/summary_controller.js:141 | btn-toggle-axis | index.html:442（1定義） |
| js/ui/summary_controller.js:132 | btn-toggle-planned | index.html:441（1定義） |
| js/ui/summary_controller.js:1081 | budget-category-progress-container | index.html:466（1定義） |
| js/ui/summary_controller.js:348 | budget-stat-grid | index.html:401（1定義） |
| js/ui/summary_controller.js:385 | card-account-balances | index.html:516（1定義） |
| js/ui/summary_controller.js:384 | card-breakdown-table | index.html:454（1定義） |
| js/ui/summary_controller.js:378 | card-budget-category-progress | index.html:462（1定義） |
| js/ui/summary_controller.js:377 | card-category-breakdown | index.html:470（1定義） |
| js/ui/summary_controller.js:380 | card-cross-matrix | index.html:505（1定義） |
| js/ui/summary_controller.js:382,514 | card-month-tx-list | index.html:540（1定義） |
| js/ui/summary_controller.js:381 | card-monthly-operations | index.html:524（1定義） |
| js/ui/summary_controller.js:375 | card-period-controls | index.html:302（1定義） |
| js/ui/summary_controller.js:383 | card-summary-chart | index.html:437（1定義） |
| js/ui/summary_controller.js:379 | card-tag-analytics | index.html:491（1定義） |
| js/ui/summary_controller.js:347 | cashflow-stat-grid | index.html:381（1定義） |
| js/ui/summary_controller.js:1261 | category-breakdown-list | index.html:487（1定義） |
| js/ui/summary_controller.js:418 | category-trend-chart | index.html:481（1定義） |
| js/ui/summary_controller.js:414 | category-trend-scope | index.html:477（1定義） |
| js/ui/summary_controller.js:416 | category-trend-title | index.html:476（1定義） |
| js/ui/summary_controller.js:139 | category-trend-type | index.html:475（1定義） |
| js/ui/summary_controller.js:387 | chart-title | index.html:439（1定義） |
| js/ui/summary_controller.js:298 | closing-scope-notice | index.html:528（1定義） |
| js/ui/summary_controller.js:579 | cross-matrix-table-container | index.html:512（1定義） |
| js/ui/summary_controller.js:371 | furusato-card | index.html:430（1定義） |
| js/ui/summary_controller.js:376 | granularity-control-row | index.html:303（1定義） |
| js/ui/summary_controller.js:111 | input-period-picker | index.html:317（1定義） |
| js/ui/summary_controller.js:184 | input-tag-search | index.html:496（1定義） |
| js/ui/summary_controller.js:168,499 | input-tx-search | index.html:548（1定義） |
| js/ui/summary_controller.js:370 | investment-record-card | index.html:358（1定義） |
| js/ui/summary_controller.js:942 | label-budget-expense-pace | index.html:408（1定義） |
| js/ui/summary_controller.js:949 | label-budget-pace-desc | index.html:426（1定義） |
| js/ui/summary_controller.js:947 | label-budget-rate-eval | index.html:421（1定義） |
| js/ui/summary_controller.js:945 | label-budget-savings-rate | index.html:416（1定義） |
| js/ui/summary_controller.js:669,751,822 | label-stat-expense | index.html:387（1定義） |
| js/ui/summary_controller.js:668,750,821 | label-stat-income | index.html:383（1定義） |
| js/ui/summary_controller.js:670,752,823 | label-stat-net | index.html:391（1定義） |
| js/ui/summary_controller.js:671,753,824 | label-stat-savings-rate | index.html:395（1定義） |
| js/ui/summary_controller.js:296 | monthly-operations-title | index.html:526（1定義） |
| js/ui/summary_controller.js:110,309 | period-display | index.html:316（1定義） |
| js/ui/summary_controller.js:153,496 | select-account-filter | index.html:545（1定義） |
| js/ui/summary_controller.js:66 | select-asset-period | index.html:328（1定義） |
| js/ui/summary_controller.js:158,497 | select-category-filter | index.html:546（1定義） |
| js/ui/summary_controller.js:148,495 | select-status-filter | index.html:544（1定義） |
| js/ui/summary_controller.js:163,498 | select-tag-filter | index.html:547（1定義） |
| js/ui/summary_controller.js:140,501 | select-type-filter | index.html:543（1定義） |
| js/ui/summary_controller.js:940 | stat-budget-expense | index.html:404（1定義） |
| js/ui/summary_controller.js:948 | stat-budget-pace-status | index.html:425（1定義） |
| js/ui/summary_controller.js:946 | stat-budget-rate | index.html:420（1定義） |
| js/ui/summary_controller.js:943 | stat-budget-savings | index.html:412（1定義） |
| js/ui/summary_controller.js:667,749,820 | stat-confirmed-balance | index.html:396（1定義） |
| js/ui/summary_controller.js:665,747,818 | stat-expense | index.html:388（1定義） |
| js/ui/summary_controller.js:358 | stat-external-assets | index.html:293（1定義） |
| js/ui/summary_controller.js:664,746,817 | stat-income | index.html:384（1定義） |
| js/ui/summary_controller.js:359 | stat-liabilities | index.html:297（1定義） |
| js/ui/summary_controller.js:357 | stat-liquid-assets | index.html:289（1定義） |
| js/ui/summary_controller.js:666,748,819 | stat-net-income | index.html:392（1定義） |
| js/ui/summary_controller.js:356 | stat-total-assets | index.html:285（1定義） |
| js/ui/summary_controller.js:388 | table-title | index.html:456（1定義） |
| js/ui/summary_controller.js:524 | tag-breakdown-list | index.html:501（1定義） |
| js/ui/chart_controller.js:189 | category-breakdown-chart | index.html:485（1定義） |
| js/ui/chart_controller.js:190 | category-breakdown-chart-container | index.html:484（1定義） |
| js/ui/chart_controller.js:60 | category-trend-chart-container | index.html:480（1定義） |
| js/ui/chart_controller.js:151 | chart-fallback | index.html:449（1定義） |
| js/ui/chart_controller.js:150 | summary-chart | index.html:448（1定義） |
| js/ui/chart_controller.js:149 | summary-reset | index.html:446（1定義） |
| js/ui/chart_controller.js:148 | summary-series | index.html:445（1定義） |
| js/ui/chart_controller.js:245 | tag-chart | index.html:499（1定義） |

口座種別の補強はE/I-3.6の既存値維持として扱う。受理済みelectronic_moneyを含む全11正規口座型は、名称だけの編集で別型へ置換しない。選択肢へ正規型を含め、型に関係しない編集で保存値が保持されることを実UIで検査する。

## UIの追加nullable atom候補（独立審査前）

次はAST上のatomが定数IDのgetElementByIdへ束縛され、同じindexに一意な定義を持つ136条件の候補である。動的行・意味条件・認証guardは対象外であり、表の存在を削除承認としない。AppCoordinatorは全controllerをconstructorで生成し、finishAppInitから各setup/renderを呼ぶ。index静的rootは非表示/ロックでも保持され、modalとmaster一覧はその内側を更新する。各candidateの束縛scopeと全callerで動的にrootを破棄しないことを別途確認し、Nullable atomだけの除去候補とする。

| 原本位置 | 条件 | 定義照合 |
| --- | --- | --- |
| js/ui/auth_controller.js:226 | txtPub | txtPub=txt-public-key (index:700) |
| js/ui/auth_controller.js:228 | banner | banner=pin-status-banner (index:660) |
| js/ui/auth_controller.js:233 | lock | lock=btn-lock-now (index:671) |
| js/ui/auth_controller.js:235 | input | input=input-pin (index:664) |
| js/ui/master_controller.js:81 | input | input=input-new-holiday (index:885) |
| js/ui/master_controller.js:112 | btn | btn=btn-fetch-holiday-api (index:1182) |
| js/ui/master_controller.js:118 | txt | txt=txt-holiday-import-input (index:1179) |
| js/ui/master_controller.js:125 | btn | btn=btn-fetch-holiday-api (index:1182) |
| js/ui/master_controller.js:147 | txt | txt=txt-holiday-import-input (index:1179) |
| js/ui/master_controller.js:226 | accList | accList=master-accounts-list (index:861) |
| js/ui/master_controller.js:281 | catList | catList=master-categories-list (index:870) |
| js/ui/master_controller.js:361 | recList | recList=master-recurring-list (index:879) |
| js/ui/master_controller.js:419 | holList | holList=master-holidays-list (index:890) |
| js/ui/master_controller.js:464 | !modal &#124;&#124; !title &#124;&#124; !body | modal=modal-master-item (index:1092); title=master-modal-title (index:1095); body=master-modal-body (index:1098) |
| js/ui/settings_controller.js:73 | !txt | txt=txt-public-key (index:700) |
| js/ui/settings_controller.js:107 | pinInput | pinInput=input-pin (index:664) |
| js/ui/settings_controller.js:242 | fileInput | fileInput=file-import-input (index:831) |
| js/ui/settings_controller.js:254 | details | details=key-mgmt-details (index:654) |
| js/ui/settings_controller.js:321 | badgeVer | badgeVer=badge-current-version (index:931) |
| js/ui/settings_controller.js:326 | updateStatus | updateStatus=update-status-msg (index:936) |
| js/ui/settings_controller.js:335 | updateStatus | updateStatus=update-status-msg (index:936) |
| js/ui/settings_controller.js:358 | updateStatus | updateStatus=update-status-msg (index:936) |
| js/ui/settings_controller.js:366 | updateStatus | updateStatus=update-status-msg (index:936) |
| js/ui/settings_controller.js:373 | updateStatus | updateStatus=update-status-msg (index:936) |
| js/ui/settings_controller.js:381 | updateStatus | updateStatus=update-status-msg (index:936) |
| js/ui/settings_controller.js:539 | badgeVer | badgeVer=badge-current-version (index:931) |
| js/ui/settings_controller.js:549 | urlInput && !this.gasUrlDirty && gasUrlGeneration === this.gasUrlGeneration | urlInput=input-gas-url (index:724) |
| js/ui/settings_controller.js:554 | badgeGasUrl | badgeGasUrl=gas-url-status-badge (index:721) |
| js/ui/settings_controller.js:555 | detailsGasUrl && (!gasUrl &#124;&#124; !detailsGasUrl.dataset.userOpened) | detailsGasUrl=details-gas-url (index:720) |
| js/ui/settings_controller.js:563 | keyConfiguredBadge | keyConfiguredBadge=key-configured-badge (index:642) |
| js/ui/settings_controller.js:564 | keyConfiguredSummary | keyConfiguredSummary=key-configured-summary (index:645) |
| js/ui/settings_controller.js:565 | keyMgmtDetails && !keyMgmtDetails.dataset.userOpened | keyMgmtDetails=key-mgmt-details (index:654) |
| js/ui/settings_controller.js:567 | keyConfiguredBadge | keyConfiguredBadge=key-configured-badge (index:642) |
| js/ui/settings_controller.js:568 | keyConfiguredSummary | keyConfiguredSummary=key-configured-summary (index:645) |
| js/ui/settings_controller.js:569 | keyMgmtDetails | keyMgmtDetails=key-mgmt-details (index:654) |
| js/ui/settings_controller.js:578 | info && config | info=master-summary-info (index:845) |
| js/ui/settings_controller.js:589 | btnClearWebauthn | btnClearWebauthn=btn-clear-webauthn (index:687) |
| js/ui/settings_controller.js:591 | status | status=synced-passkey-status (index:684) |
| js/ui/tx_edit_controller.js:44 | !modal | modal=modal-edit-tx (index:947) |
| js/ui/tx_edit_controller.js:68 | toGroup | toGroup=edit-tx-to-account-group (index:983) |
| js/ui/tx_edit_controller.js:69 | catGroup | catGroup=edit-tx-cat-container (index:989) |
| js/ui/tx_edit_controller.js:108 | !modal &#124;&#124; this.busy | modal=modal-edit-tx (index:947) |
| js/ui/tx_edit_controller.js:132 | accSelect | accSelect=edit-tx-account (index:981) |
| js/ui/tx_edit_controller.js:133 | toAccSelect | toAccSelect=edit-tx-to-account (index:985) |
| js/ui/tx_edit_controller.js:138 | catSelect | catSelect=edit-tx-category (index:993) |
| js/ui/tx_edit_controller.js:139 | actCatSelect | actCatSelect=edit-tx-actual-category (index:1009) |
| js/ui/tx_edit_controller.js:150 | idInput | idInput=edit-tx-id (index:954) |
| js/ui/tx_edit_controller.js:151 | dateInput | dateInput=edit-tx-date (index:958) |
| js/ui/tx_edit_controller.js:152 | typeSelect | typeSelect=edit-tx-type (index:962) |
| js/ui/tx_edit_controller.js:156 | amountInput | amountInput=edit-tx-amount (index:975) |
| js/ui/tx_edit_controller.js:160 | accSelect | accSelect=edit-tx-account (index:981) |
| js/ui/tx_edit_controller.js:161 | toAccSelect | toAccSelect=edit-tx-to-account (index:985) |
| js/ui/tx_edit_controller.js:167 | catSelect | catSelect=edit-tx-category (index:993) |
| js/ui/tx_edit_controller.js:171 | subSelect | subSelect=edit-tx-subcategory (index:997) |
| js/ui/tx_edit_controller.js:174 | actCatSelect | actCatSelect=edit-tx-actual-category (index:1009) |
| js/ui/tx_edit_controller.js:178 | actSubSelect | actSubSelect=edit-tx-actual-subcategory (index:1013) |
| js/ui/tx_edit_controller.js:180 | sameClassification | sameClassification=edit-chk-sync-actual-category (index:1002) |
| js/ui/tx_edit_controller.js:183 | memoInput | memoInput=edit-tx-memo (index:1022) |
| js/ui/tx_edit_controller.js:184 | tagsInput | tagsInput=edit-tx-tags (index:1041) |
| js/ui/tx_edit_controller.js:192 | statusSelect | statusSelect=edit-tx-status (index:1028) |
| js/ui/tx_edit_controller.js:198 | toGroup | toGroup=edit-tx-to-account-group (index:983) |
| js/ui/tx_edit_controller.js:199 | catGroup | catGroup=edit-tx-cat-container (index:989) |
| js/ui/tx_edit_controller.js:209 | container | container=edit-actual-category-container (index:1006) |
| js/ui/tx_input_controller.js:51 | inputDate | inputDate=input-date (index:97) |
| js/ui/tx_input_controller.js:65 | typeSelect | typeSelect=input-type (index:102) |
| js/ui/tx_input_controller.js:96 | disp | disp=display-point-self-amount (index:188) |
| js/ui/tx_input_controller.js:104 | chkSync && actContainer | chkSync=chk-sync-actual-category (index:221); actContainer=actual-category-container (index:226) |
| js/ui/tx_input_controller.js:112 | catSelect | catSelect=select-category (index:211) |
| js/ui/tx_input_controller.js:119 | actCatSelect | actCatSelect=select-actual-category (index:230) |
| js/ui/tx_input_controller.js:136 | catSelect | catSelect=select-category (index:211) |
| js/ui/tx_input_controller.js:141 | subSelect | subSelect=select-subcategory (index:215) |
| js/ui/tx_input_controller.js:146 | chkSync && chkSync.checked | chkSync=chk-sync-actual-category (index:221) |
| js/ui/tx_input_controller.js:148 | actCatSelect | actCatSelect=select-actual-category (index:230) |
| js/ui/tx_input_controller.js:153 | actSubSelect | actSubSelect=select-actual-subcategory (index:234) |
| js/ui/tx_input_controller.js:187 | form | form=tx-form (index:92) |
| js/ui/tx_input_controller.js:200 | disp | disp=display-point-self-amount (index:188) |
| js/ui/tx_input_controller.js:210 | total && amount && total.value === '' | total=input-prepaid-total (index:142); amount=input-amount (index:120) |
| js/ui/tx_input_controller.js:222 | typeSelect | typeSelect=input-type (index:102) |
| js/ui/tx_input_controller.js:242 | groupNormalAmount | groupNormalAmount=group-normal-amount (index:115) |
| js/ui/tx_input_controller.js:243 | advanceFields | advanceFields=advance-fields (index:124) |
| js/ui/tx_input_controller.js:244 | prepaidFields | prepaidFields=prepaid-fields (index:138) |
| js/ui/tx_input_controller.js:245 | repayFields | repayFields=repay-fields (index:152) |
| js/ui/tx_input_controller.js:246 | pointFields | pointFields=point-fields (index:168) |
| js/ui/tx_input_controller.js:249 | catContainer | catContainer=category-selection-container (index:207) |
| js/ui/tx_input_controller.js:250 | groupToAccount | groupToAccount=group-to-account (index:200) |
| js/ui/tx_input_controller.js:251 | labelAccount | labelAccount=label-account (index:197) |
| js/ui/tx_input_controller.js:254 | catContainer | catContainer=category-selection-container (index:207) |
| js/ui/tx_input_controller.js:255 | groupToAccount | groupToAccount=group-to-account (index:200) |
| js/ui/tx_input_controller.js:256 | labelAccount | labelAccount=label-account (index:197) |
| js/ui/tx_input_controller.js:258 | catContainer | catContainer=category-selection-container (index:207) |
| js/ui/tx_input_controller.js:259 | groupToAccount | groupToAccount=group-to-account (index:200) |
| js/ui/tx_input_controller.js:260 | labelAccount | labelAccount=label-account (index:197) |
| js/ui/tx_input_controller.js:262 | catContainer | catContainer=category-selection-container (index:207) |
| js/ui/tx_input_controller.js:263 | groupToAccount | groupToAccount=group-to-account (index:200) |
| js/ui/tx_input_controller.js:264 | labelAccount | labelAccount=label-account (index:197) |
| js/ui/tx_input_controller.js:268 | catContainer | catContainer=category-selection-container (index:207) |
| js/ui/tx_input_controller.js:269 | labelAccount | labelAccount=label-account (index:197) |
| js/ui/tx_input_controller.js:283 | groupToAccount | groupToAccount=group-to-account (index:200) |
| js/ui/tx_input_controller.js:284 | catContainer | catContainer=category-selection-container (index:207) |
| js/ui/tx_input_controller.js:285 | labelAccount | labelAccount=label-account (index:197) |
| js/ui/tx_input_controller.js:287 | groupToAccount | groupToAccount=group-to-account (index:200) |
| js/ui/tx_input_controller.js:288 | catContainer | catContainer=category-selection-container (index:207) |
| js/ui/tx_input_controller.js:289 | labelAccount | labelAccount=label-account (index:197) |
| js/ui/tx_input_controller.js:330 | pointAccSelect | pointAccSelect=select-point-account (index:182) |
| js/ui/tx_input_controller.js:432 | !list | list=unsettled-advance-list (index:163) |
| js/ui/tx_input_controller.js:436 | countBadge | countBadge=unsettled-advance-count (index:161) |
| js/ui/tx_input_controller.js:499 | modal | modal=modal-tax (index:1103) |
| js/ui/tx_input_controller.js:509 | exprEl | exprEl=calc-expr-display (index:1112) |
| js/ui/tx_input_controller.js:514 | resEl | resEl=calc-result-display (index:1113) |
| js/ui/tx_input_controller.js:517 | taxSummary | taxSummary=calc-tax-summary (index:1150) |
| js/ui/tx_input_controller.js:522 | baseEl | baseEl=calc-tax-base (index:1151) |
| js/ui/tx_input_controller.js:523 | amtEl | amtEl=calc-tax-amount (index:1151) |
| js/ui/tx_input_controller.js:525 | taxSummary | taxSummary=calc-tax-summary (index:1150) |
| js/ui/tx_input_controller.js:535 | !modal | modal=modal-tax (index:1103) |
| js/ui/tx_input_controller.js:619 | !notice | notice=point-offset-notice (index:191) |
| js/ui/tx_input_controller.js:800 | elAmt | elAmt=input-amount (index:120) |
| js/ui/tx_input_controller.js:802 | elSelf | elSelf=input-self-amount (index:128) |
| js/ui/tx_input_controller.js:804 | elAdv | elAdv=input-adv-amount (index:132) |
| js/ui/tx_input_controller.js:806 | elRepay | elRepay=input-repay-amount (index:155) |
| js/ui/tx_input_controller.js:808 | elPreTotal | elPreTotal=input-prepaid-total (index:142) |
| js/ui/tx_input_controller.js:810 | elPtTotal | elPtTotal=input-point-total (index:172) |
| js/ui/tx_input_controller.js:812 | elPtUsed | elPtUsed=input-point-used (index:176) |
| js/ui/tx_input_controller.js:814 | dispPoint | dispPoint=display-point-self-amount (index:188) |
| js/ui/tx_input_controller.js:816 | elMemo | elMemo=input-memo (index:245) |
| js/ui/tx_input_controller.js:818 | elTags | elTags=input-tags (index:258) |
| js/ui/tx_input_controller.js:820 | elTagText | elTagText=input-tag-text (index:254) |
| js/ui/tx_list_controller.js:152 | accSelect | accSelect=select-account-filter (index:545) |
| js/ui/tx_list_controller.js:167 | catSelect | catSelect=select-category-filter (index:546) |
| js/ui/tx_list_controller.js:183 | tagSelect | tagSelect=select-tag-filter (index:547) |
| js/ui/tx_list_controller.js:271 | !list | list=month-tx-list (index:562) |
| js/ui/tx_list_controller.js:309 | titleEl | titleEl=month-tx-list-title (index:541) |
| js/ui/tx_list_controller.js:379 | !list | list=recent-tx-list (index:273) |
| js/ui/sync_status_controller.js:27 | btnHeaderSync | btnHeaderSync=btn-header-sync (index:64) |
| js/ui/sync_status_controller.js:50 | !badge | badge=network-badge (index:62) |
| js/ui/sync_status_controller.js:65 | !badge | badge=sync-badge (index:63) |
| js/ui/sync_status_controller.js:109 | !result | result=sync-last-result (index:738) |

## Backendの追加単純化候補（独立審査前）

- StorageEngine.initのMemoryDatabaseは毎回newしてからdefault master/snapshotを初期化する。新しいMapの存在有無を読み返す条件は旧永続データの移行ではない。DB_VERSION=1のnative onupgradeneededはoldVersion0の新規生成だけで、既存storeチェックは現在のmigration契約では不要である。getAll成功の返値は空時も配列なので、undefinedへの補完は不要候補である。既存native DBの再open/初期値保持を先行対照とし、transaction/requestの失敗・abort保護は維持する。
- Syncの内部recordChangesは全callerが捕捉attemptを明示する。現在ownerへの暗黙fallbackは削除候補であり、旧owner非帰属を維持する。masterConflictOutcomeは全callerが各counterを明示するため暗黙0補完も内部だけの不要候補である。attachedがtrueのdetachはbound callback両方の生成後に限られるため、内側のmethod不在分岐は不要候補である。外側のbrowser/listener状態判定を維持する。
- 上記は実API・構築順に基づく候補であり、保存完了順の変更やauth/await後検査の削除へ拡張しない。未知store/abort理由/数学内部等の必要防御を、未到達だけを理由に削らない。

## マスタ操作の開始元認証と所有権

実UIの祝日追加で、最初の実getMasterConfig読取後を保留し、ロック・PIN解除後に旧応答を解放すると、旧認証の入力日が新認証で保存される不備を確認した。DB内部で保存開始時の認証を捕捉するだけでは、UIの前段読取より前の認証へ遡れない。

- 祝日の追加・プリセット・テキスト取込・外部API取得、口座/費目/内訳/定期ルールの登録編集・アーカイブ復元・有効無効・削除、およびSettingsの手動マスタJSON読取/保存は、実イベント開始時のcaptureRenderSessionを全await後と共通保存/変更関数へ伝播する。開始時失効は読取/書込を行わず、旧応答からの状態変更・入力消去・一覧再描画・alert/toast・同期起動を行わない。有効な読取/保存エラーは既存の具体的な通知を維持する。
- saveMasterConfigAndSync/mutateMasterConfigAndSyncは親predicateと自身の開始元sessionを合成し、DB保存/変更のisSessionValidとrefreshAllViewsへ同じpredicateを渡す。保存前失効は全raw原本不変とし、既にcommitした後の失効は保存済み原本を巻き戻さず、後続の新画面/通知へ干渉しない。
- MasterControllerはbusyの所有者を操作ごとに識別する。auth.invalidateSessionからcancelPendingOperationsを呼び、旧busyを解放してマスタ編集/祝日取込modalを閉じ、旧draft/保存所有権を破棄する。旧catch/finallyや旧refresh完了は、新しい操作のbusy/表示/入力を変更しない。新認証で開いた別対象の操作は直ちに実行できる。
- SettingsのJSON編集も世代と開始元sessionを捕捉し、認証取消で旧読取/保存の所有権を失効させる。旧処理の完了により、新認証で開いたJSON原値・draft・表示や新保存ボタンの状態を上書きしない。
- 同根のSettings保存も対象とする。GAS URLは実setSetting保留中のロック解除後、旧URLを保存して新SyncManagerへ適用する不備を実先行試験で確認した。setSetting(key,value,{isSessionValid})を後方互換の任意optionsとして追加し、UI開始元predicateをputRawの原子的guardへ渡す。旧URLは保存も新managerへの適用も行わず、認証取消で旧savingGasUrl/busy所有権を解放する。新認証のURLdraft/新manager/後発保存busyを旧完了が変更しない。
- PIN保存は既存DB guardに加え、暗号化後・保存後・catch・入力消去・通知へ開始元認証を再検査する。保存前の失効は全security原本不変、既にcommitしたPIN変更は保持したまま、旧成功/失敗が新PINdraftや通知へ干渉しない。失効時に秘密バッファを消去するfinallyは省略せず、正常PIN更新と有効な保存失敗の既存動作を維持する。
- 先行試験は実クリックから実DB読取/commit/表示更新を保留し、実lock/PINunlock、旧解放、実処理Promise完了まで待機する。旧祝日書込のRED、各マスタ入口の旧失敗通知抑止、保存前の全raw不変、保存後のcommit保持、新draft/新busy保持と、通常の保存/有効エラーの既存回帰を照合する。現在進行中のfresh診断は修正前の診断として保持し、その終端と独立Phase2/3承認後だけ本番を変更する。

### GAS生成validatorの単体契約

生成GAS内の共有validatorはJSと同じprogrammatic API契約を持つ。サービスのJSON/action前処理で拒否される入力はサービス境界の到達証拠にしない。専用unitはproductionSourceでGAS原本全体をVMへ読み、末尾式で既存createDataIntegrityValidator()を取得する。関数本文/状態を置換せず、標準instrument/hashを使い、JS public validatorと同じ正常入力・明示的な不正型/循環・旧不整合repair・新archive参照拒否を直接検査する。diagnostic code/path、返却原本同一性、入力非破壊、JS/GAS診断一致をassertする。署名/原子保存のサービス証明は既存signed integrationで別に維持する。

### 表示sessionの重複判定候補

captureRenderSessionの返す純粋predicateは同じ呼出時点のlock/key/keyGeneration/authGenerationを検査する。Insights.renderMetadataのvalid直後・Furusato.renderのsessionValid直後にawaitや外部callbackがなく同じlockを再検査する分岐は冗長である。Summary/Budget/Insightsのvalidと並置した同じlock/key検査も、同一式内で有効な補強にならない。非同期を挟むvalid呼出、renderVersion/generation/year/draft同一性、親predicate自体は維持する。取消済み・認証失効済みcallbackを公開メソッドへ渡す先行テストでは、可視DOM・全業務raw保持とDB読取未到達を検査する。

TagMemoInputは任意ID構成の再利用部品として、実DOMの一部なしでもタグhidden/chip/候補が機能し、query省略/空履歴/callback省略を受理する。実focus移動（text→候補→候補→text/外部）、候補以外click、hidden復元重複除去を検査する。MasterConflictは空details/未pending applyのno-op、scalar表示、非同期rejectの文字列診断と修正再適用、旧rejectが新dialogに干渉しないことを実選択/Promise/新旧IDで検査する。doughnut tooltip adapterはnumeric parsed、raw値、ラベル/dataset省略の公開callback入力から具体円額と割合を検査する。

### 分析集計の正規出力と常設ナビゲーション

aggregateMonthlySummaries:292–350は全12月にby_category/by_actual_category辞書を必ず作り、旧snapshotのnumber/objectを両方numberへ正規化する。その出力を使うBudgetSettings.renderCategoriesのmonth.by_category fallbackとamount.total ?? amount、Summary.renderBudgetProgressのm.by_category存在guardとobject/number再判定は不要である。aggregateYearlySummaries:395–438もカテゴリ金額をnumberへ正規化するため、Summary.renderYearlyAnalyticsのv.total fallbackは不要である。正規化前のsnapshot読取・任意collectionの境界は維持する。旧月次のnumeric/objectが同じ費目額・年間予算内訳へ現れることを先行検査する。

AppCoordinator.setupNavigationの.tab-btnはindex:70–75の6定義だけである。収支/予算/資産は常にdata-analytics-targetを持ち、残りinput/tax/settingsは同名panelが一意に存在する。動的tab追加や旧HTMLとの混在は契約ではないため、analyticsTargetなしのtab-summary/cashflow/budget/assets別名推測を除き、現在の明示属性を採用する。summaryPanelと非分析panelの不在guard、固定modal-app-update/modal-new-version-text/toast-notification、refreshAfterTransactionChangeの3固定panelのnullable処理も同じ一意HTML/構築順の範囲で候補とする。任意collapsed pane ID、トップmodal不在、ブラウザーAPI差異や認証は維持する。実6タブ切替/表示・更新modal表示閉鎖・toastの内容と時間後非表示を検査する。

coordinatorのstateはconstructor:33–38でcurrentMonth/selectedYear/analyticsTarget/analyticsGranularityを常に初期化する。その後の書込はSummaryの正規月/年変更、HTML固定data-granularity、Furusatoの1900–9999年の整数だけである。これらが空になるfallbackは内部状態の外部改ざんだけであり、Summary側の空state用fallbackは除去候補である。txListControllerもconstructorで常設生成し破棄時は内容を取消すだけで参照を消さないため、その存在guardは不要である。

受理済み旧masterの任意categories省略もSettings→BudgetSettings.renderCategoriesで.filter例外となる。同じ旧masterでInput/Master/TxListは空表示を正常に扱うことを別probeで確認した。BudgetSettingsの表示対象categoriesを空配列として扱う最小是正を行い、validatorや保存masterは変更しない。実settings描画の『費目が登録されていません』、年度draftの生成、全raw保持を先行assertする。

### UIモジュールのブラウザー実行境界

js/app.jsはdocument/windowが存在するときだけAppCoordinatorを作ってinitする（no-browser importは既存startup_entry_contractsで停止を検査する）。CoordinatorのDOM描画/テーマ/トースト/更新確認はこのブラウザーappの内部契約であり、SSR描画は提供していない。Chartの各renderもdocument取得の後でwindow有無を再判定しており、undefined windowの分岐へ到達しない。従ってこれらのtypeof document/window/navigatorガードは除去候補である。window.Chart未読込、navigator.onLine=false、serviceWorker機能の有無、matchMedia/AbortController/Storage等のAPI差異、任意pane ID不在は維持する。Nodeの公開facade試験はDOMを呼ばない委譲契約の検証であり、存在しないSSR仕様を追加しない。既存startup no-browser試験、実6tab、toast、theme/update/UI全回帰を先行証拠とする。

### アーカイブ参照移行の開始元認証

Maintenance.migrateでも、実approveClosedChangesの結果取得後に保留し、実lock/PINunlock後に解放すると旧移行が新認証で保存されることを先行REDで確認した。移行開始時にcaptureRenderSessionとoperation ownerを保持し、承認/DB/表示後の各awaitで同じowner/sessionを検査する。migrateArchivedMasterへ第6任意optionsのisSessionValidを伝え、mutateBusinessの原子的commitまで合成する。既存5引数callerは互換とする。認証失効時cancelはrefresh世代と移行ownerを更新し、busy/loading/取得済みpreviewを破棄する。旧catch/finallyは新sessionの通知・busy・選択・表示を変更しない。

先行は互換active現金口座だけの候補、金額未入力予定0円/空メモ/取得済み月の表示と移行内容、旧承認完了の全raw保持/通知なし、新sessionの最新選択/操作可能状態、commit後の旧表示完了の非干渉を検査する。認証をまたぐtest gateはfinallyで解放し実Promise完了とhook復元を保証する。

Maintenanceの追加単純化は2箇所へ限定する。setupのtoggle callback外側のpanel.open判定は、refreshが同じpanelのopen/busyをDB読取・世代更新・loading更新より前に再検査し、setupも既存panelの存在だけでreturnするため重複する。外側だけを除き、閉じる実toggleで読取0件・表示/原本不変、再度開く実toggleで通常更新を確認する。migrateのplanned.length===0判定は、sourcesをreferencedArchivedMasterSourcesのcount>0フィルターから作り、同じrecords/sourceと同じmatchesをbuildMasterMigrationへ渡し、plan生成までawaitもsnapshotの書換えもないため正規選択で成立しない。選択元不正・移行先不正・同口座振替の純粋関数検査とDBの最新原本/CAS/親認証検査は維持し、空planだけのUI分岐を除く。

追加4先行は、実AES復号を保留した旧一覧読取が再認証後に失敗しても新一覧へ通知/上書きしないこと、実AES暗号化中の旧移行が再認証後に全rawを保存しないこと、実DBcommit後の返却保留を再認証が跨いでも保存済み移行と別の新選択/DOM/通知を保持すること、実署名済み背景同期のtransportを保留し再認証後に通信拒否しても旧toastを出さないことを検査する。全gateはfinallyで解放して実refresh/migrate/transportのPromise終端まで待機する。旧category.type未指定のexpense補完2箇所とfinally内refreshの失効catchは必要な防御として残し、不正な内部stateで到達させない。

税設定の追加先行は、ledger fingerprint依存の失敗を現在/失効sessionで区別し、確認checkbox解除とraw保持、通知税保存のmaster読取後/commit後の実再認証で新300000円draftと旧200000円保存有無を検査する。保存済み表示失敗、住宅7%/136500円の保存、年度10000の拒否も実操作で確認する。故障は依存境界への明示注入であり、通常の暗号計算結果を捏造しない。

予算設定の追加先行は、基準収入1000円に対する貯蓄/支出1500円の導出不足額・赤字額-500円、率101%の公開save拒否と全raw保持、費目内訳1000/900/1100円の一致/残100円/超過100円、前年0件の自動計算0円/未保存draftを検査する。

### 分析期間フィルターの重複整理

Summaryのタグ/クロス表は同一の年間判定（budgetまたはyearly）とtarget_month→date→空文字の旧明細日付fallbackを重複実装している。口座収支のyearly/月次、予算口座の年間支出も同じ期間境界を使う。1個のperiodTransactionsへ集約し、年はstartsWith(selectedYear)、月はslice(0,7)一致を維持する。各consumer固有の削除/収支種別の除外は維持する。constructor/固定selectorの粒度3種は既承認であり、それ以外の粒度を仮定した無フィルター経路は不要である。月/年/予算でタグ・1セルcross額・口座額/件数が130円1件/180円2件と揃い、削除10円を含まない先行assertを置く。

renderAccountBalancesのaccStatsは同じaccounts配列から直前同期処理で全IDの行を初期化し、その配列へmapするためstat未生成fallbackは不要である。入力明細の口座参照不明/アーカイブは引き続き除外する。category_trendのseriesはproducer:31–32がkindを必ず付け、Summaryの唯一callerがtypeを付けてrenderCategoryTrendへ渡すためChart内のtype/kind既定値も不要である。drawTimeのtoggle indexは同じsource.datasetsのforEach/そのデータを持つChartの凡例から来てsourceはcaller生成後に変更されないため、存在しないindex用guardは不要であるが、認証lock guardは維持する。

### 立替ひも付け操作の旧通知

AdvanceLink.saveのlink/unlinkとも、実承認結果[]後の待機を実lock/PINunlockがまたぐと保存は拒否されるが、旧catchが新認証画面へ保存失敗alertを出すことを先行REDで確認した。開始元captureRenderSessionにoperation/generationを合成して旧未保存catchの通知も同じvalid時だけとする。既存の保存阻止と原子的DB検査は維持する。成功時closeはgenerationを更新するため、TxEdit.closeからAdvanceLink.cancelも呼ばれてoperationが進むため、背景同期catchは正常close完了直後のtransportOperationと開始元auth sessionを使い、同じ認証の正常な背景失敗通知は保持する。実link/unlink承認待ち、新しい編集中memo/ID/modalと全raw保持、通知件数の不変を先行assertする。DB書込まで通っていたMaintenanceの不具合とは区別する。

Coordinatorの追加先行では、削除済みpane IDを保持した設定読取と不在pane変更、theme省略旧master→localStorage fallback、matchMedia/AbortController/sessionStorage API省略時の機能保持、Storage故障時のテーマ表示継続、CDP実network offline時の更新fetch0件を検査する。API省略/故障は対応済みcompatibility境界の明示modelであり、通常ブラウザーの全APIが存在しない状態をアプリ全体の利用環境として捏造しない。各差し替えはfinallyで元に戻し、実API呼出の完了を待つ。

実lock完了後に遅れて呼ばれる公開分析callbackも、既存の正規投資口座ID/評価額を保持した引数で呼び、業務読取0・全raw/DOM/通知不変・背景task/Chartなしを先行検査する。readonly/disabledのDOMへ無理にnative入力したり、内部busyフラグを捏造する方法は使わない。

### マスタmutatorの親predicate伝播

独立コードレビューで、Master側が渡すmutateMasterConfig(mutator,{isSessionValid})をYoseDB既存の1引数実装が無視する漏れを確認した。実lockではDB鍵世代でも拒否されるためUI22葉だけで証明しない。任意第2options.isSessionValidをmutateBusinessへ伝え、従来1引数は互換とする。先行は親false開始時の読取0/全raw保持、同じkey/genで実AES処理待ちの間に親だけ失効した場合の原子的拒否、従来呼出成功を対照とする。DBの署名/crypto/stateを置換して枝を通す方法は使わない。

保険満期の片方だけを持つ正規データもasset_legacy_fields67で検査する。資産表は日付のみなら金額を補わず、金額800円のみなら日付を未設定と表示し、全口座残高0円なら純資産0円である。口座一覧は日付がある場合だけ満期日を載せる既存契約と区別する。保存masterへ欠落フィールドを補わず、表示前後の全rawが一致することを検査する。初回の口座一覧に資産表と同じ金額表示を期待したfixture誤りは製品不具合とは扱わない。
### 実commit後の認証・所有権

AdvanceLinkのlink/unlinkはDBがcommitした後に応答だけを待機し、実lock/PINunlock・新editor入力後に旧応答を解放すると、保存済みrawと新draftは保持するものの親predicateのないrefreshAllViewsを開始する。saved=trueの直後、描画開始前に同じ開始元validを確認し、refreshAllViewsへisSessionValidとして同じ関数を渡す。commit済みデータは巻き戻さず、失効時は描画・通知・新busyへの作用だけを中断する。

BackupImport.confirmは同じ実commit後の待機中に再認証しても旧busyを保持して新previewを拒否し、旧完了alertと新認証のrefreshを開始する。既存selection objectのidentityをbusyOwnerとして保持し、boolean busyの公開挙動は維持する。新counterは設けない。開始元captureRenderSessionとbusyOwnerの一致を所有predicateとし、DBcommitの条件には現plan一致・modal active・同期非実行も合成する。

専用cancelはplan/busyOwner/busyと確認語・確認ボタン・modalを同期的に破棄する。Settings.cancelPendingOperationsから認証失効時に専用cancelを呼ぶ。新confirmは新selectionをbusyOwnerとし、旧finallyは所有不一致なら新busy/ボタン/planを変更しない。正常commitでplanを消してmodalを閉じた後もbusyOwnerは保持し、現在のowner/sessionに限って完了通知と親predicate付きrefreshを完了する。これにより自身の正常closeで所有権を失わず、新cancel/新confirmが旧refresh/catch/finallyを失効させる。

利用者の閉鎖は専用cancelへ集約する。共通履歴閉鎖のMutationObserverは、planが残る外部閉鎖だけをcancelし、正常commitがplanを消して行う自身のcloseはbusyOwnerを解除しない。DB確定後に古いownerが失効しても金融原本/送信待ちは確定済みのまま保持する。

先行はlink/unlink実commit後gate→実lock/PINunlock→新editor memoの後に旧解放し、新規refresh呼出0・通知0・新draft/全raw保持を検査する。Backupは同じcommit後gateの再認証でbusyが同期解除され、新しい完全置換previewと2回目保存の実暗号化待機を作り、旧解放で新plan/modal/確認語/チェック/busy/通知・全rawを保持する。2回目保存を解放して正常完了する対照を置く。全gateはfinallyで解放し実Promise完了まで待つ。

Coordinatorのrefresh orchestratorはNode component試験で各依存controllerを境界として置き、実CryptoKeyを持った同じ鍵のままauthGenerationだけを各await完了時に失効させ、下流未開始と渡された親predicate失効を検査する。card生成失敗でも表示を継続すること、候補読取中の別送信busy/認証失効、背景故障に続くbadge故障の通知/抑止とtask解放を検査する。これを実UI/実DB金融保存の証明とは呼ばない。

予算の追加境界は月次集計のない受理済み旧snapshotを保存し、収入0/前年自動計算0、検索で隠した1200円draft保持、rawの欠落collection非補完、0収入0目標の率未算出、native Ctrl+A/Backspaceで年度欄を空にした編集中の2026年fallbackとblur後render完了を検査する。旧budget read故障/実commit後待機を再認証が跨いでも新3000円draft・busy・通知・保存済み1000円を保持する。

### Summaryの追加producer証明

selectedDateはAppCoordinator:35のformatDate初期化、Summary.setSelectedMonthの有効月＋1〜月末の日、aggregateDailySummariesのdate行選択でのみ代入する。aggregateDailySummaries:230–244は有効対象月の各日をYYYY-MM-DDで作り、そのdateを非空data-dateへ渡す。従ってselectedDate空/NaN→1のfallbackと日行handlerのdate有無guardは不要である。currentMonthの非空stateは既承認のためperiodPicker.valueの年1月fallbackも不要である。日行選択から1/31→2/28へ切り詰める実操作と原本不変を先行検査する。

applyInvestmentValuationsはinvestment.js:18–24の同期純関数であり、DB/DOM/callback/awaitを持たない。renderSummaryの直前valid/renderId検査からその直後まで同じJS stackで状態を変更できないため、直後の重複renderId/lock guardを除去候補とする。資産履歴等のawait後valid/renderId検査は維持する。calculateAnnualBudgetProgress:272–295は唯一returnに常にcategory_progress辞書を含め、invalidGoalsの上書きもこのfieldを消さない。Summary consumerの同fieldへの||{} fallbackは不要である。

Summary予定生成の追加先行は、1つの有効月次ルール（15日・100円）を実DBへ保存し、読取故障の現在/旧認証、master読取後/実生成commit後の再認証、commit済み表示失敗の現在/旧認証、旧表示成功完了の通知抑止を検査する。実生成件数/amount/recurring_rule_idと全raw、button復元・通知件数を照合し、gateはfinallyで解放して実処理を待つ。署名や生成結果は捏造せず、依存の読取/表示故障だけを明示注入する。

### 再承認・ファイル取込・出力の開始元認証

対象はR/E/I-3.68の開始元認証・旧完了非干渉契約である。取込・出力の永続形式、署名、GAS API、完全取込receipt、CAS条件は変更しない。

* BackupImport.reapproveは、最初のgetPendingImportより前にcaptureRenderSessionで認証・鍵世代を捕捉する。同じ有効関数を読取後、prompt前後、updatePendingImportのisSessionValid、保存応答後の通知前、renderPendingの親へ伝播する。旧readから新しい認証を捕捉し直してはならない。現認証の同期中・確認語不一致・CAS競合は既存エラーを維持する。期限切れcatchは通知しない。保存完了後に失効した場合、完了済みpending/base変更を取り消さず、旧完了通知と新UIの再描画だけを止める。
* BackupImport.previewは末尾options={isSessionValid}を受け取る。直接呼出では最初のawait以前にcaptureRenderSessionを行い、親付き呼出では同じ親を合成する。prepareReplacementImportの応答後はkey identityだけでなく同じ認証世代・DB鍵世代・親有効性を検査してからplan/summary/word/error/modalを変更する。旧readの失敗はreadInRenderSessionで取消として扱い、現認証のschema/参照/同期エラーは呼出元へ返す。
* Settingsの取込入口はFileReaderではなくFile.textである。change listenerの最初のawait以前に認証、選択file、取込mode、操作ownerを捕捉する。読取後に新認証や現在のmodeを採用し直さない。同じ有効関数をpreview、差分取込DB、刷新へ伝播する。各await後のparse/通知/DOM/refresh前とcatchで検査し、finallyによるfileInput消去は当該ownerのみ行う。cancelPendingOperationsで所有権を破棄し、新認証のfile/preview/確認/保存を旧finallyが変更しない。既存Settingsのowner機構を利用し、認証counterを新設しない。
* YoseDB.importFullData(data,{isSessionValid}={})は任意第2optionsを追加する。開始時key/keyGenerationと親を捕捉し、最初のgetPendingImport前に無効なら読取もmutatorも呼ばず拒否する。pending読取後にも検査し、同じ開始元predicateを既存mutateBusinessのisSessionValidへ渡す。旧1引数呼出は維持する。実AES中の失効・実原子commit失効は既存CAS/原子処理で全raw保持する。pending有無・金融整合性・アーカイブ参照条件は緩和しない。
* Settingsの全5種exportと直接全バックアップは、実DB export呼出より前に開始元sessionを捕捉し、応答後のBlob/URL/anchor.clickおよびmodal close前に同じ有効性を検査する。旧exportは新認証でダウンロードせず、新しく開かれた出力modalを閉じない。正常exportの5種のデータとfilenameは維持する。DB読取の世代失効rejectを無条件global suppressionへ逃がさず、旧sessionだけを取消として扱う。

実Chromium先行は、再承認の実pending読取後と実commit後、previewの実prepare後same-key世代変更と通常再認証の正常停止、native File.text待機後のmerge/replace、差分取込の実pending読取後と実AES後、実export読取後を保留点とする。再認証は実lock/PIN解除で行い、旧解放前に新sessionの全business/settings/security raw・preview/入力・modal・通知数を捕捉する。全raw保持と通知/refresh/anchor.clickの未実行をそれぞれ直接assertする。正常操作・現認証エラー・保存済み応答の場合の保存済みraw保持を対照とする。

### SyncManagerの操作入口認証と保存済み応答

SyncManagerの任意constructor option `captureSession` は、各sessionGuard生成時にその時点の有効関数を一度だけ返すproviderである。constructor時に固定したepochを保存せず、有効性評価のたびにproviderを呼び直さない。sessionGuardは捕捉した認証callbackを既存のDB暗号鍵identity・DB鍵世代・署名秘密鍵identity・明示parentと合成する。未指定のstandalone constructorと既存callerは互換である。Coordinatorは現在のauthGeneration/鍵世代と当該manager identityを捕捉するproviderを注入する。通常の鍵更新後に同じmanagerで開始する新操作は新認証を捕捉し実行できる。

syncMaster、syncBidirectional、syncPendingDiffs、fetchRemoteState、closeMonth、sendRetroactiveUpdate、直接のdownloadTransactions/pushPending/syncSharedMaster/flushPendingImport/sendRequestは最初のawait前に入口sessionを捕捉する。既存の親有効関数は子へ渡し、await後に新しいguardだけを捕捉して旧開始元の無効化を取り消さない。sendRequestの末尾optionsにも任意isSessionValidを追加し、親を持つ内部callerは同じpredicateを渡す。署名後・network後・DB保存前に既存assert/原子predicateで検査する。承認callback後・DBread後の次段階送信にも同じ入口predicateを利用する。

queueMasterSyncは最新DBを読み直す要求であり、閉じた旧UI draftのownerを保有しない。旧active attemptが失効しても完了時にbusyを解放でき、その時点で現manager/current認証が有効ならqueued masterを新attemptとして実行する。旧active attemptのpredicateを新attemptへ引き継がない。現認証が無効なままなら通信もDBcommitもしない。新attempt開始時のprovider再捕捉と、古いattempt停止を別々に検査する。フォームcloseで無効になる保存ownerを背景同期providerに流用しない。

実DBcommitが成功してから応答await中に認証が失効した場合、既に保存されたbusiness/base/pending/settingsを取り消さない。旧応答はrecordCommitted/finishAttempt/lastError/lastSyncedAt/masterConflictPathsへ新たな成功や競合解消を書き込まず、新master通知を開始しない。flushPendingImportのacknowledge後も同様である。syncSharedMasterのDBcommit後、pushPending/closeMonth/retroのDBcommit後、finishAttempt待機後、masterConflictOutcomeの副作用前に入口所有権を確認する。失効時のendAttemptによる当該managerのbusy解放は維持し、他manager・他attemptのbusy/resultは変更しない。

master変更listenerをPromise microtaskで遅延実行する場合は、予約時と実行時の両方で元操作のsessionを確認し、失効した旧操作から新sessionのrefreshを起動しない。state/busy通知は現在のmanagerのbusyを反映する用途を保つが、UI側は捕捉したmanager identityと開始元sessionを各await後にも検査する。既に完了した操作の結果を参照する新しい表示要求と、旧操作が後から通知することを区別する。

先行試験は公開constructor provider契約と実Chromium連結を区別する。実Chromiumでは、各6入口の実署名fetchを保留し、native「新しい鍵ペアを生成」から実Ed25519生成後を別gateで保留する。authGenerationだけが変わりDB鍵/DB鍵世代/manager署名鍵が変わらない区間を直接assertしてから旧応答だけを解放し、拒否・全raw保持・後続送信なし・旧result非更新を検査する。実commit後のsyncMaster/close/retroは保存済みraw保持、旧result/時刻/通知非干渉を検査する。正常provider、provider不在、現認証の新操作、queued最新DB再読の対照を持つ。内部counterを試験から代入して認証失効を作らない。

### MasterControllerの残存分岐を受け入れる工程

固定全体計測 `/tmp/yose67-coverage-final01-report` のMasterControllerはLine100%/Branch89.60%（558 arm中500実行）であり、現原本hashが一致する。未実行58 armをすべて仕様・source・具体assertへ照合する。Settingsの旧Branch84.16%は取込・認証入口の改修でhashが変わっているため、現在値として採用しない。未実行一覧を埋めるためのDOM破壊、内部認証counterの代入、未知type呼出、旧金融形状fallbackの削除は行わない。

| 区分と起点 | 根拠・保持する契約 | 先行assert |
|---|---|---|
| 必須producer候補5 arm: master_controller旧46/624/625/639/264 | 46のmaster panelは同版HTMLの全`.master-tab-btn[data-master]`に対応して常設される。624/625のcc/insurance区画と639のoffset selectは同じaccount formテンプレートが一括設置し、change/submitは同formのlistenerである。264のaccounts補完は外側の`accounts = config.accounts || []`のmap内であり、accounts不在なら当該bodyへ入らない。682/753/804のID補完は空IDの旧行に対する修復の可能性があるため、この候補に含めず維持する。旧永続行のIDが空でないことをfind成功だけから仮定しない。 | tab全種のpanel表示、account各型のchangeとcredit offset0/1/2、既存account/category/subcategoryの名称編集でIDと金融内容保持を先行検査する。承認後は当該4必須DOM判定と1重複配列補完だけを簡素化できる。外側配列・動的行・旧参照のfallbackは保持する。 |
| 認証・owner・await順序: 56/61/66/102/124/129/153/162/164/173/175/177/183/237/284/335/354/363/408/480/759/810/905 | saveMasterConfigAndSync/mutateMasterConfigAndSyncは開始・実DBcommit後・実refresh後の認証を別々に検査する。各型open失敗の旧catchは通知せず、保留中open再要求や古いclose(version)は現在のmodal/入力を変えない。 | 実lock/PIN解除、実Ed25519生成のauth-only区間、実DB/refresh/read応答のgateを使い、新draft/owner/busy/全rawと通知・queue呼出数を比較する。activeエラー対照を持ち、全gate/実Promiseをfinallyで解放・終端待ちする。 |
| 旧形状・省略・0円: 96/147/320/391/647/682/753/788/790/804/830/831/872 | data_integrity.listはundefinedを空集合として許容する。holidays/accounts/categories/subcategoriesの省略、0円定期ルール、旧type省略category、premium_day未設定は別々の合法互換境界である。空IDの旧行のUI修復も原本を用いて確認し、既存修復を失わせない。 | 金融参照が矛盾しないlegacy fixtureと通常fixtureを実保存し、0表示、候補の空状態、祝日追加、保険premium_day空入力の27保存と未変更rawを確認する。旧type省略categoryは最新保存validatorが拒否する分類との関係を分け、表示互換を保存成功と混同しない。 |
| 正常取消・入力・API省略: 138/160/425 | 空祝日、定期削除取消、save helperのexpectedConfig省略は現APIの正規入力である。既定引数は今回cleanup候補5に含めない。 | 空textareaの具体的入力要求、native削除confirm取消の全raw保持、省略/明示baseline付き保存の結果とCAS保持を比較する。 |
| 動的行・並行変更・入口前提: 284/335/354/363/408/488/491/787/789/791/803/814 | renderで取得したconfigとopen時最新DBは別時点である。動的行find不在やstale item/parent fallbackを必須DOMと同一視しない。openMasterModalの全本番callerはaccount/category/subcategory/recurringであるが、未知typeや親無しsubcategoryを数値のために呼ばない。 | 実別writerの削除/分類変更をread境界に置き、旧行復活・元raw・通知を比較して現契約を確認する。実不具合が出たらPhase1へ戻る。到達できない入口前提の防御は数値のために削除せず、残存として計測する。 |

この追加は先行試験の範囲とproducer候補の限定設計である。独立Phase2/3の承認前にはMasterController本番を変更しない。新原本の最終受入は全対象を固定した4層計測で判定し、旧hashのcounterを合成しない。

### 認証鍵削除と単一立替ひも付けの親predicate

R/E/I-3.68の開始元認証をDBの最終原子境界まで保つ。YoseDB.deleteSecurityKey(key,{isSessionValid}={})は既存第1引数を維持して任意第2optionsを受け取り、StorageEngine.deleteRaw(storeName,key,isSessionValid)の任意第3predicateへ伝播する。開始時falseならMemory/IndexedDBの読取・削除・transactionを開始せず拒否する。IndexedDBは実delete request成功時にも同じpredicateを確認し、失効ならtransactionをabortしてsecurity_keysを含む全rawを保持する。Memoryは同じ同期削除直前に確認する。既存引数省略の削除結果と他key保持は変えない。暗号化を伴わないraw削除にも同じ親寿命を適用し、鍵やDB世代を変えていない親だけの失効を検査する。

YoseDB.linkAdvanceRepayment(source,repayment,{approvedMonths,create,isSessionValid}={})は単一立替のAPIであり、複数立替の別APIと混同しない。既存の第3optionsに任意isSessionValidを追加し、既存mutateBusinessへ渡す。unlinkAdvanceRepayment(repayment,{approvedMonths,isSessionValid}={})も同じ親伝播を行う。原本CAS、1対1/金額/種別/口座方向/confirmed/承認月/税分類の金融条件や旧引数呼出は変更しない。AdvanceLinkController.saveのlink/unlink両callsiteは既に捕捉したvalidを同じoptionsへ渡し、別のguardを捕捉し直さない。

先行はMemory/IndexedDBの初期falseでread/write0、実delete成功時の親のみfalseで原子rollback、旧1引数の正常削除と他security/device/business raw保持を分ける。単一link/unlinkは初期falseのbusiness read0、同key/同DB世代で実AES完了後に親だけを失効させた全raw保持、旧3引数link/旧2引数unlinkの金融内容保持を検査する。実UIはnative鍵生成のauthGeneration更新後に立替処理を開始し、実AESを保留している間に同auth/DB世代の署名鍵交換だけを完了させる。旧AESを解放してもlink/unlinkが保存されず、成功/失敗通知と更新が新しい署名鍵の操作へ混入しないことを確認する。共有captureRenderSessionのprivateKey identity契約と合成し、署名鍵だけの実交換を内部counterの代入で代用しない。全gate/実Promiseはfinallyで解放・終端待ちする。

Auth初期業務保存の開始元predicateはYoseDB.saveSnapshot(snapshot,{isSessionValid=null}={})にも伝播する。既存の第1引数・返値・保存形式・allowArchivedReferencesを維持し、任意第2optionsの同predicateを既存mutateBusinessへ渡す。初期falseはbusiness read0で拒否し、同じDB鍵/世代の実AES後に親だけが失効した場合は全rawを保持する。既存1引数の正常保存ではsnapshot以外の全rawを保持する。Auth側の正当な鍵ロード・初期setupのintent ownerはUI設計で捕捉し、DBが新しい認証を捕捉し直して古い初期値を採用しない。

Masterの旧collection先行で、categories省略を持つ空masterはDB validatorで受理されるが、新規定期ルールを開くupdateChildrenの`config.categories.find`だけがTypeErrorとなる実不具合を確認した。先行はsnapshot.account_balancesを空にして全口座/定期の参照を除き、point_payment_defaultsをnullにした合法な空集合を用いる。新規ルールのmodal表示、口座/費目の空候補、振替先placeholderだけの表示、全raw保持を要求する。updateClassificationsやform候補と同じoptional categories補完をupdateChildrenのfindにも適用する最小是正とし、既存参照・子分類・必須入力・保存validatorの制限を緩めない。これは旧array防御の削除ではなく、既に受理する省略形状の表示を一貫させる改修である。

### 認証materialの存在・値を原子的に比較する保存

PIN更新と署名鍵再生成の両方が非同期であるため、開始元sessionだけでは、署名鍵pairをDBへcommitしてからメモリへ公開するまでの間の旧privateによるPIN保存を拒否できない。逆順では、PIN更新成功後に古いPINで包んだ再生成packageを保存してしまう。同じUIだけの排他は別connectionからの変更を保護しない。現役のpublic_key_base64/master_keys_package/webauthn_credentialを開始時に結び付け、DBの同一transactionで期待状態と比較してから変更する。形式・DBversion・署名/GAS APIは変更しない。

APIは次の任意拡張とする。

* `getSecurityKeyStates(keys,{isSessionValid}={})` は同じreadonly transactionで対象keyの存在と値を読み、`{[key]:{exists:false}|{exists:true,value}}`をcloneして返す。存在しないkeyと、値nullの存在するkeyを区別する。key重複は同じ観測へまとめ、空の配列は空結果となる。開始無効/読取中失効/読取故障は結果を返さず拒否し、後から新しい認証で読み直さない。
* `putSecurityKeys(entries,isSessionValid,{expectedSecurityKeys=null,deleteKeys=[]}={})` は書込候補と期待mapを最初のawaitより前にcloneする。期待mapは上記の存在値descriptorを持つ非空objectであり、`expectedSecurityKeys:null`なら従来の無条件batchを保つ。新CASを要求した空/不正descriptorは拒否する。同一security_keys readwrite transactionで期待された全keyの存在と値を比較し、一致と同じparentが有効であることを確認してからput/deleteをまとめて行う。req成功時にも同じparentを確認して、失効・読取/書込失敗・期待不一致では全batchをabortし、他のsecurity/device/business rawも保持する。
* 値はplain record/array/primitiveについてproperty順序に依存せず、own fieldの有無も含めて比較する。比較できないopaque値を空objectと同値として受理しない。期待recordの欠損とnullを正規化して同一視しない。期待不一致は`SecurityKeyConflictError`/`SECURITY_KEYS_CHANGED`として拒否し、UIは成功を表示せず、後追いDB値で期待mapを更新せず再認証・再試行を案内する。
* `saveSecurityKey`/`deleteSecurityKey`の既存optionsへも任意`expectedSecurityKeys`を追加する。CAS付き保存/削除は同じbatchへ伝播し、旧引数/非CASの返値と正常動作は維持する。複数credential削除は`putSecurityKeys({},valid,{expectedSecurityKeys,deleteKeys:[...]})`の1batchとし、自分の先行deleteによって次のCAS期待値が失効する逐次処理にはしない。

PINは開始メモリprivateと組のpublicBase64を期待publicへ固定し、entry packageも固定する。再生成は検証したentry package/public/変更対象credentialを固定し、package検証後の再読で新しい値を採用し直さない。PRF登録/解除も現役public/package/credentialのentry観測を使う。初期setupは開始時の存在状態を期待し、別writerが作ったpairを上書きしない。synced_passkey_bundleと旧vault/idはobsoleteであり、現役PRF tupleとは区別して従来の検証後purgeを維持する。現native共有fieldではないsynced_passkey_bundleを新しい共有credential版として扱うcross-store CASは追加しない。

存在判定には[IndexedDB 2.0のget/getKey](https://www.w3.org/TR/IndexedDB-2/#dom-idbobjectstore-getkey)を使う。同仕様ではgetは値、getKeyは存在するrecordのkeyを返し、不在はundefinedとなる。idb_mockはgetKeyを追加し、既存getの`value || null`によるfalse/0/空文字の誤変換をnativeに一致させる。これはmock規格の是正であり、本番fallbackで模擬不足を隠さない。Mockの同時transaction schedulingを別tabの証明とせず、原子的競合は実nativeの別connectionでも検証する。

先行は、(1)同UIのPIN成功→旧再生成拒否と、(2)再生成pair実commit→メモリ公開前の旧private PIN保存拒否、(3)独立native connectionのpair/credential変更後の旧PRF登録/解除/初期setup拒否、(4)正常業務登録が鍵準備中にも完了する対照を持つ。backendはMemory/IDBの初期falseでIO0、descriptor存在/null/値順序/全own field比較、入力clone、競合/実req失効/読取・書込故障の全raw保持、旧API対照、実pairをPIN復号してpublicと署名検証する整合性、別native connectionの同時CASで一方だけが成功することを直接assertする。状態やcounterを代入して認証競合を作らない。

固定snapshot全体UIで、旧file取込がlock cancel後もinputのfilename/valueを保持し、同じfileの再選択や既存完了待ちを妨げる実回帰を確認した。Settings.cancelPendingOperationsは操作Mapの所有権破棄と同じ同期処理でfile-import-input.valueを空にし、旧FileListを破棄する。後から選択された新fileは別ownerであり、旧finallyが消してはならない。先行は実File.text後と実preview prepare後を保留して、lock直後にvalue空/件数0、実PIN解除後の新選択保持、旧native handlerのfulfilled終端、全raw/通知保持を直接確認する。元のd.importFileの完了結果もdoneとしてassertし、timeoutを変換して捨てる形では成功にしない。

### Masterの表示行と編集開始時の原本不一致

表示した行とopenMasterModalが読み直す最新masterの間に別writerが対象を削除すると、旧item/parentItemへfallbackしてはならない。既存subcategoryの親または子、account/category/recurringの既存itemが最新collectionに存在しない場合は、modalを開く前に具体的な競合エラーを返す。旧行を復活させず、削除された親へ追加した子を保存せず成功したように閉じることも禁止する。新規account/category/recurringのitem=nullは従来どおり許可し、新規subcategoryの親は最新masterに存在することを要求する。旧空IDの実在する行はfind成功であり、今回新たに非空ID制約を課さない。

先行は、実DBへ専用の未参照口座/費目/内訳/定期ルールを保存して表示し、native編集・内訳追加clickの最初のmaster readを保留する。その間に別の実mutateMasterConfigで対象または親を削除し、削除後全rawを捕捉する。旧openを解放してmodal未表示・競合通知1件・全raw保持を直接assertする。空ID修復、正常新規/既存編集と子配列省略の対照を維持する。実保存中のsubmit再入は既存operationが保留中に同じformのrequestSubmitを行い、実保存callが1回だけで原本/ownerが維持されることを確認する。

この入口検査の成功後には、expectedConfigは最新原本のcloneであり、subcategoryのparentと既存childはその同じ原本に実在する。submitはexpectedConfigをさらにstructuredCloneするため、親cloneと入口parentは別objectである。したがってsubcategory submit内のparent有無、同じcategoriesの空配列補完、parent/childの旧object fallback、cloneと元objectのidentity比較は、この証明を条件として簡素化する候補とする。optional subcategories配列補完と空ID修復は保持する。未知typeの公開呼出は本番producerを持たないが、数値のために不正なtypeを作る試験や防御削除を行わない。独立Phase2/3承認後に限って入口検査と当該支配されたfallbackを是正する。

認証material比較の入力producerは、期待mapではputSecurityKeys入口のstructuredClone済みgraph、現物ではnative getのstructured cloneまたはMemoryのJSON/structuredClone済み保存値である。function/symbol値はこれらのcloneで保存・観測前に拒否され、symbol own keyはclone対象にならない。signature helperのfunction/symbol型拒否とsymbol own key拒否を、さらに同helper内に重ねる必要はない。opaque型（CryptoKey/Date等）と循環graphはclone後も存在し得るため、その比較拒否は保持する。公開APIからfunction/symbol期待値がDataCloneErrorで拒否され、全rawが保持される先行を置き、同guardを通過する到達不能stateは作らない。この2重複guardだけを独立Phase2/3承認後の整理候補とする。

Backup残存境界の追加先行は、locked状態の公開preview/reapproveの最初のDB読取0、共通closeTopModalによる外部閉鎖後のplan/確認語/確認ボタン破棄、実prepare/getPendingImport応答待ち中に同じmanagerの実署名syncMasterが開始する競合、updatePendingImport開始待ち後の実lock/PIN解除による旧catch抑止とする。同期busyはflag代入ではなく、実Ed25519署名を検証したfetchの保留で作る。managerを読取途中に差し替えると認証owner失効を検査する別ケースになるため、busy競合ではmanagerを最初に設置して同じinstanceを維持する。同期transportは明示したserver失敗で終了させ、同期自体の正常commitを取込処理の変更と誤帰属しない。全raw・plan・通知と実Promise終端を確認し、この6境界は既契約の試験補完で本番変更を必要としない。

Backupの正常な完全再承認と、現認証の完全取込CAS競合を追加対照とする。正常再承認は実pendingのid/dataを維持してbase_versionだけを除き、正常通知とpending表示を更新する。現認証の取込競合は、実preview後に別の実putTransactionが到着した状態でnative確認を実行し、最新全rawを保持してmodal内に具体的な競合を表示する。選択plan/確認語は保持し、busyは解除されて確認ボタンが再度利用可能になる。これは正常な再試行・拒否表示の既契約補完であり、架空のbusyや書込結果を作らず、本番変更を必要としない。

SyncManager.sessionGuardは内部の認証snapshot helperであり、全本番callsiteは明示したoptions objectとown parentを渡す。beginAttemptは省略parentを自身の引数でnullへ正規化し、syncSharedMaster/flushPendingImport/sendRequest/pushPending/downloadTransactionsは各入口optionsでnullへ正規化し、closeMonth/retroactive等はattempt.validを明示する。従ってsessionGuardの外側options省略defaultとparent省略defaultだけを整理候補とする。requirePrivateKey=trueは実際に省略されるため維持し、署名鍵/DB鍵・世代/provider/親predicateの比較も一切減らさない。constructorおよびサービス公開入口の引数省略互換は維持する。

先行は、実AES/実署名/実GAS/実DBによるsyncMaster・双方向・全状態受信・未送信push・月締め・遡及更新の6公開入口を実行し、委譲観測する内部sessionGuardの全呼出がoptions objectとown parent(null/function)を受けることを直接assertする。private無しのsyncSharedMaster拒否対照でrequirePrivateKey既定の認証拒否とread0/全raw保持を確認する。helperを省略引数で直接呼んだり、架空busyを代入して数値を作らない。独立Phase2/3承認後に内部signatureの不要default2個だけを削除する。
