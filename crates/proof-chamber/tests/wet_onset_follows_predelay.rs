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

/// Rates every sweep in this file runs at.
///
/// One rate is not enough to guard #1547, and that is not a hypothetical. The
/// line the defect lived on is sized `sample_rate * 0.5`, and its length is the
/// only thing that decided how long the silence was — so a regression that
/// replaces that rate term with a literal `48_000.0` is invisible at 48 kHz by
/// construction. It is also invisible at 44.1 kHz to a *single-rate* version of
/// this file: the resulting 8.8 ms error hides inside `MAX_BUILD_UP_MS`'s 20 ms
/// budget, and adding a 500 ms row does not help either, because `.min(len - 1)`
/// clamps an over-long request back onto the buffer and the top of the control's
/// range is self-correcting.
///
/// What does catch it is running the same rows at two rates and comparing the
/// onset *in seconds*: a hard-coded buffer length makes the two disagree.
/// 44 100 is the other rate the product actually ships at, and it is not a
/// divisor or multiple of 48 000, so a length computed from the wrong one lands
/// on a non-integer number of samples rather than coincidentally matching.
const SAMPLE_RATES: [f32; 2] = [44_100.0, 48_000.0];
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
/// `5 + size * 45` ms scaled by a tenth, so the pattern starts later as the
/// room grows. Measured **on this test's own instrument** — the burst below, at
/// the audibility floor above, which is the only figure that governs this
/// bound — the plate, FDN-8 and FDN-16 all start
///
/// | Size | samples after Pre-Delay expires |
/// | ---- | ------------------------------- |
/// | 0.0  | 24 (0.5 ms)                     |
/// | 0.75 | 222 (4.6 ms)                    |
/// | 1.0  | 288 (6.0 ms)                    |
///
/// and Spring starts immediately at every Size. Quoting the instrument matters:
/// a first-non-zero measurement on an impulse puts the same onsets 156 samples
/// out at the default Size, and an earlier revision of this comment cited that
/// number to justify a threshold this test cannot measure.
///
/// 20 ms is a little over three times the largest of those and still
/// twenty-five times smaller than the 503 ms #1547 rendered, so the bound has
/// room for an engine that legitimately takes longer to build up without
/// having room for a pre-delay wired to the wrong end of its buffer.
const MAX_BUILD_UP_MS: f32 = 20.0;

/// Window length of the RMS envelope the interior-hole test measures.
const ENVELOPE_WINDOW_MS: f32 = 5.0;

/// How far below its own peak a tail's envelope may fall *while still
/// sounding* before the dip counts as a hole rather than a quiet moment.
///
/// Counting consecutive exact zeroes — the literal shape #1547 was reported as
/// — is the wrong instrument, and that is worth writing down because it was the
/// first thing tried here. Exact zeroes only appear when the whole signal path
/// has never been excited: the output stage's `LowCut` is an IIR, so once
/// anything has run through it, a hole in the middle of a tail rings down
/// through denormals instead of reaching 0.0. A mutation that feeds the tank
/// 500 ms late while leaving the early reflections prompt — #1547's reported
/// shape, exactly — produces an 18 000-sample window whose peak is 1.4e-18,
/// which is 307 dB down and contains not one exact zero. A zero-run test is
/// green on it. This one is not.
///
/// So the criterion is level. Measured on a 5 ms RMS envelope, the quietest
/// interior window of a real render sits at -66.4 dB (Plate), -70.0 dB (FDN-8)
/// and -67.0 dB (FDN-16) relative to that render's envelope peak — all of them
/// just under the -60 dB line that defines where the tail ends, which is where
/// you would expect the minimum of a decaying tail to be. The mutation above
/// measures -307 dB. -120 dB sits 50 dB below the quietest real window and
/// 187 dB above the hole, which is the widest separation the two populations
/// allow.
const HOLE_FLOOR_DB: f32 = -120.0;

/// How far apart the same onset may land on the clock at two sample rates.
/// Sized from the measured spread — see
/// `onset_lands_at_the_same_time_on_the_clock_at_every_rate`.
const CROSS_RATE_TOLERANCE_MS: f32 = 0.1;

