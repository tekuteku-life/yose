# 同期・明細操作・大量データ・予定生成・ポイント設定

## 最終判定（2026-10-29）

全Node1364件・実UI631件は成功し、実装後の独立コードレビューもPASSである。一方、全体Line 97.56%/Branch 85.32%、各ファイル97%は36ファイルで未達である。Phase 5総合受入は不合格、Phase 6は未到達とし、条件付き指示に従いコミットは行っていない。[最終計測と全未達一覧](review66_coverage.md)、[PR草案](review66_pr.md)を参照する。

## 起点

2026-10-28、main a74bac0へ前作業がPR #31で統合済みであり、作業ツリーはcleanであった。git fetch origin main成功後、origin/mainからfeature/transaction-workflow-performanceを作成した。今回の7要求は[詳細設計](../transaction_workflow_improvements.md)とR/E/I-3.65〜3.71へ対応付ける。

本人の追加回答は、予定生成で同じ計上月/種別/口座/費目内訳/金額の手入力明細も除外すること、ポイント相殺分類は設定画面で既定指定することである。設計へ反映した。

## Phase 1 原因調査

design_securityは実Chromium/IndexedDB/AESの13,000件を測定し、単一編集4,177ms・復号13,003回・clear1/put13,000、無変更双方向同期9,233ms・復号104,016回・clear2/put26,000を再現した。別々の2件の並行編集は8,653ms・復号39,006回・CAS再試行1回である。通信即応モック・実署名・UI再描画なしという境界を保つ。記録は/tmp/yose66-sync-performance-browser.log、スクリプトは/tmp/yose66-sync-performance-browser.mjsである。

design_uiは実Chromiumで保存を保留し、登録は保存ボタンだけが無効、編集はbusy内部フラグだけでフォームが有効なことを確認した。編集の読取待ち中に入力したメモが保存対象へ混入した。記録は/tmp/yose66-form-busy-probe.logである。

test_auditorは手入力の同内容明細がルール未関連なら予定生成で除外されないことを確認した。ポイント専用口座は任意IDを利用可能であり、固定依存の実体は口座なし相殺の収入費目/内訳である。費目欠落/親アーカイブ/子アーカイブで保存拒否し全raw原本が保持されることを確認した。参照validatorを緩めず既定分類を設定する設計とする。

## 工程

Phase 1の文書を作成した。Phase 2の独立設計レビュー前であり、本番コードとテストは未変更である。過去のテスト数・レビューPASS・カバレッジ値を今回の受入へ流用しない。

Phase 2でdesign_securityは、旧復号Promiseが失効後に平文を返さない契約と、旧GASによる新設定の黙示除外を検出する契約の不足を指摘した。Phase 1へ戻り、await後/返却前の鍵世代再検査とreject、設定済み値の応答不在/不一致/省略でbase更新を拒否することを正本へ明記した。本番と試験は未変更であり、再レビューを必要とする。

design_uiはロック時の選択保持と既存強制破棄の矛盾、および専用刷新/背景処理の境界不足を指摘した。Phase 1へ戻り、認証失効は原本保持・選択破棄を優先すること、保存側が待つ金融生成なしの表示中stage、認証世代単位の背景カード生成/末尾送信要求、同認証の新draftへ非干渉という契約と直接assertを追加した。

Phase 2再レビューはdesign_security/design_ui/test_auditorの全員PASSである。Phase 3でrootがpure予定/ポイント/刷新の先行43件を実行し16成功・27REDであった（/tmp/yose66-root-red.log）。test_auditorは単一microtask待機、末尾要求を捨てても通る送信件数、DB有効関数の存在検査だけという3点を指摘した。Phase 3へ戻り、stage開始gate、送信保留中の新版追加と2回目実送信、DBが受けた有効関数の認証失効後false/新認証trueを直接assertするよう補強した。

