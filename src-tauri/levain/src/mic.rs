//! Microphone position mixing.
//!
//! Each mic position is its own audio stream with independent
//! gain, pan, delay, width, and phase inversion controls.
//! Delay lines are integer-sample (static per loaded zone) to
//! avoid artifacts.

use crate::types::MicPosition;

// ---------------------------------------------------------------------------
// Mic delay line (simple integer delay)
// ---------------------------------------------------------------------------

/// Maximum delay in samples (~500ms at 48kHz).
const MAX_DELAY_SAMPLES: usize = 24000;

pub struct MicDelayLine {
    buffer: Vec<f32>,
    write_pos: usize,
    delay: usize,
    size: usize,
}

impl MicDelayLine {
    pub fn new() -> Self {
        Self {
            buffer: vec![0.0; MAX_DELAY_SAMPLES],
            write_pos: 0,
            delay: 0,
            size: MAX_DELAY_SAMPLES,
        }
    }

    pub fn set_delay(&mut self, samples: u32) {
        self.delay = (samples as usize).min(self.size - 1);
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        self.buffer[self.write_pos] = input;
        let read_pos = (self.write_pos + self.size - self.delay) % self.size;
        let output = self.buffer[read_pos];
        self.write_pos = (self.write_pos + 1) % self.size;
        output
    }

    pub fn clear(&mut self) {
        self.buffer.fill(0.0);
    }
}

// ---------------------------------------------------------------------------
// Mic mixer
// ---------------------------------------------------------------------------

/// Maximum number of mic positions.
pub const MAX_MIC_POSITIONS: usize = 8;

/// Processes and mixes multiple mic positions into a stereo output.
pub struct MicMixer {
    positions: [MicPosition; MAX_MIC_POSITIONS],
    delay_lines: Vec<MicDelayLine>,
    num_mics: usize,
}

impl MicMixer {
    pub fn new(num_mics: usize) -> Self {
        let num = num_mics.min(MAX_MIC_POSITIONS);
        let delay_lines = (0..num).map(|_| MicDelayLine::new()).collect();

        Self {
            positions: [MicPosition::default(); MAX_MIC_POSITIONS],
            delay_lines,
            num_mics: num,
        }
    }

    /// Configure a mic position.
    pub fn set_mic(&mut self, index: usize, mut pos: MicPosition) {
        if index >= self.num_mics {
            return;
        }
        pos.update_pan_cache();
        self.positions[index] = pos;
        self.delay_lines[index].set_delay(pos.delay_samples);
    }

    /// Set volume for a mic position.
    pub fn set_mic_volume(&mut self, index: usize, volume: f32) {
        if index < self.num_mics {
            self.positions[index].volume = volume;
        }
    }

    /// Set pan for a mic position and recompute cached pan gains.
    pub fn set_mic_pan(&mut self, index: usize, pan: f32) {
        if index < self.num_mics {
            self.positions[index].pan = pan.clamp(-1.0, 1.0);
            self.positions[index].update_pan_cache();
        }
    }

    /// Enable/disable a mic position.
    pub fn set_mic_enabled(&mut self, index: usize, enabled: bool) {
        if index < self.num_mics {
            self.positions[index].enabled = enabled;
        }
    }

    /// Mix a mono sample from each mic position into stereo output.
    /// `mic_samples` should have one entry per enabled mic.
    /// Returns (left, right).
    #[inline]
    pub fn mix(&mut self, mic_samples: &[f32]) -> (f32, f32) {
        let mut left = 0.0_f32;
        let mut right = 0.0_f32;

        for i in 0..self.num_mics {
            let pos = &self.positions[i];
            if !pos.enabled {
                continue;
            }

            let sample = if i < mic_samples.len() {
                mic_samples[i]
            } else {
                0.0
            };

            // Apply delay.
            let delayed = self.delay_lines[i].process(sample);

            // Apply phase inversion.
            let phased = if pos.phase_invert { -delayed } else { delayed };

            // Apply volume.
            let gained = phased * pos.volume;

            // Use cached constant-power pan gains (computed in set_mic_pan).
            let l_gain = pos.cached_pan_l;
            let r_gain = pos.cached_pan_r;

            left += gained * l_gain;
            right += gained * r_gain;
        }

        (left, right)
    }

    /// Mix a single mono sample (from one mic, index 0) into stereo.
    /// Convenience for single-mic instruments.
    #[inline]
    pub fn mix_mono(&mut self, sample: f32) -> (f32, f32) {
        self.mix(&[sample])
    }

    pub fn num_mics(&self) -> usize {
        self.num_mics
    }

    pub fn clear_delays(&mut self) {
        for dl in self.delay_lines.iter_mut() {
            dl.clear();
        }
    }
}
