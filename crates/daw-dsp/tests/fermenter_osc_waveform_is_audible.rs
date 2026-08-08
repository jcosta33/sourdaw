//! Fermenter's oscillator waveform selector must change the rendered signal.
//!
//! `osc_waveform` is a four-position selector — 0=sine, 1=saw, 2=square,
//! 3=triangle, the mapping documented on `WavetableOsc::table_index` and on
//! `FermenterPatch.oscWaveform` — and `MasterSynth` pre-computes exactly those
//! four band-limited tables. A guard that only asserted "the four settings
//! render differently" would pass on a wiring that shuffled them, so each
//! setting is checked against the harmonic series that defines its waveform.
//!
//! # How a waveform is identified
//!
//! A band-limited table is built from a harmonic recipe, so its identity is
//! visible in the amplitudes of harmonics 2 and 3 relative to the fundamental.
//! Peak normalization scales every harmonic of a table by the same factor, so
//! the *ratios* are the invariant:
//!
//! | setting  | h2/h1 | h3/h1 | what separates it            |
//! | -------- | ----- | ----- | ---------------------------- |
//! | sine     | 0     | 0     | no harmonics at all          |
//! | saw      | 1/2   | 1/3   | the only one with an even h2 |
//! | square   | 0     | 1/3   | odd-only, 1/h rolloff        |
//! | triangle | 0     | 1/9   | odd-only, 1/h² rolloff       |
//!
//! Those four rows are pairwise exclusive, so the table doubles as an identity
//! check: no two settings can satisfy each other's bounds.
//!
//! The probe note is A4 (MIDI 69 = 440 Hz exactly on the voice's equal-tempered
//! formula), and the measurement is a Hann-windowed single-bin DFT at
//! 440 / 880 / 1320 Hz. Harmonics are 440 Hz apart over an 8192-sample window
//! whose bin spacing is 5.86 Hz, so the bins do not bleed into one another.
//!
//! # Why two unison counts
//!
//! The wavetable oscillator exists twice in `Voice`: the mono `WavetableOsc`
//! used at `unison_voices == 1`, and the `UnisonOsc` bank used at
//! `unison_voices > 1` — `Voice::render` picks between them on
//! `has_unison = self.unison_voices > 1`. A guard run only at the default count
//! of 1 never enters the unison bank, so both counts are driven: 1 and 4.
//!
//! # Why two engines
//!
//! `Voice::render` tests `has_unison` *before* it matches on the engine, so
//! engine 1 (Analog) only reaches its own `PolyBlepOsc` at
//! `unison_voices == 1`; above that it renders the same `UnisonOsc` bank as
//! engine 0 and follows the selector for the same reason engine 0 does. The
//! Analog cases below therefore carry the whole claim at unison 1, and the
//! unison-4 case exists to pin that narrowing rather than to test new code.
//!
//! The two engines are not band-limited the same way — engine 0 reads
//! peak-normalized mip-mapped tables, engine 1 generates directly with polyBLEP
//! for its step discontinuities and polyBLAMP for the triangle's corners — but
//! both are approximations of the *same* four harmonic series, so one table of
//! ratio bounds identifies a waveform on either.

use daw_dsp::fermenter::FermenterInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// MIDI 69 — A4, 440.0 Hz on the equal-tempered formula the voice uses.
const PROBE_NOTE: u8 = 69;
const PROBE_VELOCITY: u8 = 127;
const FUNDAMENTAL_HZ: f32 = 440.0;
/// Past the 1 ms attack and into the flat sustain before anything is measured.
const WARMUP_BLOCKS: usize = 64;
/// 8192 frames: 75 cycles of the fundamental, bin spacing 5.86 Hz.
const ANALYSIS_BLOCKS: usize = 64;
const ANALYSIS_FRAMES: usize = ANALYSIS_BLOCKS * BLOCK;

/// The fundamental has to be genuinely present before a ratio against it means
/// anything — otherwise a silent render satisfies every "no harmonic" bound.
const MIN_FUNDAMENTAL: f32 = 0.01;

struct WaveformCase {
    /// Value written to `osc_waveform`.
    setting: f32,
    name: &'static str,
    /// Inclusive bounds on |h2| / |h1|.
    h2_ratio: (f32, f32),
    /// Inclusive bounds on |h3| / |h1|.
    h3_ratio: (f32, f32),
}

