import type {
  CounterCompose,
  PatternCompose,
  ReadOptions,
  ReadResult,
  ReplaceResult,
  RuleBundle,
  YomiJa,
} from "./rules/types.js";
import { normalizeInput } from "./core/normalize.js";
import { parseArabicDecimal, parseNumber } from "./core/parseNumber.js";
import { readNumberTokens } from "./core/readNumberTokens.js";
import { joinTokens } from "./core/join.js";
import { HotLruCache } from "./core/cache.js";
import { detectCounter } from "./counters/detect.js";
import { applyCounter } from "./counters/apply.js";
import { loadRules } from "./rules/load.js";

const DECIMAL_POINT_TOKEN = "てん";
const COUNTER_PREFIXES = [
  { marker: "第", reading: ["だい"] },
] as const;
const COUNTER_POSTFIXES = [
  { marker: "目", reading: ["め"] },
  { marker: "め", reading: ["め"] },
] as const;
const KANJI_NUMERIC_CHARS = new Set(["零", "〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "百", "千", "万", "億", "兆", "京"]);
const CANDIDATE_EXTRA_START_CHARS = new Set(["+", "-", "＋", "－", "$", "¥", "￥", "第"]);
const REPLACE_EXTRA_FRAGMENT_CHARS = new Set(["+", "-", "＋", "－", "$", "¥", "￥", ".", "．", ",", "，", "対"]);
const MAX_REPLACE_SPAN = 64;
const SINGLE_KANJI_DIGIT_RE = /^[零〇一二三四五六七八九]$/u;
const HAN_CHAR_RE = /\p{Script=Han}/u;
const TRAILING_WHITESPACE_RE = /\s$/u;
const READ_CACHE_LIMIT = 8192;
const REPLACE_CACHE_LIMIT = 2048;
const REPLACE_DETAILED_CACHE_LIMIT = 1024;

interface CounterPrefixMatch {
  marker: string;
  reading: readonly string[];
}

interface CounterPostfixMatch {
  marker: string;
  reading: readonly string[];
}

interface ReplaceMarkerIndex {
  byFirstChar: Map<string, string[]>;
  charSet: Set<string>;
}

interface ParsedNumberTokens {
  normalized: string;
  tokens: string[];
}

interface TaiExpression {
  left: string;
  right: string;
}

function optionsCacheKey(options?: ReadOptions): string {
  if (!options) {
    return "";
  }
  const strictPart = options.strict ? "1" : "0";
  const variant = options.variant;
  const variantPart = [
    variant?.zero ?? "",
    variant?.four ?? "",
    variant?.seven ?? "",
    variant?.nine ?? "",
  ].join("|");

  const mode = options.mode;
  if (!mode || Object.keys(mode).length === 0) {
    return `${strictPart};${variantPart}`;
  }

  const modeEntries = Object.entries(mode);
  if (modeEntries.length > 1) {
    modeEntries.sort((a, b) => a[0].localeCompare(b[0]));
  }
  const modePart = modeEntries.map(([counterId, modeId]) => `${counterId}:${modeId}`).join(",");
  return `${strictPart};${variantPart};${modePart}`;
}

function valueCacheKey(input: string, options?: ReadOptions): string {
  if (!options) {
    return input;
  }
  return `${input}\u0001${optionsCacheKey(options)}`;
}

function getCachedOrCompute<T>(
  noOptionsCache: HotLruCache<T>,
  withOptionsCache: HotLruCache<T>,
  input: string,
  options: ReadOptions | undefined,
  compute: () => T
): T {
  const key = valueCacheKey(input, options);
  const cache = options ? withOptionsCache : noOptionsCache;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const value = compute();
  cache.set(key, value);
  return value;
}

function cloneReplaceResult(result: ReplaceResult): ReplaceResult {
  return {
    input: result.input,
    output: result.output,
    replacements: result.replacements.map((replacement) => ({ ...replacement })),
  };
}

function detectCounterPrefix(input: string): CounterPrefixMatch | undefined {
  let best: CounterPrefixMatch | undefined;
  for (const prefix of COUNTER_PREFIXES) {
    if (!input.startsWith(prefix.marker)) {
      continue;
    }
    if (!best || prefix.marker.length > best.marker.length) {
      best = prefix;
    }
  }
  return best;
}

function detectCounterPostfix(input: string): CounterPostfixMatch | undefined {
  let best: CounterPostfixMatch | undefined;
  for (const postfix of COUNTER_POSTFIXES) {
    if (!input.endsWith(postfix.marker)) {
      continue;
    }
    if (!best || postfix.marker.length > best.marker.length) {
      best = postfix;
    }
  }
  return best;
}

function prependCounterPrefix(tokens: string[], prefix: CounterPrefixMatch | undefined): string[] {
  if (!prefix) {
    return tokens;
  }
  return [...prefix.reading, ...tokens];
}

function appendCounterPostfix(tokens: string[], postfix: CounterPostfixMatch | undefined): string[] {
  if (!postfix) {
    return tokens;
  }
  return [...tokens, ...postfix.reading];
}

function hasParsableNumberText(value: string): boolean {
  return parseArabicDecimal(value) !== null || parseNumber(value) !== null;
}

function detectCounterWithParsableNumber(input: string, rules: RuleBundle) {
  const detected = detectCounter(input, rules.counters);
  if (!detected) {
    return null;
  }
  return hasParsableNumberText(detected.numberPart) ? detected : null;
}

function resolveDecimalPatternSuffix(compose: PatternCompose, rules: RuleBundle): string[] | undefined {
  const defaultForm = rules.patterns.patterns[compose.patternId]?.defaultForm;
  if (defaultForm && compose.forms[defaultForm]) {
    return compose.forms[defaultForm];
  }
  if (compose.forms.h) {
    return compose.forms.h;
  }
  for (const suffixReading of Object.values(compose.forms)) {
    return suffixReading;
  }
  return undefined;
}

function resolveDecimalComposeSuffix(compose: CounterCompose, rules: RuleBundle): string[] | undefined {
  if (compose.type === "concat") {
    return compose.suffixReading;
  }
  if (compose.type === "pattern") {
    return resolveDecimalPatternSuffix(compose, rules);
  }
  return resolveDecimalComposeSuffix(compose.fallback, rules);
}

function normalizeIntegerTokensForDecimalPoint(tokens: string[]): string[] {
  if (tokens.length === 0) {
    return tokens;
  }
  const last = tokens[tokens.length - 1];
  if (last !== "いち") {
    return tokens;
  }
  return [...tokens.slice(0, -1), "いっ"];
}

function collectReplaceMarkers(rules: RuleBundle): string[] {
  const markers = new Set<string>();
  for (const counter of Object.values(rules.counters.counters)) {
    for (const marker of counter.surface?.prefix ?? []) {
      markers.add(marker);
    }
    for (const marker of counter.surface?.suffix ?? []) {
      markers.add(marker);
    }
  }
  for (const prefix of COUNTER_PREFIXES) {
    markers.add(prefix.marker);
  }
  for (const postfix of COUNTER_POSTFIXES) {
    markers.add(postfix.marker);
  }
  return [...markers].sort((a, b) => b.length - a.length);
}

function buildReplaceMarkerIndex(markers: string[]): ReplaceMarkerIndex {
  const byFirstChar = new Map<string, string[]>();
  const charSet = new Set<string>();
  for (const marker of markers) {
    for (const ch of marker) {
      charSet.add(ch);
    }
    const first = marker[0];
    if (!first) {
      continue;
    }
    const bucket = byFirstChar.get(first);
    if (!bucket) {
      byFirstChar.set(first, [marker]);
      continue;
    }
    bucket.push(marker);
  }

  for (const bucket of byFirstChar.values()) {
    bucket.sort((a, b) => b.length - a.length);
  }
  return { byFirstChar, charSet };
}

function isNumericChar(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  return KANJI_NUMERIC_CHARS.has(ch) || ((ch >= "0" && ch <= "9") || (ch >= "０" && ch <= "９"));
}

function containsNumericChar(text: string): boolean {
  for (const ch of text) {
    if (isNumericChar(ch)) {
      return true;
    }
  }
  return false;
}

function isCandidateStartChar(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  return isNumericChar(ch) || CANDIDATE_EXTRA_START_CHARS.has(ch);
}

function isReplaceFragmentChar(ch: string | undefined, markerCharSet: Set<string>): boolean {
  if (!ch) {
    return false;
  }
  return isNumericChar(ch) || REPLACE_EXTRA_FRAGMENT_CHARS.has(ch) || markerCharSet.has(ch);
}

function containsMarker(text: string, markerIndex: ReplaceMarkerIndex): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const bucket = markerIndex.byFirstChar.get(text[i]);
    if (!bucket) {
      continue;
    }
    for (const marker of bucket) {
      if (text.startsWith(marker, i)) {
        return true;
      }
    }
  }
  return false;
}

