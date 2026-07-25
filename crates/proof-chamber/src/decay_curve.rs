//! The `decay` parameter contract, shared by every Dutch Oven engine.
//!
//! `decay` is a unitless, normalised coefficient in 0..0.999 — the range the
//! `dutch-oven` descriptor declares (`unit: ''`) and the value that projects,
//! space presets and automation lanes already store. It is never seconds.
//!
//! Each engine needs a different physical quantity: the FDN needs an RT60 in
//! seconds, the convolution engine needs a stretch factor for the loaded IR.
//! Both derive it here through one exponential law, so equal knob travel means
//! the same *ratio* change in tail length whichever algorithm is selected.
//!
//! Caveat on the convolution side: `decay_stretch` is only consumed by
//! `ConvolutionEngine::load_ir`, and nothing in the app calls `load_ir` yet —
//! the IR browser decodes a file but never posts it to the worklet. So the
//! conversion below is correct and in place, but inert on the convolution and
//! hybrid algorithms until an IR-load path is wired. It was equally inert
//! before this contract was unified; the FDN is where the fix has teeth.

/// Descriptor default for `decay` — the neutral centre of the curve.
pub const DECAY_DEFAULT: f32 = 0.5;
/// Top of the declared `decay` range (`NativeDspDescriptors.ts`, `dutch-oven`).
pub const DECAY_MAX: f32 = 0.999;

/// Shortest RT60 the FDN's absorptive filters realise, in seconds.
pub const MIN_RT60_SECONDS: f32 = 0.1;
/// Longest RT60 the FDN's absorptive filters realise, in seconds.
pub const MAX_RT60_SECONDS: f32 = 30.0;

/// Shortest IR stretch the convolution engine accepts.
pub const MIN_IR_STRETCH: f32 = 0.25;
/// Longest IR stretch the convolution engine accepts.
pub const MAX_IR_STRETCH: f32 = 4.0;

/// Map a normalised `decay` onto `[min, max]` with a constant ratio per unit of
/// knob travel. RT-safe: one clamp and one `powf`, no allocation, no locks.
#[inline]
pub fn map_decay(decay: f32, min: f32, max: f32) -> f32 {
    let normalised = decay.clamp(0.0, 1.0);
    min * (max / min).powf(normalised)
}

/// FDN reverberation time in seconds for a normalised `decay`.
///
/// Reading the raw coefficient as an RT60 instead — which the FDN used to do —
/// pinned the tail to 0.1..1.0 s and made the top of the knob unreachable.
pub fn decay_to_rt60_seconds(decay: f32) -> f32 {
    map_decay(decay, MIN_RT60_SECONDS, MAX_RT60_SECONDS)
}

/// Convolution IR stretch factor for a normalised `decay`.
///
/// Unity — the IR at its natural length — sits on the descriptor default of
/// 0.5, where the previous linear law (`0.25 + decay * 3.75`) put 2.1x.
pub fn decay_to_ir_stretch(decay: f32) -> f32 {
    map_decay(decay, MIN_IR_STRETCH, MAX_IR_STRETCH)
}

#[cfg(test)]
mod tests {
    use super::{
        decay_to_ir_stretch, decay_to_rt60_seconds, DECAY_DEFAULT, DECAY_MAX, MAX_IR_STRETCH,
        MAX_RT60_SECONDS, MIN_IR_STRETCH, MIN_RT60_SECONDS,
    };

    #[test]
    fn both_engines_span_their_full_range_over_the_declared_decay_range() {
        assert!((decay_to_rt60_seconds(0.0) - MIN_RT60_SECONDS).abs() < 1e-4);
        assert!(decay_to_rt60_seconds(DECAY_MAX) > 29.8);
        assert!(decay_to_rt60_seconds(DECAY_MAX) <= MAX_RT60_SECONDS);

        assert!((decay_to_ir_stretch(0.0) - MIN_IR_STRETCH).abs() < 1e-5);
        assert!(decay_to_ir_stretch(DECAY_MAX) > 3.98);
        assert!(decay_to_ir_stretch(DECAY_MAX) <= MAX_IR_STRETCH);
    }

    #[test]
    fn the_descriptor_default_leaves_a_loaded_ir_at_its_natural_length() {
        assert!(
            (decay_to_ir_stretch(DECAY_DEFAULT) - 1.0).abs() < 1e-5,
            "default decay must be a neutral stretch, got {}",
            decay_to_ir_stretch(DECAY_DEFAULT)
        );
    }

    #[test]
    fn equal_knob_travel_is_an_equal_ratio_in_both_engines() {
        let rt60_ratio = decay_to_rt60_seconds(0.5) / decay_to_rt60_seconds(0.25);
        let stretch_ratio = decay_to_ir_stretch(0.5) / decay_to_ir_stretch(0.25);

        assert!((rt60_ratio - decay_to_rt60_seconds(0.75) / decay_to_rt60_seconds(0.5)).abs() < 1e-4);
        assert!((stretch_ratio - decay_to_ir_stretch(0.75) / decay_to_ir_stretch(0.5)).abs() < 1e-5);
    }

    #[test]
    fn values_outside_the_declared_range_clamp_rather_than_extrapolate() {
        assert!((decay_to_rt60_seconds(-3.0) - MIN_RT60_SECONDS).abs() < 1e-4);
        assert!((decay_to_rt60_seconds(9.0) - MAX_RT60_SECONDS).abs() < 1e-3);
        assert!((decay_to_ir_stretch(-3.0) - MIN_IR_STRETCH).abs() < 1e-5);
        assert!((decay_to_ir_stretch(9.0) - MAX_IR_STRETCH).abs() < 1e-5);
    }
}