さらにtest_auditorは鍵と認証世代の同時変更、および未分類購入の片軸しか見ないassertを指摘した。鍵だけ/世代だけの独立ケースと親子4項目のnull検査へ補強し、root担当のPhase 3再レビューはPASSである。既存のfactory直接呼出fixtureは相殺分類を明示引数へ変更し、金融期待値を保持した。関連143件は114成功・29REDである（/tmp/yose66-root-red-final.log）。

ポイント取込の先行試験を確認中、差分追加マージの項目不在で新規明示既定を消す期待が混在していた。Phase 1へ戻り、差分は手元設定を優先して不在で消さず、未設定だけ明示incomingを採用し、完全置換だけ旧ファイル不在を未設定へ戻す契約を明記した。不正incomingは非採用でも拒否する。最高位の設計/テストゲートの再確認を必要とし、本番はまだ未変更である。

本人から「締め済み月の変更のたびに表側の締め処理が次操作を阻害する」と追加された。R/E/I-3.69の具体化としてPhase 1へ戻り、承認後の保存/一覧反映と再締め通信を分離し、背景の非遮断表示・末尾送信・旧ACKの新版保持を明記した。締め済み月の実署名push保留中の連続操作を先行UIへ追加する。本番は未変更である。

追加closed UIは保存Promiseが再締め応答前に未完了であることを明示REDで再現し、予定UIも重複件数/API不存在を捕捉した（/tmp/yose66-extra-ui-red.log、5件全RED）。追加設計のPhase 2と補強済み全先行試験のPhase 3は独立再レビューPASSであり、担当scopeに齟齬がないことをtest_auditorが確認した。Phase 4へ進み3作者で所有ファイルを分けて実装する。

実装時の契約照合で、完全取込の旧receiptには当初の変更前状態がなく、応答喪失後の再送から項目別送信差分を再構成できないことを確認した。未確認を推測しない既存原則を具体化し、取込完了と内訳未確認を別表示する。receipt/署名形式は拡張しない。また専用刷新unitのsync stubへ実際の送信前提であるURL/署名鍵を補い、空URLのオフライン経路を誤って送信対象にしないようfixtureを是正した。この限定追加を独立確認する。

## Phase 4初回と手戻り

全作者原本と1.21.0/SW追加3helperが揃った後、npm run lintが全項目成功した（/tmp/yose66-phase4-lint.log）。関連Node290件は288成功・2失敗、実UI87件は83成功・4失敗であった。ログは/tmp/yose66-phase4-node.logと/tmp/yose66-phase4-ui.logである。初回NGは取り消さず、是正後の関連全体再実行を必要とする。

NodeのlastError欠落は開始時privateKey=nullを結果所有権まで無効化する実装不具合であり、送信認証の鍵必須は維持して所有判定を鍵/世代の一致へ分離した。もう1件の最小remote fixtureはカテゴリ不在とfreshポイント既定の参照が不整合であり、当該テストだけ事前に既定をnullへして元の受信目的を保持するPhase 3是正とした。

UIのポイント親/子アーカイブ表示2件はnotice用configをモード切替時の最新読取へ更新しない実装不具合である。残るページ跨ぎは同順位fixtureで想定IDが別ページにならない不備、確定の認証試験はtxListControllerをobserver対象へ含めない不備であり、Phase 3へ戻って順位を明示し実Promiseを捕捉した。限定19件の再確認は17成功・notice2件REDである（/tmp/yose66-phase3-ui-fixture-reviewed.log）。

自己点検でポイント既定の競合拒否後にdirtyを保持したまま最新原本へ戻す操作がない点も確認し、Phase 1へ戻った。破棄確認付きの「保存済み設定を読み直す」を正本へ追加し、先行再現・独立レビュー後に是正する。通常の保存失敗での保持と、認証失効時の強制破棄は区別する。

design_securityは読直し成功後にdirty=falseとなると保留中の旧renderSettingsが同認証の古い原本を戻せる点を指摘した。Phase 1の回復契約へpointDefaultsGenerationを読取開始/反映前で合成することを追記し、旧読取解放後も最新原本を保持する先行試験を追加する。

