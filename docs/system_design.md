# 「よせあつめ家計簿」設計文書索引

旧「要件定義・システム設計書」は次の三文書へ分割した。本書は入口と移行対応のみを保持し、要求や実現方式の正本を重複させない。

| 文書 | 責務 |
| --- | --- |
| [要件定義書](requirements.md) | 目的、業務規則、必要な機能と非機能制約である。 |
| [外部設計書](external_design.md) | 利用者の画面/操作、確認/エラー、入出力と公開通信契約である。 |
| [税・控除計算設計](furusato_calculation.md) | 費目割当、給与/生命/住宅の導出、専用タブと年額確認の正本である。 |
| [内部設計書](internal_design.md) | 実装構成、計算、永続化、暗号、同期、排他/復旧方式である。 |
| [設計テスト監査](design_test_audit.md) | 外部/内部設計と既存assertの対応、不足、仕様乖離、実行結果である。 |
| [UIテスト監査](ui_test_audit.md) | UI回帰の追加経緯と領域別確認である。 |
| [グラフ・年間目標設計](chart_budget_improvements.md) | 推移操作、収入内訳、目標連動の正本である。 |
| [過去明細の一括編集可否](bulk_edit_eligibility.md) | R/E/I-3.64の共通能力・金融構造保護・制限理由・キャンセルと戻る操作である。 |
| [資産表示・個別参照・年間月締め](asset_trends_annual_closing.md) | R/E/I-3.63の表示階層・ヒット判定・年次締め・工程再入の詳細である。 |
| [GAS認証是正](gas_auth_hardening.md) | 管理登録・時刻/点検証・永続再送拒否の正本である。 |
| [開発プロセス](development_process.md) | 変更手順と独立レビュー、受入基準である。 |

旧番号3.x/4.xを維持し、要件はR、外部設計はE、内部設計はIの識別子と明示アンカーで参照する。要件/設計の記載は実装済み・完全検証済みを意味しない。旧版の全文はGit履歴のe817c6f/b547c13から参照できる。

## 旧章からの移行先

