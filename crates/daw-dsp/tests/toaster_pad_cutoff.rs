//! Toaster's pad Filter control has to deliver the corner frequency it is asked
//! for.
//!
//! `ToasterKit.filterCutoff` is documented "20-20000 Hz" and the panel reads the
//! stored number back out in kHz. Two stages stand between the kit field and the
//! filter: `Pad::set_param` normalises Hz onto 0–1, and `SvfFilter::tick`
//! re-expands the normalised value into the frequency it prewarps `g` with. They
//! disagreed — the second substituted a round `10` for `log2(1000) = 9.9658` —
//! and every delivered corner landed sharp by `2^(0.0342 * cutoff)`: 35 cents at
//! 7.5 kHz, 41 cents at the top of travel.
//!
//! These guards measure the **delivered corner frequency** rather than the
//! normalised coefficient. A coefficient assertion can be satisfied by a
//! right-for-the-wrong-reason value, and in this case it would have had to
//! restate one of the two mappings under test to know what to expect. The corner
//! is located by finding where the resonant peak of the lowpass actually sits,
//! which is a property of the rendered response and not of either expression.
//!
//! Every assertion here is at an **interior** point of the span. The bottom does
//! not separate the two mappings: both deliver 20 Hz at a normalised cutoff of
//! 0, and the error grows smoothly from there. A guard on the bottom end is
//! exactly the guard that would have let this ship, which is why it is called
//! out rather than left to inference.

use std::f32::consts::TAU;

use daw_dsp::toaster::{engines::DrumEngineType, pad::Pad, voice::SvfFilter};

const SAMPLE_RATE: f32 = 48_000.0;

/// Q at the top of `ToasterKit.filterResonance`'s span. A sharp peak localises
/// the corner tightly; at Q = 20 the lowpass gain has already fallen by a fifth
/// two percent away from the corner, which is the size of the error under test.
const PROBE_Q: f32 = 20.0;

/// How far either side of the asked frequency the search looks, as a ratio. The
/// old mapping's error ranged from +1.0% at mid travel to +2.4% at the top, so a
/// ±6% window brackets it with room to spare — a corner outside this window
/// fails the assertion rather than silently pinning to a window edge.
const SEARCH_SPAN: f32 = 0.06;

/// Steps across the search window. 0.2% resolution, fine enough to separate a
/// correct corner from a 1% one.
const SEARCH_STEPS: usize = 60;

/// Gain the filter delivers at one probe frequency, measured as a single-bin DFT
/// of the rendered output.
///
/// Correlating against the probe frequency rather than taking a peak sample
/// matters here: at 12 kHz on a 48 kHz clock a sine is only four samples per
/// cycle, and the largest sample can sit up to 12% below the true amplitude
/// depending on where the grid lands. That error varies with frequency, so it
/// would tilt a peak search and move the answer.
fn gain_at(cutoff_norm: f32, resonance_norm: f32, probe_hz: f32) -> f32 {
    let mut filter = SvfFilter::new();
    filter.set(cutoff_norm, resonance_norm);

    // A Q = 20 ring settles in about `Q / (pi * f)` seconds — 10 ms at the
    // lowest frequency probed here, so 80 ms is eight time constants.
    let settle = (SAMPLE_RATE * 0.08) as usize;
    let measure = (SAMPLE_RATE * 0.15) as usize;

    let mut sin_acc = 0.0_f32;
    let mut cos_acc = 0.0_f32;
    for n in 0..(settle + measure) {
        let phase = TAU * probe_hz * n as f32 / SAMPLE_RATE;
        let output = filter.tick(phase.sin(), SAMPLE_RATE);
        if n >= settle {
            sin_acc += output * phase.sin();
            cos_acc += output * phase.cos();
        }
    }

    2.0 * (sin_acc * sin_acc + cos_acc * cos_acc).sqrt() / measure as f32
}

