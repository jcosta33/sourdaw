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
//! * **First construction.** An instance told nothing must still render what
//!   it always renders. Pinned by shape scalars, which hold on every libm,
//!   and by same-run digest comparisons — the untold render against a second
//!   render of the same script and against the first `algorithm` selection —
//!   and not by an absolute captured fingerprint: the engine's f32
//!   transcendentals round differently across libm builds, even between two
//!   Linux machines, so a captured digest cannot hold on a hosted runner.
//!   `daw-dsp`'s `dsp_cost_reduction_goldens` module doc records the same
//!   finding, and the same same-run replacement, on another engine. The
//!   #1547 pre-delay behaviour the removed fingerprint used to catch is
//!   carried by an onset row further down.
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

/// Three cheap scalars of a render, pinned beside the digest and asserted
/// before it.
///
/// Same instrument as `plate_parameter_surface.rs`'s, duplicated because Rust
/// integration tests are separate crates and this is four lines of arithmetic;
/// the reasoning for why a digest needs company at all is written out there and
/// not repeated. The short version: `digest 0x…` is three opaque integers,
/// identical whether the render moved one sample of fine structure or went
/// silent, and it is the only thing that fires for a whole class of change.
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
/// looser than the retune that produced the current digests, ten times tighter
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

/// FNV-1a over every sample's bit pattern, so any change anywhere in the
/// buffer moves it.
///
/// Only ever compared against another digest from the same process. Both
/// renders then share one libm, so equality is bit-exactness — the honest
/// fine-structure pin. A captured *absolute* digest of this engine drifts
/// across libm builds; see the untold-instance row below and
/// `daw-dsp`'s `dsp_cost_reduction_goldens` module doc.
fn digest(output: &[f32]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for sample in output {
        hash ^= u64::from(sample.to_bits());
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
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

/// What an instance that has been told nothing but `mix` renders, in three
/// readable numbers. Measured on `main` at d36441d4f, before the parameter
/// cache existed, and unchanged by it.
///
/// These scalars, not a digest, are the absolute pin: a last-bit difference in
/// a transcendental is orders of magnitude below a level change worth shipping,
/// so peak and RMS hold inside the 0.1 dB tolerances on any libm, while a
/// bit-pattern fingerprint amplifies that same last bit into a hard failure —
/// which is why the absolute digest this file once pinned here was removed.
/// Re-measured once, by #1546, when the plate constructor's `damping` went
/// from 0.0005 to 0.3: a deliberate voicing change, with the behaviour it
/// produced measured in `tests/plate_default_damping.rs`, which pins what
/// these scalars only summarize. It did not change existing projects:
/// `addDevice` writes the descriptor's `damping` into `Device.parameterValues`
/// at add time and `projectTrackToLiveStrip` replays every stored value on
/// load, so only a newly added Dutch Oven reaches this state.
///
/// `onset: 0` is measured, not a placeholder — see `RenderShape` for why it is
/// 0 even at `mix = 1`, and for what it can and cannot see. The onset this
/// stimulus cannot see is pinned properly, on a pre-rolled render, by
/// `wet_onset_is_exactly_predelay_plus_the_first_reflection_tap` below — the
/// row that carries the #1547 protection the removed digest used to provide.
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

    // Scalars first, so the readable failure is the one that reports. They
    // are also the only absolute pin left standing: they hold on every libm,
    // where a captured digest does not.
    assert_shape(
        &shape(&constructed),
        &UNTOLD_INSTANCE_SHAPE,
        "an untold instance",
    );

    // Determinism witness. Every comparison below is between renders of one
    // process, which is only meaningful if the engine is a function of its
    // script, so the same script rendered twice must agree bit for bit.
    // Nondeterminism — an unseeded generator, state leaking between
    // instances — trips here instead of disguising itself as a mapping
    // change in the rows that follow.
    let constructed_again = render(&[("mix", 1.0)]);
    assert_eq!(
        digest(&constructed),
        digest(&constructed_again),
        "the same script rendered twice in one process produced different \
         fine structure, so the engine is not a function of its parameters \
         and every same-run comparison here is measuring noise"
    );

    // The first `algorithm` write happens against an empty cache, so it must
    // hand back the constructor's defaults and not a partial replay. Digest
    // equality rather than `max_delta == 0`, and this is the fine-structure
    // pin the removed absolute fingerprint used to carry: both renders share
    // this process's libm, so bit-exactness is assertable here even though a
    // captured constant is not.
    let first_selection = render(&[("algorithm", PLATE), ("mix", 1.0)]);
    assert_eq!(
        digest(&first_selection),
        digest(&constructed),
        "selecting the plate on a fresh instance does not render what the \
         constructor's plate renders: digest {:x} against {:x}. A partial \
         replay, or a default that differs between the two construction \
         sites, moves bits this comparison sees.",
        digest(&first_selection),
        digest(&constructed)
    );
}

// ---------------------------------------------------------------------------
// The #1547 protection the removed digest used to carry
// ---------------------------------------------------------------------------

/// Silent blocks rendered before the burst in the onset row below.
///
/// `mix` is smoothed with a 30 ms one-pole, so an engine told `mix = 1` still
/// passes a shrinking fraction of its dry input for some time afterwards; on
/// this file's burst-from-zero stimulus that dry leak is exactly why
/// `RenderShape::onset` measures 0. Rendering 400 silent blocks (1.07 s)
/// first parks the ramp at 1 − 3.4e-5 — where it stalls rather than settles —
/// so the dry burst measures 2.7e-5: an order of magnitude below the onset
/// floor (peak × 1e-3 ≥ 2.7e-4, since the first wet sample lands near 0.27)
/// and four orders below that first wet sample, which is what makes the
/// first sample above the floor a wet one.
///
/// Same figure, measured and argued, as `wet_onset_follows_predelay.rs`'s
/// `PREROLL_BLOCKS`; the instrument below is that file's, because the onset
/// this file's own stimulus cannot see is what this section pins.
const ONSET_PREROLL_BLOCKS: usize = 400;

/// Length and level of the burst the onset row excites the engine with.
///
/// DC rather than this file's 220 Hz sine: the sine's first sample is zero,
/// which would put the measured onset one sample after the tap's own — a real
/// offset, but a trap in a row whose whole point is naming the sample the tap
/// delivers. DC puts full amplitude in the first sample, so the onset names
/// the tap and nothing else.
const ONSET_BURST: usize = 512;
const ONSET_BURST_LEVEL: f32 = 0.8;

/// Fraction of a render's own peak that counts as sounding, so an engine that
/// runs quiet is measured on its own terms. The first early-reflection sample
/// lands near 0.27 against a floor orders of magnitude smaller, so nothing
/// sits near the threshold and libm cannot move the crossing.
const ONSET_FLOOR_FRACTION: f32 = 1e-3;

/// Frames rendered after the pre-roll. One second, so #1547's 503 ms of
/// silence would still fall inside the render and be measured rather than
/// merely absent.
const ONSET_FRAMES: usize = 48_000;

/// Apply `script` to a fresh instance, pre-roll the mix ramp silent, then
/// render the DC burst. Returns only the post-pre-roll frames, so an onset
/// index into the result counts from the first burst sample.
fn render_wet_onset(script: &[Step]) -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    for &(name, value) in script {
        instance.set_param(name, value);
    }

    let silence = [0.0_f32; BLOCK];
    for _ in 0..ONSET_PREROLL_BLOCKS {
        instance.process(&silence, &silence, BLOCK as u32);
    }

    let mut output = Vec::with_capacity(ONSET_FRAMES);
    let mut index = 0;
    while index < ONSET_FRAMES {
        let left: Vec<f32> = (0..BLOCK)
            .map(|i| {
                if index + i < ONSET_BURST {
                    ONSET_BURST_LEVEL
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

/// The wet onset of the default plate, exactly, in samples: the pre-delay
/// plus the first early-reflection tap.
///
/// #1547 counted delay reads back from the slot *after* the most recently
/// written one, in two places — `DelayLine::read` and
/// `EarlyReflections::process` — so every delay in the engine delivered one
/// sample early, and a request for zero delay had no representation at all:
/// it read the oldest slot in the line, which on a pre-delay line sized
/// `sample_rate * 0.5` is why Pre-Delay 0 ms rendered 503 ms of silence. The
/// absolute digest this file used to pin the untold instance caught both —
/// it moved when the fix landed — but a digest cannot be carried across
/// machines, so this row carries the protection instead, as behaviour.
///
/// Why the onset is this number on an untouched instance: the plate
/// constructor builds its early reflections at room size 0.5
/// (`EarlyReflections::new(sample_rate, 0.5)`), and no `size` write ever
/// reaches `update_room_size` here, so that is what renders. Tap 0 sits
/// `(1.0·0.5 + (5 + 0.5·45)·0.1)/1000 · 48 000` = 156 samples out — 222 is
/// the same tap after a Size 0.75 write — and nothing else in the wet path is
/// shorter: the tank's first possible contribution is four input diffusers
/// (142+107+379+277) plus a modulated allpass, 905 samples minimum, later.
/// So the wet output's first non-zero sample is exactly `predelay_len + 156`.
///
/// Sample counts, not bit fingerprints: the index depends only on integer
/// delay arithmetic and on buffer slots that are exactly zero, and the first
/// non-zero early sample sits orders of magnitude above the floor, so no libm
/// can move it — while the defect it watches moves it by a whole sample (the
/// one-sample copy) or by about 24 000 (the unrepresented zero), which is the
/// resolution this row pins. `early_reflections.rs`'s own unit test pins its
/// copy of the expression in isolation; this row pins the same expression
/// where the digest watched it, wired into the assembled default engine, and
/// the pre-delay line's copy with it. `wet_onset_follows_predelay.rs` sweeps
/// every engine, Size and two rates against a 20 ms budget; this is the
/// exact pin on the default plate. Re-measure both numbers in the same
/// commit as a deliberate retune — that protocol works here, because sample
/// counts do not drift across platforms.
#[test]
fn wet_onset_is_exactly_predelay_plus_the_first_reflection_tap() {
    for (predelay_ms, expected) in [(0.0_f32, 156_usize), (10.0, 636)] {
        let output = render_wet_onset(&[("mix", 1.0), ("predelay", predelay_ms)]);

        let peak = output.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
        assert!(
            peak > 1e-3,
            "the plate rendered nothing at Pre-Delay {predelay_ms} ms (peak \
             {:e}); the onset measurement below would pass on silence",
            peak
        );

        let floor = peak * ONSET_FLOOR_FRACTION;
        let onset = output
            .iter()
            .position(|s| s.abs() > floor)
            .unwrap_or(output.len());
        let requested = (predelay_ms / 1000.0 * SAMPLE_RATE) as usize;
        assert_eq!(
            onset, expected,
            "the wet output at Pre-Delay {predelay_ms} ms starts at sample \
             {onset}, not {expected} ({requested} of pre-delay plus the first \
             reflection's 156). One sample early is #1547 alive again in \
             `EarlyReflections::process` or `DelayLine::read`; around 24 000 \
             is its other half — a request for zero delay reading the oldest \
             slot in the line. If the tap table was retuned on purpose, \
             re-measure: sample counts hold on every platform, which is why \
             this row is here instead of a digest."
        );
    }
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
    // The same-run digest comparisons that stop both sides drifting together
    // live in `an_instance_told_nothing_renders_exactly_what_it_always_has`;
    // this row is the per-engine spread around them.
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
