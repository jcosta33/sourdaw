#![cfg(debug_assertions)]

//! Bit-exactness goldens for audio-path cost reductions that must not move a
//! single sample.
//!
//! Five goldens use same-run equivalence: each optimized render is hashed
//! against a debug-only reference render that executes the pre-optimization
//! computation in the same process. Both sides therefore use one toolchain
//! and libm, avoiding the cross-platform last-bit drift of captured f32 hashes
//! while remaining sensitive to every rendered bit.
//!
//! The reference paths run the discarded Grinder stages (pre-F9), process the
//! zeroed ModalString prefix (pre-F17), and omit the Grand Boule decay follower
//! update (pre-F8). They are selected with compile-time constants and exist
//! only in debug builds, so the release audio path gains no runtime flag or
//! per-sample branch. The F14 mechanical-noise render is the one retained
//! absolute golden because it is already stable across the hosted platforms.

use daw_dsp::grand_boule::mechanical_noise::{MechanicalNoise, NoiseEvent};
use daw_dsp::grand_boule::string::ModalString;
use daw_dsp::grand_boule::voice::{PianoVoice, PianoVoiceStart};
use daw_dsp::grinder::engine::GrinderEngine;

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

/// A silent or non-finite render would make equality vacuous.
fn assert_non_silent(render: &[f32]) {
    assert!(
        render.iter().all(|sample| sample.is_finite()),
        "golden render must contain only finite audio"
    );
    assert!(
        render.iter().any(|sample| sample.abs() > 0.0),
        "golden render must contain non-zero audio"
    );
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

struct GrinderRender {
    samples: Vec<f32>,
    circuit_stage_samples: usize,
    dual_amp_samples: usize,
}

fn grinder_render(reference: bool, configure: impl Fn(&mut GrinderEngine)) -> GrinderRender {
    let mut engine = GrinderEngine::new(48_000.0);
    engine.set_param("channel", 1.0);
    engine.set_param("gain", 6.0);
    engine.set_param("master", 5.0);
    configure(&mut engine);

    let mut left = stimulus(4096);
    let mut right = left.clone();
    if reference {
        engine.process_block_reference(&mut left, &mut right);
    } else {
        engine.process_block(&mut left, &mut right);
    }
    GrinderRender {
        samples: left,
        circuit_stage_samples: engine.debug_circuit_stage_samples(),
        dual_amp_samples: engine.debug_dual_amp_samples(),
    }
}

/// F9: the dual power amp and output transformer ran in every routing mode
/// but were read only under DualAmp. Serial is compared with a reference that
/// still runs and discards that chain.
#[test]
fn serial_routing_output_is_unchanged_by_gating_the_dual_amp_chain() {
    let configure = |engine: &mut GrinderEngine| {
        engine.set_param("routingMode", 0.0);
        engine.set_param("cabType", 2.0);
    };
    let optimized = grinder_render(false, configure);
    let reference = grinder_render(true, configure);
    assert_non_silent(&optimized.samples);
    assert_eq!(optimized.dual_amp_samples, 0);
    assert_eq!(reference.dual_amp_samples, 4096);
    assert_eq!(
        hash_samples(&optimized.samples),
        hash_samples(&reference.samples)
    );
}

/// DualAmp consumes the gated chain. Both engines first render in Serial so
/// only the reference charges that chain, then enter DualAmp. Equality proves
/// the mode transition clears the discarded reference state before it becomes
/// audible and that the live DualAmp computation itself remains unchanged.
#[test]
fn dual_amp_routing_output_is_unchanged() {
    fn render(reference: bool) -> GrinderRender {
        let mut engine = GrinderEngine::new(48_000.0);
        engine.set_param("channel", 1.0);
        engine.set_param("gain", 6.0);
        engine.set_param("master", 5.0);
        engine.set_param("routingMode", 0.0);
        engine.set_param("cabType", 2.0);

        let mut render = Vec::with_capacity(8192);
        for block in 0..2 {
            if block == 1 {
                engine.set_param("routingMode", 3.0);
            }
            let mut left = stimulus(4096);
            let mut right = left.clone();
            if reference {
                engine.process_block_reference(&mut left, &mut right);
            } else {
                engine.process_block(&mut left, &mut right);
            }
            render.extend_from_slice(&left);
        }
        GrinderRender {
            samples: render,
            circuit_stage_samples: engine.debug_circuit_stage_samples(),
            dual_amp_samples: engine.debug_dual_amp_samples(),
        }
    }

    let optimized = render(false);
    let reference = render(true);
    assert_non_silent(&optimized.samples);
    assert_eq!(optimized.dual_amp_samples, 4096);
    assert_eq!(reference.dual_amp_samples, 8192);
    assert_eq!(
        hash_samples(&optimized.samples),
        hash_samples(&reference.samples)
    );
}

/// F9, second half: Capture mode discards the circuit preamp and tone stack.
/// The reference still runs both stages, then throws their result away.
#[test]
fn capture_mode_output_is_unchanged_by_gating_the_circuit_preamp() {
    let configure = |engine: &mut GrinderEngine| {
        engine.set_param("engineMode", 1.0);
        engine.set_param("neuralModelSlot", 0.0);
        engine.set_param("cabType", 2.0);
    };
    let optimized = grinder_render(false, configure);
    let reference = grinder_render(true, configure);
    assert_non_silent(&optimized.samples);
    assert_eq!(optimized.circuit_stage_samples, 0);
    assert_eq!(reference.circuit_stage_samples, 4096);
    assert_eq!(
        hash_samples(&optimized.samples),
        hash_samples(&reference.samples)
    );
}

/// F14: burst resonator coefficients moved from the per-sample loop into
/// `trigger`. This deterministic arithmetic is stable across the hosted
/// platforms, so it retains its captured absolute hash.
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
    assert_non_silent(&render);
    assert_eq!(hash_samples(&render), 7_134_174_258_747_095_649);
}

