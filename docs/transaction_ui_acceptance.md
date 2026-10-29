# 明細UIの受入観点と不要分岐の整理

本書はR/E/I-3.67〜3.69とreview67の明細UI受入設計である。統合実行aYxefHでは明細一括編集・個別編集・登録・一覧の分岐網羅が97%に達していない。分岐を通すためのbusy/認証/金融状態の捏造は行わず、実操作・API契約・実await失効・明示的な依存故障を検査する。

## 静的に証明する整理対象

| 対象 | producer・全callerの根拠 | 整理内容 |
| --- | --- | --- |
| Listの粒度・年・日・月 | Coordinator constructor:33–38が全fieldを非空初期化する。Summaryの粒度/期間変更は有効な選択肢だけを反映し、selectedDateは同書の既存producer証明に従う | analyticsGranularity/selectedYear/selectedDate/currentMonthの未設定fallbackを除去する |
| Listのrender generation | renderMonthTransactionsのvalidはsessionValidと_renderGeneration一致を含む | 各await後のvalidと同じgeneration/key/lockedの再比較を重ねない。sortは外部callback/awaitを呼ばない同期comparatorを用いるため、その前後の連続した重複valid検査も除去する |
| Editの分類同期4要素 | index.htmlのedit-tx-category/edit-tx-subcategory/edit-tx-actual-category/edit-tx-actual-subcategoryは同版常設であり、syncActualClassificationの固定2組だけが参照する | source/target存在guardを除去する。同期するcheckboxの状態分岐は維持する |
| Inputの種別value | index.html:102–110の常設selectはexpense/income/transfer/advance/repay/prepaid/pointの7値を持つ。mode変更は同7非空値を代入し、optionを削除しない | currentTypeとmode切替後のtypeSelect.valueにexpense fallbackを重ねない |
| Inputの費目value | replaceOptionsKeepingSelection後は有効な先頭optionか保持した以前optionを選ぶ。activeCategoriesが空ならselect.valueは空であり、先頭候補も存在しない | catSelect.value/actCatSelect.valueからactiveCategories[0]/空文字への二重fallbackを除去する。空費目/アーカイブ保持の表示契約は維持する |
| Inputの電卓式 | constructorとclear/単一文字backspaceは'0'、openはtrim後の空値を'0'へ変換する。数字/演算子の挿入は非空文字を追加し、複数文字backspaceは1文字以上を残す。equals/taxは有限resultをStringへ変換する | 初期化後のupdate/display/evaluateに重複するcalcCurrentExprの空fallbackを除去する。open入力の空欄fallbackは維持する |
| Inputの電卓ボタン | index.html:1118–1146の全calc-btnはinsert、clear、backspace、equals、4種taxのいずれかである。setupTaxModalだけがこれらへclick処理を付け、ボタン構成は動的変更しない | insert/action各分岐の後に残るボタンはtaxであるため最後のtax属性有無guardを除去する |

削除済みID・旧master collection不足・任意tags/created_at・category.type省略・未分類・旧advance_payment・エラー・認証/operation失効・ブラウザ表示/API差異は有効状態として維持する。これらを静的HTML証明と混同しない。

## 追加の具体的検査

- 一括編集は、実保存中のpublic再入/選択解除を拒否し、選択/原本/disabledを維持する。空分類・空タグの明示変更を実保存し、archive内訳を勝手に書き換えない。
- 一括openの現認証読取故障と旧認証故障、保存済みrefresh故障と再認証、削除読取/commit後の再認証は、通知・新UI・全rawと確定済み結果を照合する。
- 個別editは、最初の明細読取、group/master、計上内訳、実態内訳、候補読取の各実応答を保留し、再認証後の新editorを旧応答が変更しないことを検査する。各種別変更の現認証故障/旧故障、保存中の再入/close拒否も検査する。
- 個別保存/削除は、実DBからの行消失・関連前払変更を別の正規操作で作り、CAS拒否と全raw保持を検査する。未commitとcommit済み応答の失効を区別し、保存後の旧refresh/通知を止める。
- 登録dropdownの各awaitは、実lock/PIN解除またはnative鍵再生成で開始元だけを失効させ、新たな種別/費目/入力を保持する。アカウント/費目collectionのない受理済み旧master、アーカイブ選択保持、空費目、default公開呼出を対照とする。
- 立替精算は正規元行を別の操作で削除/精算済みにし、再確認時の拒否とraw不変を検査する。ゼロ額・未入力・前払期間省略の既存入力契約も明示的なAPI/フォーム検証で区別する。
- 一覧はdefault引数、削除済み履歴/空タグ/未分類、予定の同時確定/一括busyによる実disabled、各期間の読取失効、pagination公開境界を検査する。pointer/visibilityは実ブラウザイベントで検査し、document.hiddenを書き換えない。

認証境界・busy所有権の共通契約は[非同期操作設計](async_session_boundaries.md)に従う。テストで実Promise完了と開始draft/対象ID/ready状態を待ち、全gateはfinallyで解放する。

