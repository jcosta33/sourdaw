//! Fermenter's glide-mode switch must decide whether a note glides.
//!
//! `portamento_mode` is a two-position switch — 0 = always, 1 = legato only,
//! the mapping documented on `FermenterPatch.portamentoMode` and offered by
//! `FermenterDescriptor` as "Glide Mode". Before this file existed
//! `Layer::set_param` stored the field and **nothing in the crate read it**:
//! `Layer::note_on_with_channel` passed `portamento_time` straight to
//! `Voice::set_portamento` whatever the mode said, so both positions of the
//! switch rendered identical audio.
//!
//! # What "legato only" means, and where that comes from
//!
//! Glide only when the new note-on arrives while the player is **still holding
//! a key**. The field is unanimous on this and states it in key terms rather
//! than sound terms: Roland's `LEGATO` applies portamento only when the next
//! key is pressed before the previous one is released; Yamaha calls the same
//! thing `Fingered` against `Fulltime`; Moog's `LEGATO GLIDE` glides only "while
//! still holding a previous key"; Serum's `Always` switch, when off, requires a
//! note to be held for portamento to take place on the second note; Ableton
//! Analog and Arturia Pigments word it the same way.
//!
//! Two consequences, both tested below because both are places an
//! implementation goes wrong:
//!
//!  - **A release tail is not a held key.** Surge XT sources its glide from
//!    `if (v->state.gate)`, and a voice in its release has no gate. Here the
//!    matching state is `Voice::held`, which `Voice::note_off` clears while the
//!    voice stays `active` through its tail. An implementation that reached for
//!    `is_active` would glide after a release and would still pass every other
//!    test in this file.
//!  - **There is no tolerance window.** No synth manual or synth engine found
//!    defines a millisecond legato window; the test is a boolean read of key
//!    state at the instant the note-on is processed. (Millisecond windows do
//!    exist in sampled-instrument legato scripting — a different domain.) So
//!    the predicate here is a plain `any(|voice| voice.held)` and there is
//!    nothing to calibrate.
//!
//! Glide **shape** is untouched by this file and by the change it guards: the
//! engine's one-pole ramp is constant-time, which is what the software cohort
//! this synth sits in defaults to (Serum, Vital and Surge all ship constant
//! time with per-octave scaling as an opt-in). Adding a rate mode would be its
//! own control.
//!
//! # How "did it glide?" is decided
//!
//! Not by "the two modes render differently" — a switch wired to the wrong
//! branch satisfies that too. Two instruments, neither of which needs to know
//! what pitch a glide starts *from*:
//!
//!  - **Identity against glide-off.** A suppressed note must render exactly as
//!    the same note does with `portamento` at 0. That is the definition of
//!    suppression, and it is checked sample for sample, so a mode that merely
//!    glided *less* fails it.
//!  - **Energy at the played pitch.** A Hann-windowed single-bin DFT at
//!    261.63 Hz (MIDI 60) over the first 85 ms. A snapped note sits in that bin
//!    from its first sample; a note still gliding towards it does not.
//!
//! The probe patch is a **sine** (`osc_waveform` 0). That is load-bearing: the
//! prior note in most cases below is MIDI 48, whose second harmonic is
//! 261.63 Hz exactly. On a saw it would land on top of the reading that
//! separates a snap from a glide; a sine has no second harmonic to put there.
//!
//! # Why 5 seconds of glide
//!
//! `Layer::set_param` clamps `portamento` to 5 s and `Voice::set_portamento`
//! turns it into a one-pole coefficient, so even the longest glide available
//! only covers ~10% of its interval inside the analysis window. A short glide
//! would be over before the window ended and would read as a snap.

use daw_dsp::fermenter::FermenterInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// MIDI 60 — C4, 261.626 Hz on the voice's equal-tempered formula.
const PROBE_NOTE: u8 = 60;
const PROBE_HZ: f32 = 261.625_58;
/// MIDI 48 — C3. An octave below the probe, so on a sine it puts nothing in the
/// measured bin.
const PRIOR_NOTE: u8 = 48;
const VELOCITY: u8 = 127;
/// The maximum `Layer::set_param` accepts for `portamento`.
const GLIDE_SECONDS: f32 = 5.0;
/// `Voice::set_portamento` treats anything at or under 0.001 s as no glide.
const GLIDE_OFF: f32 = 0.0;
const ALWAYS_MODE: f32 = 0.0;
const LEGATO_MODE: f32 = 1.0;
/// Blocks the prior note sounds before the probed note arrives.
const PRIOR_BLOCKS: usize = 16;
/// 4096 frames — 85 ms, bin spacing 11.7 Hz.
const ANALYSIS_BLOCKS: usize = 32;
/// Blocks rendered for whole-render comparisons.
const COMPARISON_BLOCKS: usize = 96;

