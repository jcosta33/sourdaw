//! TR-909 hi-hat — pre-baked 6-bit EPROM buffer playback model.
//!
//! Three 32KB HN61256P EPROMs store cymbal samples at 6-bit resolution.
//! Modeled as:
//!   - At engine init: generate metallic noise buffer from 6-oscillator bank,
//!     sum, and quantize to 6-bit resolution (64 levels).
//!   - Buffer length: ~1 second at 32 kHz = 32,000 samples.
//!   - Playback at ~32 kHz base rate (tunable via "tune" parameter).
//!   - Post-DAC lowpass filter removes clock artifacts.
//!   - Exponential decay envelope VCA.
//!
//! The tune parameter affects playback speed, not buffer content.
//! Sample rate: 32,040 Hz (measured; the actual 909 runs at ~32 kHz).

use std::sync::Arc;

use crate::toaster::dc_block::DcBlocker;
use crate::toaster::poly_blep::PolyBlepSquare;

const EPROM_SAMPLE_RATE: f32 = 32_040.0;
const EPROM_LEN: usize = 32_040; // ~1 second at 32 kHz

pub(crate) type HiHat909Buffer = Arc<[f32; EPROM_LEN]>;

// Same 6 oscillator frequencies as 808 hi-hat
const HH_FREQS: [f32; 6] = [800.0, 540.0, 522.7, 369.6, 304.4, 205.3];

pub struct HiHat909Engine {
    // Shared immutable EPROM image, generated once when the Toaster is built.
    buffer: HiHat909Buffer,

    // Playback state
    playback_pos: f64, // sub-sample position in buffer

    // Post-DAC LPF (one-pole)
    lpf_state: f32,
    lpf_coeff: f32,

    // Amplitude envelope
    amp_env: f32,
    amp_decay_coeff: f32,

    // DC blocker
    dc_block: DcBlocker,

    // Parameters
    tune: f32,  // semitones (affects playback rate)
    decay: f32, // 0..1
    is_open: bool,

    active: bool,
    sample_rate: f32,
}

impl HiHat909Engine {
    pub fn new(sample_rate: f32) -> Self {
        Self::with_buffer(sample_rate, Self::generate_buffer())
    }

    pub(crate) fn with_buffer(sample_rate: f32, buffer: HiHat909Buffer) -> Self {
        // Post-DAC LPF: cutoff ~8 kHz to remove clock artifacts
        let lpf_coeff = (-2.0 * core::f32::consts::PI * 8_000.0 / sample_rate).exp();

        Self {
            buffer,
            playback_pos: 0.0,
            lpf_state: 0.0,
            lpf_coeff,
            amp_env: 0.0,
            amp_decay_coeff: 0.0,
            dc_block: DcBlocker::new(sample_rate),
            tune: 0.0,
            decay: 0.5,
            is_open: false,
            active: false,
            sample_rate,
        }
    }

    /// Generate the pre-baked 6-bit quantized metallic noise buffer.
    /// Called once at construction time.
    pub(crate) fn generate_buffer() -> HiHat909Buffer {
        let mut buf = [0.0_f32; EPROM_LEN];
        let mut oscillators: [PolyBlepSquare; 6] =
            core::array::from_fn(|i| PolyBlepSquare::new(HH_FREQS[i]));

        for s in buf.iter_mut() {
            let mut mixed = 0.0_f32;
            for osc in oscillators.iter_mut() {
                mixed += osc.tick(EPROM_SAMPLE_RATE);
            }
            mixed /= 6.0;

            // 6-bit quantization: 64 levels (−32..+31, two's complement), step = 1/32.
            // Clamp BEFORE quantizing so every output is an exact multiple of 1/32.
            let clamped = mixed.clamp(-1.0, 1.0);
            let level = (clamped * 32.0).floor().clamp(-32.0, 31.0);
            *s = level / 32.0;
        }

        Arc::new(buf)
    }

