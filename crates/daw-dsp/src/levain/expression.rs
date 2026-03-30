//! Expression engine — CC1/CC11/velocity model.
//!
//! Standard levain expression:
//! - Velocity → attack character (initial transient)
//! - CC1 (Mod Wheel) → sustained dynamic level (crossfades between layers)
//! - CC11 (Expression) → overall volume multiplier
//!
//! Dynamic crossfading uses equal-power curves to prevent volume dips.
//! Vibrato LFO with configurable onset delay.

use super::types::*;
use super::voice::OnePoleSmoother;

// ---------------------------------------------------------------------------
// Dynamic layer crossfader
// ---------------------------------------------------------------------------

/// Manages real-time crossfading between dynamic layers based on CC1.
pub struct DynamicCrossfader {
    /// Current smoothed CC1 value (0.0 - 1.0).
    cc1: OnePoleSmoother,
    /// Number of dynamic layers.
    pub num_layers: usize,
    /// CC1 boundaries per layer: (lo, hi) normalized to 0.0-1.0.
    layer_ranges: [(f32, f32); MAX_VEL_LAYERS],
    /// CC curve shape.
    pub curve: CcCurve,
}

impl DynamicCrossfader {
    pub fn new(sample_rate: f32, crossfade_time: f32) -> Self {
        Self {
            cc1: OnePoleSmoother::new(0.5, crossfade_time, sample_rate),
            num_layers: 0,
            layer_ranges: [(0.0, 1.0); MAX_VEL_LAYERS],
            curve: CcCurve::SCurve,
        }
    }

    /// Configure layer count and even distribution.
    pub fn configure(&mut self, num_layers: usize, curve: CcCurve) {
        self.num_layers = num_layers.min(MAX_VEL_LAYERS);
        self.curve = curve;

        if self.num_layers == 0 {
            return;
        }

        // Even distribution with 15% overlap between adjacent layers.
        let overlap_fraction = 0.15;
        let layer_width = 1.0 / self.num_layers as f32;

        for i in 0..self.num_layers {
            let center = (i as f32 + 0.5) * layer_width;
            let half_width = layer_width * 0.5 * (1.0 + overlap_fraction);
            self.layer_ranges[i] = (
                (center - half_width).max(0.0),
                (center + half_width).min(1.0),
            );
        }
    }

    /// Set CC1 target value (0-127 mapped to 0.0-1.0).
    pub fn set_cc1(&mut self, value: u8) {
        let normalized = self.apply_curve(value as f32 / 127.0);
        self.cc1.set_target(normalized);
    }

    /// Get the gain for each dynamic layer (call once per block).
    /// Returns gains for layers 0..num_layers using equal-power crossfade.
    pub fn get_layer_gains(&mut self, gains: &mut [f32]) {
        let cc1_val = self.cc1.tick();

        for i in 0..self.num_layers.min(gains.len()) {
            let (lo, hi) = self.layer_ranges[i];
            let range = hi - lo;

            if range <= 0.0 {
                gains[i] = 0.0;
                continue;
            }

            if cc1_val < lo || cc1_val > hi {
                gains[i] = 0.0;
            } else {
                // Position within this layer's range (0.0-1.0).
                let pos = (cc1_val - lo) / range;
                // Triangle envelope: peak at center.
                let env = if pos < 0.5 {
                    pos * 2.0
                } else {
                    (1.0 - pos) * 2.0
                };
                // Equal-power: sqrt gives constant power across overlap.
                gains[i] = env.sqrt().min(1.0);
            }
        }
    }

    pub fn current_cc1(&self) -> f32 {
        self.cc1.current
    }

