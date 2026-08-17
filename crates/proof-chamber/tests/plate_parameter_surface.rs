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

/// Three cheap scalars of a render, pinned beside the digest and asserted
/// before it.
///
/// The digest is a good tripwire and a useless diagnosis. `digest 0x…` is three
/// opaque integers, identical whether the render moved by one sample of fine
/// structure, dropped 6 dB, went silent, or swapped its channels — and it is
/// the *only* thing that fires for a whole class of change. Whoever moves this
/// constant next has to work out which kind they caused, and the justification
/// written above it cites T60 from a 50 ms envelope, seven octave bands and a
/// lag-swept correlation, none of which any instrument in this repo produces.
/// The number regenerates in one command; the reasoning does not regenerate at
/// all.
///
/// So the scalars go next to it, and they are asserted first so their message
/// is the one that appears. A change that reds the digest while these hold *is*
/// the diagnosis — same level, same start, different fine structure, which is
/// what a retune looks like. A change that reds one of these names itself.
///
/// What they do not catch, stated so nobody reads more into them: a channel
/// swap (the stimulus is mono-summed and this render keeps the left channel
/// only), and any redistribution of energy that preserves peak, total RMS and
/// onset. The digest is still the thing that notices those.
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
/// Sized to pass the change that produced the current digests and to fail
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
         That is a level change, not a retune — the digest below would have \
         told you only that something moved.",
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
fn digest(output: &[f32]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for sample in output {
        hash ^= u64::from(sample.to_bits());
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// What the plate renders with nothing written to it but `algorithm` and
/// `mix`, which is what every project that never touched a control hears.
///
/// A `render(&[])`-versus-`render(&[(name, default)])` comparison — the shape
/// the three older rows in this file use — cannot pin this. Both sides of that
/// comparison run the *same* mapping, so it catches a default that drifts away
/// from the constructor and is blind to a mapping that is wrong at the default
/// in the same way on both sides. That blindness is not hypothetical: a
/// candidate `gravity` tilt neutral at 0 rather than at the shipped 0.5 passed
/// every other assertion in this file while quietly changing what every
/// existing project sounds like.
///
/// So the reference is a constant rather than a second render. Changing this
/// number is not a maintenance chore — it means an untouched project now
/// sounds different, and that belongs in a release note.
///
/// Changed once, by #1546: the constructor's `damping` moved from 0.0005 —
/// which is bypass, 0.0087 dB at Nyquist — to the 0.3 the panel knob had been
/// claiming all along. 0x9107_053e_5140_7165 → the value below, re-measured on
/// this file's stimulus in the same commit as the constructor edit. The
/// audible content of that move is measured in
/// `tests/plate_default_damping.rs`, not fingerprinted: 9.66 dB of 6-12 kHz
/// shed across the tail against 4.88 dB before.
///
/// The reach is newly added devices, not existing projects: `addDevice` writes
/// the descriptor's `damping` into `Device.parameterValues` and
/// `projectTrackToLiveStrip` replays every stored value on load, so a saved
/// project keeps whatever it was added with.
///
/// Moved a second time, by #1547, which corrected the same off-by-one in two
/// places: `DelayLine::read` now counts back from `write_pos - 1` instead of
/// `write_pos`, and `EarlyReflections::process` does the same. The fix is aimed
/// at Pre-Delay 0 ms, which used to render 503 ms of nothing; this row moves
/// because those two expressions serve every delay in the engine, so the input
/// path got two samples longer and the tank lines one. Dattorro's Table 2
/// positions are literal sample delays — `delay_48_54[266]` is 266 samples —
/// and the old expression delivered 265, so the fourteen output taps and the
/// six Schroeder allpasses now match the paper. Six reads still do not, by one
/// sample each, and `proof_chamber.rs`'s `read` says which and why.
/// 0x15ca_3842_cec5_5de2 → the value below.
///
/// Unlike #1546 this is *not* a voicing change, and the difference between the
/// two moves is the reason this comment is longer than the last one. A one-
/// sample retune of a recirculating tank scrambles the fine structure while
/// leaving everything measurable where it was. On the default plate, mix 1,
/// impulse, 3.0 s at 48 kHz, before against after:
///
/// * peak 0.699514031 → 0.699514031, identical to every digit f32 carries
/// * RMS -0.00013 dB (L), +0.00148 dB (R)
/// * T60 from a 50 ms envelope 1.450 s → 1.450 s
/// * seven octave bands from 20 Hz to 20 kHz, all within ±0.03 dB
/// * the 50 ms RMS envelope, across its whole audible span, within
///   +0.61/-0.56 dB with a mean of -0.02 dB
///
/// What moved is the waveform. Excluding sample 0 — which is the dry impulse
/// leaking through the 30 ms `mix` ramp and holds 54% of the buffer's energy,
/// so including it flatters every correlation figure — the zero-lag correlation
/// between the two renders is **0.029**. The best realigning lag in -12..+12 is
/// +2 samples, the two the input path gained, and even there it only holds in
/// the dense head: r = +0.60 over the first 50 ms (70% of the tail's energy),
/// +0.23 over the next 200 ms, and 0.00 everywhere past 250 ms, because the
/// tank's circulation period changed rather than its output being delayed.
///
/// That is what a fingerprint is for. An untouched project renders a different
/// tail with the same level, the same decay time and the same spectrum — worth
/// a release note for the Pre-Delay fix, not for this.
const UNTOUCHED_PLATE_DIGEST: u64 = 0x245952ca_4c990c89;

/// The same render, described in three numbers a human can read.
///
/// Regenerate these together with the digest above and never separately: they
/// are the same render, and a shape that disagrees with its digest means one of
/// the two was copied from a different run. See `RenderShape` for what each one
/// is for and what none of them can see.
///
/// `onset: 0` is measured, not a placeholder, and it is the weakest of the
/// three. Both this render and the sibling's are at `mix = 1`, and both measure
/// 0 anyway: `mix` is smoothed from its constructor 0.3 with a 30 ms one-pole,
/// so the dry burst is still most of the opening samples and the first sample
/// above 1e-6 is the first sample. Neither can therefore reproduce #1547's
/// shape — the dry path was never silent — and nothing here should be read as
/// covering it. What the scalar does catch is a render that stops sounding or
/// starts wholesale late. `wet_onset_follows_predelay.rs` is the file that
/// carries the #1547 shape, on a stimulus with the ramp pre-rolled away.
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
/// what an untouched plate renders, so it moves `UNTOUCHED_PLATE_DIGEST` and
/// `UNTOUCHED_PLATE_SHAPE` with it and belongs in a release note.
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
    //
    // This digest was taken from the plate *before* gravity read its field.
    let output = render(&[]);

    // Scalars first, so that when both fire it is the readable one that
    // reports. See `RenderShape`.
    assert_shape(
        &shape(&output),
        &UNTOUCHED_PLATE_SHAPE,
        "the untouched plate",
    );

    let digest_now = digest(&output);
    assert_eq!(
        digest_now, UNTOUCHED_PLATE_DIGEST,
        "the untouched plate changed: an existing project that never wrote a \
         control now renders differently. digest {digest_now:#x}. The three \
         scalars above held, so the level, the total energy and the start of \
         this render are all where they were — what moved is fine structure, \
         which is what a delay-length or coefficient retune looks like. If that \
         was the intent, re-measure and move this constant with the reasoning; \
         if it was not, the change is smaller than it looks and harder to see."
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
