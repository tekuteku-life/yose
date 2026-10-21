# review51 サーバー・同期の変更境界整合性

## 先行監査と設計

`push_diff` / `retroactive_update` の型・日付・必須値・参照検査欠落、`update_master` の明細参照を破壊する削除、`close_month` の不正年月受理、外部資産の無検査更新を現行GASハンドラで再現した。明細のみ完全取込で締め済み金額5→50の変更に対して集計5が残り、初期残高変更にも閉月残高が追従しない。遡及月移動の途中書込失敗では旧archiveとpendingから原本が消失する。受信も明細・snapshotをmaster確認前に保存するため部分適用となる。

共通 `createDataIntegrityValidator()` の `assertChange(before, after, { strict })` をクライアントとGASで共有し、候補全体を保存前に検証する。通常変更では既存不整合の不変保持または減少だけを許し、新規不整合を拒否する。完全置換は厳格検証する。締め済み明細変更および初期残高変更は閉月summaryを再計算し、snapshot指定の完全取込では検証した明示値を尊重する。

GASの通常変更もメモリ上の書込集合にstageし、候補の検証後に永続journalと単一セルcommitを保存して適用する。中断後は読取・次変更の前に復旧する。新設master参照明細はmasterを先に同期し、受信はmaster競合確認・候補検証・暗号化DB一括commitの順とする。取消・不正応答・認証変更では部分受信を保存しない。

既存の同一更新時刻別内容に対するLWW規則は維持する。実データの自動推測修復および本番操作は行わない。

## 先行テスト観点

- 各変更actionの型・必須値・不正年月日・金額整数・重複ID・予約ID・boolean・参照・分類種別と親子関係。
- 未削除明細、定期設定、予算、snapshotを孤立させるmaster削除の拒否と原本保持。
- 非競合明細と不正明細が混在したバッチ全体の原本保持、既存不整合を減らす修復の許容。
- 明細完全置換と初期残高変更の導出summary再計算、明示snapshotの保持。
- 通常変更の各永続書込点での故障と次要求復旧、遡及月移動時の明細保持。
- 新設master→明細の送信順、master確認取消・不正受信時のDB原本保持、受信全体の一括適用。

## 実行・レビュー記録

設計レビューと先行テスト承認を待ってから実装する。

### 独立レビューと先行RED

独立担当 `review51_audit` によりPhase 2設計はPASSである。Phase 3では別受信入口、月締め・遡及入口のmaster先行、受信暗号化中のDMK・署名鍵変更を追加し、暗号化メタデータを維持する故障注入へ修正したうえでPASSを得た。

先行実行はGAS 59件中3件PASS・56件RED、同期15件中3件PASS・12件REDである。GASの既存不整合修復・不変保持等は従来から正常であった。新規不正値の受理、導出集計の不一致、保存中断、受信部分適用、master先行漏れをREDで固定した。構文検査はPASSである。

### 実装方針の具体化

GASの通常5変更actionは共通wrapperによりstageする。読取もstage済み値を参照し、書込集合の整合性を候補全体で検査した後に既存の永続journal/commit markerで適用する。`replace_import`も同じcommit関数を使用する。参照先の新規masterは明細送信前に同期する。受信・競合確認・暗号化commitはDB共通経路へ集約し、旧`fetchRemoteState`も同経路を使用する。

旧GAS正常系の一部はdate/status・口座等を欠くテスト用レコードを新規送信していた。型・必須値検査導入後の正常系として妥当でないため、製品の検査を緩めずSchema v2の入力fixtureへ補完する。

### Phase 1/3 再入: 履歴転送・読取原本・送信応答

独立レビューで、ローカル作成後にarchiveした分類を持つ明細の初回同期が、新規選択と誤判定され拒否される問題が判明した。署名済みpush/retroの履歴転送では参照存在の検査を維持しつつarchive参照を許容し、UI/DBの新規選択禁止と区別する。

業務sheetの既存JSON破損・読取例外を空defaultに変換すると次変更で原本が消失するため、業務sheetの読取はfail closedとする。汎用`loadJsonFromSheet`のdefault機能とは分離する。不正JSON・読取例外をmaster、pending、snapshot、archiveの各原本に注入し、変更拒否・読取拒否・rawsheet不変を確認する。

