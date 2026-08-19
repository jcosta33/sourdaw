//! Does Shimmer render a pitch shift, or does it render noise?
//!
//! Every other shimmer assertion in this crate is a *stability* assertion: the
//! output stays finite, stays under a ceiling, and settles. All three hold for
//! a stage that emits broadband hiss, and all three hold for a stage that emits
//! nothing at all — `plate_shimmer_stability.rs` passes with the granular
//! shifter deleted. What the control claims on the panel is narrower, and this
//! file is where it is covered: Shimmer Pitch offers a **fifth up** and an
//! **octave up**, and the tail has to come back carrying that interval.
//!
//! So the measurement is a spectral one, taken on a sustained tone rather than
//! a burst: with the shifter inside the tank feedback and Amount at full, the
//! selected partial has to be *there*, well clear of the spectral floor around
//! it, and it has to be the up-shift rather than its downward mirror.
//!
//! Both rates, because the grain length is derived from the sample rate
//! (`GranularShifter::new`) and a rate-dependent error is invisible at one.
//!
//! # What this holds the shifter to
//!
//! Three properties of `GranularShifter` have to hold together for the measured
//! partial to exist at all, and each of them is a way the stage has been broken
//! before:
//!
//! * **The read pointer has to advance faster than the write pointer.** A grain
//!   that trails by a *growing* delay plays slower than real time and transposes
//!   down; at a ratio of 2.0 it stands still.
//! * **Each tank half needs its own shifter.** One shifter fed both halves holds
//!   them interleaved a sample apiece in a single delay line, and grain reads
//!   land on alternating channels — the tail comes back as a scramble of two
//!   unrelated signals with a flat noise floor and no partial anywhere.
//! * **Grains have to be placed randomly, and placement drawn per grain.** A
//!   read offset redrawn every sample is audio-rate noise, not placement. And
//!   grains that all start from the same point in history make the shifter a
//!   linear periodically time-varying system, whose output for a partial at `f`
//!   can only land on the grid `f + k / grain_period` — a grid that does not in
//!   general contain `f * ratio` (only when a grain holds a whole number of
//!   input cycles), so the one frequency it cannot produce is the one it exists
//!   to produce.
//!
//! The `10x` floor margin below is deliberately far under what a working shifter
//! should deliver — the fundamental sits some 300x over the same floor — so a
//! change that lands under it has stopped Shimmer being audible and the number
//! is not the thing to move.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATES: [f32; 2] = [44_100.0, 48_000.0];
const BLOCK: usize = 128;

/// Low enough that every partial up to the fourth shift stays well inside the
/// band, and not a divisor of either sample rate.
const TONE_HZ: f32 = 220.0;

/// Two seconds of tone; the analysis window is its second half, by which point
/// the shifter has recirculated through the tank many times over.
const SUSTAIN_SECONDS: f32 = 2.0;

/// `shimmer_pitch` is a two-position switch in `ProofChamber::set_param`:
/// below 0.5 selects the 1.5 ratio, at or above selects 2.0.
const PITCH_SETTINGS: [(f32, f32, &str); 2] = [(0.0, 1.5, "fifth up"), (1.0, 2.0, "octave up")];

/// How far over the surrounding spectral floor the shifted partial has to
/// stand before it counts as present rather than as part of the noise.
const FLOOR_MARGIN: f32 = 10.0;

/// How far the up-shifted partial has to stand over its downward mirror. This
/// is the direction claim on its own: a shifter running backwards puts its
/// energy at `f / ratio` instead of `f * ratio`.
const DIRECTION_MARGIN: f32 = 4.0;

/// Multiples of the tone that are neither the fundamental nor any partial the
/// two ratios can produce (`1.5^k`, `2^k`, and their mirrors), so the median of
/// their magnitudes describes the noise between the partials.
const FLOOR_PROBES: [f32; 6] = [1.15, 1.31, 1.72, 2.6, 3.9, 5.3];

/// The grain length `GranularShifter::new` derives from the sample rate.
const GRAIN_SECONDS: f32 = 0.030;

/// How often a grain restarts, in Hz. It falls out of the grain length and the
/// ratio alone — the sample rate cancels, because the grain is derived from it —
/// and it is the width of the band the shifted energy arrives in.
fn grain_rate(ratio: f32) -> f32 {
    (ratio - 1.0) / GRAIN_SECONDS
}

