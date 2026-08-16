//! A Forward loop must not click at its seam (audit F14).
//!
//! `loop_crossfade` reached the voice from the mode configuration and from the
//! `loopCrossfade` parameter, was stored on every `CrumbsVoice`, and was read
//! by nothing: playback jumped straight from `loop_end` back to `loop_start`
//! whatever the setting said. Any loop whose two ends are not already
//! waveform-continuous therefore clicked on every repeat, and the control that
//! exists to fix that did nothing.
//!
//! # What the fade must do
//!
//! Inside the fade window the tail blends against the material one loop length
//! behind the playhead — the pre-roll leading into `loop_start` — so the blend
//! converges on the exact sample the next iteration starts with. Three
//! behaviours pin that contract:
//!
//! - a mismatched seam is joined (the residual step shrinks to the source
//!   material's own slope across the window, not to some smaller click);
//! - a loop that is already continuous stays continuous — the fade must not
//!   *introduce* an artifact, which both a wrong shadow offset (blending
//!   against `loop_start + offset`) and an equal-power curve on correlated
//!   material (a +3 dB mid-window bulge) do;
//! - a loop with no pre-roll has nothing valid to blend against and renders
//!   exactly as if the crossfade were zero.
//!
//! # How the measurements stay clean
//!
//! The note plays at the sample's root, so playback speed is exactly 1.0 and
//! one output sample is one source frame. The per-voice filter is bypassed at
//! its 20 kHz default, the envelope is at sustain by the time the first wrap
//! arrives, and the master gain smoother has settled at unity.

use std::sync::Arc;

use daw_dsp::crumbs::engine::CrumbsEngine;
use daw_dsp::crumbs::sample::SampleData;
use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsParam};

const SAMPLE_RATE: f32 = 48_000.0;
const SAMPLE_FRAMES: usize = 6_000;
const RAMP_PEAK: f32 = 0.9;
const CROSSFADE_FRAMES: u32 = 256;
/// The loop starts here, leaving `LOOP_START` frames of pre-roll — more than
/// the fade span, so the window never shrinks below `CROSSFADE_FRAMES`.
const LOOP_START: u32 = 1_200;
const LOOP_END: u32 = 5_040;
const LOOP_LENGTH: u32 = LOOP_END - LOOP_START;
/// The sample's root note, played back at unity speed.
const ROOT_NOTE: u8 = 60;
const RENDER_SAMPLES: usize = 48_000;
/// Samples skipped before measuring: past the 1 ms attack and the master gain
/// smoother's settling, both of which move the output on their own.
const WARMUP_SAMPLES: usize = 2_400;

/// A ramp from 0 to `RAMP_PEAK`. Its interior is as smooth as a signal gets —
/// one 6000th of full scale per sample — so every large sample-to-sample step
/// in the render is the loop wrap and nothing else. Looping `[1200, 5040)`
/// steps the output by the ramp's travel across the loop on every wrap.
fn ramp_sample() -> Arc<SampleData> {
    let pcm: Vec<f32> = (0..SAMPLE_FRAMES)
        .map(|frame| frame as f32 / SAMPLE_FRAMES as f32 * RAMP_PEAK)
        .collect();
    Arc::new(SampleData::from_mono(pcm, SAMPLE_RATE as u32))
}

/// One period per `SINE_PERIOD_FRAMES` frames, phase-continuous across the
/// whole sample. `LOOP_LENGTH` is an exact multiple of the period (3840 = 32 ×
/// 120), so the loop wrap is already seamless and the material one loop length
/// behind the playhead is identical to the tail — the correct fade is an exact
/// identity here. The distance from the fade window to `loop_start`
/// (`LOOP_LENGTH - CROSSFADE_FRAMES` = 3584) is deliberately *not* a period
/// multiple, so a shadow read anchored at `loop_start + offset` blends
/// out-of-phase material and audibly breaks this loop.
const SINE_PERIOD_FRAMES: usize = 120;
const SINE_PEAK: f32 = 0.8;

fn sine_sample() -> Arc<SampleData> {
    let pcm: Vec<f32> = (0..SAMPLE_FRAMES)
        .map(|frame| {
            let phase = frame as f32 / SINE_PERIOD_FRAMES as f32;
            (phase * std::f32::consts::TAU).sin() * SINE_PEAK
        })
        .collect();
    Arc::new(SampleData::from_mono(pcm, SAMPLE_RATE as u32))
}

fn set_param(engine: &mut CrumbsEngine, param: CrumbsParam, value: f32) {
    engine.handle_command(CrumbsCommand::SetParam { param, value });
}

