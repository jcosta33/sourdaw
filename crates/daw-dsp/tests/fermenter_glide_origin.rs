//! Where a Fermenter glide starts *from*.
//!
//! `portamento_mode` (guarded by `fermenter_portamento_mode_legato.rs`) decides
//! **whether** a note glides. This file decides **from what pitch**, which is a
//! separate question and one the engine used to get wrong in two of its three
//! cases.
//!
//! # What was wrong
//!
//! The glide source was `Voice::current_freq` — per-voice-slot state, seeded at
//! `440.0` by `Voice::new`. `Voice::note_on` snaps it onto the new pitch only
//! when `glide_coeff >= 0.999` (glide off); with a glide armed it leaves the
//! field alone and the render loop ramps it towards `target_freq`. So a glide
//! started from whatever pitch **that particular slot** was last left on:
//!
//!  - **Monophonic playing** recycles the previous note's slot, so the origin
//!    was right. That is why the defect survived — it is the case anyone plays
//!    while listening.
//!  - **Overlapping notes take a different slot.** `Layer::note_on_with_channel`
//!    picks the first *inactive* voice, so the origin was a stale pitch left by
//!    some earlier note on that slot — or 440.0 if the slot had never been used.
//!    Every legato glide is by definition an overlap.
//!  - **The first note after instantiation** swept from a hardcoded 440.0 (A4),
//!    whatever the patch or the note.
//!
//! # The convention, and where it comes from
//!
//! **The glide source is a single last-played pitch held by the layer, not
//! per-voice slot state**, and **with no history the source equals the
//! destination, so the note snaps.**
//!
//! Vital's `voice_handler.cpp` is the closest match to this engine — a
//! polyphonic synth whose glide runs per voice from one shared source — and it
//! is where both halves come from verbatim. Its note-on reads:
//!
//! ```text
//! poly_float last_note = tuned_note;
//! if (last_played_note_[0] >= 0.0f)
//!   last_note = last_played_note_;
//! last_played_note_ = tuned_note;
//! ```
//!
//! with `last_played_note_(-1.0f)` in the constructor. The local starts *at the
//! destination* and is only replaced when there is history, which is the "no
//! history snaps" rule; and the store is written on **every** note-on,
//! unconditionally, whether or not that note glided.
//!
//! Surge XT keeps the same shape with different reach: `storage.last_key[scene]`
//! is scene-global rather than per voice, and is written only at note-on
//! (`if (polymode == pm_mono_fp && !glide) storage.last_key[scene] = key;`) with
//! no corresponding write in `releaseNote`. Surge only offers glide in its mono
//! modes — its polyphonic voice construction passes `0.f` for the portamento
//! reuse arguments — so it has nothing to say about polyphonic overlap.
//!
//! **Where the two disagree: no history.** Vital snaps. Surge initialises
//! `last_key[0] = 60; last_key[1] = 60;` and would glide the very first note
//! from middle C. Vital's rule is taken here, for two reasons. Surge's 60 is
//! only ever reachable in a monophonic mode where the next note is a bounded
//! step away, whereas this engine is polyphonic; and a fixed starting pitch is
//! the *same class of behaviour* as the 440.0 seed this change exists to
//! remove — it only relocates the arbitrary constant. Snapping has no arbitrary
//! constant in it.
//!
//! **Released notes do not clear the source.** Both sources agree here: neither
//! writes its store on note-off. That sits alongside — not against — the
//! `Voice::held` predicate `Layer::portamento_time_for_note_on` uses for legato
//! mode, because the two answer different questions. "Is a key still down?" is a
//! statement about the keyboard *now* and decides whether a glide happens at
//! all; "what was the last note played?" is a statement about play *history* and
//! decides where a glide that does happen starts. Releasing a key ends the first
//! and not the second.
//!
//! **Polyphonic overlap:** every note-on both reads and then overwrites the one
//! source, so a chord entered as three note-ons glides its second note from its
//! first and its third from its second. That is Vital's behaviour exactly, and
//! it falls out of the same two lines.
//!
//! # How these tests tell one origin from another
//!
//! By reading the pitch back out of the rendered audio, at the start of the
//! glide **and partway through it**. A glide that snaps and a glide that ramps
//! correctly agree at both ends of a long enough render, so an endpoint-only
//! assertion proves nothing.
//!
//! The readout is interpolated upward zero crossings on a pure sine — see
//! [`mean_frequency`]. The patch is configured so nothing else can move a zero
//! crossing: sine oscillator, one unison voice, no noise, drift, modulation,
//! drive or effects, and the lowpass parked far above the reading.
//!
//! # Why these three notes cannot coincide
//!
//! [`STALE_NOTE`] is what the recycled slot was left holding, [`SOURCE_NOTE`] is
//! the last note actually played, [`PROBE_NOTE`] is where the glide is going —
//! 65.41, 1046.50 and 261.63 Hz, with the old 440.0 seed a fourth distinct
//! value. The wrong origin sits *below* the destination and the right one sits
//! *above* it, so the broken and fixed engines disagree about which **direction**
//! the glide travels, not merely by how much. No choice of tolerance can let one
//! pass for the other.

