#!/usr/bin/env node
import yomi from "../index.js";
import { applyCommonReadOptionArg, buildReadOptions } from "./shared.js";

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
  const fail = (message: string): never => {
    console.error(message);
    process.exit(1);
  };
  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;
    if (arg === "--replace") {
      options.replace = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (applyCommonReadOptionArg(arg, args, options, fail)) {
      continue;
    }
    if (options.input === undefined) {
      options.input = arg;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log([
    "Usage: num-yomi \"¥300\" [--zero rei|zero] [--mode counter=mode] [--strict] [--replace]",
    "",
    "Examples:",
    "  num-yomi \"¥300\"",
    "  num-yomi \"1日\" --mode day=date",
    "  num-yomi \"今日は第3版を1.2本買った\" --replace",
    "  num-yomi \"300円\" --strict",
  ].join("\n"));
}

const options = parseArgs(process.argv.slice(2));
if (options.input === undefined) {
  printHelp();
  process.exit(1);
}

const readOptions = buildReadOptions(options);

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
