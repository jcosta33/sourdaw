//! Does a Dutch Oven nobody has written to actually damp?
//!
//! The plate shipped `damping: 0.0005` in its constructor while the Damp
//! knob's reset target and `DEFAULT_PARAMS.damping` both said `0.3` (#1546).
//! The knob's *readout* was not part of the disagreement — it displays the
//! stored value, so an old device read "0%" and agreed with the engine, which
//! is why nobody saw this by looking. Nothing else could see it either: every
//! guard
//! in `plate_parameter_surface.rs` compares two renders that both run through
//! the same mapping, and the TypeScript census
//! (`declaredDefaultConsensus.spec.ts`) compares declared *numbers* to each
//! other. A number-to-number check cannot tell you whether the filter it seeds
//! is doing anything, which is the whole question: `0.0005` in this repo's
//! `OnePole` (`y = (1−c)x + c·y₁`) attenuates **0.0087 dB at Nyquist**. It is
//! not light damping, it is bypass with a non-zero literal in front of it.
//!
//! So this file measures the rendered spectrum instead. The claim under test is
//! the product claim — *a plate loses treble as it decays* — expressed as the
//! 6–12 kHz band power against the 400–1200 Hz band power, compared between an
//! early and a late window of the same tail.
//!
//! Two things make that a claim about the shipped instance rather than about
//! the mapping:
//!
//! * **Nothing writes `damping`.** `untouched()` writes only `algorithm` and
//!   `mix`, so the coefficient under measurement is the constructor literal —
//!   the one an added device runs before any panel interaction.
//! * **The reference is an absolute threshold, not a second render.** A
//!   `render(&[])` vs `render(&[("damping", 0.3)])` comparison passes at
//!   *any* shared value, including 0.0005 on both sides.
//!
//! The output stage's default 12 kHz high cut sits downstream of everything
//! here and applies identically to every window, so it shifts the absolute
//! ratios down and cancels out of the early-to-late difference.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const PLATE: f32 = 0.0;

/// 4 s of tail at 48 kHz.
const RENDER_FRAMES: usize = 192_000;

/// Early tail window: 0.55 s – 1.0 s. Past the early reflections (last tap
/// 67 ms) and past the predelay, so only the tank is sounding.
const EARLY_TAIL: (usize, usize) = (26_400, 48_000);
/// Late tail window: 1.5 s – 3.0 s. Far enough in that a damped tank has had
/// hundreds of circulations to shed treble.
const LATE_TAIL: (usize, usize) = (72_000, 144_000);

const HF_BAND: (f32, f32) = (6_000.0, 12_000.0);
const MID_BAND: (f32, f32) = (400.0, 1_200.0);