追加reload/receiptの21件は15成功・6RED（既存notice2、新reload4）である。receipt内訳未確認caseは補完GREENであり先行REDと扱わない（/tmp/yose66-phase3-point-reload-reviewed-red.log）。この追加設計と先行試験の独立再レビューもPASSであり、UI作者がnotice/読直しを是正した。結果は全体再実行で判定する。

実装の準備レビューでtest_auditorは実DB再現による3点を追加指摘した。既定をnullへクリアした送信に古い設定済みACKが戻ると復活/同期済みになる点、archive既定の同値比較がJSONキー順依存で無関係な保存を拒否する点、旧不整合accounts:{}の修復commit後に業務集計がTypeErrorとなる点である。Phase 1/3へ戻り、unsetも比較する応答契約、親子の値比較、旧形状を安全に扱ってCAS前に集計を完了する契約を明記し、先行再現後に是正する。

design_uiの独立準備レビューで、同期entryの旧keyGenerationをnested読取が捕捉し直して旧応答をcommitする点、同groupの実金融役割を持つ裸expenseの予定充足転用、業務commit後のarchive補助metadata失敗で受信結果が消える点、予定保存後の刷新失敗を生成失敗と誤通知する点も再現した。Phase 1/3へ戻り、開始元epochのDB/同期伝播、実金融groupの除外、補助metadataの原子保存、保存済み生成結果と再試行を正本へ具体化した。

rootの金融groupはUnit2/実DB1でRED、関連27件は24成功・3REDである（/tmp/yose66-financial-group-red.log）。予定の保存済み通知はalert2件を明示REDで捕捉し、生成/除外件数と再試行ID不変まで補強した（/tmp/yose66-recurring-refresh-reviewed-red.log）。独立承認後にroot所管2件を是正し、構文/型検査は成功した。

新しい復号世代拒否の横展開で、trusted分類/タブ操作の読取をAESで保留してlock/unlockするとnative event側で未処理rejectとなることをdesign_uiが実Chromiumで再現した。captureRenderSessionのkeyGenerationとreadInRenderSessionによる失効時だけの吸収を正本へ明記した。rootの先行Unit9件は3成功・6REDであり、helperはまだ未実装である（/tmp/yose66-native-session-unit-red.log）。UI先行は正常1成功・失効7REDであり、rejection handlerで不具合を隠さず実unhandledを検査した（/tmp/yose66-native-render-session-final-red.log）。

背景再締めの追加点検で、snapshotが実DBでは654321へ更新されても表示残高が123456のままとなる実Chromium再現を確認した（/tmp/yose66-postsync-view-probe.log）。Phase 1/3へ戻り、commitが確認された背景同期後だけ専用刷新を行い、task完了時の残高反映と次の編集draft保持を先行試験へ追加する。

独立レビュー指摘で、受信commit後に承認待ち/後段失敗となる部分結果も表示へ反映し、旧lastResultを今回へ帰属しない契約へ補強した。先行26件は18成功・8RED（/tmp/yose66-postsync-reviewed-red.log）であり、再レビューPASS後に是正した。native表示読取もhelper/限定leaf/上位通知guardの独立Phase 2/3 PASS後に実装し、構文/型検査を通した。

独立Phase 5で、Aの実態内訳読取保留中に同認証のままBを開くと、旧応答がBの内訳sub_dining_outをsub_groceriesへ戻す実Chromium再現を得た。Phase 1/3へ戻り、編集対象generationと上位change所有権を合成する契約と先行回帰を追加する。

認証世代伝播/補助metadata原子性/競合受信件数の先行試験は、entry6経路の旧鍵世代・DB開始時世代・mock/native IDB metadata失敗・accepted0の競合受信を直接assertし、独立Phase 2/3 PASSである。

