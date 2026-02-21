use num_bigint::BigInt;
use num_traits::{Signed, ToPrimitive, Zero};
use serde_json::{json, Value};
use smallvec::{smallvec, SmallVec};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::Instant;
use unicode_normalization::UnicodeNormalization;

type Token = &'static str;
type Tokens = &'static [Token];
type TokenBuf = SmallVec<[Token; 16]>;
const DECIMAL_POINT_TOKEN: Token = "てん";
const MAX_REPLACE_SPAN: usize = 64;

#[derive(Clone, Copy)]
struct CounterPrefixDef {
    marker: &'static str,
    reading: Tokens,
}

#[derive(Clone, Copy)]
struct CounterPostfixDef {
    marker: &'static str,
    reading: Tokens,
}

const COUNTER_PREFIXES: &[CounterPrefixDef] = &[CounterPrefixDef {
    marker: "第",
    reading: &["だい"],
}];

const COUNTER_POSTFIXES: &[CounterPostfixDef] = &[
    CounterPostfixDef {
        marker: "目",
        reading: &["め"],
    },
    CounterPostfixDef {
        marker: "め",
        reading: &["め"],
    },
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ZeroVariant {
    Rei,
    Zero,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FourVariant {
    Yon,
    Shi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SevenVariant {
    Nana,
    Shichi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NineVariant {
    Kyu,
    Ku,
}

#[derive(Debug, Clone, Copy)]
struct ZeroVariants {
    rei: Token,
    zero: Token,
}

#[derive(Debug, Clone, Copy)]
struct FourVariants {
    yon: Token,
    shi: Token,
}

#[derive(Debug, Clone, Copy)]
struct SevenVariants {
    nana: Token,
    shichi: Token,
}

#[derive(Debug, Clone, Copy)]
struct NineVariants {
    kyu: Token,
    ku: Token,
}

#[derive(Debug, Clone, Copy)]
struct Variants {
    zero: ZeroVariants,
    four: FourVariants,
    seven: SevenVariants,
    nine: NineVariants,
}

#[derive(Debug, Clone, Copy)]
struct DefaultVariant {
    zero: ZeroVariant,
    four: FourVariant,
    seven: SevenVariant,
    nine: NineVariant,
}

#[derive(Debug, Clone, Copy)]
struct CoreRules {
    variants: Variants,
    default_variant: DefaultVariant,
    digits: [Tokens; 10],
    special_hundreds: &'static [(u8, Tokens)],
    special_thousands: &'static [(u8, Tokens)],
    small_units_10: Tokens,
    small_units_100: Tokens,
    small_units_1000: Tokens,
    big_units: &'static [(u32, Tokens)],
    minus: Tokens,
}

#[derive(Debug, Clone, Copy)]
struct RewriteDef {
    from: Token,
    to: Token,
}

#[derive(Debug, Clone, Copy)]
struct TailRuleDef {
    when_tail_in: &'static [Token],
    rewrite_tail: &'static [RewriteDef],
    use_form: Option<&'static str>,
}

#[derive(Debug, Clone, Copy)]
struct PatternDef {
    id: &'static str,
    rules: &'static [TailRuleDef],
    default_form: &'static str,
}

#[derive(Debug, Clone, Copy)]
struct FormDef {
    key: &'static str,
    tokens: Tokens,
}

#[derive(Debug, Clone, Copy)]
struct ExceptionDef {
    key: &'static str,
    key_num: Option<i64>,
    tokens: Tokens,
}

#[derive(Debug, Clone, Copy)]
struct PatternCompose {
    pattern_id: &'static str,
    forms: &'static [FormDef],
}

#[derive(Debug, Clone, Copy)]
#[allow(dead_code)]
enum FallbackCompose {
    Concat(Tokens),
    Pattern(PatternCompose),
}

#[derive(Debug, Clone, Copy)]
struct ExceptionsFirstCompose {
    exceptions: &'static [ExceptionDef],
    fallback: FallbackCompose,
}

#[derive(Debug, Clone, Copy)]
enum Compose {
    Concat(Tokens),
    Pattern(PatternCompose),
    ExceptionsFirst(ExceptionsFirstCompose),
}

#[derive(Debug, Clone, Copy)]
struct ModeDef {
    id: &'static str,
    compose: Compose,
}

#[derive(Debug, Clone, Copy)]
struct CounterDef {
    id: &'static str,
    prefix: &'static [&'static str],
    suffix: &'static [&'static str],
    compose: Option<Compose>,
    default_mode: Option<&'static str>,
    modes: &'static [ModeDef],
}

include!(concat!(env!("OUT_DIR"), "/generated_rules.rs"));

#[derive(Debug, Clone)]
struct ModeOverride {
    counter_id: String,
    mode_id: String,
}

#[derive(Debug, Clone, Default)]
struct ReadOptions {
    zero: Option<ZeroVariant>,
    four: Option<FourVariant>,
    seven: Option<SevenVariant>,
    nine: Option<NineVariant>,
    strict: bool,
    modes: Vec<ModeOverride>,
}

impl ReadOptions {
    fn mode_for(&self, counter_id: &str) -> Option<&str> {
        self.modes
            .iter()
            .find(|m| m.counter_id == counter_id)
            .map(|m| m.mode_id.as_str())
    }
}

#[derive(Debug, Clone)]
enum NumberValue {
    Small(i64),
    Big(BigInt),
}

impl NumberValue {
    fn is_zero(&self) -> bool {
        match self {
            NumberValue::Small(v) => *v == 0,
            NumberValue::Big(v) => v.is_zero(),
        }
    }

    fn is_negative(&self) -> bool {
        match self {
            NumberValue::Small(v) => *v < 0,
            NumberValue::Big(v) => v.is_negative(),
        }
    }

    fn abs_i64(&self) -> Option<i64> {
        match self {
            NumberValue::Small(v) => v.checked_abs(),
            NumberValue::Big(v) => v.abs().to_i64(),
        }
    }

    fn abs_string(&self) -> String {
        match self {
            NumberValue::Small(v) => v.abs().to_string(),
            NumberValue::Big(v) => v.abs().to_string(),
        }
    }

    fn abs_bigint(&self) -> BigInt {
        match self {
            NumberValue::Small(v) => BigInt::from(v.abs()),
            NumberValue::Big(v) => v.abs(),
        }
    }
}

#[derive(Clone, Copy)]
struct CounterMarker {
    marker: &'static str,
    counter: &'static CounterDef,
}

struct RuntimeRules {
    core: &'static CoreRules,
    patterns_by_id: HashMap<&'static str, &'static PatternDef>,
    prefix_markers_by_head: HashMap<char, Vec<CounterMarker>>,
    suffix_markers_by_tail: HashMap<char, Vec<CounterMarker>>,
}

static RUNTIME_RULES: OnceLock<RuntimeRules> = OnceLock::new();
static REPLACE_MARKERS: OnceLock<Vec<&'static str>> = OnceLock::new();

fn runtime_rules() -> &'static RuntimeRules {
    RUNTIME_RULES.get_or_init(|| {
        let mut patterns_by_id = HashMap::new();
        for pattern in PATTERN_DEFS {
            patterns_by_id.insert(pattern.id, pattern);
        }

        let mut prefix_markers_by_head: HashMap<char, Vec<CounterMarker>> = HashMap::new();
        let mut suffix_markers_by_tail: HashMap<char, Vec<CounterMarker>> = HashMap::new();

        for counter in COUNTER_DEFS {
            for marker in counter.prefix {
                let Some(head) = marker.chars().next() else {
                    continue;
                };
                prefix_markers_by_head
                    .entry(head)
                    .or_default()
                    .push(CounterMarker { marker, counter });
            }
            for marker in counter.suffix {
                let Some(tail) = marker.chars().next_back() else {
                    continue;
                };
                suffix_markers_by_tail
                    .entry(tail)
                    .or_default()
                    .push(CounterMarker { marker, counter });
            }
        }

        for markers in prefix_markers_by_head.values_mut() {
            markers.sort_by(|a, b| b.marker.len().cmp(&a.marker.len()));
        }
        for markers in suffix_markers_by_tail.values_mut() {
            markers.sort_by(|a, b| b.marker.len().cmp(&a.marker.len()));
        }

        RuntimeRules {
            core: &CORE_RULES,
            patterns_by_id,
            prefix_markers_by_head,
            suffix_markers_by_tail,
        }
    })
}

fn replace_markers() -> &'static Vec<&'static str> {
    REPLACE_MARKERS.get_or_init(|| {
        let mut seen: HashSet<&'static str> = HashSet::new();
        let mut markers: Vec<&'static str> = Vec::new();

        for counter in COUNTER_DEFS {
            for marker in counter.prefix {
                if seen.insert(*marker) {
                    markers.push(*marker);
                }
            }
            for marker in counter.suffix {
                if seen.insert(*marker) {
                    markers.push(*marker);
                }
            }
        }
        for prefix in COUNTER_PREFIXES {
            if seen.insert(prefix.marker) {
                markers.push(prefix.marker);
            }
        }
        for postfix in COUNTER_POSTFIXES {
            if seen.insert(postfix.marker) {
                markers.push(postfix.marker);
            }
        }
        markers.sort_by(|a, b| b.len().cmp(&a.len()));
        markers
    })
}

#[derive(Clone, Copy)]
struct CounterMatch<'a> {
    counter: &'static CounterDef,
    number_part: &'a str,
}

