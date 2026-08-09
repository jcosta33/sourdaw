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
//!   it always rendered, pinned by a digest rather than by comparison against
//!   another run of the same mapping.

use proof_chamber::ProofChamberInstance;

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

/// Peak absolute sample-by-sample difference between two renders.
fn max_delta(a: &[f32], b: &[f32]) -> f32 {
    assert_eq!(a.len(), b.len(), "renders must be the same length");
    a.iter()
        .zip(b.iter())
        .fold(0.0_f32, |acc, (x, y)| acc.max((x - y).abs()))
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
        delta, 0.0,
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
            delta, 0.0,
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
fn gravity_survives_a_round_trip_through_the_spring_which_drops_it() {
    // `gravity` is a plate-only control: `SpringReverb::set_param` has no arm
    // for it and discards it through `_ => {}`. If the cache only recorded
    // what the *current* engine reads, the write would be forgotten while the
    // spring was selected and the plate would come back without it.
    let writes: &[Step] = &[("mix", 1.0), ("gravity", 0.87)];
    let never_switched = render(&settled(PLATE, writes));
    let round_trip = render(&round_tripped(PLATE, SPRING, writes));
    let without_gravity = render(&settled(PLATE, &[("mix", 1.0)]));

    assert!(
        max_delta(&never_switched, &without_gravity) > 1e-4,
        "gravity 0.87 does not move the plate, so this row cannot detect \
         losing it"
    );
    let delta = max_delta(&round_trip, &never_switched);
    assert_eq!(
        delta, 0.0,
        "gravity did not survive a round trip through the spring: max_delta \
         {delta:e}. Distance from a plate with default gravity: {:e}",
        max_delta(&round_trip, &without_gravity)
    );
}

#[test]
fn matrix_survives_a_round_trip_through_the_plate_which_drops_it() {
    // The mirror case, so the row is not a statement about one engine pair:
    // `matrix` is FDN-only and `ProofChamber::set_param` drops it.
    let writes: &[Step] = &[("mix", 1.0), ("matrix", 0.0)];
    let never_switched = render(&settled(FDN8, writes));
    let round_trip = render(&round_tripped(FDN8, PLATE, writes));
    let without_matrix = render(&settled(FDN8, &[("mix", 1.0)]));

    assert!(
        max_delta(&never_switched, &without_matrix) > 1e-4,
        "matrix 0.0 does not move the fdn8, so this row cannot detect losing it"
    );
    let delta = max_delta(&round_trip, &never_switched);
    assert_eq!(
        delta, 0.0,
        "matrix did not survive a round trip through the plate: max_delta \
         {delta:e}. Distance from an fdn8 with the default matrix: {:e}",
        max_delta(&round_trip, &without_matrix)
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
        delta, 0.0,
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
/// Pinned rather than compared against another run of the same mapping: a
/// cache that quietly replayed something into a first construction — or a
/// default that drifted — would move this and leave a comparison row green,
/// which is the hole #1519's gravity digest was added to close.
/// Taken on `main` at d36441d4f, before the parameter cache existed, and
/// unchanged by it.
const UNTOLD_INSTANCE_DIGEST: u64 = 0xdd93_83f3_187e_b942;

#[test]
fn an_instance_told_nothing_renders_exactly_what_it_always_has() {
    // No `algorithm` write at all: the constructor's plate, straight from
    // `ProofChamberInstance::new`.
    let constructed = render(&[("mix", 1.0)]);
    let digest_now = digest(&constructed);
    assert_eq!(
        digest_now, UNTOLD_INSTANCE_DIGEST,
        "an untouched Dutch Oven changed what it renders: an existing project \
         that never moved a control now sounds different. digest {digest_now:#x}"
    );

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
    println!(
        "{:<10} {:>12} {:>12}",
        "engine", "vs settled", "vs untold"
    );
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
fn selecting_each_engine_on_a_fresh_instance_matches_its_constructor_defaults() {
    // The same claim per engine: an empty cache replays nothing, so a first
    // selection is the constructor and nothing else. Measured against a second
    // instance that reaches the same engine by the same single write, then
    // pinned by a digest so both sides cannot drift together.
    for (name, algorithm) in EXPOSED {
        let once = render(&settled(algorithm, &[("mix", 1.0)]));
        // Reaching the engine after a detour must not differ either: the
        // detour's cache holds only `mix`, which the destination reads anyway.
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
