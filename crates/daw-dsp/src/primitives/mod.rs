//! Product-neutral DSP contracts and reusable primitives.

#[cfg(test)]
pub(crate) mod alias_probe;
pub mod denormal;
pub mod oversample;
pub mod sanitize;
pub mod time_stretch;

pub use denormal::{flush_denormal, flush_denormal_f64, flush_denormal_in_place, DENORMAL_THRESHOLD};
pub use sanitize::sanitize_block;
