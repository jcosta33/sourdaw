//! The tuner's native per-quantum cost, for the table in
//! `crates/daw-dsp/benches/quantum-cost-table.md`.
//!
//! # The budget, and why it is that number
//!
//! **2.667 ms.** An `AudioWorkletProcessor` renders 128 frames per call — fixed
//! by the Web Audio specification — and the project runs at 48 kHz, so one
//! quantum has 128 / 48_000 = 2.6667 ms of wall clock. It is the sample rate
//! and the spec, not a policy, and the whole of it belongs to the *sum* of
//! everything on the audio thread.
//!
//! Scoring is the one device in the table that is not part of a mix: it renders
//! only while the tuner surface is open. It is measured because "only while the
//! tuner is open" is exactly when a user is least able to tolerate a dropout,
//! and because a pitch tracker is an FFT, which is the shape of thing that
//! surprises people.
//!
//! # Why this is a `tests/` file and not a criterion bench
//!
//! Criterion would be a dev-dependency, which is a `Cargo.toml` edit, and
//! `Cargo.toml` is hashed into the crate-source fingerprint `pnpm wasm:verify`
//! pins — so adding one would invalidate the committed `scoring_bg.wasm`
//! provenance for a measurement change. `tests/` is excluded from that hash and
//! `std::time::Instant` needs no dependency.
//!
//! # Running it
//!
//! ```text
//! CARGO_PROFILE_RELEASE_LTO=false \
//!   cargo test -p scoring --release --test quantum_cost -- --ignored --nocapture
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
//! `#[ignore]`d because it takes tens of seconds and prints rather than asserts
//! a cost — but it does assert that the tracker actually locked onto the
//! stimulus, because an idle detector's cost is not the detector's cost.
//!
//! # What this measures and does not
//!
//! Compute per quantum. Not a dropout: nothing here has a deadline.

use std::time::Instant;

use scoring::ScoringInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const QUANTUM: usize = 128;

/// 128 frames at 48 kHz, in nanoseconds.
const BUDGET_NS: f64 = 2_666_667.0;

const WARMUP_QUANTA: usize = 4_000;
const SAMPLE_QUANTA: usize = 20_000;

/// The fundamental the stimulus is built on; the tracker must find it.
const STIMULUS_FUNDAMENTAL_HZ: f32 = 110.0;

/// The excitation every other column in the table uses.
fn excitation(frame: usize) -> (f32, f32) {
    let t = frame as f32 / SAMPLE_RATE;
    let fundamental = (t * STIMULUS_FUNDAMENTAL_HZ * std::f32::consts::TAU).sin();
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

#[test]
#[ignore = "prints a cost table; takes tens of seconds and must be run --release"]
fn scoring_per_quantum_cost() {
    let load_before = load_average();
    let mut instance = ScoringInstance::new(SAMPLE_RATE);
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

    let detected = instance.get_frequency();
    let confidence = instance.get_confidence();

    let head = mean_of(&samples[..500]);
    let tail = mean_of(&samples[samples.len() - 500..]);
    samples.sort_unstable();
    let floor = quantile(&samples, 0.01);
    let median = quantile(&samples, 0.5);
    let p95 = quantile(&samples, 0.95);
    let p99 = quantile(&samples, 0.99);
    let max = *samples.last().expect("timed at least one quantum") as f64;
    let pct = |ns: f64| (ns / BUDGET_NS) * 100.0;

    eprintln!("\n=== Scoring / Tuner per-quantum cost — NATIVE ===\n");
    eprintln!(
        "budget {:.4} ms = 128 frames / 48 kHz; arch {}; {WARMUP_QUANTA} warm-up quanta, \
         {SAMPLE_QUANTA} timed quanta",
        BUDGET_NS / 1.0e6,
        std::env::consts::ARCH
    );
    eprintln!(
        "\n{:<44} {:>9} {:>9} {:>9} | {:>9} {:>9}",
        "device", "FLOOR", "median", "p95", "floor %", "median %"
    );
    eprintln!(
        "{:<44} {:>8.1}us {:>8.1}us {:>8.1}us | {:>8.2}% {:>8.2}%",
        "Scoring / Tuner (pitch detection running)",
        floor / 1000.0,
        median / 1000.0,
        p95 / 1000.0,
        pct(floor),
        pct(median),
    );
    eprintln!(
        "      occupancy: detected {detected:.1} Hz at confidence {confidence:.2} against a \
         {STIMULUS_FUNDAMENTAL_HZ:.0} Hz stimulus"
    );
    eprintln!(
        "      drift    : first 500 {:.1}us -> last 500 {:.1}us ({:+.1}%), n = {}",
        head / 1000.0,
        tail / 1000.0,
        (tail / head - 1.0) * 100.0,
        samples.len()
    );

    // The tracker has to have locked on. An idle detector short-circuits, and
    // its cost is the cost of the gate, not of the analysis.
    assert!(
        (detected - STIMULUS_FUNDAMENTAL_HZ).abs() < 2.0,
        "the tuner reported {detected:.2} Hz against a {STIMULUS_FUNDAMENTAL_HZ:.0} Hz stimulus, \
         so the figures above are the cost of a detector that never engaged"
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
