const ARABIC_RE = /^[-+]?\d+$/;

const KA_NUMBERS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const SMALL_UNITS: Record<string, bigint> = {
  十: 10n,
  百: 100n,
  千: 1000n,
};

const BIG_UNITS: Record<string, bigint> = {
  万: 10000n,
  億: 100000000n,
  兆: 1000000000000n,
  京: 10000000000000000n,
};

function parseKansuji(input: string): bigint | null {
  if (!/^[+\-]?[零〇一二三四五六七八九十百千万億兆京]+$/.test(input)) {
    return null;
  }

  let remaining = input;
  let sign = 1n;
  if (remaining.startsWith("+") || remaining.startsWith("-")) {
    if (remaining.startsWith("-")) {
      sign = -1n;
    }
    remaining = remaining.slice(1);
    if (!remaining) {
      return null;
    }
  }

  let total = 0n;
  let chunk = 0n;
  let digitBuffer: bigint | null = null;

  const flushDigitBuffer = (): void => {
    if (digitBuffer !== null) {
      chunk += digitBuffer;
      digitBuffer = null;
    }
  };

  for (const ch of remaining) {
    if (Object.hasOwn(KA_NUMBERS, ch)) {
      const d = BigInt(KA_NUMBERS[ch]);
      if (digitBuffer === null) {
        digitBuffer = d;
      } else {
        digitBuffer = digitBuffer * 10n + d;
      }
      continue;
    }

    if (Object.hasOwn(SMALL_UNITS, ch)) {
      const unit = SMALL_UNITS[ch];
      const num = digitBuffer === null ? 1n : digitBuffer;
      chunk += num * unit;
      digitBuffer = null;
      continue;
    }

    if (Object.hasOwn(BIG_UNITS, ch)) {
      const unit = BIG_UNITS[ch];
      flushDigitBuffer();
      total += chunk * unit;
      chunk = 0n;
      continue;
    }

    return null;
  }

  flushDigitBuffer();
  return sign * (total + chunk);
}

export function parseNumber(input: string): bigint | null {
  if (ARABIC_RE.test(input)) {
    return BigInt(input);
  }
  return parseKansuji(input);
}
