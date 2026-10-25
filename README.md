# よせあつめ家計簿 (Yoseatsume Kakeibo)

脱ベンダーロックイン・ランニングコストゼロ・複式簿記ライクなPWA家計・資産管理システム。

HTML5/Vanilla JS (ES Modules)、GitHub Pages、Google Apps Script (GAS)、Google Driveといった無料サービスや日々の差分データを「よせあつめ」、それぞれの役割分担によって堅牢で高速な家計・資産管理を実現します。

---

## 主な特徴

1. **ランニングコストゼロ & 脱ベンダーロックイン**
   * サーバー代・DB維持費完全ゼロ。
   * ビルドツール不要の標準Web技術（Vanilla JS ES Modules, CSS, HTML5）とプレーンテキスト（JSON）で永続化。何年経ってもライブラリ終了でデータが読めなくなる心配がありません。
2. **複式簿記ライクな単一レコード仕訳**
   * 1レコード＝1仕訳のシンプル設計。
   * 立替払い（自己負担分と立替金振替の2レコード自動生成）や、立替回収（立替金から受取口座への振替）を正確に管理。
3. **2軸の分類管理（計上分類 × 実態分類）**
   * 予算管理・メイン集計用の「計上分類」と、モノ・サービスの性質を表す「実態分類」を併せ持ち、グラフ表示もワンタップで切り替え可能。
4. **年払い・まとめ払いの前払費用月次償却**
   * 年会費などを一括決済しつつ、各月に均等償却（割り切れない端数は初月に加算）。
5. **定期支出の一括予定生成 & 祝日補正**
   * 毎月の固定費や家賃などを「予定（planned）」として一括生成。
   * 日本の祝日や土日に応じた「前倒し（before）」「後ろ倒し（after）」の営業日補正に対応。
6. **Ed25519公開鍵暗号による通信保護 & PIN暗号化**
   * ブラウザ内でEd25519鍵ペアを生成し、秘密鍵はPINコード（PBKDF2 + AES-GCM）で保護。
   * リクエスト毎に電子署名とタイムスタンプを付与し、GAS側でリプレイ攻撃と改ざんを防止。

---

## 🚀 GAS バックエンドの一発立ち上げ手順

GAS（Google Apps Script）は、Google Driveへのデータ永続化、月締めアーカイブ生成、過去データ修正時の連鎖再計算を担当します。

### Google スプレッドシートから立ち上げ（ブロック警告ゼロ）

Google スプレッドシートにスクリプトを紐付ける（コンテナバインド）ことで、権限スコープが **`spreadsheets.currentonly`（このドキュメントのみ）** に限定され、Google の機密アクセスブロック（`This app is blocked` / `このアプリはブロックされます`）を **100% 確実に回避** できます（個人アカウント、企業・学校の Workspace アカウントいずれでも動作します）。

