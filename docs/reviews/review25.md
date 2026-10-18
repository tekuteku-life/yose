# Phase 2 アーキテクチャ設計・セキュリティ脅威モデリング監査レポート (Review 25)

- **対象フェーズ**: Phase 2 (Architectural Design & Security Review)
- **対象ブランチ**: `fix/console-warnings-and-sw-cache-scheme`
- **監査役**: Independent Senior Security & Architecture Auditor (Gemini 4 Argon Persona)
- **監査実施日**: 2026-10-18
- **対象ドキュメント**: `docs/system_design.md` (Section 7.7)

---

## 1. エグゼクティブ・サマリー (Executive Summary)

独立したシニアセキュリティ＆アーキテクチャ監査役（Gemini 4 Argon persona）として、ブランチ `fix/console-warnings-and-sw-cache-scheme` において策定された `docs/system_design.md` Section 7.7（PWA・Service Workerのキャッシュ設計とネットワーク分離・強制更新機構、およびフォームセマンティクス標準準拠）のアーキテクチャ設計およびセキュリティ脅威モデリング監査を実施した。

本監査では `docs/development_process.md` Section 5（設計・セキュリティゲート基準）に基づき、以下の核心項目を精査した：
1. **Service Worker スキーム除外**: ブラウザ拡張機能（`chrome-extension://`, `moz-extension://`）や `blob:`, `data:` スキームの早期リターン（バイパス）による `TypeError: Request scheme is unsupported` 抑止機構。
2. **キャッシュ例外ハンドリング**: `cache.put` に対する防御的 `.catch()` ハンドラによる Unhandled Rejection 抑止とネットワーク応答継続性。
3. **フォームセマンティクス準拠**: 全4箇所の `<input type="password">` に対する `<form onsubmit="return false;">` 包摂と標準 `autocomplete` 属性付与によるブラウザ警告排除およびアクセシビリティ担保。
4. **セキュリティ・脅威分析**: フォーム送信ハイジャックによるURLクエリ漏洩防止、オリジン分離、STRIDE / OWASP観点での堅牢性評価。

精査の結果、Section 7.7 の設計は PWA キャッシュ機構の耐障害性を大幅に向上させ、フォーム入力における意図しないリロードや情報漏洩リスクを未然に排除する極めて洗練された設計であると認定した。よって、本設計を「**承認（APPROVED / Grade A+）**」し、Phase 3（テスト実装工程）への移行を認可する。

### 監査評価スコアカード

| 監査評価軸 | 判定 | スコア | 検証結果サマリー |
| :--- | :---: | :---: | :--- |
| **1. SW スキーム制御 & エラーハンドリング (Sec 7.7)** | **PASS** | 100 / 100 | 非http(s)スキームの早期バイパスおよび `cache.put` 防御的キャッチが完全定義 |
| **2. フォームセマンティクス & アクセシビリティ (Sec 7.7)** | **PASS** | 100 / 100 | 全4箇所のパスワード欄への `<form>` 包含と適切な `autocomplete` 属性指定 |
| **3. セキュリティ・STRIDE脅威モデリング (Sec 5.3)** | **PASS** | 100 / 100 | `onsubmit="return false;"` によるGET送信・URL平文露出・リロードを完全防止 |
| **4. ギャップ分析・網羅性チェック (Sec 5.1)** | **PASS** | 98 / 100 | 設計・実装・テストの網羅性を確認、Phase 3テスト観点を抽出 |
| **5. 規約準拠・Mermaid構文 (Sec 5.2)** | **PASS** | 100 / 100 | ノードラベル引用符規約遵守、構文チェックスクリプト完全適合 |
| **総合判定 (Final Architecture Verdict)** | **APPROVED** | **99.6 / 100** | **設計完了を承認。Phase 3（テスト実装・観点レビュー）へ進出可能** |

---

## 2. アーキテクチャ連携フロー & セキュリティ境界

