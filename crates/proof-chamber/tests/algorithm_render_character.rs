//! Named render-character fingerprints for every exposed non-plate algorithm.
//!
//! These are deliberately not opaque whole-buffer digests. When an engine is
//! retuned, the failure identifies whether its level, duration, or spectral
//! balance moved. Plate has its own older render guard; this file closes the
//! equivalent gap for FDN-8, FDN-16, Spring, and Reverse at both product sample
//! rates.

use proof_chamber::ProofChamberInstance;

const SAMPLE_RATES: [f32; 2] = [44_100.0, 48_000.0];
const BLOCK: usize = 128;
const RENDER_SECONDS: f32 = 4.0;
const BURST_SECONDS: f32 = 0.1;
const AUDIBILITY_FRACTION: f32 = 1.0e-3;

#[derive(Clone, Copy)]
struct Algorithm {
    name: &'static str,
    wire: f32,
}

const ALGORITHMS: [Algorithm; 4] = [
    Algorithm {
        name: "FDN-8",
        wire: 1.0,
    },
    Algorithm {
        name: "FDN-16",
        wire: 2.0,
    },
    Algorithm {
        name: "Spring",
        wire: 3.0,
    },
    Algorithm {
        name: "Reverse",
        wire: 6.0,
    },
];

#[derive(Clone, Copy, Debug)]
struct Character {
    peak: f32,
    rms: f32,
    active_span_ms: f32,
    late_energy_ratio: f32,
    high_frequency_ratio: f32,
}

const EXPECTED: [[Character; 4]; 2] = [
    [
        Character {
            peak: 0.283_691_53,
            rms: 0.033_485_048,
            active_span_ms: 3_984.467,
            late_energy_ratio: 0.053_339_72,
            high_frequency_ratio: 0.152_466_43,
        },
        Character {
            peak: 0.407_612_44,
            rms: 0.028_446_795,
            active_span_ms: 3_984.467,
            late_energy_ratio: 0.049_159_41,
            high_frequency_ratio: 0.211_066_65,
        },
        Character {
            peak: 0.481_467_52,
            rms: 0.023_791_64,
            active_span_ms: 965.283,
            late_energy_ratio: 0.000_000_106,
            high_frequency_ratio: 0.170_845_78,
        },
        Character {
            peak: 0.277_696_37,
            rms: 0.011_217_877,
            active_span_ms: 1_003.175,
            late_energy_ratio: 0.0,
            high_frequency_ratio: 0.270_421_24,
        },
    ],
    [
        Character {
            peak: 0.248_097_55,
            rms: 0.022_751_864,
            active_span_ms: 3_984.458,
            late_energy_ratio: 0.042_935_554,
            high_frequency_ratio: 0.207_538_01,
        },
        Character {
            peak: 0.368_210_26,
            rms: 0.029_996_041,
            active_span_ms: 3_983.625,
            late_energy_ratio: 0.040_598_83,
            high_frequency_ratio: 0.186_744_06,
        },
        Character {
            peak: 0.509_640_22,
            rms: 0.023_865_303,
            active_span_ms: 941.542,
            late_energy_ratio: 0.000_000_104,
            high_frequency_ratio: 0.170_841_14,
        },
        Character {
            peak: 0.303_078_23,
            rms: 0.011_496_001,
            active_span_ms: 102.521,
            late_energy_ratio: 0.0,
            high_frequency_ratio: 0.248_945_88,
        },
    ],
];

fn stimulus(frame: usize, sample_rate: f32) -> f32 {
    let burst_frames = (BURST_SECONDS * sample_rate) as usize;
    if frame >= burst_frames {
        return 0.0;
    }

    let time = frame as f32 / sample_rate;
    let envelope = 1.0 - frame as f32 / burst_frames as f32;
    let tone = (time * 110.0 * std::f32::consts::TAU).sin()
        + 0.7 * (time * 730.0 * std::f32::consts::TAU).sin()
        + 0.45 * (time * 3_100.0 * std::f32::consts::TAU).sin()
        + 0.25 * (time * 8_300.0 * std::f32::consts::TAU).sin();
    tone * envelope * 0.25
}

fn render(algorithm: Algorithm, sample_rate: f32) -> Vec<f32> {
    let mut chamber = ProofChamberInstance::new(sample_rate);
    chamber.set_param("algorithm", algorithm.wire);
    chamber.set_param("mix", 1.0);
    chamber.set_param("decay", 0.7);
    chamber.set_param("damping", 0.3);
    chamber.set_param("size", 0.0);

    // Settle the wet-only mix ramp before the fixed stimulus starts.
    let silence = [0.0_f32; BLOCK];
    for _ in 0..(sample_rate as usize / BLOCK) {
        chamber.process(&silence, &silence, BLOCK as u32);
    }

    let render_frames = (RENDER_SECONDS * sample_rate) as usize;
    let mut output = Vec::with_capacity(render_frames * 2);
    let mut frame = 0;
    while frame < render_frames {
        let mut input = [0.0_f32; BLOCK];
        for (offset, sample) in input.iter_mut().enumerate() {
            *sample = stimulus(frame + offset, sample_rate);
        }

        let left = chamber.process(&input, &input, BLOCK as u32);
        let right = chamber.get_right_ptr();
        assert!(!left.is_null(), "{} returned a null buffer", algorithm.name);
        for offset in 0..BLOCK {
            if frame + offset >= render_frames {
                break;
            }
            let left_sample = unsafe { *left.add(offset) };
            let right_sample = unsafe { *right.add(offset) };
            assert!(
                left_sample.is_finite() && right_sample.is_finite(),
                "{} emitted a non-finite sample at frame {}",
                algorithm.name,
                frame + offset
            );
            output.push(left_sample);
            output.push(right_sample);
        }
        frame += BLOCK;
    }
    output
}

