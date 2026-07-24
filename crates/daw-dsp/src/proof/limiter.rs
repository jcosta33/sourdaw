//! Look-ahead brickwall limiter with ITU-R BS.1770 true-peak detection.
//!
//! The `lim_ceiling` parameter is advertised in dBTP, so the gain computer is
//! fed a 4x-oversampled inter-sample peak (`true_peak::TruePeakUpsampler`),
//! not the raw sample magnitude: samples sitting under the ceiling can still
//! reconstruct above it at the DAC or after a lossy re-encode. The detector
//! takes `max(sample peak, reconstructed peak)` so the sample-domain ceiling
//! is honoured even where the 4x reconstruction reads marginally low.

use super::true_peak::TruePeakUpsampler;
use std::collections::VecDeque;

struct MonotonicPeakWindow {
    peaks: VecDeque<(usize, f32)>,
    window_start: usize,
    next_index: usize,
    #[cfg(test)]
    candidate_inspections: usize,
}

impl MonotonicPeakWindow {
    fn new(lookahead_samples: usize) -> Self {
        Self {
            peaks: VecDeque::with_capacity(lookahead_samples.saturating_add(1)),
            window_start: 0,
            next_index: 0,
            #[cfg(test)]
            candidate_inspections: 0,
        }
    }

    fn push(&mut self, peak: f32) {
        let index = self.next_index;
        self.next_index = self.next_index.saturating_add(1);

        // Each candidate is pushed once and removed from the back at most once.
        while let Some((_, previous_peak)) = self.peaks.back() {
            #[cfg(test)]
            {
                self.candidate_inspections += 1;
            }
            if *previous_peak > peak {
                break;
            }
            self.peaks.pop_back();
        }
        self.peaks.push_back((index, peak));
    }

    fn max(&self) -> f32 {
        self.peaks.front().map_or(0.0, |(_, peak)| *peak)
    }

    fn advance(&mut self) {
        #[cfg(test)]
        {
            self.candidate_inspections += 1;
        }
        if self
            .peaks
            .front()
            .is_some_and(|(index, _)| *index == self.window_start)
        {
            self.peaks.pop_front();
        }
        self.window_start = self.window_start.saturating_add(1);
    }

    fn ensure_capacity(&mut self, lookahead_samples: usize) {
        let required_capacity = lookahead_samples.saturating_add(1);
        if self.peaks.capacity() < required_capacity {
            self.peaks.reserve(required_capacity - self.peaks.len());
        }
    }

    /// Re-seed the window after a look-ahead resize. Only the delayed samples
    /// survive a resize, so the window restarts from their sample magnitudes;
    /// true-peak entries resume as soon as fresh samples arrive.
    fn rebuild_from_delays(&mut self, delay_l: &VecDeque<f32>, delay_r: &VecDeque<f32>) {
        self.peaks.clear();
        self.window_start = 0;
        self.next_index = 0;

        for (&left, &right) in delay_l.iter().zip(delay_r.iter()) {
            self.push(left.abs().max(right.abs()));
        }
    }
}

pub struct LookaheadLimiter {
    delay_l: VecDeque<f32>,
    delay_r: VecDeque<f32>,
    max_peaks: MonotonicPeakWindow,
    true_peak_l: TruePeakUpsampler,
    true_peak_r: TruePeakUpsampler,
    ceiling: f32, // linear
    ceiling_db: f32,
    release_coeff: f32,
    current_gain: f32,
    lookahead_samples: usize,
    sample_rate: f32,
    bypassed: bool,
    // Metering
    meter_gr_db: f32,
    meter_output_peak: f32,
}

