//! Articulation switches must be configurable and must steer note-ons.
//!
//! `ArticulationMap`'s keyswitch/velocity-split/CC-split machinery existed and
//! the note-on/CC routing consulted it, but nothing could ever populate the
//! map — no engine API, no wasm binding — so every bank loaded with an empty
//! map and the routing was dead on arrival. `add_articulation_switch` is the
//! binding; these guards prove a configured keyswitch and CC split change
//! which articulation layer a note actually plays. Keyswitches are baseline
//! orchestral-sampler behaviour.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 32;
const FRAME_COUNT: u32 = 4_800;
const SUSTAIN: u16 = 0;
const STACCATO: u16 = 8;
/// Keyswitch note below the playable range, as an orchestral bank authors it.
const KEYSWITCH_NOTE: u8 = 36;

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

/// Sustain quiet, staccato loud — which layer a note reached is readable from
/// the rendered level alone (the shape `levain_missing_articulation_falls_back`
/// already established).
fn two_articulation_instance() -> LevainInstance {
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

    for (zone_id, sample_id, articulation) in [(0, quiet_id, SUSTAIN), (1, loud_id, STACCATO)] {
        instance.add_zone(
            zone_id,
            sample_id,
            articulation,
            69,
            0.0,
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
    }
    assert!(instance.build_zone_map(28, 1));
    assert!(instance.commit_sample_bank());
    instance
}

#[test]
fn a_keyswitch_note_is_consumed_and_selects_its_articulation_layer() {
    let mut plain = two_articulation_instance();
    let mut switched = two_articulation_instance();
    switched.add_articulation_switch(0, KEYSWITCH_NOTE, 0, STACCATO, false);

    // The keyswitch note itself makes no sound — it is consumed by the
    // articulation state machine instead of allocating a voice.
    switched.note_on(KEYSWITCH_NOTE, 100);
    assert_eq!(
        switched.active_voices(),
        0,
        "the keyswitch note allocated a voice; it must be consumed as a switch"
    );

    plain.note_on(69, 100);
    switched.note_on(69, 100);

    let plain_peak = render_peak(&mut plain);
    let switched_peak = render_peak(&mut switched);

    assert!(
        plain_peak > 0.01,
        "the sustain reference rendered ~nothing (peak {plain_peak}); the fixture is broken"
    );
    assert!(
        switched_peak > plain_peak * 2.0,
        "after the keyswitch the note rendered at peak {switched_peak} against the sustain \
         reference's {plain_peak}; the configured keyswitch did not steer the note onto the \
         staccato layer"
    );
}

#[test]
fn a_cc_split_selects_its_articulation_layer() {
    let mut plain = two_articulation_instance();
    let mut switched = two_articulation_instance();
    // Values 64..=127 of the switch CC (default 32) select staccato.
    switched.add_articulation_switch(2, 64, 127, STACCATO, false);

    switched.handle_cc(32, 100);

    plain.note_on(69, 100);
    switched.note_on(69, 100);

    let plain_peak = render_peak(&mut plain);
    let switched_peak = render_peak(&mut switched);

    assert!(
        switched_peak > plain_peak * 2.0,
        "after the CC split the note rendered at peak {switched_peak} against the sustain \
         reference's {plain_peak}; the configured CC split did not steer the note"
    );
}

#[test]
fn a_velocity_split_selects_its_articulation_layer() {
    let mut plain = two_articulation_instance();
    let mut split = two_articulation_instance();
    // Hard-played notes (110..=127) switch to staccato; everything below
    // stays on the channel's articulation.
    split.add_articulation_switch(1, 110, 127, STACCATO, false);

    plain.note_on(69, 120);
    split.note_on(69, 120);

    let plain_peak = render_peak(&mut plain);
    let split_peak = render_peak(&mut split);

    assert!(
        split_peak > plain_peak * 2.0,
        "a hard-played note rendered at peak {split_peak} against the unsplit reference's \
         {plain_peak}; the configured velocity split did not steer the note"
    );
}
