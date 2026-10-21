//! Choosing a Bacteria body is a `convolutionIr` write, and on the web that
//! write runs in the worklet's message handler, on the audio rendering
//! thread. Switching selects prebuilt FIR/model state and never constructs it.
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

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// Strongest frequency in `signal` between `low` and `high` Hz, in 10 Hz steps.
fn dominant_frequency(signal: &[f32], low: u32, high: u32) -> u32 {
    let magnitude = |hz: u32| {
        let (mut re, mut im) = (0.0_f64, 0.0_f64);
        for (n, &s) in signal.iter().enumerate() {
            let angle =
                2.0 * std::f64::consts::PI * f64::from(hz) * n as f64 / f64::from(SAMPLE_RATE);
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
fn engine_with_body_stage() -> BacteriaEngine {
    let mut engine = BacteriaEngine::new(SAMPLE_RATE);
    engine.set_param("band0_convolutionEnabled", 1.0);
    engine.set_param("band0_convolutionMix", 1.0);
    engine
}

/// Every body switch, including back to none, on an engine that is already
/// rendering, allocates nothing — and each switch changes what the next block
/// sounds like, so the guard is around writes that landed.
#[test]
fn switching_bodies_on_a_rendering_engine_does_not_allocate() {
    let mut engine = engine_with_body_stage();
    let input: Vec<f32> = (0..BLOCK)
        .map(|n| ((n as f32) * 0.21).sin() * 0.5)
        .collect();
    let mut left = input.clone();
    let mut right = input.clone();
    engine.process_block(&mut left, &mut right);

    let mut blocks = [[0.0_f32; BLOCK]; 6];
    assert_no_alloc(|| {
        for (block, body) in blocks.iter_mut().zip([0.0_f32, 1.0, 2.0, 3.0, -1.0, 1.0]) {
            engine.set_param("band0_convolutionIr", body);
            block.copy_from_slice(&input);
            let mut right = [0.0_f32; BLOCK];
            right.copy_from_slice(&input);
            engine.process_block(block, &mut right);
        }
    });

    assert!(
        blocks.iter().flatten().all(|sample| sample.is_finite()),
        "the engine rendered a non-finite sample after a body switch"
    );
    for pair in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5)] {
        assert_ne!(
            blocks[pair.0], blocks[pair.1],
            "blocks {} and {} rendered identically, so the body switch between them never \
             reached the stage",
            pair.0, pair.1
        );
    }
}

/// The body chosen without allocating is the body named: an impulse through
/// the stage, with no body chosen when it is built, rings at the resonance
/// each FIR body is synthesized around. Spring's distinct long-tail model is
/// exercised by the audible guard below and bacteria_spring_body.
#[test]
fn the_body_chosen_without_allocating_is_the_body_heard() {
    for (index, name, resonance_hz) in [
        (0.0_f32, "ceramic", 2_200),
        (1.0, "wood", 800),
        (2.0, "metal", 3_500),
    ] {
        let mut body = ConvolutionProcessor::new(SAMPLE_RATE);
        body.set_param("convolutionMix", 1.0);
        let mut heard = vec![0.0_f32; 1_024];

        assert_no_alloc(|| {
            body.set_param("convolutionIr", index);
            for (n, sample) in heard.iter_mut().enumerate() {
                let impulse = if n == 0 { 1.0 } else { 0.0 };
                *sample = body.process_stereo(impulse, impulse).0;
            }
        });

        let peak = dominant_frequency(&heard, 400, 5_000);
        assert!(
            peak.abs_diff(resonance_hz) <= 40,
            "choosing {name} rings at {peak} Hz; that body resonates at {resonance_hz} Hz"
        );
    }
}

/// Outlasts the Wood FIR below; Spring is recursive and has its own reset proof.
const SILENCE_PROBE_FRAMES: usize = 8_192;

/// Choosing a body again after a spell of none starts it from silence. A burst
/// played into the body, then a long stretch with no body chosen, then the
/// body chosen again over silence: nothing of the burst may come back, because
/// a musician who switched the body off and on again long after the burst
/// ended would otherwise hear it ring out of nowhere.
#[test]
fn re_choosing_a_body_after_none_carries_nothing_from_before() {
    let mut body = ConvolutionProcessor::new(SAMPLE_RATE);
    body.set_param("convolutionMix", 1.0);

    body.set_param("convolutionIr", 1.0);
    let burst_heard: f32 = (0..256)
        .map(|n| {
            let loud = if n % 2 == 0 { 1.0 } else { -1.0 };
            body.process_stereo(loud, loud).0.abs()
        })
        .sum();
    assert!(
        burst_heard > 0.0,
        "the burst never sounded through the body, so the test proves nothing"
    );

    body.set_param("convolutionIr", -1.0);
    for _ in 0..SILENCE_PROBE_FRAMES {
        assert_eq!(
            body.process_stereo(0.0, 0.0),
            (0.0, 0.0),
            "no body chosen passes silence through as silence"
        );
    }

    body.set_param("convolutionIr", 1.0);
    let leaked: Vec<(usize, f32)> = (0..SILENCE_PROBE_FRAMES)
        .map(|n| (n, body.process_stereo(0.0, 0.0).0))
        .filter(|&(_, sample)| sample != 0.0)
        .collect();
    assert!(
        leaked.is_empty(),
        "silence through the re-chosen body rang with the burst played before the spell of \
         none: {} non-zero samples, first {:?}",
        leaked.len(),
        leaked.first()
    );
}

#[test]
fn audible_spring_switches_and_first_resumed_render_allocate_and_free_nothing() {
    for rate in [48_000.0, 192_000.0] {
        let mut engine = BacteriaEngine::new(rate);
        engine.set_param("globalRouting", 0.0);
        engine.set_param("band0_convolutionEnabled", 1.0);
        engine.set_param("band0_convolutionMix", 1.0);
        engine.set_param("band0_convolutionSeparation", 0.0);
        engine.set_param("band0_convolutionIr", 3.0);
        let blocks = (rate * 0.1 / BLOCK as f32).ceil() as usize;
        let mut tail = 0.0_f64;
        for block in 0..blocks {
            let mut left = [0.0; BLOCK];
            if block == 0 {
                left[0] = 1.0;
            }
            let mut right = left;
            engine.process_block(&mut left, &mut right);
            if block + 1 == blocks {
                tail = left.iter().map(|&x| f64::from(x).powi(2)).sum();
            }
        }
        assert!(
            tail > 1e-6,
            "{rate}: Spring must already carry a real late tail"
        );
        let mut finite = true;
        let mut stale = 0.0_f32;
        assert_no_alloc(|| {
            for choice in [3.0, 2.0, 3.0] {
                engine.set_param("band0_convolutionIr", choice);
                let mut left = [0.0; BLOCK];
                let mut right = left;
                engine.process_block(&mut left, &mut right);
                finite &= left.iter().chain(&right).all(|x| x.is_finite());
            }
            engine.set_param("band0_convolutionEnabled", 0.0);
            let mut left = [0.0; BLOCK];
            let mut right = left;
            engine.process_block(&mut left, &mut right);
            engine.set_param("band0_convolutionEnabled", 1.0);
            engine.process_block(&mut left, &mut right);
            stale += left.iter().chain(&right).map(|x| x.abs()).sum::<f32>();
            engine.set_param("band0_convolutionIr", -1.0);
            engine.process_block(&mut left, &mut right);
            engine.set_param("band0_convolutionIr", 3.0);
            engine.process_block(&mut left, &mut right);
            stale += left.iter().chain(&right).map(|x| x.abs()).sum::<f32>();
        });
        assert!(finite);
        assert_eq!(stale, 0.0, "{rate}: resume/None retained old Spring audio");
    }
}