/// Algorithms whose output is expected to begin as soon as their Pre-Delay
/// expires.
///
/// This is four of the five values `set_param("algorithm", n)` actually
/// selects — 4 and 5 are reserved for the convolution-backed engines and fall
/// through to Plate, which `algorithm_wire_contract.rs` owns.
///
/// Reverse (6) is absent by construction, not by convenience. It fills a buffer
/// for `reverse_time` and then plays it backwards, so its first output is late
/// by design — measured at 41 088 samples (856 ms) with the burst below — and a
/// Pre-Delay bound applied to it would be asserting something else entirely.
/// `reverse_engine_character.rs` owns that engine's onset.
///
/// **Spring's twelve rows here are floor-only and inert, and cannot fail.**
/// The bound is one-sided — it asks whether an engine is *late*, which is the
/// #1547 shape — and Spring starts at sample 0 for every Pre-Delay from 0 to
/// 100 ms and every Size, because it never reads the control at all. Those rows
/// would stay green if its Pre-Delay wiring were deleted outright. They are
/// kept because a future Spring that acquires a pre-delay and wires it to the
/// wrong end of a buffer would red here, and removing the rows would remove
/// that. What they are not is evidence that Spring's Pre-Delay works.
/// `spring_onset_tracks_the_predelay_it_was_given` below is that claim, and it
/// is `#[ignore]`d because it does not.
const PROMPT: [(f32, &str); 4] = [
    (0.0, "Plate"),
    (1.0, "FDN-8"),
    (2.0, "FDN-16"),
    (3.0, "Spring"),
];

/// Algorithms whose tail is expected to be continuous once it starts.
///
/// Two absences, both measured rather than assumed.
///
/// **Spring** does not have a continuous tail. Measured on the left channel of
/// the burst below — 5 ms RMS windows, hop equal to the window so they do not
/// overlap, each expressed in dB relative to the loudest window of the same
/// render — its envelope peaks every 300 ms at 0.0, -8.2, -14.6, -21.2, -28.4
/// and -39.1 dB (0.0, 0.3, 0.6, 0.9, 1.2 and 1.5 s), and the space between
/// those repeats falls to -102.9, -155.0, -207.1, -259.2 and -316.3 dB, with
/// two windows exactly zero. The window convention is part of the claim and is
/// stated because it moves the numbers: a longer or overlapping window smears
/// each repeat into the gap beside it and lifts the between-repeat minima by
/// something like 18 dB, which changes how bad it looks without changing what
/// it is.
///
/// A spring tank does repeat, but with dispersive noise between the repeats
/// rather than nothing, so this looks like the same class of defect on a
/// different engine. It is not #1547's and it is not fixed here: it is filed
/// separately, and this exclusion is where it should be deleted from when it is
/// answered.
///
/// **Reverse** sounds for 25 ms in total — it plays a reversed copy of the
/// 512-sample burst — which is shorter than the dip this test looks for. There
/// is no interior to inspect. `reverse_engine_character.rs` owns that engine.
const CONTINUOUS: [(f32, &str); 3] = [(0.0, "Plate"), (1.0, "FDN-8"), (2.0, "FDN-16")];

struct Render {
    left: Vec<f32>,
    right: Vec<f32>,
    sample_rate: f32,
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

    /// Seconds, so two rates can be compared against one another rather than
    /// each against its own sample count.
    fn seconds(&self, samples: usize) -> f32 {
        samples as f32 / self.sample_rate
    }

    fn ms(&self, samples: usize) -> f32 {
        self.seconds(samples) * 1000.0
    }

    fn samples_in_ms(&self, milliseconds: f32) -> usize {
        (milliseconds / 1000.0 * self.sample_rate) as usize
    }

    fn envelope(&self, channel: &[f32]) -> Vec<f32> {
        envelope_at(channel, self.sample_rate)
    }
}

/// Render a burst through one algorithm at `mix = 1`, wet only.
fn render(sample_rate: f32, algorithm: f32, settings: &[(&str, f32)], frames: usize) -> Render {
    let mut instance = ProofChamberInstance::new(sample_rate);
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

    Render {
        left,
        right,
        sample_rate,
    }
}

fn onset(channel: &[f32], floor: f32) -> Option<usize> {
    channel.iter().position(|s| s.abs() > floor)
}

fn last_sounding(channel: &[f32], floor: f32) -> Option<usize> {
    channel.iter().rposition(|s| s.abs() > floor)
}

