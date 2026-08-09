//! Fermenter's granular pan spread must reach the output.
//!
//! `GranularEngine::tick` pans every grain into an L/R pair by
//! `grain_pan_spread`, and `Voice::render` then sums the oscillator pair to mono
//! to run one filter instead of two. The pan is reapplied after the filter as a
//! balance — but the gate that did it read `has_unison`, so the granular
//! engine's pan was computed and thrown away.
//!
//! **At one unison voice.** Above one the gate was already true, so a granular
//! patch with a unison bank always did pan, and that render is byte-identical
//! across this change. The dead control was the shipped default: at
//! `unison_voices == 1`, driving `grain_pan_spread` 0 → 1 across 96 quanta moved
//! the render by 6.7e-5 total absolute sample difference against an RMS of
//! 6.4e-2 — float rounding, not audio. Every probe in this file therefore runs
//! at one voice unless it says otherwise, because that is where the defect was.
//!
//! What is restored is a **balance**, not the original pair. The two halves of
//! that behave differently with grain density, and the tests treat them
//! differently as a result:
//!
//!  - The **mid** is exact at any density — the weights sum to 1 — and
//!    `the_mid_signal_is_the_same_at_every_spread` drives both the default cloud
//!    and the shipped Breadcrumb Glitch one to say so. It has to: the balance
//!    divides by the oscillator pair while scaling the *filter's* output, so its
//!    behaviour tracks grain **duty cycle**, and a divisor floor that was
//!    invisible at the default cloud cost a shipped preset 20.7x this file's
//!    residue bound. That floor is gone; the bounds here are now what f32
//!    rounding on two divisions permits.
//!  - The **side** is faithful only while grains do not overlap, and that limit
//!    is inherent to reconstructing a pair from one filtered signal rather than
//!    a bug to be fixed here. `Voice::render` carries the measured degradation.
//!    The side tests run at the default cloud and do not claim more.
//!
//! # What identifies the fix, and why it is not "the render changed"
//!
//! Panning **redistributes** a signal across the pair; it does not recolour it.
//! Both halves of that are pinned here, and they constrain each other:
//!
//!  - **Mid is invariant.** `pan_l + pan_r == 1` for every grain, so `L + R` —
//!    which is what the filter sees — is the same signal at every spread. The
//!    grain RNG is drawn before the spread scales it (`rand_bipolar() *
//!    pan_spread`), so the grain stream itself is identical too. A "fix" that
//!    changed the filtered content, or that resolved the balance from a
//!    different signal, moves this and fails.
//!  - **Side grows.** `|L - R|` must rise as the spread widens, at interior
//!    points and not only at the ends.
//!
//! Either one alone is satisfiable by something wrong: a fix that made the two
//! channels random noise passes the side test, and doing nothing at all passes
//! the mid test.
//!
//! # Why the mono engines are tested here too
//!
//! The gate is no longer `has_unison`, so every other oscillator branch is now
//! in scope and "they return `(s, s)` so they are unaffected" is an assumption
//! rather than a measurement. It is also not quite true in the shape it is
//! usually stated: `SpectralWarp::process` is **stateful** — its `Quantize` mode
//! holds a sample-and-hold counter — and `Voice::render` calls it once per
//! channel, so a mono engine with warp engaged really does emit two different
//! numbers. That is a bit-crusher's dither, not a pan, and restoring a
//! "balance" from it would turn the warp into a random panner. The engine
//! branches therefore declare whether they produced a stereo pair, rather than
//! the output stage inferring it from a comparison — and
//! `every_mono_engine_stays_centred` drives that exact hazard.

