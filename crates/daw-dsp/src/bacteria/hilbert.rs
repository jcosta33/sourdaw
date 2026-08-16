//! Bode-style frequency shifter using an IIR Hilbert transform network.
//!
//! Two parallel all-pass branches whose outputs stay ~90° apart across the
//! audio band. Each branch is a cascade of second-order all-pass sections in
//! z², and the quadrature branch carries one extra sample of delay — the two
//! branches are the polyphase halves of a half-band design, so the odd branch's
//! z⁻¹ is part of the phase relationship, not an accident of ordering. Drop it
//! and the difference walks off 90° from the mid-band upwards.
//!
//! **The band is normalized to the sample rate, not fixed in Hz.** Quadrature
//! holds to better than 40 dB of unwanted-sideband rejection between
//! [`QUADRATURE_LOW_NORM`]·fs and [`QUADRATURE_HIGH_NORM`]·fs, and degrades
//! fast below the lower corner: half an octave under it the error is already
//! 8°. In Hz that corner is ~19 Hz at 44.1 kHz, ~21 Hz at 48 kHz and ~42 Hz at
//! 96 kHz, so a 96 kHz context leaves the bottom of the audio band outside the
//! contract — at 20 Hz there the image sits only 15 dB down and the shift
//! audibly degrades toward ring modulation. Covering 20 Hz at every rate needs
//! a rate-dependent coefficient set, which this design does not have.

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
    /// Whether the network's state is already cleared.
    ///
    /// Lets [`Self::bypass`] be free on every sample after the first one, so a
    /// caller can afford to call it on every skipped sample.
    idle: bool,

    // Oscillator
    phase: f32,
    shift_hz: f32,
    mix: f32,
    sample_rate: f32,
    /// false = upper sideband (shift up), true = lower sideband (shift down)
    lower_sideband: bool,
}

/// Lower edge of the quadrature band, as a fraction of the sample rate.
///
/// Where unwanted-sideband rejection passes 40 dB going up. Below it the phase
/// error grows steeply — see the module header.
pub const QUADRATURE_LOW_NORM: f32 = 4.35e-4;

/// Upper edge of the quadrature band, as a fraction of the sample rate.
pub const QUADRATURE_HIGH_NORM: f32 = 0.45;

