// Frozen test-only source oracle from cdf56ae23082998f2f3be0264309ca2c6025dee2.
// Captured before the shared-pitch extraction; never used by production.
#![allow(dead_code)]

pub mod yin;
pub mod psola;
pub mod engine;
pub mod crumbs;

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