use daw_dsp::fermenter::FermenterInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// MIDI 36 — C2, 65.41 Hz. Left on the slot the probed note will recycle, and
/// below the destination.
const STALE_NOTE: u8 = 36;
/// MIDI 84 — C6, 1046.50 Hz. The last note played, and the correct origin. Two
/// octaves above the destination, so a glide from here descends.
const SOURCE_NOTE: u8 = 84;
const SOURCE_HZ: f32 = 1046.502;
/// MIDI 60 — C4, 261.63 Hz. The note whose glide is measured.
const PROBE_NOTE: u8 = 60;
const PROBE_HZ: f32 = 261.625_58;
const VELOCITY: u8 = 127;

/// Long enough that the opening window is still near the origin and the interior
/// window is unmistakably between the two pitches. `Voice::set_portamento` turns
/// this into a one-pole coefficient whose time constant is `GLIDE_SECONDS / 2π`,
/// so 3 s is a 477 ms constant: ~8% of the interval covered by the end of the
/// opening window, ~70% by the interior one.
const GLIDE_SECONDS: f32 = 3.0;
/// `Voice::set_portamento` treats anything at or under 0.001 s as no glide.
const GLIDE_OFF: f32 = 0.0;
/// 0 = glide every note. Everything here is measured in mode 0 so it stands on
/// its own: the origin is not a mode-1 question.
const ALWAYS_MODE: f32 = 0.0;

/// 85 ms from the first sample of the probed note.
const OPENING_BLOCKS: usize = 32;
/// The interior window, blocks 192..224 — 512 ms to 597 ms in.
const INTERIOR_START_BLOCK: usize = 192;
const INTERIOR_END_BLOCK: usize = 224;
/// Everything the fixtures render, which is the interior window's end.
const TOTAL_BLOCKS: usize = INTERIOR_END_BLOCK;
/// Blocks rendered after a note-off before the slot is treated as free. With
/// `amp_release` at 5 ms this is two orders of magnitude more than the envelope
/// needs.
const RELEASE_BLOCKS: usize = 64;

/// Nothing in the signal path that could move a zero crossing: sine oscillator,
/// one unison voice, no noise, drift, modulation, drive or effects, and the
/// lowpass parked far above every pitch read here.
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

    // Flat sustain so the measured tone holds its level across the whole render,
    // and a short release so a released setup note frees its slot promptly.
    instance.set_param("amp_attack", 0.001);
    instance.set_param("amp_decay", 5.0);
    instance.set_param("amp_sustain", 1.0);
    instance.set_param("amp_release", 0.005);

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