/// A reading below this is silence, and a ratio taken against silence means
/// nothing.
const MIN_MAGNITUDE: f32 = 0.001;
/// How far a snapped note's energy at its own pitch must outweigh a gliding
/// note's. Set at 4x so that clearing it means the note is *at* the pitch and
/// not merely nearer to it.
const MIN_DOMINANCE: f32 = 4.0;
/// The floor the offline automation binding has to clear before a parameter may
/// take an ordinal, in the same currency
/// `dawDspFermenterAutomationOrdinals.spec.ts` measures it.
const MIN_BINDING_DIFFERENCE: f32 = 0.01;

/// What the prior note's key is doing when the probed note arrives.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum PriorNote {
    /// No note before the probed one.
    None,
    /// Played and released. Its release tail is still sounding — the key is up,
    /// so it must not make the probed note legato.
    Ringing,
    /// Played and still held down.
    Held,
}

/// The cases in which a glide has somewhere to start from, and so the only ones
/// in which mode 0 can be observed gliding at all.
///
/// `PriorNote::None` is deliberately absent. A glide runs from the last pitch
/// the layer played, and with no prior note there is none, so the destination is
/// substituted and the note snaps in **both** modes — see
/// `Layer::last_played_freq` and `fermenter_glide_origin.rs`. Before that was
/// true the first note of a patch swept from a hardcoded 440 Hz, which is what
/// made mode 0 look like it glided here.
const PRIOR_NOTE_CASES: [PriorNote; 2] = [PriorNote::Ringing, PriorNote::Held];

