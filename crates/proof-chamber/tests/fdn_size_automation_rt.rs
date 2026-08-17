//! `size` is an automatable parameter, so writing it is audio-thread work.
//!
//! `tests/reverb_process_rt.rs` guards `process` and deliberately leaves every
//! `set_param` outside its guard, because `set_param("algorithm", …)` rebuilds
//! the engine and allocates by design. That exemption is correct for
//! `algorithm`, which arrives from a user click, and wrong for everything the
//! automation lane writes per block: `handleSetDeviceParameter` reaches
//! `set_param` on whatever thread the parameter change lands on, and on
//! `wasm32` an allocation there can call `memory.grow()` mid-block.
//!
//! `size` is the one such name that rewrote the delay-line tuning, and the
//! tuning generator returned a freshly built `Vec` on every write. A sweep is
//! the realistic shape of the failure — a musician drawing a Size envelope —
//! so a sweep is what runs inside the guard.
//!
//! A violation calls `std::alloc::handle_alloc_error`, which aborts the whole
//! binary rather than failing one case. One test per engine width, for the same
//! reason `reverb_process_rt.rs` splits per algorithm.

#![cfg(debug_assertions)]

use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use proof_chamber::fdn::FdnReverb;

#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const SWEEP_BLOCKS: usize = 128;

/// Drive `size` across its whole declared range while rendering, inside the
/// allocation guard, and return the peak so a silent engine cannot pass.
fn sweep_size_under_guard(channels: usize) -> f32 {
    let mut reverb = FdnReverb::new(SAMPLE_RATE, channels);
    reverb.set_param("mix", 1.0);
    reverb.set_param("decay", 0.7);
    reverb.set_param("early_late", 0.5);

    let mut left = [0.0_f32; BLOCK];
    let mut right = [0.0_f32; BLOCK];

    // Warm the tank outside the guard so the sweep is measured on a running
    // reverb rather than on silence.
    for block in 0..8 {
        fill(&mut left, &mut right, block * BLOCK);
        reverb.process(&mut left, &mut right);
    }

    let mut peak = 0.0_f32;
    for block in 0..SWEEP_BLOCKS {
        fill(&mut left, &mut right, (block + 8) * BLOCK);
        // Full-range triangle sweep: every size value, both directions.
        let phase = (block as f32 / SWEEP_BLOCKS as f32) * 2.0;
        let size = if phase <= 1.0 { phase } else { 2.0 - phase };

        assert_no_alloc(|| {
            reverb.set_param("size", size);
            reverb.process(&mut left, &mut right);
        });

        for sample in left.iter().chain(right.iter()) {
            assert!(
                sample.is_finite(),
                "the size sweep produced a non-finite sample at size {size}"
            );
            peak = peak.max(sample.abs());
        }
    }
    peak
}

fn fill(left: &mut [f32; BLOCK], right: &mut [f32; BLOCK], offset: usize) {
    for i in 0..BLOCK {
        let frame = offset + i;
        let t = frame as f32 / SAMPLE_RATE;
        let click = if frame % 4_096 == 0 { 0.9 } else { 0.0 };
        left[i] = (t * 330.0 * std::f32::consts::TAU).sin() * 0.4 + click;
        right[i] = (t * 337.0 * std::f32::consts::TAU).sin() * 0.4 + click;
    }
}

#[test]
fn automating_size_on_the_eight_line_fdn_allocates_nothing() {
    let peak = sweep_size_under_guard(8);
    assert!(
        peak > 1e-3,
        "the guard has to run over an audible reverb to mean anything, got peak {peak}"
    );
}

#[test]
fn automating_size_on_the_sixteen_line_fdn_allocates_nothing() {
    let peak = sweep_size_under_guard(16);
    assert!(
        peak > 1e-3,
        "the guard has to run over an audible reverb to mean anything, got peak {peak}"
    );
}
