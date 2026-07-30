//! What the browser-side Crumbs binding actually renders.
//!
//! `CrumbsInstance` is the only thing standing between an `OfflineAudioContext`
//! and the sampler, so the thing worth proving is that a block of audio comes
//! out carrying the sample that went in — not that the struct constructs. A
//! guard that only asked "did I get an instance back" would stay green through
//! a `process` that returned a zeroed buffer, which is exactly the failure this
//! device shipped with (no render path at all, silently substituted).
//!
//! Every assertion here is against the *sample data the caller supplied*, so
//! neutering the read, the rate calculation, the gain chain or the pool lookup
//! turns one of them red rather than merely lowering a level.

use daw_dsp::crumbs::CrumbsInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// A deliberately irregular waveform. A sine would let a wrong-but-periodic
/// read (an off-by-one frame, a stuck position) still correlate; this does not
/// repeat within the window, so index errors show up as a proportionality
/// failure rather than a phase shift nobody notices.
fn fixture_pcm(frames: usize) -> Vec<f32> {
    (0..frames)
        .map(|i| {
            let t = i as f32;
            0.6 * (t * 0.11).sin() + 0.3 * (t * 0.037).cos() + 0.1 * (t * 0.29).sin()
        })
        .collect()
}

unsafe fn read_channel(ptr: *const f32, frames: usize) -> Vec<f32> {
    std::slice::from_raw_parts(ptr, frames).to_vec()
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()))
}

/// Configure an instance with one mono sample loaded and selected, an envelope
/// held flat at unity, and the filter bypassed — so the only thing between the
/// pool and the output is the sample read itself.
fn instance_with_fixture(pcm: &[f32]) -> CrumbsInstance {
    let mut instance = CrumbsInstance::new(SAMPLE_RATE);
    let sample_id = instance.add_sample(pcm.to_vec(), 1, SAMPLE_RATE as u32);
    instance.set_active_sample(sample_id);
    // Flat envelope: attack 0 with hold 0 puts the AHDSR straight into decay at
    // level 1.0, and the shipped default sustain of 1.0 holds it there.
    instance.set_param("attack", 0.0);
    instance
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
             (source {src} × {scale}) — the rendered block is not this sample"
        );
    }
}

#[test]
fn a_note_at_the_root_renders_the_loaded_sample_frame_for_frame() {
    let pcm = fixture_pcm(4 * BLOCK);
    let mut instance = instance_with_fixture(&pcm);

    // Root note is 60 by default, so note 60 plays at unity rate and the
    // 8-point sinc collapses to the sample at the integer frame exactly.
    instance.note_on(60, 100);

    let left = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };
    let right = unsafe { read_channel(instance.get_right_ptr(), BLOCK) };

    assert_proportional_to(&left, &pcm[..BLOCK], "left channel at unity rate");
    // Mono source, centre pan: both channels carry the same signal.
    assert_proportional_to(&right, &pcm[..BLOCK], "right channel at unity rate");
    assert_eq!(
        instance.get_nan_flush_count(),
        0.0,
        "a clean sample produced non-finite output"
    );
}

#[test]
fn playback_continues_across_block_boundaries_instead_of_restarting() {
    let pcm = fixture_pcm(4 * BLOCK);
    let mut instance = instance_with_fixture(&pcm);
    instance.note_on(60, 100);

    let _first = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };
    let second = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };

    // The second block must be the *next* 128 frames. A wrapper that rebuilt
    // its voice per call, or forgot to advance, would hand back block one again.
    assert_proportional_to(&second, &pcm[BLOCK..2 * BLOCK], "second rendered block");
}

#[test]
fn an_octave_above_the_root_reads_the_sample_at_double_rate() {
    let pcm = fixture_pcm(4 * BLOCK);
    let mut instance = instance_with_fixture(&pcm);

    instance.note_on(72, 100);

    let left = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };

    // Rate 2.0 lands on even frames exactly, so the expected block is every
    // other source frame. This is what pins the pitch mapping: a wrapper that
    // ignored the note and always played at unity would fail here and pass the
    // unity-rate test above.
    let every_other: Vec<f32> = (0..BLOCK).map(|i| pcm[i * 2]).collect();
    assert_proportional_to(&left, &every_other, "left channel one octave up");
}