/// RMS in fixed-length windows. The envelope, not the waveform: a tail crosses
/// zero on every cycle, so an instantaneous level says nothing about whether
/// the reverb is still there.
///
/// The window is a duration, so it holds the same span of time at every rate
/// and the dB figures below mean one thing across the sweep.
fn envelope_at(channel: &[f32], sample_rate: f32) -> Vec<f32> {
    let window = (ENVELOPE_WINDOW_MS / 1000.0 * sample_rate) as usize;
    channel
        .chunks(window)
        .map(|chunk| (chunk.iter().map(|s| s * s).sum::<f32>() / chunk.len() as f32).sqrt())
        .collect()
}

fn db_below(value: f32, reference: f32) -> f32 {
    if value <= 0.0 {
        return f32::NEG_INFINITY;
    }
    20.0 * (value / reference).log10()
}

// ---------------------------------------------------------------------------

/// The #1547 assertion. Pre-Delay is declared from 0 ms; asking for the
/// minimum must not deliver the maximum.
#[test]
fn no_engine_stays_silent_longer_than_the_predelay_it_was_given() {
    for sample_rate in SAMPLE_RATES {
        for (algorithm, name) in PROMPT {
            for predelay_ms in [0.0_f32, 5.0, 25.0, 100.0] {
                for size in [0.0_f32, 0.75, 1.0] {
                    let render = render(
                        sample_rate,
                        algorithm,
                        &[("predelay", predelay_ms), ("size", size)],
                        sample_rate as usize,
                    );
                    let floor = render.floor();
                    assert!(
                        render.peak() > 1e-3,
                        "{name} at {sample_rate} Hz, predelay {predelay_ms} ms, \
                         size {size} rendered nothing at all (peak {:e}); the \
                         onset measurement below would pass on silence",
                        render.peak()
                    );

                    let budget = render.samples_in_ms(MAX_BUILD_UP_MS);
                    let requested = render.samples_in_ms(predelay_ms);
                    let limit = requested + budget;

                    for (side, channel) in render.channels() {
                        let started = onset(channel, floor).unwrap_or_else(|| {
                            panic!(
                                "{name} {side} never rose above {floor:e} in one \
                                 second at {sample_rate} Hz, predelay \
                                 {predelay_ms} ms, size {size}"
                            )
                        });
                        assert!(
                            started <= limit,
                            "{name} {side} was silent for {started} samples \
                             ({:.1} ms) at {sample_rate} Hz, Pre-Delay \
                             {predelay_ms} ms, Size {size}. Pre-Delay asked for \
                             {requested} samples ({predelay_ms:.1} ms) and the \
                             build-up budget allows {budget} more \
                             ({MAX_BUILD_UP_MS:.1} ms), so the output should \
                             have started by sample {limit}. It arrived {:.1} ms \
                             late. #1547: a delay line read at index 0 returning \
                             its oldest sample instead of its newest looks \
                             exactly like this.",
                            render.ms(started),
                            render.ms(started.saturating_sub(limit))
                        );
                    }
                }
            }
        }
    }
}

/// The rate-independence claim itself, which the sweep above cannot make.
///
/// Every row above compares an onset against a budget derived from *its own*
/// rate, so a length hard-coded to one rate shifts the measurement and the
/// budget together at that rate and hides inside the budget at the other.
/// Comparing the two rates against **each other**, in seconds, is what removes
/// that freedom: a buffer whose length stopped following `sample_rate` puts the
/// two onsets in different places on the clock.
///
/// The tolerance is sized from the spread the engines actually show, not from a
/// round number. Measured across all sixteen rows below, the largest
/// disagreement between 44.1 and 48 kHz at head is **0.0187 ms** — under one
/// sample at either rate, which is the rounding in `scale_delay` and the
/// early-reflection tap table, both integer sample counts derived from a rate
/// ratio. `CROSS_RATE_TOLERANCE_MS` is 0.1, five times that and no more.
///
/// The first draft used 1 ms, which is fifty times the real spread, and it was
/// too loose to be worth having: a hard-coded 48 kHz in the early-reflection
/// tap table produces a 0.29 ms discrepancy and passed. It reds at 0.1.
#[test]
fn onset_lands_at_the_same_time_on_the_clock_at_every_rate() {
    for (algorithm, name) in PROMPT {
        for predelay_ms in [0.0_f32, 5.0, 25.0, 100.0] {
            let mut measured: Vec<(f32, f32)> = Vec::new();
            for sample_rate in SAMPLE_RATES {
                let render = render(
                    sample_rate,
                    algorithm,
                    &[("predelay", predelay_ms)],
                    sample_rate as usize,
                );
                let floor = render.floor();
                let started = onset(&render.left, floor).unwrap_or_else(|| {
                    panic!("{name} never sounded at {sample_rate} Hz, predelay {predelay_ms} ms")
                });
                measured.push((sample_rate, render.seconds(started)));
            }

            let (first_rate, first) = measured[0];
            for &(rate, seconds) in &measured[1..] {
                assert!(
                    (seconds - first).abs() * 1000.0 < CROSS_RATE_TOLERANCE_MS,
                    "{name} starts {first:.5} s after the burst at {first_rate} Hz \
                     but {seconds:.5} s at {rate} Hz, a difference of {:.4} ms \
                     against a tolerance of {CROSS_RATE_TOLERANCE_MS} ms, at \
                     Pre-Delay {predelay_ms} ms. A delay whose length stopped \
                     following the sample rate reads exactly like this — and the \
                     lateness sweep cannot see it, because it scales its own \
                     budget by the same rate.",
                    (seconds - first).abs() * 1000.0
                );
            }
        }
    }
}

