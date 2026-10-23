# 1.13.0 パスキー解除・日本語種別・既存立替回収の改善

## Phase 1・2 設計

最新origin/main（7cb5fcb）から `feature/passkey-unlock-and-advance-link` を作成した。要件3.49、外部E-3.49/E-5.2.1、内部I-3.49と監査計画を実装前に更新した。

独立レビュワー `auth_review` の認証設計判定はPASSである。`settlement_review` の初回指摘は、旧精算済みの補完リンク後の回収削除と、収入変換先が同一/アーカイブ口座になる条件であった。Phase 1へ戻り、補完時の参照管理への移行、候補/DB両方での口座検査、テスト計画を更新した。Phase 2再レビューはPASSである。

## 変更前の基準測定

`npm test` は743件合格、失敗/skip 0件である。Nodeの全体Line 99.40%、Branch 91.06%であり、既存段階で全対象ファイル各97%以上の数値ゲートは未達である。UIコードとSWのブラウザカバレッジはこの測定には含まれない。証拠は `/tmp/yose55-baseline-node.log` である。

## Phase 3 先行テスト

単体・結合・システム・実Chromium UIの4層へ先行テストを追加した。実装前の単体31件中30件失敗、結合/システム5件中4件失敗、主要UI4件全失敗を記録し、未対応を再現した。証拠は `/tmp/yose55-red-unit.log`、`/tmp/yose55-red-integration.log`、`/tmp/yose55-red-ui.log` である。

独立テストレビューの指摘に従い、遅延認証中の再ロック/登録解除、復号可能な異DMK/異署名鍵、登録途中取消/保存失敗後の旧パスキー解除、両原本競合・二重参照・未取得参照・旧精算移行・暗号化保存失敗・過去月承認取消を補った。`auth_review`、`settlement_review` の再レビューはいずれもPASSである。

## Phase 1〜5への手戻り

- 再登録で同じuser handleを使うと認証器が旧パスキーを置換する点を独立コードレビューで検出した。Phase 1へ戻り、credentialごとの乱数handle、失敗時の旧パスキー維持を設計した。旧パスキーでの実解除とhandle不一致をテストし、設計/テスト再レビューはいずれもPASSである。
- 鍵生成のコミット直後にロックされるとメモリ公開鍵が古くなる点を検出した。保存公開鍵を解除ごとに再読込し、鍵束/公開鍵/PRF失効を原子的に保存する設計へ戻った。コミット直後ロックからのPIN復旧UIを追加し、設計/テスト再レビューはいずれもPASSである。
- 旧settled元の同額日時競合で回収だけ受理される点を検出した。旧settledと有効参照の併存を整合違反とし、全バッチ拒否のREDを確認した。外側口座の変更は立替方向/同額/確定を保つ通常編集として許可し、関係破壊は拒否する設計へ整理した。設計/テスト再レビューはいずれもPASSである。
- 一覧再描画中の即再編集でリンクモーダルが開かない競合を全UIから検出した。Phase 3へ戻り、再描画保留中のmodal保持と即再オープン、保存済み後の再描画失敗の区別を追加してREDを確認した。テスト再レビューはPASSである。さらに再ロック解除後の別明細編集を旧refresh完了が閉じるREDを確認し、操作世代/認証鍵の照合とロック時の失効を追加した。再レビューはPASSである。
- PIN変更の保存直後ロックでisKeyLockedだけが解除中へ戻る点を独立コードレビューから再現した。Phase 3へ戻り実設定イベントのREDを確認し、冗長なロック状態代入を除去した。テスト/コード再レビューはPASSである。
- 旧retroactive_updateの通信を期待するテストは、過去月承認・旧月保持・未同期保持・再送・ACK時再編集のassertを維持して単一push_diffへ更新した。PIN変更/再生成テストは開始confirmと成功alertを区別し、reloadは新documentと認証画面初期化完了を待つ。

## Phase 4 実装

