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

/// One-pole coefficient for a given time constant.
fn release_coeff(ms: f32, sr: f32) -> f32 {
    (-1.0 / (ms * 0.001 * sr)).exp()
}

/// The transient branch of the release. Derived from the user's
/// setting rather than fixed, so the control still means something: whatever
/// release is dialled in, an isolated peak recovers about eight times faster.
/// Floored at 5 ms because below that the branch starts tracking the waveform
/// of low-frequency material instead of its envelope.
fn fast_release_ms(nominal_ms: f32) -> f32 {
    (nominal_ms * 0.12).max(5.0)
}

/// How far below its running average the applied gain must sit before any of
/// the fast release is blended in, as a fraction of the average.
///
/// Sustained low-frequency limiting ripples the gain at the tone frequency, so
/// it dips under its own average every cycle; those dips are shallow (a 30 Hz
/// tone held over the ceiling produces roughly 0.1) while an isolated 10 dB
/// transient produces roughly 0.68. Without this deadband the ripple engaged
/// the fast branch too and cost 1.11 dB of THD at 30 Hz.
const TRANSIENT_DEADBAND: f32 = 0.05;

/// Time constant of the running gain average. Long enough that a 2 ms
/// transient barely moves it, short enough that genuinely sustained limiting
/// pulls it down within a syllable — which is what collapses the gap and hands
/// the release back to the nominal setting.
const GAIN_AVERAGE_MS: f32 = 250.0;

/// Declared look-ahead range, in milliseconds. `MAX_LOOKAHEAD_MS` also sizes
/// every buffer at construction: `lim_lookahead` is a live control that lands
/// on the render thread, so the setter is only allowed to move indices, never
/// to ask the allocator for room. Mirrored at the worklet wire boundary in
/// `proofProcessor.ts`.
const MIN_LOOKAHEAD_MS: f32 = 0.5;
const MAX_LOOKAHEAD_MS: f32 = 10.0;
const DEFAULT_LOOKAHEAD_MS: f32 = 5.0;

fn lookahead_samples_for(ms: f32, sr: f32) -> usize {
    (ms * 0.001 * sr) as usize
}

pub struct LookaheadLimiter {
    delay_l: VecDeque<f32>,
    delay_r: VecDeque<f32>,
    max_peaks: MonotonicPeakWindow,
    true_peak_l: TruePeakUpsampler,
    true_peak_r: TruePeakUpsampler,
    ceiling: f32, // linear
    ceiling_db: f32,
    /// Nominal release, used under sustained limiting.
    release_coeff: f32,
    /// Faster release, blended in for isolated transients.
    release_coeff_fast: f32,
    /// Running average of the applied gain. An isolated transient pulls
    /// `current_gain` far below this; sustained limiting drags this down to
    /// meet it. The gap is what distinguishes the two cases.
    gain_avg: f32,
    gain_avg_coeff: f32,
    current_gain: f32,
    lookahead_samples: usize,
    /// Look-ahead every buffer here has room for. Fixed at construction.
    max_lookahead_samples: usize,
    sample_rate: f32,
    bypassed: bool,
    // Metering
    meter_gr_db: f32,
    meter_output_peak: f32,
}

