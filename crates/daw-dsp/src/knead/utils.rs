use std::f32::consts::PI;

pub use crate::primitives::pitch::parabolic_minimum;

/// Populates the provided slice with a Hann window.
pub fn hann_window_inplace(window: &mut [f32]) {
    let n = window.len();
    if n == 0 {
        return;
    }
    if n == 1 {
        window[0] = 1.0;
        return;
    }
    for (i, val) in window.iter_mut().enumerate() {
        *val = 0.5 * (1.0 - (2.0 * PI * i as f32 / (n - 1) as f32).cos());
    }
}
