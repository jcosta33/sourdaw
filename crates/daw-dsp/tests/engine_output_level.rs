//! Engine-boundary output level and separation guards.
//!
//! Every other DSP guard in this crate measures *the stage under test*:
//! `grinder/triode.rs` tests drive `Preamp`, `grinder/cabinet.rs` tests drive
//! the cabinet, and the same pattern holds across `toaster/*` and `proof/*`.
//! The RT guards in `tests/device_process_rt.rs` do reach the engine, but they
//! assert allocation-freedom, finiteness and non-silence — `peak > 1e-4` — and
//! never level or balance.
//!
//! So this crate contained no statement anywhere of the form "this device, at
//! these settings, outputs approximately this much", and a change upstream of
//! an engine's output could move delivered level by several dB and clear every
//! check the project runs. That is not hypothetical: relocating one one-pole
//! shelf inside `grinder/triode.rs` moved a model's output by +6.2 dB peak and
//! +5.3 dB RMS, pinning an output safety limiter that had never engaged at
//! those settings, and passed the whole gate set green.
//!
//! How this file differs from the guards that missed it:
//!
//! * It measures **at the engine output** — the `*Instance` render export, so
//!   after the cabinet and after the safety limiter. Measuring before either
//!   reproduces exactly the blind spot this file exists to close. The
//!   observation point is part of the claim.
//! * Bands are **two-sided**. A lower bound catches a stage dropping out of the
//!   path; an upper bound catches a gain-staging change or a limiter going from
//!   idle to engaged. A one-sided "is not silent" assertion catches neither —
//!   see `toaster_level` below for a live example of what that misses.
//! * It pins **separation** as well as level, so a change that moves one model
//!   onto another is distinguishable from one that moves them together.
//!
//! Deliberately NOT golden-file or bit-exact comparison: that fails on every
//! legitimate voicing change and trains people to re-bless it. These bands are
//! wide enough that a deliberate voicing tweak survives and narrow enough that
//! a topology or gain-staging accident does not.
//!
//! **When one of these fails.** The expected values are measurements, not
//! targets — there is nothing sacred about them. If you changed voicing on
//! purpose, re-measure and move the number in the same commit, and say so in
//! the message. What you must not do is widen a band to make a number fit: the
//! band width is the claim, and a band wide enough to admit any value asserts
//! nothing.

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// Blocks rendered before measurement starts, so DC blockers, parameter
/// smoothers and the cabinet convolution have settled.
const WARMUP_BLOCKS: usize = 40;
/// Blocks measured: 64 x 128 = 8192 frames, long enough for RMS to be a
/// steady-state figure rather than a window artefact.
const MEASURED_BLOCKS: usize = 64;

/// Two-sided tolerance for a level band.
///
/// Calibrated against measured changes, not picked for comfort. The regression
/// that motivated this file was +6.2 dB at the output. A smaller probe — moving
/// one amp model's input trim by +2.8 dB — lands as **-1.2 dB RMS** at the
/// engine output, because the saturating stages and the model compressor absorb
/// most of it and invert the rest. An earlier draft of this file used
/// +/-1.5 dB and let that probe through, which would have made these guards
/// look strict while missing a real upstream edit; 1.0 dB catches it.
///
/// The floor on tightness is reproducibility, not taste: the stimulus is fixed
/// by frame index and the DSP is f32 with no FMA contraction, so repeat runs
/// agree to far below this. It is not a precision claim — it is the width at
/// which a real upstream change is loud and ordinary re-voicing is quiet.
const LEVEL_TOLERANCE_DB: f32 = 1.0;

/// Grinder's output safety limiter threshold, `db_to_linear(-0.3)` at
/// `grinder/engine.rs`. It is a safety net, not a mix stage: at shipped
/// settings the signal should pass under it untouched.
const GRINDER_LIMITER_THRESHOLD: f32 = 0.966_051;

