# num-yomi

日本語の数値・漢数字・助数詞を、ひらがなの読みに変換する TypeScript ライブラリです。

例:

- `5000` -> `ごせん`
- `五千` -> `ごせん`
- `¥300` -> `さんびゃくえん`
- `$100` -> `ひゃくどる`
- `1本` -> `いっぽん`
- `1日` -> `いちにち`
- `1月1日` -> `いちがつついたち`

## 目的と特徴

- 数読みコアと助数詞処理を分離
- ルールを `rules/ja/*.json` で管理（データ駆動）
- 助数詞は `concat` / `exceptions_first` / `pattern` で合成
- 解析詳細を返す `readDetailed()` を提供

## 設計ドキュメント

- ルールファイル設計: `docs/rule_files_design.md`
- コントリビューションガイド: `CONTRIBUTING.md`
- 変更履歴: `CHANGELOG.md`

## 要件

- Node.js `>= 20`
- pnpm

## セットアップ

```bash
pnpm install
pnpm build
pnpm test
```

`pnpm build` の前に `scripts/generate_rules_artifacts.py` が走り、Node/Python向けの生成ルール（`src/generated/rules_bundle.ts`, `python_impl/generated_rules.py`）を更新します。

## CLI で使う

```bash
pnpm build
pnpm num-yomi "300円"
```

オプション:

- `--zero rei|zero`
- `--mode <counterId>=<modeId>`（複数指定可）
- `--strict`（失敗時に非0終了）
- `--replace`（文中の数値表現を自動置換）

例:

```bash
pnpm num-yomi "1日" --mode day=duration
pnpm num-yomi "0" --zero zero
pnpm num-yomi "$100"
pnpm num-yomi "今日は第3版を1.2本買った" --replace
```

変換箇所レポート付きのファイル変換:

```bash
pnpm replace-num-yomi ./input.txt --out ./output.txt
```

- 標準出力: 変換された部分だけ（位置 + `source -> reading`）
- `--out`: 変換後テキストを保存
- `--json`: 変換箇所を JSON で出力

## ライブラリ API

```ts
import yomiJa, { read, replaceInText, replaceInTextDetailed, createYomiJa } from "./dist/index.js";

const a = yomiJa.read("¥300");
// => さんびゃくえん

const a2 = read("300円");
// => さんびゃくえん

const b = yomiJa.read("1日", { mode: { day: "duration" } });
// => いちにち

const c = yomiJa.read("0", { variant: { zero: "zero" } });
// => ぜろ

const d = yomiJa.readDetailed("3匹");
// => { number, counterId, modeUsed, tokens, reading, ... }

const e = yomiJa.readNumber(5000n);
// => ごせん

const custom = createYomiJa("./rules/ja");
const f = custom.read("$100");
// => ひゃくどる

const g = replaceInText("今日は第3版を1.2本買った");
// => 今日はだいさんはんをいってんにほん買った

const h = replaceInTextDetailed("今日は第3版を1.2本買った");
// => {
//   input,
//   output,
//   replacements: [{ start, end, source, reading }, ...]
// }
```

### API 仕様

- `createYomiJa(ruleDir?)` -> `YomiJa`（ルールディレクトリを切替可能）
- `read(input, options?)` -> `string | null`
- `readDetailed(input, options?)` -> 詳細オブジェクト or `null`
- `readNumber(bigint, options?)` -> `string`
- `replaceInText(input, options?)` -> `string`
- `replaceInTextDetailed(input, options?)` -> `{ input, output, replacements[] }`

`options`:

- `variant.zero`: `"rei" | "zero"`
- `variant.four`: `"yon" | "shi"`
- `variant.seven`: `"nana" | "shichi"`
- `variant.nine`: `"kyu" | "ku"`
- `mode`: 助数詞ごとのモード指定（例: `{ day: "date" }`）
- `strict`: `true` のとき parse 失敗で throw

## 入力仕様（現状）

### 対応

