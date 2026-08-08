//! Does moving Hi Cut, Lo Cut or Width change what each algorithm renders?
//!
//! `ProofChamberPanel` gates nothing on `params.algorithm`, so all three
//! controls render on every algorithm. Until now only the plate answered to
//! them: `FdnReverb`, `SpringReverb` and `ReverseReverb` dropped all three
//! through `_ => {}`, which #1495's per-engine descriptor weld recorded as
//! eight of its forty-three gaps.
//!
//! Per ADR 0015 the load-bearing assertion is an offline render **delta**, and
//! **per engine**: a stage that works on the FDN and not the spring is exactly
//! the defect this file exists to catch, so every measurement runs the same
//! stimulus through every algorithm and asserts on each independently. A guard
//! that rendered one algorithm would have passed against the whole gap table,
//! because the plate was already correct.
//!
//! Three blindness shapes are covered explicitly:
//!
//! * **Interior points.** Each control is driven at interior settings. A clamp
//!   saturates both ends into agreement, so ends-only wiring still reds here.
//! * **Not at the default.** No measurement pair includes the shipped default
//!   as its only moving value; a branch that never executes at the default
//!   would otherwise look alive.
//! * **The shipped default itself.** Each engine is also rendered untouched
//!   and compared against the documented defaults written explicitly, so a
//!   constructor drifting away from `NativeDspDescriptors.ts` is visible.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;

/// Descriptor defaults for the three controls under test.
const DEFAULT_HIGH_CUT: f32 = 12_000.0;
const DEFAULT_LOW_CUT: f32 = 80.0;
const DEFAULT_WIDTH: f32 = 1.0;

/// Wire values from `ProofChamberInstance::set_param`'s `algorithm` arm.
const PLATE: f32 = 0.0;
const FDN8: f32 = 1.0;
const FDN16: f32 = 2.0;
const SPRING: f32 = 3.0;
const REVERSE: f32 = 6.0;

/// Every algorithm that runs the shared wet-path stage in stereo. The plate is
/// included deliberately: the stage was extracted out of it, and a regression
/// there is a regression in the engine most projects actually use.
const STEREO_ENGINES: [(f32, &str); 4] = [
    (PLATE, "plate"),
    (FDN8, "fdn8"),
    (FDN16, "fdn16"),
    (SPRING, "spring"),
];

/// Every algorithm that runs the tone filters, stereo or not.
const TONE_ENGINES: [(f32, &str); 5] = [
    (PLATE, "plate"),
    (FDN8, "fdn8"),
    (FDN16, "fdn16"),
    (SPRING, "spring"),
    (REVERSE, "reverse"),
];

/// Long enough that the reverse engine — whose default 1.5 s buffer emits
/// nothing until its first swap — is well into steady-state playback inside
/// the measurement window.
const RENDER_FRAMES: usize = 180_000;
const MEASURE_START: usize = 100_000;
const MEASURE_END: usize = 160_000;

/// Continuous broadband noise, not a tone burst: a filter guard needs energy
/// at both ends of the spectrum to measure, and the reverse engine needs the
/// stimulus to still be running when its playback buffer comes round.
/// Deterministic (fixed-seed LCG) so a delta is never the stimulus moving.
fn stimulus_block(index: usize, out: &mut [f32]) {
    let mut state = 0x2545_F491_u32
        .wrapping_add(index as u32)
        .wrapping_mul(2_654_435_761);
    for sample in out.iter_mut() {
        state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        let unit = (state >> 8) as f32 / 8_388_608.0 - 1.0;
        *sample = unit * 0.5;
    }
}

