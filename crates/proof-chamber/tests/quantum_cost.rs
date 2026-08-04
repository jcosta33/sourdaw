//! ProofChamber's native per-quantum cost, for the table in
//! `crates/daw-dsp/benches/quantum-cost-table.md`.
//!
//! # The budget, and why it is that number
//!
//! **2.667 ms.** An `AudioWorkletProcessor` renders 128 frames per call — fixed
//! by the Web Audio specification — and the project runs at 48 kHz, so one
//! quantum has 128 / 48_000 = 2.6667 ms of wall clock. It is the sample rate
//! and the spec, not a policy that can be revisited, and the whole of it
//! belongs to the *sum* of everything on the audio thread rather than to any
//! one device.
//!
//! # Why this is a `tests/` file and not a criterion bench
//!
//! Because criterion would have to be a dev-dependency of this crate, and a
//! dev-dependency is a `Cargo.toml` edit. `Cargo.toml` is hashed into the
//! crate-source fingerprint that `pnpm wasm:verify` pins, so adding one
//! invalidates the committed `proof_chamber_bg.wasm` provenance and forces a
//! manifest regeneration for a measurement change. `tests/` is excluded from
//! that hash, and `std::time::Instant` needs no dependency at all.
//!
//! For the same reason ProofChamber is not a row in `daw-dsp`'s bench: making
//! it one would pull this crate's sources into `daw-dsp`'s wasm hash, so that
//! editing a reverb would invalidate the DSP crate's artifacts.
//!
//! # Running it
//!
//! ```text
//! CARGO_PROFILE_RELEASE_LTO=false \
//!   cargo test -p proof-chamber --release --test quantum_cost -- --ignored --nocapture
//! ```
//!
//! `--test quantum_cost` is load-bearing, and the reason is pre-existing: this
//! crate's *unit* tests do not build in release at all. `assert_no_alloc`'s
//! `disable_release` feature is on by default, so `AllocDisabler` is configured
//! out of a release build and `src/lib.rs`'s `use assert_no_alloc::{...,
//! AllocDisabler}` fails to resolve. Naming the integration-test target skips
//! that target. (`cargo test -p daw-dsp --release` fails for a different
//! pre-existing reason — `-C embed-bitcode=no` against the workspace
//! `lto = true` — reproducible on a pristine `origin/main`.)
//!
//! `#[ignore]`d because it takes tens of seconds and prints rather than
//! asserts a cost — but it is not assertion-free: it fails if the reverb is not
//! actually passing signal, because a silent engine's cost is the cost of the
//! branch that skips the DSP.
//!
//! `CARGO_PROFILE_RELEASE_LTO=false` mirrors the `CARGO_PROFILE_BENCH_LTO=false`
//! the daw-dsp bench needs, so the two native columns are built the same way.
//! Debug is not an option: this crate's numbers would be an order of magnitude
//! out and would mean nothing.
//!
//! # What this measures and does not
//!
//! Compute per quantum. Not a dropout: nothing here has a deadline. "Its
//! compute exceeds the budget" and "it misses the deadline" are different
//! claims.

use std::time::Instant;

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const QUANTUM: usize = 128;

/// 128 frames at 48 kHz, in nanoseconds.
const BUDGET_NS: f64 = 2_666_667.0;

/// Untimed quanta before any timed one, matching the daw-dsp bench and the wasm
/// leg so the three columns are comparable.
const WARMUP_QUANTA: usize = 4_000;

/// Timed quanta per algorithm. 20 000 x 128 frames is 53 s of rendered audio.
/// Still not a worst case — a session renders ~1.7M quanta an hour.
const SAMPLE_QUANTA: usize = 20_000;

/// The excitation `daw-dsp`'s `tests/engine_output_level.rs` and the wasm leg's
/// `deviceRecipes.js` both use, so every column sees the same signal.
fn excitation(frame: usize) -> (f32, f32) {
    let t = frame as f32 / SAMPLE_RATE;
    let fundamental = (t * 110.0 * std::f32::consts::TAU).sin();
    let second = (t * 220.0 * std::f32::consts::TAU).sin() * 0.5;
    let third = (t * 440.0 * std::f32::consts::TAU).sin() * 0.25;
    let phase = (frame % 4_800) as f32 / SAMPLE_RATE;
    let pick = (-phase * 60.0).exp() * 0.6;
    let body = (fundamental + second + third) * 0.28;
    (body * (1.0 + pick), body * (1.0 + pick * 0.8))
}

fn quantile(sorted: &[u64], fraction: f64) -> f64 {
    let rank = (fraction * sorted.len() as f64).ceil() as usize;
    sorted[rank.saturating_sub(1).min(sorted.len() - 1)] as f64
}

fn mean_of(samples: &[u64]) -> f64 {
    samples.iter().map(|value| *value as f64).sum::<f64>() / samples.len() as f64
}

/// The one-minute load average, or `None` where it cannot be read.
///
/// Here because the first full run of this table was taken while another agent
/// worktree ran the whole vitest suite: load average 25 on a 12-core machine.
/// The numbers looked like a measurement of a device and were partly a
/// measurement of the scheduler, and nothing in the output said so.
fn load_average() -> Option<f64> {
    let output = std::process::Command::new("/usr/bin/uptime")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let tail = text
        .rsplit_once("load averages:")
        .or_else(|| text.rsplit_once("load average:"))?
        .1;
    tail.split_whitespace()
        .next()?
        .trim_end_matches(',')
        .parse()
        .ok()
}

