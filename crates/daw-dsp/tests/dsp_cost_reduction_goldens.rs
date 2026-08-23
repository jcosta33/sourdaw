//! Bit-exactness goldens for the audio-path cost reductions that must not
//! move a single sample.
//!
//! Contract: five of the six goldens pin their optimization by SAME-RUN
//! equivalence. The optimized render is hashed against a reference render,
//! produced in the same process, that runs the pre-optimization computation —
//! the cost-gated dual amp chain and circuit preamp
//! (`GrinderEngine::set_reference_render`), the zeroed f32 prefix
//! (`ModalString::tick_including_zeroed_prefix`), the decay follower and
//! prefix together (`PianoVoice::tick_reference_render`). Both sides share
//! one libm, so each of those assertions is platform-independent and
//! stronger than a captured constant: it fails on any machine whose
//! optimized path disagrees with its own reference. The sixth, the F14
//! burst-resonator golden, keeps a captured absolute constant and with it
//! the residual libm risk disclosed below.
//!
//! The renders pass through f32 transcendentals (`tanh`, `exp`, `sin`) whose
//! last-bit rounding is not specified across C runtimes, which is why the
//! original captured absolute hashes were replaced: the same source rendered
//! different hashes across Linux libm variants, so an absolute pin cannot
//! hold on a hosted runner. The one exception is the mechanical-noise golden
//! at the bottom, whose arithmetic has matched every libm tried and keeps its
//! captured constant; if a platform ever disagrees with it, re-capture that
//! single constant in its own commit.
//!
//! Each render is hashed rather than compared element-wise so the assertion
//! is sensitive to every bit of every sample while staying readable.

use daw_dsp::grand_boule::engine::GrandBouleEngine;
use daw_dsp::grand_boule::mechanical_noise::{MechanicalNoise, NoiseEvent};
use daw_dsp::grand_boule::string::ModalString;
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

/// A silent render would make any hash equality vacuous, so every golden
/// first observes that the optimized path actually produced audio. The
/// comparison is `abs() > 0.0`, not `!= 0.0`, because NaN satisfies the
/// latter: an all-NaN render must fail here instead of passing vacuously.
fn assert_non_silent(render: &[f32]) {
    assert!(
        render.iter().any(|sample| sample.abs() > 0.0),
        "golden render must produce audio or the equivalence pin is vacuous"
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

fn grinder_render(reference: bool, configure: impl Fn(&mut GrinderEngine)) -> Vec<f32> {
    let mut engine = GrinderEngine::new(48_000.0);
    engine.set_param("channel", 1.0);
    engine.set_param("gain", 6.0);
    engine.set_param("master", 5.0);
    engine.set_reference_render(reference);
    configure(&mut engine);

    let mut left = stimulus(4096);
    let mut right = left.clone();
    engine.process_block(&mut left, &mut right);
    left
}

/// F9: the dual power amp and output transformer ran in every routing mode
/// but were read only under DualAmp. Gating them must not move Serial output,
/// so Serial renders once gated and once through the reference engine that
/// still runs the chain and discards the result.
#[test]
fn serial_routing_output_is_unchanged_by_gating_the_dual_amp_chain() {
    let configure = |engine: &mut GrinderEngine| {
        engine.set_param("routingMode", 0.0);
        engine.set_param("cabType", 2.0);
    };
    let optimized = grinder_render(false, configure);
    assert_non_silent(&optimized);
    assert_eq!(
        hash_samples(&optimized),
        hash_samples(&grinder_render(true, configure))
    );
}

/// The mode that does read the dual chain must be unchanged too. Both
/// engines render a Serial half — the reference engine runs the dual chain
/// through it, charging the state the gating leaves frozen — then switch
/// into DualAmp and render again. Equality observes both that the discarded
/// Serial-half computation moves nothing and that entering DualAmp clears
/// every trace of it.
#[test]
fn dual_amp_routing_output_is_unchanged() {
    fn render(reference: bool) -> Vec<f32> {
        let mut engine = GrinderEngine::new(48_000.0);
        engine.set_param("channel", 1.0);
        engine.set_param("gain", 6.0);
        engine.set_param("master", 5.0);
        engine.set_param("routingMode", 0.0);
        engine.set_param("cabType", 2.0);
        engine.set_reference_render(reference);

        let mut render = Vec::with_capacity(8192);
        for block in 0..2 {
            if block == 1 {
                engine.set_param("routingMode", 3.0);
            }
            let mut left = stimulus(4096);
            let mut right = left.clone();
            engine.process_block(&mut left, &mut right);
            render.extend_from_slice(&left);
        }
        render
    }

    let optimized = render(false);
    assert_non_silent(&optimized);
    assert_eq!(hash_samples(&optimized), hash_samples(&render(true)));
}

/// F9, second half: Capture mode discarded the preamp and tone stack. Not
/// running them must leave Capture output identical, pinned against the
/// reference engine that still runs them and throws the result away.
#[test]
fn capture_mode_output_is_unchanged_by_gating_the_circuit_preamp() {
    let configure = |engine: &mut GrinderEngine| {
        engine.set_param("engineMode", 1.0);
        engine.set_param("neuralModelSlot", 0.0);
        engine.set_param("cabType", 2.0);
    };
    let optimized = grinder_render(false, configure);
    assert_non_silent(&optimized);
    assert_eq!(
        hash_samples(&optimized),
        hash_samples(&grinder_render(true, configure))
    );
}

/// F14: burst resonator coefficients moved from the per-sample loop into
/// `trigger`. They were already constant per burst, so the output must be
/// identical for a fixed seed and trigger sequence. This arithmetic has
/// matched every libm tried, so it keeps its captured absolute hash.
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

/// F8 adds a per-sample output follower to every voice and F17 skips the
/// zeroed f32 prefix inside each string, both under the same held chord; F14
/// is pinned by the mechanical-noise golden above. The approved Grand Boule
/// engine path, including the project-authored FIR body and tuning redesign,
/// renders once normally and once through the pre-cost-reduction voice path.
#[test]
fn grand_boule_held_chord_renders_identically() {
    fn render(reference: bool) -> Vec<f32> {
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
            if reference {
                engine.process_block_reference(&mut left, &mut right);
            } else {
                engine.process_block(&mut left, &mut right);
            }
            render.extend_from_slice(&left);
        }
        render
    }

    let optimized = render(false);
    assert_non_silent(&optimized);
    assert_eq!(hash_samples(&optimized), hash_samples(&render(true)));
}

/// F17: the f32 partial loop now starts at `f64_partials`, skipping slots
/// `configure` had already zeroed. A bass note exercises that prefix; the
/// reference tick processes the prefix anyway, as the pre-optimization loop
/// did, and must land on the same bits.
#[test]
fn modal_string_renders_identically_when_the_zeroed_prefix_is_skipped() {
    fn render(reference: bool) -> Vec<f32> {
        let mut string = ModalString::new();
        // C2 (~65 Hz): several partials fall below the 200 Hz f64 cutoff, so
        // the f32 arrays carry a zeroed prefix.
        string.configure(65.406, 16, 0.125, 48_000.0, 0.2, 0.0);
        assert!(
            string.f64_partials() > 0,
            "the bass configuration must zero a prefix or this golden is vacuous"
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
        render
    }

    let optimized = render(false);
    assert_non_silent(&optimized);
    assert_eq!(hash_samples(&optimized), hash_samples(&render(true)));
}
