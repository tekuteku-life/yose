# Phase 2 アーキテクチャ設計 & セキュリティ監査レポート (Review 29)

- **対象フェーズ**: Phase 2 (Architectural Design & Security Review)
- **対象ブランチ**: `feature/donut-chart-and-tx-list-enhancements`
- **監査役**: Independent Senior Security & Architecture Auditor (Gemini 4 Argon Persona)
- **監査実施日**: 2026-10-18
- **対象ドキュメント**: `docs/system_design.md` (Section 3.27 - 3.30, Section 8.1)

---

## 1. エグゼクティブ・サマリー (Executive Summary)

独立したシニアセキュリティ＆アーキテクチャ監査役（Gemini 4 Argon persona）として、`docs/system_design.md` に追加された要件 3.27（費目別推移・内訳のドーナツグラフ可視化）、要件 3.28（各種ドーナツグラフのツールチップへのパーセント表示追加）、要件 3.29（明細一覧の表示階層刷新）、要件 3.30（明細一覧のマルチフィルタリング）、および Section 8.1（要件トレーサビリティマトリクス）に対する Phase 2 設計レビューを実施した。

本設計は既存のモジュラーUIアーキテクチャ（`SummaryController`, `ChartController`, `TxListController`, `YoseAggregator`）の責務境界を厳格に遵守しており、DOM XSS防御（`escapeHtml`）、ゼロ除算ガード、Chart.js インスタンスの適切な破棄管理（メモリリーク防止）、およびダークモード連動が網羅的に規定されている。設計品質およびセキュリティ設計ともに最高水準を満たしているため、Phase 3（テスト駆動実装）への移行を「**承認 (APPROVED / Grade A+)**」と判定する。

### 監査評価スコアカード

| 監査評価軸 | 判定 | スコア | 検証結果サマリー |
| :--- | :---: | :---: | :--- |
| **1. 要件・アーキテクチャ適合性 (Req 3.27-3.30)** | **PASS** | 100 / 100 | 4要件すべてのUI仕様・集計ルール・トレーサビリティが明確かつ整合 |
| **2. ギャップ分析・網羅性チェック (Sec 5.1)** | **PASS** | 100 / 100 | 資金移動時の表示フォールバック、0円時の非表示・ゼロ除算防御を完備 |
| **3. セキュリティ & 脅威モデリング (Sec 5.3)** | **PASS** | 100 / 100 | DOM XSS対策（全動的属性の `escapeHtml`）、安全な検索・Canvas管理を規定 |
| **4. Mermaid構文・ドキュメント規約 (Sec 5.2)** | **PASS** | 100 / 100 | ノードラベル引用符規約（`id["Label (Extra)"]`）準拠・構文エラー0件 |
| **総合ゲート判定 (Phase 2 Gate Verdict)** | **APPROVED** | **100 / 100** | **Phase 3 (Test-First Implementation) 進行承認** |

---

## 2. アーキテクチャ & データフロー図 (Mermaid Architecture Diagram)

```mermaid
flowchart TD
    subgraph UI_Controls ["UI Control Layer (index.html / summary_controller.js / tx_list_controller.js)"]
        AXIS_TOGGLE["Axis / Period Selector (Accounting vs Actual / Daily, Monthly, Yearly)"]
        FILTER_STATUS["Status Filter (#select-status-filter)"]
        FILTER_CAT["Category Filter (#select-category-filter)"]
        FILTER_TAG["Tag Filter (#select-tag-filter)"]
        FILTER_SEARCH["Keyword Search (#input-tx-search)"]
    end

    subgraph Logic_Engine ["Core Logic Layer (js/logic/aggregator.js)"]
        CAT_AGG["Category Breakdown Aggregator (Expense > 0, Sort Desc)"]
        TOOLTIP_FMT["Pure Helper: formatDoughnutTooltipLabel (Zero-Division Guard)"]
        MULTI_FILTER["Multi-Criteria AND Filter (Status + Category + Tag + Keyword)"]
        HIERARCHY_RES["Hierarchy Resolver (Category > Subcategory / Transfer Fallback)"]
    end

    subgraph Render_Layer ["Presentation & Chart Layer (chart_controller.js / tx_list_controller.js)"]
        CHART_CAT["Category Doughnut (#category-breakdown-chart)"]
        CHART_TAG["Tag Doughnut (#tag-chart)"]
        CHART_ASSET["Asset Doughnut (#summary-chart)"]
        XSS_GUARD["Security Boundary: escapeHtml(category, sub, memo, tags)"]
        DOM_TX_LIST["Transaction List DOM (.tx-title Primary / .tx-meta Secondary)"]
    end

    AXIS_TOGGLE -->|Trigger Recalc| CAT_AGG
    CAT_AGG -->|Sorted Items| CHART_CAT
    TOOLTIP_FMT -->|¥X,XXX (YY.Y%)| CHART_CAT
    TOOLTIP_FMT -->|¥X,XXX (YY.Y%)| CHART_TAG
    TOOLTIP_FMT -->|¥X,XXX (YY.Y%)| CHART_ASSET

    FILTER_STATUS -->|AND Condition| MULTI_FILTER
    FILTER_CAT -->|AND Condition| MULTI_FILTER
    FILTER_TAG -->|AND Condition| MULTI_FILTER
    FILTER_SEARCH -->|Case-Insensitive Match| MULTI_FILTER

    MULTI_FILTER -->|Filtered Tx Array| HIERARCHY_RES
    HIERARCHY_RES -->|Resolved Labels| XSS_GUARD
    XSS_GUARD -->|Sanitized HTML| DOM_TX_LIST
```

