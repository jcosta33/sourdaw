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
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsMode, MAX_VOICES};

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

/// Render the *second* block, so the measurement sits past `PadConfig`'s
/// shipped 1 ms attack (48 frames at 48 kHz) and the envelope is flat at
/// sustain. Used where the claim is about which frames a note maps to and
/// the pad is deliberately left at its defaults.
fn render_second_block(engine: &mut CrumbsEngine) -> Vec<f32> {
    render(engine, BLOCK);
    render(engine, BLOCK)
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

// ── Defaults: both modes sound before anyone configures them ───────────

#[test]
fn a_freshly_loaded_sample_sounds_on_the_base_note_pad() {
    // Loading a sample and switching to Drum is the whole interaction, and it
    // has to leave something playable: the sample lands on the base-note pad,
    // the way a sample dropped on a drum rack takes one pad.
    let pcm = fixture_pcm(8 * BLOCK);
    let mut engine = engine_with(pcm.clone(), CrumbsMode::Drum);

    note_on(&mut engine, 36, 100);
    let out = render_second_block(&mut engine);

    // Pad 0's root note is its own note, so it plays at unity.
    assert_proportional_to(&out, &pcm[BLOCK..2 * BLOCK], "the base-note pad");
}

#[test]
fn an_unassigned_pad_above_the_base_note_stays_silent() {
    // The other half of the convention, and the one that keeps `None` doing
    // real work: only pad 0 gets the loaded sample. A blanket fallback would
    // make every pad play the same hit, which is a state no sampler has.
    let pcm = fixture_pcm(8 * BLOCK);

    for note in [37_u8, 40, 51] {
        let mut engine = engine_with(pcm.clone(), CrumbsMode::Drum);
        note_on(&mut engine, note, 100);
        let out = render(&mut engine, BLOCK);

        assert_eq!(
            peak(&out),
            0.0,
            "note {note} sounded on an unassigned pad, so the loaded sample was \
             spread across the grid instead of landing on one pad"
        );
        assert_eq!(
            engine.read_active_voice_count(),
            0,
            "a voice was allocated for unassigned pad at note {note}"
        );
    }
}

#[test]
fn an_explicit_pad_assignment_wins_over_the_loaded_sample() {
    // Precedence on the one pad where both could apply: the base-note pad
    // holds the loaded sample by default, and an assignment must displace it.
    let loaded_pcm = fixture_pcm(8 * BLOCK);
    let mut engine = engine_with(loaded_pcm.clone(), CrumbsMode::Drum);
    // A second sample, flat rather than irregular, so which one played is
    // unambiguous.
    let assigned = load(&mut engine, flat_pcm(8 * BLOCK, 0.5));
    engine.drum_mode_mut().set_pad_sample(0, assigned);

    note_on(&mut engine, 36, 100);
    let assigned_pad = render_second_block(&mut engine);

    let mut untouched = engine_with(loaded_pcm.clone(), CrumbsMode::Drum);
    note_on(&mut untouched, 36, 100);
    let default_pad = render_second_block(&mut untouched);

    assert_proportional_to(
        &assigned_pad,
        &flat_pcm(BLOCK, 0.5),
        "explicitly assigned pad 0",
    );
    assert_proportional_to(
        &default_pad,
        &loaded_pcm[BLOCK..2 * BLOCK],
        "pad 0 left holding the loaded sample",
    );
}

#[test]
fn a_freshly_loaded_sample_sounds_in_slice_mode_with_no_markers() {
    // A slicer handed a sample slices it. Waiting to be handed markers has the
    // dependency backwards.
    let pcm = fixture_pcm(32 * BLOCK);
    let mut engine = engine_with(pcm.clone(), CrumbsMode::Slice);

    note_on(&mut engine, 36, 100);
    let out = render(&mut engine, BLOCK);

    assert_proportional_to(&out, &pcm[..BLOCK], "first default slice");
}

#[test]
fn the_default_chop_maps_consecutive_notes_to_consecutive_sixteenths() {
    // Sixteen equal parts, one per note upward from the base note. The count
    // is written here rather than imported so this pins the convention instead
    // of restating whatever the constant happens to say.
    let pcm = fixture_pcm(32 * BLOCK);
    let slice_len = pcm.len() / 16;

    let mut second = engine_with(pcm.clone(), CrumbsMode::Slice);
    note_on(&mut second, 37, 100);
    let second_slice = render(&mut second, BLOCK);

    let mut third = engine_with(pcm.clone(), CrumbsMode::Slice);
    note_on(&mut third, 38, 100);
    let third_slice = render(&mut third, BLOCK);

    assert_proportional_to(
        &second_slice,
        &pcm[slice_len..slice_len + BLOCK],
        "second default slice",
    );
    assert_proportional_to(
        &third_slice,
        &pcm[2 * slice_len..2 * slice_len + BLOCK],
        "third default slice",
    );

    let divergence = second_slice
        .iter()
        .zip(third_slice.iter())
        .fold(0.0_f32, |acc, (a, b)| acc.max((a - b).abs()));
    assert!(
        divergence > 0.05,
        "two default slices rendered the same audio (max divergence {divergence}), \
         so the chop is not dividing the sample"
    );
}

#[test]
fn a_note_past_the_last_default_slice_does_not_sound() {
    // Sixteen slices from note 36 means note 52 is past the end. Without this
    // edge the "default chop" would be indistinguishable from "any note plays
    // from somewhere".
    let pcm = fixture_pcm(32 * BLOCK);
    let mut engine = engine_with(pcm, CrumbsMode::Slice);

    note_on(&mut engine, 52, 100);
    let out = render(&mut engine, BLOCK);

    assert_eq!(
        peak(&out),
        0.0,
        "a note past the sixteenth slice still sounded"
    );
    // Silence alone is weak here: a slice computed past the end of the sample
    // reads zeros and sounds identical to no slice at all, while still burning
    // a voice. The upper bound is what stops the voice being allocated.
    assert_eq!(
        engine.read_active_voice_count(),
        0,
        "a voice was allocated for a note past the last default slice"
    );
}

#[test]
fn detected_markers_replace_the_default_chop() {
    let pcm = fixture_pcm(32 * BLOCK);
    let mut engine = engine_with(pcm.clone(), CrumbsMode::Slice);
    // Three onsets, so note 37 is the marker at 700 rather than the default
    // sixteenth boundary at len/16.
    engine
        .slice_mode_mut()
        .set_markers_from_onsets(&[0, 700, 1_400], pcm.len() as u32);

    note_on(&mut engine, 37, 100);
    let out = render(&mut engine, BLOCK);

    assert_proportional_to(&out, &pcm[700..700 + BLOCK], "slice from a detected onset");
}

// ── Notes that map to nothing ──────────────────────────────────────────

#[test]
fn a_drum_note_is_silent_when_nothing_is_loaded() {
    // The default kit is the loaded sample. With an empty pool there is no
    // sample to default to, and `DrumMode::trigger_params` must still return
    // None rather than triggering a voice against a missing sample.
    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Drum));

    note_on(&mut engine, 36, 100);
    let out = render(&mut engine, BLOCK);

    assert_eq!(
        peak(&out),
        0.0,
        "a note produced audio with an empty sample pool"
    );
    assert_eq!(
        engine.read_active_voice_count(),
        0,
        "a voice was allocated with nothing to play"
    );
}