fn render_discarded(instance: &mut FermenterInstance, blocks: usize) {
    let mut discarded = Vec::with_capacity(blocks * BLOCK);
    for _ in 0..blocks {
        render_block(instance, &mut discarded);
    }
}

/// What the voice pool has been through before the probed note arrives.
///
/// [`History::Monophonic`] and [`History::Overlapping`] play the **same two
/// notes over the same number of blocks**, and differ in one thing only:
/// whether [`STALE_NOTE`] is still held when [`SOURCE_NOTE`] arrives. That is
/// what decides which slot `SOURCE_NOTE` lands on, and therefore what the probed
/// note finds on the slot it recycles.
///
/// The block counts are matched deliberately, not incidentally.
/// `MasterSynth::process_block` ticks the layer's smoothed parameters once per
/// block whether or not anything is sounding, so two fixtures that rendered a
/// different number of setup blocks would leave the lowpass at slightly
/// different cutoffs and put a fraction of a degree of phase between two
/// otherwise identical renders — enough to break a sample comparison for a
/// reason that has nothing to do with glide.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum History {
    /// Nothing at all — a freshly constructed instance.
    None,
    /// [`STALE_NOTE`] released before [`SOURCE_NOTE`] is pressed, so
    /// `SOURCE_NOTE` recycles the freed slot. Slot state and play history agree,
    /// which is why this case worked before the fix — and must go on working.
    Monophonic,
    /// [`SOURCE_NOTE`] pressed **while [`STALE_NOTE`] is still held**, which
    /// forces it onto a second slot. When the probed note later takes the first
    /// free slot it finds `STALE_NOTE`'s pitch sitting there and the last-played
    /// pitch two octaves away.
    Overlapping,
}

/// Play `history`, then start the probed note with `glide_seconds` of glide and
/// return `TOTAL_BLOCKS` of its render.
fn render_probe(history: History, glide_seconds: f32) -> Vec<f32> {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    configure_bare_sine(&mut instance);

    // The setup notes are played with the glide off and the mode fixed, so they
    // snap onto their own pitches and contribute nothing but their pitch to what
    // follows. The probed values are written only after them.
    instance.set_param("portamento", GLIDE_OFF);
    instance.set_param("portamento_mode", ALWAYS_MODE);

    match history {
        History::None => {}
        History::Monophonic => {
            instance.note_on(STALE_NOTE, VELOCITY);
            render_discarded(&mut instance, RELEASE_BLOCKS);
            instance.note_off(STALE_NOTE);
            render_discarded(&mut instance, RELEASE_BLOCKS);
            instance.note_on(SOURCE_NOTE, VELOCITY);
            render_discarded(&mut instance, RELEASE_BLOCKS);
            instance.note_off(SOURCE_NOTE);
            render_discarded(&mut instance, RELEASE_BLOCKS);
        }
        History::Overlapping => {
            instance.note_on(STALE_NOTE, VELOCITY);
            render_discarded(&mut instance, RELEASE_BLOCKS);
            render_discarded(&mut instance, RELEASE_BLOCKS);
            // Pressed while `STALE_NOTE` is still sounding and still held, which
            // is what puts it on a different slot.
            instance.note_on(SOURCE_NOTE, VELOCITY);
            render_discarded(&mut instance, RELEASE_BLOCKS);
            instance.note_off(STALE_NOTE);
            instance.note_off(SOURCE_NOTE);
            render_discarded(&mut instance, RELEASE_BLOCKS);
        }
    }

    instance.set_param("portamento", glide_seconds);
    instance.note_on(PROBE_NOTE, VELOCITY);
    let mut samples = Vec::with_capacity(TOTAL_BLOCKS * BLOCK);
    for _ in 0..TOTAL_BLOCKS {
        render_block(&mut instance, &mut samples);
    }
    samples
}