impl LookaheadLimiter {
    pub fn new(sr: f32) -> Self {
        let lookahead_ms = 5.0;
        let lookahead_samples = (lookahead_ms * 0.001 * sr) as usize;
        let release_ms = 100.0;
        let mut delay_l = VecDeque::with_capacity(lookahead_samples.saturating_add(1));
        let mut delay_r = VecDeque::with_capacity(lookahead_samples.saturating_add(1));
        delay_l.resize(lookahead_samples, 0.0);
        delay_r.resize(lookahead_samples, 0.0);
        let mut max_peaks = MonotonicPeakWindow::new(lookahead_samples);
        max_peaks.rebuild_from_delays(&delay_l, &delay_r);

        Self {
            delay_l,
            delay_r,
            max_peaks,
            true_peak_l: TruePeakUpsampler::new(),
            true_peak_r: TruePeakUpsampler::new(),
            ceiling: 10.0_f32.powf(-1.0 / 20.0), // -1.0 dBTP default
            ceiling_db: -1.0,
            release_coeff: (-1.0 / (release_ms * 0.001 * sr)).exp(),
            current_gain: 1.0,
            lookahead_samples,
            sample_rate: sr,
            bypassed: false,
            meter_gr_db: 0.0,
            meter_output_peak: 0.0,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "lim_bypass" => self.bypassed = value > 0.5,
            "lim_ceiling" => {
                self.ceiling_db = value.clamp(-12.0, 0.0);
                self.ceiling = 10.0_f32.powf(self.ceiling_db / 20.0);
            }
            "lim_release" => {
                let ms = value.clamp(10.0, 500.0);
                self.release_coeff = (-1.0 / (ms * 0.001 * self.sample_rate)).exp();
            }
            "lim_lookahead" => {
                let ms = value.clamp(0.5, 10.0);
                let new_size = (ms * 0.001 * self.sample_rate) as usize;
                if new_size != self.lookahead_samples {
                    self.delay_l.resize(new_size, 0.0);
                    self.delay_r.resize(new_size, 0.0);
                    self.delay_l.reserve(1);
                    self.delay_r.reserve(1);
                    self.max_peaks.ensure_capacity(new_size);
                    self.max_peaks
                        .rebuild_from_delays(&self.delay_l, &self.delay_r);
                    self.lookahead_samples = new_size;
                }
            }
            _ => {}
        }
    }

    pub fn process(&mut self, left: &mut [f32], right: &mut [f32]) {
        if self.bypassed {
            return;
        }

        let mut peak_out = 0.0_f32;
        let mut max_gr = 0.0_f32;

        for i in 0..left.len() {
            // Push current sample into delay
            self.delay_l.push_back(left[i]);
            self.delay_r.push_back(right[i]);

            // Record the true (inter-sample) peak for look-ahead. The 4x
            // reconstruction is causal with ~6 base-rate samples of group
            // delay, so it costs 6 samples of the look-ahead window; the
            // remainder still runs ahead of the delayed output sample.
            let sample_peak = left[i].abs().max(right[i].abs());
            let reconstructed_peak = self
                .true_peak_l
                .push_max_abs(left[i])
                .max(self.true_peak_r.push_max_abs(right[i]));
            let peak = sample_peak.max(reconstructed_peak);
            self.max_peaks.push(peak);
            let future_peak = self.max_peaks.max();

            // Required gain to bring peak to ceiling
            let required_gain = if future_peak > self.ceiling {
                self.ceiling / future_peak
            } else {
                1.0
            };

            // Smooth: instant attack (look-ahead handles it), smooth release
            self.current_gain = if required_gain < self.current_gain {
                required_gain
            } else {
                self.release_coeff * self.current_gain + (1.0 - self.release_coeff) * required_gain
            };

            // Apply gain to delayed sample
            let dl = self.delay_l.pop_front().unwrap_or(0.0);
            let dr = self.delay_r.pop_front().unwrap_or(0.0);
            self.max_peaks.advance();

            left[i] = dl * self.current_gain;
            right[i] = dr * self.current_gain;

            // Track metering
            let gr = 20.0 * self.current_gain.log10();
            if gr < max_gr {
                max_gr = gr;
            }
            let out_peak = left[i].abs().max(right[i].abs());
            if out_peak > peak_out {
                peak_out = out_peak;
            }
        }

        self.meter_gr_db = max_gr;
        self.meter_output_peak = if peak_out > 1e-10 {
            20.0 * peak_out.log10()
        } else {
            -100.0
        };
    }

