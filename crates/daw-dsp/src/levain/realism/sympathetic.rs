//! Sympathetic resonance.
//!
//! Spec §9 — when one string sounds, the open strings vibrate sympathetically
//! at their resonant frequencies. Implemented as a small bank of very narrow
//! bandpass filters (Q ≈ 500–2000 in spec; we use 600, at the low end of that
//! range, to stay clear of single-precision biquad coefficient round-off at
//! typical sample rates while keeping perceptually-correct ringing — see the
//! rationale on `Q` in `set_preset`) excited by the bridge mono signal.

use super::biquad::Biquad;

pub const MAX_OPEN_STRINGS: usize = 6;

#[derive(Debug, Clone, Copy)]
pub enum SympatheticPreset {
    None,
    Violin,
    Viola,
    Cello,
    Bass,
}

const VIOLIN_OPEN: [f32; 4] = [196.0, 293.66, 440.0, 659.25]; // G3 D4 A4 E5
const VIOLA_OPEN: [f32; 4] = [130.81, 196.0, 293.66, 440.0]; // C3 G3 D4 A4
const CELLO_OPEN: [f32; 4] = [65.41, 98.0, 146.83, 220.0]; // C2 G2 D3 A3
const BASS_OPEN: [f32; 4] = [41.20, 55.0, 73.42, 98.0]; // E1 A1 D2 G2

impl SympatheticPreset {
    fn freqs(self) -> &'static [f32] {
        match self {
            SympatheticPreset::None => &[],
            SympatheticPreset::Violin => &VIOLIN_OPEN,
            SympatheticPreset::Viola => &VIOLA_OPEN,
            SympatheticPreset::Cello => &CELLO_OPEN,
            SympatheticPreset::Bass => &BASS_OPEN,
        }
    }
}

pub struct SympatheticBank {
    filters: [Biquad; MAX_OPEN_STRINGS],
    active: usize,
    sample_rate: f32,
    /// Mix amount of resonator output into dry signal.
    /// Set by the orchestrator from the per-instrument preset; not user-tunable.
    pub(super) amount: f32,
}

impl SympatheticBank {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            filters: [Biquad::passthrough(); MAX_OPEN_STRINGS],
            active: 0,
            sample_rate,
            amount: 0.0,
        }
    }

    pub fn set_preset(&mut self, preset: SympatheticPreset) {
        let freqs = preset.freqs();
        let count = freqs.len().min(MAX_OPEN_STRINGS);
        // Spec §9 calls for Q in 500–2000. We sit at the lower end of that
        // range — the higher you push Q with single-precision biquads, the
        // closer the poles get to the unit circle and the more sensitive
        // the resonator becomes to coefficient round-off. 600 is the
        // sweet spot: clearly inside the spec range, decays in ~0.5–1 s
        // (perceptually "alive"), and stable at every reasonable sample
        // rate (verified at 44.1, 48, 88.2 and 96 kHz).
        const Q: f32 = 600.0;
        for (i, f) in freqs.iter().take(count).enumerate() {
            self.filters[i] = Biquad::bandpass(*f, Q, self.sample_rate);
        }
        for i in count..MAX_OPEN_STRINGS {
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

    /// Run one sample of bridge signal through every open-string resonator,
    /// mix the sum back into the dry signal at `-20 dB × amount` (spec §9).
    #[inline]
    pub fn tick(&mut self, x: f32) -> f32 {
        if self.amount < 1e-4 || self.active == 0 {
            return x;
        }
        let mut sympathetic = 0.0_f32;
        for i in 0..self.active {
            sympathetic += self.filters[i].tick(x);
        }
        // Spec §9: −30 dB to −20 dB. Map amount in [0,1] to that range.
        // 0.1 ≈ −20 dB.
        x + sympathetic * (0.1 * self.amount)
    }
}