/// Mean frequency over `samples`, from interpolated upward zero crossings.
///
/// Complete cycles divided by the time between the first and last crossing.
/// That is exactly the mean of the instantaneous frequency over the span, since
/// phase is its integral — which is what makes it usable on a signal whose pitch
/// is moving.
///
/// Returns 0.0 when the span holds fewer than two crossings; every caller
/// asserts a band that 0.0 falls outside, so a degenerate window fails loudly
/// rather than reading as some plausible pitch.
fn mean_frequency(samples: &[f32]) -> f32 {
    let mut first_crossing: Option<f64> = None;
    let mut last_crossing = 0.0f64;
    let mut crossings = 0usize;

    for index in 1..samples.len() {
        let previous = samples[index - 1];
        let current = samples[index];
        if previous >= 0.0 || current < 0.0 {
            continue;
        }
        // Linear interpolation of where the signal actually crossed, so the
        // reading is not quantised to the sample grid.
        let fraction = (-previous as f64) / ((current - previous) as f64);
        let position = (index - 1) as f64 + fraction;
        if first_crossing.is_none() {
            first_crossing = Some(position);
        }
        last_crossing = position;
        crossings += 1;
    }

    let Some(first) = first_crossing else {
        return 0.0;
    };
    if crossings < 2 {
        return 0.0;
    }
    let span_seconds = (last_crossing - first) / SAMPLE_RATE as f64;
    ((crossings - 1) as f64 / span_seconds) as f32
}

fn opening_frequency(samples: &[f32]) -> f32 {
    mean_frequency(&samples[..OPENING_BLOCKS * BLOCK])
}

fn interior_frequency(samples: &[f32]) -> f32 {
    mean_frequency(&samples[INTERIOR_START_BLOCK * BLOCK..INTERIOR_END_BLOCK * BLOCK])
}

/// The shape of a correct descending glide from [`SOURCE_HZ`] to [`PROBE_HZ`],
/// asserted at two points because its endpoints alone cannot separate it from a
/// note that snapped.
///
/// The bands are wide on purpose — they are not a claim about the ramp's shape,
/// only about where it starts and that it is still on its way. What they exclude
/// is every rival origin: 65.41 Hz (the stale slot), 440.0 Hz (the old
/// `Voice::new` seed) and 261.63 Hz (a snap) all sit outside the opening band,
/// on both sides.
fn assert_glides_down_from_the_source_pitch(samples: &[f32], case: History) {
    let opening = opening_frequency(samples);
    let interior = interior_frequency(samples);

    assert!(
        (700.0..=SOURCE_HZ + 1.0).contains(&opening),
        "{case:?}: the glide must start at {SOURCE_HZ:.2} Hz and be barely under \
         way 85 ms in, so the opening window should read between 700 Hz and \
         {SOURCE_HZ:.2} Hz; measured {opening:.2} Hz. Below 700 Hz means the \
         origin came from somewhere else — 65.41 Hz is the stale slot, 440.0 Hz \
         the old per-voice seed, 261.63 Hz a note that never glided at all."
    );
    assert!(
        (PROBE_HZ + 20.0..opening - 20.0).contains(&interior),
        "{case:?}: 512 ms in, the glide must be partway down — strictly below \
         its opening reading of {opening:.2} Hz and strictly above its \
         destination of {PROBE_HZ:.2} Hz; measured {interior:.2} Hz. Reading at \
         the destination means it snapped; reading at the opening value means it \
         never moved."
    );
}

/// The defect. An overlapping note must glide from the pitch last **played**,
/// not from whatever the slot it happened to land on was last left holding.
///
/// Under the old engine this render opened around 82 Hz, climbing from
/// `STALE_NOTE`; under the fix it opens around 980 Hz, descending from
/// `SOURCE_NOTE`.
#[test]
fn an_overlapping_note_glides_from_the_last_played_pitch() {
    let samples = render_probe(History::Overlapping, GLIDE_SECONDS);
    assert_glides_down_from_the_source_pitch(&samples, History::Overlapping);
}