1. [Google スプレッドシート (sheets.google.com)](https://sheets.google.com/) にアクセスし、**「空白のスプレッドシート」** を新規作成します。
2. 左上のファイル名を「よせあつめ家計簿」に変更します。
3. 上部メニューの **[拡張機能] → [Apps Script]** をクリックします。
4. エディタが開いたら、リポジトリ内の最新の [**`gas/Code.gs`**](file:///home/k/workspace/yose/gas/Code.gs) の内容をコピーし、エディタの `Code.gs` にすべて貼り付けて保存（`Ctrl + S`）します。
5. **マニフェストファイル（appsscript.json）の設定**:
   * 左メニューの **[プロジェクトの設定 (歯車アイコン ⚙️)]** をクリック。
   * **「「appsscript.json」マニフェスト ファイルをエディタで表示する」** にチェックを入れます。
   * 左メニューの **[< > エディタ]** に戻ると `appsscript.json` が表示されるので、リポジトリ内の `gas/appsscript.json` の内容を貼り付けて保存します:
     ```json
     {
       "timeZone": "Asia/Tokyo",
       "dependencies": {},
       "exceptionLogging": "STACKDRIVER",
       "runtimeVersion": "V8",
       "oauthScopes": [
         "https://www.googleapis.com/auth/spreadsheets.currentonly"
       ],
       "webapp": {
         "access": "ANYONE_ANONYMOUS",
         "executeAs": "USER_DEPLOYING"
       }
     }
     ```
   > [!TIP]
   > スコープが `spreadsheets.currentonly`（このドキュメントのみに限定）となるため、Google ドライブ全体や他ファイルへのアクセス要求が発生せず、Google によるセキュリティブロック（`このアプリはブロックされます`）が一切発生しません。
6. **初回権限承認（ワンクリック）**:
   * エディタ上部の関数プルダウンで **`initialSetup`** を選択し、**[実行]** をクリックします。
   * 「アクセスを承認」画面が出たらアカウントを選択し、**[許可]** します（`@OnlyCurrentDoc` により警告画面が出ずに即時承認されます）。
   * 実行ログに `よせあつめ家計簿: 初期化成功！` と表示され、スプレッドシート内に必要なデータシートが初期化されます。

### 🔑 共通設定（公開鍵登録 & デプロイURL取得）

1. **公開鍵（USER_PUBLIC_KEYS）の登録**:
   * PWAの「⚙️ 設定・マスタ」画面で生成された **Ed25519 公開鍵 (Base64)** をコピーします。
   * GASエディタの [プロジェクトの設定 (歯車アイコン ⚙️)] → [スクリプト プロパティ] を開き、**[スクリプト プロパティを追加]** をクリック:
     * **プロパティ**: `USER_PUBLIC_KEYS`
     * **値**: コピーした公開鍵（複数端末の場合はカンマ区切りまたはJSON配列）
     * **[スクリプト プロパティを保存]** をクリック。
2. **ウェブアプリの公開・更新**:
   * **旧版から認証是正版へ初めて更新する場合は、公開操作より先に下記3の停止・実行終了確認・10分超待機を行う。**
   * **初回デプロイの場合**:
     * 右上の **[デプロイ] → [新しいデプロイ]** をクリック。
     * **種類の選択 (歯車アイコン)**: `ウェブアプリ`
     * **説明**: `Production` など任意
     * **次のユーザーとして実行**: `自分 (YOUR_ACCOUNT@gmail.com)`
     * **アクセスできるユーザー**: `全員（Googleログイン不要、ANYONE_ANONYMOUS）`
     * **[デプロイ]** を押し、発行された **ウェブアプリのURL**（`https://script.google.com/macros/s/.../exec`）をコピーします。
   * **既にデプロイ済みでコードや権限を更新した場合**:
     * 右上の **[デプロイ] → [デプロイを管理]** をクリック。
     * アクティブなデプロイを選択し、右上の **[鉛筆アイコン ✏️ (編集)]** をクリック。
     * **次のユーザーとして実行** が自分、**アクセスできるユーザー** がGoogleログイン不要の全員であることを確認する。マニフェストの変更だけで公開済み設定が変更されるとは限らない。
     * **バージョン** を **「新バージョン」** に変更して **[デプロイ]** をクリック（URLは変わらないためPWA側の再設定は不要です）。
   * 公開後はシークレットタブで `/exec` を直接開き、`status: ok` の固定JSONが返ることを確認する。これはGETの到達確認であり、署名付きPOSTの同期成功はPWAから別途確認する必要がある。通常のデータ取得・更新は登録済み公開鍵に対応する署名で認可されるため、公開前の `USER_PUBLIC_KEYS` 登録を省略しない。
3. **旧版から認証是正版への初回移行**:
   * 旧版の公開デプロイをすべて停止し、別の旧版URLも残さない。
   * GASの実行一覧で旧版の実行がすべて終了したことを確認し、その時刻から**10分を超えて**待ってから新版を公開する。旧版で処理済みの署名要求が有効期間内に再実行されることを防ぐ。
   * 新版では公開APIからの鍵登録を受け付けない。既存の正しい `USER_PUBLIC_KEYS` は維持し、未設定の場合は所有者が公開前に設定する。
   * 公開URLが変わった場合はPWAの接続先を更新し、旧要求の拒否と新しい署名付き同期の成功を確認する。再送防止は `AUTH_REPLAY_` で始まるスクリプトプロパティへ保存する。稼働中にこれらを削除しない。
   * 詳細と障害時の扱いは[認証是正設計](docs/gas_auth_hardening.md)を参照する。
4. **PWAへのURL設定**:
   * PWAアプリの「⚙️ 設定・マスタ」画面の「GAS Web App URL」欄にURLを貼り付けて **「URLを保存」** をクリックします。
   * **「🔄 今すぐ差分同期」** を押して、初回同期が成功することを確認してください。

---

### 🛡️ トラブルシューティング

#### Q1. 「このアプリはブロックされます / This app is blocked」が出る場合
* **原因**: Google はフル Drive アクセス権（`auth/drive`）などの機密スコープを未検証アプリが要求することを禁止しています。
* **解決策**:
  上記「**方法 A: Google スプレッドシートから立ち上げ**」をお使いください。スプレッドシートのコンテナバインドスクリプト（`@OnlyCurrentDoc`）を使用することで、Google の機密スコープ制限に一切引っかからず、会社・学校アカウントでも即座に動作します。
  * Google OAuth のセッション競合により誤検知されることがあります。
  * 解決策: ブラウザの「シークレットウィンドウ」を開き、該当アカウント 1 つだけでログインして `initialSetup` を実行してください。

---

## 💻 ローカル開発 & PWAアプリの起動

静的ファイルのみで構成されているため、ビルドツール不要で任意のローカルHTTPサーバーで即座に動作します。

```bash
# Pythonの簡易サーバーで起動する場合
python3 -m http.server 8080

# または Node.js http-server
npx http-server . -p 8080
```

ブラウザで `http://localhost:8080` を開きます。

---

## 🧪 テスト実行 & カバレッジ測定

Node.js標準テストランナーで単体・結合・システム試験を、CDP経由の実ChromiumでUI試験を実行する。検証環境はNode.js 24とChromiumである。静的検査・全原本カバレッジ用の開発依存を、事前に`npm ci`で導入する。

```bash
# 静的検査と単体・結合・システム試験（Node標準の参考coverageを出力）
npm test

# 実ChromiumのUI試験
npm run test:ui

# 全4層を実行し、本番の全JS/GAS/SWでLine/Branch各97%以上を判定
npm run test:coverage

# 単体テストのみ実行
npm run test:unit

# 結合テストのみ実行
npm run test:integration

# システム（E2E）テストのみ実行
npm run test:system
```

`test:coverage`はテスト時のみIstanbul counterを挿入し、Nodeとブラウザの実行結果を共通の原本位置へ統合する。未実行ファイルも含め、対象漏れ・原本差異・計測失敗・各97%未達を終了コード非0で報告する。HTML/JSONレポートは`coverage/`、原本manifestと生記録は実行時に表示する`/tmp/yose-coverage-*`へ出力する。Node標準coverageとは測定器・対象が異なるため数値を混同しない。

---

## 📁 ディレクトリ構成

```text
yose/
 ├── .github/
 │    └── pull_request_template.md # プルリクエスト日本語テンプレート
 ├── index.html              # メイン画面（SPA：入力・集計・マスタ設定）
 ├── manifest.json           # PWAマニフェスト
 ├── sw.js                   # Service Worker（オフラインキャッシュ制御）
 ├── css/
 │    └── style.css          # スタイルシート（レスポンシブ・カードUI）
 ├── js/
 │    ├── app.js             # UIイベント制御・マスタ編集・明細編集・グラフ描画
 │    ├── db.js              # IndexedDB管理（Schema v2）
 │    ├── logic.js           # 財務計算・休日補正・前払償却・立替・2軸分類
 │    ├── crypto.js          # Web Crypto Ed25519署名・PIN暗号化
 │    └── sync.js            # GAS同期クライアント（CORS回避・keepalive）
 ├── gas/
 │    ├── Code.gs            # GASバックエンド（署名検証・LockService・Spreadsheet JSON保存・月締め）
 │    └── appsscript.json    # GASマニフェスト（V8・Web App設定）
 ├── scripts/
 │    ├── setup_gas.js       # GASセットアップ支援スクリプト
 │    └── setup_gas.sh       # シェル実行ラッパー
 ├── test/
 │    ├── unit/              # 単体テスト（logic, crypto, db, sync, gas, master, tx_edit）
 │    ├── integration/       # 結合テスト（sync_flow, recurrent_and_amortization）
 │    └── system/            # システムテスト（e2e_scenario）
 └── docs/
      ├── system_design.md       # 設計文書索引・旧章対応
      ├── requirements.md        # 要件定義書
      ├── external_design.md     # 外部設計書（画面・操作・入出力）
      ├── internal_design.md     # 内部設計書（構成・計算・保存・通信）
      ├── design_test_audit.md   # 設計と既存テストの対応・不足
      ├── development_process.md # 開発プロセス定義書（品質ゲート・独立サブエージェントレビュー）
      └── reviews/               # 独立監査・レビュー記録ディレクトリ
           ├── review1.md        # 第1回独立設計・セキュリティ監査レポート
           └── review2.md        # 第2回プロセス・PRテンプレート監査レポート
```


## 要件・設計・検証の参照先

[要件定義](docs/requirements.md)、[外部設計](docs/external_design.md)、[内部設計](docs/internal_design.md)を分けて管理する。既存テストの確認範囲と未検証項目は[設計テスト監査](docs/design_test_audit.md)、旧番号との対応は[文書索引](docs/system_design.md)を参照する。