#[test]
fn a_slice_note_is_silent_when_nothing_is_loaded() {
    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Slice));

    note_on(&mut engine, 36, 100);
    let out = render(&mut engine, BLOCK);

    assert_eq!(
        peak(&out),
        0.0,
        "a slice note produced audio with an empty sample pool"
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

    assert_eq!(
        peak(&out),
        0.0,
        "a note below the pad grid still triggered a voice"
    );
}

// ── Slice start and end frames ─────────────────────────────────────────

#[test]
fn each_slice_starts_at_its_own_marker() {
    let pcm = fixture_pcm(16 * BLOCK);

    // Three slices over the sample: [0,512), [512,1024), [1024,1024+…).
    // `set_markers_from_onsets` maps them to notes 36, 37, 38.
    let mut first = engine_with(pcm.clone(), CrumbsMode::Slice);
    first
        .slice_mode_mut()
        .set_markers_from_onsets(&[0, 512, 1024], pcm.len() as u32);
    note_on(&mut first, 37, 100);
    let second_slice = render(&mut first, BLOCK);

    let mut third = engine_with(pcm.clone(), CrumbsMode::Slice);
    third
        .slice_mode_mut()
        .set_markers_from_onsets(&[0, 512, 1024], pcm.len() as u32);
    note_on(&mut third, 38, 100);
    let third_slice = render(&mut third, BLOCK);

    assert_proportional_to(
        &second_slice,
        &pcm[512..512 + BLOCK],
        "slice mapped to note 37",
    );
    assert_proportional_to(
        &third_slice,
        &pcm[1024..1024 + BLOCK],
        "slice mapped to note 38",
    );

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
    engine
        .slice_mode_mut()
        .set_markers_from_onsets(&[0, 64, 512], pcm.len() as u32);

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

    assert_proportional_to(
        &out,
        &pcm[512..512 + BLOCK],
        "pad with a 512-frame start offset",
    );
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
    slow.drum_mode_mut()
        .get_pad_mut(0)
        .expect("pad 0 exists")
        .attack = 0.5;
    note_on(&mut slow, 36, 127);
    let slow_out = render(&mut slow, BLOCK);

    let mut instant = engine_with(pcm.clone(), CrumbsMode::Drum);
    let instant_sample = load(&mut instant, pcm.clone());
    instant.drum_mode_mut().set_pad_sample(0, instant_sample);
    instant
        .drum_mode_mut()
        .get_pad_mut(0)
        .expect("pad 0 exists")
        .attack = 0.0;
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

/// Pads 0 and 1 in choke group 1, plus pad 2 outside every group with a sample
/// of its own.
///
/// Nothing chokes pad 2, so it stands in for the sustaining material a kit is
/// played over — a cymbal tail under a hi-hat pair. Its presence is what makes
/// the steal *choice* observable: without it a scan that passes over the group
/// has nowhere else to land, and dropping the note and cutting an unrelated
/// voice look the same from outside.
fn choke_pair_with_free_pad_engine() -> CrumbsEngine {
    let mut engine = choke_pair_engine(1.0, 0.4);
    let free = load(&mut engine, flat_pcm(16 * BLOCK, 0.7));
    engine.drum_mode_mut().set_pad_sample(2, free);
    engine
        .drum_mode_mut()
        .get_pad_mut(2)
        .expect("pad exists")
        .attack = 0.0;
    engine
}

/// A voice already fading must not be stolen again.
///
/// `choke_voices_in_group` deliberately leaves the allocator slot alone and
/// starts only the 3 ms de-click fade, because releasing it would let the very
/// next `allocate` hand the same slot back and jump-cut the waveform. That
/// protection held only while the pool had a free slot elsewhere: once
/// saturated, `find_steal_target` scored a just-choked voice as `ChokeGroup` —
/// its second-highest priority — and took it, so the two passes undid each
/// other and the choke became the click it was written to avoid.
///
/// Putting the scan in front of fading voices *and nothing else* takes a stack,
/// not a single note. `note_on` reserves before it chokes, so the newest voice
/// in a group is always still live, and it is the legitimate victim — see
/// `a_saturated_pool_takes_the_choke_group_rather_than_an_unrelated_voice`. A
/// two-voice stack exhausts it: the first half reserves that one live
/// group-mate, and the second half is left with fades.
#[test]
fn a_choked_voice_is_not_stolen_again_while_its_fade_is_running() {
    let mut engine = choke_pair_engine(1.0, 0.4);

    // Fill the pool. Every pad in the fixture shares choke group 1, so each of
    // these chokes the ones before it and the pool ends up saturated with
    // note-36 voices of which every one but the last is fading.
    for _ in 0..MAX_VOICES {
        note_on(&mut engine, 36, 127);
    }

    // Render so those fades are *running* rather than merely flagged: they
    // advance only in `process_block`. One block is 128 frames against the
    // 144-frame fade, so none has reached silence and no slot has gone back to
    // the allocator — which the saturation check below is what proves.
    render(&mut engine, BLOCK);
    assert_eq!(
        engine.playable_voice_count(),
        MAX_VOICES,
        "a fade ran out inside the first block, so the pool was no longer \
         saturated and the note below would have taken a free slot without \
         ever consulting the steal scan"
    );

    // Two voices per note. The first takes the single live group-mate; the
    // second finds only voices on their way out.
    engine.handle_command(CrumbsCommand::SetParam {
        param: daw_dsp::crumbs::types::CrumbsParam::StackCount,
        value: 2.0,
    });
    note_on(&mut engine, 37, 127);

    // Nothing already fading was taken, so no voice carries note 37 — and the
    // reservation being all-or-nothing, the live group-mate the first half of
    // the stack had reserved is handed back untouched rather than silenced for
    // a note that never landed.
    //
    // Asserting the note *identity* rather than a level: summing 128 voices
    // cannot isolate one being overwritten, and an earlier version of this test
    // measured exactly that and passed with the fix reverted.
    assert!(
        !engine.any_active_voice_has_note(37),
        "note 37 took a slot inside the de-click fade, so the steal pass \
         overwrote a voice the choke pass had just started fading — the click \
         the choke path leaves its allocator slot alone to avoid"
    );
    assert_eq!(
        engine.active_voices_with_note(36),
        MAX_VOICES,
        "a note-36 voice went missing although the stack never landed, so an \
         incomplete reservation consumed a steal target it then abandoned"
    );
}

/// A saturated pool gives up the incoming note's own choke group, not an
/// unrelated voice that happens to be quiet.
///
/// The group-mate is spent whichever way the scan goes: `note_on` reserves,
/// then `choke_voices_in_group` fades every live voice in the group, this one
/// included. Stealing it only starts that same `FADE_STOLEN_SECS` de-click one
/// call earlier — `move_voice_to_steal_tail` fades it in a tail slot while the
/// incoming note takes the slot on the same sample — so nothing extra is lost.
/// Passing over it, on the other hand, sends the scan down to `Oldest`, where
/// the cost falls on a sustaining note the choke was never going to touch: an
/// open hi-hat that eats a cymbal tail and then chokes the closed hat three
/// milliseconds later anyway. Two voices where one was free, which is not what
/// a drum sampler does with a choke pair.
#[test]
fn a_saturated_pool_takes_the_choke_group_rather_than_an_unrelated_voice() {
    const UNRELATED: usize = 8;

    let mut engine = choke_pair_with_free_pad_engine();

    // Sustaining voices outside the group first, then the group fills the rest
    // of the pool. Note 38 is in no choke group, so nothing here ever fades it.
    for _ in 0..UNRELATED {
        note_on(&mut engine, 38, 127);
    }
    for _ in 0..(MAX_VOICES - UNRELATED) {
        note_on(&mut engine, 36, 127);
    }
    render(&mut engine, BLOCK);

    assert_eq!(
        engine.playable_voice_count(),
        MAX_VOICES,
        "the pool was not saturated, so the note below would have found a free \
         slot and never gone stealing"
    );
    assert_eq!(
        engine.active_voices_with_note(38),
        UNRELATED,
        "the unrelated voices were already gone before the note under test, so \
         their survival afterwards would prove nothing"
    );

    // The open hat, against one live closed hat and a pool of fades.
    note_on(&mut engine, 37, 127);

    assert_eq!(
        engine.active_voices_with_note(37),
        1,
        "the open hat never sounded: a live voice in its own choke group was \
         available and the scan took nothing"
    );
    assert_eq!(
        engine.active_voices_with_note(38),
        UNRELATED,
        "the open hat cut an unrelated sustaining voice, which the choke pass \
         does not touch — and it faded the closed hat a moment later anyway, \
         so this costs two voices where one was free"
    );
    // Every note-36 voice in this fixture is `active` whether it is live or
    // mid-fade, so this count cannot name *which* one went: it says a note-36
    // voice left the pool, and read with the note-38 assertion above, that the
    // slot the open hat took was a group-mate's rather than an outsider's.
    // Which group-mate — the live one rather than a fade — is what
    // `a_choked_voice_is_not_stolen_again_while_its_fade_is_running` covers.
    assert_eq!(
        engine.active_voices_with_note(36),
        MAX_VOICES - UNRELATED - 1,
        "no note-36 voice left the pool, so the open hat's slot came from \
         somewhere other than its own choke group"
    );
}

#[test]
fn a_stack_lands_whole_when_only_part_of_it_has_free_slots() {
    let mut engine = choke_pair_engine(1.0, 0.4);
    engine.handle_command(CrumbsCommand::SetParam {
        param: daw_dsp::crumbs::types::CrumbsParam::StackCount,
        value: 7.0,
    });

    for _ in 0..18 {
        note_on(&mut engine, 36, 127);
    }
    assert_eq!(engine.playable_voice_count(), 126);

    note_on(&mut engine, 37, 127);

    assert_eq!(
        engine.active_voices_with_note(37),
        7,
        "the two free slots admitted only part of a seven-voice stack"
    );
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
    assert!(
        peak(&solo_second) > 0.1,
        "the second pad never sounded on its own"
    );

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
    assert_eq!(
        engine.read_active_voice_count(),
        2,
        "a voice outside the choke group was cut"
    );
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

    assert_eq!(
        engine.read_active_voice_count(),
        2,
        "an ungrouped pad cut the previous voice"
    );
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
