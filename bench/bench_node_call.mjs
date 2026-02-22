#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCaseBenchArgs, pathToFileUrl, runCasesBenchmark } from "./bench_node_common.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = parseCaseBenchArgs(process.argv.slice(2), path.join(root, "test", "cases.json"));

const { read } = await import(pathToFileUrl(path.join(root, "dist", "index.js")));
const out = runCasesBenchmark("node-call", args.casesPath, args.iterations, (input, options) => read(input, options));
process.stdout.write(`${JSON.stringify(out)}\n`);
