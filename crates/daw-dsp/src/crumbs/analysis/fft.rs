//! Iterative radix-2 Cooley–Tukey FFT for the offline analysis paths.
//!
//! The spectrogram behind onset detection (and, through it, tempo estimation)
//! used to evaluate a direct DFT bin by bin: `fft_size` multiply-accumulates
//! per bin, `fft_size / 2 + 1` bins per frame. At the shipped 1024-point,
//! 441-hop settings that is roughly 9 × 10⁹ MACs for three minutes of 44.1 kHz
//! audio, which the calling Tauri command pays synchronously. This module is
//! the O(N log N) replacement. It is written in-crate rather than pulled from
//! a dependency because this crate's dependency set is deliberately minimal
//! (see `crates/daw-dsp/AGENTS.md`).
//!
//! ## Conventions
//!
//! The transform is the forward DFT with the engineering sign convention
//!
//! ```text
//! X[k] = Σ_{n=0}^{N-1} x[n] · e^{-2πikn/N}
//! ```
//!
//! that is, `real += x[n]·cos(ωn)` and `imag -= x[n]·sin(ωn)`, so a bin's phase
//! is `imag.atan2(real)`. These are the conventions the direct DFT used, and
//! the complex-domain onset detector reads phase directly, so they are part of
//! this module's contract rather than an implementation detail.
//!
//! Real input yields a Hermitian spectrum, so only bins `0..=N/2`
//! (`num_bins()` of them) carry information; that is the half callers read.
//!
//! ## Real-time safety
//!
//! Nothing here is RT-safe and nothing here is meant to be: `RealFftPlan::new`
//! allocates its tables and scratch. The point of the plan is that a caller
//! builds it *once* and transforms every frame through it, so the per-frame
//! work is allocation-free even though the analysis runs off the audio thread.

use std::f32::consts::PI;

/// A reusable plan for a power-of-two real-input FFT.
///
/// Build one per spectrogram, not one per frame: the twiddle and bit-reversal
/// tables and the working buffer are sized at construction and reused by every
/// `forward` call.
pub struct RealFftPlan {
    /// Transform length `N`. Always a power of two.
    size: usize,
    /// `bit_reverse[n]` is `n` with its `log2(N)` index bits reversed, i.e. the
    /// slot `x[n]` occupies in the decimation-in-time input permutation.
    bit_reverse: Vec<u32>,
    /// `e^{-2πik/N}` for `k` in `0..N/2`, interleaved `[re, im, re, im, …]`.
    /// A butterfly stage of half-width `m` reads it with stride `N / (2m)`.
    twiddles: Vec<f32>,
    /// Interleaved complex working buffer, `2N` long, reused across frames.
    /// After `forward` it holds the full spectrum; `magnitudes_into` and
    /// `phases_into` read its first `num_bins()` complex entries.
    scratch: Vec<f32>,
}

impl RealFftPlan {
    /// Build a plan for `size`-point transforms.
    ///
    /// # Panics
    ///
    /// Panics if `size` is zero or not a power of two. Radix-2 Cooley–Tukey
    /// has no meaning off a power of two, and every caller in this crate
    /// transforms a compile-known power of two, so a wrong size is a
    /// programming error rather than a runtime condition to thread through the
    /// offline analysis API.
    pub fn new(size: usize) -> Self {
        // `is_power_of_two` is already false for zero, so this one predicate
        // covers both rejections.
        assert!(
            size.is_power_of_two(),
            "RealFftPlan requires a power-of-two transform size, got {size}"
        );

        let bits = size.trailing_zeros().max(1);
        let bit_reverse = (0..size)
            .map(|n| ((n as u32).reverse_bits() >> (u32::BITS - bits)) & (size as u32 - 1))
            .collect();

        let mut twiddles = Vec::with_capacity(size);
        for k in 0..size / 2 {
            let angle = -2.0 * PI * k as f32 / size as f32;
            twiddles.push(angle.cos());
            twiddles.push(angle.sin());
        }

        Self {
            size,
            bit_reverse,
            twiddles,
            scratch: vec![0.0; 2 * size],
        }
    }

    /// The transform length this plan was built for.
    pub fn size(&self) -> usize {
        self.size
    }

    /// Number of independent bins in a real-input spectrum: `N / 2 + 1`.
    pub fn num_bins(&self) -> usize {
        self.size / 2 + 1
    }

    /// Transform one real frame in place into the plan's working buffer.
    ///
    /// Read the result with [`Self::magnitudes_into`] and [`Self::phases_into`]
    /// before the next `forward` call overwrites it.
    ///
    /// # Panics
    ///
    /// Panics if `input.len()` is not [`Self::size`].
    pub fn forward(&mut self, input: &[f32]) {
        assert_eq!(
            input.len(),
            self.size,
            "RealFftPlan::forward expects exactly {} samples",
            self.size
        );

        // Decimation in time: permute the input into bit-reversed order, then
        // the butterflies run over contiguous, in-order blocks.
        for (n, &sample) in input.iter().enumerate() {
            let target = self.bit_reverse[n] as usize;
            self.scratch[2 * target] = sample;
            self.scratch[2 * target + 1] = 0.0;
        }

        let n = self.size;
        let mut half = 1usize;
        while half < n {
            // Twiddle index stride for this stage: the `j`-th butterfly of a
            // stage with half-width `half` needs `e^{-iπj/half}`, which is
            // entry `j · N / (2·half)` of the shared table.
            let stride = n / (2 * half);
            let mut block = 0usize;
            while block < n {
                for j in 0..half {
                    let tw = 2 * j * stride;
                    let wr = self.twiddles[tw];
                    let wi = self.twiddles[tw + 1];

                    let a = 2 * (block + j);
                    let b = 2 * (block + j + half);

                    let br = self.scratch[b];
                    let bi = self.scratch[b + 1];
                    let vr = br * wr - bi * wi;
                    let vi = br * wi + bi * wr;

                    let ar = self.scratch[a];
                    let ai = self.scratch[a + 1];

                    self.scratch[a] = ar + vr;
                    self.scratch[a + 1] = ai + vi;
                    self.scratch[b] = ar - vr;
                    self.scratch[b + 1] = ai - vi;
                }
                block += 2 * half;
            }
            half *= 2;
        }
    }

