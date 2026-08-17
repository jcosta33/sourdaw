//! Does the Reverse engine keep sounding, or does it punch a hole in itself
//! once per grain?
//!
//! `reverse_engine_character.rs` measures the two things that make Reverse a
//! distinct engine — a late onset and a rising envelope — on a single decaying
//! burst that is over long before the second grain begins. Nothing in this
//! crate has ever looked at what happens *between* grains, and that is where
//! this engine spends most of its life: fed sustained material it swaps buffers
//! every reverse time, forever.
//!
//! The property under test is the one every windowed-grain engine has to
//! satisfy and the one a listener notices immediately: **the output level does
//! not collapse at a grain boundary.** A reverse wash that drops out for a few
//! milliseconds twice a second is not a wash, it is a stutter, and no shipping
//! reverse reverb has one — grains overlap precisely so that the fade-out of
//! one is covered by the fade-in of the next.
//!
//! The measurement is a sliding short-term RMS across several grain periods,
//! compared against the mean of the same measure. A ratio, not an absolute
//! level, so it says nothing about how loud the engine is and everything about
//! whether it is continuous.
//!
//! # Why this test is `#[ignore]`d
//!
//! It is red against the shipped engine. `ReverseReverb::process`
//! (`src/reverse.rs:108`-`:120`) applies a Hann fade-out over the last
//! `crossfade_len` samples of a grain and a Hann fade-in over the first
//! `crossfade_len` samples of the next, but the two are **sequential rather
//! than overlapped**: `read_pos` is reset to 0 in the same step that swaps the
//! buffers (`:133`-`:137`), so the envelope reaches exactly 0 at the boundary
//! and the two half-windows sum to a notch instead of to unity. At the shipped
//! 15 ms crossfade the output falls to roughly a tenth of its running level
//! across a 10 ms window, once every reverse time.
//!
//! Un-ignore this when the grains overlap. The bound below is loose on purpose
//! — a quarter of the running level is already a 12 dB hole — so a repair that
//! cannot clear it has not made the engine continuous.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const REVERSE: f32 = 6.0;

/// `size = 0` is the shortest reverse time the engine offers, 0.5 s
/// (`ReverseReverb::set_param`), which fits the most grain boundaries into the
/// shortest render.
const SIZE: f32 = 0.0;
const REVERSE_SECONDS: f32 = 0.5;

/// Four reverse times: two to fill and settle, two measured.
const RENDER_FRAMES: usize = (SAMPLE_RATE * 4.0) as usize;
const ANALYSIS_START: usize = (SAMPLE_RATE * REVERSE_SECONDS * 2.0) as usize;

/// A sustained tone rather than a burst: a grain boundary is only observable
/// when there is material either side of it.
const TONE_HZ: f32 = 330.0;
const TONE_AMP: f32 = 0.5;

/// 10 ms, which is both long enough to average over a couple of cycles of the
/// tone and short enough to be well inside the 15 ms crossfade the engine
/// applies. The hop is a quarter of it, so no boundary can hide between two
/// measurement windows.
const WINDOW: usize = (SAMPLE_RATE * 0.010) as usize;
const HOP: usize = WINDOW / 4;

/// How far below the render's own running level a single window is allowed to
/// fall. A quarter is -12 dB: audible as a dip, not as a dropout.
const MIN_WINDOW_RATIO: f32 = 0.25;

fn rms(samples: &[f32]) -> f32 {
    let energy: f64 = samples
        .iter()
        .map(|sample| f64::from(*sample) * f64::from(*sample))
        .sum();
    (energy / samples.len() as f64).sqrt() as f32
}

fn render() -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    for (name, value) in [
        ("algorithm", REVERSE),
        ("mix", 1.0),
        ("size", SIZE),
        ("decay", 0.9),
    ] {
        instance.set_param(name, value);
    }

    let mut output = Vec::with_capacity(RENDER_FRAMES);
    let mut index = 0;
    while index < RENDER_FRAMES {
        let input: Vec<f32> = (0..BLOCK)
            .map(|offset| {
                let phase = (index + offset) as f32 / SAMPLE_RATE * TONE_HZ * std::f32::consts::TAU;
                TONE_AMP * phase.sin()
            })
            .collect();
        let ptr = instance.process(&input, &input, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for offset in 0..BLOCK {
            let sample = unsafe { *ptr.add(offset) };
            assert!(
                sample.is_finite(),
                "non-finite output at frame {}",
                index + offset
            );
            output.push(sample);
        }
        index += BLOCK;
    }
    output
}

#[test]
#[ignore = "pins the Reverse engine's grain-boundary dropout — sequential rather than overlapped Hann half-windows in src/reverse.rs:108-120, with read_pos reset alongside the buffer swap at :133-137. Red until the reverse grain-overlap lane lands."]
fn reverse_does_not_drop_out_at_a_grain_boundary() {
    let output = render();

    let mut windows: Vec<(usize, f32)> = Vec::new();
    let mut index = ANALYSIS_START;
    while index + WINDOW <= output.len() {
        windows.push((index, rms(&output[index..index + WINDOW])));
        index += HOP;
    }
    assert!(
        windows.len() > 100,
        "the analysis span holds only {} windows, which is not enough to cross a grain boundary",
        windows.len()
    );

    let mean = windows.iter().map(|(_, level)| *level).sum::<f32>() / windows.len() as f32;
    assert!(
        mean > 1e-3,
        "the reverse render is effectively silent (mean window RMS {mean:e}), so a dropout \
         measurement would be meaningless"
    );

    let (worst_at, worst) = windows
        .iter()
        .copied()
        .fold((0_usize, f32::MAX), |lowest, window| {
            if window.1 < lowest.1 {
                window
            } else {
                lowest
            }
        });
    let period = (SAMPLE_RATE * REVERSE_SECONDS) as usize;

    assert!(
        worst >= mean * MIN_WINDOW_RATIO,
        "Reverse falls to {:.1}% of its own running level for a whole {:.0} ms window \
         ({worst:e} against a mean of {mean:e}), {:.1} ms into a {:.0} ms grain. Grains that \
         fade out and in one after the other instead of overlapping leave exactly this hole, \
         and it repeats every reverse time.",
        100.0 * worst / mean,
        WINDOW as f32 * 1000.0 / SAMPLE_RATE,
        (worst_at % period) as f32 * 1000.0 / SAMPLE_RATE,
        REVERSE_SECONDS * 1000.0
    );
}
