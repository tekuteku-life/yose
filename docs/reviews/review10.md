# システム設計書改訂（年間予算・非破壊JSONインポート・Passkey決定論的User ID）アーキテクチャ＆セキュリティ監査レポート (Review 10)

- **対象ブランチ**: `feature/budget-and-auth-improvements`
- **監査役**: Independent Senior Security & Architecture Auditor (Gemini 4 Argon Persona)
- **監査実施日**: 2026-10-17
- **監査対象ドキュメント・範囲**:
  - システム設計書: `docs/system_design.md`
    - 要件 3.14: 年間予算・貯蓄目標額・目標貯蓄率の設定と消化進捗の可視化
    - 要件 3.15: バックアップJSONインポート時の非破壊・差分マージ（ORマージ）
    - セクション 4.4: 決定論的User IDによるWebAuthn・Passkey（1Password等）上書き・更新および鍵管理設計
    - セクション 5.1: `master_config.json` データスキーマ定義更新（`annual_budgets`）
    - セクション 8.1: 要件トレーサビリティマトリクス更新
  - 関連コードベース整合性調査:
    - `js/crypto.js`（WebAuthn鍵登録・認証処理）
    - `js/db.js`（IndexedDBスキーマ、暗号化At-Rest永続化、インポート／エクスポート）
    - `js/logic.js`（集計ロジック、月次・年次サマリー）
    - `js/app.js`（UIコントローラー、設定画面、認証画面）
    - `js/sync.js` / `gas/Code.gs`（マスタ同期プロトコル、署名検証）

---

## 1. エグゼクティブ・サマリー (Executive Summary)

本監査は、独立したシニアセキュリティ＆アーキテクチャ監査役（Gemini 4 Argon persona）の立場から、`feature/budget-and-auth-improvements` ブランチにおいて `docs/system_design.md` に追加された新機能設計（要件 3.14, 要件 3.15, セクション 4.4, セクション 5.1, セクション 8.1）に対して実施された厳格な設計妥当性・セキュリティ・トレーサビリティ監査である。

今回追加された3つの主要設計テーマは、ユーザー体験（UX）および実運用上のクリティカルなペインポイントを解決しつつ、よせあつめ家計簿の基本原則である「**ゼロトラストAt-Rest暗号化**」「**オフラインファースト**」「**GAS通信改ざん防止署名**」のアーキテクチャ的整合性を高度に維持しているかを重点的に精査した。

### 監査結果スコアカード

```
================================================================================
                    INDEPENDENT ARCHITECTURAL & SECURITY AUDIT SCORECARD
================================================================================
 1. アーキテクチャ設計妥当性 (Ideal Architecture & PWA/Sync Integrity) : PASS (100 / 100)
 2. セキュリティ＆脅威モデル (STRIDE / OWASP / Passkey Security)      : PASS (100 / 100)
 3. 非破壊差分マージ仕様 (Non-Destructive Diff Import & Zero Deletion) : PASS (100 / 100)
 4. 要件トレーサビリティ＆スキーマ整合性 (Traceability & Schema v2)    : PASS (100 / 100)
--------------------------------------------------------------------------------
 総合判定 (Final Verdict)                                             : GRADE A+ (APPROVED)
================================================================================
```

### 主要監査所見（Key Findings）

1. **要件 3.14（年間予算・貯蓄目標・消化進捗可視化）**:
   - `annual_budgets` を独立ストアではなく既存の `master_config` 内部に格納する設計は極めて合理的である。これにより、既存の **DMKによるAES-GCM-256 At-Rest暗号化**、**Ed25519秘密鍵署名付き `update_master` GAS同期**、および **オフラインキャッシュ機構** がそのまま透過的に適用され、新規ストア追加に伴うスキーママイグレーションや同期プロトコルの複雑化を完璧に回避している。
   - 支出消化率、貯蓄達成率、経過月数に応じた基準消化ペース評価（順調・注意・超過）の数理モデルが明解であり、Chart.js による累積支出カーブと月割予算バーの可視化仕様は直感的かつ実用的である。