#[derive(Clone, Copy)]
struct CounterPrefixMatch {
    marker: &'static str,
    reading: Tokens,
}

#[derive(Clone, Copy)]
struct CounterPostfixMatch {
    marker: &'static str,
    reading: Tokens,
}

struct ParsedDecimal {
    negative: bool,
    integer_part: NumberValue,
    fraction_digits: Vec<u8>,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        print_usage();
        std::process::exit(1);
    }

    let result = match args[1].as_str() {
        "read" => run_read(&args[2..]),
        "replace" => run_replace(&args[2..]),
        "bench" => run_bench(&args[2..]),
        _ => {
            print_usage();
            Err("Unknown command".to_string())
        }
    };

    if let Err(e) = result {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn print_usage() {
    eprintln!(
        "Usage:\n  num-yomi-rust read <input> [--zero rei|zero] [--mode counter=mode] [--strict]\n  num-yomi-rust replace <input> [--zero rei|zero] [--mode counter=mode] [--strict]\n  num-yomi-rust bench [--cases path] [--iterations N]"
    );
}

fn run_read(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("read requires an input".to_string());
    }

    let input = args[0].clone();
    let mut options = ReadOptions::default();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--zero" => {
                i += 1;
                if i >= args.len() {
                    return Err("--zero expects rei or zero".to_string());
                }
                options.zero = Some(parse_zero_variant(&args[i])?);
            }
            "--mode" => {
                i += 1;
                if i >= args.len() {
                    return Err("--mode expects counter=mode".to_string());
                }
                let value = &args[i];
                let Some(eq_pos) = value.find('=') else {
                    return Err("--mode expects counter=mode".to_string());
                };
                options.modes.push(ModeOverride {
                    counter_id: value[..eq_pos].to_string(),
                    mode_id: value[eq_pos + 1..].to_string(),
                });
            }
            "--strict" => {
                options.strict = true;
            }
            other => {
                return Err(format!("Unknown flag: {other}"));
            }
        }
        i += 1;
    }

    let rules = runtime_rules();
    let result = read_with_options(&input, &options, rules)?;
    match result {
        Some(reading) => {
            println!("{reading}");
            Ok(())
        }
        None => Err("Unable to parse".to_string()),
    }
}

fn run_replace(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("replace requires an input".to_string());
    }

    let input = args[0].clone();
    let mut options = ReadOptions::default();

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--zero" => {
                i += 1;
                if i >= args.len() {
                    return Err("--zero expects rei or zero".to_string());
                }
                options.zero = Some(parse_zero_variant(&args[i])?);
            }
            "--mode" => {
                i += 1;
                if i >= args.len() {
                    return Err("--mode expects counter=mode".to_string());
                }
                let value = &args[i];
                let Some(eq_pos) = value.find('=') else {
                    return Err("--mode expects counter=mode".to_string());
                };
                options.modes.push(ModeOverride {
                    counter_id: value[..eq_pos].to_string(),
                    mode_id: value[eq_pos + 1..].to_string(),
                });
            }
            "--strict" => {
                options.strict = true;
            }
            other => {
                return Err(format!("Unknown flag: {other}"));
            }
        }
        i += 1;
    }

    let rules = runtime_rules();
    let replaced = replace_in_text_with_options(&input, &options, rules);
    println!("{replaced}");
    Ok(())
}