    pub fn get_gr_db(&self) -> f32 {
        self.meter_gr_db
    }
    pub fn get_output_peak_db(&self) -> f32 {
        self.meter_output_peak
    }
    pub fn latency_samples(&self) -> usize {
        self.lookahead_samples
    }
    pub fn is_bypassed(&self) -> bool {
        self.bypassed
    }
}

#[cfg(test)]
mod tests {
    use super::{LookaheadLimiter, TruePeakUpsampler};
    use assert_no_alloc::assert_no_alloc;
    #[cfg(debug_assertions)]
    use assert_no_alloc::AllocDisabler;
    use std::collections::VecDeque;

    #[cfg(debug_assertions)]
    #[global_allocator]
    static ALLOCATOR: AllocDisabler = AllocDisabler;

    fn reference_process(
        sample_rate: f32,
        input_left: &[f32],
        input_right: &[f32],
    ) -> (Vec<f32>, Vec<f32>) {
        let lookahead_samples = (5.0 * 0.001 * sample_rate) as usize;
        let ceiling = 10.0_f32.powf(-1.0 / 20.0);
        let release_coeff = (-1.0 / (100.0 * 0.001 * sample_rate)).exp();
        let mut delay_l = VecDeque::from(vec![0.0; lookahead_samples]);
        let mut delay_r = VecDeque::from(vec![0.0; lookahead_samples]);
        let mut gain_buffer = VecDeque::from(vec![0.0; lookahead_samples]);
        let mut max_peak = 0.0_f32;
        let mut max_peak_age = 0_usize;
        let mut current_gain = 1.0_f32;
        let mut output_left = input_left.to_vec();
        let mut output_right = input_right.to_vec();
        let mut reference_true_peak_l = TruePeakUpsampler::new();
        let mut reference_true_peak_r = TruePeakUpsampler::new();

        for i in 0..output_left.len() {
            delay_l.push_back(output_left[i]);
            delay_r.push_back(output_right[i]);

            let peak = output_left[i].abs().max(output_right[i].abs()).max(
                reference_true_peak_l
                    .push_max_abs(output_left[i])
                    .max(reference_true_peak_r.push_max_abs(output_right[i])),
            );
            gain_buffer.push_back(peak);
            if peak >= max_peak {
                max_peak = peak;
                max_peak_age = 0;
            } else {
                max_peak_age += 1;
                if max_peak_age >= lookahead_samples {
                    let mut max_idx = 0;
                    let mut max_val = 0.0_f32;
                    for (idx, &value) in gain_buffer.iter().enumerate() {
                        if value >= max_val {
                            max_val = value;
                            max_idx = idx;
                        }
                    }
                    max_peak = max_val;
                    max_peak_age = lookahead_samples.saturating_sub(1).saturating_sub(max_idx);
                }
            }

            let required_gain = if max_peak > ceiling {
                ceiling / max_peak
            } else {
                1.0
            };
            current_gain = if required_gain < current_gain {
                required_gain
            } else {
                release_coeff * current_gain + (1.0 - release_coeff) * required_gain
            };

            let delayed_left = delay_l.pop_front().unwrap_or(0.0);
            let delayed_right = delay_r.pop_front().unwrap_or(0.0);
            gain_buffer.pop_front();
            output_left[i] = delayed_left * current_gain;
            output_right[i] = delayed_right * current_gain;
        }

        (output_left, output_right)
    }

