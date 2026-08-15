//! A per-note articulation the loaded bank does not ship must still sound.
//!
//! `resolveMidiNoteArticulationId` maps a project's articulation name to a
//! fixed engine id (`staccato` is always 8), and the note carries that id
//! whether or not the instrument the track happens to be pointed at has any
//! zones for it. Every shipped Levain bank is a subset of the 28-name table.
//!
//! `note_on_with_channel_and_articulation` used to route an empty zone lookup
//! to the fallback sine tone. That tone is disabled the moment a real bank
//! commits, so the note produced nothing at all: no voice, no signal. Assigning
//! an articulation the bank lacks silenced the note instead of playing it with
//! the articulation the channel was already on.
//!
//! These tests assert on rendered signal and voice count, so restoring the
//! straight-to-fallback path fails here rather than silently muting notes.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 64;

/// The id `resolveMidiNoteArticulationId` returns for `staccato`. No shipped
/// bank is required to have zones for it.
const STACCATO: u16 = 8;
/// The id every bank ships, and the engine's default keyswitch state.
const SUSTAIN: u16 = 0;

/// Render `BLOCKS` blocks and return the loudest absolute sample seen.
fn render_peak(instance: &mut LevainInstance) -> f32 {
    let mut peak = 0.0_f32;
    for _ in 0..BLOCKS {
        let left_ptr = instance.process(BLOCK as u32);
        let right_ptr = instance.get_right_ptr();
        // SAFETY: `process` guarantees BLOCK valid f32s in each channel buffer.
        let left = unsafe { std::slice::from_raw_parts(left_ptr, BLOCK) };
        let right = unsafe { std::slice::from_raw_parts(right_ptr, BLOCK) };
        for sample in left.iter().chain(right.iter()) {
            peak = peak.max(sample.abs());
        }
    }
    peak
}

/// A bank holding one sustain zone across the whole keyboard, committed so the
/// fallback tone is disabled — the state every real instrument load ends in.
/// `num_articulations` is declared as the full table so ids 1..=27 pass the
/// zone map's range check and resolve to empty slots, which is what a bank
/// that ships only sustain looks like from a note carrying id 8.
fn sustain_only_instance() -> LevainInstance {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");

    let frame_count = SAMPLE_RATE as u32;
    let mut pcm = Vec::with_capacity(frame_count as usize);
    for frame in 0..frame_count {
        let phase = frame as f32 / SAMPLE_RATE * 440.0 * std::f32::consts::TAU;
        pcm.push(phase.sin() * 0.5);
    }
    let sample_id = instance
        .add_sample(pcm, frame_count, 1, SAMPLE_RATE)
        .expect("the loading bank is uniquely owned and within the ABI limits");

    instance.add_zone(
        0,
        sample_id,
        SUSTAIN,
        69,
        0,
        127,
        0,
        127,
        0,
        1,
        0,
        false,
        1,
        0,
        frame_count,
        0,
        0.0,
        0.001,
        0.1,
        1.0,
        0.2,
    );
    assert!(
        instance.build_zone_map(28, 1),
        "the 28-name articulation table is within MAX_ARTICULATIONS",
    );
    assert!(
        instance.commit_sample_bank(),
        "a built bank holding one sample must commit",
    );
    instance
}

#[test]
fn a_note_whose_articulation_the_bank_lacks_still_sounds() {
    let mut instance = sustain_only_instance();

    instance.note_on_with_channel_and_articulation(69, 100, 0, STACCATO);

    assert!(
        instance.active_voices() > 0,
        "the note allocated no voice; an articulation the bank has no zones for is being dropped",
    );
    assert!(
        render_peak(&mut instance) > 1e-3,
        "the note rendered silence; a project asking for an articulation the loaded bank does not \
         ship must still play the note",
    );
}

#[test]
fn the_substitute_is_the_articulation_the_channel_is_already_on() {
    // Falling back has to reach the same zones the note would have used with no
    // per-note articulation at all, not some other arbitrary sound. Rendering
    // both against the same one-zone bank is what proves it: a substitute that
    // resolved elsewhere would not match.
    let mut requested_missing = sustain_only_instance();
    let mut no_articulation = sustain_only_instance();

    requested_missing.note_on_with_channel_and_articulation(69, 100, 0, STACCATO);
    no_articulation.note_on_with_channel_and_articulation(69, 100, 0, SUSTAIN);

    let missing_peak = render_peak(&mut requested_missing);
    let sustain_peak = render_peak(&mut no_articulation);

    assert!(
        sustain_peak > 1e-3,
        "the sustain reference rendered nothing (peak {sustain_peak}); the bank fixture is broken",
    );
    assert!(
        (missing_peak - sustain_peak).abs() < sustain_peak * 0.05,
        "the substituted note rendered at peak {missing_peak} against the sustain reference's \
         {sustain_peak}; the fallback is not reaching the same zone",
    );
}

/// A bank shipping both articulations, sustain quiet and staccato loud, so
/// which zone a note reached is readable from the rendered level alone.
fn two_articulation_instance() -> LevainInstance {
    const FRAME_COUNT: u32 = 4_800;
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");

    let quiet_id = instance
        .add_sample(
            vec![0.05; FRAME_COUNT as usize],
            FRAME_COUNT,
            1,
            SAMPLE_RATE,
        )
        .expect("sample adds to a uniquely-owned bank");
    let loud_id = instance
        .add_sample(vec![0.9; FRAME_COUNT as usize], FRAME_COUNT, 1, SAMPLE_RATE)
        .expect("sample adds to a uniquely-owned bank");

    instance.add_zone(
        0,
        quiet_id,
        SUSTAIN,
        69,
        0,
        127,
        0,
        127,
        0,
        1,
        0,
        false,
        1,
        0,
        FRAME_COUNT,
        0,
        0.0,
        0.001,
        0.1,
        1.0,
        0.2,
    );
    instance.add_zone(
        1,
        loud_id,
        STACCATO,
        69,
        0,
        127,
        0,
        127,
        0,
        1,
        0,
        false,
        1,
        0,
        FRAME_COUNT,
        0,
        0.0,
        0.001,
        0.1,
        1.0,
        0.2,
    );
    assert!(instance.build_zone_map(28, 1));
    assert!(instance.commit_sample_bank());
    instance
}

#[test]
fn an_articulation_the_bank_does_ship_is_not_redirected() {
    // The substitution must only fire on an empty lookup. A bank that really
    // does ship the requested articulation has to keep playing it.
    let mut staccato_instance = two_articulation_instance();
    let mut sustain_instance = two_articulation_instance();

    staccato_instance.note_on_with_channel_and_articulation(69, 100, 0, STACCATO);
    sustain_instance.note_on_with_channel_and_articulation(69, 100, 0, SUSTAIN);

    let staccato_peak = render_peak(&mut staccato_instance);
    let sustain_peak = render_peak(&mut sustain_instance);

    assert!(
        staccato_peak > sustain_peak * 2.0,
        "staccato rendered at peak {staccato_peak} against sustain's {sustain_peak}; a requested \
         articulation the bank ships was redirected to another zone",
    );
}
