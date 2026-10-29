# 13,000件の変更前後比較

これはreview66候補の履歴である。是正後の現候補の再測定は[review67性能記録](review67_performance.md)を参照する。

## 測定条件

変更前を2026-10-28、最終候補を2026-10-29に、同じ実Chromium・IndexedDB・AES・実Ed25519署名で測定した。対象はmain a74bac0の固定コピーと1.21.0最終候補である。各候補は独立した新規ブラウザー/DBに同じ13,000件の暗号化明細を用意した。通信は即応モックであり、UI再描画・本番GAS・実ネットワーク・実端末の時間は含まない。各操作は1回の測定であり、平均値や応答時間SLOの達成を意味しない。

単一編集は明細cacheがcoldの状態で開始する。無変更同期と並行編集は先行操作後のwarm状態であり、同じ操作順序を両候補に適用した。復号API呼出回数とは別に、実際のcrypto.subtle.decryptを数えた。書込はtransactions object storeだけの回数である。

## 結果

| 操作 | 変更前 | 改善後 | 実AES復号 前→後 | 明細put 前→後 | 全clear 前→後 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 単一編集（cold） | 4,108ms | 682ms | 13,003→13,000 | 13,000→1 | 1→0 |
| 無変更双方向同期（warm） | 9,812ms | 1,880ms | 104,013→7 | 26,000→0 | 2→0 |
| 別々の2件の並行編集（warm） | 8,448ms | 1,377ms | 39,006→2 | 26,000→2 | 2→0 |

両候補の並行編集でCAS再試行を1回確認し、整合性/競合保護を省略していない。pageErrorsは両候補とも空であった。全明細の復号API呼出自体は残るが、warm時は認証済みの暗号文cacheをcloneで再利用する。cold時の実復号が必要なことと、全件CAS・全件検証のCPU負荷が残ることは区別する。

## 証拠

- 共通計測scriptは/tmp/yose66-performance-precise.mjsである。rootDirだけを切り替え、署名/通信モック/データ/操作順を共有した。
- 変更前はgit archive a74bac0で固定した/tmp/yose66-baseline-mainを使用した。
- 変更前JSONは/tmp/yose66-performance-before-precise.log、改善後JSONは/tmp/yose66-performance-release.logである。
- 最終候補のDB/暗号/同期/生成logicの11原本を/tmp/yose66-performance-release-source-manifest.jsonへSHA-256で記録し、測定後に原本一致を確認した。中間候補の/tmp/yose66-performance-after-precise.log、/tmp/yose66-performance-after-final.logと旧manifestは履歴として保持し、最終値へ流用していない。
- 別途、実UIで同期fetchを保留した13,000件の登録→編集→削除は、各ローカルcommitとDOM反映がfetch解放前に完了し、各変更の明細put1・clear0であることをtransaction_large_localで検査する。

これは局所測定の証拠であり、全テスト/各ファイル97%の総合受入とは別である。
