//! Portable signed anchors for the shipped plate render.
//!
//! Absolute sample hashes are sensitive to last-bit `libm` differences. These
//! projections instead correlate four tail windows with deterministic signed
//! sequences and normalize each result by the window energy. The expectations
//! were captured from the retained render at f2dbf9dd, whose DSP source is
//! unchanged from the accepted 93fb72b2 baseline. An absolute tolerance of
//! 5e-5 is deliberately generous relative to last-bit accumulation while the
//! independent windows and signs remain sensitive to polarity, phase, and a
//! one-sample timing change.

const FINE_STRUCTURE_TOLERANCE: f64 = 5e-5;

#[derive(Clone, Copy)]
struct Projection {
    start: usize,
    len: usize,
    seed: u64,
    expected: f64,
}

const PROJECTIONS: [Projection; 8] = [
    Projection {
        start: 8_192,
        len: 4_096,
        seed: 0x243f_6a88_85a3_08d3,
        expected: -0.000_966_305_289_844_332_5,
    },
    Projection {
        start: 8_192,
        len: 4_096,
        seed: 0x1319_8a2e_0370_7344,
        expected: 0.012_809_590_733_836_477,
    },
    Projection {
        start: 16_384,
        len: 4_096,
        seed: 0xa409_3822_299f_31d0,
        expected: -0.019_926_592_300_536_634,
    },
    Projection {
        start: 16_384,
        len: 4_096,
        seed: 0x082e_fa98_ec4e_6c89,
        expected: -0.006_841_247_337_165_01,
    },
    Projection {
        start: 28_672,
        len: 4_096,
        seed: 0x4528_21e6_38d0_1377,
        expected: -0.008_917_875_137_738_9,
    },
    Projection {
        start: 28_672,
        len: 4_096,
        seed: 0xbe54_66cf_34e9_0c6c,
        expected: -0.009_475_524_389_340_98,
    },
    Projection {
        start: 40_960,
        len: 4_096,
        seed: 0xc0ac_29b7_c97c_50dd,
        expected: -0.009_244_170_032_398_493,
    },
    Projection {
        start: 40_960,
        len: 4_096,
        seed: 0x3f84_d5b5_b547_0917,
        expected: -0.004_936_727_975_796_815,
    },
];

fn signed_projection(output: &[f32], projection: Projection) -> f64 {
    let mut state = projection.seed;
    let mut signed_sum = 0.0_f64;
    let mut energy = 0.0_f64;
    for sample in &output[projection.start..projection.start + projection.len] {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let value = f64::from(*sample);
        signed_sum += if state & 1 == 0 { value } else { -value };
        energy += value * value;
    }
    signed_sum / (energy.sqrt() * (projection.len as f64).sqrt())
}

pub fn matches(output: &[f32]) -> bool {
    PROJECTIONS.iter().all(|projection| {
        (signed_projection(output, *projection) - projection.expected).abs()
            <= FINE_STRUCTURE_TOLERANCE
    })
}

pub fn assert_matches(output: &[f32], label: &str) {
    for (index, projection) in PROJECTIONS.iter().enumerate() {
        let actual = signed_projection(output, *projection);
        let delta = (actual - projection.expected).abs();
        assert!(
            delta <= FINE_STRUCTURE_TOLERANCE,
            "{label} changed signed fine structure at projection {index}: \
             expected {:e}, actual {actual:e}, delta {delta:e}, tolerance {:e}",
            projection.expected,
            FINE_STRUCTURE_TOLERANCE
        );
    }
}
