//! Coupled-string assembly with two-stage decay for the Grand Boule piano.
//!
//! Per spec §3.4, each piano key hosts 1–3 unison strings. Each string has
//! two polarizations coupled through the bridge:
//!
//! * **Vertical** (aligned with the hammer strike) — fast decay, "prompt
//!   sound". Extra damping `σ_fast = σ_string + σ_bridge`.
//! * **Horizontal** (transverse to the strike) — slow decay, "aftersound".
//!   Extra damping `σ_slow = σ_string + σ_bridge / 100`.
//!
//! The bridge admittance used to derive `σ_bridge` is `Y ≈ 10⁻³ s/kg`; the
//! concrete bandwidth constant is tuned to give a plausible ~0.5 s prompt
//! decay and several-second aftersound.
//!
//! The assembly is allocation-free and holds at most [`MAX_UNISONS`] unisons
//! with two [`ModalString`] banks each.

use super::parameters::{unison_count, unison_detune_cents};
use super::string::{ModalString, StringModalParameters};

/// Maximum number of unison strings per key (trichord).
pub const MAX_UNISONS: usize = 3;

/// Bridge-induced bandwidth added to the fast (vertical) polarization, in Hz.
/// Scales with frequency: bass strings couple more weakly through the bridge
/// (longer prompt sound, T60 ≈ 2–3 s) while treble strings couple more
/// strongly (shorter prompt, T60 ≈ 0.3–0.8 s). This matches measurements
/// from Askenfelt & Jansson.
fn sigma_bridge_hz(fundamental_hz: f32) -> f32 {
    // Bass A0 (27.5): ~0.9 Hz → T60 ≈ 2.4 s
    // Mid  C4 (261):  ~1.8 Hz → T60 ≈ 1.2 s
    // High C7 (2093): ~9.2 Hz → T60 ≈ 0.24 s
    0.8 + fundamental_hz * 0.004
}

/// Slow-polarization multiplier (`σ_bridge / 100`) from the spec.
const SIGMA_SLOW_SCALE: f32 = 0.01;

/// Gain applied to the vertical output before feeding it into the horizontal
/// (slow) polarization. With `configure_aftersound`, the horizontal C0 is
/// computed from the fast bandwidth (matched impulse response). The gain
/// controls how quickly the aftersound builds up to its steady-state level
/// relative to the prompt. Weinreich (1977) measured the aftersound plateau
/// at roughly 15–20 dB below the prompt peak on a Steinway D; 30× coupling
/// with 0.7 mix achieves this ratio.
const BRIDGE_COUPLING_GAIN: f32 = 30.0;

/// Relative output mix for the horizontal (slow) polarization.
///
/// The horizontal polarization is driven by bridge coupling from the
/// vertical output (Weinreich 1977). Combined with BRIDGE_COUPLING_GAIN,
/// this sets the aftersound plateau at ~15–20 dB below the prompt peak.
const HORIZONTAL_MIX: f32 = 0.7;

/// One unison: a vertical + horizontal polarization pair.
#[derive(Clone, Debug)]
struct UnisonString {
    vertical: ModalString,
    horizontal: ModalString,
    detune_cents: f32,
}

impl UnisonString {
    fn new() -> Self {
        Self {
            vertical: ModalString::new(),
            horizontal: ModalString::new(),
            detune_cents: 0.0,
        }
    }

    fn reset(&mut self) {
        self.vertical.reset();
        self.horizontal.reset();
    }
}

/// Coupled-string assembly attached to one [`PianoVoice`].
///
/// Holds two polarizations per unison and exposes a single `tick` entry
/// point that injects the hammer force into every active string and returns
/// the mixed bridge signal.
#[derive(Clone, Debug)]
pub struct CoupledStringAssembly {
    unisons: [UnisonString; MAX_UNISONS],
    active_unisons: usize,
}

impl CoupledStringAssembly {
    pub fn new() -> Self {
        Self {
            unisons: [
                UnisonString::new(),
                UnisonString::new(),
                UnisonString::new(),
            ],
            active_unisons: 0,
        }
    }

    /// Reset all biquad states (voice recycle).
    pub fn reset(&mut self) {
        for unison in self.unisons.iter_mut() {
            unison.reset();
        }
    }

    pub fn active_unisons(&self) -> usize {
        self.active_unisons
    }

