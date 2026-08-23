//! Does a Dutch Oven still sound like itself after the algorithm changes?
//!
//! `ProofChamberInstance::set_param("algorithm", n)` replaces `self.engine`
//! with a freshly constructed one. Before the parameter cache, it replayed
//! nothing into it, so every parameter the user had set was discarded on every
//! algorithm change: a round-tripped plate rendered `max_delta 0e0` against an
//! engine that had been told nothing at all — bit-identical to factory-fresh.
//! `mix` went the same way.
//!
//! Per ADR 0015 the load-bearing assertion here is an **output measurement**,
//! and it is one from the first row rather than a later hardening pass. The
//! obvious alternative — assert that `set_param` was called once per cached
//! name after a switch — would have been sensitive to the cache code and blind
//! to the thing that matters, which is whether the samples come back. #1519
//! produced two findings of exactly that shape: assertions that were rigorous
//! about an array which was thrown away one call later. A green-to-red
//! mutation table proves a guard is sensitive to the code it watches; it says
//! nothing about whether it watches the layer where the behaviour lives.
//!
//! Every row compares two renders that differ **only** in whether an algorithm
//! round trip happened. Both instances are fresh and neither has processed a
//! sample before the switch, so no delay-line state is in play and the only
//! thing the comparison can be measuring is retained parameter state.
//!
//! Blindness shapes covered explicitly:
//!
//! * **Interior points.** Every value below is set away from both ends of its
//!   declared range, so a replay that only survived the extremes still reds.
//! * **Per engine.** A cache that replays into the plate and not the spring is
//!   this campaign's recurring shape, so each exposed algorithm gets its own
//!   round trip rather than trusting one representative.
//! * **Non-vacuity.** Every retention row also asserts that the parameters it
//!   writes actually move that engine's output, so a row cannot pass by
//!   comparing two identical silences.
//! * **A parameter the intermediate engine drops.** The case that decides
//!   whether caching *every* forwarded name was right, rather than only the
//!   ones the current engine reads.
//! * **First construction.** An instance told nothing must match the first
//!   explicit selection bit for bit and retain its platform-independent shape.
//! * **The documented exception.** One sequence genuinely does not round-trip
//!   — the plate latches `shimmer` off inside its `freeze` arm, and a value
//!   cache cannot re-fire a latch whose trigger has since been overwritten. It
//!   is pinned as a known non-zero delta so it cannot widen, and so that
//!   fixing the plate reds a test rather than passing unnoticed.
//! * **The second construction site.** `select_unexposed_engine` builds an
//!   engine the same way the wire path does. Every other caller in the crate
//!   selects before writing anything, so its replay would otherwise be live
//!   code no test can see.

use proof_chamber::{ProofChamberInstance, UnexposedEngine};

#[path = "support/plate_fine_structure.rs"]
mod plate_fine_structure;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

const PLATE: f32 = 0.0;
const FDN8: f32 = 1.0;
const FDN16: f32 = 2.0;
const SPRING: f32 = 3.0;
const REVERSE: f32 = 6.0;

/// Every algorithm a stored wire value can select.
const EXPOSED: [(&str, f32); 5] = [
    ("plate", PLATE),
    ("fdn8", FDN8),
    ("fdn16", FDN16),
    ("spring", SPRING),
    ("reverse", REVERSE),
];

/// A burst followed by silence: the burst excites early reflections and the
/// reverse engine's capture buffer, and the silence after it is where only
/// retained decay state can still be sounding.
const BURST_LEN: usize = 4_000;
const BURST_HZ: f32 = 220.0;
const BURST_AMP: f32 = 0.9;
const RENDER_FRAMES: usize = 48_000;

/// `PARAMETER_CACHE_CAPACITY` in `lib.rs`, which is private. Duplicated rather
/// than exported: the capacity is an implementation bound, not a contract, and
/// the row that uses it only needs *a* number that fills the cache. If the two
/// drift apart the row still fills it, provided this one is not smaller.
const PARAMETER_CACHE_LIMIT: usize = 64;