/// Spring's Pre-Delay is not wired, and this is the row that says so.
///
/// The sweep above cannot make this claim: it bounds lateness only, and Spring
/// is never late. So the claim is stated separately and two-sided — the onset
/// has to *track* the control — and it is `#[ignore]`d rather than deleted,
/// because a test that names the defect and is skipped is a smaller lie than a
/// green row that appears to cover an engine it cannot see.
///
/// Measured today: onset 0 at Pre-Delay 0, 5, 25 and 100 ms, at every Size.
/// The three tank engines all move to `predelay + 222` at the default Size.
/// Delete the attribute when Spring reads the control; this test is then the
/// proof that it does.
#[test]
#[ignore = "Spring ignores predelay entirely. Found while fixing #1547 and NOT \
            filed as an issue — this attribute and the CONTINUOUS doc are the \
            only record it has. Un-ignore it if you wire Spring's predelay; \
            open an issue if you do not."]
fn spring_onset_tracks_the_predelay_it_was_given() {
    const SPRING: f32 = 3.0;
    for sample_rate in SAMPLE_RATES {
        let prompt = render(
            sample_rate,
            SPRING,
            &[("predelay", 0.0)],
            sample_rate as usize,
        );
        let delayed = render(
            sample_rate,
            SPRING,
            &[("predelay", 100.0)],
            sample_rate as usize,
        );

        let prompt_onset =
            onset(&prompt.left, prompt.floor()).expect("Spring sounds at Pre-Delay 0");
        let delayed_onset =
            onset(&delayed.left, delayed.floor()).expect("Spring sounds at Pre-Delay 100 ms");

        let requested = delayed.samples_in_ms(100.0);
        let moved = delayed_onset.saturating_sub(prompt_onset);
        let tolerance = delayed.samples_in_ms(MAX_BUILD_UP_MS);
        assert!(
            moved.abs_diff(requested) <= tolerance,
            "Spring's onset moved {moved} samples ({:.1} ms) at {sample_rate} Hz \
             when Pre-Delay moved from 0 to 100 ms — it should have moved \
             {requested} ({:.1} ms). Onsets: {prompt_onset} and {delayed_onset}.",
            delayed.ms(moved),
            delayed.ms(requested)
        );
    }
}

