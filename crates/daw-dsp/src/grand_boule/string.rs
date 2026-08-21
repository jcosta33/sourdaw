//! Modal string resonator for the Grand Boule piano.
//!
//! Implements the sum-of-biquads representation of a stiff piano string per
//! spec §3.5. Coefficients come from the impulse-invariant transform:
//!
//! ```text
//! θ = 2π·f_k / f_s
//! r = exp(-π·bw / f_s)
//! C0 = amp · (1 - r²) · sin(θ) / 2
//! C1 = 2·r·cos(θ)
//! C2 = -r²
//! y[n] = C0·(x[n] - x[n-2]) + C1·y[n-1] + C2·y[n-2]
//! ```
//!
//! Layout is **Struct-of-Arrays** (§7.3) with 64-byte alignment so the inner
//! loop auto-vectorises to 8-wide SIMD on release builds. All state is fixed
//! size — no allocations at tick time, no conditional branches in the hot
//! path beyond the partial-count cap.

use super::parameters::inharmonicity_b;
use crate::primitives::{flush_denormal, flush_denormal_f64};

/// Maximum number of modal partials tracked per resonator bank.
/// 80 covers partials up to ~20 kHz even for bass notes and aligns to
/// 10 × f32x8 SIMD lanes. Research (Pianoteq analysis) indicates 60–130
/// modes per note for best-in-class realism.
pub const MAX_PARTIALS: usize = 80;

/// Maximum number of low-frequency partials processed in f64 precision.
/// Per spec §7.3: "Use f64 for resonators below 200 Hz." Bass notes at
/// A0 (27.5 Hz) have up to 7 partials below 200 Hz; with 80 max partials
/// we keep 8 slots which is sufficient.
const MAX_F64_PARTIALS: usize = 8;

/// Physical inputs that derive a string modal bank's coefficients.
///
/// This deliberately carries only per-string quantities. The soundboard is a
/// separate resonator stage fed after the voice has rendered its bridge
/// signal, so soundboard controls and state cannot participate in string
/// coefficient derivation.
#[derive(Clone, Copy, Debug)]
pub(crate) struct StringModalParameters {
    fundamental_hz: f32,
    key: u32,
    hammer_strike_ratio: f32,
    sample_rate: f32,
    base_bandwidth_hz: f32,
}

impl StringModalParameters {
    pub(crate) const fn new(
        fundamental_hz: f32,
        key: u32,
        hammer_strike_ratio: f32,
        sample_rate: f32,
        base_bandwidth_hz: f32,
    ) -> Self {
        Self {
            fundamental_hz,
            key,
            hammer_strike_ratio,
            sample_rate,
            base_bandwidth_hz,
        }
    }
}

/// Struct-of-Arrays modal resonator bank. One instance represents one
/// polarization of one string.
///
/// Partials below 200 Hz are processed in f64 precision for numerical
/// stability with very narrow bandwidths (spec §7.3). The f64 partials
/// are stored separately and summed first before adding f32 partials.
#[repr(C, align(64))]
#[derive(Clone, Debug)]
pub struct ModalString {
    c0: [f32; MAX_PARTIALS],
    c1: [f32; MAX_PARTIALS],
    c2: [f32; MAX_PARTIALS],
    x1: [f32; MAX_PARTIALS],
    x2: [f32; MAX_PARTIALS],
    y1: [f32; MAX_PARTIALS],
    y2: [f32; MAX_PARTIALS],
    /// f64-precision coefficients and state for low-frequency partials.
    c0_64: [f64; MAX_F64_PARTIALS],
    c1_64: [f64; MAX_F64_PARTIALS],
    c2_64: [f64; MAX_F64_PARTIALS],
    x1_64: [f64; MAX_F64_PARTIALS],
    x2_64: [f64; MAX_F64_PARTIALS],
    y1_64: [f64; MAX_F64_PARTIALS],
    y2_64: [f64; MAX_F64_PARTIALS],
    /// Number of partials processed in f64 (those below 200 Hz).
    f64_partials: usize,
    active_partials: usize,
    /// Damping mode: if true, bandwidth is scaled up by the damper state,
    /// which produces a faster decay (applied via re-configure).
    pub damped: bool,
}

