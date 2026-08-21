//! Parametric soundboard resonance bank for the Grand Boule piano.
//!
//! Implements a bank of parallel biquad resonators
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

use crate::primitives::flush_denormal;

/// Number of soundboard modes. 192 = 24 × 8 for `f32x8` SIMD alignment.
pub const SOUNDBOARD_MODES: usize = 192;

/// Lowest soundboard resonance (Hz). A full-size concert grand's
/// soundboard fundamental sits around 30–40 Hz — low enough to radiate
/// the second partial of A0 (55 Hz) and to add warmth to the bass register.
const MODE_MIN_HZ: f32 = 30.0;

/// Highest soundboard resonance (Hz). Modes above this frequency blend into
/// the radiation HF hump and contribute little.
const MODE_MAX_HZ: f32 = 7_800.0;

/// Plate-to-waveguide transition frequency.
/// (Chaigne, Cotté & Viggiano 2013, JASA 133(4)). Below this frequency the
/// soundboard vibrates as a single homogeneous orthotropic plate; above it
/// the inter-rib spaces act as waveguides and the modes localise. The
/// implication for synthesis is that the plate region has a *lower* modal
/// density (Skudrzyk mean admittance) and a *broader* radiation pattern,
/// while the waveguide region has higher modal density and decorrelated
/// stereo radiation.
const PLATE_WAVEGUIDE_HZ: f32 = 1_100.0;

/// Fraction of soundboard modes allocated to the plate region (below
/// 1.1 kHz). The plate region is broad and structural — about a third of
/// the modes get parked there, the rest live in the dense waveguide
/// region.
const PLATE_FRACTION: f32 = 0.32;

/// Frequency-independent input-drive coefficient. Scales the bridge signal
/// feeding the soundboard modes. The soundboard is the primary sound radiator
/// in a real piano — the direct string signal should be a minority component.
/// 0.18 gives a soundboard-to-dry ratio of roughly 3:1, producing the warm,
/// resonant body that distinguishes a grand piano from an electric.
const DRIVE: f32 = 0.18;

/// The rendered bridge bus delivered to the independent soundboard stage.
///
/// This is intentionally a private-to-Grand-Boule boundary type rather than a
/// synthesis control: voices render their string-derived bridge signal first,
/// then the global soundboard consumes that completed signal.
#[derive(Clone, Copy, Debug)]
pub(crate) struct RenderedBridgeSignal(f32);

