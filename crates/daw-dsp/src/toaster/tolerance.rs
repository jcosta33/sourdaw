//! Component tolerance randomization.
//!
//! Applies jitter to circuit component values based on a deterministic seed,
//! mimicking the manufacturing tolerances of 1980s components:
//! - Capacitors: ±20% (ceramic, wide tolerance)
//! - Resistors: ±5% (carbon film)
//!
//! seed=0 means nominal values — identical output every time.
//! Jitter is applied once at construction; component values are stored as fields.

/// Apply component tolerance jitter to a nominal value.
///
/// Returns a value within `±tolerance_fraction` of `nominal`.
/// Uses a simple xorshift32 PRNG seeded from `seed`.
///
/// - `nominal`: the datasheet component value
/// - `tolerance_fraction`: e.g. 0.20 for ±20%, 0.05 for ±5%
/// - `seed`: deterministic PRNG seed; 0 means return nominal unchanged
pub fn apply_tolerance(nominal: f32, tolerance_fraction: f32, state: &mut u32) -> f32 {
    if *state == 0 {
        return nominal;
    }

    // xorshift32 PRNG step
    let mut x = *state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    *state = x;

    // Convert to [-1, 1] range
    let jitter = (x as i32 as f32) / (i32::MAX as f32);

    nominal * (1.0 + jitter * tolerance_fraction)
}

/// Initialize a PRNG state from a seed.
/// seed=0 is a special sentinel meaning "nominal values" — we map it to 0 so
/// apply_tolerance returns nominal unchanged.
pub fn prng_state(seed: u32) -> u32 {
    seed
}

/// Apply capacitor tolerance (±20%) to a nominal value.
pub fn cap(nominal: f32, state: &mut u32) -> f32 {
    apply_tolerance(nominal, 0.20, state)
}

/// Apply resistor tolerance (±5%) to a nominal value.
pub fn res(nominal: f32, state: &mut u32) -> f32 {
    apply_tolerance(nominal, 0.05, state)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tolerance with seed=0 returns nominal values exactly.
    #[test]
    fn tolerance_seed_zero_returns_nominal() {
        let mut state = prng_state(0);
        assert_eq!(apply_tolerance(1000.0, 0.05, &mut state), 1000.0);
        assert_eq!(apply_tolerance(15e-9, 0.20, &mut state), 15e-9);
        assert_eq!(apply_tolerance(47_000.0, 0.05, &mut state), 47_000.0);
    }

    /// Tolerance with seed=42 and seed=43 produces different values.
    #[test]
    fn tolerance_different_seeds_produce_different_values() {
        let mut state_42 = prng_state(42);
        let mut state_43 = prng_state(43);

        let val_42 = apply_tolerance(1000.0, 0.05, &mut state_42);
        let val_43 = apply_tolerance(1000.0, 0.05, &mut state_43);

        assert_ne!(
            val_42, val_43,
            "Different seeds should produce different values"
        );
    }

    /// Tolerance jitter stays within ±20% for capacitors and ±5% for resistors.
    #[test]
    fn tolerance_jitter_within_bounds() {
        // Test capacitor tolerance
        for seed in [1u32, 42, 100, 999, 0x12345678] {
            let mut state = seed;
            for _ in 0..100 {
                let nominal = 15e-9_f32;
                let jittered = cap(nominal, &mut state);
                let ratio = jittered / nominal;
                assert!(
                    ratio >= 0.80 && ratio <= 1.20,
                    "Capacitor jitter ratio {ratio:.3} out of ±20% range for seed {seed}"
                );
            }
        }

        // Test resistor tolerance
        for seed in [1u32, 42, 100] {
            let mut state = seed;
            for _ in 0..100 {
                let nominal = 47_000.0_f32;
                let jittered = res(nominal, &mut state);
                let ratio = jittered / nominal;
                assert!(
                    ratio >= 0.95 && ratio <= 1.05,
                    "Resistor jitter ratio {ratio:.3} out of ±5% range for seed {seed}"
                );
            }
        }
    }

    /// Same seed always produces same sequence (determinism).
    #[test]
    fn tolerance_deterministic_same_seed() {
        let nominal = 1000.0_f32;
        let tolerance = 0.05;

        let mut state_a = prng_state(42);
        let mut state_b = prng_state(42);

        for _ in 0..10 {
            let a = apply_tolerance(nominal, tolerance, &mut state_a);
            let b = apply_tolerance(nominal, tolerance, &mut state_b);
            assert_eq!(a, b, "Same seed must produce identical sequence");
        }
    }
}
