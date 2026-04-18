//! Top-level engine wrapper for Knead Real-time pitch manipulation.

use daw_core::tuning::TuningManager;
use crate::knead::psola::{psola_process_offline_inplace, PsolaConfig};
use crate::knead::voicing::{is_voiced, VoicingConfig};
use crate::knead::yin::{yin_frame, YinConfig};

pub struct KneadEngine {
    pub yin_cfg: YinConfig,
    pub voicing_cfg: VoicingConfig,
    pub tuning: TuningManager,

    // Scratch buffers to avoid RT allocations
    work_d: Vec<f32>,
    work_cmnd: Vec<f32>,
    pitch_marks: Vec<usize>,
    target_f0_curve: Vec<f32>,
    window_scratchpad: Vec<f32>,
    psola_l_buffer: Vec<f32>,
    psola_work_buffer: Vec<f32>,

    // Accumulator buffers for RT block processing
    in_buffer_l: Vec<f32>,
    in_buffer_r: Vec<f32>,
    
    // Fixed-size output ring buffers to avoid allocations
    out_buffer_l: Vec<f32>,
    out_buffer_r: Vec<f32>,
    out_read_pos: usize,
    out_write_pos: usize,
    out_count: usize,

    pub shift_semitones: f32,
    pub always_analyze: bool, // Set to true when UI is open to see pitch
    psola_cfg: PsolaConfig,

    // Current State
    current_f0: Option<f32>,
    current_periodicity: f32,
    is_actively_voiced: bool,
}
impl KneadEngine {
    pub fn new(sample_rate: f32, tuning: TuningManager) -> Self {
        let mut yin_cfg = YinConfig::default();
        yin_cfg.sample_rate = sample_rate;

        let tau_max = (sample_rate / yin_cfg.f0_min).ceil() as usize;
        let frame_size = yin_cfg.frame_size;
        let ring_capacity = frame_size * 8;

        Self {
            yin_cfg,
            voicing_cfg: VoicingConfig::default(),
            tuning,
            work_d: vec![0.0; tau_max + 1],
...

            work_cmnd: vec![1.0; tau_max + 1],
            pitch_marks: Vec::with_capacity(256),
            target_f0_curve: vec![0.0; frame_size],
            window_scratchpad: vec![0.0; 4096],
            psola_l_buffer: vec![0.0; frame_size],
            psola_work_buffer: vec![0.0; frame_size],
            in_buffer_l: Vec::with_capacity(frame_size),
            in_buffer_r: Vec::with_capacity(frame_size),
            out_buffer_l: vec![0.0; ring_capacity],
            out_buffer_r: vec![0.0; ring_capacity],
            out_read_pos: 0,
            out_write_pos: 0,
            out_count: 0,
            shift_semitones: 0.0,
            always_analyze: false,
            psola_cfg: PsolaConfig {
                sample_rate,
                ..PsolaConfig::default()
            },
            current_f0: None,
            current_periodicity: 0.0,
            is_actively_voiced: false,
        }
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        self.tuning.update();
        let num_samples = left.len();
        let ring_cap = self.out_buffer_l.len();
        
        for i in 0..num_samples {
            self.in_buffer_l.push(left[i]);
            self.in_buffer_r.push(right[i]);

            if self.in_buffer_l.len() >= self.yin_cfg.frame_size {
                // Determine if we need to run YIN
                let needs_analysis = self.shift_semitones != 0.0 || self.always_analyze;

                if !needs_analysis {
                    for j in 0..self.in_buffer_l.len() {
                        if self.out_count < ring_cap {
                            self.out_buffer_l[self.out_write_pos] = self.in_buffer_l[j];
                            self.out_buffer_r[self.out_write_pos] = self.in_buffer_r[j];
                            self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                            self.out_count += 1;
                        }
                    }
                    self.current_f0 = None;
                    self.is_actively_voiced = false;
                } else {
                    let result = yin_frame(
                        &self.in_buffer_l,
                        &self.yin_cfg,
                        &mut self.work_d,
                        &mut self.work_cmnd,
                    );

                    let voiced = is_voiced(&self.in_buffer_l, result.periodicity, &self.voicing_cfg);
                    self.is_actively_voiced = voiced;
                    self.current_f0 = if voiced { result.f0_hz } else { None };
                    self.current_periodicity = result.periodicity;

                    if voiced && self.shift_semitones != 0.0 {
                        if let Some(f0) = self.current_f0 {
                            let period = self.yin_cfg.sample_rate / f0;
                            self.pitch_marks.clear();
                            let mut p = 0.0;
                            while (p as usize) < self.in_buffer_l.len() {
                                self.pitch_marks.push(p as usize);
                                p += period;
                            }

                            // Use TuningManager for target frequency
                            let current_midi = 69.0 + 12.0 * (f0 / 440.0).log2() as f64;
                            let target_midi = current_midi + self.shift_semitones as f64;
                            let target_f0 = self.tuning.get_frequency(target_midi) as f32;
                            
                            for val in self.target_f0_curve.iter_mut() { *val = target_f0; }

                            psola_process_offline_inplace(
                                &self.in_buffer_l,
                                &self.pitch_marks,
                                &self.target_f0_curve,
                                &self.psola_cfg,
                                &mut self.window_scratchpad,
                                &mut self.psola_l_buffer,
                            );
                            
                            psola_process_offline_inplace(
                                &self.in_buffer_r,
                                &self.pitch_marks,
                                &self.target_f0_curve,
                                &self.psola_cfg,
                                &mut self.window_scratchpad,
                                &mut self.psola_work_buffer,
                            );
                            
                            for j in 0..self.psola_l_buffer.len() {
                                if self.out_count < ring_cap {
                                    self.out_buffer_l[self.out_write_pos] = self.psola_l_buffer[j];
                                    self.out_buffer_r[self.out_write_pos] = self.psola_work_buffer[j];
                                    self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                                    self.out_count += 1;
                                }
                            }
                        } else {
                            for j in 0..self.in_buffer_l.len() {
                                if self.out_count < ring_cap {
                                    self.out_buffer_l[self.out_write_pos] = self.in_buffer_l[j];
                                    self.out_buffer_r[self.out_write_pos] = self.in_buffer_r[j];
                                    self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                                    self.out_count += 1;
                                }
                            }
                        }
                    } else {
                        for j in 0..self.in_buffer_l.len() {
                            if self.out_count < ring_cap {
                                self.out_buffer_l[self.out_write_pos] = self.in_buffer_l[j];
                                self.out_buffer_r[self.out_write_pos] = self.in_buffer_r[j];
                                self.out_write_pos = (self.out_write_pos + 1) % ring_cap;
                                self.out_count += 1;
                            }
                        }
                    }
                }

                self.in_buffer_l.clear();
                self.in_buffer_r.clear();
            }
        }

        for i in 0..num_samples {
            if self.out_count > 0 {
                left[i] = self.out_buffer_l[self.out_read_pos];
                right[i] = self.out_buffer_r[self.out_read_pos];
                self.out_read_pos = (self.out_read_pos + 1) % ring_cap;
                self.out_count -= 1;
            } else {
                left[i] = 0.0;
                right[i] = 0.0;
            }
        }
    }

    pub fn get_f0(&self) -> Option<f32> { self.current_f0 }
    pub fn get_periodicity(&self) -> f32 { self.current_periodicity }
    pub fn is_voiced(&self) -> bool { self.is_actively_voiced }
}