再入後のroot関連Node69件は全成功であった（/tmp/yose66-root-reentry-node.log）。関連実UI103件は102成功・1失敗（/tmp/yose66-reentry-ui.log）であり、native10件と締め済み月2件は全成功した。残るdata_insightsの予算往復は、年度予算読取中にd.fillがdisabled inputのDOM値だけを変えdraftへ反映しないfixture不備と実遅延probeで切り分けた。loading=true/disabled=true/draft=0のままDOM500000となり、解放でDOMが戻る。Phase 3へ戻り実render/save Promise、年度、readiness、draft反映の待機を補強する。元失敗を局所成功で取り消さず、関連全体と最終4層を再実行する。

同認証の編集切替先行UIは、trusted計上/実態/種別changeの3件で2成功・実態1REDであった（/tmp/yose66-native-edit-generation-red.log）。新BのID/親子分類/メモを含むdraftと全raw原本を比較し、同認証/同鍵を固定した。予算fixtureの通常/metadata遅延/budget読取遅延3件は全成功である（/tmp/yose66-annual-budget-ready-reviewed.log）。最初の遅延補強2成功・1失敗はbudgetのgateが先行metadata読取を捕捉したfixture不備であり、budget.render開始後だけarmするよう補正した。

backend最終独立レビューで、downloadTransactionsがsyncSharedMaster全体の前後を比較して並行ローカル編集を受信件数へ混入する境界を指摘した。業務項目と同じDBcommit由来の明細受信件数へ統一するため、Phase 1/3へ戻り、並行local版保持/受信0の先行回帰と伝播契約を追加する。

全作者の構文/型/GAS一致後の全体lintは成功し、関連Node257件/実UI110件は全成功した（/tmp/yose66-final-candidate-lint.log、/tmp/yose66-final-candidate-node.log、/tmp/yose66-final-candidate-ui.log）。この成功後にも独立コードレビューで受信件数誤帰属と入力候補の自動代替を検出しており、最終受入の完了とは扱わない。

受信件数誤帰属は実署名とcommit直前gateによる3入口で全RED（actual1/expected0）であった（/tmp/yose66-received-attribution-red.log）。独立Phase 2/3 PASS後、DB受信commitのbefore/next差分を返し、同期wrapper全体の二重読取を除去した。

背景マスタ受信の未保存draft喪失も実Chromiumで再現した（/tmp/yose66-master-draft-probe.log）。親/口座archiveで現金口座/両分類を別候補へ変え、ポイント口座を空へ変えて相殺方式へ転換した。子のみarchiveでも両子が別内訳へ変わった。明細rawは不変であり、保存前draftの製品不具合である。Phase 1/3へ戻り候補外の現在値を保持する設計と実listener経由の先行回帰を追加する。

backend再レビューで、fetchRemoteStateの新明細受信commit後に終了時pending読取が失敗すると、DBには受信明細があるのにlastResultがdownloaded0/partialfalseとなる実暗号/署名/DB再現を得た。Phase 1/3へ戻り、DBcommit直後に所有attemptへ確定件数を記録し、終了処理の後続読取失敗でも保持する契約を明記する。双方向末尾受信/遡及の同型も先行検査する。

候補保持の先行は最終10件で1成功・9失敗であった（/tmp/yose66-master-draft-choices-complete-red.log）。修正後の13件（件数帰属3件を含む）は4成功・9失敗であった（/tmp/yose66-master-and-attribution-green.log）。8件は回復保存後の正常な背景ACKで初期unsynced原本がsyncedとなるfixture不備であり、初期seedをsyncedへ揃えてraw保持assertを維持する。残る親0候補の1件は有効rec_rentの参照を残したままcat_housingをarchiveする不正incomingによるfixture失敗であり、製品REDの分類を撤回する。依存ルールも整合させ、受信commit/実listener刷新完了後のdraftを直接検査するPhase 3是正とした。初回NGは全て保持し、局所成功では受入しない。

postcommit確定結果保持の先行10件は5成功・5REDであった（/tmp/yose66-committed-results-red.log）。fetch/末尾/遡及の受信件数消失、push/月締めのpartial欠落を実DB保存後の読取失敗で捕捉し、正常対照で1回計数を確認した。独立Phase 2/3 PASS後に最後の結果保持を是正する。