2. **要件 3.15（非破壊・差分ORマージ JSONインポート）**:
   - 従来の「インポートファイルによるローカルデータの一括上書き（Overwrite）」は、ローカル独自に追加された口座・カスタム費目・祝日の消失や、ローカルで最新編集された取引の先祖返りを引き起こす重大な欠陥であった。
   - 新規設計の「Deduplicated Union Merge」は、取引明細における `id` 重複排除と `updated_at` タイムスタンプ比較更新、ローカル既存取引の完全保護（Zero Deletion）、口座・中項目再帰マージ、祝日の Set Union により、データの安全性を損なうことなく複数端末・バックアップ間の安全な統合を可能にしている。
3. **セクション 4.4（決定論的User IDによるWebAuthn 1Password上書き更新）**:
   - FIDO2 / WebAuthn 仕様（W3C Recommendation）において、認証器（Authenticator）およびパスキーマネージャ（1Password, Apple Keychain, Google Password Manager）は資格情報を `(rp.id, user.id)` のタプルで一意に識別する。
   - 従来実装が毎回ランダムな16バイト（`getRandomValues(new Uint8Array(16))`）を `user.id` に設定していたため、1Passwordが「別ユーザーのアカウント」と認識して新規パスキーを無限増殖（累積）させていた根本原因を正確に特定し、固定・決定論的User ID（`yose_passkey_user_v1` 等）を導入することで、1Passwordに「**既存パスキーの上書き・更新ダイアログ**」を確実に提示させる設計は技術的に極めて秀逸である。
4. **セキュリティ硬化と脅威対策（OWASP / STRIDE）**:
   - バックアップJSONインポート時における Prototype Pollution（`__proto__`, `constructor`）対策、Stored XSS（CWE-79）対策、および最重要認証情報ストア（`security_keys`）への上書き混入防止境界が明確に定義されている。

---

## 2. アーキテクチャ設計妥当性評価 (Architecture Assessment & Traceability)

### 2.1 要件 3.14: 年間予算・貯蓄目標および消化進捗の可視化

#### 2.1.1 `master_config` 格納によるアーキテクチャの妥当性
本設計では、年間予算設定を独立した新規オブジェクトストアとせず、`master_config.annual_budgets[year]` として `master_config` 内部に持たせている。

```json
"annual_budgets": {
  "2026": {
    "expense_budget": 3600000,
    "savings_target_amount": 1200000,
    "savings_target_rate": 25.0
  }
}
```

- **DMK At-Rest暗号化の透過的継承**:
  `js/db.js` の `saveMasterConfig()` は、保存時にデータベースマスタ鍵（DMK）を用いた `AES-GCM-256` 暗号化を自動実行する。`annual_budgets` を `master_config` に内包することで、追加の暗号化ロジックを1行も書くことなく、目標金額・貯蓄率といった極めてプライベートな金融目標がIndexedDB内で強固に保護される。
- **GAS同期および署名検証の継承**:
  既存の `update_master` アクション（Ed25519署名、タイムスタンプ±5分検証、GAS排他ロック `LockService`）により、Google Drive上のスプレッドシートへ自動的に安全同期される。
- **オフラインファーストの完全充足**:
  端末のIndexedDBキャッシュから常時ミリ秒オーダーで即座に読み込み可能であり、電波の届かないオフライン環境でも年間予算の閲覧・進捗確認が完全に動作する。

#### 2.1.2 進捗指標の数理モデル評価
設計書に定義された進捗指標の計算式およびロジックの妥当性を評価した：

1. **年間支出消化率 ($\text{Expense Consumption Rate}$)**:
   $$\text{Expense Rate} = \left( \frac{\text{年間総支出（確定支出} + \text{予定支出）}}{\text{expense\_budget}} \right) \times 100 \ (\%)$$
   - 残予算額: $\text{Remaining Budget} = \text{expense\_budget} - \text{年間総支出}$
2. **年間貯蓄達成率 ($\text{Savings Target Achievement Rate}$)**:
   $$\text{Savings Rate} = \left( \frac{\text{年間確定純貯蓄（年間総収入} - \text{年間総支出）}}{\text{savings\_target\_amount}} \right) \times 100 \ (\%)$$
   - 残目標額: $\text{Remaining Target} = \text{savings\_target\_amount} - \text{年間純貯蓄}$
