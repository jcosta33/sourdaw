//! Fixed, stylized spring: dispersive all-pass cascade inside a feedback loop.
//!
//! Parker (2011), doi:10.1155/2011/646134, equations 1–4, supplies the model.
//! Gamper/Parker/Välimäki, DAFx 2011, paper 39, Table 1 Automated* supplies
//! M=100, a=0.63, g=-0.64 and Td=56 ms. We use its measured Fc=4216 Hz,
//! rather than fitted Fc,lf=4275 Hz, and two output loss poles: this is a
//! Bacteria voicing, not a reproduction of the measured Leem tank.
//!
//! Per channel/sample: at most 404 multiplies, 405 adds, plus indexing and
//! denormal checks. State is 100*(floor(fs/(2*Fc))+1)+round(0.056*fs)+2
//! floats/channel. Construction allocates; processing and reset never do.

use crate::primitives::flush_denormal;
use std::f64::consts::{PI, TAU};

const STAGES: usize = 100;
const DISPERSION: f32 = 0.63;
const FEEDBACK: f32 = -0.64;

#[derive(Clone, Copy)]
struct Coefficients {
    stretch: usize,
    loop_length: usize,
    fractional: Option<f32>,
    loss: f32,
    gain: f32,
}

impl Coefficients {
    fn new(sample_rate: f32) -> Self {
        // Like Fermenter's constructor, invalid rates use 48 kHz. Positive
        // negotiated rates are not rejected or capped at our test rates.
        let rate = if sample_rate.is_finite() && sample_rate > 0.0 {
            f64::from(sample_rate)
        } else {
            48_000.0
        };
        // Below 8432 Hz the source's transition lies beyond Nyquist. Put it
        // at Nyquist, where the integer one-sample all-pass needs no fraction.
        let transition = 4_216.0_f64.min(rate * 0.5);
        let omega = TAU * transition / rate;
        let stretch = ((PI / omega).floor() as usize).max(1);
        let residual = (PI - stretch as f64 * omega).max(0.0);
        let fractional = if residual <= f64::EPSILON * PI {
            None
        } else {
            let ratio = (residual * 0.5).tan() / (omega * 0.5).tan();
            let coefficient = ((1.0 - ratio) / (1.0 + ratio)) as f32;
            (coefficient < 1.0).then_some(coefficient)
        };
        let pole = (-TAU * transition / rate).exp();
        // The output loss impulse is (n+1)*(1-p)^2*p^n. Its energy is
        // (1-p)*(1+p²)/(1+p)^3. All-pass loop powers are orthogonal because
        // the loop has a strict delay; sqrt(1-g²) normalizes their sum.
        // Coloring changes that sum by <1e-600 at 8..384 kHz (p^(Td*fs)),
        // below f64 precision. No measured/golden gain is fitted here.
        let loss_energy = (1.0 - pole) * (1.0 + pole * pole) / (1.0 + pole).powi(3);
        Self {
            stretch,
            loop_length: ((rate * 0.056).round() as usize).max(1),
            fractional,
            loss: (1.0 - pole) as f32,
            gain: ((48_000.0 / rate) * (1.0 - f64::from(FEEDBACK).powi(2)) / loss_energy).sqrt()
                as f32,
        }
    }

    fn dispersion_end(self) -> usize {
        STAGES * self.stretch
    }

    fn loop_start(self) -> usize {
        self.dispersion_end() + STAGES
    }

    fn loss_start(self) -> usize {
        self.loop_start() + self.loop_length
    }
}

struct Channel {
    state: Vec<f32>,
    dispersion_pos: usize,
    loop_pos: usize,
}

impl Channel {
    fn new(coefficients: Coefficients) -> Self {
        Self {
            state: vec![0.0; coefficients.loss_start() + 2],
            dispersion_pos: 0,
            loop_pos: 0,
        }
    }