- 算用数字: `5000`, `-12`, `5,000`
- 算用数字 + 大数単位: `5000億`, `5000億円`
- 小数（算用数字）: `3.14` -> `さんてんいちよん`
- 小数 + 助数詞: `1.2本` -> `いってんにほん`, `1.2回` -> `いってんにかい`
- 漢数字: `五千`, `三百`, `二〇二〇`
- 助数詞付き（prefix/suffix 1個）
  - prefix 例: `¥300`, `$100`
  - suffix 例: `300円`, `1本`, `1日`
- 月日連結（`月` + `日`）
  - 例: `1月1日` -> `いちがつついたち`（`day` 未指定時）
- 接頭助数詞接頭（汎用）
  - `第` を前置可能（例: `第3版`, `第1回`, `第1戦目`）
- 接尾助数詞接尾（汎用）
  - `目` / `め` を後置可能（例: `1回目`, `1週目`, `一戦目`）
- 文中自動置換（`replaceInText` / `--replace`）
  - 例: `今日は第3版を1.2本買った` -> `今日はだいさんはんをいってんにほん買った`
- 数字対数字の形式（助数詞としての `対` ではなく専用パターン）
  - 例: `1対1` -> `いったいいち`

### 非対応（現状）

- 指数表記（`1e9`）
- 1入力内の複数助数詞（`1月1日` の月日連結を除く。例: `¥300円`）

## 対応助数詞

`rules/ja/counters.json` に定義。

グルーピング基準:

- 発音ルール（`compose` の種類）
- 表面形が接頭辞か接尾辞か（`surface.prefix` / `surface.suffix`）

### `concat`（固定の読みを連結）

