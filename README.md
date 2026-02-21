# japanese-number-reading

日本語の数値・漢数字・助数詞を、ひらがなの読みに変換する TypeScript ライブラリです。

例:

- `5000` -> `ごせん`
- `五千` -> `ごせん`
- `¥300` -> `さんびゃくえん`
- `$100` -> `ひゃくどる`
- `1本` -> `いっぽん`
- `1日` (`day=date`) -> `ついたち`

## 目的と特徴

- 数読みコアと助数詞処理を分離
- ルールを `rules/ja/*.json` で管理（データ駆動）
- 助数詞は `concat` / `exceptions_first` / `pattern` で合成
- 解析詳細を返す `readDetailed()` を提供

## 要件

- Node.js `>= 20`
- pnpm

## セットアップ

```bash
cd ./japanese_number_reading
pnpm install
pnpm build
pnpm test
```

## CLI で使う

```bash
cd ./japanese_number_reading
node dist/cli/yomi.js "300円"
```

オプション:

- `--zero rei|zero`
- `--mode <counterId>=<modeId>`（複数指定可）
- `--strict`（失敗時に非0終了）

例:

```bash
node dist/cli/yomi.js "1日" --mode day=duration
node dist/cli/yomi.js "0" --zero zero
node dist/cli/yomi.js "$100"
```

## ライブラリ API

```ts
import yomiJa from "./dist/index.js";

const a = yomiJa.read("¥300");
// => さんびゃくえん

const b = yomiJa.read("1日", { mode: { day: "duration" } });
// => いちにち

const c = yomiJa.read("0", { variant: { zero: "zero" } });
// => ぜろ

const d = yomiJa.readDetailed("3匹");
// => { number, counterId, modeUsed, tokens, reading, ... }

const e = yomiJa.readNumber(5000n);
// => ごせん
```

### API 仕様

- `read(input, options?)` -> `string | null`
- `readDetailed(input, options?)` -> 詳細オブジェクト or `null`
- `readNumber(bigint, options?)` -> `string`

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
- 漢数字: `五千`, `三百`, `二〇二〇`
- 助数詞付き（prefix/suffix 1個）
  - prefix 例: `¥300`, `$100`
  - suffix 例: `300円`, `1本`, `1日`

### 非対応（現状）

- 文章全体の自動置換（単独入力のみ対象）
- 小数・指数表記（`3.14`, `1e9`）
- 1入力内の複数助数詞（`¥300円` など）

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

### `exceptions_first`（例外を優先し、未定義は fallback）

| counterId | 接頭辞/接尾辞 | 表記 | 主な例外 |
|---|---|---|---|
| `sai` | suffix | `歳` | `1=いっさい`, `20=はたち` |
| `nin` | suffix | `人` | `1=ひとり`, `2=ふたり` |
| `ko` | suffix | `個` | `1/6/8/10` の促音 |
| `satsu` | suffix | `冊` | `1/8/10` の促音 |
| `kai` | suffix | `回` | `1/6/8/10` の促音 |
| `ken` | suffix | `軒` | `3=さんげん`, `1/6/8/10` の促音 |
| `tou` | suffix | `頭` | `1/8/10` の促音 |
| `gai` | suffix | `階` | `3=さんがい`, `1/6/8/10` の促音 |
| `soku` | suffix | `足` | `3=さんぞく`, `1/8/10` の促音 |
| `chaku` | suffix | `着` | `1/8/10` の促音 |
| `kumi` | suffix | `組` | `1=ひとくみ`, `2=ふたくみ` |
| `hako` | suffix | `箱` | `1=ひとはこ`, `3=さんぱこ` など |
| `kan` | suffix | `巻` | `1/6/8/10` の促音 |
| `tsu` | suffix | `つ` | `1..10` が和語（`ひとつ` など） |
| `month` | suffix | `月` | `4=しがつ`, `7=しちがつ`, `9=くがつ` |
| `ji` | suffix | `時` | `4=よじ`, `7=しちじ`, `9=くじ` |

### `mode`（意味モードで読み分け）

| counterId | 接頭辞/接尾辞 | 表記 | 発音ルール |
|---|---|---|---|
| `day` | suffix | `日` | `date` / `duration` で分岐 |

## モード対応

- `day=date`（デフォルト）
  - `1日` -> `ついたち`
- `day=duration`
  - `1日` -> `いちにち`

## ルールファイル

- `rules/ja/core.json`
  - 数読みコア（0, 小単位, 大単位, 異読バリアント）
- `rules/ja/patterns.json`
  - 共有パターン（`h_row_3forms`, `fun_p_forms`）
- `rules/ja/counters.json`
  - 助数詞定義（surface / compose / exceptions / mode）

## テスト

ゴールデンケースは `test/cases.json` にあります。

```bash
pnpm test
```

## ライセンス

MIT
