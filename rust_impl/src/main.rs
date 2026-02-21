use num_yomi_rust::{
    read, replace_in_text, FourVariantOpt, NineVariantOpt, ReadConfig, SevenVariantOpt, ZeroVariantOpt,
};
use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

#[derive(Debug)]
struct BenchCase {
    input: String,
    expected: String,
    config: Option<ReadConfig>,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
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

    if let Err(err) = result {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn print_usage() {
    eprintln!(
        "Usage:\n  num-yomi-rust read <input> [--zero rei|zero] [--four yon|shi] [--seven nana|shichi] [--nine kyu|ku] [--mode counter=mode] [--strict]\n  num-yomi-rust replace <input> [--zero rei|zero] [--four yon|shi] [--seven nana|shichi] [--nine kyu|ku] [--mode counter=mode] [--strict]\n  num-yomi-rust bench [--cases path] [--iterations N]"
    );
}

fn run_read(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("read requires an input".to_string());
    }

    let input = &args[0];
    let config = parse_cli_config(&args[1..])?;
    let output = read(input, config.as_ref())?;

    match output {
        Some(value) => {
            println!("{value}");
            Ok(())
        }
        None => Err("Unable to parse".to_string()),
    }
}

fn run_replace(args: &[String]) -> Result<(), String> {
    if args.is_empty() {
        return Err("replace requires an input".to_string());
    }

    let input = &args[0];
    let config = parse_cli_config(&args[1..])?;
    let output = replace_in_text(input, config.as_ref())?;
    println!("{output}");
    Ok(())
}

fn parse_cli_config(args: &[String]) -> Result<Option<ReadConfig>, String> {
    let mut config = ReadConfig::default();
    let mut touched = false;

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--zero" => {
                i += 1;
                if i >= args.len() {
                    return Err("--zero expects rei or zero".to_string());
                }
                config.zero = Some(parse_zero_variant(&args[i])?);
                touched = true;
            }
            "--four" => {
                i += 1;
                if i >= args.len() {
                    return Err("--four expects yon or shi".to_string());
                }
                config.four = Some(parse_four_variant(&args[i])?);
                touched = true;
            }
            "--seven" => {
                i += 1;
                if i >= args.len() {
                    return Err("--seven expects nana or shichi".to_string());
                }
                config.seven = Some(parse_seven_variant(&args[i])?);
                touched = true;
            }
            "--nine" => {
                i += 1;
                if i >= args.len() {
                    return Err("--nine expects kyu or ku".to_string());
                }
                config.nine = Some(parse_nine_variant(&args[i])?);
                touched = true;
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
                config = config.with_mode(value[..eq_pos].to_string(), value[eq_pos + 1..].to_string());
                touched = true;
            }
            "--strict" => {
                config.strict = true;
                touched = true;
            }
            other => return Err(format!("Unknown option: {other}")),
        }
        i += 1;
    }

    if touched {
        Ok(Some(config))
    } else {
        Ok(None)
    }
}

fn parse_zero_variant(input: &str) -> Result<ZeroVariantOpt, String> {
    match input {
        "rei" => Ok(ZeroVariantOpt::Rei),
        "zero" => Ok(ZeroVariantOpt::Zero),
        _ => Err(format!("Invalid zero variant: {input}")),
    }
}

fn parse_four_variant(input: &str) -> Result<FourVariantOpt, String> {
    match input {
        "yon" => Ok(FourVariantOpt::Yon),
        "shi" => Ok(FourVariantOpt::Shi),
        _ => Err(format!("Invalid four variant: {input}")),
    }
}

fn parse_seven_variant(input: &str) -> Result<SevenVariantOpt, String> {
    match input {
        "nana" => Ok(SevenVariantOpt::Nana),
        "shichi" => Ok(SevenVariantOpt::Shichi),
        _ => Err(format!("Invalid seven variant: {input}")),
    }
}

fn parse_nine_variant(input: &str) -> Result<NineVariantOpt, String> {
    match input {
        "kyu" => Ok(NineVariantOpt::Kyu),
        "ku" => Ok(NineVariantOpt::Ku),
        _ => Err(format!("Invalid nine variant: {input}")),
    }
}

fn run_bench(args: &[String]) -> Result<(), String> {
    let mut cases_path = PathBuf::from("test/cases.json");
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
            other => return Err(format!("Unknown option: {other}")),
        }
        i += 1;
    }

    let cases = load_cases(&cases_path)?;

    let mut out_cases: Vec<Value> = Vec::new();
    let mut total_ns: u128 = 0;

    for (index, case) in cases.iter().enumerate() {
        let warmup = read(&case.input, case.config.as_ref())?;
        if warmup.as_deref() != Some(case.expected.as_str()) {
            return Err(format!(
                "Case mismatch at index {index}: in={} expected={} actual={warmup:?}",
                case.input, case.expected
            ));
        }

        let start = Instant::now();
        for _ in 0..iterations {
            let _ = read(&case.input, case.config.as_ref())?;
        }
        let elapsed_ns = start.elapsed().as_nanos();
        total_ns += elapsed_ns;

        out_cases.push(json!({
            "index": index,
            "input": case.input,
            "expected": case.expected,
            "avg_ns": (elapsed_ns / iterations as u128) as u64,
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

fn load_cases(path: &PathBuf) -> Result<Vec<BenchCase>, String> {
    let raw =
        fs::read_to_string(path).map_err(|e| format!("Failed to read cases file {}: {e}", path.display()))?;
    let value: Value = serde_json::from_str(&raw).map_err(|e| format!("Failed to parse cases JSON: {e}"))?;

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

        let config = parse_case_config(obj.get("opts"))?;

        out.push(BenchCase {
            input,
            expected,
            config,
        });
    }

    Ok(out)
}

fn parse_case_config(opts_value: Option<&Value>) -> Result<Option<ReadConfig>, String> {
    let Some(opts) = opts_value else {
        return Ok(None);
    };

    let obj = opts
        .as_object()
        .ok_or_else(|| "opts must be an object".to_string())?;

    let mut config = ReadConfig::default();
    let mut touched = false;

    if let Some(strict) = obj.get("strict").and_then(Value::as_bool) {
        config.strict = strict;
        touched = true;
    }

    if let Some(variant) = obj.get("variant") {
        let vobj = variant
            .as_object()
            .ok_or_else(|| "opts.variant must be an object".to_string())?;

        if let Some(zero) = vobj.get("zero").and_then(Value::as_str) {
            config.zero = Some(parse_zero_variant(zero)?);
            touched = true;
        }

        if let Some(four) = vobj.get("four").and_then(Value::as_str) {
            config.four = Some(parse_four_variant(four)?);
            touched = true;
        }

        if let Some(seven) = vobj.get("seven").and_then(Value::as_str) {
            config.seven = Some(parse_seven_variant(seven)?);
            touched = true;
        }

        if let Some(nine) = vobj.get("nine").and_then(Value::as_str) {
            config.nine = Some(parse_nine_variant(nine)?);
            touched = true;
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
            config = config.with_mode(counter_id.clone(), mode_id.to_string());
            touched = true;
        }
    }

    if touched {
        Ok(Some(config))
    } else {
        Ok(None)
    }
}