    fn reset(&mut self) {
        self.state.fill(0.0);
        self.dispersion_pos = 0;
        self.loop_pos = 0;
    }

    fn disperse(&mut self, mut input: f32, coefficients: Coefficients) -> f32 {
        let fractional_start = coefficients.dispersion_end();
        for stage in 0..STAGES {
            let index = stage * coefficients.stretch + self.dispersion_pos;
            let delayed = self.state[index];
            let stretched = if let Some(b) = coefficients.fractional {
                let fractional_index = fractional_start + stage;
                let value = self.state[fractional_index] + b * delayed;
                self.state[fractional_index] = flush_denormal(delayed - b * value);
                value
            } else {
                delayed
            };
            let output = DISPERSION * input + stretched;
            self.state[index] = flush_denormal(input - DISPERSION * output);
            input = output;
        }
        self.dispersion_pos += 1;
        if self.dispersion_pos == coefficients.stretch {
            self.dispersion_pos = 0;
        }
        input
    }

    fn process(&mut self, input: f32, coefficients: Coefficients) -> f32 {
        if !input.is_finite() {
            self.reset();
            // Preserve the invalid sample for the existing output sanitizer's
            // health accounting, without poisoning the recursive memory.
            return input;
        }
        let loop_index = coefficients.loop_start() + self.loop_pos;
        let signal = self.disperse(input + FEEDBACK * self.state[loop_index], coefficients);
        self.state[loop_index] = flush_denormal(signal);
        self.loop_pos += 1;
        if self.loop_pos == coefficients.loop_length {
            self.loop_pos = 0;
        }
        let mut output = signal;
        for index in coefficients.loss_start()..coefficients.loss_start() + 2 {
            self.state[index] = flush_denormal(
                self.state[index] + coefficients.loss * (output - self.state[index]),
            );
            output = self.state[index];
        }
        output *= coefficients.gain;
        if !output.is_finite() {
            self.reset();
        }
        output
    }
}

pub(super) struct SpringBody {
    coefficients: Coefficients,
    left: Channel,
    right: Channel,
}

impl SpringBody {
    pub(super) fn new(sample_rate: f32) -> Self {
        let coefficients = Coefficients::new(sample_rate);
        Self {
            coefficients,
            left: Channel::new(coefficients),
            right: Channel::new(coefficients),
        }
    }

    pub(super) fn process_stereo(&mut self, left: f32, right: f32) -> (f32, f32) {
        (
            self.left.process(left, self.coefficients),
            self.right.process(right, self.coefficients),
        )
    }