/// Render a sustained tone through the plate with Shimmer engaged, returning
/// the left channel of the second half of the tone.
///
/// `damping` is at 0 and `high_cut` wide open on purpose: the question is what
/// the shifter puts into the tank, and the shipped tone controls would
/// attenuate the upper partials the measurement is looking for before they
/// reached the output. `mod_depth` is 0 so the only thing modulating the tail
/// is the shifter itself.
fn render_shimmer_tail(sample_rate: f32, pitch_setting: f32, tone_hz: f32) -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(sample_rate);
    for (name, value) in [
        ("algorithm", 0.0),
        ("mix", 1.0),
        ("decay", 0.85),
        ("damping", 0.0),
        ("size", 0.8),
        ("early_late", 1.0),
        ("high_cut", 20_000.0),
        ("low_cut", 20.0),
        ("mod_depth", 0.0),
        ("shimmer", 1.0),
        ("shimmer_amount", 1.0),
        ("shimmer_pitch", pitch_setting),
    ] {
        instance.set_param(name, value);
    }

    let frames = (sample_rate * SUSTAIN_SECONDS) as usize;
    let mut output = Vec::with_capacity(frames);
    let mut index = 0;
    while index < frames {
        let block = (frames - index).min(BLOCK);
        let input: Vec<f32> = (0..block)
            .map(|offset| {
                let phase = (index + offset) as f32 / sample_rate * tone_hz * std::f32::consts::TAU;
                0.4 * phase.sin()
            })
            .collect();
        let ptr = instance.process(&input, &input, block as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for offset in 0..block {
            let sample = unsafe { *ptr.add(offset) };
            assert!(
                sample.is_finite(),
                "non-finite output at frame {}",
                index + offset
            );
            output.push(sample);
        }
        index += block;
    }

    output.split_off(frames / 2)
}

/// Magnitude of `freq` in `samples`, by direct evaluation of the one DFT bin
/// that matters over a Hann-windowed block.
///
/// A bin rather than a filter because the partials of interest sit at
/// non-integer ratios of any convenient block length, and a fitted bin does not
/// care where they land.
fn bin_magnitude(samples: &[f32], sample_rate: f32, freq: f32) -> f32 {
    let len = samples.len();
    let omega = std::f64::consts::TAU * f64::from(freq) / f64::from(sample_rate);
    let mut real = 0.0_f64;
    let mut imaginary = 0.0_f64;
    for (index, sample) in samples.iter().enumerate() {
        let window = 0.5 * (1.0 - (std::f64::consts::TAU * index as f64 / len as f64).cos());
        let value = f64::from(*sample) * window;
        real += value * (omega * index as f64).cos();
        imaginary += value * (omega * index as f64).sin();
    }
    ((real * real + imaginary * imaginary).sqrt() / len as f64) as f32
}

/// Mean bin magnitude across `centre ± half_width`, on the analysis window's own
/// 1 Hz bin spacing — the spectral density of a band rather than the height of
/// one bin in it.
///
/// A single bin is the wrong instrument for what this shifter emits. Every grain
/// starts from an independently drawn point in history, so the transposed energy
/// arrives phase-randomised across a band about one grain rate wide instead of
/// as a line: the band's centroid is what sits exactly at `f * ratio`, while its
/// tallest single bin wanders with the jitter seed. Probing one bin measures an
/// arbitrary slice of that band, so a grain-size, scatter-range or seed change
/// that leaves Shimmer just as audible can move the reading by an order of
/// magnitude in either direction.
///
/// A mean rather than a sum, because what it is compared against is a spectral
/// floor read one bin at a time. Both sides are then a magnitude per bin, the
/// thresholds below keep the meaning they were calibrated with, and a stage that
/// fills the band with noise instead of a partial still reads as the floor.
fn band_density(samples: &[f32], sample_rate: f32, centre: f32, half_width: f32) -> f32 {
    let lowest = (centre - half_width).max(1.0).round() as i32;
    let highest = (centre + half_width).min(sample_rate * 0.5 - 1.0).round() as i32;
    let bins = highest - lowest + 1;
    (lowest..=highest)
        .map(|freq| bin_magnitude(samples, sample_rate, freq as f32))
        .sum::<f32>()
        / bins as f32
}

/// Median magnitude across `FLOOR_PROBES`: what the spectrum reads between the
/// partials, which is what a partial has to stand above to be one.
fn spectral_floor(samples: &[f32], sample_rate: f32) -> f32 {
    let mut magnitudes: Vec<f32> = FLOOR_PROBES
        .iter()
        .map(|multiple| bin_magnitude(samples, sample_rate, TONE_HZ * multiple))
        .collect();
    magnitudes.sort_by(|a, b| a.partial_cmp(b).expect("finite magnitudes"));
    (magnitudes[magnitudes.len() / 2 - 1] + magnitudes[magnitudes.len() / 2]) * 0.5
}

