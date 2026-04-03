//! Utility functions for Knead pitch correction and DSP processing.

/// Performs parabolic interpolation around the index `x` to find the exact local minimum in an array.
/// Returns (exact_index, exact_minimum_value).
pub fn parabolic_minimum(data: &[f32], x: usize, max_index: usize) -> (f32, f32) {
    if x == 0 || x >= max_index {
        return (x as f32, data[x]);
    }

    let s0 = data[x - 1];
    let s1 = data[x];
    let s2 = data[x + 1];

    let bottom = s0 + s2 - 2.0 * s1;
    if bottom == 0.0 {
        return (x as f32, s1);
    }

    let delta = (s0 - s2) / (2.0 * bottom);
    let min_index = x as f32 + delta;
    let min_val = s1 - (delta * delta * bottom * 0.5);

    (min_index, min_val)
}

/// Blackman-Harris window for grain extraction.
pub fn blackman_harris_window(len: usize) -> Vec<f32> {
    let mut w = vec![0.0; len];
    let n_f32 = len as f32;
    for i in 0..len {
        let phase = std::f32::consts::TAU * i as f32 / n_f32;
        w[i] = 0.35875 - 0.48829 * phase.cos() + 0.14128 * (2.0 * phase).cos()
            - 0.01168 * (3.0 * phase).cos();
    }
    w
}

/// Hann window for overlapping grains.
pub fn hann_window(len: usize) -> Vec<f32> {
    let mut w = vec![0.0; len];
    let n_f32 = len as f32;
    for i in 0..len {
        let phase = std::f32::consts::TAU * i as f32 / n_f32;
        w[i] = 0.5 * (1.0 - phase.cos());
    }
    w
}
