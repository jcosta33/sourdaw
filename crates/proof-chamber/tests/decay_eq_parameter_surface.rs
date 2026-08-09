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
//! So the measured quantity is a **band-limited late/early energy ratio**, at
//! two sample rates, per band, per algorithm:
//!
//! * *band-limited*, so it says which part of the spectrum moved;
//! * a *ratio* of two windows of the same decaying tail, so a static gain
//!   change cancels out of it and only a change in decay *rate* survives;
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

/// Writes applied to every render, so all six bands have a measurable tail to
/// shape.
///
/// The shipped defaults would not: `damping` at 0.3 and `high_cut` at 12 kHz
/// between them leave the 8 kHz and 12 kHz bands with almost nothing in the late
/// window, and a ratio measured on numerical dust is a coin toss. None of these
/// is an extreme — they are ordinary bright-reverb settings — and none of them
/// touches the stage under test.
const BASELINE: [(&str, f32); 6] = [
    ("mix", 1.0),
    ("decay", 0.6),
    ("damping", 0.05),
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
/// rendered tail. `Q = 2` is wide enough to catch a band whose energy has moved
/// a little in frequency and narrow enough that adjacent centres 1.7 octaves
/// apart stay distinguishable.
fn band_filter(samples: &[f32], freq: f32, sample_rate: f32) -> Vec<f32> {
    filter_at(samples, freq, sample_rate, 2.0)
}

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

/// How much of the band's energy is still there late in the tail, relative to
/// early in it.
///
/// **This is the whole measurement, and the ratio is the point.** A stage that
/// merely made a band louder scales both windows by the same factor and leaves
/// this number untouched; only a change in that band's decay *rate* moves it.
/// The windows start well after the burst ends so neither contains the
/// stimulus.
fn band_decay_ratio(render: &Render, band: usize) -> f64 {
    band_decay_ratio_over(render, band, LONG_WINDOWS)
}

/// The two windows, in seconds: `[early_start, early_end, late_start, late_end]`.
type Windows = [f32; 4];

/// Far apart, so the ratio has a long lever on the decay rate. Every claim that
/// can use these does.
const LONG_WINDOWS: Windows = [0.30, 0.60, 1.20, 2.40];

/// Closer together, for the one claim that cannot use `LONG_WINDOWS`.
///
/// A band cut to 0.25x decays four times faster than the base rate and is
/// finished well before 1.2 s; what a `Q = 2` bandpass still reads there is
/// skirt leakage from its neighbours, so the long-window ratio floors out and
/// stops ordering the bottom of the travel. It is a limit of the *measurement*
/// and not of the control: the same five settings ordered strictly on every
/// engine and every band once the late window moved back to where the cut band
/// still has energy of its own. Stated here rather than worked around silently,
/// because "monotonic" would otherwise be a claim about a floor.
const NEAR_WINDOWS: Windows = [0.25, 0.45, 0.55, 0.95];

fn band_decay_ratio_over(render: &Render, band: usize, windows: Windows) -> f64 {
    let filtered = band_filter(&render.left, BAND_FREQS[band], render.sample_rate);
    let at = |seconds: f32| ((render.sample_rate * seconds) as usize).min(filtered.len());

    let early = rms(&filtered[at(windows[0])..at(windows[1])]);
    let late = rms(&filtered[at(windows[2])..at(windows[3])]);
    if early <= 0.0 {
        return 0.0;
    }
    late / early
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
                let neutral_ratio = band_decay_ratio(&neutral, band);
                assert!(
                    neutral_ratio > 1e-6,
                    "{engine} @{sample_rate}: band {band} ({} Hz) has no measurable tail at the \
                     neutral setting, so nothing measured on it below means anything \
                     (ratio {neutral_ratio:e})",
                    BAND_FREQS[band]
                );

                let boosted = render(sample_rate, algorithm, &band_write(band, MAX_MULT));
                let boosted_ratio = band_decay_ratio(&boosted, band);
                assert!(
                    boosted_ratio > neutral_ratio * 1.15,
                    "{engine} @{sample_rate}: band {band} ({} Hz) at {MAX_MULT}x must hold more \
                     of its energy into the late tail than at {NEUTRAL_MULT}x — \
                     late/early was {boosted_ratio:.5} against {neutral_ratio:.5}",
                    BAND_FREQS[band]
                );

                let cut = render(sample_rate, algorithm, &band_write(band, MIN_MULT));
                let cut_ratio = band_decay_ratio(&cut, band);
                assert!(
                    cut_ratio < neutral_ratio * 0.87,
                    "{engine} @{sample_rate}: band {band} ({} Hz) at {MIN_MULT}x must lose its \
                     energy sooner than at {NEUTRAL_MULT}x — \
                     late/early was {cut_ratio:.5} against {neutral_ratio:.5}",
                    BAND_FREQS[band]
                );
            }
        }
    }
}