/// A parameter write applied before rendering.
type Write = (&'static str, f32);

/// One rendered stereo buffer.
struct Render {
    left: Vec<f32>,
    right: Vec<f32>,
}

/// Render the noise through `algorithm` with `writes` applied, at `mix = 1.0`
/// so the measurement is the engine's wet output and not the dry noise
/// passing through it.
fn render(algorithm: f32, writes: &[Write]) -> Render {
    let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
    instance.set_param("algorithm", algorithm);
    instance.set_param("mix", 1.0);
    for &(name, value) in writes {
        instance.set_param(name, value);
    }

    let mut left = Vec::with_capacity(RENDER_FRAMES);
    let mut right = Vec::with_capacity(RENDER_FRAMES);
    let mut input = vec![0.0_f32; BLOCK];
    let mut index = 0;
    while index < RENDER_FRAMES {
        stimulus_block(index, &mut input);
        let ptr = instance.process(&input, &input, BLOCK as u32);
        assert!(!ptr.is_null(), "process returned a null buffer");
        let right_ptr = instance.get_right_ptr();
        for i in 0..BLOCK {
            left.push(unsafe { *ptr.add(i) });
            right.push(unsafe { *right_ptr.add(i) });
        }
        index += BLOCK;
    }

    for (i, sample) in left.iter().chain(right.iter()).enumerate() {
        assert!(
            sample.is_finite(),
            "non-finite output sample at {i} on algorithm {algorithm}: {sample}"
        );
    }
    Render { left, right }
}

fn window(samples: &[f32]) -> &[f32] {
    &samples[MEASURE_START..MEASURE_END.min(samples.len())]
}

fn rms(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let sum: f64 = values.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
    (sum / values.len() as f64).sqrt() as f32
}

/// High-frequency energy: the RMS of the first difference, which is a
/// one-zero highpass. A lowpass moving down must reduce it.
fn hf_energy(render: &Render) -> f32 {
    let w = window(&render.left);
    let diffs: Vec<f32> = w.windows(2).map(|pair| pair[1] - pair[0]).collect();
    rms(&diffs)
}

/// Low-frequency energy: RMS after an offline one-pole lowpass at 150 Hz,
/// well below the lowest cutoff under test. A highpass moving up must reduce
/// it.
fn lf_energy(render: &Render) -> f32 {
    let coeff = (-std::f32::consts::TAU * 150.0 / SAMPLE_RATE).exp();
    let mut state = 0.0_f32;
    let filtered: Vec<f32> = window(&render.left)
        .iter()
        .map(|sample| {
            state = sample * (1.0 - coeff) + state * coeff;
            state
        })
        .collect();
    rms(&filtered)
}

/// Energy in the stereo difference — what the width matrix scales.
fn side_energy(render: &Render) -> f32 {
    let left = window(&render.left);
    let right = window(&render.right);
    let side: Vec<f32> = left
        .iter()
        .zip(right.iter())
        .map(|(l, r)| (l - r) * 0.5)
        .collect();
    rms(&side)
}

fn max_delta(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .fold(0.0_f32, |acc, (x, y)| acc.max((x - y).abs()))
}

fn identical(a: &Render, b: &Render) -> bool {
    a.left.len() == b.left.len()
        && a.left
            .iter()
            .zip(b.left.iter())
            .all(|(x, y)| x.to_bits() == y.to_bits())
        && a.right
            .iter()
            .zip(b.right.iter())
            .all(|(x, y)| x.to_bits() == y.to_bits())
}

// ---------------------------------------------------------------------------
// high_cut
// ---------------------------------------------------------------------------

#[test]
fn high_cut_darkens_every_algorithm_across_its_interior() {
    // Interior settings inside the declared 1 000–20 000 Hz range, none of
    // them the 12 000 Hz default: a stage that only reacted at the endpoints,
    // or only at the value the constructor already holds, still reds.
    for (algorithm, name) in TONE_ENGINES {
        let mut previous: Option<(f32, f32)> = None;
        for cutoff in [16_000.0_f32, 8_000.0, 4_000.0, 2_000.0] {
            let energy = hf_energy(&render(algorithm, &[("high_cut", cutoff)]));
            if let Some((previous_cutoff, previous_energy)) = previous {
                assert!(
                    energy < previous_energy * 0.9,
                    "{name}: high_cut {cutoff} Hz should carry less high-frequency energy \
                     than {previous_cutoff} Hz, got {energy:e} against {previous_energy:e}"
                );
            }
            previous = Some((cutoff, energy));
        }
    }
}

#[test]
fn high_cut_defaults_to_the_documented_value_on_every_algorithm() {
    for (algorithm, name) in TONE_ENGINES {
        let untouched = render(algorithm, &[]);
        let explicit = render(algorithm, &[("high_cut", DEFAULT_HIGH_CUT)]);
        assert!(
            identical(&untouched, &explicit),
            "{name}: an engine nobody wrote to should render as high_cut={DEFAULT_HIGH_CUT}; \
             peak difference {:e}",
            max_delta(&untouched.left, &explicit.left)
        );

        // ...and the default is not accidentally an extreme, which would make
        // the identity above pass while proving nothing about the wire.
        let extreme = render(algorithm, &[("high_cut", 1_500.0)]);
        assert!(
            !identical(&untouched, &extreme),
            "{name}: the shipped default renders identically to high_cut=1500"
        );
    }
}

// ---------------------------------------------------------------------------
// low_cut
// ---------------------------------------------------------------------------

#[test]
fn low_cut_thins_every_algorithm_across_its_interior() {
    for (algorithm, name) in TONE_ENGINES {
        let mut previous: Option<(f32, f32)> = None;
        for cutoff in [100.0_f32, 250.0, 500.0, 900.0] {
            let energy = lf_energy(&render(algorithm, &[("low_cut", cutoff)]));
            if let Some((previous_cutoff, previous_energy)) = previous {
                assert!(
                    energy < previous_energy * 0.9,
                    "{name}: low_cut {cutoff} Hz should leave less low-frequency energy \
                     than {previous_cutoff} Hz, got {energy:e} against {previous_energy:e}"
                );
            }
            previous = Some((cutoff, energy));
        }
    }
}

#[test]
fn low_cut_defaults_to_the_documented_value_on_every_algorithm() {
    for (algorithm, name) in TONE_ENGINES {
        let untouched = render(algorithm, &[]);
        let explicit = render(algorithm, &[("low_cut", DEFAULT_LOW_CUT)]);
        assert!(
            identical(&untouched, &explicit),
            "{name}: an engine nobody wrote to should render as low_cut={DEFAULT_LOW_CUT}; \
             peak difference {:e}",
            max_delta(&untouched.left, &explicit.left)
        );

        let extreme = render(algorithm, &[("low_cut", 900.0)]);
        assert!(
            !identical(&untouched, &extreme),
            "{name}: the shipped default renders identically to low_cut=900"
        );
    }
}

// ---------------------------------------------------------------------------
// width
// ---------------------------------------------------------------------------

#[test]
fn width_scales_the_stereo_difference_on_every_stereo_algorithm() {
    for (algorithm, name) in STEREO_ENGINES {
        // 0.4 / 0.8 / 1.4 / 1.8 — interior settings on both sides of the
        // neutral 1.0 default, so a matrix wired only for narrowing still reds.
        let mut previous: Option<(f32, f32)> = None;
        for width in [0.4_f32, 0.8, 1.4, 1.8] {
            let energy = side_energy(&render(algorithm, &[("width", width)]));
            if let Some((previous_width, previous_energy)) = previous {
                assert!(
                    energy > previous_energy * 1.1,
                    "{name}: width {width} should carry more stereo difference than \
                     {previous_width}, got {energy:e} against {previous_energy:e}"
                );
            }
            previous = Some((width, energy));
        }

        // And the floor: width 0 is a mono fold, so nothing is left to measure.
        let mono = render(algorithm, &[("width", 0.0)]);
        assert!(
            side_energy(&mono) < 1e-9,
            "{name}: width=0 should collapse the wet signal to mono, side RMS {:e}",
            side_energy(&mono)
        );
    }
}

#[test]
fn width_defaults_to_neutral_on_every_stereo_algorithm() {
    for (algorithm, name) in STEREO_ENGINES {
        let untouched = render(algorithm, &[]);
        let explicit = render(algorithm, &[("width", DEFAULT_WIDTH)]);
        assert!(
            identical(&untouched, &explicit),
            "{name}: an engine nobody wrote to should render as width={DEFAULT_WIDTH}; \
             peak difference {:e}",
            max_delta(&untouched.right, &explicit.right)
        );

        let narrowed = render(algorithm, &[("width", 0.3)]);
        assert!(
            !identical(&untouched, &narrowed),
            "{name}: the shipped default renders identically to width=0.3"
        );
    }
}

// ---------------------------------------------------------------------------
// Reverse: why width is withheld rather than wired
// ---------------------------------------------------------------------------

#[test]
fn the_reverse_engines_wet_path_is_mono_so_a_width_matrix_would_be_inert() {
    // This is the whole justification for leaving `width` on `reverse` in
    // `KNOWN_ENGINE_GAPS`. If the reverse engine ever grows a stereo buffer
    // pair this test reds, and the gap row becomes a defect to close rather
    // than a structural fact to record.
    let rendered = render(REVERSE, &[]);
    assert_eq!(
        max_delta(&rendered.left, &rendered.right),
        0.0,
        "the reverse engine emitted different samples to the two channels, so it now has a \
         side component and `width` is implementable on it"
    );

    // ...and the engine really did refuse the write rather than storing it.
    let widened = render(REVERSE, &[("width", 1.9)]);
    assert!(
        identical(&rendered, &widened),
        "reverse accepted a width write; peak difference {:e}",
        max_delta(&rendered.left, &widened.left)
    );
}

// ---------------------------------------------------------------------------
// Advertised surface
// ---------------------------------------------------------------------------

#[test]
fn every_algorithm_advertises_the_stage_parameters_it_now_answers_to() {
    for (algorithm, name) in TONE_ENGINES {
        let mut instance = ProofChamberInstance::new(SAMPLE_RATE);
        instance.set_param("algorithm", algorithm);
        let advertised = instance.get_param_names();

        for id in ["high_cut", "low_cut"] {
            assert!(
                advertised.contains(&format!("\"{id}\"")),
                "{name} answers to {id} but does not advertise it: {advertised}"
            );
        }

        let claims_width = advertised.contains("\"width\"");
        assert_eq!(
            claims_width,
            algorithm != REVERSE,
            "{name} should advertise width iff its wet path is stereo: {advertised}"
        );
    }
}