    /// Write the magnitude of bins `0..=N/2` from the last [`Self::forward`].
    ///
    /// # Panics
    ///
    /// Panics if `out.len()` is not [`Self::num_bins`].
    pub fn magnitudes_into(&self, out: &mut [f32]) {
        assert_eq!(
            out.len(),
            self.num_bins(),
            "RealFftPlan::magnitudes_into expects exactly {} bins",
            self.num_bins()
        );

        for (bin, magnitude) in out.iter_mut().enumerate() {
            let real = self.scratch[2 * bin];
            let imag = self.scratch[2 * bin + 1];
            *magnitude = (real * real + imag * imag).sqrt();
        }
    }

    /// Write the phase of bins `0..=N/2` from the last [`Self::forward`], in
    /// radians on `(-π, π]` under the forward-transform sign convention.
    ///
    /// # Panics
    ///
    /// Panics if `out.len()` is not [`Self::num_bins`].
    pub fn phases_into(&self, out: &mut [f32]) {
        assert_eq!(
            out.len(),
            self.num_bins(),
            "RealFftPlan::phases_into expects exactly {} bins",
            self.num_bins()
        );

        for (bin, phase) in out.iter_mut().enumerate() {
            let real = self.scratch[2 * bin];
            let imag = self.scratch[2 * bin + 1];
            *phase = imag.atan2(real);
        }
    }
}

/// Periodic Hann window, `0.5·(1 − cos(2πn/N))`.
///
/// Periodic rather than symmetric (the divisor is `N`, not `N − 1`), which is
/// the correct choice for overlap-add STFT analysis and the convention the
/// analysis spectrograms have always used.
pub fn hann_window(size: usize) -> Vec<f32> {
    (0..size)
        .map(|n| 0.5 * (1.0 - (2.0 * PI * n as f32 / size as f32).cos()))
        .collect()
}

/// Fill `frame` with `window`-weighted samples starting at `start`, padding
/// with zeros once the source runs out.
///
/// The tail padding is what makes the last STFT frames well defined; it is
/// kept here so the two spectrogram builders cannot drift apart on it.
///
/// # Panics
///
/// Panics if `window` and `frame` have different lengths.
pub fn fill_windowed_frame(samples: &[f32], start: usize, window: &[f32], frame: &mut [f32]) {
    assert_eq!(
        window.len(),
        frame.len(),
        "fill_windowed_frame needs a window as long as the frame"
    );

    for (n, slot) in frame.iter_mut().enumerate() {
        *slot = match samples.get(start + n) {
            Some(&sample) => sample * window[n],
            None => 0.0,
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[should_panic(expected = "power-of-two transform size")]
    fn a_non_power_of_two_size_is_rejected() {
        let _ = RealFftPlan::new(1000);
    }

    #[test]
    #[should_panic(expected = "power-of-two transform size")]
    fn a_zero_size_is_rejected() {
        let _ = RealFftPlan::new(0);
    }

    /// The DC bin of a windowed frame is the sum of the windowed samples, and
    /// the padding is what decides that sum once the source runs short. A
    /// frame that read past the end (or refused to emit) would move this.
    #[test]
    fn a_frame_past_the_end_of_the_source_is_zero_padded() {
        let window = vec![1.0f32; 8];
        let mut frame = vec![9.9f32; 8];
        fill_windowed_frame(&[1.0, 2.0, 3.0], 1, &window, &mut frame);

        assert_eq!(frame, vec![2.0, 3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
    }

    /// A pure bin-`k` cosine must put all its energy on bins `k` (and its
    /// mirror, which `num_bins` excludes). This is the cheapest statement that
    /// the butterfly ordering and the bit-reversal table agree.
    #[test]
    fn a_bin_aligned_cosine_lands_on_its_own_bin() {
        const SIZE: usize = 64;
        const BIN: usize = 7;

        let input: Vec<f32> = (0..SIZE)
            .map(|n| (2.0 * PI * BIN as f32 * n as f32 / SIZE as f32).cos())
            .collect();

        let mut plan = RealFftPlan::new(SIZE);
        plan.forward(&input);
        let mut magnitudes = vec![0.0f32; plan.num_bins()];
        plan.magnitudes_into(&mut magnitudes);

        assert!(
            (magnitudes[BIN] - SIZE as f32 / 2.0).abs() < 1e-3,
            "bin {BIN} magnitude was {}, expected {}",
            magnitudes[BIN],
            SIZE as f32 / 2.0
        );
        for (bin, &magnitude) in magnitudes.iter().enumerate() {
            if bin != BIN {
                assert!(
                    magnitude < 1e-3,
                    "bin {bin} should be empty but held {magnitude}"
                );
            }
        }
    }
}