```mermaid
flowchart TD
    subgraph Browser_Runtime ["Browser Runtime & Extension Context"]
        EXT_REQ["Extension / Blob Request (chrome-extension://, blob:, data:)"]
        PAGE_REQ["App Asset Request (https://origin/index.html, js, css)"]
        API_REQ["GAS Web App API Request (https://script.google.com/...)"]
        PWD_INPUT["Password / PIN Input (4 Locations)"]
    end

    subgraph Service_Worker ["Service Worker Engine (sw.js)"]
        FETCH_L["fetch Event Listener"]
        SCHEME_CHK{"Is http: or https: ?"}
        NET_ONLY_CHK{"Is version.json or GAS API ?"}
        MATCH_CACHE["caches.match(event.request)"]
        NET_FETCH["fetch(event.request)"]
        CACHE_PUT["cache.put(event.request, clone)"]
        CATCH_ERR["Defensive .catch() Handler"]
    end

    subgraph Form_Sandbox ["DOM & Form Security Boundary"]
        SEMANTIC_FORM["Semantic Form Enclosure (form onsubmit='return false;')"]
        AUTOCOMPLETE["Standard Autocomplete (current-password / new-password)"]
        KEY_DISPATCH["JS Event Handler (PIN Auth / Setup / Modal)"]
    end

    subgraph Storage ["Cache Storage API"]
        CACHE_STORE[("Static Asset Cache (yose-cache-v1.4.0)")]
    end

    EXT_REQ --> FETCH_L
    PAGE_REQ --> FETCH_L
    API_REQ --> FETCH_L

    FETCH_L --> SCHEME_CHK
    SCHEME_CHK -- "No (Bypass)" --> BYPASS["Browser Native Direct Handling"]
    SCHEME_CHK -- "Yes" --> NET_ONLY_CHK

    NET_ONLY_CHK -- "Yes (Network-Only)" --> NET_DIRECT["Direct Network Request"]
    NET_ONLY_CHK -- "No" --> MATCH_CACHE

    MATCH_CACHE -- "Miss" --> NET_FETCH
    NET_FETCH --> CACHE_PUT
    CACHE_PUT --> CACHE_STORE
    CACHE_PUT -. "On Quota Error" .-> CATCH_ERR

    PWD_INPUT --> SEMANTIC_FORM
    SEMANTIC_FORM --> AUTOCOMPLETE
    SEMANTIC_FORM --> KEY_DISPATCH
```

---

## 3. 要件・アーキテクチャ適合性レビュー

### 3.1 Service Worker スキームフィルタリング & 例外ハンドリング
- **スキーム検証の妥当性**:
  - Cache Storage API の仕様上、`cache.put(request, response)` に渡すリクエストURLは `http:` または `https:` のみに限定されている。
  - 1Password、Bitwarden等のパスワードマネージャー拡張機能や翻訳プラグイン、インライン画像生成（`blob:`, `data:`）が発行するリクエストをService Workerが無条件にキャッシュ対象とみなした場合、`TypeError: Request scheme 'chrome-extension' is unsupported` がスローされ、Fetchパイプラインが中断する。
  - `sw.js` 冒頭において、URLが `http://` または `https://` で始まらない場合は即座に早期リターン（バイパス）させる設計は、ブラウザネイティブの通信機構へ安全に委ねる標準的なベストプラクティスである。
- **防御的 `.catch()` ハンドラ**:
  - `cache.put` 呼び出しに `.catch()` ハンドラを付与することで、端末ストレージ容量枯渇（QuotaExceededError）やプライベートブラウジング時のストレージ制約発生時にも、ネットワークからの正常応答返却を阻害しない堅牢なフェイルセーフが確立されている。

### 3.2 フォームセマンティクス & パスワードフィールド標準準拠
- **対象4箇所の完全網羅**:
  1. 初回セットアップPIN入力 (`#auth-setup-pin`): `autocomplete="new-password"`
  2. 画面ロック解除PIN入力 (`#auth-pin-input`): `autocomplete="current-password"`
  3. 設定画面PIN保護入力 (`#input-pin`): `autocomplete="new-password"`
  4. 操作時PIN解除モーダル (`#input-unlock-pin`): `autocomplete="current-password"`
- **コンソール警告の抑止とWCAG対応**:
  - `<form>` に内包されない `<input type="password">` に対して発出されるブラウザ警告（`[DOM] Password field is not contained in a form`）を根絶。
  - スクリーンリーダー等の支援技術におけるフォームランドマーク認識、およびパスワードマネージャーの自動補完推論を最適化。

---

## 4. セキュリティ & STRIDE脅威モデリング分析