PRFからHKDF/AES-GCMで鍵束をラップし、既存PIN復旧を残した。回収側のadvance_source_idを唯一の関係とし、両側UI・明示した収入変換・原本比較/原子保存・共有validator・GASの単一バッチ同期へ統合した。到達不能のcurrentSettlingAdvanceId分岐を削除した。版はMinorの1.13.0とし、5箇所・lockfile・PWAキャッシュ資産を同期した。構文/型検査は修正直後に実行して合格した。

## 計測基盤拡充前のPhase 5検証

当該時点のコードについて、`auth_review` と `settlement_review` の独立再レビューはいずれもPASSである。

| 検証 | 当時の結果 | 証拠 |
| --- | --- | --- |
| npm test（静的検査・単体・結合・システム） | 782件/98スイート合格、失敗/skip/cancel 0件である。 | `/tmp/yose55-release-node.log` |
| npm run test:ui（実Chromium） | 331件/22スイート合格、失敗/skip/cancel 0件である。 | `/tmp/yose55-release-ui.log` |
| lint:indent / check:syntax / check:types / check:gas-integrity | TAB 115ファイル、JS 107/GAS 1/JSON 5/Mermaid 82の構文、型、GAS埋込生成整合が合格である。 | npm testの先行lintと最終静的検査である。 |
| git diff --check | 合格である。 | 最終差分検査である。 |

全UIの初回最終実行は328件中327件合格、手動同期1件失敗であった。原因は設定URLの古い再描画による入力値上書きであり、単独合格で帳消しにはしなかった。Phase 1へ戻ってE-4.5/I-3.49を更新し、遅い読取の保存前/後と、保存提出後の別入力の計3ケースを追加してすべてREDを確認した。dirty/世代・保存二重送信抑止を実装し、設計/テスト/コード各再レビューPASS、関連4件合格後に全331件を再実行して合格した。証拠は `/tmp/yose55-final-ui.log`、`/tmp/yose55-red-url-render-corrected.log`、`/tmp/yose55-url-green.log` である。

### 数値ゲートと最終受入

Node集計はLine99.22%・Branch91.31%である。新規純粋ロジック `advance_links.js` はLine/Branchとも100%であるが、次の例を含め全対象各97%以上の基準は未達である。

| 対象 | Line | Branch |
| --- | ---: | ---: |
| gas/Code.gs | 99.13% | 91.44% |
| js/crypto.js | 99.63% | 96.70% |
| js/db/storage_engine.js | 90.43% | 91.94% |
| js/db/yose_db.js | 99.64% | 89.75% |
| js/logic/advance_links.js | 100% | 100% |
| js/logic/data_integrity.js | 100% | 93.79% |
| js/sync.js | 98.94% | 90.73% |
| js/webauthn.js | 100% | 70.00% |

変更前も未達であったが、今回追加のIDB/認証UI経路もNodeの数値測定で網羅したとは扱わない。ブラウザUIとSWのソースカバレッジは本測定に含まれない。値を満たすための除外・skip・閾値緩和は行っていない。

この時点でも最終受入ゲートは未達であり、Phase 3へ戻った。Grade A+・最終受入完了とは判定せず、Phase 6のコミット・push・リモートPR発行は行っていない。PRタイトル/本文草案は[review55_pr.md](review55_pr.md)へ格納した。GASは未配備であり、反映時は過去月バッチ対応のGASを先行更新する。

## 数値ゲート不合格からの再入と計測基盤

全対象各97%以上の免除規定がないことを独立受入監査で確認し、Phase 1/3へ戻った。I-3.49と監査計画を先行更新した。`auth_review` は認証境界の設計/先行試験/実装を、`settlement_review` は全原本計測の設計/先行試験/実装を独立レビューし、各再入後の判定はPASSである。