/// Deterministic guitar-like excitation: a low fundamental with two harmonics
/// and a repeating pick transient, fixed by frame index so every run of every
/// engine sees byte-identical input.
fn excitation(frame: usize) -> (f32, f32) {
    let t = frame as f32 / SAMPLE_RATE;
    let fundamental = (t * 110.0 * std::f32::consts::TAU).sin();
    let second = (t * 220.0 * std::f32::consts::TAU).sin() * 0.5;
    let third = (t * 440.0 * std::f32::consts::TAU).sin() * 0.25;
    // Pick transient every 4800 frames, exponentially decaying, so gates,
    // compressors, sag and envelope followers all see something to act on.
    let phase = (frame % 4_800) as f32 / SAMPLE_RATE;
    let pick = (-phase * 60.0).exp() * 0.6;
    let body = (fundamental + second + third) * 0.28;
    (body * (1.0 + pick), body * (1.0 + pick * 0.8))
}

#[derive(Debug, Clone, Copy)]
struct Level {
    peak: f32,
    rms: f32,
}

fn measure(samples: &[f32]) -> Level {
    assert!(!samples.is_empty(), "measured an empty buffer");
    let mut peak = 0.0_f32;
    let mut sum_squares = 0.0_f64;
    for (i, s) in samples.iter().enumerate() {
        assert!(
            s.is_finite(),
            "engine produced a non-finite sample at index {i}: {s}"
        );
        peak = peak.max(s.abs());
        sum_squares += (*s as f64) * (*s as f64);
    }
    Level {
        peak,
        rms: (sum_squares / samples.len() as f64).sqrt() as f32,
    }
}

/// # Safety
/// `left` and `right` must each point to at least `frames` writable `f32`s.
unsafe fn fill_input(left: *mut f32, right: *mut f32, frames: usize, offset: usize) {
    for i in 0..frames {
        let (l, r) = excitation(offset + i);
        *left.add(i) = l;
        *right.add(i) = r;
    }
}

/// # Safety
/// `ptr` must point to at least `frames` readable `f32`s.
unsafe fn read_output(ptr: *const f32, frames: usize) -> Vec<f32> {
    assert!(!ptr.is_null(), "render export returned a null buffer");
    (0..frames).map(|i| *ptr.add(i)).collect()
}

fn ratio_to_db(numerator: f32, denominator: f32) -> f32 {
    20.0 * (numerator / denominator).log10()
}

/// Assert a measured level sits inside a two-sided dB band around an expected
/// value. The message reports the deviation in dB and the raw figures, so a
/// failure is diagnosable from CI output without a local repro.
fn assert_within_db(what: &str, measured: f32, expected: f32, tolerance_db: f32) {
    assert!(
        measured > 0.0,
        "{what}: measured {measured}, expected {expected}. A zero reading means \
         the signal never reached the engine output at all."
    );
    let deviation_db = ratio_to_db(measured, expected);
    assert!(
        deviation_db.abs() <= tolerance_db,
        "{what}: measured {measured:.5}, expected {expected:.5} \
         ({deviation_db:+.2} dB against a +/-{tolerance_db:.2} dB band). \
         Output level at the engine boundary moved. If that was deliberate, \
         re-measure and move the expected value in this commit; if it was not, \
         something upstream changed the gain staging."
    );
}

// ---------------------------------------------------------------------------
// Grinder
// ---------------------------------------------------------------------------

const CLEAN_TWIN: f32 = 0.0;
const CRUNCH_JCM: f32 = 1.0;
const LEAD_JCM: f32 = 2.0;
const AC30_TOP_BOOST: f32 = 3.0;
const RECTIFIER: f32 = 4.0;
const CUSTOM: f32 = 5.0;

/// The operating point every Grinder figure below is measured at: lead channel,
/// gain 8.2, master 8.0, tone controls centred, `fat` off.
const GRINDER_GAIN: f32 = 8.2;

/// Render Grinder and return the level at the **engine output** — after
/// ToneStack, PowerAmp, Transformer, Cabinet and the output safety limiter.
fn grinder_level(amp_model: f32) -> Level {
    use daw_dsp::grinder::GrinderInstance;

    let mut instance = GrinderInstance::new(SAMPLE_RATE);
    instance.set_param("ampModel", amp_model);
    instance.set_param("channel", 2.0);
    instance.set_param("gain", GRINDER_GAIN);
    instance.set_param("master", 8.0);
    instance.set_param("bass", 5.0);
    instance.set_param("mid", 5.0);
    instance.set_param("treble", 5.0);
    instance.set_param("fat", 0.0);

    for block in 0..WARMUP_BLOCKS {
        unsafe {
            fill_input(
                instance.get_input_left_ptr(),
                instance.get_input_right_ptr(),
                BLOCK,
                block * BLOCK,
            );
        }
        instance.process(BLOCK as u32);
    }

    let mut rendered = Vec::with_capacity(MEASURED_BLOCKS * BLOCK);
    for block in WARMUP_BLOCKS..(WARMUP_BLOCKS + MEASURED_BLOCKS) {
        unsafe {
            fill_input(
                instance.get_input_left_ptr(),
                instance.get_input_right_ptr(),
                BLOCK,
                block * BLOCK,
            );
        }
        let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
        rendered.extend_from_slice(&out);
    }

    measure(&rendered)
}

