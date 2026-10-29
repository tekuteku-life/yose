# 全対象カバレッジ受入の是正

## 起点

2026-10-29、本人の「続けて」によりreview66の36ファイル未達を改善する作業を継続する。feature/transaction-workflow-performance、HEAD a74bac0とreview66の未コミット差分を保持する。前回Node1364/UI631成功・54原本一致・Line97.56%/Branch85.32%の結果は履歴であり、今回の最終受入へ流用しない。

## Phase 1

[受入是正設計](../coverage_acceptance.md)へ全体の分類・各領域の具体的assert・cleanup制限・4層の完了条件を記録した。root、design_security、design_uiは領域を分担して仕様/原本/既存assertを調査し、test_auditorは実装/試験を著作せず独立監査する。

Istanbulの36ファイルとsummaryの値が一致する。現分母のまま各97%へ達するための不足branch hitは1283であり、子locationが空の407件もbranchMap本体へ復元して分類した。分岐数だけでなく到達可能な利用者操作、許容データ、故障/競合、不要な暫定fallback、未使用UIを区別する。現段階で本番/テストを変更していない。

## Phase 2・3

全36対象の具体assert表、Summary/Chartの静的必須root84件、追加UI nullable候補136件のHTML一意性/構築順の証明を補い、独立設計レビューPASSを得た。初回の根拠不足指摘は省略せず、正本へ反映した。

先行テストは公開API/実Chromium/実暗号DBを使い、不正入力は対象pathと正常対照、非同期は実Promiseと認証世代/対象の同一性、拒否は業務raw保持まで検査する。独立テストレビューの3不足は、cache取消時の実CacheStorage内容、初期設定失敗時のsecurity/settings含む全raw、旧同期finish時の実未同期1件による結果差で補強した。補強後の全提出群はPhase3 PASSである。

電子マネー口座の型消失、新規ID空欄のnative requiredと自動採番契約の矛盾、任意accounts省略済み旧masterの資産表示例外、GAS補助月情報の黙示受理を先行REDとして捕捉した。各契約と最小是正を設計へ戻して独立承認後に実装する。0金額の予定入力がnative minで正しく拒否されるケースは製品不具合でなく、handlerへ到達すると仮定した試験を訂正した。

## Phase 4 進行記録

Summary/Chartは承認済み必須rootのguard、正規tagList出力に対する暫定fallback、呼出/HTMLが存在しない専用外部資産rendererだけを整理し、旧masterのaccountsを表示adapterで空配列へ正規化した。金融上の旧external_assets形状、認証/await後の失効、Chart未読込/layout未確定の境界は維持した。構文/型成功後の独立コードレビューはPASSである。

局所runtimeの途中に、別UI編集のAST shorthand二重展開による一時的なimport名重複が発生した。型チェックで捕捉して作者が是正した。該当実行は原本非固定の編集要因FAILとして保持する（/tmp/yose67-root-fresh-tests.log、/tmp/yose67-analytics-post-cleanup.log）。単独で通ったケースを全体合格へ読み替えず、原本安定後に構文/型から再実行する。

部分診断ではbackend9対象とform_busy/sync_result、起動/version/viewport等の改善を確認しているが、最終の全対象97%受入とは区別する。最終4層計測とPhase5は未完了であり、コミットはまだ実施していない。

固定原本で標準instrumentationによるNode全層1711/1711、実UI753/753が成功した。backend担当12ファイルは同一hash/mapのみの部分診断で各Line/Branch97%以上となった。一方UI担当は2/10達成で、他のUI/分析controllerには不足が残る。この結果は1回の最終4層受入ではなく、以後の修正により原本が変わるため最終合格へ流用しない。

追加監査では、旧masterの任意categories省略時の予算設定描画例外、マスタ祝日操作と保守移行の承認待ちを跨ぐ再認証後の旧保存を先行REDで確認した。個別設計/先行試験/独立レビューへ戻して是正する。認証の前後で業務rawと新draft/ownerの非干渉を確認し、API任意optionsを既存呼出互換で伝播する。

