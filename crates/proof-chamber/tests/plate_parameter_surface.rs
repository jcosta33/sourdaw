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

/// Peak absolute sample-by-sample difference between two renders.
fn max_delta(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .fold(0.0_f32, |acc, (x, y)| acc.max((x - y).abs()))
}

/// Whether two renders are the same buffer, sample for sample.
fn identical(a: &[f32], b: &[f32]) -> bool {
    a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| x.to_bits() == y.to_bits())
}

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
    let off_tanh = render(&[("saturation", 0.0), ("decay", 0.9), ("saturation_type", 0.0)]);
    let off_clip = render(&[("saturation", 0.0), ("decay", 0.9), ("saturation_type", 2.0)]);
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