fn grinder_sine_level(amp_model: f32, fat: bool, frequency_hz: f32, amplitude: f32) -> Level {
    use daw_dsp::grinder::GrinderInstance;

    let mut instance = GrinderInstance::new(SAMPLE_RATE);
    instance.set_param("ampModel", amp_model);
    instance.set_param("channel", 2.0);
    instance.set_param("gain", GRINDER_GAIN);
    instance.set_param("master", 8.0);
    instance.set_param("bass", 5.0);
    instance.set_param("mid", 5.0);
    instance.set_param("treble", 5.0);
    instance.set_param("fat", if fat { 1.0 } else { 0.0 });

    let mut rendered = Vec::with_capacity(MEASURED_BLOCKS * BLOCK);
    for block in 0..(WARMUP_BLOCKS + MEASURED_BLOCKS) {
        for frame in 0..BLOCK {
            let sample_index = block * BLOCK + frame;
            let phase = sample_index as f32 * frequency_hz * std::f32::consts::TAU / SAMPLE_RATE;
            let sample = phase.sin() * amplitude;
            unsafe {
                *instance.get_input_left_ptr().add(frame) = sample;
                *instance.get_input_right_ptr().add(frame) = sample;
            }
        }
        let output = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
        if block >= WARMUP_BLOCKS {
            rendered.extend_from_slice(&output);
        }
    }

    measure(&rendered)
}

fn grinder_rig_capture_level(engine_mode: f32, fat: bool) -> Level {
    use daw_dsp::grinder::GrinderInstance;

    let mut instance = GrinderInstance::new(SAMPLE_RATE);
    instance.set_param("engineMode", engine_mode);
    instance.set_param("neuralPlacement", 1.0);
    instance.set_param("neuralMix", 1.0);
    instance.set_param("fat", if fat { 1.0 } else { 0.0 });

    let mut rendered = Vec::with_capacity(MEASURED_BLOCKS * BLOCK);
    for block in 0..(WARMUP_BLOCKS + MEASURED_BLOCKS) {
        for frame in 0..BLOCK {
            let sample_index = block * BLOCK + frame;
            let phase = sample_index as f32 * 110.0 * std::f32::consts::TAU / SAMPLE_RATE;
            let sample = phase.sin() * 0.12;
            unsafe {
                *instance.get_input_left_ptr().add(frame) = sample;
                *instance.get_input_right_ptr().add(frame) = sample;
            }
        }
        let output = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
        if block >= WARMUP_BLOCKS {
            rendered.extend_from_slice(&output);
        }
    }

    measure(&rendered)
}

/// Peak and RMS for each amp model at the fixed operating point above.
const GRINDER_EXPECTED: [(&str, f32, f32, f32); 6] = [
    ("Clean Twin", CLEAN_TWIN, 0.26114, 0.07575),
    ("Crunch JCM", CRUNCH_JCM, 0.59377, 0.16143),
    ("Lead JCM", LEAD_JCM, 0.44016, 0.14457),
    ("AC30 Top Boost", AC30_TOP_BOOST, 0.47949, 0.13736),
    ("Rectifier", RECTIFIER, 0.73044, 0.24670),
    ("Custom", CUSTOM, 0.82409, 0.16959),
];

#[test]
fn grinder_amp_models_hold_their_output_level_at_the_engine_boundary() {
    for (name, model, expected_peak, expected_rms) in GRINDER_EXPECTED {
        let level = grinder_level(model);
        assert_within_db(
            &format!("Grinder {name} peak"),
            level.peak,
            expected_peak,
            LEVEL_TOLERANCE_DB,
        );
        assert_within_db(
            &format!("Grinder {name} RMS"),
            level.rms,
            expected_rms,
            LEVEL_TOLERANCE_DB,
        );
    }
}

