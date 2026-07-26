//! Allocation guards for the Dutch Oven reverb's render path.
//!
//! The crate's only pre-existing `assert_no_alloc` site wraps `set_param_by_id`,
//! a control-rate entry point, so `ProofChamberInstance::process` — the thing
//! that runs on the audio thread — had no allocation coverage at all. On
//! `wasm32` an allocation there can call `memory.grow()` mid-block.
//!
//! One test per algorithm on purpose: a violation calls
//! `std::alloc::handle_alloc_error`, which aborts the whole test binary rather
//! than failing one case, so sharing a test across algorithms would hide which
//! one is at fault.
//!
//! Guarded here: the five algorithms the product can select (plate, fdn-8,
//! fdn-16, spring, reverse), plus Hybrid-in-its-default-mode, which is
//! compiled and rendered but which no wire value reaches. Convolution — and
//! Hybrid once its convolution routing is engaged — allocates per partition
//! boundary and so cannot be guarded today; rather than omit that, it is pinned
//! as a measured fact by the last test in this file.
//!
//! The two convolution-backed engines are built through `UnexposedEngine`
//! rather than an `algorithm` value, because no `algorithm` value selects them
//! any more. That is deliberate: they need an impulse response and nothing
//! delivers one. Reaching them by number here would build a Plate and guard
//! that instead, which is the quiet failure this file exists to prevent.

#![cfg(debug_assertions)]

use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use proof_chamber::{ProofChamberInstance, UnexposedEngine};

#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const GUARDED_BLOCKS: usize = 64;

const ALGORITHM_PLATE: f32 = 0.0;
const ALGORITHM_FDN8: f32 = 1.0;
const ALGORITHM_FDN16: f32 = 2.0;
const ALGORITHM_SPRING: f32 = 3.0;
// 4 and 5 are reserved for the convolution-backed engines and select nothing;
// those two are reached through `UnexposedEngine` instead.
const ALGORITHM_REVERSE: f32 = 6.0;

fn excitation(frame: usize) -> f32 {
    let t = frame as f32 / SAMPLE_RATE;
    // An impulse train keeps energy going into the tail for the whole run
    // instead of letting it decay to denormals halfway through.
    let tone = (t * 330.0 * std::f32::consts::TAU).sin() * 0.4;
    let click = if frame % 4_096 == 0 { 0.9 } else { 0.0 };
    tone + click
}

fn block_at(offset: usize) -> (Vec<f32>, Vec<f32>) {
    let left: Vec<f32> = (0..BLOCK).map(|i| excitation(offset + i)).collect();
    let right: Vec<f32> = (0..BLOCK).map(|i| excitation(offset + i + 17)).collect();
    (left, right)
}

/// # Safety
/// `ptr` must point to at least `BLOCK` readable `f32`s, which is what
/// `process` returns.
unsafe fn read_output(ptr: *const f32) -> Vec<f32> {
    assert!(!ptr.is_null(), "process returned a null buffer");
    (0..BLOCK).map(|i| *ptr.add(i)).collect()
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()))
}

/// Build an instance on `algorithm`, settle it, and return it with its input
/// blocks prepared. `set_param("algorithm", …)` reconstructs the engine and so
/// allocates by design — it is control-rate and stays outside every guard.
fn configured(algorithm: f32) -> ProofChamberInstance {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    instance.set_param("mix", 0.5);
    instance.set_param("decay", 0.7);
    instance.set_param("diffusion", 0.6);
    instance
}

/// Same, for an engine no wire value can select. `set_param("algorithm", …)`
/// cannot reach these, so the Rust-only selector stands in; it allocates by
/// construction and stays outside every guard, exactly like the wire path.
fn unexposed(which: UnexposedEngine) -> ProofChamberInstance {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.select_unexposed_engine(which);
    instance.set_param("mix", 0.5);
    instance.set_param("decay", 0.7);
    instance.set_param("diffusion", 0.6);
    instance
}

/// Warm up outside the guard, then run the block loop inside it. Returns the
/// last guarded output block so the caller can prove the reverb was audible.
fn guarded_run(instance: &mut ProofChamberInstance) -> Vec<f32> {
    guarded_run_after(instance, 8)
}

/// As above, but with the warm-up length under the caller's control. Reverse
/// fills an entire buffer before it replays a sample of it, so eight blocks of
/// warm-up leaves its wet path still empty when the guard opens.
fn guarded_run_after(instance: &mut ProofChamberInstance, warmup_blocks: usize) -> Vec<f32> {
    for block in 0..warmup_blocks {
        let (l, r) = block_at(block * BLOCK);
        let out = unsafe { read_output(instance.process(&l, &r, BLOCK as u32)) };
        for (i, s) in out.iter().enumerate() {
            assert!(s.is_finite(), "warm-up produced a non-finite sample at {i}");
        }
    }

    // Input blocks are built before the guard; only `process` runs inside it.
    let blocks: Vec<(Vec<f32>, Vec<f32>)> = (warmup_blocks..(warmup_blocks + GUARDED_BLOCKS))
        .map(|block| block_at(block * BLOCK))
        .collect();

    let mut last = std::ptr::null();
    assert_no_alloc(|| {
        for (l, r) in &blocks {
            last = instance.process(l, r, BLOCK as u32);
        }
    });

    unsafe { read_output(last) }
}

fn assert_audible(out: &[f32], algorithm: &str) {
    for (i, s) in out.iter().enumerate() {
        assert!(
            s.is_finite(),
            "{algorithm} produced a non-finite sample at {i}: {s}"
        );
    }
    assert!(
        peak(out) > 1e-4,
        "{algorithm} fell silent, so the guarded region did not exercise the reverb"
    );
}

