# review62 GAS認証是正

## 範囲

mainからfix/gas-authentication-hardeningを作成した。先行調査で再現した公開初回登録・キャッシュ障害時の再送・非数値時刻・弱い公開鍵の4点を是正する。R/E/I-4.9、専用設計、設計テスト監査を先行更新した。GAS管理画面での鍵登録と永続認証台帳へ統一し、正当な既存要求・業務スキーマは維持する。

## 判定境界

既存全体のカバレッジ改善は本人指定どおり別件である。各97%ゲートの不足が残る場合は明記し、総合Grade A+とは判定しない。本番GASへの配備/管理設定の変更は含めない。

## Phase 2 設計レビューと再入

auth_reviewとsettlement_reviewは、旧版の処理済み要求を空台帳へ再送できる移行境界を指摘した。Phase 1へ戻り、旧版の全公開停止・全実行終了確認・600,000msを超える待機・旧要求拒否/新署名成功を配備の受入条件として明記した。実際の配備は本件のローカル作業に含めない。

## 保存方式の自己監査によるPhase 1再入

シート台帳の全体書換は、部分保存により旧履歴が欠ける境界を増やすため採用を取りやめた。PropertiesServiceへ要求ごとに独立保存し、未失効記録を変更/削除せず期限切れのみ消す方式へ変更した。公式の容量制限を確認し上限1,024件と保存後再読一致を設計した。Phase 3で指摘された正規Base64・混在鍵・ロック順序/解放・復旧待ち原本・完全置換後の記録保持も試験へ追加する。flushを要するシート保存経路は認証から除く。

Properties独立保存への設計再レビューはauth_review/settlement_reviewともPASSである。Phase 3では保存後の非空不一致値・既存履歴を持つ保存失敗・正規Base64の未使用bit・混在鍵・ロック順序/解放・復旧待ち原本・完全置換後の記録保持を追加し、auth_review/coverage_ui_reviewの再テストレビューはPASSである。先行REDは `/tmp/yose62-properties-red.log` に記録した。GASのUtilitiesによるUTF-8変換を使い、ブラウザTextEncoderの存在を前提としない。

## Phase 5指摘によるPhase 1/3再入

settlement_reviewは、一覧に未失効記録があっても個別読取が一時的にnull/期限切れ値となると再送できる点を指摘した。初回の全体収集はこの修正のため停止し、途中ログの成功件数を最終結果には使用しない。設計へ存在/値の不一致拒否を追加した。テストは個別読取の欠落/期限切れ/別値と一覧欠落の4件であり、障害注入を1回に限定し、保存後の再読失敗による偶然の拒否を防いだ。認証記録の書込0件・業務読取0件・全Properties/復旧待ち原本の不変を検証する。修正前に欠落/期限切れの2件で再送成功を再現した（`/tmp/yose62-inconsistent-red.log`）。settlement_reviewの設計/テスト再レビューはPASSである。一覧と個別読取の一致を必須とし、一覧の未失効記録を直接再送拒否に使う修正を実施した。

## 設定UI/配備案内レビューによるPhase 1/3再入

coverage_ui_reviewはsetup:gasの公開前移行案内不足と、公開鍵コピーの完了前成功通知を指摘した。手動登録が主要経路となるため両方を本件範囲で是正する。設計/テストを先行更新し、公開コマンド前の停止→全実行終了→600,000ms超待機の案内順序、コピー待機中の成功非表示、拒否/Clipboard不在時の失敗表示・選択維持を追加した。4件すべてのREDを取得した（`/tmp/yose62-setup-red.log`）。coverage_ui_reviewのPhase 1/3再レビューはPASSである。先の全体収集は途中停止し、最終結果として扱わない。コピー完了をawaitし、例外時は手動コピーを案内する。setup:gasではコードpush/公開コマンドより前に鍵登録と移行の必須条件を案内する。

## 最終独立レビュー

一覧/個別取得の一致確認を含むGAS最終実装はauth_review・settlement_reviewのPhase 5再レビューでともにPASSである。配備案内・コピー待機/失敗通知を含む全体差分はcoverage_ui_reviewのPhase 5再レビューでPASSである。実装の指摘残件は0件である。これを全対象ファイル各97%ゲートの達成と同一視せず、総合Grade A+・マージ承認とは判定しない。

