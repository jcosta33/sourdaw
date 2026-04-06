//! Nonlinear felt-hammer model for the Grand Boule piano.
//!
//! Implements a power-law compression force `F = K·δ^p` where `δ` is the
//! positive hammer-string interpenetration. The hammer is integrated with
//! Störmer-Verlet (leapfrog) per the spec `§3.2`. Oversampling is handled by
//! the caller — this type is a pure state machine over arbitrary `dt`.
//!
//! A lightweight Stulov-style hysteresis term is available via
//! [`HammerState::tick_hysteresis`]. Callers that do not need it should use
//! the cheaper [`HammerState::tick`] path.

/// Mutable hammer state advanced one sub-sample per `tick`.
#[derive(Debug, Clone)]
pub struct HammerState {
    /// Hammer position relative to the string at rest (metres).
    pub position: f32,
    /// Hammer velocity (metres/second). Negative = moving toward string.
    pub velocity: f32,
    /// Whether the hammer has already left the string after first contact.
    pub released: bool,
    /// Low-pass-filtered compression rate for Stulov hysteresis.
    hysteresis_state: f32,
}

/// Fixed, per-key hammer coefficients. Read-only during a note's lifetime.
#[derive(Debug, Clone, Copy)]
pub struct HammerParams {
    /// Power-law stiffness coefficient `K`.
    pub stiffness_k: f32,
    /// Power-law exponent `p` (typically 2.0–3.5).
    pub exponent_p: f32,
    /// Hammer mass in kilograms.
    pub mass_kg: f32,
    /// Stulov hysteresis strength `ε₀` (0.0 disables hysteresis).
    pub hysteresis_epsilon: f32,
    /// Low-pass pole `α = exp(-Δt / t₀)` for the hysteresis tracker.
    pub hysteresis_alpha: f32,
}

impl HammerState {
    /// Hammer at rest, clear of the string, stationary.
    pub fn idle() -> Self {
        Self {
            position: 0.0,
            velocity: 0.0,
            released: true,
            hysteresis_state: 0.0,
        }
    }

    /// Launch the hammer toward the string with an initial velocity.
    ///
    /// `velocity` should be negative in the spec's convention (hammer moving
    /// toward the string), but callers commonly pass a positive "strike speed"
    /// — the sign is normalised here.
    pub fn strike(&mut self, strike_velocity: f32) {
        self.position = 0.0;
        self.velocity = -strike_velocity.abs();
        self.released = false;
        self.hysteresis_state = 0.0;
    }

    /// Advance the hammer one sub-sample and return the force applied to the
    /// string at the contact point. A returned force of zero means the hammer
    /// is not touching the string.
    pub fn tick(&mut self, string_displacement: f32, dt: f32, params: &HammerParams) -> f32 {
        let compression = (string_displacement - self.position).max(0.0);
        let force = if compression > 0.0 {
            params.stiffness_k * compression.powf(params.exponent_p)
        } else {
            0.0
        };

        // Störmer-Verlet: simple symplectic leapfrog.
        let accel = force / params.mass_kg;
        self.velocity += accel * dt;
        self.position += self.velocity * dt;

        // The hammer has rebounded once the string has moved away and
        // compression has returned to zero.
        if force == 0.0 && !self.released && self.velocity > 0.0 {
            self.released = true;
        }

        force
    }

    /// Same as [`Self::tick`] but applies a Stulov hysteresis correction.
    /// More expensive — reserve for the highest-quality setting.
    pub fn tick_hysteresis(
        &mut self,
        string_displacement: f32,
        dt: f32,
        params: &HammerParams,
    ) -> f32 {
        let compression = (string_displacement - self.position).max(0.0);
        let compression_rate = (compression - self.hysteresis_state) / dt.max(1.0e-9);
        self.hysteresis_state = params.hysteresis_alpha * self.hysteresis_state
            + (1.0 - params.hysteresis_alpha) * compression;

        let base = if compression > 0.0 {
            params.stiffness_k * compression.powf(params.exponent_p)
        } else {
            0.0
        };
        let correction =
            1.0 - params.hysteresis_epsilon * compression_rate / compression.max(1.0e-6);
        let force = base * correction.max(0.0);

        let accel = force / params.mass_kg;
        self.velocity += accel * dt;
        self.position += self.velocity * dt;

        if force == 0.0 && !self.released && self.velocity > 0.0 {
            self.released = true;
        }

        force
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_params() -> HammerParams {
        HammerParams {
            stiffness_k: 1.0e9,
            exponent_p: 2.5,
            mass_kg: 0.008,
            hysteresis_epsilon: 0.0,
            hysteresis_alpha: 0.9,
        }
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