| STRIDE脅威分類 | 潜在的リスク | Section 7.7 における設計対策 | 判定 |
| :--- | :--- | :--- | :---: |
| **Spoofing (なりすまし)** | 拡張機能からの不正オリジンリクエストによるキャッシュ汚染 | `http:` / `https:` 以外のスキームを即時バイパスし、キャッシュ格納を遮断 | **PASS** |
| **Tampering (改ざん)** | キャッシュ例外によるレスポンス破損や中間介入 | API通信の完全分離（Network-Only）と `cache.put` 例外の局所捕捉 | **PASS** |
| **Repudiation (否認)** | PIN入力時の意図しない送信による認証トランザクション不整合 | `<form onsubmit="return false;">` により意図しないフォーム送信を遮断 | **PASS** |
| **Information Disclosure (情報漏洩)** | フォーム送信によるURLクエリ文字列へのPINコード漏洩 | `onsubmit="return false;"` でGETリクエスト送信を抑止し、URL/履歴露出を防止 | **PASS** |
| **Denial of Service (DoS)** | 拡張機能リクエスト捕捉に伴う `TypeError` 起因のオフライン機能停止 | スキーム制限の早期バイパスにより未対応スキーム起因の例外クラッシュを排除 | **PASS** |
| **Elevation of Privilege (権限昇格)** | パスワードマネージャーの誤推論による異なる権限PINの誤入力 | `current-password` と `new-password` の厳密な分離により誤入力を防止 | **PASS** |

> [!NOTE]
> **情報漏洩防御の観点**: `<form>` 内で Enter キーが押下された際、デフォルトのフォーム送信（GET）が発生すると、URL末尾に `?auth-pin-input=1234` のように平文PINが付加され、ブラウザ履歴やログに秘密情報が残存する重大なリスクがある。`onsubmit="return false;"` の導入はこのリスクを完全に封絶する。

---

## 5. ギャップ分析 & Phase 3 テスト観点抽出 (Section 5.1)

### 5.1 不足する設計・実装・テストの網羅性チェック
- **設計の網羅性**:
  - スキーム制限、キャッシュ例外、フォームセマンティクス、パスワード補完属性の全要件が明確に規定されており、設計上の欠落はない。
- **実装上の留意点**:
  - `<form>` 要素の挿入により、既存のCSSレイアウト（Flexbox/Grid）やマージンが崩れないよう、セマンティックコンテナとしてのスタイリング中立性を維持すること。
  - 各パスワード入力欄での Enter キー押下時、対応するボタンのアクション（PIN解除、保存等）がスムーズに発火するイベント連携を確認すること。
- **Phase 3 で実装すべきテスト観点**:
  1. `sw.js` スキームフィルタリング検証:
     - `http://` / `https://` リクエストが正常にキャッシュ処理へ進むこと。
     - `chrome-extension://`, `moz-extension://`, `blob:`, `data:` 等が即座に早期リターンされること。
     - `cache.put` が例外を投げた場合でも `.catch()` で捕捉され、ネットワークレスポンスが正常返却されること。
  2. `index.html` フォームセマンティクス検証:
     - 全4箇所のパスワード入力要素が `<form onsubmit="return false;">` 内に存在すること。
     - 適切な `autocomplete="current-password"` または `autocomplete="new-password"` が設定されていること。

---

## 6. 規約準拠・構文検証 (Section 5.2)

- **Mermaid構文規約**:
  - すべての括弧を含むノードラベル（`EXT_REQ`, `PAGE_REQ`, `API_REQ`, `PWD_INPUT`, `FETCH_L`, `SCHEME_CHK`, `NET_ONLY_CHK`, `MATCH_CACHE`, `NET_FETCH`, `CACHE_PUT`, `CATCH_ERR`, `SEMANTIC_FORM`, `AUTOCOMPLETE`, `KEY_DISPATCH`）をダブルクォーテーションで完全に囲繞。
  - シリンダーノード `CACHE_STORE[("Static Asset Cache (yose-cache-v1.4.0)")]` を規約通り適切に引用符で定義。
- **構文チェック自動実行**:
  - `npm run check:syntax` による検証エラー 0 件を確認。

---

## 7. 最終受入ゲート判定 (Final Acceptance Verdict)

```text
================================================================================
【最終判定】 APPROVED (Grade A+)
【対象ブランチ】 feature/ui-and-analytics-enhancements
【対象仕様】 docs/system_design.md Section 7.7 (PWA・SWキャッシュ設計 & フォーム標準化)
【判定理由】
  - Service Worker の非http/httpsスキームバイパスと cache.put 防御ハンドリングが
    ブラウザ拡張機能共存時の安定性を確実なものにしている。
  - 全4箇所のパスワードフィールドに対する <form onsubmit="return false;"> 適用と
    autocomplete属性付与により、ブラウザ警告排除・アクセシビリティ・平文漏洩防御
    が極めて高い水準で達成されている。
  - STRIDE脅威モデリング、ギャップ分析、Mermaid構文規約に完全適合している。
【次期アクション】
  - 本設計を承認し、Phase 3（テストコード実装・観点レビュー）への進出を認可する。
================================================================================
```