impl ModalString {
    pub fn new() -> Self {
        Self {
            c0: [0.0; MAX_PARTIALS],
            c1: [0.0; MAX_PARTIALS],
            c2: [0.0; MAX_PARTIALS],
            x1: [0.0; MAX_PARTIALS],
            x2: [0.0; MAX_PARTIALS],
            y1: [0.0; MAX_PARTIALS],
            y2: [0.0; MAX_PARTIALS],
            c0_64: [0.0; MAX_F64_PARTIALS],
            c1_64: [0.0; MAX_F64_PARTIALS],
            c2_64: [0.0; MAX_F64_PARTIALS],
            x1_64: [0.0; MAX_F64_PARTIALS],
            x2_64: [0.0; MAX_F64_PARTIALS],
            y1_64: [0.0; MAX_F64_PARTIALS],
            y2_64: [0.0; MAX_F64_PARTIALS],
            f64_partials: 0,
            active_partials: 0,
            damped: false,
        }
    }

    /// Clear all biquad states (called when a voice is recycled).
    pub fn reset(&mut self) {
        self.x1.fill(0.0);
        self.x2.fill(0.0);
        self.y1.fill(0.0);
        self.y2.fill(0.0);
        self.x1_64.fill(0.0);
        self.x2_64.fill(0.0);
        self.y1_64.fill(0.0);
        self.y2_64.fill(0.0);
    }

    pub fn active_partials(&self) -> usize {
        self.active_partials
    }

    /// Configure the bank for a given key.
    ///
    /// This retained scalar API is a compatibility wrapper for existing Rust
    /// callers. Grand Boule's own voice path uses
    /// [`Self::configure_from_string_parameters`] so coefficient derivation is
    /// explicit at the string boundary.
    pub fn configure(
        &mut self,
        fundamental_hz: f32,
        key: u32,
        hammer_strike_ratio: f32,
        sample_rate: f32,
        base_bandwidth_hz: f32,
        extra_damping_hz: f32,
    ) {
        self.configure_from_string_parameters(
            StringModalParameters::new(
                fundamental_hz,
                key,
                hammer_strike_ratio,
                sample_rate,
                base_bandwidth_hz,
            ),
            extra_damping_hz,
        );
    }

    /// Configure the bank from its complete per-string coefficient inputs.
    ///
    /// * `extra_damping_hz` — additional bandwidth added uniformly. Use this
    ///   for bridge coupling (fast polarization), damper lowering, una corda
    ///   attenuation, etc.
    pub(crate) fn configure_from_string_parameters(
        &mut self,
        parameters: StringModalParameters,
        extra_damping_hz: f32,
    ) {
        use core::f32::consts::{PI, TAU};

        let b_coefficient = inharmonicity_b(parameters.key);
        let nyquist = parameters.sample_rate * 0.5;
        let mut active = 0;
        let mut f64_count = 0_usize;

        for index in 0..MAX_PARTIALS {
            let partial_number = (index + 1) as f32;
            let freq = parameters.fundamental_hz
                * partial_number
                * (1.0 + b_coefficient * partial_number * partial_number).sqrt();

            if freq >= nyquist * 0.98 {
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                continue;
            }

            // Spec §3.5: A_n ∝ sin(nπ · x_hammer / L) / n
            let amp = (partial_number * PI * parameters.hammer_strike_ratio)
                .sin()
                .abs()
                / partial_number;

            // Partial bandwidth grows with frequency to approximate the b₂·ω²
            // damping term from the full wave equation. The coefficient is kept
            // small so that fundamentals ring for realistic durations (~10–20 s
            // at A4) while upper partials decay progressively faster (natural
            // brightness roll-off).
            let bandwidth =
                parameters.base_bandwidth_hz + 0.000005 * freq * freq.sqrt() + extra_damping_hz;

            // §7.3: Use f64 for resonators below 200 Hz for numerical stability
            // with very narrow bandwidths.
            if freq < 200.0 && f64_count < MAX_F64_PARTIALS {
                let freq64 = freq as f64;
                let sr64 = parameters.sample_rate as f64;
                let amp64 = amp as f64;
                let bw64 = bandwidth as f64;
                let theta64 = core::f64::consts::TAU * freq64 / sr64;
                let r64 = (-core::f64::consts::PI * bw64 / sr64).exp();
                self.c0_64[f64_count] = amp64 * (1.0 - r64 * r64) * theta64.sin() * 0.5;
                self.c1_64[f64_count] = 2.0 * r64 * theta64.cos();
                self.c2_64[f64_count] = -(r64 * r64);
                // Zero out the f32 slot so it doesn't double-contribute.
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                f64_count += 1;
            } else {
                let theta = TAU * freq / parameters.sample_rate;
                let r = (-PI * bandwidth / parameters.sample_rate).exp();
                self.c0[index] = amp * (1.0 - r * r) * theta.sin() * 0.5;
                self.c1[index] = 2.0 * r * theta.cos();
                self.c2[index] = -(r * r);
            }
            active = index + 1;
        }

        self.f64_partials = f64_count;
        self.active_partials = active;
    }

