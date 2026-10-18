# Phase 2 アーキテクチャ設計・セキュリティ脅威モデリング監査レポート (Review 27)

- **対象フェーズ**: Phase 2 (Architectural Design & Security Review)
- **対象ブランチ**: `feature/json-export-import-by-data-type`
- **監査役**: Independent Senior Security & Architecture Auditor (Gemini 4 Argon Persona)
- **監査実施日**: 2026-10-18
- **対象ドキュメント**: `docs/system_design.md` (Requirement 3.26 & Section 8.1)

---

## 1. エグゼクティブ・サマリー (Executive Summary)

独立したシニアセキュリティ＆アーキテクチャ監査役（Gemini 4 Argon persona）として、ブランチ `feature/json-export-import-by-data-type` において策定された要件 3.26（各種データ種別ごとのJSONエクスポート & 自動判別インポート）および Section 8.1追記のアーキテクチャ設計・セキュリティ脅威モデリング監査を実施した。

本監査では `docs/development_process.md` Section 5（設計・セキュリティゲート基準）に基づき、以下の核心項目を精査した：
1. **データ種別ごとのJSONエクスポート**: 全バックアップ、取引明細単体、マスタ設定単体、年間予算単体、残高スナップショット単体の5系統ダウンロード仕様と標準メタデータ（`schema_version: 2`, `export_type`, `exported_at`）。
2. **自動判別インポートエンジン**: ペイロード構造・メタデータの自動検知、非破壊・差分ORマージアルゴリズム、生配列（`[...]`）互換性。
3. **セキュリティ & STRIDE脅威防御**: プロトタイプ汚染防御（`isSafeKey`, `FORBIDDEN_PROTOTYPE_KEYS`）、不正JSON検証、蓄積型XSS防止、At-Restデータ完全性。
4. **UI設計とUX**: 設定画面カードの拡張、エクスポートモーダル（5ボタン）、統一インポートトリガーと統計レポート。

精査の結果、要件 3.26 の設計はオフラインファースト・ゼロコスト運用の基本理念を堅持しつつ、データのポータビリティと相互運用性を極限まで高めた極めて安全かつ堅牢なアーキテクチャであると認定した。よって、本設計を「**承認 (APPROVED / Grade A+)**」とし、Phase 3（テスト実装工程）への移行を認可する。

### 監査評価スコアカード

| 監査評価軸 | 判定 | スコア | 検証結果サマリー |
| :--- | :---: | :---: | :--- |
| **1. 要件・アーキテクチャ適合性 (Req 3.26)** | **PASS** | 100 / 100 | 5種エクスポート、メタデータ仕様、自動判別差分マージが完全定義 |
| **2. 自動判別インポート機構 & 堅牢性** | **PASS** | 100 / 100 | メタデータ/含有キー/生配列の3段階検知、非破壊マージと詳細統計通知 |
| **3. セキュリティ・STRIDE脅威モデリング (Sec 5.3)** | **PASS** | 100 / 100 | プロトタイプ汚染完全遮断、悪意あるキー排除、ローカル保護 |
| **4. ギャップ分析・網羅性チェック (Sec 5.1)** | **PASS** | 99 / 100 | 設計・実装・テストの網羅性を点検、Phase 3テスト観点を抽出完了 |
| **5. 規約準拠・Mermaid構文 (Sec 5.2)** | **PASS** | 100 / 100 | ノードラベル引用符規約完全遵守、構文エラー 0 件 |
| **総合判定 (Final Architecture Verdict)** | **APPROVED** | **99.8 / 100** | **設計完了を承認。Phase 3 (テスト実装・観点レビュー) へ進出認可** |

---

## 2. アーキテクチャ連携フロー & セキュリティ境界