## 立替の一覧精算の認証寿命

横展開の静的点検で、handleSettleAdvanceDirectly/settleAdvanceに開始元認証の捕捉がなく、各読取後の現鍵を使ってlinkAdvanceRepaymentを開始する経路を確認した。旧catch/finally・commit後通知・refresh後の同期開始にも親がない。実読取・実commit後応答を再認証が跨ぐ先行で、保存漏れと旧完了作用を分けて確定させる。

一覧精算も最初のawait前に認証・入力先口座と操作ownerを捕捉する。既存settleBusyの公開排他状態は維持し、operation object identityで同じcontrollerの精算ownerを区別する。cancelPendingOperationsは精算ownerとbusyを同期解除し、新認証の精算を妨げない。旧catch/finallyは新ownerのbusyや通知に作用しない。通常の登録submitOperationとは独立させる。

settleAdvanceは任意options.isSessionValidを受け、親省略の既存呼出も入口で認証を捕捉する。各DB読取・承認・実link commitの同じ親を検査し、DB options.isSessionValidまで伝播する。実commit後は保存済みrawを維持し、旧通知/refresh/同期を停止する。現認証の表示故障は保存済みと未保存を区別して通知する。

正常完了は他の明細保存と同じrefreshAfterTransactionChange({isSessionValid})へ統一し、二重のrefreshAllViews＋独自syncPendingDiffsを重ねない。閉鎖月の再締め/送信を背景taskへ集約する既存契約を適用する。元立替の参照条件・精算済み/金額未入力の拒否・CAS・返済額と受取口座の金融条件は変更しない。

先行では実native回収一覧から開始し、元明細/関連明細/master/承認/実linkの前後/表示応答を保留する。実lock/PIN解除後に新入力/新精算を開始してから旧応答を解放し、全raw・リンク件数・通知・新busyを直接assertする。正常精算、現在の故障、承認取消、既に消失/削除/精算済みの元行と金額0/未入力を対照とする。新ownerを内部フラグの代入で捏造しない。

YoseDB.linkAdvanceRepayment(source,repayment,options)の既存第3optionsへ任意isSessionValidを追加し、mutateBusinessへ同じ親を合成する。旧approvedMonths/createと省略呼出は互換であり、pluralのlinkAdvanceRepaymentsと混同しない。先行は親false開始時の読取/transaction0、同一DB鍵と鍵世代で実AES待機中に親だけが失効した場合の原子的raw保持、従来呼出の正常リンクを検査する。

## 一覧のfilter producerと残観点

populateFilterDropdownsより前のcurrentAcc/currentCat/currentTagの空fallbackは維持する。古い口座/費目/タグのdrilldownを、最新DBでは当該選択肢が消失した状態で処理すると、select.valueが一時的に空になり得るためである。public applyDrilldownFilterのIDが最新master/明細に存在しない場合は、既存どおりallへ戻す。

一方、その直後のfilter criteria生成ではpopulateFilterDropdownsが口座/費目/タグを必ず存在する選択肢またはallへ設定し、その間にawait/callbackがない。状態selectはindex.html:544のall/confirmed/plannedが固定で他に値を代入するcallerがなく、収支selectはindex.html:543のall/income/expense/transferとSummaryの同domainのtypeだけが代入する。このcriteria側の5つのvalue || 'all'は不要である。HTML optionが消失した状態を正常な構成として試験しない。

populateFilterDropdownsの同一txsは最初のfor-ofで既にArrayとして使用し、唯一production callerはYoseDB.getTransactionsの配列を渡す。省略引数も既存=[]で配列になる。後段tag loopのtxs || []は重複であり削除する。default引数と任意master collection/空tagの契約は維持する。

先行では古いdrilldownの3種IDが最新候補にない場合のall復旧・実明細保持、同日の作成日時を省略した有効なremote明細の受信と一覧、各期間読取後の再認証・日付月収入軸の実態選択、実native hidden/visibleイベントによるpointer待機解放、確定commit後の再認証を検査する。これらは未検証のブラウザ境界/合法データ/API契約であり、内部filter/page/hiddenフラグを捏造しない。

個別編集の追加対照では、categories collection自体を省略した正規masterと未分類明細を用い、空の費目/内訳表示とraw非補完を検査する。category.type省略は現行新規保存のvalidatorが拒否するため、正規mutation成功のfixtureとは呼ばない。既存readerのexpense補完互換を検査する場合に限り、既存のlegacy fixture方針に従って実暗号化した旧形状をraw storage APIで設置し、読み取り後の全raw不変と表示を検査する。現行書込validationを緩和しない。

前払groupの別明細memo変更は正規writerで作り、旧editor保存を全体拒否する。group読取中の認証失効と、実保存中のpublic open/close再入は別に検査し、元の金融raw/新draft/busyと実Promise終端を比較する。