/// And no hole once it has started — the shape #1547 was reported as.
#[test]
fn no_engine_goes_silent_in_the_middle_of_its_own_tail() {
    for sample_rate in SAMPLE_RATES {
        for (algorithm, name) in CONTINUOUS {
            for predelay_ms in [0.0_f32, 25.0] {
                let render = render(
                    sample_rate,
                    algorithm,
                    &[("predelay", predelay_ms)],
                    (sample_rate * 5.0) as usize,
                );
                assert!(
                    render.peak() > 1e-3,
                    "{name} at {sample_rate} Hz, predelay {predelay_ms} ms rendered \
                 nothing at all (peak {:e})",
                    render.peak()
                );

                for (side, channel) in render.channels() {
                    let envelope = render.envelope(channel);
                    let envelope_peak = envelope.iter().fold(0.0_f32, |a, b| a.max(*b));
                    let sounding = envelope_peak * AUDIBILITY_FRACTION;

                    let Some(first) = envelope.iter().position(|w| *w > sounding) else {
                        panic!("{name} {side} never rose above {sounding:e}");
                    };
                    let last = envelope
                        .iter()
                        .rposition(|w| *w > sounding)
                        .expect("a tail with a first window has a last one");
                    assert!(
                        last > first + 4,
                        "{name} {side} sounds for only {} windows at predelay \
                     {predelay_ms} ms — there is no interior for the dip below \
                     to be found in, so this row cannot fail",
                        last - first
                    );

                    let (quietest, level) = envelope[first..=last].iter().enumerate().fold(
                        (first, f32::MAX),
                        |(qi, qv), (i, v)| {
                            if *v < qv {
                                (first + i, *v)
                            } else {
                                (qi, qv)
                            }
                        },
                    );
                    let dip = db_below(level, envelope_peak);
                    assert!(
                        dip > HOLE_FLOOR_DB,
                        "{name} {side} falls to {dip:.1} dB below its own peak at \
                     {:.3} s, in the middle of a tail that is still sounding at \
                     {:.3} s. That is a hole, not a quiet moment: the floor is \
                     {HOLE_FLOOR_DB:.1} dB and the quietest window of an intact \
                     render of this engine measures around -70 dB. \
                     {sample_rate} Hz, Pre-Delay {predelay_ms} ms.",
                        quietest as f32 * ENVELOPE_WINDOW_MS / 1000.0,
                        last as f32 * ENVELOPE_WINDOW_MS / 1000.0
                    );
                }
            }
        }
    }
}

/// Anti-vacuity. Both tests above are searches for something that is not there,
/// so the searches themselves have to be shown to work.
#[test]
fn the_measurements_report_a_hole_and_a_late_start_that_are_actually_there() {
    let intact: Vec<f32> = (0..48_000)
        .map(|i| (i as f32 * 0.31).sin() * (-(i as f32) / 12_000.0).exp())
        .collect();
    let reference = envelope_at(&intact, 48_000.0);
    let reference_peak = reference.iter().fold(0.0_f32, |a, b| a.max(*b));
    let sounding = reference_peak * AUDIBILITY_FRACTION;
    let last = reference
        .iter()
        .rposition(|w| *w > sounding)
        .expect("a decaying sinusoid sounds");
    let intact_dip = reference[..=last].iter().fold(f32::MAX, |a, b| a.min(*b));
    assert!(
        db_below(intact_dip, reference_peak) > HOLE_FLOOR_DB,
        "a smoothly decaying sinusoid measured {:.1} dB down inside its own \
         sounding span, so the floor would flag an intact tail",
        db_below(intact_dip, reference_peak)
    );

    // The same tail with a quarter-second punched out — not to zero, but to the
    // 1e-18 an IIR ringdown actually reaches, which is what a zero-run test
    // misses and this one must not.
    let mut punched = intact.clone();
    for sample in punched.iter_mut().take(24_000).skip(12_000) {
        *sample = 1e-18;
    }
    let holed = envelope_at(&punched, 48_000.0);
    let holed_peak = holed.iter().fold(0.0_f32, |a, b| a.max(*b));
    let holed_last = holed
        .iter()
        .rposition(|w| *w > holed_peak * AUDIBILITY_FRACTION)
        .expect("the punched tail still sounds after the hole");
    assert!(
        holed_last * (ENVELOPE_WINDOW_MS / 1000.0 * 48_000.0) as usize > 24_000,
        "the punched tail stopped sounding before the hole ended, so the dip \
         below would not be inside the sounding span"
    );
    let holed_dip = holed[..=holed_last].iter().fold(f32::MAX, |a, b| a.min(*b));
    assert!(
        db_below(holed_dip, holed_peak) < HOLE_FLOOR_DB,
        "a quarter-second punched down to 1e-18 measured only {:.1} dB down, so \
         the floor cannot see a hole it is supposed to catch",
        db_below(holed_dip, holed_peak)
    );

    // And the onset search has to report a late start rather than finding the
    // first sample of anything. 24 153 is the run #1547 actually rendered.
    let mut late = vec![0.0_f32; 30_000];
    late[24_153] = 0.5;
    assert_eq!(
        onset(&late, 1e-3),
        Some(24_153),
        "the onset search did not report the one sounding sample it was given"
    );
    assert_eq!(
        last_sounding(&late, 1e-3),
        Some(24_153),
        "the tail-end search did not report the one sounding sample it was given"
    );
}
