/// TPT (Topology-Preserving Transform) State Variable Filter.
/// Implements LP, HP, BP, Notch with zero-delay feedback.
/// Based on Vadim Zavalishin's "The Art of VA Filter Design."
use crate::primitives::flush_denormal;

#[derive(Clone, Copy, PartialEq)]
pub enum FilterMode {
    Lowpass,
    Highpass,
    Bandpass,
    Notch,
}

#[derive(Clone)]
pub struct SvfFilter {
    ic1eq: f32,
    ic2eq: f32,
    mode: FilterMode,
    drive: f32,
}

impl SvfFilter {
    pub fn new() -> Self {
        Self {
            ic1eq: 0.0,
            ic2eq: 0.0,
            mode: FilterMode::Lowpass,
            drive: 0.0,
        }
    }

    pub fn set_mode(&mut self, mode: FilterMode) {
        self.mode = mode;
    }

    pub fn set_drive(&mut self, drive: f32) {
        self.drive = drive.clamp(0.0, 10.0);
    }

    /// Process a single sample through the SVF.
    /// `cutoff` in Hz, `resonance` as Q (0.5–20.0), `sample_rate` in Hz.
    #[inline]
    pub fn process(&mut self, input: f32, cutoff: f32, resonance: f32, sample_rate: f32) -> f32 {
        // Pre-warp cutoff frequency
        let g = (std::f32::consts::PI * cutoff / sample_rate).tan();
        let k = 1.0 / resonance.max(0.5);

        let a1 = 1.0 / (1.0 + g * (g + k));
        let a2 = g * a1;
        let a3 = g * a2;

        let v3 = input - self.ic2eq;
        let v1 = a1 * self.ic1eq + a2 * v3;
        let v2 = self.ic2eq + a2 * self.ic1eq + a3 * v3;

        // DSP-2: zero-delay-feedback integrator state, unflushed until now.
        self.ic1eq = flush_denormal(2.0 * v1 - self.ic1eq);
        self.ic2eq = flush_denormal(2.0 * v2 - self.ic2eq);

        let output = match self.mode {
            FilterMode::Lowpass => v2,
            FilterMode::Highpass => input - k * v1 - v2,
            FilterMode::Bandpass => v1,
            FilterMode::Notch => input - k * v1,
        };

        // Apply drive/saturation when drive > 0.001
        if self.drive > 0.001 {
            fast_tanh(output * (1.0 + self.drive))
        } else {
            output
        }
    }

    pub fn reset(&mut self) {
        self.ic1eq = 0.0;
        self.ic2eq = 0.0;
    }
}

/// Fast tanh approximation for saturation.
#[inline]
pub fn fast_tanh(x: f32) -> f32 {
    let x2 = x * x;
    x * (27.0 + x2) / (27.0 + 9.0 * x2)
}

/// Moog-style 4-pole ladder filter with tanh saturation per stage.
/// Gives the classic warm, fat low-pass sound. Self-oscillates at high resonance.
#[derive(Clone)]
pub struct MoogLadder {
    s: [f32; 4], // stage states
    drive: f32,
}

impl MoogLadder {
    pub fn new() -> Self {
        Self {
            s: [0.0; 4],
            drive: 0.0,
        }
    }

    pub fn set_drive(&mut self, drive: f32) {
        self.drive = drive;
    }

    pub fn reset(&mut self) {
        self.s = [0.0; 4];
    }

    #[inline]
    pub fn process(&mut self, input: f32, cutoff: f32, resonance: f32, sample_rate: f32) -> f32 {
        let f = (core::f32::consts::PI * cutoff / sample_rate).tan();
        let g = f / (1.0 + f);
        let k = resonance.clamp(0.0, 4.0);

        let driven = fast_tanh(input * (1.0 + self.drive));
        let fb = fast_tanh(self.s[3] * k);
        let mut x = driven - fb;

        for i in 0..4 {
            let v = fast_tanh(x);
            let y = g * (v - self.s[i]) + self.s[i];
            self.s[i] = flush_denormal(2.0 * y - self.s[i]);
            x = y;
        }
        x
    }
}

/// TB-303 style diode ladder filter.
/// Asymmetric clipping gives the classic acid squelch.
#[derive(Clone)]
pub struct DiodeLadder {
    s: [f32; 4],
    y: [f32; 4],
    drive: f32,
}

impl DiodeLadder {
    pub fn new() -> Self {
        Self {
            s: [0.0; 4],
            y: [0.0; 4],
            drive: 0.0,
        }
    }

    pub fn set_drive(&mut self, drive: f32) {
        self.drive = drive;
    }

    pub fn reset(&mut self) {
        self.s = [0.0; 4];
        self.y = [0.0; 4];
    }

    #[inline]
    pub fn process(&mut self, input: f32, cutoff: f32, resonance: f32, sample_rate: f32) -> f32 {
        let f = (core::f32::consts::PI * cutoff / sample_rate)
            .min(0.45 * core::f32::consts::PI)
            .tan();
        let res = resonance.clamp(0.0, 1.0) * 17.0;
        let vt = 0.0256f32;

        let driven = fast_tanh(input * (1.0 + self.drive));
        let fb = self.y[3] * res;
        let x = Self::diode_clip(driven - fb, vt);

        let mut sig = x;
        for i in 0..4 {
            let v = Self::diode_clip(sig - self.s[i], vt);
            let y = f * v + self.s[i];
            self.s[i] = flush_denormal(f * v + y);
            self.y[i] = y;
            sig = y;
        }
        self.y[3]
    }