- RSA実署名、DER不正構造、通常/旧credential、PRF結果の欠損/長さ、非対応Web Cryptoを公開APIから補った。ES Modulesで到達不能のglobalThis不存在fallbackを削除した。canonical JSONの疎配列が不正JSONになるREDを確認し、client/GASをArray.fromへ統一した。証拠は `/tmp/yose55-boundaries-red.log`、`/tmp/yose55-canonical-gas-red.log` である。
- SW原本のinstall/activate/message/fetchをVMのサービス境界fixtureで検証した。fetchが返さないnullを作るテストを独立レビューで退け、実Responseと通信拒否を用いた。到達不能のnull応答防御を除去した。テーマ初期化は同じhead位置の同期JSへ抽出し、保存優先/OS追従/非対応media/保存拒否を検証し、SW資産も更新した。
- 最初のCDP/V8方式はNode839件合格・UI335件中330件合格であった。4件は遷移時の詳細Profiler欠落、1件は前払子明細の非同期open待機不足である。後者はactive/対象ID/金額/submit可視を待ち、本来の金額再配分/単独編集assertを保持した。詳細欠落を捨てて数値成功にはしなかった。Chromeが遷移中のdebugger停止を抑止するため、この集計方式を最終受入から外した。
- 最終方式はNode同期module hook、CDPテスト配信、SW/theme VMのすべてに同じIstanbul counterを挿入するものである。本番原本に計測コードを保存しない。原本SHA-256・位置map・counterを検証し、全対象の0初期化と標準merge/reportを行う。pagehideは同期sessionStorage退避後に次documentで回収し、別origin離脱時は本番コードを持たない空HTMLで回収する。
- 計測例外を握り潰す指摘と、ブラウザ側のzero省略が不正記録を隠す指摘を独立レビューで検出し、その都度Phase 3へ戻った。例外伝播、全記録検証後だけのzero保存省略へ修正した。raw契約5件と、実Node/Chrome統合・reload・BFCache・pagehide・別origin・例外・不正zero記録を含む収集器16件は合格である。証拠は `/tmp/yose55-coverage-pruning-green.log`、`/tmp/yose55-coverage-final-pipeline.log` である。

途中で中断したIstanbul全体測定は受入成功として扱わない。設定準備式のObject.definePropertyがwindowを返してCDPシリアライズに失敗した2ケースは、式末尾をvoidに修正し、プロダクト不具合のREDと混同しない。最終計測器の独立コード再レビューは `settlement_review` のPASSである。

### 認証背景操作と旧解除経路の是正

カバレッジ監査で、認証画面の表示中にもTab操作が背景の同期ボタンへ到達することを確認した。全画面認証と旧PINモーダルの併存を整理するため、Phase 1へ戻ってR-3.49/E-4.4/I-3.49を更新した。初期設定・手動ロック・再起動・BFCache相当の復帰の4ケースを先行追加し、すべてREDを確認した。証拠は `/tmp/yose55-auth-background-red.log` である。

初期化直後から認証画面をモーダルガードの最上位とし、背景inert、Tab/Shift+Tabの認証内循環、Escapeによる保持を実装した。旧PINモーダル、設定の旧解除ボタン、関連関数/CSSを削除した。認証を必要とする操作は全画面解除へ案内する。`auth_review` の設計・テスト・実装再レビューはPASSである。認証背景4件とPRF15件は合計19件合格し、立替14件を加えた関連33件も合格した。証拠は `/tmp/yose55-auth-gate-green.log`、`/tmp/yose55-auth-gate-feature.log` である。

### 計測記録の永続化と遷移競合の是正

Istanbulの全体測定ではNode844件合格に対し、UI347件中342件合格・5件失敗であった。5件はいずれもreload時のCDP実行context破棄であり、テスト成功や計測成功として扱わない。証拠は `/tmp/yose55-coverage-release.log` である。

Phase 1/3へ戻り、各スナップショットのsessionStorage退避・チャンクID・保存後ACK・未ACK再送・内容hashによる重複検出を設計/検証した。保存前後の応答消失でも計数を失わず、再送を二重加算しない。文書遷移に伴う再試行は、CDPプロトコルエラー型と既知のcontext破棄メッセージの両方が一致する場合だけに限定した。JavaScript例外は同一メッセージでも即座に失敗とする。待機条件の読取と収集のみが再試行対象であり、ユーザー操作は再実行しない。