    /// Configure the bank as an aftersound (slow) polarization.
    ///
    /// Uses `c0_bandwidth_hz` for the input gain C0 (matching the fast
    /// polarization so the impulse response starts at the same amplitude)
    /// and `decay_bandwidth_hz` for C1/C2 (controlling the slow decay).
    /// This correctly models the bridge-mediated energy transfer where the
    /// horizontal polarization picks up energy at the resonant frequency
    /// with the same efficiency as the vertical, but releases it far more
    /// slowly (Weinreich 1977, §3.4).
    /// Compatibility wrapper for existing Rust callers of the aftersound
    /// scalar API. Grand Boule's own voice path uses
    /// [`Self::configure_aftersound_from_string_parameters`].
    pub fn configure_aftersound(
        &mut self,
        fundamental_hz: f32,
        key: u32,
        hammer_strike_ratio: f32,
        sample_rate: f32,
        base_bandwidth_hz: f32,
        c0_bandwidth_hz: f32,
        decay_bandwidth_hz: f32,
    ) {
        self.configure_aftersound_from_string_parameters(
            StringModalParameters::new(
                fundamental_hz,
                key,
                hammer_strike_ratio,
                sample_rate,
                base_bandwidth_hz,
            ),
            c0_bandwidth_hz,
            decay_bandwidth_hz,
        );
    }

    pub(crate) fn configure_aftersound_from_string_parameters(
        &mut self,
        parameters: StringModalParameters,
        c0_bandwidth_hz: f32,
        decay_bandwidth_hz: f32,
    ) {
        use core::f32::consts::{PI, TAU};

        let b_coefficient = inharmonicity_b(parameters.key);
        let nyquist = parameters.sample_rate * 0.5;
        let mut active = 0;
        let mut f64_count = 0_usize;

        for index in 0..MAX_PARTIALS {
            let partial_number = (index + 1) as f32;
            let freq = parameters.fundamental_hz
                * partial_number
                * (1.0 + b_coefficient * partial_number * partial_number).sqrt();

            if freq >= nyquist * 0.98 {
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                continue;
            }

            let amp = (partial_number * PI * parameters.hammer_strike_ratio)
                .sin()
                .abs()
                / partial_number;
            let bw_freq = 0.000005 * freq * freq.sqrt();
            // C0 uses the fast bandwidth for matched impulse response amplitude.
            let bw_c0 = parameters.base_bandwidth_hz + bw_freq + c0_bandwidth_hz;
            // C1/C2 use the slow bandwidth for long decay.
            let bw_decay = parameters.base_bandwidth_hz + bw_freq + decay_bandwidth_hz;

            if freq < 200.0 && f64_count < MAX_F64_PARTIALS {
                let freq64 = freq as f64;
                let sr64 = parameters.sample_rate as f64;
                let amp64 = amp as f64;
                let theta64 = core::f64::consts::TAU * freq64 / sr64;
                let r_c0 = (-core::f64::consts::PI * bw_c0 as f64 / sr64).exp();
                let r_decay = (-core::f64::consts::PI * bw_decay as f64 / sr64).exp();
                self.c0_64[f64_count] = amp64 * (1.0 - r_c0 * r_c0) * theta64.sin() * 0.5;
                self.c1_64[f64_count] = 2.0 * r_decay * theta64.cos();
                self.c2_64[f64_count] = -(r_decay * r_decay);
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                f64_count += 1;
            } else {
                let theta = TAU * freq / parameters.sample_rate;
                let r_c0 = (-PI * bw_c0 / parameters.sample_rate).exp();
                let r_decay = (-PI * bw_decay / parameters.sample_rate).exp();
                self.c0[index] = amp * (1.0 - r_c0 * r_c0) * theta.sin() * 0.5;
                self.c1[index] = 2.0 * r_decay * theta.cos();
                self.c2[index] = -(r_decay * r_decay);
            }
            active = index + 1;
        }

        self.f64_partials = f64_count;
        self.active_partials = active;
    }