/// One voice looping the given sample forward over `[loop_start, LOOP_END)`
/// with the given seam crossfade length.
fn looping_engine(sample: Arc<SampleData>, loop_start: u32, crossfade_frames: u32) -> CrumbsEngine {
    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    let sample_id = engine.add_sample(sample);
    engine.set_active_sample(sample_id);
    set_param(&mut engine, CrumbsParam::LoopMode, 1.0);
    set_param(&mut engine, CrumbsParam::LoopStart, loop_start as f32);
    set_param(&mut engine, CrumbsParam::LoopEnd, LOOP_END as f32);
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

fn peak(samples: &[f32]) -> f32 {
    samples
        .iter()
        .skip(WARMUP_SAMPLES)
        .fold(0.0_f32, |acc, s| acc.max(s.abs()))
}

#[test]
fn a_forward_loop_seam_steps_the_output_without_a_crossfade() {
    // The reference measurement, and the reason the control exists. If this
    // ever stops stepping, the joining test below proves nothing.
    let mut engine = looping_engine(ramp_sample(), LOOP_START, 0);
    let step = max_step(&render(&mut engine, RENDER_SAMPLES));

    // The wrap steps by the ramp's travel across the loop (0.576), less what
    // the interpolator's taps shave off as they straddle the seam; half the
    // travel is comfortably below the measured step and far above the faded
    // residual.
    let loop_travel = RAMP_PEAK * LOOP_LENGTH as f32 / SAMPLE_FRAMES as f32;
    assert!(
        step > loop_travel * 0.5,
        "a crossfade-free forward loop stepped by only {step:.4}; the render is no longer \
         wrapping inside the measured region"
    );
}

#[test]
fn a_forward_loop_seam_is_crossfaded_when_the_loop_carries_one() {
    let mut faded = looping_engine(ramp_sample(), LOOP_START, CROSSFADE_FRAMES);
    let mut raw = looping_engine(ramp_sample(), LOOP_START, 0);

    let faded_step = max_step(&render(&mut faded, RENDER_SAMPLES));
    let raw_step = max_step(&render(&mut raw, RENDER_SAMPLES));

    assert!(
        faded_step < raw_step * 0.25,
        "the loop seam stepped by {faded_step:.4} with a {CROSSFADE_FRAMES}-frame crossfade \
         against {raw_step:.4} with none; `loop_crossfade` is not reaching the render path"
    );
    // A correct fade spreads the seam's discontinuity across the window, so
    // the residual per-sample step is the wrap step divided by the span, plus
    // the ramp's own slope. Anything materially above that bound means the
    // fade is not converging on `loop_start` — a shadow read anchored at
    // `loop_start + offset` leaves a step of span × slope (16× this bound)
    // where the fade hands over to the wrapped playhead.
    let slope = RAMP_PEAK / SAMPLE_FRAMES as f32;
    let residual_bound = (LOOP_LENGTH as f32 / CROSSFADE_FRAMES as f32 + 1.0) * slope * 1.5;
    assert!(
        faded_step < residual_bound,
        "the crossfaded seam still stepped by {faded_step:.4} against a correct-fade residual \
         bound of {residual_bound:.4}; the shadow read is not converging on the loop start"
    );
}

/// A loop that is already waveform-continuous must stay continuous — and stay
/// at its own level — with the fade engaged. The shadow one loop length back
/// is identical material here, so a correct linear fade is an exact identity;
/// a wrong shadow offset blends out-of-phase material into the window, and an
/// equal-power curve on this correlated material bulges the level +3 dB
/// mid-window on every pass.
#[test]
fn a_clean_loop_is_not_degraded_by_the_crossfade() {
    let mut faded = looping_engine(sine_sample(), LOOP_START, CROSSFADE_FRAMES);
    let mut raw = looping_engine(sine_sample(), LOOP_START, 0);

    let faded_render = render(&mut faded, RENDER_SAMPLES);
    let raw_render = render(&mut raw, RENDER_SAMPLES);

    let faded_step = max_step(&faded_render);
    let raw_step = max_step(&raw_render);
    assert!(
        faded_step <= raw_step * 1.1,
        "a cycle-aligned loop stepped by {faded_step:.4} with the crossfade engaged against \
         {raw_step:.4} without it; the fade is blending mismatched material into a clean seam"
    );

    let faded_peak = peak(&faded_render);
    let raw_peak = peak(&raw_render);
    assert!(
        faded_peak <= raw_peak * 1.05,
        "a cycle-aligned loop peaked at {faded_peak:.4} with the crossfade engaged against \
         {raw_peak:.4} without it; the fade curve is bulging correlated material"
    );
}

/// A loop with no pre-roll has no material before `loop_start` to blend
/// against; the fade disables itself rather than folding unrelated audio into
/// the seam. The render must match a zero-crossfade render exactly.
#[test]
fn a_loop_without_preroll_plays_unfaded() {
    let mut faded = looping_engine(ramp_sample(), 0, CROSSFADE_FRAMES);
    let mut raw = looping_engine(ramp_sample(), 0, 0);

    let faded_render = render(&mut faded, RENDER_SAMPLES);
    let raw_render = render(&mut raw, RENDER_SAMPLES);

    assert_eq!(
        faded_render, raw_render,
        "a no-preroll loop rendered differently with a crossfade configured; the fade is \
         engaging without valid material to blend against"
    );
}

/// The crossfade shapes the seam; it must not mute the loop or leave it
/// rendering something other than the sample.
#[test]
fn a_crossfaded_loop_still_renders_the_sample() {
    let mut faded = looping_engine(ramp_sample(), LOOP_START, CROSSFADE_FRAMES);
    let rendered = render(&mut faded, RENDER_SAMPLES);

    let rendered_peak = peak(&rendered);
    assert!(
        rendered_peak > RAMP_PEAK * 0.5,
        "a crossfaded loop rendered a peak of {rendered_peak:.4} against a ramp {RAMP_PEAK} \
         tall; the crossfade is attenuating the loop rather than joining it"
    );
}
