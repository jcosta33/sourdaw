//! Does `reset` leave an engine exactly where its constructor does?
//!
//! #3307 took the five algorithms a wire value can select out of
//! `set_param("algorithm", …)`. They are built once now, and the switch resets
//! whichever one it selects, because constructing an engine on the render
//! thread allocates — `FdnReverb::new(sr, 16)` is sixteen delay lines and a
//! pre-delay buffer inside a 2.67 ms quantum.
//!
//! That trade is only sound while a reset engine is indistinguishable from a
//! fresh one. Two things depend on it: the parameter replay that follows every
//! switch is written against a factory-fresh engine (#1544), and
//! `algorithm_switch_parameter_retention.rs` measures round trips on the same
//! assumption — including the one sequence that deliberately does *not* round
//! trip, which only reads as a latch if the engine underneath it started clean.
//!
//! So each row drives an engine hard — every id it answers to written off its
//! default, then a burst rendered through it so every delay line, filter state
//! and LFO phase is dirty — resets it, and asserts the next render is bit for
//! bit what a never-touched engine renders. Bit equality rather than a
//! tolerance, because the two are supposed to be the same state and a tolerance
//! would pass a stale tail as close enough.
//!
//! Each row also renders the same driven engine *without* the reset and
//! requires that one to differ. Without that, an engine whose writes did
//! nothing and whose tail had decayed to silence would pass by comparing two
//! identical renders, which is the shape this file exists to catch.

use proof_chamber::fdn::FdnReverb;
use proof_chamber::proof_chamber::ProofChamber;
use proof_chamber::reverse::ReverseReverb;
use proof_chamber::spring::SpringReverb;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// Long enough that the plate's 30 ms smoothing ramp has settled and every
/// tank delay — the longest is 4453 samples at the reference rate, 7182 here —
/// has been written through more than once.
const DRIVE_BLOCKS: usize = 96;

/// Long enough for a retained tail to still be sounding into the comparison,
/// which is what makes a missed `fill` visible.
const COMPARE_BLOCKS: usize = 64;

const BURST_HZ: f32 = 220.0;
const BURST_AMP: f32 = 0.9;

/// Every id the four engines answer to, set away from its default and away
/// from both ends of its declared range.
///
/// One list across all four rather than one per engine: each engine drops the
/// names it does not read, and a shared list means a name that moves from one
/// engine to another stays covered without an edit here.
const WRITES: &[(&str, f32)] = &[
    ("mix", 0.83),
    ("decay", 0.62),
    ("rt60_hf", 0.44),
    ("damping", 0.41),
    ("size", 0.37),
    ("predelay", 23.0),
    ("mod_rate", 1.7),
    ("mod_depth", 0.28),
    ("diffusion", 0.72),
    ("dispersion", 0.63),
    ("density", 0.41),
    ("early_late", 0.66),
    ("gravity", 0.85),
    ("width", 1.35),
    ("high_cut", 6_800.0),
    ("low_cut", 180.0),
    ("matrix", 0.0),
    ("saturation", 1.0),
    ("saturation_type", 2.0),
    ("shimmer", 1.0),
    ("shimmer_amount", 0.55),
    ("shimmer_pitch", 0.8),
    ("decay_eq_0", 2.4),
    ("decay_eq_1", 0.4),
    ("decay_eq_2", 3.1),
    ("decay_eq_3", 0.55),
    ("decay_eq_4", 1.9),
    ("decay_eq_5", 0.31),
    // Latches shimmer off inside the plate's `freeze` arm, so a reset that
    // restored the tank but not the shifters would come back with the wrong
    // one of the two.
    ("freeze", 1.0),
    ("freeze", 0.0),
];

/// The three calls this file needs from an engine, so one comparison serves all
/// four. Implemented by forwarding only — nothing here decides behaviour.
trait Engine {
    fn set_param(&mut self, name: &str, value: f32);
    fn process(&mut self, left: &mut [f32], right: &mut [f32]);
    fn reset(&mut self);
}

macro_rules! impl_engine {
    ($type:ty) => {
        impl Engine for $type {
            fn set_param(&mut self, name: &str, value: f32) {
                <$type>::set_param(self, name, value);
            }
            fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
                <$type>::process(self, left, right);
            }
            fn reset(&mut self) {
                <$type>::reset(self);
            }
        }
    };
}

impl_engine!(ProofChamber);
impl_engine!(FdnReverb);
impl_engine!(SpringReverb);
impl_engine!(ReverseReverb);

