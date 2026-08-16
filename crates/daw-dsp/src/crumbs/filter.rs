/// Cytomic/Zavalishin Topology-Preserving Transform (TPT) State Variable Filter.
///
/// Provides simultaneous lowpass, highpass, bandpass, and notch outputs.
///
/// Above Q = 10 the filter runs its integrators at twice the sample rate to
/// keep high-resonance self-oscillation stable. The rate change is the whole
/// of it: the input is held across both sub-samples (zero-order hold) and the
/// two sub-sample outputs are averaged back down. That average is a two-tap
/// half-band-ish decimator, not a polyphase one, so this buys the stability of
/// a doubled integration rate and a gentle roll-off near Nyquist — not the
/// alias rejection of true polyphase oversampling. It is unity in the
/// passband, which is the property that matters at the Q = 10 threshold: the
/// two sides of it have to sound like the same filter.
///
/// Reference: Zavalishin, "The Art of VA Filter Design" (2018), Chapter 4.
use std::f32::consts::PI;

use crate::primitives::{flush_denormal, q_from_normalized_resonance};

// ── Resonance units ────────────────────────────────────────────────────

// The Q ↔ normalised contract is product-wide, not Crumbs-specific — Toaster's
// pads carry the identical "0.5-20" field. Both directions live in
// `primitives::resonance`; re-exported here because this module was their
// address for long enough that callers point at it.
pub use crate::primitives::resonance::{
    normalized_resonance_from_q, RESONANCE_Q_MAX, RESONANCE_Q_MIN,
};

// ── Filter Output ──────────────────────────────────────────────────────

/// Simultaneous multi-mode filter output from a single processing step.
#[derive(Debug, Clone, Copy, Default)]
pub struct SvfOutput {
    pub lowpass: f32,
    pub highpass: f32,
    pub bandpass: f32,
    pub notch: f32,
}

// ── TPT SVF Filter ────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct TptSvf {
    // State variables (integrator memories).
    ic1eq: f32,
    ic2eq: f32,

    // Cached coefficients.
    g: f32,
    k: f32,
    a1: f32,
    a2: f32,
    a3: f32,

    // Current parameters.
    cutoff: f32,
    resonance: f32,
    sample_rate: f32,

    // True while the integrators are running at 2x the sample rate. There is no
    // second integrator pair: both sub-samples run through `ic1eq`/`ic2eq`,
    // which is what makes the 2x pass a continuation of the same filter state
    // rather than a parallel one.
    oversample: bool,
}

impl TptSvf {
    pub fn new(sample_rate: f32) -> Self {
        let mut filter = Self {
            ic1eq: 0.0,
            ic2eq: 0.0,
            g: 0.0,
            k: 0.0,
            a1: 0.0,
            a2: 0.0,
            a3: 0.0,
            cutoff: 1000.0,
            resonance: 0.0,
            sample_rate,
            oversample: false,
        };
        filter.update_coefficients(1000.0, 0.0);
        filter
    }

    /// Set cutoff frequency (Hz) and resonance (0.0–1.0).
    ///
    /// Resonance is mapped to Q internally. Values above ~0.9 produce
    /// self-oscillation. When Q > 10, 2x oversampling activates automatically.
    pub fn set_params(&mut self, cutoff_hz: f32, resonance: f32) {
        let cutoff_clamped = cutoff_hz.clamp(20.0, self.sample_rate * 0.49);
        let res_clamped = resonance.clamp(0.0, 1.0);

        if (cutoff_clamped - self.cutoff).abs() > 0.01
            || (res_clamped - self.resonance).abs() > 0.001
        {
            self.update_coefficients(cutoff_clamped, res_clamped);
        }
    }

    /// Process a single sample and return all four filter outputs simultaneously.
    pub fn process(&mut self, input: f32) -> SvfOutput {
        if self.oversample {
            self.process_oversampled(input)
        } else {
            let mut s1 = self.ic1eq;
            let mut s2 = self.ic2eq;
            let result = self.tick(input, &mut s1, &mut s2);
            self.ic1eq = s1;
            self.ic2eq = s2;
            result
        }
    }