raw検証5件と、実Node/Chromiumの収集器26件が合格した。収集器には保存/ACK消失・再送重複・異なる内容の同一ID・JavaScript例外とプロトコル例外の区別を含む。証拠は `/tmp/yose55-coverage-pruning-green.log`、`/tmp/yose55-coverage-exception-green.log` である。全4層の最新測定結果と最終受入は、これらの関連試験とは別に判定する。

`settlement_review` による最新のPhase 5局所コードレビューもPASSであり、担当範囲の計測器・立替機能の既報コード指摘は解消済みである。これは全対象各97%以上の総合受入とは区別する。`auth_review` は今回要求範囲とアーカイブ明細文言を再確認し、追加の機能不具合を検出しなかった。外部設計の型表に旧settlement_statusの説明が残る指摘を受け、E-5.2.1に揃えて旧履歴・新規回収参照・補完移行を明記し、advance_source_id欄を追加した。文書整合の再レビューはPASSである。

### 通常操作時の計測負荷の是正

次の全体実行はNode844件合格、UI361件中339件合格・22件cancel・fail/skip 0件であった。editor_usability、master_modal_navigation、settings_workflows、transaction_workflowsの4スイートが120秒上限へ達した。終了処理も待機したため中断し、終了コード130であった。受入成功や全テスト合格とは扱わない。証拠は `/tmp/yose55-current-coverage.log` である。原本manifestと一致した生記録から参考レポートを別途生成し、Line96.16%/Branch82.34%であった。未完了実行の参考値であり、最終受入の数値ではない。証拠は `/tmp/yose55-current-coverage-report.log`、`/tmp/yose55-interrupted-report/` である。

各Runtime.evaluate/Input提出前に全原本counterを複製・永続化・検証する不要な処理を検出し、Phase 1へ戻った。同documentでは累積し、navigate/reload前・pagehide・明示flush・closeで退避する契約へ設計を統一した。listener末尾再配置、原本/全記録検証、ACK再送・重複検出は保持する。設計レビューの旧記述矛盾を是正して再承認を得た。

先行ケースは読取40回に加え、独立テストレビューで指摘された実クリック/キー入力各20回も含む。どちらも不要なraw保存の増加をREDで検出し、close後に全40呼出と両分岐を一度だけ回収することをassertした。証拠は `/tmp/yose55-collector-cost-red.log` である。変更後は収集器28件合格、`settlement_review` のPhase 2/3/5再レビューはいずれもPASSである。証拠は `/tmp/yose55-collector-cost-green.log` である。

上限を変更せず4スイートを再実行すると101件中100件合格、cancel 0件となり、約56秒で終了した。前払再表示の1件は別の未解決失敗として診断を追加し、単独合格で全体NGを取り消さない。証拠は `/tmp/yose55-collector-long-green.log`、`/tmp/yose55-prepaid-probe.log` である。

### 公開ロジックの追加検証と不要分岐整理

Phase 1へ公開入力契約を追記し、日付の既定値、マスタ省略一覧・不正移行先、生成された競合/古い解決情報の拒否、所有禁止キーの予算除外・実明細優先・0円境界を先行検証した。独立テストレビューで費目種別欠損を正常移行として固定する試験を退け、正規のexpenseへ修正した。UUIDは能力欠損のみを模擬し、乱数や時刻の出力は差し替えない。

存在確認後の移行元collectionフォールバック、ES ModulesのglobalThis不存在分岐、生成済み競合経路の私有取得で到達しない親欠損フォールバックを除去した。公開decoderの古いパス拒否は維持した。`auth_review` のPhase 2/3/5再レビューはPASSである。追加29件を含むNode全3層873件が合格し、その後追加した0円境界を含む対象30件も合格した。証拠は `/tmp/yose55-public-logic-node.log`、`/tmp/yose55-public-logic-zero-green.log` である。