候補保持のfixture最終10件は全成功であり、独立Phase 3再判定もPASSである（/tmp/yose66-master-draft-fixture-final-green.log）。親0候補の旧製品RED分類は撤回し、有効なincomingの実commit後までassertが到達した補完試験として扱う。

2026-10-29、postcommit確定結果保持の限定実装を独立再レビューし、test_auditorは全backend/UI/rootのコードゲートをPASSとした。すべての既知指摘を是正し、全体lintも成功した（/tmp/yose66-release-lint.log）。これは実装後コードレビューの判定であり、全4層・各ファイル97%の最終定量ゲートとは別である。以後は本番/テスト原本を固定して最終再実行と計測を行う。

固定候補の最後の再入回帰23件は全成功であった（/tmp/yose66-release-reentry.log）。最終性能再計測は単一編集710ms、無変更同期1887ms、並行2編集1389msで、明細putは1/0/2・clear0、並行CAS再試行1を維持した（/tmp/yose66-performance-after-final.log）。変更前との比較条件と境界は[性能記録](review66_performance.md)を正本とする。

初回固定原本による全4層計測（/tmp/yose66-coverage-release.log）はNode1357件中1348成功・9失敗であった。8件はfixture不整合であり、型変更raceの対象cat_point_incomeをfreshポイント既定が参照する1件、最小分類への置換fixture1件、DBstubにhasUnsyncedMasterConfigがない6件である。最初のraceはhookが完了したこともassertして早期拒否による偽成功を防ぐ。

残るfirst-sync1件は実装回帰である。完全fresh共有DEFAULT（端末固有themeのみdark）から既存remoteの任意ID口座/空分類へ同期すると、ポイント既定だけをlocal変更扱いして参照拒否となることを実暗号/署名/DBで再現した（/tmp/yose66-first-sync-probe.log）。旧項目不在/nullは正常、空remoteへのfresh初期送信は正常である。Phase 1へ戻り、既存非空remoteと完全共有DEFAULTの初回だけ比較baseへ新既定も含め、空remote・明示変更・旧legacyを区別する契約を追加した。独立Phase 2はPASSであり、先行回帰を準備する。

同全体計測のBFCache認証関連NGは、実UI隔離run通常4/4成功・計測3/4成功から測定基盤へ切り分けた（/tmp/yose66-auth-gate-isolated.log、/tmp/yose66-auth-gate-instrumented.log）。製品の鍵消去・署名拒否・PIN解除は正常で、pagehide後の完全coverage約2.3MBをclose時に未ACK queueへ重ね、sessionStorage.setItemでQuotaExceededErrorとなる（/tmp/yose66-auth-coverage-quota-probe.log）。これを製品認証へ回避実装しない。metadata重複排除と完全payload復元の基盤設計を追加し、独立Phase 2 PASS後に先行回帰を準備する。初回全体実行の原本は終了まで固定し、失敗計測を最終定量証拠へ流用しない。

初回全体計測のUIは628件中604成功・24失敗であった。24件は測定基盤quota3件、ポイント既定を残した最小分類fixture14件、旧表側同期/後着alertを前提とするfixture7件へ切り分けた。認証/金融の本番検証を緩めず是正した。最終NG報告は/tmp/yose66-coverage-release.log、raw/54原本manifestは/tmp/yose-coverage-k1bkB7、初回報告JSONは/tmp/yose66-initial-reportへ保持した。収集例外を含むため、この計測のcoverage値を最終値へ流用しない。

first-sync新先行は5件3成功・2REDから、金融参照保護2件を加えて7件5成功・2REDへ補強した（/tmp/yose66-first-sync-reviewed-red.log）。明細/残高参照拒否・全raw/base/server保持を独立確認後、比較baseだけを是正した。旧fixture8件は期待値を維持したまま是正し、raceは競合hook成立もassertした。修正後の関連Node152件は全成功した（/tmp/yose66-first-sync-final-green.log）。

