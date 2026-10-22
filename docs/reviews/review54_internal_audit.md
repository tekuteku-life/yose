# 内部設計と既存テストの対応監査

監査基点は1.12.1の`e817c6f`である。分割元は`git show e817c6f:docs/system_design.md`から保存した原本であり、監査対象は分割後の[内部設計書](../internal_design.md)である。テストファイルの存在やテスト名だけでなく、実装と既存assertを照合した。監査担当はテスト・プロダクションコードを変更していない。全体実行結果は[review54.md](review54.md)に記録する。

## 判定の意味

- **対応あり**: 表に記載した設計論点を直接検証するassertがあるとの判定である。全入力・全実行環境・全分岐の網羅を意味しない。
- **部分**: 一部の計算・経路・モック環境には直接assertがあるが、記載した残余を確認していないとの判定である。
- **未検証**: その設計論点を直接判定する既存assertを確認できないとの判定である。
- **乖離**: 旧要求の断定と現実装が一致していないとの判定である。分割に伴う文言整理を要求達成や実装修正とは扱わない。

## 証拠カタログ

各証拠の行番号は監査時点のテスト定義の先頭である。結合・システムテストの`gas.doPost`呼出しはNode上のGASサービスモックであり、Google公開URLに対する実通信ではない。

| 証拠 | テスト位置・代表ケース名 | 実際のassert対象 |
| --- | --- | --- |
| A01 | `test/unit/db.test.js:601` / `verifies direct sub-module exports from js/db/* and js/logic/* match facade exports` | DB・logic公開ファサードと分割モジュールのエクスポート同一性である。責務分離の保守性や全依存関係を判定するassertではない。 |
| A02 | `test/unit/db.test.js:15,527` / `initializes with default master config and summary snapshot`、`initializes and executes operations via native indexedDB interface` | 初期値、マスタ・明細・スナップショット・鍵・設定の保存取得である。後者のIndexedDBは`createMockIndexedDB`であり、実ブラウザではない。 |
| A03 | `test/unit/gas.test.js:427` / `correctly chunks and reads large JSON files in Spreadsheet storage` | JSON保存後の復元一致である。fixtureはcompact JSONで23,291文字、実際の保存形式`JSON.stringify(data, null, 2)`で36,299文字であり、40,000文字超の分割はこのケースでは起きない。セル数・セル長・境界位置のassertはない。 |
| A04 | `test/integration/gas_public_access.test.js:26,40,56,70` / `allows cookie-free entry while retaining owner execution and minimal OAuth scope`、`completes signed bidirectional synchronization without Google login cookies`等 | manifestの公開・実行者・scope、fetchの`credentials: omit`・`redirect: follow`・`text/plain`、署名なし拒否、GETの固定statusである。Googleログイン/CORS/公開設定の実動作は確認しない。 |
| A05 | `test/unit/logic.test.js:130,140,148` / `calculates 10% tax with floor rounding`等、`test/unit/data_integrity.test.js:42,57` | 税額・丸め・元本・tax_meta、端数円拒否・マスタ整数域である。Numberの安全整数上限・巨大な累計金額・全誤差の排除はassertしない。 |
| A06 | `test/unit/logic.test.js:214,235,243,258` / `generates planned transactions for valid active rules in target month`等、`test/integration/recurrent_and_amortization.test.js:21` | 予定状態、頻度、月末、休日補正、生成済み抑止とDB保存・月間連携である。起動時自動確定の証拠ではない。 |
| A07 | `test/unit/generated_integrity.test.js:16,23,40,50` / `${name} preserves explicit empty actual child...`、`uses stable collision-free recurring IDs...`等 | 生成経路ごとの実態中項目の親子関係、明示null、同一親だけの継承、定期/カード決済の安定ID・別周期分離である。 |
| A08 | `test/unit/logic.test.js:275` / `creates 1 payment transfer + N monthly amortizations with remainder on 1st month`、`test/integration/recurrent_and_amortization.test.js:59` | 親振替＋N子、初月端数・合計保存・予定/確定状態、前払口座残高推移である。 |
| A09 | `test/ui/recovery_workflows.test.js:35,158` / `keeps the entire prepaid group unchanged on ${failure} failure`、`moves a prepaid parent out of a closed month...` | 実ブラウザIndexedDBでグループ失敗時の全行不変、親移動時の償却日程保持である。 |
| A10 | `test/unit/logic.test.js:449,662,682,707,2438` / `calculates confirmed and projected balances accurately`等 | 確定/予定残高、日/月/年集計、スナップショット優先、明示0の保持である。 |
| A11 | `test/unit/logic.test.js:727,773,805,2352`、`test/unit/asset_history.test.js:17,28,33` | 流動/投資/保険/負債・純資産、範囲別履歴、締め残高の持越し、日次履歴不足のnoticeである。すべての勘定符号入力の一致を保証しない。 |
| A12 | `test/unit/category_trend.test.js:30,35,41,54,58,64` | 日付基準の日別、計上月基準の年、12か月固定、スナップショット二重算入防止、軸/予定/0/未知名称/閏月と入力不変である。 |
| A13 | `test/unit/logic.test.js:1453,1503,1521,1539,1603,1662,1760,1850,1908` | 予算進捗/警告/赤字/既定値/累積軌跡、タグの金額と件数、クロス行列の行列合計と総計である。 |
| A14 | `test/unit/master_sync.test.js:35,41,51,74,103,114,124,132` | 共有field限定、ID/プロパティ/休日3-way merge、競合保持・取消、base暗号化、サーバーCAS拒否、通信中の後続編集保持である。 |
| A15 | `test/unit/master_conflict_resolution.test.js:24,56,68,81,93,100`、`test/integration/master_conflict_outcomes.test.js:94,112,118,139` | 項目別混在選択、削除対編集、ドット含有ID、選択集合検証、古い承認拒否、参照整合性である。 |
| A16 | `test/unit/master_maintenance.test.js:34,55,65,90,109,117,126`、`test/unit/storage_atomicity.test.js:23,30` | 使用済みアーカイブ候補と件数、両分類軸/振替先、自己振替拒否、全件一括更新、元参照変更・暗号化中競合時の不変、暗号化rawでメモ非露出である。 |
| A17 | `test/ui/integrity_workflows.test.js:7,20,42,180,193,205`、`test/ui/recovery_workflows.test.js:178,219` | 古い画面/削除/後続編集の拒否・保持、保存失敗時の入力保持、設定intentキュー、認証変化・ACK暗号化中の新しい編集保持である。 |
| A18 | `test/unit/db.test.js:270,468,789,928`、`test/integration/import_payload_validation.test.js:10,27` | 差分ORマージの追加・重複・手元優先、形式自動判別、Prototype Pollution・未知/混在形式の受理前拒否である。 |
| A19 | `test/integration/replacement_import.test.js:23,42,87,102,113,187` | 同時刻値の完全置換・省略ID削除・暗号化outbox、選択種別限定、鍵/接続保持、厳密マジックワード、古い確認/暗号失敗時全store不変、保留操作の明示差替えである。 |
| A20 | `test/ui/replacement_import.test.js:41,61,78,89` / `rolls back every IndexedDB store if a write throws halfway through the atomic replacement`等 | 実ブラウザIDBでキャンセル・認証変化・途中書込み例外を扱う。89行ケースの直接assertは既存明細ID保持、マスタ改名未適用、outbox未保存であり、タイトルの「every store」に対するsnapshot・settings・security_keysの全値比較はない。複数エンジンのquota/強制終了保証でもない。 |
| A21 | `test/integration/full_import_sync.test.js:82,94,209,234,463,484,504` | import ID再送の冪等性、state_version競合、各シート書込への例外注入と復旧、他端末へのtombstone伝播、ACK喪失後の後続編集・outbox保持である。 |
| A22 | `test/system/full_import_recovery_scenario.test.js:12` / `recovers an offline full replacement and lost ACK without resurrecting removed records or losing later edits` | オフライン完全置換→サーバー受理ACK喪失→別端末/ローカル後続編集→再送後の削除非復活、最新編集保持、base一致である。 |
| A23 | `test/unit/data_integrity.test.js:10,42,47,57,79,92,102,114,132` | マスタ/明細/スナップショットのenum・型・日付・金額・ID/自然キー重複・親子参照・危険key、アーカイブ履歴許容と新規参照拒否、旧不整合の同値保持/修復である。 |
| A24 | `test/integration/integrity_boundaries.test.js:52,65,73,82,99,108,129,142`、`test/integration/replacement_integrity_boundaries.test.js:19,40,58,79` | 保存・一括・マスタ・snapshot・import・remote境界の拒否前後raw全state比較、LWW時刻、CAS/createOnly、暗号中の認証変化、確認計画改変・ACK整合性拒否である。 |
| A25 | `test/unit/data_integrity_gas.test.js:32,45,51,92,148` | GAS一括不正入力/マスタ孤児化拒否、破損JSON/読込例外後にrawシート不変、通常遡及移動のジャーナル各段階の例外注入から復旧である。 |
| A26 | `test/integration/data_integrity_sync.test.js:34,48,68,97,116,166` | 不正受信/競合/認証変化で複数store同時不変、新マスタ送信先行、応答全体検証前に共有マスタをアップロードしないことである。 |
| A27 | `test/integration/bidirectional_sync.test.js:24,60,66,81,99` | ローカル/リモート更新、tombstone/アーカイブ双方向、送信0件での受信、同時刻ローカル優先、途中編集・部分失敗の保留維持である。 |
| A28 | `test/integration/sync_flow.test.js:110,149,208,228,248,281,315`、`test/integration/bidirectional_sync.test.js:116,160,175,199` | 月締め/遡及再計算、締め月変更・移動/削除、再締め取消、予定・金額不明拒否、承認した版のみ確定、ACK喪失後移動重複抑止・通信中編集保持である。 |
| A29 | `test/unit/master_sync.test.js:149,159,166,174,190`、`test/unit/sync.test.js:294` | 同期状態通知、二重実行抑止、バックグラウンド再予約、online/visibilitychange登録、ヘッダー待ち/応答本文待ちのtimeout、危険な即時再送なしである。OS中断下のkeepalive到達は測定しない。 |
| A30 | `test/unit/gas.test.js:35,47,59,133,152,174,193,475,688` / `verifies valid WebCrypto signature using Pure JS RFC 8032 in GAS`、`comprehensively covers all edge branches in gas/Code.gs`等、`test/unit/crypto.test.js:143,154,167,183,358` | RFC8032検証、署名/鍵改変拒否、±5分の鮮度、初回自己署名・登録済み鍵保護、canonical JSON、lock busy/例外である。688行ケース内で同一署名の再送が`Replay detected`として拒否されることも判定する。CacheServiceの例外/不存在/早期失効時の永続的拒否はassertしない。 |
| A31 | `test/unit/crypto.test.js:108,126,234,248,265,287,329,390` | Ed25519 PINラップ、AES256鍵、暗号化往復、改ざん/IV/異鍵・不正包絡拒否、DMK+秘密鍵PIN復旧とactive session消去である。 |
| A32 | `test/unit/passkey_standard.test.js:7,25,44` | PRF/attachment/transport制限なし、SPKI/署名、ID/challenge/origin/rpHash/UP/UV/userHandle/登録異常の拒否である。認証器はECDSA署名fixtureである。 |
| A33 | `test/ui/daily_usability.test.js:65` / `registers a real standard virtual passkey and still requires PIN for decryption` | CDP仮想CTAP2で実CredentialsContainerを使い、PRF未要求/SPKI保持、パスキー認証後もDMK未解除、PIN後解除を判定する。1Passwordや実OS認証器ではない。 |
| A34 | `test/ui/daily_usability_edges.test.js:25` / `migrates the ${legacy} legacy vault only after a valid PIN and preserves existing keys` | 旧PRF/平文保存の移行にPIN成功が必要であり、既存鍵を保持することである。 |
| A35 | `test/unit/version.test.js:61,113,130,146,163,278,331,352`、`test/ui/settings_workflows.test.js:270` | バージョン比較・offline/HTTP/不正JSON、SWメッセージ送信・キャッシュ削除・リロード・IDB未削除である。SW本体イベント処理の検証ではない。 |
| A36 | `test/ui/category_trends.test.js:8,22,48,62,75` / `renders monthly category series...`、`does not let an older summary read overwrite a newer chart or breakdown`等、`test/ui/analytics_workflows.test.js:200` / `handles Chart.js being unavailable while retaining usable analytics and transactions`、`test/helpers/cdp_driver.js:24` | グラフへ渡す系列・軸・破棄/再生成とDOM表示である。Chartクラスがstubであり、CDN版の描画・タッチtooltip・描画速度を直接判定しない。 |
| A37 | `test/ui/editor_usability.test.js:55,94,129,145,161,174,195,232,322` / `replaces partial ${mode} tags and memos with selected suggestions using real clicks`、`locks background scrolling and interaction across a nested calculator and restores on close`等 | サジェストの置換・チップ/IME/キー/タッチ、dirty破棄確認、最上位モーダル、背景inertとスクロール復元、古い子分類応答の破棄である。 |
| A38 | `test/ui/master_modal_navigation.test.js:23,37,129,159,179,192,205,229` / `closes an unchanged ${type} form on back with no departure confirmation`、`keeps a newer master open when an old saved form finishes refreshing after lock and unlock`等 | 各マスタの戻る/破棄、保存中close、認証/世代変化後の遅延応答拒否、新規ID再試行時重複防止、チェックだけの変更と復元である。 |
| A39 | `test/ui/input_mode_settlement.test.js:9,33,53,67,107,127` / `settles from the real recovery list with one tag and a short memo while preserving the source`、`carries the normal amount and all shared fields through ${trigger} switching into saved installments`等、`test/ui/transaction_workflows.test.js:269` / `supports calculator arithmetic, tax modes, backspace, cancellation, and edit amount targeting` | 回収タグ/メモ、競合時原本保持、モード間の金額・文字列保持、未入力/0区別、前払既存総額非上書き、電卓取消と対象欄適用である。 |
| A40 | `test/ui/recurring_categories.test.js:29,39,64,85,94` / `starts new rules grouped and saves changed accounting parent and child to both axes`、`uses the transaction subcategory wording in recurring, insurance premium, and maintenance selectors`等、`test/unit/logic.test.js:2375` / `syncInsuranceRecurringRule creates, updates, and deactivates linked recurring rule`、`test/integration/integrity_boundaries.test.js:167,180` | 分類一致チェックの保存値、未指定表記統一、保険の対応定期作成/変更/無効化、カード並列生成で一件維持・アーカイブ引落元で生成しないことである。 |

