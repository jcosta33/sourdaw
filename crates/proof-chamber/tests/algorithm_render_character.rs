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

const FDN_8: Algorithm = Algorithm {
    name: "FDN-8",
    wire: 1.0,
};
const FDN_16: Algorithm = Algorithm {
    name: "FDN-16",
    wire: 2.0,
};

const ALGORITHMS: [Algorithm; 4] = [
    FDN_8,
    FDN_16,
    Algorithm {
        name: "Spring",
        wire: 3.0,
    },
    Algorithm {
        name: "Reverse",
        wire: 6.0,
    },
];

/// The two engines whose delay-line tuning is a function of `size`.
const FDN_ALGORITHMS: [Algorithm; 2] = [FDN_8, FDN_16];

/// The bottom of the Size control, where the old prime-power tuning collapsed
/// hardest.
const SMALLEST_SIZE: f32 = 0.0;

/// The `dutch-oven` descriptor's default, and so what most projects render.
const DEFAULT_SIZE: f32 = 0.5;

#[derive(Clone, Copy, Debug)]
struct Character {
    peak: f32,
    rms: f32,
    active_span_ms: f32,
    late_energy_ratio: f32,
    high_frequency_ratio: f32,
}

// These are measurements, not targets. The two FDN rows were re-measured when
// the tank's delay tuning was repaired, and what the measurements show is not
// what the first attempt at this comment claimed.
//
// The old prime-power tuning collapsed hardest at `SMALLEST_SIZE`, which is
// what this table renders at. How hard depended on the cell: eight lines at
// 44.1 kHz shared two values across five of them — a *triple* on the shortest
// line plus a pair — sixteen lines at 44.1 kHz put ten of sixteen on two
// values, and eight lines at 48 kHz had two pairs.
//
// `high_frequency_ratio` is not the story, and reading it as one gets the
// mechanism backwards. It falls at three cells and *rises 22%* at FDN-8 /
// 44.1 kHz — the worst-collision cell of the four. A quantity that changes sign
// across the cells is not measuring the thing being removed. It is also a
// ratio over full-render RMS, so most of the 48 kHz fall is its denominator
// moving.
//
// The sign-consistent move is that denominator: full-render RMS rises at all
// four cells, by 10% to 63% (+4.25 dB at the widest). That is what distinct
// lengths do — sixteen distinct modal series are excited where ten lines
// previously shared two, so more of the tank contributes and the wet path
// carries more energy. Spring and Reverse read no delay-line tuning from the
// FDN and are unchanged.
const EXPECTED_AT_SMALLEST_SIZE: [[Character; 4]; 2] = [
    [
        Character {
            peak: 0.355_920_911,
            rms: 0.036_786_821,
            active_span_ms: 3_984.467,
            late_energy_ratio: 0.051_378_369,
            high_frequency_ratio: 0.187_111_273,
        },
        Character {
            peak: 0.343_176_007,
            rms: 0.042_337_045,
            active_span_ms: 3_984.467,
            late_energy_ratio: 0.053_829_677,
            high_frequency_ratio: 0.128_171_325,
        },
        Character {
            peak: 0.481_467_52,
            rms: 0.023_802_584,
            active_span_ms: 963.946,
            late_energy_ratio: 0.000_000_106,
            high_frequency_ratio: 0.170_458_42,
        },
        Character {
            peak: 0.305_436_2,
            rms: 0.011_507_511,
            active_span_ms: 102.517,
            late_energy_ratio: 0.0,
            high_frequency_ratio: 0.270_421_24,
        },
    ],
    [
        Character {
            peak: 0.293_714_762,
            rms: 0.037_104_450,
            active_span_ms: 3_984.458,
            late_energy_ratio: 0.050_845_221,
            high_frequency_ratio: 0.085_059_196,
        },
        Character {
            peak: 0.370_771_289,
            rms: 0.040_721_010,
            active_span_ms: 3_984.458,
            late_energy_ratio: 0.055_192_590,
            high_frequency_ratio: 0.092_838_548,
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

/// `FDN_ALGORITHMS` at `DEFAULT_SIZE`, in the same order, at both rates.
///
/// A separate table rather than a third dimension on the one above: only the
/// two size-tuned engines are pinned here, and a ragged dimension would have to
/// carry dead rows for Spring and Reverse.
///
/// The default size behaves differently from `SMALLEST_SIZE` and is pinned
/// separately for that reason. Here `high_frequency_ratio` rises at all four
/// cells (+4% to +27%) while full-render RMS moves in both directions (+15%,
/// +1%, −9%, −24%) — the reverse of the pattern one table up. The collisions at
/// this size were milder, so what dominates is not how many lines were freed
/// but where the window now sits: the first late arrival moved from a flat
/// 1332 samples at *both* sample rates to ~20 ms at both, which is the window
/// minimum this size asks for. A delay set that used to land on the same sample
/// count regardless of rate was the clearest sign the tuning was answering to
/// prime powers rather than to the room.
const EXPECTED_AT_DEFAULT_SIZE: [[Character; 2]; 2] = [
    [
        Character {
            peak: 0.434_468_806,
            rms: 0.027_193_857,
            active_span_ms: 3_979.864,
            late_energy_ratio: 0.049_626_954,
            high_frequency_ratio: 0.234_121_159,
        },
        Character {
            peak: 0.415_174_931,
            rms: 0.024_251_200,
            active_span_ms: 3_969.592,
            late_energy_ratio: 0.048_002_899,
            high_frequency_ratio: 0.271_005_929,
        },
    ],
    [
        Character {
            peak: 0.407_224_894,
            rms: 0.026_554_497,
            active_span_ms: 3_981.708,
            late_energy_ratio: 0.050_607_596,
            high_frequency_ratio: 0.179_569_095,
        },
        Character {
            peak: 0.373_465_598,
            rms: 0.024_114_160,
            active_span_ms: 3_979.458,
            late_energy_ratio: 0.052_145_820,
            high_frequency_ratio: 0.205_256_239,
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

fn render(algorithm: Algorithm, sample_rate: f32, size: f32) -> Vec<f32> {
    let mut chamber = ProofChamberInstance::new(sample_rate);
    chamber.set_param("algorithm", algorithm.wire);
    chamber.set_param("mix", 1.0);
    chamber.set_param("decay", 0.7);
    chamber.set_param("damping", 0.3);
    chamber.set_param("size", size);

    // Settle the wet-only mix ramp for exactly one second. Processing only
    // whole blocks would leave 44.1 and 48 kHz at different Reverse grain
    // phases and make their character measurements incomparable.
    let silence = [0.0_f32; BLOCK];
    let mut settling_frames = sample_rate as usize;
    while settling_frames > 0 {
        let frames = settling_frames.min(BLOCK);
        chamber.process(&silence[..frames], &silence[..frames], frames as u32);
        settling_frames -= frames;
    }

    let render_frames = (RENDER_SECONDS * sample_rate) as usize;
    let mut output = Vec::with_capacity(render_frames * 2);
    let mut frame = 0;
    while frame < render_frames {
        let mut input = [0.0_f32; BLOCK];
        for (offset, sample) in input.iter_mut().enumerate() {
            *sample = stimulus(frame + offset, sample_rate);
        }

        let frames = (render_frames - frame).min(BLOCK);
        let left = chamber.process(&input[..frames], &input[..frames], frames as u32);
        let right = chamber.get_right_ptr();
        assert!(!left.is_null(), "{} returned a null buffer", algorithm.name);
        for offset in 0..frames {
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
        frame += frames;
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

fn assert_character(
    algorithm: Algorithm,
    sample_rate: f32,
    measured: Character,
    expected: Character,
) {
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

#[test]
fn exposed_non_plate_algorithms_keep_their_render_character() {
    for (rate_index, sample_rate) in SAMPLE_RATES.into_iter().enumerate() {
        for (algorithm_index, algorithm) in ALGORITHMS.into_iter().enumerate() {
            let measured = character(&render(algorithm, sample_rate, SMALLEST_SIZE), sample_rate);
            assert_character(
                algorithm,
                sample_rate,
                measured,
                EXPECTED_AT_SMALLEST_SIZE[rate_index][algorithm_index],
            );
        }
    }
}

/// The same fingerprints for the FDNs at the size a user actually gets.
///
/// `SMALLEST_SIZE` is the extreme of the control, and pinning only the extreme
/// left the shipped default unmeasured — which is where a Size retune is heard
/// by everyone who never touches the knob. The two engines whose tuning depends
/// on Size are the two pinned here; Spring and Reverse do not read it into a
/// delay-line set.
#[test]
fn the_fdn_engines_keep_their_render_character_at_the_default_size() {
    for (rate_index, sample_rate) in SAMPLE_RATES.into_iter().enumerate() {
        for (algorithm_index, algorithm) in FDN_ALGORITHMS.into_iter().enumerate() {
            let measured = character(&render(algorithm, sample_rate, DEFAULT_SIZE), sample_rate);
            assert_character(
                algorithm,
                sample_rate,
                measured,
                EXPECTED_AT_DEFAULT_SIZE[rate_index][algorithm_index],
            );
        }
    }
}
