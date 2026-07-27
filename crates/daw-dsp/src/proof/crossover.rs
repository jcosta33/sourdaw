//! LR-4 crossover filter — 4th-order Linkwitz-Riley.
//! Two cascaded Butterworth biquads per output. LP + HP sum to flat allpass.

use super::biquad::{BiquadCoeffs, BiquadState, SmoothedBiquadCoeffs};

const BUTTERWORTH_Q: f64 = std::f64::consts::FRAC_1_SQRT_2;

/// Single LR-4 crossover point — splits into low and high bands.
pub struct Lr4Crossover {
    lp1_l: BiquadState,
    lp2_l: BiquadState,
    hp1_l: BiquadState,
    hp2_l: BiquadState,
    lp1_r: BiquadState,
    lp2_r: BiquadState,
    hp1_r: BiquadState,
    hp2_r: BiquadState,
    /// DSP-4: crossover frequencies are automatable (`dyn_xoverN` on the
    /// multiband dynamics, `img_xoverN` / `img_mono_bass_freq` on the imager),
    /// so these ramp rather than swapping under the running filters.
    lp_coeffs: SmoothedBiquadCoeffs,
    hp_coeffs: SmoothedBiquadCoeffs,
}

impl Lr4Crossover {
    pub fn new(freq: f64, sr: f64) -> Self {
        Self {
            lp1_l: BiquadState::new(),
            lp2_l: BiquadState::new(),
            hp1_l: BiquadState::new(),
            hp2_l: BiquadState::new(),
            lp1_r: BiquadState::new(),
            lp2_r: BiquadState::new(),
            hp1_r: BiquadState::new(),
            hp2_r: BiquadState::new(),
            lp_coeffs: SmoothedBiquadCoeffs::new(
                BiquadCoeffs::lowpass(freq, BUTTERWORTH_Q, sr),
                sr,
            ),
            hp_coeffs: SmoothedBiquadCoeffs::new(
                BiquadCoeffs::highpass(freq, BUTTERWORTH_Q, sr),
                sr,
            ),
        }
    }

    pub fn set_freq(&mut self, freq: f64, sr: f64) {
        self.lp_coeffs
            .set_target(BiquadCoeffs::lowpass(freq, BUTTERWORTH_Q, sr));
        self.hp_coeffs
            .set_target(BiquadCoeffs::highpass(freq, BUTTERWORTH_Q, sr));
    }

    /// Process stereo sample, returns ((low_l, low_r), (high_l, high_r)).
    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> ((f32, f32), (f32, f32)) {
        // One ramp step per sample, shared by both channels and both cascaded
        // sections so the LR-4 pair stays matched.
        let lp = self.lp_coeffs.next();
        let hp = self.hp_coeffs.next();

        let low_l = self.lp2_l.process(self.lp1_l.process(l, &lp), &lp);
        let low_r = self.lp2_r.process(self.lp1_r.process(r, &lp), &lp);
        let high_l = self.hp2_l.process(self.hp1_l.process(l, &hp), &hp);
        let high_r = self.hp2_r.process(self.hp1_r.process(r, &hp), &hp);
        ((low_l, low_r), (high_l, high_r))
    }
}

/// 4-band splitter using 3 cascaded LR-4 crossovers.
/// Crossover frequencies: f1 < f2 < f3.
pub struct FourBandSplitter {
    xover1: Lr4Crossover,
    xover2: Lr4Crossover,
    xover3: Lr4Crossover,
    ap_low_2: Lr4Crossover,
    ap_low_3: Lr4Crossover,
    ap_low_mid_3: Lr4Crossover,
}

impl FourBandSplitter {
    pub fn new(f1: f64, f2: f64, f3: f64, sr: f64) -> Self {
        Self {
            xover1: Lr4Crossover::new(f1, sr),
            xover2: Lr4Crossover::new(f2, sr),
            xover3: Lr4Crossover::new(f3, sr),
            ap_low_2: Lr4Crossover::new(f2, sr),
            ap_low_3: Lr4Crossover::new(f3, sr),
            ap_low_mid_3: Lr4Crossover::new(f3, sr),
        }
    }

