//! Is Reverse audibly a different engine, or is it another way to spell Plate?
//!
//! Exposing an algorithm is only worth doing if a listener can tell it apart
//! from the ones already on the selector, so this measures the difference
//! rather than asserting that the engine runs.
//!
//! Two properties define a reverse reverb, and neither is a matter of taste:
//!
//! * **Onset.** It buffers a whole reverse time before it plays anything, so
//!   its response to a transient arrives most of a second late. Every forward
//!   reverb responds within milliseconds.
//! * **Shape.** It replays that buffer backwards, so a decaying input comes
//!   back as a rising swell — the energy sits at the *end* of the response.
//!   Every forward reverb decays, with the energy at the start. That swell is
//!   the entire reason the effect exists.
//!
//! The stimulus is one exponentially decaying tone rather than a pair of
//! transients. An earlier draft used two bursts, and the second burst inflated
//! every forward engine's centroid enough to make plate ambiguous (0.439
//! against reverse's 0.841). A single decaying envelope has nothing in it to
//! confound the shape measurement: whatever comes out rising was reversed.
//!
//! Everything runs at `mix = 1.0`, so the measurement is the engine's output
//! and not the dry signal passing through it.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const AUDIBLE: f32 = 1e-3;

/// The engines a user can already select, by wire value.
const EXPOSED_FORWARD: [(f32, &str); 4] = [
    (0.0, "plate"),
    (1.0, "fdn-8"),
    (2.0, "fdn-16"),
    (3.0, "spring"),
];
const REVERSE: f32 = 6.0;

/// A decaying 330 Hz tone, fully contained in one 0.5 s reverse buffer
/// (24 000 samples at 48 kHz) so the reversal has the whole envelope to work
/// with. The lead-in of silence keeps the forward engines' onset measurably
/// above zero.
const TONE_START: usize = 1_000;
const TONE_LEN: usize = 20_000;
const TONE_HZ: f32 = 330.0;
const TONE_DECAY_SAMPLES: f32 = 4_000.0;
const TONE_AMP: f32 = 0.9;
const RENDER_FRAMES: usize = 120_000;

fn stimulus(index: usize) -> f32 {
    if !(TONE_START..TONE_START + TONE_LEN).contains(&index) {
        return 0.0;
    }
    let elapsed = (index - TONE_START) as f32;
    let envelope = (-elapsed / TONE_DECAY_SAMPLES).exp();
    let phase = index as f32 / SAMPLE_RATE * TONE_HZ * std::f32::consts::TAU;
    TONE_AMP * envelope * phase.sin()
}

struct Response {
    onset: usize,
    peak: f32,
    /// Where the response's energy sits within the window that starts at its
    /// onset, as a fraction of that window. Reported for context; the
    /// assertions use `rise`, because a plate's tail outlasts the window and
    /// leaves its centroid near 0.5 — flat rather than decaying.
    centroid: f32,
    /// RMS of the last quarter of the response window over RMS of the first
    /// quarter. Above 1 the response grows; at or below 1 it does not. This
    /// is the swell, stated as a number.
    rise: f32,
    output: Vec<f32>,
}

/// Render the stimulus through one engine.
///
/// `size` is the caller's choice because Reverse reads it as its buffer
/// length. The forward engines read it as room size, where it changes the
/// voicing but not the arrival time or the direction of the envelope — the
/// two things measured here.
fn render(algorithm: f32, size: f32) -> Response {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    instance.set_param("mix", 1.0);
    instance.set_param("decay", 0.7);
    instance.set_param("size", size);

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

    let onset = output
        .iter()
        .position(|s| s.abs() > AUDIBLE)
        .unwrap_or_else(|| panic!("algorithm {algorithm} produced no audible output"));
    let peak = output.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()));

    Response {
        onset,
        peak,
        centroid: energy_centroid(&output, onset),
        rise: envelope_rise(&output, onset),
        output,
    }
}

/// One tone-length plus a margin for the tail, so every engine is measured
/// over the same duration regardless of when its response starts.
const WINDOW_LEN: usize = TONE_LEN + 2_000;

/// Energy-weighted centre of mass over `[onset, onset + WINDOW_LEN)`,
/// expressed as a fraction of that window.
fn energy_centroid(output: &[f32], onset: usize) -> f32 {
    let end = (onset + WINDOW_LEN).min(output.len());
    let window = &output[onset..end];
    let mut weighted = 0.0_f64;
    let mut total = 0.0_f64;
    for (i, sample) in window.iter().enumerate() {
        let energy = f64::from(*sample) * f64::from(*sample);
        weighted += energy * i as f64;
        total += energy;
    }
    if total <= 0.0 {
        return 0.0;
    }
    (weighted / total / window.len() as f64) as f32
}

