#!/usr/bin/env node
import yomi from "../index.js";

function parseArgs(argv: string[]) {
  const options: {
    zero?: "rei" | "zero";
    strict: boolean;
    replace: boolean;
    mode: Record<string, string>;
    input?: string;
  } = {
    strict: false,
    replace: false,
    mode: {},
  };

  const args = [...argv];
  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;
    if (arg === "--zero") {
      const value = args.shift();
      if (value === "rei" || value === "zero") {
        options.zero = value;
      } else {
        console.error("--zero expects rei or zero");
        process.exit(1);
      }
      continue;
    }
    if (arg === "--mode") {
      const value = args.shift();
      if (!value) {
        console.error("--mode requires counter=mode");
        process.exit(1);
      }
      const split = value.indexOf("=");
      if (split === -1) {
        console.error("--mode requires counter=mode");
        process.exit(1);
      }
      const counter = value.slice(0, split);
      const mode = value.slice(split + 1);
      options.mode[counter] = mode;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--replace") {
      options.replace = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (options.input === undefined) {
      options.input = arg;
    }
  }
  return options;
}

function printHelp() {
  console.log([
    "Usage: yomi \"¥300\" [--zero rei|zero] [--mode counter=mode] [--strict] [--replace]",
    "",
    "Examples:",
    "  yomi \"¥300\"",
    "  yomi \"1日\" --mode day=date",
    "  yomi \"今日は第3版を1.2本買った\" --replace",
    "  yomi \"300円\" --strict",
  ].join("\n"));
}

const options = parseArgs(process.argv.slice(2));
if (options.input === undefined) {
  printHelp();
  process.exit(1);
}

const readOptions = {
  strict: options.strict,
  variant: options.zero ? { zero: options.zero } : undefined,
  mode: options.mode,
};

if (options.replace) {
  console.log(yomi.replaceInText(options.input, readOptions));
  process.exit(0);
}

const result = yomi.read(options.input, readOptions);

if (result === null) {
  console.error("Unable to parse");
  process.exit(1);
}

console.log(result);