    pub fn set_freqs(&mut self, f1: f64, f2: f64, f3: f64, sr: f64) {
        self.xover1.set_freq(f1, sr);
        self.xover2.set_freq(f2, sr);
        self.xover3.set_freq(f3, sr);
        self.ap_low_2.set_freq(f2, sr);
        self.ap_low_3.set_freq(f3, sr);
        self.ap_low_mid_3.set_freq(f3, sr);
    }

    /// Returns 4 bands: (low_l, low_r), (low_mid_l, low_mid_r), (high_mid_l, high_mid_r), (high_l, high_r)
    #[inline]
    pub fn process(&mut self, l: f32, r: f32) -> [(f32, f32); 4] {
        let (low_raw, high_a) = self.xover1.process(l, r);
        let (low_mid_raw, high_b) = self.xover2.process(high_a.0, high_a.1);
        let (high_mid, high) = self.xover3.process(high_b.0, high_b.1);

        // Apply allpass compensation to maintain phase alignment across all bands
        let (lp_ap2, hp_ap2) = self.ap_low_2.process(low_raw.0, low_raw.1);
        let low_after_2 = (lp_ap2.0 + hp_ap2.0, lp_ap2.1 + hp_ap2.1);

        let (lp_ap3, hp_ap3) = self.ap_low_3.process(low_after_2.0, low_after_2.1);
        let low = (lp_ap3.0 + hp_ap3.0, lp_ap3.1 + hp_ap3.1);

        let (lm_ap3_lp, lm_ap3_hp) = self.ap_low_mid_3.process(low_mid_raw.0, low_mid_raw.1);
        let low_mid = (lm_ap3_lp.0 + lm_ap3_hp.0, lm_ap3_lp.1 + lm_ap3_hp.1);

        [low, low_mid, high_mid, high]
    }
}

#[cfg(test)]
mod tests {
    use super::{BiquadCoeffs, FourBandSplitter, Lr4Crossover, BUTTERWORTH_Q};
    use std::f64::consts::{PI, TAU};

    const SAMPLE_RATES: [f64; 3] = [44_100.0, 48_000.0, 96_000.0];
    const SOURCE_MAGNITUDE_TOLERANCE_DB: f64 = 0.5;
    /// The full f64-reference/f32-transport corpus measures at most 1.692e-7
    /// complex error. 1e-5 leaves 59x platform headroom while corresponding to
    /// roughly 0.000087 dB near unity, over 5,700x tighter than the source floor.
    const REFERENCE_COMPLEX_TOLERANCE: f64 = 1.0e-5;
    const STEREO_TRANSPORT_TOLERANCE: f32 = f32::EPSILON * 8.0;
    const IMPULSE_TAIL_CYCLES: f64 = 16.0;
    const MIN_IMPULSE_SAMPLES: usize = 8_192;
    const RESPONSE_GRID_STEPS: usize = 24;
    const GROUP_DELAY_GRID_STEPS: usize = 384;
    const GENERATED_TRIPLE_COUNT: usize = 5;

    /// Fixed cases cover the product default, low/mid/high representatives,
    /// near-adjacent lower/upper boundaries, and the full control-domain span.
    const FIXED_TRIPLES: [[f64; 3]; 7] = [
        [120.0, 1_000.0, 8_000.0],
        [20.0, 80.0, 320.0],
        [200.0, 1_200.0, 6_000.0],
        [2_000.0, 10_000.0, 20_000.0],
        [20.0, 21.0, 22.0],
        [19_998.0, 19_999.0, 20_000.0],
        [20.0, 1_000.0, 20_000.0],
    ];

    #[derive(Clone, Copy, Debug)]
    struct Complex {
        re: f64,
        im: f64,
    }

    impl Complex {
        const ZERO: Self = Self { re: 0.0, im: 0.0 };
        const ONE: Self = Self { re: 1.0, im: 0.0 };

        fn add(self, other: Self) -> Self {
            Self {
                re: self.re + other.re,
                im: self.im + other.im,
            }
        }

