import type { ReadOptions } from "../rules/types.js";

export interface CommonCliReadOptions {
  zero?: "rei" | "zero";
  strict: boolean;
  mode: Record<string, string>;
}

type Fail = (message: string) => never;

export function applyCommonReadOptionArg(
  arg: string,
  args: string[],
  options: CommonCliReadOptions,
  fail: Fail
): boolean {
  if (arg === "--zero") {
    const value = args.shift();
    if (value === "rei" || value === "zero") {
      options.zero = value;
      return true;
    }
    fail("--zero expects rei or zero");
  }

  if (arg === "--mode") {
    const value = args.shift();
    if (!value) {
      fail("--mode requires counter=mode");
    }
    const split = value.indexOf("=");
    if (split <= 0 || split >= value.length - 1) {
      fail("--mode requires counter=mode");
    }
    const counterId = value.slice(0, split);
    const modeId = value.slice(split + 1);
    options.mode[counterId] = modeId;
    return true;
  }

  if (arg === "--strict") {
    options.strict = true;
    return true;
  }

  return false;
}

export function buildReadOptions(options: CommonCliReadOptions): ReadOptions {
  return {
    strict: options.strict,
    variant: options.zero ? { zero: options.zero } : undefined,
    mode: options.mode,
  };
}
