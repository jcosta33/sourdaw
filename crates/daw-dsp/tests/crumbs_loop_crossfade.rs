//! A Forward loop must not click at its seam (audit F14).
//!
//! `loop_crossfade` reached the voice from the mode configuration and from the
//! `loopCrossfade` parameter, was stored on every `CrumbsVoice`, and was read
//! by nothing: playback jumped straight from `loop_end` back to `loop_start`
//! whatever the setting said. Any loop whose two ends are not already
//! waveform-continuous therefore clicked on every repeat, and the control that
//! exists to fix that did nothing.
//!
//! # How the click is measured
//!
//! The pooled sample is a linear ramp from 0 to nearly full scale. Its interior
//! is as smooth as a signal gets — one 4800th of full scale per sample — so
//! every large sample-to-sample step in the render is the loop wrap and nothing
//! else. The note plays at the sample's root, so playback speed is exactly 1.0
//! and one output sample is one source frame: no resampling ringing enters the
//! measurement.
//!
//! The whole chain is otherwise linear and flat — the per-voice filter is
//! bypassed at its 20 kHz default, the envelope is at sustain by the time the
//! first wrap arrives, and the master gain smoother has settled at unity.

use std::sync::Arc;

use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::sample::SampleData;
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsParam};

const SAMPLE_RATE: f32 = 48_000.0;
/// 100 ms, so a 1 s render wraps ten times.
const SAMPLE_FRAMES: usize = 4_800;
const RAMP_PEAK: f32 = 0.9;
const CROSSFADE_FRAMES: u32 = 256;
/// The sample's root note, played back at unity speed.
const ROOT_NOTE: u8 = 60;
const RENDER_SAMPLES: usize = 48_000;
/// Samples skipped before measuring: past the 1 ms attack and the master gain
/// smoother's settling, both of which move the output on their own.
const WARMUP_SAMPLES: usize = 2_400;

/// A ramp from 0 to `RAMP_PEAK`. Looping it back to frame 0 steps the output by
/// the full ramp height — a DC discontinuity at the seam, which is exactly what
/// a seam crossfade exists to remove.
fn ramp_sample() -> Arc<SampleData> {
    let pcm: Vec<f32> = (0..SAMPLE_FRAMES)
        .map(|frame| frame as f32 / SAMPLE_FRAMES as f32 * RAMP_PEAK)
        .collect();
    Arc::new(SampleData::from_mono(pcm, SAMPLE_RATE as u32))
}

fn set_param(engine: &mut CrumbsEngine, param: CrumbsParam, value: f32) {
    engine.handle_command(CrumbsCommand::SetParam { param, value });
}

/// One voice looping the ramp forward with the given seam crossfade length.
fn looping_engine(crossfade_frames: u32) -> CrumbsEngine {
    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    let sample_id = engine.add_sample(ramp_sample());
    engine.set_active_sample(sample_id);
    set_param(&mut engine, CrumbsParam::LoopMode, 1.0);
    set_param(&mut engine, CrumbsParam::LoopStart, 0.0);
    set_param(&mut engine, CrumbsParam::LoopEnd, SAMPLE_FRAMES as f32);
    set_param(
        &mut engine,
        CrumbsParam::LoopCrossfade,
        crossfade_frames as f32,
    );
    engine.handle_command(CrumbsCommand::NoteOn {
        note: ROOT_NOTE,
        velocity: 127,
    });
    engine
}

fn render(engine: &mut CrumbsEngine, count: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(count);
    let mut left = [0.0_f32; 128];
    let mut right = [0.0_f32; 128];
    while out.len() < count {
        left.fill(0.0);
        right.fill(0.0);
        engine.process_block(&mut left, &mut right);
        out.extend_from_slice(&left);
    }
    out.truncate(count);
    out
}

/// Largest sample-to-sample step in the measured region.
fn max_step(samples: &[f32]) -> f32 {
    samples
        .windows(2)
        .skip(WARMUP_SAMPLES)
        .fold(0.0_f32, |worst, pair| worst.max((pair[1] - pair[0]).abs()))
}

#[test]
fn a_forward_loop_seam_steps_the_output_without_a_crossfade() {
    // The reference measurement, and the reason the control exists. If this
    // ever stops stepping, the test below proves nothing.
    let mut engine = looping_engine(0);
    let step = max_step(&render(&mut engine, RENDER_SAMPLES));

    assert!(
        step > RAMP_PEAK * 0.5,
        "a crossfade-free forward loop stepped by only {step:.4} against a ramp {RAMP_PEAK} tall; \
         the render is no longer wrapping inside the measured region"
    );
}

#[test]
fn a_forward_loop_seam_is_crossfaded_when_the_loop_carries_one() {
    let mut faded = looping_engine(CROSSFADE_FRAMES);
    let mut raw = looping_engine(0);

    let faded_step = max_step(&render(&mut faded, RENDER_SAMPLES));
    let raw_step = max_step(&render(&mut raw, RENDER_SAMPLES));

    assert!(
        faded_step < raw_step * 0.25,
        "the loop seam stepped by {faded_step:.4} with a {CROSSFADE_FRAMES}-frame crossfade \
         against {raw_step:.4} with none; `loop_crossfade` is not reaching the render path"
    );
    // The fade covers 1/18th of the loop, so what is left of the ramp's own
    // travel across it bounds the residual step. Stated as an absolute number
    // rather than a ratio so a regression that made *both* variants click
    // cannot satisfy the comparison above.
    assert!(
        faded_step < RAMP_PEAK * CROSSFADE_FRAMES as f32 / SAMPLE_FRAMES as f32 * 1.5,
        "the crossfaded seam still stepped by {faded_step:.4}, which is more than the ramp \
         travels across the crossfade region"
    );
}

/// The crossfade shapes the seam; it must not mute the loop or leave it
/// rendering something other than the sample.
#[test]
fn a_crossfaded_loop_still_renders_the_sample() {
    let mut faded = looping_engine(CROSSFADE_FRAMES);
    let rendered = render(&mut faded, RENDER_SAMPLES);

    let peak = rendered.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));
    assert!(
        peak > RAMP_PEAK * 0.5,
        "a crossfaded loop rendered a peak of {peak:.4} against a ramp {RAMP_PEAK} tall; the \
         crossfade is attenuating the loop rather than joining it"
    );
}
