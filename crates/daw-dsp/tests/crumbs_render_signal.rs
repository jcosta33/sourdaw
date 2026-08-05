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
        "{what}: rendered output does not track this source (scale {scale}) — \
         it is ~silent, polarity-inverted, or reading somewhere else entirely"
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

/// The `tune` parameter shipped write-only. `set_param` stored it in
/// `CrumbsEngine::tune_cents` and nothing ever read that field back: pitch is
/// computed in `CrumbsVoice::trigger` from the *voice's* own `tune_cents`, and
/// the only writer of that was the voice-stacking detune under `if count > 1`.
/// At the stack count of 1 the device ships with, the knob moved nothing.
///
/// All three cases drive the knob *between* values rather than parking it at
/// its default — an assertion taken at `tune = 0` agrees with a dead parameter.
#[test]
fn tune_of_plus_twelve_semitones_reads_the_sample_at_double_rate() {
    let pcm = fixture_pcm(4 * BLOCK);
    let mut instance = instance_with_fixture(&pcm);

    // Deliberately left at the default stack count of 1 — the state the device
    // ships in, and the one where the stacking `set_tune` never runs. A guard
    // taken at `stackCount > 1` would pass against the write-only engine.
    instance.set_param("tune", 12.0);
    instance.note_on(60, 100);

    let left = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };

    // +12 st is the transposition note 72 asks for above, so the expected block
    // is the same one: every other source frame. Comparing against
    // `pcm[..BLOCK]` would only prove "something changed"; this pins the
    // transposition to the amount the knob asked for, which is what makes the
    // unit load-bearing — read as *cents*, 12 would be a rate of 1.007 and
    // return essentially the untransposed block.
    let every_other: Vec<f32> = (0..BLOCK).map(|i| pcm[i * 2]).collect();
    assert_proportional_to(&left, &every_other, "left channel with tune +12 st");
}

#[test]
fn tune_of_minus_twelve_semitones_reads_the_sample_at_half_rate() {
    let pcm = fixture_pcm(4 * BLOCK);
    let mut instance = instance_with_fixture(&pcm);

    instance.set_param("tune", -12.0);
    instance.note_on(60, 100);

    let left = unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) };

    // Rate 0.5 puts every second output frame on an exact source frame and the
    // ones between on a half-frame the interpolator reconstructs. Only the
    // exact ones are compared, so this pins the direction and amount of the
    // transposition without asserting anything about the sinc kernel.
    let even_output: Vec<f32> = (0..BLOCK / 2).map(|i| left[i * 2]).collect();
    assert_proportional_to(
        &even_output,
        &pcm[..BLOCK / 2],
        "even output frames with tune -12 st",
    );
}

