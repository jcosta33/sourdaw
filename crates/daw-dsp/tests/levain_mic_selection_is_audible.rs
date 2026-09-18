//! Multi-mic banks must honour the mic field through the zone lookup.
//!
//! Zones carry a `mic` id end-to-end and the zone map indexes by it, but the
//! note-on lookup was hardcoded to mic 0 — a two-mic bank could only ever
//! sound its first layer, and the panel's per-mic enable flags fed a mixer no
//! layer ever reached. With the lookup routed through the first enabled mic
//! position, disabling mic 0 must switch the note onto mic 1's zones.
//! Kontakt-style per-mic selection, as documented at
//! `LevainEngine::refresh_mic_layer`.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 32;
const FRAME_COUNT: u32 = 4_800;
const SUSTAIN: u16 = 0;

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

/// A two-mic bank: the same sustain zone authored once per mic layer, with
/// mic 0 carrying a quiet recording and mic 1 a loud one, so which layer a
/// note reaches is readable from the rendered level alone.
fn two_mic_instance() -> LevainInstance {
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

    // The loud mic-1 layer is `is_release`-flagged for the fixture's own
    // sake, not for release semantics: the CC1 dynamic-layer attach hunts for
    // a neighbouring zone through the same mic-indexed lookup, and without
    // this flag a frozen lookup would still reach the loud zone as a
    // secondary layer and mask the selection difference this file pins.
    // Release triggers only fire on note-off, which these tests never send,
    // so the flag changes nothing about what renders here.
    for (zone_id, sample_id, mic_id, is_release) in
        [(0, quiet_id, 0u8, false), (1, loud_id, 1u8, true)]
    {
        instance.add_zone(
            zone_id,
            sample_id,
            SUSTAIN,
            69,
            0.0,
            0,
            127,
            0,
            127,
            0,
            1,
            mic_id,
            is_release,
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
    assert!(
        instance.build_zone_map(28, 2),
        "a two-mic bank is within the zone map's dimension limits",
    );
    assert!(
        instance.commit_sample_bank(),
        "a built bank holding two samples must commit",
    );
    instance
}

#[test]
fn the_default_selection_plays_the_first_mic_layer() {
    let mut instance = two_mic_instance();

    instance.note_on(69, 100);

    let peak = render_peak(&mut instance);
    assert!(
        (0.01..0.15).contains(&peak),
        "with every position enabled the note rendered at peak {peak}; it should be the quiet \
         mic-0 layer (~0.05), not the loud one (~0.9)",
    );
}

#[test]
fn disabling_mic_0_switches_the_note_onto_mic_1s_zones() {
    let mut instance = two_mic_instance();
    instance.set_param("mic_0_enabled", 0.0);

    instance.note_on(69, 100);

    let peak = render_peak(&mut instance);
    assert!(
        peak > 0.25,
        "after disabling mic 0 the note rendered at peak {peak}; the lookup is still frozen on \
         the mic-0 layer instead of following the enabled selection",
    );
}

#[test]
fn disabling_every_layer_silences_the_note() {
    // The selection is "first enabled"; with none enabled there is no layer
    // to sound, which must be silence rather than a silent fallback to mic 0.
    // The lookup still finds zones (the voice exists), so the assertion has to
    // be on the rendered signal, not the voice count.
    let mut instance = two_mic_instance();
    instance.set_param("mic_0_enabled", 0.0);
    instance.set_param("mic_1_enabled", 0.0);

    instance.note_on(69, 100);

    assert!(
        render_peak(&mut instance) < 1e-4,
        "a note with no enabled mic layer rendered signal"
    );
}