/// Bounds are the ideal recipe widened by what a band-limited, peak-normalized,
/// linearly-interpolated table and a 0.5 Q lowpass at 18 kHz can move it.
const WAVEFORM_CASES: [WaveformCase; 4] = [
    WaveformCase {
        setting: 0.0,
        name: "sine",
        h2_ratio: (0.0, 0.02),
        h3_ratio: (0.0, 0.02),
    },
    WaveformCase {
        setting: 1.0,
        name: "saw",
        h2_ratio: (0.40, 0.60),
        h3_ratio: (0.25, 0.42),
    },
    WaveformCase {
        setting: 2.0,
        name: "square",
        h2_ratio: (0.0, 0.05),
        h3_ratio: (0.25, 0.42),
    },
    WaveformCase {
        setting: 3.0,
        name: "triangle",
        h2_ratio: (0.0, 0.05),
        h3_ratio: (0.06, 0.17),
    },
];

/// A patch with nothing in the signal path that could add or remove harmonics:
/// no noise, no drift, no unison detune, no modulation, no drive, no effects,
/// and a lowpass parked far above the third harmonic.
fn configure_bare_oscillator(instance: &mut FermenterInstance, engine: f32, unison_voices: f32) {
    // 0 = wavetable, 1 = analog.
    instance.set_param("engine", engine);
    // Symmetric pulse, so engine 1's square has the even harmonics of a square
    // and not those of an off-centre pulse.
    instance.set_param("pulse_width", 0.5);
    instance.set_param("osc_level", 0.5);
    instance.set_param("osc_coarse", 0.0);
    instance.set_param("osc_fine", 0.0);
    instance.set_param("unison_voices", unison_voices);
    instance.set_param("unison_detune", 0.0);
    instance.set_param("unison_spread", 0.0);
    instance.set_param("noise_level", 0.0);
    instance.set_param("drift", 0.0);
    instance.set_param("voice_drive", 0.0);
    instance.set_param("filter_drive", 0.0);
    instance.set_param("filter_model", 0.0);
    instance.set_param("filter_mode", 0.0);
    instance.set_param("filter_keytrack", 0.0);
    instance.set_param("cutoff", 18_000.0);
    instance.set_param("resonance", 0.5);
    instance.set_param("mod_env_to_filter", 0.0);
    instance.set_param("mod_lfo_to_pitch", 0.0);
    instance.set_param("lfo_filter_amount", 0.0);
    instance.set_param("mseg_to_filter", 0.0);
    instance.set_param("seq_to_pitch", 0.0);
    instance.set_param("chaos_amount", 0.0);
    instance.set_param("warp_amount", 0.0);
    instance.set_param("audio_mod_depth", 0.0);

    // Flat sustain: the analysis window sees a constant-amplitude tone.
    instance.set_param("amp_attack", 0.001);
    instance.set_param("amp_decay", 5.0);
    instance.set_param("amp_sustain", 1.0);
    instance.set_param("amp_release", 5.0);

    // Dry master chain — a wet effect or a compressor would recolour the
    // harmonics that identify the waveform.
    instance.set_param("dist_mix", 0.0);
    instance.set_param("comp_mix", 0.0);
    instance.set_param("delay_mix", 0.0);
    instance.set_param("chorus_mix", 0.0);
    instance.set_param("phaser_mix", 0.0);
    instance.set_param("reverb_mix", 0.0);
    instance.set_param("eq_low_gain", 0.0);
    instance.set_param("eq_mid_gain", 0.0);
    instance.set_param("eq_high_gain", 0.0);
    instance.set_param("master_gain", 1.0);
    instance.set_param("stereo_width", 1.0);
}

