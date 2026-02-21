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

from python_impl import replace_in_text


def to_alphabet_tag(index: int) -> str:
    value = index
    out = ""
    while True:
        out = chr(65 + (value % 26)) + out
        value = (value // 26) - 1
        if value < 0:
            return out


def run_benchmark(input_path: Path, expected_path: Path, iterations: int, variant_count: int) -> dict:
    input_text = input_path.read_text(encoding="utf-8")
    expected_text = expected_path.read_text(encoding="utf-8")

    warmup = replace_in_text(input_text)
    if warmup != expected_text:
        raise RuntimeError("Sample output mismatch for Python implementation")

    variant_inputs = []
    variant_expected = []
    for i in range(variant_count):
        suffix = f"\n__SAMPLE_BENCH_TAG_{to_alphabet_tag(i)}__"
        variant_inputs.append(input_text + suffix)
        variant_expected.append(expected_text + suffix)

    warmup_variant = replace_in_text(variant_inputs[0])
    if warmup_variant != variant_expected[0]:
        raise RuntimeError("Sample variant output mismatch for Python implementation")

    start = time.perf_counter_ns()
    for i in range(iterations):
        idx = i % variant_count
        actual = replace_in_text(variant_inputs[idx])
        if actual != variant_expected[idx]:
            raise RuntimeError(f"Sample variant mismatch at iteration={i}")
    elapsed_ns = time.perf_counter_ns() - start

    return {
        "impl": "python-sample-replace-call",
        "iterations": iterations,
        "variant_count": variant_count,
        "input_path": str(input_path),
        "expected_path": str(expected_path),
        "input_bytes": len(variant_inputs[0].encode("utf-8")),
        "avg_ns": elapsed_ns // iterations,
        "total_ns": elapsed_ns,
        "total_ms": elapsed_ns / 1_000_000.0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Python sample text replace benchmark")
    parser.add_argument("--input", default="test/sample.txt")
    parser.add_argument("--expected", default="test/sample.expected.txt")
    parser.add_argument("--iterations", type=int, default=2_000)
    parser.add_argument("--variant-count", type=int, default=None)
    args = parser.parse_args()

    if args.iterations <= 0:
        raise SystemExit("--iterations must be > 0")
    variant_count = args.variant_count if args.variant_count is not None else min(args.iterations, 4_096)
    if variant_count <= 0:
        raise SystemExit("--variant-count must be > 0")

    result = run_benchmark(Path(args.input), Path(args.expected), args.iterations, variant_count)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