    /// Process a single sample, returning only the selected filter type output.
    pub fn process_mono(&mut self, input: f32, filter_type: super::types::FilterType) -> f32 {
        let out = self.process(input);

        match filter_type {
            super::types::FilterType::Lowpass => out.lowpass,
            super::types::FilterType::Highpass => out.highpass,
            super::types::FilterType::Bandpass => out.bandpass,
            super::types::FilterType::Notch => out.notch,
        }
    }

    pub fn reset(&mut self) {
        self.ic1eq = 0.0;
        self.ic2eq = 0.0;
    }

    // ── Internal ───────────────────────────────────────────────────────

    /// Core TPT SVF tick — processes one sample through the filter.
    fn tick(&self, input: f32, s1: &mut f32, s2: &mut f32) -> SvfOutput {
        let v0 = input;
        let v3 = v0 - *s2;
        let v1 = self.a1 * *s1 + self.a2 * v3;
        let v2 = *s2 + self.a2 * *s1 + self.a3 * v3;

        // DSP-9: was an add-then-subtract `DENORMAL_DC` offset, which biased the
        // integrator state to keep it out of the subnormal range. The shared
        // guard flushes instead, leaving normal-range state bit-exact.
        *s1 = flush_denormal(2.0 * v1 - *s1);
        *s2 = flush_denormal(2.0 * v2 - *s2);

        SvfOutput {
            lowpass: v2,
            bandpass: v1,
            highpass: v0 - self.k * v1 - v2,
            notch: v0 - self.k * v1,
        }
    }

    /// 2x-rate processing for high-resonance stability.
    ///
    /// Zero-order hold on the way up — the same input drives both sub-samples,
    /// which is what a held (staircase) upsampler produces — and an average on
    /// the way down. The average is the decimator: taking only the second tick
    /// would keep an image the 2x-rate filter has not removed.
    ///
    /// This used to halve the input before both ticks, which is the amplitude
    /// correction a *zero-stuffed* upsampler needs and is wrong for a held one:
    /// it cost 6 dB of passband level, so crossing Q = 10 on the resonance knob
    /// dropped the filter's output by half.
    fn process_oversampled(&mut self, input: f32) -> SvfOutput {
        let mut s1 = self.ic1eq;
        let mut s2 = self.ic2eq;
        let first = self.tick(input, &mut s1, &mut s2);
        let second = self.tick(input, &mut s1, &mut s2);
        self.ic1eq = s1;
        self.ic2eq = s2;

        SvfOutput {
            lowpass: 0.5 * (first.lowpass + second.lowpass),
            highpass: 0.5 * (first.highpass + second.highpass),
            bandpass: 0.5 * (first.bandpass + second.bandpass),
            notch: 0.5 * (first.notch + second.notch),
        }
    }

    fn update_coefficients(&mut self, cutoff_hz: f32, resonance: f32) {
        self.cutoff = cutoff_hz;
        self.resonance = resonance;

        // Map resonance 0–1 to Q. At resonance=1.0, Q≈20 (self-oscillation).
        let q = q_from_normalized_resonance(resonance);
        self.oversample = q > 10.0;

        let effective_sr = if self.oversample {
            self.sample_rate * 2.0
        } else {
            self.sample_rate
        };

        // Bilinear pre-warp: g = tan(pi * fc / fs)
        self.g = (PI * cutoff_hz / effective_sr).tan();
        self.k = 1.0 / q;

        self.a1 = 1.0 / (1.0 + self.g * (self.g + self.k));
        self.a2 = self.g * self.a1;
        self.a3 = self.g * self.a2;
    }
}

// The two tests that lived here asserted `normalized_resonance_from_q`'s ends,
// midpoint and saturation. That function is now re-exported from
// `primitives::resonance`, so `super::normalized_resonance_from_q` resolved to
// the identical function the primitive's own tests already cover with the
// identical assertions — the same expression evaluated twice, not a second
// callsite guarded. They are deleted rather than kept for the appearance of
// coverage (ADR 0015). The Crumbs-specific detail they carried, that
// `CrumbsControls` is one of the two panels drawing this exact span, moved into
// the primitive's test comment so the citation is not lost.
