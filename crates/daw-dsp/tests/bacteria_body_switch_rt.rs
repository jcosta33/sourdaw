//! Choosing a Bacteria body is a `convolutionIr` write, and on the web that
//! write runs in the worklet's message handler, on the audio rendering
//! thread. So switching between the built-in bodies has to select a response
//! the processor already holds instead of synthesizing one.
//!
//! The interceptor is debug-only (`assert_no_alloc`'s `disable_release`
//! feature) — run this through `pnpm cargo:test`, and expect a violation to
//! abort the process with `memory allocation of N bytes failed` rather than
//! fail as a normal assertion.

#![cfg(debug_assertions)]

use assert_no_alloc::{assert_no_alloc, AllocDisabler};
use daw_dsp::bacteria::convolution::ConvolutionProcessor;
use daw_dsp::bacteria::engine::BacteriaEngine;

#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const SAMPLE_RATES: [f32; 2] = [48_000.0, 192_000.0];
const BLOCK: usize = 128;

/// Strongest frequency in `signal` between `low` and `high` Hz, in 10 Hz steps.
fn dominant_frequency(signal: &[f32], sample_rate: f32, low: u32, high: u32) -> u32 {
    let magnitude = |hz: u32| {
        let (mut re, mut im) = (0.0_f64, 0.0_f64);
        for (n, &s) in signal.iter().enumerate() {
            let angle =
                2.0 * std::f64::consts::PI * f64::from(hz) * n as f64 / f64::from(sample_rate);
            re += f64::from(s) * angle.cos();
            im += f64::from(s) * angle.sin();
        }
        re.hypot(im)
    };
    (low..=high)
        .step_by(10)
        .max_by(|a, b| magnitude(*a).total_cmp(&magnitude(*b)))
        .expect("the search range is not empty")
}

/// A band-0 Bacteria with its Body stage on at full mix and the other stages
/// at their defaults, so what leaves the engine is the body.
fn engine_with_body_stage(sample_rate: f32) -> BacteriaEngine {
    let mut engine = BacteriaEngine::new(sample_rate);
    engine.set_param("band0_convolutionEnabled", 1.0);
    engine.set_param("band0_convolutionMix", 1.0);
    engine
}

/// Every body switch, including back to none, on an engine that is already
/// rendering, allocates nothing — and each switch changes what the next block
/// sounds like, so the guard is around writes that landed.
#[test]
fn switching_bodies_on_a_rendering_engine_does_not_allocate() {
    for sample_rate in SAMPLE_RATES {
        let mut engine = engine_with_body_stage(sample_rate);
        let input: [f32; BLOCK] = std::array::from_fn(|n| ((n as f32) * 0.21).sin() * 0.5);
        let mut left = input;
        let mut right = input;
        engine.process_block(&mut left, &mut right);

        let mut blocks = [[0.0_f32; BLOCK]; 7];
        assert_no_alloc(|| {
            for (block, body) in blocks
                .iter_mut()
                .zip([0.0_f32, 1.0, 2.0, 3.0, 3.0, -1.0, 1.0])
            {
                engine.set_param("band0_convolutionIr", body);
                block.copy_from_slice(&input);
                let mut right = input;
                engine.process_block(block, &mut right);
            }
        });

        assert!(
            blocks.iter().flatten().all(|sample| sample.is_finite()),
            "the engine rendered a non-finite sample at {sample_rate} Hz"
        );
        assert!(
            blocks[0].iter().any(|sample| sample.abs() > 1e-4),
            "the guarded body never sounded at {sample_rate} Hz"
        );
        for pair in [(0, 1), (1, 2), (4, 5), (5, 6)] {
            assert_ne!(
                blocks[pair.0], blocks[pair.1],
                "blocks {} and {} rendered identically at {sample_rate} Hz, so the \
                 body switch never reached the stage",
                pair.0, pair.1
            );
        }
        assert_ne!(
            blocks[0], input,
            "the guarded stage passed input through unchanged"
        );

        // The last body has live history. None freezes it; choosing a body
        // again must clear that history, even when the engine keeps rendering.
        let mut leaked = 0.0_f32;
        assert_no_alloc(|| {
            engine.set_param("band0_convolutionIr", -1.0);
            let mut left = [0.0; BLOCK];
            let mut right = [0.0; BLOCK];
            engine.process_block(&mut left, &mut right);
            engine.set_param("band0_convolutionIr", 1.0);
            for _ in 0..LONGER_THAN_ANY_BODY / BLOCK {
                left.fill(0.0);
                right.fill(0.0);
                engine.process_block(&mut left, &mut right);
                for sample in left.into_iter().chain(right) {
                    leaked += sample.abs();
                }
            }
        });
        assert_eq!(
            leaked, 0.0,
            "the engine replayed stale body history at {sample_rate} Hz"
        );
    }
}