| 旧章 | 移行先 |
| --- | --- |
| 1 プロジェクト概要 | [要件定義1](requirements.md#1-プロジェクト概要) |
| 2 システム構成・ディレクトリ・保存・セットアップ | [内部設計I-2.1〜2.4](internal_design.md#i-2-1) |
| 3 機能要件 | 下表のR/E/I対応へ分割する。 |
| 4.1〜4.5 通信・認証・鍵管理 | [要件定義4](requirements.md#r-4-1)、[外部設計E-4.1〜4.5](external_design.md#e-4-1)、[内部設計I-4.1〜4.4](internal_design.md#i-4-1) |
| 4.6/4.7 UI/コア構造 | [要件定義4.6](requirements.md#r-4-6)、[内部設計I-4.6/4.7](internal_design.md#i-4-6) |
| 4.8 旧PRF移行 | [要件4.8](requirements.md#r-4-8)、[外部E-4.8](external_design.md#e-4-8)、[内部I-4.8](internal_design.md#i-4-8) |
| 5 JSONスキーマ | [外部設計E-5](external_design.md#e-5)、[内部格納I-5](internal_design.md#i-5) |
| 6.1.1 文脈図 | [外部設計E-6.1.1](external_design.md#e-6-1-1) |
| 6.1.2 詳細DFD | [内部設計I-6.1.2](internal_design.md#i-6-1-2) |
| 6.2 ユースケース | [外部設計E-6.2](external_design.md#e-6-2) |
| 6.3 処理シーケンス | [内部設計I-6.3.1〜6.3.6](internal_design.md#i-6-3-1) |
| 6.4 ERD | [内部設計I-6.4](internal_design.md#i-6-4) |
| 6.5 画面遷移 | [外部設計E-6.5](external_design.md#e-6-5) |
| 7 実装上の方針 | [内部設計I-7.1〜7.8](internal_design.md#i-7-1) |
| 8 旧対応表・整合性断定 | [設計テスト監査](design_test_audit.md)へ更新する。旧「乖離なし/全て対応」の無条件な断定は引き継がない。 |

## 旧機能番号の対応

I欄は主な実現方式の入口であり、一つの内部節だけで当該要求を全て満たすという意味ではない。詳細なassert対応と不足は監査表を参照する。

| 旧番号 | 機能 | 要件 | 外部 | 内部の主な入口 |
| --- | --- | --- | --- | --- |
| <a id="31-入力仕訳要件複式簿記ライクな単一レコード構造"></a>3.1 | 入力・仕訳要件（複式簿記ライクな単一レコード構造） | [R-3.1](requirements.md#r-3-1) | [E-3.1](external_design.md#e-3-1) | [I-3.1](internal_design.md#i-3-1) |
| <a id="32-定期支出と休日補正要件"></a>3.2 | 定期支出と休日補正要件 | [R-3.2](requirements.md#r-3-2) | [E-3.2](external_design.md#e-3-2) | [I-3.2](internal_design.md#i-3-2) |
| <a id="33-年払いまとめ払いの分割計上要件前払費用の月次償却"></a>3.3 | 年払い・まとめ払いの分割計上要件（前払費用の月次償却） | [R-3.3](requirements.md#r-3-3) | [E-3.3](external_design.md#e-3-3) | [I-3.3](internal_design.md#i-3-3) |
| <a id="34-集計グラフ表示月締め要件"></a>3.4 | 集計・グラフ表示・月締め要件 | [R-3.4](requirements.md#r-3-4) | [E-3.4](external_design.md#e-3-4) | [I-3.4](internal_design.md#i-3-4) |
| <a id="35-資産口座の統合要件投資有価証券口座の一本化"></a>3.5 | 資産口座の統合要件（投資・有価証券口座の一本化） | [R-3.5](requirements.md#r-3-5) | [E-3.5](external_design.md#e-3-5) | [I-3.4](internal_design.md#i-3-4) |
| <a id="36-設定マスタ編集ui要件"></a>3.6 | 設定マスタ編集UI要件 | [R-3.6](requirements.md#r-3-6) | [E-3.6](external_design.md#e-3-6) | [I-3.6](internal_design.md#i-3-6) |
| <a id="37-取引明細のタッチ編集遡及更新要件"></a>3.7 | 取引明細のタッチ編集・遡及更新要件 | [R-3.7](requirements.md#r-3-7) | [E-3.7](external_design.md#e-3-7) | [I-3.7](internal_design.md#i-3-7) |
| <a id="38-祝日データの一括インポート要件"></a>3.8 | 祝日データの一括インポート要件 | [R-3.8](requirements.md#r-3-8) | [E-3.8](external_design.md#e-3-8) | [I-4.7](internal_design.md#i-4-7) |
| <a id="39-ポイント払い相殺取引要件"></a>3.9 | ポイント払い・相殺取引要件 | [R-3.9](requirements.md#r-3-9) | [E-3.9](external_design.md#e-3-9) | [I-3.1](internal_design.md#i-3-1) |
| <a id="310-多粒度集計日別月別年別および資産残高推移表示要件"></a>3.10 | 多粒度集計（日別・月別・年別）および資産残高・推移表示要件 | [R-3.10](requirements.md#r-3-10) | [E-3.10](external_design.md#e-3-10) | [I-3.4](internal_design.md#i-3-4) |
| <a id="311-設定マスタのgas統合同期要件"></a>3.11 | 設定マスタのGAS統合同期要件 | [R-3.11](requirements.md#r-3-11) | [E-3.11](external_design.md#e-3-11) | [I-4.1](internal_design.md#i-4-1) |
| <a id="312-取引種別の統合と入力モードの調和"></a>3.12 | 取引種別の統合と入力モードの調和 | [R-3.12](requirements.md#r-3-12) | [E-3.12](external_design.md#e-3-12) | [I-3.7](internal_design.md#i-3-7) |
| <a id="313-pwa強制バージョンチェックおよび自動手動アップデート要件"></a>3.13 | PWA強制バージョンチェックおよび自動・手動アップデート要件 | [R-3.13](requirements.md#r-3-13) | [E-3.13](external_design.md#e-3-13) | [I-7.7](internal_design.md#i-7-7) |
| <a id="314-年間予算貯蓄目標および消化進捗の可視化要件"></a>3.14 | 年間予算・貯蓄目標および消化進捗の可視化要件 | [R-3.14](requirements.md#r-3-14) | [E-3.14](external_design.md#e-3-14) | [I-3.5](internal_design.md#i-3-5) |
| <a id="315-バックアップjsonインポート時の非破壊差分マージorマージ要件"></a>3.15 | バックアップJSONインポート時の非破壊・差分マージ（ORマージ）要件 | [R-3.15](requirements.md#r-3-15) | [E-3.15](external_design.md#e-3-15) | [I-3.8](internal_design.md#i-3-8) |
| <a id="316-集計グラフ画面における迅速年月選択年月ピッカー要件"></a>3.16 | 集計・グラフ画面における迅速年月選択（年月ピッカー）要件 | [R-3.16](requirements.md#r-3-16) | [E-3.16](external_design.md#e-3-16) | [I-3.7](internal_design.md#i-3-7) |
| <a id="317-集計分類実態分類の軸切替ui表記統一要件"></a>3.17 | 集計分類・実態分類の軸切替UI表記統一要件 | [R-3.17](requirements.md#r-3-17) | [E-3.17](external_design.md#e-3-17) | [I-3.4](internal_design.md#i-3-4) |
| <a id="318-タグのチップuiおよび集計検索グラフ表示要件"></a>3.18 | タグのチップUIおよび集計・検索・グラフ表示要件 | [R-3.18](requirements.md#r-3-18) | [E-3.18](external_design.md#e-3-18) | [I-3.7](internal_design.md#i-3-7) |
| <a id="319-メモ入力サジェスチョンおよび費目中項目の自動連動補完要件"></a>3.19 | メモ入力サジェスチョンおよび費目・中項目の自動連動補完要件 | [R-3.19](requirements.md#r-3-19) | [E-3.19](external_design.md#e-3-19) | [I-3.7](internal_design.md#i-3-7) |
| <a id="320-立替払い未回収リストおよびワンクリック返済精算要件"></a>3.20 | 立替払い未回収リストおよびワンクリック返済精算要件 | [R-3.20](requirements.md#r-3-20) | [E-3.20](external_design.md#e-3-20) | [I-3.1](internal_design.md#i-3-1) |
| <a id="321-クレジットカード締め日口座引き落とし日設定および自動引き落とし相殺要件"></a>3.21 | クレジットカード締め日・口座引き落とし日設定および自動引き落とし相殺要件 | [R-3.21](requirements.md#r-3-21) | [E-3.21](external_design.md#e-3-21) | [I-3.2](internal_design.md#i-3-2) |
| <a id="322-分割計上取引installment--prepaid-amortizationの一括連動更新要件"></a>3.22 | 分割計上取引（Installment / Prepaid Amortization）の一括連動更新要件 | [R-3.22](requirements.md#r-3-22) | [E-3.22](external_design.md#e-3-22) | [I-3.3](internal_design.md#i-3-3) |
| <a id="323-計上分類実態分類のクロス集計マトリクスピボット要件"></a>3.23 | 計上分類×実態分類のクロス集計（マトリクス/ピボット）要件 | [R-3.23](requirements.md#r-3-23) | [E-3.23](external_design.md#e-3-23) | [I-3.5](internal_design.md#i-3-5) |
| <a id="324-ダークテーマ対応システム追従ライトダーク要件"></a>3.24 | ダークテーマ対応（システム追従・ライト・ダーク）要件 | [R-3.24](requirements.md#r-3-24) | [E-3.24](external_design.md#e-3-24) | [I-3.7](internal_design.md#i-3-7) |
| <a id="325-金額入力欄の簡易電卓機能統合要件四則演算810税抜統合"></a>3.25 | 金額入力欄の簡易電卓機能統合要件（四則演算・8%・10%・税抜統合） | [R-3.25](requirements.md#r-3-25) | [E-3.25](external_design.md#e-3-25) | [I-3.7](internal_design.md#i-3-7) |
| <a id="326-各種データ種別ごとのjsonエクスポート--自動判別インポートデータポータビリティ強化要件"></a>3.26 | 各種データ種別ごとのJSONエクスポート & 自動判別インポート（データポータビリティ強化）要件 | [R-3.26](requirements.md#r-3-26) | [E-3.26](external_design.md#e-3-26) | [I-3.8](internal_design.md#i-3-8) |
| <a id="327-費目別推移内訳のドーナツグラフ可視化要件"></a>3.27 | 費目別推移・内訳のドーナツグラフ可視化要件 | [R-3.27](requirements.md#r-3-27) | [E-3.27](external_design.md#e-3-27) | [I-3.4](internal_design.md#i-3-4) |
| <a id="328-各種ドーナツグラフのタッチホバー時ツールチップへのパーセント構成比表示追加要件"></a>3.28 | 各種ドーナツグラフのタッチ・ホバー時ツールチップへのパーセント（構成比）表示追加要件 | [R-3.28](requirements.md#r-3-28) | [E-3.28](external_design.md#e-3-28) | [I-3.4](internal_design.md#i-3-4) |
| <a id="329-明細一覧の表示階層刷新費目中項目メインメモタグ補助表示要件"></a>3.29 | 明細一覧の表示階層刷新（費目・中項目メイン、メモ・タグ補助表示）要件 | [R-3.29](requirements.md#r-3-29) | [E-3.29](external_design.md#e-3-29) | [I-3.29](internal_design.md#i-3-29)、[I-4.6](internal_design.md#i-4-6) |
| <a id="330-明細一覧のマルチフィルタリング費目タグキーワード状態による絞り込み要件"></a>3.30 | 明細一覧のマルチフィルタリング（費目・タグ・キーワード・状態による絞り込み）要件 | [R-3.30](requirements.md#r-3-30) | [E-3.30](external_design.md#e-3-30) | [I-3.4](internal_design.md#i-3-4) |
| <a id="331-中項目を選択しない費目のみ指定選択肢の追加要件"></a>3.31 | 中項目を選択しない（費目のみ指定）選択肢の追加要件 | [R-3.31](requirements.md#r-3-31) | [E-3.31](external_design.md#e-3-31) | [I-3.1](internal_design.md#i-3-1) |
| <a id="332-スマートフォンにおけるメモタグ入力欄のフォーカスアウト時サジェスト非表示制御要件"></a>3.32 | スマートフォンにおけるメモ・タグ入力欄のフォーカスアウト時サジェスト非表示制御要件 | [R-3.32](requirements.md#r-3-32) | [E-3.32](external_design.md#e-3-32) | [I-3.7](internal_design.md#i-3-7) |
| <a id="333-取引入力完了時のトースト通知完了ポップアップ表示要件"></a>3.33 | 取引入力完了時のトースト通知（完了ポップアップ）表示要件 | [R-3.33](requirements.md#r-3-33) | [E-3.33](external_design.md#e-3-33) | [I-4.6](internal_design.md#i-4-6) |
| <a id="334-口座種別への負債ローン-loanの追加要件および負債残高表記の統一"></a>3.34 | 口座種別への負債「ローン (`loan`)」の追加要件および負債残高表記の統一 | [R-3.34](requirements.md#r-3-34) | [E-3.34](external_design.md#e-3-34) | [I-3.4](internal_design.md#i-3-4) |
| <a id="335-口座種別への保険-insurance追加定期出費ルール満期日の同時設定要件"></a>3.35 | 口座種別への「保険 (`insurance`)」追加（定期出費ルール・満期日の同時設定）要件 | [R-3.35](requirements.md#r-3-35) | [E-3.35](external_design.md#e-3-35) | [I-3.2](internal_design.md#i-3-2) |
| <a id="336-集計グラフタブの3タブ分割収支--予算実績--資産および各タブ専用表示の整理要件"></a>3.36 | 集計・グラフタブの3タブ分割（収支 / 予算・実績 / 資産）および各タブ専用表示の整理要件 | [R-3.36](requirements.md#r-3-36) | [E-3.36](external_design.md#e-3-36) | [I-4.6](internal_design.md#i-4-6) |
| <a id="337-各画面収支予算資産設定における各ペインカードの折りたたみ表示非表示切替要件"></a>3.37 | 各画面（収支・予算・資産・設定）における各ペイン（カード）の折りたたみ（表示/非表示）切替要件 | [R-3.37](requirements.md#r-3-37) | [E-3.37](external_design.md#e-3-37) | [I-3.7](internal_design.md#i-3-7) |
| <a id="338-収支タブの口座別費目別タグ別集計項目タッチによる明細一覧へのドリルダウン連動要件"></a>3.38 | 収支タブの口座別・費目別・タグ別集計項目タッチによる明細一覧へのドリルダウン連動要件 | [R-3.38](requirements.md#r-3-38) | [E-3.38](external_design.md#e-3-38) | [I-3.4](internal_design.md#i-3-4) |
| <a id="339-ヘッドレスchrome実ブラウザuiテストによる網羅的品質保証とuiux安全性不具合の恒久的修正要件"></a>3.39 | ヘッドレスChrome実ブラウザUIテストによる網羅的品質保証とUI/UX・安全性不具合の恒久的修正要件 | [R-3.39](requirements.md#r-3-39) | [E-3.39](external_design.md#e-3-39) | [I-4.6](internal_design.md#i-4-6) |
| <a id="340-入力サジェストui制御クレカ引落口座連携表示集計粒度別明細表示およびページネーション要件"></a>3.40 | 入力サジェストUI制御・クレカ引落口座連携表示・集計粒度別明細表示およびページネーション要件 | [R-3.40](requirements.md#r-3-40) | [E-3.40](external_design.md#e-3-40) | [I-3.7](internal_design.md#i-3-7) |
| <a id="341-静的型チェック自動検証checktypesおよび集計設定全機能網羅uiテスト拡充予定トグル軸切替年次予算テーマ要件"></a>3.41 | 静的型チェック自動検証（check:types）および集計・設定全機能網羅UIテスト拡充（予定トグル・軸切替・年次予算・テーマ）要件 | [R-3.41](requirements.md#r-3-41) | [E-3.41](external_design.md#e-3-41) | [I-4.7](internal_design.md#i-4-7) |
| <a id="342-ui回帰テストに基づく入力編集一覧インポート境界の整合性"></a>3.42 | UI回帰テストに基づく入力・編集・一覧・インポート境界の整合性 | [R-3.42](requirements.md#r-3-42) | [E-3.42](external_design.md#e-3-42) | [I-3.10](internal_design.md#i-3-10) |
| <a id="343-パスキー互換性日常操作双方向同期の改善"></a>3.43 | パスキー互換性・日常操作・双方向同期の改善 | [R-3.43](requirements.md#r-3-43) | [E-3.43](external_design.md#e-3-43) | [I-4.4](internal_design.md#i-4-4) |
| <a id="344-モバイル編集アーカイブ保守マスタ統合同期"></a>3.44 | モバイル編集・アーカイブ保守・マスタ統合同期 | [R-3.44](requirements.md#r-3-44) | [E-3.44](external_design.md#e-3-44) | [I-3.6](internal_design.md#i-3-6) |
| <a id="3441-共有マスタの背景同期補足"></a>3.44.1 | 共有マスタの背景同期補足 | [R-3.44.1](requirements.md#r-3-44-1) | [E-3.44.1](external_design.md#e-3-44-1) | [I-4.1](internal_design.md#i-4-1) |
| <a id="3442-設定競合の確認取消と確認待ち"></a>3.44.2 | 設定競合の確認取消と確認待ち | [R-3.44.2](requirements.md#r-3-44-2) | [E-3.44.2](external_design.md#e-3-44-2) | [I-4.1](internal_design.md#i-4-1) |
| <a id="345-セクション操作編集分類完全インポート"></a>3.45 | セクション操作・編集分類・完全インポート | [R-3.45](requirements.md#r-3-45) | [E-3.45](external_design.md#e-3-45) | [I-3.9](internal_design.md#i-3-9) |
| <a id="346-全更新境界のデータ整合性"></a>3.46 | 全更新境界のデータ整合性 | [R-3.46](requirements.md#r-3-46) | [E-3.46](external_design.md#e-3-46) | [I-3.10](internal_design.md#i-3-10) |
| <a id="347-アーカイブ明細のメンテナンス更新と費目推移"></a>3.47 | アーカイブ明細のメンテナンス更新と費目推移 | [R-3.47](requirements.md#r-3-47) | [E-3.47](external_design.md#e-3-47) | [I-3.4](internal_design.md#i-3-4) |
| <a id="348-定期ルール入力切替精算の操作整合性1121"></a>3.48 | 定期ルール・入力切替・精算の操作整合性（1.12.1） | [R-3.48](requirements.md#r-3-48) | [E-3.48](external_design.md#e-3-48) | [I-3.7](internal_design.md#i-3-7) |
| <a id="349-パスキー解除と既存立替回収"></a>3.49 | パスキー単独解除・日本語種別・既存回収の関連付け | [R-3.49](requirements.md#r-3-49) | [E-3.49](external_design.md#e-3-49) | [I-3.49](internal_design.md#i-3-49) |
| 3.55〜58 | データメタ情報・明細一括編集・ふるさと納税枠・投資推移 | [R-3.55](requirements.md#r-3-55)〜[R-3.58](requirements.md#r-3-58) | [E-3.55〜58](external_design.md#e-3-55) | [I-3.55〜58](internal_design.md#i-3-55) |
| 3.61 | データ情報・税控除の表示階層と明細ページ操作 | [R-3.61](requirements.md#r-3-61) | [E-3.61](external_design.md#e-3-61) | [I-3.61](internal_design.md#i-3-61) |
| 3.63 | 資産表示・個別系列参照・年間月締め | [R-3.63](requirements.md#r-3-63) | [E-3.63](external_design.md#e-3-63) | [I-3.63](internal_design.md#i-3-63) |
| 3.64 | 過去明細の一括編集可否 | [R-3.64](requirements.md#r-3-64) | [E-3.64](external_design.md#e-3-64) | [I-3.64](internal_design.md#i-3-64) |

## 改訂と監査

分割の基点・独立レビュー・再実行記録は[review54](reviews/review54.md)に記録する。過去レビューが本書へ張ったリンクは当時の経緯の記録であり、現行仕様は分割先を参照する。
