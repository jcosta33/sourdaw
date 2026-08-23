//! Coupled-string assembly with two-stage decay for the Grand Boule piano.
//!
//! Each piano key hosts one to three unison strings. Each string has two
//! project-voiced polarization banks:
//!
//! * **Prompt** — the immediate, faster-decaying response.
//! * **Aftersound** — a quieter, slower-decaying continuation.
//!
//! Their decay curves are authored for this project from the detuned string
//! frequency alone. No body or soundboard property enters string coefficient
//! derivation.
//!
//! The assembly is allocation-free and holds at most [`MAX_UNISONS`] unisons
//! with two [`ModalString`] banks each.

use super::parameters::{unison_count, unison_detune_cents};
use super::string::{ModalString, StringModalParameters};

/// Maximum number of unison strings per key (trichord).
pub const MAX_UNISONS: usize = 3;

#[derive(Clone, Copy, Debug)]
struct PolarizationDecay {
    prompt_hz: f32,
    aftersound_hz: f32,
}

/// Project-authored polarization decay bandwidths derived only from string
/// frequency. The normalized register spans A0 through C8 and clamps outside
/// that range so malformed callers cannot produce unbounded damping.
fn polarization_decay_hz(note_frequency_hz: f32) -> PolarizationDecay {
    let register = ((note_frequency_hz.max(27.5) / 27.5).log2() / 7.25).clamp(0.0, 1.0);
    PolarizationDecay {
        prompt_hz: 0.58 + 0.72 * register + 7.2 * register.powf(2.4),
        aftersound_hz: 0.012 + 0.025 * register + 0.105 * register * register,
    }
}

/// Gain applied to the prompt output before feeding it into the aftersound
/// polarization. With `configure_aftersound`, the aftersound C0 is computed
/// from the prompt bandwidth. The gain controls how quickly the aftersound
/// builds relative to the prompt; both constants are project voicing.
const POLARIZATION_TRANSFER_GAIN: f32 = 30.0;

/// Relative output mix for the aftersound polarization.
///
/// Combined with `POLARIZATION_TRANSFER_GAIN`, this sets the project
/// aftersound balance.
const AFTERSOUND_MIX: f32 = 0.7;

/// One unison: a prompt + aftersound polarization pair.
#[derive(Clone, Debug)]
struct UnisonString {
    prompt: ModalString,
    aftersound: ModalString,
    detune_cents: f32,
}

impl UnisonString {
    fn new() -> Self {
        Self {
            prompt: ModalString::new(),
            aftersound: ModalString::new(),
            detune_cents: 0.0,
        }
    }

    fn reset(&mut self) {
        self.prompt.reset();
        self.aftersound.reset();
    }
}

/// Coupled-string assembly attached to one [`PianoVoice`].
///
/// Holds two polarizations per unison and exposes a single `tick` entry
/// point that injects the hammer force into every active string and returns
/// the mixed string signal.
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

        for unison_index in 0..count {
            let cents = unison_detune_cents(key, unison_index as u32);
            let detuned = fundamental_hz * (2.0_f32).powf(cents / 1200.0);
            let decay = polarization_decay_hz(detuned);
            let prompt_damping_hz = decay.prompt_hz + extra_damping_hz;
            let aftersound_damping_hz = decay.aftersound_hz + extra_damping_hz;
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
                .prompt
                .configure_from_string_parameters(parameters, prompt_damping_hz);
            // The aftersound C0 follows the prompt bandwidth for a matched
            // pickup response; C1/C2 retain the independently authored tail.
            unison
                .aftersound
                .configure_aftersound_from_string_parameters(
                    parameters,
                    prompt_damping_hz,
                    aftersound_damping_hz,
                );
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
        for unison_index in 0..self.active_unisons {
            let unison = &mut self.unisons[unison_index];
            let detuned = fundamental_hz * (2.0_f32).powf(unison.detune_cents / 1200.0);
            let decay = polarization_decay_hz(detuned);
            unison.prompt.reset_decay(
                detuned,
                key,
                sample_rate,
                base_bandwidth_hz,
                decay.prompt_hz + extra_damping_hz,
            );
            unison.aftersound.reset_decay(
                detuned,
                key,
                sample_rate,
                base_bandwidth_hz,
                decay.aftersound_hz + extra_damping_hz,
            );
        }
    }

    /// Process one sample. The prompt polarization is driven by the hammer
    /// force; its output excites the quieter aftersound polarization.
    ///
    /// The transfer gain compensates for the aftersound resonators' narrow C0.
    /// Each unison's aftersound is driven only by its own prompt output, with no
    /// cross-unison feedback.
    #[inline]
    pub fn tick(&mut self, hammer_force: f32) -> f32 {
        let mut prompt = 0.0_f32;
        let mut aftersound = 0.0_f32;
        let n = self.active_unisons;
        for unison_index in 0..n {
            let unison = &mut self.unisons[unison_index];
            let immediate = unison.prompt.tick(hammer_force);
            prompt += immediate;
            aftersound += unison
                .aftersound
                .tick(immediate * POLARIZATION_TRANSFER_GAIN);
        }
        prompt + AFTERSOUND_MIX * aftersound
    }

    /// Cheaper tick — used by progressive simplification. Runs only the
    /// prompt polarization of the first unison.
    #[inline]
    pub fn tick_simplified(&mut self, hammer_force: f32) -> f32 {
        if self.active_unisons == 0 {
            return 0.0;
        }
        self.unisons[0].prompt.tick_simplified(hammer_force)
    }

    #[cfg(test)]
    pub(crate) fn modal_coefficient_signature(&self) -> u64 {
        let signature =
            self.unisons[..self.active_unisons]
                .iter()
                .fold(0_u64, |signature, unison| {
                    signature
                        .wrapping_mul(31)
                        .wrapping_add(unison.prompt.coefficient_signature())
                        .wrapping_add(unison.aftersound.coefficient_signature())
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
    /// already calls it mid-note for pitch glide, so retuning a
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
    fn project_polarization_decay_curve_is_frequency_only_and_pinned() {
        let bass = polarization_decay_hz(27.5);
        let middle = polarization_decay_hz(440.0);
        let treble = polarization_decay_hz(4_186.009);

        assert!((bass.prompt_hz - 0.58).abs() < 1.0e-6);
        assert!((bass.aftersound_hz - 0.012).abs() < 1.0e-6);
        assert!((middle.prompt_hz - 2.704_929).abs() < 1.0e-5);
        assert!((middle.aftersound_hz - 0.057_755).abs() < 1.0e-6);
        assert!((treble.prompt_hz - 8.5).abs() < 1.0e-4);
        assert!((treble.aftersound_hz - 0.142).abs() < 1.0e-5);
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