## 全設計節との対応

「対応あり」の判定も証拠カタログのassert対象に限定する。親章はその配下全節を索引する構造であり、親章全体をテスト1件で達成したとの判定ではない。

| 内部設計節 | 設計論点 | 証拠 | 判定・未検証の範囲 |
| --- | --- | --- | --- |
| 本書の位置付け | 要件/外部/内部/監査の文書責務と識別子 | 自動テスト対象ではなく、本監査と分割レビューで参照を確認する。 | 未検証（自動assert）。実行時機能の不足とは区別する。 |
| I-2.1 | PWA/ブラウザ・GAS・Sheetsの役割境界 | A02/A04/A27 | 部分。ローカル/GAS結合はモック、GitHub Pages本番公開/費用/Google運用可用性は未検証である。 |
| I-2.2 | ディレクトリ構成・公開ファサード | A01 | 対応あり。export契約を直接判定する。構成図の全責務の自動保証ではない。 |
| I-2.3 | シート単位JSON・チャンク・アーカイブ・復旧領域 | A03/A21/A25 | 部分。JSON復元・各領域復旧は確認するが、40k超・50k境界・サロゲート/長文の複数セル復元は未検証である。 |
| I-2.4 | コンテナバインド・匿名公開・初期化/デプロイ | A04、`test/unit/gas.test.js:388,410`の`initialSetup`・非バインド拒否 | 部分。scope/manifest・初期化結果は確認する。clasp実デプロイ、OAuth承認、実匿名公開の稼働は未検証である。 |
| I-4.6 | AppCoordinatorとUIコントローラーの責務・イベント伝播 | A17/A29/A36 | 部分。操作/伝播/二重処理防止は確認するが、全コントローラー依存構造の自動判定はない。 |
| I-4.7 | StorageEngine/YoseDB/BackupMergerとlogicモジュール | A01/A02/A18/A19/A23 | 対応あり。公開契約、保存、merge/replaceと計算の直接assertがある。 |
| I-3.1 | 単一明細・振替・ポイント/立替・二分類軸・回収タグ | A05/A07/A10/A23/A39、`test/integration/recurrent_and_amortization.test.js:94,138`のadvance/point残高ケース | 対応あり。生成・両分類・相殺/回収・利用者の文字列保持と参照/金額を判定する。整数精度の限界はI-7.8で分ける。 |
| I-3.2 | 定期ID・周期・休日・月末・予定生成・カード/保険連動 | A06/A07/A40 | 部分/乖離。予定・カード/保険連動は対応するが、旧3.2の起動時一括生成・固定額の日付到来自動確定は既存assert/実装で確認できない。現行生成は`status: planned`固定である。 |
| I-3.3 | 前払の親子/按分・一括更新・グループCAS | A07/A08/A09、`test/ui/transaction_workflows.test.js:215,234,247`の親/子メモ編集・総額変更ケース | 対応あり。残高・親子参照・端数/総額保持・明示再分配・関連更新失敗時全行保持を判定する。 |
| I-3.4 | snapshot差分・日月年・資産履歴・分類推移 | A10/A11/A12 | 対応あり。日付/計上月の違い、snapshot重複抑止、負債/投資/不足履歴を判定する。負債残高の負数限定という旧断定は現実装と異なる。 |
| I-3.5 | 年間予算・タグ・クロス集計 | A13/A23 | 対応あり。予算警告・赤字・階層合計・タグ/行列の予定切替と安全性を判定する。UI行列クリックの未実装は外部監査事項である。 |
| I-3.6 | 共有マスタ3-way merge・競合・アーカイブ移行 | A14/A15/A16 | 対応あり。項目別選択、baseとCAS、履歴維持、両軸/口座移行、一括更新を判定する。 |
| I-3.7 | UI状態・チップ/候補・電卓/入力モード・モーダル/履歴・遅延read | A17/A29/A36/A37/A38/A39/A40 | 部分。遅延/失敗/後続編集・最上位モーダル・分類チェック・0/未入力と金額引継ぎに直接assertがある。全描画順序・全モバイルOS・実入力機器を網羅しない。 |
| I-3.8 | 差分import・auto-detect・OR/LWW | A18/A24 | 対応あり。非破壊・同一ID/時刻/マスタ重複・不正データ全体拒否を判定する。 |
| I-3.9 | 完全import・対象範囲・計画CAS・outbox・ACK・復旧 | A19/A20/A21/A22 | 対応あり。部分成功を許さない候補適用と、再送/後続編集/削除伝播を判定する。実GAS障害時の耐久性は未測定である。 |
| I-3.10 | 全更新境界・不正候補拒否・既存不整合修復 | A23/A24/A25/A26 | 対応あり。列挙された保存/import/受信/送信/月締め/遡及/置換の境界で変更前後を判定する。全状態組合せの証明ではない。 |
| I-4.1 | 双方向差分・同期直列化・月締め/遡及・承認 | A26/A27/A28/A29 | 部分。経路/ACK/CAS/取消/後続編集は対応する。visibilitychange keepaliveの実OS終了/サイズ制限下の到達保証は未検証である。 |
| I-4.2 | 署名要求・canonical JSON・GAS認可 | A04/A30 | 部分。登録済み鍵/署名/鮮度と短期cacheでの同一署名再送拒否を判定する。永続nonceはなく、CacheServiceの不存在/例外/早期失効下でも同じ拒否となる保証はない。 |
| I-4.3 | DMK暗号化・metadata・鍵と平文の境界 | A16/A19/A24/A31 | 部分。暗号化された本文と暗号/認証変化時の全件保持を判定する。metadata・settings・security_keys・サーバーJSONは全暗号化ではなく、アンロック中DOM/メモリも読み取り可能である。 |
| I-4.4 | 通常パスキー認証とPIN復号・鍵のセッション | A31/A32/A33 | 部分。暗号検証fixture＋専用仮想CTAP2経路はある。1Password・実OS・複数ブラウザ認証器は未検証である。 |
| I-4.8 | 旧PRFバンドル/PINからの移行 | A34/A31 | 対応あり。PIN成功前の非適用と成功後の鍵保持・暗号化移行に直接assertがある。 |
| I-5 | ストア/暗号包絡・同期用内部fields・server永続schema | A02/A14/A19/A21/A23/A24 | 部分。受理/拒否と主要内部fieldsの保持/除外に対応する。ERDの全field・全JSON例の全組合せをschema検証する専用テストではない。 |
| I-6.1.2 | 詳細DFDの保存/署名/通信/復旧経路 | A19/A21/A24/A26/A27/A30/A31 | 部分。各辺の主要データ変化は判定する。図が示す全フローを実Google/実認証器で連結したテストはない。 |
| I-6.3.1 | 入力→関連明細→検証→暗号化→atomic保存 | A07/A08/A09/A17/A24 | 対応あり。生成/参照整合性/失敗時の非部分適用を判定する。 |
| I-6.3.2 | 差分同期・両方向・ACK/CAS | A14/A26/A27/A28 | 対応あり。送信0件受信、同時編集保持、未ACK再送とLWWを判定する。 |
| I-6.3.3 | 月締め・予定コーション・archive/snapshot | A25/A28 | 対応あり。承認した予定版のみ確定、未入力拒否、締め後の残高/アーカイブ、書込失敗復旧を判定する。 |
| I-6.3.4 | 過去月編集・元月保持・再締め/再計算 | A25/A28、`test/integration/retroactive_intent.test.js:22,39,49,56` | 対応あり。元版CAS・既保存版の再保存回避・移動/重複抑止・保留/復旧・連鎖残高を判定する。 |
| I-6.3.5 | 起動ロック→パスキー/PIN→DMK→描画 | A31/A33/A34、`test/ui/daily_usability.test.js:35` | 部分。仮想認証器と実ブラウザreload後のPIN解除を判定する。端末ハードウェア・OSメモリ消去の保証はない。 |
| I-6.3.6 | 初回公開鍵の自己署名登録 | A04/A30 | 部分。自己署名・登録済み上書き拒否は判定する。所有者未設定の公開endpointに対する先取り競合を本人確認する機構ではない。 |
| I-6.4 | master/tx/snapshot・親子・同期内部ERD | A07/A19/A23/A24 | 部分。参照親子/振替/予算/安定IDは判定する。図自体から全field/typeの機械照合はしていない。 |
| I-7.1 | `@OnlyCurrentDoc`・scope・バインド運用 | A04、`test/unit/gas.test.js:410` | 部分。設定値/非バインド例外を判定する。Googleの権限審査/警告が将来も100%回避される保証は未検証である。 |
| I-7.2 | 40,000文字分割・復元・破損時中断 | A03/A25 | 部分。破損時中断は直接判定するが、40k超の実分割・境界ごとの各セル長は未検証である。 |
| I-7.3 | text/plain・credentials omit・redirect・timeout | A04/A29、`test/unit/sync.test.js:95` | 部分。要求optionsとtimeoutを判定する。Googleリダイレクト/CORS・Android実ネットワークは確認しない。 |
| I-7.4 | Ed25519・canonical・鮮度・環境制約 | A30、`test/unit/crypto.test.js:226` | 部分/乖離。GAS純JS検証と短期cacheでの同一署名再送拒否は対応する。クライアント署名には純JS代替がなく、WebCrypto Ed25519非対応時の署名継続という旧断定に一致しない。cache障害下の再送拒否は未検証である。 |
| I-7.5 | DMK/PBKDF2/PIN/メモリ鍵と脅威境界 | A31/A33/A34 | 部分/乖離。暗号往復/改ざん/鍵消去呼出しは対応する。「全DB/サーバーまで暗号化」「DevToolsから平文が読めない」「パスキーだけでDMK復旧」は現行保証ではない。 |
| I-7.6 | `tryLock(30000)`・finally解放・CAS・journal | A21/A25/A28/A30 | 部分。lock取得拒否/例外/解放と中断復旧を判定する。モックは真の並列GASロック/実シート複数プロセス隔離を再現しない。 |
| I-7.7 | SW install/activate/message/fetch・ネットワーク分離 | A35 | 部分。version/UI側更新要求のみ直接検証する。SW本体のinstall失敗・cache eviction・非HTTP・GAS除外・HTML fallback・waiting競合・完全オフライン起動を判定する専用assertは未確認である。 |
| I-7.8 | 整数円・税/按分・数値域 | A05/A08/A23 | 部分/乖離。通常金額と按分合計は直接判定する。safe-integer超・巨大累計の上限方針/全精度保証はなく、「浮動小数点誤差の完全排除」との旧断定は未達である。 |

