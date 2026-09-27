//! The Decay control on a Toaster pad running the FM Perc engine must shape
//! the hit.
//!
//! `DrumVoice::trigger` writes the pad's `decay` into the engine and then calls
//! `engine.trigger`. `FmPercEngine::set_param(DECAY)` stores its coefficient in
//! `amp_decay_coeff`, but `FmPercEngine::trigger` overwrites that field with a
//! fixed 200 ms decay, so every FM pad rings for the same time whatever its
//! Decay reads. The factory "Metallic Grain" kit ships FM pads at decay 0.1
//! ("FM Zap") and 0.7 ("FM Bell"), which the arm maps to 0.218 s and 1.406 s.

use daw_dsp::toaster::engine::ToasterEngine;

const FRAMES: usize = 128;
const PADS: usize = 16;
const ENGINE_FM_PERC: f32 = 8.0;
const ENGINE_KICK_909: f32 = 14.0;

fn energy(samples: &[f32]) -> f32 {
    samples.iter().map(|sample| sample.abs()).sum()
}

/// Energy of the hit between ~213 ms and ~427 ms after the note at 48 kHz.
fn tail_energy(engine_type: f32, decay: f32) -> f32 {
    let mut engine = ToasterEngine::new(48_000.0, PADS);
    engine.set_pad_param(0, "engine_type", engine_type);
    engine.set_pad_param(0, "decay", decay);
    engine.note_on(0, 127.0, 60);

    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    let mut tail = 0.0;
    for block in 0..160 {
        engine.process_block(&mut left, &mut right);
        if block >= 80 {
            tail += energy(&left) + energy(&right);
        }
    }
    tail
}

#[test]
fn kick_909_decay_shapes_the_tail_control() {
    let short = tail_energy(ENGINE_KICK_909, 0.0);
    let long = tail_energy(ENGINE_KICK_909, 1.0);
    assert!(
        long > short * 4.0,
        "control: 909 kick decay must shape the tail: short={short}, long={long}"
    );
}

#[test]
fn fm_perc_decay_shapes_the_tail() {
    let short = tail_energy(ENGINE_FM_PERC, 0.0);
    let long = tail_energy(ENGINE_FM_PERC, 1.0);
    assert!(
        long > short * 4.0,
        "FM Perc decay 0.0 (0.02 s) and 1.0 (2.0 s) must render different tails: short={short}, long={long}"
    );
}

// ---------------------------------------------------------------------------
// Absolute decay-time checks.
//
// The ratio guards above cannot see two whole classes of lie. A coefficient
// computed against a hardcoded 44100.0 shortens or lengthens EVERY decay
// uniformly, so two settings rendered at the same rate keep their ratio and
// stay green while the hit rings ~9% off its declared time at 48 kHz. And a
// control-to-seconds mapping that halves every value keeps 0.0 vs 1.0
// different and stays green while the arm's calibration is wrong. The checks
// below read the envelope's absolute time constant instead: the tau such that
// the hit falls 60 dB after `tau * ln(1000)` seconds.
// ---------------------------------------------------------------------------

/// One FM hit, concatenated L,R, rendered for `seconds`.
fn fm_perc_hit(decay: f32, sample_rate: f32, seconds: f32) -> Vec<f32> {
    let mut engine = ToasterEngine::new(sample_rate, PADS);
    engine.set_pad_param(0, "engine_type", ENGINE_FM_PERC);
    engine.set_pad_param(0, "decay", decay);
    engine.note_on(0, 127.0, 60);

    let blocks = (seconds * sample_rate / FRAMES as f32).ceil() as usize;
    let mut left = [0.0; FRAMES];
    let mut right = [0.0; FRAMES];
    let mut out = Vec::with_capacity(blocks * FRAMES * 2);
    for _ in 0..blocks {
        engine.process_block(&mut left, &mut right);
        out.extend_from_slice(&left);
        out.extend_from_slice(&right);
    }
    out
}

/// The envelope time constant, measured from the rendered hit.
///
/// The first 0.2 s is discarded so the ~20 ms mod-index envelope settles;
/// after that the carrier is exactly periodic, and a 0.1 s window is exactly
/// 20 periods of the 200 Hz base frequency at 48 kHz, so every whole window
/// integrates the same carrier pattern and the window energies fall as
/// `exp(-t/tau)`. The tau between the first and last measurement window is
/// therefore the amp envelope's own deactivate-time constant.
fn fm_perc_measured_tau(decay: f32, sample_rate: f32, seconds: f32) -> f32 {
    const WINDOW_SECONDS: f32 = 0.1;
    const SETTLE_WINDOWS: usize = 2;

    let samples = fm_perc_hit(decay, sample_rate, seconds);
    let window = (WINDOW_SECONDS * sample_rate) as usize * 2;
    let mut window_energies: Vec<f32> = samples
        .chunks(window)
        .filter(|chunk| chunk.len() == window)
        .map(|chunk| chunk.iter().map(|sample| sample.abs()).sum())
        .collect();
    assert!(
        window_energies.len() > SETTLE_WINDOWS + 1,
        "the render must hold more than the settled windows under test"
    );
    window_energies.drain(..SETTLE_WINDOWS);
    let first = window_energies.first().expect("at least one window");
    let last = window_energies.last().expect("at least one window");
    let elapsed = WINDOW_SECONDS * (window_energies.len() - 1) as f32;
    elapsed / (first / last).ln()
}

/// decay 0.5 declares tau = 0.02 + 0.5 * 1.98 = 1.01 s
/// (`FmPercEngine::set_param`), and the trigger must turn that into a
/// per-sample coefficient with the RENDER'S sample rate. At 48 kHz a
/// coefficient computed against a hardcoded 44100.0 rings tau out 48000/44100
/// = +8.8% long — inside no tolerance this assertion admits.
#[test]
fn fm_perc_envelope_tau_at_48000_hz_matches_the_declared_decay_time() {
    let declared_tau = 1.01;
    let measured = fm_perc_measured_tau(0.5, 48_000.0, 2.5);
    let tolerance = 0.04 * declared_tau;
    assert!(
        (measured - declared_tau).abs() < tolerance,
        "FM Perc decay 0.5 must decay with its declared 1.01 s time constant at 48 kHz: \
         measured tau = {measured:.4} s, allowed ±{tolerance:.4} s"
    );
}

/// The audit docstring's own calibration: the factory "Metallic Grain" kit
/// ships "FM Bell" at Decay 0.7, which the arm maps to 0.02 + 0.7 * 1.98 =
/// 1.406 s. A mapping that clips or rescales the control (a `.min(0.5)`
/// mutation renders this hit at 0.5 s) breaks the shipped kits' voiced decay
/// without touching any ratio between two settings.
#[test]
fn fm_perc_decay_point_seven_calibrates_to_the_documented_1p4_s_tail() {
    let declared_tau = 0.02 + 0.7 * 1.98;
    let measured = fm_perc_measured_tau(0.7, 48_000.0, 3.2);
    let tolerance = 0.10 * declared_tau;
    assert!(
        (measured - declared_tau).abs() < tolerance,
        "FM Perc decay 0.7 (\"FM Bell\") must calibrate to its documented 1.406 s time constant: \
         measured tau = {measured:.4} s, allowed ±{tolerance:.4} s"
    );
}
