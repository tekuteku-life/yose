# 1.11.1 全更新境界の整合性監査と是正

## 監査範囲

基点はmainのb5f449e、1.11.0である。docs仕様・全ローカル保存API・UI追加/編集/削除/アーカイブ・生成/精算・差分/完全取込・同期の全入口・GASの全変更action・snapshot集計・認証境界を点検する。開発プロセスに従い、独立監査を先行し設計を3.46へ追加する。本番データには接続しない。

## 確認した問題

| 変化点 | 検出した不足 | 是正と検証 |
| --- | --- | --- |
| 通常明細保存/編集/一括 | 型/ID/親子/収支種別/参照検証なし、暗号化中lock、stale overwrite | 共通検証・認証guard・原本CAS、先行Node/UI |
| マスタ保存/アーカイブ/JSON編集 | 既存明細/定期/予算/snapshotを壊せる、古い設定全置換 | 候補全体検証・版比較・intent更新 |
| 実態分類の生成/集計 | 明示nullを別親の計上子へfallback | 未指定保持・同親限定既定、factory/aggregator/GAS回帰 |
| 差分インポート | 明細→マスタ→snapshotの逐次書込、候補全体未検証 | 合成後の原子的保存、混在バッチ/失敗注入 |
| 同期受信 | 調停前に明細/snapshotを適用 | 全候補と設定確認後のatomic commit |
| 同期送信/GAS | 通常actionに型/参照検証なし、新設masterより先に明細送信 | 共通契約とmaster先行、署名action異常系 |
| 月締め/初期残高/明細のみ完全取込 | 不正月受理、archiveと導出summaryの不一致 | 月と対象再検証、再計算、整合集計回帰 |
| GAS通常多ファイル保存 | 月移動の途中停止で原本喪失 | stage候補検証・永続journalと次要求recovery |
| 定期生成/立替精算/ポイント | 並行二重登録・無効ルール/口座・ポイント超過 | 安定ID/原本CAS/対象検査/エラー保持 |
| 既存不整合 | 厳格化で修復まで止める危険 | 問題fingerprint比較で不変保持と修復を許容 |

## Phase 1 共通設計

js/logic/data_integrity.jsに自己完結factory createDataIntegrityValidatorを置き、dataIntegrity.issues(state)、assertChange(before,after,{strict:false})を公開する。stateはmaster_config/transactions/summary_snapshotを持つ。問題はcode/path/message/fingerprintを持つ。fingerprintはcode/pathに加え不正値・参照先IDを含み、同じfingerprintの出現数も多重集合で比較する。通常変更は新しい問題・値の別不正化・重複数の増加を拒否する。既存値を黙って改変しない。アーカイブされたマスタへの歴史参照はissuesとしては報告せず、通常明細保存の遷移検査でbefore/after同一IDの参照先を比較し、新規IDや参照先変更だけアーカイブ先を拒否する。アーカイブ化自体は既存履歴を無効にしない。履歴の復元である取込・受信はallowArchivedReferencesを明示して許容するが、有効な定期ルールはアーカイブ先を使えない。完全取込はstrictで全問題を拒否する。GASへは同一コードを生成埋込みし、lintで一致を確認する。

YoseDBは業務3storeの原本を取り、候補合成・検証・事前暗号化・鍵検査・3store比較を通じて一括確定する。saveMasterConfigはexpectedConfig指定時に三方向合成し、mutateMasterConfigは最新のintentをCAS再試行する。putTransactionsはexpectedTransactionsで編集対象原本を比較でき、createOnlyで既存IDを上書きしない。差分取込とcommitMasterSyncのremoteStateも同じ保存境界を使う。rawストアAPIは暗号化層とテスト用の低水準APIであり、通常業務更新は上位APIを経由する。

## 独立設計レビュー

UI/生成はreview51_ui、GAS/同期はreview51_serverに先行設計を記録する。共通DB設計と先行テストの独立レビューを経て実装する。

## Phase 1 / 3 再入：受信重複・削除・自動精算