impl LookaheadLimiter {
    pub fn new(sr: f32) -> Self {
        let lookahead_samples = lookahead_samples_for(DEFAULT_LOOKAHEAD_MS, sr);
        // Room for the longest look-ahead the control can select, taken once
        // here so `set_param` never allocates on the render thread.
        let max_lookahead_samples = lookahead_samples_for(MAX_LOOKAHEAD_MS, sr);
        let release_ms = 100.0;
        let mut delay_l = VecDeque::with_capacity(max_lookahead_samples.saturating_add(1));
        let mut delay_r = VecDeque::with_capacity(max_lookahead_samples.saturating_add(1));
        delay_l.resize(lookahead_samples, 0.0);
        delay_r.resize(lookahead_samples, 0.0);
        let mut max_peaks = MonotonicPeakWindow::new(max_lookahead_samples);
        max_peaks.rebuild_from_delays(&delay_l, &delay_r);

        Self {
            delay_l,
            delay_r,
            max_peaks,
            true_peak_l: TruePeakUpsampler::new(),
            true_peak_r: TruePeakUpsampler::new(),
            ceiling: 10.0_f32.powf(-1.0 / 20.0), // -1.0 dBTP default
            ceiling_db: -1.0,
            release_coeff: release_coeff(release_ms, sr),
            release_coeff_fast: release_coeff(fast_release_ms(release_ms), sr),
            gain_avg: 1.0,
            gain_avg_coeff: release_coeff(GAIN_AVERAGE_MS, sr),
            current_gain: 1.0,
            lookahead_samples,
            max_lookahead_samples,
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
                self.release_coeff = release_coeff(ms, self.sample_rate);
                self.release_coeff_fast = release_coeff(fast_release_ms(ms), self.sample_rate);
            }
            "lim_lookahead" => {
                // Live control: this runs on the AudioWorklet render thread.
                // Every buffer was built at construction with room for
                // `max_lookahead_samples`, so `resize` only moves the logical
                // length inside capacity already held and `rebuild_from_delays`
                // refills a window that was never shrunk. Nothing here reaches
                // the allocator. `min` is belt and braces: the clamp above
                // already bounds `ms`, and exceeding capacity would reallocate
                // and miss the deadline.
                let ms = if value.is_nan() {
                    DEFAULT_LOOKAHEAD_MS
                } else {
                    value.clamp(MIN_LOOKAHEAD_MS, MAX_LOOKAHEAD_MS)
                };
                let new_size =
                    lookahead_samples_for(ms, self.sample_rate).min(self.max_lookahead_samples);
                if new_size != self.lookahead_samples {
                    self.delay_l.resize(new_size, 0.0);
                    self.delay_r.resize(new_size, 0.0);
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

            // Smooth: instant attack (look-ahead handles it), program-
            // dependent release.
            //
            // `gain_avg` trails the applied gain by GAIN_AVERAGE_MS. Right
            // after an isolated transient the applied gain sits far below it,
            // so `transient` is large and the release blends toward the fast
            // branch — the sustained material underneath, which was never over
            // the ceiling, gets its level back instead of being held down.
            // Under sustained limiting the average descends to meet the
            // applied gain, `transient` collapses to ~0, and the release is
            // the nominal one, so the envelope is not tracked into distortion.
            //
            // This cannot breach the ceiling: the attack branch is still
            // instant, and the release branch is a convex combination of
            // `current_gain` and `required_gain`, so it can never exceed the
            // gain the look-ahead window already sanctioned.
            let transient = if self.gain_avg > 1e-6 {
                let gap = ((self.gain_avg - self.current_gain) / self.gain_avg).clamp(0.0, 1.0);
                ((gap - TRANSIENT_DEADBAND) / (1.0 - TRANSIENT_DEADBAND))
                    .clamp(0.0, 1.0)
                    .sqrt()
            } else {
                0.0
            };
            let release =
                self.release_coeff + (self.release_coeff_fast - self.release_coeff) * transient;
            self.current_gain = if required_gain < self.current_gain {
                required_gain
            } else {
                release * self.current_gain + (1.0 - release) * required_gain
            };
            self.gain_avg = self.gain_avg_coeff * self.gain_avg
                + (1.0 - self.gain_avg_coeff) * self.current_gain;

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
    /// Collapse the program-dependent release onto the nominal one,
    /// reproducing the fixed one-pole this replaced. Test-only: it
    /// exists so the sustained-distortion comparison has a live oracle rather
    /// than baseline numbers copied out of console output. Call after
    /// `set_param`, which recomputes both coefficients.
    #[cfg(test)]
    pub(crate) fn force_fixed_release(&mut self) {
        self.release_coeff_fast = self.release_coeff;
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

    /// `lim_lookahead` sits in the live wire namespace, so this setter runs on
    /// the AudioWorklet render thread during an ordinary parameter change. It
    /// used to `resize` both delay lines, `reserve(1)` on each, grow the peak
    /// window and rebuild it — allocator work between two render quanta, which
    /// can miss the audio deadline and drop out audibly. Every buffer is now
    /// sized for `MAX_LOOKAHEAD_MS` at construction and the setter only moves
    /// logical indices.
    #[test]
    fn changing_the_lookahead_never_allocates() {
        let mut limiter = LookaheadLimiter::new(48_000.0);
        // Warm the render path so nothing lazy is left inside the guard.
        let mut left = vec![0.5_f32; 128];
        let mut right = vec![0.5_f32; 128];
        limiter.process(&mut left, &mut right);
        let capacities = (
            limiter.delay_l.capacity(),
            limiter.delay_r.capacity(),
            limiter.max_peaks.peaks.capacity(),
        );

        assert_no_alloc(|| {
            // Both directions and both ends of the declared range: growing is
            // what used to reallocate, shrinking is what has to keep working
            // afterwards, and interleaved render blocks are how the control
            // actually arrives.
            for ms in [10.0_f32, 0.5, 7.5, 5.0, 10.0, 0.5] {
                limiter.set_param("lim_lookahead", ms);
                limiter.process(&mut left, &mut right);
            }
        });

        assert_eq!(
            (
                limiter.delay_l.capacity(),
                limiter.delay_r.capacity(),
                limiter.max_peaks.peaks.capacity(),
            ),
            capacities,
            "capacity moved, so the preallocation is not covering the range"
        );
        assert_eq!(
            limiter.latency_samples(),
            24,
            "the 0.5 ms look-ahead must still take effect — a setter that \
             quietly stopped resizing would also allocate nothing"
        );
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

#[cfg(test)]
mod program_dependent_release_tests {
    //! A single fixed one-pole release cannot serve both jobs a
    //! brickwall limiter has. Recover slowly after a brief transient and the
    //! sustained material underneath — which was never over the ceiling — stays
    //! ducked, which is the pumping the finding names. Recover quickly under
    //! sustained limiting and the gain rides the waveform instead of its
    //! envelope, folding harmonics back in.
    //!
    //! Measured on a −10.46 dB / 200 Hz tone with 2 ms transients 20 dB above
    //! it, at the shipped 100 ms release and a −1 dBTP ceiling:
    //!
    //! | transient spacing | metric                        | fixed one-pole | program-dependent |
    //! |-------------------|-------------------------------|----------------|-------------------|
    //! | 400 ms            | recovery to within 1 dB       | 185 ms         | **68 ms**         |
    //! | 400 ms            | duck depth just after         | −20.43 dB      | **−16.10 dB**     |
    //! | 150 ms            | level reached before next hit | −12.58 dB      | **−11.68 dB**     |
    //! | 150 ms            | recovery to within 1 dB       | never          | 113 ms            |
    //!
    //! And the counter-check that keeps it honest: across all 15 (frequency,
    //! release) combinations — 30/40/60 Hz against 10/30/100/300/500 ms — THD on
    //! material held 6 dB over the ceiling is **bit-identical to the fixed
    //! release in 14 of 15, and differs by 0.000979 dB in the fifteenth**
    //! (30 Hz at a 10 ms release). The fast branch is gated behind a deadband
    //! that sustained gain ripple essentially never clears; at the shortest
    //! release and the lowest frequency the ripple is deepest and a sliver gets
    //! through, three orders of magnitude below audibility.
    //!
    //! An earlier version of this note claimed bit-identity across all 15. That
    //! was read off two-decimal console output, which cannot resolve 0.000979 dB,
    //! and the committed test covered only 3 of the 15 at a one-sided 0.1 dB
    //! bound. Both are fixed: the test below sweeps all 15 and compares against
    //! a live fixed-release limiter rather than recorded numbers.
    //!
    //! Output peak stays at −1.02 dB throughout — the ceiling is a
    //! structural guarantee here, not a tuning outcome, since the attack is
    //! still instant and the release branch is a convex combination bounded by
    //! the gain the look-ahead window already sanctioned.

    use super::LookaheadLimiter;
    use core::f64::consts::PI;

    const SR: f64 = 48_000.0;
    const TONE_HZ: f64 = 200.0;
    const TONE_AMP: f64 = 0.30;
    const BURST_AMP: f64 = 3.0;
    const BURST_LEN: usize = 96; // 2 ms
    /// Default ceiling, −1.0 dBTP.
    const CEILING: f32 = 0.891_250_9;

    fn unducked_tone_db() -> f64 {
        20.0 * TONE_AMP.log10()
    }

    /// Steady tone that never approaches the ceiling on its own, plus periodic
    /// short transients that do. Every dB the tone loses is the limiter holding
    /// down material because of a transient that has already passed.
    fn program(len: usize, period: usize) -> Vec<f32> {
        (0..len)
            .map(|n| {
                let tone = TONE_AMP * (2.0 * PI * TONE_HZ * n as f64 / SR).sin();
                let burst = if n > period && n % period < BURST_LEN {
                    BURST_AMP * (2.0 * PI * 1_100.0 * n as f64 / SR).sin()
                } else {
                    0.0
                };
                (tone + burst) as f32
            })
            .collect()
    }

    fn render(input: &[f32], release_ms: f32) -> Vec<f32> {
        render_with(input, release_ms, false)
    }

    fn render_with(input: &[f32], release_ms: f32, fixed_release: bool) -> Vec<f32> {
        let mut lim = LookaheadLimiter::new(SR as f32);
        lim.set_param("lim_release", release_ms);
        if fixed_release {
            lim.force_fixed_release();
        }
        let mut out = Vec::with_capacity(input.len());
        let mut i = 0;
        while i + 128 <= input.len() {
            let mut l: Vec<f32> = input[i..i + 128].to_vec();
            let mut r = l.clone();
            lim.process(&mut l, &mut r);
            out.extend_from_slice(&l);
            i += 128;
        }
        out
    }

    /// Tone level in dB against time since the last transient, averaged over
    /// every transient in the steady-state region. Frames are taken only after
    /// the burst and the look-ahead window have both cleared, so this measures
    /// the sustained material's recovery and never the transient itself.
    fn recovery_curve(out: &[f32], period: usize) -> Vec<f64> {
        let frame = (SR / 1000.0) as usize; // 1 ms
        let skip = BURST_LEN + (0.011 * SR) as usize;
        let usable = (period - skip) / frame;
        let mut sums = vec![0.0f64; usable];
        let mut counts = vec![0usize; usable];
        for p in (out.len() / period) / 3..out.len() / period {
            for (f, (sum, count)) in sums.iter_mut().zip(counts.iter_mut()).enumerate() {
                let a = p * period + skip + f * frame;
                if a + frame > out.len() {
                    break;
                }
                let peak = out[a..a + frame]
                    .iter()
                    .fold(0.0f32, |m, &s| m.max(s.abs()));
                if peak > 0.0 {
                    *sum += 20.0 * (peak as f64).log10();
                    *count += 1;
                }
            }
        }
        sums.iter()
            .zip(counts.iter())
            .filter(|(_, &c)| c > 0)
            .map(|(s, &c)| s / c as f64)
            .collect()
    }

    fn curve_for(release_ms: f32, period_ms: f64) -> Vec<f64> {
        let period = (period_ms * 0.001 * SR) as usize;
        let out = render(&program(48_000 * 6, period), release_ms);
        recovery_curve(&out, period)
    }

    /// The shipped default release.
    const NOMINAL_MS: f32 = 100.0;

    #[test]
    fn isolated_transients_recover_faster_than_the_nominal_release() {
        let curve = curve_for(NOMINAL_MS, 400.0);
        let target = unducked_tone_db() - 1.0;
        let recovery_ms = curve
            .iter()
            .position(|&d| d > target)
            .expect("sustained material never recovered to within 1 dB of its own level");
        assert!(
            (recovery_ms as f32) < NOMINAL_MS,
            "sustained material took {recovery_ms} ms to recover after an isolated transient, \
             which is no better than the {NOMINAL_MS} ms nominal release; the fixed one-pole \
             measured 185 ms and the program-dependent release measured 68 ms"
        );
    }

    #[test]
    fn isolated_transients_duck_sustained_material_less_deeply() {
        let curve = curve_for(NOMINAL_MS, 400.0);
        let deepest = curve[0];
        assert!(
            deepest > -18.0,
            "sustained material was ducked to {deepest:.2} dB right after a transient; the \
             fixed one-pole measured −20.43 dB and the program-dependent release −16.10 dB"
        );
    }

    #[test]
    fn dense_transients_leave_sustained_material_closer_to_its_own_level() {
        // 150 ms spacing is dense enough that the fixed release never let the
        // tone back up at all before the next hit — the finding's "dense
        // transient material" case.
        let curve = curve_for(NOMINAL_MS, 150.0);
        let before_next = *curve.last().unwrap();
        assert!(
            before_next > -12.0,
            "with transients every 150 ms the tone only reached {before_next:.2} dB before the \
             next one; the fixed one-pole measured −12.58 dB and the program-dependent \
             release −11.68 dB"
        );
    }

    /// THD of a tone held continuously above the ceiling, relative to the
    /// fundamental. Low frequencies are the case that matters: the look-ahead
    /// window spans a fraction of a period, so the window maximum dips between
    /// peaks and the release genuinely runs.
    fn sustained_thd_db(release_ms: f32, tone_hz: f64, fixed_release: bool) -> f64 {
        let len = 48_000 * 8;
        let input: Vec<f32> = (0..len)
            .map(|n| (2.0 * (2.0 * PI * tone_hz * n as f64 / SR).sin()) as f32)
            .collect();
        let out = render_with(&input, release_ms, fixed_release);
        let start = out.len() / 2;
        let n = (40.0 * SR / tone_hz) as usize;
        let seg = &out[start..start + n];
        let mag = |hz: f64| {
            let (mut re, mut im) = (0.0f64, 0.0f64);
            for (k, &s) in seg.iter().enumerate() {
                let w = 2.0 * PI * hz * k as f64 / SR;
                re += f64::from(s) * w.cos();
                im -= f64::from(s) * w.sin();
            }
            (re * re + im * im).sqrt() * 2.0 / seg.len() as f64
        };
        let fundamental = mag(tone_hz);
        let harmonics: f64 = (2..=12)
            .map(|h| mag(tone_hz * h as f64).powi(2))
            .sum::<f64>()
            .sqrt();
        20.0 * (harmonics / fundamental).log10()
    }

    /// Worst measured excess of the program-dependent release over the fixed
    /// one across the whole sweep: 0.000979 dB, at 30 Hz with a 10 ms release.
    /// The bound sits just above it so any real engagement of the fast branch
    /// on sustained material trips this, while the known sliver does not.
    const SUSTAINED_THD_TOLERANCE_DB: f64 = 0.002;

    #[test]
    fn sustained_limiting_keeps_the_nominal_release() {
        // The counter-check. A faster release under sustained limiting tracks
        // the waveform rather than its envelope and raises distortion, so the
        // pumping win is only real if these do not move.
        //
        // The oracle is a live limiter with the fast branch collapsed onto the
        // nominal release, not a recorded baseline — so this re-derives the
        // comparison on every run instead of trusting numbers that were once
        // printed to two decimals.
        let mut worst = 0.0_f64;
        let mut worst_case = (0.0_f64, 0.0_f32);
        let mut identical = 0;
        let mut total = 0;

        for tone_hz in [30.0_f64, 40.0, 60.0] {
            for release_ms in [10.0_f32, 30.0, 100.0, 300.0, 500.0] {
                total += 1;
                let program_dependent = sustained_thd_db(release_ms, tone_hz, false);
                let fixed = sustained_thd_db(release_ms, tone_hz, true);
                if program_dependent.to_bits() == fixed.to_bits() {
                    identical += 1;
                }
                let excess = program_dependent - fixed;
                if excess.abs() > worst.abs() {
                    worst = excess;
                    worst_case = (tone_hz, release_ms);
                }
                assert!(
                    excess <= SUSTAINED_THD_TOLERANCE_DB,
                    "sustained THD at {tone_hz} Hz / {release_ms} ms release is \
                     {program_dependent:.6} dB against {fixed:.6} dB for the fixed release, \
                     an excess of {excess:.6} dB — the fast branch is engaging on sustained \
                     material"
                );
            }
        }

        // Pin the shape of the result, not just its bound: if the number of
        // bit-identical combinations moves in either direction, the deadband's
        // behaviour has changed and the claim in the module docs is stale.
        assert_eq!(
            (identical, total),
            (14, 15),
            "expected 14 of 15 combinations bit-identical to the fixed release; \
             worst excess {worst:.6} dB at {:.0} Hz / {:.0} ms",
            worst_case.0,
            worst_case.1
        );
    }

    #[test]
    fn the_faster_release_never_breaches_the_ceiling() {
        // Structural, but worth pinning: the release only ever moves the gain
        // toward a value the look-ahead window already sanctioned, so no
        // release law can overshoot. Checked across both programs and the full
        // parameter range rather than at the default alone.
        for release_ms in [10.0f32, 30.0, 100.0, 300.0, 500.0] {
            for period_ms in [150.0f64, 400.0] {
                let period = (period_ms * 0.001 * SR) as usize;
                let out = render(&program(48_000 * 3, period), release_ms);
                let peak = out[out.len() / 3..]
                    .iter()
                    .fold(0.0f32, |m, &s| m.max(s.abs()));
                assert!(
                    peak <= CEILING,
                    "release {release_ms} ms with transients every {period_ms} ms let the \
                     output reach {peak:.6} against a ceiling of {CEILING:.6}"
                );
            }
        }
    }
}
