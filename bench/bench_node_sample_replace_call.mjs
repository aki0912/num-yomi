#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(args.input ?? path.join(root, "test", "sample.txt"));
const expectedPath = path.resolve(args.expected ?? path.join(root, "test", "sample.expected.txt"));
const iterations = Number(args.iterations ?? 2_000);
const variantCount = Number(args.variantCount ?? Math.min(iterations, 4_096));

if (!Number.isInteger(iterations) || iterations <= 0) {
  throw new Error("--iterations must be a positive integer");
}
if (!Number.isInteger(variantCount) || variantCount <= 0) {
  throw new Error("--variant-count must be a positive integer");
}

const inputText = fs.readFileSync(inputPath, "utf8");
const expectedText = fs.readFileSync(expectedPath, "utf8");
const { replaceInText } = await import(pathToFileUrl(path.join(root, "dist", "index.js")));

const warmup = replaceInText(inputText);
if (warmup !== expectedText) {
  throw new Error("Sample output mismatch for Node implementation");
}

const variantInputs = [];
const variantExpected = [];
for (let i = 0; i < variantCount; i += 1) {
  const tag = toAlphabetTag(i);
  const suffix = `\n__SAMPLE_BENCH_TAG_${tag}__`;
  variantInputs.push(inputText + suffix);
  variantExpected.push(expectedText + suffix);
}

const warmupVariant = replaceInText(variantInputs[0]);
if (warmupVariant !== variantExpected[0]) {
  throw new Error("Sample variant output mismatch for Node implementation");
}

const start = process.hrtime.bigint();
for (let i = 0; i < iterations; i += 1) {
  const idx = i % variantCount;
  const actual = replaceInText(variantInputs[idx]);
  if (actual !== variantExpected[idx]) {
    throw new Error(`Sample variant mismatch at iteration=${i}`);
  }
}
const elapsed = process.hrtime.bigint() - start;

const out = {
  impl: "node-sample-replace-call",
  iterations,
  variant_count: variantCount,
  input_path: path.relative(root, inputPath),
  expected_path: path.relative(root, expectedPath),
  input_bytes: Buffer.byteLength(variantInputs[0], "utf8"),
  avg_ns: Number(elapsed / BigInt(iterations)),
  total_ns: Number(elapsed),
  total_ms: Number(elapsed) / 1_000_000,
};

process.stdout.write(`${JSON.stringify(out)}\n`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") {
      parsed.input = argv[++i];
      continue;
    }
    if (arg === "--expected") {
      parsed.expected = argv[++i];
      continue;
    }
    if (arg === "--iterations") {
      parsed.iterations = argv[++i];
      continue;
    }
    if (arg === "--variant-count") {
      parsed.variantCount = argv[++i];
    }
  }
  return parsed;
}

function pathToFileUrl(p) {
  return new URL(`file://${path.resolve(p)}`);
}

function toAlphabetTag(index) {
  let value = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (value % 26)) + out;
    value = Math.floor(value / 26) - 1;
  } while (value >= 0);
  return out;
}