/// The half of the claim a bare delta cannot make: the band that moved is the
/// band that was dragged.
///
/// Compared against bands two or more positions away — 1.7 octaves per step, so
/// two steps is 3.4 octaves and well outside a `Q = 1` bell's skirt. Adjacent
/// bands are deliberately *not* asserted on: they overlap by design, a decay EQ
/// whose bands did not overlap would have audible gaps between them, and
/// pinning them apart would be pinning a defect.
#[test]
fn a_band_does_not_drag_the_far_side_of_the_spectrum_with_it() {
    for sample_rate in SAMPLE_RATES {
        for (algorithm, engine) in SHAPING_ENGINES {
            let neutral = render(sample_rate, algorithm, &[]);
            for band in 0..6 {
                let boosted = render(sample_rate, algorithm, &band_write(band, MAX_MULT));
                let own_change =
                    band_decay_ratio(&boosted, band) / band_decay_ratio(&neutral, band);

                for other in 0_usize..6 {
                    if other.abs_diff(band) < 2 {
                        continue;
                    }
                    let other_change =
                        band_decay_ratio(&boosted, other) / band_decay_ratio(&neutral, other);
                    assert!(
                        other_change < own_change * 0.6,
                        "{engine} @{sample_rate}: dragging band {band} ({} Hz) moved distant \
                         band {other} ({} Hz) by {other_change:.4}x against its own \
                         {own_change:.4}x — the curve is not band-limited",
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
            let mut previous = 0.0_f64;
            for multiplier in [MIN_MULT, 0.5, NEUTRAL_MULT, 2.0, MAX_MULT] {
                let ratio = band_decay_ratio_over(
                    &render(48_000.0, algorithm, &band_write(band, multiplier)),
                    band,
                    NEAR_WINDOWS,
                );
                assert!(
                    ratio > previous,
                    "{engine}: band {band} ({} Hz) must hold its tail longer at {multiplier}x \
                     than at the setting below it — late/early {ratio:.5} after {previous:.5}",
                    BAND_FREQS[band]
                );
                previous = ratio;
            }
        }
    }
}

// ── Transparency, stability and gating ─────────────────────────────────────

/// The default curve is not merely close to transparent, it is the identity.
///
/// This is the claim `plate_parameter_surface.rs`'s `UNTOUCHED_PLATE_DIGEST` and
/// `algorithm_switch_parameter_retention.rs`'s `UNTOLD_INSTANCE_DIGEST` rest on
/// — both survived this stage being instantiated, and neither was regenerated.
/// Asserted here rather than left to those two files, because they would also
/// stay green if the stage were simply never reached.
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
            let direct_ratio = band_decay_ratio(&direct, band);
            let round_ratio = band_decay_ratio(&round_tripped, band);
            assert!(
                (round_ratio - direct_ratio).abs() < direct_ratio * 0.02,
                "{engine}: band {band} ({} Hz) came back from an algorithm round trip shaping \
                 differently — late/early {round_ratio:.5} against {direct_ratio:.5}. The \
                 parameter cache is not carrying this id.",
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

/// Measurement `Q` for the calibration claim below.
///
/// Eight rather than the two the direction claims use, and narrower for a
/// reason: this measurement compares a band against *itself* under a different
/// Decay setting, so what a wide skirt admits is unshaped neighbour energy that
/// pulls every reading toward 1.0 and would flatter the invariance it is
/// checking. Bells only (bands 1-3): a shelf reaches half its design gain at
/// its own corner frequency, so its centre is the one place on the curve that
/// does not report the shelf's size.
const NARROW_Q: f32 = 8.0;

fn narrow_band_decay_ratio(render: &Render, band: usize) -> f64 {
    let filtered = filter_at(&render.left, BAND_FREQS[band], render.sample_rate, NARROW_Q);
    let at = |seconds: f32| ((render.sample_rate * seconds) as usize).min(filtered.len());
    let early = rms(&filtered[at(LONG_WINDOWS[0])..at(LONG_WINDOWS[1])]);
    let late = rms(&filtered[at(LONG_WINDOWS[2])..at(LONG_WINDOWS[3])]);
    if early <= 0.0 {
        return 0.0;
    }
    late / early
}

/// How many times longer the shaped band takes to fall by the same amount.
///
/// Both windows are the same two instants, so for a decay of the form
/// `e^(-t/tau)` the ratio is `e^(-dt/tau)` and `ln(neutral) / ln(shaped)` is
/// `tau_shaped / tau_neutral` with the window length cancelling out.
fn achieved_decay_multiplier(neutral_ratio: f64, shaped_ratio: f64) -> f64 {
    neutral_ratio.ln() / shaped_ratio.ln()
}

/// A curve set at one Decay setting means the same thing at the next one.
///
/// **This is the claim `head_room_db` exists for, and it is the one an
/// arbitrary fixed dB-per-multiplier would fail.** A decay multiplier is a
/// ratio, so the filter gain that delivers it has to be proportional to how
/// much the loop already loses per pass — which is a strong function of Decay:
/// on the plate at 0.4 the tank loses about 8 dB per half-traversal and at 0.85
/// about 1.4 dB. A stage that applied a constant boost would therefore deliver
/// a wildly different decay multiplier at each end of the Decay knob, and every
/// direction-only guard in this file would still pass.
///
/// The tolerance is on the *spread across Decay settings*, not on the absolute
/// multiplier, and deliberately so. The absolute number is **not** asserted:
/// the delivered multiplier at a band centre depends on the band's shape and on
/// what else sits in that engine's loop — measured between 1.5x and 3.4x for a
/// declared 4.0x, in a windowed RMS estimate of a modal tail that is not a
/// single exponential — and pinning a figure like that would be pinning the
/// estimator. What is stable, and what the design promises, is that the figure
/// does not move when Decay does.
#[test]
fn the_shaping_a_band_delivers_does_not_depend_on_the_decay_setting() {
    // `damping` at zero so the only per-pass loss in the loop is the one the
    // stage is told about: the plate's `OnePole` and the spring's damper both
    // become pass-throughs, and the FDN's absorptive filter puts its HF corner
    // above the bands measured here.
    for (algorithm, engine) in SHAPING_ENGINES {
        for band in [1_usize, 2, 3] {
            let mut delivered = Vec::new();
            for decay in [0.4_f32, 0.55, 0.7, 0.85] {
                let base: Vec<Write> = vec![("damping", 0.0), ("decay", decay)];
                let mut shaped = base.clone();
                shaped.push((BAND_PARAM_IDS[band], MAX_MULT));

                let neutral_ratio = narrow_band_decay_ratio(&render(48_000.0, algorithm, &base), band);
                let shaped_ratio = narrow_band_decay_ratio(&render(48_000.0, algorithm, &shaped), band);
                assert!(
                    neutral_ratio > 1e-6 && shaped_ratio > 1e-6,
                    "{engine}: band {band} has no measurable tail at decay {decay} \
                     ({neutral_ratio:e} neutral, {shaped_ratio:e} shaped)"
                );
                delivered.push((decay, achieved_decay_multiplier(neutral_ratio, shaped_ratio)));
            }

            let mean = delivered.iter().map(|(_, value)| value).sum::<f64>() / delivered.len() as f64;
            // A boost that delivered nothing would have a mean near 1.0 and a
            // tiny spread, which would pass the spread check on its own.
            assert!(
                mean > 1.4,
                "{engine}: band {band} at {MAX_MULT}x delivered a mean decay multiplier of only \
                 {mean:.2}, so the spread below says nothing"
            );
            for (decay, value) in delivered.iter() {
                assert!(
                    (value - mean).abs() < mean * 0.15,
                    "{engine}: band {band} at {MAX_MULT}x delivered {value:.2}x at decay {decay} \
                     against a mean of {mean:.2}x across the Decay range — the shaping is not \
                     relative to the loop's own per-pass loss"
                );
            }
        }
    }
}
