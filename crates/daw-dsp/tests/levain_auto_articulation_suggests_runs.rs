//! Auto-articulation must feed on note-ons and steer the layer selection.
//!
//! The `auto_articulation` enable parameter existed and the detector
//! (`AutoArticulation::record_note_on`/`suggest`) existed, but nothing fed or
//! read it: the parameter toggled a struct no code path consulted. Wired, a
//! fast passage with no explicitly chosen articulation suggests `Runs`, and
//! the note plays the bank's Runs layer; an explicit choice (a keyswitch)
//! still outranks the suggestion.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 32;
const FRAME_COUNT: u32 = 4_800;
const SUSTAIN: u16 = 0;
/// `ArticulationType::Runs` as the fixed 28-name-table id.
const RUNS: u16 = 27;

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

/// Sustain quiet, Runs loud — the level alone tells which layer won.
fn sustain_and_runs_instance() -> LevainInstance {
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

    for (zone_id, sample_id, articulation) in [(0, quiet_id, SUSTAIN), (1, loud_id, RUNS)] {
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

/// Play `count` separated notes as fast as the engine's block clock allows —
/// two blocks (~5.3 ms) apart, far past the runs threshold of 8 notes/s. Notes
/// alternate pitch so each is a fresh attack, and each is released before the
/// next so no overlap suggests legato instead.
fn play_a_fast_run(instance: &mut LevainInstance, count: usize) {
    for i in 0..count {
        let note = 69 + (i % 2) as u8;
        instance.note_on(note, 100);
        let _ = instance.process(BLOCK as u32);
        instance.note_off(note);
        let _ = instance.process(BLOCK as u32);
    }
}

#[test]
fn a_fast_run_with_auto_articulation_enabled_reaches_the_runs_layer() {
    let mut manual = sustain_and_runs_instance();
    let mut auto_enabled = sustain_and_runs_instance();
    auto_enabled.set_param("auto_articulation", 1.0);

    // Sustain reference: same passage, detector off — the channel sits on its
    // default articulation and every note plays the quiet layer.
    play_a_fast_run(&mut manual, 6);
    let manual_peak = render_peak(&mut manual);

    play_a_fast_run(&mut auto_enabled, 6);
    let auto_peak = render_peak(&mut auto_enabled);

    assert!(
        manual_peak > 0.01,
        "the sustain reference rendered ~nothing (peak {manual_peak}); the fixture is broken"
    );
    assert!(
        auto_peak > manual_peak * 2.0,
        "a fast run with auto-articulation enabled rendered at peak {auto_peak} against the \
         detector-off reference's {manual_peak}; the runs suggestion is not steering the layer \
         selection"
    );
}

#[test]
fn an_explicit_articulation_outranks_the_suggestion() {
    let mut explicit = sustain_and_runs_instance();
    explicit.set_param("auto_articulation", 1.0);
    // The player explicitly set the channel's articulation: the detector
    // must defer even in the middle of a fast passage.
    explicit.set_param("current_articulation", SUSTAIN as f32);

    play_a_fast_run(&mut explicit, 6);
    let peak = render_peak(&mut explicit);

    assert!(
        peak < 0.15,
        "an explicitly chosen articulation rendered at peak {peak}; the runs suggestion is \
         overriding the player's explicit choice"
    );
}
