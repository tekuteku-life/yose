# 一括編集のキャンセルと戻る操作の是正

2026-10-27の本人指摘を受け、開発プロセス定義書の手戻り規則に従いPhase 1へ再入した。review64の未コミット候補へ追加する是正であり、過去の全体カバレッジ不合格は取り消さない。

## Phase 1

R/E/I-3.64と一括編集詳細設計へ、常時表示するキャンセル/保存、入力領域のみのスクロール、共通閉じる処理、戻る時の履歴復元、未保存破棄確認/保存中保護、原本/選択保持の契約を追記した。現checkoutにはbulkを扱うcloseTopModalが既に存在するため、本人環境の戻る現象と現在の再現結果を区別して調査する。

## 工程の状態

design_ui/design_securityのPhase 2設計レビュー、補強後のtest_auditorのPhase 3再レビュー、独立コードレビューはPASSである。rootが本番を実装し、Phase 4の静的検査と最終全テストも成功した。各ファイル97%未達のためPhase 5総合受入は不合格であり、Phase 6へ進めない。

## 原因と横展開調査

design_ui/design_securityは独立した実Chromium probeで、キャンセルの欠如と、入力を下へスクロールすると×が画面外となる構造を再現した。390×640と390×500等で確認した。原因はmodal全体のoverflow-y:autoと操作フッターの欠如である。記録は/tmp/yose64-bulk-close-probe.logと/tmp/yose64-bulk-navigation-probe.logである。

現checkoutでBackの本人現象は再現しなかった。未変更は無確認で閉じ、変更中は破棄確認1回で拒否時保持/承認時閉じ、保存中は保持した。各例でyoseGuardを復元しnative dialogはない。既存履歴経路は維持し、この事実を再現したとは扱わない。共通経路の退行を追加回帰で捕捉する。

## Phase 3先行検証

初回は新規15件中8成功・7失敗である（/tmp/yose65-navigation-red.log）。戻るを含む既存の閉じる経路は成功し、キャンセル操作と4寸法の操作表示が失敗した。保存中の試験は欠けたキャンセルのdisabled参照がTypeErrorになったため、存在とdisabledを合わせた明示assertへ補強した。先行検証の独立レビュー後に本番実装へ進む。

補強後も8成功・7失敗であり、保存中はキャンセルの存在/無効状態に対応するassertで失敗した（/tmp/yose65-navigation-red-reviewed.log）。design_securityのPhase 2設計レビューもPASSである。test_auditorは、scrollTop代入とdriver内部のscrollIntoViewだけではoverflow:hiddenでも試験が通る点を指摘した。Phase 3へ戻り、実wheel入力後の入力領域のscrollTop増加・背景scrollY不変・外側modal非スクロールを直接assertするよう補強した。

補強後のtest_auditor再レビューはPASSである。Phase 4で一括編集専用のflex構成と入力領域のoverflow-y:auto、明示キャンセル、既存requestClose/setBusyへの接続を実装した。既存coordinatorの履歴/キー/背景制御は変更していない。新しい履歴リスナーやDB/API変更は追加しない。

当初は未公開1.20.0候補への是正として同版維持を予定したが、プロセス定義書のすべての改修での版上げと、既に1.20.0キャッシュがあるプレビュー環境の更新を考慮し、1.20.1へ5箇所とlockfileを同期する。進行中の初回統合測定は原本固定を守って完了させ、版同期後に静的検査と全体統合測定を再実行する。初回測定を最終版の証拠へ流用しない。

## Phase 4検証とPhase 5

実装直後のnpm run lintはTAB・構文・型・GAS生成一致が成功した（/tmp/yose65-phase4-lint.log）。関連UI82/82成功、失敗/取消/skip 0である（/tmp/yose65-focused.log）。design_uiは別途新規UI15/15成功を独立確認し、design_ui/design_securityの今回コードレビューはPASSである。390×640の実画面では入力領域scrollTop737でも閉じる・キャンセル・保存が画面内にあり、ページ横はみ出しはない（/tmp/yose65-bulk-preview.log、/tmp/yose65-bulk-mobile.png）。

test_auditorの独立実装/試験レビューもPASSである。初回1.20.0測定はNode1101/1101・UI550/550成功、失敗/取消/skip 0、Line97.47%/Branch85.46%、33ファイルで各97%未達であった（/tmp/yose65-coverage-final.log、生記録/tmp/yose-coverage-WZWKyE）。全測定終了後、報告を/tmp/yose65-first-coverage、原本を/tmp/yose65-first-sources.tarへ保存してから版を変更した。

1.20.1への全版情報/lockfile同期後、テストより先にnpm run lintを実行し全静的ゲートが成功した（/tmp/yose65-release-lint.log）。design_securityは保存した初回原本と現原本をバイト比較し、差分が版情報/キャッシュ/build_timeのみでUI本体の変更がないことを確認して再レビューPASSである。

## 最終全体結果と到達点

最終1.20.1計測はNode1101/1101・実Chromium UI550/550成功、失敗/取消/skip 0である。全体Line97.50%/Branch85.47%、33ファイルで各97%未達である。51本番原本のSHA-256は計測前後と現原本で一致した。実行ログは/tmp/yose65-coverage-release.log、生記録/manifestは/tmp/yose-coverage-1mdPW6である。[最終計測と全未達一覧](review65_coverage.md)を正とする。npm run test:coverageの終了値1は各97%基準によるもので、テスト失敗ではない。

design_ui/design_security/test_auditorは今回のroot実装を独立レビューしてPASSである。版同期も独立確認した。機能/コードレビューのPASSを総合Grade A+やマージ承認へ読み替えない。Phase 5総合受入は不合格、Phase 6は未到達であり、コミット・push・リモートPR作成は行わず、未コミット差分と[PR草案](review64_pr.md)を保持する。

本人の戻る時の離脱警告は現checkoutでは再現しなかった。既存履歴経路は変更せず、未変更の戻るで閉じること、変更中は破棄確認1回のみで拒否/承認を扱うこと、保存中は保持することを実Chromium回帰へ追加した。キャンセル欠如と操作の隠れは先行REDで捕捉して修正した。公開GAS/実Spreadsheet、実機タッチと配布先PWA更新の保証はローカル試験に含まない。

test_auditorは最終の実行JSON・原本manifest・全未達一覧・版同期・工程到達点・PR草案の記録整合性も独立確認しPASSである。この記録レビューのPASSは各97%未達の総合受入を承認するものではない。最終文書の構文/Mermaid検査とgit diff --checkも成功した（/tmp/yose65-final-doc-syntax.log）。

## 本人指示によるローカルコミット

その後、本人から「コミットまでして」と明示指示を受けた。本人指示を優先し、設計・先行試験・本番実装・レビュー記録の単位でローカルコミットへ保存する方針へ変更した。これは各97%基準の免除やPhase 5総合受入の合格、マージ承認を意味しない。全体受入は不合格のままとし、push・リモートPR作成・マージは行わない。本番原本の最終計測との一致を再確認し、文書の指示反映だけを追加したため、全テストの再実行は行わない。