/// Nothing in the signal path that could move the measured bin: no noise, no
/// drift, no unison, no modulation reaching pitch or filter, no drive, no
/// effects, and a lowpass parked far above the reading.
fn configure_bare_sine(instance: &mut FermenterInstance) {
    instance.set_param("engine", 0.0);
    instance.set_param("osc_waveform", 0.0);
    instance.set_param("osc_level", 0.5);
    instance.set_param("osc_coarse", 0.0);
    instance.set_param("osc_fine", 0.0);
    instance.set_param("unison_voices", 1.0);
    instance.set_param("unison_detune", 0.0);
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

    // Flat sustain and a long release, so the `Ringing` case still has an
    // audible tail when the probed note starts.
    instance.set_param("amp_attack", 0.001);
    instance.set_param("amp_decay", 5.0);
    instance.set_param("amp_sustain", 1.0);
    instance.set_param("amp_release", 5.0);

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

fn render_block(instance: &mut FermenterInstance, into: &mut Vec<f32>) {
    let pointer = instance.process(BLOCK as u32);
    // SAFETY: `process` returns its own left buffer, allocated at 128 frames,
    // and `BLOCK` is 128.
    let block = unsafe { std::slice::from_raw_parts(pointer, BLOCK) };
    into.extend_from_slice(block);
}

/// Render `blocks` quanta from the moment the probed note starts, having first
/// put the prior note into the state `prior` names.
fn render_probe(mode: f32, glide_seconds: f32, prior: PriorNote, blocks: usize) -> Vec<f32> {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    configure_bare_sine(&mut instance);

    // The prior note is played under a fixed, snapping configuration in every
    // arm, and the probed values are written only after it. Writing them first
    // would let the *prior* note's own glide into every comparison: at mode 1
    // it is itself a note with no key down, so it snaps where mode 0 glides it,
    // and two renders would differ over a note neither test is about.
    instance.set_param("portamento", GLIDE_OFF);
    instance.set_param("portamento_mode", ALWAYS_MODE);

    if prior != PriorNote::None {
        instance.note_on(PRIOR_NOTE, VELOCITY);
        let mut discarded = Vec::with_capacity(PRIOR_BLOCKS * BLOCK);
        for _ in 0..PRIOR_BLOCKS {
            render_block(&mut instance, &mut discarded);
        }
        if prior == PriorNote::Ringing {
            instance.note_off(PRIOR_NOTE);
        }
    }

    instance.set_param("portamento", glide_seconds);
    instance.set_param("portamento_mode", mode);
    instance.note_on(PROBE_NOTE, VELOCITY);
    let mut samples = Vec::with_capacity(blocks * BLOCK);
    for _ in 0..blocks {
        render_block(&mut instance, &mut samples);
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

/// Energy at the pitch the probed note was played at, over the first 85 ms.
fn energy_at_played_pitch(mode: f32, prior: PriorNote) -> f32 {
    let samples = render_probe(mode, GLIDE_SECONDS, prior, ANALYSIS_BLOCKS);
    bin_magnitude(&samples, PROBE_HZ)
}

/// Total absolute sample difference between two renders.
fn total_difference(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right.iter())
        .map(|(a, b)| (a - b).abs())
        .sum()
}

/// The probed note under this mode must be at its own pitch from the start,
/// where the same note under "always" is still on its way there.
fn assert_starts_on_pitch(prior: PriorNote) {
    let snapped = energy_at_played_pitch(LEGATO_MODE, prior);
    let gliding = energy_at_played_pitch(ALWAYS_MODE, prior);
    assert!(
        snapped > MIN_MAGNITUDE,
        "{prior:?}: the legato-mode note reads {snapped:.5} at its own pitch, \
         below the {MIN_MAGNITUDE} floor — the render is silent, so the ratio \
         below would be meaningless"
    );
    assert!(
        snapped > gliding * MIN_DOMINANCE,
        "{prior:?}: no key is down, so legato mode must start the note at \
         {PROBE_HZ:.2} Hz while always mode is still gliding towards it — the \
         legato reading should be at least {MIN_DOMINANCE}x the always reading; \
         measured {snapped:.5} against {gliding:.5}"
    );
}

/// A note whose glide the legato switch suppressed must render exactly as the
/// same note renders with the glide time at zero.
///
/// This is the definitional half of the claim, and it is what the energy
/// readings alone cannot say: a mode that glided at some other rate would still
/// put more energy in the bin than a 5-second glide does, and would fail here.
#[test]
fn a_suppressed_note_renders_exactly_as_if_glide_were_off() {
    for prior in [PriorNote::None, PriorNote::Ringing] {
        let suppressed = render_probe(LEGATO_MODE, GLIDE_SECONDS, prior, COMPARISON_BLOCKS);
        let glide_off = render_probe(ALWAYS_MODE, GLIDE_OFF, prior, COMPARISON_BLOCKS);
        assert_eq!(
            suppressed, glide_off,
            "{prior:?}: legato mode with no key down must render the note the \
             way the engine renders it with portamento off, sample for sample"
        );
    }
}

/// With nothing played before it, the switch has no effect: neither position
/// glides, because there is no pitch to glide from.
///
/// This case used to be stated as `assert_starts_on_pitch(PriorNote::None)` —
/// mode 1 snapping while mode 0 was still on its way. Mode 0's half of that
/// contrast was the engine sweeping from the 440 Hz `Voice::new` seed, and with
/// the glide origin taken from play history instead there is nothing left for it
/// to sweep from. The claim the old assertion carried, that mode 1 snaps with no
/// key down, is unchanged and is still measured — by
/// `legato_mode_snaps_while_the_previous_note_rings_out_its_release`, whose
/// fixture has a history and so can still tell the two modes apart, and by
/// `a_suppressed_note_renders_exactly_as_if_glide_were_off`, which covers this
/// very fixture.
#[test]
fn neither_mode_glides_a_note_with_nothing_played_before_it() {
    let always = render_probe(
        ALWAYS_MODE,
        GLIDE_SECONDS,
        PriorNote::None,
        COMPARISON_BLOCKS,
    );
    let legato = render_probe(
        LEGATO_MODE,
        GLIDE_SECONDS,
        PriorNote::None,
        COMPARISON_BLOCKS,
    );
    let glide_off = render_probe(ALWAYS_MODE, GLIDE_OFF, PriorNote::None, COMPARISON_BLOCKS);
    assert_eq!(
        always, glide_off,
        "always mode has no pitch to glide the first note from, so it must \
         render it the way the engine renders it with portamento off"
    );
    assert_eq!(
        legato, glide_off,
        "and legato mode, which suppresses the glide outright here, must agree \
         with it sample for sample"
    );
}

/// The edge case the field has already settled. A note whose key is up is not
/// held even though its release tail is still sounding — Surge XT gates its
/// glide on `state.gate`, and every manual wording is on key release rather
/// than on audible decay. An implementation asking `Voice::is_active` instead
/// of `Voice::held` glides here and passes everything else in this file.
#[test]
fn legato_mode_snaps_while_the_previous_note_rings_out_its_release() {
    assert_starts_on_pitch(PriorNote::Ringing);
}

/// And the branch that makes mode 1 a glide mode rather than an off switch.
/// Without this, `portamento_mode == 1 => never glide` passes every test above.
///
/// Asserted as sample identity against mode 0 rather than as an energy reading,
/// because mode 1 with a key down is not "glides differently" but "glides" —
/// the same glide mode 0 would have produced.
#[test]
fn legato_mode_glides_while_the_previous_key_is_still_down() {
    let legato = render_probe(
        LEGATO_MODE,
        GLIDE_SECONDS,
        PriorNote::Held,
        COMPARISON_BLOCKS,
    );
    let always = render_probe(
        ALWAYS_MODE,
        GLIDE_SECONDS,
        PriorNote::Held,
        COMPARISON_BLOCKS,
    );
    assert_eq!(
        legato, always,
        "with a key still down both modes glide, so they must render the same \
         samples"
    );

    let glide_off = render_probe(LEGATO_MODE, GLIDE_OFF, PriorNote::Held, COMPARISON_BLOCKS);
    assert_ne!(
        legato, glide_off,
        "and that shared render must be a glide — legato mode with a key down \
         must not render the same as the glide being off"
    );
}

/// Mode 0 does not consult the keyboard at all. This is the behaviour the
/// engine already had for every value of the switch, and it must survive the
/// switch gaining an effect — including in the state where mode 1 now
/// suppresses the glide, which is where a fix applied to the wrong branch would
/// land.
///
/// What mode 0 does consult is whether anything has been played, which is a
/// different question and not a keyboard one — see [`PRIOR_NOTE_CASES`].
#[test]
fn always_mode_glides_whatever_the_previous_key_is_doing() {
    for prior in PRIOR_NOTE_CASES {
        let gliding = render_probe(ALWAYS_MODE, GLIDE_SECONDS, prior, COMPARISON_BLOCKS);
        let glide_off = render_probe(ALWAYS_MODE, GLIDE_OFF, prior, COMPARISON_BLOCKS);
        assert_ne!(
            gliding, glide_off,
            "{prior:?}: always mode must glide, so its render must differ from \
             the same note with portamento off"
        );
    }
}

/// The claim the offline automation binding rests on, in the currency
/// `dawDspFermenterAutomationOrdinals.spec.ts` requires before a parameter may
/// take an ordinal at all: driving this parameter moves the rendered audio by
/// more than a rounding error. Measured here against the native build, where a
/// failure names the engine rather than the binding.
///
/// Measured over `PriorNote::Ringing` rather than `PriorNote::None`: no key is
/// down in either, but only the ringing fixture has a pitch for mode 0 to glide
/// from, and a parameter that moves nothing in the arm it is measured in cannot
/// evidence a binding. That is the same reason
/// `dawDspFermenterAutomationOrdinals.spec.ts` plays a `priorNote` on both of
/// its portamento rows.
#[test]
fn the_two_modes_render_differently_when_no_key_is_down() {
    let always = render_probe(
        ALWAYS_MODE,
        GLIDE_SECONDS,
        PriorNote::Ringing,
        COMPARISON_BLOCKS,
    );
    let legato = render_probe(
        LEGATO_MODE,
        GLIDE_SECONDS,
        PriorNote::Ringing,
        COMPARISON_BLOCKS,
    );
    let difference = total_difference(&always, &legato);
    assert!(
        difference > MIN_BINDING_DIFFERENCE,
        "the glide-mode switch must move the render: total absolute difference \
         over {COMPARISON_BLOCKS} quanta is {difference:.6}, under the \
         {MIN_BINDING_DIFFERENCE} floor the binding requires"
    );
}
