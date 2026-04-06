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

/// Maximum number of modal partials tracked per resonator bank.
/// 48 covers all bass partials below 22 kHz at 96 kHz sample rates and
/// aligns to 6 × f32x8 lanes.
pub const MAX_PARTIALS: usize = 48;

/// Struct-of-Arrays modal resonator bank. One instance represents one
/// polarization of one string.
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
    }

    pub fn active_partials(&self) -> usize {
        self.active_partials
    }

    /// Configure the bank for a given key.
    ///
    /// * `fundamental_hz` — Railsback-adjusted f1 in Hz for this unison.
    /// * `key` — 1-based piano key, used to look up inharmonicity `B`.
    /// * `hammer_strike_ratio` — fraction of string length at which the hammer
    ///   strikes (controls which partials are suppressed).
    /// * `sample_rate` — DSP sample rate in Hz.
    /// * `base_bandwidth_hz` — baseline partial bandwidth (drives decay).
    /// * `extra_damping_hz` — additional bandwidth added uniformly. Use this
    ///   for bridge coupling (fast polarization), damper lowering, una corda
    ///   attenuation, etc.
    pub fn configure(
        &mut self,
        fundamental_hz: f32,
        key: u32,
        hammer_strike_ratio: f32,
        sample_rate: f32,
        base_bandwidth_hz: f32,
        extra_damping_hz: f32,
    ) {
        use core::f32::consts::{PI, TAU};

        let b_coefficient = inharmonicity_b(key);
        let nyquist = sample_rate * 0.5;
        let mut active = 0;

        for index in 0..MAX_PARTIALS {
            let partial_number = (index + 1) as f32;
            let freq = fundamental_hz
                * partial_number
                * (1.0 + b_coefficient * partial_number * partial_number).sqrt();

            if freq >= nyquist * 0.98 {
                self.c0[index] = 0.0;
                self.c1[index] = 0.0;
                self.c2[index] = 0.0;
                continue;
            }

            // Spec §3.5: A_n ∝ sin(nπ · x_hammer / L) / n
            let amp = (partial_number * PI * hammer_strike_ratio).sin().abs() / partial_number;

            // Partial bandwidth grows with frequency to approximate the b₂·ω²
            // damping term from the full wave equation.
            let bandwidth = base_bandwidth_hz + 0.0008 * freq * freq.sqrt() + extra_damping_hz;
            let theta = TAU * freq / sample_rate;
            let r = (-PI * bandwidth / sample_rate).exp();

            self.c0[index] = amp * (1.0 - r * r) * theta.sin() * 0.5;
            self.c1[index] = 2.0 * r * theta.cos();
            self.c2[index] = -(r * r);
            active = index + 1;
        }

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

        for index in 0..self.active_partials {
            let partial_number = (index + 1) as f32;
            let freq = fundamental_hz
                * partial_number
                * (1.0 + b_coefficient * partial_number * partial_number).sqrt();
            if freq >= nyquist * 0.98 {
                continue;
            }
            let bandwidth = base_bandwidth_hz + 0.0008 * freq * freq.sqrt() + extra_damping_hz;
            let theta = TAU * freq / sample_rate;
            let r = (-PI * bandwidth / sample_rate).exp();
            self.c1[index] = 2.0 * r * theta.cos();
            self.c2[index] = -(r * r);
        }
    }

    /// Process one sample. Loop structure keeps arrays in cache and auto-
    /// vectorises on release builds.
    #[inline]
    pub fn tick(&mut self, input: f32) -> f32 {
        let mut output = 0.0_f32;
        let n = self.active_partials;
        // Tight inner loop over SoA arrays.
        for index in 0..n {
            let y = self.c0[index] * (input - self.x2[index])
                + self.c1[index] * self.y1[index]
                + self.c2[index] * self.y2[index];
            self.x2[index] = self.x1[index];
            self.x1[index] = input;
            self.y2[index] = self.y1[index];
            self.y1[index] = y;
            output += y;
        }
        output
    }

    /// Cheaper linear-model tick — used by progressive simplification (§4.1)
    /// once a voice has aged past the threshold. Reduces the effective partial
    /// count by half, keeping the loudest low partials (largest amp ∝ 1/n).
    #[inline]
    pub fn tick_simplified(&mut self, input: f32) -> f32 {
        let mut output = 0.0_f32;
        let n = (self.active_partials / 2).max(1);
        for index in 0..n {
            let y = self.c0[index] * (input - self.x2[index])
                + self.c1[index] * self.y1[index]
                + self.c2[index] * self.y2[index];
            self.x2[index] = self.x1[index];
            self.x1[index] = input;
            self.y2[index] = self.y1[index];
            self.y1[index] = y;
            output += y;
        }
        output
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

        let energy = |string: &mut ModalString| -> f32 {
            string.tick(1.0);
            let mut total = 0.0;
            for _ in 0..4_000 {
                total += string.tick(0.0).abs();
            }
            total
        };
        assert!(energy(&mut quiet_decay) > energy(&mut fast_decay));
    }
}
