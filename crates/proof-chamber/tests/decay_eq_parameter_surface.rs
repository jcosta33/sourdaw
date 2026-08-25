//! Does moving one Decay EQ band change how fast *that part of the spectrum*
//! decays, on every algorithm that claims to hear it?
//!
//! The overlay has shipped six draggable bands writing `decay_eq_0` …
//! `decay_eq_5` since the panel was written, and until this change no engine had
//! a `set_param` arm for any of them (#1539). A render-delta guard is therefore
//! the minimum; it is not the claim. The claim the control makes on screen is
//! *frequency-dependent decay rate*, and three weaker things would satisfy a
//! bare delta while breaking it:
//!
//! * a **gain** change rather than a decay change — the tail gets louder but
//!   ends at the same time;
//! * the **wrong band** moving, or every band moving together;
//! * a change that is real at 48 kHz and wrong at another rate, which is the
//!   error #1569's review found in this crate and which every file here was
//!   blind to because every file here declared `SAMPLE_RATE = 48_000.0`.
//!
//! So the measured quantity is a **band-limited T60**, fitted over the
//! -5 dB … -35 dB region of the decay and extrapolated (ISO 3382's T30), at two
//! sample rates, per band, per algorithm:
//!
//! * *band-limited*, so it says which part of the spectrum moved;
//! * a *decay time*, so a static gain change does not move it at all and only a
//!   change in decay rate does;
//! * *fitted*, so it carries no assumption about how long the tail should be —
//!   which a pair of fixed measurement windows does, and which is why the first
//!   version of this file had to be run at a `damping` the product does not
//!   ship in order to keep its windows meaningful;
//! * *per algorithm*, because the crate's existing guards select the plate and
//!   four of five algorithms have nothing pinning what they render (#1578).
//!
//! Reverse is deliberately absent and that absence is asserted: it has no
//! recirculating path, so there is no per-pass gain for a multiplier to be
//! relative to. `reverse_ignores_every_band` pins that it renders bit-identically
//! under all six writes, which is what makes the `structural` gap row in
//! `src/utils/nativeDspEngineGaps.ts` a measurement rather than an opinion.

use proof_chamber::ProofChamberInstance;

/// Two rates, because the stage designs biquads from the sample rate and a
/// rate-scaling error is invisible at one. 44.1 kHz is the other rate the
/// application actually runs at.
const SAMPLE_RATES: [f32; 2] = [44_100.0, 48_000.0];

const BLOCK: usize = 128;

/// Wire values from `ProofChamberInstance::set_param`'s `algorithm` arm.
const PLATE: f32 = 0.0;
const FDN8: f32 = 1.0;
const FDN16: f32 = 2.0;
const SPRING: f32 = 3.0;
const REVERSE: f32 = 6.0;

/// Every algorithm whose topology has a recirculating path for the stage to sit
/// in. The plate is first because it is the default algorithm and the one every
/// project meets.
const SHAPING_ENGINES: [(f32, &str); 4] = [
    (PLATE, "plate"),
    (FDN8, "fdn8"),
    (FDN16, "fdn16"),
    (SPRING, "spring"),
];

/// The band centres, matching `default_bands()` in `decay_eq.rs` and
/// `BAND_FREQS` in `DecayEqOverlay.tsx`.
const BAND_FREQS: [f32; 6] = [100.0, 400.0, 1200.0, 3500.0, 8000.0, 12000.0];

/// The travel the overlay offers and the descriptor declares.
const MIN_MULT: f32 = 0.25;
const MAX_MULT: f32 = 4.0;
const NEUTRAL_MULT: f32 = 1.0;

const BAND_PARAM_IDS: [&str; 6] = [
    "decay_eq_0",
    "decay_eq_1",
    "decay_eq_2",
    "decay_eq_3",
    "decay_eq_4",
    "decay_eq_5",
];

/// Writes applied to every render.
///
/// **`damping` is the shipped default of 0.3, and that is not a detail.** An
/// earlier version of this file measured at 0.05, on the reasoning that the
/// tail needed to stay bright enough for the top two bands to be measurable —
/// which was true, and which meant the whole per-band table described a device
/// nobody runs. It also hid the defect that mattered most: the stage was told a
/// single low-frequency loop gain while the FDN's absorption already takes
/// roughly twice as much per pass above its 2 kHz crossover, so at `damping =
/// 0.3` a requested 4.0x delivered **0.98x** on fdn8 — less than neutral. The
/// direction assertions still passed there; only the magnitude collapsed.
///
/// `high_cut` and `low_cut` are opened up because they are a *wet-path output*
/// stage, outside the loop the decay EQ sits in: they scale both measurement
/// windows equally and cancel out of every ratio here, while the shipped 12 kHz
/// corner would leave the 12 kHz band measuring mostly its own filter skirt.
/// `early_late` is at 1.0 so the measurement is the tail rather than the
/// early-reflection blend.
const BASELINE: [(&str, f32); 6] = [
    ("mix", 1.0),
    ("decay", 0.6),
    ("damping", 0.3),
    ("high_cut", 20_000.0),
    ("low_cut", 20.0),
    ("early_late", 1.0),
];

