use num_yomi_rust::{parse_read_config, ReadConfig};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Debug)]
struct BenchCase {
    input: String,
    expected: String,
    config: Option<ReadConfig>,
}

pub fn run_bench<F, T>(
    impl_name: &str,
    default_cases_path: &str,
    mut invoke: F,
) -> Result<(), String>
where
    F: FnMut(&str, Option<&ReadConfig>) -> Result<T, String>,
    T: AsRef<str>,
{
    let args: Vec<String> = std::env::args().collect();
    let (cases_path, iterations) = parse_args(&args[1..], default_cases_path)?;
    let cases = load_cases(&cases_path)?;

    let mut out_cases: Vec<Value> = Vec::with_capacity(cases.len());
    let mut total_ns: u128 = 0;

    for (index, case) in cases.iter().enumerate() {
        let warmup = invoke(&case.input, case.config.as_ref())?;
        if warmup.as_ref() != case.expected {
            return Err(format!(
                "Case mismatch at index {index}: in={} expected={} actual={}",
                case.input,
                case.expected,
                warmup.as_ref()
            ));
        }

        let start = Instant::now();
        for _ in 0..iterations {
            let _ = invoke(&case.input, case.config.as_ref())?;
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
            "impl": impl_name,
            "iterations": iterations,
            "cases": out_cases,
            "total_ns": total_ns as u64,
            "total_ms": (total_ns as f64) / 1_000_000.0,
        })
    );

    Ok(())
}

fn parse_args(args: &[String], default_cases_path: &str) -> Result<(PathBuf, u64), String> {
    let mut cases_path = PathBuf::from(default_cases_path);
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
            other => return Err(format!("Unknown flag: {other}")),
        }
        i += 1;
    }

    Ok((cases_path, iterations))
}

fn load_cases(path: &Path) -> Result<Vec<BenchCase>, String> {
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

        let config = parse_read_config(obj.get("opts"))?;

        out.push(BenchCase {
            input,
            expected,
            config,
        });
    }

    Ok(out)
}
