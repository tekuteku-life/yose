# review64 資産表示・グラフ・年間締め・過去明細一括編集の工程再入

本記録は1.20.0時点のものである。追加のキャンセル/戻る指摘の是正と1.20.1の検証は[review65](review65.md)へ引き継ぐ。

## 起点と判定原則

前回は開発プロセス定義書の先行設計・独立レビューを行わず、候補実装と試験を先に作成した。この順序違反を過去に遡って解消したとは記録しない。2026-10-27の本人指示によりPhase 1から再入する。候補は/tmp/yose64-candidate.patchと/tmp/yose64-candidate-untracked.tar、Git stashへ保存した。

originを取得し最新main=770ebf9を確認した。専用feature/asset-trends-annual-closingを同コミット起点で作成した。旧feature/bulk-advance-repayment=022e8d2と退避stashは保持する。前作業は未統合なのでその業務変更・3.62文書/試験を新ブランチへ持ち込まず、今回の差分だけを復元し競合を解消した。

Phase 1ではR/E/I-3.63、専用設計、索引、設計テスト監査を更新する。既存候補の採用可否はこれから独立レビューで判定する。全対象各97%未達なら総合Grade A+・コミット・マージ承認とはしない。以前のテスト成功数/coverageはこの原本の最終値として使わない。

## 工程の状態

Phase 2初回のdesign_securityは、既存refreshAllViewsがカード引落生成を行うため取消時の「新規取引を生成しない」という契約と矛盾し、表示更新経路も未定義であると指摘した。Phase 1へ戻り、closeMonth呼出前の終了では再取得しないこと、送信試行後もgenerateSettlements:falseの読取専用経路だけを使うこと、表示例外を締め結果と分離して捕捉することを設計へ明記した。再レビュー前に本番コードは変更しない。

design_uiは、Chart.jsが描画領域外で独自modeを呼ばず旧activeを保持する点と、取得原価の階段線に通常の最寄り点を使うと次の記録値を先取りし得る点を指摘した。Phase 1へ戻り、イベント後処理による領域外/2本指時のactive解除、凡例操作と破棄済みchartの保護、通常線の距離尺度と階段の水平区間/垂直境界における日付・金額の選択を明記した。対応する実入力の回帰をPhase 3で追加する。

Phase 2再レビューはdesign_security、design_uiともPASSである。これは設計ゲートの結果であり、候補実装や最終受入の承認ではない。以降はPhase 3で先行試験を拡充する。

| 工程 | 状態 |
| --- | --- |
| Phase 1 | 認証競合・メモ経路・追加一括編集と監査対応を反映した |
| Phase 2 | 最終追加分を含め独立再レビューはPASSである |
| Phase 3 | 先行RED・fixture是正・境界補完の独立再レビューもPASSである |
| Phase 4 | 是正・棚卸し・TAB/構文/型/GAS生成一致は成功した |
| Phase 5 | 独立コードレビューと全テストは成功したが、各97%未達で総合不合格である |
| Phase 6 | 未到達である。コミット・push・リモートPR作成は行わない |

## Phase 3初回テストレビュー

test_auditorは、ボタン再有効だけで月締めの実Promiseを待たない点、取消時にcloseMonthモック呼出だけを検査して原本副作用を見ない点、ロック/再解除競合、系列名/件数だけのtooltip検査、署名経路の失敗/後年再締め不足、everyだけによる空集合の偽陽性を指摘した。Phase 3へ戻し、処理完了待機、原本比較、日付/系列/値の組、失敗時のサーバー/端末の非対称状態、明細の件数/ID/金額を直接検査する試験へ補強する。

design_uiが作成した実Chart.jsの先行試験は14件中10成功・4失敗である。軸/凡例/先頭指が領域外のピンチでactiveが残る3件と、階段線の右側で次の記録日/金額を先取りする1件を再現した。対象canvasのafterEventまで待つ補強後も同じ結果である（/tmp/yose64-chart-red.log、/tmp/yose64-chart-red-reviewed.log）。

design_securityの年間締め先行試験は17件中8成功・9失敗である（/tmp/yose64-annual-red.log）。失敗は未送信終了時のrefresh副作用、read-only指定不足、表示更新例外未捕捉である。予定版競合・サーバー未入力・3月応答喪失・暗号化commit失敗・後年境界維持は実署名経路で検査した。正常系の金融内容24件と各月2件のarchiveも直接比較する。

test_auditorの再指摘で、予算設定の旧draft/!loading/有効だけの待機を廃し、実renderSettingsのPromise、対象年、入力後draft反映まで待つよう補強した。メタ情報を保留して旧条件が真でも設定遷移が未完了である回帰を追加した。またChart stubへ実ライブラリのInteraction公開APIを定義し、本番のstub専用フォールバックをPhase 4棚卸し対象とする。

