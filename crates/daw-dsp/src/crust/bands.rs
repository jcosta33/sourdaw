//! Multiband split for Crust's ROUTE level — wideband, 3-band or 5-band.
//!
//! Serial LR-4 splits with allpass compensation, the same topology
//! [`crate::proof::crossover::FourBandSplitter`] uses, generalised to the band
//! counts Crust's panel offers. An LR-4 low/high pair sums to an allpass rather
//! than to unity, so every band that was produced *before* a later split has to
//! be run through that split's own allpass or the recombined signal is not
//! flat.
//!
//! Splitting alone does not make a multiband limiter safe: the per-band gain
//! stages are summed afterwards, and independent bands can sum above the
//! ceiling. That is what the engine's final wideband true-peak stage is for.

use crate::proof::crossover::Lr4Crossover;

/// Crossover points needed for the widest mode (5 bands).
pub const MAX_CROSSOVERS: usize = 4;
/// Bands the widest mode produces.
pub const MAX_BANDS: usize = 5;
/// Allpass compensators: band `b` needs one per crossover above it.
const MAX_COMPENSATORS: usize = 6;

/// Flat index of the compensator that applies crossover `crossover` to band
/// `band`. Fixed regardless of the active band count, so a given (band,
/// crossover) pair always reuses the same filter state.
fn compensator_slot(band: usize, crossover: usize) -> usize {
    let base = match band {
        0 => 0,
        1 => 3,
        _ => 5,
    };
    base + (crossover - band - 1)
}

pub struct MultibandSplitter {
    splits: Vec<Lr4Crossover>,
    compensators: Vec<Lr4Crossover>,
    bands: usize,
    sample_rate: f64,
}

impl MultibandSplitter {
    pub fn new(sample_rate: f64) -> Self {
        let build = |count: usize| {
            (0..count)
                .map(|_| Lr4Crossover::new(1_000.0, sample_rate))
                .collect::<Vec<_>>()
        };
        Self {
            splits: build(MAX_CROSSOVERS),
            compensators: build(MAX_COMPENSATORS),
            bands: 1,
            sample_rate,
        }
    }

    pub fn bands(&self) -> usize {
        self.bands
    }

    /// Select 1 (wideband), 3 or 5 bands. Any other count is refused rather
    /// than rounded, because a count the crossover layout does not cover would
    /// silently drop the top band.
    pub fn set_bands(&mut self, bands: usize) {
        if bands == 1 || bands == 3 || bands == 5 {
            self.bands = bands;
        }
    }

    /// Set the two crossovers the panel exposes.
    ///
    /// 3-band splits at exactly those two. 5-band keeps them as the inner pair
    /// and derives an outer pair below and above, so one pair of controls still
    /// means the same thing in both modes.
    pub fn set_crossovers(&mut self, low_hz: f32, high_hz: f32) {
        let low = low_hz.clamp(20.0, 2_000.0) as f64;
        let high = high_hz.clamp(200.0, 18_000.0).max(low_hz * 2.0) as f64;
        let frequencies = [
            (low * 0.4).max(20.0),
            low,
            high,
            (high * 4.0).min(self.sample_rate * 0.45),
        ];
        for (index, frequency) in frequencies.iter().enumerate() {
            self.splits[index].set_freq(*frequency, self.sample_rate);
            for band in 0..index {
                let slot = compensator_slot(band, index);
                self.compensators[slot].set_freq(*frequency, self.sample_rate);
            }
        }
    }

    /// Crossover indices this band count actually splits at.
    ///
    /// 3-band uses the inner pair (the two frequencies the panel names);
    /// 5-band uses all four.
    fn active_crossovers(&self) -> &'static [usize] {
        match self.bands {
            3 => &[1, 2],
            5 => &[0, 1, 2, 3],
            _ => &[],
        }
    }

    /// Split one stereo sample into `bands()` band pairs, written into `out`.
    #[inline]
    pub fn process(&mut self, left: f32, right: f32, out: &mut [(f32, f32); MAX_BANDS]) {
        let crossovers = self.active_crossovers();
        if crossovers.is_empty() {
            out[0] = (left, right);
            return;
        }

        let mut rest = (left, right);
        for (band, &crossover) in crossovers.iter().enumerate() {
            let (low, high) = self.splits[crossover].process(rest.0, rest.1);
            out[band] = low;
            rest = high;
        }
        out[crossovers.len()] = rest;

        for band in 0..crossovers.len() {
            let mut compensated = out[band];
            for later in (band + 1)..crossovers.len() {
                let slot = compensator_slot(band, crossovers[later]);
                let (low, high) = self.compensators[slot].process(compensated.0, compensated.1);
                compensated = (low.0 + high.0, low.1 + high.1);
            }
            out[band] = compensated;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{MultibandSplitter, MAX_BANDS};

    const SAMPLE_RATE: f64 = 48_000.0;

    fn recombined_response(bands: usize, frequency: f32) -> f32 {
        let mut splitter = MultibandSplitter::new(SAMPLE_RATE);
        splitter.set_bands(bands);
        splitter.set_crossovers(120.0, 2_000.0);

        let mut scratch = [(0.0_f32, 0.0_f32); MAX_BANDS];
        let mut peak = 0.0_f32;
        for n in 0..24_000 {
            let phase = 2.0 * std::f32::consts::PI * frequency * n as f32 / SAMPLE_RATE as f32;
            let sample = phase.sin();
            splitter.process(sample, sample, &mut scratch);
            let sum: f32 = scratch[..splitter.bands()].iter().map(|band| band.0).sum();
            if n > 8_000 {
                peak = peak.max(sum.abs());
            }
        }
        peak
    }

    /// The compensators are the whole point: without them the recombined sum
    /// dips several dB around each crossover. Probe on and off the crossovers.
    #[test]
    fn recombined_bands_stay_flat_across_the_spectrum() {
        for bands in [3_usize, 5] {
            for frequency in [50.0_f32, 120.0, 400.0, 2_000.0, 6_000.0] {
                let peak = recombined_response(bands, frequency);
                assert!(
                    (0.9..=1.1).contains(&peak),
                    "{bands}-band sum at {frequency} Hz measured {peak:.4}, not flat"
                );
            }
        }
    }

    #[test]
    fn wideband_mode_hands_back_the_input_untouched() {
        let mut splitter = MultibandSplitter::new(SAMPLE_RATE);
        let mut scratch = [(0.0_f32, 0.0_f32); MAX_BANDS];

        splitter.process(0.42, -0.17, &mut scratch);

        assert_eq!(splitter.bands(), 1);
        assert_eq!(scratch[0], (0.42, -0.17));
    }

    #[test]
    fn an_unsupported_band_count_is_refused_rather_than_rounded() {
        let mut splitter = MultibandSplitter::new(SAMPLE_RATE);
        splitter.set_bands(3);

        splitter.set_bands(4);

        assert_eq!(splitter.bands(), 3);
    }
}
