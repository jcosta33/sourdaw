//! Bacteria's Position control must delay the grain stream by what it says.
//!
//! #1570: `spawn_grain` counted back from a `write_pos` that `process_sample`
//! had already advanced, so `offset == 0` landed on the slot about to be
//! overwritten — the oldest sample in a two-second ring. Position's declared
//! minimum is 0 ms, so the control's "off" position played audio from two
//! seconds ago, and every other setting was one sample short.
//!
//! What this file asserts is the **rendered outcome** at the device boundary:
//! a burst put into `BacteriaEngine` comes back out `offset` milliseconds
//! later, and at Position 0 ms it comes back out *now*. It deliberately does
//! not assert that an index expression equals a formula — the pointer was
//! always right and the count back from it was not, so a test written against
//! the arithmetic would have been green throughout the defect.
//!
//! `granular.rs`'s own `mod tests` covers the primitive on a counting ramp.
//! That layer is the one that can see a **one-sample** error; the windowed
//! envelope below cannot, and the mutation table in the PR shows the split.

use daw_dsp::bacteria::engine::BacteriaEngine;

/// RMS window, in samples at 48 kHz. One millisecond — short enough that the
/// window quantisation is inside the tolerance below, long enough that a lone
/// impulse still registers (a unit sample in a 48-sample window reads 0.144
/// RMS, ~50 dB clear of the floor).
const WINDOW: usize = 48;

/// How far the measured onset may sit from the requested Position.
///
/// The reproduction is not approximate: a grain spawned at any sample `s`
/// reads slot `s - offset + progress` at time `s + progress`, so it replays
/// the input at exactly `t_input + offset` no matter which grain catches it.
/// Measured on the fixed tree, the **exact first non-zero sample** after the
/// burst equalled the requested offset on all 36 rows of the sweep below, at
/// both sample rates. The entire budget is therefore the envelope's own
/// quantisation: the largest gap between the requested offset and the window
/// this instrument reports is **6 samples (0.136 ms)**, at 44.1 kHz where a
/// 1 ms window is 44 samples and 22 050 is not a multiple of it.
///
/// 3 ms is ~22x that, deliberately: the point of the slack is that a re-tuned
/// grain scheduler which shifts an onset by a fraction of a window should not
/// red this file, which is not an instrument for one sample. For scale on the
/// other side, the defect this guards against moved Position 0 ms by
/// 1999.98 ms — 660x the tolerance.
const TOLERANCE_MS: f32 = 3.0;

/// Onset floor, in dB below the render's own peak.
///
/// Relative rather than absolute because the granular stage sums overlapping
/// grains without normalising, so the reproduction's level is a function of
/// grain size and density: peak envelope runs 0.289 to 0.603 across the rows
/// here, a 6.4 dB spread, and a wider cloud would widen it further.
///
/// Measured separation on the fixed tree: on all 36 rows the envelope before
/// the reported onset is **exactly 0.0**, and so is the whole pre-burst
/// stretch of the render — with `grainMix` at 1 nothing but grains reaches the
/// output and the ring holds silence until the burst. −60 dB is therefore not
/// separating two close populations; it is slack against a future dry leak or
/// denormal tail putting something small ahead of the reproduction.
///
/// It is a *floor*, not a zero-run count, for the reason #1569 established:
/// a signal path that has run through any IIR stage rings down through
/// denormals instead of reaching exact zero, so "count the zeroes" measures
/// whether a filter is in the path rather than whether the device is silent.
const ONSET_FLOOR_DB: f32 = -60.0;

/// A granular cloud only reproduces a transient if a grain is alive across it.
/// A grain spawned at `s` covers the input at `t` when
/// `t + offset - grain_size < s <= t + offset`, so the cloud catches every
/// transient exactly when `grain_size >= sample_rate / density`. Every row
/// here satisfies that with room to spare; the ratio is stated so a future row
/// that violates it is recognisable as a coverage gap rather than a defect.
/// (Position 100 ms at 10 ms grains and 15 g/s — 31% duty — reproduces
/// nothing at all, before this fix and after it. That is granular sparsity,
/// not scheduling.)
struct Cloud {
    grain_size_ms: f32,
    density: f32,
}

const CLOUDS: [Cloud; 3] = [
    // 8 grains overlapping.
    Cloud {
        grain_size_ms: 200.0,
        density: 40.0,
    },
    // 4 overlapping, the shortest grain that still covers.
    Cloud {
        grain_size_ms: 40.0,
        density: 100.0,
    },
    // 7 overlapping at the shipped default density.
    Cloud {
        grain_size_ms: 500.0,
        density: 15.0,
    },
];

