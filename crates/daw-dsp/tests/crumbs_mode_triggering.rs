//! What a Crumbs note actually plays in each operating mode.
//!
//! `crumbs::modes` builds a `VoiceTriggerParams` per mode — a pad's sample,
//! root note, envelope and choke group in Drum; a marker's start and end frame
//! in Slice. `CrumbsEngine::note_on` used to build its own params instead, with
//! `start_frame: 0` and `choke_group: 0` hardcoded, so every mode played the
//! active sample chromatically from frame zero and choke groups never choked.
//!
//! Every assertion here is against *audio*: which source frames came out, when
//! they stopped, and whether an earlier voice was still contributing. A guard
//! that only asked "did `trigger_params` get called" would stay green through a
//! `trigger` that discarded the result, which is the shape of the defect.

use std::sync::Arc;

use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::sample::SampleData;
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsMode};

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// A deliberately irregular waveform: it does not repeat within the windows
/// measured here, so reading the wrong frames shows up as a proportionality
/// failure rather than a phase shift that still correlates.
fn fixture_pcm(frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|i| {
            let t = i as f32;
            0.6 * (t * 0.11).sin() + 0.3 * (t * 0.037).cos() + 0.1 * (t * 0.29).sin()
        })
        .collect()
}

/// Constant-amplitude PCM. A DC sample sums exactly under the 8-point sinc at
/// unity rate, so two voices mixing is a clean arithmetic difference rather
/// than something that has to be correlated.
fn flat_pcm(frames: usize, level: f32) -> Vec<f32> {
    vec![level; frames]
}

fn load(engine: &mut CrumbsEngine, pcm: Vec<f32>) -> u32 {
    engine.add_sample(Arc::new(SampleData::from_mono(pcm, SAMPLE_RATE as u32)))
}

/// Render one block. `process_block` adds into its slices, so the buffers are
/// fresh each call.
fn render(engine: &mut CrumbsEngine, frames: usize) -> Vec<f32> {
    let mut left = vec![0.0_f32; frames];
    let mut right = vec![0.0_f32; frames];
    engine.process_block(&mut left, &mut right);
    left
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()))
}

/// The single scale factor relating rendered output to source frames, taken
/// from the largest-magnitude frame so the ratio is well conditioned.
fn scale_factor(rendered: &[f32], expected_source: &[f32]) -> f32 {
    let (index, _) = expected_source
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.abs().total_cmp(&b.abs()))
        .expect("fixture is non-empty");
    rendered[index] / expected_source[index]
}

fn assert_proportional_to(rendered: &[f32], expected_source: &[f32], what: &str) {
    let scale = scale_factor(rendered, expected_source);
    assert!(
        scale > 0.05,
        "{what}: rendered output is ~silent (scale {scale}), so nothing reached the output"
    );
    for (frame, (out, src)) in rendered.iter().zip(expected_source.iter()).enumerate() {
        let expected = src * scale;
        assert!(
            (out - expected).abs() < 1e-4,
            "{what}: frame {frame} was {out}, expected {expected} \
             (source {src} × {scale}) — these are not the frames this note maps to"
        );
    }
}

/// An engine holding one selected sample with the amp envelope flat at unity,
/// so the only thing between the pool and the output is the frame mapping.
fn engine_with(pcm: Vec<f32>, mode: CrumbsMode) -> CrumbsEngine {
    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    let sample_id = load(&mut engine, pcm);
    engine.set_active_sample(sample_id);
    engine.handle_command(CrumbsCommand::SetParam {
        param: daw_dsp::crumbs::types::CrumbsParam::Attack,
        value: 0.0,
    });
    engine.handle_command(CrumbsCommand::SetMode(mode));
    engine
}

fn note_on(engine: &mut CrumbsEngine, note: u8, velocity: u8) {
    engine.handle_command(CrumbsCommand::NoteOn { note, velocity });
}

// ── Notes that map to nothing ──────────────────────────────────────────