/// Burst length, then silence: the tail has to be decaying on its own for a
/// decay-rate measurement to mean anything.
fn burst_seconds() -> f32 {
    0.2
}

/// A parameter write applied before rendering.
type Write = (&'static str, f32);

struct Render {
    left: Vec<f32>,
    sample_rate: f32,
}

/// Deterministic broadband noise (fixed-seed LCG), so a delta is never the
/// stimulus moving.
fn stimulus_block(index: usize, out: &mut [f32], burst_frames: usize) {
    let mut state = 0x2545_F491_u32
        .wrapping_add(index as u32)
        .wrapping_mul(2_654_435_761);
    for (offset, sample) in out.iter_mut().enumerate() {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let unit = (state >> 8) as f32 / 8_388_608.0 - 1.0;
        *sample = if index + offset < burst_frames {
            unit * 0.5
        } else {
            0.0
        };
    }
}

fn render(sample_rate: f32, algorithm: f32, writes: &[Write]) -> Render {
    let mut instance = ProofChamberInstance::new(sample_rate);
    instance.set_param("algorithm", algorithm);
    for &(name, value) in BASELINE.iter() {
        instance.set_param(name, value);
    }
    for &(name, value) in writes {
        instance.set_param(name, value);
    }

    let frames = (sample_rate * 3.0) as usize;
    let burst_frames = (sample_rate * burst_seconds()) as usize;
    let mut left = Vec::with_capacity(frames);
    let mut input = vec![0.0_f32; BLOCK];
    let mut index = 0;
    while index < frames {
        stimulus_block(index, &mut input, burst_frames);
        let ptr = instance.process(&input, &input, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for i in 0..BLOCK {
            left.push(unsafe { *ptr.add(i) });
        }
        index += BLOCK;
    }

    for (i, sample) in left.iter().enumerate() {
        assert!(
            sample.is_finite(),
            "non-finite output sample at {i} on algorithm {algorithm} at {sample_rate} Hz: {sample}"
        );
    }
    Render { left, sample_rate }
}

/// A second-order constant-skirt bandpass (RBJ), applied offline to the
/// rendered tail at `MEASUREMENT_Q`.
fn filter_at(samples: &[f32], freq: f32, sample_rate: f32, q: f32) -> Vec<f32> {
    let w0 = std::f32::consts::TAU * freq / sample_rate;
    let alpha = w0.sin() / (2.0 * q);
    let a0 = 1.0 + alpha;
    let b0 = alpha / a0;
    let b2 = -alpha / a0;
    let a1 = -2.0 * w0.cos() / a0;
    let a2 = (1.0 - alpha) / a0;

    let mut z1 = 0.0_f32;
    let mut z2 = 0.0_f32;
    samples
        .iter()
        .map(|input| {
            let output = b0 * input + z1;
            z1 = -a1 * output + z2;
            z2 = b2 * input - a2 * output;
            output
        })
        .collect()
}

fn rms(values: &[f32]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let sum: f64 = values.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
    (sum / values.len() as f64).sqrt()
}

/// Measurement `Q` for the band filter.
///
/// Twelve, not the four this started at, and the difference decides several
/// claims. A `Q = 4` bandpass at 12 kHz is about 3 kHz wide, which overlaps the
/// 8 kHz band heavily — and where the loop is already very lossy, as it is above
/// the damper's corner at the shipped `damping = 0.3`, the band's own energy is
/// gone long before its neighbour's, so what the fit measures at 12 kHz is the
/// 8 kHz band leaking in. That reads as a locality failure and as a floor on
/// every cut, and it is neither: it is the instrument.
///
/// The cost of narrowing is the measuring filter's own ringing, and it is
/// negligible here: a resonator's decay time is about `Q / (pi * f)`, so 38 ms
/// at 100 Hz and 0.3 ms at 12 kHz, against tails of a second and up.
const MEASUREMENT_Q: f32 = 12.0;

/// Envelope hop, in seconds. 20 ms is short against every decay measured here
/// and long enough that the RMS in a hop is a level rather than a waveform.
const ENVELOPE_HOP_SECONDS: f32 = 0.02;

/// The band's own T60, in seconds, by least-squares fit of the log envelope
/// over the −5 dB … −35 dB region of its decay.
///
/// **This replaced a pair of fixed measurement windows, and the replacement is
/// the whole reason the per-band table can now be quoted at the shipped
/// `damping = 0.3`.** A fixed late window has to be chosen against some
/// expected decay time, and the moment the tail is much shorter than that guess
/// — which is exactly what damping does to the bands above 2 kHz — what the
/// window reads is the measuring filter's own skirt picking up the neighbours,
/// not the band. That floor is why the earlier version of this file measured at
/// `damping = 0.05` and therefore described a device nobody runs.
///
/// A T30 fit has no such guess in it: it finds the decay wherever the decay is.
/// It is also the standard instrument for the quantity (ISO 3382's T30, fitted
/// over 30 dB and extrapolated to 60), rather than a proxy invented here.
///
/// `None` when the band never falls 35 dB inside the render, or when the fit
/// has too few points to mean anything — reported by the caller rather than
/// silently returning a number.
fn band_t60(render: &Render, band: usize) -> Option<f64> {
    let filtered = filter_at(
        &render.left,
        BAND_FREQS[band],
        render.sample_rate,
        MEASUREMENT_Q,
    );
    let hop = (render.sample_rate * ENVELOPE_HOP_SECONDS) as usize;
    if hop == 0 {
        return None;
    }

    // Envelope in dB, one point per hop, starting once the stimulus has stopped
    // and the measuring filter has settled.
    let first = ((render.sample_rate * (burst_seconds() + 0.05)) as usize) / hop;
    let mut points: Vec<(f64, f64)> = Vec::new();
    let mut index = first * hop;
    while index + hop <= filtered.len() {
        let level = rms(&filtered[index..index + hop]);
        if level > 0.0 {
            let seconds = index as f64 / f64::from(render.sample_rate);
            points.push((seconds, 20.0 * level.log10()));
        }
        index += hop;
    }
    if points.len() < 8 {
        return None;
    }

    let peak_db = points
        .iter()
        .fold(f64::NEG_INFINITY, |acc, (_, db)| acc.max(*db));
    let upper = peak_db - 5.0;
    let lower = peak_db - 35.0;

    // Take the first monotone run through the fit region. Stopping at the first
    // point below `lower` keeps a noise floor that flattens out later in the
    // render from dragging the slope towards zero.
    let mut fit: Vec<(f64, f64)> = Vec::new();
    let mut started = false;
    for (seconds, db) in points {
        if !started && db <= upper {
            started = true;
        }
        if started {
            if db < lower {
                break;
            }
            fit.push((seconds, db));
        }
    }
    if fit.len() < 6 {
        return None;
    }

    let n = fit.len() as f64;
    let mean_t = fit.iter().map(|(t, _)| t).sum::<f64>() / n;
    let mean_db = fit.iter().map(|(_, db)| db).sum::<f64>() / n;
    let mut covariance = 0.0;
    let mut variance = 0.0;
    for (t, db) in fit.iter() {
        covariance += (t - mean_t) * (db - mean_db);
        variance += (t - mean_t) * (t - mean_t);
    }
    if variance <= 0.0 {
        return None;
    }
    let slope_db_per_second = covariance / variance;
    if slope_db_per_second >= -1e-3 {
        return None;
    }
    Some(-60.0 / slope_db_per_second)
}

fn band_t60_or_panic(render: &Render, band: usize, context: &str) -> f64 {
    match band_t60(render, band) {
        Some(t60) => t60,
        None => panic!(
            "{context}: band {band} ({} Hz) has no measurable decay, so nothing measured on it \
             means anything",
            BAND_FREQS[band]
        ),
    }
}

/// The fraction of the loop's own per-pass loss the stage consumed at this
/// band, derived from the delivered decay multiplier.
///
/// `1 - T60_neutral / T60_shaped` is the same `1 - 1/m` the designer works in,
/// which makes it the one quantity that can be compared *across bands*: the
/// delivered decay multiplier cannot, because it is exponentially sensitive to
/// how lossy the loop already is at that frequency, so a band where damping
/// eats 20 dB a pass shows a large multiplier for a small filter gain.
fn consumed_share(neutral_t60: f64, shaped_t60: f64) -> f64 {
    1.0 - neutral_t60 / shaped_t60
}

/// Band-limited level, in dB, one second after the stimulus stops.
///
/// The cut side needs this and the T30 fit cannot give it. A band cut hard
/// enough is *gone*, and once it is gone the only thing left at its centre
/// frequency is the skirt of its neighbours — which decays at the neutral rate,
/// so the fit returns the neutral T60 and the direction claim floors out. That
/// floor is not a defect in the stage: "this band ends sooner" is exactly what
/// the user asked for, and the honest way to measure it is the energy still
/// present late, not the slope of what is left.
fn band_level_db_at(render: &Render, band: usize, seconds: f32) -> f64 {
    let filtered = filter_at(
        &render.left,
        BAND_FREQS[band],
        render.sample_rate,
        MEASUREMENT_Q,
    );
    let hop = (render.sample_rate * ENVELOPE_HOP_SECONDS) as usize;
    let start = ((render.sample_rate * seconds) as usize).min(filtered.len().saturating_sub(hop));
    let level = rms(&filtered[start..(start + hop).min(filtered.len())]);
    if level <= 0.0 {
        return -300.0;
    }
    20.0 * level.log10()
}

fn band_write(band: usize, multiplier: f32) -> Vec<Write> {
    vec![(BAND_PARAM_IDS[band], multiplier)]
}

// ── The per-band claim ─────────────────────────────────────────────────────

/// Every band, on its own, on every algorithm that claims it, at two rates.
///
/// Assertions are named scalars with their own messages rather than one opaque
/// comparison, per the instrument style #1569 established for this crate: a
/// failure has to say which band, which algorithm, which rate and which
/// direction, or the next reader learns only that something moved.
#[test]
fn each_band_lengthens_its_own_part_of_the_spectrum() {
    for sample_rate in SAMPLE_RATES {
        for (algorithm, engine) in SHAPING_ENGINES {
            let neutral = render(sample_rate, algorithm, &[]);
            for band in 0..6 {
                let context = format!("{engine} @{sample_rate}");
                let neutral_t60 = band_t60_or_panic(&neutral, band, &context);

                let boosted = render(sample_rate, algorithm, &band_write(band, MAX_MULT));
                let boosted_t60 = band_t60_or_panic(&boosted, band, &context);
                assert!(
                    boosted_t60 > neutral_t60 * 1.15,
                    "{context}: band {band} ({} Hz) at {MAX_MULT}x must decay slower than at \
                     {NEUTRAL_MULT}x — T60 {boosted_t60:.3} s against {neutral_t60:.3} s",
                    BAND_FREQS[band]
                );

                // The cut side is measured as level rather than as slope, for
                // the reason `band_level_db_at` gives: a band cut hard is gone,
                // and the slope of what is left is its neighbours'.
                let cut = render(sample_rate, algorithm, &band_write(band, MIN_MULT));
                let late = burst_seconds() + 1.0;
                let neutral_level = band_level_db_at(&neutral, band, late);
                let cut_level = band_level_db_at(&cut, band, late);
                assert!(
                    cut_level < neutral_level - 3.0,
                    "{context}: band {band} ({} Hz) at {MIN_MULT}x must have less energy left a \
                     second into the tail than at {NEUTRAL_MULT}x — {cut_level:.1} dB against \
                     {neutral_level:.1} dB",
                    BAND_FREQS[band]
                );
            }
        }
    }
}

/// The half of the claim a bare delta cannot make: the band that moved is the
/// band that was dragged.
///
/// Scoped by **octaves**, not by index distance, and that correction is the
/// whole of what this guard is worth. The six centres are not evenly spaced:
/// 100 to 400 is two octaves and 8000 to 12000 is 0.58 of one, so "two indices
/// apart" runs from 3.6 octaves down to 1.19. Asserting band-limitation between
/// 3500 Hz and 12 kHz — 1.78 octaves, against a `Q = 1` bell about 1.4 octaves
/// wide — is asserting that a filter has no skirt, which is not a property any
/// EQ has or should have.
///
/// `MIN_ISOLATED_OCTAVES` is the separation at which a bell's contribution is
/// genuinely small. Closer pairs overlap by design: a decay EQ whose bands did
/// not overlap would have audible gaps between them, and pinning them apart
/// would be pinning a defect.
///
/// **Compared in consumed share rather than in delivered decay multiplier**, and
/// that is a correction rather than a convenience. The multiplier is
/// exponentially sensitive to how lossy the loop already is at a frequency, so
/// at the shipped `damping = 0.3` a *small* filter gain at 12 kHz — where the
/// absorption is eating most of the pass — shows up as a large decay multiplier
/// and reads like a locality failure that is really the damper's own curve.
/// `1 - T60_neutral/T60_shaped` is the same `1 - 1/m` the designer works in and
/// is free of that.
///
/// Separation at which one band's bell no longer meaningfully reaches another.
///
/// A `Q = 1` peaking section is about 1.4 octaves wide between its half-gain
/// points, so 2.5 octaves is comfortably outside it while still leaving nine of
/// the fifteen band pairs in the population.
const MIN_ISOLATED_OCTAVES: f64 = 2.5;

fn octaves_between(a: usize, b: usize) -> f64 {
    (f64::from(BAND_FREQS[a]) / f64::from(BAND_FREQS[b]))
        .log2()
        .abs()
}

/// Measured from neutral, so the clamp is **not** engaged: one band at 4.0x is
/// a total requested share of 0.75, under `ANALYTIC_SAFE_TOTAL_SHARE`, so the
/// boosts are passed through at full scale and what is measured is the filter's
/// own band-limitation and nothing else. The clamp's own non-locality is a
/// separate, deliberate property and has its own guard below.
#[test]
fn a_band_does_not_drag_the_far_side_of_the_spectrum_with_it() {
    for sample_rate in SAMPLE_RATES {
        for (algorithm, engine) in SHAPING_ENGINES {
            let neutral = render(sample_rate, algorithm, &[]);
            for band in 0..6 {
                let dragged = render(sample_rate, algorithm, &band_write(band, MAX_MULT));
                let context = format!("{engine} @{sample_rate}");

                let own = consumed_share(
                    band_t60_or_panic(&neutral, band, &context),
                    band_t60_or_panic(&dragged, band, &context),
                );
                assert!(
                    own > 0.1,
                    "{context}: dragging band {band} ({} Hz) to {MAX_MULT}x consumed only \
                     {own:.4} of its own headroom, so the comparison below says nothing",
                    BAND_FREQS[band]
                );

                for other in 0_usize..6 {
                    if octaves_between(band, other) < MIN_ISOLATED_OCTAVES {
                        continue;
                    }
                    let elsewhere = consumed_share(
                        band_t60_or_panic(&neutral, other, &context),
                        band_t60_or_panic(&dragged, other, &context),
                    );
                    assert!(
                        elsewhere.abs() < own * 0.5,
                        "{context}: dragging band {band} ({} Hz) changed distant band {other} \
                         ({} Hz) by {elsewhere:.4} of a share against its own {own:.4} — the \
                         curve is not band-limited",
                        BAND_FREQS[band],
                        BAND_FREQS[other]
                    );
                }
            }
        }
    }
}

/// Five settings across the declared travel, in order: the control is
/// continuous over its whole range rather than a latch that fires once, or a
/// clamp that saturates both ends into agreement.
#[test]
fn the_curve_is_monotonic_across_its_declared_travel() {
    for (algorithm, engine) in SHAPING_ENGINES {
        for band in 0..6 {
            let mut previous = f64::NEG_INFINITY;
            for multiplier in [MIN_MULT, 0.5, NEUTRAL_MULT, 2.0, MAX_MULT] {
                let rendered = render(48_000.0, algorithm, &band_write(band, multiplier));
                // Level a second into the tail rather than the fitted T60: a
                // band cut to 0.25x is gone by then and the slope of what is
                // left belongs to its neighbours, so a T60 fit stops ordering
                // the bottom of the travel while the level still does.
                let level = band_level_db_at(&rendered, band, burst_seconds() + 1.0);
                assert!(
                    level > previous + 0.5,
                    "{engine}: band {band} ({} Hz) must have more left a second into the tail at \
                     {multiplier}x than at the setting below it — {level:.1} dB after \
                     {previous:.1} dB",
                    BAND_FREQS[band]
                );
                previous = level;
            }
        }
    }
}

// ── Transparency, stability and gating ─────────────────────────────────────

/// The default curve is not merely close to transparent, it is the identity.
///
/// This is the claim `plate_parameter_surface.rs`'s untouched-Plate shape guard
/// and `algorithm_switch_parameter_retention.rs`'s constructor-versus-first-
/// selection parity rest on. Asserted here rather than left to those two files,
/// because they would also stay green if the stage were simply never reached.
#[test]
fn writing_every_band_to_its_default_renders_bit_identically() {
    for sample_rate in SAMPLE_RATES {
        for (algorithm, engine) in SHAPING_ENGINES {
            let untouched = render(sample_rate, algorithm, &[]);
            let written: Vec<Write> = BAND_PARAM_IDS
                .iter()
                .map(|id| (*id, NEUTRAL_MULT))
                .collect();
            let explicit = render(sample_rate, algorithm, &written);

            let differing = untouched
                .left
                .iter()
                .zip(explicit.left.iter())
                .filter(|(a, b)| a.to_bits() != b.to_bits())
                .count();
            assert_eq!(
                differing, 0,
                "{engine} @{sample_rate}: writing every band to {NEUTRAL_MULT}x must be the \
                 identity, but {differing} samples differ"
            );
        }
    }
}

/// All six bands at full boost at once must still be a reverb.
///
/// The cascade's magnitudes multiply, so six overlapping boosts can exceed the
/// loop's per-pass headroom and turn the tail into an oscillator. `decay_eq.rs`'s
/// `MAX_TOTAL_BOOST` is the bound that prevents it; this is that bound measured
/// through a whole engine rather than through the filter cascade alone.
#[test]
fn six_bands_at_full_boost_still_decay_on_every_algorithm() {
    let extreme: Vec<Write> = BAND_PARAM_IDS.iter().map(|id| (*id, MAX_MULT)).collect();
    for (algorithm, engine) in SHAPING_ENGINES {
        let render = render(48_000.0, algorithm, &extreme);
        let tail_start = (48_000.0_f32 * 2.6) as usize;
        let late = rms(&render.left[tail_start..]);
        let burst = rms(&render.left[(48_000.0_f32 * 0.3) as usize..(48_000.0_f32 * 0.6) as usize]);
        assert!(
            late < burst,
            "{engine}: six bands at {MAX_MULT}x left the tail growing rather than decaying — \
             late RMS {late:e} against {burst:e}"
        );
    }
}

/// Reverse hears none of the six, and that is the measurement behind its
/// `structural` gap row.
///
/// It has no recirculating path: `decay` scales a reversed grain once, on its
/// way out. There is no per-pass gain for a decay multiplier to be relative to,
/// so the control is disabled on this algorithm rather than wired to something
/// that would be a tone control wearing a decay control's label.
#[test]
fn reverse_ignores_every_band() {
    for sample_rate in SAMPLE_RATES {
        let untouched = render(sample_rate, REVERSE, &[]);
        for band in 0..6 {
            let written = render(sample_rate, REVERSE, &band_write(band, MAX_MULT));
            let differing = untouched
                .left
                .iter()
                .zip(written.left.iter())
                .filter(|(a, b)| a.to_bits() != b.to_bits())
                .count();
            assert_eq!(
                differing, 0,
                "reverse @{sample_rate}: band {band} changed {differing} samples, so the \
                 `structural` gap row in src/utils/nativeDspEngineGaps.ts is now false"
            );
        }
    }
}

// ── The parameter cache ────────────────────────────────────────────────────

/// The six ids survive an algorithm change, measured by render.
///
/// `set_param("algorithm", n)` throws the engine away and builds a new one, and
/// `ParameterCache` (#1545) is what re-tells the replacement everything it was
/// told. A new parameter that does not pass through the cache is silently reset
/// on every algorithm switch — the defect #1544 was, one name at a time — and
/// reading `lib.rs` cannot show that it does, because the cache records at the
/// dispatcher and the value has to arrive in a *filter design* two layers down.
#[test]
fn the_band_curve_survives_a_round_trip_through_another_algorithm() {
    for (algorithm, engine) in SHAPING_ENGINES {
        for band in 0..6 {
            let direct = render(48_000.0, algorithm, &band_write(band, MAX_MULT));

            let mut instance = ProofChamberInstance::new(48_000.0);
            instance.set_param("algorithm", algorithm);
            for &(name, value) in BASELINE.iter() {
                instance.set_param(name, value);
            }
            instance.set_param(BAND_PARAM_IDS[band], MAX_MULT);
            // Away and back. Everything the engine knew is discarded twice.
            instance.set_param("algorithm", REVERSE);
            instance.set_param("algorithm", algorithm);

            let frames = (48_000.0_f32 * 3.0) as usize;
            let burst_frames = (48_000.0_f32 * burst_seconds()) as usize;
            let mut left = Vec::with_capacity(frames);
            let mut input = vec![0.0_f32; BLOCK];
            let mut index = 0;
            while index < frames {
                stimulus_block(index, &mut input, burst_frames);
                let ptr = instance.process(&input, &input, BLOCK as u32);
                for i in 0..BLOCK {
                    left.push(unsafe { *ptr.add(i) });
                }
                index += BLOCK;
            }

            let round_tripped = Render {
                left,
                sample_rate: 48_000.0,
            };
            let direct_t60 = band_t60_or_panic(&direct, band, engine);
            let round_t60 = band_t60_or_panic(&round_tripped, band, engine);
            assert!(
                (round_t60 - direct_t60).abs() < direct_t60 * 0.02,
                "{engine}: band {band} ({} Hz) came back from an algorithm round trip shaping \
                 differently — T60 {round_t60:.3} s against {direct_t60:.3} s. The parameter \
                 cache is not carrying this id.",
                BAND_FREQS[band]
            );
        }
    }
}

/// The engines advertise the ids to a host that asks.
#[test]
fn every_shaping_engine_advertises_all_six_bands() {
    for (algorithm, engine) in SHAPING_ENGINES {
        let mut instance = ProofChamberInstance::new(48_000.0);
        instance.set_param("algorithm", algorithm);
        let names = instance.get_param_names();
        for id in BAND_PARAM_IDS {
            assert!(
                names.contains(&format!("\"{id}\"")),
                "{engine}: get_param_names() must advertise {id}, got {names}"
            );
        }
    }
}

/// ...and reverse does not advertise what it cannot hear.
#[test]
fn reverse_advertises_none_of_them() {
    let mut instance = ProofChamberInstance::new(48_000.0);
    instance.set_param("algorithm", REVERSE);
    let names = instance.get_param_names();
    for id in BAND_PARAM_IDS {
        assert!(
            !names.contains(&format!("\"{id}\"")),
            "reverse: get_param_names() advertises {id}, which it drops. Got {names}"
        );
    }
}

// ── The shaping is relative, and stays relative ────────────────────────────

/// A curve set at one Decay setting means the same thing at the next one.
///
/// **This is the claim the per-band headroom exists for, and it is the one an
/// arbitrary fixed dB-per-multiplier would fail.** A decay multiplier is a
/// ratio, so the filter gain that delivers it has to be proportional to how much
/// the loop already loses per pass — which is a strong function of Decay: on the
/// plate at 0.4 the tank loses about 8 dB per half-traversal and at 0.85 about
/// 1.4 dB. A stage that applied a constant boost would deliver a wildly
/// different decay multiplier at each end of the Decay knob, and every
/// direction-only guard in this file would still pass.
///
/// What is asserted is a **band** the delivered multiplier stays inside across
/// the whole Decay range, plus the *direction* of the residual variation. An
/// exact figure is deliberately not pinned: the delivered multiplier at a band
/// centre depends on the band's shape — a shelf reaches only half its design
/// gain at its own corner — and on how much of the measuring filter's passband
/// the neighbours still occupy, and pinning a figure like that would be pinning
/// the estimator rather than the stage.
#[test]
fn the_shaping_a_band_delivers_does_not_depend_on_the_decay_setting() {
    // Bells only (bands 1-3): a shelf reaches half its design gain at its own
    // corner frequency, so its centre is the one place on the curve that does
    // not report the shelf's size.
    //
    // The sweep stops at 0.85 on purpose. Past there the loop has less loss
    // than the stage's own margin and the shaping is refused outright, so an
    // invariance claim would be asserting that a correct refusal is a
    // regression. The top of the range has its own test above; leaving it out
    // of the grid without saying so is what let the refusal go unnoticed.
    for (algorithm, engine) in SHAPING_ENGINES {
        for band in [1_usize, 2, 3] {
            let mut delivered = Vec::new();
            for decay in [0.4_f32, 0.55, 0.7, 0.85] {
                let base: Vec<Write> = vec![("decay", decay)];
                let mut shaped = base.clone();
                shaped.push((BAND_PARAM_IDS[band], MAX_MULT));

                let context = format!("{engine} at decay {decay}");
                let neutral_t60 =
                    band_t60_or_panic(&render(48_000.0, algorithm, &base), band, &context);
                let shaped_t60 =
                    band_t60_or_panic(&render(48_000.0, algorithm, &shaped), band, &context);
                delivered.push((decay, shaped_t60 / neutral_t60));
            }

            for (decay, value) in delivered.iter() {
                assert!(
                    (1.8..=4.5).contains(value),
                    "{engine}: band {band} at a requested {MAX_MULT}x delivered {value:.2}x at \
                     decay {decay} — outside the band the control is supposed to hold across \
                     the Decay range"
                );
            }

            // ...and it barely moves across the range, which is the actual
            // claim.
            //
            // The plate and the spring measure under 4% of spread. The FDN
            // carries most of the 20%, and for a reason worth naming rather
            // than absorbing: its absorption is `rt60_hf = rt60 * (1 - damping)
            // * 0.5`, so moving Decay changes the *shape* of the loop's
            // magnitude curve around the 2 kHz crossover and not only its
            // scale, and a band sitting in that transition is measured through
            // a filter whose passband spans loop gains that no longer stand in
            // the same relation to each other. The plate's `OnePole` and the
            // spring's damper have no such term.
            //
            // 20% is therefore loose enough to survive the estimator on the one
            // engine whose loop reshapes, and it is still an order of magnitude
            // tighter than a fixed dB-per-multiplier stage could reach: such a
            // stage would ask the same boost of a headroom running from about
            // 8 dB to about 1.4 dB on the plate, over-delivering at one end and
            // asking for more than the loop has at the other.
            let mean =
                delivered.iter().map(|(_, value)| value).sum::<f64>() / delivered.len() as f64;
            for (decay, value) in delivered.iter() {
                assert!(
                    (value - mean).abs() < mean * 0.2,
                    "{engine}: band {band} at {MAX_MULT}x delivered {value:.2}x at decay {decay} \
                     against a mean of {mean:.2}x across the Decay range — the shaping is not \
                     relative to the loop's own per-pass loss"
                );
            }
        }
    }
}

/// The top of the Decay knob, which the sweep above deliberately does not reach.
///
/// **This is the axis #1580's stance 2 found missing, and it is missing for a
/// reason worth stating rather than fixing quietly.** The invariance sweep
/// stops at `decay = 0.85` because past there the stage runs out of headroom
/// and stops shaping — so including 0.99 and 0.999 in *that* test would have
/// made it fail on a behaviour that is correct. Putting them in a test of their
/// own is what turns "the sweep does not go there" from an omission into a
/// statement.
///
/// What is asserted is that the refusal is total and that the panel is told
/// about it. Refusing to boost a loop already at the ceiling is right — the
/// alternative is a reverb that grows — but a user dragging six nodes and
/// hearing nothing cannot tell that from a broken control, which is why
/// `ProofChamberPanel` gates the overlay on exactly these states.
#[test]
fn the_top_of_the_decay_range_stops_shaping_rather_than_shaping_weakly() {
    // The descriptor's own maximum. The plate's loop is `decay^2`, so 0.999
    // leaves 0.017 dB of per-pass loss — less than the stage's own margin —
    // and the whole curve is refused.
    let base: Vec<Write> = vec![("decay", 0.999_f32)];
    let mut all_six = base.clone();
    for id in BAND_PARAM_IDS {
        all_six.push((id, MAX_MULT));
    }

    let untouched = render(48_000.0, PLATE, &base);
    let shaped = render(48_000.0, PLATE, &all_six);
    let differing = untouched
        .left
        .iter()
        .zip(shaped.left.iter())
        .filter(|(a, b)| a.to_bits() != b.to_bits())
        .count();
    assert_eq!(
        differing, 0,
        "plate at decay 0.999: all six bands at {MAX_MULT}x must render bit-identically to never \
         writing them — {differing} samples differ, which would mean the bound is being \
         approached rather than respected"
    );

    // One step down the knob and it is working again — 0.99 leaves 0.087 dB,
    // and the tank's damper opens far more than that above a few kHz. So this
    // is the top of a range rather than a control that has died, and the
    // boundary is a property of the *loop*, not of a Decay number: the same
    // 0.999 on an engine whose damper takes more per pass would still shape.
    let mut nearly = vec![("decay", 0.99_f32)];
    for id in BAND_PARAM_IDS {
        nearly.push((id, MAX_MULT));
    }
    let nearly_untouched = render(48_000.0, PLATE, &[("decay", 0.99)]);
    let nearly_shaped = render(48_000.0, PLATE, &nearly);
    let nearly_differing = nearly_untouched
        .left
        .iter()
        .zip(nearly_shaped.left.iter())
        .filter(|(a, b)| a.to_bits() != b.to_bits())
        .count();
    assert!(
        nearly_differing > 1_000,
        "plate at decay 0.99 must still be shaped — only {nearly_differing} samples differ, so \
         the refusal has spread further down the knob than the headroom explains"
    );
}

/// The defect F5 named, pinned at the setting the product ships.
///
/// The stage used to be handed one scalar loop gain, taken from the FDN's
/// low-frequency RT60. Its absorption already removes roughly twice as much per
/// pass above the 2 kHz crossover, so above there the correction supplied about
/// half the dB it needed — and a requested 4.0x came out at **0.98x**, below
/// neutral, at the shipped `damping = 0.3`. Nothing in this file could see it:
/// the direction assertions ran at `damping = 0.05`, where the gap is small.
///
/// Asserted as a floor on the delivered multiplier rather than as a target,
/// because the target is what the estimator cannot carry. A floor of 2.0x on a
/// requested 4.0x is far above the 0.98x the defect produced and far below what
/// the fixed stage delivers, so it discriminates without pinning the instrument.
#[test]
fn a_boost_above_the_damping_crossover_still_lengthens_at_the_shipped_damping() {
    for damping in [0.3_f32, 0.6] {
        for (algorithm, engine) in SHAPING_ENGINES {
            // Bands 3 and 4 sit above the FDN's 2 kHz absorption crossover,
            // which is where the single-scalar version lost its correction.
            // Band 5 is above it too and is deliberately absent: it is a
            // *shelf*, and a shelf reaches half its design gain at its own
            // corner frequency, so measuring it at 12 kHz caps the deliverable
            // multiplier near 1.6x whatever the wiring does. That is the band's
            // shape, not the defect this guard is for.
            for band in [3_usize, 4] {
                let base: Vec<Write> = vec![("damping", damping)];
                let mut shaped = base.clone();
                shaped.push((BAND_PARAM_IDS[band], MAX_MULT));

                let context = format!("{engine} at damping {damping}");
                let neutral_t60 =
                    band_t60_or_panic(&render(48_000.0, algorithm, &base), band, &context);
                let shaped_t60 =
                    band_t60_or_panic(&render(48_000.0, algorithm, &shaped), band, &context);
                let delivered = shaped_t60 / neutral_t60;

                assert!(
                    delivered > 2.0,
                    "{context}: band {band} ({} Hz) at a requested {MAX_MULT}x delivered only \
                     {delivered:.2}x — T60 {shaped_t60:.3} s against {neutral_t60:.3} s. The \
                     stage is being told a loop gain that does not include the damper.",
                    BAND_FREQS[band]
                );
            }
        }
    }
}