impl RenderedBridgeSignal {
    pub(crate) const fn new(sample: f32) -> Self {
        Self(sample)
    }
}

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
    #[cfg(test)]
    rendered_bridge_process_count: usize,
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
            #[cfg(test)]
            rendered_bridge_process_count: 0,
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
        #[cfg(test)]
        {
            self.rendered_bridge_process_count = 0;
        }
    }

    /// Rebuild mode coefficients. Called from `new` and whenever the sample
    /// rate changes.
    ///
    /// The mode set is split at `PLATE_WAVEGUIDE_HZ`:
    ///
    /// * **Plate region** (≤ 1.1 kHz, ~32 % of modes): low density, high Q
    ///   in the lows, broadly correlated L/R radiation (most plate modes
    ///   span the whole soundboard so both channels see them).
    /// * **Waveguide region** (> 1.1 kHz, remaining modes): higher density,
    ///   moderate Q, *decorrelated* L/R radiation because the modes are
    ///   localised to individual inter-rib waveguides.
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

        let plate_count = ((SOUNDBOARD_MODES as f32 * PLATE_FRACTION) as usize).max(1);
        let waveguide_count = SOUNDBOARD_MODES - plate_count;
        let log_plate_lo = MODE_MIN_HZ.ln();
        let log_plate_hi = PLATE_WAVEGUIDE_HZ.ln();
        let log_wg_lo = PLATE_WAVEGUIDE_HZ.ln();
        let log_wg_hi = MODE_MAX_HZ.ln();

        for index in 0..SOUNDBOARD_MODES {
            // Plate vs waveguide membership and log-spaced frequency.
            let (freq_nominal, is_plate) = if index < plate_count {
                let local = index as f32 / (plate_count.max(1) as f32 - 1.0).max(1.0);
                (
                    (log_plate_lo + local.clamp(0.0, 1.0) * (log_plate_hi - log_plate_lo)).exp(),
                    true,
                )
            } else {
                let local =
                    (index - plate_count) as f32 / (waveguide_count.max(1) as f32 - 1.0).max(1.0);
                (
                    (log_wg_lo + local.clamp(0.0, 1.0) * (log_wg_hi - log_wg_lo)).exp(),
                    false,
                )
            };
            let jitter = 1.0 + 0.15 * (2.0 * next_rand() - 1.0);
            let freq = (freq_nominal * jitter).clamp(MODE_MIN_HZ, nyquist * 0.98);

            // Plate modes carry low-mid energy with high Q (long ringing
            // body resonances). Waveguide modes are more lossy and add the
            // characteristic upper-mid "shimmer" without dominating.
            let q = if is_plate {
                // Lowest plate modes are highly resonant (Suzuki 1986).
                let bass_bias = 1.0
                    - ((freq - MODE_MIN_HZ) / (PLATE_WAVEGUIDE_HZ - MODE_MIN_HZ)).clamp(0.0, 1.0);
                60.0 + 180.0 * bass_bias
            } else {
                // Waveguide region modes — moderate Q with mild peak around
                // 2 kHz where coincidence radiation is most efficient.
                let peak_bias = 1.0 - ((freq.ln() - 2_000.0_f32.ln()).abs() * 0.7).min(1.0);
                60.0 + 90.0 * peak_bias
            };
            let bandwidth = freq / q;

            let theta = TAU * freq / self.sample_rate;
            let r = (-PI * bandwidth / self.sample_rate).exp();

            // Amplitude rolls off slightly with frequency (~ -3 dB/oct).
            // Plate modes carry slightly more energy because they radiate
            // efficiently across the whole board.
            let plate_boost = if is_plate { 1.20 } else { 1.0 };
            let amp = plate_boost / freq.sqrt();

            self.c0[index] = DRIVE * amp * (1.0 - r * r) * theta.sin() * 0.5;
            self.c1[index] = 2.0 * r * theta.cos();
            self.c2[index] = -(r * r);

            // Stereo placement.
            //
            // Plate modes span the whole board → near-mono with a small
            // ±7.65° spread either side of centre. Waveguide modes are
            // localised to inter-rib bays → strongly decorrelated, allowed
            // any pan angle.
            let pan = next_rand();
            let angle = if is_plate {
                // Confine to (45° ± 7.65°) — broadly mono with a touch of
                // perspective. PI*0.085 ≈ 0.267 rad ≈ 15.3° peak-to-peak.
                PI * 0.25 + (pan - 0.5) * (PI * 0.085)
            } else {
                pan * PI * 0.5
            };
            self.gain_left[index] = angle.cos();
            self.gain_right[index] = angle.sin();
        }
    }

    /// Process one bridge-input sample and return a stereo soundboard pair.
    #[inline]
    pub fn tick(&mut self, input: f32) -> (f32, f32) {
        self.process_rendered_bridge(RenderedBridgeSignal::new(input))
    }

    /// Resonantly process the completed bridge bus at the Grand Boule stage
    /// boundary. This keeps the global soundboard state distinct from voice
    /// string state without changing the public scalar `tick` API.
    #[inline]
    pub(crate) fn process_rendered_bridge(&mut self, bridge: RenderedBridgeSignal) -> (f32, f32) {
        #[cfg(test)]
        {
            self.rendered_bridge_process_count += 1;
        }
        let input = bridge.0;
        let mut left = 0.0_f32;
        let mut right = 0.0_f32;
        for index in 0..SOUNDBOARD_MODES {
            let y = self.c0[index] * (input - self.x2[index])
                + self.c1[index] * self.y1[index]
                + self.c2[index] * self.y2[index];
            self.x2[index] = self.x1[index];
            self.x1[index] = input;
            self.y2[index] = self.y1[index];
            self.y1[index] = flush_denormal(y);
            left += self.gain_left[index] * y;
            right += self.gain_right[index] * y;
        }
        (left, right)
    }

    #[cfg(test)]
    pub(crate) const fn rendered_bridge_process_count(&self) -> usize {
        self.rendered_bridge_process_count
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

    #[test]
    fn rendered_bridge_signal_drives_an_independent_resonator_stage() {
        let mut board = Soundboard::new(48_000.0);
        let _ = board.process_rendered_bridge(RenderedBridgeSignal::new(1.0));

        let (left, right) = board.process_rendered_bridge(RenderedBridgeSignal::new(0.0));

        assert!(
            left.abs() + right.abs() > 0.0,
            "the soundboard must retain its own resonator state after bridge input ends"
        );
    }
}
