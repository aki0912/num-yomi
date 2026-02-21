# 日本語数値・漢数字・助数詞読みライブラリ 設計書（v0.1）

- 作成日: 2026-02-21  
- 対象言語: TypeScript（Node.js）  
- 目的: `5000 / 5,000 / 五千 / ¥300 / 1本 / 1匹 / 1つ / 1日` などを **ひらがなの読み**に変換する  
- 方針:  
  - **数読みコア**（数値→読み）と **助数詞**（数読み→助数詞付き読み）を分離  
  - 助数詞は **共有パターン（クラス） + 例外表 + モード** を **テキストデータ（JSON）**で定義  
  - 実装は **トークン列**（語のパーツ列）で処理し、最後に連結して出力（正規表現の全面依存を避ける）

---

## 1. スコープ

### 1.1 MVPで対応する入力

- 裸の数
  - 算用数字: `5000`, `-12`
  - 桁区切り: `5,000`
  - 漢数字: `五千`, `三百`, `二〇二〇`（単位なし連結）
- 助数詞付き（単独入力として）
  - prefix: `¥300`, `￥300`
  - suffix: `300円`, `1本`, `1匹`, `1つ`, `1日`
- 出力: **ひらがな**（デフォルト）

### 1.2 MVPでの非対応（ただし拡張余地は残す）

- 文章中の数値抽出（`今日は¥300使った` を置換など）→ v0.2以降
- 小数・指数表記（`3.14`, `1e9`）→ v0.2以降
- 複数助数詞や複合（`¥300円` など）→ “最長一致 + 1個のみ”でまず固定
- 「月」「時」などの広範囲カバレッジ → ルール追加で対応（エンジン側は拡張可能）

---

## 2. 要件

### 2.1 必須要件

1. `5000`, `5,000`, `五千` → `ごせん`
2. `¥300` / `300円` → `さんびゃくえん`
3. 「ゼロ」を `れい` / `ぜろ` から選択可能
4. 本・匹のような同型助数詞の変化を、助数詞ごとに大量の例外を書かずに定義可能
5. `1つ` のような **完全に語彙が変わる**ケースを例外で定義可能
6. `1日` のように **文脈（意味）で読みが変わる**ケースを **mode（モード）**で定義可能  
   - 例: `day.date` → `ついたち`  
   - 例: `day.duration` → `いちにち`

### 2.2 望ましい要件

- 解析結果（数値BigInt、検出した助数詞、適用したモード、トークン列）を返せるデバッグAPI
- ルールファイルのスキーマ検証（起動時に弾く）

---

## 3. 全体アーキテクチャ

### 3.1 処理パイプライン

1. **Normalize**
   - Unicode NFKC
   - `,` 除去（数値の桁区切り）
   - `￥` を `¥` に寄せる（またはルールに両方書く）
   - 漢数字の異体（`零/〇`、大字など）は v0.1では最小限（必要分のみ）
2. **Detect Counter（prefix/suffix）**
   - ルール（JSON）にある `surface.prefix/surface.suffix` で最長一致
   - 一致したら `(counterId, numberPart)` に分解
3. **Parse number → BigInt**
   - 算用数字（符号対応）
   - 漢数字（万進、単位なし連結 `二〇二〇`）
4. **Read number → tokens**
   - BigInt → 読みトークン列（例: `300n` → `["さん","びゃく"]`）
   - `zero` の選択をここで確定（0なら `["れい"]` or `["ぜろ"]`）
5. **Apply counter compose**
   - counter に `modes` があれば、指定モード（または `defaultMode`）で処理
   - まず **exceptions**（全文読み）でヒットすればそれを返す
   - 次に **pattern**（共有クラス）適用：末尾トークンで form選択＆末尾書き換え
   - 最後に concat して出力
6. **Join tokens**
   - トークン列をそのまま連結して最終出力（ひらがな）

---

## 4. データ駆動ルール仕様

### 4.1 ルールセットのファイル構成（推奨）

- `rules/ja/core.json` … 数読みコア
- `rules/ja/patterns.json` … 共有パターン定義
- `rules/ja/counters.json` … 助数詞定義（表記・例外・モード・pattern参照）
- 将来: `rules/ja/overrides/*.json`（プロジェクトごとの差分）

