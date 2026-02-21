#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
import unicodedata
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT_DIR = Path(__file__).resolve().parents[1]
RULE_DIR = ROOT_DIR / "rules" / "ja"

KANJI_INT_CHARS = set("零〇一二三四五六七八九十百千万億兆京")

KA_NUMBERS: Dict[str, int] = {
    "零": 0,
    "〇": 0,
    "一": 1,
    "二": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
}

SMALL_UNITS: Dict[str, int] = {
    "十": 10,
    "百": 100,
    "千": 1000,
}

BIG_UNITS: Dict[str, int] = {
    "万": 10_000,
    "億": 100_000_000,
    "兆": 1_000_000_000_000,
    "京": 10_000_000_000_000_000,
}

DECIMAL_POINT_TOKEN = "てん"
COUNTER_PREFIXES: List[Tuple[str, List[str]]] = [("第", ["だい"])]
COUNTER_POSTFIXES: List[Tuple[str, List[str]]] = [("目", ["め"]), ("め", ["め"])]

__all__ = [
    "YomiJaPy",
    "create_yomi",
    "get_default_yomi",
    "load_rules",
    "read",
    "read_detailed",
    "read_number",
    "run_benchmark",
]


def normalize_input(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return normalized.replace(",", "").replace("￥", "¥").strip()


def load_rules(rule_dir: Path = RULE_DIR) -> Dict[str, Any]:
    with (rule_dir / "core.json").open("r", encoding="utf-8") as f:
        core = json.load(f)
    with (rule_dir / "patterns.json").open("r", encoding="utf-8") as f:
        patterns = json.load(f)
    with (rule_dir / "counters.json").open("r", encoding="utf-8") as f:
        counters = json.load(f)
    return {
        "core": core,
        "patterns": patterns,
        "counters": counters,
    }


def build_counter_index(counter_defs: Dict[str, Any]) -> Tuple[Dict[str, List[Tuple[str, str]]], Dict[str, List[Tuple[str, str]]]]:
    prefixes_by_head: Dict[str, List[Tuple[str, str]]] = {}
    suffixes_by_tail: Dict[str, List[Tuple[str, str]]] = {}

    for counter_id, counter in counter_defs.items():
        surface = counter.get("surface", {})
        for marker in surface.get("prefix", []):
            if not marker:
                continue
            head = marker[0]
            prefixes_by_head.setdefault(head, []).append((counter_id, marker))
        for marker in surface.get("suffix", []):
            if not marker:
                continue
            tail = marker[-1]
            suffixes_by_tail.setdefault(tail, []).append((counter_id, marker))

    for entries in prefixes_by_head.values():
        entries.sort(key=lambda item: len(item[1]), reverse=True)
    for entries in suffixes_by_tail.values():
        entries.sort(key=lambda item: len(item[1]), reverse=True)

    return prefixes_by_head, suffixes_by_tail


def detect_counter(
    input_text: str,
    prefixes_by_head: Dict[str, List[Tuple[str, str]]],
    suffixes_by_tail: Dict[str, List[Tuple[str, str]]],
) -> Optional[Dict[str, str]]:
    if not input_text:
        return None

    prefix_candidates = prefixes_by_head.get(input_text[0], [])
    for counter_id, marker in prefix_candidates:
        if not input_text.startswith(marker):
            continue
        return {
            "counterId": counter_id,
            "mode": "prefix",
            "surface": marker,
            "numberPart": input_text[len(marker):],
        }

    suffix_candidates = suffixes_by_tail.get(input_text[-1], [])
    for counter_id, marker in suffix_candidates:
        if not input_text.endswith(marker):
            continue
        return {
            "counterId": counter_id,
            "mode": "suffix",
            "surface": marker,
            "numberPart": input_text[: len(input_text) - len(marker)],
        }

    return None


def detect_counter_postfix(input_text: str) -> Optional[Tuple[str, List[str]]]:
    best: Optional[Tuple[str, List[str]]] = None
    for marker, reading in COUNTER_POSTFIXES:
        if not input_text.endswith(marker):
            continue
        if best is None or len(marker) > len(best[0]):
            best = (marker, reading)
    return best


def detect_counter_prefix(input_text: str) -> Optional[Tuple[str, List[str]]]:
    best: Optional[Tuple[str, List[str]]] = None
    for marker, reading in COUNTER_PREFIXES:
        if not input_text.startswith(marker):
            continue
        if best is None or len(marker) > len(best[0]):
            best = (marker, reading)
    return best


def has_parsable_number_text(input_text: str) -> bool:
    return parse_decimal(input_text) is not None or parse_number(input_text) is not None


def detect_counter_with_parsable_number(
    input_text: str,
    prefixes_by_head: Dict[str, List[Tuple[str, str]]],
    suffixes_by_tail: Dict[str, List[Tuple[str, str]]],
) -> Optional[Dict[str, str]]:
    detected = detect_counter(input_text, prefixes_by_head, suffixes_by_tail)
    if detected is None:
        return None
    if not has_parsable_number_text(detected["numberPart"]):
        return None
    return detected


def parse_kansuji(input_text: str) -> Optional[int]:
    if not is_kansuji_int(input_text):
        return None

    remaining = input_text
    sign = 1
    if remaining.startswith(("+", "-")):
        if remaining.startswith("-"):
            sign = -1
        remaining = remaining[1:]
        if remaining == "":
            return None

    total = 0
    chunk = 0
    digit_buffer: Optional[int] = None

    def flush_digit_buffer() -> None:
        nonlocal chunk, digit_buffer
        if digit_buffer is not None:
            chunk += digit_buffer
            digit_buffer = None

    for ch in remaining:
        if ch in KA_NUMBERS:
            digit = KA_NUMBERS[ch]
            if digit_buffer is None:
                digit_buffer = digit
            else:
                digit_buffer = digit_buffer * 10 + digit
            continue

        if ch in SMALL_UNITS:
            unit = SMALL_UNITS[ch]
            num = 1 if digit_buffer is None else digit_buffer
            chunk += num * unit
            digit_buffer = None
            continue

        if ch in BIG_UNITS:
            unit = BIG_UNITS[ch]
            flush_digit_buffer()
            total += chunk * unit
            chunk = 0
            continue

        return None

    flush_digit_buffer()
    return sign * (total + chunk)


def parse_number(input_text: str) -> Optional[int]:
    if is_arabic_int(input_text):
        return int(input_text)
    scaled = parse_scaled_arabic(input_text)
    if scaled is not None:
        return scaled
    return parse_kansuji(input_text)


def parse_scaled_arabic(input_text: str) -> Optional[int]:
    if len(input_text) < 2:
        return None

    unit_char = input_text[-1]
    unit = BIG_UNITS.get(unit_char)
    if unit is None:
        return None

    number_text = input_text[:-1]
    if not is_arabic_int(number_text):
        return None

    return int(number_text) * unit


def parse_decimal(input_text: str) -> Optional[Dict[str, Any]]:
    if not input_text:
        return None

    sign = 1
    start = 0
    if input_text[0] in ("+", "-"):
        if len(input_text) == 1:
            return None
        if input_text[0] == "-":
            sign = -1
        start = 1

    dot_pos = input_text.find(".", start)
    if dot_pos < 0:
        return None
    if input_text.find(".", dot_pos + 1) >= 0:
        return None

    int_part = input_text[start:dot_pos]
    frac_part = input_text[dot_pos + 1 :]
    if not int_part or not frac_part:
        return None
    if not int_part.isdigit() or not frac_part.isdigit():
        return None

    return {
        "sign": sign,
        "integerPart": int(int_part),
        "fractionDigits": [ord(ch) - 48 for ch in frac_part],
        "normalized": f"{'-' if sign < 0 else ''}{int_part}.{frac_part}",
    }


def is_arabic_int(input_text: str) -> bool:
    if not input_text:
        return False
    if input_text[0] in ("+", "-"):
        return len(input_text) > 1 and input_text[1:].isdigit()
    return input_text.isdigit()


def is_kansuji_int(input_text: str) -> bool:
    if not input_text:
        return False
    start = 0
    if input_text[0] in ("+", "-"):
        if len(input_text) == 1:
            return False
        start = 1
    for ch in input_text[start:]:
        if ch not in KANJI_INT_CHARS:
            return False
    return True


def resolve_variant(options: Optional[Dict[str, Any]], key: str, default_value: str) -> str:
    if not options:
        return default_value
    variant = options.get("variant")
    if not isinstance(variant, dict):
        return default_value
    value = variant.get(key)
    if isinstance(value, str):
        return value
    return default_value


def read_digit_tokens(digit: int, core: Dict[str, Any], options: Optional[Dict[str, Any]]) -> List[str]:
    if digit == 4:
        key = resolve_variant(options, "four", core["defaultVariant"]["four"])
        return [core["variants"]["four"]["shi" if key == "shi" else "yon"]]
    if digit == 7:
        key = resolve_variant(options, "seven", core["defaultVariant"]["seven"])
        return [core["variants"]["seven"]["shichi" if key == "shichi" else "nana"]]
    if digit == 9:
        key = resolve_variant(options, "nine", core["defaultVariant"]["nine"])
        return [core["variants"]["nine"]["ku" if key == "ku" else "kyu"]]
    return core["digits"][str(digit)]


def read_0_to_9999_tokens(value: int, core: Dict[str, Any], options: Optional[Dict[str, Any]]) -> List[str]:
    out: List[str] = []
    remaining = value

    if remaining >= 1000:
        digit = remaining // 1000
        remaining %= 1000
        if digit == 1:
            out.extend(core["smallUnits"]["1000"])
        elif str(digit) in core["specialThousands"]:
            out.extend(core["specialThousands"][str(digit)])
        else:
            out.extend(read_digit_tokens(digit, core, options))
            out.extend(core["smallUnits"]["1000"])

    if remaining >= 100:
        digit = remaining // 100
        remaining %= 100
        if digit == 1:
            out.extend(core["smallUnits"]["100"])
        elif str(digit) in core["specialHundreds"]:
            out.extend(core["specialHundreds"][str(digit)])
        else:
            out.extend(read_digit_tokens(digit, core, options))
            out.extend(core["smallUnits"]["100"])

    if remaining >= 10:
        digit = remaining // 10
        remaining %= 10
        if digit == 1:
            out.extend(core["smallUnits"]["10"])
        else:
            out.extend(read_digit_tokens(digit, core, options))
            out.extend(core["smallUnits"]["10"])

    if remaining > 0:
        out.extend(read_digit_tokens(remaining, core, options))

    return out


def read_number_tokens(
    value: int,
    core: Dict[str, Any],
    options: Optional[Dict[str, Any]],
    unit_by_pow10: Dict[int, List[str]],
) -> List[str]:
    if value == 0:
        zero_key = resolve_variant(options, "zero", core["defaultVariant"]["zero"])
        return [core["variants"]["zero"][zero_key]]

    abs_value = abs(value)
    chunks: List[List[str]] = []
    remaining = abs_value
    pow10 = 0
    while remaining > 0:
        chunk = remaining % 10000
        if chunk != 0:
            tokens = read_0_to_9999_tokens(chunk, core, options)
            tokens.extend(unit_by_pow10.get(pow10, []))
            chunks.append(tokens)
        remaining //= 10000
        pow10 += 4

    merged: List[str] = []
    for chunk_tokens in reversed(chunks):
        merged.extend(chunk_tokens)

    if value < 0:
        return list(core["minus"]) + merged
    return merged


def read_fraction_digit_token(digit: int, core: Dict[str, Any], options: Optional[Dict[str, Any]]) -> str:
    if digit == 0:
        zero_key = resolve_variant(options, "zero", core["defaultVariant"]["zero"])
        return core["variants"]["zero"][zero_key]
    return read_digit_tokens(digit, core, options)[0]


def read_decimal_tokens(
    sign: int,
    integer_part: int,
    fraction_digits: List[int],
    core: Dict[str, Any],
    options: Optional[Dict[str, Any]],
    unit_by_pow10: Dict[int, List[str]],
) -> List[str]:
    integer_tokens = read_number_tokens(integer_part, core, options, unit_by_pow10)
    prefix = (list(core["minus"]) + integer_tokens) if sign < 0 else integer_tokens
    out = list(prefix)
    out.append(DECIMAL_POINT_TOKEN)
    out.extend(read_fraction_digit_token(digit, core, options) for digit in fraction_digits)
    return out


def apply_tail_pattern(pattern: Dict[str, Any], tokens: List[str]) -> Tuple[List[str], str]:
    if not tokens:
        return tokens, pattern["defaultForm"]

    tail = tokens[-1]
    for rule in pattern["rules"]:
        when_tail_in = rule.get("whenTailIn", [])
        if tail not in when_tail_in:
            continue

        rewrite_tail = rule.get("rewriteTail", {})
        if tail in rewrite_tail:
            next_tokens = list(tokens)
            next_tokens[-1] = rewrite_tail[tail]
            return next_tokens, rule.get("useForm", pattern["defaultForm"])
        return tokens, rule.get("useForm", pattern["defaultForm"])

    return tokens, pattern["defaultForm"]


def apply_compose(
    compose: Dict[str, Any],
    number_value: int,
    number_tokens: List[str],
    pattern_defs: Dict[str, Any],
) -> List[str]:
    compose_type = compose.get("type")

    if compose_type == "concat":
        return list(number_tokens) + list(compose.get("suffixReading", []))

    if compose_type == "exceptions_first":
        key = str(abs(number_value))
        exceptions = compose.get("exceptions", {})
        if key in exceptions:
            return exceptions[key]
        fallback = compose.get("fallback")
        if isinstance(fallback, dict):
            return apply_compose(fallback, number_value, number_tokens, pattern_defs)
        return list(number_tokens)

    if compose_type == "pattern":
        pattern_id = compose.get("patternId")
        pattern = pattern_defs.get(pattern_id)
        if not isinstance(pattern, dict):
            return list(number_tokens)
        rewritten_tokens, form = apply_tail_pattern(pattern, number_tokens)
        forms = compose.get("forms", {})
        suffix = forms.get(form)
        if not isinstance(suffix, list):
            return list(number_tokens)
        return rewritten_tokens + list(suffix)

    return list(number_tokens)


def apply_counter(
    counter_defs: Dict[str, Any],
    pattern_defs: Dict[str, Any],
    counter_id: str,
    number_value: int,
    number_tokens: List[str],
    options: Optional[Dict[str, Any]],
) -> Tuple[List[str], Optional[str]]:
    compose, mode_name = resolve_counter_compose(counter_defs, counter_id, options)
    if not isinstance(compose, dict):
        return number_tokens, mode_name

    return apply_compose(compose, number_value, number_tokens, pattern_defs), mode_name


def resolve_counter_compose(
    counter_defs: Dict[str, Any],
    counter_id: str,
    options: Optional[Dict[str, Any]],
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    counter = counter_defs.get(counter_id)
    if not isinstance(counter, dict):
        return None, None

    mode_overrides = options.get("mode") if isinstance(options, dict) else None
    requested_mode: Optional[str] = None
    if isinstance(mode_overrides, dict):
        raw_mode = mode_overrides.get(counter_id)
        if isinstance(raw_mode, str):
            requested_mode = raw_mode

    mode_name = None
    modes = counter.get("modes") if isinstance(counter.get("modes"), dict) else {}
    if requested_mode and requested_mode in modes:
        mode_name = requested_mode
    elif isinstance(counter.get("defaultMode"), str):
        mode_name = counter["defaultMode"]

    mode_compose = None
    if mode_name is not None and mode_name in modes:
        mode_config = modes[mode_name]
        if isinstance(mode_config, dict):
            mode_compose = mode_config.get("compose")

    compose = mode_compose if isinstance(mode_compose, dict) else counter.get("compose")
    if not isinstance(compose, dict):
        return None, mode_name
    return compose, mode_name


class YomiJaPy:
    def __init__(self, rules: Optional[Dict[str, Any]] = None) -> None:
        self.rules = rules if rules is not None else load_rules()
        self.core = self.rules["core"]
        self.pattern_defs = self.rules["patterns"]["patterns"]
        self.counter_defs = self.rules["counters"]["counters"]
        self.prefixes_by_head, self.suffixes_by_tail = build_counter_index(self.counter_defs)
        self.unit_by_pow10 = {int(entry["pow10"]): entry["reading"] for entry in self.core["bigUnits"]}

    def read(self, input_text: str, options: Optional[Dict[str, Any]] = None) -> Optional[str]:
        result = self.read_detailed(input_text, options)
        return None if result is None else result["reading"]

    def read_number(self, value: int, options: Optional[Dict[str, Any]] = None) -> str:
        tokens = read_number_tokens(value, self.core, options, self.unit_by_pow10)
        return "".join(tokens)

    def read_detailed(self, input_text: str, options: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        normalized = normalize_input(input_text)
        prefix = None
        postfix = None
        counter_input = normalized
        detected = detect_counter_with_parsable_number(normalized, self.prefixes_by_head, self.suffixes_by_tail)
        if detected is None:
            prefix = detect_counter_prefix(normalized)
            if prefix:
                counter_input = normalized[len(prefix[0]):]
                detected = detect_counter_with_parsable_number(
                    counter_input, self.prefixes_by_head, self.suffixes_by_tail
                )
        if detected is None:
            postfix = detect_counter_postfix(counter_input)
            if postfix:
                counter_input = counter_input[: len(counter_input) - len(postfix[0])]
                detected = detect_counter_with_parsable_number(
                    counter_input, self.prefixes_by_head, self.suffixes_by_tail
                )
        number_text = detected["numberPart"] if detected else counter_input
        strict = bool(options.get("strict")) if isinstance(options, dict) else False

        decimal = parse_decimal(number_text)
        if decimal is not None:
            base_tokens = read_decimal_tokens(
                decimal["sign"],
                decimal["integerPart"],
                decimal["fractionDigits"],
                self.core,
                options,
                self.unit_by_pow10,
            )

            if detected:
                compose, mode_used = resolve_counter_compose(self.counter_defs, detected["counterId"], options)
                counter_id = detected["counterId"]
                if isinstance(compose, dict):
                    if compose.get("type") != "concat":
                        if strict:
                            raise ValueError(
                                f"Decimal values with counter '{counter_id}' are only supported for concat compose"
                            )
                        return None
                    tokens = list(base_tokens) + list(compose.get("suffixReading", []))
                else:
                    tokens = base_tokens
            else:
                tokens = base_tokens
                mode_used = None
                counter_id = None

            if postfix:
                tokens = list(tokens) + list(postfix[1])
            if prefix:
                tokens = list(prefix[1]) + list(tokens)

            return {
                "input": input_text,
                "normalized": normalized,
                "number": decimal["normalized"],
                "counterId": counter_id,
                "modeUsed": mode_used,
                "tokens": tokens,
                "reading": "".join(tokens),
            }

        number_value = parse_number(number_text)
        if number_value is None:
            if strict:
                raise ValueError(f"Unable to parse number from input: {input_text}")
            return None

        base_tokens = read_number_tokens(number_value, self.core, options, self.unit_by_pow10)

        if detected:
            tokens, mode_used = apply_counter(
                self.counter_defs,
                self.pattern_defs,
                detected["counterId"],
                number_value,
                base_tokens,
                options,
            )
            counter_id = detected["counterId"]
        else:
            tokens = base_tokens
            mode_used = None
            counter_id = None

        if postfix:
            tokens = list(tokens) + list(postfix[1])
        if prefix:
            tokens = list(prefix[1]) + list(tokens)

        return {
            "input": input_text,
            "normalized": normalized,
            "number": number_value,
            "counterId": counter_id,
            "modeUsed": mode_used,
            "tokens": tokens,
            "reading": "".join(tokens),
        }


_DEFAULT_YOMI: Optional[YomiJaPy] = None


def create_yomi(rule_dir: Optional[Path] = None) -> YomiJaPy:
    if rule_dir is None:
        return YomiJaPy()
    return YomiJaPy(load_rules(rule_dir))


def get_default_yomi() -> YomiJaPy:
    global _DEFAULT_YOMI
    if _DEFAULT_YOMI is None:
        _DEFAULT_YOMI = YomiJaPy()
    return _DEFAULT_YOMI


def read(input_text: str, options: Optional[Dict[str, Any]] = None) -> Optional[str]:
    return get_default_yomi().read(input_text, options)


def read_detailed(input_text: str, options: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    return get_default_yomi().read_detailed(input_text, options)


def read_number(value: int, options: Optional[Dict[str, Any]] = None) -> str:
    return get_default_yomi().read_number(value, options)


def run_benchmark(cases_path: Path, iterations: int) -> Dict[str, Any]:
    yomi = YomiJaPy()
    with cases_path.open("r", encoding="utf-8") as f:
        cases = json.load(f)

    case_results: List[Dict[str, Any]] = []
    total_ns = 0

    for index, case in enumerate(cases):
        input_text = case["in"]
        expected = case["out"]
        opts = case.get("opts")

        actual = yomi.read(input_text, opts)
        if actual != expected:
            raise RuntimeError(
                f"Case mismatch at index {index}: in={input_text} expected={expected} actual={actual}"
            )

        start = time.perf_counter_ns()
        for _ in range(iterations):
            yomi.read(input_text, opts)
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
        "impl": "python",
        "iterations": iterations,
        "cases": case_results,
        "total_ns": total_ns,
        "total_ms": round(total_ns / 1_000_000.0, 3),
    }


def parse_modes(mode_args: List[str]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for mode_arg in mode_args:
        if "=" not in mode_arg:
            raise ValueError(f"--mode expects counter=mode: {mode_arg}")
        counter, mode = mode_arg.split("=", 1)
        out[counter] = mode
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="Python implementation for japanese-number-reading")
    subparsers = parser.add_subparsers(dest="command", required=True)

    read_parser = subparsers.add_parser("read", help="Read one input")
    read_parser.add_argument("input", help="Input text")
    read_parser.add_argument("--zero", choices=["rei", "zero"], default=None)
    read_parser.add_argument("--mode", action="append", default=[])
    read_parser.add_argument("--strict", action="store_true")

    bench_parser = subparsers.add_parser("bench", help="Run benchmark with cases")
    bench_parser.add_argument("--cases", default=str(ROOT_DIR / "test" / "cases.json"))
    bench_parser.add_argument("--iterations", type=int, default=20_000)

    args = parser.parse_args()
    yomi = YomiJaPy()

    if args.command == "read":
        options: Dict[str, Any] = {}
        if args.zero is not None:
            options["variant"] = {"zero": args.zero}
        modes = parse_modes(args.mode)
        if modes:
            options["mode"] = modes
        if args.strict:
            options["strict"] = True

        result = yomi.read(args.input, options or None)
        if result is None:
            raise SystemExit("Unable to parse")
        print(result)
        return

    if args.command == "bench":
        cases_path = Path(args.cases)
        result = run_benchmark(cases_path, args.iterations)
        print(json.dumps(result, ensure_ascii=False))
        return


if __name__ == "__main__":
    main()