送信応答も受信境界である。push/retro/close応答のACK・競合明細・snapshotは共通DBの`commitSyncResponse`候補に合成・検査して一括保存し、送信時明細と一致する現行版だけをACKする。不正snapshot混在および暗号化中の署名鍵変更では、その応答直前の業務3storeをすべて保持する。先行テストでこれらを追加した。故障注入の準備段階では未締めsnapshotを設定し、元明細push/月締めの成功もassertして、元明細が存在することを保証する。

### Phase 1/3 再入: 実態中項目と未集計残高

独立レビューで、GAS月集計の実態中項目が`actual_subcategory_id || accounting_subcategory`で補完され、明示nullや異なる親費目に計上中項目を誤補完することが判明した。共通検査により不正snapshotは拒否されるが、正当な月締め自体を止めてしまうため、UI集計と同じく明示nullを保持し、未指定時だけ同じ親の計上中項目を補完する。実際の月締めで同親/別親×null/省略の4件を先行追加する。

月別summaryがゼロ件の場合も、初期残高変更ではsnapshot残高をmasterの初期値から再構成する。早期returnによる残高未反映を1件の先行テストで固定する。

## 最終検証

- 構文検査、静的型検査、GAS埋込validator同期検査はPASSである。
- GAS・同期の関連10ファイル298件はすべてPASSである。新規GAS74件、同期受信・応答境界23件を含む。ログは `/tmp/review51-server-regression-final.log` である。
- 追加担当した既存マスタ保守・IndexedDB原子性の21件もすべてPASSである。archive履歴fixtureは履歴受信APIで作成し、通常作成を試験するfixtureでは明細作成後に設定をarchiveする。raceと全原本保持のassertは維持した。ログは `/tmp/review51-maintenance-fixture-green.log` である。
- 独立担当 `review51_audit` の最終コードレビューはPASSである。指摘された受信経路、送信応答、履歴archive参照、GAS実態中項目補完を設計・先行テストへ戻して対応した。
- 完全取込の再計算snapshotはACKと送信待ち削除と同時に保存し、後続ダウンロードがないpending-only同期でも反映されることを実暗号化DB・署名GAS連携で確認した。
- masterを欠く旧応答では現在のmasterで受信候補を検証するが、共有基点を進行させず、手元の未送信masterを未同期のまま保持する。

本記録のPASSは担当範囲の検証と独立コードレビューを示す。全体のUI実行、カバレッジゲート、最終受入判定は親記録 `review51.md` に統合する。本番データ・本番GASは操作していない。

### Phase 1/3 再入: 差分取込の射影前検証

既存DBテストの正常fixtureを正規化した結果、差分取込のOR合成が不正キーや重複master IDを黙って捨て、候補検証を通過する入口が判明した。インポート全体を検証してから合成する契約に合わせ、`BackupMerger.validateImportData`で入力全体のunsafe key/IDを走査し、種別ごとのエンティティ配列ID重複を合成前に拒否する。単独`mergeMasterConfig`の既存skip仕様は変更しない。

root/master metadata/budget/transaction metadataの各階層×予約キー3種、master3配列/中項目/明細×unsafe ID/duplicate IDを先行追加し、先行する正当な行も含め業務3storeのraw原本が一切変わらないことを確認する。既存のprototype payloadテストも部分成功期待から全体拒否・原本保持へ強化する。

差分取込の射影前検査は22件中8件PASS・14件REDを先行確認し、deep unsafe key/IDとエンティティ配列ごとのID必須・重複検査追加後に全件PASSである。DB、マスタ管理、完全取込を含む関連5ファイル162件もすべてPASSである。ログは `/tmp/review51-import-raw-current.log` である。既存DBテストは不正payloadの部分成功を全体拒否へ変更し、業務3storeのraw原本保持を追加した。正常系は型・参照先のmaster fixtureを用意し、不正暗号エンベロープは業務作成APIを通さず既存rawデータとしてseedした。

射影前検査の追加についても独立担当 `review51_audit` のPhase 2/3および最終Phase 5レビューはPASSである。

### Phase 1/3 再入: 完全取込planとACK

完全取込の最終候補は参照だけでなく共通`dataIntegrity.assertChange(null,state,{strict:true,allowArchivedReferences:true})`へ委譲し、部分置換でも保持する業務全体を厳格検証する。prepareの確認planはインスタンス内WeakMapに内容fingerprintを記録し、commit開始時・暗号化後に変更を検査する。commitは最初にcloneしたplanだけを使用し、確認後や暗号化中のplan差替による未確認値保存を拒否する。

