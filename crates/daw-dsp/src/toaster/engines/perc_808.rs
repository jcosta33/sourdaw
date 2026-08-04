//! TR-808 remaining percussion voices: cowbell, clave, rimshot, maracas.
//!
//! Cowbell:  Oscillators at 800 Hz and 540 Hz through BPF at ~850 Hz (Q≈4.25), 50ms decay.
//! Clave:    Single bridged-T at 2500 Hz, natural ring decay ~20ms.
//! Rimshot:  Two bridged-T oscillators at 1667 Hz and 455 Hz, ~10ms decay, with HPF for snap.
//! Maracas:  White noise through VCA with 25–35ms decay. Broadband, no resonant filter.

use crate::primitives::flush_denormal_in_place;
use crate::toaster::bridged_t::BridgedTFilter;
use crate::toaster::dc_block::DcBlocker;
use crate::toaster::poly_blep::PolyBlepSquare;
use crate::toaster::tolerance::{cap, prng_state, res};

// Cowbell oscillator frequencies (from hi-hat bank, oscillators 1 and 2)
const COWBELL_FREQ1: f32 = 800.0;
const COWBELL_FREQ2: f32 = 540.0;
const COWBELL_BPF_FREQ: f32 = 850.0;
const COWBELL_BPF_Q: f32 = 4.25;
const COWBELL_DECAY_S: f32 = 0.05;

// Clave bridged-T at 2500 Hz
// fc = 1/(2π×√(R_eff × R_shunt × C1 × C2))
// For fc=2500 Hz, R_shunt=1MΩ, C1=C2=1nF:
//   R_eff = (1/(2π×2500))² / (1e6 × 1e-9 × 1e-9) = (6.366e-5)² / 1e-12 = 4052 Ω
const CLAVE_R_EFF_NOM: f32 = 4_052.0; // Ω — yields fc ≈ 2500 Hz
const CLAVE_R_SHUNT_NOM: f32 = 1_000_000.0; // Ω
const CLAVE_C1_NOM: f32 = 1e-9; // F
const CLAVE_C2_NOM: f32 = 1e-9; // F
const CLAVE_DECAY_S: f32 = 0.02; // 20ms natural ring

// Rimshot
const RIM_FREQ1: f32 = 1667.0;
const RIM_FREQ2: f32 = 455.0;
const RIM_DECAY_S: f32 = 0.01; // 10ms

// Maracas
const MARACAS_DECAY_MIN_S: f32 = 0.025;
const MARACAS_DECAY_MAX_S: f32 = 0.035;

pub enum Perc808Mode {
    Cowbell,
    Clave,
    Rimshot,
    Maracas,
}

pub struct Perc808Engine {
    mode: Perc808Mode,

    // Cowbell oscillators (PolyBLEP square waves through BPF)
    cowbell_osc1: PolyBlepSquare,
    cowbell_osc2: PolyBlepSquare,
    cowbell_bp_ic1: f32,
    cowbell_bp_ic2: f32,

    // Clave bridged-T
    clave_filter: BridgedTFilter,

    // Rimshot bridged-T pair
    rim_filter1: BridgedTFilter,
    rim_filter2: BridgedTFilter,
    rim_hpf_state: f32,
    rim_hpf_prev: f32,

    // Shared amplitude envelope
    amp_env: f32,
    amp_decay_coeff: f32,

    // Noise (for maracas)
    noise_state: u32,

    // DC blocker
    dc_block: DcBlocker,

    // Parameters
    decay: f32,
    tune: f32,

    active: bool,
    sample_rate: f32,
}

impl Perc808Engine {
    pub fn new(sample_rate: f32, mode: Perc808Mode) -> Self {
        Self::with_tolerance(sample_rate, mode, 0)
    }