| counterId | 接頭辞/接尾辞 | 表記 | 発音ルール |
|---|---|---|---|
| `yen` | prefix + suffix | `¥`, `￥`, `円` | 数読み + `えん` |
| `dollar` | prefix | `$` | 数読み + `どる` |
| `celsius` | suffix | `℃`, `°C` | 数読み + `ど` |
| `mei` | suffix | `名` | 数読み + `めい` |
| `ken_item` | suffix | `件` | 数読み + `けん` |
| `tsuu` | suffix | `通` | 数読み + `つう` |
| `byou` | suffix | `秒` | 数読み + `びょう` |
| `shuukan` | suffix | `週間` | 数読み + `しゅうかん` |
| `page` | suffix | `ページ`, `頁` | 数読み + `ぺーじ` |
| `kou_clause` | suffix | `項` | 数読み + `こう` |
| `kan_clause` | suffix | `款` | 数読み + `かん` |
| `han_edition` | suffix | `版` | 数読み + `はん` |
| `ki_base` | suffix | `基` | 数読み + `き` |
| `ki_period` | suffix | `期` | 数読み + `き` |
| `ben_service` | suffix | `便` | 数読み + `びん` |
| `ban_chi` | suffix | `番地` | 数読み + `ばんち` |
| `bu` | suffix | `部` | 数読み + `ぶ` |
| `kou_school` | suffix | `校` | 数読み + `こう` |
| `to_building` | suffix | `棟` | 数読み + `とう` |
| `tou_grade` | suffix | `等` | 数読み + `とう` |
| `ko_house` | suffix | `戸` | 数読み + `こ` |
| `setai` | suffix | `世帯` | 数読み + `せたい` |
| `gou` | suffix | `号` | 数読み + `ごう` |
| `sen_battle` | suffix | `戦` | 数読み + `せん` |
| `kyoku_music` | suffix | `曲` | 数読み + `きょく` |
| `dan` | suffix | `段` | 数読み + `だん` |
| `shou` | suffix | `章` | 数読み + `しょう` |
| `jou_article` | suffix | `条` | 数読み + `じょう` |
| `hen` | suffix | `編` | 数読み + `へん` |
| `setsu` | suffix | `節` | 数読み + `せつ` |
| `men_surface` | suffix | `面` | 数読み + `めん` |
| `ten_point` | suffix | `点` | 数読み + `てん` |
| `hyou_vote` | suffix | `票` | 数読み + `ひょう` |
| `ji_char` | suffix | `字` | 数読み + `じ` |
| `go_word` | suffix | `語` | 数読み + `ご` |
| `mon_question` | suffix | `問` | 数読み + `もん` |
| `gyou_line` | suffix | `行` | 数読み + `ぎょう` |
| `retsu_line` | suffix | `列` | 数読み + `れつ` |
| `rin_wheel` | suffix | `輪` | 数読み + `りん` |
| `kuchi` | suffix | `口` | 数読み + `くち` |
| `kire` | suffix | `切れ`, `切` | 数読み + `きれ` |
| `tama` | suffix | `玉` | 数読み + `たま` |
| `suji` | suffix | `筋` | 数読み + `すじ` |
| `ren` | suffix | `連` | 数読み + `れん` |
| `te_hand` | suffix | `手` | 数読み + `て` |
| `kon` | suffix | `梱` | 数読み + `こん` |
| `shitsu` | suffix | `室` | 数読み + `しつ` |
| `seki_seat` | suffix | `席` | 数読み + `せき` |
| `za` | suffix | `座` | 数読み + `ざ` |
| `ku_phrase` | suffix | `句` | 数読み + `く` |
| `dai_title` | suffix | `題` | 数読み + `だい` |
| `kyoku_board` | suffix | `局` | 数読み + `きょく` |
| `do_counter` | suffix | `度` | 数読み + `ど` |
| `hen_count` | suffix | `遍` | 数読み + `へん` |
| `ryou` | suffix | `両` | 数読み + `りょう` |
| `ki_aircraft` | suffix | `機` | 数読み + `き` |
| `seki_ship` | suffix | `隻` | 数読み + `せき` |
| `sou_ship` | suffix | `艘` | 数読み + `そう` |
| `fukuro` | suffix | `袋` | 数読み + `ふくろ` |
| `tsubu` | suffix | `粒`, `つぶ` | 数読み + `つぶ` |
| `teki_drop` | suffix | `滴` | 数読み + `てき` |
| `jou_tablet` | suffix | `錠` | 数読み + `じょう` |
| `man_unit` | suffix | `万` | 数読み + `まん` |
| `oku_unit` | suffix | `億` | 数読み + `おく` |
| `cho_unit` | suffix | `兆` | 数読み + `ちょう` |
| `kei_unit` | suffix | `京` | 数読み + `けい` |
| `mai` | suffix | `枚` | 数読み + `まい` |
| `dai` | suffix | `台` | 数読み + `だい` |
| `wa` | suffix | `羽` | 数読み + `わ` |
| `ban` | suffix | `番` | 数読み + `ばん` |
| `wa_story` | suffix | `話` | 数読み + `わ` |

### `pattern`（末尾音に応じて h/b/p を切替）

`patternId: h_row_3forms` と `fun_p_forms` を使用。末尾トークンで促音化・濁音化・半濁音化を切り替えます。

| counterId | 接頭辞/接尾辞 | 表記 | 発音ルール |
|---|---|---|---|
| `hon` | suffix | `本` | `ほん/ぼん/ぽん` |
| `hiki` | suffix | `匹` | `ひき/びき/ぴき` |
| `hai` | suffix | `杯` | `はい/ばい/ぱい` |
| `fun` | suffix | `分` | `ふん/ぷん` |
| `ho_step` | suffix | `歩` | `ほ/ぽ` |

### `exceptions_first`（例外を優先し、未定義は fallback）

