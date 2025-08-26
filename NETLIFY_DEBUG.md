# Netlify Functions デバッグ手順

## 1. ダッシュボードでのログ確認

https://app.netlify.com/ で以下を確認してください：

1. **サイト一覧** → **eloquent-banoffee-689a2a** を選択
2. **Functions** タブをクリック
3. Functions が表示されているか確認
4. **Deploys** タブで最新のデプロイログを確認

## 2. 期待される Functions

以下の関数が認識されているはずです：

- `hello` - 基本テスト関数
- `stats` - データベース統計 (Node.js)
- `search` - 検索機能 (Node.js)
- `stats.py` - データベース統計 (Python)
- `search.py` - 検索機能 (Python)
- `script_detail.py` - スクリプト詳細 (Python)

## 3. テスト順序

1. **基本テスト**: https://eloquent-banoffee-689a2a.netlify.app/test.html
2. **Hello 関数**: /.netlify/functions/hello
3. **Stats 関数**: /.netlify/functions/stats

## 4. よくある問題

- Functions が認識されない → ビルドログでエラーがないか確認
- SQLite3 エラー → Node.js のパッケージインストールが失敗している可能性
- 404 エラー → Functions ディレクトリ構造の問題

## 5. 緊急回避策

Functions が動作しない場合、静的ファイル化に切り替え可能です。