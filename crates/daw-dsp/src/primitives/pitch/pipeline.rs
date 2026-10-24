use super::YinResult;

/// The two existing YIN contracts. Each profile fixes selection, interpolation
/// and confidence together; callers cannot mix incompatible policies.
#[derive(Clone, Copy)]
pub(super) enum YinProfile {
    FirstThreshold { threshold: f32 },
    HarmonicWeighted { threshold: f32 },
}

pub(super) fn normalize_cmnd(difference: &[f32], cmnd: &mut [f32], max_tau: usize) {
    cmnd[0] = 1.0;
    let mut running_sum = 0.0_f32;
    for tau in 1..=max_tau {
        if tau < difference.len() && tau < cmnd.len() {
            running_sum += difference[tau];
            cmnd[tau] = if running_sum > 0.0 {
                difference[tau] * tau as f32 / running_sum
            } else {
                1.0
            };
        }
    }
}

pub(super) fn finish_yin(
    cmnd: &[f32],
    sample_rate: f32,
    min_tau: usize,
    max_tau: usize,
    profile: YinProfile,
) -> YinResult {
    let pick = match profile {
        YinProfile::FirstThreshold { threshold } => {
            let mut pick = None;
            for tau in min_tau..=max_tau {
                if cmnd[tau] < threshold {
                    let mut t0 = tau;
                    while t0 + 1 <= max_tau && cmnd[t0 + 1] < cmnd[t0] {
                        t0 += 1;
                    }
                    pick = Some(t0);
                    break;
                }
            }
            pick
        }
        YinProfile::HarmonicWeighted { threshold } => {
            let mut best_tau = 0;
            let mut best_score = -1.0_f32;
            for tau in min_tau..=max_tau {
                if tau >= cmnd.len() {
                    break;
                }
                if tau > 0 && tau < max_tau {
                    let prev = if tau > 0 { cmnd[tau - 1] } else { 1.0 };
                    let curr = cmnd[tau];
                    let next = if tau + 1 < cmnd.len() {
                        cmnd[tau + 1]
                    } else {
                        1.0
                    };
                    if curr <= prev && curr <= next && curr < threshold * 2.0 {
                        let harmonic_weight = 1.0 / (1.0 + tau as f32 * 0.0005);
                        let score = (1.0 - curr) * harmonic_weight;
                        if score > best_score {
                            best_score = score;
                            best_tau = tau;
                        }
                    }
                }
            }
            if best_tau == 0 || best_score < 0.0 {
                None
            } else {
                Some(best_tau)
            }
        }
    };

    let Some(tau_i) = pick else {
        let periodicity = match profile {
            YinProfile::FirstThreshold { .. } => {
                let mut min_val = f32::MAX;
                for tau in min_tau..=max_tau {
                    if cmnd[tau] < min_val {
                        min_val = cmnd[tau];
                    }
                }
                1.0 - min_val.clamp(0.0, 1.0)
            }
            YinProfile::HarmonicWeighted { .. } => 0.0,
        };
        return YinResult {
            f0_hz: None,
            periodicity,
            tau: None,
        };
    };

    let (tau, value) = interpolate_minimum(cmnd, tau_i, max_tau, profile);
    let periodicity = match profile {
        YinProfile::FirstThreshold { .. } => 1.0 - value.clamp(0.0, 1.0),
        YinProfile::HarmonicWeighted { .. } => (1.0 - value).clamp(0.0, 1.0),
    };
    YinResult {
        f0_hz: Some(sample_rate / tau),
        periodicity,
        tau: Some(tau),
    }
}

fn interpolate_minimum(
    values: &[f32],
    k: usize,
    max_tau: usize,
    profile: YinProfile,
) -> (f32, f32) {
    match profile {
        YinProfile::FirstThreshold { .. } => parabolic_minimum(values, k, max_tau),
        YinProfile::HarmonicWeighted { .. } => {
            let y_minus = if k > 0 && k - 1 < values.len() {
                values[k - 1]
            } else {
                values[k]
            };
            let y0 = values[k];
            let y_plus = if k + 1 < values.len() {
                values[k + 1]
            } else {
                values[k]
            };
            let denom = y_minus - 2.0 * y0 + y_plus;
            let delta = if denom.abs() > 1e-10 {
                ((y_minus - y_plus) / (2.0 * denom)).clamp(-0.5, 0.5)
            } else {
                0.0
            };
            (k as f32 + delta, y0)
        }
    }
}

/// Refines an integer minimum using the original unconstrained overlap fit.
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
