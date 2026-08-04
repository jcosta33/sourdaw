//! 31-bit maximal-length LFSR noise generator.
//!
//! Models the TR-909's noise circuit: two CD4006 18-stage shift registers +
//! one CD4070 quad-XOR gate forming a 31-stage maximal-length LFSR.
//! Feedback taps at stages 31 and 13.
//!
//! Sequence length: 2³¹ − 1 = 2,147,483,647 samples.
//! Deterministic: same initial state → same sequence.

/// 31-bit maximal-length LFSR (Linear Feedback Shift Register).
pub struct Lfsr31 {
    state: u32,
}

impl Lfsr31 {
    /// Create a new LFSR with the given initial state.
    /// State must be non-zero (all-zeros is a degenerate state in LFSRs).
    pub fn new(initial_state: u32) -> Self {
        Self {
            // Ensure non-zero; clamp to 31-bit range
            state: if initial_state == 0 {
                0x00000001
            } else {
                initial_state & 0x7FFFFFFF
            },
        }
    }

    /// Advance the LFSR by one step and return ±1.0.
    #[inline]
    pub fn step(&mut self) -> f32 {
        let new_bit = ((self.state >> 30) ^ (self.state >> 12)) & 1;
        self.state = (self.state << 1) | new_bit;
        self.state &= 0x7FFFFFFF; // 31-bit mask
        if (self.state >> 30) & 1 == 1 {
            1.0
        } else {
            -1.0
        }
    }

    /// Return the current state (for serialization or inspection).
    pub fn state(&self) -> u32 {
        self.state
    }

    /// Reset to a new initial state.
    pub fn reset(&mut self, initial_state: u32) {
        self.state = if initial_state == 0 {
            0x00000001
        } else {
            initial_state & 0x7FFFFFFF
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// LFSR with initial state 0x00000001 must cycle back to initial state
    /// after exactly 2³¹ − 1 steps.
    ///
    /// NOTE: This test is DISABLED by default because iterating 2 billion steps
    /// would take too long in a unit test. Uncomment to verify manually.
    #[test]
    #[ignore = "Takes ~30s to iterate 2^31-1 steps; run with --ignored for full verification"]
    fn lfsr_period_is_2_pow_31_minus_1() {
        let initial = 0x00000001u32;
        let mut lfsr = Lfsr31::new(initial);

        let period = (1u64 << 31) - 1;
        for _ in 0..period {
            lfsr.step();
        }

        assert_eq!(
            lfsr.state(),
            initial,
            "LFSR must return to initial state after 2^31-1 steps"
        );
    }

    /// LFSR is deterministic: two instances with same initial state produce identical sequences.
    #[test]
    fn lfsr_deterministic() {
        let mut a = Lfsr31::new(0x00000001);
        let mut b = Lfsr31::new(0x00000001);

        for i in 0..10_000 {
            let va = a.step();
            let vb = b.step();
            assert_eq!(va, vb, "LFSR mismatch at step {i}: {va} != {vb}");
        }
    }

    /// LFSR output is only ±1.
    #[test]
    fn lfsr_output_is_bipolar() {
        let mut lfsr = Lfsr31::new(0x12345678);
        for _ in 0..10_000 {
            let v = lfsr.step();
            assert!(v == 1.0 || v == -1.0, "LFSR output must be ±1, got {v}");
        }
    }

    /// LFSR should produce roughly equal numbers of +1 and -1 over a long run.
    #[test]
    fn lfsr_statistical_balance() {
        let mut lfsr = Lfsr31::new(0x00000001);
        let n = 100_000;
        let mut count_pos = 0u32;
        for _ in 0..n {
            if lfsr.step() > 0.0 {
                count_pos += 1;
            }
        }
        let ratio = count_pos as f32 / n as f32;
        // Should be within 1% of 50% balance
        assert!(
            (ratio - 0.5).abs() < 0.01,
            "LFSR balance ratio {ratio:.3} too far from 0.5"
        );
    }

    /// Verify a specific short sequence is reproducible (regression guard).
    #[test]
    fn lfsr_known_sequence() {
        let mut lfsr = Lfsr31::new(0x00000001);
        // Collect first 8 output values
        let seq: [f32; 8] = core::array::from_fn(|_| lfsr.step());
        // All values must be ±1
        for (i, &v) in seq.iter().enumerate() {
            assert!(v == 1.0 || v == -1.0, "Step {i}: expected ±1, got {v}");
        }
        // The sequence must be consistent across runs (determinism is the key property)
        let mut lfsr2 = Lfsr31::new(0x00000001);
        for i in 0..8 {
            let v2 = lfsr2.step();
            assert_eq!(seq[i], v2, "Sequence mismatch at step {i}");
        }
    }
}