/// How much louder the end of the response is than its beginning: RMS of the
/// last quarter of the window over RMS of the first quarter.
///
/// This is the swell measured directly. The centroid above cannot carry the
/// assertion on its own, because a plate's tail is longer than the window and
/// so spreads its energy almost evenly — that reads as ~0.5, indistinguishable
/// from "flat" and uncomfortably close to a swell's threshold. A ratio says
/// the thing that matters without needing the tail to have ended: a forward
/// reverb never gets louder as it goes.
fn envelope_rise(output: &[f32], onset: usize) -> f32 {
    let end = (onset + WINDOW_LEN).min(output.len());
    let window = &output[onset..end];
    let quarter = window.len() / 4;
    assert!(quarter > 0, "response window too short to measure a slope");

    let rms = |xs: &[f32]| {
        (xs.iter()
            .map(|s| f64::from(*s) * f64::from(*s))
            .sum::<f64>()
            / xs.len() as f64)
            .sqrt()
    };
    let first = rms(&window[..quarter]).max(1e-12);
    let last = rms(&window[window.len() - quarter..]);
    (last / first) as f32
}

fn ms(samples: usize) -> f32 {
    samples as f32 * 1000.0 / SAMPLE_RATE
}

/// Root-mean-square difference between two renders, normalised by the louder
/// one's RMS. 0 means identical; 1 means they differ by as much as the signal
/// itself is large.
fn normalised_difference(a: &[f32], b: &[f32]) -> f32 {
    let len = a.len().min(b.len());
    let rms = |xs: &[f32]| (xs.iter().map(|s| s * s).sum::<f32>() / len as f32).sqrt();
    let diff: Vec<f32> = (0..len).map(|i| a[i] - b[i]).collect();
    let reference = rms(&a[..len]).max(rms(&b[..len])).max(1e-12);
    rms(&diff) / reference
}

/// Reverse holds a whole buffer before it plays anything. At its shortest
/// setting that is half a second; every forward engine answers immediately.
#[test]
fn reverse_answers_a_transient_late_where_every_forward_engine_answers_at_once() {
    let reverse = render(REVERSE, 0.0);

    for (algorithm, name) in EXPOSED_FORWARD {
        let forward = render(algorithm, 0.5);
        assert!(
            ms(forward.onset) < 50.0,
            "{name} took {:.1} ms to respond. A forward reverb answers a transient immediately, \
             so this is not comparing what it claims to compare.",
            ms(forward.onset)
        );
        assert!(
            reverse.onset > forward.onset * 8,
            "reverse responded at {:.1} ms and {name} at {:.1} ms — not the order-of-magnitude \
             separation that makes reverse a distinct engine rather than a re-voiced one",
            ms(reverse.onset),
            ms(forward.onset)
        );
    }

    assert!(
        ms(reverse.onset) > 500.0,
        "reverse responded after only {:.1} ms, so it is not buffering a reverse time",
        ms(reverse.onset)
    );
}

/// A decaying input comes back rising. This is the property no forward reverb
/// reproduces at any setting, and it is what a listener hears.
#[test]
fn reverse_turns_a_decaying_input_into_a_swell_where_forward_engines_never_grow() {
    let reverse = render(REVERSE, 0.0);

    assert!(
        reverse.rise > 4.0,
        "reverse ended its response only {:.2}x the level it started at. Fed a decaying tone it \
         must come back growing, or the buffer was not replayed backwards.",
        reverse.rise
    );

    for (algorithm, name) in EXPOSED_FORWARD {
        let forward = render(algorithm, 0.5);
        assert!(
            forward.rise <= 1.0,
            "{name} ended its response {:.2}x louder than it started. A forward reverb decays \
             into its tail; one that grows would mean this measurement is not isolating the \
             reversal.",
            forward.rise
        );
        assert!(
            reverse.rise > forward.rise * 4.0,
            "reverse's envelope slope ({:.2}x) is not clearly the opposite of {name}'s \
             ({:.2}x), so the two would not read as different engines",
            reverse.rise,
            forward.rise
        );
    }
}

/// A blunt whole-render comparison, kept as a backstop: whatever the engines
/// do in detail, their outputs must not be substantially the same signal.
#[test]
fn reverse_output_is_not_a_near_copy_of_any_exposed_engine() {
    let reverse = render(REVERSE, 0.0);

    for (algorithm, name) in EXPOSED_FORWARD {
        let forward = render(algorithm, 0.5);
        let difference = normalised_difference(&reverse.output, &forward.output);
        assert!(
            difference > 0.5,
            "reverse and {name} differ by only {difference:.3} of their own amplitude, which is \
             close enough that exposing reverse would ship a duplicate"
        );
    }
}

/// Prints the table quoted in the change description. The three tests above
/// carry the assertions; this exists so the numbers stay reproducible.
#[test]
fn measurement_table() {
    let reverse = render(REVERSE, 0.0);
    println!(
        "{:<10} {:>11} {:>9} {:>10} {:>9} {:>12}",
        "engine", "onset (ms)", "peak", "centroid", "rise", "vs reverse"
    );
    println!(
        "{:<10} {:>11.1} {:>9.4} {:>10.3} {:>8.2}x {:>12}",
        "reverse",
        ms(reverse.onset),
        reverse.peak,
        reverse.centroid,
        reverse.rise,
        "-"
    );
    for (algorithm, name) in EXPOSED_FORWARD {
        let forward = render(algorithm, 0.5);
        println!(
            "{:<10} {:>11.1} {:>9.4} {:>10.3} {:>8.2}x {:>12.3}",
            name,
            ms(forward.onset),
            forward.peak,
            forward.centroid,
            forward.rise,
            normalised_difference(&reverse.output, &forward.output)
        );
    }
}