| counterId | 接頭辞/接尾辞 | 表記 | 主な例外 |
|---|---|---|---|
| `sai` | suffix | `歳`, `才` | `1=いっさい`, `20=はたち` |
| `nin` | suffix | `人` | `1=ひとり`, `2=ふたり` |
| `ko` | suffix | `個` | `1/6/8/10` の促音 |
| `satsu` | suffix | `冊` | `1/8/10` の促音 |
| `kai` | suffix | `回` | `1/6/8/10` の促音 |
| `ken` | suffix | `軒` | `3=さんげん`, `1/6/8/10` の促音 |
| `tou` | suffix | `頭` | `1/8/10` の促音 |
| `tou_grade` | suffix | `等` | `1/8/10` の促音 |
| `gai` | suffix | `階` | `3=さんがい`, `1/6/8/10` の促音 |
| `soku` | suffix | `足` | `3=さんぞく`, `1/8/10` の促音 |
| `chaku` | suffix | `着` | `1/8/10` の促音 |
| `kumi` | suffix | `組`, `くみ` | `1=ひとくみ`, `2=ふたくみ` |
| `hako` | suffix | `箱` | `1=ひとはこ`, `3=さんばこ` など |
| `kan` | suffix | `巻` | `1/6/8/10` の促音 |
| `sha` | suffix | `社` | `1/8/10` の促音 |
| `chou_me` | suffix | `丁目` | `1/8/10` の促音 |
| `ka_getsu` | suffix | `ヶ月`, `か月`, `カ月` ほか | `1/6/8/10` の促音 |
| `ka_sho` | suffix | `箇所`, `か所`, `カ所` ほか | `1/6/8/10` の促音 |
| `kai_me` | suffix | `回目` | `1/6/8/10` の促音 |
| `ka_koku` | suffix | `ヶ国`, `か国`, `箇国` ほか | `1/6/8/10` の促音 |
| `paku` | suffix | `泊` | `1/3/6/8/10` の半濁音化 |
| `hatsu_shot` | suffix | `発` | `1/3/6/8/10` の半濁音化 |
| `kan_tube` | suffix | `管` | `1/6/8/10` の促音 |
| `shiki_set` | suffix | `式` | `1/8/10` の促音 |
| `tsu` | suffix | `つ` | `1..10` が和語（`ひとつ` など） |
| `nen` | suffix | `年` | `4=よねん`, `7=しちねん` |
| `jikan` | suffix | `時間` | `4=よじかん`, `7=しちじかん` |
| `shuu` | suffix | `週` | `1/8/10` の促音 |
| `shuu_cycle` | suffix | `周` | `1/8/10` の促音 |
| `nin` | suffix | `人` | `1=ひとり`, `2=ふたり`, `4=よにん`, `7=しちにん` |
| `month` | suffix | `月` | `4=しがつ`, `7=しちがつ`, `9=くがつ` |
| `ji` | suffix | `時` | `4=よじ`, `7=しちじ`, `9=くじ` |
| `sen_battle` | suffix | `戦` | `1/8/10` の促音 |

### `mode`（意味モードで読み分け）

| counterId | 接頭辞/接尾辞 | 表記 | 発音ルール |
|---|---|---|---|
| `day` | suffix | `日` | `date` / `duration` で分岐 |
| `hari` | suffix | `張` | `hari` / `cho` で分岐 |

### 接尾助数詞接尾（後置）

- `目` / `め` は汎用後置として扱います。
- 助数詞読みの後ろに自動で `め` を付与します。
  - 例: `1回目` -> `いっかいめ`, `1週目` -> `いっしゅうめ`, `一戦目` -> `いっせんめ`

### 接頭助数詞接頭（前置）

- `第` は汎用前置として扱います。
- 数読み（＋助数詞読み）の前に自動で `だい` を付与します。
  - 例: `第3版` -> `だいさんはん`, `第1回` -> `だいいっかい`, `第1戦目` -> `だいいっせんめ`

## モード対応

- `day=duration`（デフォルト）
  - `1日` -> `いちにち`
- `day=date`
  - `1日` -> `ついたち`
- `hari=hari`（デフォルト）
  - `2張` -> `にはり`
- `hari=cho`
  - `2張` -> `にちょう`

## ルールファイル

- `rules/ja/core.json`
  - 数読みコア（0, 小単位, 大単位, 異読バリアント）
- `rules/ja/patterns.json`
  - 共有パターン（`h_row_3forms`, `fun_p_forms`）
- `rules/ja/counters.json`
  - 助数詞定義（surface / compose / exceptions / mode）

## テスト

