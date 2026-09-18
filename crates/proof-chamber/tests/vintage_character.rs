//! Audible contract for the two shipped non-modern Dutch Oven character modes.
//!
//! Every render below feeds the *same* buffer to both channels, which is the
//! right stimulus for a bandwidth-and-noise measurement and a blind one for
//! anything the stage does to the stereo image: a mode that folded the two
//! channels together would read identically on a mono stimulus. The stereo
//! contract is measured separately at the bottom of this file, on a hard-panned
//! one.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATES: [f32; 2] = [44_100.0, 48_000.0];
const BLOCK: usize = 128;
const FRAMES: usize = 48_000;

#[derive(Clone, Copy, Debug)]
struct Measurement {
    rms: f32,
    high_frequency_rms: f32,
}

const EXPECTED_SIGNAL: [[Measurement; 3]; 2] = [
    [
        Measurement {
            rms: 0.303_318_23,
            high_frequency_rms: 0.388_374_57,
        },
        Measurement {
            rms: 0.274_717_24,
            high_frequency_rms: 0.330_152_12,
        },
        Measurement {
            rms: 0.236_572_74,
            high_frequency_rms: 0.220_032_45,
        },
    ],
    [
        Measurement {
            rms: 0.303_324_85,
            high_frequency_rms: 0.367_476_25,
        },
        Measurement {
            rms: 0.272_278_13,
            high_frequency_rms: 0.306_728_2,
        },
        Measurement {
            rms: 0.233_388_59,
            high_frequency_rms: 0.214_636_03,
        },
    ],
];
const SEVENTIES_NOISE_RMS: f32 = 0.000_407_652_43;

fn assert_near(name: &str, measured: f32, expected: f32) {
    let error = (measured - expected).abs() / expected.max(1.0e-12);
    assert!(
        error <= 0.01,
        "{name} changed: measured {measured:.9}, expected {expected:.9}"
    );
}

fn rms(samples: &[f32]) -> f32 {
    let energy = samples
        .iter()
        .map(|sample| f64::from(*sample) * f64::from(*sample))
        .sum::<f64>();
    (energy / samples.len() as f64).sqrt() as f32
}

fn render(sample_rate: f32, vintage: f32, silent: bool) -> Measurement {
    let mut chamber = ProofChamberInstance::new(sample_rate);
    chamber.set_param("mix", 0.0);
    chamber.set_param("vintage", vintage);

    let mut output = Vec::with_capacity(FRAMES * 2);
    let mut frame = 0;
    while frame < FRAMES {
        let frames = (FRAMES - frame).min(BLOCK);
        let mut input = [0.0_f32; BLOCK];
        if !silent {
            for (offset, sample) in input[..frames].iter_mut().enumerate() {
                let time = (frame + offset) as f32 / sample_rate;
                *sample = 0.25 * (time * 3_000.0 * std::f32::consts::TAU).sin()
                    + 0.25 * (time * 9_000.0 * std::f32::consts::TAU).sin()
                    + 0.25 * (time * 16_000.0 * std::f32::consts::TAU).sin();
            }
        }

        let left = chamber.process(&input[..frames], &input[..frames], frames as u32);
        let right = chamber.get_right_ptr();
        for offset in 0..frames {
            let left_sample = unsafe { *left.add(offset) };
            let right_sample = unsafe { *right.add(offset) };
            assert!(left_sample.is_finite() && right_sample.is_finite());
            output.push(left_sample);
            output.push(right_sample);
        }
        frame += frames;
    }

    let mono: Vec<f32> = output
        .chunks_exact(2)
        .map(|pair| (pair[0] + pair[1]) * 0.5)
        .collect();
    let high_passed: Vec<f32> = mono.windows(2).map(|pair| pair[1] - pair[0]).collect();
    Measurement {
        rms: rms(&mono),
        high_frequency_rms: rms(&high_passed),
    }
}