    pub(super) fn reset(&mut self) {
        self.left.reset();
        self.right.reset();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn response_at(signal: &[f32], rate: f64, hz: f64) -> (f64, f64) {
        signal.iter().enumerate().fold((0.0, 0.0), |sum, (n, &x)| {
            let angle = TAU * hz * n as f64 / rate;
            (
                sum.0 + f64::from(x) * angle.cos(),
                sum.1 - f64::from(x) * angle.sin(),
            )
        })
    }

    // Independent phase derivative of the published transfer, using the
    // fractional delay's tangent law rather than the implementation's state
    // recurrence or coefficient helper. Constants belong to the design oracle.
    fn reference_delay_seconds(rate: f64, hz: f64) -> f64 {
        let transition = 4_216.0_f64.min(rate / 2.0);
        let at_transition = TAU * transition / rate;
        let integer = (rate / (2.0 * transition)).floor();
        let residual = PI - integer * at_transition;
        let ratio = if residual.abs() < 1e-12 {
            0.0
        } else {
            (residual / 2.0).tan() / (at_transition / 2.0).tan()
        };
        let omega = TAU * hz / rate;
        let phase = -integer * omega - 2.0 * (ratio * (omega / 2.0).tan()).atan();
        let fractional_delay =
            ratio / ((omega / 2.0).cos().powi(2) + ratio.powi(2) * (omega / 2.0).sin().powi(2));
        100.0 * (integer + fractional_delay) * (1.0 - 0.63_f64.powi(2))
            / (1.0 + 2.0 * 0.63 * phase.cos() + 0.63_f64.powi(2))
            / rate
    }

    #[test]
    fn dispersion_recurrence_matches_the_independent_physical_frequency_law() {
        for rate in [
            8_000.0_f32,
            44_100.0,
            48_000.0,
            96_000.0,
            176_400.0,
            192_000.0,
            384_000.0,
        ] {
            let coefficients = Coefficients::new(rate);
            let mut channel = Channel::new(coefficients);
            let signal: Vec<f32> = (0..(rate * 0.12) as usize)
                .map(|n| channel.disperse(if n == 0 { 1.0 } else { 0.0 }, coefficients))
                .collect();
            for hz in [200.0, 2_000.0, 4_216.0_f64.min(f64::from(rate) / 2.0)] {
                let before = response_at(&signal, f64::from(rate), hz - 0.5);
                let after = response_at(&signal, f64::from(rate), hz + 0.5);
                let phase_difference = after.1.atan2(after.0) - before.1.atan2(before.0);
                let wrapped = (phase_difference + PI).rem_euclid(TAU) - PI;
                let heard_delay = -wrapped / TAU;
                let expected = reference_delay_seconds(f64::from(rate), hz);
                assert!(
                    (heard_delay - expected).abs() < 0.0002,
                    "{rate} Hz, {hz} Hz: measured delay {heard_delay}s, analytic {expected}s"
                );
                assert!(
                    (before.0.hypot(before.1) - 1.0).abs() < 1e-3,
                    "the dispersion cascade must change phase, not gain"
                );
            }
        }
    }

    #[test]
    fn low_rate_and_exact_integer_stretches_bypass_the_fraction_safely() {
        for rate in [8_000.0, 8_432.0, 50_592.0] {
            let coefficients = Coefficients::new(rate);
            assert!(coefficients.stretch >= 1);
            assert!(coefficients.fractional.is_none());
            let mut spring = SpringBody::new(rate);
            let mut energy = 0.0_f64;
            for n in 0..(rate * 0.2) as usize {
                let impulse = if n == 0 { 1.0 } else { 0.0 };
                let output = spring.process_stereo(impulse, 0.0);
                assert!(output.0.is_finite());
                assert_eq!(output.1, 0.0, "the model does not crossfeed channels");
                energy += f64::from(output.0).powi(2);
            }
            assert!(energy > 0.05);
        }
    }

    #[test]
    fn invalid_rates_follow_the_existing_default_rate_precedent() {
        let normal = Coefficients::new(48_000.0);
        for rate in [0.0, -1.0, f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let invalid = Coefficients::new(rate);
            assert_eq!(invalid.stretch, normal.stretch);
            assert_eq!(invalid.loop_length, normal.loop_length);
            assert_eq!(invalid.gain, normal.gain);
        }
    }

    #[test]
    fn invalid_audio_is_reportable_and_cannot_poison_the_following_tail() {
        for invalid in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut spring = SpringBody::new(48_000.0);
            spring.process_stereo(1.0, 0.0);
            assert!(!spring.process_stereo(invalid, 0.0).0.is_finite());
            for _ in 0..4_800 {
                assert_eq!(spring.process_stereo(0.0, 0.0), (0.0, 0.0));
            }
        }
    }

    #[test]
    fn an_overflow_clears_recursive_memory_without_hiding_the_fault() {
        let mut spring = SpringBody::new(48_000.0);
        let mut fault = false;
        for _ in 0..9_600 {
            if !spring.process_stereo(f32::MAX, 0.0).0.is_finite() {
                fault = true;
                break;
            }
        }
        assert!(fault, "the stress signal must reach an actual overflow");
        for _ in 0..4_800 {
            assert_eq!(spring.process_stereo(0.0, 0.0), (0.0, 0.0));
        }
    }
}