        fn subtract(self, other: Self) -> Self {
            Self {
                re: self.re - other.re,
                im: self.im - other.im,
            }
        }

        fn multiply(self, other: Self) -> Self {
            Self {
                re: self.re * other.re - self.im * other.im,
                im: self.re * other.im + self.im * other.re,
            }
        }

        fn divide(self, other: Self) -> Self {
            let denominator = other.re * other.re + other.im * other.im;
            Self {
                re: (self.re * other.re + self.im * other.im) / denominator,
                im: (self.im * other.re - self.re * other.im) / denominator,
            }
        }

        fn scale(self, scalar: f64) -> Self {
            Self {
                re: self.re * scalar,
                im: self.im * scalar,
            }
        }

        fn magnitude(self) -> f64 {
            self.re.hypot(self.im)
        }

        fn phase(self) -> f64 {
            self.im.atan2(self.re)
        }

        fn distance(self, other: Self) -> f64 {
            self.subtract(other).magnitude()
        }
    }

    fn logarithmic_frequency(position: usize, steps: usize) -> f64 {
        let progress = position as f64 / steps as f64;
        20.0 * 1_000.0_f64.powf(progress)
    }

    /// Generated case `i` uses logarithmic grid positions
    /// `[1 + 2i, 8 + 2i, 15 + 2i] / 24` across 20–20,000 Hz.
    fn generated_triple(index: usize) -> [f64; 3] {
        [
            logarithmic_frequency(1 + index * 2, 24),
            logarithmic_frequency(8 + index * 2, 24),
            logarithmic_frequency(15 + index * 2, 24),
        ]
    }

    fn crossover_corpus() -> Vec<[f64; 3]> {
        let mut corpus = FIXED_TRIPLES.to_vec();
        for index in 0..GENERATED_TRIPLE_COUNT {
            corpus.push(generated_triple(index));
        }
        corpus
    }

    fn response_frequencies(triple: [f64; 3], steps: usize) -> Vec<f64> {
        let mut frequencies = Vec::with_capacity(steps + 4);
        for position in 0..=steps {
            frequencies.push(logarithmic_frequency(position, steps));
        }
        frequencies.extend(triple);
        frequencies.sort_by(|left, right| left.total_cmp(right));
        frequencies.dedup_by(|left, right| (*left - *right).abs() < 1.0e-9);
        frequencies
    }

    /// Integrating at least 16 cycles of the slowest crossover leaves its
    /// Butterworth pole envelope far below f32 transport precision. The 8,192
    /// sample floor gives high-frequency cases an equally deterministic tail.
    fn impulse_sample_count(triple: [f64; 3], sample_rate: f64) -> usize {
        let slowest_crossover = triple[0].min(triple[1]).min(triple[2]);
        let tail_samples = (IMPULSE_TAIL_CYCLES * sample_rate / slowest_crossover).ceil() as usize;
        tail_samples.max(MIN_IMPULSE_SAMPLES)
    }

    fn render_impulse(
        triple: [f64; 3],
        sample_rate: f64,
        left_impulse: f32,
        right_impulse: f32,
    ) -> Vec<[(f32, f32); 4]> {
        let sample_count = impulse_sample_count(triple, sample_rate);
        let mut splitter = FourBandSplitter::new(triple[0], triple[1], triple[2], sample_rate);
        let mut rendered = Vec::with_capacity(sample_count);

        for sample_index in 0..sample_count {
            let left = if sample_index == 0 { left_impulse } else { 0.0 };
            let right = if sample_index == 0 {
                right_impulse
            } else {
                0.0
            };
            rendered.push(splitter.process(left, right));
        }

        rendered
    }

    fn measure_band_responses(
        rendered: &[[(f32, f32); 4]],
        frequency: f64,
        sample_rate: f64,
        right_channel: bool,
    ) -> [Complex; 4] {
        let phase_step = -TAU * frequency / sample_rate;
        let rotation = Complex {
            re: phase_step.cos(),
            im: phase_step.sin(),
        };
        let mut phase = Complex::ONE;
        let mut responses = [Complex::ZERO; 4];

        for sample in rendered {
            for band_index in 0..4 {
                let value = if right_channel {
                    sample[band_index].1
                } else {
                    sample[band_index].0
                };
                responses[band_index] = responses[band_index].add(phase.scale(f64::from(value)));
            }
            phase = phase.multiply(rotation);
        }

        responses
    }

