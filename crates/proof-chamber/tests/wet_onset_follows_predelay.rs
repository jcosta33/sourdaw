//! No Dutch Oven algorithm may go silent for longer than the Pre-Delay it was
//! given, and none may go silent again in the middle of its own tail.
//!
//! #1547 was reported as a quarter-second of digital zeroes on the plate's left
//! channel between the burst and the tail. The zeroes were real and the shape
//! was wrong in every particular: the run was on *both* channels, it started at
//! sample 1 rather than at 0.25 s, and it was 24 153 samples rather than 12 000.
//! What the engine actually did with Pre-Delay at its declared minimum of 0 ms
//! was emit nothing at all for 503 ms and then start — a reverb that arrives
//! after the note it is reverberating.
//!
//! The cause was `DelayLine::read` in `proof_chamber.rs`, which counted its
//! delay back from the write pointer *after* `write` had advanced it. That made
//! the argument mean `delay + 1` samples and, worse, left `delay == 0` with no
//! representation: `(write_pos + len - 0) % len` is `write_pos`, the oldest
//! slot. A caller asking for the shortest delay got the longest one. On a
//! pre-delay line sized `sample_rate * 0.5` that is half a second.
//!
//! This file therefore asserts a **rendered outcome** rather than a delay
//! length. Pinning `predelay_len` to a number would have been green throughout
//! the defect — the field held 0, exactly as it should; it was the read that
//! turned 0 into 24 000. The only thing that could have caught it is listening
//! to the output and noticing it was not there yet, which is what these tests
//! do.
//!
//! #1560 established that this crate's guards only ever select the plate, so
//! both assertions here sweep every algorithm the `algorithm` wire value
//! actually selects. That is not decoration: the FDN pair reaches the same
//! Pre-Delay control through a completely separate inline implementation
//! (`fdn.rs`, `pd_read`), which reads *before* advancing its write position and
//! is correct — the sweep is what records that the two implementations agree,
//! and what would catch the next one that does not.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// Length of the exciting burst, in samples.
const BURST: usize = 512;

/// Blocks of silence rendered before the burst.
///
/// `mix` is smoothed with a 30 ms one-pole, so an engine told `mix = 1` still
/// passes a shrinking fraction of its dry input for some time afterwards. At
/// 400 blocks (1.07 s) that residue measures 3.4e-5 against a burst of 0.8 —
/// a stalled f32 ramp, not a decaying one, so waiting longer does not remove
/// it. The audibility floor below is three orders of magnitude above it, which
/// is what keeps a dry leak from being mistaken for engine output.
const PREROLL_BLOCKS: usize = 400;

/// Fraction of a render's own peak that counts as sounding.
///
/// Relative rather than absolute so an engine that happens to run quiet is
/// measured on its own terms, and so the threshold cannot be tuned to a
/// particular engine's level.
const AUDIBILITY_FRACTION: f32 = 1e-3;

/// Silence an engine may add on top of its Pre-Delay before it starts sounding.
///
/// Every engine puts something between the input and the first output sample:
/// the plate and the FDN pair tap early reflections whose first arrival is
/// `5 + size * 45` ms scaled by a tenth, which is 2.75 ms at the default Size
/// and 5 ms at Size 1.0. Measured, the plate and both FDNs start `155` samples
/// (3.23 ms) after their Pre-Delay expires at the default Size and `287`
/// samples (6.0 ms) at Size 1.0; Spring starts immediately.
///
/// 20 ms is a little over three times the largest of those and still
/// twenty-five times smaller than the 503 ms #1547 rendered, so the bound has
/// room for an engine that legitimately takes longer to build up without
/// having room for a pre-delay wired to the wrong end of its buffer.
const MAX_BUILD_UP_MS: f32 = 20.0;

/// Longest run of exact zeroes tolerated *inside* a sounding tail.
///
/// Not zero: a reverb tail crosses zero, and `DelayLine::write` truncates
/// magnitudes below 1e-18 to exactly 0.0 to kill limit cycles, so short runs
/// of true zeroes are expected near the noise floor. Spring's longest measured
/// run mid-tail is 12 samples; the plate, both FDNs and Reverse measure 0.
/// 5 ms is four hundred times the longest real one and fifty times shorter
/// than the shortest hole worth calling a hole.
const MAX_INTERIOR_ZERO_RUN_MS: f32 = 5.0;