/// One `set_param` call. Scripts include `algorithm` writes, because the
/// switch is itself a `set_param` and nothing about the sequence should be
/// modelled differently from how a writer actually reaches the instance.
type Step = (&'static str, f32);

/// Parameters set away from their defaults and away from both ends of their
/// declared ranges. The list spans all five exposed engines: any single engine
/// reads a subset and drops the rest, which is the point — a name one engine
/// drops must still be replayed, or switching *to* the engine that reads it
/// loses it.
const INTERIOR_WRITES: &[Step] = &[
    ("mix", 0.83),
    ("decay", 0.62),
    ("damping", 0.41),
    ("size", 0.37),
    ("predelay", 23.0),
    ("mod_depth", 0.28),
    ("mod_rate", 1.7),
    ("diffusion", 0.72),
    ("early_late", 0.66),
    ("width", 1.35),
    ("high_cut", 6_800.0),
    ("low_cut", 180.0),
    ("gravity", 0.85),
    ("density", 0.41),
    // The FDN constructs with the Hadamard matrix on, so 0.0 flips it.
    ("matrix", 0.0),
    ("saturation", 1.0),
    ("saturation_type", 2.0),
    ("shimmer", 1.0),
    ("shimmer_amount", 0.55),
    ("shimmer_pitch", 0.8),
];

fn stimulus(index: usize) -> f32 {
    if index >= BURST_LEN {
        return 0.0;
    }
    let phase = index as f32 / SAMPLE_RATE * BURST_HZ * std::f32::consts::TAU;
    BURST_AMP * phase.sin()
}

/// Apply `script` in order to a fresh instance, then render the burst.
fn render(script: &[Step]) -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    for &(name, value) in script {
        instance.set_param(name, value);
    }
    render_instance(&mut instance)
}

/// Render the burst through an instance that has already been set up. Split
/// out for the one row that reaches its engine through `select_unexposed_
/// engine`, which no `Step` can express because it is not on the wire.
fn render_instance(instance: &mut ProofChamberInstance) -> Vec<f32> {
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

/// Three platform-independent scalars of a render.
///
/// Same instrument as `plate_parameter_surface.rs`'s, duplicated because Rust
/// integration tests are separate crates and this is four lines of arithmetic;
/// the reasoning for their tolerances is written out there and not repeated.
///
/// `onset` is the weakest of the three and is documented as such rather than
/// quietly relied on. Even at `mix = 1` the 30 ms smoothing ramp leaves the dry
/// burst in the opening samples, so it measures 0 here and in the sibling, and
/// neither can reproduce #1547's shape — the dry path was never silent. What it
/// does catch is a render that stops sounding or starts wholesale late.
/// `wet_onset_follows_predelay.rs` is the file that carries the #1547 shape, on
/// a stimulus with the ramp pre-rolled away.
struct RenderShape {
    peak: f32,
    rms: f32,
    onset: usize,
}

fn shape(output: &[f32]) -> RenderShape {
    let peak = output.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
    let rms = (output.iter().map(|s| s * s).sum::<f32>() / output.len() as f32).sqrt();
    let onset = output
        .iter()
        .position(|s| s.abs() > 1e-6)
        .unwrap_or(output.len());
    RenderShape { peak, rms, onset }
}

/// See the sibling file for how these two are sized. In short: a hundred times
/// looser than the measured retune, ten times tighter
/// than any level move worth shipping.
const SHAPE_LEVEL_TOLERANCE_DB: f32 = 0.1;
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
    assert_eq!(a.len(), b.len(), "renders must be the same length");
    a.iter()
        .zip(b.iter())
        .fold(0.0_f32, |acc, (x, y)| acc.max((x - y).abs()))
}

/// Build a script: select `algorithm`, apply `writes`.
fn settled(algorithm: f32, writes: &[Step]) -> Vec<Step> {
    let mut script = vec![("algorithm", algorithm)];
    script.extend_from_slice(writes);
    script
}

/// Build a script: select `algorithm`, apply `writes`, then leave for `via`
/// and come back. The round trip happens after the writes and before any
/// audio, which is the reachable shape — a user picks a sound, then auditions
/// another algorithm, then goes back.
fn round_tripped(algorithm: f32, via: f32, writes: &[Step]) -> Vec<Step> {
    let mut script = settled(algorithm, writes);
    script.push(("algorithm", via));
    script.push(("algorithm", algorithm));
    script
}