### 計測負荷是正後の全体実行

`npm run test:coverage`で静的検査、Node全3層874件、実Chromium UI363件がすべて合格した。fail/cancel/skipは0件である。原本39ファイルを漏れなく統合し、全体Line96.33%/Branch83.21%、各97%未達は26ファイルであった。日付・マスタ移行・マスタ競合・予算の4モジュールはLine100%、Branchは順に100%/97.43%/100%/98.12%であった。証拠は `/tmp/yose55-coverage-after-cost.log`、`/tmp/yose-coverage-KkyeNa/`、`coverage/execution.json` である。

これは一覧ポインタ競合の是正前の記録である。独立調査では実保存後のrenderSummaryを保留し、行押下→実一覧再描画→同座標解放の順序でoldRowDetached:true、rowClicks:0、modalActive:falseを確定再現した。既存の通常実行で当該1件が合格しても、不具合解消とは扱わない。E-3.49/I-3.49へ戻り、ポインタ操作とDOM適用の設計/先行試験を追加する。全対象各97%の数値ゲートとこの未解決不具合のため、総合受入・Phase 6には進めない。

### 一覧ポインタ競合の是正

最近/期間一覧ごとのポインタIDを追跡し、pointerup/cancel後の次taskまでDOM置換を保留する設計とした。複数pointer・再押下・一覧外解放・blur/非活性・認証失効を扱い、待機後に独立した描画世代・鍵・ロック状態を検査する。削除済みの旧行から編集画面を開かない。

`auth_review` のPhase 2では両一覧/空表示、windowでの解放捕捉、次taskでの再押下、認証と世代の再確認、実クリック保持、待機中の原本変更を補った。Phase 3では非同期openの完了観測、最近一覧の旧結果後着、再押下timer、空結果への更新を追加した。最初の試験準備でgateのPromiseをevaluateのcompletion valueとして返していた点はvoidへ修正し、そのログを製品REDとは扱わない。

修正後の先行16件は旧実装で3件合格・13件失敗となり、実DOM置換による不具合を捕捉した。実装後は16件すべて合格、fail/cancel/skip 0件である。証拠は `/tmp/yose55-list-pointer-red-final.log`、`/tmp/yose55-list-pointer-green.log` である。金融データや読取値を偽造せず、実IndexedDBの最後の読取を保留して実mouse/touchの順序を固定した。`auth_review` のPhase 2/3/5各再レビューはPASSであり、独立の正常touchEnd確認でも旧行保持と正しいIDの編集を確認した。構文/型/TAB/GAS整合検査も合格した。

## 最新ソースの全体検証と残る受入条件

一覧ポインタ・遅延ひも付け取消・鍵通知是正後の`npm run test:coverage`では、静的検査とNode107スイート874件・実Chromium UI26スイート383件がすべて合格した。fail/cancel/skipは0件である。TAB127ファイル、JS119/GAS1/JSON5/Mermaid83の構文、型、GAS共有validator生成整合、`git diff --check`も合格した。証拠は `/tmp/yose55-coverage-cancel-final.log` である。

原本39ファイルをmanifest/hash/位置mapと照合して統合し、全体Line96.35%/Branch83.29%であった。生記録は `/tmp/yose-coverage-hCxWGE/`、HTML/JSONは `coverage/`、実行状態は `coverage/execution.json` でnodePassed/uiPassedともtrueである。ただし次の26原本が各Line/Branch97%以上を満たさず、コマンドの終了コードは1であった。

