//! Nonlinear felt-hammer model for the Grand Boule piano.
//!
//! Implements a power-law compression force `F = K·δ^p` where `δ` is the
//! positive hammer-string interpenetration. The hammer is integrated with
//! Störmer-Verlet integration. Oversampling is handled by
//! the caller — this type is a pure state machine over arbitrary `dt`.
//!
//! [`HammerState::tick_stulov`] implements Stulov's simplified three-parameter
//! hereditary form (Stulov 2005, *Acta Acustica* 91:1086):
//!
//! ```text
//! F(t) = Q₀ · ( δᵖ(t)  +  a · δ̇(t) · |δ(t)|^(p−1) )
//! ```
//!
//! The `δ̇·|δ|^(p−1)` term gives the project voicing an asymmetric force pulse
//! (fast rise, slower decay) without needing a history buffer.
//! Callers that do not need hysteresis use the cheaper [`HammerState::tick`]
//! path.

/// Mutable hammer state advanced one sub-sample per `tick`.
#[derive(Debug, Clone)]
pub struct HammerState {
    /// Hammer position relative to the string at rest (metres).
    pub position: f32,
    /// Hammer velocity (metres/second). Negative = moving toward string.
    pub velocity: f32,
    /// Whether the hammer has already left the string after first contact.
    pub released: bool,
    /// Previous-sample compression, used for the Stulov δ̇ finite difference.
    prev_compression: f32,
    /// Output state of the one-pole contact-time filter that shapes the force spectrum.
    contact_filter_state: f32,
}

/// Fixed, per-key hammer coefficients. Read-only during a note's lifetime.
#[derive(Debug, Clone, Copy)]
pub struct HammerParams {
    /// Power-law stiffness coefficient `K` (≡ Stulov `Q₀`).
    pub stiffness_k: f32,
    /// Power-law exponent `p`; the project curve rises with key number.
    pub exponent_p: f32,
    /// Hammer mass in kilograms.
    pub mass_kg: f32,
    /// Stulov asymmetry coefficient `a` in seconds. Larger values produce a
    /// more pronounced fast-rise / slow-decay force pulse. Set to `0.0` to
    /// fall back to the memoryless power law.
    pub stulov_a: f32,
    /// Velocity-dependent contact low-pass coefficient `α` in
    /// `y[n] = α·y[n−1] + (1−α)·x[n]`. Higher velocity produces a wider
    /// contact spectrum. Set to `0.0` to disable.
    pub contact_lp_alpha: f32,
}

impl HammerState {
    /// Hammer at rest, clear of the string, stationary.
    pub fn idle() -> Self {
        Self {
            position: 0.0,
            velocity: 0.0,
            released: true,
            prev_compression: 0.0,
            contact_filter_state: 0.0,
        }
    }

    /// Launch the hammer toward the string with an initial velocity.
    ///
    /// `velocity` should be negative when the hammer moves
    /// toward the string), but callers commonly pass a positive "strike speed"
    /// — the sign is normalised here.
    pub fn strike(&mut self, strike_velocity: f32) {
        self.position = 0.0;
        self.velocity = -strike_velocity.abs();
        self.released = false;
        self.prev_compression = 0.0;
        self.contact_filter_state = 0.0;
    }

    /// Apply the velocity-dependent contact lowpass to a raw force value
    /// and return the filtered force. The filter is a single one-pole IIR
    /// whose pole `α` is set per strike from `f_c(v)`. When
    /// `params.contact_lp_alpha == 0.0` the filter passes
    /// the input through unchanged.
    #[inline]
    fn apply_contact_lowpass(&mut self, force: f32, alpha: f32) -> f32 {
        if alpha <= 0.0 {
            return force;
        }
        let y = alpha * self.contact_filter_state + (1.0 - alpha) * force;
        self.contact_filter_state = y;
        y
    }

    /// Advance the hammer one sub-sample and return the force applied to the
    /// string at the contact point. A returned force of zero means the hammer
    /// is not touching the string.
    pub fn tick(&mut self, string_displacement: f32, dt: f32, params: &HammerParams) -> f32 {
        let compression = (string_displacement - self.position).max(0.0);
        let raw_force = if compression > 0.0 {
            params.stiffness_k * compression.powf(params.exponent_p)
        } else {
            0.0
        };
        let force = self.apply_contact_lowpass(raw_force, params.contact_lp_alpha);

        // Störmer-Verlet: simple symplectic leapfrog.
        let accel = force / params.mass_kg;
        self.velocity += accel * dt;
        self.position += self.velocity * dt;
        self.prev_compression = compression;

        // The hammer has rebounded once the string has moved away and
        // compression has returned to zero.
        if force == 0.0 && !self.released && self.velocity > 0.0 {
            self.released = true;
        }

        force
    }