ACKのmaster/snapshotは省略undefinedと明示null/false/0を区別する。不正型を射影やoutbox削除の前に拒否する。accepted masterの厳格検証はsubmittedの明細範囲と応答snapshotに対して行い、送信後のlocal追加分類・明細までserver受理済みと誤認しない。業務適用候補は現在のlocal masterを保持してACK明細とsnapshotをno-new検査し、outbox・共有基点と同時にCASする。後日local追加の正常参照を保つ先行テストも用意する。

完全取込planの独立レビューで、fingerprint外の`plan.encryptionKey`とDBの鍵を双方置換すると確認が再有効化される不足を指摘された。WeakMapにprepare時のCryptoKey参照も保存し、planとDBの鍵がともに元参照と同一であることを必須とする。双方を新鍵へ差し替える先行テストを追加し、業務原本/outbox不変を固定する。

完全取込境界の先行28件は5件PASS・23件RED、元鍵差替の追加後は29件中28件PASS・1件REDで不足を確認した。修正後は新29件と既存完全取込・署名GAS・システム復旧を含む127件がすべてPASSである（`/tmp/review51-replacement-boundary-final.log`）。実ブラウザの完全取込UI12件もすべてPASSである（`/tmp/review51-replacement-ui-final.log`）。構文・型検査はPASSであり、元CryptoKey保存を含めた独立担当 `review51_audit` の最終コードレビューもPASSである。

### Phase 1/3 再入: 不正な旧明細の完全除去と最小削除記録

完全取込の候補検証後に旧行全体をspreadしてtombstoneを生成すると、除去対象の不正amount/date/type/metaを再導入し、ACK後の受信を停止させる。削除記録はsafe ID、`is_deleted:true`、有効な`updated_at`、同期状態だけの最小形とし、旧業務値を転記しない。削除行で省略した業務項目だけを許容し、同梱されたdate/month/type/status/amount等の型検査は維持する。safe IDと有効な更新日時は必須であり、安全に同定できない旧IDは推測せず拒否する。GASはtombstone生成・再計算後の保存集合全体もstrict検証する。

最小削除記録のexport→完全取込→同期の往復も同じ契約へ統一する。対象月を持たない削除を差分取込した場合、取得したarchiveの同IDから対象月を確認し、承認後の遡及ルートで各旧archiveを除去する。通常のpushで確認を迂回しない。定期明細の明示再生成では月のない削除原本もIDで照合する（UI担当範囲）。

旧不正値8種を除去する実暗号化DB＋署名GASシナリオ、完全往復、締め済みIDの最小削除、危険IDの原本保持、最小削除行の省略合法・明示不正拒否を先行追加する。

同設計の横展開で、旧更新日時が非文字列JSON objectの場合に`Date.parse`が例外となり、正当な除去も止まることを先行追加した。旧更新日時は文字列だけを安全にparseし、不正型・非有限値を0として版比較・確定時刻計算に用いる。不正な日時を保存可能にする変更ではなく、除去対象を比較する際に元業務値を信頼しないための処置である。

最小削除の先行22件は11件PASS・11件RED、旧非文字列日時の追加後は23件中22件PASS・1件REDを確認した。修正後は旧不正9種の除去・export完全往復、締め済み最小削除の承認と再計算・別端末反映を含む23件がすべてPASSである。最小削除初版の共通/GAS/完全取込262件は `/tmp/review51-tombstone-current.log` ですべてPASSし、旧非文字列日時追加後の23件は `/tmp/review51-role-clock-final.log` ですべてPASSした。最小削除記録とGAS生成後strict検証の独立最終レビューもPASSである。

親記録の前払役割再入に従い、共通validatorへ`amortization`問題codeを追加した。補助情報のroleは指定時boolean、親はtransfer・子はexpense、補助情報を持つ行は非空group_idを必要とする。旧expense子のrole省略は維持する。GASへ生成同期済みである。共通役割検証とGAS旧時刻safe比較は独立担当 `review51_audit` のPhase 2/3および最終Phase 5でPASSを得た。関連実行ログは `/tmp/review51-role-clock-final.log` である。親担当のDB単調時計・既存グループ配賦前拒否と合わせた全体結果は親記録へ統合する。
