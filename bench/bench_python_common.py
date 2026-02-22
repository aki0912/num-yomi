#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, Optional

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


def parse_case_bench_args(
    description: str,
    default_cases: str,
    default_iterations: int = 20_000,
) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--cases", default=default_cases)
    parser.add_argument("--iterations", type=int, default=default_iterations)
    args = parser.parse_args()
    if args.iterations <= 0:
        raise SystemExit("--iterations must be > 0")
    return args


def run_cases_benchmark(
    impl_name: str,
    cases_path: Path,
    iterations: int,
    run_case: Callable[[str, Optional[Dict[str, Any]]], Optional[str]],
) -> Dict[str, Any]:
    with cases_path.open("r", encoding="utf-8") as f:
        cases = json.load(f)

    case_results = []
    total_ns = 0

    for index, case in enumerate(cases):
        input_text = case["in"]
        expected = case["out"]
        opts = case.get("opts")

        actual = run_case(input_text, opts)
        if actual != expected:
            raise RuntimeError(
                f"Case mismatch at index {index}: in={input_text} expected={expected} actual={actual}"
            )

        start = time.perf_counter_ns()
        for _ in range(iterations):
            run_case(input_text, opts)
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
        "impl": impl_name,
        "iterations": iterations,
        "cases": case_results,
        "total_ns": total_ns,
        "total_ms": round(total_ns / 1_000_000.0, 3),
    }
