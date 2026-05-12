# Chat History Summary

このファイルは、num-yomi プロジェクトに関するこれまでのチャット内容と作業履歴を要約したものです。

## 目的

日本語の数値・漢数字・助数詞をひらがなの読みに変換する `num-yomi` について、読み分け、性能改善、CI、ベンチマーク、Node/Python/Rust 実装の整備を進めた。

## 主な要望と対応

### 1. `1日` と日付読みの扱い

- `1日` のデフォルト読みを `いちにち` にしたい。
- `1月1日` のように月の後に続く場合は日付として `ついたち` にしたい。
- `4月1日` / `四月一日` のような月日表現も日付読みになるようにしたい。

対応:

- `1日` はデフォルトで `いちにち`。
- `mode.day=date` 指定時は `ついたち`。
- `1月1日` など月日連結では、日側に日付モードを補う処理を追加。
- `pnpm num-yomi "四月一日"` などの確認も実施。

### 2. パッケージ名の更新

- `package.json` の名前が古いままではないか確認。
- 新しい名前 `num-yomi` に変更した。

### 3. ベンチマーク整備

- Node / Python / Rust の比較ベンチを何度も測定。
- 5回平均を出すスクリプトの有無を確認し、なければ追加。
- `README.md` のベンチ結果を更新できるようにした。
- `test/sample.txt` を処理する全文置換ベンチを追加。
- `test/sample.expected.txt` を更新できる流れも整えた。

追加・整備した主なベンチ:

- `pnpm bench:compare`
- `pnpm bench:compare:replace`
- `pnpm bench:compare:sample:replace`
- `pnpm bench:update-readme`

README 更新用スクリプト:

- `scripts/update_readme_benchmarks.py`

### 4. CI の修正

GitHub Actions で以下のエラーが出た。

```text
Unable to locate executable file: pnpm.
```

原因:

- CI 上で `pnpm` がセットアップされていない状態で `pnpm` コマンドを実行していた。

対応:

- `.github/workflows/ci.yml` に `pnpm/action-setup` を追加。
- Node / Rust / Python の lint・test・parity check が通る構成にした。

### 5. Lint 導入

Node / Python / Rust それぞれに lint を導入した。

- Node: Biome
- Python: Ruff
- Rust: `cargo fmt --check` + `cargo clippy`

主な npm scripts:

- `pnpm lint`
- `pnpm lint:node`
- `pnpm lint:python`
- `pnpm lint:rust`

Warning が出た箇所を確認し、修正後にベンチも再測定した。

### 6. Node 実装のリファクタリング

Node 側で改善候補を洗い出し、すべて実施した。

主な対応:

- CLI 共通オプション処理を `src/cli/shared.ts` に分離。
- `num-yomi` と `replace-num-yomi` の unknown argument 処理を統一。
- cache 処理を `src/core/cache.ts` に分離。
- `src/index.ts` の cache 分岐重複を削減。
- `normalizeTaiLeftTokens` を既存の正規化処理へ統一。
- Node ベンチ処理を `bench/bench_node_common.mjs` に共通化。

検証:

- `pnpm lint`
- `pnpm test`
- `pnpm bench:compare`
- `pnpm bench:compare:replace`
- `pnpm bench:compare:sample:replace`

### 7. Rust 実装の改善

Rust 側の性能・リファクタリング余地を確認し、必要な改善を実施した。

主な流れ:

- Rust が遅くなっていないか確認。
- 最新ベンチ結果で README を更新。
- Rust コードのリファクタリング候補を確認。
- `cargo fmt` / `cargo clippy` を lint に組み込んだ。

### 8. Python 実装のリファクタリング

Python 側のリファクタリング候補を確認し、すべて実施した。

主な対応:

- cache 処理を `HotLruCache` に整理。
- `read` / `replace_in_text` の cache 分岐重複を削減。
- `normalize_tai_left_tokens` を廃止し、既存の整数末尾正規化関数に統一。
- `read_detailed` の責務を分割。
- CLI オプション構築を `build_cli_read_options` に共通化。
- Python ベンチを `bench/bench_python_common.py` に共通化。

検証:

- `pnpm lint`
- `pnpm test`
- `pnpm bench:compare`

### 9. Python パッケージ管理を uv へ移行

Python のパッケージ管理が十分か確認し、`uv` 管理へ変更した。

主な対応:

- `pyproject.toml` に `[project]`, `[dependency-groups]`, `[tool.uv]` を追加。
- `uv.lock` を生成。
- Python lint を `uv run --frozen --group dev ruff ...` に変更。
- Python 実行・ベンチ・README 更新系スクリプトを `uv run --frozen python ...` に統一。
- CI に `astral-sh/setup-uv` と `uv sync --frozen --group dev` を追加。
- `.venv/` を `.gitignore` に追加。
- README のセットアップ手順に `uv sync --frozen --group dev` を追加。

検証:

- `pnpm lint`
- `pnpm test`
- `pnpm bench:compare`

### 10. README のベンチ結果更新

複数回、最新のベンチ結果で `README.md` を更新した。

直近では `uv` 移行後に `pnpm bench:update-readme` を実行し、5回計測レンジと平均を反映した。

直近の反映値:

- `bench:compare`
  - Node: `48.633 - 56.537 ms`（平均 `53.326 ms`）
  - Python: `324.729 - 337.751 ms`（平均 `329.792 ms`）
  - Rust: `30.660 - 35.996 ms`（平均 `32.990 ms`）
- `bench:compare:replace`
  - Node: `19.255 - 22.970 ms`（平均 `21.414 ms`）
  - Python: `75.151 - 77.048 ms`（平均 `76.215 ms`）
  - Rust: `7.595 - 8.854 ms`（平均 `8.226 ms`）
- `bench:compare:sample:replace`
  - Node: `338.930 - 354.956 ms`（平均 `348.389 ms`）
  - Python: `1436.611 - 1459.381 ms`（平均 `1452.181 ms`）
  - Rust: `102.720 - 109.982 ms`（平均 `106.164 ms`）

## 現在の状態

- Node / Python / Rust の3実装がある。
- ルールは `rules/ja/*.json` を中心に管理している。
- Node と Python には生成済みルール成果物がある。
- Rust は `build.rs` でルールをビルド時に取り込む。
- CI は pnpm / uv / Rust toolchain をセットアップし、lint・test・parity check を行う。
- Python 依存は `uv.lock` で固定する方針になった。

## 今後の改善候補

- CI で `pnpm generate:rules` 後の `git diff --exit-code` を追加し、生成物更新漏れを検知する。
- ベンチ兼 parity check ではなく、専用の parity check スクリプトを用意する。
- `src/index.ts`, `python_impl/num_yomi.py`, `rust_impl/src/lib.rs` をさらに責務分割する。
- Rust / Python の純正テスト（`cargo test`, `pytest`）を増やす。
- ベンチ集計に median / p95 / warmup を追加する。
- npm 公開する場合は `files`, `publishConfig`, `private` の扱いを最終確認する。
