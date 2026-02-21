import type { CoreRules, PatternDefinitions, CounterDefinitions, RuleBundle } from "./types.js";

export function validateCore(core: unknown): core is CoreRules {
  if (!core || typeof core !== "object") {
    throw new Error("core.json is invalid");
  }
  return true;
}

export function validatePatterns(patterns: unknown): patterns is PatternDefinitions {
  if (!patterns || typeof patterns !== "object") {
    throw new Error("patterns.json is invalid");
  }
  return true;
}

export function validateCounters(counters: unknown): counters is CounterDefinitions {
  if (!counters || typeof counters !== "object") {
    throw new Error("counters.json is invalid");
  }
  return true;
}

export function validateRuleBundle(ruleBundle: unknown): ruleBundle is RuleBundle {
  const root = ruleBundle as RuleBundle | null;
  if (!root || typeof root !== "object" || !("core" in root) || !("patterns" in root) || !("counters" in root)) {
    throw new Error("Rules bundle is invalid");
  }

  validateCore(root.core);
  validatePatterns(root.patterns);
  validateCounters(root.counters);
  return true;
}
