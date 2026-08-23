//! Retained-render contracts for five audio paths whose absolute f32 hashes
//! vary across platform libm implementations, plus one deterministic render
//! that remains bit-exact.
//!
//! Peak and RMS pin each row's level while independent signed projections over
//! non-overlapping windows pin polarity, phase, and sample alignment. These
//! tests preserve the accepted render character; they do not claim historical
//! bit-equivalence to an implementation that is not present for comparison.

use daw_dsp::grand_boule::engine::GrandBouleEngine;
use daw_dsp::grand_boule::mechanical_noise::{MechanicalNoise, NoiseEvent};
use daw_dsp::grand_boule::string::ModalString;
use daw_dsp::grinder::engine::GrinderEngine;

#[path = "support/retained_signal.rs"]
mod retained_signal;

use retained_signal::Contract;

const SERIAL_CONTRACT: Contract = Contract {
    peak: 0.515_945_196_151_733_4,
    rms: 0.143_552_243_153_985_2,
    projections: [
        -0.040_942_879_282_910_294,
        -0.010_198_204_019_696_426,
        -0.039_743_450_272_362_35,
        0.004_656_999_393_152_554,
    ],
};

const DUAL_AMP_CONTRACT: Contract = Contract {
    peak: 0.603_328_943_252_563_5,
    rms: 0.164_024_649_460_511_65,
    projections: [
        -0.024_683_128_235_638_934,
        -0.055_704_666_543_982_664,
        0.005_817_914_126_775_449,
        -0.013_701_024_808_456_948,
    ],
};

const CAPTURE_CONTRACT: Contract = Contract {
    peak: 0.565_128_207_206_726_1,
    rms: 0.141_212_598_528_000_86,
    projections: [
        -0.008_040_537_570_336_73,
        0.017_527_487_064_845_623,
        0.007_775_847_597_784_735,
        0.023_986_268_655_465_187,
    ],
};

const GRAND_BOULE_CONTRACT: Contract = Contract {
    peak: 0.734_753_310_680_389_4,
    rms: 0.182_824_249_399_353_24,
    projections: [
        -0.036_892_330_979_955_3,
        -0.008_884_576_005_635_63,
        -0.012_320_547_678_103_432,
        -0.002_912_273_744_125_708,
    ],
};

const MODAL_STRING_CONTRACT: Contract = Contract {
    peak: 7.244_800_508_487_97e-5,
    rms: 6.740_421_661_263_019e-6,
    projections: [
        0.003_475_431_486_146_232_4,
        0.053_907_726_732_634_74,
        0.008_875_824_585_744_877,
        0.027_794_146_127_891_797,
    ],
};

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

/// Serial routing has a distinct retained level and signed time-domain shape.
#[test]
fn serial_routing_retains_its_render_character() {
    let render = grinder_render(|engine| {
        engine.set_param("routingMode", 0.0);
        engine.set_param("cabType", 2.0);
    });
    retained_signal::assert_matches_contract(&render, &SERIAL_CONTRACT, "serial routing");
}

/// Dual-amp routing is independently pinned so another audible row cannot
/// satisfy every retained-render contract.
#[test]
fn dual_amp_routing_retains_its_render_character() {
    let render = grinder_render(|engine| {
        engine.set_param("routingMode", 3.0);
        engine.set_param("cabType", 2.0);
    });
    retained_signal::assert_matches_contract(&render, &DUAL_AMP_CONTRACT, "dual-amp routing");
}

/// Capture mode has its own retained level and signed time-domain shape.
#[test]
fn capture_mode_retains_its_render_character() {
    let render = grinder_render(|engine| {
        engine.set_param("engineMode", 1.0);
        engine.set_param("neuralModelSlot", 0.0);
        engine.set_param("cabType", 2.0);
    });
    retained_signal::assert_matches_contract(&render, &CAPTURE_CONTRACT, "capture mode");
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

/// The held chord keeps its accepted level and signed time-domain shape.
#[test]
fn grand_boule_held_chord_retains_its_render_character() {
    let render = grand_boule_render();
    retained_signal::assert_matches_contract(&render, &GRAND_BOULE_CONTRACT, "held chord");
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

/// A bass note exercises ModalString's mixed-precision partial ranges and pins
/// their accepted combined render without depending on platform-exact libm.
#[test]
fn modal_string_bass_note_retains_its_render_character() {
    let render = modal_string_render();
    retained_signal::assert_matches_contract(&render, &MODAL_STRING_CONTRACT, "modal bass note");
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
fn retained_signal_contract_rejects_polarity_and_one_sample_shift_mutations() {
    let render = grinder_render(|engine| {
        engine.set_param("routingMode", 0.0);
        engine.set_param("cabType", 2.0);
    });
    retained_signal::assert_matches_contract(&render, &SERIAL_CONTRACT, "serial routing");

    let negated = render.iter().map(|sample| -*sample).collect::<Vec<_>>();
    assert!(
        !retained_signal::matches_contract(&negated, &SERIAL_CONTRACT),
        "the shared retained-signal boundary must reject polarity inversion"
    );

    let mut shifted = vec![0.0_f32; render.len()];
    shifted[1..].copy_from_slice(&render[..render.len() - 1]);
    assert!(
        !retained_signal::matches_contract(&shifted, &SERIAL_CONTRACT),
        "the shared retained-signal boundary must reject a one-sample shift"
    );
}