test_auditorのPhase 3再レビューはPASSである。先行REDとテスト自身の待機補強を記録したうえでPhase 4へ進み、候補実装を是正する。

Phase 4着手時の棚卸しで、候補のclosingMonths/disabled解除が最終表示更新の完了より先であり、「処理終了まで二重起動を拒否する」契約の回帰が不足すると判断した。Phase 3へ再入し、表示更新を保留して二重送信が起きないことを直接検査する試験を追加する。本番是正は再レビュー後である。

追加試験は/tmp/yose64-refresh-busy-red.logでREDを確認し、test_auditorの再レビューもPASSである。Phase 4へ復帰し、取引生成を伴わない最終表示更新、例外捕捉、最終更新完了までのbusy維持、領域外active解除、階段値の据え置き参照を実装する。stub専用nearestフォールバックは除去し、固定Chart.js 4.6.1の公開APIへ統一する。

## Phase 4是正・棚卸しと静的ゲート

Chartのイベント後処理は凡例クリックを阻害せず、破棄済みchartには触れない。階段値の選択は通常線の距離判定と分離した。年間/月次締めはcloseMonth未呼出なら再取得せず、送信試行後だけgenerateSettlements:falseで描画し、表示例外を捕捉する。busy解除は最終表示更新の後である。既存の引数省略時の自動引落生成は保持する。

不要なstub専用fallbackを削除した。既存のフォームDOM ID、投資の保存/CAS、署名・暗号・GAS生成validator、金額計算、円グラフの構成比は維持する。新規モジュールのSW事前キャッシュと5箇所/lockfileの1.20.0同期も確認する。

実装後、テストより先にnpm run lintを実行し、TAB・構文・型・GAS生成一致を全件成功した（/tmp/yose64-phase4-lint.log）。その後の関連単体/システム/実UI51件は全件成功した（/tmp/yose64-phase4-focused.log）。予算の待機回帰2件も成功した（/tmp/yose64-budget-test-readiness.log）。以後は本番原本を固定し、Phase 5の独立実装レビューと統合計測へ進む。

## Phase 5初回結果とPhase 1/3再入

初回統合計測はNode1072/1072成功、UI494/495成功である（/tmp/yose64-coverage-first.log、生記録/tmp/yose-coverage-ySPPtd）。50本番原本のmanifestと現ファイルのSHA-256一致を確認した。全体Line97.43%/Branch85.40%、34ファイルで各97%未達である。UIの既存settings_workflows:307は失敗通知だけを待ち、最終表示更新の終了前にdisabled=falseを期待して失敗した。単独成功で取り消さず、実handleCloseMonthのPromiseまで待つ試験へPhase 3で補強する。

design_uiの初回実装レビューはPASSだったが、design_security/test_auditorは独立実Chromium probeで最終表示更新内の口座読取がロック/再解除を跨いで旧名を描画する不具合を再現した（/tmp/yose64-refresh-session-probe.mjs）。Phase 1へ戻り、開始前だけでなく各読取後の状態/DOM反映前まで認証有効関数を伝播する横展開と、旧catch/finallyの失効契約を専用設計へ明記した。

本人から「過去の収支一括編集で編集できるはずの項目が使えない場合がある」と追加されたためR/E/I-3.64を追加した。具体的利用条件は確認中である。design_uiの合成実UI probe（/tmp/yose64-bulk-capability-probe.log）で、金融役割のない通常収支でも共有group_idだけでメモ/タグ限定になること、項目別の原因説明がないことを確認した。空の旧前払補助情報や真の連携役割は保護を維持する設計とし、先行レビュー・再現テストを行う。


本人の具体条件は、有効親費目/アーカイブ済み内訳を参照し金額相違がある明細で、現金→クレジットカードと費目/内訳を変更できなかった、というものである。口座のみ変更時の旧内訳/各金額保持、有効な分類への変更、現在のアーカイブ内訳の識別表示を先行設計と回帰へ追加する。

本人の追加条件を受けた実UI合成probe（/tmp/yose64-bulk-archived-child-probe.log）では、別groupの通常支出は口座/親子分類を変更できた。同条件でgroup_idだけを共有すると適用チェックが無効となった。共通のアーカイブ済み子が初期画面では未分類になる表示不具合も確認した。本人データのgroup_id/金融役割が未取得であるため同一原因と断定せず、これらの直接再現を追加する。

追加設計のPhase 2はdesign_security/design_ui/test_auditorがPASSである。本人条件追記後もtest_auditorがPASSと判定した。認証横展開の先行試験は38件中9成功・29失敗であり、型/参照例外やtimeoutではなく、DOM/内部状態・旧通知/busy・有効関数伝播の期待違反である（/tmp/yose64-render-session-red.log）。23種類の葉描画と最終更新中の実lock/unlockを含む。

