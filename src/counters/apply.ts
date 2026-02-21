import type {
  CounterCompose,
  CounterDefinitions,
  ComposeConcat,
  ComposeExceptionsFirst,
  PatternCompose,
  PatternDefinitions,
  ReadingToken,
} from "../rules/types.js";
import { applyTailPattern } from "./patterns.js";

export interface CounterApplyInput {
  numberValue: bigint;
  numberTokens: ReadingToken[];
  counterId: string;
  modeOverrides?: Record<string, string>;
}

export interface CounterApplyResult {
  counterId?: string;
  modeUsed?: string;
  tokens: ReadingToken[];
}

export function applyCounter(
  counterDefs: CounterDefinitions,
  patterns: PatternDefinitions,
  input: CounterApplyInput
): CounterApplyResult {
  const { counterId } = input;
  const counter = counterDefs.counters[counterId];
  if (!counter) {
    return { tokens: input.numberTokens, counterId, modeUsed: undefined };
  }

  const requestedMode = input.modeOverrides?.[counterId];
  const modeName = requestedMode && counter.modes?.[requestedMode] ? requestedMode : counter.defaultMode;
  const modeCompose = modeName ? counter.modes?.[modeName]?.compose : undefined;
  const compose = (modeCompose ?? counter.compose) as CounterCompose;

  if (!compose) {
    return { tokens: input.numberTokens, counterId, modeUsed: modeName };
  }

  if (compose.type === "concat") {
    return {
      counterId,
      modeUsed: modeName,
      tokens: [...input.numberTokens, ...compose.suffixReading],
    };
  }

  if (compose.type === "exceptions_first") {
    return applyExceptionsFirst(compose, patterns, input, counterId, modeName);
  }

  return applyPattern(compose, patterns, input, counterId, modeName);
}

function applyExceptionsFirst(
  compose: ComposeExceptionsFirst,
  patterns: PatternDefinitions,
  input: CounterApplyInput,
  counterId: string,
  modeName?: string
): CounterApplyResult {
  const key = input.numberValue < 0n ? (-input.numberValue).toString() : input.numberValue.toString();
  if (compose.exceptions[key]) {
    return { counterId, modeUsed: modeName, tokens: [...compose.exceptions[key]] };
  }
  return applyCounterFallback(compose.fallback, patterns, input, counterId, modeName);
}

function applyCounterFallback(
  fallback: ComposeConcat | PatternCompose,
  patterns: PatternDefinitions,
  input: CounterApplyInput,
  counterId: string,
  modeName?: string
): CounterApplyResult {
  if (fallback.type === "concat") {
    return {
      counterId,
      modeUsed: modeName,
      tokens: [...input.numberTokens, ...fallback.suffixReading],
    };
  }
  return applyPattern(fallback, patterns, input, counterId, modeName);
}

function applyPattern(
  compose: PatternCompose,
  patterns: PatternDefinitions,
  input: CounterApplyInput,
  counterId: string,
  modeName?: string
): CounterApplyResult {
  const pattern = patterns.patterns[compose.patternId];
  if (!pattern) {
    return {
      counterId,
      modeUsed: modeName,
      tokens: input.numberTokens,
    };
  }

  const applied = applyTailPattern(pattern, input.numberTokens);
  const formReading = compose.forms[applied.form];
  if (!formReading) {
    return {
      counterId,
      modeUsed: modeName,
      tokens: input.numberTokens,
    };
  }

  return {
    counterId,
    modeUsed: modeName,
    tokens: [...applied.tokens, ...formReading],
  };
}