    #[test]
    fn expired_max_does_not_rescan_the_lookahead_window() {
        let mut limiter = LookaheadLimiter::new(48_000.0);
        let samples = limiter.latency_samples() * 2 + 1;
        let initial_inspections = limiter.max_peaks.candidate_inspections;
        let mut left = vec![0.0; samples];
        let mut right = vec![0.0; samples];
        left[0] = 1.0;
        right[0] = 1.0;

        limiter.process(&mut left, &mut right);

        let inspections = limiter.max_peaks.candidate_inspections - initial_inspections;
        assert!(
            inspections <= samples.saturating_mul(3),
            "monotonic window inspected {inspections} candidates for {samples} samples"
        );
    }

    #[test]
    fn monotonic_window_matches_the_previous_limiter_output() {
        let sample_rate = 48_000.0;
        let samples = 1_000;
        let mut input_left = vec![0.0; samples];
        let mut input_right = vec![0.0; samples];
        for i in 0..samples {
            input_left[i] = ((i * 13 % 29) as f32 - 14.0) / 12.0;
            input_right[i] = ((i * 17 % 37) as f32 - 18.0) / 15.0;
        }
        input_left[0] = 1.25;
        input_right[241] = -1.4;

        let (expected_left, expected_right) =
            reference_process(sample_rate, &input_left, &input_right);
        let mut actual_left = input_left.clone();
        let mut actual_right = input_right.clone();
        let mut limiter = LookaheadLimiter::new(sample_rate);
        let split = 333;
        limiter.process(&mut actual_left[..split], &mut actual_right[..split]);
        limiter.process(&mut actual_left[split..], &mut actual_right[split..]);

        let tolerance = f32::EPSILON * 8.0;
        for i in 0..samples {
            assert!(
                (actual_left[i] - expected_left[i]).abs() <= tolerance,
                "left sample {i}"
            );
            assert!(
                (actual_right[i] - expected_right[i]).abs() <= tolerance,
                "right sample {i}"
            );
        }
    }

    #[test]
    fn resized_lookahead_processes_decreasing_peaks_without_allocation() {
        let mut limiter = LookaheadLimiter::new(48_000.0);
        limiter.set_param("lim_lookahead", 10.0);
        let initial_capacities = (
            limiter.delay_l.capacity(),
            limiter.delay_r.capacity(),
            limiter.max_peaks.peaks.capacity(),
        );
        let samples = limiter.latency_samples();
        let denominator = samples as f32 + 1.0;
        let mut left = (0..samples)
            .map(|index| 1.0 - index as f32 / denominator)
            .collect::<Vec<_>>();
        let mut right = vec![0.0; samples];

        assert_no_alloc(|| limiter.process(&mut left, &mut right));

        let final_capacities = (
            limiter.delay_l.capacity(),
            limiter.delay_r.capacity(),
            limiter.max_peaks.peaks.capacity(),
        );
        assert_eq!(final_capacities, initial_capacities);
    }

    #[test]
    fn lookahead_resize_rebuilds_maximum_from_delayed_stereo_peaks() {
        let mut limiter = LookaheadLimiter::new(48_000.0);
        limiter.set_param("lim_lookahead", 1.0);
        let mut left = vec![0.0];
        let mut right = vec![1.0];
        limiter.process(&mut left, &mut right);

        limiter.set_param("lim_lookahead", 10.0);

        assert_eq!(limiter.latency_samples(), 480);
        assert_eq!(limiter.max_peaks.max(), 1.0);
    }

