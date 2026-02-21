# Changelog

このプロジェクトの主な変更履歴です。

## [Unreleased]

### Added

- `CONTRIBUTING.md` を追加
- ベンチ計測環境情報を `README.md` に追加
- 公開方針（`private: true` の意図）を `README.md` に追加

## [0.1.0] - 2026-02-21

### Added

- 日本語数値読みライブラリ（Node / Python / Rust）
- データ駆動ルール（`rules/ja/*.json`）
- 助数詞ルール（`concat` / `pattern` / `exceptions_first` / `mode`）
- CLI (`yomi`, `yomi-file`) と文中自動置換
- ルール生成（Node/Pythonは事前生成、Rustはbuild時生成）
- テストケースおよびベンチマーク比較スクリプト

