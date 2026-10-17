#!/usr/bin/env node

/**
 * Yoseatsume Kakeibo - One-step Google Apps Script (GAS) Setup & Deployment Assistant
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const gasDir = path.join(rootDir, 'gas');
const claspConfigPath = path.join(rootDir, '.clasp.json');

console.log('====================================================');
console.log(' 🧺 よせあつめ家計簿 - GAS バックエンド一発立ち上げ');
console.log('====================================================\n');

function run(cmd, desc) {
	console.log(`▶ ${desc}...`);
	try {
		const output = execSync(cmd, { cwd: rootDir, encoding: 'utf-8', stdio: 'pipe' });
		if (output) console.log(output.trim());
		return true;
	} catch (err) {
		console.warn(`⚠️ コマンド実行情報: ${err.message}`);
		return false;
	}
}

async function main() {
	const args = process.argv.slice(2);
	const command = args[0] || 'all';

	if (!fs.existsSync(claspConfigPath)) {
		console.log('ℹ️  .clasp.json が存在しません。新規プロジェクト設定ファイルを生成します。');
		const defaultClasp = {
			scriptId: "",
			rootDir: "gas"
		};
		fs.writeFileSync(claspConfigPath, JSON.stringify(defaultClasp, null, 2));
	}

	console.log('【ステップ 1】Google Clasp 認証または Web エディタ利用');
	console.log('※ clasp login で「This app is blocked」と表示される場合は、ブラウザ（script.google.com）での直接作成が推奨されます。');
	console.log('   コマンド: npx @google/clasp login\n');

	console.log('【ステップ 2】GAS プロジェクトの作成または既存プロジェクトの紐付け');
	console.log('   新規作成する場合: npx @google/clasp create --type webapp --title "よせあつめ家計簿" --rootDir gas');
	console.log('   既存スクリプトを使う場合: .clasp.json の scriptId にスクリプトIDを記載\n');

	console.log('【ステップ 3】スクリプトコードのプッシュ (Code.gs & appsscript.json)');
	console.log('   コマンド: npx @google/clasp push\n');

	console.log('【ステップ 4】Web App としてデプロイ');
	console.log('   コマンド: npx @google/clasp deploy --description "Production"\n');

	console.log('====================================================');
	console.log(' 🔑 Google Apps Script 設定チェックリスト（重要）');
	console.log('====================================================');
	console.log('1. Google スプレッドシート（sheets.google.com）で「よせあつめ家計簿」を新規作成');
	console.log('   上部メニューの [拡張機能] -> [Apps Script] をクリック（コンテナバインドで作成）');
	console.log('2. gas/Code.gs をエディタに貼り付けて保存');
	console.log('3. [プロジェクトの設定 (歯車アイコン)] -> [「appsscript.json」マニフェスト ファイルをエディタで表示する] にチェック');
	console.log('   ※ gas/appsscript.json（spreadsheets.currentonly）を定義して保存');
	console.log('4. 関数一覧から「initialSetup」を選び「実行」をクリックして権限を承認');
	console.log('   ※ @OnlyCurrentDoc により「このアプリはブロックされます」の機密制限を完全に回避できます。');
	console.log('5. [プロジェクトの設定] -> [スクリプト プロパティ] を開く');
	console.log('   - プロパティ名: USER_PUBLIC_KEYS');
	console.log('   - 値: PWA設定画面で生成された Ed25519 公開鍵 (Base64 文字列) を登録');
	console.log('6. [デプロイ] -> [新しいデプロイ] を選択');
	console.log('   - 種類の選択: ウェブアプリ');
	console.log('   - 次のユーザーとして実行: 自分');
	console.log('   - アクセスできるユーザー: 全員 (Anyone)');
	console.log('7. 発行された「ウェブアプリのURL」をコピーし、PWAの設定画面の GAS URL に貼り付けて保存！');
	console.log('====================================================\n');
}

main().catch(console.error);