rootの追加先行では、TagMemoのfill補助がblurすることによる誤期待、monthly summary省略時のKPI保持と年月表記、任意部品のbox指定漏れ、DB保存API誤記をfixture/期待要因として訂正した。製品REDと区別し、初回ログを保存した。独立指摘で月次の各金額セル、旧master年度draft/ready、全gateのfinally解放/実Promise完了/hook復元を補完した。単独成功を全体FAILの取消には使わない。

MaintenanceのDB第6optionsとSettings.setSetting第3optionsは、UIだけでは伝播漏れを検出できないとの独立指摘を受け、親predicate=falseで読取/transaction0、同一鍵のまま実AES/native成功listener待ちで親だけ失効して全raw原子的保持を確認するDB先行7葉を追加した。Phase3 PASS後にAPIの限定伝播へ進む。既存の引数呼出は互換である。

rootの期間共通化/canonical出力整理後は、追加先行と既存分析/グラフ/予算操作の実UI89/89が成功した（/tmp/yose67-root-cleanup3-regression.log）。追加Coordinatorのoptional API/Storage故障/実offline/旧pane設定も5/5成功した。これらは局所回帰であり、全対象の最終カバレッジ判定ではない。

現候補のDB/暗号/同期11原本を固定して13,000件性能を再測定した。cold編集765ms/明細put1、warm無変更同期1999ms/put0、並行2編集1469ms/put2、全clear0である。実AESは13000/7/2、並行CASretry1、pageErrors空、11原本の前後hash一致である。詳細と測定限界は[review67性能記録](review67_performance.md)へ記録した。

独立コードレビューはMaster→YoseDB.mutateMasterConfigの第2options未伝播も検出した。lockで鍵世代が変わるUI試験の成功だけでは、親predicate/認証世代だけが失効する境界を証明できないため、Phase1/3へ戻してDB先行3観点を追加し、親を原子的commitまで伝播する。鍵世代も変化する22UI観点をこの漏れの否定証拠として扱わない。

Masterの新旧owner追加1葉のtimeoutは、CDP evaluateで保留Promiseを代入した式の返値まで待ったfixture要因である。voidで記録のみ行う形へ訂正し、具体製品assertで確認した他21葉と区別する。初回/84葉83成功1失敗のログを保持し、修正fixtureを独立再レビューする。PINの鍵非nullはcaptureRenderSessionが保証する契約ではないため、既存鍵材料存在guardを維持する。

独立点検の追加probeで、立替の実commit後応答待ちから再認証すると親guardなしの描画を開始すること、完全取込で旧busyを保持して新previewを阻害し旧完了通知/描画を新認証で開始することを確認した。金融rawはcommit済みのまま保持されるため巻き戻さず、開始元session/selection identityのowner/cancelと親描画predicateを設計へ追加した。postcommit先行5葉は5REDであり、承認前にsourceを変更しない。

担当別の同hash診断はbackend12＋立替/完全取込2が各97%以上、MaintenanceはLine99.22/Branch97.00となった。Maintenanceは新4＋既存16＋認証reload4と既存入口2の計26葉が成功し、限定Phase2/3/5もPASSである。root側もグラフ/税/共通入力部品等が達成しているが、全54の統合測定で未採取既存UIと残不足を再照合する。

追加budget2fileは、初回の新入力がdraftへ未反映でも成功し得る比較を独立レビューで指摘された。実settings遷移Promiseと年度/入力可能状態を待つhelperを設け、検索前後1200円・旧処理解放前3000円dirtyを直接assertしてから保持比較へ進め、4/4成功・Phase3 PASSとなった。数値inputの実削除にはnative key codeが必要であることをイベントprobeで切り分け、Ctrl+A/Backspace/Tabと入力/変更イベント、実render完了を検査した。

## 第1統合計測と認証境界への再入

