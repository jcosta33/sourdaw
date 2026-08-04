//! Every selectable Bacteria distortion mode must render differently, and the
//! delay any of them imposes must be the delay the host is told about.
//!
//! `BacteriaPanel` offers nine modes and `DISTORTION_MODE_INDEX` encodes all
//! nine down to the engine. A mode that renders bit-identically to another one
//! is a control that reaches no DSP. Two of them did: before this file,
//! `breakdown` (6) and `smudge` (7) both fell through to `soft_clip` in
//! `DistortionProcessor::process_sample`, so the two panel buttons and the
//! 0–4 octave `breakdownDepth` slider produced a max divergence of exactly
//! 0.000e0 against `soft-clip`.
//!
//! Smudge is now wired. Breakdown is not, and the tests at the bottom of this
//! file pin *why* rather than leaving it to be rediscovered.

use daw_dsp::bacteria::BacteriaInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// 2048-point STFT at a 512 hop: the spectral modes need several frames of
/// history before they diverge from a memoryless shaper at all.
const BLOCKS: usize = 96;

const SOFT_CLIP: u32 = 0;
const BREAKDOWN: u32 = 6;
const SMUDGE: u32 = 7;

/// `SmudgeProcessor`'s overlap-add window, in samples at the rate it is fed.
const SMUDGE_WINDOW: u32 = 2048;

/// Deterministic stimulus with transients — a decaying pulse train over a
/// sine, so both a memoryless shaper and a transient-blurring one have
/// something to act on.
fn stimulus(index: usize) -> f32 {
    let t = index as f32 / SAMPLE_RATE;
    let sine = (2.0 * std::f32::consts::PI * 220.0 * t).sin() * 0.5;
    let pulse_phase = index % 4800;
    let pulse = if pulse_phase < 64 {
        0.45 * (1.0 - pulse_phase as f32 / 64.0)
    } else {
        0.0
    };
    sine + pulse
}

/// Drive that pushes `tanh` well into saturation — the setting a mode
/// comparison wants, because it is the one a user reaches for.
const HARD_DRIVE: f32 = 40.0;
/// Drive of zero leaves `tanh` near-linear over this stimulus, so anything a
/// mode does to the waveform's *shape* or *level* survives to the output
/// instead of being flattened by the shaper it feeds.
const GENTLE_DRIVE: f32 = 0.0;

fn configure(mode: u32, drive: f32, breakdown_depth: f32) -> BacteriaInstance {
    let mut instance = BacteriaInstance::new(SAMPLE_RATE);
    instance.set_param("bandCount", 1.0);
    instance.set_param("band0_distortionEnabled", 1.0);
    instance.set_param("band0_distortionMode", mode as f32);
    instance.set_param("band0_drive", drive);
    instance.set_param("band0_breakdownDepth", breakdown_depth);
    instance.set_param("mix", 1.0);
    instance
}

/// Render `BLOCKS` blocks of `stimulus` into both channels, returning
/// (left, right).
fn render_stereo(instance: &mut BacteriaInstance, right_gain: f32) -> (Vec<f32>, Vec<f32>) {
    let mut left_out = Vec::with_capacity(BLOCKS * BLOCK);
    let mut right_out = Vec::with_capacity(BLOCKS * BLOCK);
    for block in 0..BLOCKS {
        unsafe {
            let left = instance.get_input_left_ptr();
            let right = instance.get_input_right_ptr();
            for i in 0..BLOCK {
                let sample = stimulus(block * BLOCK + i);
                *left.add(i) = sample;
                *right.add(i) = sample * right_gain;
            }
        }
        let left_ptr = instance.process(BLOCK as u32);
        let right_ptr = instance.get_right_ptr();
        for i in 0..BLOCK {
            left_out.push(unsafe { *left_ptr.add(i) });
            right_out.push(unsafe { *right_ptr.add(i) });
        }
    }
    (left_out, right_out)
}

fn render(mode: u32, drive: f32, breakdown_depth: f32) -> Vec<f32> {
    let mut instance = configure(mode, drive, breakdown_depth);
    render_stereo(&mut instance, 1.0).0
}

/// Render `total` samples of an arbitrary mono signal into both channels,
/// returning the left output.
fn render_signal(
    instance: &mut BacteriaInstance,
    total: usize,
    signal: impl Fn(usize) -> f32,
) -> Vec<f32> {
    let mut rendered = Vec::with_capacity(total);
    let blocks = total.div_ceil(BLOCK);
    for block in 0..blocks {
        unsafe {
            let left = instance.get_input_left_ptr();
            let right = instance.get_input_right_ptr();
            for i in 0..BLOCK {
                let value = signal(block * BLOCK + i);
                *left.add(i) = value;
                *right.add(i) = value;
            }
        }
        let out = instance.process(BLOCK as u32);
        for i in 0..BLOCK {
            rendered.push(unsafe { *out.add(i) });
        }
    }
    rendered
}

