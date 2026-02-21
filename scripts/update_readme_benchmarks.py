#!/usr/bin/env python3
from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import pathlib
import re
import statistics
import subprocess
from typing import Sequence

TOTAL_RE = re.compile(r"^-\s*(node|python|rust):\s*([0-9]+(?:\.[0-9]+)?)\s*$", re.MULTILINE)


@dataclasses.dataclass
class StatSummary:
    values: list[float]

    @property
    def min(self) -> float:
        return min(self.values)

    @property
    def max(self) -> float:
        return max(self.values)

    @property
    def avg(self) -> float:
        return statistics.fmean(self.values)


@dataclasses.dataclass
class BenchSummary:
    node: StatSummary
    python: StatSummary
    rust: StatSummary


def run_command(command: Sequence[str]) -> str:
    completed = subprocess.run(command, check=True, capture_output=True, text=True)
    return completed.stdout


def parse_totals(output: str) -> dict[str, float]:
    parsed: dict[str, float] = {}
    for name, value in TOTAL_RE.findall(output):
        parsed[name] = float(value)

    missing = [name for name in ("node", "python", "rust") if name not in parsed]
    if missing:
        raise RuntimeError(f"Could not parse totals for: {', '.join(missing)}")
    return parsed


def collect_benchmark_stats(command: Sequence[str], runs: int) -> BenchSummary:
    by_impl: dict[str, list[float]] = {"node": [], "python": [], "rust": []}
    for i in range(1, runs + 1):
        output = run_command(command)
        totals = parse_totals(output)
        for name, value in totals.items():
            by_impl[name].append(value)
        print(
            f"run{i} node={totals['node']:.3f} python={totals['python']:.3f} rust={totals['rust']:.3f}",
            flush=True,
        )

    return BenchSummary(
        node=StatSummary(by_impl["node"]),
        python=StatSummary(by_impl["python"]),
        rust=StatSummary(by_impl["rust"]),
    )


def format_line(summary: StatSummary) -> str:
    return f"`{summary.min:.3f} - {summary.max:.3f} ms`（平均 `{summary.avg:.3f} ms`）"


def build_section(date_text: str, iterations: int, runs: int, read_stats: BenchSummary, replace_stats: BenchSummary) -> list[str]:
    return [
        f"直近計測結果（{date_text}, `--iterations {iterations}`, {runs}回計測レンジ）:",
        "",
        "- `pnpm bench:compare`（call-style）",
        f"  - Node: {format_line(read_stats.node)}",
        f"  - Python: {format_line(read_stats.python)}",
        f"  - Rust: {format_line(read_stats.rust)}",
        "- `pnpm bench:compare:replace`",
        f"  - Node: {format_line(replace_stats.node)}",
        f"  - Python: {format_line(replace_stats.python)}",
        f"  - Rust: {format_line(replace_stats.rust)}",
        "",
    ]


def update_readme(readme_path: pathlib.Path, section_lines: list[str]) -> None:
    original_lines = readme_path.read_text(encoding="utf-8").splitlines()
    start = next((i for i, line in enumerate(original_lines) if line.startswith("直近計測結果（")), None)
    if start is None:
        raise RuntimeError("README section start not found")

    end = next((i for i, line in enumerate(original_lines[start + 1 :], start + 1) if line.startswith("注: ベンチ結果")), None)
    if end is None:
        raise RuntimeError("README section end marker not found")

    updated = original_lines[:start] + section_lines + original_lines[end:]
    readme_path.write_text("\n".join(updated) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run benchmark comparisons repeatedly and update README results section")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--iterations", type=int, default=20_000)
    parser.add_argument("--readme", default="README.md")
    parser.add_argument("--date", default=None, help="Date text for README (default: today, YYYY-MM-DD)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.runs <= 0:
        raise SystemExit("--runs must be > 0")
    if args.iterations <= 0:
        raise SystemExit("--iterations must be > 0")

    date_text = args.date or dt.date.today().isoformat()
    readme_path = pathlib.Path(args.readme)

    read_command = [
        "python3",
        "scripts/compare_benchmarks.py",
        "--call-style",
        "--cases",
        "test/cases.json",
        "--iterations",
        str(args.iterations),
    ]
    replace_command = [
        "python3",
        "scripts/compare_benchmarks.py",
        "--call-style",
        "--replace-style",
        "--cases",
        "test/replace_cases.json",
        "--iterations",
        str(args.iterations),
    ]

    print("Collecting pnpm bench:compare", flush=True)
    read_stats = collect_benchmark_stats(read_command, args.runs)

    print("Collecting pnpm bench:compare:replace", flush=True)
    replace_stats = collect_benchmark_stats(replace_command, args.runs)

    section_lines = build_section(date_text, args.iterations, args.runs, read_stats, replace_stats)
    update_readme(readme_path, section_lines)
    print(f"Updated {readme_path}")


if __name__ == "__main__":
    main()