#[test]
fn vintage_modes_keep_their_bandwidth_and_noise_character() {
    for (rate_index, sample_rate) in SAMPLE_RATES.into_iter().enumerate() {
        let modern = render(sample_rate, 0.0, false);
        let eighties = render(sample_rate, 1.0, false);
        let seventies = render(sample_rate, 2.0, false);
        let modern_silence = render(sample_rate, 0.0, true);
        let seventies_silence = render(sample_rate, 2.0, true);

        let measured = [modern, eighties, seventies];
        for (mode_index, mode) in ["Modern", "Eighties", "Seventies"].into_iter().enumerate() {
            let expected = EXPECTED_SIGNAL[rate_index][mode_index];
            assert_near(
                &format!("{mode} {sample_rate:.0} Hz RMS"),
                measured[mode_index].rms,
                expected.rms,
            );
            assert_near(
                &format!("{mode} {sample_rate:.0} Hz high-frequency RMS"),
                measured[mode_index].high_frequency_rms,
                expected.high_frequency_rms,
            );
        }
        assert_eq!(
            modern_silence.rms, 0.0,
            "Modern injected noise into silence"
        );
        assert_near(
            "Seventies noise-floor RMS",
            seventies_silence.rms,
            SEVENTIES_NOISE_RMS,
        );
        assert!(
            measured[1].high_frequency_rms < measured[0].high_frequency_rms * 0.9
                && measured[2].high_frequency_rms < measured[1].high_frequency_rms * 0.75,
            "vintage modes no longer darken progressively at {sample_rate:.0} Hz"
        );
    }
}

// ---------------------------------------------------------------------------
// Stereo image
// ---------------------------------------------------------------------------

/// Skipped before every stereo measurement below: `mix` is smoothed from its
/// constructor value with a 30 ms one-pole, so the opening of a `mix = 0`
/// render still carries wet signal in both channels and would read as
/// cross-channel leakage that the vintage stage did not cause.
const RAMP_SKIP_SECONDS: f32 = 0.1;

/// How much of a hard-panned source's side energy a character mode has to keep.
///
/// A per-channel degradation — which is what every one of these modes claims to
/// be — leaves the mid/side ratio where it found it, so the bound is loose
/// rather than exact: 0.7 allows a mode to lose nearly a third of the image to
/// filtering and still pass.
const MIN_SIDE_RETENTION: f32 = 0.7;

/// Ceiling on the level a character mode may leave in the channel the stimulus
/// never fed, over the level in the channel it did.
///
/// The decimator, the lowpass and the blend are all per-channel, so the only
/// legitimate contribution there is the mode's own injected noise halo —
/// measured at ~0.002 for Seventies and ~0.001 for Eighties. This is the same
/// near-zero bound the Modern precondition uses, and it fails a real fold: a
/// 10% cross-blend reads ~0.075.
const MAX_CHARACTER_LEAK: f32 = 0.01;

#[derive(Clone, Copy)]
struct StereoImage {
    mid_rms: f32,
    side_rms: f32,
    /// Level in the channel the stimulus never fed, over level in the channel
    /// it did. 0 is a clean pan; 1 is mono.
    leak: f32,
}

impl StereoImage {
    fn side_over_mid(&self) -> f32 {
        self.side_rms / self.mid_rms.max(1e-12)
    }
}

/// Which channel a hard-panned stimulus feeds.
///
/// Both directions are measured: a fold that only moves one channel's signal
/// away reads as a clean gain when the pan happens to fall on the channel it
/// keeps, and only the opposite pan exposes it.
#[derive(Clone, Copy)]
enum Pan {
    Left,
    Right,
}

impl Pan {
    const BOTH: [Pan; 2] = [Pan::Left, Pan::Right];

    fn label(self) -> &'static str {
        match self {
            Pan::Left => "left-panned",
            Pan::Right => "right-panned",
        }
    }
}