/// The body chosen without allocating is the body named: an impulse through
/// the stage, with no body chosen when it is built, rings at the resonance
/// each body is synthesized around. Spring shares metal's response.
#[test]
fn the_body_chosen_without_allocating_is_the_body_heard() {
    for sample_rate in SAMPLE_RATES {
        for (index, name, resonance_hz) in [
            (0.0_f32, "ceramic", 2_200),
            (1.0, "wood", 800),
            (2.0, "metal", 3_500),
            (3.0, "spring", 3_500),
        ] {
            let mut body = ConvolutionProcessor::new(sample_rate);
            body.set_param("convolutionMix", 1.0);
            let mut heard = vec![0.0_f32; (sample_rate * 1024.0 / 44_100.0).round() as usize];

            assert_no_alloc(|| {
                body.set_param("convolutionIr", index);
                for (n, sample) in heard.iter_mut().enumerate() {
                    let impulse = if n == 0 { 1.0 } else { 0.0 };
                    *sample = body.process_stereo(impulse, impulse).0;
                }
            });

            let peak = dominant_frequency(&heard, sample_rate, 400, 5_000);
            assert!(
                peak.abs_diff(resonance_hz) <= 40,
                "choosing {name} rings at {peak} Hz; that body resonates at {resonance_hz} Hz"
            );
        }
    }
}

/// Longer than the 23.2 ms body at 192 kHz, so this span outlasts every tail.
const LONGER_THAN_ANY_BODY: usize = 8_192;

/// Choosing a body again after a spell of none starts it from silence. A burst
/// played into the body, then a long stretch with no body chosen, then the
/// body chosen again over silence: nothing of the burst may come back, because
/// a musician who switched the body off and on again long after the burst
/// ended would otherwise hear it ring out of nowhere.
#[test]
fn re_choosing_a_body_after_none_carries_nothing_from_before() {
    for sample_rate in SAMPLE_RATES {
        let mut body = ConvolutionProcessor::new(sample_rate);
        body.set_param("convolutionMix", 1.0);

        let mut burst_heard = 0.0;
        assert_no_alloc(|| {
            body.set_param("convolutionIr", 1.0);
            for n in 0..256 {
                let loud = if n % 2 == 0 { 1.0 } else { -1.0 };
                burst_heard += body.process_stereo(loud, loud).0.abs();
            }
        });
        assert!(
            burst_heard > 0.0,
            "the burst never sounded through the body, so the test proves nothing"
        );

        let mut leaked = 0.0_f32;
        assert_no_alloc(|| {
            body.set_param("convolutionIr", -1.0);
            for _ in 0..LONGER_THAN_ANY_BODY {
                let (left, right) = body.process_stereo(0.0, 0.0);
                leaked += left.abs() + right.abs();
            }
            body.set_param("convolutionIr", 1.0);
            for _ in 0..LONGER_THAN_ANY_BODY {
                let (left, right) = body.process_stereo(0.0, 0.0);
                leaked += left.abs() + right.abs();
            }
        });
        assert_eq!(
            leaked, 0.0,
            "the body replayed stale history at {sample_rate} Hz"
        );
    }
}

/// Body-to-body selection and repeated writes must retain the input ring.
#[test]
fn switching_or_repeating_a_body_preserves_the_rendering_history() {
    for sample_rate in SAMPLE_RATES {
        let mut switched = ConvolutionProcessor::new(sample_rate);
        let mut reference = ConvolutionProcessor::new(sample_rate);
        for body in [&mut switched, &mut reference] {
            body.set_param("convolutionMix", 1.0);
        }
        switched.set_param("convolutionIr", 1.0);
        reference.set_param("convolutionIr", 2.0);
        let mut heard = 0.0_f32;
        let mut difference = 0.0_f32;
        assert_no_alloc(|| {
            for n in 0..BLOCK {
                let impulse = if n == 0 { 1.0 } else { 0.0 };
                switched.process_stereo(impulse, impulse);
                reference.process_stereo(impulse, impulse);
            }
            switched.set_param("convolutionIr", 2.0);
            for _ in 0..BLOCK {
                // A repeated parameter write must not reset that same ring.
                switched.set_param("convolutionIr", 2.0);
                let actual = switched.process_stereo(0.0, 0.0);
                let expected = reference.process_stereo(0.0, 0.0);
                heard += actual.0.abs() + actual.1.abs();
                difference += (actual.0 - expected.0).abs() + (actual.1 - expected.1).abs();
            }
        });
        assert!(
            heard > 0.0,
            "the switched body lost its live tail at {sample_rate} Hz"
        );
        assert_eq!(
            difference, 0.0,
            "the body switch reset input history at {sample_rate} Hz"
        );
    }
}