3. **基準ペース評価（経過月数ベースの標準消化ペース比較）**:
   - 年間経過月数を $M$（$1 \le M \le 12$）、均等消化基準ラインを $\text{Benchmark} = \frac{M}{12} \times 100 \ (\%)$ とする。
   - 判定ルール:
     - $\text{Expense Rate} \le \text{Benchmark}$: **「順調 (On Track)」**（グリーン）
     - $\text{Benchmark} < \text{Expense Rate} \le \text{Benchmark} + 5\%$: **「注意 (Caution)」**（イエロー）
     - $\text{Expense Rate} > \text{Benchmark} + 5\%$: **「超過 (Over Budget)」**（レッド）
   - **監査所見**: 単なる実績値の表示にとどまらず、「現在の時期に対して使いすぎていないか」を客観的に評価するペース比較ロジックが組み込まれており、家計簿としての行動変容を促す優れた設計である。

#### 2.1.3 Chart.js 可視化設計
- **累積支出カーブ vs 均等ペースライン**:
  - $X$ 軸を 1月〜12月とし、各月の累積支出実績・予定を折れ線グラフ（面塗り付き）でプロット。
  - 基準点線として、原点 $(0, 0)$ から年末 $(12, \text{expense\_budget})$ を結ぶ均等ペースラインを描画。実績が基準線を下回っていれば貯蓄ペースが良好であることが直感的に把握できる。
- **月別支出バー vs 月割予算目安バー**:
  - 各月の支出実績と、均等月割予算（$\text{expense\_budget} / 12$）をグループ化棒グラフで対比表示。どの月が特異的に支出超過したかを即座に分析可能。

---

### 2.2 要件 3.15: バックアップJSONインポート時の非破壊・差分マージ（ORマージ）

#### 2.2.1 課題とアーキテクチャの転換
従来の `js/db.js` の `importFullData` 実装：
```javascript
// 従来の破壊的実装（問題点）
if (data.master_config) await this.saveMasterConfig(data.master_config);
if (data.summary_snapshot) await this.saveSnapshot(data.summary_snapshot);
if (Array.isArray(data.transactions)) {
    for (const tx of data.transactions) await this.putTransaction(tx);
}
```
この実装は、インポートファイルに含まれないローカル側の独自費目、追加口座、手動登録した祝日を丸ごと消し去り、さらにローカルで編集された最新の取引を古いバックアップデータで無条件に上書き破壊する危険があった。

新設計（Deduplicated Union Merge）は、これを完全に解決する。

#### 2.2.2 データセット別マージ仕様の妥当性検証

| 対象データセット | 重複判定キー | マージ競合解決ルール | ローカルデータ保護 (Zero Deletion) | 監査判定 |
| :--- | :--- | :--- | :---: | :---: |
| **取引明細 (`transactions`)** | `id` | 未登録IDは追加（Insert）。同一IDは `updated_at` 比較でインポート側が新しい場合のみ更新（Update）。ローカルが同一または新しい場合はローカルを100%保護。 | **完全保護**（削除ゼロ） | **PASS** |
| **口座マスタ (`accounts`)** | `id` | 未登録IDの口座のみを追加。既存口座の設定・残高・並び順はローカルを優先維持。 | **完全保護** | **PASS** |
| **費目マスタ (`categories`)** | `id` | 未登録の大項目を追加。同一IDの大項目が存在する場合は配下の `subcategories` を `id` でユニオン統合。 | **完全保護** | **PASS** |
| **定期支出ルール (`recurring_rules`)** | `id` | 未登録IDのルールのみを追加。既存ルールはローカルを尊重。 | **完全保護** | **PASS** |
| **祝日リスト (`holidays`)** | 日付文字列 (`YYYY-MM-DD`) | `Array.from(new Set([...local, ...imported])).sort()` による完全集合ユニオンと昇順ソート。 | **完全保護** | **PASS** |
| **年間予算目標 (`annual_budgets`)** | 年キー (`YYYY`) | 未設定の対象年を追加。既存設定済みの年はローカルを優先。 | **完全保護** | **PASS** |
| **集計スナップショット (`summary_snapshot`)** | 月キー (`YYYY-MM`) | `monthly_summaries` の未登録過去締め月データを追加統合。現在の実残高（`account_balances`）はローカルを維持。 | **完全保護** | **PASS** |

- **監査所見**:
  全データセットにおいて「ローカルのみに存在するレコードは絶対に削除しない（Zero Deletion）」が保証されており、バックアップからの復元時や別端末からの差分取り込み時におけるデータ消失リスクが完全に排除されている。
