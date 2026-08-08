//! Toaster's pad Resonance control has to deliver the Q it is asked for.
//!
//! `ToasterKit.filterResonance` is documented "0.5-20" and every shipped `Reso`
//! knob in the product draws that span. Two stages stand between the kit field
//! and the filter: `Pad::set_param` normalises Q onto 0–1, and `SvfFilter::tick`
//! re-expands the normalised value into the damping coefficient `k = 1/Q`. They
//! disagreed — the second was linear in damping and capped at Q = 10 — and
//! delivered Q moved only 0.50 → 0.79 across the whole range any kit uses.
//!
//! These guards measure what the user hears rather than what the coefficient
//! says: for an SVF lowpass the resonant peak gain **at** the cutoff frequency
//! is Q. A coefficient assertion could be satisfied by a right-for-the-wrong-
//! reason value; a measured peak cannot.
//!
//! Every assertion here is at an **interior** point of the span. The ends do not
//! separate the two tapers: `2.0 - 1.9 * res` and `1/(0.5 + 19.5 * res)` both
//! pass through Q = 0.5 at res = 0. A guard on the ends alone is exactly the
//! guard that would have let this ship, which is why it is called out rather
//! than left to inference.

use std::f32::consts::TAU;

use daw_dsp::primitives::hz_from_normalized_cutoff;
use daw_dsp::toaster::{pad::Pad, voice::SvfFilter};

const SAMPLE_RATE: f32 = 48_000.0;

/// Normalised cutoff, kept in the middle of the control's travel and far from
/// Nyquist so the measurement reads resonance rather than prewarp error.
const CUTOFF_NORM: f32 = 0.5;

/// The frequency the filter resonates at, so the stimulus lands on it.
///
/// This used to restate `SvfFilter::tick`'s expansion inline, which meant it
/// carried a copy of that expansion's `log2(1000) ≈ 10` error and stayed
/// accidentally correct only because both sides were wrong together. It now
/// calls the same primitive the filter does.
fn cutoff_hz(cutoff_norm: f32) -> f32 {
    hz_from_normalized_cutoff(cutoff_norm)
}

/// Drive a sine at the cutoff frequency through the voice filter and return the
/// settled peak output amplitude — the filter's gain at cutoff, which for an SVF
/// lowpass is Q.
fn measured_peak_gain_at_cutoff(normalized_resonance: f32) -> f32 {
    let mut filter = SvfFilter::new();
    filter.set(CUTOFF_NORM, normalized_resonance);

    let freq = cutoff_hz(CUTOFF_NORM);
    // Two seconds is long enough for a Q = 20 ring to reach steady state.
    let settle = (SAMPLE_RATE * 2.0) as usize;
    let measure = (SAMPLE_RATE * 0.5) as usize;

    let mut peak = 0.0_f32;
    for n in 0..(settle + measure) {
        let input = (TAU * freq * n as f32 / SAMPLE_RATE).sin();
        let output = filter.tick(input, SAMPLE_RATE);
        if n >= settle {
            peak = peak.max(output.abs());
        }
    }
    peak
}

/// The Q a pad delivers for a Q written into a kit, across both stages.
fn delivered_q_for_kit_value(kit_q: f32) -> f32 {
    let mut pad = Pad::new(daw_dsp::toaster::engines::DrumEngineType::Kick);
    pad.set_param("filter_resonance", kit_q);
    measured_peak_gain_at_cutoff(pad.filter_resonance)
}

fn assert_close(actual: f32, expected: f32, context: &str) {
    let error = (actual - expected).abs() / expected;
    assert!(
        error < 0.01,
        "{context}: expected Q ≈ {expected}, measured {actual} ({:.1}% off)",
        error * 100.0
    );
}

#[test]
fn the_filter_delivers_the_q_its_damping_coefficient_encodes() {
    // Anchors the premise the rest of the file rests on: peak gain at cutoff is
    // 1/k, so measuring gain is measuring Q. Read through the normalised
    // control, whose k is 1/(0.5 + 19.5 * res).
    for (normalized, expected_q) in [(0.0_f32, 0.5_f32), (0.5, 10.25), (1.0, 20.0)] {
        let measured = measured_peak_gain_at_cutoff(normalized);
        assert_close(
            measured,
            expected_q,
            &format!("normalised resonance {normalized}"),
        );
    }
}

