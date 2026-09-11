//! The reverse engine's capture buffers are sized from the device rate.
//!
//! `ReverseReverb::process` reads `buffer[reverse_len - 1 - read_pos]`, so the
//! two capture buffers have to be at least as long as `reverse_len` — itself a
//! number of seconds times the sample rate. A fixed 144 000-sample allocation
//! is the advertised three seconds at 48 kHz and nothing like it anywhere else:
//! above 96 kHz the constructor's 1.5 s default alone overran it and the first
//! sample of the first block panicked, which traps the worklet in the browser
//! and aborts the process natively.
//!
//! These tests render at the highest rate the product can meet rather than
//! asserting against a sample count, because the allocation and the length now
//! derive from the same rate and only a render proves they agree.

use proof_chamber::reverse::ReverseReverb;
use proof_chamber::{ProofChamberInstance, PROOF_CHAMBER_BLOCK_FRAMES};

const RATE_48: f32 = 48_000.0;
const RATE_192: f32 = 192_000.0;

/// `algorithm` 6 selects `ReverbEngine::Reverse`.
const ALGORITHM_REVERSE: f32 = 6.0;

/// Top of the advertised `size` range: `0.5 + value * 2.5` seconds.
const SIZE_LONGEST: f32 = 1.0;
const LONGEST_REVERSE_SECONDS: f32 = 3.0;

const BURST: usize = 128;

/// A 128-frame burst: one full-scale impulse, then a tone, so the block carries
/// energy rather than silence that could satisfy a finiteness check without
/// exercising the reversal.
fn burst() -> (Vec<f32>, Vec<f32>) {
    let left: Vec<f32> = (0..BURST)
        .map(|i| {
            if i == 0 {
                1.0
            } else {
                (i as f32 * 0.05).sin() * 0.5
            }
        })
        .collect();
    let right = left.clone();
    (left, right)
}

/// # Safety
/// `ptr` must point to at least `frames` readable `f32`s. Every caller passes a
/// pointer `ProofChamberInstance::process` returned together with a frame count
/// no larger than `PROOF_CHAMBER_BLOCK_FRAMES`, which is that guarantee.
unsafe fn read_output(ptr: *const f32, frames: usize) -> Vec<f32> {
    assert!(!ptr.is_null(), "process returned a null buffer");
    (0..frames).map(|i| *ptr.add(i)).collect()
}

/// Index of the largest-magnitude sample, and that magnitude.
fn peak(samples: &[f32]) -> (usize, f32) {
    samples
        .iter()
        .enumerate()
        .fold((0, 0.0_f32), |(best_i, best), (i, s)| {
            if s.abs() > best {
                (i, s.abs())
            } else {
                (best_i, best)
            }
        })
}

/// At 192 kHz the constructor's 1.5 s default is 288 000 samples, and the very
/// first sample of the very first block indexed a 144 000-sample buffer with
/// 287 999. Nothing has to write `size` to reach it — selecting the algorithm
/// is enough.
#[test]
fn reverse_renders_its_first_block_at_192_khz_without_a_size_write() {
    let mut instance = ProofChamberInstance::new(RATE_192);
    instance.set_param("algorithm", ALGORITHM_REVERSE);

    let (left, right) = burst();
    let out = unsafe { read_output(instance.process(&left, &right, BURST as u32), BURST) };

    for (i, sample) in out.iter().enumerate() {
        assert!(
            sample.is_finite(),
            "reverse at 192 kHz produced a non-finite sample at {i}: {sample}"
        );
    }
}