/// A parameter write applied before rendering.
type Write = (&'static str, f32);

/// The other algorithms `damping` reaches, by the wire value `set_param`
/// takes. Reverse (6) is deliberately absent: `damping` is bit-dead on it
/// across the whole declared range, which `nativeDspEngineGaps.ts` already
/// records and the panel already gates, so a monotonicity claim there would be
/// a claim about a control the user cannot reach.
const FDN8: f32 = 1.0;
const FDN16: f32 = 2.0;
const SPRING: f32 = 3.0;

/// Unit impulse into a fully wet engine. An impulse excites every band at once,
/// so a single render answers the whole spectral question without a stimulus
/// choice biasing one band over another.
fn render_on(algorithm: f32, writes: &[Write]) -> Vec<f32> {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    instance.set_param("mix", 1.0);
    for &(name, value) in writes {
        instance.set_param(name, value);
    }

    let mut output = Vec::with_capacity(RENDER_FRAMES);
    let mut index = 0;
    while index < RENDER_FRAMES {
        let left: Vec<f32> = (0..BLOCK)
            .map(|i| if index + i == 0 { 1.0 } else { 0.0 })
            .collect();
        let right = left.clone();
        let ptr = instance.process(&left, &right, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        for i in 0..BLOCK {
            let sample = unsafe { *ptr.add(i) };
            assert!(
                sample.is_finite(),
                "non-finite output sample at {}",
                index + i
            );
            output.push(sample);
        }
        index += BLOCK;
    }
    output
}

/// The plate, which is the algorithm every project runs until something writes
/// the selector, and the one whose constructor default #1546 moved.
fn render(writes: &[Write]) -> Vec<f32> {
    render_on(PLATE, writes)
}

/// The shipped instance: `damping` is never written, so the constructor
/// literal is what renders.
fn untouched() -> Vec<f32> {
    render(&[])
}

// ---------------------------------------------------------------------------
// Spectral measurement
// ---------------------------------------------------------------------------

/// In-place iterative radix-2 Cooley-Tukey FFT. Test-only, so allocation and
/// `f64` are both fine here; nothing in this file runs on an audio thread.
fn fft(re: &mut [f64], im: &mut [f64]) {
    let n = re.len();
    assert!(n.is_power_of_two(), "fft length {n} is not a power of two");

    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }

    let mut len = 2usize;
    while len <= n {
        let angle = -2.0 * std::f64::consts::PI / len as f64;
        let (wr, wi) = (angle.cos(), angle.sin());
        let mut i = 0usize;
        while i < n {
            let (mut cur_r, mut cur_i) = (1.0_f64, 0.0_f64);
            for k in 0..len / 2 {
                let (ur, ui) = (re[i + k], im[i + k]);
                let (vr, vi) = (
                    re[i + k + len / 2] * cur_r - im[i + k + len / 2] * cur_i,
                    re[i + k + len / 2] * cur_i + im[i + k + len / 2] * cur_r,
                );
                re[i + k] = ur + vr;
                im[i + k] = ui + vi;
                re[i + k + len / 2] = ur - vr;
                im[i + k + len / 2] = ui - vi;
                let next_r = cur_r * wr - cur_i * wi;
                cur_i = cur_r * wi + cur_i * wr;
                cur_r = next_r;
            }
            i += len;
        }
        len <<= 1;
    }
}

/// Summed power in `[low, high)` Hz over a Hann-windowed slice, zero-padded to
/// the next power of two.
fn band_power(window: &[f32], band: (f32, f32)) -> f64 {
    let n = window.len().next_power_of_two();
    let mut re = vec![0.0_f64; n];
    let mut im = vec![0.0_f64; n];
    let span = window.len() as f64;
    for (i, sample) in window.iter().enumerate() {
        let hann = 0.5 - 0.5 * (2.0 * std::f64::consts::PI * i as f64 / span).cos();
        re[i] = f64::from(*sample) * hann;
    }
    fft(&mut re, &mut im);

    let bin_hz = f64::from(SAMPLE_RATE) / n as f64;
    let first = (f64::from(band.0) / bin_hz).ceil() as usize;
    let last = (f64::from(band.1) / bin_hz).floor() as usize;
    assert!(
        last > first,
        "band {band:?} spans no bins at {n}-point resolution"
    );
    (first..last.min(n / 2))
        .map(|k| re[k] * re[k] + im[k] * im[k])
        .sum()
}

/// 6–12 kHz against 400–1200 Hz, in dB, over one window of the tail.
///
/// Positive means the treble band carries more energy than the midrange band.
/// The two bands have different widths, so the absolute figure is not a
/// flatness measure — it is a fixed yardstick, and what carries the claim is
/// how it moves between windows of the same render.
fn hf_over_mid_db(output: &[f32], window: (usize, usize)) -> f64 {
    let slice = &output[window.0..window.1.min(output.len())];
    let hf = band_power(slice, HF_BAND);
    let mid = band_power(slice, MID_BAND);
    assert!(mid > 0.0, "midrange band is silent; the render is dead");
    10.0 * (hf / mid).log10()
}

/// How much treble the tail sheds between the early and late windows, in dB.
/// Larger is more damped.
fn hf_loss_db(output: &[f32]) -> f64 {
    hf_over_mid_db(output, EARLY_TAIL) - hf_over_mid_db(output, LATE_TAIL)
}

/// The late window's HF-over-mid figure on its own. More negative is darker.
///
/// This is the measure the cross-algorithm guard uses, and the choice is not
/// cosmetic. `hf_loss_db` — the early-to-late *difference* — is **not**
/// monotone in `damping` on the FDN: measured on this stimulus, FDN 8 gives
/// 20.39 → 27.41 → 36.04 dB across 0.0005 / 0.15 / 0.3 and then falls back to
/// 33.67 dB at 0.5, because past a point the treble is already gone by the
/// early window and there is less left to shed. A guard written on loss would
/// have to carve out that reversal. The late-window tilt has no such turn: it
/// is monotone on all three algorithms across the whole sweep, and it is also
/// the number a listener would describe, since it says what the tail sounds
/// like rather than how it got there.
fn late_tilt_db(output: &[f32]) -> f64 {
    hf_over_mid_db(output, LATE_TAIL)
}

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

/// Measured on this file's stimulus (unit impulse, `mix = 1`, everything else
/// at its constructor value) by `damping_monotonically_darkens_the_tail`:
///
/// | damping | early 0.55–1.0 s | late 1.5–3.0 s | HF loss |
/// | --- | --- | --- | --- |
/// | 0.0005 (pre-#1546) | +5.10 dB | **+0.21 dB** | 4.88 dB |
/// | 0.15 | +3.47 dB | −3.46 dB | 6.94 dB |
/// | **0.3 (shipped)** | +1.21 dB | **−8.45 dB** | 9.66 dB |
/// | 0.5 | −3.14 dB | −18.28 dB | 15.15 dB |
///
/// The threshold sits between the shipped value's 9.66 dB and the *next
/// setting down* (0.15, 6.94 dB), not merely above the defect. A guard placed
/// just above 4.88 dB would have passed on `damping = 0.15` — half the shipped
/// value — and a bound fitted to the defect is not a bound. 7.5 dB leaves
/// 2.2 dB of headroom for ordinary DSP work upstream while refusing anything
/// as bright as the pre-#1546 constructor or half of the current one.
const MIN_HF_LOSS_DB: f64 = 7.5;

#[test]
fn the_shipped_plate_sheds_treble_as_it_decays() {
    let output = untouched();
    let early = hf_over_mid_db(&output, EARLY_TAIL);
    let late = hf_over_mid_db(&output, LATE_TAIL);
    let loss = early - late;

    assert!(
        loss >= MIN_HF_LOSS_DB,
        "an untouched plate should shed at least {MIN_HF_LOSS_DB} dB of 6–12 kHz \
         energy relative to 400–1200 Hz between 0.55–1.0 s and 1.5–3.0 s; \
         measured {loss:.2} dB (early {early:.2} dB, late {late:.2} dB). \
         The pre-#1546 constructor value of 0.0005 measures 4.88 dB here."
    );
}

#[test]
fn the_shipped_plate_is_darker_than_its_own_midrange_late_in_the_tail() {
    // The failure mode #1546 describes in one number: two seconds into the
    // tail the 6–12 kHz band was *louder* than 400–1200 Hz. This is the
    // absolute half of the claim — the relative guard above still passes on a
    // tank that starts implausibly bright and merely gets less so.
    let output = untouched();
    let late = hf_over_mid_db(&output, LATE_TAIL);
    assert!(
        late < 0.0,
        "two seconds into an untouched plate's tail the 6–12 kHz band should sit \
         below 400–1200 Hz; measured {late:+.2} dB. A positive figure means the \
         tank is ringing undamped, which is what the 0.0005 constructor did."
    );
}

#[test]
fn damping_monotonically_darkens_the_tail() {
    // Anti-vacuity for the two guards above: they measure a fixed instance, so
    // they would also pass on an engine where `damping` no longer reached the
    // filter and something else happened to be dark. This walks the control
    // and requires the measurement to respond, at interior points.
    //
    // Kept on `hf_loss_db` for the plate specifically, because the plate is the
    // algorithm whose default this change moves and loss is the quantity the
    // 7.5 dB bar above is written in. The cross-algorithm walk below uses the
    // late-window tilt instead, for the reason `late_tilt_db` documents.
    let mut previous = f64::NEG_INFINITY;
    for step in [0.0005_f32, 0.15, 0.3, 0.5] {
        let loss = hf_loss_db(&render(&[("damping", step)]));
        assert!(
            loss > previous + 0.5,
            "HF loss should rise with damping; at {step} it was {loss:.2} dB \
             against {previous:.2} dB at the step below"
        );
        previous = loss;
    }
}

/// Every algorithm that can hear `damping` has to darken when it is turned up.
///
/// The gap this closes: before it, nothing in the crate could see `damping`
/// break on anything but the plate. Every other test that writes the parameter
/// — `algorithm_switch_parameter_retention.rs:98`'s `("damping", 0.41)` — puts
/// the same write on *both* sides of its comparison, so an arm dropped from
/// `FdnReverb::set_param` or `SpringReverb::set_param` drops on both sides and
/// the row still passes. That is the same vacuity this file's header calls out
/// for `render(&[])` versus `render(&[("damping", 0.3)])`, one level up.
///
/// Verified by mutation rather than assumed: with this test absent, deleting
/// the spring's `damping` arm left the whole crate at `23 passed; 0 failed`,
/// and so did deleting the FDN's. A refactor could silently kill the Damp knob
/// on three of the five algorithms and no guard would move.
///
/// Interior points, not the extremes, and a per-step separation requirement, so
/// a wire that reacts only at 0 and 1 still reds.
#[test]
fn damping_darkens_the_late_tail_on_every_algorithm_that_hears_it() {
    for (algorithm, name) in [
        (PLATE, "plate"),
        (FDN8, "fdn-8"),
        (FDN16, "fdn-16"),
        (SPRING, "spring"),
    ] {
        let mut previous = f64::INFINITY;
        for step in [0.0005_f32, 0.15, 0.3, 0.5] {
            let tilt = late_tilt_db(&render_on(algorithm, &[("damping", step)]));
            assert!(
                tilt < previous - 0.5,
                "on {name}, the late window's 6–12 kHz tilt should fall as damping \
                 rises; at {step} it was {tilt:+.2} dB against {previous:+.2} dB at \
                 the step below. A flat sequence means `damping` is not reaching \
                 this algorithm's filter at all."
            );
            previous = tilt;
        }
    }
}

#[test]
fn the_constructor_default_renders_as_the_value_the_panel_resets_to() {
    // The panel's Damp knob resets to 0.3 (`ProofChamberPanel.tsx`) and
    // `DEFAULT_PARAMS.damping` is 0.3. This is the render-side half of that: an
    // instance nobody has written to must be bit-identical to one explicitly
    // set to 0.3, so the reset target and the shipped instance are the same
    // reverb rather than two.
    //
    // 0.3 is on the knob's `step={0.001}` grid and survives the f32 round trip
    // through `set_param`, so "identical" is the right strength here — an
    // off-grid constructor value could not be reached from the panel at all,
    // which is the second defect #1546 records.
    let untouched = untouched();
    let explicit = render(&[("damping", 0.3)]);
    let delta = untouched
        .iter()
        .zip(explicit.iter())
        .fold(0.0_f32, |acc, (a, b)| acc.max((a - b).abs()));
    assert!(
        delta == 0.0,
        "an engine nobody wrote to should render as damping=0.3; \
         peak difference {delta:e}"
    );

    // And 0.3 is not an inert point that would make the check vacuous.
    let elsewhere = render(&[("damping", 0.6)]);
    let separation = untouched
        .iter()
        .zip(elsewhere.iter())
        .fold(0.0_f32, |acc, (a, b)| acc.max((a - b).abs()));
    assert!(
        separation > 1e-5,
        "damping=0.3 and damping=0.6 render identically; the control is inert \
         and the guard above proves nothing (peak difference {separation:e})"
    );
}

// ---------------------------------------------------------------------------
// The input bandwidth filter
// ---------------------------------------------------------------------------

/// The coefficient the constructor seeds `bandwidth_filter` with, read out of
/// the source rather than restated, so this file cannot go on describing a
/// filter the engine has stopped building.
fn declared_bandwidth_coefficient() -> f64 {
    let source = include_str!("../src/proof_chamber.rs");
    let line = source
        .lines()
        .find(|line| {
            line.trim_start()
                .starts_with("bandwidth_filter: OnePole::new(")
        })
        .expect("no `bandwidth_filter: OnePole::new(...)` line in proof_chamber.rs");
    let arguments = line
        .split_once("OnePole::new(")
        .expect("malformed constructor line")
        .1
        .split_once(')')
        .expect("malformed constructor line")
        .0;
    // The literal is written as Dattorro's bandwidth complemented — `1.0 - b` —
    // so the decision reads off the paper's number rather than off its inverse.
    let (one, bandwidth) = arguments
        .split_once('-')
        .expect("expected the coefficient to be written as `1.0 - <bandwidth>`");
    assert_eq!(
        one.trim(),
        "1.0",
        "unexpected complement base in {arguments}"
    );
    let bandwidth: f64 = bandwidth
        .trim()
        .parse()
        .expect("bandwidth literal is not a number");
    1.0 - bandwidth
}

/// Worst-case attenuation, in dB, of a single pass through this file's
/// `OnePole` difference equation at `coefficient` — measured from its impulse
/// response, not derived.
fn one_pole_worst_case_attenuation_db(coefficient: f64) -> f64 {
    const N: usize = 8192;
    let mut re = vec![0.0_f64; N];
    let mut im = vec![0.0_f64; N];
    let mut state = 0.0_f64;
    for (index, slot) in re.iter_mut().enumerate() {
        let input = if index == 0 { 1.0 } else { 0.0 };
        state = input * (1.0 - coefficient) + state * coefficient;
        *slot = state;
    }
    fft(&mut re, &mut im);

    let mut worst = 0.0_f64;
    for k in 0..N / 2 {
        let magnitude = (re[k] * re[k] + im[k] * im[k]).sqrt();
        let attenuation = -20.0 * magnitude.log10();
        if attenuation > worst {
            worst = attenuation;
        }
    }
    worst
}

/// **Secondary.** The load-bearing check on the input filter is
/// `proof_chamber::tests::the_input_bandwidth_filter_has_no_audible_authority_on_the_running_engine`,
/// which reads `self.bandwidth_filter.coeff` off the engine after a render and
/// after every advertised parameter has been driven across its range.
///
/// This row was the first revision of that guard, and on its own it was wrong
/// in exactly the way this file documents elsewhere: it parses the *constructor
/// literal* out of the source, and a constructor literal is not the engine.
/// `left_damp: OnePole::new(0.3)` twenty lines below the parsed line is dead —
/// `process()` overwrites `.coeff` every block — so a source parse would have
/// vouched for a filter whose coefficient it never saw. A live `set_param` arm
/// reaching `bandwidth_filter`, with the literal untouched, left this test
/// green.
///
/// It is kept, demoted, for the one thing it does see that the unit test does
/// not: whether the literal the comment in `proof_chamber.rs` cites is still
/// the literal in the file. A comment citing Dattorro's 0.9995 beside a
/// constructor that has stopped writing 0.9995 is a documentation defect even
/// when the engine is fine.
#[test]
fn the_constructor_still_writes_the_bandwidth_literal_the_comment_cites() {
    let coefficient = declared_bandwidth_coefficient();
    let attenuation = one_pole_worst_case_attenuation_db(coefficient);

    assert!(
        attenuation < 0.05,
        "the constructor now seeds the input bandwidth filter at a coefficient \
         worth {attenuation:.4} dB ({coefficient:e}), which is not the \
         near-open filter the comment beside that line describes. Fix the \
         comment or re-take the decision — and check the unit test in \
         proof_chamber.rs, which measures the running engine."
    );

    // And the comparison the decision rests on: whatever the input filter does,
    // the tail is shaped by the tank's damping, which is inside the loop.
    let tail_loss = hf_loss_db(&untouched());
    assert!(
        tail_loss > 100.0 * attenuation,
        "the tail's HF loss ({tail_loss:.2} dB) should dwarf the input filter's \
         entire authority ({attenuation:.4} dB); if it does not, the input \
         filter — not `damping` — is what shapes this reverb"
    );
}

/// On the spring, 0.3 is not a new voicing — it is the engine's own.
///
/// `SpringReverb::new` seeds `damping: 0.3` (`spring.rs:102`), unchanged since
/// the crate's first commit. The descriptor's old 0.0005 was *overwriting* that
/// designed value on every instance, and the result was the same failure this
/// file documents on the plate: measured on this stimulus, the spring's late
/// window sat at **+7.36 dB** — treble above midrange — against **−17.72 dB**
/// at its constructor value. Aligning the descriptor with 0.3 stops the
/// overwrite, so the spring now renders what it was built to render.
///
/// This is asserted rather than narrated because it is the one algorithm where
/// the descriptor value and the engine's own default coincide, and a future
/// per-algorithm default table (the real fix for the FDN, see the descriptor
/// comment) must not quietly move the spring off its own number.
#[test]
fn the_descriptor_default_restores_the_springs_own_designed_damping() {
    let untouched_spring = render_on(SPRING, &[]);
    let at_descriptor_default = render_on(SPRING, &[("damping", 0.3)]);

    let delta = untouched_spring
        .iter()
        .zip(at_descriptor_default.iter())
        .fold(0.0_f32, |acc, (a, b)| acc.max((a - b).abs()));
    assert!(
        delta == 0.0,
        "writing the descriptor's 0.3 to the spring should reproduce its own \
         constructor default bit for bit; peak difference {delta:e}"
    );

    // And what the old descriptor value did to it, so the claim above is not
    // just "two numbers match".
    let at_old_default = late_tilt_db(&render_on(SPRING, &[("damping", 0.0005)]));
    let at_new_default = late_tilt_db(&at_descriptor_default);
    assert!(
        at_old_default > 0.0,
        "the pre-#1546 descriptor value should leave the spring's late tail \
         brighter than its own midrange, which is the defect; measured \
         {at_old_default:+.2} dB"
    );
    assert!(
        at_new_default < -10.0,
        "the spring's own default should leave a clearly darkened late tail; \
         measured {at_new_default:+.2} dB"
    );
}