/// Render the sustained probe note for one waveform setting.
fn render_sustain(setting: f32, engine: f32, unison_voices: f32) -> Vec<f32> {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    configure_bare_oscillator(&mut instance, engine, unison_voices);
    instance.set_param("osc_waveform", setting);
    instance.note_on(PROBE_NOTE, PROBE_VELOCITY);

    for _ in 0..WARMUP_BLOCKS {
        instance.process(BLOCK as u32);
    }

    let mut samples = Vec::with_capacity(ANALYSIS_FRAMES);
    for _ in 0..ANALYSIS_BLOCKS {
        let pointer = instance.process(BLOCK as u32);
        // SAFETY: `process` returns its own left buffer, allocated at 128
        // frames, and `BLOCK` is 128.
        let block = unsafe { std::slice::from_raw_parts(pointer, BLOCK) };
        samples.extend_from_slice(block);
    }
    samples
}

/// Hann-windowed single-bin DFT magnitude at `freq`.
fn bin_magnitude(samples: &[f32], freq: f32) -> f32 {
    let frame_count = samples.len() as f64;
    let mut real = 0.0f64;
    let mut imaginary = 0.0f64;
    for (index, sample) in samples.iter().enumerate() {
        let position = index as f64;
        let window = 0.5 - 0.5 * (std::f64::consts::TAU * position / frame_count).cos();
        let phase = std::f64::consts::TAU * freq as f64 * position / SAMPLE_RATE as f64;
        let windowed = *sample as f64 * window;
        real += windowed * phase.cos();
        imaginary += windowed * phase.sin();
    }
    (real.hypot(imaginary) / frame_count) as f32
}

fn assert_waveform_identity(case: &WaveformCase, engine: f32, unison_voices: f32) {
    let samples = render_sustain(case.setting, engine, unison_voices);
    let h1 = bin_magnitude(&samples, FUNDAMENTAL_HZ);
    let h2 = bin_magnitude(&samples, FUNDAMENTAL_HZ * 2.0);
    let h3 = bin_magnitude(&samples, FUNDAMENTAL_HZ * 3.0);

    assert!(
        h1 > MIN_FUNDAMENTAL,
        "{} on engine {engine} at unison {unison_voices}: fundamental is \
         {h1:.5}, below the {MIN_FUNDAMENTAL} floor — the render is silent, so \
         the harmonic ratios below would be meaningless",
        case.name
    );

    let h2_ratio = h2 / h1;
    let h3_ratio = h3 / h1;

    assert!(
        h2_ratio >= case.h2_ratio.0 && h2_ratio <= case.h2_ratio.1,
        "osc_waveform={} should render {} on engine {engine} at unison \
         {unison_voices}, whose second harmonic is {:?} of the fundamental; \
         measured {h2_ratio:.4} (h1={h1:.5}, h2={h2:.5})",
        case.setting,
        case.name,
        case.h2_ratio
    );
    assert!(
        h3_ratio >= case.h3_ratio.0 && h3_ratio <= case.h3_ratio.1,
        "osc_waveform={} should render {} on engine {engine} at unison \
         {unison_voices}, whose third harmonic is {:?} of the fundamental; \
         measured {h3_ratio:.4} (h1={h1:.5}, h3={h3:.5})",
        case.setting,
        case.name,
        case.h3_ratio
    );
}

#[test]
fn each_osc_waveform_setting_renders_its_own_harmonic_series() {
    for case in &WAVEFORM_CASES {
        assert_waveform_identity(case, 0.0, 1.0);
    }
}

#[test]
fn the_unison_bank_follows_the_osc_waveform_setting() {
    for case in &WAVEFORM_CASES {
        assert_waveform_identity(case, 0.0, 4.0);
    }
}

/// The Analog engine's own oscillator must render the selected waveform.
///
/// This is the path that used to render `PolyBlepOsc::pulse` unconditionally:
/// `PolyBlepOsc` held no waveform, so all four settings produced a square, and
/// three of the four rows below failed on h2 or h3. It is reached only at
/// `unison_voices == 1` — see the module header.
#[test]
fn the_analog_engine_renders_its_own_harmonic_series_per_waveform() {
    for case in &WAVEFORM_CASES {
        assert_waveform_identity(case, 1.0, 1.0);
    }
}