独立レビューで、Map化前の重複ID拒否、deleteTransactionの原本/認証guard、クレカ自動精算の同card/cycle重複が不足すると判明した。受信/差分取込はpayload配列の重複を合成前に拒否する。soft削除は読取時原本CAS、hard削除も同じ業務一括保存境界を通す。自動精算はcard/cycleの衝突しない安定ID、自然キー検査、比較登録により二重生成を防ぐ。既存nullable数値と99末日は合法であり、型検査はUIの正常値域を保持する。外部資産の市場評価額とメタデータobject形も共通検査へ含める。

### 再入追加

同値保存時の平文→暗号文移行、snapshotの明示null/false/0、受信masterの射影前型検査、引落口座の役割参照を追加する。未指定項目と明示不正値を区別し、合法な旧応答のmaster省略は許容する。分割編集は変更前原本を別cloneで保持する。メンテナンスも共通一括保存と最終認証guardへ統合する。追加先行テストはreview51-extra-red.logで失敗を確認した。

自動精算の先行テストで、前周期計算が当周期開始日を再利用して同周期になり、締め日通過後に引落済み前々周期を検索しない問題も検出した。前周期は開始日の前日から求め、2周期前も同様とする。仕様の「確定額」に合わせ、予定・金額未確定のカード支出を引落対象から除く。

カード生成の並行検証はallSettledでは片方の起動失敗を隠すため、両処理の正常完了をPromise.allで要求する。自動精算全体を共通mutateBusiness内の同期候補生成へ移し、CAS再試行時に最新の口座・明細を再集計する。作成済みまたは削除済みの安定IDは自動再作成しない。これにより対象変更中の古い集計保存も防ぐ。

既存のcollection形崩れ（配列項目がobject）でも問題を増やさない無関係更新と修復を許容する。遷移時のアーカイブ検査は安全な配列だけを走査し、共通issuesの本来の問題報告をTypeErrorで隠さない。legacy-shape先行テストで失敗を確認した。

LWW比較に使用するcreated_at/updated_atも、指定時は有限の日時として検証する。不正文字列を時刻0として保存・受信して変更を失うことを防ぐ。時刻省略時の既定は維持し、端末時計差を考慮して将来日時は一律拒否しない。unit2件と通常保存/取込/受信の原本保持を先行REDで固定した。

自動精算metadataは未削除明細について、card_idの実在とcredit_card種別、振替先との一致、billing_cycleの年月も検査する。識別情報の破損による二重生成を防ぐ。欠損参照・宛先不一致・不正月を共通unitで先行REDへ追加した。


## 実装後の整理と全体検証

共通一括保存へ統合したことで不要になった旧compareAndPutRaw・compareAndPutRawBatch・compareAndPutMaintenanceBatchを削除した。低水準putRaw/deleteRawもrequest成功ではなくトランザクション完了を待つ。GAS共通コードの生成一致をlintへ追加し、.mjsもTAB・構文の検査対象へ含めた。1.11.1の規定5ファイルとpackage-lock、SWの新モジュールキャッシュを更新した。

正常fixtureのSchema補完と、旧不整合を再現するraw履歴fixtureを区別した。暗号化途中失敗、競合、ロック、不正応答では、先行する正常行を含め業務原本が変化しないことを検査した。独立レビューで追加された問題は設計・先行テストへ戻して再検証した。

最終Node一括実行は`npm test`で730件・94 suitesすべて合格、失敗・取消・スキップ0件である。TAB・JS/GAS/JSON/Mermaid構文・静的型・GAS生成一致も合格である。測定ログは `/tmp/review51-release-node.log` である。

### カバレッジ実測と受入ゲート

Node一括測定の集計はLine99.40%、Branch90.52%である。全対象各97%以上の数値ゲートは未達である。数値を合わせるための除外・閾値変更・到達不能分岐の擬似試験は行わない。