// ---------------------------------------------------------------------------
// Round-trip identity
// ---------------------------------------------------------------------------

#[test]
fn a_plate_round_tripped_through_reverse_renders_what_it_did_before_the_switch() {
    let never_switched = render(&settled(PLATE, INTERIOR_WRITES));
    let round_trip = render(&round_tripped(PLATE, REVERSE, INTERIOR_WRITES));

    // Non-vacuity: the writes have to be doing something, or "identical" is a
    // statement about two identical factory plates.
    let untouched = render(&settled(PLATE, &[]));
    assert!(
        max_delta(&never_switched, &untouched) > 1e-4,
        "the interior writes do not move the plate, so this row cannot detect \
         losing them"
    );

    let delta = max_delta(&round_trip, &never_switched);
    assert_eq!(
        delta,
        0.0,
        "plate -> reverse -> plate does not render what the plate rendered \
         before the switch: max_delta {delta:e}. Distance from a plate that \
         was told nothing: {:e}",
        max_delta(&round_trip, &untouched)
    );
}

#[test]
fn every_exposed_engine_survives_a_round_trip_through_another_one() {
    for (name, algorithm) in EXPOSED {
        // Leave via an engine that is not this one. Plate is the fallback for
        // every algorithm, so the plate's own excursion goes to the spring.
        let via = if algorithm == PLATE { SPRING } else { PLATE };

        let never_switched = render(&settled(algorithm, INTERIOR_WRITES));
        let round_trip = render(&round_tripped(algorithm, via, INTERIOR_WRITES));
        let untouched = render(&settled(algorithm, &[]));

        assert!(
            max_delta(&never_switched, &untouched) > 1e-4,
            "the interior writes do not move {name}, so its row cannot detect \
             losing them"
        );

        let delta = max_delta(&round_trip, &never_switched);
        assert_eq!(
            delta,
            0.0,
            "{name} lost parameters across an algorithm round trip: max_delta \
             {delta:e}. Distance from a {name} that was told nothing: {:e}",
            max_delta(&round_trip, &untouched)
        );
    }
}

#[test]
fn mix_survives_an_algorithm_round_trip() {
    // Called out separately because `mix` is lost with no gating involved: it
    // is not an algorithm-specific control, it is on every engine's parameter
    // list, and a device that silently returns to its default wet/dry balance
    // is audible on any material.
    let writes: &[Step] = &[("mix", 0.19)];
    let never_switched = render(&settled(PLATE, writes));
    let round_trip = render(&round_tripped(PLATE, FDN8, writes));
    let untouched = render(&settled(PLATE, &[]));

    assert!(
        max_delta(&never_switched, &untouched) > 1e-4,
        "mix 0.19 does not move the plate against its default, so this row \
         cannot detect losing it"
    );
    let delta = max_delta(&round_trip, &never_switched);
    assert_eq!(
        delta, 0.0,
        "mix did not survive plate -> fdn8 -> plate: max_delta {delta:e}"
    );
}

// ---------------------------------------------------------------------------
// A parameter the intermediate engine drops
// ---------------------------------------------------------------------------

#[test]
fn gravity_written_while_the_spring_is_selected_reaches_the_plate_that_reads_it() {
    // `gravity` is a plate-only control: `SpringReverb::set_param` has no arm
    // for it and discards it through `_ => {}`.
    //
    // The write has to land **while the dropping engine is selected**, or the
    // row does not test what it claims. Writing it on the plate and detouring
    // through the spring passes even for a cache that only records what the
    // current engine reads, because the plate reads it — the recording
    // happens before the detour. Written on the spring, a
    // reads-it-first cache never records it at all and the plate arrives at
    // its default.
    let via_spring: &[Step] = &[
        ("algorithm", SPRING),
        ("mix", 1.0),
        ("gravity", 0.87),
        ("algorithm", PLATE),
    ];
    let direct = render(&settled(PLATE, &[("mix", 1.0), ("gravity", 0.87)]));
    let carried = render(via_spring);
    let without_gravity = render(&settled(PLATE, &[("mix", 1.0)]));

    assert!(
        max_delta(&direct, &without_gravity) > 1e-4,
        "gravity 0.87 does not move the plate, so this row cannot detect \
         losing it"
    );
    let delta = max_delta(&carried, &direct);
    assert_eq!(
        delta,
        0.0,
        "gravity written on the spring did not reach the plate: max_delta \
         {delta:e}. Distance from a plate with default gravity: {:e}",
        max_delta(&carried, &without_gravity)
    );
}