/// Above one unison voice the Analog engine renders the *wavetable* bank,
/// because `Voice::render` resolves `has_unison` before it matches on the
/// engine. That is what narrows the defect to `unison_voices == 1`.
///
/// Asserted as sample-identity against engine 0 rather than as harmonic bounds,
/// because after the fix both engines render the right waveform and bounds
/// alone can no longer tell which oscillator produced it. Identity can: nothing
/// but the shared `UnisonOsc` makes two different engines agree sample for
/// sample.
#[test]
fn above_one_unison_voice_the_analog_engine_renders_the_wavetable_bank() {
    for case in &WAVEFORM_CASES {
        assert_waveform_identity(case, 1.0, 4.0);

        let analog = render_sustain(case.setting, 1.0, 4.0);
        let wavetable = render_sustain(case.setting, 0.0, 4.0);
        assert_eq!(
            analog, wavetable,
            "{} at unison 4: the Analog engine should render the same bank as \
             the wavetable engine, sample for sample",
            case.name
        );
    }
}

/// The counterpart to the test above: at one voice the two engines must *not*
/// agree, because engine 1 renders its own `PolyBlepOsc` there.
///
/// Without this, moving every engine onto the wavetable oscillator would
/// satisfy the whole file — the Analog engine would be correct by no longer
/// being the Analog engine.
#[test]
fn at_one_unison_voice_the_analog_engine_renders_its_own_oscillator() {
    for case in &WAVEFORM_CASES {
        let analog = render_sustain(case.setting, 1.0, 1.0);
        let wavetable = render_sustain(case.setting, 0.0, 1.0);
        assert_ne!(
            analog, wavetable,
            "{} at unison 1: the Analog engine should render its own polyBLEP \
             oscillator, not the wavetable one",
            case.name
        );
    }
}

/// Render a sustained note that starts on one waveform and is switched to
/// another while it is still sounding. Both stretches are warmed up, so the
/// analysis window contains only post-switch samples.
fn render_sustain_after_switch(initial: f32, switched_to: f32, engine: f32) -> Vec<f32> {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    configure_bare_oscillator(&mut instance, engine, 1.0);
    instance.set_param("osc_waveform", initial);
    instance.note_on(PROBE_NOTE, PROBE_VELOCITY);
    for _ in 0..WARMUP_BLOCKS {
        instance.process(BLOCK as u32);
    }

    instance.set_param("osc_waveform", switched_to);
    for _ in 0..WARMUP_BLOCKS {
        instance.process(BLOCK as u32);
    }

    let mut samples = Vec::with_capacity(ANALYSIS_FRAMES);
    for _ in 0..ANALYSIS_BLOCKS {
        let pointer = instance.process(BLOCK as u32);
        // SAFETY: `process` returns its own left buffer, allocated at 128
        // frames, and `BLOCK` is 128.
        let block = unsafe { std::slice::from_raw_parts(pointer, BLOCK) };
        samples.extend_from_slice(block);
    }
    samples
}

/// Moving the selector must rewrite a note that is already sounding.
///
/// The note-on configuration path alone would satisfy the two tests above while
/// leaving the selector frozen for the life of every held note — turning it
/// into a control that only takes effect on the *next* note. Every wavetable
/// synth applies an oscillator wave change to sounding voices immediately, and
/// Fermenter's own engine, unison and noise settings already do, via the
/// per-block push in `Layer::advance_block_params`.
///
/// Each case is entered from a different starting waveform, so no case can be
/// satisfied by the note-on value it began with.
#[test]
fn moving_the_selector_rewrites_a_note_already_sounding() {
    for engine in [0.0, 1.0] {
        for case in &WAVEFORM_CASES {
            let initial = (case.setting + 1.0) % 4.0;
            assert_ne!(
                initial, case.setting,
                "the case must be switched away from a different waveform, or \
                 the note-on value alone would satisfy it"
            );

            let samples = render_sustain_after_switch(initial, case.setting, engine);
            let h1 = bin_magnitude(&samples, FUNDAMENTAL_HZ);
            let h2 = bin_magnitude(&samples, FUNDAMENTAL_HZ * 2.0);
            let h3 = bin_magnitude(&samples, FUNDAMENTAL_HZ * 3.0);

            assert!(
                h1 > MIN_FUNDAMENTAL,
                "{} on engine {engine}: fundamental is {h1:.5} after the \
                 switch, below the {MIN_FUNDAMENTAL} floor",
                case.name
            );

            let h2_ratio = h2 / h1;
            let h3_ratio = h3 / h1;
            assert!(
                h2_ratio >= case.h2_ratio.0 && h2_ratio <= case.h2_ratio.1,
                "switching a sounding note on engine {engine} from \
                 osc_waveform={initial} to {} should render {}, whose second \
                 harmonic is {:?} of the fundamental; measured {h2_ratio:.4}",
                case.setting,
                case.name,
                case.h2_ratio
            );
            assert!(
                h3_ratio >= case.h3_ratio.0 && h3_ratio <= case.h3_ratio.1,
                "switching a sounding note on engine {engine} from \
                 osc_waveform={initial} to {} should render {}, whose third \
                 harmonic is {:?} of the fundamental; measured {h3_ratio:.4}",
                case.setting,
                case.name,
                case.h3_ratio
            );
        }
    }
}

