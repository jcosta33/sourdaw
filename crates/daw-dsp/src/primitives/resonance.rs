//! The Q ↔ normalised resonance conversion shared by the devices whose *stored*
//! resonance field is in Q.
//!
//! This is **not** a house style, and the repo should not be read as having one.
//! What actually ships:
//!
//! | surface | range | default | unit |
//! | --- | --- | --- | --- |
//! | Crumbs `Reso` (`CrumbsControls.tsx:193-197`) | 0.5–20 step 0.1 | 1 | Q |
//! | Fermenter `filterResonance` (`FilterSection.tsx:150-156`) | 0.5–20 step 0.1 | 1 | Q |
//! | Grinder `Res Q` (`GrinderPanel.tsx:1470-1474`) | 0.5–**10** step 0.1 | **2** | Q |
//! | Bacteria `Reso` (`BacteriaPanel.tsx:1028-1032`) | **0–1** | 0.3 | **normalised** |
//! | GrandBoule | — draws no resonance control — | | |
//!
//! Two surfaces share the 0.5–20 shape this module implements. Grinder uses Q
//! over a different span. Bacteria deliberately does not use Q at all: its knob
//! is normalised 0–1 and `bacteria/filter.rs:86,122` implements
//! `clamp(0.0, 1.0)` then `k = 2.0 - 2.0 * res * 0.99` — Cytomic's recommended
//! damping-linear line, end to end, self-oscillation backed off by the 0.99.
//! That is a coherent design and this module is not an argument against it.
//!
//! So the reason a device belongs here is narrow and worth stating, because the
//! alternative is genuinely defensible: **it belongs here when its persisted
//! field is already denominated in Q.** `ToasterKit.filterResonance` is
//! documented "0.5-20", defaults to `1`, and is CRDT-persisted, so reading that
//! stored `1` as a normalised control would mean `k = 0` — self-oscillation on
//! every pad that never set the field. The stored unit decides, not the taper.
//!
//! Given a field in Q, something has to convert to the normalised 0–1 the SVF
//! state carries, and the pair has to stay an exact inverse. Twice now it has
//! not:
//!
//! - `CrumbsEngine::set_param` fed raw Q straight into a `clamp(0.0, 1.0)`,
//!   pinning 19 of the knob's 19.5 units onto the same coefficients.
//! - Toaster normalised correctly in `pad::set_param` and then re-expanded with
//!   an unrelated `k = 2.0 - 1.9 * resonance`, a taper linear in *damping* and
//!   capped at Q = 10. Delivered Q moved 0.50 → 0.79 across the whole span any
//!   shipped kit uses.
//!
//! Both directions live here, beside each other, so a third drift has to edit
//! two adjacent lines to happen.

/// Q at a normalised resonance of 0.0 — a gently damped, non-peaking filter.
pub const RESONANCE_Q_MIN: f32 = 0.5;

/// Q at a normalised resonance of 1.0 — the onset of self-oscillation.
pub const RESONANCE_Q_MAX: f32 = 20.0;

/// Convert a Q reading from a product surface into the normalised 0–1
/// resonance a filter's state carries.
///
/// The taper is linear in Q because the *value* is Q: a surface that reads out
/// `filterResonance.toFixed(1)` has to deliver the number it prints. This is
/// not a claim that a Q-linear sweep feels better than a damping-linear one —
/// Cytomic, Pirkle and Zavalishin all favour damping, and Bacteria ships it.
/// Taper belongs in the knob's travel→value curve, where the readout can stay
/// honest; it does not belong in a conversion between two units.
///
/// Out-of-range readings saturate: an automation curve can be dragged past
/// either end, and a project saved against an older advertised range can carry
/// one in.
pub fn normalized_resonance_from_q(q: f32) -> f32 {
    ((q - RESONANCE_Q_MIN) / (RESONANCE_Q_MAX - RESONANCE_Q_MIN)).clamp(0.0, 1.0)
}