#[derive(Debug)]
struct BenchCase {
    input: String,
    expected: String,
    options: ReadOptions,
}

fn run_bench(args: &[String]) -> Result<(), String> {
    let mut cases_path = repo_root().join("test/cases.json");
    let mut iterations: u64 = 20_000;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--cases" => {
                i += 1;
                if i >= args.len() {
                    return Err("--cases requires a path".to_string());
                }
                cases_path = PathBuf::from(&args[i]);
            }
            "--iterations" => {
                i += 1;
                if i >= args.len() {
                    return Err("--iterations requires a number".to_string());
                }
                iterations = args[i]
                    .parse::<u64>()
                    .map_err(|_| "--iterations must be a positive integer".to_string())?;
                if iterations == 0 {
                    return Err("--iterations must be > 0".to_string());
                }
            }
            other => {
                return Err(format!("Unknown flag: {other}"));
            }
        }
        i += 1;
    }

    let cases = load_bench_cases(&cases_path)?;
    let rules = runtime_rules();

    let mut out_cases: Vec<Value> = Vec::new();
    let mut total_ns: u128 = 0;

    for (index, case) in cases.iter().enumerate() {
        let warmup = read_with_options(&case.input, &case.options, rules)?;
        if warmup.as_deref() != Some(case.expected.as_str()) {
            return Err(format!(
                "Case mismatch at index {index}: in={} expected={} actual={:?}",
                case.input, case.expected, warmup
            ));
        }

        let start = Instant::now();
        for _ in 0..iterations {
            let _ = read_with_options(&case.input, &case.options, rules)?;
        }
        let elapsed_ns = start.elapsed().as_nanos();
        total_ns += elapsed_ns;

        let avg_ns = elapsed_ns / iterations as u128;
        out_cases.push(json!({
            "index": index,
            "input": case.input,
            "expected": case.expected,
            "avg_ns": avg_ns as u64,
            "total_ns": elapsed_ns as u64,
        }));
    }

    println!(
        "{}",
        json!({
            "impl": "rust",
            "iterations": iterations,
            "cases": out_cases,
            "total_ns": total_ns as u64,
            "total_ms": (total_ns as f64) / 1_000_000.0,
        })
    );

    Ok(())
}

