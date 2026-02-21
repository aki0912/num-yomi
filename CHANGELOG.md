# Changelog

このプロジェクトの主な変更履歴です。

## [Unreleased]

### Added

- `CONTRIBUTING.md` を追加
- ベンチ計測環境情報を `README.md` に追加
- 公開方針（`private: true` の意図）を `README.md` に追加

### Changed

- `day` 助数詞のデフォルトモードを `duration` に変更（`1日` -> `いちにち`）
- `read` / `replaceInText` / `replaceInTextDetailed` で、`1月1日` のような月日連結を日付読みとして扱うよう改善（例: `いちがつついたち`）

## [0.1.0] - 2026-02-21

### Added

- 日本語数値読みライブラリ（Node / Python / Rust）
- データ駆動ルール（`rules/ja/*.json`）
- 助数詞ルール（`concat` / `pattern` / `exceptions_first` / `mode`）
- CLI (`num-yomi`, `replace-num-yomi`) と文中自動置換
- ルール生成（Node/Pythonは事前生成、Rustはbuild時生成）
- テストケースおよびベンチマーク比較スクリプト
