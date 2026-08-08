//! The Hz ↔ normalised cutoff conversion for filters whose *stored* cutoff
//! field is in Hz but whose state carries a normalised 0–1 control.
//!
//! This is the second field on Toaster's pad filter to drift apart across the
//! two stages that convert it, after resonance (`primitives::resonance`). The
//! shape is identical: `Pad::set_param` normalises the product-facing unit, the
//! filter re-expands it, and the two expressions were written independently
//! rather than as a stated inverse pair.
//!
//! Concretely, `pad.rs` normalised with `log2(hz / 20) / log2(1000)` — correct,
//! and the exact inverse of what the product's other producer of this field
//! computes (`trigger16Level.ts:26-36` writes `20 * 1000 ** n`). `voice.rs` then
//! re-expanded with `20.0 * (cutoff * 10.0).exp2()`, substituting a round `10`
//! for `log2(1000) = 9.9658…`. The 0.0342 difference in the exponent is a
//! multiplicative error of `2^(0.0342 * norm)` on every delivered corner:
//!
//! | asked | delivered | error |
//! | --- | --- | --- |
//! | 630 Hz (mid travel) | 636.4 Hz | +1.02% (17.5 cents) |
//! | 7.5 kHz | 7654.2 Hz | +2.06% (35.2 cents) |
//! | 12 kHz | 12266.5 Hz | +2.22% (38.0 cents) |
//! | 20 kHz | 20480.0 Hz | +2.40% (41.1 cents) |
//!
//! The error is zero at 20 Hz and grows monotonically with the control, so the
//! bottom of travel agrees under both mappings. That is why it shipped, and it
//! is why every guard in `tests/toaster_pad_cutoff.rs` is interior.
//!
//! A second, quieter defect lived in the same expression: `.min(20_000.0)` bound
//! to `exp2()` rather than to the product, so it compared a unitless `2^10 =
//! 1024` against a frequency and could never bind. The advertised 20 kHz ceiling
//! was dead code and the real ceiling was 20480 Hz — disagreeing with the
//! comment directly above it, with `pad.rs`'s clamp, and with
//! `ToasterKit.filterCutoff`'s documented "20-20000 Hz". Saturation now lives in
//! this module, where a clamped normalised input cannot exceed the advertised
//! top however the caller reaches it.
//!
//! Both directions live here, beside each other, so a third drift on this field
//! has to edit two adjacent lines to happen.

/// Frequency at a normalised cutoff of 0.0 — the bottom of the advertised span
/// and of `ToasterKit.filterCutoff`'s documented "20-20000 Hz".
pub const CUTOFF_HZ_MIN: f32 = 20.0;

/// Frequency at a normalised cutoff of 1.0 — nominally "filter open". Voices
/// gate the filter out entirely just below this (`voice.rs` treats a normalised
/// cutoff at or above 0.99 — about 18.7 kHz — as bypass), so the very top of the
/// span is a declared range end rather than a corner any pad renders through.
pub const CUTOFF_HZ_MAX: f32 = 20_000.0;

/// The span the control covers, as a frequency ratio — 1000, or just under ten
/// octaves.
///
/// Both directions read the span from this one expression rather than from a
/// transcendental of it written out by hand. The defect this module exists to
/// prevent was precisely a hand-written `10` standing in for `log2(1000)`.
#[inline]
fn cutoff_span_ratio() -> f32 {
    CUTOFF_HZ_MAX / CUTOFF_HZ_MIN
}

/// Convert a cutoff in Hz from a product surface into the normalised 0–1 the
/// filter's state carries.
///
/// The mapping is exponential in frequency because the normalised value it
/// produces is consumed as a position in a three-decade span: 20 → 200 → 2000 →
/// 20000 are equal thirds of it. `trigger16Level.ts:26-36` places the 16-Levels
/// grid on that same exponential and is the exact inverse of this function.
///
/// This is a **unit conversion**, not a knob taper, and the distinction matters
/// because the two currently disagree. Toaster's own manual control — the
/// "Bright" `Knob` at `ToasterPanel.tsx:415` — is `min={20} max={20000}`
/// **linear**, so dragging it halfway lands near 10 kHz rather than at the
/// 632 Hz that is half of this span. That is a taper question belonging to the
/// knob's travel→value curve, where the readout can stay honest; it is
/// pre-existing, out of scope here, and deliberately not "fixed" by bending this
/// conversion, which has to remain the exact inverse of what
/// `trigger16Level.ts` and the stored field mean.
///
/// Out-of-range readings saturate: an automation curve can be dragged past
/// either end, and a project saved against an older advertised range can carry
/// one in.
#[inline]
pub fn normalized_cutoff_from_hz(hz: f32) -> f32 {
    let clamped = hz.clamp(CUTOFF_HZ_MIN, CUTOFF_HZ_MAX);
    ((clamped / CUTOFF_HZ_MIN).log2() / cutoff_span_ratio().log2()).clamp(0.0, 1.0)
}

/// Convert a filter's normalised 0–1 cutoff back into Hz — the exact inverse of
/// [`normalized_cutoff_from_hz`] over the unsaturated span.
///
/// This is the corner frequency the filter delivers: the SVF prewarps with
/// `g = tan(π f / fs)`, which places the analog prototype's corner on this exact
/// digital frequency, so the resonant peak of the lowpass lands here.
#[inline]
pub fn hz_from_normalized_cutoff(normalized: f32) -> f32 {
    let clamped = normalized.clamp(0.0, 1.0);
    CUTOFF_HZ_MIN * cutoff_span_ratio().powf(clamped)
}

