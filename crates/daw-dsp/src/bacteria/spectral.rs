//! Spectral processing for Bacteria: blur, freeze, frequency shifting.
//!
//! Placeholder module — full STFT implementation and Hilbert transform
//! frequency shifter will be expanded in Phase 3.

use crate::primitives::flush_denormal;

/// Spectral blur processor using simple recursive averaging.
/// This is a time-domain approximation; full STFT follows in Phase 3.
pub struct SpectralProcessor {
    blur_alpha: f32,
    freeze: bool,
    mix: f32,

    // Time-domain blur approximation using smoothed buffer
    smooth_buffer: Vec<f32>,
    buffer_pos: usize,
    frozen_value: f32,
}

impl SpectralProcessor {
    pub fn new(_sample_rate: f32) -> Self {
        Self {
            blur_alpha: 0.5,
            freeze: false,
            mix: 0.5,
            smooth_buffer: vec![0.0; 1024],
            buffer_pos: 0,
            frozen_value: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "spectralBlur" => self.blur_alpha = value.clamp(0.0, 1.0),
            "spectralFreeze" => self.freeze = value > 0.5,
            "spectralMix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if self.freeze {
            return input * (1.0 - self.mix) + self.frozen_value * self.mix;
        }

        // Simple time-domain spectral blur: recursive smoothing
        // DSP-2: the smoothing recursion runs through the ring buffer, so the tail
        // decays into the subnormal range one slot at a time.
        let smoothed = flush_denormal(
            self.blur_alpha * input + (1.0 - self.blur_alpha) * self.smooth_buffer[self.buffer_pos],
        );
        self.smooth_buffer[self.buffer_pos] = smoothed;
        self.buffer_pos = (self.buffer_pos + 1) % self.smooth_buffer.len();
        self.frozen_value = smoothed;

        input * (1.0 - self.mix) + smoothed * self.mix
    }

    pub fn reset(&mut self) {
        self.smooth_buffer.fill(0.0);
        self.buffer_pos = 0;
        self.frozen_value = 0.0;
    }
}

/// Frequency shifter using Hilbert transform approximation.
/// Simple all-pass network approximation of 90° phase shift.
pub struct FrequencyShifter {
    shift_hz: f32,
    mix: f32,
    phase: f32,
    sample_rate: f32,
    // All-pass chain for Hilbert approximation (simplified)
    ap_state: [f32; 4],
}

impl FrequencyShifter {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            shift_hz: 0.0,
            mix: 0.5,
            phase: 0.0,
            sample_rate,
            ap_state: [0.0; 4],
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "freqShiftHz" => self.shift_hz = value,
            "freqShiftMix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if self.shift_hz.abs() < 0.001 {
            return input;
        }

        // Simple frequency shifting: multiply by complex exponential
        let phase_inc = self.shift_hz / self.sample_rate;
        self.phase += phase_inc;
        if self.phase > 1.0 {
            self.phase -= 1.0;
        }
        if self.phase < -1.0 {
            self.phase += 1.0;
        }

        let cos_phase = (self.phase * 2.0 * std::f32::consts::PI).cos();
        let shifted = input * cos_phase;

        input * (1.0 - self.mix) + shifted * self.mix
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.ap_state = [0.0; 4];
    }
}
