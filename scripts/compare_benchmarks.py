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


def print_table(node: Dict[str, Any], py: Dict[str, Any], rust: Dict[str, Any]) -> None:
    node_cases = node["cases"]
    py_cases = py["cases"]
    rust_cases = rust["cases"]

    if not (len(node_cases) == len(py_cases) == len(rust_cases)):
        raise RuntimeError("Case count mismatch across implementations")

    print("Total time (ms)")
    print(f"- node:   {node['total_ms']:.3f}")
    print(f"- python: {py['total_ms']:.3f}")
    print(f"- rust:   {rust['total_ms']:.3f}")
    print()

    header = [
        "#",
        "input",
        "expected",
        "node avg(ns)",
        "python avg(ns)",
        "rust avg(ns)",
        "fastest",
    ]
    print("| " + " | ".join(header) + " |")
    print("|" + "|".join(["---"] * len(header)) + "|")

    for i in range(len(node_cases)):
        n = node_cases[i]
        p = py_cases[i]
        r = rust_cases[i]

        if n["input"] != p["input"] or n["input"] != r["input"]:
            raise RuntimeError(f"Input mismatch at case index {i}")
        if n["expected"] != p["expected"] or n["expected"] != r["expected"]:
            raise RuntimeError(f"Expected mismatch at case index {i}")

        row_times = {
            "node": int(n["avg_ns"]),
            "python": int(p["avg_ns"]),
            "rust": int(r["avg_ns"]),
        }
        fastest = min(row_times, key=row_times.get)

        row = [
            str(i),
            n["input"],
            n["expected"],
            str(row_times["node"]),
            str(row_times["python"]),
            str(row_times["rust"]),
            fastest,
        ]
        print("| " + " | ".join(row) + " |")


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare Node/Python/Rust benchmark results")
    parser.add_argument("--cases", default=str(ROOT_DIR / "test" / "cases.json"))
    parser.add_argument("--iterations", type=int, default=20_000)
    parser.add_argument(
        "--call-style",
        action="store_true",
        help="Use library-call benchmark runners instead of CLI runners",
    )
    parser.add_argument(
        "--replace-style",
        action="store_true",
        help="Use replace-in-text benchmark runners",
    )
    args = parser.parse_args()

    cases_path = str(Path(args.cases).resolve())
    iterations = str(args.iterations)

    if args.replace_style:
        if not args.call_style:
            raise RuntimeError("--replace-style currently requires --call-style")

        node_cmd = [
            "node",
            "bench/bench_node_replace_call.mjs",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]

        py_cmd = [
            sys.executable,
            "bench/bench_python_replace_call.py",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]

        rust_cmd = [
            "cargo",
            "run",
            "--quiet",
            "--release",
            "--manifest-path",
            "rust_impl/Cargo.toml",
            "--bin",
            "bench_replace_call",
            "--",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]
    elif args.call_style:
        node_cmd = [
            "node",
            "bench/bench_node_call.mjs",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]

        py_cmd = [
            sys.executable,
            "bench/bench_python_call.py",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]

        rust_cmd = [
            "cargo",
            "run",
            "--quiet",
            "--release",
            "--manifest-path",
            "rust_impl/Cargo.toml",
            "--bin",
            "bench_call",
            "--",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]
    else:
        node_cmd = [
            "node",
            "bench/bench_node.mjs",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]

        py_cmd = [
            sys.executable,
            "python_impl/num_yomi.py",
            "bench",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]

        rust_cmd = [
            "cargo",
            "run",
            "--quiet",
            "--release",
            "--manifest-path",
            "rust_impl/Cargo.toml",
            "--bin",
            "num-yomi-rust",
            "--",
            "bench",
            "--cases",
            cases_path,
            "--iterations",
            iterations,
        ]

    node = run_command(node_cmd)
    py = run_command(py_cmd)
    rust = run_command(rust_cmd)

    print_table(node, py, rust)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
