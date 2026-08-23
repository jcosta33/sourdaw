//! Bit-exactness goldens for audio-path cost reductions that must not move a
//! sample.
//!
//! The optimized engines come from the shipping `daw_dsp` crate. Their
//! pre-optimization counterparts live entirely under this integration test's
//! shadow module tree, so release/native production contains no reference
//! switch, field, API, or alternate branch.
//!
//! Five goldens compare same-process renders, removing cross-platform libm
//! variation from the oracle. The mechanical-noise golden keeps its captured
//! absolute hash because that arithmetic has remained stable on every runner.

mod primitives {
    pub use daw_dsp::primitives::*;
}

#[path = "dsp_cost_reduction_goldens/shadow/mod.rs"]
mod shadow;

use daw_dsp::grand_boule::mechanical_noise::{MechanicalNoise, NoiseEvent};
use daw_dsp::grand_boule::string::ModalString;
use daw_dsp::grand_boule::voice::{
    PianoVoice, PianoVoiceStart, VoiceQuality as ProductionVoiceQuality,
};
use daw_dsp::grinder::engine::GrinderEngine;
use shadow::grand_boule::voice::{
    PianoVoice as ReferencePianoVoice, PianoVoiceStart as ReferencePianoVoiceStart,
    VoiceQuality as ReferenceVoiceQuality,
};
use shadow::grinder::engine::GrinderEngine as ReferenceGrinderEngine;
use shadow::modal_string::ModalString as ReferenceModalString;

fn hash_samples(samples: &[f32]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for sample in samples {
        for byte in sample.to_bits().to_le_bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    hash
}

/// A silent or poisoned render would make hash comparison vacuous.
fn assert_finite_and_non_silent(label: &str, render: &[f32]) {
    assert!(
        render.iter().all(|sample| sample.is_finite()),
        "{label} golden render must contain only finite samples"
    );
    assert!(
        render.iter().any(|sample| sample.abs() > 0.0),
        "{label} golden render must produce audio or the comparison is vacuous"
    );
}

fn assert_equivalent_renders(optimized: &[f32], reference: &[f32]) {
    assert_finite_and_non_silent("optimized", optimized);
    assert_finite_and_non_silent("reference", reference);
    assert_eq!(hash_samples(optimized), hash_samples(reference));
}

fn assert_distinct_renders(optimized: &[f32], reference: &[f32]) {
    assert_finite_and_non_silent("optimized", optimized);
    assert_finite_and_non_silent("reference", reference);
    assert_ne!(hash_samples(optimized), hash_samples(reference));
}

fn stimulus(total: usize) -> Vec<f32> {
    (0..total)
        .map(|frame| {
            let low = ((frame as f32 * 2.0 * std::f32::consts::PI * 140.0) / 48_000.0).sin() * 0.09;
            let high =
                ((frame as f32 * 2.0 * std::f32::consts::PI * 2600.0) / 48_000.0).sin() * 0.04;
            low + high
        })
        .collect()
}

trait GrinderHarness {
    fn set_param(&mut self, name: &str, value: f32);
    fn process_block(&mut self, left: &mut [f32], right: &mut [f32]);
}

impl GrinderHarness for GrinderEngine {
    fn set_param(&mut self, name: &str, value: f32) {
        GrinderEngine::set_param(self, name, value);
    }

    fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        GrinderEngine::process_block(self, left, right);
    }
}

impl GrinderHarness for ReferenceGrinderEngine {
    fn set_param(&mut self, name: &str, value: f32) {
        ReferenceGrinderEngine::set_param(self, name, value);
    }

    fn process_block(&mut self, left: &mut [f32], right: &mut [f32]) {
        ReferenceGrinderEngine::process_block(self, left, right);
    }
}

fn configure_grinder(engine: &mut impl GrinderHarness, params: &[(&str, f32)]) {
    engine.set_param("channel", 1.0);
    engine.set_param("gain", 6.0);
    engine.set_param("master", 5.0);
    for &(name, value) in params {
        engine.set_param(name, value);
    }
}