固定原本54ファイルの第1統合計測は `/tmp/yose-coverage-aYxefH`、報告保存先は `/tmp/yose67-coverage-final01-report` である。Node 1736/1736成功、Chromium UI 872/875成功・3失敗、skip/cancelは0である。全体Line99.68%/Branch95.88%であり、46/54ファイルがLine/Branchとも97%以上となった。未達はBulkEdit92.30%、Coordinator94.05%、Master89.60%、Settings84.16%、SyncStatus90.81%、TxEdit86.46%、TxInput89.93%、TxList84.64%のBranchである。全体平均や成功した個別診断で受入完了を代用しない。

UIの3失敗はPIN変更commit直後の認証失効に対する旧成功alert待ち1件と、保険archive/定期予定toggleのhidden/disabled操作2件である。旧通知抑止の期待整合と実保存処理のready待ちを独立して切り分ける。

最終独立レビューは、Backup再承認・native File.text取込・exportの最初のawaitより後の認証捕捉、Coordinator旧初期化による新manager置換、鍵再生成がauth世代だけを先に更新した間の旧同期commitを実Chromiumで検出した。この候補は計測が成功しても受入対象とせず、[非同期操作設計](../async_session_boundaries.md)へPhase1再入する。開始元認証とbusy ownerを分離し、親predicateをDB/子処理/描画まで伝播する。原子的commit済みrawは保持し、旧完了の新UIへの作用だけを止める。

横展開した投資・予算・税通知/集計設定の保存前後8葉、digest成功/故障2葉、drilldownの4await境界は14/14製品REDを確認した。通常renderでdraft参照が交換されても実DB保存がresolveしbusy解放する4対照はGREENである。独立Phase2/3でbusy ownerを既存local generationと排他・cancelで区別する案、および正常税保存の具体値/実DB resolve必須assertの補強がPASSとなった。限定実装後は追加18＋既存15の33/33成功である。これは限定検証であり、次の固定全体計測/最終独立レビュー/性能再測定は未完了である。

明細の追加29葉は、独立Phase3の指摘に従いeditorのlive captureValues/initialValues/原本/busyを捕捉し、新income/planned/986→987draftと旧expense/confirmed/100を区別した。非表示ページ移動は実scrollIntoViewの委譲観測0とscrollY不変を追加し、29/29成功・Phase3 PASSとなった。locked default drilldownの遅延callback1葉も、全分析DOM/raw/通知不変を確認した。

承認済みの静的7候補を整理後、関連333葉の診断は332成功/1失敗であった。失敗はSettings原本の並行変更が1つのbrowser pageのcoverage flushと重なったsource hash不一致であり、機能のassert失敗と区別する。この実行を全成功や固定全体受入と呼ばず、4つの明細原本それぞれのhash/mapが一致するchunkのみで不足経路を診断する。bulkは標準合算の下限でLine100%/Branch97.04%となった。次の最終全体runは全原本・試験を固定して再実行する。

一覧の立替精算にも開始元認証未捕捉とsingular DB linkの親未伝播を確認し、Phase1へ戻した。実nativeのsource/links/master/承認の読取後に再認証すると旧返済が保存され、commit後は旧通知、refresh後は新managerへの旧同期開始が発生する6製品REDである。精算ownerと開始元session、受取口座draftを保持し、既存の背景maintenanceへ更新を統一する設計を独立Phase2 PASSとした。DB singular link/unlinkの親伝播と認証のsecurity raw削除も、同一鍵世代で親だけ失効する実原子的検査へ戻している。

一覧精算の追加15葉は7GREEN/8製品REDの後、限定是正後の関連51葉で50成功/1timeoutとなった。timeoutは新mode切替の全workflow待機が、意図して保留した旧精算まで待ったfixtureデッドロックである。新native switchInputModeの開始を直接assertし、その実Promiseだけを待つ補強後は51/51成功、独立Phase3/限定Phase5 PASSとなった。cancel後の新owner維持と2400円/開始時walletへの実保存、旧raw/通知/背景同期非干渉も維持した。approveの広域親APIは別受入である。

## 固定候補による追加診断と再入

54原本のhashを前後照合した固定候補 `/tmp/yose67-root-candidate-Keyr3y` の全UIは1054件中1046成功・8失敗、skip/cancel0である（`/tmp/yose67-root-snapshot-ui.log`）。この候補は既知の欠落categories不具合や認証画面を隠すタイミングの旧実装を含む診断用であり、最終受入候補ではない。関連Node80/80、追加dropdown4/4、末尾集計/入力回復7/7も同候補の別実行である。