/// The limiter at the end of `GrinderEngine` exists to catch accidents, so at
/// shipped settings it should be doing nothing. This is the assertion that
/// would have caught the +6.2 dB shelf relocation as a *behaviour* change
/// rather than a level change: that edit drove peak to 0.99978 and put the
/// model hard into a limiter that had never engaged, silently converting a
/// headroom change into a compression change.
#[test]
fn grinder_stays_clear_of_its_output_safety_limiter_at_shipped_settings() {
    for (name, model, _, _) in GRINDER_EXPECTED {
        let level = grinder_level(model);
        assert!(
            level.peak < GRINDER_LIMITER_THRESHOLD,
            "Grinder {name} peaks at {:.5}, at or above the -0.3 dB safety \
             limiter threshold {GRINDER_LIMITER_THRESHOLD:.5}. The limiter is a \
             safety net, not a mix stage: once the signal reaches it at default \
             settings it is compressing on every note and the voicing below it \
             is no longer what anyone tuned.",
            level.peak
        );
    }
}

/// Separation, not just level. Clean Twin is the clean model and Rectifier the
/// highest-gain one, so at a high gain setting the Rectifier must deliver
/// substantially more sustained energy — that difference is the product.
///
/// Stated at **this** operating point deliberately. The ordering is not stable
/// across the gain range: at gain 3.0 Clean Twin measures *louder* than
/// Rectifier, because gain scaling and the model compressor interact. A guard
/// claiming a gain-independent ordering would be asserting something false.
#[test]
fn grinder_separates_its_clean_and_high_gain_models_at_the_engine_output() {
    let clean = grinder_level(CLEAN_TWIN);
    let rectifier = grinder_level(RECTIFIER);
    let ratio = rectifier.rms / clean.rms;

    assert_within_db(
        "Grinder Rectifier-over-Clean-Twin RMS ratio",
        ratio,
        3.2568,
        2.0,
    );
}

#[test]
fn grinder_fat_switch_increases_low_register_body_across_models_and_levels() {
    const FREQUENCIES_HZ: [f32; 3] = [82.41, 110.0, 146.83];
    const AMPLITUDES: [f32; 3] = [0.06, 0.12, 0.28];

    for (name, model, _, _) in GRINDER_EXPECTED {
        for frequency_hz in FREQUENCIES_HZ {
            for amplitude in AMPLITUDES {
                let neutral = grinder_sine_level(model, false, frequency_hz, amplitude);
                let fat = grinder_sine_level(model, true, frequency_hz, amplitude);
                let ratio = fat.rms / neutral.rms.max(f32::EPSILON);
                assert!(
                    ratio >= 1.005,
                    "Grinder {name} Fat must increase low-register body at {frequency_hz} Hz / {amplitude} input (off RMS={}, on RMS={}, ratio={})",
                    neutral.rms,
                    fat.rms,
                    ratio
                );
                assert!(
                    fat.peak < GRINDER_LIMITER_THRESHOLD,
                    "Grinder {name} Fat peaks at {}, at or above the -0.3 dB safety limiter threshold {GRINDER_LIMITER_THRESHOLD} at {frequency_hz} Hz / {amplitude} input",
                    fat.peak
                );
            }
        }
    }
}

#[test]
fn grinder_fat_switch_reaches_capture_and_full_hybrid_rig_outputs() {
    for (name, engine_mode) in [
        ("Capture Rig", 1.0),
        ("Hybrid Rig at full capture mix", 2.0),
    ] {
        let neutral = grinder_rig_capture_level(engine_mode, false);
        let fat = grinder_rig_capture_level(engine_mode, true);
        let ratio = fat.rms / neutral.rms.max(f32::EPSILON);
        assert!(
            ratio >= 1.005,
            "Grinder {name} Fat must increase low-register body (off RMS={}, on RMS={}, ratio={ratio})",
            neutral.rms,
            fat.rms
        );
        assert!(
            fat.peak < GRINDER_LIMITER_THRESHOLD,
            "Grinder {name} Fat peaks at {}, at or above {GRINDER_LIMITER_THRESHOLD}",
            fat.peak
        );
    }
}

