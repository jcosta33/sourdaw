/// Reverse reverb — real-time double-buffered grain reversal.
///
/// Method 3 from the research doc: circular buffer with grains that play
/// in reverse, Hann-windowed crossfades at buffer boundaries.
/// Buffer size equals the desired reverse time (0.5-3 seconds).
/// Produces the classic pre-vocal swell / reverse wash effect.
use std::f32::consts::TAU;

// Tone filters only. This engine writes one mono buffer and emits the same
// sample to both channels, so the stage's mid/side `width` matrix has no side
// component to scale — see `OutputStage::MONO_PARAM_NAMES`.
use crate::output_stage::OutputStage;

/// Maximum reverse time (3 seconds at 48kHz).
const MAX_REVERSE_SAMPLES: usize = 144000;

pub struct ReverseReverb {
    sample_rate: f32,

    // Double buffer: while one fills, the other plays in reverse
    buffer_a: Vec<f32>,
    buffer_b: Vec<f32>,
    write_pos: usize,
    reverse_len: usize,

    // Which buffer is currently writing (true = A writes, B plays)
    a_is_writing: bool,

    // Playback state for the reading buffer
    read_pos: usize,
    crossfade_len: usize,

    // Output envelope for smooth transitions
    envelope_phase: f32,

    pub mix: f32,
    pub decay: f32, // applied to the reversed signal

    /// Wet-path tone, shared with the plate, the FDN and the spring.
    output: OutputStage,
}

impl ReverseReverb {
    pub fn new(sample_rate: f32) -> Self {
        let reverse_len = (sample_rate * 1.5) as usize; // 1.5s default
        let crossfade_len = (sample_rate * 0.015) as usize; // 15ms crossfade
        Self {
            sample_rate,
            buffer_a: vec![0.0; MAX_REVERSE_SAMPLES],
            buffer_b: vec![0.0; MAX_REVERSE_SAMPLES],
            write_pos: 0,
            reverse_len,
            a_is_writing: true,
            read_pos: 0,
            crossfade_len,
            envelope_phase: 0.0,
            mix: 0.3,
            decay: 0.7,
            output: OutputStage::new(sample_rate),
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        if self.output.set_param(name, value) {
            return;
        }

        match name {
            "mix" => self.mix = value.clamp(0.0, 1.0),
            "decay" => self.decay = value.clamp(0.0, 0.99),
            "size" | "reverse_time" => {
                let time_s = 0.5 + value * 2.5; // 0.5-3.0 seconds
                self.reverse_len = ((time_s * self.sample_rate) as usize).min(MAX_REVERSE_SAMPLES);
            }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        for i in 0..left.len() {
            let dry_l = left[i];
            let dry_r = right[i];
            let mono = (dry_l + dry_r) * 0.5;

            // Write to the active buffer
            let write_buf = if self.a_is_writing {
                &mut self.buffer_a
            } else {
                &mut self.buffer_b
            };
            write_buf[self.write_pos] = mono;

            // Read from the other buffer in REVERSE
            let read_buf = if self.a_is_writing {
                &self.buffer_b
            } else {
                &self.buffer_a
            };

            // Read position goes backwards from reverse_len-1 to 0
            let reversed = if self.read_pos < self.reverse_len {
                let rev_idx = self.reverse_len - 1 - self.read_pos;
                read_buf[rev_idx] * self.decay
            } else {
                0.0
            };

            // Hann envelope for crossfade at boundaries
            let env = if self.read_pos < self.crossfade_len {
                // Fade in
                let t = self.read_pos as f32 / self.crossfade_len as f32;
                0.5 * (1.0 - (TAU * 0.5 * t).cos())
            } else if self.read_pos > self.reverse_len.saturating_sub(self.crossfade_len) {
                // Fade out
                let remaining = self.reverse_len.saturating_sub(self.read_pos);
                let t = remaining as f32 / self.crossfade_len as f32;
                0.5 * (1.0 - (TAU * 0.5 * t).cos())
            } else {
                1.0
            };

            // Output EQ over the windowed grain. Filtering the grain rather
            // than the raw buffer read keeps the crossfade envelope intact:
            // a highpass ahead of the window would ring across the boundary
            // the window exists to hide.
            let wet = self.output.process_mono(reversed * env);

            // Advance positions
            self.write_pos += 1;
            self.read_pos += 1;

            // Swap buffers when write buffer is full
            if self.write_pos >= self.reverse_len {
                self.write_pos = 0;
                self.read_pos = 0;
                self.a_is_writing = !self.a_is_writing;
            }

            // Mix
            left[i] = dry_l * (1.0 - self.mix) + wet * self.mix;
            right[i] = dry_r * (1.0 - self.mix) + wet * self.mix;
        }
    }

    pub fn param_names(&self) -> Vec<&str> {
        // The host-facing name is the descriptor's `size`, which is already
        // declared and already maps onto this engine's buffer length;
        // `reverse_time` stays accepted as the engine-native alias but is not
        // advertised. Same shape as the FDN pair, which advertises `decay`
        // while still accepting `rt60`. Advertising a name the descriptor
        // never declares would describe a control the host cannot send.
        let mut names = vec!["mix", "decay", "size"];
        // Tone only. `width` is deliberately absent: the wet path above is one
        // mono sample copied to both channels, so a width matrix would accept
        // the write and change nothing. Advertising it would describe a
        // control that cannot move this engine's output.
        names.extend(OutputStage::PARAM_NAMES);
        names
    }
}
