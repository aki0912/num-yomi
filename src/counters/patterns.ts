import type { PatternRule, ReadingToken } from "../rules/types.js";

export interface AppliedPattern {
  tokens: ReadingToken[];
  form: string;
}

export function applyTailPattern(pattern: PatternRule, tokens: ReadingToken[]): AppliedPattern {
  if (tokens.length === 0) {
    return { tokens, form: pattern.defaultForm };
  }

  const tail = tokens[tokens.length - 1];

  for (const rule of pattern.rules) {
    if (!rule.whenTailIn.includes(tail)) {
      continue;
    }

    const nextTokens = [...tokens];
    if (rule.rewriteTail && rule.rewriteTail[tail]) {
      nextTokens[nextTokens.length - 1] = rule.rewriteTail[tail];
    }
    return {
      tokens: nextTokens,
      form: rule.useForm ?? pattern.defaultForm,
    };
  }

  return { tokens, form: pattern.defaultForm };
}
