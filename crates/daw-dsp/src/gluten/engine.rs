//! GlutenEngine — top-level compressor orchestrator.
//!
//! Routes audio through: sidechain → detector → topology → gain application.
//! Handles M/S encoding, stereo linking, lookahead, parallel mix.

use super::detector::DetectionMode;
use super::diode::DiodeCompressor;
use super::fet::FetCompressor;
use super::gain_computer::{auto_makeup, db_to_linear};
use super::lookahead::LookaheadDelay;
use super::opto::OptoCompressor;
use super::params::SmoothedParam;
use super::sidechain::SidechainChain;
use super::stereo::{decode_ms, encode_ms, parallel_mix, StereoMode};
use super::vca::VcaCompressor;

/// Compressor topology selector.
#[derive(Clone, Copy, PartialEq)]
pub enum Topology {
    Vca,   // SSL G-Bus
    Opto,  // LA-2A
    Fet,   // 1176
    Diode, // Neve 33609
}

impl Topology {
    fn index(self) -> usize {
        match self {
            Self::Vca => 0,
            Self::Opto => 1,
            Self::Fet => 2,
            Self::Diode => 3,
        }
    }
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
    /// Second topology for dual-stage serial routing (Shadow Hills style)
    blend_topology: Topology,
    /// 0.0 = single topology, 1.0 = full dual-stage serial
    blend_amount: f32,

    // Sidechain
    sidechains: [SidechainChain; 4],

    // Detector. The detectors themselves live inside each topology, next to the
    // ballistics they steer; the engine keeps the selections so it can restate
    // them when the other one changes.
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
    /// Delta listen: output only the difference (compressed - dry)
    delta_listen: bool,
    /// Use external sidechain input for detection
    ext_sidechain: bool,
    ext_sc_left: Vec<f32>,
    ext_sc_right: Vec<f32>,
    /// Gain-matched bypass: compensate level difference when bypassing
    gain_match_bypass: bool,
    /// Running input loudness estimate (EMA of squared signal, ~400ms)
    input_loudness: f32,
    /// Running output loudness estimate
    output_loudness: f32,
    loudness_coeff: f32,

    // Metering (updated per-block)
    meter_gr_db: f32,
    meter_input_db: f32,
    meter_output_db: f32,
    meter_input_peak: f32,
    meter_output_peak: f32,
    /// GR history ring buffer for scrolling display (256 entries, ~5s at 50fps)
    gr_history: [f32; 256],
    gr_history_pos: u8,
    /// Crest factor: peak/RMS ratio in dB (higher = more transient)
    meter_crest: f32,
    /// Phase correlation: +1 = mono, 0 = uncorrelated, -1 = out of phase
    meter_phase_corr: f32,
    // Running accumulators for crest/phase (reset per block)
    rms_accum: f32,
    lr_product_accum: f32,
    l_sq_accum: f32,
    r_sq_accum: f32,
}

impl GlutenEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut engine = Self {
            sample_rate,
            vca: VcaCompressor::new(sample_rate),
            opto: OptoCompressor::new(sample_rate),
            fet: FetCompressor::new(sample_rate),
            diode: DiodeCompressor::new(sample_rate),
            active_topology: Topology::Vca,
            blend_topology: Topology::Opto,
            blend_amount: 0.0,

            sidechains: std::array::from_fn(|_| SidechainChain::new(sample_rate)),

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
            delta_listen: false,
            ext_sidechain: false,
            ext_sc_left: vec![0.0_f32; 4096],
            ext_sc_right: vec![0.0_f32; 4096],
            gain_match_bypass: false,
            input_loudness: 0.0,
            output_loudness: 0.0,
            loudness_coeff: (-1.0 / (0.4 * sample_rate)).exp(), // ~400ms window