fn load_bench_cases(path: &Path) -> Result<Vec<BenchCase>, String> {
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read cases file {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse cases JSON {}: {e}", path.display()))?;

    let arr = value
        .as_array()
        .ok_or_else(|| "cases JSON must be an array".to_string())?;

    let mut out = Vec::with_capacity(arr.len());
    for (index, case) in arr.iter().enumerate() {
        let obj = case
            .as_object()
            .ok_or_else(|| format!("Case at index {index} is not an object"))?;

        let input = obj
            .get("in")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Case {index} missing string field: in"))?
            .to_string();
        let expected = obj
            .get("out")
            .and_then(Value::as_str)
            .ok_or_else(|| format!("Case {index} missing string field: out"))?
            .to_string();

        let options = parse_options_from_value(obj.get("opts"))?;
        out.push(BenchCase {
            input,
            expected,
            options,
        });
    }

    Ok(out)
}

fn parse_options_from_value(value: Option<&Value>) -> Result<ReadOptions, String> {
    let mut options = ReadOptions::default();
    let Some(value) = value else {
        return Ok(options);
    };
    let obj = value
        .as_object()
        .ok_or_else(|| "opts must be an object".to_string())?;

    if let Some(strict) = obj.get("strict").and_then(Value::as_bool) {
        options.strict = strict;
    }

    if let Some(variant) = obj.get("variant") {
        let vobj = variant
            .as_object()
            .ok_or_else(|| "opts.variant must be an object".to_string())?;

        if let Some(zero) = vobj.get("zero").and_then(Value::as_str) {
            options.zero = Some(parse_zero_variant(zero)?);
        }
        if let Some(four) = vobj.get("four").and_then(Value::as_str) {
            options.four = Some(parse_four_variant(four)?);
        }
        if let Some(seven) = vobj.get("seven").and_then(Value::as_str) {
            options.seven = Some(parse_seven_variant(seven)?);
        }
        if let Some(nine) = vobj.get("nine").and_then(Value::as_str) {
            options.nine = Some(parse_nine_variant(nine)?);
        }
    }

    if let Some(mode) = obj.get("mode") {
        let mobj = mode
            .as_object()
            .ok_or_else(|| "opts.mode must be an object".to_string())?;

        for (counter_id, mode_id_value) in mobj {
            let mode_id = mode_id_value
                .as_str()
                .ok_or_else(|| "opts.mode values must be strings".to_string())?;
            options.modes.push(ModeOverride {
                counter_id: counter_id.clone(),
                mode_id: mode_id.to_string(),
            });
        }
    }

    Ok(options)
}

fn parse_zero_variant(input: &str) -> Result<ZeroVariant, String> {
    match input {
        "rei" => Ok(ZeroVariant::Rei),
        "zero" => Ok(ZeroVariant::Zero),
        _ => Err(format!("Invalid zero variant: {input}")),
    }
}

fn parse_four_variant(input: &str) -> Result<FourVariant, String> {
    match input {
        "yon" => Ok(FourVariant::Yon),
        "shi" => Ok(FourVariant::Shi),
        _ => Err(format!("Invalid four variant: {input}")),
    }
}

fn parse_seven_variant(input: &str) -> Result<SevenVariant, String> {
    match input {
        "nana" => Ok(SevenVariant::Nana),
        "shichi" => Ok(SevenVariant::Shichi),
        _ => Err(format!("Invalid seven variant: {input}")),
    }
}

fn parse_nine_variant(input: &str) -> Result<NineVariant, String> {
    match input {
        "kyu" => Ok(NineVariant::Kyu),
        "ku" => Ok(NineVariant::Ku),
        _ => Err(format!("Invalid nine variant: {input}")),
    }
}

fn read_with_options(
    input: &str,
    options: &ReadOptions,
    rules: &RuntimeRules,
) -> Result<Option<String>, String> {
    let normalized = normalize_input(input);
    let mut prefix: Option<CounterPrefixMatch> = None;
    let mut postfix: Option<CounterPostfixMatch> = None;
    let mut counter_input = normalized.as_str();
    let mut detected = detect_counter_with_parsable_number(counter_input, rules);
    if detected.is_none() {
        prefix = detect_counter_prefix(counter_input);
        if let Some(matched_prefix) = prefix {
            counter_input = &counter_input[matched_prefix.marker.len()..];
            detected = detect_counter_with_parsable_number(counter_input, rules);
        }
    }
    if detected.is_none() {
        postfix = detect_counter_postfix(counter_input);
        if let Some(matched_postfix) = postfix {
            counter_input = &counter_input[..counter_input.len() - matched_postfix.marker.len()];
            detected = detect_counter_with_parsable_number(counter_input, rules);
        }
    }

    let number_text = detected
        .as_ref()
        .map(|m| m.number_part)
        .unwrap_or(counter_input);

    if let Some(decimal) = parse_decimal(number_text) {
        let base_tokens = read_decimal_tokens(&decimal, rules.core, options)?;
        let final_tokens = if let Some(matched) = detected {
            match apply_counter_decimal(matched.counter, &base_tokens, options, rules) {
                Ok(tokens) => tokens,
                Err(message) => {
                    if options.strict {
                        return Err(message);
                    }
                    return Ok(None);
                }
            }
        } else {
            base_tokens
        };

        let final_tokens = prepend_counter_prefix(append_counter_postfix(final_tokens, postfix), prefix);
        return Ok(Some(join_tokens(&final_tokens)));
    }

    let number_value = parse_number(number_text);
    let Some(number_value) = number_value else {
        if options.strict {
            return Err(format!("Unable to parse number from input: {input}"));
        }
        return Ok(None);
    };

    let base_tokens = read_number_tokens(&number_value, rules.core, options)?;
    let final_tokens = if let Some(matched) = detected {
        apply_counter(matched.counter, &number_value, &base_tokens, options, rules)
    } else {
        base_tokens
    };

    let final_tokens = prepend_counter_prefix(append_counter_postfix(final_tokens, postfix), prefix);
    Ok(Some(join_tokens(&final_tokens)))
}

fn replace_in_text_with_options(input: &str, options: &ReadOptions, rules: &RuntimeRules) -> String {
    if input.is_empty() {
        return String::new();
    }

    let positions: Vec<(usize, char)> = input.char_indices().collect();
    let char_len = positions.len();
    let markers = replace_markers();
    let mut out = String::with_capacity(input.len());
    let mut index = 0usize;

    while index < char_len {
        let ch = positions[index].1;
        if !is_candidate_start(ch) {
            out.push(ch);
            index += 1;
            continue;
        }

        let max_end = std::cmp::min(char_len, index + MAX_REPLACE_SPAN);
        let mut matched: Option<(usize, String)> = None;
        for end in (index + 1..=max_end).rev() {
            let start_byte = positions[index].0;
            let end_byte = if end < char_len {
                positions[end].0
            } else {
                input.len()
            };
            let fragment = &input[start_byte..end_byte];
            if !has_replace_trigger(fragment) {
                continue;
            }
            if !contains_numeric_char(fragment) {
                continue;
            }
            if !contains_marker(fragment, markers) {
                continue;
            }

            if let Ok(Some(reading)) = read_with_options(fragment, options, rules) {
                matched = Some((end, reading));
                break;
            }
        }

        if let Some((end, reading)) = matched {
            out.push_str(&reading);
            index = end;
            continue;
        }

        out.push(ch);
        index += 1;
    }

    out
}

fn normalize_input(input: &str) -> String {
    let mut normalized = String::with_capacity(input.len());
    for ch in input.nfkc() {
        match ch {
            ',' => {}
            '￥' => normalized.push('¥'),
            _ => normalized.push(ch),
        }
    }

    let trimmed = normalized.trim();
    if trimmed.len() == normalized.len() {
        normalized
    } else {
        trimmed.to_string()
    }
}

fn detect_counter<'a>(input: &'a str, rules: &RuntimeRules) -> Option<CounterMatch<'a>> {
    if let Some(head) = input.chars().next() {
        if let Some(candidates) = rules.prefix_markers_by_head.get(&head) {
            for marker in candidates {
                if input.starts_with(marker.marker) {
                    return Some(CounterMatch {
                        counter: marker.counter,
                        number_part: &input[marker.marker.len()..],
                    });
                }
            }
        }
    }

    if let Some(tail) = input.chars().next_back() {
        if let Some(candidates) = rules.suffix_markers_by_tail.get(&tail) {
            for marker in candidates {
                if input.ends_with(marker.marker) {
                    let number_len = input.len() - marker.marker.len();
                    return Some(CounterMatch {
                        counter: marker.counter,
                        number_part: &input[..number_len],
                    });
                }
            }
        }
    }

    None
}

fn has_replace_trigger(input: &str) -> bool {
    input.chars().any(|ch| {
        ch == '$'
            || ch == '¥'
            || ch == '￥'
            || ch == '第'
            || ch.is_ascii_digit()
            || ('０'..='９').contains(&ch)
    })
}

fn contains_numeric_char(input: &str) -> bool {
    input.chars().any(|ch| {
        ch.is_ascii_digit()
            || ('０'..='９').contains(&ch)
            || matches!(
                ch,
                '零'
                    | '〇'
                    | '一'
                    | '二'
                    | '三'
                    | '四'
                    | '五'
                    | '六'
                    | '七'
                    | '八'
                    | '九'
                    | '十'
                    | '百'
                    | '千'
                    | '万'
                    | '億'
                    | '兆'
                    | '京'
            )
    })
}

fn contains_marker(input: &str, markers: &[&str]) -> bool {
    markers.iter().any(|marker| input.contains(marker))
}

fn is_candidate_start(ch: char) -> bool {
    ch.is_ascii_digit()
        || ('０'..='９').contains(&ch)
        || matches!(
            ch,
            '+'
                | '-'
                | '＋'
                | '－'
                | '$'
                | '¥'
                | '￥'
                | '第'
                | '零'
                | '〇'
                | '一'
                | '二'
                | '三'
                | '四'
                | '五'
                | '六'
                | '七'
                | '八'
                | '九'
                | '十'
                | '百'
                | '千'
                | '万'
                | '億'
                | '兆'
                | '京'
        )
}