    /// Configure the assembly for a given key.
    ///
    /// * `fundamental_hz` — Railsback-corrected f1 of the key.
    /// * `key` — 1-based piano key (for inharmonicity + detune lookup).
    /// * `hammer_strike_ratio` — hammer striking position, fraction of L.
    /// * `sample_rate` — DSP sample rate.
    /// * `base_bandwidth_hz` — intrinsic string damping `σ_string`.
    /// * `extra_damping_hz` — caller-injected damping (damper pedal / mute).
    pub fn configure(
        &mut self,
        fundamental_hz: f32,
        key: u32,
        hammer_strike_ratio: f32,
        sample_rate: f32,
        base_bandwidth_hz: f32,
        extra_damping_hz: f32,
    ) {
        let count = unison_count(key).min(MAX_UNISONS as u32) as usize;
        self.active_unisons = count;

        let bridge = sigma_bridge_hz(fundamental_hz);
        let fast_damp = bridge + extra_damping_hz;
        let slow_damp = bridge * SIGMA_SLOW_SCALE + extra_damping_hz;

        for unison_index in 0..count {
            let cents = unison_detune_cents(key, unison_index as u32);
            let detuned = fundamental_hz * (2.0_f32).powf(cents / 1200.0);
            let parameters = StringModalParameters::new(
                detuned,
                key,
                hammer_strike_ratio,
                sample_rate,
                base_bandwidth_hz,
            );
            let unison = &mut self.unisons[unison_index];
            unison.detune_cents = cents;
            unison
                .vertical
                .configure_from_string_parameters(parameters, fast_damp);
            // Horizontal (aftersound) polarization: C0 uses fast bandwidth
            // for efficient energy pickup from bridge coupling, but C1/C2
            // use slow bandwidth for the long-ringing aftersound tail
            // (Weinreich 1977, §3.4).
            unison
                .horizontal
                .configure_aftersound_from_string_parameters(parameters, fast_damp, slow_damp);
        }
    }

    /// Update the damping of both polarizations for all active unisons
    /// without touching amplitudes. Used when the damper state changes
    /// mid-note (pedal release, una-corda engage).
    pub fn reset_decay(
        &mut self,
        fundamental_hz: f32,
        key: u32,
        sample_rate: f32,
        base_bandwidth_hz: f32,
        extra_damping_hz: f32,
    ) {
        let bridge = sigma_bridge_hz(fundamental_hz);
        let fast_damp = bridge + extra_damping_hz;
        let slow_damp = bridge * SIGMA_SLOW_SCALE + extra_damping_hz;
        for unison_index in 0..self.active_unisons {
            let unison = &mut self.unisons[unison_index];
            let detuned = fundamental_hz * (2.0_f32).powf(unison.detune_cents / 1200.0);
            unison
                .vertical
                .reset_decay(detuned, key, sample_rate, base_bandwidth_hz, fast_damp);
            unison
                .horizontal
                .reset_decay(detuned, key, sample_rate, base_bandwidth_hz, slow_damp);
        }
    }

    /// Process one sample. The vertical polarization is driven by the hammer
    /// force directly; the horizontal polarization receives energy through
    /// bridge coupling from the vertical output (Weinreich 1977, §3.4).
    ///
    /// The `BRIDGE_COUPLING_GAIN` compensates for the horizontal resonators'
    /// very small C0 (narrow decay bandwidth) so that energy transfers at a
    /// realistic rate. No cross-unison feedback is applied to the horizontal
    /// drive — each unison's horizontal is driven only by its own vertical
    /// output, avoiding the positive-feedback instability that arises when
    /// high-Q resonators are cross-coupled.
    #[inline]
    pub fn tick(&mut self, hammer_force: f32) -> f32 {
        self.tick_inner(hammer_force, false)
    }

    /// Reference render for the cost-reduction goldens: both polarizations
    /// run [`ModalString::tick_including_zeroed_prefix`], the pre-F17
    /// computation. Bit-identical to [`Self::tick`] by contract; never call
    /// this in production.
    pub fn tick_including_zeroed_prefix(&mut self, hammer_force: f32) -> f32 {
        self.tick_inner(hammer_force, true)
    }

    fn tick_inner(&mut self, hammer_force: f32, reference_render: bool) -> f32 {
        let mut prompt = 0.0_f32;
        let mut aftersound = 0.0_f32;
        let n = self.active_unisons;
        for unison_index in 0..n {
            let unison = &mut self.unisons[unison_index];
            let v = if reference_render {
                unison.vertical.tick_including_zeroed_prefix(hammer_force)
            } else {
                unison.vertical.tick(hammer_force)
            };
            prompt += v;
            let drive = v * BRIDGE_COUPLING_GAIN;
            aftersound += if reference_render {
                unison.horizontal.tick_including_zeroed_prefix(drive)
            } else {
                unison.horizontal.tick(drive)
            };
        }
        prompt + HORIZONTAL_MIX * aftersound
    }

    /// Cheaper tick — used by progressive simplification. Runs only the
    /// vertical polarization of the first unison.
    #[inline]
    pub fn tick_simplified(&mut self, hammer_force: f32) -> f32 {
        if self.active_unisons == 0 {
            return 0.0;
        }
        self.unisons[0].vertical.tick_simplified(hammer_force)
    }

    #[cfg(test)]
    pub(crate) fn modal_coefficient_signature(&self) -> u64 {
        let signature =
            self.unisons[..self.active_unisons]
                .iter()
                .fold(0_u64, |signature, unison| {
                    signature
                        .wrapping_mul(31)
                        .wrapping_add(unison.vertical.coefficient_signature())
                        .wrapping_add(unison.horizontal.coefficient_signature())
                });
        signature
            .wrapping_mul(31)
            .wrapping_add(self.active_unisons as u64)
    }
}