#[test]
fn a_drum_note_with_no_pad_assigned_does_not_sound() {
    // No pad in the grid has a sample, so `DrumMode::trigger_params` returns
    // None for every note. The engine used to ignore that and play the active
    // sample chromatically, which made Drum mode an alias for Quick mode.
    let mut engine = engine_with(fixture_pcm(4 * BLOCK), CrumbsMode::Drum);

    note_on(&mut engine, 36, 100);
    let out = render(&mut engine, BLOCK);

    assert_eq!(
        peak(&out),
        0.0,
        "a note on an unassigned pad produced audio, so the pad map was bypassed"
    );
    assert_eq!(engine.read_active_voice_count(), 0, "a voice was allocated for an unassigned pad");
}

#[test]
fn a_slice_note_outside_the_marker_map_does_not_sound() {
    // No markers have been set, so no note maps to a slice.
    let mut engine = engine_with(fixture_pcm(4 * BLOCK), CrumbsMode::Slice);

    note_on(&mut engine, 36, 100);
    let out = render(&mut engine, BLOCK);

    assert_eq!(
        peak(&out),
        0.0,
        "a note with no slice behind it produced audio, so the marker map was bypassed"
    );
}

#[test]
fn a_note_below_the_pad_grid_does_not_sound_even_when_pads_are_loaded() {
    // `DrumMode::note_to_pad` returns None below its base note (36). Pad 0 is
    // loaded, so this fails for the mapping reason rather than for want of a
    // sample anywhere.
    let mut engine = engine_with(fixture_pcm(4 * BLOCK), CrumbsMode::Drum);
    engine.drum_mode_mut().set_pad_sample(0, 0);

    note_on(&mut engine, 24, 100);
    let out = render(&mut engine, BLOCK);

    assert_eq!(peak(&out), 0.0, "a note below the pad grid still triggered a voice");
}

// ── Slice start and end frames ─────────────────────────────────────────

#[test]
fn each_slice_starts_at_its_own_marker() {
    let pcm = fixture_pcm(16 * BLOCK);

    // Three slices over the sample: [0,512), [512,1024), [1024,1024+…).
    // `set_markers_from_onsets` maps them to notes 36, 37, 38.
    let mut first = engine_with(pcm.clone(), CrumbsMode::Slice);
    first.slice_mode_mut().set_markers_from_onsets(&[0, 512, 1024], pcm.len() as u32);
    note_on(&mut first, 37, 100);
    let second_slice = render(&mut first, BLOCK);

    let mut third = engine_with(pcm.clone(), CrumbsMode::Slice);
    third.slice_mode_mut().set_markers_from_onsets(&[0, 512, 1024], pcm.len() as u32);
    note_on(&mut third, 38, 100);
    let third_slice = render(&mut third, BLOCK);

    assert_proportional_to(&second_slice, &pcm[512..512 + BLOCK], "slice mapped to note 37");
    assert_proportional_to(&third_slice, &pcm[1024..1024 + BLOCK], "slice mapped to note 38");

    // The symptom in the ledger: two different slices rendering the same audio
    // because both started at frame 0.
    let divergence = second_slice
        .iter()
        .zip(third_slice.iter())
        .fold(0.0_f32, |acc, (a, b)| acc.max((a - b).abs()));
    assert!(
        divergence > 0.05,
        "two different slices rendered the same audio (max divergence {divergence}), \
         so both started from the same frame"
    );
}

#[test]
fn a_slice_stops_at_its_end_marker_instead_of_running_on() {
    let pcm = fixture_pcm(8 * BLOCK);

    let mut engine = engine_with(pcm.clone(), CrumbsMode::Slice);
    // First slice spans [0, 64) — half a block, so one render shows both the
    // sounding part and the silence after it.
    engine.slice_mode_mut().set_markers_from_onsets(&[0, 64, 512], pcm.len() as u32);

    note_on(&mut engine, 36, 100);
    let out = render(&mut engine, BLOCK);

    assert!(
        peak(&out[..64]) > 0.05,
        "the slice never sounded, so the silence after it proves nothing"
    );
    assert_eq!(
        peak(&out[64..]),
        0.0,
        "the voice kept playing past the slice's end marker"
    );
}

// ── Drum pads ──────────────────────────────────────────────────────────

