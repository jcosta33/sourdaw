//! A sample's decoded rate must survive to playback (issue #3715).
//!
//! `LevainInstance::add_sample` carries each sample's decoded rate through the
//! same upload the live bank loader and the offline node use, but the voice
//! computed its speed from the note-to-root interval alone. One source frame
//! per output frame is only right at 44.1 kHz: the audit rendered a synthetic
//! half-second at a 48 kHz engine and watched it advance 24,000 source frames
//! instead of 22,050 — sharp and fast by 48000/44100.
//!
//! Measured at the instance boundary, not on a struct field, because a rate
//! that reaches the pool and not the playhead is the failure this exists to
//! catch. Both observables come from the same render: how many output frames
//! the voice spends (duration) and the rising crossings per output second
//! (pitch).

use daw_dsp::levain::LevainInstance;

const SOURCE_RATE: f32 = 44_100.0;
const SOURCE_HZ: f32 = 440.0;
const ROOT_NOTE: u8 = 69;
const SOURCE_FRAMES: u32 = 22_050; // 0.5 s at 44.1 kHz
const BLOCK: usize = 128;

/// A committed one-zone bank holding half a second of 440 Hz decoded at
/// 44.1 kHz — the upload contract the live loader and the offline node share.
fn instance_at(output_rate: f32) -> LevainInstance {
    let mut instance = LevainInstance::new(output_rate, 8);
    instance.begin_sample_bank("rate-probe");

    let pcm: Vec<f32> = (0..SOURCE_FRAMES)
        .map(|frame| (frame as f32 / SOURCE_RATE * SOURCE_HZ * std::f32::consts::TAU).sin() * 0.5)
        .collect();
    let sample_id = instance
        .add_sample(pcm, SOURCE_FRAMES, 1, SOURCE_RATE)
        .expect("the loading bank is uniquely owned and within the ABI limits");

    instance.add_zone(
        0,
        sample_id,
        0,
        ROOT_NOTE,
        0.0,
        0,
        127,
        0,
        127,
        0,
        1,
        0,
        false,
        0,
        0,
        SOURCE_FRAMES,
        0,
        0.0,
        0.001,
        0.1,
        1.0,
        0.005,
    );
    assert!(
        instance.build_zone_map(1, 1),
        "a single-zone map must build"
    );
    assert!(
        instance.commit_sample_bank(),
        "a built bank holding one sample must commit"
    );
    instance.note_on(ROOT_NOTE, 100);
    instance
}

/// Render whole blocks until the instance falls silent; returns the frames
/// actually rendered, trailing silence trimmed by dropping the final block.
fn render_until_done(instance: &mut LevainInstance, cap_blocks: usize) -> Vec<f32> {
    let mut out = Vec::new();
    for _ in 0..cap_blocks {
        if instance.active_voices() == 0 {
            break;
        }
        let ptr = instance.process(BLOCK as u32);
        // SAFETY: `process` guarantees BLOCK valid f32s in the left buffer.
        let block = unsafe { std::slice::from_raw_parts(ptr, BLOCK) };
        out.extend_from_slice(block);
    }
    assert!(
        instance.active_voices() == 0,
        "the voice never ended within {cap_blocks} blocks"
    );
    out
}

/// Rising crossings per output second, floored so the realism layer's
/// low-level noise between the tone's own crossings cannot be counted.
fn rendered_hz(samples: &[f32], output_rate: f32) -> f32 {
    let peak = samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
    assert!(peak > 1e-3, "the instance rendered silence (peak {peak})");
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
    crossings as f32 * output_rate / samples.len() as f32
}

#[test]
fn a_half_second_source_sounds_for_half_a_second_at_every_output_rate() {
    for (output_rate, expected_frames) in [
        (44_100.0_f32, 22_050_usize),
        (48_000.0, 24_000),
        (96_000.0, 48_000),
    ] {
        let mut instance = instance_at(output_rate);
        let rendered = render_until_done(&mut instance, (expected_frames / BLOCK) * 3);

        // The release tail (5 ms) keeps the voice alive past the source's end,
        // so the render runs a little long; the source must not run short of
        // its authored half second, and must not overshoot it by more than the
        // tail plus a block. Pre-fix, 48 kHz finished 1,950 frames early and
        // 96 kHz half early.
        let tail_and_block = (0.005 * output_rate) as usize + BLOCK;
        let duration = rendered.len();
        assert!(
            duration + tail_and_block >= expected_frames
                && duration <= expected_frames + tail_and_block,
            "at {output_rate} Hz the half-second source rendered {duration} frames, \
             expected ~{expected_frames} plus the release tail"
        );

        let hz = rendered_hz(&rendered, output_rate);
        assert!(
            (hz - SOURCE_HZ).abs() < SOURCE_HZ * 0.05,
            "at {output_rate} Hz the root-key render measured {hz:.1} Hz against the sample's own {SOURCE_HZ} Hz"
        );
    }
}

#[test]
fn a_transposed_note_keeps_its_interval_across_output_rates() {
    // +3 semitones from note 72 against root 69. The interval, not the rate
    // pair, is what may shorten the note and sharpen the pitch.
    for output_rate in [44_100.0_f32, 48_000.0, 96_000.0] {
        let mut instance = instance_at(output_rate);
        instance.note_off(ROOT_NOTE);
        instance.all_notes_off();
        instance.note_on(72, 100);

        let rendered = render_until_done(&mut instance, 4_000);
        let hz = rendered_hz(&rendered, output_rate);
        let target = SOURCE_HZ * 2.0_f32.powf(3.0 / 12.0);
        assert!(
            (hz - target).abs() < target * 0.05,
            "at {output_rate} Hz a +3-semitone note measured {hz:.1} Hz, expected ~{target:.1}"
        );
    }
}