/// Render a hard-panned stimulus — full scale in the channel `pan` names,
/// silence in the other — through one character mode at `mix = 0`, so what is
/// measured is the vintage stage and not the reverb behind it.
fn render_panned(sample_rate: f32, vintage: f32, pan: Pan) -> StereoImage {
    let mut chamber = ProofChamberInstance::new(sample_rate);
    chamber.set_param("mix", 0.0);
    chamber.set_param("vintage", vintage);

    let frames = sample_rate as usize;
    let mut left_out = Vec::with_capacity(frames);
    let mut right_out = Vec::with_capacity(frames);
    let mut frame = 0;
    while frame < frames {
        let block = (frames - frame).min(BLOCK);
        let mut input = [0.0_f32; BLOCK];
        for (offset, sample) in input[..block].iter_mut().enumerate() {
            let time = (frame + offset) as f32 / sample_rate;
            *sample = 0.25 * (time * 300.0 * std::f32::consts::TAU).sin()
                + 0.25 * (time * 900.0 * std::f32::consts::TAU).sin()
                + 0.25 * (time * 3_000.0 * std::f32::consts::TAU).sin();
        }
        let silence = [0.0_f32; BLOCK];

        let (left_in, right_in) = match pan {
            Pan::Left => (&input[..block], &silence[..block]),
            Pan::Right => (&silence[..block], &input[..block]),
        };
        let left = chamber.process(left_in, right_in, block as u32);
        let right = chamber.get_right_ptr();
        for offset in 0..block {
            let left_sample = unsafe { *left.add(offset) };
            let right_sample = unsafe { *right.add(offset) };
            assert!(left_sample.is_finite() && right_sample.is_finite());
            left_out.push(left_sample);
            right_out.push(right_sample);
        }
        frame += block;
    }

    let skip = (sample_rate * RAMP_SKIP_SECONDS) as usize;
    let mid: Vec<f32> = (skip..frames)
        .map(|index| (left_out[index] + right_out[index]) * 0.5)
        .collect();
    let side: Vec<f32> = (skip..frames)
        .map(|index| (left_out[index] - right_out[index]) * 0.5)
        .collect();
    let (fed, unfed) = match pan {
        Pan::Left => (&left_out, &right_out),
        Pan::Right => (&right_out, &left_out),
    };

    StereoImage {
        mid_rms: rms(&mid),
        side_rms: rms(&side),
        leak: rms(&unfed[skip..]) / rms(&fed[skip..]).max(1e-12),
    }
}

/// A character mode degrades a signal; it does not re-pan it.
///
/// Every mode is measured in both pan directions, and a mode fails if it drops
/// the side image or if it moves level into the channel the stimulus never fed.
/// Nothing else in this crate feeds the vintage stage a stereo signal, so this
/// is the whole of the coverage for what the modes do to the image.
#[test]
fn character_modes_leave_the_stereo_image_where_they_found_it() {
    for sample_rate in SAMPLE_RATES {
        let modern = Pan::BOTH.map(|pan| render_panned(sample_rate, 0.0, pan));

        for (index, pan) in Pan::BOTH.into_iter().enumerate() {
            let baseline = modern[index];
            assert!(
                baseline.side_over_mid() > 0.9 && baseline.leak < 0.01,
                "Modern is not passing the {} stimulus through intact at \
                 {sample_rate:.0} Hz (side/mid {:.4}, opposite-channel leak {:.4}), so the two \
                 modes below cannot be compared against it",
                pan.label(),
                baseline.side_over_mid(),
                baseline.leak
            );
        }

        for (mode, vintage) in [("Eighties", 1.0_f32), ("Seventies", 2.0)] {
            let measured = Pan::BOTH.map(|pan| render_panned(sample_rate, vintage, pan));
            for (index, pan) in Pan::BOTH.into_iter().enumerate() {
                let baseline = modern[index];
                let image = measured[index];
                let retention = image.side_over_mid() / baseline.side_over_mid();
                assert!(
                    retention >= MIN_SIDE_RETENTION,
                    "{mode} at {sample_rate:.0} Hz kept only {:.1}% of the {} stereo image \
                     (side/mid {:.4} against Modern's {:.4}). A character mode degrades each \
                     channel; it does not fold them together.",
                    retention * 100.0,
                    pan.label(),
                    image.side_over_mid(),
                    baseline.side_over_mid()
                );
                assert!(
                    image.leak < MAX_CHARACTER_LEAK,
                    "{mode} at {sample_rate:.0} Hz put {:.1}% of the {} stimulus into the \
                     channel it was never fed (limit {:.1}%). A character mode degrades each \
                     channel; it does not fold them together.",
                    image.leak * 100.0,
                    pan.label(),
                    MAX_CHARACTER_LEAK * 100.0
                );
            }
        }
    }
}