    pub fn trigger(&mut self, velocity: f32, sample_rate: f32) {
        self.sample_rate = sample_rate;
        self.active = true;
        self.amp_env = velocity;
        self.playback_pos = 0.0;

        let decay_s = if self.is_open {
            0.1 + self.decay * 0.5 // 100..600ms
        } else {
            0.05 // fixed ~50ms for closed hat
        };
        self.amp_decay_coeff = (-1.0 / (decay_s * sample_rate)).exp();

        self.lpf_state = 0.0;
        self.dc_block.reset();
    }

    /// Choke: trigger fast fade (≤1 ms).
    pub fn release(&mut self) {
        if self.is_open {
            self.amp_decay_coeff = (-1.0 / (0.001 * self.sample_rate)).exp();
        }
    }

    pub fn tick(&mut self, _sample_rate: f32) -> f32 {
        if !self.active || self.amp_env < 1e-6 {
            self.active = false;
            return 0.0;
        }

        // Playback rate = EPROM_SAMPLE_RATE × tune_ratio / output_sample_rate
        let tune_ratio = (self.tune / 12.0_f32).exp2();
        let rate = EPROM_SAMPLE_RATE * tune_ratio / self.sample_rate;

        // Read from buffer (no interpolation — this is hardware-accurate ZOH behavior)
        let idx = self.playback_pos as usize % EPROM_LEN;
        let sample = self.buffer[idx];

        self.playback_pos += rate as f64;
        if self.playback_pos >= EPROM_LEN as f64 {
            self.playback_pos -= EPROM_LEN as f64;
        }

        // Post-DAC lowpass filter (one-pole)
        self.lpf_state = self.lpf_state * self.lpf_coeff + sample * (1.0 - self.lpf_coeff);

        // Amplitude envelope
        self.amp_env *= self.amp_decay_coeff;

        let output = self.dc_block.process(self.lpf_state * self.amp_env);

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
            "open" => self.is_open = value > 0.5,
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hihat_909_buffer_is_6bit_quantized() {
        let sample_rate = 48_000.0_f32;
        let engine = HiHat909Engine::new(sample_rate);

        // All buffer values should be multiples of 1/32 (step size of 6-bit two's complement)
        let quantum = 1.0 / 32.0_f32;
        for (i, &v) in engine.buffer.iter().enumerate() {
            let normalized = v / quantum;
            let rounded = normalized.round();
            assert!(
                (normalized - rounded).abs() < 0.01,
                "Buffer[{i}] = {v} is not 6-bit quantized (expected multiple of {quantum:.5})"
            );
        }
    }

    #[test]
    fn hihat_909_renders_cleanly() {
        let sample_rate = 48_000.0_f32;
        let mut engine = HiHat909Engine::new(sample_rate);
        engine.set_param("open", 1.0);
        engine.trigger(1.0, sample_rate);

        for i in 0..48_000 {
            let s = engine.tick(sample_rate);
            assert!(!s.is_nan(), "NaN at sample {i}");
            assert!(!s.is_infinite(), "Inf at sample {i}");
        }
    }

    /// Tune parameter should change playback rate (and thus pitch).
    /// At tune=+12 (one octave up), playback should be 2× faster.
    #[test]
    fn hihat_909_tune_changes_playback_rate() {
        let sample_rate = 48_000.0_f32;
        let mut engine_normal = HiHat909Engine::new(sample_rate);
        let mut engine_tuned = HiHat909Engine::new(sample_rate);

        engine_normal.trigger(1.0, sample_rate);
        engine_tuned.set_param("tune", 12.0);
        engine_tuned.trigger(1.0, sample_rate);

        // Collect 100 samples
        let normal: Vec<f32> = (0..100).map(|_| engine_normal.tick(sample_rate)).collect();
        let tuned: Vec<f32> = (0..100).map(|_| engine_tuned.tick(sample_rate)).collect();

        // The two should be different (different playback speeds)
        let diff_rms = (normal
            .iter()
            .zip(tuned.iter())
            .map(|(a, b)| (a - b) * (a - b))
            .sum::<f32>()
            / 100.0)
            .sqrt();
        assert!(
            diff_rms > 1e-5,
            "Tune+12 should change playback, diff_rms={diff_rms}"
        );
    }
}
