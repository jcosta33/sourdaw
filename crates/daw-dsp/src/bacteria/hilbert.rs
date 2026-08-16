//! Bode-style frequency shifter using an IIR Hilbert transform network.
//!
//! Two parallel all-pass branches whose outputs stay ~90° apart across the
//! audio band. Each branch is a cascade of second-order all-pass sections in
//! z², and the quadrature branch carries one extra sample of delay — the two
//! branches are the polyphase halves of a half-band design, so the odd branch's
//! z⁻¹ is part of the phase relationship, not an accident of ordering. Drop it
//! and the difference walks off 90° from the mid-band upwards.

use crate::primitives::flush_denormal;
use std::f32::consts::PI;

/// One second-order all-pass section of a Hilbert branch.
///
/// H(z) = (a² − z⁻²) / (1 − a² z⁻²), so |H(e^jω)| = 1 at every frequency: the
/// section contributes phase and nothing else. The coefficient is stored
/// squared because that is the only form the difference equation uses.
///
/// The state is deliberately four words. x[n−2] and y[n−2] are different
/// quantities, and folding them into one accumulator collapses the section to
/// y[n] = a·x[n] + (1−a)·y[n−1] — a one-pole lowpass with unity DC gain, which
/// holds no fixed phase relationship to anything. Two chains of those cannot
/// form a quadrature pair, and the shifter downstream degenerates into ring
/// modulation of two lowpassed copies.
#[derive(Clone)]
struct HilbertAllPass {
    /// a², the squared design coefficient.
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl HilbertAllPass {
    fn new(coeff: f32) -> Self {
        Self {
            a2: coeff * coeff,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    /// y[n] = a²·(x[n] + y[n−2]) − x[n−2]
    fn process(&mut self, input: f32) -> f32 {
        let y = flush_denormal(self.a2 * (input + self.y2) - self.x2);
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }

    fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

/// Bode frequency shifter with IIR Hilbert transform approximation.
///
/// Uses two parallel all-pass branches that maintain ~90° phase difference
/// across the audio band. The analytic signal is then multiplied by
/// a complex exponential to shift frequencies.
///
/// y(t) = x(t)·cos(ω_shift·t) ∓ x̂(t)·sin(ω_shift·t)
pub struct HilbertShifter {
    /// Quadrature branch — the "imaginary" path, lagging the in-phase branch
    /// by ~90°. Its output passes through [`Self::quad_delay`].
    chain_quadrature: Vec<HilbertAllPass>,
    /// In-phase branch — the "real" path.
    chain_in_phase: Vec<HilbertAllPass>,
    /// The quadrature branch's extra z⁻¹ (see the module header).
    quad_delay: f32,

    // Oscillator
    phase: f32,
    shift_hz: f32,
    mix: f32,
    sample_rate: f32,
    /// false = upper sideband (shift up), true = lower sideband (shift down)
    lower_sideband: bool,
}

// Polyphase half-band all-pass coefficients for a wideband 90° phase
// difference. The pair holds within ~2° of quadrature from ~4·10⁻⁴·fs to
// ~0.45·fs, which covers 20 Hz – 20 kHz at every rate the engine runs at.
// Coefficients are design values `a`; each section squares its own.
const QUADRATURE_BRANCH_COEFFS: [f32; 4] =
    [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737];

const IN_PHASE_BRANCH_COEFFS: [f32; 4] = [
    0.4021921162426,
    0.8561710882420,
    0.9722909545651,
    0.9952884791278,
];

impl HilbertShifter {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            chain_quadrature: QUADRATURE_BRANCH_COEFFS
                .iter()
                .map(|&c| HilbertAllPass::new(c))
                .collect(),
            chain_in_phase: IN_PHASE_BRANCH_COEFFS
                .iter()
                .map(|&c| HilbertAllPass::new(c))
                .collect(),
            quad_delay: 0.0,
            phase: 0.0,
            shift_hz: 0.0,
            mix: 0.5,
            sample_rate,
            lower_sideband: false,
        }
    }

    pub fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "freqShiftHz" => {
                self.lower_sideband = value < 0.0;
                self.shift_hz = value.abs();
            }
            "freqShiftMix" => self.mix = value.clamp(0.0, 1.0),
            _ => {}
        }
    }

    /// The analytic pair (in-phase, quadrature) for one input sample.
    ///
    /// Both components carry unit magnitude at every frequency; only their
    /// phases differ, by ~90° with the quadrature component lagging. That is
    /// the property the shift below depends on, and the one the tests pin.
    fn analytic_pair(&mut self, input: f32) -> (f32, f32) {
        let mut in_phase = input;
        for ap in &mut self.chain_in_phase {
            in_phase = ap.process(in_phase);
        }

        let mut quadrature = input;
        for ap in &mut self.chain_quadrature {
            quadrature = ap.process(quadrature);
        }

        let delayed_quadrature = self.quad_delay;
        self.quad_delay = quadrature;

        (in_phase, delayed_quadrature)
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if self.shift_hz < 0.001 {
            return input;
        }

        let (real_path, imag_path) = self.analytic_pair(input);

        // Generate complex exponential
        let phase_inc = self.shift_hz / self.sample_rate;
        self.phase += phase_inc;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }

        let angle = self.phase * 2.0 * PI;
        let cos_w = angle.cos();
        let sin_w = angle.sin();

        // Frequency shifting via analytic signal × complex exponential
        // Upper sideband: y = real·cos - imag·sin
        // Lower sideband: y = real·cos + imag·sin
        let shifted = if self.lower_sideband {
            real_path * cos_w + imag_path * sin_w
        } else {
            real_path * cos_w - imag_path * sin_w
        };