---

## 3. 要件・アーキテクチャ適合性レビュー (Requirements 3.27 - 3.30 & Section 8.1)

### 3.1 要件 3.27: 費目別推移・内訳のドーナツグラフ可視化
- **UI配置と構造**: `#card-category-breakdown` 内の `#category-breakdown-list` 直前に `<canvas id="category-breakdown-chart">` を内包する `.chart-container`（高さ `240px`）を配置する設計は、既存のサマリーカード群のレイアウト規約と完全に一致している。
- **データ抽出・ソート仕様**: 支出金額が正（`> 0`）の費目のみを抽出し、金額の降順でソートして描画するルール、およびデータが空または合計 `0` 円の場合にキャンバスを非表示とするエッジケース制御が明確に定義されている。
- **ライフサイクルとテーマ追従**: `ChartController` における既存インスタンスの確実な `destroy()` 呼び出し、およびダークモード時の凡例テキストカラー（`#e2e8f0` / `#334155`）追従が明記されており、要件 3.24 との整合性が保たれている。

### 3.2 要件 3.28: ドーナツグラフのツールチップへのパーセント（構成比）表示追加
- **対象チャートの網羅性**: アプリ内の全3種のドーナツグラフ（`#category-breakdown-chart`, `#tag-chart`, 資産ビュー時の `#summary-chart`）を対象として統一的に適用する設計となっている。
- **純粋関数設計とゼロ除算防御**: `formatDoughnutTooltipLabel` としてフォーマット計算を切り出し、`食費: ¥45,000 (32.1%)` 形式（小数点第1位まで）で出力するとともに、合計値が `0` の場合のゼロ除算防御（`0%` または `0.0%`）を保証しており、単体テスト容易性（Testability）が極めて高い。

### 3.3 要件 3.29: 明細一覧の表示階層刷新（費目・中項目メイン、メモ・タグ補助表示）
- **視認性向上のための階層逆転**: `#month-tx-list` および `#recent-tx-list` の双方において、メインタイトル（`.tx-title`）を「費目（大項目）＞ 中項目（アイコン付き）」とし、補助表示（`.tx-meta`）に日付・ステータスバッジ・メモ（`📝`）・タグ（`🏷️ #タグ`）を配置する構造は、家計簿アプリとしての情報階層を大幅に改善している。
- **特殊取引のフォールバック**: 中項目が未設定の場合は `🏷️ 食費` のみ、資金移動取引（`transfer`）の場合は `🔄 資金移動・振替` を表示するフォールバック仕様が明記されており、表示崩れや `undefined` 露出のリスクが排除されている。

### 3.4 要件 3.30: 明細一覧のマルチフィルタリング
- **4軸複合フィルタ（AND条件）**: 状態（`#select-status-filter`）、費目（`#select-category-filter`）、タグ（`#select-tag-filter`）、キーワード検索（`#input-tx-search`）の4要素を AND 条件で結合する設計が明確である。
- **計上/実態分類および横断検索の網羅**: 費目フィルタが `category_id` と `actual_category_id` の双方にマッチする仕様、およびキーワード検索がメモ・費目名・中項目名・タグ名に対して大文字小文字を区別せず部分一致検索を行う仕様により、ユーザビリティ上の死角がない。

