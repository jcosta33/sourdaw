//! Bit-exactness goldens for four audio-path cost reductions that must not
//! move a single sample.
//!
//! Each render is hashed rather than compared element-wise so the assertion
//! is sensitive to every bit of every sample while staying readable. The
//! expected values were captured from the implementations these changes
//! replaced; a change that alters the output, in any mode, moves the hash.
//!
//! Scope: the hashes pin same-platform equivalence, captured and checked on
//! the same toolchain and libm. The renders pass through f32 transcendentals
//! (`tanh`, `exp`, `sin`) whose last-bit rounding is not specified across C
//! runtimes, so a different platform may legitimately produce different
//! hashes. If one of these fails after a toolchain or platform change and the
//! DSP is untouched, re-capture the values on the new platform in their own
//! commit; a failure after a DSP edit is a real behavioural change.

use daw_dsp::grand_boule::engine::GrandBouleEngine;
use daw_dsp::grand_boule::mechanical_noise::{MechanicalNoise, NoiseEvent};
use daw_dsp::grand_boule::string::ModalString;
use daw_dsp::grinder::engine::GrinderEngine;

#[path = "support/retained_signal.rs"]
mod retained_signal;

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

fn stimulus(total: usize) -> Vec<f32> {
    (0..total)
        .map(|n| {
            let low = ((n as f32 * 2.0 * std::f32::consts::PI * 140.0) / 48_000.0).sin() * 0.09;
            let high = ((n as f32 * 2.0 * std::f32::consts::PI * 2600.0) / 48_000.0).sin() * 0.04;
            low + high
        })
        .collect()
}

fn grinder_render(configure: impl FnOnce(&mut GrinderEngine)) -> Vec<f32> {
    let mut engine = GrinderEngine::new(48_000.0);
    engine.set_param("channel", 1.0);
    engine.set_param("gain", 6.0);
    engine.set_param("master", 5.0);
    configure(&mut engine);

    let mut left = stimulus(4096);
    let mut right = left.clone();
    engine.process_block(&mut left, &mut right);
    left
}

/// F9: the dual power amp and output transformer ran in every routing mode
/// but were read only under DualAmp. Gating them must not move Serial output.
#[test]
#[ignore = "temporary portable-baseline diagnostic"]
fn serial_routing_output_is_unchanged_by_gating_the_dual_amp_chain() {
    let render = grinder_render(|engine| {
        engine.set_param("routingMode", 0.0);
        engine.set_param("cabType", 2.0);
    });
    assert_eq!(hash_samples(&render), 13_745_200_862_744_656_841);
}

/// The mode that does read the dual chain must be unchanged too.
#[test]
#[ignore = "temporary portable-baseline diagnostic"]
fn dual_amp_routing_output_is_unchanged() {
    let render = grinder_render(|engine| {
        engine.set_param("routingMode", 3.0);
        engine.set_param("cabType", 2.0);
    });
    assert_eq!(hash_samples(&render), 2_391_357_263_732_743_946);
}

/// F9, second half: Capture mode discarded the preamp and tone stack. Not
/// running them must leave Capture output identical.
#[test]
#[ignore = "temporary portable-baseline diagnostic"]
fn capture_mode_output_is_unchanged_by_gating_the_circuit_preamp() {
    let render = grinder_render(|engine| {
        engine.set_param("engineMode", 1.0);
        engine.set_param("neuralModelSlot", 0.0);
        engine.set_param("cabType", 2.0);
    });
    assert_eq!(hash_samples(&render), 164_338_697_114_077_204);
}

/// F14: burst resonator coefficients moved from the per-sample loop into
/// `trigger`. They were already constant per burst, so the output must be
/// identical for a fixed seed and trigger sequence.
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
    assert_eq!(hash_samples(&render), 7_134_174_258_747_095_649);
}

/// Approved Grand Boule baseline after the project-authored FIR body and
/// tuning redesign. Later DSP edits must be reviewed before moving this hash.
#[test]
#[ignore = "temporary portable-baseline diagnostic"]
fn grand_boule_held_chord_renders_identically() {
    let render = grand_boule_render();
    assert_eq!(hash_samples(&render), 18_068_797_612_036_848_195);
}

fn grand_boule_render() -> Vec<f32> {
    let mut engine = GrandBouleEngine::new(48_000.0, 32);
    engine.note_on(48, 0.9);
    engine.note_on(60, 0.7);
    engine.note_on(67, 0.5);

    let mut render = Vec::with_capacity(8192);
    let mut left = vec![0.0_f32; 512];
    let mut right = vec![0.0_f32; 512];
    for _ in 0..16 {
        left.fill(0.0);
        right.fill(0.0);
        engine.process_block(&mut left, &mut right);
        render.extend_from_slice(&left);
    }
    render
}

/// F17: the f32 partial loop now starts at `f64_partials`, skipping slots
/// `configure` had already zeroed. A bass note exercises that prefix.
#[test]
#[ignore = "temporary portable-baseline diagnostic"]
fn modal_string_renders_identically_when_the_zeroed_prefix_is_skipped() {
    let render = modal_string_render();
    assert_eq!(hash_samples(&render), 9_423_460_074_255_799_726);
}

fn modal_string_render() -> Vec<f32> {
    let mut string = ModalString::new();
    // C2 (~65 Hz): several partials fall below the 200 Hz f64 cutoff, so the
    // f32 arrays carry a zeroed prefix.
    string.configure(65.406, 16, 0.125, 48_000.0, 0.2, 0.0);

    let mut render = Vec::with_capacity(8192);
    render.push(string.tick(1.0));
    for _ in 1..8192 {
        render.push(string.tick(0.0));
    }
    render
}

#[test]
fn diagnostic_emits_portable_retained_signal_measurements() {
    let serial = grinder_render(|engine| {
        engine.set_param("routingMode", 0.0);
        engine.set_param("cabType", 2.0);
    });
    let dual_amp = grinder_render(|engine| {
        engine.set_param("routingMode", 3.0);
        engine.set_param("cabType", 2.0);
    });
    let capture = grinder_render(|engine| {
        engine.set_param("engineMode", 1.0);
        engine.set_param("neuralModelSlot", 0.0);
        engine.set_param("cabType", 2.0);
    });
    println!("SERIAL={:?}", retained_signal::measure(&serial));
    println!("DUAL_AMP={:?}", retained_signal::measure(&dual_amp));
    println!("CAPTURE={:?}", retained_signal::measure(&capture));
    println!(
        "GRAND_BOULE={:?}",
        retained_signal::measure(&grand_boule_render())
    );
    println!(
        "MODAL_STRING={:?}",
        retained_signal::measure(&modal_string_render())
    );
    #[cfg(target_os = "linux")]
    panic!("intentional Linux retained-signal diagnostic");
}