function isAsciiAlphaNumeric(ch: string | undefined): boolean {
  if (!ch) {
    return false;
  }
  const code = ch.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isHanChar(ch: string | undefined): boolean {
  return !!ch && HAN_CHAR_RE.test(ch);
}

function shouldConvertBareNumberFragment(input: string, start: number, end: number, fragment: string): boolean {
  const normalized = normalizeInput(fragment);
  if (!hasParsableNumberText(normalized)) {
    return false;
  }

  const before = start > 0 ? input[start - 1] : undefined;
  const after = end < input.length ? input[end] : undefined;
  if (isAsciiAlphaNumeric(before) || isAsciiAlphaNumeric(after)) {
    return false;
  }

  // Prevent converting single kanji digits inside normal compound words, e.g. 一般.
  if (SINGLE_KANJI_DIGIT_RE.test(normalized) && (isHanChar(before) || isHanChar(after))) {
    return false;
  }
  return true;
}

function detectTaiExpression(input: string): TaiExpression | null {
  const splitAt = input.indexOf("対");
  if (splitAt <= 0) {
    return null;
  }
  if (splitAt !== input.lastIndexOf("対")) {
    return null;
  }
  if (splitAt >= input.length - 1) {
    return null;
  }
  const left = input.slice(0, splitAt);
  const right = input.slice(splitAt + 1);
  if (!hasParsableNumberText(left) || !hasParsableNumberText(right)) {
    return null;
  }
  return { left, right };
}

function isTaiExpressionFragment(fragment: string): boolean {
  return detectTaiExpression(normalizeInput(fragment)) !== null;
}

const WHITESPACE_ONLY_RE = /^\s*$/u;

function shouldUseDateModeForDay(
  input: string,
  fragmentStart: number,
  previousCounterId: string | undefined,
  previousReplacementEnd: number,
  options?: ReadOptions
): boolean {
  if (options?.mode?.day !== undefined) {
    return false;
  }
  if (previousCounterId !== "month") {
    return false;
  }
  if (previousReplacementEnd < 0 || previousReplacementEnd > fragmentStart) {
    return false;
  }
  return WHITESPACE_ONLY_RE.test(input.slice(previousReplacementEnd, fragmentStart));
}

function withDayDateModeIfUnspecified(options?: ReadOptions): ReadOptions | undefined {
  if (options?.mode?.day !== undefined) {
    return options;
  }
  const mode = {
    ...(options?.mode ?? {}),
    day: "date",
  };
  if (!options) {
    return { mode };
  }
  return {
    ...options,
    mode,
  };
}

function resolveReadOptionsForReplaceFragment(
  input: string,
  fragmentStart: number,
  previousCounterId: string | undefined,
  previousReplacementEnd: number,
  options?: ReadOptions
): ReadOptions | undefined {
  if (!shouldUseDateModeForDay(input, fragmentStart, previousCounterId, previousReplacementEnd, options)) {
    return options;
  }
  return withDayDateModeIfUnspecified(options);
}

function readMonthDayExpressionTokens(
  input: string,
  rules: RuleBundle,
  options?: ReadOptions
): { number: string; tokens: string[] } | null {
  const monthEnd = input.indexOf("月");
  if (monthEnd <= 0 || monthEnd >= input.length - 1) {
    return null;
  }
  if (monthEnd !== input.lastIndexOf("月")) {
    return null;
  }

  const monthPart = input.slice(0, monthEnd + 1);
  const dayPart = input.slice(monthEnd + 1);
  if (dayPart.length === 0 || !dayPart.endsWith("日") || /\s/u.test(dayPart[0])) {
    return null;
  }

  const month = toReading(monthPart, rules, options);
  if (!month || month.counterId !== "month") {
    return null;
  }
  const day = toReading(dayPart, rules, withDayDateModeIfUnspecified(options));
  if (!day || day.counterId !== "day") {
    return null;
  }

  return {
    number: `${month.number}月${day.number}日`,
    tokens: [...month.tokens, ...day.tokens],
  };
}

function replaceInTextCoreWithRules(
  input: string,
  rules: RuleBundle,
  markerIndex: ReplaceMarkerIndex,
  options: ReadOptions | undefined,
  includeDetails: boolean
): ReplaceResult {
  if (input.length === 0) {
    return {
      input,
      output: input,
      replacements: [],
    };
  }
  let out = "";
  let index = 0;
  let previousCounterId: string | undefined;
  let previousReplacementEnd = -1;
  const replacements: ReplaceResult["replacements"] | undefined = includeDetails ? [] : undefined;
  while (index < input.length) {
    const ch = input[index];
    if (!isCandidateStartChar(ch)) {
      out += ch;
      index += 1;
      continue;
    }

    const maxSpanEnd = Math.min(input.length, index + MAX_REPLACE_SPAN);
    let maxEnd = index;
    while (maxEnd < maxSpanEnd && isReplaceFragmentChar(input[maxEnd], markerIndex.charSet)) {
      maxEnd += 1;
    }
    if (maxEnd === index) {
      out += ch;
      index += 1;
      continue;
    }
    let matchedReading: string | undefined;
    let matchedSource: string | undefined;
    let matchedCounterId: string | undefined;
    let matchedEnd = index;
    const contextualOptions = resolveReadOptionsForReplaceFragment(
      input,
      index,
      previousCounterId,
      previousReplacementEnd,
      options
    );
    for (let end = maxEnd; end > index; end -= 1) {
      const fragment = input.slice(index, end);
      if (TRAILING_WHITESPACE_RE.test(fragment)) {
        continue;
      }
      if (!containsNumericChar(fragment)) {
        continue;
      }
      if (!containsMarker(fragment, markerIndex)) {
        if (!shouldConvertBareNumberFragment(input, index, end, fragment) && !isTaiExpressionFragment(fragment)) {
          continue;
        }
      }
      const reading = toReading(fragment, rules, contextualOptions);
      if (!reading) {
        continue;
      }
      matchedReading = reading.reading;
      matchedSource = fragment;
      matchedCounterId = reading.counterId;
      matchedEnd = end;
      break;
    }

    if (matchedReading !== undefined) {
      out += matchedReading;
      if (replacements) {
        replacements.push({
          start: index,
          end: matchedEnd,
          source: matchedSource ?? input.slice(index, matchedEnd),
          reading: matchedReading,
        });
      }
      previousCounterId = matchedCounterId;
      previousReplacementEnd = matchedEnd;
      index = matchedEnd;
      continue;
    }

    out += ch;
    index += 1;
  }
  return {
    input,
    output: out,
    replacements: replacements ?? [],
  };
}

function replaceInTextDetailedWithRules(input: string, rules: RuleBundle, markerIndex: ReplaceMarkerIndex, options?: ReadOptions): ReplaceResult {
  return replaceInTextCoreWithRules(input, rules, markerIndex, options, true);
}

function replaceInTextWithRules(input: string, rules: RuleBundle, markerIndex: ReplaceMarkerIndex, options?: ReadOptions): string {
  return replaceInTextCoreWithRules(input, rules, markerIndex, options, false).output;
}

function resolveCounterCompose(rules: RuleBundle, counterId: string, options?: ReadOptions) {
  const counter = rules.counters.counters[counterId];
  if (!counter) {
    return { compose: undefined, modeUsed: undefined };
  }

  const requestedMode = options?.mode?.[counterId];
  const modeUsed = requestedMode && counter.modes?.[requestedMode] ? requestedMode : counter.defaultMode;
  const modeCompose = modeUsed ? counter.modes?.[modeUsed]?.compose : undefined;
  return {
    compose: modeCompose ?? counter.compose,
    modeUsed,
  };
}

function readFractionDigitToken(digit: number, rules: RuleBundle, options?: ReadOptions): string {
  if (digit === 0) {
    const zeroKey = options?.variant?.zero ?? rules.core.defaultVariant.zero;
    return rules.core.variants.zero[zeroKey];
  }
  const tokens = readNumberTokens(BigInt(digit), rules.core, options?.variant);
  return tokens[0];
}

function readDecimalTokens(
  sign: 1 | -1,
  integerPart: bigint,
  fractionDigits: number[],
  rules: RuleBundle,
  options?: ReadOptions
) {
  const integerTokens = normalizeIntegerTokensForDecimalPoint(readNumberTokens(integerPart, rules.core, options?.variant));
  const prefix = sign < 0 ? [...rules.core.minus, ...integerTokens] : integerTokens;
  return [...prefix, DECIMAL_POINT_TOKEN, ...fractionDigits.map((d) => readFractionDigitToken(d, rules, options))];
}

function readNumberTextTokens(numberText: string, rules: RuleBundle, options?: ReadOptions): ParsedNumberTokens | null {
  const decimal = parseArabicDecimal(numberText);
  if (decimal) {
    return {
      normalized: decimal.normalized,
      tokens: readDecimalTokens(decimal.sign, decimal.integerPart, decimal.fractionDigits, rules, options),
    };
  }
  const value = parseNumber(numberText);
  if (value === null) {
    return null;
  }
  return {
    normalized: value.toString(),
    tokens: readNumberTokens(value, rules.core, options?.variant),
  };
}

function readTaiExpressionTokens(input: string, rules: RuleBundle, options?: ReadOptions) {
  const expr = detectTaiExpression(input);
  if (!expr) {
    return null;
  }
  const left = readNumberTextTokens(expr.left, rules, options);
  if (!left) {
    return null;
  }
  const right = readNumberTextTokens(expr.right, rules, options);
  if (!right) {
    return null;
  }
  const tokens = [...normalizeIntegerTokensForDecimalPoint(left.tokens), "たい", ...right.tokens];
  return {
    number: `${left.normalized}対${right.normalized}`,
    tokens,
  };
}

function toReading(input: string, rules: RuleBundle, options?: ReadOptions): ReadResult | null {
  const normalized = normalizeInput(input);
  const tai = readTaiExpressionTokens(normalized, rules, options);
  if (tai) {
    return {
      input,
      normalized,
      number: tai.number,
      counterId: undefined,
      modeUsed: undefined,
      tokens: tai.tokens,
      reading: joinTokens(tai.tokens),
    } satisfies ReadResult;
  }
  const monthDay = readMonthDayExpressionTokens(normalized, rules, options);
  if (monthDay) {
    return {
      input,
      normalized,
      number: monthDay.number,
      counterId: undefined,
      modeUsed: undefined,
      tokens: monthDay.tokens,
      reading: joinTokens(monthDay.tokens),
    } satisfies ReadResult;
  }
  let prefix: CounterPrefixMatch | undefined;
  let postfix: CounterPostfixMatch | undefined;
  let counterInput = normalized;
  let detected = detectCounterWithParsableNumber(normalized, rules);
  if (!detected) {
    prefix = detectCounterPrefix(normalized);
    if (prefix) {
      counterInput = normalized.slice(prefix.marker.length);
      detected = detectCounterWithParsableNumber(counterInput, rules);
    }
  }
  if (!detected) {
    postfix = detectCounterPostfix(counterInput);
    if (postfix) {
      counterInput = normalized.slice(0, -postfix.marker.length);
      if (prefix) {
        counterInput = counterInput.slice(prefix.marker.length);
      }
      detected = detectCounterWithParsableNumber(counterInput, rules);
    }
  }
  const numberText = detected ? detected.numberPart : counterInput;
  const decimal = parseArabicDecimal(numberText);
  if (decimal) {
    const baseTokens = readDecimalTokens(decimal.sign, decimal.integerPart, decimal.fractionDigits, rules, options);
    const tokensWithPostfix = prependCounterPrefix(appendCounterPostfix(baseTokens, postfix), prefix);
    if (!detected) {
      return {
        input,
        normalized,
        number: decimal.normalized,
        counterId: undefined,
        modeUsed: undefined,
        tokens: tokensWithPostfix,
        reading: joinTokens(tokensWithPostfix),
      } satisfies ReadResult;
    }

    const resolved = resolveCounterCompose(rules, detected.counterId, options);
    if (!resolved.compose) {
      return {
        input,
        normalized,
        number: decimal.normalized,
        counterId: detected.counterId,
        modeUsed: resolved.modeUsed,
        tokens: tokensWithPostfix,
        reading: joinTokens(tokensWithPostfix),
      } satisfies ReadResult;
    }

    const decimalSuffixReading = resolveDecimalComposeSuffix(resolved.compose, rules);
    if (!decimalSuffixReading) {
      if (options?.strict) {
        throw new Error(`Decimal values with counter '${detected.counterId}' are not supported`);
      }
      return null;
    }

    const tokens = prependCounterPrefix(
      appendCounterPostfix([...baseTokens, ...decimalSuffixReading], postfix),
      prefix
    );
    return {
      input,
      normalized,
      number: decimal.normalized,
      counterId: detected.counterId,
      modeUsed: resolved.modeUsed,
      tokens,
      reading: joinTokens(tokens),
    } satisfies ReadResult;
  }

  const numberValue = parseNumber(numberText);

  if (numberValue === null) {
    if (options?.strict) {
      throw new Error(`Unable to parse number from input: ${input}`);
    }
    return null;
  }

  const baseTokens = readNumberTokens(numberValue, rules.core, options?.variant);
  const applied = detected
    ? applyCounter(
        rules.counters,
        rules.patterns,
        {
          counterId: detected.counterId,
          numberValue,
          numberTokens: baseTokens,
          modeOverrides: options?.mode,
        }
      )
    : { tokens: baseTokens, modeUsed: undefined, counterId: undefined };

  const tokens = prependCounterPrefix(appendCounterPostfix(applied.tokens, postfix), prefix);
  return {
    input,
    normalized,
    number: numberValue,
    counterId: detected ? detected.counterId : undefined,
    modeUsed: applied.modeUsed,
    tokens,
    reading: joinTokens(tokens),
  };
}

function createYomiJaWithRules(rules: RuleBundle): YomiJa {
  const replaceMarkers = collectReplaceMarkers(rules);
  const replaceMarkerIndex = buildReplaceMarkerIndex(replaceMarkers);
  const readNoOptionsCache = new HotLruCache<string | null>(READ_CACHE_LIMIT);
  const readWithOptionsCache = new HotLruCache<string | null>(READ_CACHE_LIMIT);
  const replaceNoOptionsCache = new HotLruCache<string>(REPLACE_CACHE_LIMIT);
  const replaceWithOptionsCache = new HotLruCache<string>(REPLACE_CACHE_LIMIT);
  const replaceDetailedNoOptionsCache = new HotLruCache<ReplaceResult>(REPLACE_DETAILED_CACHE_LIMIT);
  const replaceDetailedWithOptionsCache = new HotLruCache<ReplaceResult>(REPLACE_DETAILED_CACHE_LIMIT);

  return {
    read(input, options) {
      return getCachedOrCompute(readNoOptionsCache, readWithOptionsCache, input, options, () => {
        const result = toReading(input, rules, options);
        return result === null ? null : result.reading;
      });
    },
    readDetailed(input, options) {
      return toReading(input, rules, options);
    },
    readNumber(value, options) {
      return joinTokens(readNumberTokens(value, rules.core, options?.variant));
    },
    replaceInText(input, options) {
      return getCachedOrCompute(replaceNoOptionsCache, replaceWithOptionsCache, input, options, () =>
        replaceInTextWithRules(input, rules, replaceMarkerIndex, options)
      );
    },
    replaceInTextDetailed(input, options) {
      const result = getCachedOrCompute(
        replaceDetailedNoOptionsCache,
        replaceDetailedWithOptionsCache,
        input,
        options,
        () => replaceInTextDetailedWithRules(input, rules, replaceMarkerIndex, options)
      );
      return cloneReplaceResult(result);
    },
  };
}

export function createYomiJa(ruleDir?: string): YomiJa {
  return createYomiJaWithRules(loadRules(ruleDir));
}

const defaultRules = loadRules();
export const yomiJa: YomiJa = createYomiJaWithRules(defaultRules);

export function read(input: string, options?: ReadOptions): string | null {
  return yomiJa.read(input, options);
}

export function readDetailed(input: string, options?: ReadOptions): ReadResult | null {
  return yomiJa.readDetailed(input, options);
}

export function readNumber(value: bigint, options?: ReadOptions): string {
  return yomiJa.readNumber(value, options);
}

export function replaceInText(input: string, options?: ReadOptions): string {
  return yomiJa.replaceInText(input, options);
}

export function replaceInTextDetailed(input: string, options?: ReadOptions): ReplaceResult {
  return yomiJa.replaceInTextDetailed(input, options);
}

export default yomiJa;