#[test]
fn a_note_with_no_sample_selected_renders_silence_rather_than_noise() {
    let mut instance = CrumbsInstance::new(SAMPLE_RATE);

    instance.note_on(60, 127);
    let left = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };

    assert_eq!(peak(&left), 0.0, "an empty pool produced output");
}

#[test]
fn the_output_block_is_replaced_each_call_rather_than_accumulated() {
    let pcm = fixture_pcm(4 * BLOCK);
    let mut instance = instance_with_fixture(&pcm);
    instance.note_on(60, 100);
    let first_peak = peak(&unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) });

    instance.all_sound_off();
    // Let the 3 ms steal fade finish before measuring.
    for _ in 0..4 {
        instance.process(BLOCK as u32);
    }
    let after_silence = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };

    assert!(first_peak > 0.05, "the note never sounded, so this proves nothing");
    // `CrumbsEngine::process_block` adds into its slices. If the binding did not
    // zero its buffer, the last audible block would linger here forever.
    assert_eq!(peak(&after_silence), 0.0, "stale audio persisted after all voices stopped");
}

#[test]
fn master_gain_scales_the_rendered_block() {
    // Long enough that the voice is still sounding after the smoother settles.
    let pcm = fixture_pcm(32 * BLOCK);

    let mut loud = instance_with_fixture(&pcm);
    loud.note_on(60, 100);
    let mut quiet = instance_with_fixture(&pcm);
    quiet.set_param("masterGain", 0.25);
    quiet.note_on(60, 100);

    // The master gain is smoothed over ~10 ms, so measure after it has settled.
    let settle_blocks = (0.05 * SAMPLE_RATE / BLOCK as f32).ceil() as usize;
    for _ in 0..settle_blocks {
        loud.process(BLOCK as u32);
        quiet.process(BLOCK as u32);
    }
    let loud_block = unsafe { read_channel(loud.process(BLOCK as u32), BLOCK) };
    let quiet_block = unsafe { read_channel(quiet.process(BLOCK as u32), BLOCK) };

    let ratio = peak(&quiet_block) / peak(&loud_block);
    assert!(
        (ratio - 0.25).abs() < 0.02,
        "masterGain 0.25 produced {ratio}× the unity-gain peak, not 0.25×"
    );
}

#[test]
fn an_unknown_parameter_name_is_ignored_rather_than_silencing_the_engine() {
    let pcm = fixture_pcm(4 * BLOCK);
    let mut instance = instance_with_fixture(&pcm);

    instance.set_param("noSuchParameter", 0.0);
    instance.set_mode("noSuchMode");
    instance.note_on(60, 100);

    let left = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };

    assert_proportional_to(&left, &pcm[..BLOCK], "left channel after an unknown param");
}

#[test]
fn a_stereo_sample_keeps_its_channels_apart() {
    // Interleaved L/R where the right channel is the left inverted, so a
    // wrapper that fanned mono out to both channels cannot pass.
    let mono = fixture_pcm(4 * BLOCK);
    let mut interleaved = Vec::with_capacity(mono.len() * 2);
    for value in &mono {
        interleaved.push(*value);
        interleaved.push(-*value);
    }

    let mut instance = CrumbsInstance::new(SAMPLE_RATE);
    let sample_id = instance.add_sample(interleaved, 2, SAMPLE_RATE as u32);
    instance.set_active_sample(sample_id);
    instance.set_param("attack", 0.0);
    instance.note_on(60, 100);

    let left = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };
    let right = unsafe { read_channel(instance.get_right_ptr(), BLOCK) };

    assert_proportional_to(&left, &mono[..BLOCK], "left channel of a stereo sample");
    let inverted: Vec<f32> = mono[..BLOCK].iter().map(|value| -value).collect();
    assert_proportional_to(&right, &inverted, "right channel of a stereo sample");
}