---

### 4.2 core.json（数読みコア）仕様（案）

> **重要**: 数読みは「文字列」ではなく **トークン配列**を中心に設計する。  
> 例: `300` の読みは `["さん","びゃく"]` のように表す。

```json
{
  "variants": {
    "zero": { "rei": "れい", "zero": "ぜろ" },
    "four": { "yon": "よん", "shi": "し" },
    "seven": { "nana": "なな", "shichi": "しち" },
    "nine": { "kyu": "きゅう", "ku": "く" }
  },
  "defaultVariant": { "zero": "rei", "four": "yon", "seven": "nana", "nine": "kyu" },

  "digits": {
    "1": ["いち"], "2": ["に"], "3": ["さん"], "4": ["よん"], "5": ["ご"],
    "6": ["ろく"], "7": ["なな"], "8": ["はち"], "9": ["きゅう"]
  },

  "specialHundreds": {
    "3": ["さん","びゃく"],
    "6": ["ろっ","ぴゃく"],
    "8": ["はっ","ぴゃく"]
  },
  "specialThousands": {
    "3": ["さん","ぜん"],
    "8": ["はっ","せん"]
  },

  "smallUnits": {
    "10": ["じゅう"],
    "100": ["ひゃく"],
    "1000": ["せん"]
  },

  "bigUnits": [
    { "pow10": 0, "reading": [] },
    { "pow10": 4, "reading": ["まん"] },
    { "pow10": 8, "reading": ["おく"] },
    { "pow10": 12, "reading": ["ちょう"] },
    { "pow10": 16, "reading": ["けい"] }
  ],

  "minus": ["まいなす"]
}
```

---

### 4.3 patterns.json（共有パターン）

本・匹・杯など「ハ行3形（h/b/p）」を同じパターンで扱う。

```json
{
  "patterns": {
    "h_row_3forms": {
      "type": "tail_form_selector",
      "rules": [
        {
          "whenTailIn": ["いち", "ろく", "はち", "じゅう", "ひゃく", "びゃく", "ぴゃく"],
          "rewriteTail": {
            "いち": "いっ",
            "ろく": "ろっ",
            "はち": "はっ",
            "じゅう": "じゅっ",
            "ひゃく": "ひゃっ",
            "びゃく": "びゃっ",
            "ぴゃく": "ぴゃっ"
          },
          "useForm": "p"
        },
        {
          "whenTailIn": ["さん", "せん", "ぜん", "まん"],
          "useForm": "b"
        }
      ],
      "defaultForm": "h"
    }
  }
}
```

#### ルール適用仕様

- 末尾トークン（最後の1個）を見て、上から順にマッチ判定
- マッチしたら
  - `rewriteTail` があれば末尾を置換
  - `useForm` の形（h/b/p）を選択
  - **1回だけ適用して終了**（複数適用はしない）

---

### 4.4 counters.json（助数詞定義 + 例外 + モード）

#### 4.4.1 円（¥/円）

```json
{
  "counters": {
    "yen": {
      "surface": { "prefix": ["¥", "￥"], "suffix": ["円"] },
      "compose": { "type": "concat", "suffixReading": ["えん"] }
    }
  }
}
```

#### 4.4.2 本・匹（同パターン参照）

```json
{
  "counters": {
    "hon": {
      "surface": { "suffix": ["本"] },
      "compose": {
        "type": "pattern",
        "patternId": "h_row_3forms",
        "forms": { "h": ["ほん"], "b": ["ぼん"], "p": ["ぽん"] }
      }
    },
    "hiki": {
      "surface": { "suffix": ["匹"] },
      "compose": {
        "type": "pattern",
        "patternId": "h_row_3forms",
        "forms": { "h": ["ひき"], "b": ["びき"], "p": ["ぴき"] }
      }
    }
  }
}
```

#### 4.4.3 つ（語彙置換）

