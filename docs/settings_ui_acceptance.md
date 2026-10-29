# 設定画面の操作境界と受入

本書は外部設計3.68・3.73および認証操作設計に従う設定画面の追加受入契約である。鍵材料CASの設計と実装は[認証設計](auth_session_lifecycle.md)の責務であり、本書によって変更しない。

## 操作入口

通常の利用者操作は実Chromiumのpointer・keyboard・file選択で検査する。これとは別に、登録済みDOM listenerに届く遅延イベントのコンポーネント契約を検査する。後者はHTMLElement.clickまたはdispatchEventを明示して使用し、isTrusted=falseと実listener呼出回数をassertする。認証overlayを利用者が通過できるという主張には使用しない。busyや認証鍵を試験から代入して作った状態を使用しない。

| 境界 | 具体的な先行assert |
| --- | --- |
| 実lock完了後のPIN・GAS・JSON保存・JSON表示イベント | 各実listenerが1回呼ばれ、実DBの読取/transaction開始0、認証世代/全raw/通知不変、busyを取得しない |
| ファイル未選択のchange通知 | 実空FileListからlistenerを1回通り、File.text/DB/通知0、保存済み全raw不変 |
| 実テーマ選択後の非選択radioへの遅延change | 元radioが実際にunchecked、遅延listener1回、現在のthemeと永続値不変、追加DB書込0 |
| JSON取得のactive故障/失効後故障 | real読取の故障モデルを明示し、activeのみエラー通知する。失効後は新editor/draft/全raw/通知を保持する |
| ポイント設定の旧取得・commit応答・描画故障 | native選択した実draftで保存を開始する。同じ開始元predicateをDBへ伝播し、失効前のcommitは保持、未commitは全拒否、旧処理は新draft/busy/通知を変更しない |
| 選択後に他writerが分類をarchive | 許容masterの実writerでarchiveし、旧選択の保存は明示拒否、writer後の全rawを保持する |

raw比較はbusinessに加えてsecurity_keys/settingsの実キーと値を含む。DB呼出カウンタはraw比較自身のreadonly transactionを含めず、対象listenerの期間を明示して検査する。

追加のawait境界はPINの期待鍵取得・実DMK/秘密鍵export、GASの実commit応答、ファイル選択の遅延通知/実取込commit応答、設定描画の子処理/credential応答を対象とする。実APIの結果だけを保留し、その間に実lock/PIN解除と新draftを作る。原本のcommit有無と鍵/全store保持を確認する。例外のPromise伝播とcaller catchの間も別のmicrotaskであるため、helper内でvalid=trueだった失敗の後に実lockが入るモデルを検査する。暗号鍵やbusy/sessionを試験から代入せず、実lock APIと実Promiseの継続順序だけを制御する。catchの再検査を到達不能と決めつけて削除しない。

## 更新機能の環境境界

AbortController、sessionStorage、CacheStorageは外部設計3.73の任意APIである。Chromium自身の機能不足とは主張せず、実ページ上で該当APIだけを一時的に未提供とする明示した環境モデルを使用する。その他のDOM・fetch・IndexedDB・暗号・更新後reloadは実物を使用する。取得時のsignal不使用、更新表示、実reload後の財務/鍵raw保持をassertし、例外を握りつぶすだけの確認にしない。通常APIでの既存更新試験も維持する。

## 静的な整理候補

設定controllerはindex.htmlのdocumentを必須として構築・setupするDOM専用moduleである。更新2入口におけるtypeof windowの非ブラウザfallbackは到達しない。renderSettingsのconfigは同一同期区間の直前で非nullを検査済みであり、件数表示の再度のif(config)は重複する。これら3箇所だけを整理候補とし、任意API・旧データ・鍵非null・非同期失効guardは維持する。実装は独立Phase2/3承認後に行う。

## 完了条件

各試験の実listener Promise・実DB commit/abort・新draftの具体値・非干渉を検査する。局所PASSは固定4層全試験/各対象ファイルLine・Branch97%以上/独立Phase5の代用ではない。
