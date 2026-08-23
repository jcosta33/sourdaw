#[derive(Debug)]
pub struct Measurement {
    pub peak: f64,
    pub rms: f64,
    pub projections: [f64; 4],
}

const PROJECTION_SEEDS: [u64; 4] = [
    0x243f_6a88_85a3_08d3,
    0x1319_8a2e_0370_7344,
    0xa409_3822_299f_31d0,
    0x082e_fa98_ec4e_6c89,
];

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

pub fn measure(samples: &[f32]) -> Measurement {
    assert!(
        samples.len() >= 8,
        "retained signal needs at least eight samples"
    );
    let window_len = samples.len() / 8;
    let projections = PROJECTION_SEEDS.map(|seed| {
        let index = PROJECTION_SEEDS
            .iter()
            .position(|candidate| *candidate == seed)
            .expect("projection seed belongs to the fixed set");
        signed_projection(samples, index * 2 * window_len, window_len, seed)
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