// ---------------------------------------------------------------------------
// The other engine families
// ---------------------------------------------------------------------------

/// Render an effect engine that takes audio in through the raw input pointers.
fn effect_level(fill: &mut dyn FnMut(usize), process: &mut dyn FnMut() -> *const f32) -> Level {
    for block in 0..WARMUP_BLOCKS {
        fill(block * BLOCK);
        process();
    }
    let mut rendered = Vec::with_capacity(MEASURED_BLOCKS * BLOCK);
    for block in WARMUP_BLOCKS..(WARMUP_BLOCKS + MEASURED_BLOCKS) {
        fill(block * BLOCK);
        let out = unsafe { read_output(process(), BLOCK) };
        rendered.extend_from_slice(&out);
    }
    measure(&rendered)
}

/// Render an instrument engine over a fixed window starting at note-on. No
/// warmup here: for a struck or plucked voice the attack *is* the signal, and
/// skipping it would measure only the tail.
fn instrument_level(process: &mut dyn FnMut() -> *const f32, blocks: usize) -> Level {
    let mut rendered = Vec::with_capacity(blocks * BLOCK);
    for _ in 0..blocks {
        let out = unsafe { read_output(process(), BLOCK) };
        rendered.extend_from_slice(&out);
    }
    measure(&rendered)
}

const INSTRUMENT_BLOCKS: usize = 96;

fn bacteria_level() -> Level {
    use daw_dsp::bacteria::BacteriaInstance;
    let mut i = BacteriaInstance::new(SAMPLE_RATE);
    i.set_param("bandCount", 3.0);
    i.set_param("mix", 1.0);
    let (lp, rp) = (i.get_input_left_ptr(), i.get_input_right_ptr());
    effect_level(
        &mut |o| unsafe { fill_input(lp, rp, BLOCK, o) },
        &mut || i.process(BLOCK as u32),
    )
}

fn gluten_level() -> Level {
    use daw_dsp::gluten::GlutenInstance;
    let mut i = GlutenInstance::new(SAMPLE_RATE);
    i.set_param("threshold", -24.0);
    i.set_param("ratio", 4.0);
    i.set_param("attack", 5.0);
    i.set_param("release", 100.0);
    i.set_param("makeup", 3.0);
    let (lp, rp) = (i.get_input_left_ptr(), i.get_input_right_ptr());
    effect_level(
        &mut |o| unsafe { fill_input(lp, rp, BLOCK, o) },
        &mut || i.process(BLOCK as u32),
    )
}

fn crust_level() -> Level {
    use daw_dsp::crust::CrustInstance;
    let mut i = CrustInstance::new(SAMPLE_RATE);
    i.set_param("gain", 6.0);
    i.set_param("ceiling", -1.0);
    i.set_param("lookahead", 2.0);
    i.set_param("true_peak", 1.0);
    let (lp, rp) = (i.get_input_left_ptr(), i.get_input_right_ptr());
    effect_level(
        &mut |o| unsafe { fill_input(lp, rp, BLOCK, o) },
        &mut || i.process(BLOCK as u32),
    )
}

fn proof_level() -> Level {
    use daw_dsp::proof::ProofInstance;
    let mut i = ProofInstance::new(SAMPLE_RATE);
    i.set_param("limiter_ceiling", -1.0);
    i.set_param("limiter_threshold", -12.0);
    let (lp, rp) = (i.get_input_left_ptr(), i.get_input_right_ptr());
    effect_level(
        &mut |o| unsafe { fill_input(lp, rp, BLOCK, o) },
        &mut || i.process(BLOCK as u32),
    )
}

fn knead_level() -> Level {
    use daw_dsp::knead::KneadInstance;
    let mut i = KneadInstance::new(SAMPLE_RATE);
    // PSOLA is a passthrough at 0 semitones; engage it so this measures the
    // analysis/overlap-add path rather than a copy.
    i.set_shift_semitones(4.0);
    let (lp, rp) = (i.get_input_left_ptr(), i.get_input_right_ptr());
    effect_level(
        &mut |o| unsafe { fill_input(lp, rp, BLOCK, o) },
        &mut || i.process(BLOCK as u32),
    )
}

