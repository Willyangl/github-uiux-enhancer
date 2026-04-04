# GitHub Enhancer

Microsoft Edge / Chrome 向けブラウザ拡張機能。GitHubの使い勝手を改善します。

## 機能

### 1. ブランチ選択プルダウンの幅を1.7倍に拡大
リポジトリ画面・GitHub Actions の「Run workflow」モーダルなど、GitHub全体のブランチ選択プルダウンの幅を自動的に1.7倍に拡大します。長いブランチ名でも全体が見やすくなります。

### 2. Actionsワークフロー履歴のブランチ名を全表示
GitHub Actions のワークフロー一覧で、ブランチ名が省略されて見えない問題を解消します。ブランチ名を全て表示します。

### 3. ブランチ名のコピーボタン
GitHub Actions のワークフロー履歴の各行に、ブランチ名をコピーするボタンを追加します。クリック1回でブランチ名をクリップボードにコピーできます。

### 4. ワークフロー完了通知
実行中のワークフロー履歴に「通知」ボタンを追加します。クリックすると、そのワークフローが完了した際にブラウザ通知でお知らせします。

## インストール方法

### 開発版として読み込む（Edge）

1. `edge://extensions/` を開く
2. **「開発者モード」** をオンにする
3. **「展開して読み込む」** をクリック
4. このリポジトリのフォルダを選択

### 開発版として読み込む（Chrome）

1. `chrome://extensions/` を開く
2. **「デベロッパーモード」** をオンにする
3. **「パッケージ化されていない拡張機能を読み込む」** をクリック
4. このリポジトリのフォルダを選択

## 通知機能のセットアップ

ワークフロー完了通知を使うには **GitHub Personal Access Token** が必要です。

1. 拡張機能アイコンをクリックしてポップアップを開く
2. [GitHub トークン発行ページ](https://github.com/settings/tokens/new?scopes=repo&description=GitHub+Enhancer) でトークンを作成（`repo` スコープが必要）
3. トークンをポップアップの入力欄に貼り付けて「保存」

## ファイル構成

```
github-enhancer/
├── manifest.json       # 拡張機能マニフェスト（Manifest V3）
├── content.js          # コンテンツスクリプト（全4機能）
├── background.js       # サービスワーカー（API ポーリング・通知）
├── popup.html          # 設定ポップアップ UI
├── popup.js            # 設定ポップアップ ロジック
├── styles.css          # CSS（プルダウン幅・ブランチ名表示）
├── generate-icons.js   # アイコン生成スクリプト（Node.js + canvas）
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 注意事項

- GitHub の UI は随時変更されるため、セレクタが一致しなくなる場合があります。その際は `content.js` のセレクタを調整してください。
- GitHub Personal Access Token はブラウザのローカルストレージに保存されます。共有PCでの使用には注意してください。