/// The same claim stated as an equality rather than as a band: the two fixtures
/// play the same two notes over the same number of blocks and differ only in
/// which slot the probed note is allocated, so their glides must coincide.
///
/// Stated in Hz rather than as sample identity, and the difference between the
/// two matters. The two renders are not bit-identical — they sit about 68 dB
/// apart at their widest, because `History::Overlapping` has two voices sounding
/// at once for part of its setup and the master chain's signal-dependent state
/// carries a trace of that past the point where the voices themselves fall
/// silent. That residue is not a pitch and asserting it away would make this
/// guard fail for reasons that have nothing to do with glide. The pitch readings
/// are the claim, and they agree to about 0.002 Hz — three orders of magnitude
/// inside the tolerance below, which is itself three orders of magnitude inside
/// the ~900 Hz that separates the right origin from the stale-slot one.
#[test]
fn slot_reuse_does_not_change_where_the_glide_starts() {
    const TOLERANCE_HZ: f32 = 1.0;

    let overlapping = render_probe(History::Overlapping, GLIDE_SECONDS);
    let monophonic = render_probe(History::Monophonic, GLIDE_SECONDS);

    let opening_gap = (opening_frequency(&overlapping) - opening_frequency(&monophonic)).abs();
    let interior_gap = (interior_frequency(&overlapping) - interior_frequency(&monophonic)).abs();

    assert!(
        opening_gap < TOLERANCE_HZ,
        "both fixtures last played {SOURCE_NOTE}, so both glides must start from \
         the same pitch whichever slot they were allocated; their opening \
         readings are {:.3} Hz and {:.3} Hz, {opening_gap:.3} Hz apart",
        opening_frequency(&overlapping),
        opening_frequency(&monophonic)
    );
    assert!(
        interior_gap < TOLERANCE_HZ,
        "and they must still coincide partway down, where a snap and a correct \
         ramp part company; measured {:.3} Hz and {:.3} Hz, {interior_gap:.3} Hz \
         apart",
        interior_frequency(&overlapping),
        interior_frequency(&monophonic)
    );
}

/// The case the old engine got right, which the fix must not cost. Sequential
/// monophonic playing recycles the previous note's slot, so slot state and play
/// history agreed — and they must go on agreeing.
#[test]
fn sequential_monophonic_playing_still_glides_from_the_previous_note() {
    let samples = render_probe(History::Monophonic, GLIDE_SECONDS);
    assert_glides_down_from_the_source_pitch(&samples, History::Monophonic);
}

/// With no history there is no pitch to glide from, so the note starts where it
/// is going. Under the old engine it swept down from the hardcoded 440.0 that
/// `Voice::new` seeded — an A4-to-target sweep on the first note of any patch
/// with glide dialled in.
#[test]
fn the_first_note_after_instantiation_snaps() {
    let samples = render_probe(History::None, GLIDE_SECONDS);
    let opening = opening_frequency(&samples);
    assert!(
        (PROBE_HZ - 2.0..=PROBE_HZ + 2.0).contains(&opening),
        "with nothing played before it the note must start at its own pitch, \
         {PROBE_HZ:.2} Hz; measured {opening:.2} Hz. A reading near 410 Hz is \
         the old 440.0 seed on its way down."
    );
}

/// And the snap must be a real snap, not a very fast glide: with no history the
/// render has to match the same note with the glide turned off, sample for
/// sample. Both renders share an identical history — an empty one — so nothing
/// but the glide can separate them.
#[test]
fn the_first_note_renders_exactly_as_if_glide_were_off() {
    let snapped = render_probe(History::None, GLIDE_SECONDS);
    let glide_off = render_probe(History::None, GLIDE_OFF);
    assert_eq!(
        snapped, glide_off,
        "a note with no pitch to glide from must render the way the engine \
         renders it with portamento off"
    );
}