既存settings_workflowsの失敗は最終表示更新を保留し、通知後も無効状態を保持することと実Promise完了後の復帰を直接検査するよう補強した。単独1件は成功し、test_auditorの試験是正レビューもPASSである（/tmp/yose64-settings-close-wait-fixed.log）。初回全体NGは取り消さず、最終全体再実行を必要とする。

認証試験の独立再レビューではrootのstubが引数を無視して伝播漏れを検知できない点を指摘された。全7stageの同一isSessionValid受信と親失効後false、税のstate/options位置、保留中の受信callbackまで直接assertするようPhase 3へ戻した。追加unit11件は6成功・5REDであり（/tmp/yose64-render-propagation-red.log）、test_auditor再レビューはPASSである。

一括編集の新規unit17/結合6/UI6と既存関連44件は計73件中52成功・21REDである（/tmp/yose64-bulk-edit-red.log、/tmp/yose64-bulk-edit-red-reviewed.log、/tmp/yose64-bulk-edit-red-aria-final.log）。旧baregroup制限期待は新契約へ合わせ、実point役割の後発追加で拒否/全raw不変を維持した。独立指摘のARIA分割式は実バイト/実行展開で元から正しいと確認され、レビュワーが指摘を撤回した。String.rawの共通読取helperへの整理と各IDREFの可視/文言確認は可読性改善として扱い、元REDをテスト不備に分類しない。test_auditorの最終Phase 3判定はPASSである。

認証横展開と一括編集は、それぞれ設計/先行RED/独立テストレビューを通してからPhase 4へ進み、担当ファイルを分離して実装する。全原本が揃った後に静的ゲートを先に実行し、回帰と独立実装レビュー・全体統合計測を再実行する。

## Phase 4追加実装と静的ゲート

認証描画はcaptureRenderSessionで既存authGeneration・鍵・親有効関数を合成し、rootと各葉/入れ子の非同期反映前へ伝播した。通常更新の自動引落とread-only更新を区別し、ロック時のclosing破棄と旧catch/finallyの所有確認を実装した。共有helperもSWの事前キャッシュへ追加した。

一括編集はbulkEditCapabilitiesのfields/reasonsを共通判定とし、Mapで実役割・明示/逆参照・役割のある同groupを調べる。通常の共有groupだけでは制限しない。現在の共通内訳を復元し、archived原値はdisabledの識別付き現在値とする。原因説明はescapeHtmlを通して表示し、scopeと項目理由を両方aria-describedbyで関連付ける。

所有原本が揃った後、回帰試験より先にnpm run lintを実行しTAB・構文・型・GAS生成一致がすべて成功した（/tmp/yose64-phase4-expanded-lint.log）。本番原本を一時固定し、追加先行試験と関連回帰を実行する。

関連193件の初回は192成功・1失敗である（/tmp/yose64-expanded-focused.log）。data_insights_storage:123の暗号化中競合試験に、共有group_idだけを追加して拒否を期待する旧fixtureがもう1か所残っていた。新契約では正常に許可すべき入力であり、本番の拒否を戻さずPhase 3へ再入する。同group＋実ポイント役割の後発追加へ置き換え、競合後の全raw原本と新到着明細の保持も直接比較する。単独成功だけで初回NGを取り消さず、独立レビューと関連全体再実行を必要とする。

このfixture是正はtest_auditorが独立確認してPASSである。該当1件の成功は/tmp/yose64-bulk-race-fixture-fixed.logに記録し、最終統合試験で全体の再成功を確認する。

## Phase 5追加実装の独立クロスレビュー

認証guardを実装したdesign_securityは、自身の実装を承認対象とせず、一括編集/グラフの実装と金融構造保護・原本再検証・archived現在値・理由の安全な描画をレビューしてPASSである。一切の本番実装を担当していないtest_auditorは、両要求/全差分/具体的assertとfixture是正を独立レビューしてPASSである。design_uiは自身のbulk実装を承認せず、認証guard/グラフのクロスレビューを行う。

本番原本を再び固定し、/tmp/yose64-coverage-final.logへ全4層統合測定を開始した。Grade A+およびPhase 6到達は各ファイル97%基準を含む最終結果で別に判定する。

design_uiのクロスレビューで、TxInputのメモ履歴自動反映イベントにも保留readを跨ぐ認証競合を再現した（/tmp/yose64-expired-memo-probe.log）。再解除後にcat_housing/sub_rent/NEW_MEMOへ変更しても分類だけ旧cat_food/sub_groceriesへ戻る。候補収集のguardだけではイベント内の後着反映を防げないためPhase 1へ戻し、文字列/イベント双方の対象メモ比較と開始元authguard、両中項目読取/catchへの伝播を先行設計へ追加した。現在進行中の測定はこの是正前の候補結果として保持し、最終値へ流用しない。

