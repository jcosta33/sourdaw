//! Product-neutral DSP contracts and reusable primitives.

pub mod denormal;
pub mod sanitize;
pub mod time_stretch;

pub use denormal::{flush_denormal, flush_denormal_f64, flush_denormal_in_place, DENORMAL_THRESHOLD};
pub use sanitize::sanitize_block;
