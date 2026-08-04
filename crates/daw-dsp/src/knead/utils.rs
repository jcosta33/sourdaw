use std::f32::consts::PI;

/// Refines an integer peak to a floating-point minimum by fitting a parabola.
pub fn parabolic_minimum(x: &[f32], i: usize, max_idx: usize) -> (f32, f32) {
    if i == 0 || i >= max_idx {
        return (i as f32, x[i]);
    }
    let alpha = x[i - 1];
    let beta = x[i];
    let gamma = x[i + 1];

    let denom = alpha - 2.0 * beta + gamma;
    if denom == 0.0 {
        return (i as f32, x[i]);
    }

    let p = 0.5 * (alpha - gamma) / denom;
    (i as f32 + p, beta - 0.25 * (alpha - gamma) * p)
}

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
