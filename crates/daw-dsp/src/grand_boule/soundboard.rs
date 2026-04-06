//! Parametric soundboard resonance bank for the Grand Boule piano.
//!
//! Implements §3.6 Option C — a bank of ~192 parallel biquad resonators
//! tuned to a plausible piano soundboard mode distribution. The soundboard
//! is a single global element (one per engine, not per voice) driven by the
//! aggregate bridge force of all active voices.
//!
//! The bank is stereo: every mode gets an independent L/R gain pair drawn at
//! construction time, so the soundboard imparts a natural stereo spread
//! without any post-processing.
//!
//! Struct-of-Arrays layout mirrors [`super::string::ModalString`] for the
//! same SIMD auto-vectorisation properties.

/// Number of soundboard modes. 192 = 24 × 8 for `f32x8` SIMD alignment and
/// sits near the upper end of the spec's 100–200 range.
pub const SOUNDBOARD_MODES: usize = 192;

/// Lowest soundboard resonance (Hz). Roughly matches the lowest plate mode
/// of a full-size grand piano.
const MODE_MIN_HZ: f32 = 45.0;

/// Highest soundboard resonance (Hz). Modes above this frequency blend into
/// the radiation HF hump and contribute little.
const MODE_MAX_HZ: f32 = 7_800.0;

/// Frequency-independent input-drive coefficient. The bank is normalised so
/// that flat-noise excitation produces roughly unity RMS output at the
/// reference sample rate.
const DRIVE: f32 = 0.015;

#[repr(C, align(64))]
#[derive(Clone, Debug)]
pub struct Soundboard {
    c0: [f32; SOUNDBOARD_MODES],
    c1: [f32; SOUNDBOARD_MODES],
    c2: [f32; SOUNDBOARD_MODES],
    gain_left: [f32; SOUNDBOARD_MODES],
    gain_right: [f32; SOUNDBOARD_MODES],
    x1: [f32; SOUNDBOARD_MODES],
    x2: [f32; SOUNDBOARD_MODES],
    y1: [f32; SOUNDBOARD_MODES],
    y2: [f32; SOUNDBOARD_MODES],
    sample_rate: f32,
}

impl Soundboard {
    /// Construct a soundboard with a deterministic mode distribution.
    /// Allocation-free: all arrays live inline.
    pub fn new(sample_rate: f32) -> Self {
        let mut board = Self {
            c0: [0.0; SOUNDBOARD_MODES],
            c1: [0.0; SOUNDBOARD_MODES],
            c2: [0.0; SOUNDBOARD_MODES],
            gain_left: [0.0; SOUNDBOARD_MODES],
            gain_right: [0.0; SOUNDBOARD_MODES],
            x1: [0.0; SOUNDBOARD_MODES],
            x2: [0.0; SOUNDBOARD_MODES],
            y1: [0.0; SOUNDBOARD_MODES],
            y2: [0.0; SOUNDBOARD_MODES],
            sample_rate,
        };
        board.rebuild_modes();
        board
    }

    /// Clear all biquad states (engine reset).
    pub fn reset(&mut self) {
        self.x1.fill(0.0);
        self.x2.fill(0.0);
        self.y1.fill(0.0);
        self.y2.fill(0.0);
    }