#[test]
fn tune_is_bounded_at_the_twenty_four_semitones_the_knob_travels() {
    let pcm = fixture_pcm(4 * BLOCK);

    let mut at_limit = instance_with_fixture(&pcm);
    at_limit.set_param("tune", 24.0);
    at_limit.note_on(60, 100);
    let bounded = unsafe { read_channel(at_limit.process(BLOCK as u32), BLOCK) };

    let mut beyond_limit = instance_with_fixture(&pcm);
    beyond_limit.set_param("tune", 100.0);
    beyond_limit.note_on(60, 100);
    let clamped = unsafe { read_channel(beyond_limit.process(BLOCK as u32), BLOCK) };

    // +24 st is rate 4, which reads every fourth source frame; the fixture is
    // 4 × BLOCK long, so the whole block stays in range.
    let every_fourth: Vec<f32> = (0..BLOCK).map(|i| pcm[i * 4]).collect();
    assert_proportional_to(&bounded, &every_fourth, "left channel with tune +24 st");
    // The wire value is semitones, so the bound is ±24 — not the ±2400 a cents
    // reading would want. An over-range write (a stale project, an automation
    // curve authored against a wider declared range) is pinned to the top of
    // the knob's travel instead of transposing 100 semitones into aliasing.
    assert_eq!(
        bounded, clamped,
        "tune 100 was not clamped to the +24 st limit"
    );
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

    assert!(
        first_peak > 0.05,
        "the note never sounded, so this proves nothing"
    );
    // `CrumbsEngine::process_block` adds into its slices. If the binding did not
    // zero its buffer, the last audible block would linger here forever.
    assert_eq!(
        peak(&after_silence),
        0.0,
        "stale audio persisted after all voices stopped"
    );
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

// ── Filter resonance ───────────────────────────────────────────────────

/// The frequency the resonance guards park both the tone and the cutoff on. A
/// lowpass SVF's magnitude response *at* its own cutoff is its Q, so the peak of
/// a steady tone sitting there reads back the Q the engine actually resolved —
/// the only observable that separates one `Reso` knob position from another.
const RESONANT_TONE_HZ: f32 = 1_000.0;

/// Long enough for the ~10 ms master-gain smoother to settle and for the
/// resonator to reach steady state at the top of the knob (ring-down ≈ Q/(π·fc),
/// ~6 ms at Q 20 and 1 kHz).
const SETTLE_BLOCKS: usize = 32;

/// The knob's own bounds, as `CrumbsControls` publishes them (`min={0.5}`,
/// `max={20}`, `defaultValue={1}`) and as `ToasterKit` documents for the
/// identically-shaped parameter: "0.5-20", i.e. Q — not a normalised 0–1.
const RESO_KNOB_MIN: f32 = 0.5;
const RESO_KNOB_DEFAULT: f32 = 1.0;
const RESO_KNOB_MAX: f32 = 20.0;
/// The middle of that travel. Load-bearing: it is the one knob position whose
/// rendered Q a shrunk span cannot reproduce — see the assertion that uses it.
const RESO_KNOB_MIDPOINT: f32 = 10.25;

fn steady_tone(frames: usize, tone_hz: f32) -> Vec<f32> {
    (0..frames)
        .map(|i| 0.5 * (i as f32 / SAMPLE_RATE * tone_hz * std::f32::consts::TAU).sin())
        .collect()
}

/// Peak of a steady 1 kHz tone rendered with the cutoff parked on the tone and
/// the `Reso` knob at `knob_position`, expressed in the knob's own units.
fn peak_at_resonance_knob(knob_position: f32) -> f32 {
    let pcm = steady_tone((SETTLE_BLOCKS + 2) * BLOCK, RESONANT_TONE_HZ);
    let mut instance = instance_with_fixture(&pcm);
    // Both filter params have to land before `note_on`: `Voice::trigger` is what
    // copies them into the per-voice SVF, so a value set afterwards never
    // reaches the sounding voice and every reading here would be the default.
    instance.set_param("filterCutoff", RESONANT_TONE_HZ);
    instance.set_param("filterResonance", knob_position);
    instance.note_on(60, 100);

    for _ in 0..SETTLE_BLOCKS {
        instance.process(BLOCK as u32);
    }
    peak(&unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) })
}

/// The same tone with the filter genuinely out of circuit — the shipped 20 kHz
/// cutoff and an untouched resonance leave `Voice::filter_enabled` false — so
/// the readings above have an absolute reference and not merely each other.
fn peak_with_filter_out_of_circuit() -> f32 {
    let pcm = steady_tone((SETTLE_BLOCKS + 2) * BLOCK, RESONANT_TONE_HZ);
    let mut instance = instance_with_fixture(&pcm);
    instance.note_on(60, 100);

    for _ in 0..SETTLE_BLOCKS {
        instance.process(BLOCK as u32);
    }
    peak(&unsafe { read_channel(instance.process(BLOCK as u32), BLOCK) })
}

#[test]
fn the_resonance_knob_separates_its_default_from_its_maximum() {
    let at_default = peak_at_resonance_knob(RESO_KNOB_DEFAULT);
    let at_maximum = peak_at_resonance_knob(RESO_KNOB_MAX);

    // The knob travels 0.5 → 20 and ships at 1, so 19 of its 19.5 units sit at
    // or above the default. An engine that read those units as a normalised 0–1
    // clamps every one of them onto the same coefficients and these two renders
    // come back bit-identical.
    let ratio = at_maximum / at_default;
    assert!(
        ratio > 3.0,
        "Reso {RESO_KNOB_DEFAULT} rendered peak {at_default} and Reso \
         {RESO_KNOB_MAX} rendered peak {at_maximum} ({ratio}× apart) — the top of \
         the knob's travel is not reaching the filter"
    );
}