## 検証の限界

GAS、PropertiesService、LockService、Spreadsheetはローカルのモックである。保存後の再読一致と障害時中断を試験するが、実Googleの障害耐久性・並列実行・割当/CORS/OAuthは保証しない。コピー試験は実Chromium内のClipboard APIを制御し、OSのクリップボードそのものを検証しない。setup:gasは案内ソースの順序を検証し、実デプロイを実行しない。公開先では専用設計の停止移行と旧要求拒否・新署名成功の受入が別途必要である。

## 全体試験の通信切断NGとPhase 3再入

`/tmp/yose62-coverage-accepted.log` の全体収集はNode1,057件成功、UI実ケース470件成功の後、passkey_prfのファイル単位でread ECONNRESETのuncaughtExceptionが発生し、UI全体は470/471で失敗した。この結果を全体合格と扱わない。beforeEachの表示は非同期資源の作成元であり、そのawait漏れや発生pipe/発生段階をこのログだけでは断定しない。独立レビューでCDPの全pipeのerror未管理とexitだけを待つ終了処理を確認した。

Phase 3へ戻り、稼働中のpending有無・read/write・終了中のECONNRESET/EPIPE・回収中障害・終了中の別I/O障害・exit後のclose待ち・再closeの7ケースを追加した。修正前6件の失敗と回収中障害を拒否する既存動作1件の成功を確認した（`/tmp/yose62-transport-red.log`）。coverage_ui_reviewの設計/テスト再レビューはPASSである。全pipeの障害を管理し、稼働中の最初の障害はpending拒否・次send/closeの失敗へ伝播させる。最後の回収試行が終わってから意図的な終了へ移り、その後のECONNRESET/EPIPEだけを限定処理する。spawn直後に保持したchild closeまで待って終了し、例外をグローバルに握りつぶす処理は追加しない。

通信基盤の7回帰は成功したが、対象3ファイルの合計57件中56成功、既存パスキー解除/再読込後の解除ボタン操作1件は非表示で失敗した（`/tmp/yose62-transport-focused.log`）。暗号や通信の実装不良とは混同しない。既存のメタ情報遅延回帰が検証済みの実finishAppInit Promise待ちを、当該ケースの初回解除と再読込後解除にも適用し、詳細展開後の対象ボタン可視/操作可能を確認する。待ち秒数延長や本番認証変更で対処しない。

補強後のcoverage_pipeline・passkey_prf・gas_key_setupは57/57成功である（`/tmp/yose62-transport-focused-final.log`）。通信障害の握りつぶしやassertの削除を行わず、実初期化完了待ちを使うテスト修正と基盤実装の再レビューはcoverage_ui_reviewでPASSである。この後の全体試験を最終受入結果として記録する。

## 最終全体検証結果

最終収集ログは`/tmp/yose62-coverage-release.log`、生記録/原本manifestは`/tmp/yose-coverage-1XSS9Z`、レポートは`coverage/`である。`coverage/execution.json`はnodePassed/uiPassedともtrueであり、49対象原本の計測前後と現在のSHA-256一致も別途確認した。

| 検証 | 結果 |
| --- | --- |
| TAB・構文・型・GAS生成ブロック一致 | 合格である |
| 単体・結合・システム | 1,057/1,057成功、失敗/取消/skip 0である |
| 実Chromium UI | 477/477成功、失敗/取消/skip 0である |
| 全体カバレッジ | Line 97.39%、Branch 85.27%である |
| 全対象ファイル各97%ゲート | 33ファイルで未達である |

変更した業務原本のファイル全体値は、GASがLine 98.06%/Branch 81.32%、SyncManagerが98.88%/88.94%、SettingsControllerが88.14%/65.31%である。今回差分だけの値とは呼ばない。`test:coverage`の最終終了値1は各97%ゲートによるものであり、全テストの成功と区別する。既存部分を含む全体改善は本人指定に従い別件である。機能差分の是正と独立レビューの指摘対応は済んでいるが、総合Grade A+・マージ承認とは判定しない。PR文面は[review62_pr](review62_pr.md)である。本番の設定変更・配備・push・リモートPR作成は実施しない。