#[test]
fn matrix_written_while_the_plate_is_selected_reaches_the_fdn_that_reads_it() {
    // The mirror case, so the row is not a statement about one engine pair:
    // `matrix` is FDN-only and `ProofChamber::set_param` drops it.
    let via_plate: &[Step] = &[
        ("algorithm", PLATE),
        ("mix", 1.0),
        ("matrix", 0.0),
        ("algorithm", FDN8),
    ];
    let direct = render(&settled(FDN8, &[("mix", 1.0), ("matrix", 0.0)]));
    let carried = render(via_plate);
    let without_matrix = render(&settled(FDN8, &[("mix", 1.0)]));

    assert!(
        max_delta(&direct, &without_matrix) > 1e-4,
        "matrix 0.0 does not move the fdn8, so this row cannot detect losing it"
    );
    let delta = max_delta(&carried, &direct);
    assert_eq!(
        delta,
        0.0,
        "matrix written on the plate did not reach the fdn8: max_delta \
         {delta:e}. Distance from an fdn8 with the default matrix: {:e}",
        max_delta(&carried, &without_matrix)
    );
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

#[test]
fn the_replay_preserves_most_recent_write_order() {
    // `diffusion` is a derived write: `ProofChamberInstance::set_param`
    // forwards it to the spring and then sets `dispersion` from the same
    // value. So the two names are order-sensitive on that engine — whichever
    // arrived last decides the allpass coefficients.
    //
    // This is the row that discriminates between orderings. The script writes
    // `dispersion`, then `diffusion` (which overwrites it), then `dispersion`
    // again. The live engine ends at 0.35.
    //
    //   * A map iteration, or a cache keyed by first-insertion position,
    //     replays `dispersion` before `diffusion` and ends at 0.72.
    //   * Replaying in most-recent-write order replays `diffusion` first and
    //     ends at 0.35, which is what the engine being replaced was doing.
    let writes: &[Step] = &[
        ("mix", 1.0),
        ("dispersion", 0.2),
        ("diffusion", 0.72),
        ("dispersion", 0.35),
    ];
    let never_switched = render(&settled(SPRING, writes));
    let round_trip = render(&round_tripped(SPRING, PLATE, writes));

    // Non-vacuity: the two candidate orders must actually render differently,
    // or "preserves order" is unfalsifiable here.
    let wrong_order = render(&settled(
        SPRING,
        &[("mix", 1.0), ("dispersion", 0.35), ("diffusion", 0.72)],
    ));
    assert!(
        max_delta(&never_switched, &wrong_order) > 1e-4,
        "the two replay orders render the same thing, so this row cannot tell \
         them apart"
    );

    let delta = max_delta(&round_trip, &never_switched);
    assert_eq!(
        delta,
        0.0,
        "the replay reordered two order-sensitive writes: max_delta {delta:e}. \
         Distance from the wrong order: {:e}",
        max_delta(&round_trip, &wrong_order)
    );
}

// ---------------------------------------------------------------------------
// First construction
// ---------------------------------------------------------------------------

/// What an instance that has been told nothing but `mix` renders.
///
/// The readable shape is pinned, while the constructor/cache relationship is
/// compared bit for bit within the same process so platform `libm` drift does
/// not become an unbound allowlist.
/// Taken on `main` at d36441d4f, before the parameter cache existed, and
/// unchanged by it.
///
/// Moved once, by #1546, when the plate constructor's `damping` went from
/// 0.0005 to 0.3. That is a deliberate voicing change and this row is the
/// place it is supposed to show up, re-measured on this stimulus in the same
/// commit as the constructor edit.
/// What it means in the render is 9.66 dB of 6-12 kHz shed across the tail
/// against 4.88 dB before, and a late window that sits 8.45 dB *below* the
/// midrange instead of 0.21 dB above it — measured in
/// `tests/plate_default_damping.rs`, which pins the audible behaviour.
///
/// It does **not** mean existing projects sound different. `addDevice` writes
/// the descriptor's `damping` into `Device.parameterValues` at add time and
/// `projectTrackToLiveStrip` replays every stored value on load, so a saved
/// project carrying 0.0005 still gets 0.0005 written over the constructor.
/// Only a newly added Dutch Oven reaches this state.
///
/// Moved a second time, by #1547, and for the same reason as its sibling in
/// `plate_parameter_surface.rs` — the two fingerprint the same engine from two
/// stimuli and always move together. `DelayLine::read` and
/// `EarlyReflections::process` now count back from the most recently written
/// sample rather than from the slot after it, so a request for zero delay is
/// zero delay rather than a whole buffer. That is what stops Pre-Delay 0 ms
/// rendering 503 ms of silence, and it lengthens every delay in the engine by
/// one sample on the way, which is why a stimulus that never writes `predelay`
/// moves at all.
///
/// The measured content of the move is written out beside the other constant
/// and not repeated here: identical peak, RMS within 0.0015 dB, identical T60,
/// every octave band within 0.03 dB, and a waveform that decorrelates past the
/// first 250 ms. The fine structure moved; the sound did not.
///
/// The retained render crosses platform `libm` implementations, so the stable
/// contract is its readable shape, portable signed projections of its fine
/// structure, and an exact same-process comparison with the first explicit
/// selection below. Both paths use the same platform math; any constructor or
/// cache disagreement still moves a sample bit.
///
/// The render in three readable numbers.
///
/// `onset: 0` is measured, not a placeholder — see `RenderShape` for why it is
/// 0 even at `mix = 1`, and for what it can and cannot see.
const UNTOLD_INSTANCE_SHAPE: RenderShape = RenderShape {
    peak: 8.290293e-1,
    rms: 1.515884e-1,
    onset: 0,
};

#[test]
fn an_instance_told_nothing_renders_exactly_what_it_always_has() {
    // No `algorithm` write at all: the constructor's plate, straight from
    // `ProofChamberInstance::new`.
    let constructed = render(&[("mix", 1.0)]);

    // Scalars first, so the readable failure is the one that reports.
    assert_shape(
        &shape(&constructed),
        &UNTOLD_INSTANCE_SHAPE,
        "an untold instance",
    );
    plate_fine_structure::assert_matches(&constructed, "an untold instance");

    // The first `algorithm` write happens against an empty cache, so it must
    // hand back the constructor's defaults and not a partial replay.
    let first_selection = render(&[("algorithm", PLATE), ("mix", 1.0)]);
    let delta = max_delta(&first_selection, &constructed);
    assert_eq!(
        delta, 0.0,
        "selecting the plate on a fresh instance does not render what the \
         constructor's plate renders: max_delta {delta:e}"
    );
}

/// Prints the table quoted in the change description. The rows above carry the
/// assertions; this exists so the numbers stay reproducible.
///
/// `vs settled` is the defect: how far a round-tripped engine is from the one
/// it was before the switch. `vs untold` is the diagnosis: on `main` it is
/// exactly zero for every engine, because the round trip does not merely lose
/// some parameters, it lands on factory-fresh.
#[test]
fn measurement_table() {
    println!("{:<10} {:>12} {:>12}", "engine", "vs settled", "vs untold");
    for (name, algorithm) in EXPOSED {
        let via = if algorithm == PLATE { SPRING } else { PLATE };
        let never_switched = render(&settled(algorithm, INTERIOR_WRITES));
        let round_trip = render(&round_tripped(algorithm, via, INTERIOR_WRITES));
        let untouched = render(&settled(algorithm, &[]));
        println!(
            "{:<10} {:>12e} {:>12e}",
            name,
            max_delta(&round_trip, &never_switched),
            max_delta(&round_trip, &untouched)
        );
    }
}

#[test]
fn every_engine_reached_after_a_detour_renders_what_it_does_when_reached_directly() {
    // The general form of the two rows above, across every exposed engine and
    // the whole write set rather than one name: build a sound on one engine,
    // then switch to another. Everything the destination reads has to arrive.
    //
    // Deliberately not the shape "select, write, leave, come back". That shape
    // records every write while an engine that reads it is selected, so it
    // cannot distinguish a cache that records everything from one that records
    // only what the current engine reads. Here the writes land on the *other*
    // engine.
    for (name, algorithm) in EXPOSED {
        let from = if algorithm == PLATE { SPRING } else { PLATE };

        let mut detour = vec![("algorithm", from)];
        detour.extend_from_slice(INTERIOR_WRITES);
        detour.push(("algorithm", algorithm));

        let carried = render(&detour);
        let direct = render(&settled(algorithm, INTERIOR_WRITES));
        let untouched = render(&settled(algorithm, &[]));

        assert!(
            max_delta(&direct, &untouched) > 1e-4,
            "the interior writes do not move {name}, so its row cannot detect \
             losing them"
        );

        let delta = max_delta(&carried, &direct);
        assert_eq!(
            delta,
            0.0,
            "{name} reached from another engine does not render what {name} \
             written directly renders: max_delta {delta:e}. Distance from a \
             {name} that was told nothing: {:e}",
            max_delta(&carried, &untouched)
        );
    }
}

// ---------------------------------------------------------------------------
// The documented exception
// ---------------------------------------------------------------------------

#[test]
fn a_freeze_that_was_switched_off_leaves_shimmer_on_after_a_round_trip() {
    // The one place a round trip does *not* render what it rendered before,
    // pinned as a known non-zero delta so it cannot widen without a test
    // saying so, and cannot be silently fixed without one either.
    //
    // `ProofChamber::set_param`'s `freeze` arm writes `shimmer.enabled =
    // false` as a side effect. The cache holds values, not the write history,
    // so a `freeze` that has since been turned off replays as `shimmer = 1,
    // freeze = 0` and the rebuilt plate comes back with shimmer on. Both
    // controls are live on the panel and the `infinite` space preset sets
    // freeze, so this is two clicks away, not a theoretical sequence.
    let writes: &[Step] = &[
        ("mix", 1.0),
        ("shimmer", 1.0),
        ("shimmer_amount", 0.9),
        ("shimmer_pitch", 0.8),
        ("freeze", 1.0),
        ("freeze", 0.0),
    ];
    let never_switched = render(&settled(PLATE, writes));
    let round_trip = render(&round_tripped(PLATE, SPRING, writes));

    // What the live engine was doing: shimmer latched off by the freeze.
    let shimmer_off = render(&settled(
        PLATE,
        &[
            ("mix", 1.0),
            ("shimmer", 0.0),
            ("shimmer_amount", 0.9),
            ("shimmer_pitch", 0.8),
        ],
    ));
    // What the round trip actually produces: the freeze never having fired.
    let shimmer_on = render(&settled(
        PLATE,
        &[
            ("mix", 1.0),
            ("shimmer", 1.0),
            ("shimmer_amount", 0.9),
            ("shimmer_pitch", 0.8),
        ],
    ));

    assert_eq!(
        max_delta(&never_switched, &shimmer_off),
        0.0,
        "the live plate is supposed to have shimmer latched off by the freeze; \
         if this moved, the plate's freeze arm changed and this row is now \
         describing something else"
    );
    assert_eq!(
        max_delta(&round_trip, &shimmer_on),
        0.0,
        "the round-tripped plate is supposed to land exactly on shimmer-on; if \
         this moved, either the latch or the replay changed"
    );

    let delta = max_delta(&round_trip, &never_switched);
    assert!(
        delta > 1e-2,
        "the freeze -> shimmer latch no longer diverges across a round trip \
         (max_delta {delta:e}). If the plate now computes shimmer from freeze \
         at process time, this row and the exception in `ParameterCache`'s doc \
         comment should both go."
    );
}

// ---------------------------------------------------------------------------
// The capacity bound
// ---------------------------------------------------------------------------

#[test]
fn a_full_cache_keeps_the_newest_write_and_drops_its_oldest() {
    // The cache is bounded because growing it would allocate on the audio
    // thread, and a bound has to choose a victim. Choosing the incoming write
    // would reintroduce the defect this file exists to stop — forwarded live,
    // dropped at the next reconstruction, permanently for that name — while
    // protecting whatever has gone untouched longest.
    //
    // No writer can reach the bound today (the descriptor declares 22
    // forwarded ids against a limit of 64), but `handleSetDeviceParameter`
    // does no descriptor validation and `parameterValues` is an unvalidated
    // string-keyed map, so the policy is asserted rather than assumed.
    let mut flooded = ProofChamberInstance::new(SAMPLE_RATE);
    flooded.set_param("algorithm", PLATE);
    for slot in 0..PARAMETER_CACHE_LIMIT {
        flooded.set_param(&format!("junk_{slot}"), 0.5);
    }
    flooded.set_param("mix", 1.0);
    flooded.set_param("gravity", 0.87);
    flooded.set_param("algorithm", SPRING);
    flooded.set_param("algorithm", PLATE);

    let flooded_output = render_instance(&mut flooded);
    let direct = render(&settled(PLATE, &[("mix", 1.0), ("gravity", 0.87)]));
    let without_gravity = render(&settled(PLATE, &[("mix", 1.0)]));

    assert!(
        max_delta(&direct, &without_gravity) > 1e-4,
        "gravity 0.87 does not move the plate, so this row cannot detect \
         losing it"
    );
    let delta = max_delta(&flooded_output, &direct);
    assert_eq!(
        delta,
        0.0,
        "a cache filled past its limit dropped the writes that arrived after \
         it filled: max_delta {delta:e}. Distance from a plate with default \
         gravity: {:e}",
        max_delta(&flooded_output, &without_gravity)
    );
}

// ---------------------------------------------------------------------------
// The other construction site
// ---------------------------------------------------------------------------

#[test]
fn the_unexposed_engine_selector_replays_the_cache_too() {
    // `select_unexposed_engine` is the crate's second engine-construction
    // site. It is Rust-only and no wire value reaches it, but it constructs
    // the same way and would lose parameters the same way, and every existing
    // caller happens to select before writing anything — so without this row
    // the replay there is live code no test can see.
    //
    // Hybrid rather than convolution: with no IR loaded
    // `ConvolutionEngine::process` returns before it touches a sample, so
    // every replayed parameter would measure `0e0` and the row would be
    // vacuous. Hybrid defaults to its algorithmic-only mode, which is a plate.
    let mut carried = ProofChamberInstance::new(SAMPLE_RATE);
    carried.set_param("mix", 1.0);
    carried.set_param("gravity", 0.87);
    carried.select_unexposed_engine(UnexposedEngine::Hybrid);

    let mut untold = ProofChamberInstance::new(SAMPLE_RATE);
    untold.select_unexposed_engine(UnexposedEngine::Hybrid);

    let carried_output = render_instance(&mut carried);
    let untold_output = render_instance(&mut untold);

    let delta = max_delta(&carried_output, &untold_output);
    assert!(
        delta > 1e-2,
        "selecting the hybrid engine discarded the parameters written before \
         it: max_delta {delta:e} against an instance that was told nothing"
    );
}

#[test]
fn selecting_each_engine_on_a_fresh_instance_matches_its_constructor_defaults() {
    // An empty cache replays nothing, so a first selection is the constructor
    // and nothing else — checked per engine by reaching each one twice, once
    // directly and once after a detour that wrote nothing, so a replay that
    // invented state at either construction shows up as a difference.
    //
    // The platform-independent shape contract lives in
    // `an_instance_told_nothing_renders_exactly_what_it_always_has`; this row
    // is the per-engine spread around it.
    for (name, algorithm) in EXPOSED {
        let once = render(&settled(algorithm, &[("mix", 1.0)]));
        let after_detour = render(&[
            ("algorithm", if algorithm == PLATE { SPRING } else { PLATE }),
            ("algorithm", algorithm),
            ("mix", 1.0),
        ]);
        let delta = max_delta(&once, &after_detour);
        assert_eq!(
            delta, 0.0,
            "{name} reached after a detour does not render what {name} \
             selected directly renders: max_delta {delta:e}"
        );
    }
}
