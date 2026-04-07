/// Phase Vocoder with Identity Phase Locking (IPL).
///
/// Frequency-domain time-stretching that decomposes audio into STFT frames,
/// modifies synthesis hop size for time-scaling, and uses identity phase
/// locking to preserve vertical phase coherence and eliminate "phasiness."
///
/// Parameters (from spec):
///   - FFT size: 2048 samples
///   - Overlap: 75% (hop = N/4 = 512)
///   - Identity Phase Locking (Laroche & Dolson, 1999)
///
/// Best for: sustained tones, pads, tonal content.
/// Struggles with: transients (smearing).

use std::f32::consts::PI;

use super::super::types::FFT_SIZE_PV;

// ── Constants ──────────────────────────────────────────────────────────

const HOP_ANALYSIS: usize = FFT_SIZE_PV / 4; // 512 — 75% overlap
const NUM_BINS: usize = FFT_SIZE_PV / 2 + 1;

// ── Phase Vocoder ──────────────────────────────────────────────────────

/// Offline Phase Vocoder with Identity Phase Locking.
///
/// Pre-allocates per-bin work buffers (phase, magnitude, frequency, peak flags)
/// at construction. The `analyze()` and `process()` methods allocate frame
/// and output buffers on the heap — this is acceptable because the phase vocoder
/// runs offline on the management thread, never on the RT audio thread.
pub struct PhaseVocoder {
    fft_size: usize,
    hop_ana: usize,
    window: Vec<f32>,

    // Pre-allocated work buffers.
    prev_phase: Vec<f32>,
    synth_phase: Vec<f32>,
    magnitudes: Vec<f32>,
    frequencies: Vec<f32>,
    peak_flags: Vec<bool>,
}

