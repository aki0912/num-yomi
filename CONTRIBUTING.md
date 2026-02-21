# Contributing Guide

このプロジェクトへのコントリビュート手順です。

## 1. 前提

- Node.js `>= 20`
- `pnpm`
- Python 3
- Rust toolchain（Rust実装に触る場合）

## 2. セットアップ

```bash
pnpm install
pnpm build
pnpm test
```

## 3. 開発フロー

1. ブランチを作成する
2. 変更を加える
3. 必ず以下を実行する

```bash
pnpm build
pnpm test
pnpm bench:compare
pnpm bench:compare:replace
```

4. 変更内容とベンチ結果を PR に記載する

## 4. ルール変更時の注意

- 助数詞や読みルールの追加は `rules/ja/*.json` を修正する
- 生成物（`src/generated/rules_bundle.ts`, `python_impl/generated_rules.py`）が更新されることを確認する
- 仕様変更時は `README.md` と `docs/rule_files_design.md` も更新する

## 5. テスト方針

- 単独読み: `test/cases.json`
- 文中置換: `test/replace_cases.json`
- 新機能は最低1件以上の正常系ケースを追加する
- 既知の回帰は再発防止ケースを追加する

## 6. PRに含める情報

- 目的（何を改善したか）
- 変更ファイルの概要
- 互換性への影響（あれば）
- 実行した検証コマンドと結果（build/test/bench）