#[test]
fn plate_process_does_not_allocate() {
    let mut instance = configured(ALGORITHM_PLATE);
    let out = guarded_run(&mut instance);
    assert_audible(&out, "plate");
}

#[test]
fn fdn8_process_does_not_allocate() {
    let mut instance = configured(ALGORITHM_FDN8);
    let out = guarded_run(&mut instance);
    assert_audible(&out, "fdn-8");
}

#[test]
fn fdn16_process_does_not_allocate() {
    let mut instance = configured(ALGORITHM_FDN16);
    let out = guarded_run(&mut instance);
    assert_audible(&out, "fdn-16");
}

#[test]
fn spring_process_does_not_allocate() {
    let mut instance = configured(ALGORITHM_SPRING);
    let out = guarded_run(&mut instance);
    assert_audible(&out, "spring");
}

/// Reverse writes a whole buffer before it replays any of it, so at the
/// default 1.5 s length nothing comes back inside a 72-block window. This
/// guard used to run `configured(ALGORITHM_REVERSE)` straight through
/// `guarded_run` and pass on the dry signal alone, executing none of the
/// reversal it claimed to cover — `mix` at 1.0 removes the dry path so only
/// the wet one can satisfy `assert_audible`, the shortest buffer (0.5 s =
/// 24 000 samples) brings the first buffer swap within reach, and the longer
/// warm-up carries the instance past it so the guarded blocks are replaying.
#[test]
fn reverse_process_does_not_allocate() {
    let mut instance = configured(ALGORITHM_REVERSE);
    instance.set_param("mix", 1.0);
    instance.set_param("size", 0.0);
    let out = guarded_run_after(&mut instance, 200);
    assert_audible(&out, "reverse");
}

/// Hybrid defaults to `HybridMode::Off`, which routes the algorithmic engine
/// only and never touches convolution. That default is allocation-free and is
/// guarded here; engaging its convolution routing is a different matter and is
/// pinned by the test below. The name says which of the two this covers,
/// because a bare "hybrid does not allocate" would overstate it.
///
/// Selected through the Rust-only path rather than a wire value: no
/// `algorithm` number reaches Hybrid any more, and writing `5.0` here would
/// quietly build a Plate and guard that instead.
#[test]
fn hybrid_process_does_not_allocate_in_its_default_algorithmic_only_mode() {
    let mut instance = unexposed(UnexposedEngine::Hybrid);
    let out = guarded_run(&mut instance);
    assert_audible(&out, "hybrid (mode off)");
}

/// Convolution allocates per partition boundary inside `process`
/// (`convolution.rs` builds four `vec![0.0; fft_size]` scratch frames per
/// boundary and moves two of them into the frequency-delay line, dropping the
/// previous pair). Hybrid inherits it the moment its routing is set to
/// Parallel or Series. Neither is reachable from the product today — no
/// surface can select algorithm 4 or 5, no surface can set `hybrid_mode`, and
/// no application code loads an impulse response — so this is carried weight
/// rather than a live RT fault.
///
/// This test pins that state as a measured fact instead of leaving it
/// unrecorded: it asserts the allocation still happens, in a child process,
/// because the violation aborts rather than unwinding. If someone makes these
/// engines allocation-free, this test fails and should be replaced by a plain
/// `assert_no_alloc` guard alongside the others. If someone deletes the
/// engines, it fails to compile and should be deleted with them. Either way
/// the decision surfaces here rather than going quiet.
#[test]
fn convolution_backed_engines_still_allocate_on_the_render_path() {
    const CHILD_ENV: &str = "PROOF_CHAMBER_CONV_ALLOC_CHILD";
    const TEST_NAME: &str = "convolution_backed_engines_still_allocate_on_the_render_path";

    if let Some(which) = std::env::var_os(CHILD_ENV) {
        let hybrid = which == "hybrid";
        let engine = if hybrid {
            UnexposedEngine::Hybrid
        } else {
            UnexposedEngine::Convolution
        };
        let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
        instance.select_unexposed_engine(engine);
        instance.set_param("mix", 0.5);
        if hybrid {
            // Parallel routing — without this hybrid runs its algorithmic
            // engine only and the convolution stage never executes.
            instance.set_param("hybrid_mode", 1.0);
            instance.set_param("hybrid_blend", 0.5);
        }
        // A short synthetic decaying-noise IR, loaded before the guard.
        let ir: Vec<f32> = (0..8_192)
            .map(|i| {
                let decay = (-(i as f32) / 2_000.0).exp();
                let noise = ((i as f32 * 12.9898).sin() * 43_758.547).fract() * 2.0 - 1.0;
                noise * decay
            })
            .collect();
        instance.load_ir(ir, 1);

        let blocks: Vec<(Vec<f32>, Vec<f32>)> =
            (0..GUARDED_BLOCKS).map(|b| block_at(b * BLOCK)).collect();
        assert_no_alloc(|| {
            for (l, r) in &blocks {
                instance.process(l, r, BLOCK as u32);
            }
        });
        return;
    }

    for which in ["convolution", "hybrid"] {
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([TEST_NAME, "--exact", "--nocapture", "--test-threads=1"])
            .env(CHILD_ENV, which)
            .output()
            .expect("failed to re-invoke the test binary as a child process");

        assert!(
            !child.status.success(),
            "the {which} engine no longer allocates inside process. That is an \
             improvement, not a regression: replace this test with a normal \
             assert_no_alloc guard next to the other algorithms."
        );
    }
}