use daw_dsp::fermenter::FermenterInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
/// 0 = wavetable, 1 = analog, 2 = FM, 3 = Karplus-Strong, 4 = granular,
/// 5 = additive, 6 = sampler.
const GRANULAR_ENGINE: f32 = 4.0;
/// Engines whose own branch is tested *before* `has_unison` in `Voice::render`,
/// so they render one signal at any voice count.
const ENGINES_WITH_THEIR_OWN_BRANCH: [f32; 3] = [3.0, 5.0, 6.0];
/// Engines with no branch of their own above the unison test, so they render
/// the `UnisonOsc` bank — which is genuinely stereo — as soon as the voice count
/// rises. They are mono only at one voice.
const ENGINES_THAT_FALL_THROUGH_TO_UNISON: [f32; 3] = [0.0, 1.0, 2.0];
/// One voice, and a bank. The second is not decoration: under the old
/// `has_unison` gate, an engine with its own branch *and* a raised voice count
/// took the balance path, and with the quantize warp engaged that panned a
/// bit-crusher's dither across the image. It is the one non-granular render
/// this change moves.
const UNISON_COUNTS: [f32; 2] = [1.0, 7.0];
/// Detune for every probe that raises the voice count — see `Probe::unison_detune`
/// for why an undetuned bank comes out bit-identical across the pair.
const UNISON_DETUNE_CENTS: f32 = 40.0;
/// `WarpMode::Quantize` — the sample-and-hold mode, and the one whose state
/// makes a per-channel `SpectralWarp::process` return two different numbers.
const QUANTIZE_WARP: f32 = 2.0;
const PROBE_NOTE: u8 = 60;
const VELOCITY: u8 = 127;
/// Past the attack, into a settled grain stream — and, the reason this is 512
/// rather than a handful, past the reverb.
///
/// `reverb_mix` defaults to 0.2 and is a `SmoothedParam` that
/// `MasterSynth::process_block` ticks **once per block**, so writing 0 to it
/// does not switch the reverb off: the mix decays by ~1.3% per quantum and takes
/// around 400 quanta to fall under the 0.001 at which the reverb is skipped.
/// Until then a stereo plate is running, and every "the channels are identical"
/// assertion below would be measuring its output instead of the oscillator's. A
/// 16-block warmup put 0.0073 mean |L-R| into a plain mono engine.
const WARMUP_BLOCKS: usize = 512;
const ANALYSIS_BLOCKS: usize = 96;

/// Interior points, not only the ends. A clamp, or a fix that only handled the
/// extremes, saturates 0 and 1 into agreement with each other and would pass a
/// two-point test.
const SPREADS: [f32; 5] = [0.0, 0.25, 0.5, 0.75, 1.0];
/// Neither of these is the 0.5 default, and both are away from the ends.
const BINDING_FROM: f32 = 0.15;
const BINDING_TO: f32 = 0.85;
/// The floor `dawDspFermenterAutomationOrdinals.spec.ts` requires before a
/// parameter may take an offline ordinal at all.
const MIN_BINDING_DIFFERENCE: f32 = 0.01;

/// A grain stream whose channels are identical reads as this much side content
/// per sample; anything at or under it is the float noise the broken gate
/// produced.
const SILENT_SIDE: f32 = 1e-4;
/// Each step up in spread must widen the image by at least this fraction of the
/// step before it, so that "rises" means rises and not "does not fall".
const MIN_SIDE_GROWTH: f32 = 1.2;
/// Peak deviation allowed in `L + R` between two spreads.
///
/// The balance weights sum to exactly 1, so panning cannot move the mid at all
/// beyond f32 rounding on two divisions. This was 3e-3, sized around a
/// `.max(0.001)` divisor floor in `Voice::render` that attenuated the mid
/// whenever the oscillator pair fell into the gap between the gate's 0.0001 and
/// the floor's 0.001. That floor is gone — the sub-threshold case takes the
/// centred branch — so the bound is what the arithmetic actually permits rather
/// than what the floor happened to cost.
const BALANCE_FLOOR: f32 = 1e-4;
/// And the residue's RMS as a fraction of the mid's. Same story: was 5e-4 to
/// accommodate the floor, and even that was 20.7x too tight for the shipped
/// Breadcrumb Glitch cloud, which is why that cloud is now driven here.
const MAX_MID_RESIDUE_RATIO: f32 = 1e-5;
/// Mid RMS a render has to reach before any assertion about its *channels*
/// means anything. Engine 6 measured 0.00000000 here at its defaults, and its
/// centred-image arm passed on that.
const MIN_SOUNDING: f32 = 0.01;

