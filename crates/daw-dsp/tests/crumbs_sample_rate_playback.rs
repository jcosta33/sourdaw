//! A loaded sample's decoded rate must reach voice playback (issue #3716).
//!
//! Browser preparation decodes at a fixed 44.1 kHz and native loading
//! preserves the file's rate, so a 44.1 kHz pool on a 48 kHz engine is the
//! ordinary case — and a speed computed from pitch alone plays such a sample
//! ~8.84% sharp and fast. Both ingress routes land in the same sample pool
//! (`add_sample` carries the rate), so the engine-level assertion here covers
//! the worklet upload and the native mirror alike.
//!
//! Measured at the output across every mode a note can map through — Quick,
//! Drum, Slice — because each mode builds its own trigger params and any of
//! them could have dropped the rate.

use std::sync::Arc;

use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::sample::SampleData;
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsMode};

const OUTPUT_RATE: f32 = 48_000.0;
const SOURCE_RATE: u32 = 44_100;
const SOURCE_HZ: f32 = 440.0;
/// Half a second of source; at a 48 kHz engine the pre-fix render spent only
/// ~20,300 output frames on it (0.459 s) at ~479 Hz.
const SOURCE_FRAMES: usize = 22_050;
const BLOCK: usize = 128;

/// One 440 Hz sine decoded at 44.1 kHz, loaded the way the worklet port loads
/// decoded PCM: an `Arc<SampleData>` whose metadata carries the source rate.
fn engine_in(mode: CrumbsMode) -> CrumbsEngine {
    let pcm: Vec<f32> = (0..SOURCE_FRAMES)
        .map(|frame| {
            (2.0 * core::f32::consts::PI * SOURCE_HZ * frame as f32 / SOURCE_RATE as f32).sin()
                * 0.8
        })
        .collect();
    let mut engine = CrumbsEngine::new(OUTPUT_RATE);
    let sample_id = engine.add_sample(Arc::new(SampleData::from_mono(pcm, SOURCE_RATE)));
    engine.set_active_sample(sample_id);
    // A flat envelope: the note lasts exactly as long as its source.
    engine.handle_command(CrumbsCommand::SetParam {
        param: daw_dsp::crumbs::types::CrumbsParam::Attack,
        value: 0.0,
    });
    engine.handle_command(CrumbsCommand::SetMode(mode));
    engine
}

/// Render until the engine has been silent for a block; returns the frames
/// that sounded.
fn render_until_done(engine: &mut CrumbsEngine) -> Vec<f32> {
    let mut out = Vec::new();
    let mut silent_blocks = 0;
    for _ in 0..600 {
        let mut left = vec![0.0_f32; BLOCK];
        let mut right = vec![0.0_f32; BLOCK];
        engine.process_block(&mut left, &mut right);
        let peak = left.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
        if peak > 0.0 {
            silent_blocks = 0;
            out.extend_from_slice(&left);
        } else {
            silent_blocks += 1;
            if silent_blocks > 2 && !out.is_empty() {
                break;
            }
        }
    }
    out
}

/// Rising crossings per output second, floored so envelope ripple cannot count.
fn crossing_hz(samples: &[f32]) -> f32 {
    let peak = samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
    assert!(peak > 1e-3, "the engine rendered silence (peak {peak})");
    let floor = peak * 0.25;
    let mut crossings = 0;
    let mut armed = false;
    for sample in samples {
        if *sample < -floor {
            armed = true;
        } else if *sample > floor && armed {
            crossings += 1;
            armed = false;
        }
    }
    crossings as f32 * OUTPUT_RATE / samples.len() as f32
}

fn assert_root_key_pitch_and_duration(engine: &mut CrumbsEngine, note: u8, what: &str) {
    engine.handle_command(CrumbsCommand::NoteOn {
        note,
        velocity: 127,
    });
    let out = render_until_done(engine);

    // Half a second of source at a 48 kHz engine: ~24,000 output frames.
    // Pre-fix the render ran the source dry in 22,050 frames and measured
    // ~479 Hz.
    let expected = (0.5 * OUTPUT_RATE) as usize;
    assert!(
        (out.len() as i64 - expected as i64).abs() <= (2 * BLOCK) as i64,
        "{what}: the 22,050-frame source must sound for ~{expected} output frames, sounded {}",
        out.len()
    );
    let hz = crossing_hz(&out);
    assert!(
        (hz - SOURCE_HZ).abs() < SOURCE_HZ * 0.05,
        "{what}: the root-key render measured {hz:.1} Hz against the sample's own {SOURCE_HZ} Hz"
    );
}

#[test]
fn quick_mode_plays_a_44k1_sample_true_at_a_48k_engine() {
    assert_root_key_pitch_and_duration(&mut engine_in(CrumbsMode::Quick), 60, "Quick");
}

#[test]
fn drum_mode_plays_a_44k1_sample_true_at_a_48k_engine() {
    // Pad 0 holds the loaded sample at its own base note.
    assert_root_key_pitch_and_duration(&mut engine_in(CrumbsMode::Drum), 36, "Drum");
}

#[test]
fn slice_mode_plays_a_44k1_sample_true_at_a_48k_engine() {
    let mut engine = engine_in(CrumbsMode::Slice);
    // One marker covering the whole sample: note 36 plays it at original pitch.
    engine
        .slice_mode_mut()
        .set_markers_from_onsets(&[0], SOURCE_FRAMES as u32);
    assert_root_key_pitch_and_duration(&mut engine, 36, "Slice");
}

#[test]
fn a_transposed_quick_note_keeps_its_interval_against_the_rate_ratio() {
    let mut engine = engine_in(CrumbsMode::Quick);
    engine.handle_command(CrumbsCommand::NoteOn {
        note: 72,
        velocity: 127,
    });
    let out = render_until_done(&mut engine);

    // +12 semitones: an octave up, ~12,000 output frames of the half-second
    // source (the interval alone shortens it, the rate pair does not).
    let expected = (0.25 * OUTPUT_RATE) as usize;
    assert!(
        (out.len() as i64 - expected as i64).abs() <= (2 * BLOCK) as i64,
        "the +12 render must sound for ~{expected} output frames, sounded {}",
        out.len()
    );
    let hz = crossing_hz(&out);
    let target = SOURCE_HZ * 2.0;
    assert!(
        (hz - target).abs() < target * 0.05,
        "the +12 render measured {hz:.1} Hz, expected ~{target:.1}"
    );
}