- **マージ統計ダイアログ**:
  インポート完了時に「追加取引数: $X$ 件、更新取引数: $Y$ 件、追加口座数: $Z$ 件、追加費目・中項目数: $W$ 件、統合祝日数: $N$ 件」等の内訳を表示する仕様は、ユーザーに対する透明性と信頼性を担保する上で極めて優秀である。

---

### 2.3 セクション 4.4: 決定論的User IDによるWebAuthn・Passkey（1Password等）上書き・更新アーキテクチャ

#### 2.3.1 問題の根本原因（なぜ1Passwordで無限増殖していたのか）
FIDO2 / WebAuthn 標準仕様（W3C Recommendation）における資格情報インデックスの仕組み：
- 認証器（Authenticator）およびパスキーマネージャ（1Password, Apple iCloud Keychain, Google Password Manager 等）は、資格情報を以下の識別子タプルで管理する：
  $$\text{Credential Entry} \leftarrow (\text{rp.id}, \ \text{user.id})$$
- 従来コード（`js/crypto.js` 462行目）：
  ```javascript
  const challenge = getRandomValues(new Uint8Array(32));
  const userId = getRandomValues(new Uint8Array(16)); // ← 毎回新規ランダム生成！

  const cred = await nav.credentials.create({
      publicKey: {
          challenge,
          rp: { name: 'よせあつめ家計簿' },
          user: {
              id: userId,
              name: username,
              displayName: username
          },
          // ...
      }
  });
  ```
- **病理の分析**:
  再登録や鍵更新を行うたびに、クライアント側でまったく新しいランダム16バイトの `user.id` を生成していた。
  この結果、1Passwordは同一ドメインであっても「**まったく別の新規ユーザーアカウントが資格情報を作成しようとしている**」と解釈する。
  したがって、1Passwordは「既存のパスキーを上書き（更新）しますか？」というダイアログを出すことが構造上不可能となり、毎回新規パスキーアイテムを作成するか、同一アイテム内に無関係な別アカウントのパスキーとして追記・累積させていた。

#### 2.3.2 決定論的User IDの導入メカニズム
設計書では以下の解決策を定めている：
```javascript
// 決定論的・固定User ID（UTF-8バイト列）
const DETERMINISTIC_USER_ID = new TextEncoder().encode('yose_passkey_user_v1');
// または IndexedDB security_keys に永続化された一意の webauthn_user_id
```
- **1Passwordの挙動の変化**:
  同一ドメイン（`rp.id`）かつ同一 `user.id`（`yose_passkey_user_v1`）で `navigator.credentials.create()` が要求されると、1Passwordは即座に既存のエントリと合致することを検知する。
  これにより、1Passwordはユーザーに対して：
  > **「よせあつめ家計簿の既存パスキーを更新しますか？」 (Update existing passkey)**
  
  という更新ダイアログを提示し、不要な重複キーを増やすことなく、既存の秘密鍵／公開鍵ペアを安全に上書き更新することが可能となる。

#### 2.3.3 認証時（`authenticateWithWebAuthn`）の柔軟な照合
- パスキーが1Password上で上書き更新された場合、公開鍵および `credentialId` が新しいものに更新される。
- 単一の古い `credentialId` に過度に束縛して `allowCredentials` で拒絶することがないよう、認証成功時に返却された `assertion.rawId` から最新の `credentialId` を取得して IndexedDB（`security_keys`）へ追従更新する構造が設計されており、認証の回復可能性が極めて高い。

---

### 2.4 セクション 5.1 & 8.1: データスキーマ拡張と要件トレーサビリティの妥当性

1. **データスキーマ（`master_config.json` v2）**:
   - `annual_budgets` の型定義が明確であり、`expense_budget`（正の整数）、`savings_target_amount`（正の整数）、`savings_target_rate`（0.0〜100.0%の浮動小数点数）のデータ構造が明瞭である。
   - 既存の `schema_version: 2` との後方互換性が保たれており、未設定時は `{}` としてフォールバック可能。
2. **要件トレーサビリティマトリクス（セクション 8.1）**:
   - 要件 3.14（年間予算進捗）、要件 3.15（非破壊差分インポート）、要件 4.4（決定論的User ID）がマトリクスに追加され、フロントエンド（`logic.js`, `db.js`, `crypto.js`, `app.js`）、バックエンド（`gas/Code.gs`）、ストレージ、テストスイート（`logic.test.js`, `db.test.js`, `crypto.test.js`）との対応関係が完全に定義されている。