struct Stereo {
    left: Vec<f32>,
    right: Vec<f32>,
}

/// Everything that could move the channels apart for a reason other than the
/// grain pan is off: no unison bank, no noise, no drift, no chaos, and — this
/// one matters — no reverb, chorus, phaser or delay, all of which are stereo
/// stages. `stereo_width` is left at its bypassing 1.0.
fn configure_bare_granular(instance: &mut FermenterInstance) {
    instance.set_param("osc_level", 0.5);
    instance.set_param("osc_coarse", 0.0);
    instance.set_param("osc_fine", 0.0);
    instance.set_param("unison_voices", 1.0);
    instance.set_param("unison_detune", 0.0);
    instance.set_param("noise_level", 0.0);
    instance.set_param("drift", 0.0);
    instance.set_param("voice_drive", 0.0);
    instance.set_param("filter_drive", 0.0);
    instance.set_param("filter_model", 0.0);
    instance.set_param("filter_mode", 0.0);
    instance.set_param("filter_keytrack", 0.0);
    instance.set_param("cutoff", 18_000.0);
    instance.set_param("resonance", 0.5);
    instance.set_param("mod_env_to_filter", 0.0);
    instance.set_param("mod_lfo_to_pitch", 0.0);
    instance.set_param("lfo_filter_amount", 0.0);
    instance.set_param("mseg_to_filter", 0.0);
    instance.set_param("seq_to_pitch", 0.0);
    instance.set_param("chaos_amount", 0.0);
    instance.set_param("warp_amount", 0.0);
    instance.set_param("audio_mod_depth", 0.0);

    instance.set_param("amp_attack", 0.001);
    instance.set_param("amp_decay", 5.0);
    instance.set_param("amp_sustain", 1.0);
    instance.set_param("amp_release", 5.0);

    instance.set_param("dist_mix", 0.0);
    instance.set_param("comp_mix", 0.0);
    instance.set_param("delay_mix", 0.0);
    instance.set_param("chorus_mix", 0.0);
    instance.set_param("phaser_mix", 0.0);
    // 0.2 by default, and a reverb is a stereo stage.
    instance.set_param("reverb_mix", 0.0);
    instance.set_param("eq_low_gain", 0.0);
    instance.set_param("eq_mid_gain", 0.0);
    instance.set_param("eq_high_gain", 0.0);
    instance.set_param("master_gain", 1.0);
    instance.set_param("stereo_width", 1.0);
    instance.set_param("layer_pan", 0.0);

    // Two engines are silent at their defaults by the time this file measures
    // anything, and a "the channels are identical" assertion over a zero buffer
    // is true for no reason. `crates/daw-dsp/AGENTS.md` names this class
    // directly: most engines here early-return unless driven, so every guard has
    // to put its engine into an audibly active state. `sounding()` below is the
    // assertion that keeps it that way.
    //
    // Karplus-Strong is excited once at note-on and then decays. Undamped and
    // bright, it is still ringing after the warmup.
    instance.set_param("ks_damping", 0.0);
    instance.set_param("ks_brightness", 1.0);
    // The sampler seeds a decaying burst over a 44_100-sample buffer and plays
    // it as a one-shot; the warmup alone is 65_536 samples, so at the defaults
    // engine 6 has finished before the first analysed sample — it measured
    // 0.00000000 RMS. Looping the loud head keeps it sounding.
    instance.set_param("sampler_mode", 1.0);
    instance.set_param("sampler_start", 0.0);
    instance.set_param("sampler_end", 0.02);
}

