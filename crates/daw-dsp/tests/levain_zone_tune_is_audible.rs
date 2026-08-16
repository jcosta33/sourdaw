//! A zone's authored tuning must survive the wasm boundary (audit F15).
//!
//! `SampleRef::tune_cents` is read by `LevainVoice::start`, which folds it into
//! the playback ratio alongside the note-to-root interval. `LevainInstance::
//! add_zone` — the only route a browser-side bank has into the zone map — took
//! no tuning argument and wrote a hardcoded zero, so a bank that tuned a zone
//! played it at the untuned pitch in the browser while the native path honoured
//! it. Nothing downstream could recover the difference: by the time the zone is
//! in the map, the authored value is gone.
//!
//! The rendered pitch is measured rather than the field, because a parameter
//! that reaches a struct and not the oscillator is the failure this exists to
//! catch.

use daw_dsp::levain::LevainInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const BLOCKS: usize = 96;
/// The zone's sample is a sine at this frequency, mapped so the played note is
/// its root: at zero tuning the playback ratio is exactly 1.0 and the render
/// comes back at this pitch.
const SAMPLE_HZ: f32 = 220.0;
const ROOT_NOTE: u8 = 69;
/// One octave, the least ambiguous tuning offset a zero-crossing count can
/// confirm.
const OCTAVE_CENTS: f32 = 1_200.0;

/// A committed one-zone bank whose only zone carries `tune_cents`.
fn tuned_instance(tune_cents: f32) -> LevainInstance {
    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");

    let frame_count = SAMPLE_RATE as u32;
    let pcm: Vec<f32> = (0..frame_count)
        .map(|frame| (frame as f32 / SAMPLE_RATE * SAMPLE_HZ * std::f32::consts::TAU).sin() * 0.5)
        .collect();
    let sample_id = instance
        .add_sample(pcm, frame_count, 1, SAMPLE_RATE)
        .expect("the loading bank is uniquely owned and within the ABI limits");

    instance.add_zone(
        0,
        sample_id,
        0,
        ROOT_NOTE,
        tune_cents,
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
        instance.build_zone_map(1, 1),
        "a single-zone map must build"
    );
    assert!(
        instance.commit_sample_bank(),
        "a built bank holding one sample must commit"
    );
    // Played at the zone's own root, so the note-to-root interval is zero and
    // the only thing left to move the pitch is the zone's tuning.
    instance.note_on(ROOT_NOTE, 100);
    instance
}

/// Render and return the left channel.
fn render(instance: &mut LevainInstance) -> Vec<f32> {
    let mut out = Vec::with_capacity(BLOCKS * BLOCK);
    for _ in 0..BLOCKS {
        let left_ptr = instance.process(BLOCK as u32);
        // SAFETY: `process` guarantees BLOCK valid f32s in the left buffer.
        let left = unsafe { std::slice::from_raw_parts(left_ptr, BLOCK) };
        out.extend_from_slice(left);
    }
    out
}

/// Rising zero crossings per second — the rendered pitch, for a signal
/// dominated by one partial.
///
/// Crossings are counted against a floor so the realism layer's low-level noise
/// between the tone's own crossings cannot be counted as extra periods.
fn rendered_hz(samples: &[f32]) -> f32 {
    let peak = samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
    assert!(
        peak > 1e-3,
        "the instance rendered silence (peak {peak}); there is no pitch to measure"
    );
    let floor = peak * 0.25;

    let mut crossings = 0_usize;
    let mut armed = false;
    for sample in samples {
        if *sample < -floor {
            armed = true;
        } else if *sample > floor && armed {
            crossings += 1;
            armed = false;
        }
    }
    crossings as f32 * SAMPLE_RATE / samples.len() as f32
}

#[test]
fn an_untuned_zone_renders_at_its_sample_pitch() {
    // The reference. Without it, "the tuned render differs" could be satisfied
    // by the untuned one being wrong in the other direction.
    let mut instance = tuned_instance(0.0);
    let hz = rendered_hz(&render(&mut instance));

    assert!(
        (hz - SAMPLE_HZ).abs() < SAMPLE_HZ * 0.05,
        "an untuned zone played at its root rendered {hz:.1} Hz against the sample's own \
         {SAMPLE_HZ} Hz"
    );
}

#[test]
fn a_zone_tuned_up_an_octave_renders_an_octave_higher() {
    let mut instance = tuned_instance(OCTAVE_CENTS);
    let hz = rendered_hz(&render(&mut instance));

    assert!(
        (hz - SAMPLE_HZ * 2.0).abs() < SAMPLE_HZ * 0.1,
        "a zone tuned +{OCTAVE_CENTS} cents rendered {hz:.1} Hz, not the {:.1} Hz an octave \
         above its sample; `add_zone` is dropping the authored tuning at the wasm boundary",
        SAMPLE_HZ * 2.0
    );
}

#[test]
fn a_zone_tuned_down_an_octave_renders_an_octave_lower() {
    let mut instance = tuned_instance(-OCTAVE_CENTS);
    let hz = rendered_hz(&render(&mut instance));

    assert!(
        (hz - SAMPLE_HZ * 0.5).abs() < SAMPLE_HZ * 0.05,
        "a zone tuned -{OCTAVE_CENTS} cents rendered {hz:.1} Hz, not the {:.1} Hz an octave \
         below its sample",
        SAMPLE_HZ * 0.5
    );
}