/// F8 adds the per-sample decay follower and F17 skips the zeroed f32 prefix
/// below the same held chord. The reference keeps the pre-reduction work for
/// both while using the identical piano voice and coefficient path.
#[test]
fn grand_boule_held_chord_renders_identically() {
    fn render(reference: bool) -> (Vec<f32>, usize) {
        // midi 48/60/67 -> keys 28/40/47 (A0 = midi 21 = key 1).
        let chord = [(48_u8, 28_u32, 0.9_f32), (60, 40, 0.7), (67, 47, 0.5)];
        let mut voices = chord
            .iter()
            .map(|&(midi_note, key, velocity)| {
                let mut voice = PianoVoice::new(48_000.0);
                voice.note_on(PianoVoiceStart {
                    midi_note,
                    channel: 0,
                    velocity,
                    key,
                    pitch_ratio: 1.0,
                    stiffness_scale: 1.0,
                    mass_scale: 1.0,
                    attack_length: 0,
                });
                voice
            })
            .collect::<Vec<_>>();

        let mut render = Vec::with_capacity(8192);
        for _ in 0..8192 {
            let mut sample = 0.0_f32;
            for voice in voices.iter_mut() {
                sample += if reference {
                    voice.tick_reference_render()
                } else {
                    voice.tick()
                };
            }
            render.push(sample);
        }
        let follower_updates = voices
            .iter()
            .map(PianoVoice::debug_decay_follower_updates)
            .sum();
        (render, follower_updates)
    }

    let (optimized, optimized_follower_updates) = render(false);
    let (reference, reference_follower_updates) = render(true);
    assert_non_silent(&optimized);
    assert_eq!(optimized_follower_updates, 3 * 8192);
    assert_eq!(reference_follower_updates, 0);
    assert_eq!(hash_samples(&optimized), hash_samples(&reference));
}

/// F17 starts the f32 loop at `f64_partials`, skipping coefficient slots that
/// configuration already zeroed. The reference processes those slots anyway,
/// exactly as the pre-optimization loop did.
#[test]
fn modal_string_renders_identically_when_the_zeroed_prefix_is_skipped() {
    fn render(reference: bool) -> (Vec<f32>, usize, usize) {
        let mut string = ModalString::new();
        // C2 (~65 Hz) puts several partials below the 200 Hz f64 cutoff.
        string.configure(65.406, 16, 0.125, 48_000.0, 0.2, 0.0);
        assert!(
            string.f64_partials() > 0,
            "the test must exercise a non-empty zeroed f32 prefix"
        );

        let tick = |string: &mut ModalString, input: f32| {
            if reference {
                string.tick_including_zeroed_prefix(input)
            } else {
                string.tick(input)
            }
        };
        let mut render = Vec::with_capacity(8192);
        render.push(tick(&mut string, 1.0));
        for _ in 1..8192 {
            render.push(tick(&mut string, 0.0));
        }
        (render, string.debug_f32_iterations(), string.f64_partials())
    }

    let (optimized, optimized_iterations, f64_partials) = render(false);
    let (reference, reference_iterations, reference_f64_partials) = render(true);
    assert_non_silent(&optimized);
    assert_eq!(reference_f64_partials, f64_partials);
    assert_eq!(
        reference_iterations - optimized_iterations,
        f64_partials * 8192,
        "the reference must execute exactly the zeroed iterations F17 skips"
    );
    assert_eq!(hash_samples(&optimized), hash_samples(&reference));
}