/// What `set_param("algorithm", n)` actually selects. 4 and 5 are reserved for
/// the convolution-backed engines and fall through to Plate — see
/// `algorithm_wire_contract.rs`, which owns that claim.
const SELECTABLE: [(f32, &str); 5] = [
    (0.0, "Plate"),
    (1.0, "FDN-8"),
    (2.0, "FDN-16"),
    (3.0, "Spring"),
    (6.0, "Reverse"),
];

/// Algorithms whose output is expected to begin as soon as their Pre-Delay
/// expires.
///
/// Reverse is absent by construction, not by convenience. It fills a buffer for
/// `reverse_time` and then plays it backwards, so its first output is late by
/// design — measured at 41 088 samples (856 ms) with the burst above — and a
/// Pre-Delay bound applied to it would be asserting something else entirely.
/// `reverse_engine_character.rs` owns that engine's onset. It is still swept by
/// the interior-hole test below, where the claim does apply to it.
const PROMPT: [(f32, &str); 4] = [
    (0.0, "Plate"),
    (1.0, "FDN-8"),
    (2.0, "FDN-16"),
    (3.0, "Spring"),
];

struct Render {
    left: Vec<f32>,
    right: Vec<f32>,
}

impl Render {
    fn peak(&self) -> f32 {
        let l = self.left.iter().fold(0.0_f32, |a, b| a.max(b.abs()));
        self.right.iter().fold(l, |a, b| a.max(b.abs()))
    }

    fn floor(&self) -> f32 {
        self.peak() * AUDIBILITY_FRACTION
    }