    fn sum_responses(responses: [Complex; 4]) -> Complex {
        responses.into_iter().fold(Complex::ZERO, Complex::add)
    }

    fn biquad_response(coefficients: BiquadCoeffs, frequency: f64, sample_rate: f64) -> Complex {
        let omega = TAU * frequency / sample_rate;
        let z1 = Complex {
            re: omega.cos(),
            im: -omega.sin(),
        };
        let z2 = z1.multiply(z1);
        let numerator = Complex::ONE
            .scale(coefficients.b0)
            .add(z1.scale(coefficients.b1))
            .add(z2.scale(coefficients.b2));
        let denominator = Complex::ONE
            .add(z1.scale(coefficients.a1))
            .add(z2.scale(coefficients.a2));
        numerator.divide(denominator)
    }

    fn lr4_responses(
        crossover_frequency: f64,
        frequency: f64,
        sample_rate: f64,
    ) -> (Complex, Complex) {
        let lowpass = BiquadCoeffs::lowpass(crossover_frequency, BUTTERWORTH_Q, sample_rate);
        let highpass = BiquadCoeffs::highpass(crossover_frequency, BUTTERWORTH_Q, sample_rate);
        let lowpass_response = biquad_response(lowpass, frequency, sample_rate);
        let highpass_response = biquad_response(highpass, frequency, sample_rate);
        (
            lowpass_response.multiply(lowpass_response),
            highpass_response.multiply(highpass_response),
        )
    }

    fn reference_band_responses(
        triple: [f64; 3],
        frequency: f64,
        sample_rate: f64,
    ) -> [Complex; 4] {
        let (low_1, high_1) = lr4_responses(triple[0], frequency, sample_rate);
        let (low_2, high_2) = lr4_responses(triple[1], frequency, sample_rate);
        let (low_3, high_3) = lr4_responses(triple[2], frequency, sample_rate);
        let allpass_2 = low_2.add(high_2);
        let allpass_3 = low_3.add(high_3);

        [
            low_1.multiply(allpass_2).multiply(allpass_3),
            high_1.multiply(low_2).multiply(allpass_3),
            high_1.multiply(high_2).multiply(low_3),
            high_1.multiply(high_2).multiply(high_3),
        ]
    }

    /// This reference is built directly as three serial LR4 allpass responses,
    /// independently of the production four-band summing expression.
    fn reference_allpass_cascade(triple: [f64; 3], frequency: f64, sample_rate: f64) -> Complex {
        let mut response = Complex::ONE;
        for crossover_frequency in triple {
            let (lowpass, highpass) = lr4_responses(crossover_frequency, frequency, sample_rate);
            response = response.multiply(lowpass.add(highpass));
        }
        response
    }

    fn wrapped_phase_delta(from: f64, to: f64) -> f64 {
        let mut delta = to - from;
        while delta > PI {
            delta -= TAU;
        }
        while delta < -PI {
            delta += TAU;
        }
        delta
    }

    fn unwrap_phases(responses: &[Complex]) -> Vec<f64> {
        let mut phases = Vec::with_capacity(responses.len());
        if responses.is_empty() {
            return phases;
        }

        let mut previous_raw = responses[0].phase();
        let mut unwrapped = previous_raw;
        phases.push(unwrapped);
        for response in &responses[1..] {
            let raw = response.phase();
            unwrapped += wrapped_phase_delta(previous_raw, raw);
            phases.push(unwrapped);
            previous_raw = raw;
        }
        phases
    }