    pub fn with_tolerance(sample_rate: f32, mode: Perc808Mode, tolerance_seed: u32) -> Self {
        let mut state = prng_state(tolerance_seed);
        let clave_r_eff = res(CLAVE_R_EFF_NOM, &mut state);
        let clave_r_shunt = res(CLAVE_R_SHUNT_NOM, &mut state);
        let clave_c1 = cap(CLAVE_C1_NOM, &mut state);
        let clave_c2 = cap(CLAVE_C2_NOM, &mut state);

        let mut clave_filter = BridgedTFilter::new();
        clave_filter.update_coefficients(
            clave_r_eff,
            clave_r_shunt,
            clave_c1,
            clave_c2,
            sample_rate,
        );

        // Rimshot bridged-T component values derived from target frequencies
        // fc = 1/(2π√(R_eff × R_shunt × C1 × C2))
        // For 1667 Hz with R_shunt=1MΩ, C1=C2=1nF:
        //   R_eff = (1/(2π×1667))² / (1e6 × 1e-9 × 1e-9) ≈ 9_100 Ω
        let mut rim_filter1 = BridgedTFilter::new();
        rim_filter1.update_coefficients(9_100.0, 1_000_000.0, 1e-9, 1e-9, sample_rate);

        // For 455 Hz with R_shunt=1MΩ, C1=C2=1nF:
        //   R_eff = (1/(2π×455))² / (1e6 × 1e-9 × 1e-9) ≈ 122_500 Ω
        let mut rim_filter2 = BridgedTFilter::new();
        rim_filter2.update_coefficients(122_500.0, 1_000_000.0, 1e-9, 1e-9, sample_rate);

        Self {
            mode,
            cowbell_osc1: PolyBlepSquare::new(COWBELL_FREQ1),
            cowbell_osc2: PolyBlepSquare::new(COWBELL_FREQ2),
            cowbell_bp_ic1: 0.0,
            cowbell_bp_ic2: 0.0,
            clave_filter,
            rim_filter1,
            rim_filter2,
            rim_hpf_state: 0.0,
            rim_hpf_prev: 0.0,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            noise_state: 0x87654321,
            dc_block: DcBlocker::new(sample_rate),
            decay: 0.5,
            tune: 0.0,
            active: false,
            sample_rate,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.active = true;
        self.amp_env = velocity;

        let decay_s = match self.mode {
            Perc808Mode::Cowbell => COWBELL_DECAY_S,
            Perc808Mode::Clave => CLAVE_DECAY_S,
            Perc808Mode::Rimshot => RIM_DECAY_S,
            Perc808Mode::Maracas => {
                MARACAS_DECAY_MIN_S + self.decay * (MARACAS_DECAY_MAX_S - MARACAS_DECAY_MIN_S)
            }
        };
        self.amp_decay_coeff = (-1.0 / (decay_s * sample_rate)).exp();

        // Reset state
        match self.mode {
            Perc808Mode::Cowbell => {
                self.cowbell_osc1.reset();
                self.cowbell_osc2.reset();
                self.cowbell_bp_ic1 = 0.0;
                self.cowbell_bp_ic2 = 0.0;
            }
            Perc808Mode::Clave => {
                self.clave_filter.reset();
            }
            Perc808Mode::Rimshot => {
                self.rim_filter1.reset();
                self.rim_filter2.reset();
                self.rim_hpf_state = 0.0;
                self.rim_hpf_prev = 0.0;
            }
            Perc808Mode::Maracas => {}
        }
        self.dc_block.reset();
    }

    pub fn release(&mut self) {}

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active || self.amp_env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        let signal = match self.mode {
            Perc808Mode::Cowbell => self.tick_cowbell(sample_rate),
            Perc808Mode::Clave => self.tick_clave(),
            Perc808Mode::Rimshot => self.tick_rimshot(sample_rate),
            Perc808Mode::Maracas => self.tick_maracas(),
        };

        self.amp_env *= self.amp_decay_coeff;

        let output = self.dc_block.process(signal * self.amp_env);

        if self.amp_env < 1e-6 {
            self.active = false;
        }

        output
    }