| 原本 | Line | Branch |
| --- | ---: | ---: |
| gas/Code.gs | 98.23% | 84.21% |
| js/app.js | 81.81% | 50% |
| js/sync.js | 98.55% | 88.58% |
| js/version.js | 100% | 92.64% |
| js/db/backup_merger.js | 99.41% | 91.09% |
| js/db/backup_replacement.js | 100% | 74.07% |
| js/db/storage_engine.js | 97.64% | 78.4% |
| js/db/yose_db.js | 99.59% | 90.44% |
| js/logic/aggregator.js | 100% | 90.57% |
| js/logic/data_integrity.js | 100% | 93.71% |
| js/logic/transaction_factory.js | 100% | 94.49% |
| js/ui/advance_link_controller.js | 100% | 82.6% |
| js/ui/auth_controller.js | 99.4% | 86.31% |
| js/ui/backup_import_controller.js | 100% | 80.32% |
| js/ui/chart_controller.js | 84.53% | 59.72% |
| js/ui/coordinator.js | 88.46% | 83.56% |
| js/ui/maintenance_controller.js | 97.39% | 81.33% |
| js/ui/master_conflict_controller.js | 100% | 85.24% |
| js/ui/master_controller.js | 90.64% | 78.85% |
| js/ui/settings_controller.js | 86.66% | 67.47% |
| js/ui/summary_controller.js | 93.72% | 64.81% |
| js/ui/sync_status_controller.js | 95.52% | 75.67% |
| js/ui/tag_memo_input.js | 100% | 74.24% |
| js/ui/tx_edit_controller.js | 99.2% | 81.72% |
| js/ui/tx_input_controller.js | 96.94% | 72.23% |
| js/ui/tx_list_controller.js | 99.45% | 74.74% |

今回変更したUIも未達に含まれるため、既存の不足だけとして免除しない。開発プロセス定義書1.7/Phase 5の基準を満たしたとの判定やGrade A+の総合受入は行わない。その後のユーザー指定によるローカルコミット先行は末尾に記録する。push・リモートPR発行・GAS配備は行っていない。

`settlement_review` が最終の取消是正後ログとexecution、原本/manifest/両JSONレポート各39件の集合、現在原本とのSHA-256差異0、全位置mapと標準Istanbul再集計値、全体率と未達26件を独立照合し、上記結果との一致を確認した。局所コードレビューPASSと総合受入未達を区別する記録は妥当と判定された。

### 既存領域の追加監査候補

全原本の不足観点監査を`auth_review`、`settlement_review`、`coverage_ui_review`へ依頼した。以下は今回の機能改修とは別に設計・再現が必要な候補であり、この記録だけで修正済み・確定再現済みとは扱わない。

- マスタ一覧表示後の対象/親削除とモーダル読込が競合すると、旧itemへのフォールバックによって再作成や不正な成功表示へ進む可能性がある。実DBの削除競合を先行再現し、対象消失時の拒否を設計する必要がある。
- タグ/クロス集計で予定表示設定が集計引数へ伝播しない経路がある。確定100円・予定200円を同じ分類/タグで保存し、予定OFF時に100円になる実UIの先行試験が必要である。
- クリップボード書込の完了前に成功通知する経路がある。実APIの拒否時に成功を表示せず、例外を処理する先行試験と非同期完了条件の設計が必要である。鍵再生成のPIN取消/誤PIN時の誤成功通知は、後述の追加是正で解消した。
- 外部資産のKPIと内訳でamount/market_value/current_valueの優先順位が異なる。複数フィールドを持つ正規snapshotの正本値を設計し、同一原本のKPI・内訳一致を先行確認する必要がある。
- 未使用の外部資産描画メソッド/Chart破棄メソッド、静的HTMLに必ず存在する要素の欠損ガード、必須DIや現行集計戻り値に対する旧互換フォールバックは、呼出元と戻り契約を照合して不要性を判断する必要がある。存在しない状態の成功モックで数値を満たさない。

担当別の次の確認単位は以下である。これらは監査案であり、実装・実行済みと扱わない。