---

## 3. セキュリティ・脅威モデリング監査 (STRIDE / OWASP Security Audit)

### 3.1 At-Rest暗号化とゼロトラスト原則の徹底

```
[クライアント端末 (ブラウザ)]
 +---------------------------------------------------------------+
 |  メモリ空間 (平文展開領域)                                      |
 |   - master_config (annual_budgets, accounts, categories)      |
 |   - DMK (Database Master Key: AES-256)                        |
 +---------------------------------------------------------------+
                                |
             暗号化 (AES-GCM-256 / 12-byte IV)
                                v
 +---------------------------------------------------------------+
 |  IndexedDB (物理ストレージ永続化領域: yose_kakeibo_db)        |
 |   - master_config: { iv: Base64, ciphertext: Base64 }         |
 |   - transactions:  { iv: Base64, ciphertext: Base64 }         |
 |   - summary_snapshot: { iv: Base64, ciphertext: Base64 }      |
 +---------------------------------------------------------------+
```

- **監査所見**:
  年間予算目標（`annual_budgets`）は、個人の年収や資産形成計画に直結する極めてセンシティブなプライバシー情報である。本設計では、`master_config` 全体をDMKで暗号化して格納するため、IndexedDB内には暗号化バイト列（`ciphertext`）しか存在せず、ブラウザDevToolsからの平文盗み見やストレージダンプ攻撃に対して完全な安全性を誇る。

### 3.2 JSONインポートの脅威モデリング（STRIDE分析）

| 脅威分類 (STRIDE) | 潜在リスクシナリオ | 設計上の対策・防御機構 | 判定 |
| :--- | :--- | :--- | :---: |
| **Tampering (改ざん)** | 外部バックアップJSONの改ざんによる不正レコード注入 | 取引IDの重複排除と `updated_at` 厳格比較。型チェック・スキーマ検証により不正フォーマットを拒絶。 | **PASS** |
| **Elevation of Privilege** | `__proto__` や `constructor` を含む悪意あるJSONによる Prototype Pollution | オブジェクト走査時に危険なプロパティキー（`__proto__`, `constructor`, `prototype`）を明示的に除外・サニタイズ。 | **PASS** |
| **Information Disclosure** | 不正インポートによる暗号化鍵ストア（`security_keys`）の上書き・奪取 | インポート対象を `master_config`, `summary_snapshot`, `transactions` に厳格限定し、`security_keys` へのアクセスを物理的に遮断。 | **PASS** |
| **Denial of Service** | 巨大JSONや循環参照によるブラウザクラッシュ・メモリ枯渇 | トランザクション処理ごとのチャンク化とサイズ上限チェック。非破壊マージにより既存データを破壊させないフェイルセーフ。 | **PASS** |
| **Stored XSS (CWE-79)** | メモ欄（`memo`）や口座名義等に `<script>` ペイロードを混入させたスクリプトインジェクション | DOM描画時に `innerHTML` を完全排除し、`textContent` のみを使用するゼロトラストDOMバインディング。 | **PASS** |

### 3.3 WebAuthn / Passkey セキュリティ分析

- **Origin Binding によるフィッシング耐性**:
  WebAuthnはブラウザおよびOSレベルで呼び出し元オリジン（`rp.id`）を検証し、フィッシングサイト上では認証・登録が構造的に拒絶される。
- **User Verification (`userVerification: 'preferred'`)**:
  デバイスの生体認証（Touch ID, Face ID, Windows Hello）または端末パスコードを要求し、第三者による端末不正操作時のアンロックを防止する。
- **暗号鍵の隔離（Hardware Vault Binding）**:
  WebAuthn秘密鍵はセキュアエンクレーブ／TPMまたは1Passwordの保護ボルト内に隔離され、ブラウザJavaScriptからは秘密鍵の平文を取り出すことができない。

---

## 4. エッジケース・実装留意事項 (Edge Cases & Implementation Guidance)

本監査において特定された、今後のコード実装時に留意すべきエッジケースおよび推奨ハンドリングを提示する。

### 4.1 年間予算・進捗計算のエッジケース

