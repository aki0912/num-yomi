import type { CoreRules, ReadingToken, VariantConfig } from "../rules/types.js";

export function readNumberTokens(value: bigint, core: CoreRules, variant: VariantConfig = {}): ReadingToken[] {
  if (value === 0n) {
    return [readZero(variant, core)];
  }

  const abs = value < 0n ? -value : value;
  const chunkToReading = readTokensBy4DigitsChunks(abs, core, variant);
  return abs === value ? chunkToReading : [...core.minus, ...chunkToReading];
}

function readZero(variant: VariantConfig, core: CoreRules): ReadingToken {
  const key = variant.zero ?? core.defaultVariant.zero;
  return core.variants.zero[key];
}

function readDigit(value: bigint, variant: VariantConfig, core: CoreRules): ReadingToken[] {
  const digit = Number(value);
  if (digit === 4) {
    const key = variant.four ?? core.defaultVariant.four;
    return [core.variants.four[key === "shi" ? "shi" : "yon"]];
  }
  if (digit === 7) {
    const key = variant.seven ?? core.defaultVariant.seven;
    return [core.variants.seven[key === "shichi" ? "shichi" : "nana"]];
  }
  if (digit === 9) {
    const key = variant.nine ?? core.defaultVariant.nine;
    return [core.variants.nine[key === "ku" ? "ku" : "kyu"]];
  }
  return core.digits[String(digit)];
}

function read0To9999(n: number, variant: VariantConfig, core: CoreRules): ReadingToken[] {
  let value = n;
  const out: ReadingToken[] = [];
  const specialThousands = core.specialThousands;
  const specialHundreds = core.specialHundreds;

  if (value >= 1000) {
    const digit = Math.floor(value / 1000);
    value %= 1000;
    if (digit === 1) {
      out.push(...core.smallUnits["1000"]);
    } else if (specialThousands[String(digit)] !== undefined) {
      out.push(...specialThousands[String(digit)]);
    } else {
      out.push(...readDigit(BigInt(digit), variant, core), ...core.smallUnits["1000"]);
    }
  }

  if (value >= 100) {
    const digit = Math.floor(value / 100);
    value %= 100;
    if (digit === 1) {
      out.push(...core.smallUnits["100"]);
    } else if (specialHundreds[String(digit)] !== undefined) {
      out.push(...specialHundreds[String(digit)]);
    } else {
      out.push(...readDigit(BigInt(digit), variant, core), ...core.smallUnits["100"]);
    }
  }

  if (value >= 10) {
    const digit = Math.floor(value / 10);
    value %= 10;
    if (digit === 1) {
      out.push(...core.smallUnits["10"]);
    } else {
      out.push(...readDigit(BigInt(digit), variant, core), ...core.smallUnits["10"]);
    }
  }

  if (value > 0) {
    out.push(...readDigit(BigInt(value), variant, core));
  }

  return out;
}

function readTokensBy4DigitsChunks(value: bigint, core: CoreRules, variant: VariantConfig): ReadingToken[] {
  let remaining = value;
  const chunks: ReadingToken[][] = [];
  const unitByPow10 = new Map<number, ReadingToken[]>(
    core.bigUnits.map((entry) => [entry.pow10, entry.reading])
  );

  let pow10 = 0;
  while (remaining > 0n) {
    const chunk = Number(remaining % 10000n);
    if (chunk !== 0) {
      const tokens = read0To9999(chunk, variant, core);
      const unitTokens = unitByPow10.get(pow10) ?? [];
      chunks.push([...tokens, ...unitTokens]);
    }
    remaining /= 10000n;
    pow10 += 4;
  }

  return chunks.reverse().flat();
}