    /// Rebuild mode coefficients. Called from `new` and whenever the sample
    /// rate changes.
    pub fn rebuild_modes(&mut self) {
        use core::f32::consts::{PI, TAU};

        let nyquist = self.sample_rate * 0.5;
        // Deterministic LCG — we do not need cryptographic quality, only
        // repeatable jitter so that every instance of the plugin sounds
        // identical and allocation-free.
        let mut rng_state: u32 = 0x1234_5678;
        let mut next_rand = || -> f32 {
            rng_state = rng_state
                .wrapping_mul(1_664_525)
                .wrapping_add(1_013_904_223);
            (rng_state >> 8) as f32 / (1 << 24) as f32
        };

        let log_min = MODE_MIN_HZ.ln();
        let log_max = MODE_MAX_HZ.ln();
        for index in 0..SOUNDBOARD_MODES {
            // Log-spaced base frequency with up to ±15% jitter.
            let fraction = index as f32 / (SOUNDBOARD_MODES - 1) as f32;
            let log_f = log_min + fraction * (log_max - log_min);
            let jitter = 1.0 + 0.15 * (2.0 * next_rand() - 1.0);
            let freq = log_f.exp() * jitter;
            let freq = freq.clamp(MODE_MIN_HZ, nyquist * 0.98);

            // Soundboard Q: ~40 at bass, ~200 at treble. Higher Q modes in
            // the midrange give the characteristic "zing" of a grand.
            let q_mid_bias = 1.0 - ((fraction - 0.55).abs() * 2.0).min(1.0);
            let q = 40.0 + 160.0 * q_mid_bias;
            let bandwidth = freq / q;

            let theta = TAU * freq / self.sample_rate;
            let r = (-PI * bandwidth / self.sample_rate).exp();

            // Amplitude rolls off slightly with frequency (~ -3 dB/oct).
            let amp = 1.0 / freq.sqrt();

            self.c0[index] = DRIVE * amp * (1.0 - r * r) * theta.sin() * 0.5;
            self.c1[index] = 2.0 * r * theta.cos();
            self.c2[index] = -(r * r);

            // Stereo spread: random L/R balance, sum of squares = 1.
            let pan = next_rand();
            let angle = pan * PI * 0.5;
            self.gain_left[index] = angle.cos();
            self.gain_right[index] = angle.sin();
        }
    }

    /// Process one sample of bridge input and return a stereo soundboard pair.
    #[inline]
    pub fn tick(&mut self, input: f32) -> (f32, f32) {
        let mut left = 0.0_f32;
        let mut right = 0.0_f32;
        for index in 0..SOUNDBOARD_MODES {
            let y = self.c0[index] * (input - self.x2[index])
                + self.c1[index] * self.y1[index]
                + self.c2[index] * self.y2[index];
            self.x2[index] = self.x1[index];
            self.x1[index] = input;
            self.y2[index] = self.y1[index];
            self.y1[index] = y;
            left += self.gain_left[index] * y;
            right += self.gain_right[index] * y;
        }
        (left, right)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn soundboard_constructs_with_all_modes() {
        let board = Soundboard::new(48_000.0);
        // Every coefficient should be set — no zeros left over.
        let zeros = board.c1.iter().filter(|&&v| v == 0.0).count();
        assert_eq!(zeros, 0);
    }

    #[test]
    fn impulse_response_decays() {
        let mut board = Soundboard::new(48_000.0);
        let (l0, r0) = board.tick(1.0);
        let initial_energy = l0.abs() + r0.abs();
        // Run long enough for even the narrowest modes to decay audibly.
        let mut late_energy = 0.0_f32;
        for _ in 0..48_000 {
            let _ = board.tick(0.0);
        }
        for _ in 0..4_800 {
            let (l, r) = board.tick(0.0);
            late_energy += l.abs() + r.abs();
        }
        assert!(initial_energy > 0.0);
        assert!(late_energy / 4_800.0 < initial_energy);
    }

    #[test]
    fn silent_input_produces_no_output_after_reset() {
        let mut board = Soundboard::new(48_000.0);
        board.reset();
        let (l, r) = board.tick(0.0);
        assert_eq!(l, 0.0);
        assert_eq!(r, 0.0);
    }

    #[test]
    fn stereo_channels_differ() {
        let mut board = Soundboard::new(48_000.0);
        board.tick(1.0);
        let mut total_diff = 0.0_f32;
        for _ in 0..4_800 {
            let (l, r) = board.tick(0.0);
            total_diff += (l - r).abs();
        }
        assert!(total_diff > 0.0, "L and R should decorrelate");
    }
}
