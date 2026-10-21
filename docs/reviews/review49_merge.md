# Review 49 共有マスタ競合の項目別解消

## Phase 1 設計

対象は `js/logic/master_sync.js` の純粋な三方向マージと競合解消である。初回base推定、三方向比較規則、ID配列順序、文字列集合の合成、optional値の比較規則は変更しない。

既存の `mergeMasterConfigs` の `config` と `conflicts` を維持し、追加の `conflictDetails` 配列を返す。各詳細は `id`（列挙順の `conflict-0` 形式）、既存互換の `path`、日本語の `label`、安全な構造化 `segments`、`localValue`、`remoteValue`、`hasLocal`、`hasRemote` である。値は入力と共有しない複製であり、undefinedは欠落として表現し、明示null・空配列と区別する。

`segments` はオブジェクトのフィールド名文字列とID配列の `{ id: string }` トークンで構成する。既存 `path` は表示互換用に維持するが、値の参照・書込には使用しない。IDにドットが含まれても別フィールドに分割しない。ルート全体の競合は空のsegmentsで表す。

日本語ラベルはコレクション名、レコードの名称、項目名を表示する。口座、費目、中項目、定期設定、祝日、年度予算と主要フィールドを日本語へ変換する。名称のないレコードは「名称未設定の項目」とし、raw IDを主要ラベルにしない。

新規 `resolveMasterConflicts(mergeResult, choices)` は実JavaScriptのMapのみを受け取り、全競合に `local` または `remote` が指定されていることを必須とする。未選択、未知ID、不正な選択値、重複競合ID、不正なsegments、危険キーを拒否する。競合のない結果には空Mapを受け取り、そのまま複製したconfigを返す。

解消はマージ済みconfigの複製に対して構造化segmentsで実行し、競合部分だけを置換する。ローカル・リモート・base・mergeResult・choicesを変更しない。ID配列の親全体が欠落している競合は該当IDを削除し、リモート採用時は該当レコードを追加または置換する。欠落フィールドはdelete、明示nullと空配列はそのまま保存する。ルート競合は全体置換となる。入力値、config、詳細、segmentsの危険キーを拒否し、フィールド名をprototype参照として解釈しない。

参照整合の最終検証はSyncManagerが送信前に既存 `assertMasterReferences` を用いて行う。純粋ヘルパーは任意のroot leaf・配列全体にも適用できるため、ドメインの参照検査を解消処理へ強制しない。

## Phase 3 先行テスト観点

- 日本語ラベルと既存path/config/conflicts維持、IDのドットと階層の区別。
- scalar、ルート全体、オブジェクト/配列全体、親削除と子編集、欠落フィールド、null、空配列。
- 複数競合のlocal/remote混合採用と非競合変更の保持、同値変更と競合なし。
- 全選択必須、未知ID、不正側、Map以外、詳細の重複ID、不正segments、安全キー拒否。
- 入力とマージ結果の不変性、返却値から元オブジェクトへ変更が漏れないこと。

参照整合エラーは、設定レコード名（名称がなければID）、対象項目（計上/実態の費目・中項目・口座等）、存在しない参照先IDを含む文言とする。解消画面内でエラーを表示し選択を変更できるよう、選択検査と送信前検査に同じ `assertMasterReferences` を使用する。UIはRecordを返し、SyncManagerの境界で厳密検証した後、純粋ヘルパー用のMapへ変換する。

## Phase 2 設計レビュー

独立レビュワー `independent_review` のPhase2設計レビューはPASSである。親削除の両方向、カテゴリ・中項目・年度費目のドット付きID、危険キー、不正segments、非競合変更維持を先行テストで検証する。

## Phase 3 テスト先行・レビュー

`test/unit/master_conflict_resolution.test.js` の13件を先行実装し、`resolveMasterConflicts` 未exportによるREDを確認した。独立レビュワー `independent_review` は、親削除両方向、構造化segmentsと旧path衝突の区別、年度費目キー、null/欠落/配列、Map検証、安全キーと不正segments、非変異、非競合保持、具体的な参照エラーを確認し、Phase3をPASSとした。

## Phase 4 実装・検証

共有マスタの純粋ヘルパーに競合詳細と項目別解消を追加し、参照エラーの文言を改善した。`npm run check:syntax` と `npm run check:types` はPASS、新規13件と既存共有マスタ17件は全30件PASSである。rootleafや型の異なる全体競合を扱うため、解消ヘルパーへドメイン参照整合を強制せず、SyncManagerの選択検査・送信前検査で参照整合を検証する。

## Phase 3 表示辞書の横展開点検

自己点検で未知フィールド `toString` が日本語ラベル辞書の継承プロパティを参照する表示不具合を発見した。14件目の先行テストを追加し、期待する「項目「toString」」に対しnative functionの文字列が表示されるREDを確認した。ラベル辞書をown propertyのみに限定する修正方針でPhase3へ再入する。

独立レビュワーは追加の14件目を確認しPhase3再PASSとした。辞書参照を `Object.hasOwn` に限定して修正し、syntax・typeともPASS、新規14件と既存17件の全31件がGREENとなった。最初の13件に対する独立実装レビューはPASSであり、追加1行の最終確認を依頼した。

## Phase 5 独立実装レビュー

独立レビュワー `independent_review` は、追加のown-propertyガードを含めて最終コードレビューをPASSとした。既存マージ規則を維持し、構造化パスで競合部分のみを更新し、安全キー・選択・欠落値・非変異を検証する実装に未解決のコード指摘はない。最新の担当範囲テストは全31件PASS、syntax/type/indentと差分空白検査もPASSである。全体カバレッジとUIを含む最終受入は親担当の統合検証で別途判定する。

## Phase 1 再入: 参照値の名称表示

390px幅の実画面確認で、中項目の競合値がraw IDだけでは採用判断しにくいことを確認した。競合詳細へ任意の `localDisplayName` と `remoteDisplayName` を加え、各sideの元マスタから参照先の名称を取得する。口座・費目は名称、中項目は「費目名 > 中項目名」とする。計上中項目は同side親recordの `category_id`、実態中項目は `actual_category_id` の費目配下だけを検索する。別sideや別費目から名称を推定しない。参照欠落・null・空文字・削除・配列/オブジェクト全体では従来表示を維持する。元IDは残し、UIは名称と元IDをtextContentで表示する。表示メタ情報はconfig・選択適用・送信payloadへ混入させない。

独立レビュワー `independent_review` は上記のPhase2設計をPASSとした。

参照名称の先行pureテストを3件追加し、既存14件GREENと新規3件REDを確認した。独立レビュワーはside別の口座/費目名称、計上実態親限定の中項目名称、欠落・特殊値fallback、HTML文字列保持、解消configへの表示メタ非混入を確認しPhase3再PASSとした。名称参照ヘルパーと任意メタ情報を実装後、syntax/typeともPASS、pure17件と既存共有マスタ17件の全34件がPASSした。

参照表示名の追加に対する独立最終コードレビューもPASSである。各side元マスタと計上/実態親配下の参照解決、文字列IDと実名ありへの限定、optionalメタのみの追加でraw値・config・送信payloadを変更しないことを確認した。