    #[inline]
    fn diode_clip(x: f32, vt: f32) -> f32 {
        if x > 0.0 {
            fast_tanh(x / vt) * vt
        } else {
            fast_tanh(x / (2.0 * vt)) * 2.0 * vt
        }
    }
}

/// Formant (vowel) filter — 3 parallel bandpass resonances that morph between vowels.
/// Vowel positions: A(0), E(1), I(2), O(3), U(4)
/// The morph parameter sweeps continuously between them.
#[derive(Clone)]
pub struct FormantFilter {
    /// 3 bandpass filter states (each is a 2nd-order biquad)
    bp: [[f32; 2]; 3], // [formant_index][state: s1, s2]
    drive: f32,
}

// Formant frequency table: [vowel][formant F1, F2, F3] in Hz
const FORMANT_FREQS: [[f32; 3]; 5] = [
    [800.0, 1150.0, 2900.0], // A (as in "father")
    [350.0, 2000.0, 2800.0], // E (as in "bed")
    [270.0, 2140.0, 2950.0], // I (as in "heed")
    [450.0, 800.0, 2830.0],  // O (as in "hose")
    [325.0, 700.0, 2700.0],  // U (as in "hoot")
];

// Formant bandwidth table: [vowel][formant] in Hz
const FORMANT_BW: [[f32; 3]; 5] = [
    [80.0, 90.0, 120.0],
    [60.0, 100.0, 120.0],
    [60.0, 90.0, 100.0],
    [40.0, 80.0, 100.0],
    [50.0, 60.0, 170.0],
];

// Formant gain table: [vowel][formant] linear amplitude
const FORMANT_GAIN: [[f32; 3]; 5] = [
    [1.0, 0.5, 0.25],
    [1.0, 0.5, 0.3],
    [1.0, 0.35, 0.25],
    [1.0, 0.35, 0.2],
    [1.0, 0.3, 0.15],
];

impl FormantFilter {
    pub fn new() -> Self {
        Self {
            bp: [[0.0; 2]; 3],
            drive: 0.0,
        }
    }

    pub fn set_drive(&mut self, drive: f32) {
        self.drive = drive;
    }

    pub fn reset(&mut self) {
        self.bp = [[0.0; 2]; 3];
    }

    /// Process one sample. `morph` sweeps 0.0–4.0 across the 5 vowels.
    /// `resonance` here controls the Q scaling (higher = more resonant formants).
    #[inline]
    pub fn process(&mut self, input: f32, morph: f32, resonance: f32, sample_rate: f32) -> f32 {
        let morph = morph.clamp(0.0, 3.999);
        let idx = morph as usize;
        let frac = morph - idx as f32;
        let next = (idx + 1).min(4);

        let driven = if self.drive > 0.001 {
            fast_tanh(input * (1.0 + self.drive))
        } else {
            input
        };

        let mut out = 0.0f32;
        let q_scale = 0.5 + resonance * 0.3; // resonance affects bandwidth

        for f in 0..3 {
            // Interpolate formant parameters between adjacent vowels
            let freq = FORMANT_FREQS[idx][f] * (1.0 - frac) + FORMANT_FREQS[next][f] * frac;
            let bw = (FORMANT_BW[idx][f] * (1.0 - frac) + FORMANT_BW[next][f] * frac) / q_scale;
            let gain = FORMANT_GAIN[idx][f] * (1.0 - frac) + FORMANT_GAIN[next][f] * frac;

            // 2nd-order bandpass biquad (peaking EQ style)
            let w0 = core::f32::consts::TAU * freq / sample_rate;
            let cos_w0 = w0.cos();
            let sin_w0 = w0.sin();
            let alpha = sin_w0 * (freq / bw).max(0.1) * 0.5; // Q = freq/bw

            let a0_inv = 1.0 / (1.0 + alpha);
            let b1 = 0.0;
            let b0 = alpha * a0_inv;
            let a1 = -2.0 * cos_w0 * a0_inv;
            let a2 = (1.0 - alpha) * a0_inv;

            // Direct form II transposed
            let y = b0 * driven + self.bp[f][0];
            self.bp[f][0] = b1 * driven - a1 * y + self.bp[f][1];
            self.bp[f][1] = -b0 * driven - a2 * y; // b2 = -b0 for bandpass

            out += y * gain;
        }

        out
    }
}

/// Korg MS-20 style HP → LP filter.
///
/// Both two-pole sections use topology-preserving trapezoidal integrators. This
/// keeps their state transition inside the stable region as cutoff approaches
/// Nyquist; an explicit-Euler update here previously amplified even a 1e-12
/// impulse to infinity.
#[derive(Clone)]
pub struct Ms20Filter {
    hp_s1: f32,
    hp_s2: f32,
    lp_s1: f32,
    lp_s2: f32,
    drive: f32,
}