#[test]
fn shimmer_puts_its_selected_interval_into_the_tail() {
    for sample_rate in SAMPLE_RATES {
        for (setting, ratio, label) in PITCH_SETTINGS {
            let tail = render_shimmer_tail(sample_rate, setting, TONE_HZ);
            let band = grain_rate(ratio);

            let fundamental = bin_magnitude(&tail, sample_rate, TONE_HZ);
            let shifted = band_density(&tail, sample_rate, TONE_HZ * ratio, band);
            let mirror = band_density(&tail, sample_rate, TONE_HZ / ratio, band);
            let floor = spectral_floor(&tail, sample_rate);

            assert!(
                fundamental > floor * FLOOR_MARGIN,
                "{label} at {sample_rate:.0} Hz: the input tone itself is not clear of the \
                 spectral floor (fundamental {fundamental:e}, floor {floor:e}), so this render \
                 cannot say anything about a partial either — the stimulus or the render \
                 settings moved, not the shifter"
            );

            assert!(
                shifted > floor * FLOOR_MARGIN,
                "{label} at {sample_rate:.0} Hz: nothing is sounding at {:.1} Hz. Shimmer's \
                 partial measures {shifted:e} against a spectral floor of {floor:e} \
                 ({:.1}x, needs {FLOOR_MARGIN:.0}x), while the fundamental measures \
                 {fundamental:e}. The stage is adding noise to the tank, not an interval.",
                TONE_HZ * ratio,
                shifted / floor.max(1e-12)
            );

            assert!(
                shifted > mirror * DIRECTION_MARGIN,
                "{label} at {sample_rate:.0} Hz: Shimmer is shifting the wrong way. \
                 {:.1} Hz measures {shifted:e} and its downward mirror {:.1} Hz measures \
                 {mirror:e} ({:.2}x, needs {DIRECTION_MARGIN:.0}x). The control offers an \
                 interval up.",
                TONE_HZ * ratio,
                TONE_HZ / ratio,
                shifted / mirror.max(1e-12)
            );
        }
    }
}

/// High enough that both ratios image it past Nyquist at both rates, and not a
/// divisor of either rate.
const FOLD_TONE_HZ: f32 = 18_000.0;

/// How far under the partial that produces it a folded image has to sit.
///
/// Measured against the stimulus rather than against the noise around the image,
/// because the tank's own floor is not flat: at 17 kHz it reads several times
/// what it reads an octave down, so a neighbourhood estimate charges the shifter
/// for a tilt it did not cause. The stimulus is what the fold is made from, so
/// the ratio between them is the rejection the feed filter achieves and nothing
/// else.
///
/// An unfiltered feed manages between 5 dB and *nothing* across the four cells
/// below — at 48 kHz the alias comes back louder than the partial that made it.
/// A band-limited feed reaches at worst 60 dB, and that figure is set by the
/// tank's own noise at the image frequency rather than by the filter, so it does
/// not move when the filter is made steeper. This bar sits between the two with
/// room on both sides; it is not a rejection figure to tune a filter down to.
const FOLD_REJECTION_DB: f32 = 40.0;

#[test]
fn shimmer_does_not_fold_the_tank_back_under_its_own_shift() {
    for sample_rate in SAMPLE_RATES {
        for (setting, ratio, label) in PITCH_SETTINGS {
            // Reading the grain faster than it was written is resampling, and
            // resampling images: anything the tank carries above
            // `sample_rate / (2 * ratio)` transposes past Nyquist and comes back
            // down the spectrum as an alias. Unlike the partials above, that
            // alias is not a pitch anyone selected, and it recirculates through
            // the tank feedback and folds again.
            let image = FOLD_TONE_HZ * ratio;
            assert!(
                image > sample_rate * 0.5,
                "{label} at {sample_rate:.0} Hz: the stimulus images to {image:.0} Hz, which is \
                 inside the band — this cell cannot say anything about folding unless the \
                 stimulus transposes past Nyquist"
            );
            let folded = sample_rate - image;

            let tail = render_shimmer_tail(sample_rate, setting, FOLD_TONE_HZ);
            let band = grain_rate(ratio);

            let alias = band_density(&tail, sample_rate, folded, band);
            let stimulus = band_density(&tail, sample_rate, FOLD_TONE_HZ, band);
            let rejection_db = 20.0 * (stimulus / alias.max(1e-12)).log10();

            assert!(
                rejection_db > FOLD_REJECTION_DB,
                "{label} at {sample_rate:.0} Hz: a {FOLD_TONE_HZ:.0} Hz partial is folding back \
                 to {folded:.0} Hz. The alias measures {alias:e} against a stimulus of \
                 {stimulus:e} — only {rejection_db:.1} dB of rejection, and this file wants \
                 {FOLD_REJECTION_DB:.0} dB. Shimmer up-samples whatever the tank hands it, so the \
                 feed has to be band-limited well below {:.0} Hz before the grains read it.",
                sample_rate / (2.0 * ratio)
            );
        }
    }
}