/// Convert a filter's normalised 0–1 resonance back into Q — the exact inverse
/// of [`normalized_resonance_from_q`] over the unsaturated span.
///
/// This is the value a TPT SVF's damping coefficient is the reciprocal of
/// (`k = 1/Q`), and it is the resonant peak gain the filter delivers at cutoff.
pub fn q_from_normalized_resonance(resonance: f32) -> f32 {
    let clamped = resonance.clamp(0.0, 1.0);
    RESONANCE_Q_MIN + clamped * (RESONANCE_Q_MAX - RESONANCE_Q_MIN)
}

#[cfg(test)]
mod tests {
    use super::{normalized_resonance_from_q, q_from_normalized_resonance};

    /// A filter's `set_params` clamps its own argument, so a rendered block
    /// cannot tell whether the conversion saturated or the filter did — this is
    /// the only place the conversion's own ends are observable.
    #[test]
    fn the_q_range_the_knob_draws_maps_onto_the_whole_normalised_span() {
        // The ends as the two panels on this span draw them — Crumbs
        // (`CrumbsControls.tsx:194-195`) and Fermenter
        // (`FilterSection.tsx:152-153`), both `min={0.5} max={20}` — written as
        // literals rather than through `RESONANCE_Q_MIN`/`MAX` so moving a
        // constant reds this instead of dragging the expectation along with it.
        assert_eq!(normalized_resonance_from_q(0.5), 0.0);
        assert_eq!(normalized_resonance_from_q(20.0), 1.0);

        // The ends alone do not hold the span: this function's own `clamp`
        // saturates them, so shrinking `RESONANCE_Q_MAX` to 10 still returns
        // 1.0 here and both assertions above stay green while the knob's top
        // silently delivers half the Q it advertises. The knob's midpoint is
        // the assertion that cannot be saturated into agreement — it is
        // interior to the true span and outside a shrunk one.
        assert_eq!(normalized_resonance_from_q(10.25), 0.5);
    }

    #[test]
    fn a_q_outside_the_knobs_travel_saturates_instead_of_leaving_the_span() {
        // Automation curves, presets and projects saved against an older
        // advertised range can all deliver one.
        assert_eq!(normalized_resonance_from_q(0.1), 0.0);
        assert_eq!(normalized_resonance_from_q(40.0), 1.0);
    }

    /// The ends of this direction are the two constants restated, so they agree
    /// with a damping-linear taper — `2.0 - 1.9 * res` also passes through
    /// Q 0.5 at res 0. Only interior points separate the tapers, and they
    /// separate them by an order of magnitude.
    #[test]
    fn normalised_travel_expands_linearly_in_q_across_the_interior() {
        assert_eq!(q_from_normalized_resonance(0.0), 0.5);
        assert_eq!(q_from_normalized_resonance(1.0), 20.0);

        // Midpoint of travel. A damping-linear taper delivers 0.95 here.
        assert_eq!(q_from_normalized_resonance(0.5), 10.25);
        // Quarter and three-quarter travel, likewise unreachable by damping.
        assert_eq!(q_from_normalized_resonance(0.25), 5.375);
        assert_eq!(q_from_normalized_resonance(0.75), 15.125);
    }

    #[test]
    fn the_two_directions_are_an_exact_inverse_across_the_interior() {
        for q in [0.5f32, 1.0, 2.0, 4.0, 8.0, 10.25, 12.0, 20.0] {
            let round_tripped = q_from_normalized_resonance(normalized_resonance_from_q(q));
            assert!(
                (round_tripped - q).abs() < 1e-4,
                "Q {q} round-tripped to {round_tripped}"
            );
        }
    }

    #[test]
    fn a_normalised_reading_outside_the_span_saturates_at_the_advertised_ends() {
        assert_eq!(q_from_normalized_resonance(-1.0), 0.5);
        assert_eq!(q_from_normalized_resonance(2.0), 20.0);
    }
}