/// `size` at its top is three seconds of reverse at every rate, not three
/// seconds at 48 kHz and whatever 144 000 samples happens to be elsewhere.
///
/// Measured through a render rather than an accessor. The engine fills one
/// buffer for `reverse_len` frames, swaps, then replays that buffer backwards,
/// so an impulse written at frame `k` comes back out at frame
/// `2 * reverse_len - 1 - k`. Feeding the impulse at the midpoint keeps it clear
/// of the crossfade window at either end of the grain, where the Hann envelope
/// would flatten it, and makes the emergence frame a direct read-out of the
/// length: a shorter buffer returns it sooner.
#[test]
fn reverse_time_range_holds_at_every_rate() {
    for rate in [RATE_48, RATE_192] {
        let expected_len = (rate * LONGEST_REVERSE_SECONDS) as usize;
        let impulse_at = expected_len / 2;
        let emerges_at = 2 * expected_len - 1 - impulse_at;

        let mut engine = ReverseReverb::new(rate);
        engine.set_param("size", SIZE_LONGEST);
        // Wet only: the dry impulse would otherwise be the loudest sample in
        // the render and the peak below would find it instead of the replay.
        engine.set_param("mix", 1.0);

        let mut left = vec![0.0_f32; 2 * expected_len];
        left[impulse_at] = 1.0;
        let mut right = left.clone();
        engine.process(&mut left, &mut right);

        let (observed, magnitude) = peak(&left);
        assert!(
            magnitude > 1e-3,
            "at {rate} Hz the reversed impulse never came back (peak {magnitude})"
        );
        assert_eq!(
            observed,
            emerges_at,
            "at {rate} Hz an impulse at frame {impulse_at} came back at frame {observed}, so the \
             reverse length is {} samples rather than the {LONGEST_REVERSE_SECONDS} s the size \
             control advertises ({expected_len} samples)",
            (observed + 1 + impulse_at) / 2
        );
    }
}

/// Feeding more frames than the instance can hold renders exactly as many as it
/// exports and no more: every frame inside the capacity is its own input, so a
/// clamp that stopped short would leave the tail of the block unwritten.
///
/// `mix` at zero makes `dry * (1 - mix) + wet * mix` the identity, which is what
/// turns "this frame was processed" into an exact comparison rather than a
/// threshold. Only `PROOF_CHAMBER_BLOCK_FRAMES` samples are read back; the eight
/// surplus frames are the overrun being clamped, not something to inspect.
#[test]
fn the_instance_clamps_a_block_to_its_exported_capacity() {
    let mut instance = ProofChamberInstance::new(RATE_48);
    instance.set_param("algorithm", ALGORITHM_REVERSE);
    instance.set_param("mix", 0.0);

    let overrun = PROOF_CHAMBER_BLOCK_FRAMES + 8;
    // Distinct and non-zero at every index, so an unwritten output frame reads
    // back as silence and fails rather than coinciding with its input.
    let left: Vec<f32> = (0..overrun).map(|i| 0.25 + i as f32 * 1e-4).collect();
    let right = left.clone();

    let out = unsafe {
        read_output(
            instance.process(&left, &right, overrun as u32),
            PROOF_CHAMBER_BLOCK_FRAMES,
        )
    };

    for (i, sample) in out.iter().enumerate() {
        assert_eq!(
            *sample, left[i],
            "frame {i} of a {overrun}-frame block is not its own input, so the instance rendered \
             fewer than the {PROOF_CHAMBER_BLOCK_FRAMES} frames it exports"
        );
    }
}

/// The value arrives unclamped from the wire, so the arm's clamp against the
/// buffer is the only thing between an over-range write and a read past the
/// capture buffer; this is that clamp's spec.
#[test]
fn an_over_range_size_write_still_renders_within_the_capture_buffer() {
    for name in ["size", "reverse_time"] {
        let mut instance = ProofChamberInstance::new(RATE_48);
        instance.set_param("algorithm", ALGORITHM_REVERSE);
        // Request 10.5 s of a 3.0 s buffer: 0.5 + 4.0 * 2.5 = 10.5 s
        instance.set_param(name, 4.0);

        let (left, right) = burst();
        // Process at least four 128-frame blocks
        for _ in 0..4 {
            let out = unsafe { read_output(instance.process(&left, &right, BURST as u32), BURST) };
            for (i, sample) in out.iter().enumerate() {
                assert!(
                    sample.is_finite(),
                    "set_param({name}, 4.0) produced a non-finite sample at block index {i}: {sample}"
                );
            }
        }
    }
}