## 優先して残す不足と要求乖離

1. **SW本体・実オフライン復旧**: `version.js`へのメッセージ送信assertと、`sw.js`の実イベント検証を分ける必要がある。SWファイルのNode構文チェックだけをPWAオフライン要件の確認とはしない。
2. **40,000文字チャンク**: 現行の「large JSON」ケースは実保存形式で36,299文字である。40,000直前/一致/直後・複数行・Unicode・短い再保存で旧行が消えることと、途中書込破損からのjournal再実行を区別して確認する必要がある。
3. **暗号・リプレイの保証範囲**: 本文AESと平文metadata/設定/サーバーJSONを分ける必要がある。GASは±5分の鮮度とsignatureキーの300秒CacheService記録を併用し、同一署名の短期再送拒否に直接assertがある。ただし永続nonceではなく、cache不存在/例外は処理を続行する。cache早期失効や例外時を含めた再送拒否は未検証である。`replace_import`の冪等receiptは別の機構であり、クライアントWebCrypto Ed25519非対応時の代替署名はない。
4. **真の実環境**: GASモックのlockはフラグ、シートはメモリ配列である。ブラウザCDPの実IDBケースは存在するが、Android/iOS複数エンジン・quota/プロセス中断・本番Sheets・ネットワーク・OAuthを代替しない。仮想CTAP2は実1Passwordを代替しない。
5. **数値・業務の旧要求未達**: 定期の起動時生成/日付到来自動確定、安全整数上限を含む精度保証には既存テストの証拠がない。負債計算は正のloan残高も取り込むため、符号表示テストと内部負数限定要求は分離する必要がある。