#[test]
fn the_midpoint_of_the_kit_span_delivers_the_q_the_midpoint_asks_for() {
    // Q 10.25 is the exact midpoint of the advertised 0.5–20 span, so it is the
    // single point furthest from either end's saturation. The damping-linear
    // taper delivered 0.95 here — an order of magnitude short — while agreeing
    // with this mapping exactly at res = 0.
    let delivered = delivered_q_for_kit_value(10.25);
    assert_close(delivered, 10.25, "kit midpoint");
}

#[test]
fn resonance_the_shipped_kits_ask_for_arrives_at_the_filter() {
    // The interior points shipped kits and pad presets actually carry, plus the
    // quarter-travel points around them. Under the damping-linear taper every
    // one of these delivered between 0.51 and 1.14.
    for kit_q in [0.7_f32, 1.0, 2.0, 4.0, 5.375, 8.0, 12.0, 15.125] {
        let delivered = delivered_q_for_kit_value(kit_q);
        assert_close(delivered, kit_q, &format!("kit Q {kit_q}"));
    }
}

#[test]
fn the_control_spreads_its_range_across_the_travel_rather_than_bunching_it() {
    // A taper claim, not a point claim: equal steps in normalised travel must
    // produce equal steps in delivered Q. The damping-linear taper failed this
    // badly — its first quarter of travel moved Q by 0.11 and its last by 10.0,
    // a 90:1 imbalance — and no single-point assertion states it.
    let quarters: Vec<f32> = [0.0_f32, 0.25, 0.5, 0.75, 1.0]
        .iter()
        .map(|normalized| measured_peak_gain_at_cutoff(*normalized))
        .collect();

    let steps: Vec<f32> = quarters.windows(2).map(|pair| pair[1] - pair[0]).collect();
    let expected_step = (20.0 - 0.5) / 4.0;
    for (index, step) in steps.iter().enumerate() {
        assert_close(*step, expected_step, &format!("quarter {index} of travel"));
    }
}

#[test]
fn a_kit_value_past_the_advertised_span_saturates_at_the_span_end() {
    // Projects saved against an older range, and automation dragged past the
    // knob's travel, both deliver these.
    assert_close(delivered_q_for_kit_value(0.1), 0.5, "below the span");
    assert_close(delivered_q_for_kit_value(40.0), 20.0, "above the span");
}

#[test]
fn the_top_of_the_q_span_stays_bounded_at_every_cutoff_and_sample_rate() {
    // Q = 20 is newly reachable — the damping-linear taper topped out at 10 —
    // so the top of the span needs a stability claim it never needed before.
    // Crumbs oversamples above Q = 10 to avoid "aliasing from high-resonance
    // self-oscillation"; that rationale does not transfer here, because this
    // filter is strictly linear (no saturation anywhere in `tick`) and a linear
    // filter generates no new frequencies to alias. What is worth pinning is
    // that the TPT form stays bounded with the prewarp pushed towards Nyquist.
    for sample_rate in [44_100.0_f32, 48_000.0, 96_000.0] {
        for cutoff_norm in [0.0_f32, 0.5, 0.9, 1.0] {
            let mut filter = SvfFilter::new();
            filter.set(cutoff_norm, 1.0); // normalised 1.0 == Q 20, the top
            let freq = cutoff_hz(cutoff_norm);

            let mut peak = 0.0_f32;
            for n in 0..(sample_rate as usize) {
                let input = (TAU * freq * n as f32 / sample_rate).sin();
                let output = filter.tick(input, sample_rate);
                peak = peak.max(output.abs());
            }

            assert!(
                peak.is_finite(),
                "cutoff {cutoff_norm} at {sample_rate} Hz produced a non-finite peak"
            );
            // A Q of 20 is +26 dB; anything beyond 40x unity is the filter
            // running away rather than resonating.
            assert!(
                peak < 40.0,
                "cutoff {cutoff_norm} at {sample_rate} Hz peaked at {peak}"
            );
        }
    }
}
