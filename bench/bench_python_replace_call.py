#!/usr/bin/env python3
from __future__ import annotations

import json
from pathlib import Path

from bench_python_common import parse_case_bench_args, run_cases_benchmark

from python_impl import replace_in_text


def main() -> None:
    args = parse_case_bench_args(
        description="Python replace call-style benchmark",
        default_cases="test/replace_cases.json",
    )
    result = run_cases_benchmark("python-replace-call", Path(args.cases), args.iterations, replace_in_text)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