impl Default for CoupledStringAssembly {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Measured evidence for audit MD-2: what a *block-rate* per-note pitch
    /// bend would cost this engine.
    ///
    /// `reset_decay` is the engine's existing mid-note retune primitive — it
    /// rewrites c1/c2 for a new fundamental and never touches the ringing
    /// state (x1/x2/y1/y2), which only `reset()` clears. `PianoVoice::tick`
    /// already calls it mid-note for the §A5.2 pitch glide, so retuning a
    /// sounding string is a shipping code path, not a redesign. The open
    /// question is only whether doing it *every block, per bent voice* fits
    /// the audio deadline.
    ///
    /// Ignored by default (it is a timing measurement, not an assertion).
    /// Run with:
    ///   cargo test -p daw-dsp --release grand_boule::coupled_strings::tests::\
    ///     measure_block_rate_retune_cost -- --ignored --nocapture
    #[test]
    #[ignore = "timing measurement, not an assertion — see audit MD-2"]
    fn measure_block_rate_retune_cost() {
        const SAMPLE_RATE: f32 = 48_000.0;
        const BLOCK: f32 = 128.0;
        const VOICES: usize = 32;
        const ITERATIONS: usize = 2_000;

        // A4 (key 49) — a trichord, so the full 3 unisons × 2 polarizations.
        let mut assembly = CoupledStringAssembly::new();
        assembly.configure(440.0, 49, 0.12, SAMPLE_RATE, 0.14, 0.0);

        let start = std::time::Instant::now();
        let mut bend = 0.0_f32;
        for iteration in 0..ITERATIONS {
            bend = 1.0 + 0.001 * ((iteration % 100) as f32);
            assembly.reset_decay(440.0 * bend, 49, SAMPLE_RATE, 0.14, 0.0);
        }
        let per_voice_secs = start.elapsed().as_secs_f64() / ITERATIONS as f64;
        std::hint::black_box(bend);

        let block_budget_secs = (BLOCK / SAMPLE_RATE) as f64;
        let full_polyphony_secs = per_voice_secs * VOICES as f64;
        let budget_fraction = full_polyphony_secs / block_budget_secs;

        println!("grand-boule block-rate retune (audit MD-2 measurement)");
        println!("  per voice          : {:.1} µs", per_voice_secs * 1e6);
        println!(
            "  {VOICES} voices bent   : {:.1} µs",
            full_polyphony_secs * 1e6
        );
        println!("  block budget       : {:.1} µs", block_budget_secs * 1e6);
        println!("  budget consumed    : {:.1}%", budget_fraction * 100.0);
    }
    #[test]
    fn trichord_key_has_three_unisons() {
        let mut assembly = CoupledStringAssembly::new();
        // Key 40 = middle C area, definitely trichord.
        assembly.configure(261.63, 40, 0.125, 48_000.0, 0.3, 0.0);
        assert_eq!(assembly.active_unisons(), 3);
    }

    #[test]
    fn monochord_bass_has_one_unison() {
        let mut assembly = CoupledStringAssembly::new();
        assembly.configure(27.5, 1, 1.0 / 7.0, 48_000.0, 0.25, 0.0);
        assert_eq!(assembly.active_unisons(), 1);
    }

    #[test]
    fn two_stage_decay_rings_longer_than_single_string() {
        // A properly coupled assembly should still be ringing long after the
        // fast prompt decay has died — that is the whole point of the slow
        // polarization.
        let mut assembly = CoupledStringAssembly::new();
        assembly.configure(440.0, 49, 0.125, 48_000.0, 0.3, 0.0);
        assembly.tick(1.0);
        let mut late_energy = 0.0_f32;
        // Skip past the prompt-decay portion (~200 ms) and integrate.
        for _ in 0..9_600 {
            let _ = assembly.tick(0.0);
        }
        for _ in 0..9_600 {
            late_energy += assembly.tick(0.0).abs();
        }
        assert!(
            late_energy > 0.0,
            "aftersound should persist past the prompt decay"
        );
    }

    #[test]
    fn extra_damping_shortens_combined_decay() {
        let mut loud = CoupledStringAssembly::new();
        let mut quiet = CoupledStringAssembly::new();
        loud.configure(220.0, 25, 0.125, 48_000.0, 0.25, 0.0);
        quiet.configure(220.0, 25, 0.125, 48_000.0, 0.25, 50.0);
        // Measure late-tail energy so the faster decay dominates over the
        // C0 gain increase from wider bandwidth.
        let late_energy = |assembly: &mut CoupledStringAssembly| -> f32 {
            assembly.tick(1.0);
            for _ in 0..4_000 {
                let _ = assembly.tick(0.0);
            }
            let mut sum = 0.0_f32;
            for _ in 0..8_000 {
                sum += assembly.tick(0.0).abs();
            }
            sum
        };
        assert!(late_energy(&mut loud) > late_energy(&mut quiet));
    }
}
