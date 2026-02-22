#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List

ROOT_DIR = Path(__file__).resolve().parents[1]


def run_command(cmd: List[str]) -> Dict[str, Any]:
    completed = subprocess.run(cmd, cwd=ROOT_DIR, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(
            "Command failed:\n"
            f"  {' '.join(cmd)}\n"
            f"stderr:\n{completed.stderr}\n"
            f"stdout:\n{completed.stdout}"
        )

    stdout = completed.stdout.strip()
    if not stdout:
        raise RuntimeError(f"No output from command: {' '.join(cmd)}")

    try:
        return json.loads(stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(
            f"Failed to parse JSON output from {' '.join(cmd)}\nstdout:\n{stdout}"
        ) from exc


def throughput_mb_s(input_bytes: int, total_ms: float, iterations: int) -> float:
    if total_ms <= 0:
        return float("inf")
    total_mb = (input_bytes * iterations) / 1_000_000.0
    return total_mb / (total_ms / 1_000.0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare sample.txt replace benchmark across Node/Python/Rust")
    parser.add_argument("--input", default=str(ROOT_DIR / "test" / "sample.txt"))
    parser.add_argument("--expected", default=str(ROOT_DIR / "test" / "sample.expected.txt"))
    parser.add_argument("--iterations", type=int, default=2_000)
    parser.add_argument("--variant-count", type=int, default=None)
    args = parser.parse_args()

    if args.iterations <= 0:
        raise SystemExit("--iterations must be > 0")
    variant_count = args.variant_count if args.variant_count is not None else min(args.iterations, 4_096)
    if variant_count <= 0:
        raise SystemExit("--variant-count must be > 0")

    input_path = str(Path(args.input).resolve())
    expected_path = str(Path(args.expected).resolve())
    iterations = str(args.iterations)
    variant_count_text = str(variant_count)

    node_cmd = [
        "node",
        "bench/bench_node_sample_replace_call.mjs",
        "--input",
        input_path,
        "--expected",
        expected_path,
        "--iterations",
        iterations,
        "--variant-count",
        variant_count_text,
    ]
    py_cmd = [
        sys.executable,
        "bench/bench_python_sample_replace_call.py",
        "--input",
        input_path,
        "--expected",
        expected_path,
        "--iterations",
        iterations,
        "--variant-count",
        variant_count_text,
    ]
    rust_cmd = [
        "cargo",
        "run",
        "--quiet",
        "--release",
        "--manifest-path",
        "rust_impl/Cargo.toml",
        "--bin",
        "bench_sample_replace_call",
        "--",
        "--input",
        input_path,
        "--expected",
        expected_path,
        "--iterations",
        iterations,
        "--variant-count",
        variant_count_text,
    ]

    node = run_command(node_cmd)
    py = run_command(py_cmd)
    rust = run_command(rust_cmd)

    input_bytes = int(node["input_bytes"])
    if int(py["input_bytes"]) != input_bytes or int(rust["input_bytes"]) != input_bytes:
        raise RuntimeError("input_bytes mismatch across implementations")

    print("Sample replace benchmark")
    print(f"- input: {input_path} ({input_bytes} bytes)")
    print(f"- expected: {expected_path}")
    print(f"- iterations: {args.iterations}")
    print(f"- variant_count: {variant_count}")
    print()

    print("Total time (ms)")
    print(f"- node:   {float(node['total_ms']):.3f}")
    print(f"- python: {float(py['total_ms']):.3f}")
    print(f"- rust:   {float(rust['total_ms']):.3f}")
    print()

    print("Avg per run (us)")
    print(f"- node:   {int(node['avg_ns']) / 1000.0:.3f}")
    print(f"- python: {int(py['avg_ns']) / 1000.0:.3f}")
    print(f"- rust:   {int(rust['avg_ns']) / 1000.0:.3f}")
    print()

    print("Throughput (MB/s)")
    print(f"- node:   {throughput_mb_s(input_bytes, float(node['total_ms']), args.iterations):.3f}")
    print(f"- python: {throughput_mb_s(input_bytes, float(py['total_ms']), args.iterations):.3f}")
    print(f"- rust:   {throughput_mb_s(input_bytes, float(rust['total_ms']), args.iterations):.3f}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
