//! GlutenEngine — top-level compressor orchestrator.
//!
//! Routes audio through: sidechain → detector → topology → gain application.
//! Handles M/S encoding, stereo linking, lookahead, parallel mix.

use super::vca::VcaCompressor;
use super::opto::OptoCompressor;
use super::fet::FetCompressor;
use super::diode::DiodeCompressor;
use super::detector::{RmsDetector, DetectionMode};
use super::sidechain::{SidechainHpf, ThrustFilter};
use super::stereo::{encode_ms, decode_ms, parallel_mix, StereoMode};
use super::lookahead::LookaheadDelay;
use super::params::SmoothedParam;
use super::gain_computer::{db_to_linear, auto_makeup};

/// Compressor topology selector.
#[derive(Clone, Copy, PartialEq)]
pub enum Topology {
    Vca,    // SSL G-Bus
    Opto,   // LA-2A
    Fet,    // 1176
    Diode,  // Neve 33609
}

/// Style presets (Level 1 UI).
#[derive(Clone, Copy, PartialEq)]
pub enum CompStyle {
    Glue,   // VCA, 4:1, 10ms attack, auto release
    Punch,  // FET, fast attack, medium release
    Smooth, // Opto, program-dependent
    Pump,   // VCA, fast attack, long release
}

pub struct GlutenEngine {
    sample_rate: f32,

    // Topology instances
    vca: VcaCompressor,
    opto: OptoCompressor,
    fet: FetCompressor,
    diode: DiodeCompressor,
    active_topology: Topology,

    // Sidechain
    sc_hpf_l: SidechainHpf,
    sc_hpf_r: SidechainHpf,
    sc_hpf_freq: f32,
    thrust: ThrustFilter,

    // Detector
    rms_l: RmsDetector,
    rms_r: RmsDetector,
    detection_mode: DetectionMode,

    // Stereo
    stereo_mode: StereoMode,
    stereo_link: f32,

    // Lookahead
    lookahead_l: LookaheadDelay,
    lookahead_r: LookaheadDelay,
    lookahead_ms: f32,

    // Output
    mix: SmoothedParam,
    makeup_gain: SmoothedParam,
    auto_makeup: bool,
    bypassed: bool,

    // Metering (updated per-block)
    meter_gr_db: f32,
    meter_input_db: f32,
    meter_output_db: f32,
    meter_input_peak: f32,
    meter_output_peak: f32,
}

impl GlutenEngine {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            sample_rate,
            vca: VcaCompressor::new(sample_rate),
            opto: OptoCompressor::new(sample_rate),
            fet: FetCompressor::new(sample_rate),
            diode: DiodeCompressor::new(sample_rate),
            active_topology: Topology::Vca,

            sc_hpf_l: SidechainHpf::new(sample_rate, 80.0),
            sc_hpf_r: SidechainHpf::new(sample_rate, 80.0),
            sc_hpf_freq: 80.0,
            thrust: ThrustFilter::new(sample_rate),

            rms_l: RmsDetector::new(sample_rate, 10.0),
            rms_r: RmsDetector::new(sample_rate, 10.0),
            detection_mode: DetectionMode::Rms,

            stereo_mode: StereoMode::Stereo,
            stereo_link: 1.0,

            lookahead_l: LookaheadDelay::new(20.0, sample_rate),
            lookahead_r: LookaheadDelay::new(20.0, sample_rate),
            lookahead_ms: 0.0,

            mix: SmoothedParam::new(1.0, 5.0, sample_rate),
            makeup_gain: SmoothedParam::new(0.0, 5.0, sample_rate),
            auto_makeup: false,
            bypassed: false,

            meter_gr_db: 0.0,
            meter_input_db: -100.0,
            meter_output_db: -100.0,
            meter_input_peak: 0.0,
            meter_output_peak: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            // Global controls
            "topology" => {
                self.active_topology = match value as u8 {
                    0 => Topology::Vca,
                    1 => Topology::Opto,
                    2 => Topology::Fet,
                    3 => Topology::Diode,
                    _ => Topology::Vca,
                };
            }
            "style" => {
                self.load_style(match value as u8 {
                    0 => CompStyle::Glue,
                    1 => CompStyle::Punch,
                    2 => CompStyle::Smooth,
                    3 => CompStyle::Pump,
                    _ => CompStyle::Glue,
                });
            }
            "mix" => self.mix.set_target(value.clamp(0.0, 1.0)),
            "makeup" => self.makeup_gain.set_target(value.clamp(-12.0, 24.0)),
            "auto_makeup" => self.auto_makeup = value > 0.5,
            "bypass" => self.bypassed = value > 0.5,

            // Sidechain
            "sc_hpf_freq" => {
                self.sc_hpf_freq = value.clamp(20.0, 500.0);
                self.sc_hpf_l.set_freq(self.sample_rate, self.sc_hpf_freq);
                self.sc_hpf_r.set_freq(self.sample_rate, self.sc_hpf_freq);
            }
            "sc_hpf_enabled" => {
                let enabled = value > 0.5;
                self.sc_hpf_l.set_enabled(enabled);
                self.sc_hpf_r.set_enabled(enabled);
            }
            "thrust" => self.thrust.set_mode(value),

            // Detection
            "detection" => {
                self.detection_mode = if value > 0.5 {
                    DetectionMode::Peak
                } else {
                    DetectionMode::Rms
                };
            }