// Polyphase half-band all-pass coefficients for a wideband 90° phase
// difference. Coefficients are design values `a`; each section squares its own.
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
            idle: true,
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

    /// Skip this stage for one sample and drop whatever is still ringing in it.
    ///
    /// Every path that stops feeding the shifter has to call this. The network
    /// is eight second-order all-pass sections with pole radius `a`, and the
    /// slowest of them sits at a = 0.9987: its memory falls 60 dB in ~5500
    /// samples, not the ~1 sample the collapsed one-pole structure this
    /// replaced used to forget in. Freeze that state instead of clearing it and
    /// it flushes intact when the stage comes back — 20k samples of loud audio
    /// followed by an unmute over silence peaks above full scale within three
    /// samples. `BandChain`'s alignment ring documents the same rule for the
    /// same reason.
    ///
    /// Free once the state is already down, so callers can invoke it per
    /// skipped sample without paying for it on the audio thread.
    pub fn bypass(&mut self) {
        if !self.idle {
            self.reset();
        }
    }

    pub fn process_sample(&mut self, input: f32) -> f32 {
        if self.shift_hz < 0.001 {
            // A shift of zero is a skip like any other: the stage stops being
            // fed, so it must not keep what it was holding.
            self.bypass();
            return input;
        }

        self.idle = false;
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
        self.idle = true;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_RATE: f32 = 48_000.0;
    /// Long enough for the 0.9987 section — pole radius `a`, so its transient
    /// needs a few thousand samples to fall out of the measurement.
    const SETTLE: usize = 12_000;
    const MEASURE: usize = 36_000;

    /// Window the normalized sweep measures over. Every test frequency there is
    /// an exact number of cycles in this many samples, so the correlation below
    /// carries no leakage from a partial cycle at the end.
    const NORM_WINDOW: usize = 32_768;

    fn rms(samples: &[f32]) -> f32 {
        (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
    }

    /// Sample `n` of a unit sine at `freq`, generated in f64 with the phase
    /// wrapped before the sine.
    ///
    /// `(2π·f·n/fs) as f32` does not survive this: at 15 kHz and n = 36000 the
    /// argument reaches 3.4·10⁹, where the f32 grid is 256 wide, and the phase
    /// lands up to 2.7 mrad off — sample-to-sample jitter that shows up as ~1%
    /// of envelope ripple and gets blamed on the filter.
    fn sine(freq: f64, sample_rate: f64, n: usize) -> f32 {
        let cycles = (freq * n as f64 / sample_rate).fract();
        (2.0 * std::f64::consts::PI * cycles).sin() as f32
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

    /// Normalized correlation between the two branches over a whole number of
    /// cycles. Zero at exact quadrature; sin(error) otherwise.
    fn branch_correlation(sample_rate: f32, cycles_per_sample: f64, window: usize) -> f64 {
        let mut shifter = HilbertShifter::new(sample_rate);
        let mut dot = 0.0_f64;
        let mut norm_i = 0.0_f64;
        let mut norm_q = 0.0_f64;
        for n in 0..SETTLE + window {
            let x = (2.0 * std::f64::consts::PI * cycles_per_sample * n as f64).sin() as f32;
            let (i, q) = shifter.analytic_pair(x);
            if n >= SETTLE {
                dot += i as f64 * q as f64;
                norm_i += (i as f64) * (i as f64);
                norm_q += (q as f64) * (q as f64);
            }
        }
        dot / (norm_i.sqrt() * norm_q.sqrt())
    }

    /// Unwanted-sideband rejection in dB, derived from the branches' phase
    /// error: an error `e` leaves an image of |tan(e/2)| relative to the wanted
    /// sideband. Negative and large means good.
    fn image_rejection_db(sample_rate: f32, cycles_per_sample: f64, window: usize) -> f64 {
        let correlation = branch_correlation(sample_rate, cycles_per_sample, window);
        let error = correlation.clamp(-1.0, 1.0).asin();
        20.0 * (error / 2.0).tan().abs().max(1e-18).log10()
    }

    fn gcd(a: u32, b: u32) -> u32 {
        if b == 0 {
            a
        } else {
            gcd(b, a % b)
        }
    }

    /// Measurement window holding a whole number of cycles of `freq_hz` at
    /// `rate_hz`, at least `NORM_WINDOW` samples long.
    fn whole_cycle_window(rate_hz: u32, freq_hz: u32) -> usize {
        let block = (rate_hz / gcd(rate_hz, freq_hz)) as usize;
        block * NORM_WINDOW.div_ceil(block)
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
            for freq in [
                20.0_f32, 100.0, 1_000.0, 5_000.0, 10_000.0, 15_000.0, 18_000.0,
            ] {
                let mut section = HilbertAllPass::new(*coeff);
                let mut output = Vec::with_capacity(MEASURE);
                for n in 0..SETTLE + MEASURE {
                    let x = sine(freq as f64, SAMPLE_RATE as f64, n);
                    let y = section.process(x);
                    if n >= SETTLE {
                        output.push(y);
                    }
                }
                // Input RMS is 1/√2 for a unit sine.
                let gain = rms(&output) * std::f32::consts::SQRT_2;
                assert!(
                    (gain - 1.0).abs() < 0.01,
                    "section a={coeff} at {freq} Hz has gain {gain}, not unity — \
                     an all-pass section may not change magnitude"
                );
            }
        }
    }

    /// The contract the module header states, in the units it is stated in.
    ///
    /// The network is rate-independent: `sample_rate` only feeds the shift
    /// oscillator, so the band is a fraction of fs and nothing else. Every
    /// point here is an exact number of cycles in `NORM_WINDOW` samples.
    #[test]
    fn quadrature_holds_across_the_whole_normalized_band() {
        // k/32768, spanning the declared band from its lower edge to its upper.
        for k in [15_u32, 33, 328, 3_277, 9_830, 14_745] {
            let norm = k as f64 / NORM_WINDOW as f64;
            assert!(
                norm >= QUADRATURE_LOW_NORM as f64 && norm <= QUADRATURE_HIGH_NORM as f64,
                "test point {norm} is outside the declared band, so it pins nothing"
            );
            let rejection = image_rejection_db(SAMPLE_RATE, norm, NORM_WINDOW);
            assert!(
                rejection < -40.0,
                "at f/fs = {norm:.3e} the unwanted sideband is only {rejection:.1} dB down; \
                 the declared band promises 40"
            );
        }
    }

    /// What that normalized band means in Hz, and where it stops meaning 20 Hz.
    ///
    /// This is a two-sided pin on a deliberately accepted limitation, not a
    /// floor to improve against silently: the lower edge scales with fs, so a
    /// 96 kHz context leaves 20 Hz outside the band and the shift there degrades
    /// toward ring modulation. Give the network rate-dependent coefficients and
    /// this test fails — update it, do not widen it.
    #[test]
    fn the_low_edge_of_the_band_scales_with_the_sample_rate() {
        for (rate, worst_20_hz_db, best_20_hz_db) in [
            (44_100_u32, -42.0, -47.0),
            (48_000, -34.0, -40.0),
            (96_000, -13.0, -18.0),
        ] {
            let window = whole_cycle_window(rate, 20);
            let rejection = image_rejection_db(rate as f32, 20.0 / rate as f64, window);
            assert!(
                rejection < worst_20_hz_db && rejection > best_20_hz_db,
                "at {rate} Hz the 20 Hz image sits {rejection:.1} dB down, outside the \
                 pinned {best_20_hz_db}..{worst_20_hz_db} dB — the rate-dependence of the \
                 low edge changed"
            );
        }

        // The top of the audio band is inside the contract at every rate.
        for rate in [44_100_u32, 48_000, 96_000] {
            let window = whole_cycle_window(rate, 15_000);
            let rejection = image_rejection_db(rate as f32, 15_000.0 / rate as f64, window);
            assert!(
                rejection < -40.0,
                "at {rate} Hz the 15 kHz image is only {rejection:.1} dB down"
            );
        }
    }

    /// The two branches must form an analytic pair: orthogonal outputs whose
    /// vector length is the constant envelope of the input sine.
    #[test]
    fn the_two_branches_form_a_quadrature_pair() {
        for freq in [200.0_f32, 1_000.0, 5_000.0, 15_000.0] {
            let mut shifter = HilbertShifter::new(SAMPLE_RATE);
            let mut in_phase = Vec::with_capacity(MEASURE);
            let mut quadrature = Vec::with_capacity(MEASURE);
            for n in 0..SETTLE + MEASURE {
                let x = sine(freq as f64, SAMPLE_RATE as f64, n);
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
                correlation.abs() < 0.02,
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
                min > 0.99 && max < 1.01,
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
            let x = sine(carrier as f64, SAMPLE_RATE as f64, n);
            let y = shifter.process_sample(x);
            if n >= SETTLE {
                output.push(y);
            }
        }

        let sum = amplitude_at(&output, carrier + shift);
        let difference = amplitude_at(&output, carrier - shift);
        let leak = amplitude_at(&output, carrier);
        assert!(
            sum > 0.99,
            "shifted output holds only {sum} at {} Hz; an all-pass network \
             preserves the input amplitude",
            carrier + shift
        );
        assert!(
            difference < 0.01 * sum,
            "unwanted lower sideband at {} Hz is {difference} against {sum}",
            carrier - shift
        );
        assert!(
            leak < 0.01 * sum,
            "carrier leaks through at {leak} against {sum}"
        );
    }

    /// Drive the network hard, stop feeding it, and bring it back over silence.
    ///
    /// Eight all-pass sections with pole radius up to 0.9987 hold ~5500 samples
    /// of memory. Freezing that state instead of clearing it means the whole
    /// burst is still in the filters when the stage returns, and it flushes
    /// above full scale within a few samples.
    #[test]
    fn a_skipped_shifter_does_not_flush_its_memory_when_it_comes_back() {
        let mut shifter = HilbertShifter::new(SAMPLE_RATE);
        shifter.set_param("freqShiftHz", 200.0);
        shifter.set_param("freqShiftMix", 1.0);

        for n in 0..20_000 {
            shifter.process_sample(sine(440.0, SAMPLE_RATE as f64, n));
        }

        // The stage is skipped — exactly what a mute, a band drop or the
        // `freqShiftEnabled` toggle does.
        shifter.bypass();

        let mut peak = 0.0_f32;
        for _ in 0..8_000 {
            peak = peak.max(shifter.process_sample(0.0).abs());
        }
        assert!(
            peak < 1e-3,
            "silence after a skip came back at {peak} ({} dBFS) — the all-pass \
             network flushed what it was holding",
            20.0 * peak.max(1e-12).log10()
        );
    }

    /// The zero-shift early return is a skip like any other.
    #[test]
    fn dropping_the_shift_to_zero_empties_the_network() {
        let mut shifter = HilbertShifter::new(SAMPLE_RATE);
        shifter.set_param("freqShiftHz", 200.0);
        shifter.set_param("freqShiftMix", 1.0);

        for n in 0..20_000 {
            shifter.process_sample(sine(440.0, SAMPLE_RATE as f64, n));
        }

        shifter.set_param("freqShiftHz", 0.0);
        for _ in 0..64 {
            shifter.process_sample(0.0);
        }
        shifter.set_param("freqShiftHz", 200.0);

        let mut peak = 0.0_f32;
        for _ in 0..8_000 {
            peak = peak.max(shifter.process_sample(0.0).abs());
        }
        assert!(
            peak < 1e-3,
            "silence after a zero-shift pass came back at {peak}"
        );
    }
}