    /// Update the decay coefficients (C1/C2) without touching amplitudes.
    /// Used when damper state changes mid-note.
    pub fn reset_decay(
        &mut self,
        fundamental_hz: f32,
        key: u32,
        sample_rate: f32,
        base_bandwidth_hz: f32,
        extra_damping_hz: f32,
    ) {
        use core::f32::consts::{PI, TAU};
        let b_coefficient = inharmonicity_b(key);
        let nyquist = sample_rate * 0.5;
        let mut f64_idx = 0_usize;

        for index in 0..self.active_partials {
            let partial_number = (index + 1) as f32;
            let freq = fundamental_hz
                * partial_number
                * (1.0 + b_coefficient * partial_number * partial_number).sqrt();
            if freq >= nyquist * 0.98 {
                continue;
            }
            let bandwidth = base_bandwidth_hz + 0.000005 * freq * freq.sqrt() + extra_damping_hz;
            if freq < 200.0 && f64_idx < self.f64_partials {
                let freq64 = freq as f64;
                let sr64 = sample_rate as f64;
                let bw64 = bandwidth as f64;
                let theta64 = core::f64::consts::TAU * freq64 / sr64;
                let r64 = (-core::f64::consts::PI * bw64 / sr64).exp();
                self.c1_64[f64_idx] = 2.0 * r64 * theta64.cos();
                self.c2_64[f64_idx] = -(r64 * r64);
                f64_idx += 1;
            } else {
                let theta = TAU * freq / sample_rate;
                let r = (-PI * bandwidth / sample_rate).exp();
                self.c1[index] = 2.0 * r * theta.cos();
                self.c2[index] = -(r * r);
            }
        }
    }

    /// Process one sample. f64 partials (below 200 Hz) are processed first
    /// for numerical stability (§7.3), then f32 partials via the SIMD-friendly
    /// SoA loop.
    #[inline]
    pub fn tick(&mut self, input: f32) -> f32 {
        let mut output = 0.0_f32;

        // f64-precision partials (below 200 Hz).
        let input_64 = input as f64;
        let n64 = self.f64_partials;
        for index in 0..n64 {
            let y = self.c0_64[index] * (input_64 - self.x2_64[index])
                + self.c1_64[index] * self.y1_64[index]
                + self.c2_64[index] * self.y2_64[index];
            self.x2_64[index] = self.x1_64[index];
            self.x1_64[index] = input_64;
            self.y2_64[index] = self.y1_64[index];
            self.y1_64[index] = flush_denormal_f64(y);
            output += y as f32;
        }

        // f32-precision partials (200 Hz and above). Tight inner loop over
        // SoA arrays for auto-vectorization. Partials below 200 Hz occupy the
        // first `f64_partials` slots and had their f32 coefficients zeroed by
        // `configure`, so starting there skips slots that can only ever add
        // zero — up to 8 wasted iterations per unison per polarization.
        let n = self.active_partials;
        for index in self.f64_partials..n {
            let y = self.c0[index] * (input - self.x2[index])
                + self.c1[index] * self.y1[index]
                + self.c2[index] * self.y2[index];
            self.x2[index] = self.x1[index];
            self.x1[index] = input;
            self.y2[index] = self.y1[index];
            self.y1[index] = flush_denormal(y);
            output += y;
        }
        output
    }

