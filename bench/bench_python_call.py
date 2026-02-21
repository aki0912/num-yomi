#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from python_impl import read


def run_benchmark(cases_path: Path, iterations: int) -> dict:
    with cases_path.open("r", encoding="utf-8") as f:
        cases = json.load(f)

    case_results = []
    total_ns = 0

    for index, case in enumerate(cases):
        input_text = case["in"]
        expected = case["out"]
        opts = case.get("opts")

        actual = read(input_text, opts)
        if actual != expected:
            raise RuntimeError(
                f"Case mismatch at index {index}: in={input_text} expected={expected} actual={actual}"
            )

        start = time.perf_counter_ns()
        for _ in range(iterations):
            read(input_text, opts)
        elapsed_ns = time.perf_counter_ns() - start

        total_ns += elapsed_ns
        case_results.append(
            {
                "index": index,
                "input": input_text,
                "expected": expected,
                "avg_ns": elapsed_ns // iterations,
                "total_ns": elapsed_ns,
            }
        )

    return {
        "impl": "python-call",
        "iterations": iterations,
        "cases": case_results,
        "total_ns": total_ns,
        "total_ms": round(total_ns / 1_000_000.0, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Python call-style benchmark")
    parser.add_argument("--cases", default="test/cases.json")
    parser.add_argument("--iterations", type=int, default=20_000)
    args = parser.parse_args()

    if args.iterations <= 0:
        raise SystemExit("--iterations must be > 0")

    result = run_benchmark(Path(args.cases), args.iterations)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