#[test]
fn the_knobs_ends_land_on_the_q_range_the_filter_documents() {
    // Where the ends actually land, not merely that they differ. A knob whose
    // ends resolved a narrower Q span than the SVF's documented 0.5–20 would
    // clear every relative check above while quietly shortening the control's
    // reach.
    let out_of_circuit = peak_with_filter_out_of_circuit();
    assert!(
        out_of_circuit > 0.05,
        "the reference render is ~silent ({out_of_circuit}), so this proves nothing"
    );

    // A lowpass' magnitude at its own cutoff is its Q, so these lifts read back
    // the Q each end resolved: Q 0.5 halves the tone (measured 0.50×), Q 20
    // lifts it about tenfold (measured 9.99× — short of 20 because Q > 10
    // engages the SVF's 2× oversampling path, which halves its input).
    let floor_lift = peak_at_resonance_knob(RESO_KNOB_MIN) / out_of_circuit;
    assert!(
        (0.4..0.65).contains(&floor_lift),
        "Reso {RESO_KNOB_MIN} lifted the tone {floor_lift}× over its unfiltered \
         peak — the bottom of the knob is not the filter's documented Q \
         {RESO_KNOB_MIN}"
    );

    let top_lift = peak_at_resonance_knob(RESO_KNOB_MAX) / out_of_circuit;
    assert!(
        top_lift > 8.0,
        "Reso {RESO_KNOB_MAX} lifted the tone {top_lift}× over its unfiltered \
         peak — the top of the knob is not the filter's documented Q \
         {RESO_KNOB_MAX}"
    );

    // The top of the knob cannot carry the span on its own. Q > 10 engages the
    // SVF's 2× oversampling, which halves the input, so Q 20 renders a 9.99×
    // lift and a Q span shrunk to 0.5–10 renders 9.999× — the two are 0.1%
    // apart and no honest band separates them. The knob's *midpoint* does
    // separate them: Q 10.25 is interior to the true span and renders 5.12×
    // (its own Q, halved by the same oversampling), while a shrunk span
    // saturates it to the ceiling and renders 9.999×.
    let midpoint_lift = peak_at_resonance_knob(RESO_KNOB_MIDPOINT) / out_of_circuit;
    assert!(
        (4.6..5.6).contains(&midpoint_lift),
        "Reso {RESO_KNOB_MIDPOINT} — the middle of the knob's travel — lifted \
         the tone {midpoint_lift}× over its unfiltered peak, not the ~5.12× \
         that Q {RESO_KNOB_MIDPOINT} resolves; the knob's travel is not \
         landing on the Q span the filter documents"
    );
}

#[test]
fn the_shipped_resonance_default_leaves_the_response_flat_at_the_cutoff() {
    let out_of_circuit = peak_with_filter_out_of_circuit();
    let at_default = peak_at_resonance_knob(RESO_KNOB_DEFAULT);

    assert!(
        out_of_circuit > 0.05,
        "the reference render is ~silent ({out_of_circuit}), so this proves nothing"
    );
    // Q 1 is a ~1 dB shelf at the cutoff, not a resonant peak. A build that read
    // the shipped default of 1 as full normalised resonance puts Q 20 here and
    // lands an order of magnitude high; one that mis-scaled the mapping lands
    // somewhere in between.
    let ratio = at_default / out_of_circuit;
    assert!(
        (0.8..1.25).contains(&ratio),
        "Reso {RESO_KNOB_DEFAULT} rendered {ratio}× the unfiltered peak \
         ({at_default} vs {out_of_circuit}) — the shipped default is not the \
         gentle filter the knob position claims"
    );
}

#[test]
fn resonance_outside_the_knobs_travel_pins_to_its_ends() {
    // `CrumbsDescriptor` advertises a wider automation range than the knob draws
    // (minValue 0.1), and an automation curve can be dragged past either end, so
    // both ends have to saturate rather than run the mapping off into a Q the SVF
    // was never designed for.
    let below_floor = peak_at_resonance_knob(0.1);
    let at_floor = peak_at_resonance_knob(RESO_KNOB_MIN);
    assert_eq!(
        below_floor, at_floor,
        "Reso 0.1 rendered differently from the knob floor {RESO_KNOB_MIN}"
    );

    let above_ceiling = peak_at_resonance_knob(40.0);
    let at_ceiling = peak_at_resonance_knob(RESO_KNOB_MAX);
    assert_eq!(
        above_ceiling, at_ceiling,
        "Reso 40 rendered differently from the knob ceiling {RESO_KNOB_MAX}"
    );
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