    fn apply_curve(&self, x: f32) -> f32 {
        match self.curve {
            CcCurve::Linear => x,
            CcCurve::SCurve => {
                // Smooth S-curve: 3x^2 - 2x^3.
                let x = x.clamp(0.0, 1.0);
                x * x * (3.0 - 2.0 * x)
            }
            CcCurve::Logarithmic => {
                // Log-like curve: maps [0,1] → [0,1]. Clamp to 0.01 to avoid negatives.
                let x = x.clamp(0.01, 1.0);
                ((x.ln() + 4.6) / 4.6).max(0.0)
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Expression state (per-instrument)
// ---------------------------------------------------------------------------

pub struct ExpressionState {
    /// CC1 mod wheel (0-127).
    pub cc1: u8,
    /// CC11 expression (0-127).
    pub cc11: u8,
    /// CC7 volume (0-127).
    pub cc7: u8,
    /// CC2 vibrato depth (0-127).
    pub cc2: u8,
    /// CC64 sustain pedal.
    pub sustain_pedal: bool,
    /// Smoothed CC11 as gain multiplier.
    pub cc11_gain: OnePoleSmoother,
    /// Dynamic crossfader.
    pub crossfader: DynamicCrossfader,
    /// Vibrato LFO.
    pub vibrato: VibratoLfo,
}

impl ExpressionState {
    pub fn new(sample_rate: f32, config: &ExpressionConfig) -> Self {
        let mut crossfader = DynamicCrossfader::new(sample_rate, config.dynamic_crossfade_time);
        crossfader.configure(3, config.cc1_curve); // default 3 layers

        Self {
            cc1: 64,
            cc11: 127,
            cc7: 100,
            cc2: 0,
            sustain_pedal: false,
            cc11_gain: OnePoleSmoother::new(1.0, 0.02, sample_rate),
            crossfader,
            vibrato: VibratoLfo::new(sample_rate, config),
        }
    }

    /// Handle a MIDI CC message.
    pub fn handle_cc(&mut self, cc: u8, value: u8) {
        match cc {
            1 => {
                self.cc1 = value;
                self.crossfader.set_cc1(value);
            }
            2 => self.cc2 = value,
            7 => self.cc7 = value,
            11 => {
                self.cc11 = value;
                self.cc11_gain.set_target(value as f32 / 127.0);
            }
            64 => self.sustain_pedal = value >= 64,
            _ => {}
        }
    }

    /// Get the current expression gain (CC11 * CC7).
    #[inline]
    pub fn expression_gain(&mut self) -> f32 {
        let cc11 = self.cc11_gain.tick();
        let cc7 = self.cc7 as f32 / 127.0;
        cc11 * cc7
    }
}

// ---------------------------------------------------------------------------
// Vibrato LFO
// ---------------------------------------------------------------------------

/// Vibrato LFO with onset delay and per-note variation.
pub struct VibratoLfo {
    phase: f32,
    rate: f32,        // Hz
    depth: f32,       // cents
    pub onset_delay: f32, // seconds
    sample_rate: f32,
    pub config: ExpressionConfig,
}

impl VibratoLfo {
    pub fn new(sample_rate: f32, config: &ExpressionConfig) -> Self {
        Self {
            phase: 0.0,
            rate: config.vibrato_rate_min,
            depth: 0.0,
            onset_delay: config.vibrato_onset_delay,
            sample_rate,
            config: *config,
        }
    }

    /// Set vibrato depth from CC2 (0-127).
    pub fn set_depth_cc(&mut self, cc2: u8) {
        let normalized = cc2 as f32 / 127.0;
        self.depth = self.config.vibrato_depth_min
            + normalized * (self.config.vibrato_depth_max - self.config.vibrato_depth_min);
        self.rate = self.config.vibrato_rate_min
            + normalized * (self.config.vibrato_rate_max - self.config.vibrato_rate_min);
    }

    /// Get vibrato pitch offset in semitones for a voice.
    /// `time_since_on` is in seconds.
    #[inline]
    pub fn get_pitch_offset(&mut self, time_since_on: f32) -> f32 {
        if self.depth < 0.1 {
            return 0.0;
        }

        // Onset delay: ramp up over the delay period.
        let onset_gain = if self.onset_delay > 0.0 {
            (time_since_on / self.onset_delay).min(1.0)
        } else {
            1.0
        };

        // Advance phase.
        self.phase += self.rate / self.sample_rate;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        // Sine LFO.
        let lfo = (self.phase * std::f32::consts::TAU).sin();

        // Convert depth from cents to semitones.
        let depth_semitones = self.depth / 100.0;

        lfo * depth_semitones * onset_gain
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
    }
}
