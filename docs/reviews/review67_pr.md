# PR草案

タイトル: `feat(workflows): 明細操作と同期応答の改善、認証を跨ぐ非同期処理の保護`

## 概要 / 背景 (Background)

13,000件を超える明細での連続操作と、締め済み月の修正が同期・再締め完了待ちに阻害されていた。同期結果で口座設定などの変更も把握できるようにし、一覧からの一括削除・予定確定・ポイント分類設定・予定生成の重複除外を追加する。受入点検で発見した、再認証後の旧処理による保存・通知・画面更新と、PIN変更/鍵再生成の競合も是正する。

要求と設計の正本は[改善要件](../transaction_workflow_improvements.md)、[非同期境界](../async_session_boundaries.md)、[認証](../auth_session_lifecycle.md)、[設計テスト監査](../design_test_audit.md)である。

## 変更内容 (Changes)

### 1. 設計上の変更・判断 (Design Decisions)

- 同期表示はcommit済みの明細件数と、口座・費目/内訳・定期予定・年度設定・投資評価などの業務項目を方向別に表示する。部分失敗時にも確定した結果を保持する。
- 一覧に一括削除と金額入力済み予定の確定を追加する。関連取引・締め承認・原本比較を維持し、対象全体を原子的に保存する。
- 保存時にdraftを固定し、フォームの無効化と進行表示を行う。保存後の表示と背景生成/同期を分離し、締め済み月の連続修正をまとめて再締めする。
- 復号結果は鍵世代ごとのcacheで再利用し、全件整合性検査/CASを維持したままIndexedDBへ変更明細だけを書き込む。旧ACKによって新しい編集を同期済みにしない。
- 予定生成は同ルール明細に加えて、同じ計上月・収支種別・両口座・費目/内訳・金額の手入力明細を1対1で充足へ対応させる。ポイント相殺分類は設定画面で既定値を指定する。
- 認証の開始元、画面draft、busy ownerの寿命を区別する。親predicateをDB・同期・子描画へ伝播し、旧処理が新しい入力・通知・処理中表示へ作用しないようにする。
- security_keysの期待値と存在を同一transaction内で比較し、PIN package・公開鍵・パスキー情報の更新/削除を原子的に確定する。旧暗号形式と既存API引数を維持する。
- 常設DOMと正規producerに支配される重複guardを整理し、任意API・旧データ・鍵材料存在・非同期失効の防御は維持する。coverageの対象除外や閾値緩和は行わない。

### 2. 対象ファイル一覧 (Modified / Added / Deleted Files)

- 新規追加は `js/logic/sync_changes.js`、`js/ui/form_busy.js`、`js/ui/sync_result.js`、`test/unit`・`test/integration`・`test/system`・`test/ui`配下の回帰試験、詳細設計・レビュー記録である。
- 変更対象は `js/db`、`js/sync.js`、`js/logic/transaction_factory.js`などの予定/ポイント生成、`js/ui`の入力/編集/一覧/設定/分析/認証controller、`gas/Code.gs`、`index.html`・`css/style.css`、版数/SWおよび仕様・監査である。
- 全明細clear/再put、同期前後の重複読取、未使用の専用外部資産renderer、証明済みの重複fallbackを整理した。

## 確認内容 (Verification Checklist)

- [x] システム全体の設計・データフローを先に定義した。
- [x] 要件・外部/内部設計の該当箇所へ先行反映した。
- [x] 設計テスト監査に設計ID・実assert・未検証境界を反映した。
- [x] 未使用コード・証明済みの重複guard/fallbackを整理した。
- [x] 外部Secretsの追加と認証鍵の平文永続化がないことを確認した。
- [x] ユーザー入力のHTML escape/textContentを維持した。
- [x] GAS最小scope `@OnlyCurrentDoc` を維持した。
- [x] TABインデント検査が成功した。
- [x] 構文・静的型・GAS生成一致検査が成功した。
- [x] 既存を含む文書のMermaid構文検査が成功した。
- [x] 独立レビューで不足する設計・実装・試験を点検した。
- [x] 不具合の横展開と先行RED・再入・再レビューを記録した。
- [x] 版数1.21.0を5箇所とlockで同期した。
- [x] 固定原本の4層全成功・全54ファイルLine/Branch各97%以上を確認した。
- [x] 最終11原本の13,000件性能再測定と独立Phase5を完了した。

## テスト結果 (Test Results)

公式 `npm run test:coverage` は終了値0である。単体・結合・システム1811/1811、実Chromium UI1206/1206が成功し、失敗・取消・skipは全て0である。全体Line99.79%・Branch97.94%、本番54ファイル全てが各Line/Branch97%以上となった。[各ファイル値と54原本SHA](review67_coverage.md)に最終1回の公式実行を記録した。入力420ファイルは計測前後で一致し、独立レビュワーも全1305 raw chunkと計算結果を再検証した。

13,000件の最終局所測定は単一編集694ms・無変更同期1860ms・並行2編集1370ms、明細put1/0/2・clear全0・CAS再試行1である。実GAS/回線・UI再描画を含まない各1回の測定であり、平均値/SLOの証明ではない。[性能記録](review67_performance.md)に途中候補との差と11原本の一致を記録した。

## レビュー結果 (Review Results)

実装著作者はroot・design_security・design_ui、独立レビュー担当はtest_auditorである。設計・先行試験・コードの各独立レビューと、指摘による上流工程への再入を[review67](review67.md)に保存した。認証の入口順・親predicate伝播・鍵CAS・新旧busy owner・legacy保持・fixtureの空比較/待機不足を是正した。最終コード/試験レビューに追加指摘はなく、公式結果と原本一致の独立再照合も成功した。総合Phase5 PASS、Grade A+であり、全コミット条件を満たす。

GAS変更は再デプロイを必要とする。実GAS/実回線・OSパスキーの本番確認、push・PR作成・merge・deployは実施していない。本草案はローカルレビュー用である。