fn has_parsable_number_text(input: &str) -> bool {
    parse_decimal(input).is_some() || parse_number(input).is_some()
}

fn detect_counter_with_parsable_number<'a>(
    input: &'a str,
    rules: &RuntimeRules,
) -> Option<CounterMatch<'a>> {
    let detected = detect_counter(input, rules)?;
    if !has_parsable_number_text(detected.number_part) {
        return None;
    }
    Some(detected)
}

fn detect_counter_prefix(input: &str) -> Option<CounterPrefixMatch> {
    let mut best: Option<CounterPrefixMatch> = None;
    for prefix in COUNTER_PREFIXES {
        if !input.starts_with(prefix.marker) {
            continue;
        }
        let matched = CounterPrefixMatch {
            marker: prefix.marker,
            reading: prefix.reading,
        };
        match best {
            None => best = Some(matched),
            Some(current) if matched.marker.len() > current.marker.len() => best = Some(matched),
            _ => {}
        }
    }
    best
}

fn detect_counter_postfix(input: &str) -> Option<CounterPostfixMatch> {
    let mut best: Option<CounterPostfixMatch> = None;
    for postfix in COUNTER_POSTFIXES {
        if !input.ends_with(postfix.marker) {
            continue;
        }
        let matched = CounterPostfixMatch {
            marker: postfix.marker,
            reading: postfix.reading,
        };
        match best {
            None => best = Some(matched),
            Some(current) if matched.marker.len() > current.marker.len() => best = Some(matched),
            _ => {}
        }
    }
    best
}

fn prepend_counter_prefix(tokens: TokenBuf, prefix: Option<CounterPrefixMatch>) -> TokenBuf {
    if let Some(prefix) = prefix {
        let mut merged: TokenBuf = SmallVec::with_capacity(prefix.reading.len() + tokens.len());
        merged.extend_from_slice(prefix.reading);
        merged.extend(tokens);
        return merged;
    }
    tokens
}

fn append_counter_postfix(mut tokens: TokenBuf, postfix: Option<CounterPostfixMatch>) -> TokenBuf {
    if let Some(postfix) = postfix {
        tokens.extend_from_slice(postfix.reading);
    }
    tokens
}

fn parse_number(input: &str) -> Option<NumberValue> {
    if is_arabic_int(input) {
        if let Ok(v) = input.parse::<i64>() {
            return Some(NumberValue::Small(v));
        }
        return BigInt::parse_bytes(input.as_bytes(), 10).map(NumberValue::Big);
    }

    if let Some(v) = parse_scaled_arabic(input) {
        return Some(v);
    }

    parse_kansuji(input)
}

fn parse_scaled_arabic(input: &str) -> Option<NumberValue> {
    if input.chars().count() < 2 {
        return None;
    }

    let unit_char = input.chars().next_back()?;
    let multiplier = big_unit_multiplier(unit_char)?;
    let number_text = input.strip_suffix(unit_char)?;
    if !is_arabic_int(number_text) {
        return None;
    }

    if let Ok(base_i64) = number_text.parse::<i64>() {
        let product = (base_i64 as i128).checked_mul(multiplier as i128)?;
        if let Ok(small) = i64::try_from(product) {
            return Some(NumberValue::Small(small));
        }
    }

    let base_big = number_text.parse::<BigInt>().ok()?;
    Some(NumberValue::Big(base_big * BigInt::from(multiplier)))
}

fn big_unit_multiplier(ch: char) -> Option<i64> {
    match ch {
        '万' => Some(10_000),
        '億' => Some(100_000_000),
        '兆' => Some(1_000_000_000_000),
        '京' => Some(10_000_000_000_000_000),
        _ => None,
    }
}

fn parse_decimal(input: &str) -> Option<ParsedDecimal> {
    if input.is_empty() {
        return None;
    }

    let bytes = input.as_bytes();
    let mut start = 0usize;
    let mut negative = false;

    if bytes[0] == b'+' || bytes[0] == b'-' {
        if input.len() == 1 {
            return None;
        }
        negative = bytes[0] == b'-';
        start = 1;
    }

    let dot_rel = input[start..].find('.')?;
    let dot_pos = start + dot_rel;
    if input[dot_pos + 1..].contains('.') {
        return None;
    }

    let integer_text = &input[start..dot_pos];
    let fraction_text = &input[dot_pos + 1..];
    if integer_text.is_empty() || fraction_text.is_empty() {
        return None;
    }
    if !integer_text.as_bytes().iter().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !fraction_text.as_bytes().iter().all(|b| b.is_ascii_digit()) {
        return None;
    }

    let integer_part = if let Ok(v) = integer_text.parse::<i64>() {
        NumberValue::Small(v)
    } else {
        NumberValue::Big(BigInt::parse_bytes(integer_text.as_bytes(), 10)?)
    };
    let fraction_digits = fraction_text
        .as_bytes()
        .iter()
        .map(|b| *b - b'0')
        .collect::<Vec<u8>>();

    Some(ParsedDecimal {
        negative,
        integer_part,
        fraction_digits,
    })
}

fn is_arabic_int(input: &str) -> bool {
    if input.is_empty() {
        return false;
    }
    let bytes = input.as_bytes();
    let mut start = 0usize;
    if bytes[0] == b'+' || bytes[0] == b'-' {
        if input.len() == 1 {
            return false;
        }
        start = 1;
    }
    bytes[start..].iter().all(|b| b.is_ascii_digit())
}

fn parse_kansuji(input: &str) -> Option<NumberValue> {
    if !is_kansuji_int(input) {
        return None;
    }

    if let Some(v) = parse_kansuji_i64(input) {
        return Some(NumberValue::Small(v));
    }

    parse_kansuji_bigint(input).map(NumberValue::Big)
}