/// Peak difference between two settings' first block, as a fraction of the
/// louder block's peak. Two different tables are nothing like each other, so
/// this only has to sit above rounding — it is set at a tenth so that passing
/// it means an audible difference and not a numeric one.
const MIN_FIRST_BLOCK_DIFFERENCE: f32 = 0.10;

/// One block containing a note scheduled at its first sample.
fn render_scheduled_first_block(setting: f32, engine: f32) -> Vec<f32> {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    configure_bare_oscillator(&mut instance, engine, 1.0);
    instance.set_param("osc_waveform", setting);
    assert!(
        instance.push_note_on(PROBE_NOTE, PROBE_VELOCITY, 0, 0),
        "the event list should accept a single note-on"
    );

    let pointer = instance.process(BLOCK as u32);
    // SAFETY: `process` returns its own left buffer, allocated at 128 frames,
    // and `BLOCK` is 128.
    unsafe { std::slice::from_raw_parts(pointer, BLOCK) }.to_vec()
}

fn peak(block: &[f32]) -> f32 {
    block.iter().fold(0.0f32, |best, s| best.max(s.abs()))
}

/// A note that arrives *inside* a block takes its waveform from a different
/// place than a note that was already sounding.
///
/// `MasterSynth::process_block` pushes the layer's parameters onto its voices
/// once, at the top of the block, before any queued MIDI event is applied — and
/// that pass skips voices that are not active yet. So the per-block push cannot
/// reach a voice the block itself is about to start; only the note-on
/// configuration path can. This is the path the AudioWorklet uses for
/// sample-accurate MIDI, so a voice missed here plays its first block on
/// whatever table the pooled oscillator was left on.
///
/// The claim is differential rather than spectral because 128 samples is 1.17
/// cycles of the probe note — too short to resolve harmonics. Everything except
/// `osc_waveform` is identical between the two instances, so any difference in
/// the block is attributable to the selector alone.
#[test]
fn a_note_scheduled_inside_a_block_starts_on_the_selected_waveform() {
    for engine in [0.0, 1.0] {
        let blocks: Vec<(&'static str, Vec<f32>)> = WAVEFORM_CASES
            .iter()
            .map(|case| {
                (
                    case.name,
                    render_scheduled_first_block(case.setting, engine),
                )
            })
            .collect();

        for (name, block) in &blocks {
            assert!(
                peak(block) > MIN_FUNDAMENTAL,
                "{name} on engine {engine}: the scheduled note's first block \
                 peaks at {:.5}, so the comparison below would be between two \
                 silences",
                peak(block)
            );
        }

        for (index, (left_name, left_block)) in blocks.iter().enumerate() {
            for (right_name, right_block) in blocks.iter().skip(index + 1) {
                let loudest = peak(left_block).max(peak(right_block));
                let difference = left_block
                    .iter()
                    .zip(right_block.iter())
                    .fold(0.0f32, |best, (a, b)| best.max((a - b).abs()));
                assert!(
                    difference >= loudest * MIN_FIRST_BLOCK_DIFFERENCE,
                    "{left_name} and {right_name} should already differ on \
                     engine {engine} in the block their note starts in; peak \
                     difference is {difference:.5} against a peak of \
                     {loudest:.5}, a ratio of {:.4} under the \
                     {MIN_FIRST_BLOCK_DIFFERENCE} floor",
                    difference / loudest
                );
            }
        }
    }
}