    /// Cheaper linear-model tick — used by progressive simplification (§4.1)
    /// once a voice has aged past the threshold. Reduces the effective partial
    /// count by half, keeping the loudest low partials (largest amp ∝ 1/n).
    /// f64 partials are always processed in full (they are already few).
    #[inline]
    pub fn tick_simplified(&mut self, input: f32) -> f32 {
        let mut output = 0.0_f32;

        // Always process f64 partials in full (max 8, negligible cost).
        let input_64 = input as f64;
        let n64 = self.f64_partials;
        for index in 0..n64 {
            let y = self.c0_64[index] * (input_64 - self.x2_64[index])
                + self.c1_64[index] * self.y1_64[index]
                + self.c2_64[index] * self.y2_64[index];
            self.x2_64[index] = self.x1_64[index];
            self.x1_64[index] = input_64;
            self.y2_64[index] = self.y1_64[index];
            self.y1_64[index] = flush_denormal_f64(y);
            output += y as f32;
        }

        let n = (self.active_partials / 2).max(1);
        for index in 0..n {
            let y = self.c0[index] * (input - self.x2[index])
                + self.c1[index] * self.y1[index]
                + self.c2[index] * self.y2[index];
            self.x2[index] = self.x1[index];
            self.x1[index] = input;
            self.y2[index] = self.y1[index];
            self.y1[index] = flush_denormal(y);
            output += y;
        }
        output
    }

    #[cfg(test)]
    pub(crate) fn coefficient_signature(&self) -> u64 {
        fn mix(signature: u64, coefficient: u64) -> u64 {
            signature
                .wrapping_mul(1_099_511_628_211)
                .wrapping_add(coefficient)
        }

        let mut signature = 14_695_981_039_346_656_037_u64;
        for coefficients in [&self.c0, &self.c1, &self.c2] {
            for coefficient in coefficients {
                signature = mix(signature, coefficient.to_bits() as u64);
            }
        }
        for coefficients in [&self.c0_64, &self.c1_64, &self.c2_64] {
            for coefficient in coefficients {
                signature = mix(signature, coefficient.to_bits());
            }
        }
        signature = mix(signature, self.f64_partials as u64);
        signature = mix(signature, self.active_partials as u64);
        signature
    }
}

impl Default for ModalString {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_bank_outputs_zero() {
        let mut string = ModalString::new();
        assert_eq!(string.tick(1.0), 0.0);
    }

    #[test]
    fn configured_bank_rings() {
        let mut string = ModalString::new();
        string.configure(440.0, 49, 0.125, 48_000.0, 0.3, 0.0);
        let first = string.tick(1.0);
        let mut peak = first.abs();
        for _ in 0..1_000 {
            peak = peak.max(string.tick(0.0).abs());
        }
        assert!(peak > 0.0);
    }

    #[test]
    fn extra_damping_shortens_decay() {
        let mut quiet_decay = ModalString::new();
        let mut fast_decay = ModalString::new();
        quiet_decay.configure(220.0, 25, 0.125, 48_000.0, 0.25, 0.0);
        fast_decay.configure(220.0, 25, 0.125, 48_000.0, 0.25, 30.0);

        // Measure late-tail energy (skip the attack) so the faster decay
        // dominates over the C0 gain increase from wider bandwidth.
        let late_energy = |string: &mut ModalString| -> f32 {
            string.tick(1.0);
            for _ in 0..4_000 {
                let _ = string.tick(0.0);
            }
            let mut total = 0.0;
            for _ in 0..8_000 {
                total += string.tick(0.0).abs();
            }
            total
        };
        assert!(late_energy(&mut quiet_decay) > late_energy(&mut fast_decay));
    }
}