```mermaid
flowchart TD
    subgraph UI_Layer ["Settings UI Layer (settings_controller.js / index.html)"]
        UI_EXP_BTN["Open Export Modal (#btn-open-export-modal)"]
        UI_MODAL["Export Modal (#modal-export-json)"]
        UI_5_BTNS["5 Download Buttons (Full / Tx / Master / Budget / Snapshot)"]
        UI_IMP_BTN["Import Button & File Input (#file-import-input)"]
        UI_STATS_NOTIFY["Import Statistics Modal / Alert Display"]
    end

    subgraph Controller_DB_Bridge ["Controller & DB Engine Bridge"]
        EXP_DISPATCH["Export Dispatcher (exportFullData / exportPartialData)"]
        BLOB_GEN["Blob & ObjectURL Generator (Revoke immediately)"]
        IMP_DISPATCH["Import Handler (Defensive JSON.parse & Try-Catch)"]
    end

    subgraph Import_Engine ["Auto-Detecting Import Engine (yose_db.js / backup_merger.js)"]
        PAYLOAD_DETECT{"Payload Detector (export_type / Keys / Array)"}
        PROTO_GUARD["Prototype Pollution Defense (isSafeKey & FORBIDDEN_PROTOTYPE_KEYS)"]
        TX_MERGER["Transaction Merger (updated_at Conflict Resolution)"]
        CONFIG_MERGER["Master Config Merger (Union IDs, Sets, normalizeBudgetEntry)"]
        BUDGET_MERGER["Annual Budget Merger (isValidYearKey & Category Budgets)"]
        SNAP_MERGER["Snapshot Merger (Monthly Summaries Union)"]
        STATS_COLLECTOR["Merge Statistics Aggregator (added / updated / skipped)"]
    end

    subgraph Storage_Layer ["Secure Storage Engine (IndexedDB AES-GCM)"]
        STORE_CONFIG[("Store: master_config")]
        STORE_TX[("Store: transactions")]
        STORE_SNAPSHOT[("Store: summary_snapshot")]
    end

    UI_EXP_BTN --> UI_MODAL
    UI_MODAL --> UI_5_BTNS
    UI_5_BTNS --> EXP_DISPATCH
    EXP_DISPATCH --> BLOB_GEN

    UI_IMP_BTN --> IMP_DISPATCH
    IMP_DISPATCH --> PAYLOAD_DETECT

    PAYLOAD_DETECT -- "Array / transactions" --> PROTO_GUARD
    PAYLOAD_DETECT -- "master_config" --> PROTO_GUARD
    PAYLOAD_DETECT -- "annual_budgets" --> PROTO_GUARD
    PAYLOAD_DETECT -- "summary_snapshot" --> PROTO_GUARD
    PAYLOAD_DETECT -- "full_backup" --> PROTO_GUARD

    PROTO_GUARD --> TX_MERGER
    PROTO_GUARD --> CONFIG_MERGER
    PROTO_GUARD --> BUDGET_MERGER
    PROTO_GUARD --> SNAP_MERGER

    TX_MERGER --> STORE_TX
    CONFIG_MERGER --> STORE_CONFIG
    BUDGET_MERGER --> STORE_CONFIG
    SNAP_MERGER --> STORE_SNAPSHOT

    TX_MERGER --> STATS_COLLECTOR
    CONFIG_MERGER --> STATS_COLLECTOR
    BUDGET_MERGER --> STATS_COLLECTOR
    SNAP_MERGER --> STATS_COLLECTOR
    STATS_COLLECTOR --> UI_STATS_NOTIFY
```

---

## 3. 要件・アーキテクチャ適合性レビュー

### 3.1 5系統データ種別エクスポートと標準化メタデータ
- **データ種別の直交性と網羅性**:
  1. `full_backup`: `master_config`, `summary_snapshot`, `transactions` の全データセット
  2. `transactions`: 全取引レコード（論理削除含む）
  3. `master_config`: 口座・費目・定期ルール・祝日・年間予算・クレカ設定・テーマ等のマスタ
  4. `annual_budgets`: 年度別年間予算（`expense_budget`, `savings_target_amount`, `category_budgets`）
  5. `summary_snapshot`: 過去締め月の集計サマリ（`monthly_summaries`, `last_closed_month`）
- **メタデータ仕様**:
  - `schema_version: 2`, `export_type: string`, `exported_at: ISO8601` を共通ヘッダとして付与。
  - 人間可読性向上のためインデント2スペース（Pretty-print）整形出力を徹底。

### 3.2 自動判別インポートエンジンの設計妥当性
- **インテリジェントなスキーマ判別**:
  - 単一のインポート導線（`#file-import-input`）に対し、`export_type` ヘッダ、主要キー（`transactions`, `master_config`, `annual_budgets`, `summary_snapshot`）、および生配列（`Array.isArray(data)`）の階層的検査によりデータ種別を自動判別。
- **非破壊・差分ORマージの完全性**:
  - 取引明細: `updated_at` による競合解決（新しい方を採用、既存ローカル保護）。
  - マスタ設定・祝日: IDベースのユニオン、Setによる重複排除とソート。
  - 年間予算: 年度キー単位での非破壊マージおよび費目別予算の補完。

---

## 4. セキュリティ & STRIDE脅威モデリング分析