8失敗は、認証画面を初期化終了まで隠さないことによる既存Chart/PIN正常操作3件、cancel時のfile value残留1件、categoriesを省略した受理済みmasterからの定期ルール追加例外1件、失効後の旧成功通知を待つ期待2件、mode選択の実Promiseを待たないfixture1件に分類した。正常hideとfile cancelは限定修正・独立レビューを経ている。mode試験は同じ本番候補で実switchInputModeの1呼出とそのPromiseを待ち、4/4成功した。元fixtureと修正fixtureのSHAおよび一時コピーへの適用/復元を `/tmp/yose67-mode-fixture-provenance.json` に記録し、独立照合PASSを得た。全UIの8失敗自体を取消しない。

追加診断はSHAおよびstatementMap/fnMap/branchMapが全て一致するchunkだけをIstanbul標準mergeした。`/tmp/yose67-snapshot-diagnostic-current.json` によりInput97.22%、Edit97.65%、List97.22%、Bulk97.04%、Summary97.06%、Furusato97.98%のBranchを確認した。これは部分診断であり、Auth/Budget/Settingsの変更後原本は未計測と明示する。原本の異なる過去カウンタは再利用していない。

予算では実保存後のrenderがdraftを交換して後続のrefreshを失効させる製品不具合を捕捉し、保存draftと描画ownerの寿命を分離した。追加試験の初回は非activeのFuruを待つfixture誤りを含み、常時実行するMaintenanceへ補正後、旧候補で4RED・是正後8GREENを確認した。さらに独立レビューで未commit保存失敗の表示区分を指摘され、実native write abortを先行REDで追加した。committedをDB正常resolve後だけ更新する修正後は関連23/23成功・限定Phase5 PASSである。

秘密鍵のメモリ同一性だけでは、鍵再生成commit後・API応答前のPIN変更を守れないこともnative probeで再現した。変更成功したPINの巻戻りと公開鍵/復号秘密鍵不一致を防ぐため、[認証設計](../auth_session_lifecycle.md)へ戻し、security_keysの期待値と存在を同一readwrite transaction内で比較して全更新/削除を原子的に確定する設計を検証している。廃止済みsynced_passkey_bundleの再導入や暗号形式変更は行わない。全原本を固定した次の4層実行・変更後性能測定・最終独立Phase5・コミットは未完了である。

設定入口・ポイント保存・optional APIの追加20葉は、独立Phase3で認証世代の誤参照を指摘された。Coordinatorには存在しないfieldのundefined比較を、実authController.authGenerationと事前integer必須assertへ改め、全rawのキー/値とともに20/20成功した（`/tmp/yose67-settings-contracts-reviewed.log`）。componentイベントのisTrusted=falseと利用者のnative操作を分離し、任意API不提供モデルでは実reload後の全store保持を検査した。独立Phase3 PASS後、承認済みのtypeof window2箇所・同期config再guard1箇所だけを整理し、限定Phase5 PASSを得た。

その後の設定/ポイント関連65葉は64成功・1失敗であった（`/tmp/yose67-settings-cleanup-regression.log`）。既存の年間予算試験が設定タブ遷移後のrenderを待たず、disabledの自動計算buttonを押していた。readyBudget67と実save/render/Summaryの委譲Promise待ちへ補強し、実draft24000円・費目12000円、DB24000円、年度identityを追加assertした。選択した同case1/1成功・独立Phase3 PASSであり、初回65葉の失敗は保持して関連全体を再実行する。

補強後の同関連65葉は65/65成功・skip/cancel0である（`/tmp/yose67-settings-cleanup-reviewed.log`）。CAS/IndexedDBモデル変更後は54原本の前後hashを照合して `/tmp/yose67-node-candidate-reqVwf` に固定し、単体・結合・システム全1804/1804成功・skip/cancel0を確認した（`/tmp/yose67-node-snapshot-all.log`）。この候補は後続のWebAuthn解除入口とCoordinator/Status補完前であり、最終4層受入とは呼ばない。

