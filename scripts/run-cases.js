#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const casesPath = path.join(repoRoot, "test", "cases.json");
const replaceCasesPath = path.join(repoRoot, "test", "replace_cases.json");
const distIndex = path.join(repoRoot, "dist", "index.js");

const raw = fs.readFileSync(casesPath, "utf8");
const cases = JSON.parse(raw);
const replaceRaw = fs.readFileSync(replaceCasesPath, "utf8");
const replaceCases = JSON.parse(replaceRaw);

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

for (const item of replaceCases) {
  const actual = yomi.replaceInText(item.in, item.opts);
  if (actual !== item.out) {
    fail += 1;
    console.error(`FAIL replace in=${item.in}\n  expected=${item.out}\n  actual=${actual}`);
    continue;
  }
  console.log(`OK replace ${item.in} => ${actual}`);
}

const detailed = yomi.replaceInTextDetailed("今日は第3版を1.2本買った");
if (detailed.output !== "今日はだいさんはんをいってんにほん買った") {
  fail += 1;
  console.error(
    `FAIL replaceDetailed output\n  expected=今日はだいさんはんをいってんにほん買った\n  actual=${detailed.output}`
  );
} else if (
  detailed.replacements.length !== 2
  || detailed.replacements[0]?.source !== "第3版"
  || detailed.replacements[0]?.reading !== "だいさんはん"
  || detailed.replacements[1]?.source !== "1.2本"
  || detailed.replacements[1]?.reading !== "いってんにほん"
) {
  fail += 1;
  console.error(`FAIL replaceDetailed replacements\n  actual=${JSON.stringify(detailed.replacements)}`);
} else {
  console.log("OK replaceDetailed 今日は第3版を1.2本買った");
}

if (fail > 0) {
  console.error(`\n${fail} cases failed.`);
  process.exit(1);
}

console.log(`\n${cases.length + replaceCases.length} cases passed.`);

function pathToFileURL(filePath) {
  const absolute = path.resolve(filePath);
  return new URL(`file://${absolute}`);
}