        // Mix
        input * (1.0 - self.mix) + shifted * self.mix
    }

    pub fn reset(&mut self) {
        for ap in &mut self.chain_quadrature {
            ap.reset();
        }
        for ap in &mut self.chain_in_phase {
            ap.reset();
        }
        self.quad_delay = 0.0;
        self.phase = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: f32 = 48_000.0;
    /// Long enough for the 0.9987 section — pole radius a² ≈ 0.9975, so its
    /// transient needs a few thousand samples to fall out of the measurement.
    const SETTLE: usize = 12_000;
    const MEASURE: usize = 36_000;

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    /// Magnitude of `signal` at `freq`, as a peak amplitude.
    fn amplitude_at(signal: &[f32], freq: f32) -> f32 {
        let mut re = 0.0_f64;
        let mut im = 0.0_f64;
        for (n, &s) in signal.iter().enumerate() {
            let angle = 2.0 * std::f64::consts::PI * freq as f64 * n as f64 / SAMPLE_RATE as f64;
            re += s as f64 * angle.cos();
            im += s as f64 * angle.sin();
        }
        (2.0 * (re * re + im * im).sqrt() / signal.len() as f64) as f32
    }

    /// An all-pass section passes every frequency at unit gain. The one-pole
    /// lowpass it is easy to collapse into does not: at 10 kHz the 0.6923878
    /// section would deliver ~0.72 of the input amplitude.
    #[test]
    fn a_single_all_pass_section_preserves_magnitude_at_every_frequency() {
        for coeff in QUADRATURE_BRANCH_COEFFS
            .iter()
            .chain(IN_PHASE_BRANCH_COEFFS.iter())
        {
            for freq in [100.0_f32, 1_000.0, 5_000.0, 10_000.0, 18_000.0] {
                let mut section = HilbertAllPass::new(*coeff);
                let mut output = Vec::with_capacity(MEASURE);
                for n in 0..SETTLE + MEASURE {
                    let x = (2.0 * PI * freq * n as f32 / SAMPLE_RATE).sin();
                    let y = section.process(x);
                    if n >= SETTLE {
                        output.push(y);
                    }
                }
                // Input RMS is 1/√2 for a unit sine.
                let gain = rms(&output) * std::f32::consts::SQRT_2;
                assert!(
                    (gain - 1.0).abs() < 0.02,
                    "section a={coeff} at {freq} Hz has gain {gain}, not unity — \
                     an all-pass section may not change magnitude"
                );
            }
        }
    }

    /// The two branches must form an analytic pair: orthogonal outputs whose
    /// vector length is the constant envelope of the input sine.
    #[test]
    fn the_two_branches_form_a_quadrature_pair() {
        for freq in [200.0_f32, 1_000.0, 5_000.0] {
            let mut shifter = HilbertShifter::new(SAMPLE_RATE);
            let mut in_phase = Vec::with_capacity(MEASURE);
            let mut quadrature = Vec::with_capacity(MEASURE);
            for n in 0..SETTLE + MEASURE {
                let x = (2.0 * PI * freq * n as f32 / SAMPLE_RATE).sin();
                let (i, q) = shifter.analytic_pair(x);
                if n >= SETTLE {
                    in_phase.push(i);
                    quadrature.push(q);
                }
            }

            let dot: f32 = in_phase
                .iter()
                .zip(&quadrature)
                .map(|(i, q)| i * q)
                .sum::<f32>();
            let norm = rms(&in_phase) * rms(&quadrature) * in_phase.len() as f32;
            let correlation = dot / norm;
            assert!(
                correlation.abs() < 0.05,
                "branches at {freq} Hz correlate at {correlation}, so they are not 90° apart"
            );

            let envelope: Vec<f32> = in_phase
                .iter()
                .zip(&quadrature)
                .map(|(i, q)| (i * i + q * q).sqrt())
                .collect();
            let min = envelope.iter().copied().fold(f32::INFINITY, f32::min);
            let max = envelope.iter().copied().fold(0.0_f32, f32::max);
            assert!(
                min > 0.95 && max < 1.05,
                "analytic envelope at {freq} Hz ripples between {min} and {max}; \
                 a true analytic pair holds the input amplitude flat"
            );
        }
    }

    /// End of the chain: shifting a sine up must move it to f + shift and put
    /// nothing audible on the mirror image or the original carrier.
    #[test]
    fn an_upper_sideband_shift_lands_on_the_sum_frequency() {
        let carrier = 1_000.0_f32;
        let shift = 200.0_f32;

        let mut shifter = HilbertShifter::new(SAMPLE_RATE);
        shifter.set_param("freqShiftHz", shift);
        shifter.set_param("freqShiftMix", 1.0);

        let mut output = Vec::with_capacity(MEASURE);
        for n in 0..SETTLE + MEASURE {
            let x = (2.0 * PI * carrier * n as f32 / SAMPLE_RATE).sin();
            let y = shifter.process_sample(x);
            if n >= SETTLE {
                output.push(y);
            }
        }

        let sum = amplitude_at(&output, carrier + shift);
        let difference = amplitude_at(&output, carrier - shift);
        let leak = amplitude_at(&output, carrier);
        assert!(
            sum > 0.95,
            "shifted output holds only {sum} at {} Hz; an all-pass network \
             preserves the input amplitude",
            carrier + shift
        );
        assert!(
            difference < 0.05 * sum,
            "unwanted lower sideband at {} Hz is {difference} against {sum}",
            carrier - shift
        );
        assert!(
            leak < 0.05 * sum,
            "carrier leaks through at {leak} against {sum}"
        );
    }
}