    fn local_group_delay(
        rendered: &[[(f32, f32); 4]],
        crossover_frequency: f64,
        sample_rate: f64,
    ) -> f64 {
        let offset = (crossover_frequency * 0.001).max(0.05);
        let lower = (crossover_frequency - offset).max(20.0);
        let upper = (crossover_frequency + offset).min(20_000.0);
        let lower_response =
            sum_responses(measure_band_responses(rendered, lower, sample_rate, false));
        let upper_response =
            sum_responses(measure_band_responses(rendered, upper, sample_rate, false));
        let phase_delta = wrapped_phase_delta(lower_response.phase(), upper_response.phase());
        let omega_delta = TAU * (upper - lower) / sample_rate;
        -phase_delta / omega_delta
    }

    #[test]
    fn four_band_sum_stays_within_source_magnitude_tolerance() {
        let mut worst_error_db = 0.0_f64;

        for (case_index, triple) in crossover_corpus().into_iter().enumerate() {
            for sample_rate in SAMPLE_RATES {
                let rendered = render_impulse(triple, sample_rate, 1.0, 0.0);
                for frequency in response_frequencies(triple, RESPONSE_GRID_STEPS) {
                    if frequency >= sample_rate * 0.5 {
                        continue;
                    }
                    let response = sum_responses(measure_band_responses(
                        &rendered,
                        frequency,
                        sample_rate,
                        false,
                    ));
                    let error_db = 20.0 * response.magnitude().log10();
                    worst_error_db = worst_error_db.max(error_db.abs());
                    assert!(
                        error_db.abs() <= SOURCE_MAGNITUDE_TOLERANCE_DB,
                        "case={case_index} triple={triple:?} sr={sample_rate}Hz \
                         probe={frequency:.6}Hz magnitude_error={error_db:.9}dB"
                    );
                }
            }
        }

        eprintln!("maximum four-band magnitude error: {worst_error_db:.9} dB");
    }

    #[test]
    fn complex_sum_matches_independent_allpass_reference() {
        let mut worst_sum_error = 0.0_f64;
        let mut worst_band_error = 0.0_f64;
        let mut smallest_group_delay = f64::INFINITY;
        let mut largest_group_delay = 0.0_f64;

        for (case_index, triple) in crossover_corpus().into_iter().enumerate() {
            for sample_rate in SAMPLE_RATES {
                let rendered = render_impulse(triple, sample_rate, 1.0, 0.0);
                let frequencies = response_frequencies(triple, GROUP_DELAY_GRID_STEPS);
                let mut production_sums = Vec::with_capacity(frequencies.len());

                for &frequency in &frequencies {
                    if frequency >= sample_rate * 0.5 {
                        continue;
                    }
                    let production_bands =
                        measure_band_responses(&rendered, frequency, sample_rate, false);
                    let expected_bands = reference_band_responses(triple, frequency, sample_rate);
                    for band_index in 0..4 {
                        let error =
                            production_bands[band_index].distance(expected_bands[band_index]);
                        worst_band_error = worst_band_error.max(error);
                        assert!(
                            error <= REFERENCE_COMPLEX_TOLERANCE,
                            "case={case_index} triple={triple:?} sr={sample_rate}Hz \
                             probe={frequency:.6}Hz band={band_index} \
                             complex_error={error:.9e}"
                        );
                    }

                    let production_sum = sum_responses(production_bands);
                    let expected_sum = reference_allpass_cascade(triple, frequency, sample_rate);
                    let error = production_sum.distance(expected_sum);
                    worst_sum_error = worst_sum_error.max(error);
                    assert!(
                        error <= REFERENCE_COMPLEX_TOLERANCE,
                        "case={case_index} triple={triple:?} sr={sample_rate}Hz \
                         probe={frequency:.6}Hz sum_complex_error={error:.9e}"
                    );
                    let reference_magnitude_error = (expected_sum.magnitude() - 1.0).abs();
                    assert!(
                        reference_magnitude_error <= 1.0e-9,
                        "case={case_index} triple={triple:?} sr={sample_rate}Hz \
                         probe={frequency:.6}Hz independent allpass magnitude \
                         error={reference_magnitude_error:.9e}"
                    );
                    production_sums.push(production_sum);
                }

                let phases = unwrap_phases(&production_sums);
                for index in 1..phases.len() {
                    let omega_delta =
                        TAU * (frequencies[index] - frequencies[index - 1]) / sample_rate;
                    let group_delay = -(phases[index] - phases[index - 1]) / omega_delta;
                    smallest_group_delay = smallest_group_delay.min(group_delay);
                    largest_group_delay = largest_group_delay.max(group_delay);
                    assert!(
                        group_delay.is_finite() && group_delay >= 0.0,
                        "case={case_index} triple={triple:?} sr={sample_rate}Hz \
                         interval=({:.6},{:.6})Hz group_delay={group_delay:.9} samples",
                        frequencies[index - 1],
                        frequencies[index]
                    );
                }

                for (crossover_index, crossover_frequency) in triple.into_iter().enumerate() {
                    let group_delay =
                        local_group_delay(&rendered, crossover_frequency, sample_rate);
                    assert!(
                        group_delay.is_finite() && group_delay >= 0.0,
                        "case={case_index} triple={triple:?} sr={sample_rate}Hz \
                         crossover=f{}({crossover_frequency:.6}Hz) \
                         group_delay={group_delay:.9} samples",
                        crossover_index + 1
                    );
                    eprintln!(
                        "group delay case={case_index} sr={sample_rate:.0}Hz \
                         f{}={crossover_frequency:.6}Hz: {group_delay:.6} samples",
                        crossover_index + 1
                    );
                }
            }
        }

        eprintln!(
            "maximum complex error: sum={worst_sum_error:.9e}, \
             band={worst_band_error:.9e}; group-delay range \
             {smallest_group_delay:.6}..{largest_group_delay:.6} samples"
        );
    }