#[derive(Clone, Copy, Debug)]
struct Probe {
    engine: f32,
    spread: f32,
    unison_voices: f32,
    /// Detune across the unison bank, in cents.
    ///
    /// Zero is not a neutral setting for a *stereo* claim about the bank, which
    /// is why this is a knob rather than the shared config's 0. `UnisonOsc`
    /// spreads its copies symmetrically about the centre, so with every copy
    /// carrying the identical signal the left and right pan weights sum to the
    /// same number and the pair comes out bit-identical — a genuinely stereo
    /// branch measuring 0.00000000 mean |L-R|. The copies have to differ from
    /// each other before their positions can be heard.
    unison_detune: f32,
    warp_mode: f32,
    warp_amount: f32,
    /// Grain cloud, as `(grain_density, grain_size_ms)`.
    ///
    /// A knob because the mid-invariance claim turned out to depend on it. The
    /// balance divides by the *oscillator* pair while scaling the *filter's*
    /// output, so a low duty cycle — short grains, spaced out — leaves stretches
    /// where the raw pair has collapsed and the filter is still ringing. What
    /// happens in those stretches is not visible at the default cloud.
    cloud: (f32, f32),
}

/// `Layer::new`'s `grain_density` / `grain_size`.
const DEFAULT_CLOUD: (f32, f32) = (20.0, 50.0);
/// The shipped **Breadcrumb Glitch** preset's cloud: 15 ms grains at density 80.
/// A far lower duty cycle than the default, and the configuration on which the
/// old `.max(0.001)` divisor floor attenuated a -23.5 dBFS inter-grain tail by
/// up to 76% of the local mid value.
const BREADCRUMB_GLITCH_CLOUD: (f32, f32) = (80.0, 15.0);
const CLOUDS: [(f32, f32); 2] = [DEFAULT_CLOUD, BREADCRUMB_GLITCH_CLOUD];

/// Warp bypassed, and warp in its stateful sample-and-hold mode.
const NO_WARP: (f32, f32) = (0.0, 0.0);
const QUANTIZE: (f32, f32) = (QUANTIZE_WARP, 1.0);

fn render(probe: Probe) -> Stereo {
    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    configure_bare_granular(&mut instance);
    instance.set_param("engine", probe.engine);
    instance.set_param("grain_pan_spread", probe.spread);
    instance.set_param("unison_voices", probe.unison_voices);
    instance.set_param("unison_detune", probe.unison_detune);
    instance.set_param("warp_mode", probe.warp_mode);
    instance.set_param("warp_amount", probe.warp_amount);
    instance.set_param("grain_density", probe.cloud.0);
    instance.set_param("grain_size", probe.cloud.1);
    instance.note_on(PROBE_NOTE, VELOCITY);

    for _ in 0..WARMUP_BLOCKS {
        instance.process(BLOCK as u32);
    }

    let mut stereo = Stereo {
        left: Vec::with_capacity(ANALYSIS_BLOCKS * BLOCK),
        right: Vec::with_capacity(ANALYSIS_BLOCKS * BLOCK),
    };
    for _ in 0..ANALYSIS_BLOCKS {
        let left_pointer = instance.process(BLOCK as u32);
        let right_pointer = instance.get_right_ptr();
        // SAFETY: `process` renders into the instance's own 128-frame left
        // buffer and returns it; `get_right_ptr` returns the matching right
        // buffer. `BLOCK` is 128, and neither pointer is held across a further
        // call.
        let left = unsafe { std::slice::from_raw_parts(left_pointer, BLOCK) };
        let right = unsafe { std::slice::from_raw_parts(right_pointer, BLOCK) };
        stereo.left.extend_from_slice(left);
        stereo.right.extend_from_slice(right);
    }
    stereo
}

