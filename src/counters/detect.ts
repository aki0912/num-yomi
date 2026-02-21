import type { CounterDefinitions } from "../rules/types.js";

export interface CounterMatch {
  counterId: string;
  numberPart: string;
  mode: "prefix" | "suffix";
  surface: string;
}

export function detectCounter(input: string, counters: CounterDefinitions): CounterMatch | null {
  let bestPrefixMatch: { id: string; marker: string } | null = null;

  for (const [counterId, counter] of Object.entries(counters.counters)) {
    const prefix = counter.surface?.prefix;
    if (!prefix) continue;
    for (const marker of prefix) {
      if (input.startsWith(marker)) {
        if (bestPrefixMatch === null || marker.length > bestPrefixMatch.marker.length) {
          bestPrefixMatch = { id: counterId, marker };
        }
      }
    }
  }

  if (bestPrefixMatch) {
    const numberPart = input.slice(bestPrefixMatch.marker.length);
    return {
      counterId: bestPrefixMatch.id,
      numberPart,
      mode: "prefix",
      surface: bestPrefixMatch.marker,
    };
  }

  let bestSuffixMatch: { id: string; marker: string } | null = null;
  for (const [counterId, counter] of Object.entries(counters.counters)) {
    const suffix = counter.surface?.suffix;
    if (!suffix) continue;
    for (const marker of suffix) {
      if (input.endsWith(marker)) {
        if (bestSuffixMatch === null || marker.length > bestSuffixMatch.marker.length) {
          bestSuffixMatch = { id: counterId, marker };
        }
      }
    }
  }

  if (bestSuffixMatch) {
    const numberPart = input.slice(0, -bestSuffixMatch.marker.length);
    return {
      counterId: bestSuffixMatch.id,
      numberPart,
      mode: "suffix",
      surface: bestSuffixMatch.marker,
    };
  }

  return null;
}
