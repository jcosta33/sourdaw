//! Does moving a plate control change what the plate renders?
//!
//! The plate is the Dutch Oven's *default* algorithm, and three of the
//! parameters it advertised were unreachable, inert, or both:
//!
//! * `early_late` — the panel sent it, `PARAM_MAP` translated it, it arrived
//!   in Rust intact, and `ProofChamber::set_param` dropped it through `_ =>
//!   {}`. The knob moved on the default engine and nothing happened.
//! * `saturation_type` — three curves implemented, advertised in
//!   `param_names`, absent from the descriptor and from `PARAM_MAP`. Every
//!   project has heard curve 0 since the engine shipped.
//! * `density` — implemented, advertised, declared in the descriptor and
//!   automatable, with no entry in `PARAM_MAP` and no field in
//!   `ProofChamberEngineState`, so nothing could write it.
//!
//! Per ADR 0015 the load-bearing assertion is an offline render **delta**: two
//! parameter values, one stimulus, and a measured difference in the samples
//! that come out. A test that only checked `set_param` was accepted would have
//! passed against every one of the three defects, because `_ => {}` accepts
//! everything.
//!
//! Two blindness shapes are covered explicitly:
//!
//! * **Interior points.** Each control is driven at interior settings, not
//!   only at 0 and 1, so wiring that reacts to the extremes alone still reds.
//! * **The shipped default.** Every control is also rendered on an engine
//!   nobody wrote to, and compared against the same control set explicitly to
//!   its documented default. A default that drifts away from the constructor
//!   changes what an untouched project sounds like without any test noticing,
//!   which is the hole #1411's M8 found.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const PLATE: f32 = 0.0;

/// A short loud burst followed by silence: the burst excites the early
/// reflections, and the silence that follows is where only the tank can still
/// be ringing. Loud enough (0.9) that the saturation curves are driven past
/// the region where all three are approximately linear and therefore
/// approximately equal — a quiet stimulus is a fixed point of the broken
/// behaviour, since every curve passes small signals through unchanged.
const BURST_LEN: usize = 4_000;
const BURST_HZ: f32 = 220.0;
const BURST_AMP: f32 = 0.9;

/// Long enough that the tail window sits far past the end of the early
/// reflections, whose last tap is 67 ms (~3 216 samples) and which have no
/// feedback path at all.
const RENDER_FRAMES: usize = 96_000;

/// The window where "late" is the only thing that can still be sounding:
/// 0.5 s to 1.0 s after the burst ends.
const TAIL_START: usize = BURST_LEN + 24_000;
const TAIL_END: usize = BURST_LEN + 48_000;

/// The window that holds the early reflections and nothing but: the first
/// 100 ms, which is the whole span of the tapped delay line.
const EARLY_END: usize = 4_800;

fn stimulus(index: usize) -> f32 {
    if index >= BURST_LEN {
        return 0.0;
    }
    let phase = index as f32 / SAMPLE_RATE * BURST_HZ * std::f32::consts::TAU;
    BURST_AMP * phase.sin()
}