    #[test]
    fn stereo_channels_are_equal_and_isolated() {
        for (case_index, triple) in crossover_corpus().into_iter().enumerate() {
            for sample_rate in SAMPLE_RATES {
                let identical = render_impulse(triple, sample_rate, 1.0, 1.0);
                for (sample_index, bands) in identical.iter().enumerate() {
                    for (band_index, &(left, right)) in bands.iter().enumerate() {
                        assert!(left.is_finite() && right.is_finite());
                        assert!(
                            (left - right).abs() <= STEREO_TRANSPORT_TOLERANCE,
                            "case={case_index} triple={triple:?} sr={sample_rate}Hz \
                             sample={sample_index} band={band_index} \
                             left={left} right={right}"
                        );
                    }
                }

                let left_only = render_impulse(triple, sample_rate, 1.0, 0.0);
                for bands in &left_only {
                    for &(left, right) in bands {
                        assert!(left.is_finite());
                        assert_eq!(right.to_bits(), 0.0_f32.to_bits());
                    }
                }

                let right_only = render_impulse(triple, sample_rate, 0.0, 1.0);
                for bands in &right_only {
                    for &(left, right) in bands {
                        assert_eq!(left.to_bits(), 0.0_f32.to_bits());
                        assert!(right.is_finite());
                    }
                }
            }
        }
    }

    fn assert_all_smoothers_settled(splitter: &FourBandSplitter, expected: bool) {
        let crossovers = [
            &splitter.xover1,
            &splitter.xover2,
            &splitter.xover3,
            &splitter.ap_low_2,
            &splitter.ap_low_3,
            &splitter.ap_low_mid_3,
        ];
        for (index, crossover) in crossovers.into_iter().enumerate() {
            assert_eq!(
                crossover.lp_coeffs.is_settled(),
                expected,
                "lowpass smoother {index} settlement mismatch"
            );
            assert_eq!(
                crossover.hp_coeffs.is_settled(),
                expected,
                "highpass smoother {index} settlement mismatch"
            );
        }
    }

    fn assert_coefficients_exact(actual: BiquadCoeffs, expected: BiquadCoeffs) {
        assert_eq!(actual.b0.to_bits(), expected.b0.to_bits());
        assert_eq!(actual.b1.to_bits(), expected.b1.to_bits());
        assert_eq!(actual.b2.to_bits(), expected.b2.to_bits());
        assert_eq!(actual.a1.to_bits(), expected.a1.to_bits());
        assert_eq!(actual.a2.to_bits(), expected.a2.to_bits());
    }

