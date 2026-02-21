import type { ReadOptions, ReadResult, YomiJa, VariantConfig } from "./rules/types.js";
import { normalizeInput } from "./core/normalize.js";
import { parseNumber } from "./core/parseNumber.js";
import { readNumberTokens } from "./core/readNumberTokens.js";
import { joinTokens } from "./core/join.js";
import { detectCounter } from "./counters/detect.js";
import { applyCounter } from "./counters/apply.js";
import { loadRules } from "./rules/load.js";

const defaultRules = loadRules();

function resolveVariant(variant: VariantConfig | undefined) {
  return {
    zero: variant?.zero,
    four: variant?.four,
    seven: variant?.seven,
    nine: variant?.nine,
  } satisfies VariantConfig;
}

function toReading(input: string, options?: ReadOptions) {
  const normalized = normalizeInput(input);
  const detected = detectCounter(normalized, defaultRules.counters);
  const numberText = detected ? detected.numberPart : normalized;
  const numberValue = parseNumber(numberText);

  if (numberValue === null) {
    if (options?.strict) {
      throw new Error(`Unable to parse number from input: ${input}`);
    }
    return null;
  }

  const baseTokens = readNumberTokens(numberValue, defaultRules.core, resolveVariant(options?.variant));
  const applied = detected
    ? applyCounter(
        defaultRules.counters,
        defaultRules.patterns,
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

export const yomiJa: YomiJa = {
  read(input, options) {
    const result = toReading(input, options);
    return result === null ? null : result.reading;
  },
  readDetailed(input, options) {
    return toReading(input, options);
  },
  readNumber(value, options) {
    return joinTokens(readNumberTokens(value, defaultRules.core, resolveVariant(options?.variant)));
  },
};

export default yomiJa;
export { toReading as readDetailedImpl };
