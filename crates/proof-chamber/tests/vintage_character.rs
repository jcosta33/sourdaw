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

/// Render a hard-panned stimulus — full scale left, silence right — through
/// one character mode at `mix = 0`, so what is measured is the vintage stage
/// and not the reverb behind it.
fn render_panned(sample_rate: f32, vintage: f32) -> StereoImage {
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

        let left = chamber.process(&input[..block], &silence[..block], block as u32);
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

    StereoImage {
        mid_rms: rms(&mid),
        side_rms: rms(&side),
        leak: rms(&right_out[skip..]) / rms(&left_out[skip..]).max(1e-12),
    }
}

/// A character mode degrades a signal; it does not re-pan it.
///
/// Nothing else in this crate feeds the vintage stage a stereo signal, so this
/// is the whole of the coverage for what the modes do to the image.
///
/// # Why this test is `#[ignore]`d
///
/// It is red against the shipped engine. Seventies decimation in
/// `src/vintage.rs:92`-`:95` holds **one** sample for both channels and sources
/// it from `(l + r) * 0.5`, then reconstructs each channel as `hold + (channel
/// - hold) * 0.3`. That is a mid/side matrix with the side scaled to 0.3, not a
/// sample-rate reduction: a hard-panned source comes back with the image
/// collapsed to a third and more than half its level appearing in the channel
/// it was never in. The other two modes are per-channel and measure clean, so
/// the fix is a per-channel decimator with its own counter and hold, which
/// leaves the mono measurements above untouched.
///
/// Un-ignore this when Seventies decimates per channel.
#[test]
#[ignore = "pins the Seventies mono-summing decimation hold (src/vintage.rs:92-95), which collapses a hard-panned source's stereo image to 0.3 and leaks it into the opposite channel. Red until the vintage per-channel decimation lane lands."]
fn character_modes_leave_the_stereo_image_where_they_found_it() {
    for sample_rate in SAMPLE_RATES {
        let modern = render_panned(sample_rate, 0.0);

        assert!(
            modern.side_over_mid() > 0.9 && modern.leak < 0.01,
            "Modern is not passing the hard-panned stimulus through intact at \
             {sample_rate:.0} Hz (side/mid {:.4}, opposite-channel leak {:.4}), so the two \
             modes below cannot be compared against it",
            modern.side_over_mid(),
            modern.leak
        );

        for (mode, vintage) in [("Eighties", 1.0_f32), ("Seventies", 2.0)] {
            let measured = render_panned(sample_rate, vintage);
            let retention = measured.side_over_mid() / modern.side_over_mid();
            assert!(
                retention >= MIN_SIDE_RETENTION,
                "{mode} at {sample_rate:.0} Hz kept only {:.1}% of the stereo image \
                 (side/mid {:.4} against Modern's {:.4}), and {:.1}% of the signal now sounds \
                 in the channel the stimulus never fed. A character mode degrades each \
                 channel; it does not fold them together.",
                retention * 100.0,
                measured.side_over_mid(),
                modern.side_over_mid(),
                measured.leak * 100.0
            );
        }
    }
}