/// Peak and RMS over the settled tail — past the overlap-add warmup and past
/// the recursive magnitude smoother's settling.
fn tail_peak_and_rms(samples: &[f32]) -> (f32, f32) {
    let window = &samples[BLOCKS * BLOCK / 2..];
    let rms = (window.iter().map(|s| s * s).sum::<f32>() / window.len() as f32).sqrt();
    (peak(window), rms)
}

fn divergence(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .fold(0.0_f32, |acc, (x, y)| acc.max((x - y).abs()))
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()))
}

// ── Smudge ───────────────────────────────────────────────────────────────────

#[test]
fn smudge_renders_differently_from_soft_clip() {
    let reference = render(SOFT_CLIP, HARD_DRIVE, 2.0);
    let smudge = render(SMUDGE, HARD_DRIVE, 2.0);

    assert!(
        peak(&reference) > 1e-3,
        "the reference render fell silent, so this comparison proves nothing"
    );
    let d = divergence(&reference, &smudge);
    assert!(
        d > 1e-3,
        "distortionMode 7 (smudge) renders identically to mode 0 \
         (soft-clip) — max divergence {d:.3e}. The mode is selectable in \
         BacteriaPanel and reaches no distinct DSP."
    );
}

/// Smudge claims to blur transients. A blurred transient is a lower peak
/// against the same sustained material, so its crest factor has to drop.
///
/// Measured as the rise of a hard-gated sine onset, each mode against its own
/// steady state so the two modes' different group delays cancel out of the
/// comparison. A memoryless shaper reproduces the edge; a recursive magnitude
/// smoother at `blur_alpha` 0.85 has only reached `1 − 0.85⁴ ≈ 48 %` of the
/// new magnitudes four hops after it arrives.
///
/// Run at [`GENTLE_DRIVE`]: at a saturating drive `tanh` pins both envelopes
/// near full scale from the first cycle and the measurement stops being about
/// the blur at all. A crest-factor comparison on the mixed stimulus does not
/// work either — the sustained sine, not the transient, sets the peak, and the
/// two modes come out 1.594 against 1.655.
#[test]
fn smudge_blurs_the_transients_it_claims_to_blur() {
    /// Onset placed well past the overlap-add warmup.
    const ONSET: usize = 8192;
    const TOTAL: usize = ONSET + 40_960;

    let gated_sine = |index: usize| {
        if index < ONSET {
            return 0.0;
        }
        let t = index as f32 / SAMPLE_RATE;
        (2.0 * std::f32::consts::PI * 220.0 * t).sin() * 0.5
    };

    let rise_fraction = |mode: u32| {
        let mut instance = configure(mode, GENTLE_DRIVE, 2.0);
        let delay = instance.get_latency_samples() as usize;
        let rendered = render_signal(&mut instance, TOTAL, gated_sine);
        let arrival = ONSET + delay;
        let early = peak(&rendered[arrival + 1024..arrival + 2048]);
        let steady = peak(&rendered[arrival + 24_576..arrival + 28_672]);
        early / steady
    };

    // Presence pin: the measurement has to be able to see an unblurred edge,
    // or "smudge is low" would be satisfied by a window that reads zero for
    // everything.
    let reference_rise = rise_fraction(SOFT_CLIP);
    assert!(
        reference_rise > 0.95,
        "soft-clip reached only {reference_rise:.3} of its steady state one \
         window after the onset, so this measurement is not reading an edge \
         and proves nothing about smudge"
    );

    let smudge_rise = rise_fraction(SMUDGE);
    assert!(
        smudge_rise < 0.8,
        "smudge reached {smudge_rise:.3} of its steady state one window after \
         the onset against soft-clip's {reference_rise:.3} — the transient \
         blur is not in the path"
    );
}

