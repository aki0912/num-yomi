use num_yomi_rust::replace_in_text_shared;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();

    let mut input_path = PathBuf::from("test/sample.txt");
    let mut expected_path = PathBuf::from("test/sample.expected.txt");
    let mut iterations: u64 = 2_000;
    let mut variant_count: Option<usize> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--input" => {
                i += 1;
                if i >= args.len() {
                    return Err("--input requires a path".to_string());
                }
                input_path = PathBuf::from(&args[i]);
            }
            "--expected" => {
                i += 1;
                if i >= args.len() {
                    return Err("--expected requires a path".to_string());
                }
                expected_path = PathBuf::from(&args[i]);
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
            "--variant-count" => {
                i += 1;
                if i >= args.len() {
                    return Err("--variant-count requires a number".to_string());
                }
                let parsed = args[i]
                    .parse::<usize>()
                    .map_err(|_| "--variant-count must be a positive integer".to_string())?;
                if parsed == 0 {
                    return Err("--variant-count must be > 0".to_string());
                }
                variant_count = Some(parsed);
            }
            other => return Err(format!("Unknown flag: {other}")),
        }
        i += 1;
    }

    let variant_count = variant_count.unwrap_or(std::cmp::min(iterations as usize, 4_096));

    let input_text = fs::read_to_string(&input_path)
        .map_err(|e| format!("Failed to read input file {}: {e}", input_path.display()))?;
    let expected_text = fs::read_to_string(&expected_path).map_err(|e| {
        format!(
            "Failed to read expected file {}: {e}",
            expected_path.display()
        )
    })?;

    let warmup = replace_in_text_shared(&input_text, None)?;
    if warmup.as_ref() != expected_text.as_str() {
        return Err("Sample output mismatch for Rust implementation".to_string());
    }

    let mut variant_inputs = Vec::with_capacity(variant_count);
    let mut variant_expected = Vec::with_capacity(variant_count);
    for idx in 0..variant_count {
        let suffix = format!("\n__SAMPLE_BENCH_TAG_{}__", to_alphabet_tag(idx));
        variant_inputs.push(format!("{input_text}{suffix}"));
        variant_expected.push(format!("{expected_text}{suffix}"));
    }

    let warmup_variant = replace_in_text_shared(&variant_inputs[0], None)?;
    if warmup_variant.as_ref() != variant_expected[0].as_str() {
        return Err("Sample variant output mismatch for Rust implementation".to_string());
    }

    let start = Instant::now();
    for idx in 0..iterations {
        let variant_idx = (idx as usize) % variant_count;
        let actual = replace_in_text_shared(&variant_inputs[variant_idx], None)?;
        if actual.as_ref() != variant_expected[variant_idx].as_str() {
            return Err(format!("Sample variant mismatch at iteration={idx}"));
        }
    }
    let elapsed_ns = start.elapsed().as_nanos();

    println!(
        "{}",
        json!({
            "impl": "rust-sample-replace-call",
            "iterations": iterations,
            "variant_count": variant_count,
            "input_path": input_path.display().to_string(),
            "expected_path": expected_path.display().to_string(),
            "input_bytes": variant_inputs[0].as_bytes().len(),
            "avg_ns": (elapsed_ns / iterations as u128) as u64,
            "total_ns": elapsed_ns as u64,
            "total_ms": (elapsed_ns as f64) / 1_000_000.0,
        })
    );

    Ok(())
}

fn to_alphabet_tag(index: usize) -> String {
    let mut value = index;
    let mut chars: Vec<char> = Vec::new();
    loop {
        chars.push((b'A' + (value % 26) as u8) as char);
        if value < 26 {
            break;
        }
        value = (value / 26) - 1;
    }
    chars.into_iter().rev().collect()
}