    /// Reconstruct the continuous waveform between samples with a
    /// Blackman-windowed sinc interpolator (32x, 96 taps) and return its peak
    /// magnitude over `[first, last)`. Deliberately *not* the BS.1770
    /// polyphase filter the limiter detects with, so it cannot rubber-stamp
    /// that filter: on the fs/4 test tone it recovers the analytic amplitude.
    fn reconstructed_peak(signal: &[f32], first: usize, last: usize) -> f32 {
        const UPSAMPLE: usize = 32;
        const HALF_WIDTH: isize = 48;

        let mut peak = 0.0_f64;
        for n in first..last {
            for step in 0..UPSAMPLE {
                let fraction = step as f64 / UPSAMPLE as f64;
                let mut accumulator = 0.0_f64;
                for j in (-HALF_WIDTH + 1)..=HALF_WIDTH {
                    let index = n as isize + j;
                    if index < 0 || index as usize >= signal.len() {
                        continue;
                    }
                    let t = fraction - j as f64;
                    let sinc = if t.abs() < 1e-9 {
                        1.0
                    } else {
                        (std::f64::consts::PI * t).sin() / (std::f64::consts::PI * t)
                    };
                    let window = 0.42
                        + 0.5 * (std::f64::consts::PI * t / HALF_WIDTH as f64).cos()
                        + 0.08 * (2.0 * std::f64::consts::PI * t / HALF_WIDTH as f64).cos();
                    accumulator += f64::from(signal[index as usize]) * sinc * window;
                }
                peak = peak.max(accumulator.abs());
            }
        }
        peak as f32
    }

    /// A 12 kHz (fs/4) tone offset 45 degrees at amplitude 0.99: every sample
    /// sits at +-0.6999 while the reconstructed waveform reaches 0.99
    /// (-0.09 dBTP). Sample-peak detection sees nothing above the -1.0 dBTP
    /// ceiling and passes the inter-sample peak straight through (DSP-1).
    #[test]
    fn inter_sample_peaks_above_the_ceiling_are_limited() {
        let ceiling = 10.0_f32.powf(-1.0 / 20.0);
        let mut left = (0..3_000)
            .map(|n| {
                let phase =
                    (n % 4) as f32 * std::f32::consts::FRAC_PI_2 + std::f32::consts::FRAC_PI_4;
                0.99 * phase.sin()
            })
            .collect::<Vec<_>>();
        let mut right = left.clone();

        let input_sample_peak = left.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
        let input_true_peak = reconstructed_peak(&left, 1_000, 1_010);
        assert!(
            input_sample_peak < ceiling,
            "sample peak {input_sample_peak:.4} must sit under the ceiling {ceiling:.4}, \
             otherwise the tone is not an inter-sample-peak case"
        );
        assert!(
            input_true_peak > ceiling,
            "reconstructed input peak must exceed the ceiling, got {input_true_peak:.4}"
        );

        let mut limiter = LookaheadLimiter::new(48_000.0);
        limiter.process(&mut left, &mut right);

        let output_true_peak = reconstructed_peak(&left, 2_000, 2_010);
        assert!(
            output_true_peak <= ceiling,
            "output must land at or under the -1.0 dBTP ceiling, got {output_true_peak:.4} \
             ({:+.2} dBTP)",
            20.0 * output_true_peak.log10()
        );
        assert!(
            output_true_peak > ceiling * 0.95,
            "the ceiling must be approached, not over-attenuated: {output_true_peak:.4}"
        );
        assert!(
            limiter.get_gr_db() < -0.8,
            "gain reduction must cover the ~0.9 dB inter-sample overshoot, got {:.2} dB",
            limiter.get_gr_db()
        );
    }

    /// Sample-peak content already under the ceiling must not be attenuated by
    /// the new detector: a 1 kHz tone at -3 dBFS reconstructs to -3 dBTP.
    #[test]
    fn low_frequency_content_under_the_ceiling_passes_unattenuated() {
        let mut left = (0..2_000)
            .map(|n| 0.707 * (2.0 * std::f32::consts::PI * 1_000.0 * n as f32 / 48_000.0).sin())
            .collect::<Vec<_>>();
        let mut right = left.clone();

        let mut limiter = LookaheadLimiter::new(48_000.0);
        limiter.process(&mut left, &mut right);

        let output_peak = left[500..2_000]
            .iter()
            .fold(0.0_f32, |acc, s| acc.max(s.abs()));
        assert!(
            (0.700..=0.708).contains(&output_peak),
            "a -3 dBFS tone must pass at its own level, got {output_peak:.4}"
        );
        assert_eq!(limiter.get_gr_db(), 0.0);
    }
}
