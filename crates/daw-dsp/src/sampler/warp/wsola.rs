/// WSOLA (Waveform Similarity Overlap-Add) time-stretching.
///
/// Time-domain algorithm that preserves transients and waveform shape.
/// Extracts overlapping frames at synthesis positions and searches within
/// a tolerance window for maximum waveform similarity in the overlap region.
///
/// Parameters (from spec):
///   - Frame length: 1024 samples
///   - Overlap: 512 samples (50%)
///   - Tolerance window (Δ_max): 256 samples
///
/// Best for: drums, speech, percussive content, real-time use.
/// Degrades beyond 2× stretch ratio with polyphonic content.
use std::f32::consts::PI;

use super::super::types::{WSOLA_FRAME, WSOLA_TOLERANCE};

// ── Constants ──────────────────────────────────────────────────────────

const OVERLAP: usize = WSOLA_FRAME / 2;

// ── WSOLA Processor ────────────────────────────────────────────────────

/// Offline WSOLA time-stretcher.
///
/// Processes an entire sample buffer and returns the time-stretched result.
/// For real-time use, the engine should pre-compute stretched regions.
#[derive(Debug)]
pub struct WsolaProcessor {
    frame_len: usize,
    overlap: usize,
    tolerance: usize,
    window: Vec<f32>,
}

impl WsolaProcessor {
    pub fn new() -> Self {
        let frame_len = WSOLA_FRAME;
        let overlap = OVERLAP;

        // Hann window for overlap-add.
        let window: Vec<f32> = (0..frame_len)
            .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f32 / frame_len as f32).cos()))
            .collect();

        Self {
            frame_len,
            overlap,
            tolerance: WSOLA_TOLERANCE,
            window,
        }
    }

    /// Time-stretch a mono audio buffer by the given ratio.
    ///
    /// `ratio` > 1.0 = slower (longer), < 1.0 = faster (shorter).
    /// Returns the stretched audio.
    pub fn process(&self, input: &[f32], ratio: f64) -> Vec<f32> {
        if input.len() < self.frame_len || ratio <= 0.0 {
            return input.to_vec();
        }

        let output_len = (input.len() as f64 * ratio) as usize;
        let mut output = vec![0.0f32; output_len];
        let hop_syn = self.frame_len - self.overlap; // Synthesis hop
        let hop_ana = (hop_syn as f64 / ratio) as usize; // Analysis hop

        let mut ana_pos: usize = 0; // Analysis position in input
        let mut syn_pos: usize = 0; // Synthesis position in output
        let mut prev_best_offset: i32 = 0;

        while syn_pos + self.frame_len <= output_len {
            // Determine the analysis center, adjusted by previous offset.
            let target_ana = (ana_pos as i32 + prev_best_offset).max(0) as usize;

            // Search for best match within tolerance window.
            let best_offset = if syn_pos > 0 {
                self.find_best_offset(input, &output, target_ana, syn_pos)
            } else {
                0i32
            };

            let actual_ana = (target_ana as i32 + best_offset)
                .max(0)
                .min((input.len() - self.frame_len) as i32) as usize;

            // Overlap-add the frame.
            for n in 0..self.frame_len {
                if actual_ana + n < input.len() && syn_pos + n < output_len {
                    output[syn_pos + n] += input[actual_ana + n] * self.window[n];
                }
            }

            prev_best_offset = best_offset;
            ana_pos += hop_ana;
            syn_pos += hop_syn;

            // Stop if we've run out of input.
            if ana_pos + self.frame_len > input.len() {
                break;
            }
        }

        output
    }

    /// Find the offset within the tolerance window that maximizes
    /// waveform similarity in the overlap region.
    fn find_best_offset(
        &self,
        input: &[f32],
        output: &[f32],
        ana_center: usize,
        syn_pos: usize,
    ) -> i32 {
        let mut best_offset: i32 = 0;
        let mut best_corr: f32 = f32::MIN;

        let tol = self.tolerance as i32;

        for delta in -tol..=tol {
            let candidate = ana_center as i32 + delta;
            if candidate < 0 || (candidate as usize + self.overlap) > input.len() {
                continue;
            }
            let candidate = candidate as usize;

            // Cross-correlation in the overlap region.
            let mut corr = 0.0f32;
            let mut energy_in = 0.0f32;
            let mut energy_out = 0.0f32;

            for n in 0..self.overlap {
                let in_sample = if candidate + n < input.len() {
                    input[candidate + n]
                } else {
                    0.0
                };
                let out_sample = if syn_pos + n < output.len() {
                    output[syn_pos + n]
                } else {
                    0.0
                };

                corr += in_sample * out_sample;
                energy_in += in_sample * in_sample;
                energy_out += out_sample * out_sample;
            }

            // Normalized cross-correlation.
            let denom = (energy_in * energy_out).sqrt();
            let ncc = if denom > 1e-10 { corr / denom } else { 0.0 };

            if ncc > best_corr {
                best_corr = ncc;
                best_offset = delta;
            }
        }

        best_offset
    }
}

impl Default for WsolaProcessor {
    fn default() -> Self {
        Self::new()
    }
}
