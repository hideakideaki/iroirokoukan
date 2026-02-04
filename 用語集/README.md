# 用語集アプリ

Excel で管理した用語集を `terms.json` に変換し、ブラウザで検索・閲覧できる静的アプリです。

## できること
- 用語の検索（/ キーでフォーカス）
- カテゴリ/タグ/ステータスで絞り込み
- 最近更新の表示
- お気に入り（ローカル保存）
- 用語詳細のコピーリンク

## 構成
- `index.html` アプリ本体
- `styles.css` スタイル
- `app.js` ロジック
- `terms.xlsx` 用語マスター（Excel）
- `data/terms.json` 生成される用語データ
- `excel_to_terms_json.py` 変換スクリプト

## 使い方
1. `terms.xlsx` を編集
2. 変換スクリプトを実行して `data/terms.json` を更新
3. ローカルホストで起動

### ローカルホストでの起動手順（外部非公開）
- ターミナルでこのフォルダに移動
- 次のコマンドを実行
```bash
python -m http.server 8000 --bind 127.0.0.1
```
- ブラウザで `http://127.0.0.1:8000/` を開く
- `--bind 127.0.0.1` なので外部からはアクセスできません

### 変換コマンド
```bash
python excel_to_terms_json.py --xlsx terms.xlsx --out data/terms.json
```

オプション:
- `--sheet` シート名（既定: `Terms`）
- `--stop-on-blank-id` 空の `id` 行で処理を終了
- `--report` 変換レポート出力先（既定: `data/convert_report.json`）

## Excel の列定義
必須:
- `id` 一意なID
- `term` 用語名

任意:
- `reading` 読み
- `en` 英語
- `category` 複数可（`|` 区切り）
- `tags` 複数可（`|` 区切り）
- `summary` 要約
- `body` 本文
- `related_ids` 関連ID（`|` 区切り）
- `source` 出典（`|` 区切り）
- `owner` 担当者
- `status` `draft` / `verified` / `deprecated`（その他は `draft` 扱い）
- `updated` 更新日（`YYYY-MM-DD`）
- `created` 作成日（`YYYY-MM-DD`）

## 注意点
- `id` が重複した行はスキップされます。
- `related_ids` に存在しないIDがある場合は警告になります。
- 日付は `YYYY-MM-DD` 形式以外だと警告になります。