2回目の統合測定はNode1097/1097・UI526/526成功である（/tmp/yose64-coverage-final.log、生記録/tmp/yose-coverage-IhL7nu）。51原本のSHA-256一致を確認し、報告JSONと当時原本を/tmp/yose64-second-coverageおよび/tmp/yose64-phase5-second-sources.tarへ保存した。全体Line97.47%/Branch85.35%、35ファイルで各97%未達である。メモ競合を未修正の候補なので最終承認とは扱わない。

未確認の分岐を実境界へ対応付け、一括編集の通常振替・同じ親を明示指定した場合の旧子/同額税情報保持・最小削除墓標・groupのない選択と複数逆参照を4件補完した。意味のない防御例外モックは追加しない。チャートの領域外判定はChart.js本体がmode呼出前に実施し、外側のイベント後処理も必要であるため、独自mode内の到達不能な重複判定を棚卸し対象とする。実際の軸/凡例/ピンチ回帰は維持する。

メモの追加設計・先行9件（4成功/5RED、/tmp/yose64-memo-session-red.log）、追加境界4件、重複領域判定の棚卸し案はtest_auditorの独立再レビューでPASSである。Phase 4へ復帰しメモ反映を是正する。Chart.js本体とイベント後処理に重複する独自modeの領域判定1行を除去し、存在しない領域外mode呼出のモック試験で数値を繕わない。

メモ自動分類は開始auth/keyと対象メモを捕捉し、文字列/Event双方で現在メモを照合する。マスタと両中項目の読取後に検査し、中項目の親一致も確認してから反映する。旧catchの通知も抑止した。実装後にnpm run lintを先に全件成功した（/tmp/yose64-release-lint.log）。最後の対象回帰を実行し、追加sourceだけの独立再レビューと全体再測定へ進む。

追加実装のdesign_uiクロスレビューはPASSである。test_auditorは本番不具合ではなく、memo_session_edgesの具体的assertが設計テスト監査に未対応であると指摘した。R/E/I-3.63と関連メモ契約から文字列/Event・実lock/unlock・両中項目await・別メモ・旧/現在の通知へ対応付けを補正し、独立再確認へ提出する。仕様・本番原本・期待値は変更しない。

監査対応補正後のtest_auditor最終再レビューはPASSである。実在するR/E-3.19とE-3.40へ参照を揃えた。最後の対象77件も全件成功した（/tmp/yose64-release-focused.log）。以後は本番/試験原本を固定し、/tmp/yose64-coverage-release.logへ最終統合計測を行う。未達条件があればPhase 5不合格のままPhase 6へ進めない。

## 最終全体結果と工程の到達点

最終結果はNode1101/1101、実Chromium UI535/535成功であり、失敗・取消・skipは0である。全体Line97.49%/Branch85.47%、33ファイルで各97%未達である。本番51原本のSHA-256は計測前後および現在と一致した。実行ログ/tmp/yose64-coverage-release.log、生記録/manifestは/tmp/yose-coverage-zHIbI6である。詳細・改修対象も含む全未達一覧は[最終計測](review64_coverage.md)を正とする。

design_uiは自作bulkを除く認証/グラフとメモ是正、design_securityは自作guardを除く一括編集/グラフをクロスレビューした。最終差分と監査対応は本番を一切実装していないtest_auditorも独立確認し、いずれも最終のコード/機能レビューはPASSである。本人指定の有効親/archived子・異なる金額・現金→クレカと分類変更は実UIで成功し、元額・未指定軸・未選択原本を保持する。合成条件と本人実データのgroup/金融役割は同一と断定しない。

追加の実画面確認でも口座/親/子の適用チェックが有効で、archived子の現在値を表示し、ページ全体の横はみ出しがないことを確認した（/tmp/yose64-bulk-preview.log、/tmp/yose64-bulk-edit-preview.png）。資産画面は1180/390/320pxとdarkを確認した。

各対象97%基準が未達のため総合Grade A+・マージ承認は行わない。Phase 5総合受入を不合格としてPhase 6へは進めず、差分は未コミットで保持し[PR草案](review64_pr.md)を提示する。前作業ブランチと退避stashも保持する。公開GAS/実Spreadsheet、実機タッチ、配布先PWA更新はローカル保証の対象外である。

最終の計測JSON・原本manifest・全未達一覧・工程到達点・PR草案の記録整合性もtest_auditorが独立確認してPASSである。この記録レビューのPASSは各97%未達の総合受入を承認するものではない。最終文書の構文/Mermaid検査も成功した（/tmp/yose64-final-doc-syntax.log）。
