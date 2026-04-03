//! Top-level engine wrapper for Knead Real-time pitch manipulation.

use crate::knead::voicing::{is_voiced, VoicingConfig};
use crate::knead::yin::{yin_frame, YinConfig};

pub struct KneadEngine {
    pub yin_cfg: YinConfig,
    pub voicing_cfg: VoicingConfig,

    // Scratch buffers to avoid RT allocations
    work_d: Vec<f32>,
    work_cmnd: Vec<f32>,

    // Current State
    current_f0: Option<f32>,
    current_periodicity: f32,
    is_actively_voiced: bool,
}

impl KneadEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut yin_cfg = YinConfig::default();
        yin_cfg.sample_rate = sample_rate;

        let tau_max = (sample_rate / yin_cfg.f0_min).ceil() as usize;

        Self {
            yin_cfg,
            voicing_cfg: VoicingConfig::default(),
            work_d: vec![0.0; tau_max + 1],
            work_cmnd: vec![1.0; tau_max + 1],
            current_f0: None,
            current_periodicity: 0.0,
            is_actively_voiced: false,
        }
    }

    pub fn process_analysis_frame(&mut self, input: &[f32]) {
        // Run YIN
        let result = yin_frame(input, &self.yin_cfg, &mut self.work_d, &mut self.work_cmnd);

        // Gate voicing
        let voiced = is_voiced(input, result.periodicity, &self.voicing_cfg);

        self.is_actively_voiced = voiced;
        if voiced {
            self.current_f0 = result.f0_hz;
        } else {
            self.current_f0 = None;
        }
        self.current_periodicity = result.periodicity;
    }

    pub fn get_f0(&self) -> Option<f32> {
        self.current_f0
    }

    pub fn is_voiced(&self) -> bool {
        self.is_actively_voiced
    }
}