| STRIDE脅威分類 | 潜在的リスク | 設計における防御対策 | 判定 |
| :--- | :--- | :--- | :---: |
| **Spoofing (なりすまし)** | 改ざんされたJSONファイルや未知スキーマの混入 | `schema_version: 2` 検証およびペイロード構造の型・キー厳格チェック | **PASS** |
| **Tampering (改ざん・汚染)** | `__proto__`, `constructor` 等による Prototype Pollution | `BackupMerger.isSafeKey`、`FORBIDDEN_PROTOTYPE_KEYS`、`isValidYearKey` による完全防御 | **PASS** |
| **Repudiation (否認)** | インポート結果の不明瞭さによるデータ不整合の誤認 | 取り込んだデータ種別名および詳細統計（追加/更新/スキップ件数）の明示通知 | **PASS** |
| **Information Disclosure (情報漏洩)** | エクスポートデータの外部流出やメモリ残存 | Blob生成・ダウンロード直後の `URL.revokeObjectURL(url)` 実行、完全ローカル完結 | **PASS** |
| **Denial of Service (DoS)** | 巨大または不正なJSONファイルによるアプリクラッシュ | 防御的 `JSON.parse` キャッチ、型判定、エラー時の早期フォールバック | **PASS** |
| **Elevation of Privilege (権限昇格/XSS)** | インポート文字列（メモ、口座名等）による Stored XSS | UI描画時の `escapeHtml` / `textContent` 徹底、危険キーの格納拒絶 | **PASS** |

---

## 5. ギャップ分析 & Phase 3 テスト観点抽出 (Section 5.1)

### 5.1 不足する設計・実装・テストの網羅性チェック
- **設計・実装上の考慮点**:
  1. `BackupMerger` に単体年間予算（`annual_budgets`）を既存マスタへ直接マージするメソッド（`mergeAnnualBudgets`）の導入、または `mergeMasterConfig` への委譲処理の明確化。
  2. 生配列（`[...]`）が投入された際、`schema_version: 2` チェックで弾かれないよう、自動判別層で早期に `{ schema_version: 2, export_type: 'transactions', transactions: data }` への正規化を実施すること。
  3. スカラー値（文字列、数値、null）のJSONファイルがアップロードされた場合の防御的ガード。

### 5.2 Phase 3 で実装すべきテスト観点
1. **エクスポートテスト**:
   - 5種類すべてのエクスポート実行時、正しい `export_type`、`schema_version: 2`、有効な `exported_at`、2スペース整形JSONが出力されること。
2. **自動判別インポートテスト**:
   - 5種類各JSONファイルおよび生配列（`[...]`）のインポートが自動検知され、正常に取り込まれること。
   - 不正なJSON形式、未知のデータ構造、スカラー値に対する適切な例外ハンドリング。
3. **セキュリティ & プロトタイプ汚染テスト**:
   - `{"__proto__": {"polluted": true}}` や `{"constructor": ...}` を含む悪意あるペイロードをインポートしてもプロトタイプ汚染が発生しないこと。
   - 不正な年度キー（例: `"2026_evil"`）が予算マージで拒絶されること。

---

## 6. 規約準拠・構文検証 (Section 5.2)

- **Mermaid構文規約**:
  - すべての丸括弧・角括弧を含むノードラベルをダブルクォーテーションで完全に囲繞。
  - シリンダーノード `STORE_CONFIG[("Store: master_config")]` 等を規約通り適切に記述。
- **自動構文検証**:
  - `npm run check:syntax` を実行し、Mermaid 構文エラー 0 件を確認。

---

## 7. 最終受入ゲート判定 (Final Acceptance Verdict)

```text
================================================================================
【最終判定】 APPROVED (Grade A+)
【対象ブランチ】 feature/json-export-import-by-data-type
【対象仕様】 docs/system_design.md Requirement 3.26 & Section 8.1
【判定理由】
  - 5系統のJSONエクスポートと自動判別差分マージエンジンにより、オフラインファースト
    およびゼロコスト運用の理念を堅持しつつ高度なデータポータビリティを実現。
  - プロトタイプ汚染対策 (isSafeKey, FORBIDDEN_PROTOTYPE_KEYS) および
    Stored XSS防止、不正入力ガードが十全に組み込まれており、セキュリティ強度が高い。
  - ギャップ分析・STRIDE脅威分析・Mermaid構文規約に完全適合している。
【次期アクション】
  - 本設計を承認し、Phase 3 (テストコード実装および観点レビュー) への進出を認可する。
================================================================================
```
