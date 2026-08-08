//! Product-neutral DSP contracts and reusable primitives.

#[cfg(test)]
pub(crate) mod alias_probe;
pub mod cutoff;
pub mod denormal;
pub mod lifecycle;
pub mod oversample;
pub mod resonance;
pub mod sanitize;
pub mod time_stretch;

pub use cutoff::{
    hz_from_normalized_cutoff, normalized_cutoff_from_hz, CUTOFF_HZ_MAX, CUTOFF_HZ_MIN,
};
pub use denormal::{
    flush_denormal, flush_denormal_f64, flush_denormal_in_place, DENORMAL_THRESHOLD,
};
pub use lifecycle::{ProcessLifecycle, TailLength};
pub use resonance::{
    normalized_resonance_from_q, q_from_normalized_resonance, RESONANCE_Q_MAX, RESONANCE_Q_MIN,
};
pub use sanitize::sanitize_block;
