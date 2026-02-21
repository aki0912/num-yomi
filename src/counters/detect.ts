import type { CounterDefinitions } from "../rules/types.js";

export interface CounterMatch {
  counterId: string;
  numberPart: string;
  mode: "prefix" | "suffix";
  surface: string;
}

interface IndexedMarker {
  id: string;
  marker: string;
}

interface CounterIndex {
  prefixesByHead: Map<string, IndexedMarker[]>;
  suffixesByTail: Map<string, IndexedMarker[]>;
}

const counterIndexCache = new WeakMap<CounterDefinitions, CounterIndex>();

function buildCounterIndex(counters: CounterDefinitions): CounterIndex {
  const prefixesByHead = new Map<string, IndexedMarker[]>();
  const suffixesByTail = new Map<string, IndexedMarker[]>();

  for (const [counterId, counter] of Object.entries(counters.counters)) {
    for (const marker of counter.surface?.prefix ?? []) {
      const head = marker[0];
      if (!head) continue;
      const current = prefixesByHead.get(head);
      if (current) {
        current.push({ id: counterId, marker });
      } else {
        prefixesByHead.set(head, [{ id: counterId, marker }]);
      }
    }

    for (const marker of counter.surface?.suffix ?? []) {
      const tail = marker[marker.length - 1];
      if (!tail) continue;
      const current = suffixesByTail.get(tail);
      if (current) {
        current.push({ id: counterId, marker });
      } else {
        suffixesByTail.set(tail, [{ id: counterId, marker }]);
      }
    }
  }

  for (const entries of prefixesByHead.values()) {
    entries.sort((a, b) => b.marker.length - a.marker.length);
  }

  for (const entries of suffixesByTail.values()) {
    entries.sort((a, b) => b.marker.length - a.marker.length);
  }

  return { prefixesByHead, suffixesByTail };
}

function getCounterIndex(counters: CounterDefinitions): CounterIndex {
  const cached = counterIndexCache.get(counters);
  if (cached) return cached;
  const built = buildCounterIndex(counters);
  counterIndexCache.set(counters, built);
  return built;
}

export function detectCounter(input: string, counters: CounterDefinitions): CounterMatch | null {
  if (input.length === 0) {
    return null;
  }

  const index = getCounterIndex(counters);
  const prefixCandidates = index.prefixesByHead.get(input[0]);
  if (prefixCandidates) {
    for (const candidate of prefixCandidates) {
      if (!input.startsWith(candidate.marker)) {
        continue;
      }
      return {
        counterId: candidate.id,
        numberPart: input.slice(candidate.marker.length),
        mode: "prefix",
        surface: candidate.marker,
      };
    }
  }

  const suffixCandidates = index.suffixesByTail.get(input[input.length - 1]);
  if (suffixCandidates) {
    for (const candidate of suffixCandidates) {
      if (!input.endsWith(candidate.marker)) {
        continue;
      }
      return {
        counterId: candidate.id,
        numberPart: input.slice(0, -candidate.marker.length),
        mode: "suffix",
        surface: candidate.marker,
      };
    }
  }

  return null;
}
