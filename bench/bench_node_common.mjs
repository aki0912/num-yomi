import fs from "node:fs";
import path from "node:path";

export function pathToFileUrl(p) {
  return new URL(`file://${path.resolve(p)}`);
}

export function parseCaseBenchArgs(argv, defaultCasesPath, defaultIterations = 20_000) {
  let casesPath = defaultCasesPath;
  let iterationsRaw = String(defaultIterations);

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cases") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--cases requires a path");
      }
      casesPath = argv[i];
      continue;
    }
    if (arg === "--iterations") {
      i += 1;
      if (i >= argv.length) {
        throw new Error("--iterations requires a number");
      }
      iterationsRaw = argv[i];
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  const iterations = Number(iterationsRaw);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new Error("--iterations must be a positive integer");
  }

  return {
    casesPath: path.resolve(casesPath),
    iterations,
  };
}

export function runCasesBenchmark(implName, casesPath, iterations, runCase) {
  const cases = JSON.parse(fs.readFileSync(casesPath, "utf8"));

  let totalNs = 0n;
  const caseResults = [];

  for (let i = 0; i < cases.length; i += 1) {
    const item = cases[i];
    const actual = runCase(item.in, item.opts);
    if (actual !== item.out) {
      throw new Error(`Case mismatch index=${i} in=${item.in} expected=${item.out} actual=${actual}`);
    }

    const start = process.hrtime.bigint();
    for (let n = 0; n < iterations; n += 1) {
      runCase(item.in, item.opts);
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

  return {
    impl: implName,
    iterations,
    cases: caseResults,
    total_ns: Number(totalNs),
    total_ms: Number(totalNs) / 1_000_000,
  };
}