/// Positions swept. 0 is the declared minimum and the whole of #1570; 100 is
/// the shipped default; 200 is the only value any shipped preset sets.
const POSITIONS_MS: [f32; 6] = [0.0, 1.0, 10.0, 100.0, 200.0, 500.0];

/// Where the burst is placed. Far enough in that the grain stream is in steady
/// state and the spawn phase is not a variable.
const BURST_AT_MS: f32 = 1000.0;

struct Render {
    left: Vec<f32>,
    burst_at: usize,
}

/// Drive one band of `BacteriaEngine` with granular fully wet and a single
/// unit impulse at [`BURST_AT_MS`].
fn render(sample_rate: f32, position_ms: f32, cloud: &Cloud, tail_ms: f32) -> Render {
    let mut engine = BacteriaEngine::new(sample_rate);
    engine.set_param("bandCount", 1.0);
    engine.set_param("band0_granularEnabled", 1.0);
    engine.set_param("band0_grainMix", 1.0);
    // Pitch is pinned at 0 and is not a swept dimension, for a reason that is
    // a property of the device rather than of this test. At `grainPitch != 0`
    // a grain's read head advances by `pitch_ratio` per sample while the write
    // head advances by one, so Position stops being a delay: it is a start
    // offset, and when the grain replays a given input sample depends on which
    // grain caught it. Worse for an impulse probe specifically, the read is
    // `grain.read_pos as usize` with no interpolation, so at +12 st the head
    // steps two slots at a time and visits only every other one — a one-sample
    // impulse is then hit or missed by parity. Measured onsets at Position
    // 100 ms wander accordingly (+12 st: 2399 before this fix, 3999 after),
    // which is the probe failing, not the scheduler. A pitched Position needs
    // a sustained stimulus and its own criterion; it is not covered here.
    engine.set_param("band0_grainPitch", 0.0);
    engine.set_param("band0_grainSize", cloud.grain_size_ms);
    engine.set_param("band0_grainDensity", cloud.density);
    engine.set_param("band0_grainPosOffset", position_ms);

    let burst_at = (BURST_AT_MS * 0.001 * sample_rate) as usize;
    let len = burst_at + (tail_ms * 0.001 * sample_rate) as usize;
    let mut left = vec![0.0_f32; len];
    let mut right = vec![0.0_f32; len];
    left[burst_at] = 1.0;
    right[burst_at] = 1.0;

    // Block-rate, as the worklet drives it.
    for start in (0..len).step_by(128) {
        let end = (start + 128).min(len);
        engine.process_block(&mut left[start..end], &mut right[start..end]);
    }

    Render { left, burst_at }
}

/// RMS in non-overlapping [`WINDOW`]-sample windows, scaled with the rate so a
/// window is one millisecond at every sample rate.
fn envelope(buf: &[f32], sample_rate: f32) -> (Vec<f32>, usize) {
    let window = (WINDOW as f32 * sample_rate / 48_000.0).round() as usize;
    let envelope = buf
        .chunks(window)
        .map(|chunk| {
            let sum: f32 = chunk.iter().map(|s| s * s).sum();
            (sum / chunk.len() as f32).sqrt()
        })
        .collect();
    (envelope, window)
}

/// First sample at which the render is sounding, or `None` if it never is.
fn onset(buf: &[f32], sample_rate: f32) -> Option<usize> {
    let (envelope, window) = self::envelope(buf, sample_rate);
    let peak = envelope.iter().fold(0.0_f32, |a, &b| a.max(b));
    if peak <= 0.0 {
        return None;
    }
    let floor = peak * 10.0_f32.powf(ONSET_FLOOR_DB / 20.0);
    envelope
        .iter()
        .position(|&level| level > floor)
        .map(|index| index * window)
}

/// Loudest sample inside `[from, to)`.
///
/// The range is asserted rather than clamped. An earlier revision saturated
/// both ends on `buf.len()`, which turns an out-of-range window into an empty
/// slice and an empty slice into `0.0` — so the anti-echo assertion below
/// would have reported "no echo" from a measurement that was never taken, and
/// passed. It is non-vacuous today only because the caller's `tail_ms` happens
/// to render past the ring; that is a fact about one argument, not a property
/// of the helper, so the helper now insists on it.
fn peak_between(buf: &[f32], from: usize, to: usize) -> f32 {
    assert!(
        to <= buf.len(),
        "peak_between({from}, {to}) asked for a window past the end of a {}-sample render; \
         the render is too short for the measurement, which would otherwise read 0.0 and pass",
        buf.len()
    );
    assert!(from < to, "peak_between({from}, {to}) is an empty window");
    buf[from..to].iter().fold(0.0_f32, |a, &s| a.max(s.abs()))
}