fn stimulus(index: usize) -> f32 {
    let phase = index as f32 / SAMPLE_RATE * BURST_HZ * std::f32::consts::TAU;
    BURST_AMP * phase.sin()
}

/// Render `blocks` of the burst and return the interleaved result.
fn render(engine: &mut dyn Engine, blocks: usize) -> Vec<f32> {
    let mut output = Vec::with_capacity(blocks * BLOCK * 2);
    for block in 0..blocks {
        let mut left: Vec<f32> = (0..BLOCK)
            .map(|frame| stimulus(block * BLOCK + frame))
            .collect();
        let mut right = left.clone();
        engine.process(&mut left, &mut right);
        for frame in 0..BLOCK {
            output.push(left[frame]);
            output.push(right[frame]);
        }
    }
    for (index, sample) in output.iter().enumerate() {
        assert!(sample.is_finite(), "non-finite sample at {index}: {sample}");
    }
    output
}

fn drive(engine: &mut dyn Engine) {
    for &(name, value) in WRITES {
        engine.set_param(name, value);
    }
    render(engine, DRIVE_BLOCKS);
}

fn first_difference(left: &[f32], right: &[f32]) -> Option<usize> {
    left.iter()
        .zip(right.iter())
        .position(|(a, b)| a.to_bits() != b.to_bits())
}

fn assert_reset_is_factory_fresh(
    mut driven: Box<dyn Engine>,
    mut kept_dirty: Box<dyn Engine>,
    mut factory: Box<dyn Engine>,
    label: &str,
) {
    drive(driven.as_mut());
    drive(kept_dirty.as_mut());

    driven.reset();

    let after_reset = render(driven.as_mut(), COMPARE_BLOCKS);
    let without_reset = render(kept_dirty.as_mut(), COMPARE_BLOCKS);
    let fresh = render(factory.as_mut(), COMPARE_BLOCKS);

    let peak = fresh.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
    assert!(
        peak > 1e-3,
        "{label}: the comparison render is silent, so it cannot discriminate anything (peak {peak:e})"
    );

    assert!(
        first_difference(&without_reset, &fresh).is_some(),
        "{label}: a driven engine renders what a fresh one does even without a \
         reset, so this row cannot see a reset that does nothing"
    );

    if let Some(index) = first_difference(&after_reset, &fresh) {
        panic!(
            "{label}: a reset engine diverges from a fresh one at sample {index} \
             ({} vs {}). `reset` and the constructor disagree — every field one \
             writes the other has to write, or the parameter replay after an \
             `algorithm` switch runs on top of state the switch was supposed to \
             clear (#3307).",
            after_reset[index], fresh[index]
        );
    }
}

#[test]
fn a_reset_plate_renders_what_a_fresh_one_does() {
    assert_reset_is_factory_fresh(
        Box::new(ProofChamber::new(SAMPLE_RATE)),
        Box::new(ProofChamber::new(SAMPLE_RATE)),
        Box::new(ProofChamber::new(SAMPLE_RATE)),
        "plate",
    );
}

#[test]
fn a_reset_fdn8_renders_what_a_fresh_one_does() {
    assert_reset_is_factory_fresh(
        Box::new(FdnReverb::new(SAMPLE_RATE, 8)),
        Box::new(FdnReverb::new(SAMPLE_RATE, 8)),
        Box::new(FdnReverb::new(SAMPLE_RATE, 8)),
        "fdn8",
    );
}

#[test]
fn a_reset_fdn16_renders_what_a_fresh_one_does() {
    assert_reset_is_factory_fresh(
        Box::new(FdnReverb::new(SAMPLE_RATE, 16)),
        Box::new(FdnReverb::new(SAMPLE_RATE, 16)),
        Box::new(FdnReverb::new(SAMPLE_RATE, 16)),
        "fdn16",
    );
}

#[test]
fn a_reset_spring_renders_what_a_fresh_one_does() {
    assert_reset_is_factory_fresh(
        Box::new(SpringReverb::new(SAMPLE_RATE)),
        Box::new(SpringReverb::new(SAMPLE_RATE)),
        Box::new(SpringReverb::new(SAMPLE_RATE)),
        "spring",
    );
}

#[test]
fn a_reset_reverse_renders_what_a_fresh_one_does() {
    assert_reset_is_factory_fresh(
        Box::new(ReverseReverb::new(SAMPLE_RATE)),
        Box::new(ReverseReverb::new(SAMPLE_RATE)),
        Box::new(ReverseReverb::new(SAMPLE_RATE)),
        "reverse",
    );
}
