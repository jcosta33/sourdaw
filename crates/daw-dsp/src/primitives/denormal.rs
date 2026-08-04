//! Denormal (subnormal) flush guard for recursive DSP state (DSP-2, DSP-9).
//!
//! Every recursive path — IIR filter state, delay-line feedback, waveguide
//! loops, envelope followers — decays geometrically toward zero when its input
//! goes silent. It does not *reach* zero: it lands in the IEEE-754 binary32
//! **subnormal** range, where arithmetic traps to microcode on most x86 parts
//! and costs 10–100× a normal-range operation. A single idle voice can then
//! xrun the whole graph.
//!
//! Native x86 fixes this globally with the FTZ/DAZ bits in `MXCSR`.
//! **WebAssembly has no portable equivalent**: the SIMD proposal leaves
//! subnormal flushing implementation-defined and scalar wasm has no FTZ control
//! at all, so the engine cannot rely on the host. The only portable defense is
//! an explicit per-state flush, which is what this module provides.
//!
//! # Why the threshold is [`f32::MIN_POSITIVE`] and not a magic constant
//!
//! [`DENORMAL_THRESHOLD`] is `f32::MIN_POSITIVE` — 2^-126 ≈ `1.175_494_4e-38`,
//! the smallest positive **normal** binary32 value. It is read off the number
//! format, not chosen by ear, and that buys two properties:
//!
//! 1. **It flushes exactly the range that traps.** `|x| < f32::MIN_POSITIVE`
//!    is precisely the set {subnormals, ±0}. Nothing slower than a normal
//!    operation survives the guard, and nothing faster is touched.
//! 2. **It is transparent by construction, not by measurement.** Every normal
//!    f32 is by definition ≥ `f32::MIN_POSITIVE` in magnitude, so no
//!    representable normal value can be altered. Bit-exactness for
//!    normal-range signal is a property of the threshold, not a test result
//!    that happens to pass.
//!
//! This replaces two divergent, magic-numbered strategies that predated it
//! (DSP-9):
//!
//! - A `1e-20` magnitude gate (toaster/sp1200 family). `1e-20` sits ~18 orders
//!   of magnitude *above* the subnormal range, so it never acted as a denormal
//!   guard at all — it was a coarse −400 dB noise gate that happened to also
//!   catch subnormals on the way down.
//! - A `DENORMAL_DC = 1e-18` offset added to and then subtracted from state
//!   (crumbs). Injecting DC into a filter's state to keep it out of the
//!   subnormal range works, but it biases the state and the magnitude is again
//!   arbitrary.
//!
//! # NaN and infinity are deliberately *not* handled here
//!
//! `f32::NAN.abs() < DENORMAL_THRESHOLD` is `false`, so non-finite values pass
//! through this guard untouched. That is intentional: the output-boundary
//! scrub in [`crate::primitives::sanitize`] (DSP-8) owns NaN/Inf, and it counts
//! what it scrubs so a poisoned block surfaces through telemetry instead of
//! being silently laundered by a filter's inner loop.
//!
//! # RT-safety
//!
//! One `abs` and one compare per call, `#[inline]`, no allocation, no locking,
//! no branch on anything but the value itself. Safe on the audio thread.
//!
//! # References
//!
//! - WebAssembly SIMD, subnormal flushing is implementation-defined:
//!   <https://github.com/WebAssembly/simd/issues/2>
//! - EarLevel Engineering, "Floating point denormals":
//!   <https://www.earlevel.com/main/2019/04/19/floating-point-denormals/>

/// Magnitude below which an `f32` is subnormal and must be flushed to zero.
///
/// `f32::MIN_POSITIVE` = 2^-126 ≈ `1.175_494_4e-38` is the smallest positive
/// normal binary32 value, so `|x| < DENORMAL_THRESHOLD` holds for subnormals
/// and zero and for nothing else. See the module docs for the rationale.
pub const DENORMAL_THRESHOLD: f32 = f32::MIN_POSITIVE;

/// Magnitude below which an `f64` is subnormal and must be flushed to zero.
///
/// `f64::MIN_POSITIVE` = 2^-1022 ≈ `2.225_073_858_507_201_4e-308`. Applies to
/// any recursive state the crate keeps in `f64`: Grand Boule's low partials
/// (`grand_boule/string.rs`), Proof's K-weighting filter
/// (`proof/metering.rs`), and Grinder's Miller low-pass (`grinder/triode.rs`).
pub const DENORMAL_THRESHOLD_F64: f64 = f64::MIN_POSITIVE;

/// Flush `x` to `0.0` if it is subnormal; return it bit-unchanged otherwise.
///
/// Every **normal** value is returned bit-identical. The two values that are
/// neither normal nor subnormal, `+0.0` and `-0.0`, both come back as `+0.0`:
/// negative zero loses its sign bit. That is numerically inert (`-0.0 == 0.0`,
/// and the filter state this guards is only ever added, multiplied, and
/// compared) and it keeps the guard down to a single compare.
///
/// Non-finite inputs (NaN, ±Inf) are returned unchanged — see the module docs.
#[inline]
#[must_use]
pub fn flush_denormal(x: f32) -> f32 {
    if x.abs() < DENORMAL_THRESHOLD {
        return 0.0;
    }
    x
}

/// [`flush_denormal`] for `f64` state.
#[inline]
#[must_use]
pub fn flush_denormal_f64(x: f64) -> f64 {
    if x.abs() < DENORMAL_THRESHOLD_F64 {
        return 0.0;
    }
    x
}

