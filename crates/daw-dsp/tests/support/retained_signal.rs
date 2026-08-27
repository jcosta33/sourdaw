#[derive(Debug)]
pub struct Contract {
    pub peak: f64,
    pub rms: f64,
    pub projections: [f64; 4],
}

#[derive(Debug)]
struct Measurement {
    peak: f64,
    rms: f64,
    projections: [f64; 4],
}

const PROJECTION_SEEDS: [u64; 4] = [
    0x243f_6a88_85a3_08d3,
    0x1319_8a2e_0370_7344,
    0xa409_3822_299f_31d0,
    0x082e_fa98_ec4e_6c89,
];

// Expectations were captured on macOS at diagnostic head
// 355b60dbca8a7d52f7128ff9947d6a192448439d and compared with Linux run
// 32651259906. Across all five renders the largest normalized-projection
// delta was 8.856e-7 and the largest peak/RMS relative delta was 1.482e-6.
// These limits use a 16x safety margin, rounded up, for libm/toolchain drift.
const PROJECTION_ABSOLUTE_TOLERANCE: f64 = 1.5e-5;
const SHAPE_RELATIVE_TOLERANCE: f64 = 2.5e-5;

fn signed_projection(samples: &[f32], start: usize, len: usize, seed: u64) -> f64 {
    let mut state = seed;
    let mut signed_sum = 0.0_f64;
    let mut energy = 0.0_f64;
    for sample in &samples[start..start + len] {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let value = f64::from(*sample);
        signed_sum += if state & 1 == 0 { value } else { -value };
        energy += value * value;
    }
    signed_sum / (energy.sqrt() * (len as f64).sqrt())
}

fn measure(samples: &[f32]) -> Measurement {
    assert!(
        samples.len() >= 8,
        "retained signal needs at least eight samples"
    );
    let window_len = samples.len() / 8;
    let projections = std::array::from_fn(|index| {
        signed_projection(
            samples,
            index * 2 * window_len,
            window_len,
            PROJECTION_SEEDS[index],
        )
    });
    let peak = samples
        .iter()
        .map(|sample| f64::from(*sample).abs())
        .fold(0.0_f64, f64::max);
    let energy = samples
        .iter()
        .map(|sample| {
            let value = f64::from(*sample);
            value * value
        })
        .sum::<f64>();
    Measurement {
        peak,
        rms: (energy / samples.len() as f64).sqrt(),
        projections,
    }
}

fn relative_delta(actual: f64, expected: f64) -> f64 {
    (actual - expected).abs() / expected.abs()
}

pub fn matches_contract(samples: &[f32], expected: &Contract) -> bool {
    let actual = measure(samples);
    actual.peak.is_finite()
        && actual.rms.is_finite()
        && actual.peak > 0.0
        && actual.rms > 0.0
        && relative_delta(actual.peak, expected.peak) <= SHAPE_RELATIVE_TOLERANCE
        && relative_delta(actual.rms, expected.rms) <= SHAPE_RELATIVE_TOLERANCE
        && actual
            .projections
            .iter()
            .zip(expected.projections)
            .all(|(actual, expected)| {
                actual.is_finite() && (*actual - expected).abs() <= PROJECTION_ABSOLUTE_TOLERANCE
            })
}

pub fn assert_matches_contract(samples: &[f32], expected: &Contract, label: &str) {
    let actual = measure(samples);
    assert!(
        actual.peak.is_finite() && actual.rms.is_finite() && actual.peak > 0.0 && actual.rms > 0.0,
        "{label} must produce a finite, non-silent render: {actual:?}"
    );
    assert!(
        relative_delta(actual.peak, expected.peak) <= SHAPE_RELATIVE_TOLERANCE,
        "{label} peak changed: expected {}, got {}",
        expected.peak,
        actual.peak
    );
    assert!(
        relative_delta(actual.rms, expected.rms) <= SHAPE_RELATIVE_TOLERANCE,
        "{label} RMS changed: expected {}, got {}",
        expected.rms,
        actual.rms
    );
    for (index, (actual, expected)) in actual
        .projections
        .iter()
        .zip(expected.projections)
        .enumerate()
    {
        assert!(
            actual.is_finite() && (*actual - expected).abs() <= PROJECTION_ABSOLUTE_TOLERANCE,
            "{label} signed projection {index} changed: expected {expected}, got {actual}"
        );
    }
}