/// Smudge must not be unity-gain's problem: the Hann analysis/synthesis pair
/// carries a coherent overlap-add gain of exactly 3/2, and `SmudgeProcessor`
/// divides it back out. Without that, selecting the mode raises the band
/// +3.5 dB.
///
/// Measured as RMS over the settled tail at [`GENTLE_DRIVE`], where the shaper
/// is near-linear. At a saturating drive `tanh` flattens a 3.5 dB input
/// difference into a fraction of a dB and this would pass with the correction
/// deleted.
#[test]
fn smudge_does_not_change_the_bands_level() {
    let (_, reference_rms) = tail_peak_and_rms(&render(SOFT_CLIP, GENTLE_DRIVE, 2.0));
    let (_, smudge_rms) = tail_peak_and_rms(&render(SMUDGE, GENTLE_DRIVE, 2.0));

    let ratio_db = 20.0 * (smudge_rms / reference_rms).log10();
    assert!(
        ratio_db.abs() < 1.5,
        "smudge sits {ratio_db:+.2} dB against soft-clip on the same \
         material. The overlap-add gain is not being divided back out."
    );
}

/// One `DistortionProcessor` serves both channels, so Smudge keeps one STFT
/// per channel. A shared one would receive `L₀, R₀, L₁, R₁, …` and analyse a
/// 2048-point window of interleaved stereo.
///
/// Stated as independence rather than as leakage: what the left channel
/// renders must not depend on what the right channel carries. Measuring a
/// silent right channel for crosstalk does *not* catch a shared buffer —
/// interleaving a signal with zeros mostly leaves the zeros alone, and that
/// version of this test passed with `smudge[0]` hard-coded for both channels.
#[test]
fn smudge_processes_each_channel_independently() {
    let mut matched = configure(SMUDGE, GENTLE_DRIVE, 2.0);
    let (left_against_itself, _) = render_stereo(&mut matched, 1.0);

    // Same left input, a right channel carrying something else entirely.
    let mut differing = configure(SMUDGE, GENTLE_DRIVE, 2.0);
    let (left_against_other, _) = render_stereo(&mut differing, -0.35);

    assert!(
        peak(&left_against_itself) > 1e-2,
        "the left channel fell silent, so this comparison proves nothing"
    );
    let d = divergence(&left_against_itself, &left_against_other);
    assert!(
        d < 1e-6,
        "the left channel moved by {d:.3e} when only the *right* input \
         changed — the two channels are sharing one overlap-add buffer"
    );
}

// ── Latency ──────────────────────────────────────────────────────────────────

/// The window is a real delay and the host has to be told about it.
///
/// Derived from the configured mode, not from `distortionEnabled` — the same
/// stable-worst-case policy `BandChain::latency_samples` applies to the
/// oversampler.
#[test]
fn reported_latency_follows_the_smudge_window() {
    let soft = configure(SOFT_CLIP, HARD_DRIVE, 2.0);
    assert_eq!(
        soft.get_latency_samples(),
        0,
        "a memoryless shaper at 1x must report no latency"
    );

    let smudge = configure(SMUDGE, HARD_DRIVE, 2.0);
    assert_eq!(
        smudge.get_latency_samples(),
        SMUDGE_WINDOW,
        "smudge's overlap-add window is not reaching the reported latency"
    );

    // Inside the oversampled loop the window is 2048 samples of the *8x*
    // stream — 256 base-rate samples — on top of the oversampler's own 11.375.
    let mut oversampled = configure(SMUDGE, HARD_DRIVE, 2.0);
    oversampled.set_param("band0_oversampling", 8.0);
    assert_eq!(
        oversampled.get_latency_samples(),
        267,
        "smudge at 8x must report 2048/8 + 11.375 base-rate samples"
    );
}

/// The oversampling parameter accepts any integer 1..=8, but the chain is a
/// cascade of 2x stages and snaps to a power of two — 3 runs at 2x, and 5, 6
/// and 7 all run at 4x.
///
/// So the reported latency has to be computed from the rate the chain is
/// *actually* running at. Dividing the window by the requested value instead
/// reports a delay the band does not deliver, and because the internal
/// cross-band alignment reads the same figure, the bands comb against each
/// other rather than merely arriving late.
///
/// Every other latency case here uses a power of two, which is exactly why this
/// went unnoticed: at 1, 2, 4 and 8 the requested and effective factors agree.
#[test]
fn reported_latency_uses_the_effective_oversampling_factor_not_the_requested_one() {
    // (requested, effective) — the chain rounds down to the nearest power of two.
    for (requested, effective) in [(3.0_f32, 2.0_f32), (5.0, 4.0), (6.0, 4.0), (7.0, 4.0)] {
        let mut requested_chain = configure(SMUDGE, HARD_DRIVE, 2.0);
        requested_chain.set_param("band0_oversampling", requested);

        let mut effective_chain = configure(SMUDGE, HARD_DRIVE, 2.0);
        effective_chain.set_param("band0_oversampling", effective);

        assert_eq!(
            requested_chain.get_latency_samples(),
            effective_chain.get_latency_samples(),
            "oversampling {requested} runs at {effective}x, so it must report {effective}x's latency \
             — reporting the requested factor's is a delay the band never delivers"
        );
    }
}