```json
{
  "counters": {
    "tsu": {
      "surface": { "suffix": ["つ"] },
      "compose": {
        "type": "exceptions_first",
        "exceptions": {
          "1": ["ひとつ"],
          "2": ["ふたつ"],
          "3": ["みっつ"],
          "4": ["よっつ"],
          "5": ["いつつ"],
          "6": ["むっつ"],
          "7": ["ななつ"],
          "8": ["やっつ"],
          "9": ["ここのつ"],
          "10": ["とお"]
        },
        "fallback": { "type": "concat", "suffixReading": ["つ"] }
      }
    }
  }
}
```

#### 4.4.4 日（モードで意味分岐）

```json
{
  "counters": {
    "day": {
      "surface": { "suffix": ["日"] },
      "defaultMode": "date",
      "modes": {
        "date": {
          "compose": {
            "type": "exceptions_first",
            "exceptions": {
              "1": ["ついたち"],
              "2": ["ふつか"],
              "3": ["みっか"],
              "4": ["よっか"],
              "5": ["いつか"],
              "6": ["むいか"],
              "7": ["なのか"],
              "8": ["ようか"],
              "9": ["ここのか"],
              "10": ["とおか"],
              "14": ["じゅう","よっ","か"],
              "20": ["はつか"],
              "24": ["に","じゅう","よっ","か"]
            },
            "fallback": { "type": "concat", "suffixReading": ["にち"] }
          }
        },
        "duration": {
          "compose": {
            "type": "exceptions_first",
            "exceptions": {
              "1": ["いち","にち"],
              "2": ["ふつか"],
              "3": ["みっか"],
              "4": ["よっか"],
              "5": ["いつか"],
              "6": ["むいか"],
              "7": ["なのか"],
              "8": ["ようか"],
              "9": ["ここのか"],
              "10": ["とおか"],
              "14": ["じゅう","よっ","か"],
              "20": ["はつか"],
              "24": ["に","じゅう","よっ","か"]
            },
            "fallback": { "type": "concat", "suffixReading": ["にち"] }
          }
        }
      }
    }
  }
}
```

---

## 5. API設計（TypeScript）

### 5.1 公開API（案）

```ts
export type Variant = Partial<{
  zero: "rei" | "zero";
  four: "yon" | "shi";
  seven: "nana" | "shichi";
  nine: "kyu" | "ku";
}>;

export type ModeOverrides = Record<string /*counterId*/, string /*modeId*/>;

export type ReadOptions = {
  variant?: Variant;
  mode?: ModeOverrides;
  strict?: boolean; // true: parse不能時throw / false: null返却
};

export type ReadResult = {
  input: string;
  normalized: string;
  number: bigint;
  counterId?: string;
  modeUsed?: string;
  tokens: string[];
  reading: string; // tokens.join("")
};

export interface YomiJa {
  read(input: string, options?: ReadOptions): string | null;
  readDetailed(input: string, options?: ReadOptions): ReadResult | null;
  readNumber(n: bigint, options?: ReadOptions): string;
}
```

### 5.2 仕様上の重要ルール

- `read()` は「単独入力（数 or 数+助数詞1個）」を対象（MVP）
- `readDetailed()` はデバッグ用途（テスト・トラブルシュート向け）
- `strict=false` の場合は **null** を返す（例：`abc`）

---

## 6. 実装設計（内部モジュール）

### 6.1 推奨ディレクトリ

```
/src
  /core
    normalize.ts
    parseNumber.ts
    readNumberTokens.ts
    join.ts
  /rules
    types.ts
    load.ts
    validate.ts
  /counters
    detect.ts
    apply.ts
    patterns.ts
  index.ts
/cli
  yomi.ts
/rules/ja
  core.json
  patterns.json
  counters.json
/test
  cases.json
  core.test.ts
  counters.test.ts
  e2e.test.ts
```

### 6.2 数読み：BigInt → tokens（要点）

- 4桁（0〜9999）読みを `read0To9999Tokens(n)` として実装
- `BigInt` を `10^4` ごとに分割（万進）
- 各チャンク（0〜9999）を tokens にして、後ろに bigUnit tokens を追加
- 0 の扱いは `variant.zero` を参照し、`0` のときだけ `["れい"]` or `["ぜろ"]`

### 6.3 助数詞検出（prefix/suffix）