全更新境界・完全import・再送/復旧については多数の直接assertが存在する。ただしモック結合/Nodeカバレッジの高さをもって、未測定のSW・UIコントローラー・Google実サービス・認証器実機も網羅済みとは判定しない。

## 実行層と測定の境界

`npm test`は`test/unit`・`test/integration`・`test/system`をNodeの`--experimental-test-coverage`付きで実行する。ブラウザ内で読み込むUIコントローラーのカバレッジをこの数値から判断することはできない。`npm run test:ui`はCDPケースを実行するが、現行コマンドにブラウザソースのcoverage収集はない。構文/型検査成功も操作・副作用assertの代わりにはならない。

`createMockIndexedDB`はMapをtransaction snapshotへ複製し、microtask/`setImmediate`で完了するテストダブルである。実IndexedDBのストレージ耐久性・quota・複数タブ排他・ブラウザ強制終了を再現しない。`MockGasEnvironment`のSpreadsheetは配列/Map、LockServiceはフラグを用い、Googleのサービス割当・分散実行・シート原子性・OAuth・ネットワークを再現しない。一方、CDPテストには実ブラウザのIndexedDBとWeb Crypto、および専用ケースの仮想CTAP2を使用するものがあるため、すべてをNodeモック検証だけと断定してもならない。

本書は設計論点へのassert対応監査であり、各対象ファイルLine/Branch97%以上という開発プロセス上の数値ゲートの承認ではない。最新数値・全体テスト結果と、その受入判定は親レビュー記録に集約する。
