//! YIN pitch tracking algorithm.
//! Based on de Cheveigné & Kawahara (2002) "YIN, a fundamental frequency estimator for speech and music."

use super::pipeline::{finish_yin, normalize_cmnd, YinProfile};

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

    // Overlap callers retain their required caller-owned scratch extent.
    normalize_cmnd(
        &work_buffer_d[..=tau_max],
        &mut work_buffer_cmnd[..=tau_max],
        tau_max,
    );
    finish_yin(
        work_buffer_cmnd,
        cfg.sample_rate,
        tau_min,
        tau_max,
        YinProfile::FirstThreshold {
            threshold: cfg.cmnd_threshold,
        },
    )
}