fn parse_kansuji_i64(input: &str) -> Option<i64> {
    let mut negative = false;
    let mut started = false;

    let mut total: i128 = 0;
    let mut chunk: i128 = 0;
    let mut digit_buffer: Option<i128> = None;

    for (idx, ch) in input.chars().enumerate() {
        if idx == 0 {
            if ch == '-' {
                negative = true;
                continue;
            }
            if ch == '+' {
                continue;
            }
        }

        started = true;
        if let Some(digit) = kanji_digit(ch) {
            let digit = digit as i128;
            digit_buffer = Some(match digit_buffer {
                None => digit,
                Some(prev) => prev.checked_mul(10)?.checked_add(digit)?,
            });
            continue;
        }

        if let Some(unit) = small_unit_i128(ch) {
            let num = digit_buffer.take().unwrap_or(1);
            chunk = chunk.checked_add(num.checked_mul(unit)?)?;
            continue;
        }

        if let Some(unit) = big_unit_i128(ch) {
            if let Some(db) = digit_buffer.take() {
                chunk = chunk.checked_add(db)?;
            }
            total = total.checked_add(chunk.checked_mul(unit)?)?;
            chunk = 0;
            continue;
        }

        return None;
    }

    if !started {
        return None;
    }

    if let Some(db) = digit_buffer {
        chunk = chunk.checked_add(db)?;
    }

    let mut result = total.checked_add(chunk)?;
    if negative {
        result = result.checked_neg()?;
    }
    i64::try_from(result).ok()
}

fn parse_kansuji_bigint(input: &str) -> Option<BigInt> {
    let mut negative = false;
    let mut started = false;

    let mut total = BigInt::zero();
    let mut chunk = BigInt::zero();
    let mut digit_buffer: Option<BigInt> = None;

    for (idx, ch) in input.chars().enumerate() {
        if idx == 0 {
            if ch == '-' {
                negative = true;
                continue;
            }
            if ch == '+' {
                continue;
            }
        }

        started = true;
        if let Some(digit) = kanji_digit(ch) {
            let d = BigInt::from(digit);
            digit_buffer = Some(match digit_buffer.take() {
                None => d,
                Some(prev) => prev * BigInt::from(10u8) + d,
            });
            continue;
        }

        if let Some(unit) = small_unit(ch) {
            let num = digit_buffer.take().unwrap_or_else(|| BigInt::from(1u8));
            chunk += num * unit;
            continue;
        }

        if let Some(unit) = big_unit(ch) {
            if let Some(db) = digit_buffer.take() {
                chunk += db;
            }
            total += chunk * unit;
            chunk = BigInt::zero();
            continue;
        }

        return None;
    }

    if !started {
        return None;
    }

    if let Some(db) = digit_buffer {
        chunk += db;
    }

    let value = total + chunk;
    if negative {
        Some(-value)
    } else {
        Some(value)
    }
}

fn is_kansuji_int(input: &str) -> bool {
    if input.is_empty() {
        return false;
    }

    let mut chars = input.chars();
    let first = chars.next();
    let mut had_digit = false;

    match first {
        Some('+') | Some('-') => {}
        Some(ch) => {
            if !is_kansuji_char(ch) {
                return false;
            }
            had_digit = true;
        }
        None => return false,
    }

    for ch in chars {
        if !is_kansuji_char(ch) {
            return false;
        }
        had_digit = true;
    }

    had_digit
}

fn is_kansuji_char(ch: char) -> bool {
    matches!(
        ch,
        '零' | '〇'
            | '一'
            | '二'
            | '三'
            | '四'
            | '五'
            | '六'
            | '七'
            | '八'
            | '九'
            | '十'
            | '百'
            | '千'
            | '万'
            | '億'
            | '兆'
            | '京'
    )
}

fn kanji_digit(ch: char) -> Option<i32> {
    match ch {
        '零' | '〇' => Some(0),
        '一' => Some(1),
        '二' => Some(2),
        '三' => Some(3),
        '四' => Some(4),
        '五' => Some(5),
        '六' => Some(6),
        '七' => Some(7),
        '八' => Some(8),
        '九' => Some(9),
        _ => None,
    }
}

fn small_unit(ch: char) -> Option<BigInt> {
    match ch {
        '十' => Some(BigInt::from(10)),
        '百' => Some(BigInt::from(100)),
        '千' => Some(BigInt::from(1000)),
        _ => None,
    }
}

fn big_unit(ch: char) -> Option<BigInt> {
    match ch {
        '万' => Some(BigInt::from(10_000)),
        '億' => Some(BigInt::from(100_000_000)),
        '兆' => Some(BigInt::from(1_000_000_000_000u64)),
        '京' => Some(BigInt::from(10_000_000_000_000_000u64)),
        _ => None,
    }
}

fn small_unit_i128(ch: char) -> Option<i128> {
    match ch {
        '十' => Some(10),
        '百' => Some(100),
        '千' => Some(1000),
        _ => None,
    }
}

fn big_unit_i128(ch: char) -> Option<i128> {
    match ch {
        '万' => Some(10_000),
        '億' => Some(100_000_000),
        '兆' => Some(1_000_000_000_000),
        '京' => Some(10_000_000_000_000_000),
        _ => None,
    }
}

fn read_number_tokens(
    value: &NumberValue,
    core: &CoreRules,
    options: &ReadOptions,
) -> Result<TokenBuf, String> {
    if value.is_zero() {
        let zero_variant = options.zero.unwrap_or(core.default_variant.zero);
        let token = match zero_variant {
            ZeroVariant::Rei => core.variants.zero.rei,
            ZeroVariant::Zero => core.variants.zero.zero,
        };
        return Ok(smallvec![token]);
    }

    let mut out = match value {
        NumberValue::Small(v) => {
            let abs = if let Some(abs) = v.checked_abs() {
                abs as u64
            } else {
                return read_number_tokens_bigint(&value.abs_bigint(), core, options);
            };
            read_number_tokens_small(abs, core, options)?
        }
        NumberValue::Big(v) => read_number_tokens_bigint(&v.abs(), core, options)?,
    };

    if value.is_negative() {
        let mut prefixed: TokenBuf = TokenBuf::with_capacity(core.minus.len() + out.len());
        prefixed.extend_from_slice(core.minus);
        prefixed.append(&mut out);
        return Ok(prefixed);
    }

    Ok(out)
}

