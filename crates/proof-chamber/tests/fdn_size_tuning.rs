//! `size` on the FDN engines must map onto the whole room it advertises.
//!
//! The delay-line set *is* the room: its shortest line is the first late
//! arrival, and the spread of the set is the modal density. Both are what a
//! musician is reaching for when they turn Size, and both are measured here at
//! the render output rather than read off the tuning table, because a tuning
//! table that changes while the tank does not is exactly the failure this file
//! was written for.
//!
//! Early reflections also track `size`, and they moved correctly throughout the
//! defect. Every render here therefore runs at `early_late = 1.0` so the early
//! path contributes nothing: with it blended in, the output changes with Size
//! at every setting and a dead tank is invisible.
//!
//! Onset rather than any energy statistic, deliberately. Jot's per-line gain is
//! derived from that line's own length, so a longer line loses proportionally
//! more per pass and makes proportionally fewer passes per second: the decay
//! *envelope* is size-invariant by construction. An energy centroid over the
//! whole tail therefore reports the envelope, and measured across 0.75 / 0.85 /
//! 1.0 on the fixed engine it read 9569.7 / 9564.2 / 9750.1 — non-monotonic,
//! and not a fact about size. The share of energy in the first 100 ms behaves
//! the same way (0.377 / 0.385 / 0.373), because the delay set is a set of
//! primes and a small size step reshuffles the echo pattern as much as it
//! stretches it. First arrival is the one thing that moves with the room and
//! not with the pattern.

use proof_chamber::fdn::FdnReverb;

const BLOCK: usize = 128;
const IR_FRAMES: usize = 48_000;
const ONSET_THRESHOLD: f32 = 1e-4;

/// A tank-only impulse response at `size`, at the shipped 8-line width.
///
/// `predelay` is zeroed and `early_late` pinned to the late tank so the only
/// thing between the impulse and the measurement is the delay-line set.
///
/// The silent pre-roll is load-bearing. `mix` is smoothed over a 30 ms ramp
/// from its constructor default, so an impulse fed on the first block comes
/// back out through the *dry* half of a mix that has not arrived at 1.0 yet —
/// which lands at sample 0 and makes every onset measurement read zero. Half a
/// second of silence puts the residual dry path some 140 dB below the threshold
/// used here.
fn tank_impulse_response(sample_rate: f32, size: f32) -> Vec<f32> {
    let mut reverb = FdnReverb::new(sample_rate, 8);
    reverb.set_param("mix", 1.0);
    reverb.set_param("early_late", 1.0);
    reverb.set_param("predelay", 0.0);
    reverb.set_param("decay", 0.7);
    reverb.set_param("size", size);

    let mut left = [0.0_f32; BLOCK];
    let mut right = [0.0_f32; BLOCK];

    let preroll = (sample_rate * 0.5) as usize;
    let mut settled = 0;
    while settled < preroll {
        left.fill(0.0);
        right.fill(0.0);
        reverb.process(&mut left, &mut right);
        settled += BLOCK;
    }

    let mut response = Vec::with_capacity(IR_FRAMES);
    let mut rendered = 0;
    while rendered < IR_FRAMES {
        left.fill(0.0);
        right.fill(0.0);
        if rendered == 0 {
            left[0] = 1.0;
            right[0] = 1.0;
        }
        reverb.process(&mut left, &mut right);
        response.extend_from_slice(&left);
        rendered += BLOCK;
    }
    response
}

/// Sample index of the first late arrival — the tank's own onset, and the
/// closest render-level proxy there is for the room's mean free path.
fn late_onset(response: &[f32]) -> usize {
    response
        .iter()
        .position(|sample| sample.abs() > ONSET_THRESHOLD)
        .expect("the tank must produce a late field for an impulse")
}

/// FNV-1a over the raw sample bits. Compared instead of the buffers themselves
/// so a failure prints three integers rather than 48 000 floats.
fn digest(response: &[f32]) -> u64 {
    let mut hash = 0xcbf29ce4_84222325_u64;
    for sample in response {
        for byte in sample.to_bits().to_le_bytes() {
            hash ^= byte as u64;
            hash = hash.wrapping_mul(0x100000001b3);
        }
    }
    hash
}

/// The defect: everything from ~0.75 upwards rendered bit-identically, because
/// every delay line had already saturated against the buffer it was given at
/// construction. The upper quarter of the control was dead.
#[test]
fn the_upper_quarter_of_size_still_moves_the_tank() {
    let sample_rate = 48_000.0;
    let responses: Vec<Vec<f32>> = [0.75_f32, 0.85, 1.0]
        .iter()
        .map(|&size| tank_impulse_response(sample_rate, size))
        .collect();

    let digests: Vec<u64> = responses.iter().map(|r| digest(r)).collect();
    assert!(
        digests[0] != digests[1] && digests[1] != digests[2],
        "sizes above 0.75 render identically: 0.75 / 0.85 / 1.0 hashed to \
         {digests:#x?}, so the top of the control does nothing"
    );

    let onsets: Vec<usize> = responses.iter().map(|r| late_onset(r)).collect();
    assert!(
        onsets[0] < onsets[1] && onsets[1] < onsets[2],
        "the late field must arrive later as the room grows: onsets {onsets:?} at \
         size 0.75 / 0.85 / 1.0"
    );

    let peaks: Vec<f32> = responses
        .iter()
        .map(|r| r.iter().fold(0.0_f32, |acc, s| acc.max(s.abs())))
        .collect();
    for (index, peak) in peaks.iter().enumerate() {
        assert!(
            *peak > 1e-3,
            "measurement {index} ran on a silent tail (peak {peak}); the onsets \
             above would then be meaningless"
        );
    }
}

/// The same claim over the whole declared range, so a fix that merely moves the
/// dead zone somewhere else does not pass.
#[test]
fn late_onset_rises_monotonically_across_the_whole_size_range() {
    let sample_rate = 48_000.0;
    let mut previous = 0_usize;
    for step in 0..=10 {
        let size = step as f32 / 10.0;
        let onset = late_onset(&tank_impulse_response(sample_rate, size));
        assert!(
            onset > previous,
            "size {size} produced a late onset of {onset} samples, no later than \
             the {previous} of the size below it"
        );
        previous = onset;
    }
}