impl Ms20Filter {
    pub fn new() -> Self {
        Self {
            hp_s1: 0.0,
            hp_s2: 0.0,
            lp_s1: 0.0,
            lp_s2: 0.0,
            drive: 0.0,
        }
    }

    pub fn set_drive(&mut self, drive: f32) {
        self.drive = drive;
    }

    pub fn reset(&mut self) {
        self.hp_s1 = 0.0;
        self.hp_s2 = 0.0;
        self.lp_s1 = 0.0;
        self.lp_s2 = 0.0;
    }

    #[inline]
    pub fn process(&mut self, input: f32, cutoff: f32, resonance: f32, sample_rate: f32) -> f32 {
        let sample_rate = sample_rate.max(1.0);
        let max_cutoff = (sample_rate * 0.45).clamp(20.0, 20_000.0);
        let g = (core::f32::consts::PI * cutoff.clamp(20.0, max_cutoff) / sample_rate).tan();
        let damping = 1.0 / resonance.clamp(0.5, 20.0);

        let driven = if self.drive > 0.001 {
            fast_tanh(input * (1.0 + self.drive))
        } else {
            input
        };

        let (_, hp) = Self::process_section(driven, g, damping, &mut self.hp_s1, &mut self.hp_s2);
        let (lp, _) = Self::process_section(hp, g, damping, &mut self.lp_s1, &mut self.lp_s2);
        lp
    }

    #[inline]
    fn process_section(
        input: f32,
        g: f32,
        damping: f32,
        state_1: &mut f32,
        state_2: &mut f32,
    ) -> (f32, f32) {
        let a1 = 1.0 / (1.0 + g * (g + damping));
        let a2 = g * a1;
        let a3 = g * a2;
        let v3 = input - *state_2;
        let bandpass = a1 * *state_1 + a2 * v3;
        let lowpass = *state_2 + a2 * *state_1 + a3 * v3;

        *state_1 = flush_denormal(2.0 * bandpass - *state_1);
        *state_2 = flush_denormal(2.0 * lowpass - *state_2);

        let highpass = input - damping * bandpass - lowpass;
        (lowpass, highpass)
    }
}

/// Oberheim SEM filter — 12dB/oct state variable with continuous LP→BP→Notch→HP morph.
/// Gentler slope than Moog, creamy character from internal soft-clipping.
#[derive(Clone)]
pub struct SemFilter {
    ic1eq: f32,
    ic2eq: f32,
    drive: f32,
}

impl SemFilter {
    pub fn new() -> Self {
        Self {
            ic1eq: 0.0,
            ic2eq: 0.0,
            drive: 0.0,
        }
    }

    pub fn set_drive(&mut self, drive: f32) {
        self.drive = drive;
    }

    pub fn reset(&mut self) {
        self.ic1eq = 0.0;
        self.ic2eq = 0.0;
    }

    /// Process one sample. `morph` controls filter character:
    /// 0.0=LP, 0.25=BP(low), 0.5=Notch, 0.75=BP(high), 1.0=HP
    #[inline]
    pub fn process(
        &mut self,
        input: f32,
        cutoff: f32,
        resonance: f32,
        morph: f32,
        sample_rate: f32,
    ) -> f32 {
        let g = (core::f32::consts::PI * cutoff.clamp(20.0, 20000.0) / sample_rate).tan();
        let k = 2.0 - resonance.clamp(0.0, 2.0); // invert: high resonance = low damping

        let x = if self.drive > 0.001 {
            fast_tanh(input * (1.0 + self.drive))
        } else {
            input
        };

        // SVF core (same as TPT but we extract all outputs)
        let v3 = x - self.ic2eq;
        let v1 = (self.ic1eq * k + v3) / (1.0 + k * g + g * g);
        let v2 = self.ic2eq + g * v1;
        self.ic1eq = flush_denormal(2.0 * v1 - self.ic1eq);
        self.ic2eq = flush_denormal(2.0 * v2 - self.ic2eq);

        // All four outputs
        let lp = v2;
        let hp = x - k * v1 - v2;
        let notch = lp + hp; // notch = LP + HP

        // Continuous morph
        let m = morph.clamp(0.0, 1.0);
        if m <= 0.5 {
            let t = m * 2.0;
            lp * (1.0 - t) + notch * t
        } else {
            let t = (m - 0.5) * 2.0;
            notch * (1.0 - t) + hp * t
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Ms20Filter;

    #[test]
    fn ms20_state_remains_finite_after_near_zero_excitation() {
        let mut filter = Ms20Filter::new();
        let mut peak = 0.0_f32;

        for frame in 0..48_000 {
            let input = if frame == 0 { 1e-12 } else { 0.0 };
            let output = filter.process(input, 20_000.0, 1.0, 48_000.0);
            assert!(
                output.is_finite(),
                "MS-20 state diverged at frame {frame}: {output}"
            );
            peak = peak.max(output.abs());
        }

        assert!(
            peak < 1e-6,
            "near-zero excitation grew to {peak}; the filter state is unstable"
        );
    }
}