impl PhaseVocoder {
    pub fn new() -> Self {
        // Hann window.
        let window: Vec<f32> = (0..FFT_SIZE_PV)
            .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f32 / FFT_SIZE_PV as f32).cos()))
            .collect();

        Self {
            fft_size: FFT_SIZE_PV,
            hop_ana: HOP_ANALYSIS,
            window,
            prev_phase: vec![0.0; NUM_BINS],
            synth_phase: vec![0.0; NUM_BINS],
            magnitudes: vec![0.0; NUM_BINS],
            frequencies: vec![0.0; NUM_BINS],
            peak_flags: vec![false; NUM_BINS],
        }
    }

    /// Time-stretch a mono audio buffer by the given ratio.
    ///
    /// `ratio` > 1.0 = slower (longer), < 1.0 = faster (shorter).
    pub fn process(&mut self, input: &[f32], ratio: f64) -> Vec<f32> {
        if input.len() < self.fft_size || ratio <= 0.0 {
            return input.to_vec();
        }

        let hop_syn = (self.hop_ana as f64 * ratio) as usize;
        let hop_syn = hop_syn.max(1);

        // Compute STFT frames (analysis).
        let frames = self.analyze(input);
        let num_frames = frames.len();

        if num_frames < 2 {
            return input.to_vec();
        }

        // Output buffer.
        let output_len = (num_frames - 1) * hop_syn + self.fft_size;
        let mut output = vec![0.0f32; output_len];
        let mut window_sum = vec![0.0f32; output_len];

        // Reset synthesis phase.
        for phase in &mut self.synth_phase {
            *phase = 0.0;
        }
        for phase in &mut self.prev_phase {
            *phase = 0.0;
        }

        // Process each frame.
        for (frame_idx, frame) in frames.iter().enumerate() {
            // Extract magnitudes and phases.
            for bin in 0..NUM_BINS {
                let real = frame[bin * 2];
                let imag = frame[bin * 2 + 1];
                self.magnitudes[bin] = (real * real + imag * imag).sqrt();
                let phase = imag.atan2(real);

                // Compute instantaneous frequency via phase difference.
                let expected_phase_advance = 2.0 * PI * bin as f32 * self.hop_ana as f32 / self.fft_size as f32;
                let phase_diff = phase - self.prev_phase[bin] - expected_phase_advance;
                // Wrap to [-pi, pi].
                let wrapped = phase_diff - (2.0 * PI * (phase_diff / (2.0 * PI)).round());
                self.frequencies[bin] = expected_phase_advance + wrapped;

                self.prev_phase[bin] = phase;
            }

            // Identity Phase Locking: find spectral peaks.
            self.find_peaks();

            // Propagate phases.
            if frame_idx == 0 {
                // First frame: use analysis phases directly.
                for bin in 0..NUM_BINS {
                    self.synth_phase[bin] = self.prev_phase[bin];
                }
            } else {
                // Advance peak phases and lock surrounding bins.
                for bin in 0..NUM_BINS {
                    if self.peak_flags[bin] {
                        // Peak bin: advance phase by instantaneous frequency × synthesis hop.
                        self.synth_phase[bin] += self.frequencies[bin] * ratio as f32;
                    }
                }

                // Lock non-peak bins to nearest peak's phase relationship.
                for bin in 0..NUM_BINS {
                    if !self.peak_flags[bin] {
                        // Find nearest peak.
                        let nearest_peak = self.find_nearest_peak(bin);
                        if nearest_peak < NUM_BINS {
                            let phase_diff_original =
                                self.prev_phase[bin] - self.prev_phase[nearest_peak];
                            self.synth_phase[bin] = self.synth_phase[nearest_peak] + phase_diff_original;
                        } else {
                            self.synth_phase[bin] += self.frequencies[bin] * ratio as f32;
                        }
                    }
                }
            }

            // Synthesize frame via inverse DFT.
            let syn_start = frame_idx * hop_syn;
            self.synthesize_frame(&mut output, &mut window_sum, syn_start);
        }

        // Normalize by window sum (overlap-add normalization).
        for (idx, sample) in output.iter_mut().enumerate() {
            if window_sum[idx] > 1e-6 {
                *sample /= window_sum[idx];
            }
        }

        output
    }

    // ── Internal ───────────────────────────────────────────────────────

    /// Analyze input into STFT frames (real/imag interleaved per bin).
    fn analyze(&self, input: &[f32]) -> Vec<Vec<f32>> {
        let num_frames = (input.len() - self.fft_size) / self.hop_ana + 1;
        let mut frames = Vec::with_capacity(num_frames);

        for frame_idx in 0..num_frames {
            let start = frame_idx * self.hop_ana;
            let mut frame = vec![0.0f32; NUM_BINS * 2]; // real/imag interleaved

            // DFT (offline, not RT — O(N*K) is acceptable).
            for bin in 0..NUM_BINS {
                let mut real = 0.0f32;
                let mut imag = 0.0f32;
                let freq = 2.0 * PI * bin as f32 / self.fft_size as f32;

                for n in 0..self.fft_size {
                    let sample = if start + n < input.len() {
                        input[start + n] * self.window[n]
                    } else {
                        0.0
                    };
                    real += sample * (freq * n as f32).cos();
                    imag -= sample * (freq * n as f32).sin();
                }

                frame[bin * 2] = real;
                frame[bin * 2 + 1] = imag;
            }

            frames.push(frame);
        }

        frames
    }

    /// Find spectral peaks in the current magnitude spectrum.
    fn find_peaks(&mut self) {
        for flag in &mut self.peak_flags {
            *flag = false;
        }

        // A bin is a peak if it's greater than both neighbors.
        for bin in 1..NUM_BINS - 1 {
            if self.magnitudes[bin] > self.magnitudes[bin - 1]
                && self.magnitudes[bin] > self.magnitudes[bin + 1]
            {
                self.peak_flags[bin] = true;
            }
        }

        // Edge bins: mark as peaks if they're local maxima.
        if NUM_BINS > 1 && self.magnitudes[0] > self.magnitudes[1] {
            self.peak_flags[0] = true;
        }
        if NUM_BINS > 1 && self.magnitudes[NUM_BINS - 1] > self.magnitudes[NUM_BINS - 2] {
            self.peak_flags[NUM_BINS - 1] = true;
        }
    }

    /// Find the nearest peak bin to a given bin index.
    fn find_nearest_peak(&self, bin: usize) -> usize {
        let mut best_dist = NUM_BINS;
        let mut best_bin = NUM_BINS; // sentinel

        for (peak_bin, &is_peak) in self.peak_flags.iter().enumerate() {
            if is_peak {
                let dist = if peak_bin > bin {
                    peak_bin - bin
                } else {
                    bin - peak_bin
                };
                if dist < best_dist {
                    best_dist = dist;
                    best_bin = peak_bin;
                }
            }
        }

        best_bin
    }

    /// Synthesize one frame into the output buffer via inverse DFT + overlap-add.
    fn synthesize_frame(&self, output: &mut [f32], window_sum: &mut [f32], syn_start: usize) {
        for n in 0..self.fft_size {
            let out_idx = syn_start + n;
            if out_idx >= output.len() {
                break;
            }

            let mut sample = 0.0f32;
            for bin in 0..NUM_BINS {
                let phase = self.synth_phase[bin];
                let mag = self.magnitudes[bin];
                let freq = 2.0 * PI * bin as f32 * n as f32 / self.fft_size as f32;

                // Reconstruct using magnitude and locked phase.
                sample += mag * (freq + phase).cos();
            }

            // Scale by 2/N (DFT normalization) and apply window.
            sample *= 2.0 / self.fft_size as f32 * self.window[n];
            output[out_idx] += sample;
            window_sum[out_idx] += self.window[n] * self.window[n];
        }
    }
}

impl Default for PhaseVocoder {
    fn default() -> Self {
        Self::new()
    }
}