collectorは実instrument済み2MB超・未ACK pagehide・ACK再送・reload/BFCacheを使う先行でnative quota REDを得た（/tmp/yose66-coverage-quota-native-red.log）。独立Phase 3承認後のschema/counter分離実装は、既存のexact count/未配送再送/ACK喪失/同ID別payload/invalid map・counter/原本hash/transport異常を含む全36件で成功した（/tmp/yose66-collector-pipeline-green.log）。実アプリの旧BFCache失敗3経路も計測ありで全成功した（/tmp/yose66-collector-actual-bfcache.log）。

旧同期前提UI7件は実ローカル操作Promiseと背景taskの完了を待ち、移動後の新月から再編集する。旧ACK後・第2送信保留中の新版unsynced/previous保持と新payload、第2ACK後の新版syncedを直接検査する。非遮断の未同期/失敗badgeを確認して後着alertなしをassertし、金融期待を弱めず7件全成功と独立Phase 3 PASSを得た（/tmp/yose66-background-fixtures-reviewed.log）。最小分類fixture14件を含む該当18件も成功した。

これらの最終実装後再レビューはtest_auditorがPASSとした。全体lint成功後、本番/テスト原本を再固定し/tmp/yose66-coverage-final.logで全4層を再実行している。最終性能原本11件も/tmp/yose66-performance-release-source-manifest.jsonへ固定し、測定後のhash一致を確認した（最終682/1880/1377ms）。途中版の性能値を最終値へ流用しない。

第2固定計測（/tmp/yose66-coverage-final.log、証拠/tmp/yose-coverage-HSfh2k）はNode1364件全成功、UI629件中628成功・1失敗であった。残るchart_controlsの予算mode往復はactual0/expected1800であり、読取中のd.fillがDOMだけ変えてdraftへ反映しない実遅延probeと一致した（/tmp/yose66-chart-budget-loading-probe.log）。Phase 3へ戻り、このファイル内の通常settings遷移を実Promise/年度/ready/draft待機へ横展開し、意図的なmetadata保留試験は未完了clickを維持する。通常/metadata遅延/budget読取遅延の3対照を加え、元の1800/-300等の期待を維持する。第2計測の部分成功も最終全体成功へ読み替えない。

chart_controlsの待機是正は通常のsettings呼出を同ファイル内で横展開し、actual render Promise・年度・ready・入力後draftを待つようにした。意図的なmetadata保留試験では未完了clickを維持し、budget読取のgateは実budget.render以後だけarmする。通常/metadata遅延/budget読取遅延の3条件で1800/300/20と年度変更後200のdraftを直接検査し、元期待を維持した。通常全21/21・計測あり21/21が成功し、独立Phase 3最終判定はPASSである（/tmp/yose66-chart-ready-standard.log、/tmp/yose66-chart-ready-instrumented.log）。本番原本の変更はない。第2計測の報告JSONは/tmp/yose66-second-reportへ退避した。

第3固定計測は/tmp/yose66-coverage-verified.logで実行している。過去2回のNGを単独成功で取り消さず、この実行の全4層結果だけを最終受入の根拠とする。

第3固定計測はNode1364/1364・UI631/631成功、失敗/取消/skip0で終了した。54原本と最終性能11原本のhashは現原本と一致し、収集例外はない。各ファイル97%未達だけにより終了値1となった。最終定量結果と工程到達点は[review66_coverage](review66_coverage.md)を正本とし、機能/コードレビューのPASSを総合A+へ読み替えない。

最終のexecution/summary・54原本manifest・性能11原本・全未達一覧・工程到達点・PR草案の記録整合性もtest_auditorが独立確認してPASSである。PRチェック項目は「全4層のテストが成功」と表現を揃え、定量ゲート不合格と区別した。この記録レビューは各97%基準の免除や総合受入の承認ではない。最終文書の構文/Mermaid検査（/tmp/yose66-final-doc-syntax.log）とgit diff --checkも成功した。