#[test]
fn the_wet_onset_lands_where_position_put_it() {
    for &sample_rate in &[48_000.0_f32, 44_100.0] {
        for cloud in &CLOUDS {
            for &position_ms in &POSITIONS_MS {
                let rendered = render(sample_rate, position_ms, cloud, position_ms + 400.0);
                let after_burst = &rendered.left[rendered.burst_at..];

                let measured = onset(after_burst, sample_rate).unwrap_or_else(|| {
                    panic!(
                        "{sample_rate} Hz, Position {position_ms} ms, {} ms grains at {} g/s: \
                         the wet path never sounded at all after the burst.",
                        cloud.grain_size_ms, cloud.density
                    )
                });

                let expected = (position_ms * 0.001 * sample_rate) as usize;
                let error_ms = (measured as f32 - expected as f32).abs() / sample_rate * 1000.0;
                assert!(
                    error_ms <= TOLERANCE_MS,
                    "{sample_rate} Hz, Position {position_ms} ms, {} ms grains at {} g/s: \
                     the burst came back after {measured} samples ({:.2} ms), not the \
                     {expected} ({position_ms} ms) the control asked for — off by \
                     {error_ms:.2} ms.",
                    cloud.grain_size_ms,
                    cloud.density,
                    measured as f32 / sample_rate * 1000.0,
                );
            }
        }
    }
}

#[test]
fn position_zero_plays_live_audio_and_not_the_far_end_of_the_ring() {
    // The two-sided half of #1570. The row above already fails if Position 0
    // is late, but only this one names *where* the audio went: into the far
    // end of a `sample_rate * 2.0` ring, which is a place a plausible partial
    // fix could still leave it.
    for cloud in &CLOUDS {
        let sample_rate = 48_000.0_f32;
        let ring = (sample_rate * 2.0) as usize;
        // 2200 ms of tail, not a round number for its own sake: the anti-echo
        // window below reaches `ring + 1200` = 97 200 samples past the burst,
        // and `peak_between` now refuses to measure past the end of the render
        // rather than folding an out-of-range window to 0.0 and passing.
        let rendered = render(sample_rate, 0.0, cloud, 2200.0);
        let after_burst = &rendered.left[rendered.burst_at..];

        let prompt = peak_between(after_burst, 0, WINDOW);
        assert!(
            prompt > 0.0,
            "Position 0 ms, {} ms grains at {} g/s: the first millisecond after the \
             burst is silent, so the grain stream is not reading live audio.",
            cloud.grain_size_ms,
            cloud.density
        );

        // #1570's exact signature: the burst reappearing one ring-length late.
        let echo = peak_between(after_burst, ring - 1200, ring + 1200);
        assert!(
            echo < prompt * 1e-4,
            "Position 0 ms, {} ms grains at {} g/s: the burst reappears at {:.6} around \
             the {ring}-sample mark — {:.4} of the live level. That is the whole ring \
             played back as delay, which is #1570.",
            cloud.grain_size_ms,
            cloud.density,
            echo,
            echo / prompt
        );
    }
}

#[test]
fn the_onset_instrument_reports_a_late_start_that_is_actually_there() {
    // Anti-vacuity. `onset` must be capable of returning something other than
    // "sample 0", or every row above passes by construction at Position 0 and
    // says nothing anywhere else.
    let sample_rate = 48_000.0_f32;
    let mut late = vec![0.0_f32; 96_000];
    for (i, sample) in late.iter_mut().enumerate().skip(24_000) {
        *sample = ((i - 24_000) as f32 * 0.01).sin() * 0.5;
    }
    assert_eq!(
        onset(&late, sample_rate),
        Some(24_000),
        "the onset search must find the start of the signal, not the start of the buffer"
    );

    assert_eq!(
        onset(&vec![0.0_f32; 4_800], sample_rate),
        None,
        "silence has no onset"
    );

    // And it must not be fooled by a floor-level tail: a signal that decays to
    // -80 dB still has its onset at the top, not where it crosses the floor.
    let mut decaying = vec![0.0_f32; 48_000];
    for (i, sample) in decaying.iter_mut().enumerate().skip(9_600) {
        *sample = (-((i - 9_600) as f32) / 4_000.0).exp() * (i as f32 * 0.05).sin();
    }
    assert_eq!(
        onset(&decaying, sample_rate),
        Some(9_600),
        "a decaying signal's onset is where it starts, not where it falls through the floor"
    );
}