            // Stereo
            "stereo_mode" => {
                self.stereo_mode = match value as u8 {
                    0 => StereoMode::Stereo,
                    1 => StereoMode::Mid,
                    2 => StereoMode::Side,
                    3 => StereoMode::DualMono,
                    _ => StereoMode::Stereo,
                };
            }
            "stereo_link" => self.stereo_link = value.clamp(0.0, 1.0),

            // Lookahead
            "lookahead" => self.lookahead_ms = value.clamp(0.0, 20.0),

            // Forward all other params to active topology
            _ => {
                self.vca.set_param(name, value);
                self.opto.set_param(name, value);
                self.fet.set_param(name, value);
                self.diode.set_param(name, value);
            }
        }
    }

    fn load_style(&mut self, style: CompStyle) {
        match style {
            CompStyle::Glue => {
                self.active_topology = Topology::Vca;
                self.vca.set_param("threshold", -18.0);
                self.vca.set_param("ratio", 4.0);
                self.vca.set_param("attack", 10.0);
                self.vca.set_param("auto_release", 1.0);
                self.vca.set_param("knee", 6.0);
                self.vca.set_param("range", 15.0);
                self.mix.set_target(1.0);
            }
            CompStyle::Punch => {
                self.active_topology = Topology::Fet;
                self.fet.set_param("threshold", -20.0);
                self.fet.set_param("ratio", 8.0);
                self.fet.set_param("attack", 0.2);
                self.fet.set_param("release", 250.0);
                self.mix.set_target(1.0);
            }
            CompStyle::Smooth => {
                self.active_topology = Topology::Opto;
                self.opto.set_param("threshold", -25.0);
                self.mix.set_target(1.0);
            }
            CompStyle::Pump => {
                self.active_topology = Topology::Vca;
                self.vca.set_param("threshold", -15.0);
                self.vca.set_param("ratio", 4.0);
                self.vca.set_param("attack", 0.5);
                self.vca.set_param("release", 800.0);
                self.vca.set_param("auto_release", 0.0);
                self.vca.set_param("knee", 3.0);
                self.mix.set_target(1.0);
            }
        }
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            return;
        }

        let len = left.len().min(right.len());
        let lookahead_samples = (self.lookahead_ms * 0.001 * self.sample_rate) as usize;

        let mut gr_sum = 0.0_f32;
        let mut input_peak = 0.0_f32;
        let mut output_peak = 0.0_f32;

        for i in 0..len {
            let dry_l = left[i];
            let dry_r = right[i];

            // Track input level
            input_peak = input_peak.max(dry_l.abs()).max(dry_r.abs());

            // M/S encode if needed
            let (proc_l, proc_r) = match self.stereo_mode {
                StereoMode::Mid | StereoMode::Side => encode_ms(dry_l, dry_r),
                _ => (dry_l, dry_r),
            };

            // Lookahead: delay the audio signal, process sidechain on undelayed
            let delayed_l = self.lookahead_l.process(proc_l, lookahead_samples);
            let delayed_r = self.lookahead_r.process(proc_r, lookahead_samples);

            // Process through active topology
            let (wet_l, wet_r, gr_db) = match self.active_topology {
                Topology::Vca => self.vca.process_sample(delayed_l, delayed_r),
                Topology::Opto => self.opto.process_sample(delayed_l, delayed_r),
                Topology::Fet => self.fet.process_sample(delayed_l, delayed_r),
                Topology::Diode => self.diode.process_sample(delayed_l, delayed_r),
            };

            gr_sum += gr_db;

            // Makeup gain
            let makeup = self.makeup_gain.next();
            let effective_makeup = if self.auto_makeup {
                // Use auto-makeup based on current topology settings
                makeup + self.compute_auto_makeup()
            } else {
                makeup
            };
            let makeup_lin = db_to_linear(effective_makeup);
            let made_up_l = wet_l * makeup_lin;
            let made_up_r = wet_r * makeup_lin;

            // Parallel mix
            let mix = self.mix.next();
            let mixed_l = parallel_mix(delayed_l, made_up_l, mix);
            let mixed_r = parallel_mix(delayed_r, made_up_r, mix);

            // M/S decode if needed
            let (out_l, out_r) = match self.stereo_mode {
                StereoMode::Mid => decode_ms(mixed_l, 0.0), // mid only
                StereoMode::Side => decode_ms(0.0, mixed_r), // side only
                _ => (mixed_l, mixed_r),
            };

            left[i] = out_l;
            right[i] = out_r;

            output_peak = output_peak.max(out_l.abs()).max(out_r.abs());
        }

        // Update meters
        if len > 0 {
            self.meter_gr_db = gr_sum / len as f32;
        }
        self.meter_input_peak = input_peak;
        self.meter_output_peak = output_peak;
        self.meter_input_db = if input_peak > 1e-10 {
            20.0 * input_peak.log10()
        } else {
            -100.0
        };
        self.meter_output_db = if output_peak > 1e-10 {
            20.0 * output_peak.log10()
        } else {
            -100.0
        };
    }

    fn compute_auto_makeup(&self) -> f32 {
        match self.active_topology {
            Topology::Vca => auto_makeup(-18.0, 4.0),
            Topology::Opto => auto_makeup(-20.0, 3.0),
            Topology::Fet => auto_makeup(-24.0, 4.0),
            Topology::Diode => auto_makeup(-16.0, 2.0),
        }
    }

    pub fn current_gr_db(&self) -> f32 {
        self.meter_gr_db
    }

    pub fn current_input_db(&self) -> f32 {
        self.meter_input_db
    }

    pub fn current_output_db(&self) -> f32 {
        self.meter_output_db
    }
}
