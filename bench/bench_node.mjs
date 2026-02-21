#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const args = parseArgs(process.argv.slice(2));
const casesPath = path.resolve(args.cases ?? path.join(root, "test", "cases.json"));
const iterations = Number(args.iterations ?? 20_000);

if (!Number.isInteger(iterations) || iterations <= 0) {
  throw new Error("--iterations must be a positive integer");
}

const yomi = (await import(pathToFileUrl(path.join(root, "dist", "index.js")))).default;
const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));

let totalNs = 0n;
const caseResults = [];

for (let i = 0; i < cases.length; i += 1) {
  const item = cases[i];
  const actual = yomi.read(item.in, item.opts);
  if (actual !== item.out) {
    throw new Error(`Case mismatch index=${i} in=${item.in} expected=${item.out} actual=${actual}`);
  }

  const start = process.hrtime.bigint();
  for (let n = 0; n < iterations; n += 1) {
    yomi.read(item.in, item.opts);
  }
  const elapsed = process.hrtime.bigint() - start;
  totalNs += elapsed;

  caseResults.push({
    index: i,
    input: item.in,
    expected: item.out,
    avg_ns: Number(elapsed / BigInt(iterations)),
    total_ns: Number(elapsed),
  });
}

const out = {
  impl: "node",
  iterations,
  cases: caseResults,
  total_ns: Number(totalNs),
  total_ms: Number(totalNs) / 1_000_000,
};

process.stdout.write(`${JSON.stringify(out)}\n`);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cases") {
      parsed.cases = argv[++i];
      continue;
    }
    if (arg === "--iterations") {
      parsed.iterations = argv[++i];
      continue;
    }
  }
  return parsed;
}

function pathToFileUrl(p) {
  return new URL(`file://${path.resolve(p)}`);
}