ゴールデンケースは `test/cases.json`（単独読み）と `test/replace_cases.json`（文中置換）にあります。

```bash
pnpm test
```

## Python / Rust 実装

同じルールファイル（`rules/ja/*.json`）を読む実装を用意しています。

- Python: `python_impl/num_yomi.py`
- Rust: `rust_impl/src/lib.rs`（ライブラリ）, `rust_impl/src/main.rs`（CLI）

Rust 実装は `build.rs` で `rules/ja/*.json` をビルド時に構造体定数へ変換します。
実行時に JSON をパースせず、生成済みルールを直接参照します。

Python から呼ぶ例:

```python
from python_impl import read, YomiJaPy

print(read("300円"))
# さんびゃくえん

yomi = YomiJaPy()
print(yomi.read("1日", {"mode": {"day": "duration"}}))
# いちにち

print(yomi.replace_in_text("今日は第3版を1.2本買った"))
# 今日はだいさんはんをいってんにほん買った
```

Rust から呼ぶ例:

```toml
# Cargo.toml（path は配置に合わせて調整）
[dependencies]
num-yomi-rust = { path = "../<project-root>/rust_impl" }
```

```rust
use num_yomi_rust::{read, read_number_i64, replace_in_text, ReadConfig};

fn main() {
    let out = read("300円", None).unwrap().unwrap();
    println!("{out}");

    let cfg = ReadConfig::default().with_mode("day", "duration");
    let out2 = read("1日", Some(&cfg)).unwrap().unwrap();
    println!("{out2}");

    let n = read_number_i64(5000, None).unwrap();
    println!("{n}");

    let replaced = replace_in_text("今日は第3版を1.2本買った", None).unwrap();
    println!("{replaced}");
}
```

単発実行例:

```bash
python3 python_impl/num_yomi.py read \"300円\"
cargo run --manifest-path rust_impl/Cargo.toml -- replace \"今日は第3版を1.2本買った\"
cargo run --manifest-path rust_impl/Cargo.toml -- read \"300円\"
```

## 処理時間比較（Node / Python / Rust）

同一の `test/cases.json` を使い、各テストケースごとに平均処理時間（ns）を比較できます。

```bash
# TypeScript 実装を最新化
pnpm build

# 比較実行（ケースごとの表を出力）
pnpm bench:compare

# 文中置換の呼び出し形式API（ライブラリ関数直呼び）で比較
pnpm bench:compare:replace
```

反復回数を変更する例:

```bash
python3 scripts/compare_benchmarks.py --cases test/cases.json --iterations 5000
```

個別ベンチ:

```bash
pnpm bench:node
pnpm bench:python
pnpm bench:rust
```

README の計測結果を自動更新:

```bash
pnpm bench:update-readme
```

計測環境（2026-02-21 時点）:

- Node.js: `v25.6.1`
- Python: `3.11.9`
- Rust: `rustc 1.92.0`, `cargo 1.92.0`
- OS: `Darwin 25.3.0 (arm64, Apple Silicon)`

直近計測結果（2026-02-21, `--iterations 20000`, 5回計測レンジ）:

- `pnpm bench:compare`（call-style）
  - Node: `41.232 - 50.154 ms`（平均 `45.585 ms`）
  - Python: `392.065 - 402.108 ms`（平均 `396.849 ms`）
  - Rust: `20.461 - 27.915 ms`（平均 `24.616 ms`）
- `pnpm bench:compare:replace`
  - Node: `15.494 - 16.390 ms`（平均 `15.925 ms`）
  - Python: `90.545 - 94.329 ms`（平均 `92.565 ms`）
  - Rust: `3.775 - 5.705 ms`（平均 `4.518 ms`）

注: ベンチ結果はマシン負荷や実行タイミングで多少ぶれます。

## 公開方針メモ

- GitHub 公開はそのまま可能です。
- `package.json` の `private: true` は npm への誤公開防止設定です。
  npm 公開する場合のみ `private: false` に変更して、`name`/`version`/`files` などを最終確認してください。

## ライセンス

MIT