### 3.5 Section 8.1: 要件トレーサビリティマトリクス
- 要件 3.27〜3.30 のそれぞれについて、フロントエンド実装対象ファイル（`js/ui/summary_controller.js`, `js/ui/chart_controller.js`, `js/ui/tx_list_controller.js`, `js/logic/aggregator.js`, `index.html`, `css/style.css`）および検証テストファイル（`test/unit/logic.test.js`, `test/unit/master_management.test.js`, `test/unit/tx_edit.test.js`）が漏れなくマッピングされている。

---

## 4. ギャップ分析 & 実装・テスト指針 (Section 5.1 - Gap Analysis)

Phase 3 実装および単体テスト作成に向けて、設計書で規定された以下の境界条件・実装ディテールを確実にテストケースへ落とし込むこと：

1. **特殊取引・未分類取引のタイトル解決 (Req 3.29)**:
   - 資金移動（`type === 'transfer'`）、立替精算（`settlement`）、または削除済みマスタを参照している明細において、アイコンとラベルが安全にフォールバックされること。
   - メモが空文字・未定義の場合は `📝` 行自体を非表示とし、不要な空要素や `(メモなし)` によるノイズを出さないこと。
2. **マルチフィルタの状態保持と動的選択肢生成 (Req 3.30)**:
   - 月切り替えや明細編集による再描画時、`#select-category-filter` や `#select-tag-filter` の選択肢を再構築する際、現在選択中のフィルタ値（存在する場合）や `#input-tx-search` の入力値が意図せずリセットされないよう配慮すること。
3. **ドーナツグラフの0件・合計0円ハンドリング (Req 3.27 / 3.28)**:
   - 支出データが0件、または収入・資金移動のみで支出合計が `0` 円の月において、`#category-breakdown-chart` の既存 Chart インスタンスが確実に破棄（`destroy()`）され、キャンバス領域が非表示となること。

---

## 5. セキュリティ & 脅威モデリング監査 (Section 5.3 - STRIDE / OWASP)

| 脅威カテゴリ (STRIDE) | 対象コンポーネント | 潜在的リスク・攻撃ベクタ | 設計上の緩和策・防御機構 | 監査判定 |
| :--- | :--- | :--- | :--- | :---: |
| **Tampering / XSS (Spoofing / Injection)** | `tx_list_controller.js` (`.tx-title`, `.tx-meta`) | 悪意あるスクリプトを含むカスタム費目名・中項目名・メモ・タグ名（インポートデータ等経由）による DOM-based XSS | 費目名、中項目名、アイコン、メモ、タグのすべてを `innerHTML` テンプレートへ展開する前に必ず `escapeHtml()` を適用（Req 3.29 明記）。 | **PASS** |
| **Injection (ReDoS / Search Abuse)** | `tx_list_controller.js` / `aggregator.js` (`#input-tx-search`) | 検索キーワードに正規表現メタ文字（`.*+?^${}()|[]\`）を入力した際の RegExp クラッシュや ReDoS | 正規表現コンパイル（`new RegExp`）を使用せず、`String.prototype.toLowerCase()` と `includes()` による安全な部分一致比較を使用する設計。 | **PASS** |
| **Denial of Service (Memory Leak / Crash)** | `chart_controller.js` (`#category-breakdown-chart`) | 期間・分類軸の高速切り替えに伴う Chart.js インスタンスの重複生成・Canvas メモリリーク、および合計0円時の `NaN%` 表示 | `ChartController` でインスタンス参照を保持し再描画前に必ず `destroy()` を実行。ツールチップ計算で `total > 0` ガードを実装。 | **PASS** |
| **Tampering (Prototype Pollution)** | `aggregator.js` (費目・タグ集計マップ) | `__proto__` や `constructor` 等の特殊なタグ名やカテゴリIDによるオブジェクト汚染 | `Map` オブジェクトまたは `Object.create(null)` / `Object.prototype.hasOwnProperty` を用いた安全な集計処理。 | **PASS** |

---

## 6. 結論および次フェーズへの勧告 (Conclusion)

`docs/system_design.md` における要件 3.27〜3.30 のアーキテクチャ設計は、機能性・UI/UXの一貫性・セキュリティ・テスト容易性のすべてにおいて完璧に定義されている。
実装担当チームは直ちに **Phase 3（テスト駆動実装）** へ進み、純粋関数群（ツールチップ構成比フォーマッタ、明細マルチフィルタ、階層タイトル解決、費目別内訳チャート描画）の単体テストおよびUI統合実装に着手されたい。