次の固定UI候補 `/tmp/yose67-settings-candidate-Nnn7Qx` の全体は1132葉中1115成功・2失敗・15取消・skip0である（`/tmp/yose67-settings-snapshot-ui.log`）。1失敗は認証失効errorを旧文言だけで照合していたfixtureで、実write到達/全rawの取消保持を先にassertしてからerror分類を補強し、6/6成功・独立Phase3 PASSとなった。もう1失敗とheadless suiteの15取消は初期readyの5秒期限で発生した。Node全層の並行実行負荷があったため、同原本・同計測・試験無変更で2fileを順次再実行し20/20成功した（`/tmp/yose67-settings-snapshot-isolation.log`）。起動負荷境界として記録し、元全体のNG/取消は保持する。最終4層は他runtimeを停止し、公式scriptのNode→UI順で行う。

この終端と同hash/mapの過去証拠のみを標準合算した部分診断では48/54ファイルが各97%以上となった（`/tmp/yose67-combined-current-diagnostic.json`）。残りはAuth/Settings/Coordinator/SyncStatus/Sync/YoseDBである。YoseDBはUI側が変更前hashであり、最新hashの既存41UIを再計測してLine99.83%/Branch97.56%へ到達した。対象sourceを除外せず、未採取と実未通過を区別する。後続source変更後の値として転用しない。

設定の追加await16葉は13成功・3失敗から再入した。失敗3件は実lock操作自身の正当な通知まで0と期待したfixtureであり、ロック通知1件だけ許容し旧設定fault通知は0とする補強後16/16成功・独立Phase3 PASSである（`/tmp/yose67-settings-await-reviewed.log`）。暗号export/期待鍵取得・実GAS commit・432円取込と新file busy・描画子処理・native登録解除・Promise例外伝播を検査した。catch内のvalid再検査はmicrotask間の認証失効で到達するため維持する。最新Settings原本の固定計測を別途実施する。

## 最終固定原本の受入

全担当の本番・試験編集と別runtimeを停止し、入力420ファイルを `/tmp/yose67-release-input-manifest.json` に固定した。最新の同期内部既定整理後の11原本で性能を再測定し、単一編集694ms・無変更同期1860ms・並行2編集1370ms、明細put1/0/2・clear全0・CAS再試行1・pageErrors空を確認した。測定前後の11原本は一致する（`/tmp/yose67-performance-release.log`、`/tmp/yose67-performance-release-source-manifest.json`）。実GAS/回線・UI再描画を含まない各1回の局所測定である。

公式 `npm run test:coverage` は終了値0である。静的検査全成功、単体・結合・システム1811/1811、実Chromium UI1206/1206が成功し、失敗・取消・skipは全て0である。全体Line99.79%・Branch97.94%、本番54ファイル全てで各Line/Branch97%以上となった。途中の別原本カウンタを混ぜず、この1回の公式実行だけで受入を判定した。証拠は `/tmp/yose-coverage-nprjDm`、ログは `/tmp/yose67-coverage-release.log`、各ファイル値と54原本SHAは[最終カバレッジ](review67_coverage.md)に保存した。

入力420ファイルは開始前・終了直後で不一致0である。test_auditorは既存の総合コード/試験レビューPASSに加え、公式54原本・報告54原本・性能11原本・入力420のSHA、全1305 raw chunkの標準hash/map/counter検証、全54の閾値・合計算術・記録表を独立再確認した。追加指摘なしで総合Phase5 PASSを受領し、全受入条件を満たした。総合判定はGrade A+である。以降の追記は結果文書のみとし、本番・試験・計測scriptは変更しない。

Phase6は英語のローカルコミットと日本語[PR草案](review67_pr.md)の確定を対象とする。push・PR作成・merge・deployは実施していない。GAS変更を利用環境へ反映するには再デプロイが必要である。実GAS/実回線・OSパスキー・実機PWA配信は本ローカル受入の保証範囲外である。