/// A parameter write applied before rendering.
type Write = (&'static str, f32);

/// Render the burst through the plate with `writes` applied, at `mix = 1.0` so
/// the measurement is the engine's wet output and not the dry signal passing
/// through it.
fn render(writes: &[Write]) -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", PLATE);
    instance.set_param("mix", 1.0);
    for &(name, value) in writes {
        instance.set_param(name, value);
    }

    let mut output = Vec::with_capacity(RENDER_FRAMES);
    let mut index = 0;
    while index < RENDER_FRAMES {
        let left: Vec<f32> = (0..BLOCK).map(|i| stimulus(index + i)).collect();
        let right = left.clone();
        let ptr = instance.process(&left, &right, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for i in 0..BLOCK {
            output.push(unsafe { *ptr.add(i) });
        }
        index += BLOCK;
    }

    for (i, sample) in output.iter().enumerate() {
        assert!(
            sample.is_finite(),
            "non-finite output sample at {i}: {sample}"
        );
    }
    output
}

fn rms(window: &[f32]) -> f32 {
    if window.is_empty() {
        return 0.0;
    }
    let sum: f64 = window.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
    (sum / window.len() as f64).sqrt() as f32
}

fn tail_rms(output: &[f32]) -> f32 {
    rms(&output[TAIL_START..TAIL_END.min(output.len())])
}

fn early_rms(output: &[f32]) -> f32 {
    rms(&output[..EARLY_END.min(output.len())])
}

/// Three cheap scalars of a render, asserted against pinned constants.
///
/// They are the absolute pin, and they are all of it: a last-bit difference in
/// a transcendental — the thing one libm build does and the next does not —
/// is orders of magnitude below a level change worth shipping, so peak and
/// RMS hold inside the tolerances below on any platform. A bit-pattern digest
/// of the same render does not, which is why this file no longer pins one
/// (`daw-dsp`'s `dsp_cost_reduction_goldens` module doc is the finding).
///
/// What a digest is still for, and all it is for: comparing two renders of
/// one process, where both sides share a libm and equality means
/// bit-exactness.
///
/// What nothing catches any more, stated so nobody reads more into the
/// scalars: a channel swap (the stimulus is mono-summed and this render keeps
/// the left channel only), and any redistribution of energy that preserves
/// peak, total RMS and onset. Same-run digest comparisons notice those
/// between two renders of one process; nothing notices them against history,
/// because history cannot be fingerprinted across libm builds.
struct RenderShape {
    peak: f32,
    rms: f32,
    onset: usize,
}

/// Index of the first sample above 1e-6.
///
/// Absolute rather than relative to the peak, so that a level change moves the
/// RMS scalar and not this one and the two failures stay separable. See
/// `UNTOUCHED_PLATE_SHAPE` for what this one can actually see on this stimulus,
/// which is less than its name suggests.
fn shape(output: &[f32]) -> RenderShape {
    let peak = output.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
    let rms = (output.iter().map(|s| s * s).sum::<f32>() / output.len() as f32).sqrt();
    let onset = output
        .iter()
        .position(|s| s.abs() > 1e-6)
        .unwrap_or(output.len());
    RenderShape { peak, rms, onset }
}

/// Level tolerance, in dB, for the two amplitude scalars.
///
/// Sized to pass a retune and to fail
/// anything a listener would call a level change. #1547's one-to-two-sample
/// retune moved peak by 0.00000 dB and RMS by 0.00013 dB on this render; 0.1 dB
/// is nearly three orders of magnitude above that and an order of magnitude
/// below the smallest level move anyone would ship deliberately.
const SHAPE_LEVEL_TOLERANCE_DB: f32 = 0.1;

/// Onset tolerance, in samples. A retune of the input path may move the first
/// audible sample by a sample or two; a pre-delay or scheduling defect moves it
/// by thousands.
const SHAPE_ONSET_TOLERANCE: usize = 4;

fn assert_shape(actual: &RenderShape, expected: &RenderShape, label: &str) {
    let peak_db = 20.0 * (actual.peak / expected.peak).log10();
    assert!(
        peak_db.abs() < SHAPE_LEVEL_TOLERANCE_DB,
        "{label}: peak moved {peak_db:+.4} dB ({:e} against the pinned {:e}). \
         That is a level change, not a retune.",
        actual.peak,
        expected.peak
    );

    let rms_db = 20.0 * (actual.rms / expected.rms).log10();
    assert!(
        rms_db.abs() < SHAPE_LEVEL_TOLERANCE_DB,
        "{label}: full-buffer RMS moved {rms_db:+.4} dB ({:e} against the pinned \
         {:e}). The render is louder or quieter overall, or part of it has gone \
         missing.",
        actual.rms,
        expected.rms
    );

    assert!(
        actual.onset.abs_diff(expected.onset) <= SHAPE_ONSET_TOLERANCE,
        "{label}: the first sample above 1e-6 moved from {} to {}, a shift of \
         {} samples. The render starts somewhere else, or has stopped sounding \
         altogether.",
        expected.onset,
        actual.onset,
        actual.onset.abs_diff(expected.onset)
    );
}

/// Peak absolute sample-by-sample difference between two renders.
fn max_delta(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .fold(0.0_f32, |acc, (x, y)| acc.max((x - y).abs()))
}

/// Whether two renders are the same buffer, sample for sample.
fn identical(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b.iter())
            .all(|(x, y)| x.to_bits() == y.to_bits())
}