/// A layer that was out of range while notes were played still glides its next
/// note from what the **player** played, not from whatever it was last audible
/// for itself.
///
/// This is the same defect one level up. `MasterSynth::note_on_with_channel`
/// fans a note out only to layers that are unmuted, solo-eligible and inside
/// `num_active_layers`, so a record kept *per layer* would mean "what was this
/// layer last audible for" — and a layer switched out of range for part of a
/// phrase would keep the pitch from before it left and glide from there. The
/// record is therefore taken by the synth, above that filter.
///
/// `num_layers` is a declared, automatable patch parameter with an entry in
/// `AUTOMATION_PARAM_NAMES`, so this state is reachable from a project rather
/// than only from a test. `layer_mute` reproduces it identically.
///
/// The fixture silences layer 0 with `layer_level` so that only layer 1 is
/// measured, and moves `num_layers` so that only layer 0 hears the middle note.
/// The two candidate origins are the same two octaves apart the rest of this
/// file uses, in opposite directions from the destination.
#[test]
fn a_layer_out_of_range_still_glides_from_what_the_player_played() {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);

    // Layer 0: configured and then silenced, so it never reaches the analysis
    // while still being the layer that receives the middle note.
    instance.set_param("active_layer", 0.0);
    configure_bare_sine(&mut instance);
    instance.set_param("layer_level", 0.0);

    // Layer 1: the one that is measured.
    instance.set_param("num_layers", 2.0);
    instance.set_param("active_layer", 1.0);
    configure_bare_sine(&mut instance);
    instance.set_param("portamento", GLIDE_OFF);
    instance.set_param("portamento_mode", ALWAYS_MODE);

    // Heard by both layers.
    instance.note_on(STALE_NOTE, VELOCITY);
    render_discarded(&mut instance, RELEASE_BLOCKS);
    instance.note_off(STALE_NOTE);
    render_discarded(&mut instance, RELEASE_BLOCKS);

    // Layer 1 is now out of range, so only layer 0 hears this one — but the
    // player played it, and it is the pitch the next glide must start from.
    instance.set_param("num_layers", 1.0);
    instance.note_on(SOURCE_NOTE, VELOCITY);
    render_discarded(&mut instance, RELEASE_BLOCKS);
    instance.note_off(SOURCE_NOTE);
    render_discarded(&mut instance, RELEASE_BLOCKS);

    // Layer 1 back in range, and its glide armed.
    instance.set_param("num_layers", 2.0);
    instance.set_param("active_layer", 1.0);
    instance.set_param("portamento", GLIDE_SECONDS);
    instance.note_on(PROBE_NOTE, VELOCITY);

    let mut samples = Vec::with_capacity(TOTAL_BLOCKS * BLOCK);
    for _ in 0..TOTAL_BLOCKS {
        render_block(&mut instance, &mut samples);
    }

    assert_origin_survived_the_filter(&samples, "layer 1 out of num_layers range");
}

