#[path = "../bench_common.rs"]
mod bench_common;
use num_yomi_rust::replace_in_text_shared;

fn main() {
    if let Err(err) = bench_common::run_bench(
        "rust-replace-call",
        "test/replace_cases.json",
        replace_in_text_shared,
    ) {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