fn fermenter_level() -> Level {
    use daw_dsp::fermenter::FermenterInstance;
    let mut i = FermenterInstance::new(SAMPLE_RATE, 8);
    i.set_param("cutoff", 4_000.0);
    i.set_param("resonance", 0.4);
    for note in [48_u8, 55, 60, 64] {
        i.note_on(note, 100);
    }
    instrument_level(&mut || i.process(BLOCK as u32), INSTRUMENT_BLOCKS)
}

fn grand_boule_level() -> Level {
    use daw_dsp::grand_boule::GrandBouleInstance;
    let mut i = GrandBouleInstance::new(SAMPLE_RATE, 0);
    i.note_on(48, 0.9);
    i.note_on(60, 0.7);
    i.note_on(67, 0.5);
    instrument_level(&mut || i.process(BLOCK as u32), INSTRUMENT_BLOCKS)
}

fn toaster_level() -> Level {
    use daw_dsp::toaster::ToasterInstance;
    let mut i = ToasterInstance::new(SAMPLE_RATE, 8);
    i.set_param("master_gain", 0.63);
    // Velocity here is on a 0..127 scale, not 0..1. The RT guard in
    // `device_process_rt.rs` passes 1.0 and 0.8, driving the pads at under 1%
    // velocity — roughly 45 dB below a real hit — and still clearing its
    // `peak > 1e-4` non-silence check, which is why nothing noticed. That is
    // the gap in miniature: a one-sided "not silent" bound cannot tell a struck
    // drum from a brushed one, and a two-sided band on the level can.
    i.note_on(0, 127.0, 36);
    i.note_on(1, 100.0, 38);
    instrument_level(&mut || i.process(BLOCK as u32), INSTRUMENT_BLOCKS)
}

fn levain_level() -> Level {
    use daw_dsp::levain::LevainInstance;
    let mut i = LevainInstance::new(SAMPLE_RATE, 8);
    // A real looped sample mapped across the keyboard, so this measures the
    // sampler voice path rather than the fallback tone.
    let frame_count = 4_800_u32;
    let sample: Vec<f32> = (0..frame_count)
        .map(|f| (f as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();
    let sample_id = i
        .add_sample(sample, frame_count, 1, SAMPLE_RATE)
        .expect("test sample should fit the bank");
    i.add_zone(
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
        0.005,
        0.1,
        1.0,
        0.3,
    );
    i.build_zone_map(1, 1);
    i.note_on(60, 100);
    i.note_on(64, 90);
    instrument_level(&mut || i.process(BLOCK as u32), INSTRUMENT_BLOCKS)
}

#[test]
fn device_engines_hold_their_output_level_at_the_engine_boundary() {
    let families: [(&str, Level, f32, f32); 9] = [
        ("bacteria", bacteria_level(), 0.58812, 0.25139),
        // Re-measured 2026-08-17. Two deliberate, independently spec-guarded
        // changes moved this row since the 2026-07-30 pin: the declared RMS
        // detection mode now actually reaches the VCA (+0.82 dB), guarded by
        // `a_gluten_that_is_sent_no_detector_settings_uses_the_ones_it_declares`;
        // and the sidechain HPF default flipped to enabled at 80 Hz
        // (+0.39 dB marginal), guarded by
        // `a_bare_sidechain_chain_uses_the_declared_hpf_default`. The gain is
        // correct; only the pin was stale.
        ("gluten", gluten_level(), 0.40482, 0.18860),
        ("crust", crust_level(), 0.88986, 0.43822),
        ("proof", proof_level(), 0.81706, 0.35082),
        ("knead", knead_level(), 0.52538, 0.24745),
        ("fermenter", fermenter_level(), 1.46824, 0.39554),
        // Re-measured 2026-08-22 after replacing the recursive modal body with
        // the fixed feed-forward FIR body. The +/-1 dB bands are unchanged.
        ("grand_boule", grand_boule_level(), 1.36708, 0.28596),
        ("toaster", toaster_level(), 0.54580, 0.17768),
        ("levain", levain_level(), 0.32936, 0.19990),
    ];

    for (name, level, expected_peak, expected_rms) in families {
        assert_within_db(
            &format!("{name} peak"),
            level.peak,
            expected_peak,
            LEVEL_TOLERANCE_DB,
        );
        assert_within_db(
            &format!("{name} RMS"),
            level.rms,
            expected_rms,
            LEVEL_TOLERANCE_DB,
        );
    }
}
