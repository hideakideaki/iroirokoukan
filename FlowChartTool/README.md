# FlowChartTool Lite

ブラウザで動作するフローチャート/ブロック線図エディタです。

## 1. 起動
1. `index.html` をブラウザで開く
2. ツールバーやShapesから図形を追加

## 2. 主な機能
- ノード作成/移動/複数選択
- ノード接続（矢印ON/OFF、線種切替）
- Mindmapモード（`Tab` / `Enter` で子ノード生成）
- JSON Export / Import
- PNG Export（透過、現在の表示範囲）
- Undo / Redo（`Ctrl+Z` / `Ctrl+Y`）

## 3. ショートカット
- `Ctrl/Command + C`: 選択ノードコピー
- `Ctrl/Command + V`: 貼り付け
- `Delete`: 選択ノード/選択線を削除
- `Shift` + クリック: 接続作成

## 4. Excel図形への変換（VBA）
このリポジトリには、JSONをExcel図形へ変換するVBAモジュールを同梱しています。

- モジュール: `excel/FlowChartJsonImporter.bas`

### 4.1 前提
- Excel（デスクトップ版）
- VBAでJSONを読むために **VBA-JSON** の `JsonConverter.bas` を導入
  - 参照: https://github.com/VBA-tools/VBA-JSON

### 4.2 手順
1. FlowChartToolで `JSON Export`
2. Excelを開き、`Alt + F11` でVBEを開く
3. `JsonConverter.bas` と `excel/FlowChartJsonImporter.bas` をインポート
4. `ImportFlowChartFromJson` を実行
5. JSONファイルを選択すると、アクティブシートに図形/接続線を作成

### 4.3 補足
- 既存図形を消すかどうかは実行時に確認
- 座標はピクセル→ポイント変換して配置
- 線種（curve/straight/orthogonal）、矢印有無、接続辺（fromSide/toSide）を反映
- Excel側の描画仕様差で見た目が完全一致しない場合があります

## 5. ファイル構成
- `index.html`: UI
- `style.css`: スタイル
- `app.js`: アプリロジック
- `excel/FlowChartJsonImporter.bas`: JSON -> Excel図形 変換VBA

