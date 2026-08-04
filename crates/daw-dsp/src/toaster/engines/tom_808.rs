//! TR-808 toms — bridged-T oscillator with diode-based pitch sweep in feedback path.
//!
//! The diode's forward resistance increases at lower signal levels, reducing effective
//! resonance and creating a subtle downward pitch sweep as amplitude decays.
//!
//! Frequency ranges:
//!   Low tom:  80–100 Hz (decay ~200ms)
//!   Mid tom:  120–160 Hz (decay ~130ms)
//!   High tom: 165–220 Hz (decay ~100ms)

use crate::toaster::bridged_t::BridgedTFilter;

#[inline]
fn fast_tanh_tom(x: f32) -> f32 {
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}
use crate::toaster::dc_block::DcBlocker;
use crate::toaster::tolerance::{cap, prng_state, res};

pub enum TomVariant {
    Low,
    Mid,
    High,
}

struct TomParams {
    r_eff_nom: f32,
    r_shunt_nom: f32,
    c1_nom: f32,
    c2_nom: f32,
    decay_s: f32,
    freq_base: f32,
}

impl TomParams {
    fn for_variant(variant: &TomVariant) -> Self {
        match variant {
            TomVariant::Low => TomParams {
                r_eff_nom: 33_000.0, // Ω — tuned for ~90 Hz
                r_shunt_nom: 820_000.0,
                c1_nom: 10e-9, // F
                c2_nom: 10e-9,
                decay_s: 0.2,
                freq_base: 90.0,
            },
            TomVariant::Mid => TomParams {
                r_eff_nom: 22_000.0, // Ω — tuned for ~140 Hz
                r_shunt_nom: 820_000.0,
                c1_nom: 6.8e-9,
                c2_nom: 6.8e-9,
                decay_s: 0.13,
                freq_base: 140.0,
            },
            TomVariant::High => TomParams {
                r_eff_nom: 15_000.0, // Ω — tuned for ~190 Hz
                r_shunt_nom: 820_000.0,
                c1_nom: 4.7e-9,
                c2_nom: 4.7e-9,
                decay_s: 0.1,
                freq_base: 190.0,
            },
        }
    }
}

pub struct Tom808Engine {
    bridged_t: BridgedTFilter,

    // Component values
    r_eff: f32,
    r_shunt: f32,
    c1: f32,
    c2: f32,
    decay_s: f32,

    // Envelope
    amp_env: f32,
    amp_decay_coeff: f32,

    // Diode feedback: forward resistance models signal-level-dependent pitch sweep
    diode_r: f32, // effective resistance added to r_eff from diode

    // Feedback buffer
    fb_state: f32,

    // DC blocker
    dc_block: DcBlocker,

    // Parameters
    tune: f32,  // semitones
    decay: f32, // 0..1 normalized scale on base decay

    active: bool,
    sample_rate: f32,
}

impl Tom808Engine {
    pub fn new(sample_rate: f32, variant: TomVariant) -> Self {
        Self::with_tolerance(sample_rate, variant, 0)
    }

    pub fn with_tolerance(sample_rate: f32, variant: TomVariant, tolerance_seed: u32) -> Self {
        let params = TomParams::for_variant(&variant);
        let mut state = prng_state(tolerance_seed);
        let r_eff = res(params.r_eff_nom, &mut state);
        let r_shunt = res(params.r_shunt_nom, &mut state);
        let c1 = cap(params.c1_nom, &mut state);
        let c2 = cap(params.c2_nom, &mut state);

        let mut bridged_t = BridgedTFilter::new();
        bridged_t.update_coefficients(r_eff, r_shunt, c1, c2, sample_rate);

        Self {
            bridged_t,
            r_eff,
            r_shunt,
            c1,
            c2,
            decay_s: params.decay_s,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            diode_r: 0.0,
            fb_state: 0.0,
            dc_block: DcBlocker::new(sample_rate),
            tune: 0.0,
            decay: 0.5,
            active: false,
            sample_rate,
        }
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.active = true;
        self.amp_env = velocity;

        let decay_s = self.decay_s * (0.5 + self.decay);
        self.amp_decay_coeff = (-1.0 / (decay_s * sample_rate)).exp();

        self.bridged_t.reset();
        self.fb_state = 0.0;
        self.diode_r = 0.0;
        self.dc_block.reset();

        self.bridged_t
            .update_coefficients(self.r_eff, self.r_shunt, self.c1, self.c2, sample_rate);
    }

    pub fn release(&mut self) {}

    pub fn tick(&mut self, sample_rate: f32) -> f32 {
        if !self.active || self.amp_env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        // Diode feedback: at lower signal levels the diode forward resistance increases,
        // raising r_eff and lowering fc — creates subtle downward pitch sweep.
        // Model: diode_r increases as amp_env decreases (inverse relationship)
        let diode_model = (1.0 - self.amp_env).max(0.0) * 5_000.0; // up to 5kΩ extra
        self.diode_r = self.diode_r * 0.999 + diode_model * 0.001; // smooth
        let r_eff_current = self.r_eff + self.diode_r;

        self.bridged_t.update_coefficients(
            r_eff_current,
            self.r_shunt,
            self.c1,
            self.c2,
            sample_rate,
        );

        let excitation = self.amp_env + self.fb_state * 0.15;
        let out = self.bridged_t.process(excitation);
        // Soft-clip feedback to prevent instability
        self.fb_state = fast_tanh_tom(out);

        self.amp_env *= self.amp_decay_coeff;

        let signal = out * self.amp_env;
        let output = self.dc_block.process(signal);

        if self.amp_env < 1e-6 {
            self.active = false;
        }

        output
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "tune" => self.tune = value.clamp(-24.0, 24.0),
            "decay" => self.decay = value.clamp(0.0, 1.0),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tom_808_variants_render_cleanly() {
        let sample_rate = 48_000.0_f32;
        for (name, variant) in [
            ("low", TomVariant::Low),
            ("mid", TomVariant::Mid),
            ("high", TomVariant::High),
        ] {
            let mut engine = Tom808Engine::new(sample_rate, variant);
            engine.trigger(1.0, sample_rate);

            for i in 0..48_000 {
                let s = engine.tick(sample_rate);
                assert!(!s.is_nan(), "Tom {name}: NaN at sample {i}");
                assert!(!s.is_infinite(), "Tom {name}: Inf at sample {i}");
            }
        }
    }
}
