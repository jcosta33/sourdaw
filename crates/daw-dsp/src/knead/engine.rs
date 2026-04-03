//! Top-level engine wrapper for Knead Real-time pitch manipulation.

use std::collections::VecDeque;

use crate::knead::psola::{psola_process_offline, PsolaConfig};
use crate::knead::voicing::{is_voiced, VoicingConfig};
use crate::knead::yin::{yin_frame, YinConfig};

pub struct KneadEngine {
    pub yin_cfg: YinConfig,
    pub voicing_cfg: VoicingConfig,

    // Scratch buffers to avoid RT allocations
    work_d: Vec<f32>,
    work_cmnd: Vec<f32>,

    // Accumulator ring buffer for RT block processing
    in_buffer: Vec<f32>,
    out_buffer: VecDeque<f32>,

    pub shift_semitones: f32,
    psola_cfg: PsolaConfig,

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
            in_buffer: Vec::with_capacity(yin_cfg.frame_size),
            out_buffer: VecDeque::with_capacity(yin_cfg.frame_size * 2),
            shift_semitones: 0.0,
            psola_cfg: PsolaConfig {
                sample_rate,
                ..PsolaConfig::default()
            },
            current_f0: None,
            current_periodicity: 0.0,
            is_actively_voiced: false,
        }
    }

    pub fn process_analysis_frame(&mut self, input: &mut [f32]) {
        for &sample in input.iter() {
            self.in_buffer.push(sample);
            
            // Accumulate enough samples before calling yin_frame
            if self.in_buffer.len() >= self.yin_cfg.frame_size {
                // Run YIN
                let result = yin_frame(&self.in_buffer, &self.yin_cfg, &mut self.work_d, &mut self.work_cmnd);

                // Gate voicing
                let voiced = is_voiced(&self.in_buffer, result.periodicity, &self.voicing_cfg);

                self.is_actively_voiced = voiced;
                if voiced {
                    self.current_f0 = result.f0_hz;
                } else {
                    self.current_f0 = None;
                }
                self.current_periodicity = result.periodicity;

                if voiced && self.shift_semitones != 0.0 {
                    if let Some(f0) = self.current_f0 {
                        let period = self.yin_cfg.sample_rate / f0;
                        let mut pitch_marks = Vec::with_capacity(100);
                        let mut p = 0.0;
                        while (p as usize) < self.in_buffer.len() {
                            pitch_marks.push(p as usize);
                            p += period;
                        }

                        let target_f0 = f0 * 2.0_f32.powf(self.shift_semitones / 12.0);
                        let target_f0_curve = vec![target_f0; self.in_buffer.len()];

                        // Apply pitch-shifting to the signal based on detected f0
                        let out = psola_process_offline(&self.in_buffer, &pitch_marks, &target_f0_curve, &self.psola_cfg);
                        self.out_buffer.extend(out);
                    } else {
                        self.out_buffer.extend(self.in_buffer.iter());
                    }
                } else {
                    self.out_buffer.extend(self.in_buffer.iter());
                }
                
                // Reset accumulation buffer
                self.in_buffer.clear();
            }
        }

        // Drain the processed output
        for out_sample in input.iter_mut() {
            *out_sample = self.out_buffer.pop_front().unwrap_or(0.0);
        }
    }

    pub fn get_f0(&self) -> Option<f32> {
        self.current_f0
    }

    pub fn is_voiced(&self) -> bool {
        self.is_actively_voiced
    }
}