            meter_gr_db: 0.0,
            meter_input_db: -100.0,
            meter_output_db: -100.0,
            meter_input_peak: 0.0,
            meter_output_peak: 0.0,
            gr_history: [0.0; 256],
            gr_history_pos: 0,
            meter_crest: 0.0,
            meter_phase_corr: 1.0,
            rms_accum: 0.0,
            lr_product_accum: 0.0,
            l_sq_accum: 0.0,
            r_sq_accum: 0.0,
        };
        // The topologies are constructed with their own detector defaults; push
        // the engine's declared ones down so a Gluten that is never sent a
        // patch still detects the way the descriptor says it does.
        engine.apply_detector_settings();
        engine
    }

    /// Restate detection mode and stereo link on every topology.
    ///
    /// Called whenever any of the three controls that determine them moves.
    /// Stereo mode is one of those three: `dual-mono` *is* an unlinked
    /// detector, which is the meaning it carries on every console-style bus
    /// compressor, so it forces the link to 0 rather than adding a second
    /// mechanism that does the same thing.
    ///
    /// Control-rate only — nothing here runs per sample.
    fn apply_detector_settings(&mut self) {
        let link = match self.stereo_mode {
            StereoMode::DualMono => 0.0,
            _ => self.stereo_link,
        };
        let mode = self.detection_mode;

        self.vca.set_detection(mode);
        self.opto.set_detection(mode);
        self.fet.set_detection(mode);
        self.diode.set_detection(mode);

        self.vca.set_stereo_link(link);
        self.opto.set_stereo_link(link);
        self.fet.set_stereo_link(link);
        self.diode.set_stereo_link(link);
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
            "blend_topology" => {
                self.blend_topology = match value as u8 {
                    0 => Topology::Vca,
                    1 => Topology::Opto,
                    2 => Topology::Fet,
                    3 => Topology::Diode,
                    _ => Topology::Opto,
                };
            }
            "blend_amount" => self.blend_amount = value.clamp(0.0, 1.0),
            "feed_forward" => {
                self.vca.set_param("feed_forward", value);
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

            // Amount macro: 0-100% maps to threshold (-5..-40 dB) + ratio (2..8)
            "amount" => {
                let pct = value.clamp(0.0, 100.0) / 100.0;
                let threshold = -5.0 - 35.0 * pct; // -5 to -40
                let ratio = 2.0 + 6.0 * pct; // 2:1 to 8:1
                                             // Forward to active topology
                self.vca.set_param("threshold", threshold);
                self.opto.set_param("threshold", threshold);
                self.fet.set_param("threshold", threshold);
                self.diode.set_param("threshold", threshold);
                self.vca.set_param("ratio", ratio);
                self.fet.set_param("ratio", ratio);
                self.diode.set_param("ratio", ratio.min(6.0));
            }

            // Sidechain
            "sc_hpf_freq" => {
                for sidechain in &mut self.sidechains {
                    sidechain.set_hpf_freq(self.sample_rate, value);
                }
            }
            "sc_hpf_enabled" => {
                let enabled = value > 0.5;
                for sidechain in &mut self.sidechains {
                    sidechain.set_hpf_enabled(enabled);
                }
            }
            "thrust" => {
                for sidechain in &mut self.sidechains {
                    sidechain.set_thrust(value);
                }
            }
            "sc_lpf_freq" => {
                for sidechain in &mut self.sidechains {
                    sidechain.set_lpf_freq(self.sample_rate, value);
                }
            }
            "sc_lpf_enabled" => {
                let enabled = value > 0.5;
                for sidechain in &mut self.sidechains {
                    sidechain.set_lpf_enabled(enabled);
                }
            }
            "sc_eq_freq" => {
                for sidechain in &mut self.sidechains {
                    sidechain.set_eq_freq(value);
                }
            }
            "sc_eq_gain" => {
                for sidechain in &mut self.sidechains {
                    sidechain.set_eq_gain(value);
                }
            }
            "sc_eq_q" => {
                for sidechain in &mut self.sidechains {
                    sidechain.set_eq_q(value);
                }
            }
            "sc_eq_enabled" => {
                let enabled = value > 0.5;
                for sidechain in &mut self.sidechains {
                    sidechain.set_eq_enabled(enabled);
                }
            }
            "delta_listen" => self.delta_listen = value > 0.5,
            "ext_sidechain" => self.ext_sidechain = value > 0.5,
            "gain_match_bypass" => self.gain_match_bypass = value > 0.5,

            // Detection
            "detection" => {
                self.detection_mode = if value > 0.5 {
                    DetectionMode::Peak
                } else {
                    DetectionMode::Rms
                };
                self.apply_detector_settings();
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
                self.apply_detector_settings();
            }
            "stereo_link" => {
                self.stereo_link = value.clamp(0.0, 1.0);
                self.apply_detector_settings();
            }

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

    /// Set external sidechain input for the next process_block call.
    pub fn set_ext_sc(&mut self, sc_left: &[f32], sc_right: &[f32]) {
        // Store in temp fields — used by process_block when ext_sidechain is true
        let len_l = sc_left.len().min(self.ext_sc_left.len());
        self.ext_sc_left[..len_l].copy_from_slice(&sc_left[..len_l]);

        let len_r = sc_right.len().min(self.ext_sc_right.len());
        self.ext_sc_right[..len_r].copy_from_slice(&sc_right[..len_r]);
    }

    pub fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            if self.gain_match_bypass && self.output_loudness > 1e-10 && self.input_loudness > 1e-10
            {
                // Gain-matched bypass: compensate output level to match input loudness
                let compensation = (self.input_loudness / self.output_loudness).sqrt();
                let comp_clamped = compensation.clamp(0.1, 10.0);
                for i in 0..left.len().min(right.len()) {
                    left[i] *= comp_clamped;
                    right[i] *= comp_clamped;
                }
            }
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

            // Lookahead: delay the audio for attack compensation
            let delayed_l = self.lookahead_l.process(proc_l, lookahead_samples);
            let delayed_r = self.lookahead_r.process(proc_r, lookahead_samples);

            // The diode is feed-forward, so its internal detector must stay on
            // the undelayed program while the audio path receives lookahead.
            // Stage two historically shared this same detector source.
            let program_detector = match self.stereo_mode {
                StereoMode::Mid => (proc_l, 0.0),
                StereoMode::Side => (0.0, proc_r),
                _ => (proc_l, proc_r),
            };

            let external_detector = if self.ext_sidechain && i < self.ext_sc_left.len() {
                let raw = (
                    self.ext_sc_left[i],
                    self.ext_sc_right.get(i).copied().unwrap_or(0.0),
                );
                let detector = match self.stereo_mode {
                    StereoMode::Mid | StereoMode::Side => encode_ms(raw.0, raw.1),
                    _ => raw,
                };
                Some(match self.stereo_mode {
                    StereoMode::Mid => (detector.0, 0.0),
                    StereoMode::Side => (0.0, detector.1),
                    _ => detector,
                })
            } else {
                None
            };

            // Process through active topology.
            let (topo_l, topo_r) = match self.stereo_mode {
                StereoMode::Mid => (delayed_l, 0.0),
                StereoMode::Side => (0.0, delayed_r),
                _ => (delayed_l, delayed_r),
            };
            // Primary topology
            let (mut wet_l, mut wet_r, gr_db) = self.process_topology(
                self.active_topology,
                topo_l,
                topo_r,
                program_detector,
                external_detector,
            );

            // Dual-stage serial routing (Shadow Hills style)
            // Second topology processes the output of the first
            if self.blend_amount > 0.001 && self.blend_topology != self.active_topology {
                let (s2_l, s2_r, gr2) = self.process_topology(
                    self.blend_topology,
                    wet_l,
                    wet_r,
                    program_detector,
                    external_detector,
                );
                // Crossfade between single and dual-stage
                let b = self.blend_amount;
                wet_l = wet_l * (1.0 - b) + s2_l * b;
                wet_r = wet_r * (1.0 - b) + s2_r * b;
                gr_sum += gr2 * b;
            }

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
                StereoMode::Mid => decode_ms(mixed_l, delayed_r),
                StereoMode::Side => decode_ms(delayed_l, mixed_r),
                _ => (mixed_l, mixed_r),
            };

            // Delta listen: output only the difference (what compression removed)
            if self.delta_listen {
                left[i] = dry_l - out_l;
                right[i] = dry_r - out_r;
            } else {
                left[i] = out_l;
                right[i] = out_r;
            }

            output_peak = output_peak.max(left[i].abs()).max(right[i].abs());

            // Track running loudness for gain-matched bypass (EMA of squared signal)
            let in_sq = (dry_l * dry_l + dry_r * dry_r) * 0.5;
            let out_sq = (left[i] * left[i] + right[i] * right[i]) * 0.5;
            self.input_loudness =
                self.loudness_coeff * self.input_loudness + (1.0 - self.loudness_coeff) * in_sq;
            self.output_loudness =
                self.loudness_coeff * self.output_loudness + (1.0 - self.loudness_coeff) * out_sq;

            // Accumulate for crest factor + phase correlation
            self.rms_accum += out_sq;
            self.lr_product_accum += left[i] * right[i];
            self.l_sq_accum += left[i] * left[i];
            self.r_sq_accum += right[i] * right[i];
        }

        // Update meters
        if len > 0 {
            let n = len as f32;
            self.meter_gr_db = gr_sum / n;
            // Push to GR history ring buffer
            self.gr_history[self.gr_history_pos as usize] = self.meter_gr_db;
            self.gr_history_pos = self.gr_history_pos.wrapping_add(1);

            // Crest factor: peak / RMS in dB
            let rms = (self.rms_accum / n).sqrt();
            if rms > 1e-10 {
                self.meter_crest = 20.0 * (output_peak / rms).log10();
            }

            // Phase correlation: Pearson correlation coefficient
            let denom = (self.l_sq_accum * self.r_sq_accum).sqrt();
            if denom > 1e-10 {
                self.meter_phase_corr = (self.lr_product_accum / denom).clamp(-1.0, 1.0);
            }

            // Reset accumulators
            self.rms_accum = 0.0;
            self.lr_product_accum = 0.0;
            self.l_sq_accum = 0.0;
            self.r_sq_accum = 0.0;
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

    #[inline]
    fn process_topology(
        &mut self,
        topo: Topology,
        l: f32,
        r: f32,
        program_detector: (f32, f32),
        external_detector: Option<(f32, f32)>,
    ) -> (f32, f32, f32) {
        let detector_source = external_detector.unwrap_or_else(|| match topo {
            Topology::Vca => self.vca.detector_source(l, r),
            Topology::Opto => self.opto.detector_source(),
            Topology::Fet => self.fet.detector_source(),
            Topology::Diode => self
                .diode
                .detector_source(program_detector.0, program_detector.1),
        });
        let (detector_l, detector_r) =
            self.sidechains[topo.index()].process(detector_source.0, detector_source.1);

        match topo {
            Topology::Vca => self
                .vca
                .process_sample_with_detector(l, r, detector_l, detector_r),
            Topology::Opto => self
                .opto
                .process_sample_with_detector(l, r, detector_l, detector_r),
            Topology::Fet => self
                .fet
                .process_sample_with_detector(l, r, detector_l, detector_r),
            Topology::Diode => self
                .diode
                .process_sample_with_detector(l, r, detector_l, detector_r),
        }
    }

    fn compute_auto_makeup(&self) -> f32 {
        match self.active_topology {
            Topology::Vca => auto_makeup(self.vca.get_threshold(), self.vca.get_ratio()),
            Topology::Opto => self.opto.auto_makeup_gain(),
            Topology::Fet => auto_makeup(self.fet.get_threshold(), self.fet.get_ratio()),
            Topology::Diode => auto_makeup(self.diode.get_threshold(), self.diode.get_ratio()),
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

    pub fn current_crest(&self) -> f32 {
        self.meter_crest
    }

    pub fn current_phase_corr(&self) -> f32 {
        self.meter_phase_corr
    }

    pub fn latency_samples(&self) -> u32 {
        (self.lookahead_ms * 0.001 * self.sample_rate) as u32
    }
}