fn read_decimal_tokens(
    decimal: &ParsedDecimal,
    core: &CoreRules,
    options: &ReadOptions,
) -> Result<TokenBuf, String> {
    let mut integer_tokens = read_number_tokens(&decimal.integer_part, core, options)?;
    normalize_integer_tokens_for_decimal_point(&mut integer_tokens);

    if decimal.negative {
        let mut prefixed = TokenBuf::with_capacity(core.minus.len() + integer_tokens.len());
        prefixed.extend_from_slice(core.minus);
        prefixed.append(&mut integer_tokens);
        integer_tokens = prefixed;
    }

    let mut out = TokenBuf::with_capacity(integer_tokens.len() + 1 + decimal.fraction_digits.len());
    out.extend(integer_tokens);
    out.push(DECIMAL_POINT_TOKEN);

    for digit in &decimal.fraction_digits {
        out.push(read_fraction_digit_token(*digit, core, options)?);
    }

    Ok(out)
}

fn normalize_integer_tokens_for_decimal_point(tokens: &mut TokenBuf) {
    if let Some(last) = tokens.last_mut() {
        if *last == "いち" {
            *last = "いっ";
        }
    }
}

fn read_fraction_digit_token(
    digit: u8,
    core: &CoreRules,
    options: &ReadOptions,
) -> Result<Token, String> {
    if digit == 0 {
        let zero_variant = options.zero.unwrap_or(core.default_variant.zero);
        return Ok(match zero_variant {
            ZeroVariant::Rei => core.variants.zero.rei,
            ZeroVariant::Zero => core.variants.zero.zero,
        });
    }

    let mut buf = TokenBuf::new();
    push_digit_token(&mut buf, u32::from(digit), core, options)?;
    buf.first()
        .copied()
        .ok_or_else(|| "digit token generation failed".to_string())
}

fn read_number_tokens_small(
    value: u64,
    core: &CoreRules,
    options: &ReadOptions,
) -> Result<TokenBuf, String> {
    let mut remaining = value;
    let mut chunks: Vec<TokenBuf> = Vec::new();
    let mut pow10: u32 = 0;

    while remaining > 0 {
        let chunk = (remaining % 10_000) as u32;
        if chunk != 0 {
            let mut tokens = read_0_to_9999_tokens(chunk, core, options)?;
            if let Some(unit) = find_big_unit(core, pow10) {
                tokens.extend_from_slice(unit);
            }
            chunks.push(tokens);
        }
        remaining /= 10_000;
        pow10 += 4;
    }

    let mut out = TokenBuf::new();
    for chunk in chunks.into_iter().rev() {
        out.extend(chunk);
    }

    Ok(out)
}

fn read_number_tokens_bigint(
    abs_value: &BigInt,
    core: &CoreRules,
    options: &ReadOptions,
) -> Result<TokenBuf, String> {
    let mut remaining = abs_value.clone();
    let mut chunks: Vec<TokenBuf> = Vec::new();
    let mut pow10: u32 = 0;

    while remaining > BigInt::zero() {
        let chunk = (&remaining % BigInt::from(10_000u32))
            .to_u32()
            .ok_or_else(|| "chunk conversion failed".to_string())?;
        if chunk != 0 {
            let mut tokens = read_0_to_9999_tokens(chunk, core, options)?;
            if let Some(unit) = find_big_unit(core, pow10) {
                tokens.extend_from_slice(unit);
            }
            chunks.push(tokens);
        }
        remaining /= BigInt::from(10_000u32);
        pow10 += 4;
    }

    let mut out = TokenBuf::new();
    for chunk in chunks.into_iter().rev() {
        out.extend(chunk);
    }

    Ok(out)
}

fn read_0_to_9999_tokens(
    value: u32,
    core: &CoreRules,
    options: &ReadOptions,
) -> Result<TokenBuf, String> {
    let mut out: TokenBuf = TokenBuf::new();
    let mut remaining = value;

    if remaining >= 1000 {
        let digit = remaining / 1000;
        remaining %= 1000;
        if digit == 1 {
            out.extend_from_slice(core.small_units_1000);
        } else if let Some(special) = find_special(core.special_thousands, digit) {
            out.extend_from_slice(special);
        } else {
            push_digit_token(&mut out, digit, core, options)?;
            out.extend_from_slice(core.small_units_1000);
        }
    }

    if remaining >= 100 {
        let digit = remaining / 100;
        remaining %= 100;
        if digit == 1 {
            out.extend_from_slice(core.small_units_100);
        } else if let Some(special) = find_special(core.special_hundreds, digit) {
            out.extend_from_slice(special);
        } else {
            push_digit_token(&mut out, digit, core, options)?;
            out.extend_from_slice(core.small_units_100);
        }
    }

    if remaining >= 10 {
        let digit = remaining / 10;
        remaining %= 10;
        if digit == 1 {
            out.extend_from_slice(core.small_units_10);
        } else {
            push_digit_token(&mut out, digit, core, options)?;
            out.extend_from_slice(core.small_units_10);
        }
    }

    if remaining > 0 {
        push_digit_token(&mut out, remaining, core, options)?;
    }

    Ok(out)
}

fn push_digit_token(
    out: &mut TokenBuf,
    digit: u32,
    core: &CoreRules,
    options: &ReadOptions,
) -> Result<(), String> {
    let token = match digit {
        4 => match options.four.unwrap_or(core.default_variant.four) {
            FourVariant::Yon => core.variants.four.yon,
            FourVariant::Shi => core.variants.four.shi,
        },
        7 => match options.seven.unwrap_or(core.default_variant.seven) {
            SevenVariant::Nana => core.variants.seven.nana,
            SevenVariant::Shichi => core.variants.seven.shichi,
        },
        9 => match options.nine.unwrap_or(core.default_variant.nine) {
            NineVariant::Kyu => core.variants.nine.kyu,
            NineVariant::Ku => core.variants.nine.ku,
        },
        d if d <= 9 => {
            let tokens = core.digits[d as usize];
            if tokens.is_empty() {
                return Err(format!("digit {} has empty token set", d));
            }
            tokens[0]
        }
        d => return Err(format!("invalid digit: {d}")),
    };

    out.push(token);
    Ok(())
}

fn find_special(entries: &[(u8, Tokens)], digit: u32) -> Option<Tokens> {
    entries
        .iter()
        .find(|(d, _)| *d as u32 == digit)
        .map(|(_, tokens)| *tokens)
}

fn find_big_unit(core: &CoreRules, pow10: u32) -> Option<Tokens> {
    core.big_units
        .iter()
        .find(|(p, _)| *p == pow10)
        .map(|(_, tokens)| *tokens)
}

