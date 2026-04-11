//! Breath / reed air noise.
//!
//! Spec §3 — wind and brass players have a continuous air-noise floor that
//! samples often miss. We model it as bandpassed white noise around the
//! tube's primary turbulence frequency, scaled by CC11 (expression / breath).

use super::super::humanize::Rng;
use super::biquad::Biquad;

#[derive(Debug, Clone, Copy)]
pub enum BreathPreset {
    None,
    Flute,
    DoubleReed, // oboe / bassoon — brighter
    SingleReed, // clarinet / sax
    Brass,
}

pub struct BreathNoise {
    rng: Rng,
    bandpass: Biquad,
    sample_rate: f32,
    /// Current expression level (0..1) — typically CC11. Updated per block
    /// by the orchestrator; not user-tunable from outside the realism layer.
    pub(super) level: f32,
    /// Master amount in [0,1].
    /// Set by the orchestrator from the per-instrument preset; not user-tunable.
    pub(super) amount: f32,
    preset: BreathPreset,
}

impl BreathNoise {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            rng: Rng::new(0xB12EA113),
            bandpass: Biquad::bandpass(2200.0, 1.0, sample_rate),
            sample_rate,
            level: 1.0,
            amount: 0.0,
            preset: BreathPreset::None,
        }
    }

    pub fn set_preset(&mut self, preset: BreathPreset) {
        self.preset = preset;
        let (f0, q) = match preset {
            BreathPreset::None => (2200.0, 1.0),
            BreathPreset::Flute => (3500.0, 0.8), // breathy, broad
            BreathPreset::DoubleReed => (3000.0, 1.4), // brighter, more nasal
            BreathPreset::SingleReed => (1800.0, 1.2),
            BreathPreset::Brass => (1200.0, 1.0),
        };
        self.bandpass = Biquad::bandpass(f0, q, self.sample_rate);
    }

    pub fn reset(&mut self) {
        self.bandpass.reset();
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        if self.amount < 1e-4 || matches!(self.preset, BreathPreset::None) {
            return 0.0;
        }
        let white = self.rng.next_bipolar();
        let band = self.bandpass.tick(white);
        // Per-preset character scaling (flute and brass are louder relative
        // to the tone than reeds).
        let preset_gain = match self.preset {
            BreathPreset::Flute => 0.10,
            BreathPreset::Brass => 0.06,
            BreathPreset::DoubleReed => 0.04,
            BreathPreset::SingleReed => 0.04,
            BreathPreset::None => 0.0,
        };
        band * preset_gain * self.level * self.amount
    }
}
