import type { ReadOptions, ReadResult, RuleBundle, YomiJa } from "./rules/types.js";
import { normalizeInput } from "./core/normalize.js";
import { parseNumber } from "./core/parseNumber.js";
import { readNumberTokens } from "./core/readNumberTokens.js";
import { joinTokens } from "./core/join.js";
import { detectCounter } from "./counters/detect.js";
import { applyCounter } from "./counters/apply.js";
import { loadRules } from "./rules/load.js";

function toReading(input: string, rules: RuleBundle, options?: ReadOptions) {
  const normalized = normalizeInput(input);
  const detected = detectCounter(normalized, rules.counters);
  const numberText = detected ? detected.numberPart : normalized;
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

  const tokens = applied.tokens;
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