- `surface.prefix/suffix` を全counterから集めて **最長一致**
- prefix優先・suffix優先の仕様を固定（MVPは「prefixを先に判定」推奨）
- 検出できたら `numberPart` を切り出す

### 6.4 助数詞適用（compose）

`compose.type` ごとに分岐:

- `concat`: `numberTokens + suffixReading`
- `exceptions_first`:
  1) `exceptions[number]` があればそれを返す  
  2) なければ `fallback` を実行
- `pattern`:
  1) pattern を適用して `(rewrittenNumberTokens, formKey)` を得る  
  2) `forms[formKey]` を末尾に付ける

---

## 7. テスト仕様（受け入れ条件）

### 7.1 ゴールデンテスト（MVP必須）

`test/cases.json`（例）

```json
[
  { "in": "5000", "out": "ごせん" },
  { "in": "5,000", "out": "ごせん" },
  { "in": "五千", "out": "ごせん" },

  { "in": "¥300", "out": "さんびゃくえん" },
  { "in": "300円", "out": "さんびゃくえん" },

  { "in": "1本", "out": "いっぽん" },
  { "in": "3本", "out": "さんぼん" },
  { "in": "2本", "out": "にほん" },

  { "in": "1匹", "out": "いっぴき" },
  { "in": "3匹", "out": "さんびき" },

  { "in": "1つ", "out": "ひとつ" },
  { "in": "10つ", "out": "とお" },

  { "in": "1日", "opts": { "mode": { "day": "date" } }, "out": "ついたち" },
  { "in": "1日", "opts": { "mode": { "day": "duration" } }, "out": "いちにち" },

  { "in": "0", "out": "れい" },
  { "in": "0", "opts": { "variant": { "zero": "zero" } }, "out": "ぜろ" }
]
```

---

## 8. CLI仕様（MVP）

### 8.1 コマンド例

- `yomi "¥300"` → `さんびゃくえん`
- `yomi "1日" --mode day=duration` → `いちにち`
- `yomi "0" --zero zero` → `ぜろ`

### 8.2 オプション

- `--zero rei|zero`
- `--mode <counterId>=<modeId>`（複数可）
- `--strict`（失敗時に非0終了）

---

## 9. Codexで実装を回すためのリポジトリ運用（推奨）

### 9.1 AGENTS.md（リポジトリに置く指示）

```md
# Project: yomi-ja

## Goal
Implement a Japanese number reading library:
- Parse: Arabic numbers (with commas), Kansuji, and counter forms (prefix/suffix).
- Read: return hiragana readings.
- Data-driven: rules live in /rules/ja/*.json.
- Support: zero variant (rei/zero), counters (yen/hon/hiki/tsu/day), and day modes.

## Constraints
- TypeScript, Node.js >= 20, ESM.
- Use BigInt for integers.
- No external network calls.
- Keep parsing, core reading, and counters separated by modules.
- Add tests using test/cases.json as golden tests.

## Acceptance
- `pnpm test` passes.
- All cases in test/cases.json pass.
```

### 9.2 PLANS.md（Codexに渡す作業計画テンプレ）

```md
# Plan

1) Scaffold project
- pnpm init, tsconfig, vitest, ESM setup
- directory structure

2) Implement rules loader + validator
- load core/patterns/counters JSON
- validate with zod

3) Implement normalize + counter detection
- NFKC + comma removal
- prefix then suffix, longest match

4) Implement number parser
- arabic -> BigInt
- kansuji -> BigInt (large units man/oku/chou)
- digit-sequence kansuji (e.g. 二〇二〇)

5) Implement number reading tokens
- 0..9999 reader
- 10^4 grouping, big units

6) Implement counter compose engine
- concat
- exceptions_first
- pattern tail_form_selector

7) Implement CLI
- parse args: --zero, --mode, --strict

8) Tests
- golden tests from test/cases.json
```

---

## 10. 完了定義（Definition of Done）

- `rules/ja/core.json`, `rules/ja/patterns.json`, `rules/ja/counters.json` が存在し、スキーマ検証が通る
- `read()` が MVP 入力を満たす
- `test/cases.json` の全ケースがパス
- CLI が動く（少なくとも `yomi "¥300"` が成功）
