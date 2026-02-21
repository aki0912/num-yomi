import type { ReadOptions, ReadResult, RuleBundle, YomiJa } from "./rules/types.js";
import { normalizeInput } from "./core/normalize.js";
import { parseArabicDecimal, parseNumber } from "./core/parseNumber.js";
import { readNumberTokens } from "./core/readNumberTokens.js";
import { joinTokens } from "./core/join.js";
import { detectCounter } from "./counters/detect.js";
import { applyCounter } from "./counters/apply.js";
import { loadRules } from "./rules/load.js";

const DECIMAL_POINT_TOKEN = "てん";
const COUNTER_POSTFIXES = [
  { marker: "目", reading: ["め"] },
  { marker: "め", reading: ["め"] },
] as const;

interface CounterPostfixMatch {
  marker: string;
  reading: readonly string[];
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

function appendCounterPostfix(tokens: string[], postfix: CounterPostfixMatch | undefined): string[] {
  if (!postfix) {
    return tokens;
  }
  return [...tokens, ...postfix.reading];
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
  const integerTokens = readNumberTokens(integerPart, rules.core, options?.variant);
  const prefix = sign < 0 ? [...rules.core.minus, ...integerTokens] : integerTokens;
  return [...prefix, DECIMAL_POINT_TOKEN, ...fractionDigits.map((d) => readFractionDigitToken(d, rules, options))];
}

function toReading(input: string, rules: RuleBundle, options?: ReadOptions) {
  const normalized = normalizeInput(input);
  let postfix: CounterPostfixMatch | undefined;
  let counterInput = normalized;
  let detected = detectCounter(normalized, rules.counters);
  if (!detected) {
    postfix = detectCounterPostfix(normalized);
    if (postfix) {
      counterInput = normalized.slice(0, -postfix.marker.length);
      detected = detectCounter(counterInput, rules.counters);
    }
  }
  const numberText = detected ? detected.numberPart : counterInput;
  const decimal = parseArabicDecimal(numberText);
  if (decimal) {
    const baseTokens = readDecimalTokens(decimal.sign, decimal.integerPart, decimal.fractionDigits, rules, options);
    const tokensWithPostfix = appendCounterPostfix(baseTokens, postfix);
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

    if (resolved.compose.type !== "concat") {
      if (options?.strict) {
        throw new Error(
          `Decimal values with counter '${detected.counterId}' are only supported for concat compose`
        );
      }
      return null;
    }

    const tokens = appendCounterPostfix([...baseTokens, ...resolved.compose.suffixReading], postfix);
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

  const tokens = appendCounterPostfix(applied.tokens, postfix);
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
  return {
    read(input, options) {
      const result = toReading(input, rules, options);
      return result === null ? null : result.reading;
    },
    readDetailed(input, options) {
      return toReading(input, rules, options);
    },
    readNumber(value, options) {
      return joinTokens(readNumberTokens(value, rules.core, options?.variant));
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

export default yomiJa;
