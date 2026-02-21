use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;
use yomi_rust::{
    replace_in_text_shared, FourVariantOpt, NineVariantOpt, ReadConfig, SevenVariantOpt, ZeroVariantOpt,
};

#[derive(Debug)]
struct BenchCase {
    input: String,
    expected: String,
    config: Option<ReadConfig>,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();

    let mut cases_path = PathBuf::from("test/replace_cases.json");
    let mut iterations: u64 = 20_000;

    let mut i = 1;
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
            other => return Err(format!("Unknown flag: {other}")),
        }
        i += 1;
    }

    let cases = load_cases(&cases_path)?;

    let mut out_cases: Vec<Value> = Vec::new();
    let mut total_ns: u128 = 0;

    for (index, case) in cases.iter().enumerate() {
        let warmup = replace_in_text_shared(&case.input, case.config.as_ref())?;
        if warmup.as_ref() != case.expected.as_str() {
            return Err(format!(
                "Case mismatch at index {index}: in={} expected={} actual={}",
                case.input, case.expected, warmup
            ));
        }

        let start = Instant::now();
        for _ in 0..iterations {
            let _ = replace_in_text_shared(&case.input, case.config.as_ref())?;
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
            "impl": "rust-replace-call",
            "iterations": iterations,
            "cases": out_cases,
            "total_ns": total_ns as u64,
            "total_ms": (total_ns as f64) / 1_000_000.0,
        })
    );

    Ok(())
}

fn load_cases(path: &PathBuf) -> Result<Vec<BenchCase>, String> {
    let raw = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read cases file {}: {e}", path.display()))?;
    let value: Value =
        serde_json::from_str(&raw).map_err(|e| format!("Failed to parse cases JSON: {e}"))?;

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

        let config = parse_config(obj.get("opts"))?;

        out.push(BenchCase {
            input,
            expected,
            config,
        });
    }

    Ok(out)
}

fn parse_config(opts_value: Option<&Value>) -> Result<Option<ReadConfig>, String> {
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
            config.zero = Some(match zero {
                "rei" => ZeroVariantOpt::Rei,
                "zero" => ZeroVariantOpt::Zero,
                _ => return Err(format!("Invalid zero variant: {zero}")),
            });
            touched = true;
        }

        if let Some(four) = vobj.get("four").and_then(Value::as_str) {
            config.four = Some(match four {
                "yon" => FourVariantOpt::Yon,
                "shi" => FourVariantOpt::Shi,
                _ => return Err(format!("Invalid four variant: {four}")),
            });
            touched = true;
        }

        if let Some(seven) = vobj.get("seven").and_then(Value::as_str) {
            config.seven = Some(match seven {
                "nana" => SevenVariantOpt::Nana,
                "shichi" => SevenVariantOpt::Shichi,
                _ => return Err(format!("Invalid seven variant: {seven}")),
            });
            touched = true;
        }

        if let Some(nine) = vobj.get("nine").and_then(Value::as_str) {
            config.nine = Some(match nine {
                "kyu" => NineVariantOpt::Kyu,
                "ku" => NineVariantOpt::Ku,
                _ => return Err(format!("Invalid nine variant: {nine}")),
            });
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
