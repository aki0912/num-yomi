#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import type { ReadOptions, ReplaceSegment } from "../rules/types.js";
import yomi from "../index.js";

interface CliOptions {
  inputPath?: string;
  outPath?: string;
  zero?: "rei" | "zero";
  strict: boolean;
  mode: Record<string, string>;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    strict: false,
    mode: {},
    json: false,
  };
  const args = [...argv];

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) {
      break;
    }
    if (arg === "--out") {
      const value = args.shift();
      if (!value) {
        console.error("--out requires a file path");
        process.exit(1);
      }
      options.outPath = value;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
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
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (!options.inputPath) {
      options.inputPath = arg;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }

  return options;
}

function printHelp(): void {
  console.log([
    "Usage: yomi-file <input.txt> [--out converted.txt] [--json] [--zero rei|zero] [--mode counter=mode] [--strict]",
    "",
    "Description:",
    "  Reads a UTF-8 text file and prints only converted segments.",
    "  Use --out to save the fully converted text.",
    "",
    "Examples:",
    "  yomi-file sample.txt",
    "  yomi-file sample.txt --out sample.converted.txt",
    "  yomi-file sample.txt --mode day=date --json",
  ].join("\n"));
}

function buildLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

function toLineCol(lineStarts: number[], index: number): { line: number; col: number } {
  let left = 0;
  let right = lineStarts.length - 1;
  let best = 0;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    if (lineStarts[mid] <= index) {
      best = mid;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }

  return {
    line: best + 1,
    col: index - lineStarts[best] + 1,
  };
}

function formatLocation(lineStarts: number[], segment: ReplaceSegment): string {
  const start = toLineCol(lineStarts, segment.start);
  const end = toLineCol(lineStarts, Math.max(segment.start, segment.end - 1));
  if (start.line === end.line) {
    return `L${start.line}:C${start.col}-C${end.col}`;
  }
  return `L${start.line}:C${start.col}-L${end.line}:C${end.col}`;
}

const options = parseArgs(process.argv.slice(2));
if (!options.inputPath) {
  printHelp();
  process.exit(1);
}

const inputAbs = path.resolve(process.cwd(), options.inputPath);
const outputAbs = options.outPath ? path.resolve(process.cwd(), options.outPath) : undefined;

let inputText = "";
try {
  inputText = fs.readFileSync(inputAbs, "utf8");
} catch (error) {
  console.error(`Failed to read file: ${inputAbs}`);
  console.error(String(error));
  process.exit(1);
}

const readOptions: ReadOptions = {
  strict: options.strict,
  variant: options.zero ? { zero: options.zero } : undefined,
  mode: options.mode,
};

const result = yomi.replaceInTextDetailed(inputText, readOptions);

if (outputAbs) {
  fs.writeFileSync(outputAbs, result.output, "utf8");
}

const lineStarts = buildLineStarts(inputText);

if (options.json) {
  const payload = {
    inputPath: inputAbs,
    outputPath: outputAbs,
    replacementCount: result.replacements.length,
    replacements: result.replacements.map((segment, index) => ({
      index,
      location: formatLocation(lineStarts, segment),
      source: segment.source,
      reading: segment.reading,
    })),
  };
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

if (result.replacements.length === 0) {
  console.log("変換箇所はありませんでした。");
  if (outputAbs) {
    console.log(`出力ファイル: ${outputAbs}`);
  }
  process.exit(0);
}

for (let i = 0; i < result.replacements.length; i += 1) {
  const segment = result.replacements[i];
  console.log(`${i + 1}. ${formatLocation(lineStarts, segment)} "${segment.source}" -> "${segment.reading}"`);
}

if (outputAbs) {
  console.log(`出力ファイル: ${outputAbs}`);
}