/// The reported number has to be the delay the device actually delivers, or
/// plugin delay compensation slides the track against everything else.
///
/// Measured on the dry tap (`mix` 0), which `realign_bands` pads out to the
/// same reported target the bands are padded to — so this reads the device's
/// delivered delay end to end rather than any one stage's internal figure.
#[test]
fn the_device_delivers_the_smudge_latency_it_reports() {
    let mut instance = configure(SMUDGE, HARD_DRIVE, 2.0);
    instance.set_param("mix", 0.0);
    let reported = instance.get_latency_samples() as usize;
    assert_eq!(reported, SMUDGE_WINDOW as usize);

    // Let the 5 ms `mix` smoothing settle before the impulse goes in.
    let settle_blocks = 8;
    let impulse_at = settle_blocks * BLOCK;
    let total_blocks = settle_blocks + (reported + 2 * BLOCK) / BLOCK + 2;

    let mut rendered = Vec::with_capacity(total_blocks * BLOCK);
    for block in 0..total_blocks {
        unsafe {
            let left = instance.get_input_left_ptr();
            let right = instance.get_input_right_ptr();
            for i in 0..BLOCK {
                let value = if block * BLOCK + i == impulse_at {
                    1.0
                } else {
                    0.0
                };
                *left.add(i) = value;
                *right.add(i) = value;
            }
        }
        let out = instance.process(BLOCK as u32);
        for i in 0..BLOCK {
            rendered.push(unsafe { *out.add(i) });
        }
    }

    let arrival = rendered
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.abs().total_cmp(&b.abs()))
        .map(|(index, _)| index)
        .expect("render produced no samples");

    assert_eq!(
        arrival - impulse_at,
        reported,
        "the dry tap arrived {} samples late against a reported {reported}",
        arrival - impulse_at
    );
}

// ── Breakdown: carried weight, stated ────────────────────────────────────────

/// `distortionMode` 6 renders as `soft-clip` because there is nothing else to
/// route it to.
///
/// `BreakdownProcessor` in `bacteria/stft.rs` is a stub: `process_sample`
/// performs no pitch shift (it maps `depth` onto a blur coefficient and says
/// so in its own comment), `remap_mags` / `remap_phases` are allocated and
/// never read, `StftProcessor` carries neither the previous-frame phases nor
/// the synthesis accumulator a phase vocoder needs, and there is no foldback
/// clipping. Wiring it would put a control labelled "0–4 oct" in front of a
/// blur knob.
///
/// **This test is carried weight, not a specification.** It goes red the day
/// breakdown is implemented, and the correct response is to delete it and
/// replace it with `smudge_renders_differently_from_soft_clip`'s shape.
#[test]
fn breakdown_is_not_implemented_and_renders_as_soft_clip() {
    let reference = render(SOFT_CLIP, HARD_DRIVE, 2.0);
    let breakdown = render(BREAKDOWN, HARD_DRIVE, 2.0);

    assert!(
        peak(&reference) > 1e-3,
        "the reference render fell silent, so this comparison proves nothing"
    );
    assert_eq!(
        divergence(&reference, &breakdown),
        0.0,
        "breakdown no longer renders as soft-clip. If that is because a real \
         phase-vocoder breakdown landed, delete this test and assert the new \
         behaviour instead."
    );
}

/// The panel's 0–4 octave `breakdownDepth` slider reaches no DSP, for the same
/// reason. `DistortionProcessor` stores the value and never consults it.
///
/// Carried weight on the same terms as the test above.
#[test]
fn breakdown_depth_reaches_no_dsp() {
    let shallow = render(BREAKDOWN, HARD_DRIVE, 0.0);
    let deep = render(BREAKDOWN, HARD_DRIVE, 4.0);

    assert!(
        peak(&shallow) > 1e-3,
        "the shallow render fell silent, so this comparison proves nothing"
    );
    assert_eq!(
        divergence(&shallow, &deep),
        0.0,
        "breakdownDepth now changes the render. Delete this test and assert \
         the pitch-down depth it is supposed to control."
    );
}

#[test]
fn breakdown_and_smudge_are_not_the_same_mode() {
    let breakdown = render(BREAKDOWN, HARD_DRIVE, 2.0);
    let smudge = render(SMUDGE, HARD_DRIVE, 2.0);

    let d = divergence(&breakdown, &smudge);
    assert!(
        d > 1e-3,
        "breakdown and smudge render identically — max divergence {d:.3e}."
    );
}
