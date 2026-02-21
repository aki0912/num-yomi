#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const casesPath = path.join(repoRoot, "test", "cases.json");
const distIndex = path.join(repoRoot, "dist", "index.js");

const raw = fs.readFileSync(casesPath, "utf8");
const cases = JSON.parse(raw);

const yomi = (await import(pathToFileURL(distIndex))).default;

let fail = 0;
for (const item of cases) {
  const actual = yomi.read(item.in, item.opts);
  if (actual !== item.out) {
    fail += 1;
    console.error(`FAIL in=${item.in}\n  expected=${item.out}\n  actual=${actual}`);
  continue;
  }
  console.log(`OK ${item.in} => ${actual}`);
}

if (fail > 0) {
  console.error(`\n${fail} cases failed.`);
  process.exit(1);
}

console.log(`\n${cases.length} cases passed.`);

function pathToFileURL(filePath) {
  const absolute = path.resolve(filePath);
  return new URL(`file://${absolute}`);
}
