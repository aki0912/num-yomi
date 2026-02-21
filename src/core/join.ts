import type { ReadingToken } from "../rules/types.js";

export function joinTokens(tokens: ReadingToken[]): string {
  return tokens.join("");
}
