//! Body resonance bank.
//!
//! Implements spec §2 — a parallel bank of peaking biquads tuned to the
//! perceptually critical body modes of a real instrument. The signal is
//! mixed with the original (parallel topology) so the resonances colour
//! the timbre without removing energy elsewhere.
//!
//! The mode tables are taken from the Princeton NBody database / spec §2.1
//! and §2.3 (frequency scaling for the rest of the string family). For brass
//! we apply the "bridge hill" idea via a single broad peak around 2.5 kHz.

use super::biquad::Biquad;

/// Maximum modes per body bank — fits violin/viola/cello/bass + brass bell.
pub const MAX_BODY_MODES: usize = 8;

/// One body mode (peak in the parallel bank).
#[derive(Debug, Clone, Copy)]
pub struct BodyMode {
    pub freq_hz: f32,
    pub q: f32,
    pub gain_db: f32,
}

const fn mode(freq_hz: f32, q: f32, gain_db: f32) -> BodyMode {
    BodyMode {
        freq_hz,
        q,
        gain_db,
    }
}

/// Spec §2.1 + §2.2 — violin LPC mode frequencies (Princeton NBody / Smith, Cook).
/// Q and gains are perceptually-tuned starting values.
const VIOLIN_MODES: [BodyMode; 7] = [
    mode(280.0, 12.0, 4.5), // A0 (Helmholtz air mode)
    mode(460.0, 10.0, 3.5), // A1
    mode(524.0, 9.0, 4.0),  // C2/3 cluster
    mode(1156.0, 6.0, 3.0), //
    mode(1870.0, 5.0, 2.5), //
    mode(2302.0, 4.5, 2.0), // bridge hill region
    mode(2836.0, 4.0, 1.5), //
];

/// Viola modes — frequency-scaled from violin (~violin × 0.78).
const VIOLA_MODES: [BodyMode; 7] = [
    mode(220.0, 12.0, 4.5),
    mode(360.0, 10.0, 3.5),
    mode(410.0, 9.0, 4.0),
    mode(905.0, 6.0, 3.0),
    mode(1465.0, 5.0, 2.5),
    mode(1800.0, 4.5, 2.0),
    mode(2220.0, 4.0, 1.5),
];

/// Cello modes — frequency-scaled from violin (~violin × 0.46) per spec §2.3.
const CELLO_MODES: [BodyMode; 7] = [
    mode(130.0, 13.0, 5.0),
    mode(212.0, 10.0, 4.0),
    mode(241.0, 9.0, 4.5),
    mode(532.0, 6.0, 3.5),
    mode(861.0, 5.0, 3.0),
    mode(1059.0, 4.5, 2.5),
    mode(1305.0, 4.0, 2.0),
];

/// Double bass modes — scaled further (~violin × 0.30).
const BASS_MODES: [BodyMode; 7] = [
    mode(85.0, 14.0, 5.5),
    mode(140.0, 11.0, 4.5),
    mode(160.0, 9.0, 5.0),
    mode(347.0, 6.0, 4.0),
    mode(561.0, 5.0, 3.5),
    mode(691.0, 4.5, 3.0),
    mode(851.0, 4.0, 2.5),
];

/// Brass bell radiation — single broad "bridge hill" style peak.
const BRASS_MODES: [BodyMode; 2] = [mode(700.0, 1.5, 2.0), mode(2500.0, 2.5, 4.0)];

/// Woodwind body — gentler colouration around the bore tube formant.
const WIND_MODES: [BodyMode; 2] = [mode(900.0, 2.0, 2.0), mode(2800.0, 2.5, 2.5)];

#[derive(Debug, Clone, Copy)]
pub enum BodyPreset {
    None,
    Violin,
    Viola,
    Cello,
    Bass,
    Brass,
    Woodwind,
}

impl BodyPreset {
    fn modes(self) -> &'static [BodyMode] {
        match self {
            BodyPreset::None => &[],
            BodyPreset::Violin => &VIOLIN_MODES,
            BodyPreset::Viola => &VIOLA_MODES,
            BodyPreset::Cello => &CELLO_MODES,
            BodyPreset::Bass => &BASS_MODES,
            BodyPreset::Brass => &BRASS_MODES,
            BodyPreset::Woodwind => &WIND_MODES,
        }
    }
}

/// Parallel bank of peaking biquads acting as a parametric body filter.
pub struct BodyResonator {
    filters: [Biquad; MAX_BODY_MODES],
    active: usize,
    sample_rate: f32,
    /// Wet/dry mix in [0, 1]. 0 = dry only, 1 = full body colouration.
    /// Set by the orchestrator from the per-instrument preset; not user-tunable.
    pub(super) amount: f32,
}

impl BodyResonator {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            filters: [Biquad::passthrough(); MAX_BODY_MODES],
            active: 0,
            sample_rate,
            amount: 0.0,
        }
    }

    pub fn set_preset(&mut self, preset: BodyPreset) {
        let modes = preset.modes();
        let count = modes.len().min(MAX_BODY_MODES);
        for (i, m) in modes.iter().take(count).enumerate() {
            self.filters[i] = Biquad::peaking(m.freq_hz, m.q, m.gain_db, self.sample_rate);
        }
        for i in count..MAX_BODY_MODES {
            self.filters[i] = Biquad::passthrough();
            self.filters[i].reset();
        }
        self.active = count;
    }

    pub fn reset(&mut self) {
        for f in self.filters.iter_mut() {
            f.reset();
        }
    }

    /// Process one mono sample. Each peaking biquad has unity DC gain plus
    /// a resonant peak, so `filter.tick(x) - x` is purely that mode's
    /// resonant contribution. Summing those contributions across all
    /// active modes and mixing back into dry by `amount` means the
    /// per-mode `gain_db` table values literally describe the dB the user
    /// hears at each mode's peak — no averaging fudge.
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        if self.amount < 1e-4 || self.active == 0 {
            return x;
        }
        let mut resonance = 0.0_f32;
        for i in 0..self.active {
            resonance += self.filters[i].tick(x) - x;
        }
        x + resonance * self.amount
    }
}
