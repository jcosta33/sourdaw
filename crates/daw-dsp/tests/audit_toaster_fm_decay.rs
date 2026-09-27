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