fn granular_cloud(spread: f32, cloud: (f32, f32)) -> Stereo {
    render(Probe {
        engine: GRANULAR_ENGINE,
        spread,
        unison_voices: 1.0,
        unison_detune: 0.0,
        warp_mode: NO_WARP.0,
        warp_amount: NO_WARP.1,
        cloud,
    })
}

fn granular(spread: f32) -> Stereo {
    granular_cloud(spread, DEFAULT_CLOUD)
}

/// Mean |L − R| per sample: how much of the render is side content.
fn side_energy(stereo: &Stereo) -> f32 {
    let total: f32 = stereo
        .left
        .iter()
        .zip(stereo.right.iter())
        .map(|(l, r)| (l - r).abs())
        .sum();
    total / stereo.left.len() as f32
}

/// The mid signal — what the filter renders, and what panning must leave alone.
fn mid(stereo: &Stereo) -> Vec<f32> {
    stereo
        .left
        .iter()
        .zip(stereo.right.iter())
        .map(|(l, r)| l + r)
        .collect()
}

fn rms(samples: &[f32]) -> f32 {
    (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
}

fn peak_difference(left: &[f32], right: &[f32]) -> f32 {
    left.iter()
        .zip(right.iter())
        .fold(0.0f32, |worst, (a, b)| worst.max((a - b).abs()))
}

/// A grain stream must actually be sounding, or every ratio below is a ratio
/// between two silences.
#[test]
fn the_granular_engine_sounds_at_every_spread() {
    for spread in SPREADS {
        let stereo = granular(spread);
        let level = rms(&mid(&stereo));
        assert!(
            level > MIN_SOUNDING,
            "grain_pan_spread={spread}: the mid signal reads {level:.6} RMS, so \
             nothing below is measuring audio"
        );
    }
}

/// At zero spread every grain sits dead centre, so the two channels must be
/// identical — the fix must not invent width where the parameter asks for none.
#[test]
fn zero_spread_renders_a_centred_image() {
    let side = side_energy(&granular(0.0));
    assert!(
        side <= SILENT_SIDE,
        "grain_pan_spread=0 must render both channels the same; mean |L-R| is \
         {side:.8}, over the {SILENT_SIDE} float-noise floor"
    );
}

/// The claim itself: widening the spread widens the image, measured at interior
/// points so that a fix which only handled the extremes cannot pass.
#[test]
fn side_content_rises_with_pan_spread() {
    let measured: Vec<(f32, f32)> = SPREADS
        .iter()
        .map(|spread| (*spread, side_energy(&granular(*spread))))
        .collect();

    for window in measured.windows(2) {
        let (lower_spread, lower_side) = window[0];
        let (higher_spread, higher_side) = window[1];
        assert!(
            higher_side > lower_side.max(SILENT_SIDE) * MIN_SIDE_GROWTH,
            "grain_pan_spread {lower_spread} → {higher_spread} must widen the \
             image by at least {MIN_SIDE_GROWTH}x; mean |L-R| went {lower_side:.8} \
             → {higher_side:.8} across {measured:?}"
        );
    }
}

/// Panning redistributes; it does not recolour. `pan_l + pan_r == 1` for every
/// grain, so `L + R` is the same signal at every spread — and the grain stream
/// itself is identical too, because the pan RNG is drawn before the spread
/// scales it.
///
/// This is what stops the test above being satisfied by a fix that filled the
/// two channels with something new: a balance resolved from the wrong signal,
/// or a gain that does not sum back to unity, moves the mid.
/// Nothing in the balance can move the mid: the two weights are `|a|/(|a|+|b|)`
/// and `|b|/(|a|+|b|)` and they sum to 1, so all that is left is f32 rounding on
/// two divisions.
///
/// **Two clouds.** The balance divides by the *oscillator* pair while scaling
/// the *filter's* output, so the two are not the same signal — between grains
/// the raw pair collapses while the filter is still ringing. How often that
/// happens is a function of grain **duty cycle**, not of level, so a divisor
/// floor costs a sparse cloud far more than a dense one. Under the old
/// `.max(0.001)` floor, driven here at both:
///
/// | cloud                        | peak mid deviation |
/// | ---------------------------- | ------------------ |
/// | default, 50 ms / density 20  | 2.4857e-4          |
/// | Breadcrumb Glitch, 15 / 80   | 5.6991e-3  (23x)   |
///
/// **Be exact about what the second row buys, because it is not a mutation this
/// arm alone catches.** With `BALANCE_FLOOR` at what the arithmetic actually
/// permits, the default cloud reds a restored floor at every magnitude that
/// changes anything (measured: 0.001, 0.0005 and 0.0002 all red on the default
/// cloud alone; 0.0001 is a no-op, since the gate beside it already establishes
/// `sum > 0.0001`). So the Breadcrumb row is regime coverage rather than unique
/// detection: it is the configuration of a **shipped preset**, and it is a 23x
/// more sensitive detector, which is margin for whatever touches this balance
/// next. What actually closed the hole was tightening the bound — the floor was
/// invisible before because `BALANCE_FLOOR` had been sized *around* it.
#[test]
fn the_mid_signal_is_the_same_at_every_spread() {
    for cloud in CLOUDS {
        let centred = mid(&granular_cloud(0.0, cloud));
        let reference = rms(&centred);
        assert!(
            reference > MIN_SOUNDING,
            "cloud {cloud:?}: the mid reads {reference:.8} RMS, so the residue \
             ratios below would be taken against silence"
        );
        for spread in SPREADS.iter().skip(1) {
            let widened = mid(&granular_cloud(*spread, cloud));
            let residue: Vec<f32> = centred
                .iter()
                .zip(widened.iter())
                .map(|(a, b)| a - b)
                .collect();
            let drift_peak = peak_difference(&centred, &widened);
            let drift_rms = rms(&residue);
            assert!(
                drift_peak < BALANCE_FLOOR,
                "cloud {cloud:?}, grain_pan_spread={spread}: panning must leave \
                 L+R alone to within {BALANCE_FLOOR}, but it moved by \
                 {drift_peak:.8} peak against a mid RMS of {reference:.6}"
            );
            assert!(
                drift_rms < reference * MAX_MID_RESIDUE_RATIO,
                "cloud {cloud:?}, grain_pan_spread={spread}: the mid residue \
                 should be f32 rounding on two divisions, not a recolouring — \
                 its RMS is {drift_rms:.9} against a mid RMS of {reference:.6}"
            );
        }
    }
}

/// The render must be audible before "the channels are identical" means
/// anything: `|L - R| == 0` is true of silence for no reason at all.
fn assert_sounding(stereo: &Stereo, probe: Probe) {
    let level = rms(&mid(stereo));
    assert!(
        level > MIN_SOUNDING,
        "{probe:?}: renders {level:.8} RMS, under the {MIN_SOUNDING} floor — a \
         centred-image assertion over silence is satisfied by nothing happening"
    );
}

fn assert_centred(probe: Probe) {
    let stereo = render(probe);
    assert_sounding(&stereo, probe);
    let side = side_energy(&stereo);
    assert!(
        side <= SILENT_SIDE,
        "{probe:?}: must render both channels the same whatever \
         grain_pan_spread says; mean |L-R| is {side:.8}"
    );
}

/// Every branch that returns two copies of one signal must stay centred, and
/// the generalised gate must not have made any of them stereo.
///
/// The warp arm is the specific hazard, not a formality. `SpectralWarp::process`
/// is stateful and is called once per channel, so at `WarpMode::Quantize` a mono
/// engine genuinely emits two different numbers — an output stage that inferred
/// "stereo" from `osc_l != osc_r` would pan a bit-crusher at random.
///
/// The unison dimension is the other one, and it is the **only non-granular
/// render this change moves**. `Voice::render` tests `engine == 3/5/6` before it
/// tests `has_unison`, so those three keep their own mono branch at any voice
/// count — but under the old `has_unison` gate they still took the balance path
/// once the count rose. Without warp that was a no-op; with quantize warp the
/// diverged pair was panned, and a bit-crusher wandered across the image.
/// Measured on engine 5 at 7 voices: mean |L-R| 0.00156657 before, 0.00000000
/// after. At one voice this state is unreachable, so a guard pinned there cannot
/// see it.
///
/// Engine 4 is absent because it is the one engine that is supposed to be stereo
/// here.
#[test]
fn every_mono_engine_stays_centred() {
    for engine in ENGINES_WITH_THEIR_OWN_BRANCH {
        for unison_voices in UNISON_COUNTS {
            for (warp_mode, warp_amount) in [NO_WARP, QUANTIZE] {
                assert_centred(Probe {
                    engine,
                    spread: 1.0,
                    unison_voices,
                    // Detuned, so that if one of these three ever *did* reach
                    // the bank the copies would be audibly apart and this would
                    // red rather than cancel to a centred pair.
                    unison_detune: UNISON_DETUNE_CENTS,
                    warp_mode,
                    warp_amount,
                    cloud: DEFAULT_CLOUD,
                });
            }
        }
    }

    // These three have no branch above the unison test, so above one voice they
    // *are* the unison bank and are legitimately stereo — see the test below.
    for engine in ENGINES_THAT_FALL_THROUGH_TO_UNISON {
        for (warp_mode, warp_amount) in [NO_WARP, QUANTIZE] {
            assert_centred(Probe {
                engine,
                spread: 1.0,
                unison_voices: 1.0,
                unison_detune: 0.0,
                warp_mode,
                warp_amount,
                cloud: DEFAULT_CLOUD,
            });
        }
    }
}

/// The counterpart, and the reason the exclusion above is a fact rather than an
/// excuse: the three engines left at one voice are left there because the bank
/// they fall through to really does produce a stereo pair. Without this, quietly
/// narrowing the test to states that happen to pass would look the same.
#[test]
fn the_unison_bank_is_stereo_for_the_engines_that_fall_through_to_it() {
    for engine in ENGINES_THAT_FALL_THROUGH_TO_UNISON {
        let probe = Probe {
            engine,
            spread: 1.0,
            unison_voices: 7.0,
            unison_detune: UNISON_DETUNE_CENTS,
            warp_mode: NO_WARP.0,
            warp_amount: NO_WARP.1,
            cloud: DEFAULT_CLOUD,
        };
        let stereo = render(probe);
        assert_sounding(&stereo, probe);
        let side = side_energy(&stereo);
        assert!(
            side > SILENT_SIDE,
            "{probe:?}: the unison bank spreads its copies across the image, so \
             this is the branch that must *not* be centred; mean |L-R| is \
             {side:.8}"
        );
    }
}

/// The claim the offline automation binding rests on, in the currency
/// `dawDspFermenterAutomationOrdinals.spec.ts` requires before a parameter may
/// take an ordinal at all. Both values are interior and neither is the 0.5
/// default.
#[test]
fn two_interior_spreads_render_differently() {
    let lower = granular(BINDING_FROM);
    let higher = granular(BINDING_TO);
    let difference: f32 = lower
        .left
        .iter()
        .chain(lower.right.iter())
        .zip(higher.left.iter().chain(higher.right.iter()))
        .map(|(a, b)| (a - b).abs())
        .sum();
    assert!(
        difference > MIN_BINDING_DIFFERENCE,
        "grain_pan_spread {BINDING_FROM} → {BINDING_TO} must move the render: \
         total absolute difference over {ANALYSIS_BLOCKS} quanta is \
         {difference:.6}, under the {MIN_BINDING_DIFFERENCE} floor the binding \
         requires"
    );
}
