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

function readDigit(digit: number, variant: VariantConfig, core: CoreRules): ReadingToken[] {
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
  const units10 = core.smallUnits["10"];
  const units100 = core.smallUnits["100"];
  const units1000 = core.smallUnits["1000"];

  if (value >= 1000) {
    const digit = Math.floor(value / 1000);
    value %= 1000;
    if (digit === 1) {
      out.push(...units1000);
    } else if (specialThousands[String(digit)] !== undefined) {
      out.push(...specialThousands[String(digit)]);
    } else {
      out.push(...readDigit(digit, variant, core), ...units1000);
    }
  }

  if (value >= 100) {
    const digit = Math.floor(value / 100);
    value %= 100;
    if (digit === 1) {
      out.push(...units100);
    } else if (specialHundreds[String(digit)] !== undefined) {
      out.push(...specialHundreds[String(digit)]);
    } else {
      out.push(...readDigit(digit, variant, core), ...units100);
    }
  }

  if (value >= 10) {
    const digit = Math.floor(value / 10);
    value %= 10;
    if (digit === 1) {
      out.push(...units10);
    } else {
      out.push(...readDigit(digit, variant, core), ...units10);
    }
  }

  if (value > 0) {
    out.push(...readDigit(value, variant, core));
  }

  return out;
}

function readTokensBy4DigitsChunks(value: bigint, core: CoreRules, variant: VariantConfig): ReadingToken[] {
  let remaining = value;
  const chunks: Array<{ pow10: number; tokens: ReadingToken[] }> = [];

  let pow10 = 0;
  while (remaining > 0n) {
    const chunk = Number(remaining % 10000n);
    if (chunk !== 0) {
      chunks.push({ pow10, tokens: read0To9999(chunk, variant, core) });
    }
    remaining /= 10000n;
    pow10 += 4;
  }

  const out: ReadingToken[] = [];
  for (let i = chunks.length - 1; i >= 0; i -= 1) {
    const item = chunks[i];
    out.push(...item.tokens);
    const unitTokens = readBigUnit(item.pow10, core.bigUnits);
    if (unitTokens) {
      out.push(...unitTokens);
    }
  }
  return out;
}

function readBigUnit(pow10: number, bigUnits: CoreRules["bigUnits"]): ReadingToken[] | undefined {
  for (const entry of bigUnits) {
    if (entry.pow10 === pow10) {
      return entry.reading;
    }
  }
  return undefined;
}