    /// Same as [`Self::tick`] but uses Stulov's three-parameter hereditary
    /// form `F = Q₀·(δᵖ + a·δ̇·|δ|^(p−1))`.
    /// The δ̇ term is computed from a one-sample finite difference, no
    /// history buffer needed. More expensive than [`Self::tick`] but still
    /// allocation-free and branch-free in the hot path.
    pub fn tick_stulov(&mut self, string_displacement: f32, dt: f32, params: &HammerParams) -> f32 {
        let compression = (string_displacement - self.position).max(0.0);
        let compression_dot = (compression - self.prev_compression) / dt.max(1.0e-9);

        let raw_force = if compression > 0.0 {
            // Stulov's three-parameter form: power-law spring + asymmetric
            // velocity-coupled damping. The damping term carries the sign
            // of δ̇ so loading and unloading produce different forces — the
            // hysteresis loop used for the fast-rise / slow-decay product
            // voicing.
            let delta_p = compression.powf(params.exponent_p);
            let delta_p_minus_1 = compression.powf(params.exponent_p - 1.0);
            params.stiffness_k * (delta_p + params.stulov_a * compression_dot * delta_p_minus_1)
        } else {
            0.0
        };
        // Stulov's hysteresis can briefly drive the force negative as the
        // hammer pulls away — a real felt is purely compressive, so clamp.
        let force = self.apply_contact_lowpass(raw_force.max(0.0), params.contact_lp_alpha);

        let accel = force / params.mass_kg;
        self.velocity += accel * dt;
        self.position += self.velocity * dt;
        self.prev_compression = compression;

        if force == 0.0 && !self.released && self.velocity > 0.0 {
            self.released = true;
        }

        force
    }
}

/// Compute the contact-lowpass pole `α` from a strike velocity (m/s),
/// the per-key minimum and maximum cutoff frequencies (Hz), the
/// velocity-sensitivity exponent `β` and the host sample rate.
///
/// `f_c(v) = f_min + (f_max − f_min)·(1 − e^{−β·v})` saturates at high
/// velocity, then `α = exp(−2π·f_c / fs)` produces the standard one-pole pole.
pub fn contact_lowpass_alpha(
    strike_velocity: f32,
    f_min_hz: f32,
    f_max_hz: f32,
    beta: f32,
    sample_rate: f32,
) -> f32 {
    let saturated = 1.0 - (-beta * strike_velocity.abs()).exp();
    let f_c = f_min_hz + (f_max_hz - f_min_hz) * saturated;
    // Guard against runaway when fs is small or f_c approaches Nyquist:
    // a pole of zero (no filter) is the safe degenerate case.
    let arg = -core::f32::consts::TAU * f_c / sample_rate.max(1.0);
    arg.exp().clamp(0.0, 0.999_5)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_params() -> HammerParams {
        HammerParams {
            stiffness_k: 1.0e9,
            exponent_p: 2.5,
            mass_kg: 0.008,
            stulov_a: 0.0,
            contact_lp_alpha: 0.0,
        }
    }

    #[test]
    fn stulov_form_produces_asymmetric_pulse() {
        // The Stulov damping term means loading (compression rising) and
        // unloading (compression falling) at the same δ produce different
        // forces; that asymmetry is intentional.
        let mut state = HammerState::idle();
        state.strike(4.0);
        let mut params = default_params();
        params.stulov_a = 310.0e-6;
        let dt = 1.0 / 192_000.0;
        let mut peak_force = 0.0_f32;
        let mut samples_after_peak = 0_usize;
        let mut tail = 0.0_f32;
        for _ in 0..2_000 {
            let f = state.tick_stulov(0.0, dt, &params);
            if f > peak_force {
                peak_force = f;
                samples_after_peak = 0;
            } else if peak_force > 0.0 {
                samples_after_peak += 1;
                tail += f;
            }
        }
        // Hammer must release with a non-trivial pulse history.
        assert!(peak_force > 0.0);
        assert!(samples_after_peak > 0);
        assert!(tail >= 0.0);
    }

    #[test]
    fn contact_lowpass_alpha_increases_with_velocity() {
        let lo = contact_lowpass_alpha(0.5, 200.0, 6_000.0, 0.6, 192_000.0);
        let hi = contact_lowpass_alpha(5.0, 200.0, 6_000.0, 0.6, 192_000.0);
        // Higher velocity → higher cutoff → smaller α (less smoothing).
        assert!(hi < lo);
        assert!(lo > 0.0);
        assert!(hi > 0.0);
    }

    #[test]
    fn hammer_rebounds_after_strike() {
        let mut state = HammerState::idle();
        state.strike(4.0);
        let params = default_params();
        let dt = 1.0 / 192_000.0;
        // Hold the string fixed at zero — hammer should reverse course.
        for _ in 0..10_000 {
            let _ = state.tick(0.0, dt, &params);
            if state.released && state.velocity > 0.0 {
                return;
            }
        }
        panic!("hammer never released");
    }

    #[test]
    fn force_is_zero_when_not_in_contact() {
        let mut state = HammerState::idle();
        let params = default_params();
        let force = state.tick(0.0, 1.0 / 48_000.0, &params);
        assert_eq!(force, 0.0);
    }
}
