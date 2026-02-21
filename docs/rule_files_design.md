# ルールファイル設計ガイド

このドキュメントは、`rules/ja/*.json` の役割と実装側の適用フローをまとめたものです。  
目的は「助数詞や読みルールを追加するときに、どこをどう編集すればよいか」を迷わない状態にすることです。

## 1. 全体アーキテクチャ

ルールの主な編集対象は次の3ファイルです。

| ファイル | 役割 | 使われ方 |
|---|---|---|
| `rules/ja/core.json` | 数字そのものの読み | すべての入力の基礎読み |
| `rules/ja/patterns.json` | 語尾変化の共通パターン | 複数助数詞で再利用 |
| `rules/ja/counters.json` | 助数詞と合成規則 | 入力文字列から助数詞を解決 |

実装側は Node / Python / Rust の3系統ですが、ルールのソースは共通です。

- Node: ビルド前生成で `src/generated/rules_bundle.ts` を作成して利用（デフォルト時）
- Python: ビルド前生成で `python_impl/generated_rules.py` を作成して利用（デフォルト時）
- Rust: `rust_impl/build.rs` がビルド時に `generated_rules.rs` を生成して利用
- 共通: カスタム `ruleDir` を指定した場合は JSON を直接ロード

## 2. `core.json` の責務

`core.json` は「数字だけ」を読むルールです。助数詞の情報は持ちません。

主なキー:

- `variants`: `れい/ぜろ`, `よん/し` のような発音バリアント
- `defaultVariant`: バリアントのデフォルト
- `digits`: 0〜9
- `specialHundreds`, `specialThousands`: 三百, 八百, 三千, 八千など
- `smallUnits`: 十・百・千
- `bigUnits`: 万・億・兆・京（`pow10` 指定）
- `minus`: マイナス記号の読み

## 3. `patterns.json` の責務

`patterns.json` は、助数詞側から参照される「語尾変化テンプレート」です。

現在の中心は `tail_form_selector` です。  
これは「数読みトークン末尾」を見て次の2つを決めます。

- 語尾を書き換えるか（`rewriteTail`）
- どのフォームを使うか（`useForm`）

例:

- `h_row_3forms`: `ほん/ぼん/ぽん` 系
- `fun_p_forms`: `ふん/ぷん` 系

## 4. `counters.json` の責務

`counters.json` は助数詞定義の本体です。

各 `counterId` は最低限次を持ちます。

- `surface.prefix` / `surface.suffix`: どの表記で検出するか
- `compose` または `modes`: 数読みとどう結合するか

### 4.1 `compose` の型

| type | 使いどころ | 例 |
|---|---|---|
| `concat` | 単純連結 | `円`, `件`, `列` |
| `exceptions_first` | 例外優先 + 通常フォールバック | `人`, `歳`, `回` |
| `pattern` | `patterns.json` の変化規則を利用 | `本`, `匹`, `杯`, `分` |

### 4.2 `modes` / `defaultMode`

1つの表記でも読み分けが必要な助数詞は `modes` を使います。

例:

- `day`: `date` と `duration`
- `hari`: `hari` と `cho`

## 5. 実行時フロー（`read`）

概略は次の順です。

1. 入力正規化（NFKC, カンマ除去, `￥ -> ¥`）
2. 特殊式の先行処理（例: `1対1`）
3. 助数詞検出（prefix/suffix, 最長一致）
4. 数値パース（整数, 小数, 漢数字, `5000億` 形式）
5. 数読みトークン生成（`core.json`）
6. 助数詞合成（`counters.json` の `compose` / `modes`）
7. 追加接頭・接尾（`第`, `目` など実装側の汎用処理）

## 6. 実行時フロー（`replaceInText`）

文全体を走査し、候補区間に対して最長一致で読みを適用します。

要点:

- 数字/記号の開始候補だけを対象にする
- 助数詞マーカーがない裸数字も、条件を満たせば変換する
- 英数字隣接や漢字語中の単漢数字などは誤変換を抑制する
- 変換不能なら元の文字を維持する

## 7. ルール追加の実践手順

### 7.1 単純な助数詞（`concat`）

`counters.json` に以下を追加します。

```json
"retsu_line": {
  "surface": { "suffix": ["列"] },
  "compose": { "type": "concat", "suffixReading": ["れつ"] }
}
```

上の例は実際の助数詞 `列`（`3列 -> さんれつ`）です。

### 7.2 例外つき助数詞（`exceptions_first`）

```json
"tou_grade": {
  "surface": { "suffix": ["等"] },
  "compose": {
    "type": "exceptions_first",
    "exceptions": {
      "1": ["いっ", "とう"],
      "8": ["はっ", "とう"],
      "10": ["じゅっ", "とう"]
    },
    "fallback": { "type": "concat", "suffixReading": ["とう"] }
  }
}
```

上の例は実際の助数詞 `等`（`1等 -> いっとう`, `2等 -> にとう`）です。

### 7.3 パターン合成（`pattern`）

```json
"hon": {
  "surface": { "suffix": ["本"] },
  "compose": {
    "type": "pattern",
    "patternId": "h_row_3forms",
    "forms": {
      "h": ["ほん"],
      "b": ["ぼん"],
      "p": ["ぽん"]
    }
  }
}
```

上の例は実際の助数詞 `本`（`2本 -> にほん`, `3本 -> さんぼん`, `1本 -> いっぽん`）です。

## 8. テスト運用

共通ケースは次の2ファイルです。

- `test/cases.json`: 単体入力の読み
- `test/replace_cases.json`: 文中置換

推奨実行順:

1. `pnpm build`
2. `pnpm test`
3. `pnpm bench:compare`
4. `pnpm bench:compare:replace`

## 9. 設計上の注意点

- ルールバリデーションは現在最小限（`src/rules/validate.ts`）。
- 読みはトークン配列で管理し、最後に連結する設計。
- 小数 + 助数詞は `compose` が小数を解決できる場合のみ成立する。
- Node/Python/Rust すべて、デフォルト利用時は「生成物」を参照するため、ルール変更後はビルドが必要。
- カスタム `ruleDir` を明示した場合のみ、Node/Python は JSON 直接ロードで反映される。

## 10. 関連ファイル

- `rules/ja/core.json`
- `rules/ja/patterns.json`
- `rules/ja/counters.json`
- `src/index.ts`
- `src/rules/types.ts`
- `src/rules/validate.ts`
- `python_impl/num_yomi.py`
- `rust_impl/build.rs`
- `rust_impl/src/lib.rs`