    fn channels(&self) -> [(&'static str, &[f32]); 2] {
        [("left", &self.left), ("right", &self.right)]
    }
}

/// Render a burst through one algorithm at `mix = 1`, wet only.
fn render(algorithm: f32, settings: &[(&str, f32)], frames: usize) -> Render {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    instance.set_param("mix", 1.0);
    for (name, value) in settings {
        instance.set_param(name, *value);
    }

    let silence = [0.0_f32; BLOCK];
    for _ in 0..PREROLL_BLOCKS {
        instance.process(&silence, &silence, BLOCK as u32);
    }

    let mut left = Vec::with_capacity(frames);
    let mut right = Vec::with_capacity(frames);
    let mut index = 0;
    while index < frames {
        let block: Vec<f32> = (0..BLOCK)
            .map(|i| if index + i < BURST { 0.8 } else { 0.0 })
            .collect();
        let left_ptr = instance.process(&block, &block, BLOCK as u32);
        assert!(!left_ptr.is_null(), "process returned a null buffer");
        let right_ptr = instance.get_right_ptr();
        for i in 0..BLOCK {
            left.push(unsafe { *left_ptr.add(i) });
            right.push(unsafe { *right_ptr.add(i) });
        }
        index += BLOCK;
    }

    Render { left, right }
}

fn onset(channel: &[f32], floor: f32) -> Option<usize> {
    channel.iter().position(|s| s.abs() > floor)
}

fn last_sounding(channel: &[f32], floor: f32) -> Option<usize> {
    channel.iter().rposition(|s| s.abs() > floor)
}

/// `(start, length)` of the longest run of exact zeroes in `channel[from..to]`.
fn longest_zero_run(channel: &[f32], from: usize, to: usize) -> (usize, usize) {
    let mut best = (from, 0_usize);
    let mut start = from;
    let mut run = 0_usize;
    for index in from..to.min(channel.len()) {
        if channel[index] == 0.0 {
            if run == 0 {
                start = index;
            }
            run += 1;
            if run > best.1 {
                best = (start, run);
            }
        } else {
            run = 0;
        }
    }
    best
}

fn ms(samples: usize) -> f32 {
    samples as f32 * 1000.0 / SAMPLE_RATE
}

// ---------------------------------------------------------------------------

/// The #1547 assertion. Pre-Delay is declared from 0 ms; asking for the
/// minimum must not deliver the maximum.
#[test]
fn no_engine_stays_silent_longer_than_the_predelay_it_was_given() {
    let budget = (MAX_BUILD_UP_MS / 1000.0 * SAMPLE_RATE) as usize;

    for (algorithm, name) in PROMPT {
        for predelay_ms in [0.0_f32, 5.0, 25.0, 100.0] {
            for size in [0.0_f32, 0.75, 1.0] {
                let render = render(
                    algorithm,
                    &[("predelay", predelay_ms), ("size", size)],
                    48_000,
                );
                let floor = render.floor();
                assert!(
                    render.peak() > 1e-3,
                    "{name} at predelay {predelay_ms} ms, size {size} rendered \
                     nothing at all (peak {:e}); the onset measurement below \
                     would pass on silence",
                    render.peak()
                );

                let requested = (predelay_ms / 1000.0 * SAMPLE_RATE) as usize;
                let limit = requested + budget;

                for (side, channel) in render.channels() {
                    let started = onset(channel, floor).unwrap_or_else(|| {
                        panic!(
                            "{name} {side} never rose above {floor:e} in one \
                             second at predelay {predelay_ms} ms, size {size}"
                        )
                    });
                    assert!(
                        started <= limit,
                        "{name} {side} was silent for {started} samples \
                         ({:.1} ms) at Pre-Delay {predelay_ms} ms, Size {size}. \
                         Pre-Delay asked for {requested} samples ({predelay_ms:.1} \
                         ms) and the build-up budget allows {budget} more \
                         ({MAX_BUILD_UP_MS:.1} ms), so the output should have \
                         started by sample {limit}. It arrived {:.1} ms late. \
                         #1547: a delay line read at index 0 returning its \
                         oldest sample instead of its newest looks exactly like \
                         this.",
                        ms(started),
                        ms(started.saturating_sub(limit))
                    );
                }
            }
        }
    }
}

/// And no hole once it has started — the shape #1547 was reported as.
#[test]
fn no_engine_goes_silent_in_the_middle_of_its_own_tail() {
    let budget = (MAX_INTERIOR_ZERO_RUN_MS / 1000.0 * SAMPLE_RATE) as usize;

    for (algorithm, name) in SELECTABLE {
        for predelay_ms in [0.0_f32, 25.0] {
            let render = render(algorithm, &[("predelay", predelay_ms)], 240_000);
            let floor = render.floor();
            assert!(
                render.peak() > 1e-3,
                "{name} at predelay {predelay_ms} ms rendered nothing at all \
                 (peak {:e})",
                render.peak()
            );

            for (side, channel) in render.channels() {
                let Some(first) = onset(channel, floor) else {
                    panic!("{name} {side} never rose above {floor:e}");
                };
                let last = last_sounding(channel, floor)
                    .expect("a channel with an onset has a last sounding sample");
                assert!(
                    last > first + budget,
                    "{name} {side} sounds for only {} samples at predelay \
                     {predelay_ms} ms, which is shorter than the run this test \
                     looks for — the assertion below cannot fail",
                    last - first
                );

                let (start, length) = longest_zero_run(channel, first, last);
                assert!(
                    length <= budget,
                    "{name} {side} is exactly zero for {length} consecutive \
                     samples ({:.1} ms) from sample {start} ({:.3} s) at \
                     Pre-Delay {predelay_ms} ms, while its tail is still \
                     sounding — it is audible again at sample {last}. A reverb \
                     does not stop and restart. Budget is {budget} samples \
                     ({MAX_INTERIOR_ZERO_RUN_MS:.1} ms).",
                    ms(length),
                    start as f32 / SAMPLE_RATE
                );
            }
        }
    }
}

/// Anti-vacuity. Both tests above are searches for something that is not there,
/// so the search itself has to be shown to work.
#[test]
fn the_hole_detector_finds_a_hole_that_is_actually_there() {
    let mut tail: Vec<f32> = (0..20_000)
        .map(|i| (i as f32 * 0.31).sin() * (-(i as f32) / 6_000.0).exp())
        .collect();
    let intact = longest_zero_run(&tail, 0, tail.len());
    assert!(
        intact.1 < 4,
        "a decaying sinusoid should not contain a run of zeroes; found {} from \
         sample {}",
        intact.1,
        intact.0
    );

    for sample in tail.iter_mut().take(12_000).skip(4_000) {
        *sample = 0.0;
    }
    let punched = longest_zero_run(&tail, 0, tail.len());
    assert_eq!(
        punched,
        (4_000, 8_000),
        "the detector missed an 8 000-sample hole punched at sample 4 000"
    );

    // And the onset search has to be able to report a late start rather than
    // finding the first sample of anything.
    let mut late = vec![0.0_f32; 30_000];
    late[24_153] = 0.5;
    assert_eq!(
        onset(&late, 1e-3),
        Some(24_153),
        "the onset search did not report the one sounding sample it was given"
    );
}