fn rms(samples: &[f32]) -> f32 {
    let sum = samples
        .iter()
        .map(|sample| f64::from(*sample) * f64::from(*sample))
        .sum::<f64>();
    (sum / samples.len() as f64).sqrt() as f32
}

fn character(output: &[f32], sample_rate: f32) -> Character {
    let peak = output
        .iter()
        .fold(0.0_f32, |maximum, sample| maximum.max(sample.abs()));
    let floor = peak * AUDIBILITY_FRACTION;
    let first_frame = output
        .chunks_exact(2)
        .position(|frame| frame[0].abs().max(frame[1].abs()) > floor)
        .expect("render never crossed its relative audibility floor");
    let last_frame = output
        .chunks_exact(2)
        .rposition(|frame| frame[0].abs().max(frame[1].abs()) > floor)
        .expect("render never crossed its relative audibility floor");

    let high_passed: Vec<f32> = output
        .chunks_exact(2)
        .map(|frame| (frame[0] + frame[1]) * 0.5)
        .collect::<Vec<_>>()
        .windows(2)
        .map(|pair| pair[1] - pair[0])
        .collect();

    let stereo_window_rms = |start_seconds: f32, end_seconds: f32| {
        let start = (start_seconds * sample_rate) as usize * 2;
        let end = ((end_seconds * sample_rate) as usize * 2).min(output.len());
        rms(&output[start..end])
    };
    let early_rms = stereo_window_rms(0.25, 0.75);
    let late_rms = stereo_window_rms(2.5, 3.0);

    Character {
        peak,
        rms: rms(output),
        active_span_ms: (last_frame - first_frame) as f32 * 1_000.0 / sample_rate,
        late_energy_ratio: late_rms / early_rms.max(1.0e-12),
        high_frequency_ratio: rms(&high_passed) / rms(output),
    }
}

fn assert_relative(
    algorithm: Algorithm,
    sample_rate: f32,
    property: &str,
    measured: f32,
    expected: f32,
    tolerance: f32,
) {
    let relative_error = (measured - expected).abs() / expected.abs().max(1.0e-12);
    assert!(
        relative_error <= tolerance,
        "{} at {sample_rate:.0} Hz changed {property}: measured {measured:.9}, expected \
         {expected:.9} (relative error {:.3}%, tolerance {:.1}%)",
        algorithm.name,
        relative_error * 100.0,
        tolerance * 100.0
    );
}

#[test]
fn exposed_non_plate_algorithms_keep_their_render_character() {
    for (rate_index, sample_rate) in SAMPLE_RATES.into_iter().enumerate() {
        for (algorithm_index, algorithm) in ALGORITHMS.into_iter().enumerate() {
            let measured = character(&render(algorithm, sample_rate), sample_rate);
            let expected = EXPECTED[rate_index][algorithm_index];

            assert_relative(
                algorithm,
                sample_rate,
                "peak level",
                measured.peak,
                expected.peak,
                0.01,
            );
            assert_relative(
                algorithm,
                sample_rate,
                "full-render RMS level",
                measured.rms,
                expected.rms,
                0.01,
            );
            assert!(
                (measured.active_span_ms - expected.active_span_ms).abs() <= 2.0,
                "{} at {sample_rate:.0} Hz changed audible duration: measured {:.3} ms, \
                 expected {:.3} ms (tolerance 2 ms)",
                algorithm.name,
                measured.active_span_ms,
                expected.active_span_ms
            );
            if expected.late_energy_ratio < 1.0e-6 {
                assert!(
                    measured.late_energy_ratio <= 1.0e-6,
                    "{} at {sample_rate:.0} Hz grew an audible late tail: late/early RMS ratio \
                     {:.9} exceeds the absolute 0.000001 ceiling",
                    algorithm.name,
                    measured.late_energy_ratio
                );
            } else {
                assert_relative(
                    algorithm,
                    sample_rate,
                    "late/early energy ratio",
                    measured.late_energy_ratio,
                    expected.late_energy_ratio,
                    0.05,
                );
            }
            assert_relative(
                algorithm,
                sample_rate,
                "high-frequency energy ratio",
                measured.high_frequency_ratio,
                expected.high_frequency_ratio,
                0.01,
            );
        }
    }
}