| 担当 | 未実施の確認・整理単位 |
| --- | --- |
| settlement_review | 実カード自動精算のpush_diff/close_monthと不正補助情報の原子拒否、完全取込のID/時刻/基点不一致、IDB request成功時の認証失効abort、取込種別判定・全原本保持である。新規Memory/DB_VERSION1/事前validator後の重複検査は、到達不能性を設計へ反映してから整理する。 |
| auth_review | 登録解除/再締め/解除取消、実メモ候補の収入分類、特殊モードの明示0拒否、予算の差額と空欄、鍵未登録時の生成とPIN復旧である。数値へ正規化済みの費目集計や電卓税情報の欠損fallbackは供給元契約から整理する。 |
| coverage_ui_review | 予定OFFのタグ/クロス、予算ペース・貯蓄率、日次/年次/予算/履歴のChart不在表示、保険/外部資産、祝日API、マスタ削除競合、import/競合取消中の世代、タグ候補の実キーボード操作である。静的要素/必須DI/未使用メソッドの根拠を確認して整理する。 |

2026-10-24のユーザー指定により、本件は今回の機能差分で区切り、既存全体の品質改善は別件へ切り分けた。上記の未達26原本には今回変更したUIも含まれる。数値と監査候補を後続作業の基点として保持し、97%ゲートを満たしたとの宣言は行わない。後続のローカルコミット先行指定を、総合受入やリモート公開の承認へ拡張しない。

### 編集終了後の遅延ひも付けと鍵通知の追加是正

独立監査で、実リンク候補読取を保留しEscapeで編集を閉じてから解放するとeditor:false/link:trueとなる不具合と、実鍵再生成のPIN取消で中止後に成功通知が出る不具合を再現した。これは機能範囲の是正として継続した。

Phase 1へ戻ってI-3.49の取消世代と通知責任を明記し、コミット前の原本維持とコミット後ロックのPIN復旧を区別する設計指摘を是正した。先行4件はEscape/取消からの遅延open完了と再リンク成功、PIN取消/誤PINでsecurity_keys原本保持・成功通知なし・旧PRF実解除をassertし、旧実装ですべて失敗した。証拠は `/tmp/yose55-cancel-link-red.log` である。

TxEdit.closeからAdvanceLink.cancelを呼び、候補読込/操作世代を失効させた。鍵生成の実結果を通知するAuthControllerへ責任を統一し、設定側の無条件重複成功通知を削除した。構文/型/diff検査が合格し、関連UI53件はfail/cancel/skip 0件で合格した。証拠は `/tmp/yose55-cancel-link-green.log` である。`auth_review` のPhase 2/3/5各再レビューはPASSである。全体再実行は上記「最新ソースの全体検証」に記録した。

## 作業範囲の確定（2026-10-24）

ユーザーは「今回の機能差分で区切り、既存全体の品質改善は別件にする」を選択した。本件の実装範囲は、PRF対応パスキーのPIN省略、明細種別の日本語化、既存立替回収の双方向ひも付け、および検証中に是正した関連する認証・保存・再描画・取消の不具合である。実装済みの計測基盤・先行試験・不要分岐整理も検証証跡とともに保持する。

全原本のカバレッジ改善と未変更領域の追加監査候補は、上記の一覧・担当別確認単位を引き継ぐ別件とする。今回の範囲確定を、97%達成・Grade A+・リモート公開の承認へ読み替えない。この時点ではコミット・push・リモートPR発行・GAS配備は未実施であり、PRタイトル/本文草案は[review55_pr.md](review55_pr.md)に保持する。

範囲確定に伴う今回の変更は記録文書のみである。874件/383件の合格は上記の最終実行記録であり、新たなテスト実行を意味しない。

## ローカルコミット先行の指定（2026-10-24）

ユーザーから「とりあえずcommitまでは済ませておいて」と明示指示を受けた。開発プロセス定義書の通常順序に対する今回限定の指示として、現在の機能差分・関連是正・検証基盤・記録を英語メッセージでローカルコミットする。全体カバレッジ改善の別件化と数値ゲート未達を維持し、Grade A+・最終受入・push・PR発行・配備の承認とは扱わない。

コミット前に本番原本39ファイルと前回全体試験のmanifestのSHA-256一致を再確認した。874件/383件は記録済みの合格結果として扱い、全テストを新たに実行したとの記載は行わない。