/// The same claim through the other exclusion the filter offers: every active
/// layer *muted* while [`SOURCE_NOTE`] is played, so the note reaches **no**
/// layer at all.
///
/// This is the arm that the range fixture above cannot cover. With `num_layers`
/// at 1 there is still a playable layer, so an implementation that recorded the
/// pitch only when the note reached *some* layer would look correct there — the
/// record would be taken by layer 0 into shared state and read back by layer 1
/// later. Muting every layer removes that cover: nothing is dispatched, and an
/// implementation that hangs the record off dispatch takes none.
///
/// `MasterSynth::last_played_freq`'s doc promises the record is taken "whether
/// or not **any** given layer was in range, unmuted and solo-eligible", and this
/// is the arm where *any* has to mean *none*.
#[test]
fn a_note_played_while_every_layer_is_muted_is_still_the_next_glide_origin() {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    configure_bare_sine(&mut instance);
    instance.set_param("portamento", GLIDE_OFF);
    instance.set_param("portamento_mode", ALWAYS_MODE);

    // Heard, and left on the slot the probed note will recycle.
    instance.note_on(STALE_NOTE, VELOCITY);
    render_discarded(&mut instance, RELEASE_BLOCKS);
    instance.note_off(STALE_NOTE);
    render_discarded(&mut instance, RELEASE_BLOCKS);

    // Reaches no layer whatsoever — but the player played it.
    instance.set_param("layer_mute", 1.0);
    instance.note_on(SOURCE_NOTE, VELOCITY);
    render_discarded(&mut instance, RELEASE_BLOCKS);
    instance.note_off(SOURCE_NOTE);
    render_discarded(&mut instance, RELEASE_BLOCKS);

    instance.set_param("layer_mute", 0.0);
    instance.set_param("portamento", GLIDE_SECONDS);
    instance.note_on(PROBE_NOTE, VELOCITY);

    let mut samples = Vec::with_capacity(TOTAL_BLOCKS * BLOCK);
    for _ in 0..TOTAL_BLOCKS {
        render_block(&mut instance, &mut samples);
    }

    assert_origin_survived_the_filter(&samples, "every layer muted");
}

/// The probed note must descend from [`SOURCE_HZ`] even though the layer that
/// renders it did not hear that note.
///
/// Three distinct wrong readings are named, because they are three different
/// defects and an assertion that describes only one of them invites a red to be
/// misread:
///
///  - **~83 Hz, ascending from [`STALE_NOTE`]** — the played pitch was never
///    recorded, either because the record is kept per layer or because it is
///    taken only when the note reaches a layer. This is also what a completely
///    unseeded origin produces, so it is a signature of "the origin did not
///    come from play history" rather than of this defect alone.
///  - **~261.63 Hz, a snap** — a record that is resolved *and* overwritten
///    inside the layer loop, so an earlier layer consumed it before the
///    measured one read it, leaving destination-equals-origin.
///  - **~440 Hz** — `Voice::new`'s construction seed, reachable only if
///    `note_on` stopped applying the origin it is handed.
fn assert_origin_survived_the_filter(samples: &[f32], case: &str) {
    let opening = opening_frequency(samples);
    assert!(
        (700.0..=SOURCE_HZ + 1.0).contains(&opening),
        "{case}: the layer that renders this note never heard {SOURCE_NOTE}, but \
         the player played it — so the glide must descend from {SOURCE_HZ:.2} Hz \
         and the opening window should read between 700 Hz and {SOURCE_HZ:.2} \
         Hz; measured {opening:.2} Hz.\n\
         \x20 ~83 Hz  = ascending from the stale slot: the played pitch was \
         never recorded (per-layer record, or a record taken only when the note \
         reaches a layer).\n\
         \x20 ~261.63 Hz = a snap: the record was resolved and overwritten \
         inside the layer loop, so an earlier layer consumed it.\n\
         \x20 ~440 Hz = Voice::new's seed: the origin handed to note_on was not \
         applied."
    );
    let interior = interior_frequency(samples);
    assert!(
        (PROBE_HZ + 20.0..opening - 20.0).contains(&interior),
        "{case}: and it must still be partway down 512 ms in — below its opening \
         {opening:.2} Hz and above its destination {PROBE_HZ:.2} Hz; measured \
         {interior:.2} Hz"
    );
}

/// The counterweight to the two snap tests above: they are satisfied by an
/// engine that has simply stopped gliding, and this is not that. With a history
/// to glide from, the render must differ from the same note with the glide off.
#[test]
fn a_note_with_history_still_glides() {
    let gliding = render_probe(History::Monophonic, GLIDE_SECONDS);
    let glide_off = render_probe(History::Monophonic, GLIDE_OFF);
    assert_ne!(
        gliding, glide_off,
        "a note played after another note must still glide, so its render must \
         differ from the same note with portamento off"
    );
}