#[test]
fn a_pad_plays_from_its_own_start_offset() {
    let pcm = fixture_pcm(8 * BLOCK);

    let mut engine = engine_with(pcm.clone(), CrumbsMode::Drum);
    let pad_sample = load(&mut engine, pcm.clone());
    engine.drum_mode_mut().set_pad_sample(0, pad_sample);
    let pad = engine.drum_mode_mut().get_pad_mut(0).expect("pad 0 exists");
    pad.start_offset = 512;
    pad.attack = 0.0;

    note_on(&mut engine, 36, 100);
    let out = render(&mut engine, BLOCK);

    assert_proportional_to(&out, &pcm[512..512 + BLOCK], "pad with a 512-frame start offset");
}

#[test]
fn a_pad_pitches_from_its_own_root_note_not_the_global_one() {
    let pcm = fixture_pcm(8 * BLOCK);

    let mut engine = engine_with(pcm.clone(), CrumbsMode::Drum);
    let pad_sample = load(&mut engine, pcm.clone());
    engine.drum_mode_mut().set_pad_sample(0, pad_sample);
    let pad = engine.drum_mode_mut().get_pad_mut(0).expect("pad 0 exists");
    // An octave below the note, so the pad reads at exactly double rate and
    // lands on even frames without interpolation error. The engine-wide root
    // note is 60, which would give 0.25× instead.
    pad.root_note = 24;
    pad.attack = 0.0;

    note_on(&mut engine, 36, 100);
    let out = render(&mut engine, BLOCK);

    let every_other: Vec<f32> = (0..BLOCK).map(|i| pcm[i * 2]).collect();
    assert_proportional_to(&out, &every_other, "pad rooted an octave below the note");
}

#[test]
fn a_pad_uses_its_own_envelope_rather_than_the_engine_wide_one() {
    let pcm = flat_pcm(8 * BLOCK, 1.0);

    // `engine_with` sets the engine-wide attack to 0.0. The AHDSR's
    // exponential-to-target shape rises fast early — a 50 ms attack is already
    // 39% up after one 128-frame block — so the pad carries a half-second
    // attack, which is ~5% up over the same block. The value is chosen for
    // separation, not for musicality.
    let mut slow = engine_with(pcm.clone(), CrumbsMode::Drum);
    let slow_sample = load(&mut slow, pcm.clone());
    slow.drum_mode_mut().set_pad_sample(0, slow_sample);
    slow.drum_mode_mut().get_pad_mut(0).expect("pad 0 exists").attack = 0.5;
    note_on(&mut slow, 36, 127);
    let slow_out = render(&mut slow, BLOCK);

    let mut instant = engine_with(pcm.clone(), CrumbsMode::Drum);
    let instant_sample = load(&mut instant, pcm.clone());
    instant.drum_mode_mut().set_pad_sample(0, instant_sample);
    instant.drum_mode_mut().get_pad_mut(0).expect("pad 0 exists").attack = 0.0;
    note_on(&mut instant, 36, 127);
    let instant_out = render(&mut instant, BLOCK);

    assert!(
        peak(&instant_out) > 0.5,
        "the reference pad never sounded, so the comparison proves nothing"
    );
    let ratio = peak(&slow_out) / peak(&instant_out);
    assert!(
        ratio < 0.1,
        "a pad with a half-second attack reached {ratio}× the instant-attack pad's \
         peak in one block, so the engine-wide envelope was used instead of the pad's"
    );
}

// ── Choke groups ───────────────────────────────────────────────────────

/// Pads 0 and 1 share choke group 1, each with a flat sample at a distinct
/// level, so a mix of the two is arithmetically obvious.
fn choke_pair_engine(closed_level: f32, open_level: f32) -> CrumbsEngine {
    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    let closed = load(&mut engine, flat_pcm(16 * BLOCK, closed_level));
    let open = load(&mut engine, flat_pcm(16 * BLOCK, open_level));
    engine.set_active_sample(closed);
    engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Drum));

    engine.drum_mode_mut().set_pad_sample(0, closed);
    engine.drum_mode_mut().set_pad_sample(1, open);
    engine.drum_mode_mut().set_pad_choke_group(0, 1);
    engine.drum_mode_mut().set_pad_choke_group(1, 1);
    for pad_index in 0..2 {
        engine
            .drum_mode_mut()
            .get_pad_mut(pad_index)
            .expect("pad exists")
            .attack = 0.0;
    }
    engine
}

