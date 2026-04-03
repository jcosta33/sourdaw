//! YIN pitch tracking algorithm.
//! Based on de Cheveigné & Kawahara (2002) "YIN, a fundamental frequency estimator for speech and music."

use crate::knead::utils::parabolic_minimum;

#[derive(Clone, Copy)]
pub struct YinConfig {
    pub sample_rate: f32,
    pub frame_size: usize,
    pub f0_min: f32,
    pub f0_max: f32,
    pub cmnd_threshold: f32,
}

impl Default for YinConfig {
    fn default() -> Self {
        Self {
            sample_rate: 44100.0,
            frame_size: 2048,
            f0_min: 50.0,
            f0_max: 1000.0,
            cmnd_threshold: 0.15,
        }
    }
}

pub struct YinResult {
    pub f0_hz: Option<f32>,
    pub periodicity: f32,
    pub tau: Option<f32>,
}

pub fn yin_frame(
    x: &[f32],
    cfg: &YinConfig,
    work_buffer_d: &mut [f32],
    work_buffer_cmnd: &mut [f32],
) -> YinResult {
    let n = cfg.frame_size.min(x.len());
    let tau_min = (cfg.sample_rate / cfg.f0_max).floor() as usize;
    let tau_max = (cfg.sample_rate / cfg.f0_min).ceil() as usize;
    let tau_max = tau_max.min(n - 1);

    if n <= tau_max {
        return YinResult {
            f0_hz: None,
            periodicity: 0.0,
            tau: None,
        };
    }

    // 1) Difference function
    for tau in 1..=tau_max {
        let mut sum = 0.0;
        for t in 0..(n - tau) {
            let diff = x[t] - x[t + tau];
            sum += diff * diff;
        }
        work_buffer_d[tau] = sum;
    }

    // 2) Cumulative Mean Normalized Difference (CMND)
    work_buffer_cmnd[0] = 1.0;
    let mut running_sum = 0.0_f32;
    for tau in 1..=tau_max {
        running_sum += work_buffer_d[tau];
        work_buffer_cmnd[tau] = if running_sum > 0.0 {
            work_buffer_d[tau] * (tau as f32) / running_sum
        } else {
            1.0
        };
    }

    // 3) Absolute threshold search
    let mut pick: Option<usize> = None;
    for tau in tau_min..=tau_max {
        if work_buffer_cmnd[tau] < cfg.cmnd_threshold {
            // Found a dip! Now look for the local minimum.
            let mut t0 = tau;
            while t0 + 1 <= tau_max && work_buffer_cmnd[t0 + 1] < work_buffer_cmnd[t0] {
                t0 += 1;
            }
            pick = Some(t0);
            break;
        }
    }

    // 4) Parabolic refinement & Final Output
    if let Some(tau_i) = pick {
        let (tau_f, min_val) = parabolic_minimum(work_buffer_cmnd, tau_i, tau_max);
        let f0 = cfg.sample_rate / tau_f;
        let periodicity = 1.0 - min_val.clamp(0.0, 1.0);
        YinResult {
            f0_hz: Some(f0),
            periodicity,
            tau: Some(tau_f),
        }
    } else {
        // Fallback: search for global minimum if threshold not reached
        let mut min_val = f32::MAX;
        let mut _best_tau = tau_min;
        for tau in tau_min..=tau_max {
            if work_buffer_cmnd[tau] < min_val {
                min_val = work_buffer_cmnd[tau];
                _best_tau = tau;
            }
        }
        let periodicity = 1.0 - min_val.clamp(0.0, 1.0);
        YinResult {
            f0_hz: None,
            periodicity,
            tau: None,
        }
    }
}