    fn assert_exact_crossover_targets(
        splitter: &mut FourBandSplitter,
        target: [f64; 3],
        sample_rate: f64,
    ) {
        let frequencies = [
            target[0], target[1], target[2], target[1], target[2], target[2],
        ];
        let crossovers: [&mut Lr4Crossover; 6] = [
            &mut splitter.xover1,
            &mut splitter.xover2,
            &mut splitter.xover3,
            &mut splitter.ap_low_2,
            &mut splitter.ap_low_3,
            &mut splitter.ap_low_mid_3,
        ];

        for (crossover, frequency) in crossovers.into_iter().zip(frequencies) {
            let expected_lowpass = BiquadCoeffs::lowpass(frequency, BUTTERWORTH_Q, sample_rate);
            let expected_highpass = BiquadCoeffs::highpass(frequency, BUTTERWORTH_Q, sample_rate);
            assert_coefficients_exact(crossover.lp_coeffs.next(), expected_lowpass);
            assert_coefficients_exact(crossover.hp_coeffs.next(), expected_highpass);
        }
    }

    fn transition_input(sample_index: usize, sample_rate: f64) -> (f32, f32) {
        let time = sample_index as f64 / sample_rate;
        let low = (TAU * 73.0 * time).sin() * 0.25;
        let mid = (TAU * 997.0 * time).sin() * 0.25;
        let high = (TAU * 11_003.0 * time).sin() * 0.15;
        let left = (low + mid + high) as f32;
        let right = (low - mid + high) as f32;
        (left, right)
    }

    fn assert_transition_output_is_bounded(
        output: [(f32, f32); 4],
        sample_rate: f64,
        sample_index: usize,
    ) {
        for (band_index, (left, right)) in output.into_iter().enumerate() {
            assert!(
                left.is_finite() && right.is_finite(),
                "sr={sample_rate}Hz sample={sample_index} band={band_index} is non-finite"
            );
            assert!(
                left.abs() <= 4.0 && right.abs() <= 4.0,
                "sr={sample_rate}Hz sample={sample_index} band={band_index} \
                 exceeded stability bound: left={left} right={right}"
            );
        }
    }

    #[test]
    fn frequency_changes_follow_the_counted_transition() {
        let initial = [120.0, 1_000.0, 8_000.0];
        let target = [40.0, 2_400.0, 16_000.0];

        for sample_rate in SAMPLE_RATES {
            let mut splitter =
                FourBandSplitter::new(initial[0], initial[1], initial[2], sample_rate);
            for sample_index in 0..4_096 {
                let (left, right) = transition_input(sample_index, sample_rate);
                let output = splitter.process(left, right);
                assert_transition_output_is_bounded(output, sample_rate, sample_index);
            }

            assert_all_smoothers_settled(&splitter, true);
            splitter.set_freqs(target[0], target[1], target[2], sample_rate);
            assert_all_smoothers_settled(&splitter, false);

            let ramp_samples = (0.005 * sample_rate).round() as usize;
            for ramp_index in 0..ramp_samples - 1 {
                let sample_index = 4_096 + ramp_index;
                let (left, right) = transition_input(sample_index, sample_rate);
                let output = splitter.process(left, right);
                assert_transition_output_is_bounded(output, sample_rate, sample_index);
            }
            assert_all_smoothers_settled(&splitter, false);

            let settlement_index = 4_096 + ramp_samples - 1;
            let (left, right) = transition_input(settlement_index, sample_rate);
            let output = splitter.process(left, right);
            assert_transition_output_is_bounded(output, sample_rate, settlement_index);
            assert_all_smoothers_settled(&splitter, true);
            assert_exact_crossover_targets(&mut splitter, target, sample_rate);

            for tail_index in 0..4_096 {
                let sample_index = 4_096 + ramp_samples + tail_index;
                let (left, right) = transition_input(sample_index, sample_rate);
                let output = splitter.process(left, right);
                assert_transition_output_is_bounded(output, sample_rate, sample_index);
            }
        }
    }
}