#[test]
fn a_pad_in_a_choke_group_cuts_the_voice_already_sounding_in_it() {
    // Open and closed hi-hat: striking the second must silence the first.
    let mut choked = choke_pair_engine(1.0, 0.4);
    note_on(&mut choked, 36, 127);
    let first_alone = render(&mut choked, BLOCK);
    note_on(&mut choked, 37, 127);
    // The choke starts a 3 ms de-click fade (144 frames), so measure past it.
    for _ in 0..4 {
        render(&mut choked, BLOCK);
    }
    let after_choke = render(&mut choked, BLOCK);

    // The same second pad, struck on its own, is the level the choked engine
    // has to match. Both peaks come off the same gain chain, so this compares
    // engine output against engine output rather than against a constant.
    let mut solo = choke_pair_engine(1.0, 0.4);
    note_on(&mut solo, 37, 127);
    for _ in 0..5 {
        render(&mut solo, BLOCK);
    }
    let solo_second = render(&mut solo, BLOCK);

    assert!(peak(&first_alone) > 0.1, "the first pad never sounded");
    assert!(peak(&solo_second) > 0.1, "the second pad never sounded on its own");

    let ratio = peak(&after_choke) / peak(&solo_second);
    assert!(
        (ratio - 1.0).abs() < 0.02,
        "after choking, the output was {ratio}× the second pad alone — the first \
         pad was still contributing, so the choke group did not choke"
    );
    assert_eq!(
        choked.read_active_voice_count(),
        1,
        "both choke-group voices were still active after the second was struck"
    );
}

#[test]
fn pads_in_different_choke_groups_both_keep_sounding() {
    // The other half of the claim: choking must be scoped to the group, not
    // applied to every previous voice.
    let mut engine = choke_pair_engine(1.0, 0.4);
    engine.drum_mode_mut().set_pad_choke_group(1, 2);

    note_on(&mut engine, 36, 127);
    render(&mut engine, BLOCK);
    note_on(&mut engine, 37, 127);
    for _ in 0..4 {
        render(&mut engine, BLOCK);
    }
    let both = render(&mut engine, BLOCK);

    let mut solo = choke_pair_engine(1.0, 0.4);
    note_on(&mut solo, 37, 127);
    for _ in 0..5 {
        render(&mut solo, BLOCK);
    }
    let solo_second = render(&mut solo, BLOCK);

    let ratio = peak(&both) / peak(&solo_second);
    assert!(
        ratio > 3.0,
        "two pads in different choke groups summed to {ratio}× the second alone, \
         so the first was cut when it should have kept sounding"
    );
    assert_eq!(engine.read_active_voice_count(), 2, "a voice outside the choke group was cut");
}

#[test]
fn a_pad_with_no_choke_group_does_not_cut_anything() {
    // Choke group 0 means "no group". Treating it as a group would mute the
    // whole kit on every hit.
    let mut engine = choke_pair_engine(1.0, 0.4);
    engine.drum_mode_mut().set_pad_choke_group(0, 0);
    engine.drum_mode_mut().set_pad_choke_group(1, 0);

    note_on(&mut engine, 36, 127);
    render(&mut engine, BLOCK);
    note_on(&mut engine, 37, 127);
    for _ in 0..4 {
        render(&mut engine, BLOCK);
    }
    let both = render(&mut engine, BLOCK);

    assert_eq!(engine.read_active_voice_count(), 2, "an ungrouped pad cut the previous voice");
    assert!(
        peak(&both) > 0.5,
        "the ungrouped pair rendered {} — the previous voice was cut",
        peak(&both)
    );
}

// ── Quick mode is unchanged ────────────────────────────────────────────

#[test]
fn quick_mode_still_plays_the_active_sample_chromatically() {
    // The regression pin for the mode that was already correct: routing
    // through `QuickMode` must not move it.
    let pcm = fixture_pcm(8 * BLOCK);
    let mut engine = engine_with(pcm.clone(), CrumbsMode::Quick);

    note_on(&mut engine, 72, 100);
    let out = render(&mut engine, BLOCK);

    // Root note 60, note 72 — one octave up, so every other source frame.
    let every_other: Vec<f32> = (0..BLOCK).map(|i| pcm[i * 2]).collect();
    assert_proportional_to(&out, &every_other, "quick mode an octave above the root");
}
