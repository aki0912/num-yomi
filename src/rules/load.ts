import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RuleBundle } from "./types.js";
import { validateRuleBundle } from "./validate.js";
import { GENERATED_RULE_BUNDLE } from "../generated/rules_bundle.js";

function resolveDefaultRuleDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "rules/ja"),
    path.resolve(here, "../../rules/ja"),
    path.resolve(here, "../rules/ja"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "core.json"))) {
      return candidate;
    }
  }

  return candidates[0];
}

const DEFAULT_RULE_DIR = resolveDefaultRuleDir();

function isDefaultRuleDir(ruleDir: string): boolean {
  return path.resolve(ruleDir) === path.resolve(DEFAULT_RULE_DIR);
}

export function loadRules(ruleDir = DEFAULT_RULE_DIR): RuleBundle {
  if (isDefaultRuleDir(ruleDir)) {
    return GENERATED_RULE_BUNDLE;
  }

  const corePath = path.join(ruleDir, "core.json");
  const patternsPath = path.join(ruleDir, "patterns.json");
  const countersPath = path.join(ruleDir, "counters.json");

  const core = JSON.parse(fs.readFileSync(corePath, "utf8"));
  const patterns = JSON.parse(fs.readFileSync(patternsPath, "utf8"));
  const counters = JSON.parse(fs.readFileSync(countersPath, "utf8"));

  const ruleBundle = {
    core,
    patterns,
    counters,
  };

  validateRuleBundle(ruleBundle);
  return ruleBundle;
}
