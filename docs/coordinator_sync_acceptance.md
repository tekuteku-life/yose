# Coordinator / SyncStatus の受入補完

本書はR/E/I-3.13・3.24・3.39・3.68およびI-2の補完計画である。閾値、対象、計算式、ignore、計測counterは変更しない。記録済み標準診断 `/tmp/yose67-snapshot-diagnostic-current.json` の同hash部分はCoordinatorがLine 98.69% / Branch 91.68%、SyncStatusがLine 100% / Branch 90.81%である。Authは後続変更により未採取であり、未採取を実0%と扱わない。最終受入は固定原本の4層再計測で判定する。

## 既存assertと追加観点

Auth寿命の実UI99件とNode81件の成功は個々の回帰証拠であり、全体97%の代用ではない。既存 `coordinator_origin67` は旧gas/theme/pane、manual親伝播、pane保存前後、更新応答、承認親、初期無効ownerを検査する。`coordinator_contracts67` は旧theme/localStorage故障、API欠如、offlineを検査する。`transaction_refresh` は背景分離・要求合流・失敗非ループをNodeで検査する。次は同hashの実不足へ絞った追加である。

|対象と代表位置|追加する正規操作/故障|直接assert|
|---|---|---|
|SyncStatus:90–91|badgeの実pending read中に実lock/PIN解除、実同期開始が読取完了と競合|新badge/aria/disabled/結果/raw保持、同期中に「同期済」を書かない|
|SyncStatus:117|実ensure完了後応答を保留したnative手動同期を再認証が跨ぐ|旧managerの実sync開始0、新draft/通知/結果/raw保持|
|SyncStatus:137–138|実手動試行終了後の実refresh応答を故障モデルで保留し再認証|旧warn/旧render0、新画面/manager/draft/raw保持|
|Coordinator:109–113|loopback HTTP上の実SW登録、実登録応答/故障の新旧認証、API非対応|現登録だけの採用、旧代入/旧warn0、正常初期化継続|
|Coordinator:150/387/589/648|既存子read保留、初期false親、locked直接API|旧finish採用なし、無効時read0/DOM保存0|
|Coordinator:205–215|実fragment往復、初回history置換で短いhistoryからの離脱、通常pageshowモデル|不要promptなし、正当離脱/取消、正常表示保持|
|Coordinator:310|入力上のtrusted touch開始後のmove|text保持、既存tab維持、moveを不当にpreventしない|
|Coordinator:333–339|未締めsnapshot、締め済み月の予定/金額未確定の保存承認|戻値/拒否メッセージ/confirm0/raw保持|
|Coordinator:424|現sessionの実表示設定write故障|現在の保存エラー、表示draft保持/raw不変|
|Coordinator:525–580|実保存からの背景処理、read故障中の次保存、soft認証意図変更、実sync終了待ち|要求1回合流、失敗後の要求のみ再実行、取消/旧send0、全raw/draft保持|
|Coordinator:595–626|legacy theme欠落、optional Storage/media listener欠如、実emulated media change|正常system追従、明示dark維持、元設定/金融raw保持|
|Coordinator:635|既存1引数persistDisplaySetting|旧引数の正常保存、未指定軸/金融原本/可視draft保持|

同期開始の競合は実SyncManager入口と実DB読取を使用し、状態flagを代入しない。Promise/microtask順序を制御する場合も実読取・実同期を委譲し、MutationObserverでbadgeへの実書込を検査する。SW成功はloopback上のnative登録を用い、登録レスポンスの保留/失敗は依存故障モデルと明記する。OS認証器・公開配信のTLS/GAS・実機PWAの受入まで証明したと扱わない。

## 限定簡素化の根拠

以下だけをPhase 2/3後の候補とする。認証/操作世代、optional browser API、動的focus/行/選択肢の防御を機械的に削除しない。

|候補|producer/callerの根拠|維持する検査|
|---|---|---|
|SyncStatus.setupListenersのtypeof window|最初からdocument/常設buttonを操作するUIメソッドであり、AppCoordinator.finishAppInitのbrowser DOM setupだけがproduction callerである。Nodeのimport安全性はjs/app.jsの入口で守る|online/offline native eventと実button同期|
|SyncStatus.showProgressのbutton存在guard|index.html:64/732に両buttonが常設される。非表示/lockでもrootは破棄せず、I-2の必須DOMである|実sync busy/解除、auth失効による新画面保持|
|Coordinator modal解除内のauthVisible ternary|authVisibleならtopは常設auth-screenであり、同じupdate内の!topと同時成立しない。解除時focusはlocked.focusである|実auth gate/通常modalのfocus、nested close、戻る/Escape|
|Coordinator modalのelse if(top)|topがあるとlockedを取得し、top消失でlockedを解放する。top===currentは先にreturnするため、解除分岐に入らない後半はtopがある状態である|実modal遷移/スクロール/focus境界|
|Coordinator.applyThemeのchartController guard|constructor:51で無条件構築し、production内でchartController自体を再代入/破棄しない。Authはinstanceのdestroyを呼ぶだけである|system/light/darkとChartテーマ呼出。Chart内部の未生成instance guardは維持する|
|Coordinator背景結果のdirection fallback|SyncManager.beginAttemptのchangesはsent/receivedのrecordであり、集計/finishは各recordを返す。既存resultにchanges自体がない場合の外側fallbackは維持する|null方向という非producer形状を捏造せず、通常送受信/失敗/部分commitの結果を検査する|

body.childrenの非HTMLElement防御、消失focus target、古いブラウザAPI差異、callback直前の認証/manager検査は別扱いで維持する。全体の数値が足りない理由だけで除去しない。