#[cfg(test)]
mod tests {
    use super::{
        hz_from_normalized_cutoff, normalized_cutoff_from_hz, CUTOFF_HZ_MAX, CUTOFF_HZ_MIN,
    };

    /// The ends written as literals rather than through the constants, so moving
    /// a constant reds this instead of dragging the expectation along with it.
    /// `ToasterKit.filterCutoff` is documented "20-20000 Hz" and
    /// `trigger16Level.ts:27-28` writes the same two numbers as `minHz`/`maxHz`.
    #[test]
    fn the_hz_range_the_knob_draws_maps_onto_the_whole_normalised_span() {
        assert_eq!(normalized_cutoff_from_hz(20.0), 0.0);
        assert_eq!(normalized_cutoff_from_hz(20_000.0), 1.0);

        // The ends alone do not hold the span: this function's own `clamp`
        // saturates them, so shrinking the span still returns 1.0 at the top
        // while every interior point silently moves. The decade marks are
        // interior and cannot be saturated into agreement — they are the
        // assertions that separate a correct span from a wrong one.
        //
        // 20 → 200 → 2000 → 20000 is three equal decades across the control, so
        // each decade is exactly a third of travel.
        let one_decade = normalized_cutoff_from_hz(200.0);
        let two_decades = normalized_cutoff_from_hz(2_000.0);
        assert!(
            (one_decade - 1.0 / 3.0).abs() < 1e-6,
            "200 Hz normalised to {one_decade}, expected a third of travel"
        );
        assert!(
            (two_decades - 2.0 / 3.0).abs() < 1e-6,
            "2 kHz normalised to {two_decades}, expected two thirds of travel"
        );
    }

    /// The bug in one assertion. `20.0 * (norm * 10.0).exp2()` agrees with the
    /// correct mapping at norm = 0 and nowhere else; it is wrong by 2.4% at the
    /// top and by a smoothly growing amount in between.
    #[test]
    fn normalised_travel_expands_over_exactly_three_decades_not_ten_octaves() {
        assert_eq!(hz_from_normalized_cutoff(0.0), 20.0);

        // The advertised ceiling. The old expression delivered 20 * 2^10 =
        // 20480 Hz here, and its `.min(20_000.0)` could not clamp it because the
        // `min` bound to `exp2()` — comparing a unitless 1024 against a
        // frequency — rather than to the product.
        assert_eq!(hz_from_normalized_cutoff(1.0), 20_000.0);

        // Interior points, where the two mappings actually separate. Each is the
        // frequency a third, half and three quarters of the way up the control.
        for (normalized, expected) in [
            (1.0 / 3.0, 200.0_f32),
            (0.5, 632.4555),
            (2.0 / 3.0, 2_000.0),
            (0.75, 3556.5588),
        ] {
            let delivered = hz_from_normalized_cutoff(normalized);
            let error = (delivered / expected - 1.0).abs();
            assert!(
                error < 1e-4,
                "normalised {normalized} delivered {delivered} Hz, expected {expected} Hz"
            );
        }
    }

    #[test]
    fn a_reading_outside_the_span_saturates_at_the_advertised_ends() {
        // Automation curves, presets and projects saved against an older
        // advertised range can all deliver one.
        assert_eq!(normalized_cutoff_from_hz(5.0), 0.0);
        assert_eq!(normalized_cutoff_from_hz(96_000.0), 1.0);
        assert_eq!(hz_from_normalized_cutoff(-1.0), CUTOFF_HZ_MIN);
        assert_eq!(hz_from_normalized_cutoff(2.0), CUTOFF_HZ_MAX);
    }

    #[test]
    fn the_two_directions_are_an_exact_inverse_across_the_interior() {
        // The four frequencies shipped kits actually carry, plus the ends.
        for hz in [
            20.0_f32, 630.0, 2_000.0, 7_500.0, 8_500.0, 10_500.0, 12_000.0, 14_000.0, 20_000.0,
        ] {
            let round_tripped = hz_from_normalized_cutoff(normalized_cutoff_from_hz(hz));
            let error = (round_tripped / hz - 1.0).abs();
            assert!(
                error < 1e-4,
                "{hz} Hz round-tripped to {round_tripped} Hz ({:.4}% off)",
                error * 100.0
            );
        }
    }

    /// `trigger16Level.ts:26-36` computes `20 * (20000 / 20) ** n` in
    /// TypeScript and writes the result into `filterCutoff`. That is this
    /// module's expansion, independently written on the other side of the IPC
    /// boundary, and the round trip through the engine has to return it.
    #[test]
    fn the_sixteen_levels_grid_round_trips_through_the_engines_normalisation() {
        for grid_index in 0..16u32 {
            let normalized = f64::from(grid_index + 1) / 16.0;
            // `20 * (20000 / 20) ** normalized`, as the TypeScript writes it.
            let asked = (20.0_f64 * 1000.0_f64.powf(normalized)) as f32;

            let delivered = hz_from_normalized_cutoff(normalized_cutoff_from_hz(asked));
            let error = (delivered / asked - 1.0).abs();
            assert!(
                error < 1e-4,
                "grid position {grid_index} asked {asked} Hz, delivered {delivered} Hz"
            );
        }
    }
}