    #[inline]
    fn tick_cowbell(&mut self, sample_rate: f32) -> f32 {
        let tune_ratio = (self.tune / 12.0).exp2();
        self.cowbell_osc1.set_freq(COWBELL_FREQ1 * tune_ratio);
        self.cowbell_osc2.set_freq(COWBELL_FREQ2 * tune_ratio);

        let osc_sum =
            (self.cowbell_osc1.tick(sample_rate) + self.cowbell_osc2.tick(sample_rate)) * 0.5;

        // BPF at ~850 Hz, Q=4.25
        svf_bandpass_cowbell(
            osc_sum,
            COWBELL_BPF_FREQ * tune_ratio,
            COWBELL_BPF_Q,
            sample_rate,
            &mut self.cowbell_bp_ic1,
            &mut self.cowbell_bp_ic2,
        )
    }

    #[inline]
    fn tick_clave(&mut self) -> f32 {
        // Self-decaying bridged-T resonator — excitation is the envelope itself
        self.clave_filter.process(self.amp_env)
    }

    #[inline]
    fn tick_rimshot(&mut self, sample_rate: f32) -> f32 {
        let excitation = self.amp_env;
        let out1 = self.rim_filter1.process(excitation);
        let out2 = self.rim_filter2.process(excitation);
        let mixed = (out1 + out2) * 0.5;

        // Simple HPF for snap character (one-pole)
        let hpf_coeff = (-2.0 * core::f32::consts::PI * 800.0 / sample_rate).exp();
        let new_hpf = hpf_coeff * self.rim_hpf_state + (1.0 - hpf_coeff) * mixed;
        let hpf_out = mixed - new_hpf;
        self.rim_hpf_state = new_hpf;

        hpf_out
    }

    #[inline]
    fn tick_maracas(&mut self) -> f32 {
        xorshift_noise(&mut self.noise_state)
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "decay" => self.decay = value.clamp(0.0, 1.0),
            "tune" => self.tune = value.clamp(-24.0, 24.0),
            _ => {}
        }
    }
}

#[inline]
fn svf_bandpass_cowbell(
    input: f32,
    freq: f32,
    q: f32,
    sample_rate: f32,
    ic1: &mut f32,
    ic2: &mut f32,
) -> f32 {
    use core::f32::consts::TAU;
    let g = (TAU * freq / sample_rate * 0.5).tan();
    let k = 1.0 / q;
    let a1 = 1.0 / (1.0 + g * (g + k));
    let a2 = g * a1;
    let a3 = g * a2;

    let v3 = input - *ic2;
    let v1 = a1 * (*ic1) + a2 * v3;
    let v2 = *ic2 + a2 * (*ic1) + a3 * v3;
    *ic1 = 2.0 * v1 - *ic1;
    *ic2 = 2.0 * v2 - *ic2;

    flush_denormal_in_place(ic1);
    flush_denormal_in_place(ic2);

    v1
}

#[inline]
fn xorshift_noise(state: &mut u32) -> f32 {
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;
    (x as i32 as f32) / (i32::MAX as f32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn perc_808_all_modes_render_cleanly() {
        let sample_rate = 48_000.0_f32;

        for mode in [
            ("cowbell", Perc808Mode::Cowbell),
            ("clave", Perc808Mode::Clave),
            ("rimshot", Perc808Mode::Rimshot),
            ("maracas", Perc808Mode::Maracas),
        ] {
            let mut engine = Perc808Engine::new(sample_rate, mode.1);
            engine.trigger(1.0, sample_rate);

            for i in 0..24_000 {
                let s = engine.tick(sample_rate);
                assert!(!s.is_nan(), "Mode {}: NaN at sample {i}", mode.0);
                assert!(!s.is_infinite(), "Mode {}: Inf at sample {i}", mode.0);
            }
        }
    }

    /// Cowbell uses 800 Hz and 540 Hz oscillators (not generic minor-3rd ratio).
    #[test]
    fn cowbell_uses_808_frequencies() {
        assert_eq!(COWBELL_FREQ1, 800.0, "Cowbell osc 1 should be 800 Hz");
        assert_eq!(COWBELL_FREQ2, 540.0, "Cowbell osc 2 should be 540 Hz");

        // Verify BPF is at ~850 Hz
        assert_eq!(COWBELL_BPF_FREQ, 850.0, "Cowbell BPF should be 850 Hz");
    }
}
