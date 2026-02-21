#[path = "../bench_common.rs"]
mod bench_common;
use num_yomi_rust::read_shared;

fn main() {
    if let Err(err) = bench_common::run_bench("rust-call", "test/cases.json", |input, config| {
        read_shared(input, config)?.ok_or_else(|| "Unable to parse".to_string())
    }) {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
