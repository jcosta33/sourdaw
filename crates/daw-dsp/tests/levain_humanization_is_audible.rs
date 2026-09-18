//! The humanizer's per-note offsets must reach the voices.
//!
//! `NoteHumanization` generates seven randomized fields of which the engine
//! consumed three (dynamic scale, vibrato phase, vibrato rate). The timing
//! offset, the tuning offset, and the start offset were generated and
//! discarded on every note. These guards hold the two with the strongest
//! observable signatures: a large timing budget must delay note onsets, and a
//! large tuning budget must de-tune notes off the recorded pitch. The vibrato
//! depth scale rides the same `apply_note_humanization` path as the tuning
//! offset (both land in `update_vibrato_block`), so the tuning guard failing
//! on its own mutation is the pattern; a depth-only revert is covered by that
//! shared path rather than a separate frequency-excursion measurement.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// Two blocks ≈ 5.3 ms — the window in which an unhumanized note is already
/// sounding at full attack.
const ONSET_WINDOW_BLOCKS: usize = 2;

fn instance_with_sine() -> LevainInstance {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");

    // One second of 440 Hz at a solid level: pitch is measurable from
    // zero-crossing counts, and a full second outlasts every onset window.
    let frame_count = SAMPLE_RATE as u32;
    let pcm: Vec<f32> = (0..frame_count)
        .map(|frame| {
            let phase = frame as f32 / SAMPLE_RATE * 440.0 * std::f32::consts::TAU;
            phase.sin() * 0.5
        })
        .collect();
    let sample_id = instance
        .add_sample(pcm, frame_count, 1, SAMPLE_RATE)
        .expect("sample adds to a uniquely-owned bank");

    instance.add_zone(
        0,
        sample_id,
        0,
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
        frame_count,
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

fn render_energy(instance: &mut LevainInstance, blocks: usize) -> f64 {
    let mut energy = 0.0_f64;
    for _ in 0..blocks {
        let left_ptr = instance.process(BLOCK as u32);
        let right_ptr = instance.get_right_ptr();
        // SAFETY: `process` guarantees BLOCK valid f32s in each channel buffer.
        let left = unsafe { std::slice::from_raw_parts(left_ptr, BLOCK) };
        let right = unsafe { std::slice::from_raw_parts(right_ptr, BLOCK) };
        for sample in left.iter().chain(right.iter()) {
            energy += (sample.abs() as f64) * (sample.abs() as f64);
        }
    }
    energy
}

#[test]
fn a_large_timing_budget_delays_note_onsets() {
    // The timing offset is bipolar-random around 0, so roughly half the notes
    // draw a negative offset (clamped to "on time") and half a positive one.
    // With a 500 ms budget against a 5.3 ms onset window, the in-window share
    // of an unhumanized render is every note and of a humanized render ~half
    // — thirty-two notes put that separation well outside binomial noise. If
    // the offset were still discarded, the two energies match.
    let mut machine = instance_with_sine();
    machine.set_param("humanize", 0.0);

    let mut humanized = instance_with_sine();
    humanized.set_param("humanize", 1.0);
    humanized.set_param("humanize_timing_max_ms", 500.0);

    let mut machine_onset_energy = 0.0_f64;
    let mut humanized_onset_energy = 0.0_f64;
    for note in 60..92u8 {
        machine.note_on(note, 100);
        machine_onset_energy += render_energy(&mut machine, ONSET_WINDOW_BLOCKS);
        machine.note_off(note);
        let _ = render_energy(&mut machine, 200);

        humanized.note_on(note, 100);
        humanized_onset_energy += render_energy(&mut humanized, ONSET_WINDOW_BLOCKS);
        humanized.note_off(note);
        // Drain the note's tail so the next onset window measures only the
        // next note. Two hundred blocks ≈ 0.5 s outlasts the release zone.
        let _ = render_energy(&mut humanized, 200);
        let _ = render_energy(&mut machine, 200);
    }

    assert!(
        machine_onset_energy > 1.0,
        "the machine-precise reference produced no onset energy ({machine_onset_energy}); \
         the fixture is broken"
    );
    assert!(
        humanized_onset_energy < machine_onset_energy * 0.75,
        "with a 500 ms timing budget the onsets carried {humanized_onset_energy} against the \
         machine reference's {machine_onset_energy}; the timing offset is not delaying the \
         attacks"
    );
}

#[test]
fn a_large_tuning_budget_de_tunes_notes_off_the_recorded_pitch() {
    // With a ±100-cent budget each note lands within ±5.9 Hz of the recorded
    // 440 Hz. A zero-crossing count over a 16,384-sample window resolves
    // ~1.5 Hz, so a discarded offset pins every note inside ±1.5 Hz of 440
    // while a wired one spreads most of them past ±2.5 Hz. The assertion is
    // on the widest deviation across ten notes, which binomial noise cannot
    // bridge in either direction.
    let mut instance = instance_with_sine();
    instance.set_param("humanize", 1.0);
    instance.set_param("humanize_tuning_max_cents", 100.0);
    // Kill the timing offset so the measurement window is fully on-signal,
    // and hold vibrato off (the expression default is no vibrato; a pitch
    // LFO would smear the crossing count).
    instance.set_param("humanize_timing_max_ms", 0.0);

    const WINDOW_BLOCKS: usize = 128;
    let window_seconds = (WINDOW_BLOCKS * BLOCK) as f32 / SAMPLE_RATE;
    let mut max_deviation_hz = 0.0_f32;

    // Every note is the root, so the recorded 440 Hz is the only pitch the
    // engine itself would ever render — any deviation beyond quantization is
    // the humanized tuning offset reaching the playback rate.
    for _ in 0..10 {
        instance.note_on(69, 100);
        // Discard the first block: it carries the attack and the humanizer's
        // start offset (up to 64 frames), which would shift a crossing in or
        // out of the window and masquerade as pitch.
        let _ = instance.process(BLOCK as u32);
        let mut left_samples = Vec::with_capacity(WINDOW_BLOCKS * BLOCK);
        for _ in 0..WINDOW_BLOCKS {
            let left_ptr = instance.process(BLOCK as u32);
            // SAFETY: `process` guarantees BLOCK valid f32s in the buffer.
            let left = unsafe { std::slice::from_raw_parts(left_ptr, BLOCK) };
            left_samples.extend_from_slice(left);
        }
        instance.note_off(69);
        // Drain the release tail fully (~0.2 s zone release, several time
        // constants) so the next measurement window is one note's pitch and
        // not a blend of two.
        let _ = render_energy(&mut instance, 450);

        let crossings = left_samples
            .windows(2)
            .filter(|pair| (pair[0] < 0.0 && pair[1] >= 0.0) || (pair[0] >= 0.0 && pair[1] < 0.0))
            .count();
        let frequency = crossings as f32 / window_seconds / 2.0;
        assert!(
            (380.0..500.0).contains(&frequency),
            "measured {frequency} Hz for a note the fixture pins at 440 Hz; the measurement is \
             off-signal"
        );
        max_deviation_hz = max_deviation_hz.max((frequency - 440.0).abs());
    }

    assert!(
        max_deviation_hz > 2.5,
        "ten notes with a ±100-cent tuning budget all measured within {max_deviation_hz:.2} Hz \
         of the recorded pitch; the tuning offset is not reaching the voices"
    );
}