fn grinder_render(
    mut engine: impl GrinderHarness,
    params: &[(&str, f32)],
    frames: usize,
) -> Vec<f32> {
    configure_grinder(&mut engine, params);
    let mut left = stimulus(frames);
    let mut right = left.clone();
    engine.process_block(&mut left, &mut right);
    left
}

/// F9: Serial routing discards the second amp and transformer. The shadow runs
/// both stages exactly as the pre-optimization engine did.
#[test]
fn serial_routing_output_is_unchanged_by_gating_the_dual_amp_chain() {
    let params = [("routingMode", 0.0), ("cabType", 2.0)];
    let optimized = grinder_render(GrinderEngine::new(48_000.0), &params, 4096);
    let reference = grinder_render(ReferenceGrinderEngine::new(48_000.0), &params, 4096);
    assert_equivalent_renders(&optimized, &reference);
}

/// F9: the optimized engine freezes the dual chain during Serial routing and
/// clears it before entering DualAmp. The pre-F9 shadow continuously processes
/// that chain and preserves its state across the transition, so the second
/// block must differ. Equality means the shadow copied the optimized reset.
#[test]
fn dual_amp_entry_resets_state_that_pre_f9_kept_processing() {
    fn render(mut engine: impl GrinderHarness) -> (Vec<f32>, Vec<f32>) {
        configure_grinder(&mut engine, &[("routingMode", 0.0), ("cabType", 2.0)]);
        let mut serial = stimulus(4096);
        let mut right = serial.clone();
        engine.process_block(&mut serial, &mut right);

        engine.set_param("routingMode", 3.0);
        let mut dual_amp = stimulus(4096);
        right.copy_from_slice(&dual_amp);
        engine.process_block(&mut dual_amp, &mut right);
        (serial, dual_amp)
    }

    let (optimized_serial, optimized_dual_amp) = render(GrinderEngine::new(48_000.0));
    let (reference_serial, reference_dual_amp) = render(ReferenceGrinderEngine::new(48_000.0));
    assert_equivalent_renders(&optimized_serial, &reference_serial);
    assert_distinct_renders(&optimized_dual_amp, &reference_dual_amp);
}

/// F9: Capture replaces the circuit preamp and tone stack. The shadow still
/// computes and discards those stages.
#[test]
fn capture_mode_output_is_unchanged_by_gating_the_circuit_preamp() {
    let params = [
        ("engineMode", 1.0),
        ("neuralModelSlot", 0.0),
        ("cabType", 2.0),
    ];
    let optimized = grinder_render(GrinderEngine::new(48_000.0), &params, 4096);
    let reference = grinder_render(ReferenceGrinderEngine::new(48_000.0), &params, 4096);
    assert_equivalent_renders(&optimized, &reference);
}

/// F14: burst coefficients moved out of the per-sample loop. This arithmetic
/// retains its measured absolute hash.
#[test]
fn mechanical_noise_bursts_render_identically_with_precomputed_coefficients() {
    let events = [
        NoiseEvent::KeyDown,
        NoiseEvent::HammerLetoff,
        NoiseEvent::DamperLift,
        NoiseEvent::PedalDown,
        NoiseEvent::StringPrecursor,
    ];
    let mut noise = MechanicalNoise::new(48_000.0);
    let mut render = Vec::with_capacity(9600);
    for frame in 0..9600_usize {
        if frame % 320 == 0 {
            let index = (frame / 320) % events.len();
            noise.trigger(events[index], 0.2 + 0.15 * index as f32);
        }
        render.push(noise.tick());
    }
    assert_finite_and_non_silent("mechanical-noise", &render);
    assert_eq!(hash_samples(&render), 7_134_174_258_747_095_649);
}

trait HeldVoiceHarness {
    fn strike(&mut self);
    fn tick(&mut self) -> f32;
    fn is_high_quality(&self) -> bool;
    fn is_standard_quality(&self) -> bool;
    fn age_samples(&self) -> u64;
}