/// Half the logical cores. This harness is single-threaded, so a quiet machine
/// sits near 1; above this the DSP is sharing cores with something else.
fn load_ceiling() -> f64 {
    std::thread::available_parallelism().map_or(4.0, |cores| cores.get() as f64 / 2.0)
}

/// The reverb algorithms a user can actually select. Convolution (4) and Hybrid
/// (5) are excluded because `ProofChamberInstance::set_param` falls them through
/// to Plate — no impulse response ships and `load_ir` has no caller — so
/// selecting them would benchmark Plate under another name.
const ALGORITHMS: [(&str, f32); 5] = [
    ("Plate (shipped default)", 0.0),
    ("FDN-8", 1.0),
    ("FDN-16", 2.0),
    ("Spring", 3.0),
    ("Reverse", 6.0),
];

#[test]
#[ignore = "prints a cost table; takes tens of seconds and must be run --release"]
fn proof_chamber_per_quantum_cost() {
    let load_before = load_average();
    eprintln!("\n=== ProofChamber per-quantum cost — NATIVE ===\n");
    eprintln!(
        "budget {:.4} ms = 128 frames / 48 kHz; arch {}; {WARMUP_QUANTA} warm-up quanta, \
         {SAMPLE_QUANTA} timed quanta per row",
        BUDGET_NS / 1.0e6,
        std::env::consts::ARCH
    );
    eprintln!(
        "\n{:<44} {:>9} {:>9} {:>9} | {:>9} {:>9}",
        "algorithm", "FLOOR", "median", "p95", "floor %", "median %"
    );

    let mut silent: Vec<&str> = Vec::new();

    for (name, algorithm) in ALGORITHMS {
        let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
        instance.set_param("algorithm", algorithm);
        instance.set_param("mix", 0.4);
        instance.set_param("decay", 0.6);

        let mut left = [0.0_f32; QUANTUM];
        let mut right = [0.0_f32; QUANTUM];
        let mut fill = |block: usize, left: &mut [f32; QUANTUM], right: &mut [f32; QUANTUM]| {
            for frame in 0..QUANTUM {
                let (l, r) = excitation(block * QUANTUM + frame);
                left[frame] = l;
                right[frame] = r;
            }
        };

        for block in 0..WARMUP_QUANTA {
            fill(block, &mut left, &mut right);
            std::hint::black_box(instance.process(&left, &right, QUANTUM as u32));
        }

        let mut samples = Vec::with_capacity(SAMPLE_QUANTA);
        for block in 0..SAMPLE_QUANTA {
            fill(WARMUP_QUANTA + block, &mut left, &mut right);
            let start = Instant::now();
            let produced = instance.process(&left, &right, QUANTUM as u32);
            let elapsed = start.elapsed();
            std::hint::black_box(produced);
            samples.push(elapsed.as_nanos() as u64);
        }

        // Occupancy: the reverb has to be passing signal. A bypassed or silent
        // engine costs the branch that skips the DSP, not the DSP.
        fill(WARMUP_QUANTA + SAMPLE_QUANTA, &mut left, &mut right);
        let out = instance.process(&left, &right, QUANTUM as u32);
        let mut sum = 0.0_f64;
        for frame in 0..QUANTUM {
            // SAFETY: `process` returns a pointer to its own `out_left`, which
            // is 1024 long and was just written for `QUANTUM` frames.
            let sample = unsafe { *out.add(frame) } as f64;
            sum += sample * sample;
        }
        let rms = (sum / QUANTUM as f64).sqrt();
        if rms <= 1.0e-5 {
            silent.push(name);
        }

        let head = mean_of(&samples[..500]);
        let tail = mean_of(&samples[samples.len() - 500..]);
        samples.sort_unstable();
        let floor = quantile(&samples, 0.01);
        let median = quantile(&samples, 0.5);
        let p95 = quantile(&samples, 0.95);
        let p99 = quantile(&samples, 0.99);
        let max = *samples.last().expect("timed at least one quantum") as f64;
        let pct = |ns: f64| (ns / BUDGET_NS) * 100.0;

        eprintln!(
            "{name:<44} {:>8.1}us {:>8.1}us {:>8.1}us | {:>8.2}% {:>8.2}%",
            floor / 1000.0,
            median / 1000.0,
            p95 / 1000.0,
            pct(floor),
            pct(median),
        );
        eprintln!(
            "      occupancy: output RMS {rms:.3e}; drift first 500 {:.1}us -> last 500 {:.1}us \
             ({:+.1}%), n = {}",
            head / 1000.0,
            tail / 1000.0,
            (tail / head - 1.0) * 100.0,
            samples.len()
        );
    }

    assert!(
        silent.is_empty(),
        "these algorithms produced no output, so their cost figures are the cost of skipping the \
         DSP rather than of running it: {silent:?}"
    );

    // Load is **recorded, never gated**. The machine this runs on sustains a
    // load average of 20-180 from ordinary desktop applications and never falls
    // to an "idle" threshold, so a gate here meant no measurement at all.
    //
    // The escape is that contention is one-directional: it only ever adds time
    // to a sample. So the FLOOR printed above is a genuine lower bound taken
    // under load, and the median is an upper bound on what a quiet machine
    // would show. Neither bounds the deadline — that is AC-3's question.
    let ceiling = load_ceiling();
    let busiest = [load_before, load_average()]
        .into_iter()
        .flatten()
        .fold(0.0_f64, f64::max);
    eprintln!(
        "      machine  : 1-minute load average peaked at {busiest:.2} (recorded, not gated; \
         reference quiet threshold {ceiling:.1})"
    );
}