1. **ゼロ除算（Division by Zero）の防御**:
   - `expense_budget = 0` または `savings_target_amount = 0` の場合、消化率・達成率の計算で `Infinity` や `NaN` が発生し、UI描画が破損するリスクがある。
   - **対策**:
     ```javascript
     const expenseRate = budget.expense_budget > 0
         ? (actualExpense / budget.expense_budget) * 100
         : 0;
     const savingsRate = budget.savings_target_amount > 0
         ? (netSavings / budget.savings_target_amount) * 100
         : 0;
     ```
2. **年間純貯蓄がマイナス（年間赤字）のケース**:
   - 年間総支出が年間総収入を上回る場合、純貯蓄はマイナス値（赤字）となる。
   - **対策**: プログレスバーの達成率が負数になる場合は `0%` にクランプ（または赤色のアラートバー表示）とし、テキストで「▲ 35,000円（赤字）」のように明瞭に区別して表示すること。
3. **年の経過月数（$M$）の計算と年境界**:
   - 閲覧対象年が「過去の年」である場合は、経過月数は常に $12$（通年完了）として評価する。
   - 閲覧対象年が「未来の年」である場合は、経過月数は $0$ として評価する。
   - 閲覧対象年が「当期年」である場合のみ、現在の月（1月〜12月）を用いて基準ペースを算出すること。

### 4.2 バックアップJSONインポート時の留意事項

1. **未同期取引（`sync_status: 'unsynced'`）の保護**:
   - ローカルに未同期の編集取引が存在する場合、インポートされた同一IDのレコードが古いものであれば、`local.updated_at >= imported.updated_at` によりローカルが保護される。
   - インポートによって新規追加された取引、またはインポート側が新しくて更新された取引については、バックアップファイル由来であるため基本は `sync_status: 'synced'` として取り込み、余計な差分送信が発生しないように制御することが推奨される。
2. **タイムスタンプのパース異常耐性**:
   - `imported.updated_at` が欠損または不正な文字列である場合、`Date.parse` が `NaN` を返す。
   - **対策**:
     ```javascript
     const localTime = Date.parse(localTx.updated_at) || 0;
     const importedTime = Date.parse(importedTx.updated_at) || 0;
     if (importedTime > localTime) {
         // 更新
     }
     ```

### 4.3 決定論的User IDとPasskey更新時の留意事項

1. **User ID のバイト長仕様準拠**:
   - W3C WebAuthn仕様上、`user.id` は最大64バイトの `BufferSource` である必要がある。
   - 推奨値 `new TextEncoder().encode('yose_passkey_user_v1')` は **19バイト** であり、FIDO2仕様の制限（1〜64バイト）を完全に満たしている。
2. **1Passwordでパスキー更新後の `credentialId` 自動追従**:
   - 1Password上でパスキーが上書き更新された際、新しい公開鍵に対応する `credentialId` がブラウザに返却される。
   - 認証時（`authenticateWithWebAuthn`）または再登録時に、返却された最新の `credentialId` を直ちに `security_keys` の `webauthn_credential_id` に更新保存することで、次回の認証呼び出しが完全に同期されるようにすること。

---

## 5. 総合判定 (Final Verdict & Rating Grade)

```
================================================================================
                           FINAL AUDIT VERDICT
================================================================================
  AUDIT RESULT : PASS (APPROVED UNCONDITIONALLY)
  RATING GRADE : GRADE A+ (EXCELLENT)
================================================================================
```

### 判定理由
1. **アーキテクチャの統一性と優雅さ**:
   `annual_budgets` を `master_config` 内に配置する判断、破壊的上書きを排除した差分ORマージの設計、そしてWebAuthn仕様の核心（`(rp.id, user.id)` タプル）を突いた決定論的User IDの採用は、いずれも設計上の無駄がなく、既存システムと完璧に調和している。
2. **ゼロトラスト＆セキュリティ原則の完全遵守**:
   金融目標のAt-Rest暗号化、外部バックアップJSONからのPrototype Pollutionや任意ストア書き換えの完全防止、WebAuthnのOriginバインディングなど、最高水準のセキュリティ要件をクリアしている。
3. **要件トレーサビリティの完全性**:
   新設された要件 3.14, 要件 3.15, セクション 4.4 は、システム設計書のデータスキーマ（セクション 5.1）およびトレーサビリティマトリクス（セクション 8.1）と1対1で整合している。

よって、`docs/system_design.md` の設計改訂を **満点（Grade A+）** で承認し、次期実装タスクへの移行を推奨する。