impl HeldVoiceHarness for PianoVoice {
    fn strike(&mut self) {
        self.set_quality(ProductionVoiceQuality::High);
        self.note_on(PianoVoiceStart {
            midi_note: 60,
            channel: 0,
            velocity: 0.9,
            key: 40,
            pitch_ratio: 1.0,
            stiffness_scale: 1.0,
            mass_scale: 1.0,
            attack_length: 0,
        });
    }

    fn tick(&mut self) -> f32 {
        PianoVoice::tick(self)
    }

    fn is_high_quality(&self) -> bool {
        self.quality() == ProductionVoiceQuality::High
    }

    fn is_standard_quality(&self) -> bool {
        self.quality() == ProductionVoiceQuality::Standard
    }

    fn age_samples(&self) -> u64 {
        PianoVoice::age_samples(self)
    }
}

impl HeldVoiceHarness for ReferencePianoVoice {
    fn strike(&mut self) {
        self.set_quality(ReferenceVoiceQuality::High);
        self.note_on(ReferencePianoVoiceStart {
            midi_note: 60,
            channel: 0,
            velocity: 0.9,
            key: 40,
            pitch_ratio: 1.0,
            stiffness_scale: 1.0,
            mass_scale: 1.0,
            attack_length: 0,
        });
    }

    fn tick(&mut self) -> f32 {
        ReferencePianoVoice::tick(self)
    }

    fn is_high_quality(&self) -> bool {
        self.quality() == ReferenceVoiceQuality::High
    }

    fn is_standard_quality(&self) -> bool {
        self.quality() == ReferenceVoiceQuality::Standard
    }

    fn age_samples(&self) -> u64 {
        ReferencePianoVoice::age_samples(self)
    }
}

fn held_voice_render(mut voice: impl HeldVoiceHarness) -> (Vec<f32>, bool, bool, u64) {
    const FRAMES: usize = 48_128;
    voice.strike();
    let mut render = Vec::with_capacity(FRAMES);
    for _ in 0..FRAMES {
        render.push(voice.tick());
    }
    (
        render,
        voice.is_high_quality(),
        voice.is_standard_quality(),
        voice.age_samples(),
    )
}

/// F8: the shipping voice's output follower demotes a decayed held voice after
/// one second; the pre-F8 shadow never updates that follower. The model change
/// occurs after hammer contact, so both renders must remain bit-identical.
#[test]
fn grand_boule_held_voice_renders_identically_across_the_demotion_boundary() {
    let (optimized, optimized_high, optimized_standard, optimized_age) =
        held_voice_render(PianoVoice::new(48_000.0));
    let (reference, reference_high, reference_standard, reference_age) =
        held_voice_render(ReferencePianoVoice::new(48_000.0));

    assert!(optimized_age > 48_000 && reference_age > 48_000);
    assert_equivalent_renders(&optimized, &reference);
    assert!(!optimized_high && optimized_standard);
    assert!(reference_high && !reference_standard);
}

/// F17: the shipping string skips the f32 slots whose coefficients were zeroed
/// because those low partials are already processed in f64. The shadow retains
/// the old zero-prefix loop.
#[test]
fn modal_string_renders_identically_when_the_zeroed_prefix_is_skipped() {
    let mut optimized = ModalString::new();
    let mut reference = ReferenceModalString::new();
    optimized.configure(65.406, 16, 0.125, 48_000.0, 0.2, 0.0);
    reference.configure(65.406, 16, 0.125, 48_000.0, 0.2, 0.0);
    assert!(
        reference.f64_partials() > 0,
        "the bass configuration must zero a prefix or this golden is vacuous"
    );

    let mut optimized_render = Vec::with_capacity(8192);
    let mut reference_render = Vec::with_capacity(8192);
    optimized_render.push(optimized.tick(1.0));
    reference_render.push(reference.tick(1.0));
    for _ in 1..8192 {
        optimized_render.push(optimized.tick(0.0));
        reference_render.push(reference.tick(0.0));
    }

    assert_equivalent_renders(&optimized_render, &reference_render);
}