fn resolve_counter_compose(counter: &CounterDef, options: &ReadOptions) -> Option<Compose> {
    let requested_mode = options.mode_for(counter.id);
    let mode_name = match requested_mode {
        Some(mode_id) if counter.modes.iter().any(|m| m.id == mode_id) => Some(mode_id),
        _ => counter.default_mode,
    };

    let mode_compose = mode_name.and_then(|mode_id| {
        counter
            .modes
            .iter()
            .find(|m| m.id == mode_id)
            .map(|m| m.compose)
    });

    mode_compose.or(counter.compose)
}

fn apply_counter(
    counter: &CounterDef,
    number: &NumberValue,
    base_tokens: &TokenBuf,
    options: &ReadOptions,
    rules: &RuntimeRules,
) -> TokenBuf {
    let compose = resolve_counter_compose(counter, options);
    let Some(compose) = compose else {
        return base_tokens.clone();
    };

    apply_compose(compose, number, base_tokens, rules)
}

fn apply_counter_decimal(
    counter: &CounterDef,
    base_tokens: &TokenBuf,
    options: &ReadOptions,
    rules: &RuntimeRules,
) -> Result<TokenBuf, String> {
    let compose = resolve_counter_compose(counter, options);
    let Some(compose) = compose else {
        return Ok(base_tokens.clone());
    };

    let Some(suffix) = resolve_decimal_compose_suffix(compose, rules) else {
        return Err(format!("Decimal values with counter '{}' are not supported", counter.id));
    };

    let mut out = TokenBuf::with_capacity(base_tokens.len() + suffix.len());
    out.extend_from_slice(base_tokens);
    out.extend_from_slice(suffix);
    Ok(out)
}

fn apply_compose(
    compose: Compose,
    number: &NumberValue,
    base_tokens: &TokenBuf,
    rules: &RuntimeRules,
) -> TokenBuf {
    match compose {
        Compose::Concat(suffix) => {
            let mut out = TokenBuf::with_capacity(base_tokens.len() + suffix.len());
            out.extend_from_slice(base_tokens);
            out.extend_from_slice(suffix);
            out
        }
        Compose::Pattern(pattern_compose) => {
            apply_pattern_compose(pattern_compose, base_tokens, rules)
        }
        Compose::ExceptionsFirst(ex_compose) => {
            if let Some(ex_tokens) = lookup_exception(ex_compose.exceptions, number) {
                let mut out = TokenBuf::with_capacity(ex_tokens.len());
                out.extend_from_slice(ex_tokens);
                return out;
            }
            match ex_compose.fallback {
                FallbackCompose::Concat(suffix) => {
                    let mut out = TokenBuf::with_capacity(base_tokens.len() + suffix.len());
                    out.extend_from_slice(base_tokens);
                    out.extend_from_slice(suffix);
                    out
                }
                FallbackCompose::Pattern(pattern_compose) => {
                    apply_pattern_compose(pattern_compose, base_tokens, rules)
                }
            }
        }
    }
}

fn lookup_exception(exceptions: &[ExceptionDef], number: &NumberValue) -> Option<Tokens> {
    if let Some(abs_num) = number.abs_i64() {
        if let Some(found) = exceptions.iter().find(|e| e.key_num == Some(abs_num)) {
            return Some(found.tokens);
        }
    }

    let key = number.abs_string();
    exceptions.iter().find(|e| e.key == key).map(|e| e.tokens)
}

fn apply_pattern_compose(
    pattern_compose: PatternCompose,
    base_tokens: &TokenBuf,
    rules: &RuntimeRules,
) -> TokenBuf {
    let Some(pattern) = rules.patterns_by_id.get(pattern_compose.pattern_id) else {
        return base_tokens.clone();
    };

    let (mut rewritten, form_key) = apply_tail_pattern(pattern, base_tokens);
    if let Some(form) = pattern_compose.forms.iter().find(|f| f.key == form_key) {
        rewritten.extend_from_slice(form.tokens);
        rewritten
    } else {
        base_tokens.clone()
    }
}

fn resolve_decimal_pattern_suffix(
    pattern_compose: PatternCompose,
    rules: &RuntimeRules,
) -> Option<Tokens> {
    if let Some(pattern) = rules.patterns_by_id.get(pattern_compose.pattern_id) {
        if let Some(form) = pattern_compose
            .forms
            .iter()
            .find(|f| f.key == pattern.default_form)
        {
            return Some(form.tokens);
        }
    }

    if let Some(form) = pattern_compose.forms.iter().find(|f| f.key == "h") {
        return Some(form.tokens);
    }

    pattern_compose.forms.first().map(|form| form.tokens)
}

fn resolve_decimal_compose_suffix(compose: Compose, rules: &RuntimeRules) -> Option<Tokens> {
    match compose {
        Compose::Concat(suffix) => Some(suffix),
        Compose::Pattern(pattern_compose) => resolve_decimal_pattern_suffix(pattern_compose, rules),
        Compose::ExceptionsFirst(ex_compose) => match ex_compose.fallback {
            FallbackCompose::Concat(suffix) => Some(suffix),
            FallbackCompose::Pattern(pattern_compose) => {
                resolve_decimal_pattern_suffix(pattern_compose, rules)
            }
        },
    }
}

fn apply_tail_pattern(pattern: &PatternDef, tokens: &TokenBuf) -> (TokenBuf, &'static str) {
    if tokens.is_empty() {
        return (tokens.clone(), pattern.default_form);
    }

    let tail = tokens[tokens.len() - 1];
    for rule in pattern.rules {
        if !rule.when_tail_in.iter().any(|t| *t == tail) {
            continue;
        }

        let mut next = tokens.clone();
        if let Some(rewrite) = rule.rewrite_tail.iter().find(|rw| rw.from == tail) {
            let last = next.len() - 1;
            next[last] = rewrite.to;
        }

        let form = rule.use_form.unwrap_or(pattern.default_form);
        return (next, form);
    }

    (tokens.clone(), pattern.default_form)
}

fn join_tokens(tokens: &[Token]) -> String {
    let capacity: usize = tokens.iter().map(|t| t.len()).sum();
    let mut out = String::with_capacity(capacity);
    for token in tokens {
        out.push_str(token);
    }
    out
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}
