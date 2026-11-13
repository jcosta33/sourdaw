//! Attack/release smoothing filters for gain reduction envelope.

use crate::primitives::{flush_denormal, pole_from_ms};

/// Branching smooth filter (Giannoulis et al.)
/// Applies separate one-pole coefficients for attack vs release.
pub struct BranchingSmoother {
    state: f32,
    attack_coeff: f32,
    release_coeff: f32,
}

impl BranchingSmoother {
    pub fn new(sample_rate: f32, attack_ms: f32, release_ms: f32) -> Self {
        Self {
            state: 0.0,
            attack_coeff: Self::ms_to_coeff(attack_ms, sample_rate),
            release_coeff: Self::ms_to_coeff(release_ms, sample_rate),
        }
    }

    pub fn set_attack(&mut self, ms: f32, sample_rate: f32) {
        self.attack_coeff = Self::ms_to_coeff(ms, sample_rate);
    }

    pub fn set_release(&mut self, ms: f32, sample_rate: f32) {
        self.release_coeff = Self::ms_to_coeff(ms, sample_rate);
    }

    /// Process one sample of gain computer output.
    /// gc is gain reduction in dB (negative = more compression).
    #[inline]
    pub fn process(&mut self, gc: f32) -> f32 {
        let coeff = if gc <= self.state {
            // Attack: more compression needed (gc more negative)
            self.attack_coeff
        } else {
            // Release: compression recovering
            self.release_coeff
        };
        self.state = flush_denormal(coeff * self.state + (1.0 - coeff) * gc);
        self.state
    }

    pub fn current(&self) -> f32 {
        self.state
    }

    pub fn reset(&mut self) {
        self.state = 0.0;
    }

    #[inline]
    fn ms_to_coeff(ms: f32, sample_rate: f32) -> f32 {
        if ms <= 0.0 {
            0.0
        } else {
            pole_from_ms(ms, sample_rate)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::BranchingSmoother;

    /// Zero and negative times are a coefficient of 0.0: the smoother jumps to
    /// its target in one sample.
    #[test]
    fn smoother_time_at_or_below_zero_is_a_coefficient_of_zero() {
        assert_eq!(BranchingSmoother::ms_to_coeff(0.0, 48_000.0), 0.0);
        assert_eq!(BranchingSmoother::ms_to_coeff(-1.0, 48_000.0), 0.0);
        assert_eq!(
            BranchingSmoother::ms_to_coeff(5.0, 48_000.0).to_bits(),
            0x3f7e_ef80
        );
    }
}