| 対象 | Line % | Branch % | 各97%以上 |
| --- | ---: | ---: | --- |
| Code.gs | 99.13 | 90.60 | 未達 |
| crypto.js | 99.60 | 96.10 | 未達 |
| db.js | 100.00 | 100.00 | 達成 |
| backup_merger.js | 100.00 | 92.96 | 未達 |
| backup_replacement.js | 100.00 | 82.35 | 未達 |
| defaults.js | 100.00 | 100.00 | 達成 |
| storage_engine.js | 95.41 | 93.33 | 未達 |
| yose_db.js | 99.26 | 90.13 | 未達 |
| logic.js | 100.00 | 100.00 | 達成 |
| aggregator.js | 100.00 | 85.64 | 未達 |
| budget_engine.js | 100.00 | 92.42 | 未達 |
| data_integrity.js | 100.00 | 92.93 | 未達 |
| date_utils.js | 98.90 | 97.18 | 達成 |
| master_maintenance.js | 100.00 | 90.41 | 未達 |
| master_sync.js | 99.49 | 91.51 | 未達 |
| transaction_factory.js | 100.00 | 94.27 | 未達 |
| sync.js | 98.97 | 91.24 | 未達 |
| version.js | 100.00 | 94.64 | 未達 |
| webauthn.js | 100.00 | 68.63 | 未達 |

この作業ブランチへのコミットは変更の保存であり、開発プロセスの最終受入・マージ・本番反映の承認とは扱わない。PR案は[review51_pr](review51_pr.md)である。既存実データを推測で削除・付け替える処理は実施していない。反映時は対応するGASとクライアント1.11.1をともに更新する必要がある。

### 再入：未来版を編集した際の更新日時

未来日時の受信や完全取込確定後も通常の手元変更を失わないよう、同IDのローカル変更版はmax(現在時刻,既存版+1ms,指定時刻)へ単調増加させる。remote/OR取込のLWW比較は従来どおりとする。未来版の編集→同期で金額とACKを保持する先行REDを追加した。直接遡及送信するUIは保存APIが返した確定版を送る。

前払補助情報のis_payment_recordは、文字列falseが真と解釈され誤った親支払を選ぶ不具合がある。指定時はbooleanとし、親はtransfer・子はexpense、補助情報を持つ行は非空group_idを必要とする。旧子のflag省略は従来のexpense子として維持する。既存の役割不正を持つグループの再配賦は原本を保ったまま拒否し、新しい親子金額不一致を作らない。共通unit4件と4境界の原本保持を先行REDに追加した。


### 最終独立コードレビュー

独立担当`review51_audit`は共通検証・DB・GAS・同期・UI・生成集計・変更テスト一式の最終コードレビューをPASSと判定した。既知のコード指摘はすべて解消した。最小削除通知、未来版の単調更新、旧日時objectの修復、前払役割不正時の配賦拒否、直接遡及APIの原本比較、閉じた編集原本の再利用防止、同期未完了の正確な通知まで追加で検証した。設計・先行RED・再入の担当詳細は[UI記録](review51_ui.md)、[サーバー記録](review51_server.md)を参照する。コードレビューのPASSと数値受入ゲートは別である。

## 最終一括確認

ソースとテストの担当変更を停止した後、Node730件・94 suites、実ブラウザUI243件・15 suitesを一括実行し、いずれも全件合格した。失敗・取消・スキップは0件である。ログは `/tmp/review51-release-node.log` と `/tmp/review51-release-ui.log` である。版番号5ファイルとlockの一致、新モジュールを含むオフライン資産37件の実在、差分空白も確認した。

途中の全UI235PASS/1NGは、検索入力完了を描画完了と見なしたテスト待機不足であった。DB読取停止probeで製品の正常な非同期完了を確認し、意図的な遅延と表示内容の条件待機を追加した。期待ページ・総件数・表示行数のassertは維持した。その他のNGは旧正常fixtureの型・参照不足と、先行回帰が捕捉した製品不具合を切り分け、それぞれ検証・修正した。

独立コード最終レビューはPASS、既知コード指摘は0件である。カバレッジは上記実測のとおり各97%基準未達のため、最終受入ゲートは未承認である。