/// In-place [`flush_denormal`], for flushing a state field held behind `&mut`.
#[inline]
pub fn flush_denormal_in_place(x: &mut f32) {
    *x = flush_denormal(*x);
}

#[cfg(test)]
mod tests {
    use super::{
        flush_denormal, flush_denormal_f64, flush_denormal_in_place, DENORMAL_THRESHOLD,
        DENORMAL_THRESHOLD_F64,
    };

    #[test]
    fn threshold_is_the_binary32_normal_boundary() {
        assert_eq!(
            DENORMAL_THRESHOLD,
            f32::MIN_POSITIVE,
            "threshold must be read off the float format, not chosen by ear"
        );
        assert!(
            DENORMAL_THRESHOLD.is_normal(),
            "the boundary value itself is the smallest normal"
        );
        assert_eq!(DENORMAL_THRESHOLD_F64, f64::MIN_POSITIVE);
    }

    #[test]
    fn flushes_subnormals_to_exact_zero() {
        // Construct genuine subnormals from their bit patterns: 1 ULP, and the
        // largest subnormal (mantissa all ones, exponent zero).
        let smallest_subnormal = f32::from_bits(1);
        let largest_subnormal = f32::from_bits(0x007f_ffff);
        assert!(
            !smallest_subnormal.is_normal() && smallest_subnormal > 0.0,
            "fixture must actually be subnormal"
        );
        assert!(!largest_subnormal.is_normal() && largest_subnormal > 0.0);

        assert_eq!(flush_denormal(smallest_subnormal), 0.0);
        assert_eq!(flush_denormal(largest_subnormal), 0.0);
        assert_eq!(flush_denormal(-smallest_subnormal), 0.0);
        assert_eq!(flush_denormal(-largest_subnormal), 0.0);
    }

    #[test]
    fn smallest_normal_survives_the_guard() {
        // The boundary is exclusive: MIN_POSITIVE itself is normal and must pass.
        assert_eq!(
            flush_denormal(f32::MIN_POSITIVE).to_bits(),
            f32::MIN_POSITIVE.to_bits()
        );
        assert_eq!(
            flush_denormal(-f32::MIN_POSITIVE).to_bits(),
            (-f32::MIN_POSITIVE).to_bits()
        );
    }

    #[test]
    fn normal_range_block_is_bit_identical() {
        // The #732 sanitize guard's transparency assertion, for the flush guard:
        // no normal-range sample may change by even one bit.
        let original = [
            0.0_f32,
            1.0,
            -1.0,
            0.123_456_79,
            -0.999_999,
            f32::MIN_POSITIVE,
            f32::MAX,
            f32::MIN,
            1e-30,
            -1e-30,
            1e-37,
        ];
        for sample in original {
            let flushed = flush_denormal(sample);
            assert_eq!(
                flushed.to_bits(),
                sample.to_bits(),
                "normal-range sample {sample:e} must stay bit-exact"
            );
        }
    }

    #[test]
    fn negative_zero_normalizes_to_positive_zero() {
        // Documented, deliberate: -0.0 is neither normal nor subnormal, and the
        // single-compare guard drops its sign bit. Numerically inert, but pinned
        // so it cannot change silently.
        let flushed = flush_denormal(-0.0);
        assert_eq!(flushed, 0.0);
        assert_eq!(
            flushed.to_bits(),
            0_u32,
            "sign bit is dropped, not preserved"
        );
    }

    #[test]
    fn tiny_normals_well_below_audibility_are_not_gated() {
        // Guards against regressing to the old 1e-20 magic gate: 1e-30 is ~8
        // orders of magnitude below it but still a perfectly normal float, so a
        // true denormal guard must leave it alone.
        let tiny = 1e-30_f32;
        assert!(tiny.is_normal());
        assert_eq!(flush_denormal(tiny), tiny);
        assert_ne!(flush_denormal(tiny), 0.0);
    }

    #[test]
    fn non_finite_values_pass_through_untouched() {
        // DSP-8's sanitize_block owns NaN/Inf and counts what it scrubs; this
        // guard must not launder them out of the telemetry.
        assert!(flush_denormal(f32::NAN).is_nan());
        assert_eq!(flush_denormal(f32::INFINITY), f32::INFINITY);
        assert_eq!(flush_denormal(f32::NEG_INFINITY), f32::NEG_INFINITY);
    }

    #[test]
    fn in_place_variant_matches_the_by_value_one() {
        let mut subnormal = f32::from_bits(1);
        flush_denormal_in_place(&mut subnormal);
        assert_eq!(subnormal, 0.0);

        let mut normal = -0.75_f32;
        flush_denormal_in_place(&mut normal);
        assert_eq!(normal.to_bits(), (-0.75_f32).to_bits());
    }

    #[test]
    fn f64_variant_flushes_only_f64_subnormals() {
        let subnormal = f64::from_bits(1);
        assert!(!subnormal.is_normal() && subnormal > 0.0);
        assert_eq!(flush_denormal_f64(subnormal), 0.0);

        // An f32 subnormal is a perfectly normal f64 and must survive.
        let f32_subnormal_as_f64 = f64::from(f32::from_bits(1));
        assert!(f32_subnormal_as_f64.is_normal());
        assert_eq!(
            flush_denormal_f64(f32_subnormal_as_f64),
            f32_subnormal_as_f64
        );

        assert_eq!(
            flush_denormal_f64(f64::MIN_POSITIVE).to_bits(),
            f64::MIN_POSITIVE.to_bits()
        );
    }
}