/// FNV-1a over every sample's bit pattern, so any change anywhere in the
/// buffer moves it.
///
/// Only ever compared against another digest from the same process. Both
/// renders then share one libm, so equality is bit-exactness. A captured
/// *absolute* digest of this engine drifts across libm builds — see
/// `UNTOUCHED_PLATE_SHAPE`'s doc and `daw-dsp`'s
/// `dsp_cost_reduction_goldens` module doc.
fn digest(output: &[f32]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for sample in output {
        hash ^= u64::from(sample.to_bits());
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// What the plate renders with nothing written to it but `algorithm` and
/// `mix` — what every project that never touched a control hears — in three
/// readable numbers. Measured on `main` at d36441d4f and unchanged since.
///
/// These scalars, not a digest, are the absolute pin, and the reason is the
/// same as in `algorithm_switch_parameter_retention.rs`: the engine's f32
/// transcendentals round differently across libm builds — even between two
/// Linux machines — so a captured bit-pattern fingerprint of this render
/// cannot hold on a hosted runner, while peak and RMS inside the 0.1 dB
/// tolerances can. `daw-dsp`'s `dsp_cost_reduction_goldens` module doc records
/// the same finding, and the same same-run replacement, on another engine.
///
/// The fingerprint this file kept here until that finding moved twice, and
/// both moves are part of the protection, so they are recorded rather than
/// dropped:
///
/// * #1546 moved the constructor's `damping` from 0.0005 — bypass, 0.0087 dB
///   at Nyquist — to the 0.3 the panel knob had been claiming. A deliberate
///   voicing change: 9.66 dB of 6-12 kHz shed across the tail against 4.88 dB
///   before, measured in `tests/plate_default_damping.rs`, which pins that
///   behaviour directly. The reach is newly added devices only — `addDevice`
///   writes the descriptor's `damping` into `Device.parameterValues` and
///   `projectTrackToLiveStrip` replays every stored value on load, so a saved
///   project keeps what it was added with.
/// * #1547 corrected the same off-by-one in `DelayLine::read` and
///   `EarlyReflections::process`, which serve every delay in the engine. It
///   moved the fingerprint without moving the sound: peak identical, RMS
///   within 0.0015 dB, T60 identical, every octave band within 0.03 dB, and a
///   waveform that decorrelated past the first 250 ms — the tank's
///   circulation period changed, not its output level. That is exactly the
///   move a level pin cannot see, and the reason the one-sample class is now
///   pinned by behaviour instead: `wet_onset_follows_predelay.rs` for the
///   shape, and the onset rows — this file's and
///   `algorithm_switch_parameter_retention.rs`'s — for the exact sample.
///
/// `onset: 0` is measured, not a placeholder, and it is the weakest of the
/// three. This render is at `mix = 1` and measures 0 anyway: `mix` is
/// smoothed from its constructor 0.3 with a 30 ms one-pole, so the dry burst
/// is still most of the opening samples and the first sample above 1e-6 is
/// the first sample. It cannot therefore reproduce #1547's shape — the dry
/// path was never silent — and nothing here should be read as covering it.
/// What the scalar does catch is a render that stops sounding or starts
/// wholesale late; the exact wet onset is pinned, on a stimulus with the ramp
/// pre-rolled away, by
/// `wet_onset_is_exactly_the_default_predelay_plus_the_first_tap` below.
const UNTOUCHED_PLATE_SHAPE: RenderShape = RenderShape {
    peak: 8.290293e-1,
    rms: 1.0719928e-1,
    onset: 0,
};

// ---------------------------------------------------------------------------
// early_late
// ---------------------------------------------------------------------------

#[test]
fn early_late_moves_energy_from_the_tank_into_the_reflections() {
    let all_early = render(&[("early_late", 0.0)]);
    let all_late = render(&[("early_late", 1.0)]);

    // The reflections have no feedback path, so with the tank blended out
    // there is nothing left ringing half a second after the burst stops.
    let early_tail = tail_rms(&all_early);
    let late_tail = tail_rms(&all_late);
    assert!(
        late_tail > early_tail * 20.0,
        "the tank should dominate the half-second-late tail: \
         early_late=0 tail RMS {early_tail:e}, early_late=1 tail RMS {late_tail:e}"
    );

    // And the converse in the first 100 ms, where the reflections live.
    let early_head = early_rms(&all_early);
    let late_head = early_rms(&all_late);
    assert!(
        early_head > late_head * 2.0,
        "the reflections should dominate the first 100 ms: \
         early_late=0 head RMS {early_head:e}, early_late=1 head RMS {late_head:e}"
    );
}

#[test]
fn early_late_is_monotone_across_its_interior() {
    // Interior settings only — wiring that reacts to 0 and 1 alone still reds.
    let mut previous = tail_rms(&render(&[("early_late", 0.2)]));
    for step in [0.4_f32, 0.6, 0.8] {
        let current = tail_rms(&render(&[("early_late", step)]));
        assert!(
            current > previous * 1.15,
            "tail energy should rise with early_late; at {step} it was {current:e} \
             against {previous:e} at the step below"
        );
        previous = current;
    }
}

#[test]
fn early_late_defaults_to_the_documented_value() {
    let untouched = render(&[]);
    let explicit = render(&[("early_late", 0.4)]);
    assert!(
        identical(&untouched, &explicit),
        "an engine nobody wrote to should render as early_late=0.4; \
         peak difference {:e}",
        max_delta(&untouched, &explicit)
    );

    // And the default is not accidentally one of the extremes, which would
    // make the guard above pass while telling us nothing.
    let extreme = render(&[("early_late", 1.0)]);
    assert!(
        !identical(&untouched, &extreme),
        "the shipped default renders identically to early_late=1.0"
    );
}

// ---------------------------------------------------------------------------
// saturation_type
// ---------------------------------------------------------------------------

/// Saturation on, and hard enough into the tank that the curves separate.
const SATURATING: [Write; 2] = [("saturation", 1.0), ("decay", 0.9)];

fn render_with_curve(curve: f32) -> Vec<f32> {
    let mut writes = SATURATING.to_vec();
    writes.push(("saturation_type", curve));
    render(&writes)
}

#[test]
fn every_saturation_curve_renders_differently() {
    let tanh = render_with_curve(0.0);
    let chebyshev = render_with_curve(1.0);
    let hard_clip = render_with_curve(2.0);

    // All three pairs, not just curve 0 against the rest: the arm reads
    // `(value as u8).min(2)`, so a wire that saturated at 1 would leave 1 and
    // 2 identical while 0 still differed.
    for (left, right, names) in [
        (&tanh, &chebyshev, "tanh vs chebyshev"),
        (&chebyshev, &hard_clip, "chebyshev vs hard clip"),
        (&tanh, &hard_clip, "tanh vs hard clip"),
    ] {
        let delta = max_delta(left, right);
        assert!(
            delta > 1e-4,
            "{names} should render differently; peak difference {delta:e}"
        );
    }
}

#[test]
fn saturation_curve_does_nothing_while_saturation_is_off() {
    // The curve is selected inside a branch the Saturation switch gates. A
    // wire that applied the curve unconditionally would change the sound of
    // every project that never turned saturation on.
    let off_tanh = render(&[
        ("saturation", 0.0),
        ("decay", 0.9),
        ("saturation_type", 0.0),
    ]);
    let off_clip = render(&[
        ("saturation", 0.0),
        ("decay", 0.9),
        ("saturation_type", 2.0),
    ]);
    assert!(
        identical(&off_tanh, &off_clip),
        "saturation_type moved the output with saturation disabled; \
         peak difference {:e}",
        max_delta(&off_tanh, &off_clip)
    );
}

#[test]
fn saturation_curve_defaults_to_tanh() {
    let untouched = render(&SATURATING);
    let explicit = render_with_curve(0.0);
    assert!(
        identical(&untouched, &explicit),
        "an engine nobody wrote a curve to should render as curve 0; \
         peak difference {:e}",
        max_delta(&untouched, &explicit)
    );
}

// ---------------------------------------------------------------------------
// density
// ---------------------------------------------------------------------------

#[test]
fn density_renders_differently_at_interior_settings() {
    // 0.25 / 0.5 / 0.75 rather than 0 and 1: the arm scales a gain linearly,
    // and the extremes alone would not distinguish that from a switch.
    let sparse = render(&[("density", 0.25)]);
    let middle = render(&[("density", 0.5)]);
    let dense = render(&[("density", 0.75)]);

    for (left, right, names) in [
        (&sparse, &middle, "0.25 vs 0.50"),
        (&middle, &dense, "0.50 vs 0.75"),
    ] {
        let delta = max_delta(left, right);
        assert!(
            delta > 1e-4,
            "density {names} should render differently; peak difference {delta:e}"
        );
    }
}

#[test]
fn density_defaults_to_full_cross_coupling() {
    let untouched = render(&[]);
    let explicit = render(&[("density", 1.0)]);
    assert!(
        identical(&untouched, &explicit),
        "an engine nobody wrote to should render as density=1.0, the value the \
         constructor's -0.70 allpass gains encode; peak difference {:e}",
        max_delta(&untouched, &explicit)
    );

    let sparse = render(&[("density", 0.0)]);
    assert!(
        !identical(&untouched, &sparse),
        "the shipped default renders identically to density=0.0"
    );
}

// ---------------------------------------------------------------------------
// size
// ---------------------------------------------------------------------------

#[test]
fn size_renders_differently_at_interior_settings() {
    // Size reaches one thing on this engine — the early-reflection spacing, via
    // `EarlyReflections::update_room_size` — because the tank delays are fixed
    // at Dattorro's Table 1 lengths and do not scale. That makes the render
    // delta the only evidence that the control does anything at all, and it is
    // measured at interior points for the same reason every other row here is:
    // wiring that reacts only at 0 and 1 is not a room-size control.
    let small = render(&[("size", 0.25)]);
    let middle = render(&[("size", 0.5)]);
    let large = render(&[("size", 0.75)]);

    for (left, right, names) in [
        (&small, &middle, "0.25 vs 0.50"),
        (&middle, &large, "0.50 vs 0.75"),
    ] {
        let delta = max_delta(left, right);
        assert!(
            delta > 1e-4,
            "size {names} should render differently; peak difference {delta:e}"
        );
    }
}

/// The default row for Size, in the shape every other control in this file
/// uses: an engine nobody wrote to must render as the engine's own documented
/// default.
///
/// # Why this test is `#[ignore]`d
///
/// It is red against the shipped engine, and it is red because the plate seeds
/// its two copies of the room size from different numbers.
/// `ProofChamber::new` stores `size: 0.75` in the field
/// (`src/proof_chamber.rs:550`) and builds its reflection network with
/// `EarlyReflections::new(sample_rate, 0.5)` (`:614`). Nothing reconciles them:
/// `update_room_size` only runs from the `"size"` arm, so an untouched plate
/// renders a 0.5 room while reporting a 0.75 one.
///
/// What that costs is not abstract. Writing Size the value the engine already
/// claims to be at moves the render by 0.856 peak on this stimulus — an
/// automation lane that writes its own default at frame 0, a preset that stores
/// it, or a project reload that replays `parameterValues` all change what the
/// user was hearing, and each one is a different sound from the last.
///
/// Un-ignore this when the constructor seeds `EarlyReflections` from the field
/// it also stores. Note the direction of that fix: seeding from 0.75 changes
/// what an untouched plate renders, so it moves `UNTOUCHED_PLATE_SHAPE` and
/// the onset row's 876 (tap 0 becomes 222) with it and belongs in a release
/// note.
#[test]
#[ignore = "pins the plate's split Size default — the field is seeded 0.75 (src/proof_chamber.rs:550) while EarlyReflections is built at 0.5 (:614), so an untouched plate renders a room it does not report. Red until the plate Size default lane lands."]
fn size_defaults_to_the_documented_value() {
    let untouched = render(&[]);
    let explicit = render(&[("size", 0.75)]);
    assert!(
        identical(&untouched, &explicit),
        "an engine nobody wrote to should render as size=0.75, the value the constructor \
         stores in the field; peak difference {:e}",
        max_delta(&untouched, &explicit)
    );

    let half = render(&[("size", 0.5)]);
    assert!(
        !identical(&untouched, &half),
        "the shipped default renders identically to size=0.5, which is what the constructor \
         hands `EarlyReflections` rather than what it stores"
    );
}

// ---------------------------------------------------------------------------
// gravity
// ---------------------------------------------------------------------------

#[test]
fn gravity_renders_differently_at_interior_settings() {
    // The row that made this file's whole premise necessary. `gravity` had a
    // `set_param` arm, was clamped and stored in a field, was advertised by
    // `param_names`, was declared in the descriptor and was automatable — and
    // the field was never read, so `max_delta(-1, +1)` was exactly 0e0 across
    // the entire declared range. Every acceptance-shaped check in the repo
    // passed against it, including the descriptor/engine census, which defines
    // a gap as a missing match arm and therefore could not see this one.
    //
    // Interior points rather than only the bounds, and points on both sides of
    // the 0.5 default, so a tilt that only reacted at the extremes or only in
    // one direction still reds.
    let swell = render(&[("gravity", -0.5)]);
    let low = render(&[("gravity", 0.0)]);
    let default_side = render(&[("gravity", 0.5)]);
    let normal = render(&[("gravity", 1.0)]);

    for (left, right, names) in [
        (&swell, &low, "-0.50 vs 0.00"),
        (&low, &default_side, "0.00 vs 0.50"),
        (&default_side, &normal, "0.50 vs 1.00"),
    ] {
        let delta = max_delta(left, right);
        assert!(
            delta > 1e-4,
            "gravity {names} should render differently; peak difference {delta:e}"
        );
    }
}

#[test]
fn gravity_spans_the_whole_declared_range() {
    // The measurement the reviewer of #1519 ran to prove the parameter was
    // dead, kept as the regression: end to end across the descriptor's
    // declared -1…+1, the two extremes must not render the same buffer.
    let bottom = render(&[("gravity", -1.0)]);
    let top = render(&[("gravity", 1.0)]);
    let delta = max_delta(&bottom, &top);

    assert!(
        delta > 1e-3,
        "gravity -1 and +1 should be audibly different; peak difference {delta:e}"
    );
}

#[test]
fn gravity_defaults_to_the_documented_value() {
    // The constraint that keeps this fix from changing what every existing
    // project sounds like. The tilt is exactly 1.0 at 0.5, so an engine nobody
    // wrote to must render bit-identically to one written to its default —
    // and, before this parameter did anything, to what the plate has always
    // rendered.
    let untouched = render(&[]);
    let explicit = render(&[("gravity", 0.5)]);
    assert!(
        identical(&untouched, &explicit),
        "an engine nobody wrote to should render as gravity=0.5; peak difference {:e}",
        max_delta(&untouched, &explicit)
    );

    let swell = render(&[("gravity", -1.0)]);
    assert!(
        !identical(&untouched, &swell),
        "the shipped default renders identically to gravity=-1.0"
    );
}

#[test]
fn the_untouched_plate_still_renders_what_it_always_has() {
    // The claim `gravity` had to satisfy to be implementable at all: the tilt
    // is exactly 1.0 at the shipped default, so wiring a parameter that was
    // inert does not move a single sample of any project that never wrote it.
    let output = render(&[]);

    // Scalars first, so the readable failure is the one that reports. They
    // are the only absolute pin left: they hold on every libm, where a
    // captured fingerprint does not. See `UNTOUCHED_PLATE_SHAPE` for what
    // moved them historically and where each of those protections went.
    assert_shape(
        &shape(&output),
        &UNTOUCHED_PLATE_SHAPE,
        "the untouched plate",
    );

    // Determinism witness. The same script rendered twice in one process
    // must agree bit for bit, or every same-run comparison in this file —
    // including the `identical` rows below — is measuring noise rather than
    // a mapping.
    let again = render(&[]);
    assert_eq!(
        digest(&output),
        digest(&again),
        "the untouched plate rendered twice in one process produced \
         different fine structure"
    );

    // The same-run pins of the default mapping are the per-control rows in
    // this file (`early_late_defaults_to_the_documented_value`,
    // `density_defaults_to_full_cross_coupling`,
    // `gravity_defaults_to_the_documented_value`,
    // `saturation_curve_defaults_to_tanh`), each asserting `identical` —
    // bit-exact — between this render and the documented default written
    // explicitly. What none of those can catch, and what the removed
    // absolute fingerprint existed to catch, is a mapping wrong at the
    // default in the same way on both sides of every comparison: the
    // `gravity` tilt neutral at 0 is the recorded candidate, and it passed
    // every one of those rows. That hole is now covered only insofar as such
    // a change moves level or onset; a cross-platform fine-structure
    // fingerprint does not exist to be kept, which is the finding
    // `dsp_cost_reduction_goldens.rs` in `daw-dsp` records.
}

// ---------------------------------------------------------------------------
// The #1547 protection the removed fingerprint used to carry
// ---------------------------------------------------------------------------

/// Silent blocks rendered before the burst in the onset row below. The mix
/// ramp has to settle or the dry burst masks the wet onset — which is exactly
/// why `UNTOUCHED_PLATE_SHAPE.onset` measures 0 above. Same figure and same
/// argument as `wet_onset_follows_predelay.rs`'s `PREROLL_BLOCKS`; the
/// instrument is a copy of the one `algorithm_switch_parameter_retention.rs`
/// added, duplicated because Rust integration tests are separate crates.
const WET_ONSET_PREROLL_BLOCKS: usize = 400;

/// Length and level of the burst the onset row excites the engine with.
///
/// DC rather than this file's 220 Hz sine: the sine's first sample is zero,
/// which would put the measured onset one sample after the tap's own — a real
/// offset, but a trap in a row whose whole point is naming the sample the tap
/// delivers. DC puts full amplitude in the first sample, so the onset names
/// the tap and nothing else.
const WET_ONSET_BURST: usize = 512;
const WET_ONSET_BURST_LEVEL: f32 = 0.8;

/// Fraction of the render's own peak that counts as sounding, so a quiet
/// render is measured on its own terms. The first early-reflection sample
/// sits orders of magnitude above it, so nothing is near the threshold and
/// libm cannot move the crossing.
const WET_ONSET_FLOOR_FRACTION: f32 = 1e-3;

/// Frames rendered after the pre-roll. One second.
const WET_ONSET_FRAMES: usize = 48_000;

/// The untouched plate — `algorithm` and `mix`, nothing else — pre-rolled
/// silent, then excited with the DC burst. Returns only the post-pre-roll
/// frames, so an onset index into the result counts from the first burst
/// sample.
fn render_wet_onset() -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", PLATE);
    instance.set_param("mix", 1.0);

    let silence = [0.0_f32; BLOCK];
    for _ in 0..WET_ONSET_PREROLL_BLOCKS {
        instance.process(&silence, &silence, BLOCK as u32);
    }

    let mut output = Vec::with_capacity(WET_ONSET_FRAMES);
    let mut index = 0;
    while index < WET_ONSET_FRAMES {
        let left: Vec<f32> = (0..BLOCK)
            .map(|i| {
                if index + i < WET_ONSET_BURST {
                    WET_ONSET_BURST_LEVEL
                } else {
                    0.0
                }
            })
            .collect();
        let right = left.clone();
        let ptr = instance.process(&left, &right, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for i in 0..BLOCK {
            output.push(unsafe { *ptr.add(i) });
        }
        index += BLOCK;
    }
    output
}

/// The untouched plate's wet onset, exactly, in samples.
///
/// #1547's off-by-one — delay reads counting back from the slot *after* the
/// most recently written one, in both `DelayLine::read` and
/// `EarlyReflections::process` — moved this file's old fingerprint and
/// nothing else measurable: identical peak, RMS within 0.0015 dB, identical
/// T60, every octave band within 0.03 dB. Behaviour is what can be pinned
/// across platforms, so this row pins the untouched plate's wet onset
/// exactly: the constructor's 15 ms pre-delay, which no script in this file
/// ever writes — 720 samples — plus tap 0 of the early reflections, 156
/// samples at the room size the constructor hands them (0.5; see the
/// `#[ignore]`d Size row above for why that is not the 0.75 the field
/// stores). 720 + 156 = 876. Nothing else in the wet path is shorter: the
/// tank's first possible contribution is four input diffusers plus a
/// modulated allpass, 905 samples minimum, later.
///
/// Sample counts, not bit fingerprints: the index depends only on integer
/// delay arithmetic and on buffer slots that are exactly zero, so no libm
/// moves it — while the defect it watches moves it by a whole sample (either
/// copy of the off-by-one) or, in the Pre-Delay-0 shape
/// (`wet_onset_follows_predelay.rs`), by 24 000.
/// `algorithm_switch_parameter_retention.rs` pins the written-predelay path
/// exactly at 0 and 10 ms; this row pins the constructor's own 720, which no
/// write ever touches. When the Size split is fixed and the reflections are
/// seeded from the stored field, tap 0 becomes 222 and this row moves with
/// it — re-measure in that commit; the protocol works on any platform,
/// which is why this row replaced a digest.
#[test]
fn wet_onset_is_exactly_the_default_predelay_plus_the_first_tap() {
    let output = render_wet_onset();

    let peak = output.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
    assert!(
        peak > 1e-3,
        "the untouched plate rendered nothing (peak {:e}); the onset \
         measurement below would pass on silence",
        peak
    );

    let floor = peak * WET_ONSET_FLOOR_FRACTION;
    let onset = output
        .iter()
        .position(|s| s.abs() > floor)
        .unwrap_or(output.len());
    assert_eq!(
        onset, 876,
        "the untouched plate's wet output starts at sample {onset}, not 876 \
         (the constructor's 720 samples of pre-delay plus the first \
         reflection's 156). One sample early is #1547 alive again in \
         `EarlyReflections::process` or `DelayLine::read`; a wholesale late \
         start is the pre-delay wired to the wrong end of its buffer. If a \
         retune moved the taps — the Size split fix will — re-measure: \
         sample counts hold on every platform, which is why this row is \
         here instead of a digest."
    );
}

#[test]
fn gravity_leaves_the_tank_stable_at_both_extremes() {
    // The tilt scales a feedback allpass coefficient, so the failure mode of
    // getting the span wrong is a tank that rings instead of decaying rather
    // than a wrong-sounding one. Both extremes must still be decaying half a
    // second after the burst ends.
    for setting in [-1.0_f32, 1.0] {
        let output = render(&[("gravity", setting)]);
        let early = early_rms(&output);
        let tail = tail_rms(&output);
        assert!(
            tail < early,
            "gravity {setting} should still decay; early RMS {early:e}, tail RMS {tail:e}"
        );
    }
}

// ---------------------------------------------------------------------------
// Advertised surface
// ---------------------------------------------------------------------------

#[test]
fn the_plate_advertises_every_parameter_it_now_answers_to() {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", PLATE);
    let advertised = instance.get_param_names();

    for name in ["early_late", "saturation_type", "density"] {
        assert!(
            advertised.contains(&format!("\"{name}\"")),
            "the plate answers to {name} but does not advertise it: {advertised}"
        );
    }
}
