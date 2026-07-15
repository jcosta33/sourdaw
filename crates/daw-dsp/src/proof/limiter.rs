//! Look-ahead brickwall limiter with true peak detection.

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
            self.peaks
                .reserve(required_capacity - self.peaks.capacity());
        }
    }

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

            // Record peak for lookahead
            let peak = left[i].abs().max(right[i].abs());
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
    use super::LookaheadLimiter;
    use std::collections::VecDeque;

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

        for i in 0..output_left.len() {
            delay_l.push_back(output_left[i]);
            delay_r.push_back(output_right[i]);

            let peak = output_left[i].abs().max(output_right[i].abs());
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
    fn process_does_not_grow_preallocated_buffers() {
        let mut limiter = LookaheadLimiter::new(48_000.0);
        limiter.set_param("lim_lookahead", 10.0);
        let initial_capacities = (
            limiter.delay_l.capacity(),
            limiter.delay_r.capacity(),
            limiter.max_peaks.peaks.capacity(),
        );
        let samples = limiter.latency_samples() * 3 + 1;
        let mut left = vec![0.75; samples];
        let mut right = vec![-0.65; samples];

        limiter.process(&mut left, &mut right);

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
}