/// The corner frequency a pad actually delivers, located from the rendered
/// response: for a resonant SVF lowpass the magnitude peaks at the corner, so
/// the frequency of maximum gain *is* the delivered corner.
///
/// The whole product path runs here — `Pad::set_param` normalises the kit's Hz,
/// and the filter re-expands it — so this composes exactly the two mappings that
/// drifted apart, in the order the engine composes them.
fn delivered_corner_hz(asked_hz: f32) -> f32 {
    let mut pad = Pad::new(DrumEngineType::Kick);
    pad.set_param("filter_cutoff", asked_hz);
    pad.set_param("filter_resonance", PROBE_Q);

    let mut best_hz = asked_hz;
    let mut best_gain = 0.0_f32;
    for step in 0..=SEARCH_STEPS {
        let offset = -SEARCH_SPAN + 2.0 * SEARCH_SPAN * step as f32 / SEARCH_STEPS as f32;
        let probe_hz = asked_hz * (1.0 + offset);
        let gain = gain_at(pad.filter_cutoff, pad.filter_resonance, probe_hz);
        if gain > best_gain {
            best_gain = gain;
            best_hz = probe_hz;
        }
    }
    best_hz
}

fn assert_corner_lands_on(asked_hz: f32, context: &str) {
    let delivered = delivered_corner_hz(asked_hz);
    let error = delivered / asked_hz - 1.0;
    let cents = 1200.0 * (delivered / asked_hz).log2();
    assert!(
        error.abs() < 0.005,
        "{context}: asked {asked_hz} Hz, filter resonates at {delivered:.1} Hz \
         ({:+.2}%, {cents:+.1} cents)",
        error * 100.0
    );
}

/// Representative high-frequency cutoff requests from the shipped control
/// range, including the region where the former expansion drifted most.
#[test]
fn representative_high_cutoffs_resonate_where_requested() {
    // Interior to the control's travel, which is where the mappings separate:
    // the old expansion put these at 7654.2 Hz, 10739.9 Hz and 14322.3 Hz.
    assert_corner_lands_on(7_500.0, "low representative cutoff");
    assert_corner_lands_on(10_500.0, "middle representative cutoff");
    assert_corner_lands_on(14_000.0, "high representative cutoff");
}

/// Mid travel is the single point furthest from either end's agreement, and the
/// one a coefficient assertion is least able to pin down without restating a
/// mapping under test.
#[test]
fn the_middle_of_the_controls_travel_resonates_three_decades_geometric() {
    // 20 Hz and 20 kHz are three decades apart, so half travel is 20 * 1000^0.5.
    // The old expansion put this at 640.0 Hz — a round 2^5 above 20, which is
    // what made it look right.
    assert_corner_lands_on(632.46, "half travel");
}

/// `trigger16Level.ts:26-36` writes `20 * 1000 ** ((i + 1) / 16)` into
/// `filterCutoff` for grid position `i`, so 16-Levels filter mode moves *any*
/// pad of *any* kit through this path — a far wider population than the one kit
/// that ships explicit cutoffs.
#[test]
fn sixteen_levels_filter_mode_lands_each_grid_position_where_it_asked() {
    // Positions 3, 7 and 11 of 16. Position 15 is the top of the grid and lands
    // at 20 kHz, above the normalised 0.99 gate at which `Voice::trigger` stops
    // running the filter at all, so it renders no corner to measure.
    for grid_index in [3u32, 7, 11] {
        let normalized = f64::from(grid_index + 1) / 16.0;
        let asked = (20.0_f64 * 1000.0_f64.powf(normalized)) as f32;
        assert_corner_lands_on(asked, &format!("16-Levels grid position {grid_index}"));
    }
}

/// The advertised ceiling was dead code: `.min(20_000.0)` bound to `exp2()`
/// rather than to the product, comparing a unitless `2^10 = 1024` against a
/// frequency. Nothing clamped, and a fully open filter cornered at 20480 Hz.
///
/// Measured rather than asserted on the constant, because the constant being
/// right is what the old code also looked like from the outside.
#[test]
fn a_fully_open_filter_corners_at_the_advertised_ceiling_not_above_it() {
    let mut pad = Pad::new(DrumEngineType::Kick);
    // Past the top of the advertised range, as an automation curve or a project
    // saved against a wider range can deliver.
    pad.set_param("filter_cutoff", 30_000.0);
    assert_eq!(
        pad.filter_cutoff, 1.0,
        "a cutoff above the advertised range should saturate at the top of travel"
    );

    // 20480 Hz is above Nyquist at 44.1 kHz, where the old ceiling would have
    // prewarped past the point `tan` stays finite and positive.
    let mut filter = SvfFilter::new();
    filter.set(pad.filter_cutoff, pad.filter_resonance);
    let corner = delivered_corner_hz(20_000.0);
    assert!(
        (corner / 20_000.0 - 1.0).abs() < 0.005,
        "fully open filter corners at {corner:.1} Hz, expected the advertised 20 kHz"
    );
}
